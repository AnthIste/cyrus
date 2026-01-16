/**
 * Loader for workflow definitions from local filesystem or Git repositories
 *
 * This class handles discovering, loading, and caching workflows from either
 * a local directory or a remote Git repository. It uses WorkflowParser to
 * parse and validate the YAML workflow files.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
}

/**
 * Loader for workflow definitions from local filesystem or Git repositories.
 *
 * Features:
 * - Load from local directories
 * - Clone and fetch from Git repositories (HTTPS and SSH)
 * - Manual refresh capability
 */
export class WorkflowLoader {
	private readonly config: Required<Omit<WorkflowLoaderConfig, "cacheEnabled">>;
	private readonly parser: WorkflowParser;
	private procedures = new Map<string, ProcedureDefinition>();
	private workflows = new Map<string, WorkflowDefinition>();
	private workingDirectory: string | null = null;
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
	 * Extract repository name from a Git URL
	 *
	 * Examples:
	 * - "https://github.com/org/repo.git" -> "repo"
	 * - "git@github.com:org/repo.git" -> "repo"
	 * - "https://github.com/org/my-workflows.git" -> "my-workflows"
	 */
	private extractRepoName(source: string): string {
		// Remove trailing .git if present
		let name = source.replace(/\.git$/, "");

		// Handle SSH URLs (git@github.com:org/repo)
		if (name.includes(":") && name.startsWith("git@")) {
			name = name.split(":").pop() || name;
		}

		// Get the last path segment (repo name)
		name = name.split("/").pop() || name;

		return name;
	}

	/**
	 * Get the working directory for a Git repository
	 * Uses ~/.cyrus/workflows/{repo-name} to match Cyrus's pattern
	 */
	private getGitWorkingDirectory(): string {
		const repoName = this.extractRepoName(this.config.source);
		return path.join(os.homedir(), ".cyrus", "workflows", repoName);
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
	private initializeGitRepo(): void {
		this.workingDirectory = this.getGitWorkingDirectory();

		if (fs.existsSync(this.workingDirectory)) {
			// Directory exists, validate it's a git repo and fetch
			try {
				execSync("git fetch origin", {
					cwd: this.workingDirectory,
					stdio: "pipe",
				});
				execSync(`git checkout "${this.config.branch}"`, {
					cwd: this.workingDirectory,
					stdio: "pipe",
				});
				execSync(`git reset --hard "origin/${this.config.branch}"`, {
					cwd: this.workingDirectory,
					stdio: "pipe",
				});
			} catch {
				// If fetch/checkout fails, re-clone
				fs.rmSync(this.workingDirectory, { recursive: true, force: true });
				this.cloneRepo();
			}
		} else {
			this.cloneRepo();
		}
	}

	/**
	 * Clone the Git repository
	 */
	private cloneRepo(): void {
		this.workingDirectory = this.getGitWorkingDirectory();

		// Create parent directory if needed
		const parentDir = path.dirname(this.workingDirectory);
		if (!fs.existsSync(parentDir)) {
			fs.mkdirSync(parentDir, { recursive: true });
		}

		// Clone with specific branch (shallow clone for efficiency)
		execSync(
			`git clone --branch "${this.config.branch}" --single-branch --depth 1 "${this.config.source}" "${this.workingDirectory}"`,
			{ stdio: "pipe" },
		);
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
			this.initializeGitRepo();
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
			this.loadSingleFile(basePath);
		} else if (stat.isDirectory()) {
			// Directory mode - find all YAML files
			this.loadDirectory(basePath);
		}

		return this.procedures;
	}

	/**
	 * Load workflows from a single YAML file
	 */
	private loadSingleFile(filePath: string): void {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const collection = this.parser.parseAndValidate(content);
			const promptBasePath = path.dirname(filePath);

			for (const workflow of collection.workflows) {
				const procedure = this.parser.toProcedureDefinition(
					workflow,
					promptBasePath,
				);
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
	private loadDirectory(dirPath: string): void {
		const result = this.parser.parseDirectory(dirPath);
		this.lastLoadErrors = result.errors;

		// Convert workflows to procedures
		for (const workflow of result.collection.workflows) {
			const procedure = this.parser.toProcedureDefinition(workflow, dirPath);
			this.workflows.set(workflow.name, workflow);
			this.procedures.set(procedure.name, procedure);
		}
	}

	/**
	 * Refresh workflows from the source.
	 *
	 * For Git sources, this fetches the latest changes and resets to the branch.
	 * For local sources, this re-reads all files.
	 */
	async refresh(): Promise<void> {
		// Clear current state
		this.procedures.clear();
		this.workflows.clear();
		this.lastLoadErrors = {};

		// For Git sources, fetch and reset
		if (this.isGitSource && this.workingDirectory) {
			try {
				execSync("git fetch origin", {
					cwd: this.workingDirectory,
					stdio: "pipe",
				});
				execSync(`git reset --hard "origin/${this.config.branch}"`, {
					cwd: this.workingDirectory,
					stdio: "pipe",
				});
			} catch {
				// If fetch fails, try re-cloning
				fs.rmSync(this.workingDirectory, { recursive: true, force: true });
				this.workingDirectory = null;
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
		}
		this.procedures.clear();
		this.workflows.clear();
	}
}
