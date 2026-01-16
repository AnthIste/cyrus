import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowParser } from "../src/workflows/index.js";
import type { WorkflowCollection } from "../src/workflows/types.js";

describe("WorkflowParser", () => {
	let parser: WorkflowParser;

	beforeEach(() => {
		// Create parser with the actual schema path
		const schemaPath = path.join(
			__dirname,
			"../src/workflows/workflow-schema.json",
		);
		parser = new WorkflowParser(schemaPath);
	});

	describe("parse()", () => {
		it("should parse a minimal valid workflow", () => {
			const yaml = `
workflows:
  - name: simple-workflow
    description: A simple workflow
    subroutines:
      - name: step-one
        prompt_file: prompts/step-one.md
`;
			const result = parser.parse(yaml);

			expect(result.workflows).toHaveLength(1);
			expect(result.workflows[0].name).toBe("simple-workflow");
			expect(result.workflows[0].description).toBe("A simple workflow");
			expect(result.workflows[0].subroutines).toHaveLength(1);
			expect(result.workflows[0].subroutines[0].name).toBe("step-one");
			expect(result.workflows[0].subroutines[0].prompt_file).toBe(
				"prompts/step-one.md",
			);
		});

		it("should parse a workflow with all optional fields", () => {
			const yaml = `
version: "1.0"
workflows:
  - name: full-workflow
    description: A fully-featured workflow
    priority: 10
    triggers:
      classifications:
        - code
        - debugger
      labels:
        - feature
        - bug-fix
      keywords:
        - implement
        - fix
      examples:
        - Add a new API endpoint
    subroutines:
      - name: coding
        prompt_file: prompts/coding.md
        description: Main coding activity
        single_turn: false
        validation_loop: true
        max_iterations: 5
        disallow_tools: false
        disallowed_tools:
          - Write
          - Bash
        requires_approval: true
        suppress_thought_posting: true
        skip_linear_post: false
`;
			const result = parser.parse(yaml);

			expect(result.version).toBe("1.0");
			expect(result.workflows).toHaveLength(1);

			const workflow = result.workflows[0];
			expect(workflow.name).toBe("full-workflow");
			expect(workflow.priority).toBe(10);
			expect(workflow.triggers?.classifications).toEqual(["code", "debugger"]);
			expect(workflow.triggers?.labels).toEqual(["feature", "bug-fix"]);
			expect(workflow.triggers?.keywords).toEqual(["implement", "fix"]);
			expect(workflow.triggers?.examples).toEqual(["Add a new API endpoint"]);

			const subroutine = workflow.subroutines[0];
			expect(subroutine.name).toBe("coding");
			expect(subroutine.description).toBe("Main coding activity");
			expect(subroutine.single_turn).toBe(false);
			expect(subroutine.validation_loop).toBe(true);
			expect(subroutine.max_iterations).toBe(5);
			expect(subroutine.disallow_tools).toBe(false);
			expect(subroutine.disallowed_tools).toEqual(["Write", "Bash"]);
			expect(subroutine.requires_approval).toBe(true);
			expect(subroutine.suppress_thought_posting).toBe(true);
			expect(subroutine.skip_linear_post).toBe(false);
		});

		it("should parse multiple workflows in one file", () => {
			const yaml = `
workflows:
  - name: workflow-a
    description: First workflow
    subroutines:
      - name: step-a
        prompt_file: prompts/a.md
  - name: workflow-b
    description: Second workflow
    priority: 5
    subroutines:
      - name: step-b1
        prompt_file: prompts/b1.md
      - name: step-b2
        prompt_file: prompts/b2.md
`;
			const result = parser.parse(yaml);

			expect(result.workflows).toHaveLength(2);
			expect(result.workflows[0].name).toBe("workflow-a");
			expect(result.workflows[1].name).toBe("workflow-b");
			expect(result.workflows[1].priority).toBe(5);
			expect(result.workflows[1].subroutines).toHaveLength(2);
		});

		it("should throw error for empty content", () => {
			expect(() => parser.parse("")).toThrow("YAML content is empty");
			expect(() => parser.parse("   ")).toThrow("YAML content is empty");
			expect(() => parser.parse("\n\n")).toThrow("YAML content is empty");
		});

		it("should throw error for null YAML", () => {
			expect(() => parser.parse("null")).toThrow(
				"YAML content is empty or null",
			);
			expect(() => parser.parse("~")).toThrow("YAML content is empty or null");
		});

		it("should throw error for invalid YAML syntax", () => {
			const invalidYaml = `
workflows:
  - name: bad
    description: [unclosed bracket
`;
			expect(() => parser.parse(invalidYaml)).toThrow("Failed to parse YAML");
		});

		it("should throw error when workflows property is missing", () => {
			expect(() => parser.parse("name: something")).toThrow(
				"YAML must contain a 'workflows' property",
			);
		});

		it("should throw error when workflows is not an array", () => {
			expect(() => parser.parse("workflows: not-an-array")).toThrow(
				"'workflows' must be an array",
			);
		});

		it("should throw error when workflows array is empty", () => {
			expect(() => parser.parse("workflows: []")).toThrow(
				"'workflows' array cannot be empty",
			);
		});

		it("should throw error when workflow is not an object", () => {
			expect(() => parser.parse("workflows:\n  - just a string")).toThrow(
				"Workflow at index 0 must be an object",
			);
		});

		it("should throw error when workflow name is missing", () => {
			const yaml = `
workflows:
  - description: Missing name
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Workflow at index 0 must have a 'name' string",
			);
		});

		it("should throw error when workflow description is missing", () => {
			const yaml = `
workflows:
  - name: missing-description
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Workflow 'missing-description' must have a 'description' string",
			);
		});

		it("should throw error when subroutines array is missing", () => {
			const yaml = `
workflows:
  - name: no-subroutines
    description: Missing subroutines array
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Workflow 'no-subroutines' must have a 'subroutines' array",
			);
		});

		it("should throw error when subroutines array is empty", () => {
			const yaml = `
workflows:
  - name: empty-subroutines
    description: Empty subroutines array
    subroutines: []
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Workflow 'empty-subroutines' must have at least one subroutine",
			);
		});

		it("should throw error when subroutine name is missing", () => {
			const yaml = `
workflows:
  - name: bad-subroutine
    description: Subroutine without name
    subroutines:
      - prompt_file: prompts/step.md
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Subroutine at index 0 in workflow 'bad-subroutine' must have a 'name' string",
			);
		});

		it("should throw error when subroutine prompt_file is missing", () => {
			const yaml = `
workflows:
  - name: bad-subroutine
    description: Subroutine without prompt_file
    subroutines:
      - name: step
`;
			expect(() => parser.parse(yaml)).toThrow(
				"Subroutine 'step' in workflow 'bad-subroutine' must have a 'prompt_file' string",
			);
		});

		it("should throw error when YAML is an array instead of object", () => {
			expect(() => parser.parse("- item1\n- item2")).toThrow(
				"YAML must be an object with a 'workflows' array",
			);
		});
	});

	describe("validate()", () => {
		it("should validate a correct workflow collection", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "valid-workflow",
						description: "A valid workflow",
						subroutines: [
							{
								name: "step-one",
								prompt_file: "prompts/step-one.md",
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(true);
			expect(result.errors).toBeUndefined();
		});

		it("should reject workflow with invalid name pattern", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "InvalidName", // Must start with lowercase and use only lowercase/numbers/hyphens
						description: "Invalid workflow name",
						subroutines: [
							{
								name: "step",
								prompt_file: "prompts/step.md",
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors?.some((e) => e.includes("name"))).toBe(true);
		});

		it("should reject subroutine with invalid prompt_file pattern", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test-workflow",
						description: "Test workflow",
						subroutines: [
							{
								name: "step",
								prompt_file: "invalid.txt", // Must end with .md
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors?.some((e) => e.includes("prompt_file"))).toBe(true);
		});

		it("should reject invalid classification values", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test-workflow",
						description: "Test workflow",
						triggers: {
							classifications: ["invalid-classification" as never],
						},
						subroutines: [
							{
								name: "step",
								prompt_file: "prompts/step.md",
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
		});

		it("should validate all valid classification values", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test-workflow",
						description: "Test workflow",
						triggers: {
							classifications: [
								"question",
								"documentation",
								"transient",
								"planning",
								"code",
								"debugger",
								"orchestrator",
								"user-testing",
								"release",
							],
						},
						subroutines: [
							{
								name: "step",
								prompt_file: "prompts/step.md",
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(true);
		});

		it("should reject max_iterations outside valid range", () => {
			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test-workflow",
						description: "Test workflow",
						subroutines: [
							{
								name: "step",
								prompt_file: "prompts/step.md",
								validation_loop: true,
								max_iterations: 15, // Max is 10
							},
						],
					},
				],
			};

			const result = parser.validate(collection);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
		});
	});

	describe("parseAndValidate()", () => {
		it("should parse and validate valid YAML", () => {
			const yaml = `
workflows:
  - name: valid-workflow
    description: A valid workflow
    subroutines:
      - name: step-one
        prompt_file: prompts/step-one.md
`;
			const result = parser.parseAndValidate(yaml);
			expect(result.workflows).toHaveLength(1);
		});

		it("should throw error for valid YAML but invalid schema", () => {
			const yaml = `
workflows:
  - name: InvalidName
    description: Invalid workflow name
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`;
			expect(() => parser.parseAndValidate(yaml)).toThrow(
				"Workflow validation failed",
			);
		});
	});

	describe("toProcedureDefinition()", () => {
		it("should convert a minimal workflow to ProcedureDefinition", () => {
			const yaml = `
workflows:
  - name: simple-workflow
    description: A simple workflow
    subroutines:
      - name: step-one
        prompt_file: prompts/step-one.md
`;
			const collection = parser.parse(yaml);
			const procedure = parser.toProcedureDefinition(
				collection.workflows[0],
				"/base/path",
			);

			expect(procedure.name).toBe("simple-workflow");
			expect(procedure.description).toBe("A simple workflow");
			expect(procedure.subroutines).toHaveLength(1);
			expect(procedure.subroutines[0].name).toBe("step-one");
			expect(procedure.subroutines[0].promptPath).toBe(
				"/base/path/prompts/step-one.md",
			);
			expect(procedure.subroutines[0].description).toBe("step-one"); // Falls back to name
		});

		it("should convert all subroutine options correctly", () => {
			const yaml = `
workflows:
  - name: full-workflow
    description: Full workflow
    subroutines:
      - name: step-one
        prompt_file: prompts/step.md
        description: Full step description
        single_turn: true
        validation_loop: true
        disallow_tools: true
        disallowed_tools:
          - Write
          - Bash
        requires_approval: true
        suppress_thought_posting: true
        skip_linear_post: true
`;
			const collection = parser.parse(yaml);
			const procedure = parser.toProcedureDefinition(
				collection.workflows[0],
				"/workflows",
			);

			const subroutine = procedure.subroutines[0];
			expect(subroutine.description).toBe("Full step description");
			expect(subroutine.singleTurn).toBe(true);
			expect(subroutine.usesValidationLoop).toBe(true);
			expect(subroutine.disallowAllTools).toBe(true);
			expect(subroutine.disallowedTools).toEqual(["Write", "Bash"]);
			expect(subroutine.requiresApproval).toBe(true);
			expect(subroutine.suppressThoughtPosting).toBe(true);
			expect(subroutine.skipLinearPost).toBe(true);
		});

		it("should not include undefined optional fields in conversion", () => {
			const yaml = `
workflows:
  - name: minimal-workflow
    description: Minimal workflow
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`;
			const collection = parser.parse(yaml);
			const procedure = parser.toProcedureDefinition(
				collection.workflows[0],
				"/base",
			);

			const subroutine = procedure.subroutines[0];
			expect(subroutine.singleTurn).toBeUndefined();
			expect(subroutine.usesValidationLoop).toBeUndefined();
			expect(subroutine.disallowAllTools).toBeUndefined();
			expect(subroutine.disallowedTools).toBeUndefined();
			expect(subroutine.requiresApproval).toBeUndefined();
			expect(subroutine.suppressThoughtPosting).toBeUndefined();
			expect(subroutine.skipLinearPost).toBeUndefined();
		});

		it("should resolve prompt paths relative to base path", () => {
			const yaml = `
workflows:
  - name: test
    description: Test
    subroutines:
      - name: step1
        prompt_file: subroutines/coding.md
      - name: step2
        prompt_file: subroutines/deep/nested/file.md
`;
			const collection = parser.parse(yaml);
			const procedure = parser.toProcedureDefinition(
				collection.workflows[0],
				"/repo/.cyrus/workflows",
			);

			expect(procedure.subroutines[0].promptPath).toBe(
				"/repo/.cyrus/workflows/subroutines/coding.md",
			);
			expect(procedure.subroutines[1].promptPath).toBe(
				"/repo/.cyrus/workflows/subroutines/deep/nested/file.md",
			);
		});
	});

	describe("toProcedureDefinitions()", () => {
		it("should convert all workflows in a collection", () => {
			const yaml = `
workflows:
  - name: workflow-a
    description: Workflow A
    subroutines:
      - name: step-a
        prompt_file: prompts/a.md
  - name: workflow-b
    description: Workflow B
    subroutines:
      - name: step-b
        prompt_file: prompts/b.md
`;
			const collection = parser.parse(yaml);
			const procedures = parser.toProcedureDefinitions(collection, "/base");

			expect(procedures.size).toBe(2);
			expect(procedures.has("workflow-a")).toBe(true);
			expect(procedures.has("workflow-b")).toBe(true);
			expect(procedures.get("workflow-a")?.description).toBe("Workflow A");
			expect(procedures.get("workflow-b")?.description).toBe("Workflow B");
		});
	});

	describe("parseDirectory()", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-parser-test-"));
		});

		afterEach(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("should parse all YAML files in a directory", () => {
			fs.writeFileSync(
				path.join(tempDir, "workflow-a.yaml"),
				`
workflows:
  - name: workflow-a
    description: Workflow A
    subroutines:
      - name: step-a
        prompt_file: prompts/a.md
`,
			);

			fs.writeFileSync(
				path.join(tempDir, "workflow-b.yml"),
				`
workflows:
  - name: workflow-b
    description: Workflow B
    subroutines:
      - name: step-b
        prompt_file: prompts/b.md
`,
			);

			const result = parser.parseDirectory(tempDir);

			expect(result.parsedFiles).toHaveLength(2);
			expect(result.parsedFiles).toContain("workflow-a.yaml");
			expect(result.parsedFiles).toContain("workflow-b.yml");
			expect(result.collection.workflows).toHaveLength(2);
			expect(Object.keys(result.errors)).toHaveLength(0);
		});

		it("should merge workflows from multiple files alphabetically", () => {
			// 01-base.yaml comes first
			fs.writeFileSync(
				path.join(tempDir, "01-base.yaml"),
				`
workflows:
  - name: shared-workflow
    description: Original description
    subroutines:
      - name: step
        prompt_file: prompts/original.md
`,
			);

			// 02-override.yaml comes second and overrides
			fs.writeFileSync(
				path.join(tempDir, "02-override.yaml"),
				`
workflows:
  - name: shared-workflow
    description: Overridden description
    subroutines:
      - name: step
        prompt_file: prompts/overridden.md
`,
			);

			const result = parser.parseDirectory(tempDir);

			expect(result.collection.workflows).toHaveLength(1);
			expect(result.collection.workflows[0].description).toBe(
				"Overridden description",
			);
			expect(result.collection.workflows[0].subroutines[0].prompt_file).toBe(
				"prompts/overridden.md",
			);
		});

		it("should handle errors in individual files gracefully", () => {
			// Valid file
			fs.writeFileSync(
				path.join(tempDir, "valid.yaml"),
				`
workflows:
  - name: valid-workflow
    description: Valid workflow
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`,
			);

			// Invalid file (missing required fields)
			fs.writeFileSync(
				path.join(tempDir, "invalid.yaml"),
				`
workflows:
  - name: InvalidWorkflow
    description: Missing subroutines
`,
			);

			const result = parser.parseDirectory(tempDir);

			expect(result.parsedFiles).toContain("valid.yaml");
			expect(result.parsedFiles).not.toContain("invalid.yaml");
			expect(result.errors["invalid.yaml"]).toBeDefined();
			expect(result.collection.workflows).toHaveLength(1);
		});

		it("should return error for non-existent directory", () => {
			const result = parser.parseDirectory("/non/existent/path");

			expect(result.errors._directory).toContain("does not exist");
			expect(result.parsedFiles).toHaveLength(0);
			expect(result.collection.workflows).toHaveLength(0);
		});

		it("should return error when path is a file, not a directory", () => {
			const filePath = path.join(tempDir, "notadir.yaml");
			fs.writeFileSync(filePath, "workflows: []");

			const result = parser.parseDirectory(filePath);

			expect(result.errors._directory).toContain("not a directory");
		});

		it("should return error for directory with no YAML files", () => {
			// Create a directory with only non-YAML files
			fs.writeFileSync(path.join(tempDir, "readme.txt"), "Hello");
			fs.writeFileSync(path.join(tempDir, "config.json"), "{}");

			const result = parser.parseDirectory(tempDir);

			expect(result.errors._directory).toContain("No YAML files found");
		});

		it("should ignore non-YAML files", () => {
			fs.writeFileSync(
				path.join(tempDir, "workflow.yaml"),
				`
workflows:
  - name: workflow
    description: Workflow
    subroutines:
      - name: step
        prompt_file: prompts/step.md
`,
			);
			fs.writeFileSync(path.join(tempDir, "readme.md"), "# Readme");
			fs.writeFileSync(path.join(tempDir, "config.json"), "{}");

			const result = parser.parseDirectory(tempDir);

			expect(result.parsedFiles).toHaveLength(1);
			expect(result.parsedFiles).toContain("workflow.yaml");
		});

		it("should process files in alphabetical order for deterministic merging", () => {
			// Create files that would be processed in a specific order
			fs.writeFileSync(
				path.join(tempDir, "z-last.yaml"),
				`
workflows:
  - name: workflow
    description: Last
    subroutines:
      - name: step
        prompt_file: prompts/last.md
`,
			);
			fs.writeFileSync(
				path.join(tempDir, "a-first.yaml"),
				`
workflows:
  - name: workflow
    description: First
    subroutines:
      - name: step
        prompt_file: prompts/first.md
`,
			);

			const result = parser.parseDirectory(tempDir);

			// z-last.yaml should win because it's processed last (alphabetically)
			expect(result.collection.workflows[0].description).toBe("Last");
		});
	});

	describe("schema loading behavior", () => {
		it("should handle missing schema file gracefully", () => {
			const parserWithBadSchema = new WorkflowParser(
				"/non/existent/schema.json",
			);

			const collection: WorkflowCollection = {
				workflows: [
					{
						name: "test",
						description: "Test",
						subroutines: [
							{
								name: "step",
								prompt_file: "prompts/step.md",
							},
						],
					},
				],
			};

			// Should not throw, returns valid=true when schema unavailable
			const result = parserWithBadSchema.validate(collection);
			expect(result.valid).toBe(true);
		});
	});
});
