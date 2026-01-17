import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import type { WorkflowDefinition } from "../src/workflows/types";

/**
 * Tests for ProcedureAnalyzer.matchWorkflowByLabels()
 *
 * This method matches issue labels against workflow trigger labels,
 * selecting the highest priority matching workflow.
 */

describe("ProcedureAnalyzer - matchWorkflowByLabels", () => {
	let tempDir: string;
	let procedureAnalyzer: ProcedureAnalyzer;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "workflow-selection-test-"),
		);

		procedureAnalyzer = new ProcedureAnalyzer({
			cyrusHome: tempDir,
		});
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	/**
	 * Create sample workflow definitions for testing
	 */
	function createSampleWorkflows(): WorkflowDefinition[] {
		return [
			{
				name: "full-development",
				description: "For code changes requiring full verification",
				triggers: {
					classifications: ["code"],
					labels: ["feature", "enhancement"],
				},
				priority: 10,
				subroutines: [
					{ name: "coding-activity", prompt_file: "prompts/coding.md" },
				],
			},
			{
				name: "debugger-full",
				description: "Full debugging workflow",
				triggers: {
					classifications: ["debugger"],
					labels: ["bug", "fix"],
				},
				priority: 15,
				subroutines: [
					{ name: "debugger-reproduction", prompt_file: "prompts/debug.md" },
				],
			},
			{
				name: "simple-question",
				description: "For questions that don't modify the codebase",
				triggers: {
					classifications: ["question"],
				},
				priority: 5,
				subroutines: [
					{
						name: "question-investigation",
						prompt_file: "prompts/question.md",
					},
				],
			},
			{
				name: "security-review",
				description: "Security-focused code review",
				triggers: {
					labels: ["security", "audit"],
				},
				priority: 20,
				subroutines: [
					{ name: "security-analysis", prompt_file: "prompts/security.md" },
				],
			},
		];
	}

	/**
	 * Register workflows as procedures so they can be found
	 */
	function registerWorkflowsAsProcedures(workflows: WorkflowDefinition[]) {
		for (const workflow of workflows) {
			procedureAnalyzer.registerProcedure({
				name: workflow.name,
				description: workflow.description,
				subroutines: workflow.subroutines.map((s) => ({
					name: s.name,
					promptPath: s.prompt_file,
					description: s.description || s.name,
				})),
			});
		}
	}

	describe("Label matching", () => {
		it("should match workflow by label (bug -> debugger-full)", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["bug"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("debugger-full");
			expect(result!.selectionMode).toBe("direct");
			expect(result!.reasoning).toContain("Label-based match");
		});

		it("should match workflow by label (security -> security-review)", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["security"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("security-review");
			expect(result!.selectionMode).toBe("direct");
		});

		it("should match labels case-insensitively", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["BUG"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("debugger-full");
		});

		it("should prefer higher priority workflow when multiple labels match", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["bug", "security"],
				workflows,
			);

			// security-review has priority 20, debugger-full has priority 15
			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("security-review");
		});

		it("should return null when no labels provided", () => {
			const workflows = createSampleWorkflows();

			const result = procedureAnalyzer.matchWorkflowByLabels([], workflows);

			expect(result).toBeNull();
		});

		it("should return null when no workflows provided", () => {
			const result = procedureAnalyzer.matchWorkflowByLabels(["bug"], []);

			expect(result).toBeNull();
		});

		it("should return null when no labels match any workflow", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["random-label", "other-label"],
				workflows,
			);

			expect(result).toBeNull();
		});
	});

	describe("Classification inference", () => {
		it("should infer classification from workflow triggers", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["bug"],
				workflows,
			);

			// debugger-full has classifications: ['debugger'] in triggers
			expect(result).not.toBeNull();
			expect(result!.classification).toBe("debugger");
		});

		it("should infer classification from procedure name when no triggers", () => {
			const workflows: WorkflowDefinition[] = [
				{
					name: "full-development",
					description: "Code changes workflow",
					triggers: {
						labels: ["feature"],
						// No classifications specified
					},
					priority: 10,
					subroutines: [{ name: "coding", prompt_file: "prompts/coding.md" }],
				},
			];
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["feature"],
				workflows,
			);

			// Should fall back to name-based inference
			expect(result).not.toBeNull();
			expect(result!.classification).toBe("code");
		});
	});

	describe("WorkflowSelectionDecision structure", () => {
		it("should return all required fields", () => {
			const workflows = createSampleWorkflows();
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["bug"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result).toHaveProperty("workflowName");
			expect(result).toHaveProperty("procedure");
			expect(result).toHaveProperty("selectionMode");
			expect(result).toHaveProperty("classification");
			expect(result).toHaveProperty("reasoning");

			expect(typeof result!.workflowName).toBe("string");
			expect(result!.selectionMode).toBe("direct");
			expect(result!.procedure).toBeDefined();
			expect(result!.procedure.name).toBeDefined();
			expect(result!.procedure.subroutines).toBeDefined();
		});
	});

	describe("Workflow not registered as procedure", () => {
		it("should return null when matched workflow is not registered as procedure", () => {
			// Use a custom workflow name that doesn't exist as a built-in procedure
			const workflows: WorkflowDefinition[] = [
				{
					name: "custom-workflow-not-registered",
					description: "Custom workflow",
					triggers: { labels: ["custom"] },
					subroutines: [{ name: "custom", prompt_file: "custom.md" }],
				},
			];
			// Don't register procedures

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["custom"],
				workflows,
			);

			// Workflow matches but procedure not found
			expect(result).toBeNull();
		});
	});

	describe("Priority handling", () => {
		it("should select highest priority workflow when multiple match same label", () => {
			const workflows: WorkflowDefinition[] = [
				{
					name: "low-priority",
					description: "Low priority",
					triggers: { labels: ["test"] },
					priority: 5,
					subroutines: [{ name: "low", prompt_file: "low.md" }],
				},
				{
					name: "high-priority",
					description: "High priority",
					triggers: { labels: ["test"] },
					priority: 50,
					subroutines: [{ name: "high", prompt_file: "high.md" }],
				},
				{
					name: "medium-priority",
					description: "Medium priority",
					triggers: { labels: ["test"] },
					priority: 25,
					subroutines: [{ name: "medium", prompt_file: "medium.md" }],
				},
			];

			for (const w of workflows) {
				procedureAnalyzer.registerProcedure({
					name: w.name,
					description: w.description,
					subroutines: w.subroutines.map((s) => ({
						name: s.name,
						promptPath: s.prompt_file,
						description: s.name,
					})),
				});
			}

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["test"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("high-priority");
		});

		it("should handle undefined priority (defaults to 0)", () => {
			const workflows: WorkflowDefinition[] = [
				{
					name: "no-priority",
					description: "No priority defined",
					triggers: { labels: ["test"] },
					// priority is undefined
					subroutines: [{ name: "none", prompt_file: "none.md" }],
				},
				{
					name: "with-priority",
					description: "Has priority",
					triggers: { labels: ["test"] },
					priority: 10,
					subroutines: [{ name: "with", prompt_file: "with.md" }],
				},
			];

			for (const w of workflows) {
				procedureAnalyzer.registerProcedure({
					name: w.name,
					description: w.description,
					subroutines: w.subroutines.map((s) => ({
						name: s.name,
						promptPath: s.prompt_file,
						description: s.name,
					})),
				});
			}

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["test"],
				workflows,
			);

			expect(result).not.toBeNull();
			expect(result!.workflowName).toBe("with-priority");
		});
	});

	describe("Edge cases", () => {
		it("should handle workflow without triggers", () => {
			const workflows: WorkflowDefinition[] = [
				{
					name: "no-triggers",
					description: "No triggers defined",
					subroutines: [{ name: "none", prompt_file: "none.md" }],
				},
			];
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["any-label"],
				workflows,
			);

			expect(result).toBeNull();
		});

		it("should handle workflow with empty labels array", () => {
			const workflows: WorkflowDefinition[] = [
				{
					name: "empty-labels",
					description: "Empty labels array",
					triggers: { labels: [] },
					subroutines: [{ name: "empty", prompt_file: "empty.md" }],
				},
			];
			registerWorkflowsAsProcedures(workflows);

			const result = procedureAnalyzer.matchWorkflowByLabels(
				["any-label"],
				workflows,
			);

			expect(result).toBeNull();
		});
	});

	describe("Backward compatibility - determineRoutine", () => {
		it("should work with determineRoutine for AI classification", async () => {
			const result = await procedureAnalyzer.determineRoutine(
				"Add a new API endpoint for user authentication",
			);

			expect(result.classification).toBeDefined();
			expect(result.procedure).toBeDefined();
			expect(result.reasoning).toBeDefined();
		});

		it("should work with determineRoutine with issue context", async () => {
			const result = await procedureAnalyzer.determineRoutine("", {
				identifier: "RUB-77",
				title: "Procedure analyzer does not provide issue context",
				description:
					"When routing a request through our custom workflows, the AI classifier does not have enough context.",
				state: "In Progress",
				priority: "Normal",
				labels: ["Feature"],
			});

			expect(result.classification).toBeDefined();
			expect(result.procedure).toBeDefined();
			expect(result.reasoning).toBeDefined();
		});

		it("should work with determineRoutine with issue context and new comment", async () => {
			const result = await procedureAnalyzer.determineRoutine("", {
				identifier: "RUB-77",
				title: "Fix the login bug",
				description: "Users cannot login with their credentials",
				labels: ["Bug"],
				newComment: "Please also check the session timeout handling",
			});

			expect(result.classification).toBeDefined();
			expect(result.procedure).toBeDefined();
			expect(result.reasoning).toBeDefined();
		});
	});
});
