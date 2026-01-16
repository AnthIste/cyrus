import { describe, expect, it } from "vitest";
import type {
	SubroutineReference,
	WorkflowCollection,
	WorkflowDefinition,
	WorkflowMatchResult,
	WorkflowTriggers,
} from "../src/workflows/index.js";

describe("Workflow Types", () => {
	describe("SubroutineReference", () => {
		it("should accept minimal subroutine reference", () => {
			const subroutine: SubroutineReference = {
				name: "coding-activity",
				prompt_file: "prompts/coding-activity.md",
			};

			expect(subroutine.name).toBe("coding-activity");
			expect(subroutine.prompt_file).toBe("prompts/coding-activity.md");
			expect(subroutine.single_turn).toBeUndefined();
		});

		it("should accept full subroutine reference with all options", () => {
			const subroutine: SubroutineReference = {
				name: "verifications",
				prompt_file: "prompts/verifications.md",
				description: "Run tests and type checking",
				single_turn: false,
				validation_loop: true,
				max_iterations: 5,
				disallow_tools: false,
				disallowed_tools: ["Write", "Bash"],
				requires_approval: false,
				suppress_thought_posting: true,
				skip_linear_post: false,
			};

			expect(subroutine.name).toBe("verifications");
			expect(subroutine.validation_loop).toBe(true);
			expect(subroutine.max_iterations).toBe(5);
			expect(subroutine.disallowed_tools).toEqual(["Write", "Bash"]);
		});
	});

	describe("WorkflowTriggers", () => {
		it("should accept empty triggers", () => {
			const triggers: WorkflowTriggers = {};

			expect(triggers.classifications).toBeUndefined();
			expect(triggers.labels).toBeUndefined();
		});

		it("should accept classification triggers", () => {
			const triggers: WorkflowTriggers = {
				classifications: ["code", "debugger"],
			};

			expect(triggers.classifications).toEqual(["code", "debugger"]);
		});

		it("should accept label triggers", () => {
			const triggers: WorkflowTriggers = {
				labels: ["feature", "bug-fix"],
			};

			expect(triggers.labels).toEqual(["feature", "bug-fix"]);
		});

		it("should accept keyword triggers", () => {
			const triggers: WorkflowTriggers = {
				keywords: ["implement", "add feature"],
			};

			expect(triggers.keywords).toEqual(["implement", "add feature"]);
		});

		it("should accept example triggers", () => {
			const triggers: WorkflowTriggers = {
				examples: ["Add a new API endpoint for user authentication"],
			};

			expect(triggers.examples).toHaveLength(1);
		});

		it("should accept combined triggers", () => {
			const triggers: WorkflowTriggers = {
				classifications: ["code"],
				labels: ["feature"],
				keywords: ["implement"],
				examples: ["Add a feature"],
			};

			expect(triggers.classifications).toEqual(["code"]);
			expect(triggers.labels).toEqual(["feature"]);
			expect(triggers.keywords).toEqual(["implement"]);
			expect(triggers.examples).toEqual(["Add a feature"]);
		});
	});

	describe("WorkflowDefinition", () => {
		it("should accept minimal workflow definition", () => {
			const workflow: WorkflowDefinition = {
				name: "simple-question",
				description: "For questions that don't modify the codebase",
				subroutines: [
					{
						name: "question-answer",
						prompt_file: "prompts/question-answer.md",
					},
				],
			};

			expect(workflow.name).toBe("simple-question");
			expect(workflow.subroutines).toHaveLength(1);
			expect(workflow.triggers).toBeUndefined();
			expect(workflow.priority).toBeUndefined();
		});

		it("should accept full workflow definition", () => {
			const workflow: WorkflowDefinition = {
				name: "full-development",
				description: "For code changes requiring full verification",
				triggers: {
					classifications: ["code"],
					labels: ["feature"],
				},
				priority: 10,
				subroutines: [
					{
						name: "coding-activity",
						prompt_file: "prompts/coding-activity.md",
					},
					{
						name: "verifications",
						prompt_file: "prompts/verifications.md",
						validation_loop: true,
					},
					{
						name: "concise-summary",
						prompt_file: "prompts/concise-summary.md",
						single_turn: true,
						disallow_tools: true,
					},
				],
			};

			expect(workflow.name).toBe("full-development");
			expect(workflow.priority).toBe(10);
			expect(workflow.subroutines).toHaveLength(3);
			expect(workflow.triggers?.classifications).toEqual(["code"]);
		});
	});

	describe("WorkflowCollection", () => {
		it("should accept minimal workflow collection", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test-workflow",
						description: "Test workflow",
						subroutines: [
							{
								name: "test-subroutine",
								prompt_file: "prompts/test.md",
							},
						],
					},
				],
			};

			expect(collection.workflows).toHaveLength(1);
			expect(collection.version).toBeUndefined();
		});

		it("should accept versioned workflow collection", () => {
			const collection: WorkflowCollection = {
				version: "1.0",
				workflows: [
					{
						name: "workflow-1",
						description: "First workflow",
						subroutines: [{ name: "sub-1", prompt_file: "prompts/sub-1.md" }],
					},
					{
						name: "workflow-2",
						description: "Second workflow",
						priority: 5,
						subroutines: [{ name: "sub-2", prompt_file: "prompts/sub-2.md" }],
					},
				],
			};

			expect(collection.version).toBe("1.0");
			expect(collection.workflows).toHaveLength(2);
		});
	});

	describe("WorkflowMatchResult", () => {
		it("should represent no match", () => {
			const result: WorkflowMatchResult = {
				workflow: undefined,
				score: 0,
			};

			expect(result.workflow).toBeUndefined();
			expect(result.score).toBe(0);
		});

		it("should represent a successful match", () => {
			const workflow: WorkflowDefinition = {
				name: "matched-workflow",
				description: "A matched workflow",
				subroutines: [{ name: "sub", prompt_file: "prompts/sub.md" }],
			};

			const result: WorkflowMatchResult = {
				workflow,
				score: 100,
				reasoning: "Matched by classification",
				matchedBy: "classification",
			};

			expect(result.workflow?.name).toBe("matched-workflow");
			expect(result.score).toBe(100);
			expect(result.matchedBy).toBe("classification");
		});

		it("should support all match types", () => {
			const matchTypes: WorkflowMatchResult["matchedBy"][] = [
				"classification",
				"label",
				"keyword",
				"example",
				"explicit",
			];

			for (const matchType of matchTypes) {
				const result: WorkflowMatchResult = {
					score: 50,
					matchedBy: matchType,
				};
				expect(result.matchedBy).toBe(matchType);
			}
		});
	});
});
