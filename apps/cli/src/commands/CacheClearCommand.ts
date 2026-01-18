import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SerializableEdgeWorkerState } from "cyrus-core";
import { BaseCommand } from "./ICommand.js";

/**
 * State file structure (version 2.0)
 */
interface StateFile {
	version: string;
	savedAt: string;
	state: SerializableEdgeWorkerState;
}

/**
 * Cache entry with issue identifier for display purposes
 */
interface CacheEntry {
	issueId: string;
	repositoryId: string;
	issueIdentifier?: string;
}

/**
 * Command to clear the repository cache for issues.
 *
 * Usage:
 *   cyrus cache clear <pattern>
 *
 * Pattern is required and can be:
 *   - "*" - Clear all cache entries
 *   - "RUB-*" - Clear entries for issues with identifiers starting with "RUB-"
 *   - "RUB-101" - Clear entry for a specific issue identifier
 *
 * Use "cyrus cache list" to see cached entries before clearing.
 */
export class CacheClearCommand extends BaseCommand {
	private getStateFilePath(): string {
		return join(this.app.cyrusHome, "state", "edge-worker-state.json");
	}

	async execute(args: string[]): Promise<void> {
		const pattern = args[0];

		// Pattern is required
		if (!pattern) {
			this.logError("Pattern is required.");
			this.logger.info("");
			this.logger.info("Usage: cyrus cache clear <pattern>");
			this.logger.info("");
			this.logger.info("Pattern can be:");
			this.logger.info('  "*"       - Clear all entries');
			this.logger.info('  "RUB-*"   - Clear entries matching prefix');
			this.logger.info('  "RUB-101" - Clear specific issue');
			this.logger.info("");
			this.logger.info('Use "cyrus cache list" to see cached entries.');
			process.exit(1);
		}

		const stateFilePath = this.getStateFilePath();

		if (!existsSync(stateFilePath)) {
			this.logger.info("No cache file found. Nothing to clear.");
			return;
		}

		// Load and parse state file
		let stateFile: StateFile;
		try {
			const content = await readFile(stateFilePath, "utf-8");
			stateFile = JSON.parse(content);
		} catch (error) {
			this.logError(`Failed to read state file: ${error}`);
			process.exit(1);
		}

		if (stateFile.version !== "2.0") {
			this.logError(
				`Unsupported state file version: ${stateFile.version}. Expected 2.0`,
			);
			process.exit(1);
		}

		const state = stateFile.state;
		const cache = state.issueRepositoryCache || {};

		// Build cache entries with issue identifiers from agentSessions
		const cacheEntries = this.buildCacheEntries(state, cache);

		if (cacheEntries.length === 0) {
			this.logger.info("Cache is empty. Nothing to clear.");
			return;
		}

		// Find entries matching the pattern
		const matchingEntries = this.findMatchingEntries(cacheEntries, pattern);

		if (matchingEntries.length === 0) {
			this.logger.info(`No cache entries match pattern "${pattern}".`);
			return;
		}

		// Clear matching entries
		await this.clearEntries(stateFile, matchingEntries, stateFilePath);

		this.logSuccess(
			`Cleared ${matchingEntries.length} cache ${matchingEntries.length === 1 ? "entry" : "entries"}.`,
		);
	}

	/**
	 * Build cache entries with issue identifiers from agentSessions
	 */
	private buildCacheEntries(
		state: SerializableEdgeWorkerState,
		cache: Record<string, string>,
	): CacheEntry[] {
		const entries: CacheEntry[] = [];

		// Build a map of issueId -> identifier from agentSessions
		const issueIdToIdentifier = new Map<string, string>();
		if (state.agentSessions) {
			for (const repoSessions of Object.values(state.agentSessions)) {
				for (const session of Object.values(repoSessions)) {
					if (session.issueId && session.issue?.identifier) {
						issueIdToIdentifier.set(session.issueId, session.issue.identifier);
					}
				}
			}
		}

		// Build cache entries with identifiers
		for (const [issueId, repositoryId] of Object.entries(cache)) {
			entries.push({
				issueId,
				repositoryId,
				issueIdentifier: issueIdToIdentifier.get(issueId),
			});
		}

		return entries;
	}

	/**
	 * Find cache entries matching the given pattern
	 */
	private findMatchingEntries(
		entries: CacheEntry[],
		pattern: string,
	): CacheEntry[] {
		// Wildcard - match all
		if (pattern === "*") {
			return entries;
		}

		// Prefix pattern (e.g., "RUB-*")
		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			return entries.filter((entry) => {
				// Match on identifier if available
				if (entry.issueIdentifier) {
					return entry.issueIdentifier.startsWith(prefix);
				}
				// Fall back to matching on issue ID
				return entry.issueId.startsWith(prefix);
			});
		}

		// Exact match (e.g., "RUB-101")
		return entries.filter((entry) => {
			// Match on identifier if available
			if (entry.issueIdentifier) {
				return entry.issueIdentifier === pattern;
			}
			// Fall back to matching on issue ID
			return entry.issueId === pattern;
		});
	}

	/**
	 * Clear the matching cache entries and save the state file
	 */
	private async clearEntries(
		stateFile: StateFile,
		entriesToClear: CacheEntry[],
		stateFilePath: string,
	): Promise<void> {
		const cache = stateFile.state.issueRepositoryCache || {};

		// Log what we're clearing
		for (const entry of entriesToClear) {
			const identifier = entry.issueIdentifier || entry.issueId;
			this.logger.info(`  Clearing: ${identifier}`);
		}

		// Remove entries from cache
		for (const entry of entriesToClear) {
			delete cache[entry.issueId];
		}

		// Update state file
		stateFile.state.issueRepositoryCache = cache;
		stateFile.savedAt = new Date().toISOString();

		// Write back to disk
		await writeFile(stateFilePath, JSON.stringify(stateFile, null, 2), "utf-8");
	}
}
