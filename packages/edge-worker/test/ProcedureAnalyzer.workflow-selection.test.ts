import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import type { WorkflowDefinition } from "../src/workflows/types";

/**
 * Tests for ProcedureAnalyzer workflow-aware selection
 *
 * These tests verify the new frontmatter-aware routing that uses workflow
 * descriptions, triggers, keywords, examples, and priorities to directly
 * select workflows instead of classifying into abstract categories.
 */

describe("ProcedureAnalyzer - Workflow Selection", () => {
	let tempDir: string;
	let procedureAnalyzer: ProcedureAnalyzer;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "workflow-selection-test-"),
		);

		// Create a standalone ProcedureAnalyzer for testing
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
				description:
					"For code changes requiring full verification and PR creation. Includes implementation, testing, changelog updates, and PR creation.",
				triggers: {
					classifications: ["code"],
					labels: ["feature", "enhancement"],
					keywords: ["implement", "add feature", "create", "build"],
					examples: [
						"Add a new API endpoint for user authentication",
						"Implement dark mode toggle in settings",
					],
				},
				priority: 10,
				subroutines: [
					{
						name: "coding-activity",
						prompt_file: "prompts/coding-activity.md",
					},
				],
			},
			{
				name: "debugger-full",
				description:
					"Full debugging workflow with reproduction, fix, and verification. Requires approval after reproducing the issue before implementing fix.",
				triggers: {
					classifications: ["debugger"],
					labels: ["bug", "fix"],
					keywords: ["fix bug", "debug", "broken", "not working"],
					examples: [
						"Fix the login form not submitting on mobile",
						"Debug why API returns 500 error on large payloads",
					],
				},
				priority: 15,
				subroutines: [
					{
						name: "debugger-reproduction",
						prompt_file: "prompts/debugger-reproduction.md",
					},
				],
			},
			{
				name: "simple-question",
				description:
					"For questions or requests that don't modify the codebase. Investigates the codebase and provides a comprehensive answer.",
				triggers: {
					classifications: ["question", "transient"],
					keywords: [
						"how does",
						"what is",
						"where is",
						"explain",
						"help me understand",
					],
					examples: [
						"How does the authentication system work?",
						"What is the purpose of the EdgeWorker class?",
					],
				},
				priority: 5,
				subroutines: [
					{
						name: "question-investigation",
						prompt_file: "prompts/question-investigation.md",
					},
				],
			},
			{
				name: "security-review",
				description:
					"Security-focused code review workflow. Disallows write operations during analysis phase.",
				triggers: {
					labels: ["security", "audit"],
					keywords: ["security review", "vulnerability", "audit code"],
				},
				priority: 20,
				subroutines: [
					{
						name: "security-analysis",
						prompt_file: "prompts/security-analysis.md",
					},
				],
			},
		];
	}

	describe("setWorkflows and hasWorkflows", () => {
		it("should start without workflows", () => {
			expect(procedureAnalyzer.hasWorkflows()).toBe(false);
		});

		it("should have workflows after setWorkflows is called", () => {
			const workflows = createSampleWorkflows();
			procedureAnalyzer.setWorkflows(workflows);

			expect(procedureAnalyzer.hasWorkflows()).toBe(true);
		});

		it("should return workflow names after setWorkflows", () => {
			const workflows = createSampleWorkflows();
			procedureAnalyzer.setWorkflows(workflows);

			const names = procedureAnalyzer.getWorkflowNames();
			expect(names).toContain("full-development");
			expect(names).toContain("debugger-full");
			expect(names).toContain("simple-question");
			expect(names).toContain("security-review");
		});

		it("should clear workflows when setWorkflows is called with empty array", () => {
			const workflows = createSampleWorkflows();
			procedureAnalyzer.setWorkflows(workflows);
			expect(procedureAnalyzer.hasWorkflows()).toBe(true);

			procedureAnalyzer.setWorkflows([]);
			expect(procedureAnalyzer.hasWorkflows()).toBe(false);
		});
	});

	describe("selectWorkflow - Label-based matching", () => {
		beforeEach(() => {
			// Register the workflow procedures so they can be found
			const workflows = createSampleWorkflows();
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
			procedureAnalyzer.setWorkflows(workflows);
		});

		it("should select workflow by matching label (bug -> debugger-full)", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"Something is broken in the login flow",
				["bug"],
			);

			expect(result.workflowName).toBe("debugger-full");
			expect(result.selectionMode).toBe("direct");
			expect(result.reasoning).toContain("Label-based match");
		});

		it("should select workflow by matching label (security -> security-review)", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"Review the authentication module",
				["security"],
			);

			expect(result.workflowName).toBe("security-review");
			expect(result.selectionMode).toBe("direct");
			expect(result.reasoning).toContain("Label-based match");
		});

		it("should match labels case-insensitively", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"Something is broken",
				["BUG"],
			);

			expect(result.workflowName).toBe("debugger-full");
			expect(result.selectionMode).toBe("direct");
		});

		it("should prefer higher priority workflow when multiple labels match", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"Security issue causing bugs",
				["bug", "security"],
			);

			// security-review has priority 20, debugger-full has priority 15
			expect(result.workflowName).toBe("security-review");
		});

		it("should not match if no labels provided", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"How does authentication work?",
				[],
			);

			// Should use AI routing (which may be classification or direct depending on runner)
			// Won't be label-based match
			expect(result.reasoning).not.toContain("Label-based match");
			// Should have a valid procedure
			expect(result.procedure).toBeDefined();
		});
	});

	describe("selectWorkflow - Fallback to classification", () => {
		it("should fall back to classification when no workflows are set", async () => {
			// Don't set any workflows
			const result = await procedureAnalyzer.selectWorkflow(
				"Fix the login bug",
				["some-random-label"],
			);

			expect(result.selectionMode).toBe("classification");
			// Should still return a valid procedure
			expect(result.procedure).toBeDefined();
		});
	});

	describe("inferClassificationFromWorkflow", () => {
		beforeEach(() => {
			const workflows = createSampleWorkflows();
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
			procedureAnalyzer.setWorkflows(workflows);
		});

		it("should infer correct classification from workflow triggers", async () => {
			// When bug label matches debugger-full
			const result = await procedureAnalyzer.selectWorkflow("Fix this issue", [
				"bug",
			]);

			// debugger-full has classifications: ['debugger'] in triggers
			expect(result.classification).toBe("debugger");
		});

		it("should infer classification from workflow name when no triggers", async () => {
			// Create a workflow without trigger classifications
			const workflowWithoutTriggerClassifications: WorkflowDefinition[] = [
				{
					name: "full-development",
					description: "Code changes workflow",
					triggers: {
						labels: ["feature"],
						// No classifications specified
					},
					priority: 10,
					subroutines: [
						{
							name: "coding",
							prompt_file: "prompts/coding.md",
						},
					],
				},
			];

			procedureAnalyzer.setWorkflows(workflowWithoutTriggerClassifications);

			const result = await procedureAnalyzer.selectWorkflow("Add new feature", [
				"feature",
			]);

			// Should fall back to name-based inference
			expect(result.classification).toBe("code");
		});
	});

	describe("selectWorkflow - Backward compatibility", () => {
		it("should return WorkflowSelectionDecision with all required fields", async () => {
			const workflows = createSampleWorkflows();
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
			procedureAnalyzer.setWorkflows(workflows);

			const result = await procedureAnalyzer.selectWorkflow(
				"Fix authentication bug",
				["bug"],
			);

			// Verify all required fields are present
			expect(result).toHaveProperty("workflowName");
			expect(result).toHaveProperty("procedure");
			expect(result).toHaveProperty("selectionMode");
			expect(result).toHaveProperty("classification");
			expect(result).toHaveProperty("reasoning");

			// Verify types
			expect(typeof result.workflowName).toBe("string");
			expect(typeof result.selectionMode).toBe("string");
			expect(["direct", "classification"]).toContain(result.selectionMode);
			expect(result.procedure).toBeDefined();
			expect(result.procedure.name).toBeDefined();
			expect(result.procedure.subroutines).toBeDefined();
		});

		it("should work with determineRoutine for backward compatibility", async () => {
			// determineRoutine should still work as before
			const result = await procedureAnalyzer.determineRoutine(
				"Add a new API endpoint for user authentication",
			);

			expect(result.classification).toBeDefined();
			expect(result.procedure).toBeDefined();
			expect(result.reasoning).toBeDefined();
		});
	});

	describe("Priority-based selection", () => {
		beforeEach(() => {
			// Create workflows with different priorities for same label
			const workflows: WorkflowDefinition[] = [
				{
					name: "low-priority",
					description: "Low priority workflow",
					triggers: {
						labels: ["test"],
					},
					priority: 5,
					subroutines: [{ name: "step", prompt_file: "prompts/step.md" }],
				},
				{
					name: "high-priority",
					description: "High priority workflow",
					triggers: {
						labels: ["test"],
					},
					priority: 20,
					subroutines: [{ name: "step", prompt_file: "prompts/step.md" }],
				},
				{
					name: "medium-priority",
					description: "Medium priority workflow",
					triggers: {
						labels: ["test"],
					},
					priority: 10,
					subroutines: [{ name: "step", prompt_file: "prompts/step.md" }],
				},
			];

			for (const workflow of workflows) {
				procedureAnalyzer.registerProcedure({
					name: workflow.name,
					description: workflow.description,
					subroutines: workflow.subroutines.map((s) => ({
						name: s.name,
						promptPath: s.prompt_file,
						description: s.name,
					})),
				});
			}
			procedureAnalyzer.setWorkflows(workflows);
		});

		it("should select highest priority workflow when multiple match same label", async () => {
			const result = await procedureAnalyzer.selectWorkflow("Do the task", [
				"test",
			]);

			expect(result.workflowName).toBe("high-priority");
		});
	});

	describe("Edge cases", () => {
		beforeEach(() => {
			const workflows = createSampleWorkflows();
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
			procedureAnalyzer.setWorkflows(workflows);
		});

		it("should handle empty request text", async () => {
			const result = await procedureAnalyzer.selectWorkflow("", ["bug"]);

			// Should still match by label
			expect(result.workflowName).toBe("debugger-full");
		});

		it("should handle undefined labels", async () => {
			const result = await procedureAnalyzer.selectWorkflow(
				"How does this work?",
				undefined,
			);

			// Should use AI routing
			expect(result.procedure).toBeDefined();
		});

		it("should handle workflow without triggers", async () => {
			const workflowNoTriggers: WorkflowDefinition[] = [
				{
					name: "no-triggers",
					description: "A workflow without triggers",
					subroutines: [{ name: "step", prompt_file: "prompts/step.md" }],
				},
			];

			procedureAnalyzer.registerProcedure({
				name: "no-triggers",
				description: "A workflow without triggers",
				subroutines: [
					{ name: "step", promptPath: "prompts/step.md", description: "step" },
				],
			});
			procedureAnalyzer.setWorkflows(workflowNoTriggers);

			// Should not crash, should use AI routing
			const result = await procedureAnalyzer.selectWorkflow("Do something", [
				"random",
			]);
			expect(result.procedure).toBeDefined();
		});

		it("should handle workflow with empty labels array", async () => {
			const workflowEmptyLabels: WorkflowDefinition[] = [
				{
					name: "empty-labels",
					description: "A workflow with empty labels",
					triggers: {
						labels: [],
					},
					subroutines: [{ name: "step", prompt_file: "prompts/step.md" }],
				},
			];

			procedureAnalyzer.registerProcedure({
				name: "empty-labels",
				description: "A workflow with empty labels",
				subroutines: [
					{ name: "step", promptPath: "prompts/step.md", description: "step" },
				],
			});
			procedureAnalyzer.setWorkflows(workflowEmptyLabels);

			// Should not match by label (empty labels array)
			const result = await procedureAnalyzer.selectWorkflow("Do something", [
				"anything",
			]);
			// Should use AI routing since no label match - may be classification or direct
			expect(result.reasoning).not.toContain("Label-based match");
			// Should still return a valid procedure
			expect(result.procedure).toBeDefined();
		});
	});
});
