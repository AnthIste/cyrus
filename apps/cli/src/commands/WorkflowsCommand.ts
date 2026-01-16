import * as fs from "node:fs";
import * as path from "node:path";
import {
	PROCEDURES,
	type WorkflowDefinition,
	WorkflowLoader,
	WorkflowParser,
} from "cyrus-edge-worker";
import type { Application } from "../Application.js";
import { BaseCommand } from "./ICommand.js";

/**
 * Represents a workflow with its source (built-in or external)
 */
interface WorkflowInfo {
	name: string;
	source: "built-in" | "external";
	description: string;
	triggers?: {
		classifications?: string[];
		labels?: string[];
		keywords?: string[];
	};
	subroutineCount: number;
}

/**
 * CLI command for managing workflows
 *
 * Subcommands:
 * - list: List all loaded workflows (built-in + external)
 * - refresh: Manually refresh external workflows
 * - validate <path>: Validate a workflow YAML file
 * - show <name>: Show details of a specific workflow
 */
export class WorkflowsCommand extends BaseCommand {
	private parser: WorkflowParser;

	constructor(app: Application) {
		super(app);
		this.parser = new WorkflowParser();
	}

	async execute(args: string[]): Promise<void> {
		const subcommand = args[0];

		switch (subcommand) {
			case "list":
				await this.list();
				break;
			case "refresh":
				await this.refresh();
				break;
			case "validate":
				await this.validate(args[1]);
				break;
			case "show":
				await this.show(args[1]);
				break;
			case undefined:
			case "":
				this.showHelp();
				break;
			default:
				this.logError(`Unknown subcommand: ${subcommand}`);
				this.showHelp();
				process.exit(1);
		}
	}

	/**
	 * Show help for the workflows command
	 */
	private showHelp(): void {
		this.logger.raw("");
		this.logger.raw("Usage: cyrus workflows <subcommand> [options]");
		this.logger.raw("");
		this.logger.raw("Subcommands:");
		this.logger.raw("  list              List all loaded workflows");
		this.logger.raw(
			"  refresh           Refresh external workflows from source",
		);
		this.logger.raw("  validate <path>   Validate a workflow YAML file");
		this.logger.raw("  show <name>       Show details of a specific workflow");
		this.logger.raw("");
	}

	/**
	 * List all workflows (built-in + external)
	 */
	private async list(): Promise<void> {
		const workflows: WorkflowInfo[] = [];

		// Get built-in workflows from registry
		for (const [name, procedure] of Object.entries(PROCEDURES)) {
			workflows.push({
				name,
				source: "built-in",
				description: procedure.description,
				subroutineCount: procedure.subroutines.length,
			});
		}

		// Get external workflows if configured
		const config = this.app.config.load();
		if (config.workflowsRepository) {
			try {
				const loader = new WorkflowLoader({
					...config.workflowsRepository,
					cyrusHome: this.app.cyrusHome,
				});

				await loader.load();
				const externalWorkflows = loader.getAllWorkflows();

				for (const workflow of externalWorkflows) {
					// Check if this overrides a built-in
					const existingIndex = workflows.findIndex(
						(w) => w.name === workflow.name,
					);

					const info: WorkflowInfo = {
						name: workflow.name,
						source: "external",
						description: workflow.description,
						triggers: workflow.triggers
							? {
									classifications: workflow.triggers.classifications,
									labels: workflow.triggers.labels,
									keywords: workflow.triggers.keywords,
								}
							: undefined,
						subroutineCount: workflow.subroutines.length,
					};

					if (existingIndex >= 0) {
						// External overrides built-in
						workflows[existingIndex] = info;
					} else {
						workflows.push(info);
					}
				}

				// Check for errors
				const errors = loader.getErrors();
				if (Object.keys(errors).length > 0) {
					this.logger.warn("Some workflows failed to load:");
					for (const [file, error] of Object.entries(errors)) {
						this.logger.warn(`  ${file}: ${error}`);
					}
					this.logger.raw("");
				}
			} catch (error) {
				this.logger.warn(
					`Failed to load external workflows: ${(error as Error).message}`,
				);
			}
		}

		// Sort workflows by name
		workflows.sort((a, b) => a.name.localeCompare(b.name));

		// Display table header
		this.logger.raw("");
		this.logger.raw(
			`${"NAME".padEnd(25)} ${"SOURCE".padEnd(12)} ${"TRIGGERS".padEnd(40)}`,
		);
		this.logDivider();

		// Display each workflow
		for (const workflow of workflows) {
			const triggers = this.formatTriggers(workflow.triggers);
			this.logger.raw(
				`${workflow.name.padEnd(25)} ${workflow.source.padEnd(12)} ${triggers.padEnd(40)}`,
			);
		}

		this.logger.raw("");
		this.logger.info(`Total: ${workflows.length} workflow(s)`);

		// Show external source info if configured
		if (config.workflowsRepository) {
			this.logger.info(`External source: ${config.workflowsRepository.source}`);
		} else {
			this.logger.info(
				"No external workflow repository configured. Using built-in workflows only.",
			);
		}
	}

	/**
	 * Format triggers for display
	 */
	private formatTriggers(triggers?: WorkflowInfo["triggers"]): string {
		if (!triggers) return "-";

		const parts: string[] = [];

		if (triggers.classifications?.length) {
			parts.push(`classifications: [${triggers.classifications.join(", ")}]`);
		}
		if (triggers.labels?.length) {
			parts.push(`labels: [${triggers.labels.join(", ")}]`);
		}
		if (triggers.keywords?.length) {
			parts.push(`keywords: [${triggers.keywords.join(", ")}]`);
		}

		return parts.length > 0 ? parts.join("; ") : "-";
	}

	/**
	 * Refresh external workflows
	 */
	private async refresh(): Promise<void> {
		const config = this.app.config.load();

		if (!config.workflowsRepository) {
			this.logger.info(
				"No external workflow repository configured in config.json.",
			);
			this.logger.info(
				"Add a workflowsRepository configuration to enable external workflows:",
			);
			this.logger.raw("");
			this.logger.raw('  "workflowsRepository": {');
			this.logger.raw('    "source": "https://github.com/org/repo.git",');
			this.logger.raw('    "branch": "main",');
			this.logger.raw('    "path": "workflows/"');
			this.logger.raw("  }");
			this.logger.raw("");
			return;
		}

		this.logger.info(`Refreshing from ${config.workflowsRepository.source}...`);

		try {
			const loader = new WorkflowLoader({
				...config.workflowsRepository,
				cyrusHome: this.app.cyrusHome,
			});

			// Force refresh by loading and then refreshing
			await loader.load();
			await loader.refresh();

			const count = loader.count;
			const errors = loader.getErrors();

			if (Object.keys(errors).length > 0) {
				this.logger.warn("Some workflows failed to load:");
				for (const [file, error] of Object.entries(errors)) {
					this.logger.warn(`  ${file}: ${error}`);
				}
			}

			this.logSuccess(`Loaded ${count} workflow(s) from external repository.`);
			this.logger.info(`Workflow path: ${loader.getWorkflowPath()}`);
		} catch (error) {
			this.logError(`Failed to refresh workflows: ${(error as Error).message}`);
			process.exit(1);
		}
	}

	/**
	 * Validate a workflow YAML file
	 */
	private async validate(filePath?: string): Promise<void> {
		if (!filePath) {
			this.logError("Please provide a path to a workflow file or directory.");
			this.logger.raw("");
			this.logger.raw("Usage: cyrus workflows validate <path>");
			this.logger.raw("");
			this.logger.raw("Examples:");
			this.logger.raw("  cyrus workflows validate ./my-workflow.yaml");
			this.logger.raw("  cyrus workflows validate ./workflows/");
			process.exit(1);
		}

		const absolutePath = path.resolve(filePath);

		if (!fs.existsSync(absolutePath)) {
			this.logError(`Path does not exist: ${absolutePath}`);
			process.exit(1);
		}

		const stat = fs.statSync(absolutePath);

		if (stat.isDirectory()) {
			await this.validateDirectory(absolutePath);
		} else {
			await this.validateFile(absolutePath);
		}
	}

	/**
	 * Validate a single workflow file
	 */
	private async validateFile(filePath: string): Promise<void> {
		this.logger.info(`Validating ${filePath}...`);
		this.logger.raw("");

		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const collection = this.parser.parseAndValidate(content);

			this.logSuccess("Schema valid");

			// Check if referenced prompt files exist
			const basePath = path.dirname(filePath);
			let allPromptsExist = true;
			const missingPrompts: string[] = [];

			for (const workflow of collection.workflows) {
				for (const subroutine of workflow.subroutines) {
					const promptPath = path.join(basePath, subroutine.prompt_file);
					if (!fs.existsSync(promptPath)) {
						allPromptsExist = false;
						missingPrompts.push(subroutine.prompt_file);
					}
				}
			}

			if (allPromptsExist) {
				this.logSuccess("All referenced prompt files exist");
			} else {
				this.logger.warn("Missing prompt files:");
				for (const missing of missingPrompts) {
					this.logger.warn(`  - ${missing}`);
				}
			}

			this.logger.raw("");

			if (allPromptsExist) {
				this.logSuccess("Workflow ready to use");
			} else {
				this.logger.warn(
					"Workflow has validation errors. Fix missing prompt files before use.",
				);
				process.exit(1);
			}

			// Show summary of workflows found
			this.logger.raw("");
			this.logger.info(`Found ${collection.workflows.length} workflow(s):`);
			for (const workflow of collection.workflows) {
				this.logger.info(
					`  - ${workflow.name} (${workflow.subroutines.length} subroutines)`,
				);
			}
		} catch (error) {
			this.logError(`Validation failed: ${(error as Error).message}`);
			process.exit(1);
		}
	}

	/**
	 * Validate a directory of workflow files
	 */
	private async validateDirectory(dirPath: string): Promise<void> {
		this.logger.info(`Validating directory ${dirPath}...`);
		this.logger.raw("");

		const result = this.parser.parseDirectory(dirPath);

		if (
			result.parsedFiles.length === 0 &&
			Object.keys(result.errors).length === 0
		) {
			this.logger.warn("No YAML files found in directory.");
			return;
		}

		// Show parsed files
		if (result.parsedFiles.length > 0) {
			this.logSuccess(
				`Successfully parsed ${result.parsedFiles.length} file(s):`,
			);
			for (const file of result.parsedFiles) {
				this.logger.info(`  - ${file}`);
			}
		}

		// Show errors
		if (Object.keys(result.errors).length > 0) {
			this.logger.raw("");
			this.logError(
				`Failed to parse ${Object.keys(result.errors).length} file(s):`,
			);
			for (const [file, error] of Object.entries(result.errors)) {
				this.logger.error(`  ${file}: ${error}`);
			}
		}

		// Check prompt files for all parsed workflows
		let allPromptsExist = true;
		const missingPrompts: string[] = [];

		for (const workflow of result.collection.workflows) {
			for (const subroutine of workflow.subroutines) {
				const promptPath = path.join(dirPath, subroutine.prompt_file);
				if (!fs.existsSync(promptPath)) {
					allPromptsExist = false;
					missingPrompts.push(`${workflow.name}: ${subroutine.prompt_file}`);
				}
			}
		}

		this.logger.raw("");

		if (allPromptsExist && result.parsedFiles.length > 0) {
			this.logSuccess("All referenced prompt files exist");
		} else if (missingPrompts.length > 0) {
			this.logger.warn("Missing prompt files:");
			for (const missing of missingPrompts) {
				this.logger.warn(`  - ${missing}`);
			}
		}

		// Summary
		this.logger.raw("");
		this.logger.info(
			`Total: ${result.collection.workflows.length} workflow(s) from ${result.parsedFiles.length} file(s)`,
		);

		if (Object.keys(result.errors).length > 0 || missingPrompts.length > 0) {
			process.exit(1);
		}
	}

	/**
	 * Show details of a specific workflow
	 */
	private async show(name?: string): Promise<void> {
		if (!name) {
			this.logError("Please provide a workflow name.");
			this.logger.raw("");
			this.logger.raw("Usage: cyrus workflows show <name>");
			this.logger.raw("");
			this.logger.raw("Use 'cyrus workflows list' to see available workflows.");
			process.exit(1);
		}

		// First check built-in procedures
		let workflow: WorkflowDefinition | undefined;
		let source: "built-in" | "external" = "built-in";

		const builtInProcedure = PROCEDURES[name];

		if (builtInProcedure) {
			// Convert built-in procedure to WorkflowDefinition format for display
			workflow = {
				name: builtInProcedure.name,
				description: builtInProcedure.description,
				subroutines: builtInProcedure.subroutines.map((s) => ({
					name: s.name,
					prompt_file: s.promptPath,
					description: s.description,
					single_turn: s.singleTurn,
					validation_loop: s.usesValidationLoop,
					disallow_tools: s.disallowAllTools,
					requires_approval: s.requiresApproval,
					suppress_thought_posting: s.suppressThoughtPosting,
				})),
			};
		}

		// Check external workflows (may override built-in)
		const config = this.app.config.load();
		if (config.workflowsRepository) {
			try {
				const loader = new WorkflowLoader({
					...config.workflowsRepository,
					cyrusHome: this.app.cyrusHome,
				});

				await loader.load();
				const externalWorkflow = loader.getWorkflow(name);

				if (externalWorkflow) {
					workflow = externalWorkflow;
					source = "external";
				}
			} catch (_error) {
				// Ignore errors, use built-in if available
			}
		}

		if (!workflow) {
			this.logError(`Workflow not found: ${name}`);
			this.logger.raw("");
			this.logger.info(
				"Use 'cyrus workflows list' to see available workflows.",
			);
			process.exit(1);
		}

		// Display workflow details
		this.logger.raw("");
		this.logger.raw(`Name: ${workflow.name}`);
		this.logger.raw(`Source: ${source}`);
		this.logger.raw(`Description: ${workflow.description}`);

		// Display triggers if present
		if (workflow.triggers) {
			this.logger.raw("");
			this.logger.raw("Triggers:");
			if (workflow.triggers.classifications?.length) {
				this.logger.raw(
					`  Classifications: ${workflow.triggers.classifications.join(", ")}`,
				);
			}
			if (workflow.triggers.labels?.length) {
				this.logger.raw(`  Labels: ${workflow.triggers.labels.join(", ")}`);
			}
			if (workflow.triggers.keywords?.length) {
				this.logger.raw(`  Keywords: ${workflow.triggers.keywords.join(", ")}`);
			}
			if (workflow.triggers.examples?.length) {
				this.logger.raw("  Examples:");
				for (const example of workflow.triggers.examples) {
					this.logger.raw(`    - "${example}"`);
				}
			}
		}

		if (workflow.priority !== undefined) {
			this.logger.raw(`Priority: ${workflow.priority}`);
		}

		// Display subroutines
		this.logger.raw("");
		this.logger.raw("Subroutines:");
		workflow.subroutines.forEach((subroutine, index) => {
			const flags: string[] = [];
			if (subroutine.single_turn) flags.push("single_turn");
			if (subroutine.validation_loop) flags.push("validation_loop");
			if (subroutine.disallow_tools) flags.push("disallow_tools");
			if (subroutine.requires_approval) flags.push("requires_approval");
			if (subroutine.suppress_thought_posting)
				flags.push("suppress_thought_posting");

			const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
			this.logger.raw(`  ${index + 1}. ${subroutine.name}${flagStr}`);
		});

		this.logger.raw("");
	}
}
