import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
 * Command to list the repository cache entries.
 *
 * Usage:
 *   cyrus cache list
 */
export class CacheListCommand extends BaseCommand {
	private getStateFilePath(): string {
		return join(this.app.cyrusHome, "state", "edge-worker-state.json");
	}

	async execute(_args: string[]): Promise<void> {
		const stateFilePath = this.getStateFilePath();

		if (!existsSync(stateFilePath)) {
			this.logger.info("No cache file found.");
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
			this.logger.info("Cache is empty.");
			return;
		}

		this.listCacheEntries(cacheEntries);
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
	 * List all cache entries
	 */
	private listCacheEntries(entries: CacheEntry[]): void {
		this.logger.info(`Found ${entries.length} cached repository selections:\n`);

		for (const entry of entries) {
			const identifier = entry.issueIdentifier || "(unknown identifier)";
			this.logger.info(`  ${identifier}`);
			this.logger.info(`    Issue ID: ${entry.issueId}`);
			this.logger.info(`    Repository ID: ${entry.repositoryId}`);
			this.logger.info("");
		}

		this.logger.info(
			'Use "cyrus cache clear <pattern>" to clear entries. Pattern can be:',
		);
		this.logger.info("  *         - Clear all entries");
		this.logger.info("  RUB-*     - Clear entries matching prefix");
		this.logger.info("  RUB-101   - Clear specific issue");
	}
}
