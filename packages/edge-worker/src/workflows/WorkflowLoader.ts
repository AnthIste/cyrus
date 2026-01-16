/**
 * Loader for workflow definitions from local filesystem or Git repositories
 *
 * This class handles discovering, loading, and caching workflows from either
 * a local directory or a remote Git repository. It uses WorkflowParser to
 * parse and validate the YAML workflow files.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";

import type { ProcedureDefinition } from "../procedures/types.js";
import type { WorkflowCollection, WorkflowDefinition } from "./types.js";
import { WorkflowParser } from "./WorkflowParser.js";

/**
 * Configuration for the WorkflowLoader
 */
export interface WorkflowLoaderConfig {
	/**
	 * Source for workflows. Can be:
	 * - Local filesystem path (e.g., "/path/to/workflows")
	 * - Git HTTPS URL (e.g., "https://github.com/org/repo.git")
	 * - Git SSH URL (e.g., "git@github.com:org/repo.git")
	 */
	source: string;

	/**
	 * Git branch to use. Only applies when source is a Git URL.
	 * @default "main"
	 */
	branch?: string;

	/**
	 * Subdirectory within the repository containing workflow files.
	 * This is where YAML workflow files and prompt files are located.
	 * @default "workflows/"
	 */
	path?: string;

	/**
	 * Whether to enable caching of parsed workflows.
	 * When enabled, workflows are only re-parsed if files change.
	 * @default true
	 */
	cacheEnabled?: boolean;
}

/**
 * Internal cache entry for a parsed workflow
 */
interface WorkflowCacheEntry {
	/** The parsed workflow definition */
	workflow: WorkflowDefinition;
	/** The converted procedure definition */
	procedure: ProcedureDefinition;
	/** File modification time when cached */
	mtime: number;
	/** Content hash for change detection */
	contentHash: string;
}

/**
 * Result of a load operation
 */
export interface LoadResult {
	/** Number of workflows loaded */
	count: number;
	/** Files that were successfully parsed */
	parsedFiles: string[];
	/** Errors encountered during loading, keyed by filename */
	errors: Record<string, string>;
	/** Whether the load was from cache */
	fromCache: boolean;
}

/**
 * Loader for workflow definitions from local filesystem or Git repositories.
 *
 * Features:
 * - Load from local directories
 * - Clone and fetch from Git repositories (HTTPS and SSH)
 * - File-based caching to avoid re-parsing unchanged files
 * - Manual refresh capability
 */
export class WorkflowLoader {
	private readonly config: Required<WorkflowLoaderConfig>;
	private readonly parser: WorkflowParser;
	private readonly cache = new Map<string, WorkflowCacheEntry>();
	private procedures = new Map<string, ProcedureDefinition>();
	private workflows = new Map<string, WorkflowDefinition>();
	private workingDirectory: string | null = null;
	private git: SimpleGit | null = null;
	private isGitSource: boolean;
	private lastLoadErrors: Record<string, string> = {};

	/**
	 * Create a new WorkflowLoader
	 *
	 * @param config - Configuration for the loader
	 * @param parser - Optional WorkflowParser instance. If not provided, a new one is created.
	 */
	constructor(config: WorkflowLoaderConfig, parser?: WorkflowParser) {
		this.config = {
			source: config.source,
			branch: config.branch ?? "main",
			path: config.path ?? "workflows/",
			cacheEnabled: config.cacheEnabled ?? true,
		};

		this.parser = parser ?? new WorkflowParser();
		this.isGitSource = this.isGitUrl(config.source);
	}

	/**
	 * Check if a source string is a Git URL
	 */
	private isGitUrl(source: string): boolean {
		// HTTPS URLs
		if (source.startsWith("https://") && source.endsWith(".git")) {
			return true;
		}
		// SSH URLs (git@github.com:org/repo.git)
		if (source.startsWith("git@") && source.includes(":")) {
			return true;
		}
		// Explicit git:// protocol
		if (source.startsWith("git://")) {
			return true;
		}
		return false;
	}

	/**
	 * Generate a deterministic directory name for a Git repository
	 */
	private getGitWorkingDirectory(): string {
		const hash = crypto
			.createHash("sha256")
			.update(this.config.source)
			.digest("hex")
			.substring(0, 16);
		const safeName = this.config.source
			.replace(/[^a-zA-Z0-9]/g, "-")
			.substring(0, 32);
		return path.join(os.tmpdir(), `cyrus-workflows-${safeName}-${hash}`);
	}

	/**
	 * Get the base path for workflow files
	 */
	private getWorkflowBasePath(): string {
		if (this.isGitSource) {
			// For Git sources, use the expected working directory path
			// This allows getWorkflowPath() to be called before load()
			const workDir = this.workingDirectory ?? this.getGitWorkingDirectory();
			return path.join(workDir, this.config.path);
		}
		return path.join(this.config.source, this.config.path);
	}

	/**
	 * Initialize the Git repository (clone or validate existing)
	 */
	private async initializeGitRepo(): Promise<void> {
		this.workingDirectory = this.getGitWorkingDirectory();

		if (fs.existsSync(this.workingDirectory)) {
			// Directory exists, validate it's a git repo and fetch
			const git = simpleGit(this.workingDirectory);
			this.git = git;
			try {
				await git.fetch("origin");
				await git.checkout(this.config.branch);
				await git.reset(["--hard", `origin/${this.config.branch}`]);
			} catch {
				// If fetch/checkout fails, re-clone
				fs.rmSync(this.workingDirectory, { recursive: true, force: true });
				await this.cloneRepo();
			}
		} else {
			await this.cloneRepo();
		}
	}

	/**
	 * Clone the Git repository
	 */
	private async cloneRepo(): Promise<void> {
		this.workingDirectory = this.getGitWorkingDirectory();

		// Create parent directory if needed
		const parentDir = path.dirname(this.workingDirectory);
		if (!fs.existsSync(parentDir)) {
			fs.mkdirSync(parentDir, { recursive: true });
		}

		// Clone with specific branch
		const git = simpleGit();
		await git.clone(this.config.source, this.workingDirectory, [
			"--branch",
			this.config.branch,
			"--single-branch",
			"--depth",
			"1",
		]);

		// Re-initialize git instance for the cloned repo
		this.git = simpleGit(this.workingDirectory);
	}

	/**
	 * Calculate a content hash for a file
	 */
	private calculateHash(content: string): string {
		return crypto.createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Check if a cached entry is still valid
	 */
	private isCacheValid(filePath: string, entry: WorkflowCacheEntry): boolean {
		if (!this.config.cacheEnabled) {
			return false;
		}

		try {
			const stat = fs.statSync(filePath);
			const content = fs.readFileSync(filePath, "utf-8");
			const hash = this.calculateHash(content);

			return stat.mtimeMs === entry.mtime && hash === entry.contentHash;
		} catch {
			return false;
		}
	}

	/**
	 * Load all workflows from the configured source.
	 *
	 * For Git sources, this will clone the repository on first call
	 * or fetch updates on subsequent calls.
	 *
	 * @returns Map of workflow name to ProcedureDefinition
	 */
	async load(): Promise<Map<string, ProcedureDefinition>> {
		// Initialize Git repo if needed
		if (this.isGitSource && !this.workingDirectory) {
			await this.initializeGitRepo();
		}

		const basePath = this.getWorkflowBasePath();

		// Check if the workflow directory exists
		if (!fs.existsSync(basePath)) {
			this.lastLoadErrors = {
				_directory: `Workflow directory does not exist: ${basePath}`,
			};
			return this.procedures;
		}

		// Determine if basePath is a file or directory
		const stat = fs.statSync(basePath);

		if (stat.isFile()) {
			// Single file mode
			await this.loadSingleFile(basePath);
		} else if (stat.isDirectory()) {
			// Directory mode - find all YAML files
			await this.loadDirectory(basePath);
		}

		return this.procedures;
	}

	/**
	 * Load workflows from a single YAML file
	 */
	private async loadSingleFile(filePath: string): Promise<void> {
		const cacheKey = filePath;
		const cachedEntry = this.cache.get(cacheKey);

		// Check cache
		if (cachedEntry && this.isCacheValid(filePath, cachedEntry)) {
			this.workflows.set(cachedEntry.workflow.name, cachedEntry.workflow);
			this.procedures.set(cachedEntry.procedure.name, cachedEntry.procedure);
			return;
		}

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const collection = this.parser.parseAndValidate(content);
			const promptBasePath = path.dirname(filePath);
			const stat = fs.statSync(filePath);
			const hash = this.calculateHash(content);

			for (const workflow of collection.workflows) {
				const procedure = this.parser.toProcedureDefinition(
					workflow,
					promptBasePath,
				);

				// Update cache
				if (this.config.cacheEnabled) {
					this.cache.set(`${filePath}:${workflow.name}`, {
						workflow,
						procedure,
						mtime: stat.mtimeMs,
						contentHash: hash,
					});
				}

				this.workflows.set(workflow.name, workflow);
				this.procedures.set(procedure.name, procedure);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			this.lastLoadErrors[path.basename(filePath)] = message;
		}
	}

	/**
	 * Load workflows from a directory of YAML files
	 */
	private async loadDirectory(dirPath: string): Promise<void> {
		const result = this.parser.parseDirectory(dirPath);
		this.lastLoadErrors = result.errors;

		// Convert workflows to procedures and update caches
		for (const workflow of result.collection.workflows) {
			const procedure = this.parser.toProcedureDefinition(workflow, dirPath);

			this.workflows.set(workflow.name, workflow);
			this.procedures.set(procedure.name, procedure);

			// Update cache for each workflow
			if (this.config.cacheEnabled) {
				// For directory mode, we use a composite key
				// Note: mtime and hash tracking is less precise in directory mode
				// since parseDirectory doesn't return per-file information
				this.cache.set(`${dirPath}:${workflow.name}`, {
					workflow,
					procedure,
					mtime: Date.now(),
					contentHash: workflow.name, // Simplified for directory mode
				});
			}
		}
	}

	/**
	 * Refresh workflows from the source.
	 *
	 * For Git sources, this fetches the latest changes and resets to the branch.
	 * For local sources, this re-reads all files.
	 *
	 * Caches are invalidated during refresh.
	 */
	async refresh(): Promise<void> {
		// Clear current state
		this.cache.clear();
		this.procedures.clear();
		this.workflows.clear();
		this.lastLoadErrors = {};

		// For Git sources, fetch and reset
		if (this.isGitSource && this.git && this.workingDirectory) {
			try {
				await this.git.fetch("origin");
				await this.git.reset(["--hard", `origin/${this.config.branch}`]);
			} catch {
				// If fetch fails, try re-cloning
				fs.rmSync(this.workingDirectory, { recursive: true, force: true });
				this.workingDirectory = null;
				this.git = null;
			}
		}

		// Reload workflows
		await this.load();
	}

	/**
	 * Get a specific workflow by name
	 *
	 * @param name - The workflow name
	 * @returns The ProcedureDefinition or undefined if not found
	 */
	get(name: string): ProcedureDefinition | undefined {
		return this.procedures.get(name);
	}

	/**
	 * Get a specific workflow definition by name
	 *
	 * @param name - The workflow name
	 * @returns The WorkflowDefinition or undefined if not found
	 */
	getWorkflow(name: string): WorkflowDefinition | undefined {
		return this.workflows.get(name);
	}

	/**
	 * Get all loaded workflows as ProcedureDefinitions
	 *
	 * @returns Array of all loaded ProcedureDefinitions
	 */
	getAll(): ProcedureDefinition[] {
		return Array.from(this.procedures.values());
	}

	/**
	 * Get all loaded workflow definitions
	 *
	 * @returns Array of all loaded WorkflowDefinitions
	 */
	getAllWorkflows(): WorkflowDefinition[] {
		return Array.from(this.workflows.values());
	}

	/**
	 * Get the workflow collection (raw parsed workflows)
	 *
	 * @returns WorkflowCollection containing all loaded workflows
	 */
	getCollection(): WorkflowCollection {
		return {
			workflows: this.getAllWorkflows(),
		};
	}

	/**
	 * Get the number of loaded workflows
	 */
	get count(): number {
		return this.procedures.size;
	}

	/**
	 * Get any errors from the last load operation
	 */
	getErrors(): Record<string, string> {
		return { ...this.lastLoadErrors };
	}

	/**
	 * Check if the loader has any loaded workflows
	 */
	hasWorkflows(): boolean {
		return this.procedures.size > 0;
	}

	/**
	 * Get the resolved workflow directory path
	 * Useful for debugging and testing
	 */
	getWorkflowPath(): string {
		return this.getWorkflowBasePath();
	}

	/**
	 * Clean up temporary directories (for Git sources)
	 * Call this when the loader is no longer needed
	 */
	cleanup(): void {
		if (this.isGitSource && this.workingDirectory) {
			try {
				fs.rmSync(this.workingDirectory, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors
			}
			this.workingDirectory = null;
			this.git = null;
		}
		this.cache.clear();
		this.procedures.clear();
		this.workflows.clear();
	}
}
