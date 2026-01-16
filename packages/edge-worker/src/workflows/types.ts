/**
 * Type definitions for YAML workflow configuration
 *
 * These types define the schema for external workflow definitions that can be
 * loaded from YAML files in a git repository. They map to the internal
 * ProcedureDefinition and SubroutineDefinition types used by the edge worker.
 */

import type { RequestClassification } from "../procedures/types.js";

/**
 * Reference to a subroutine within a workflow definition.
 *
 * This type is designed for YAML serialization, using snake_case property names
 * that map to the internal SubroutineDefinition type.
 */
export interface SubroutineReference {
	/** Unique identifier for the subroutine */
	name: string;

	/**
	 * Path to the prompt file (relative to the workflows directory).
	 * Example: "prompts/coding-activity.md" or "subroutines/verification.md"
	 */
	prompt_file: string;

	/**
	 * Human-readable description of what this subroutine does.
	 * Optional in YAML, will use name as fallback.
	 */
	description?: string;

	/**
	 * Whether this subroutine should run in single-turn mode (maxTurns: 1).
	 * Use for subroutines that should complete in one response.
	 * @default false
	 */
	single_turn?: boolean;

	/**
	 * Whether this subroutine uses the validation loop with retry logic.
	 * When true, the subroutine output is parsed as ValidationResult and
	 * the validation-fixer subroutine is run on failures.
	 * @default false
	 */
	validation_loop?: boolean;

	/**
	 * Maximum iterations for the validation loop.
	 * Only applicable when validation_loop is true.
	 * @default 3
	 */
	max_iterations?: number;

	/**
	 * Whether to disallow ALL tool usage during this subroutine.
	 * When true, the agent will only produce text output without any tool calls.
	 * Useful for summary subroutines where tool usage would cause
	 * the session to appear "hanging" to users.
	 * @default false
	 */
	disallow_tools?: boolean;

	/**
	 * Specific tools that should be explicitly disallowed during this subroutine.
	 * More granular than disallow_tools for selective restrictions.
	 */
	disallowed_tools?: string[];

	/**
	 * Whether this subroutine requires user approval before advancing to next step.
	 * Triggers the approval workflow to wait for explicit user confirmation.
	 * @default false
	 */
	requires_approval?: boolean;

	/**
	 * Whether to suppress posting thoughts/actions to Linear activity stream.
	 * The final summary will still be posted.
	 * @default false
	 */
	suppress_thought_posting?: boolean;

	/**
	 * Whether to skip posting any output to Linear activity stream.
	 * @default false
	 */
	skip_linear_post?: boolean;
}

/**
 * Trigger configuration for automatic workflow selection.
 *
 * Workflows can be triggered by multiple criteria. When multiple workflows match,
 * the one with the highest priority wins.
 */
export interface WorkflowTriggers {
	/**
	 * Request classifications that trigger this workflow.
	 * Maps to the existing RequestClassification system for fallback compatibility.
	 * Example: ["code", "debugger"]
	 */
	classifications?: RequestClassification[];

	/**
	 * Linear issue labels that trigger this workflow.
	 * Matches against the labels array on the issue.
	 * Example: ["feature", "bug-fix"]
	 */
	labels?: string[];

	/**
	 * Keywords in the issue title or description that suggest this workflow.
	 * Used as hints for the AI router when selecting workflows.
	 * Example: ["refactor", "optimize", "cleanup"]
	 */
	keywords?: string[];

	/**
	 * Few-shot examples to help the AI router understand when to use this workflow.
	 * These are example issue descriptions that should trigger this workflow.
	 * Example: ["Add a new API endpoint for user authentication"]
	 */
	examples?: string[];
}

/**
 * Complete workflow definition for YAML serialization.
 *
 * A workflow defines a sequence of subroutines to execute for a particular
 * type of task, along with triggers that determine when to use it.
 */
export interface WorkflowDefinition {
	/** Unique identifier for the workflow */
	name: string;

	/** Human-readable description of what this workflow does and when to use it */
	description: string;

	/**
	 * Trigger configuration for automatic workflow selection.
	 * If not specified, the workflow must be explicitly invoked.
	 */
	triggers?: WorkflowTriggers;

	/**
	 * Priority for workflow selection when multiple workflows match.
	 * Higher values indicate higher priority.
	 * @default 0
	 */
	priority?: number;

	/** Ordered list of subroutines to execute */
	subroutines: SubroutineReference[];
}

/**
 * Collection of workflows loaded from a repository.
 * Typically stored in a workflows.yaml file or workflows/ directory.
 */
export interface WorkflowCollection {
	/**
	 * Version of the workflow schema.
	 * Used for backwards compatibility when the schema evolves.
	 */
	version?: string;

	/** List of workflow definitions */
	workflows: WorkflowDefinition[];
}

/**
 * Result of matching a request against workflow triggers.
 */
export interface WorkflowMatchResult {
	/** The matched workflow, or undefined if no match */
	workflow?: WorkflowDefinition;

	/** Score indicating match strength (for debugging) */
	score: number;

	/** Reasoning for the match (for debugging) */
	reasoning?: string;

	/** Which trigger type caused the match */
	matchedBy?: "classification" | "label" | "keyword" | "example" | "explicit";
}
