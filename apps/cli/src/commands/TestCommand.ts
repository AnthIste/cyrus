import {
	type PROCEDURES,
	ProcedureAnalyzer,
	type SimpleRunnerType,
	type WorkflowDefinition,
	WorkflowLoader,
} from "cyrus-edge-worker";
import { BaseCommand } from "./ICommand.js";

/**
 * CLI command for testing repository resolution and workflow resolution
 *
 * Subcommands:
 * - resolve-workflow [--runner claude|gemini] <text>: Test AI workflow resolution for given request text
 * - resolve-labels <labels...>: Test label-based workflow matching
 * - list-classifications: List all valid request classifications
 */
export class TestCommand extends BaseCommand {
	async execute(args: string[]): Promise<void> {
		const subcommand = args[0];

		switch (subcommand) {
			case "resolve-workflow":
				await this.resolveWorkflow(args.slice(1));
				break;
			case "resolve-labels":
				await this.resolveLabels(args.slice(1));
				break;
			case "list-classifications":
				this.listClassifications();
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
	 * Show help for the test command
	 */
	private showHelp(): void {
		this.logger.raw("");
		this.logger.raw("Usage: cyrus test <subcommand> [options]");
		this.logger.raw("");
		this.logger.raw("Subcommands:");
		this.logger.raw("  resolve-workflow [--runner claude|gemini] <text>");
		this.logger.raw(
			"                             Test AI workflow resolution for request text",
		);
		this.logger.raw(
			"  resolve-labels <labels>    Test label-based workflow matching",
		);
		this.logger.raw(
			"  list-classifications       List all valid request classifications",
		);
		this.logger.raw("");
		this.logger.raw("Options:");
		this.logger.raw(
			"  --runner <type>            AI runner to use: claude or gemini (default: gemini)",
		);
		this.logger.raw("");
		this.logger.raw("Examples:");
		this.logger.raw(
			'  cyrus test resolve-workflow "Fix the login bug in authentication"',
		);
		this.logger.raw(
			'  cyrus test resolve-workflow --runner claude "How does the API work?"',
		);
		this.logger.raw("  cyrus test resolve-labels bug fix");
		this.logger.raw("  cyrus test resolve-labels feature enhancement");
		this.logger.raw("  cyrus test list-classifications");
		this.logger.raw("");
	}

	/**
	 * Parse --runner option from args
	 */
	private parseRunnerOption(args: string[]): {
		runner: SimpleRunnerType;
		remainingArgs: string[];
	} {
		let runner: SimpleRunnerType = "gemini";
		const remainingArgs: string[] = [];

		for (let i = 0; i < args.length; i++) {
			if (args[i] === "--runner" && i + 1 < args.length) {
				const value = args[i + 1];
				if (value === "claude" || value === "gemini") {
					runner = value;
				} else {
					this.logError(
						`Invalid runner: ${value}. Must be 'claude' or 'gemini'`,
					);
					process.exit(1);
				}
				i++; // Skip the next arg
			} else {
				remainingArgs.push(args[i]!);
			}
		}

		return { runner, remainingArgs };
	}

	/**
	 * Test AI workflow resolution for a given request text
	 */
	private async resolveWorkflow(args: string[]): Promise<void> {
		const { runner, remainingArgs } = this.parseRunnerOption(args);
		const requestText = remainingArgs.join(" ");

		if (!requestText || requestText.trim() === "") {
			this.logError("Error: Request text is required");
			this.logger.raw("");
			this.logger.raw(
				"Usage: cyrus test resolve-workflow [--runner claude|gemini] <text>",
			);
			this.logger.raw("");
			this.logger.raw("Examples:");
			this.logger.raw(
				'  cyrus test resolve-workflow "Fix the login bug in authentication"',
			);
			this.logger.raw(
				'  cyrus test resolve-workflow --runner claude "How does the API work?"',
			);
			process.exit(1);
		}

		this.logger.raw("");
		this.logger.raw("Testing AI Workflow Resolution");
		this.logger.raw("==============================");
		this.logger.raw("");
		this.logger.raw(`Request: "${requestText}"`);
		this.logger.raw(`Runner: ${runner}`);
		this.logger.raw("");

		try {
			// Create a ProcedureAnalyzer instance
			const analyzer = new ProcedureAnalyzer({
				cyrusHome: this.app.cyrusHome,
				runnerType: runner,
			});

			this.logger.raw("Analyzing request...");
			this.logger.raw("");

			// Determine the routine
			const decision = await analyzer.determineRoutine(requestText);

			this.logger.raw("Result:");
			this.logger.raw("-------");
			this.logger.raw(`Classification: ${decision.classification}`);
			this.logger.raw(`Procedure: ${decision.procedure.name}`);
			this.logger.raw(`Description: ${decision.procedure.description}`);
			this.logger.raw("");
			this.logger.raw(`Reasoning: ${decision.reasoning}`);
			this.logger.raw("");

			// Show subroutines
			this.logger.raw("Subroutines:");
			for (let i = 0; i < decision.procedure.subroutines.length; i++) {
				const sub = decision.procedure.subroutines[i]!;
				const flags: string[] = [];
				if (sub.singleTurn) flags.push("single_turn");
				if (sub.usesValidationLoop) flags.push("validation_loop");
				if (sub.requiresApproval) flags.push("requires_approval");
				if (sub.disallowAllTools) flags.push("disallow_tools");
				if (sub.suppressThoughtPosting) flags.push("suppress_thought_posting");

				const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
				this.logger.raw(`  ${i + 1}. ${sub.name}${flagStr}`);
			}
			this.logger.raw("");
		} catch (error) {
			this.logError(`Error during workflow resolution: ${error}`);
			process.exit(1);
		}
	}

	/**
	 * Test label-based workflow matching
	 */
	private async resolveLabels(labels: string[]): Promise<void> {
		if (labels.length === 0) {
			this.logError("Error: At least one label is required");
			this.logger.raw("");
			this.logger.raw("Usage: cyrus test resolve-labels <label1> [label2] ...");
			this.logger.raw("");
			this.logger.raw("Examples:");
			this.logger.raw("  cyrus test resolve-labels bug fix");
			this.logger.raw("  cyrus test resolve-labels feature enhancement");
			this.logger.raw("  cyrus test resolve-labels security audit");
			process.exit(1);
		}

		this.logger.raw("");
		this.logger.raw("Testing Label-Based Workflow Resolution");
		this.logger.raw("=======================================");
		this.logger.raw("");
		this.logger.raw(`Labels: [${labels.join(", ")}]`);
		this.logger.raw("");

		try {
			// Load external workflows if configured
			const config = this.app.config.load();
			const workflowsConfig = config.workflowsRepository;
			const workflows: WorkflowDefinition[] = [];

			// Load external workflows
			let loader: WorkflowLoader | null = null;
			if (workflowsConfig) {
				this.logger.raw(
					`Loading external workflows from: ${workflowsConfig.source}`,
				);
				loader = new WorkflowLoader({
					source: workflowsConfig.source,
					branch: workflowsConfig.branch,
					path: workflowsConfig.path,
					cyrusHome: this.app.cyrusHome,
				});

				await loader.load();
				workflows.push(...loader.getAllWorkflows());
				this.logger.raw(`Loaded ${workflows.length} external workflow(s)`);
			} else {
				this.logger.raw("No external workflow repository configured");
			}

			this.logger.raw("");

			// Create a ProcedureAnalyzer instance with external procedures
			const externalProcedures = new Map<
				string,
				(typeof PROCEDURES)[keyof typeof PROCEDURES]
			>();
			if (loader) {
				for (const procedure of loader.getAll()) {
					externalProcedures.set(procedure.name, procedure);
				}
			}

			const analyzer = new ProcedureAnalyzer({
				cyrusHome: this.app.cyrusHome,
				additionalProcedures: externalProcedures,
			});

			// Try label-based matching
			const decision = analyzer.matchWorkflowByLabels(labels, workflows);

			if (decision) {
				this.logger.raw("Match Found!");
				this.logger.raw("------------");
				this.logger.raw(`Workflow: ${decision.workflowName}`);
				this.logger.raw(`Selection Mode: ${decision.selectionMode}`);
				this.logger.raw(`Classification: ${decision.classification}`);
				this.logger.raw(`Reasoning: ${decision.reasoning}`);
				this.logger.raw("");
				this.logger.raw(`Procedure: ${decision.procedure.name}`);
				this.logger.raw(`Description: ${decision.procedure.description}`);
				this.logger.raw("");

				// Show subroutines
				this.logger.raw("Subroutines:");
				for (let i = 0; i < decision.procedure.subroutines.length; i++) {
					const sub = decision.procedure.subroutines[i]!;
					const flags: string[] = [];
					if (sub.singleTurn) flags.push("single_turn");
					if (sub.usesValidationLoop) flags.push("validation_loop");
					if (sub.requiresApproval) flags.push("requires_approval");
					if (sub.disallowAllTools) flags.push("disallow_tools");
					if (sub.suppressThoughtPosting)
						flags.push("suppress_thought_posting");

					const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
					this.logger.raw(`  ${i + 1}. ${sub.name}${flagStr}`);
				}
			} else {
				this.logger.raw("No Match Found");
				this.logger.raw("--------------");
				this.logger.raw(
					"No workflow matched the provided labels. The system would fall back to AI classification.",
				);
				this.logger.raw("");

				// Show available label triggers
				this.logger.raw("Available workflow label triggers:");
				if (workflows.length === 0) {
					this.logger.raw(
						"  (No external workflows with label triggers configured)",
					);
				} else {
					for (const w of workflows) {
						const triggerLabels = w.triggers?.labels;
						if (triggerLabels && triggerLabels.length > 0) {
							this.logger.raw(`  - ${w.name}: [${triggerLabels.join(", ")}]`);
						}
					}
				}
			}
			this.logger.raw("");
		} catch (error) {
			this.logError(`Error during label resolution: ${error}`);
			process.exit(1);
		}
	}

	/**
	 * List all valid request classifications
	 */
	private listClassifications(): void {
		this.logger.raw("");
		this.logger.raw("Request Classifications");
		this.logger.raw("=======================");
		this.logger.raw("");

		const classifications = [
			{
				name: "question",
				procedure: "simple-question",
				description: "User is asking a question or seeking information",
				examples: [
					"How does X work?",
					"What is the purpose of Y?",
					"Explain the architecture",
				],
			},
			{
				name: "documentation",
				procedure: "documentation-edit",
				description: "Documentation, markdown, or comments (no code changes)",
				examples: [
					"Update the README",
					"Add docstrings to functions",
					"Fix typos in docs",
				],
			},
			{
				name: "transient",
				procedure: "simple-question",
				description: "MCP tools, temporary files, or no codebase interaction",
				examples: [
					"Search the web for X",
					"Generate a diagram",
					"Use Linear MCP",
				],
			},
			{
				name: "planning",
				procedure: "plan-mode",
				description:
					"Vague requirements, needs clarification, or asks for implementation plan",
				examples: [
					"Can you help with authentication?",
					"I need to improve performance",
					"Add a new feature",
				],
			},
			{
				name: "code",
				procedure: "full-development",
				description:
					"Code changes with clear requirements (DEFAULT for most work)",
				examples: [
					"Fix bug in X",
					"Add feature Y",
					"Refactor module Z",
					"Add unit tests",
				],
			},
			{
				name: "debugger",
				procedure: "debugger-full",
				description:
					"EXPLICIT request for debugging workflow with reproduction and approval",
				examples: [
					"Debug this with approval workflow",
					"Reproduce the bug first",
					"Show root cause before fixing",
				],
			},
			{
				name: "orchestrator",
				procedure: "orchestrator-full",
				description: "EXPLICIT request for decomposition into sub-issues",
				examples: [
					"Break this into sub-issues",
					"Orchestrate this work",
					"Delegate to specialized agents",
				],
			},
			{
				name: "user-testing",
				procedure: "user-testing",
				description: "EXPLICIT request for manual/user testing session",
				examples: [
					"Test the login flow manually",
					"Run user testing on checkout",
					"Help me test this",
				],
			},
			{
				name: "release",
				procedure: "release",
				description: "EXPLICIT request for release/publish workflow",
				examples: [
					"Release the new version",
					"Publish to npm",
					"Create a new release",
				],
			},
		];

		for (const c of classifications) {
			this.logger.raw(`${c.name}`);
			this.logger.raw(`  Procedure: ${c.procedure}`);
			this.logger.raw(`  Description: ${c.description}`);
			this.logger.raw(`  Examples:`);
			for (const ex of c.examples) {
				this.logger.raw(`    - "${ex}"`);
			}
			this.logger.raw("");
		}
	}
}
