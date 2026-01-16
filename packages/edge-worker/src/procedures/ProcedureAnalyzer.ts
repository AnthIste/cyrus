/**
 * ProcedureAnalyzer - Intelligent analysis of agent sessions to determine procedures
 *
 * Uses a SimpleAgentRunner (Claude or Gemini) to analyze requests and determine
 * which procedure (sequence of subroutines) should be executed.
 *
 * Supports two routing modes:
 * 1. Classification-based (legacy): Classifies request into categories, maps to procedures
 * 2. Direct workflow selection: Uses workflow frontmatter metadata for direct selection
 */

import type { CyrusAgentSession, ISimpleAgentRunner } from "cyrus-core";
import { SimpleGeminiRunner } from "cyrus-gemini-runner";
import { SimpleClaudeRunner } from "cyrus-simple-agent-runner";
import type { WorkflowDefinition } from "../workflows/types.js";
import { getProcedureForClassification, PROCEDURES } from "./registry.js";
import type {
	ProcedureAnalysisDecision,
	ProcedureDefinition,
	ProcedureMetadata,
	RequestClassification,
	SubroutineDefinition,
	WorkflowSelectionDecision,
} from "./types.js";

export type SimpleRunnerType = "claude" | "gemini";

export interface ProcedureAnalyzerConfig {
	cyrusHome: string;
	model?: string;
	timeoutMs?: number;
	runnerType?: SimpleRunnerType; // Default: "gemini"
	/**
	 * Additional procedures to register on initialization.
	 * These take precedence over built-in procedures with the same name.
	 */
	additionalProcedures?: Map<string, ProcedureDefinition>;
}

/**
 * Configuration for workflow-aware routing
 */
export interface WorkflowRoutingConfig {
	/**
	 * Workflow definitions loaded from external sources (Git repo, filesystem).
	 * When provided, enables direct workflow selection mode.
	 */
	workflows: WorkflowDefinition[];
}

export class ProcedureAnalyzer {
	private analysisRunner: ISimpleAgentRunner<RequestClassification>;
	private procedures: Map<string, ProcedureDefinition> = new Map();
	private config: ProcedureAnalyzerConfig;
	/** Cached workflow definitions for direct selection mode */
	private workflowDefinitions: WorkflowDefinition[] = [];
	/** Dynamically created runner for workflow selection (created when workflows are set) */
	private workflowSelectionRunner: ISimpleAgentRunner<string> | null = null;

	constructor(config: ProcedureAnalyzerConfig) {
		this.config = config;
		// Determine which runner to use
		const runnerType = config.runnerType || "gemini";

		// Use runner-specific default models if not provided
		const defaultModel =
			runnerType === "claude" ? "haiku" : "gemini-2.5-flash-lite";
		const defaultFallbackModel =
			runnerType === "claude" ? "sonnet" : "gemini-2.0-flash-exp";

		// Create runner configuration
		const runnerConfig = {
			validResponses: [
				"question",
				"documentation",
				"transient",
				"planning",
				"code",
				"debugger",
				"orchestrator",
				"user-testing",
				"release",
			] as const,
			cyrusHome: config.cyrusHome,
			model: config.model || defaultModel,
			fallbackModel: defaultFallbackModel,
			systemPrompt: this.buildAnalysisSystemPrompt(),
			maxTurns: 1,
			timeoutMs: config.timeoutMs || 10000,
		};

		// Initialize the appropriate runner based on type
		this.analysisRunner =
			runnerType === "claude"
				? new SimpleClaudeRunner(runnerConfig)
				: new SimpleGeminiRunner(runnerConfig);

		// Load all predefined procedures from registry
		this.loadPredefinedProcedures();

		// Register any additional procedures (these override built-in procedures by name)
		if (config.additionalProcedures) {
			for (const [name, procedure] of config.additionalProcedures) {
				this.procedures.set(name, procedure);
			}
		}
	}

	/**
	 * Build the system prompt for request analysis and classification
	 */
	private buildAnalysisSystemPrompt(): string {
		return `You are a request classifier for a software agent system.

Analyze the Linear issue request and classify it into ONE of these categories:

**question**: User is asking a question, seeking information, or requesting explanation.
- Examples: "How does X work?", "What is the purpose of Y?", "Explain the architecture"

**documentation**: User wants documentation, markdown, or comments edited (no code changes).
- Examples: "Update the README", "Add docstrings to functions", "Fix typos in docs"

**transient**: Request involves MCP tools, temporary files, or no codebase interaction.
- Examples: "Search the web for X", "Generate a diagram", "Use Linear MCP to check issues"

**planning**: Request has vague requirements, needs clarification, or asks for an implementation plan.
- Examples: "Can you help with the authentication system?", "I need to improve performance", "Add a new feature for user management"
- Use when requirements are unclear, missing details, or user asks for a plan/proposal
- DO NOT use if the request has clear, specific requirements (use "code" instead)
- DO NOT use for adding/writing tests, fixing tests, or other test-related work (use "code" instead)

**debugger**: User EXPLICITLY requests the full debugging workflow with reproduction and approval.
- ONLY use this if the user specifically asks for: "debug this with approval workflow", "reproduce the bug first", "show me the root cause before fixing"
- DO NOT use for regular bug reports - those should use "code"
- Examples: "Debug this issue and get my approval before fixing", "Reproduce the authentication bug with approval checkpoint"

**orchestrator**: User EXPLICITLY requests decomposition into sub-issues with specialized agent delegation.
- ONLY use this if the user specifically asks for: "break this into sub-issues", "orchestrate this work", "use sub-agents", "delegate to specialized agents"
- DO NOT use for regular complex work - those should use "code"
- Examples: "Orchestrate this feature with sub-issues", "Break this down and delegate to specialized agents", "Create sub-tasks for this epic"

**code**: Request involves code changes with clear, specific requirements (DEFAULT for most work).
- Examples: "Fix bug in X", "Add feature Y", "Refactor module Z", "Implement new API endpoint", "Fix the login issue"
- Use this for ALL standard bug fixes and features with clear requirements
- Use this for ALL test-related work: "Add unit tests", "Fix failing tests", "Write test coverage", etc.
- Use this when user explicitly says "Classify as full development", "classify as code", or similar

**user-testing**: User EXPLICITLY requests a manual testing or user testing session.
- ONLY use this if the user specifically asks for: "test this for me", "run a testing session", "perform user testing", "manual testing"
- Examples: "Test the login flow manually", "Run user testing on the checkout feature", "Help me test this integration"
- DO NOT use for automated test writing (use "code" instead)
- This is for interactive, user-guided testing sessions

**release**: User EXPLICITLY requests a release, publish, or deployment workflow.
- ONLY use this if the user specifically asks for: "release", "publish", "deploy to npm", "create a release", "publish packages"
- Examples: "Release the new version", "Publish to npm", "Create a new release", "Deploy version 1.2.0"
- DO NOT use for regular code changes that mention versions (use "code" instead)
- This is for executing the full release/publish workflow

IMPORTANT: Respond with ONLY the classification word, nothing else.`;
	}

	/**
	 * Load predefined procedures from registry
	 */
	private loadPredefinedProcedures(): void {
		for (const [name, procedure] of Object.entries(PROCEDURES)) {
			this.procedures.set(name, procedure);
		}
	}

	/**
	 * Analyze a request and determine which procedure to use
	 */
	async determineRoutine(
		requestText: string,
	): Promise<ProcedureAnalysisDecision> {
		try {
			// Classify the request using analysis runner
			const result = await this.analysisRunner.query(
				`Classify this Linear issue request:\n\n${requestText}`,
			);

			const classification = result.response;

			// Get procedure name for this classification
			const procedureName = getProcedureForClassification(classification);

			// Get procedure definition
			const procedure = this.procedures.get(procedureName);

			if (!procedure) {
				throw new Error(`Procedure "${procedureName}" not found in registry`);
			}

			return {
				classification,
				procedure,
				reasoning: `Classified as "${classification}" → using procedure "${procedureName}"`,
			};
		} catch (error) {
			// Fallback to full-development on error
			console.log("[ProcedureAnalyzer] Error during analysis:", error);
			const fallbackProcedure = this.procedures.get("full-development");

			if (!fallbackProcedure) {
				throw new Error("Fallback procedure 'full-development' not found");
			}

			return {
				classification: "code",
				procedure: fallbackProcedure,
				reasoning: `Fallback to full-development due to error: ${error}`,
			};
		}
	}

	/**
	 * Set workflow definitions for direct workflow selection mode.
	 *
	 * When workflows are set, the analyzer can use `selectWorkflow` for
	 * frontmatter-aware routing that considers workflow descriptions,
	 * triggers, keywords, and examples.
	 *
	 * @param workflows - Array of WorkflowDefinition objects from WorkflowLoader
	 */
	setWorkflows(workflows: WorkflowDefinition[]): void {
		this.workflowDefinitions = workflows;

		// Clear any existing workflow selection runner (will be recreated on next use)
		this.workflowSelectionRunner = null;

		console.log(
			`[ProcedureAnalyzer] Loaded ${workflows.length} workflow definitions for direct selection`,
		);
	}

	/**
	 * Check if workflow-aware selection is available
	 */
	hasWorkflows(): boolean {
		return this.workflowDefinitions.length > 0;
	}

	/**
	 * Get the list of available workflow names for direct selection
	 */
	getWorkflowNames(): string[] {
		return this.workflowDefinitions.map((w) => w.name);
	}

	/**
	 * Build the system prompt for direct workflow selection.
	 *
	 * This prompt includes all available workflow descriptions and trigger metadata
	 * to enable the AI to select the best matching workflow directly.
	 */
	private buildWorkflowSelectionPrompt(): string {
		// Sort workflows by priority (higher first) to indicate preference
		const sortedWorkflows = [...this.workflowDefinitions].sort(
			(a, b) => (b.priority ?? 0) - (a.priority ?? 0),
		);

		const workflowDescriptions = sortedWorkflows
			.map((w) => {
				const parts = [`### ${w.name}`, w.description];

				if (w.triggers?.labels && w.triggers.labels.length > 0) {
					parts.push(`Labels: ${w.triggers.labels.join(", ")}`);
				}

				if (w.triggers?.keywords && w.triggers.keywords.length > 0) {
					parts.push(`Keywords: ${w.triggers.keywords.join(", ")}`);
				}

				if (w.triggers?.examples && w.triggers.examples.length > 0) {
					parts.push(
						`Examples:\n${w.triggers.examples.map((e) => `- "${e}"`).join("\n")}`,
					);
				}

				if (w.priority !== undefined && w.priority > 0) {
					parts.push(`Priority: ${w.priority}`);
				}

				return parts.join("\n");
			})
			.join("\n\n");

		return `You are a workflow router for a software agent system.

Select the BEST workflow for the given Linear issue based on the workflow descriptions and triggers below.

## Available Workflows

${workflowDescriptions}

## Selection Guidelines

1. Match the issue against workflow descriptions first
2. Consider labels mentioned in the issue (e.g., "bug", "feature", "docs")
3. Look for keywords that indicate workflow fit
4. When multiple workflows could match, prefer the one with higher priority
5. If truly unsure, default to "full-development" for code changes or "simple-question" for questions

IMPORTANT: Respond with ONLY the workflow name, nothing else.`;
	}

	/**
	 * Create or get the workflow selection runner.
	 *
	 * This runner is created lazily and uses the current workflow definitions
	 * to build its valid responses list.
	 */
	private getWorkflowSelectionRunner(): ISimpleAgentRunner<string> {
		if (this.workflowSelectionRunner) {
			return this.workflowSelectionRunner;
		}

		// Get all valid workflow names (including built-in procedures as fallbacks)
		const workflowNames = this.workflowDefinitions.map((w) => w.name);
		const builtInNames = Object.keys(PROCEDURES);
		const allValidNames = [...new Set([...workflowNames, ...builtInNames])];

		const runnerType = this.config.runnerType || "gemini";
		const defaultModel =
			runnerType === "claude" ? "haiku" : "gemini-2.5-flash-lite";
		const defaultFallbackModel =
			runnerType === "claude" ? "sonnet" : "gemini-2.0-flash-exp";

		const runnerConfig = {
			validResponses: allValidNames,
			cyrusHome: this.config.cyrusHome,
			model: this.config.model || defaultModel,
			fallbackModel: defaultFallbackModel,
			systemPrompt: this.buildWorkflowSelectionPrompt(),
			maxTurns: 1,
			timeoutMs: this.config.timeoutMs || 10000,
		};

		this.workflowSelectionRunner =
			runnerType === "claude"
				? new SimpleClaudeRunner(runnerConfig)
				: new SimpleGeminiRunner(runnerConfig);

		return this.workflowSelectionRunner;
	}

	/**
	 * Select a workflow using frontmatter-aware direct selection.
	 *
	 * This method uses the workflow metadata (descriptions, triggers, keywords,
	 * examples, and priorities) to directly select the best workflow, rather
	 * than classifying into abstract categories first.
	 *
	 * @param requestText - The issue title and description
	 * @param issueLabels - Optional array of Linear issue labels for label-based matching
	 * @returns WorkflowSelectionDecision with the selected workflow
	 */
	async selectWorkflow(
		requestText: string,
		issueLabels?: string[],
	): Promise<WorkflowSelectionDecision> {
		// First, check for label-based overrides (highest priority)
		const labelMatch = this.matchByLabels(issueLabels);
		if (labelMatch) {
			return labelMatch;
		}

		// If no workflows are loaded, fall back to classification-based routing
		if (!this.hasWorkflows()) {
			console.log(
				"[ProcedureAnalyzer] No workflows loaded, using classification-based routing",
			);
			const classificationResult = await this.determineRoutine(requestText);
			return {
				workflowName: classificationResult.procedure.name,
				procedure: classificationResult.procedure,
				selectionMode: "classification",
				classification: classificationResult.classification,
				reasoning: classificationResult.reasoning,
			};
		}

		try {
			// Use direct workflow selection
			const runner = this.getWorkflowSelectionRunner();
			const result = await runner.query(
				`Select the best workflow for this Linear issue:\n\n${requestText}`,
			);

			const selectedName = result.response;

			// Get the procedure for the selected workflow
			const procedure = this.procedures.get(selectedName);

			if (!procedure) {
				throw new Error(
					`Selected workflow "${selectedName}" not found in registry`,
				);
			}

			// Infer classification from the selected workflow (for backward compatibility)
			const classification = this.inferClassificationFromWorkflow(selectedName);

			return {
				workflowName: selectedName,
				procedure,
				selectionMode: "direct",
				classification,
				reasoning: `Directly selected workflow "${selectedName}" based on issue content`,
			};
		} catch (error) {
			console.log(
				"[ProcedureAnalyzer] Error during workflow selection, falling back to classification:",
				error,
			);

			// Fall back to classification-based routing on error
			const classificationResult = await this.determineRoutine(requestText);
			return {
				workflowName: classificationResult.procedure.name,
				procedure: classificationResult.procedure,
				selectionMode: "classification",
				classification: classificationResult.classification,
				reasoning: `Fallback to classification due to error: ${error}`,
			};
		}
	}

	/**
	 * Match workflows by Linear issue labels.
	 *
	 * Labels provide the highest priority matching - if an issue has a label
	 * that matches a workflow's trigger labels, that workflow is selected.
	 *
	 * @param issueLabels - Labels from the Linear issue
	 * @returns WorkflowSelectionDecision if a match is found, null otherwise
	 */
	private matchByLabels(
		issueLabels?: string[],
	): WorkflowSelectionDecision | null {
		if (!issueLabels || issueLabels.length === 0) {
			return null;
		}

		// Normalize labels to lowercase for case-insensitive matching
		const normalizedIssueLabels = issueLabels.map((l) => l.toLowerCase());

		// Find workflows with matching labels, sorted by priority
		const matchingWorkflows = this.workflowDefinitions
			.filter((w) => {
				if (!w.triggers?.labels || w.triggers.labels.length === 0) {
					return false;
				}
				const normalizedTriggerLabels = w.triggers.labels.map((l) =>
					l.toLowerCase(),
				);
				return normalizedTriggerLabels.some((triggerLabel) =>
					normalizedIssueLabels.includes(triggerLabel),
				);
			})
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

		if (matchingWorkflows.length === 0) {
			return null;
		}

		// Select the highest priority matching workflow
		const selectedWorkflow = matchingWorkflows[0]!;
		const procedure = this.procedures.get(selectedWorkflow.name);

		if (!procedure) {
			console.log(
				`[ProcedureAnalyzer] Warning: Matched workflow "${selectedWorkflow.name}" not found in procedures registry`,
			);
			return null;
		}

		const matchedLabels = selectedWorkflow.triggers?.labels?.filter((l) =>
			normalizedIssueLabels.includes(l.toLowerCase()),
		);

		return {
			workflowName: selectedWorkflow.name,
			procedure,
			selectionMode: "direct",
			classification: this.inferClassificationFromWorkflow(
				selectedWorkflow.name,
			),
			reasoning: `Label-based match: issue labels [${matchedLabels?.join(", ")}] → workflow "${selectedWorkflow.name}"`,
		};
	}

	/**
	 * Infer a classification from a workflow name for backward compatibility.
	 *
	 * This maps workflow names back to RequestClassification types so that
	 * the decision can include a classification for systems that expect it.
	 */
	private inferClassificationFromWorkflow(
		workflowName: string,
	): RequestClassification {
		// Check if workflow has triggers with classifications
		const workflow = this.workflowDefinitions.find(
			(w) => w.name === workflowName,
		);
		if (workflow?.triggers?.classifications?.[0]) {
			return workflow.triggers.classifications[0];
		}

		// Map common workflow names to classifications
		const nameToClassification: Record<string, RequestClassification> = {
			"full-development": "code",
			"simple-question": "question",
			"documentation-edit": "documentation",
			"debugger-full": "debugger",
			"orchestrator-full": "orchestrator",
			"plan-mode": "planning",
			"user-testing": "user-testing",
			release: "release",
		};

		return nameToClassification[workflowName] ?? "code";
	}

	/**
	 * Get the next subroutine for a session
	 * Returns null if procedure is complete
	 */
	getNextSubroutine(session: CyrusAgentSession): SubroutineDefinition | null {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			// No procedure metadata - session doesn't use procedures
			return null;
		}

		const procedure = this.procedures.get(procedureMetadata.procedureName);

		if (!procedure) {
			console.error(
				`[ProcedureAnalyzer] Procedure "${procedureMetadata.procedureName}" not found`,
			);
			return null;
		}

		const nextIndex = procedureMetadata.currentSubroutineIndex + 1;

		if (nextIndex >= procedure.subroutines.length) {
			// Procedure complete
			return null;
		}

		return procedure.subroutines[nextIndex] ?? null;
	}

	/**
	 * Get the current subroutine for a session
	 */
	getCurrentSubroutine(
		session: CyrusAgentSession,
	): SubroutineDefinition | null {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			return null;
		}

		const procedure = this.procedures.get(procedureMetadata.procedureName);

		if (!procedure) {
			return null;
		}

		const currentIndex = procedureMetadata.currentSubroutineIndex;

		if (currentIndex < 0 || currentIndex >= procedure.subroutines.length) {
			return null;
		}

		return procedure.subroutines[currentIndex] ?? null;
	}

	/**
	 * Initialize procedure metadata for a new session
	 */
	initializeProcedureMetadata(
		session: CyrusAgentSession,
		procedure: ProcedureDefinition,
	): void {
		if (!session.metadata) {
			session.metadata = {};
		}

		session.metadata.procedure = {
			procedureName: procedure.name,
			currentSubroutineIndex: 0,
			subroutineHistory: [],
		} satisfies ProcedureMetadata;
	}

	/**
	 * Record subroutine completion and advance to next
	 */
	advanceToNextSubroutine(
		session: CyrusAgentSession,
		sessionId: string | null,
	): void {
		const procedureMetadata = session.metadata?.procedure as
			| ProcedureMetadata
			| undefined;

		if (!procedureMetadata) {
			throw new Error("Cannot advance: session has no procedure metadata");
		}

		const currentSubroutine = this.getCurrentSubroutine(session);

		if (currentSubroutine) {
			// Determine which type of session ID this is
			const isGeminiSession = session.geminiSessionId !== undefined;

			// Record completion with the appropriate session ID
			procedureMetadata.subroutineHistory.push({
				subroutine: currentSubroutine.name,
				completedAt: Date.now(),
				claudeSessionId: isGeminiSession ? null : sessionId,
				geminiSessionId: isGeminiSession ? sessionId : null,
			});
		}

		// Advance index
		procedureMetadata.currentSubroutineIndex++;
	}

	/**
	 * Check if procedure is complete
	 */
	isProcedureComplete(session: CyrusAgentSession): boolean {
		return this.getNextSubroutine(session) === null;
	}

	/**
	 * Register a custom procedure
	 */
	registerProcedure(procedure: ProcedureDefinition): void {
		this.procedures.set(procedure.name, procedure);
	}

	/**
	 * Get procedure by name
	 */
	getProcedure(name: string): ProcedureDefinition | undefined {
		return this.procedures.get(name);
	}
}
