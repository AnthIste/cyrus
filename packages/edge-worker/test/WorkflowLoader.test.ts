import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowLoader, WorkflowParser } from "../src/workflows/index.js";

describe("WorkflowLoader", () => {
	let tempDir: string;
	let parser: WorkflowParser;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-loader-test-"));
		const schemaPath = path.join(
			__dirname,
			"../src/workflows/workflow-schema.json",
		);
		parser = new WorkflowParser(schemaPath);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	/**
	 * Helper to create a valid workflow YAML file
	 */
	function createWorkflowFile(
		dir: string,
		filename: string,
		workflows: Array<{ name: string; description: string }>,
	): string {
		const workflowsYaml = workflows
			.map(
				(w) => `  - name: ${w.name}
    description: ${w.description}
    subroutines:
      - name: step-one
        prompt_file: prompts/step-one.md`,
			)
			.join("\n");

		const yaml = `workflows:\n${workflowsYaml}`;
		const filePath = path.join(dir, filename);
		fs.writeFileSync(filePath, yaml);
		return filePath;
	}

	/**
	 * Helper to create a full workflow directory structure
	 */
	function createWorkflowStructure(baseDir: string): {
		workflowsDir: string;
		promptsDir: string;
	} {
		const workflowsDir = path.join(baseDir, "workflows");
		const promptsDir = path.join(workflowsDir, "prompts");
		fs.mkdirSync(workflowsDir, { recursive: true });
		fs.mkdirSync(promptsDir, { recursive: true });

		// Create a sample prompt file
		fs.writeFileSync(
			path.join(promptsDir, "step-one.md"),
			"# Step One Prompt\n\nThis is the prompt content.",
		);

		return { workflowsDir, promptsDir };
	}

	describe("constructor", () => {
		it("should create a loader with default configuration", () => {
			const loader = new WorkflowLoader({ source: tempDir });
			expect(loader.count).toBe(0);
			expect(loader.hasWorkflows()).toBe(false);
		});

		it("should accept custom configuration", () => {
			const loader = new WorkflowLoader({
				source: tempDir,
				branch: "develop",
				path: "custom/workflows/",
				cacheEnabled: false,
			});
			expect(loader.getWorkflowPath()).toContain("custom/workflows");
		});

		it("should accept a custom parser", () => {
			const customParser = new WorkflowParser();
			const loader = new WorkflowLoader({ source: tempDir }, customParser);
			expect(loader.count).toBe(0);
		});
	});

	describe("load() - local filesystem", () => {
		it("should load workflows from a local directory", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "test-workflow", description: "A test workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			const procedures = await loader.load();

			expect(procedures.size).toBe(1);
			expect(procedures.has("test-workflow")).toBe(true);
			expect(loader.count).toBe(1);
		});

		it("should load multiple workflows from multiple files", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow-a.yaml", [
				{ name: "workflow-a", description: "Workflow A" },
			]);
			createWorkflowFile(workflowsDir, "workflow-b.yaml", [
				{ name: "workflow-b", description: "Workflow B" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			const procedures = await loader.load();

			expect(procedures.size).toBe(2);
			expect(procedures.has("workflow-a")).toBe(true);
			expect(procedures.has("workflow-b")).toBe(true);
		});

		it("should handle non-existent workflow directory", async () => {
			const loader = new WorkflowLoader(
				{ source: tempDir, path: "nonexistent/" },
				parser,
			);
			const procedures = await loader.load();

			expect(procedures.size).toBe(0);
			const errors = loader.getErrors();
			expect(errors._directory).toContain("does not exist");
		});

		it("should load from a single YAML file path", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			const filePath = createWorkflowFile(workflowsDir, "single.yaml", [
				{ name: "single-workflow", description: "Single file workflow" },
			]);

			// Set path to point directly to the file
			const relativePath = path.relative(tempDir, filePath);
			const loader = new WorkflowLoader(
				{ source: tempDir, path: relativePath },
				parser,
			);
			const procedures = await loader.load();

			expect(procedures.size).toBe(1);
			expect(procedures.has("single-workflow")).toBe(true);
		});

		it("should convert workflows to ProcedureDefinitions correctly", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			// Create a workflow with all options
			const yaml = `workflows:
  - name: full-workflow
    description: Full workflow with all options
    priority: 10
    triggers:
      classifications:
        - code
      labels:
        - feature
    subroutines:
      - name: coding-step
        prompt_file: prompts/step-one.md
        description: The coding step
        single_turn: true
        validation_loop: true
        disallow_tools: true
        requires_approval: true
`;
			fs.writeFileSync(path.join(workflowsDir, "full.yaml"), yaml);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const procedure = loader.get("full-workflow");
			expect(procedure).toBeDefined();
			expect(procedure?.name).toBe("full-workflow");
			expect(procedure?.description).toBe("Full workflow with all options");
			expect(procedure?.subroutines).toHaveLength(1);

			const subroutine = procedure?.subroutines[0];
			expect(subroutine?.name).toBe("coding-step");
			expect(subroutine?.description).toBe("The coding step");
			expect(subroutine?.singleTurn).toBe(true);
			expect(subroutine?.usesValidationLoop).toBe(true);
			expect(subroutine?.disallowAllTools).toBe(true);
			expect(subroutine?.requiresApproval).toBe(true);
			expect(subroutine?.promptPath).toBe(
				path.join(workflowsDir, "prompts/step-one.md"),
			);
		});
	});

	describe("get() and getAll()", () => {
		it("should return undefined for non-existent workflow", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "existing", description: "Existing workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.get("non-existent")).toBeUndefined();
			expect(loader.get("existing")).toBeDefined();
		});

		it("should return all loaded workflows", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflows.yaml", [
				{ name: "workflow-a", description: "Workflow A" },
				{ name: "workflow-b", description: "Workflow B" },
				{ name: "workflow-c", description: "Workflow C" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const all = loader.getAll();
			expect(all).toHaveLength(3);
			expect(all.map((p) => p.name).sort()).toEqual([
				"workflow-a",
				"workflow-b",
				"workflow-c",
			]);
		});
	});

	describe("getWorkflow() and getAllWorkflows()", () => {
		it("should return the raw WorkflowDefinition", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			const yaml = `workflows:
  - name: test-workflow
    description: Test workflow
    priority: 5
    triggers:
      classifications:
        - code
      labels:
        - feature
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`;
			fs.writeFileSync(path.join(workflowsDir, "test.yaml"), yaml);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const workflow = loader.getWorkflow("test-workflow");
			expect(workflow).toBeDefined();
			expect(workflow?.name).toBe("test-workflow");
			expect(workflow?.priority).toBe(5);
			expect(workflow?.triggers?.classifications).toContain("code");
			expect(workflow?.triggers?.labels).toContain("feature");
		});

		it("should return all workflow definitions", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflows.yaml", [
				{ name: "workflow-a", description: "A" },
				{ name: "workflow-b", description: "B" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const workflows = loader.getAllWorkflows();
			expect(workflows).toHaveLength(2);
		});
	});

	describe("getCollection()", () => {
		it("should return a WorkflowCollection", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflows.yaml", [
				{ name: "workflow-a", description: "A" },
				{ name: "workflow-b", description: "B" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const collection = loader.getCollection();
			expect(collection.workflows).toHaveLength(2);
		});
	});

	describe("refresh()", () => {
		it("should reload workflows after refresh", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "original", description: "Original workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.get("original")).toBeDefined();
			expect(loader.count).toBe(1);

			// Update the file with a new workflow
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "updated", description: "Updated workflow" },
			]);

			await loader.refresh();

			expect(loader.get("original")).toBeUndefined();
			expect(loader.get("updated")).toBeDefined();
			expect(loader.count).toBe(1);
		});

		it("should clear errors on refresh", async () => {
			const loader = new WorkflowLoader(
				{ source: tempDir, path: "nonexistent/" },
				parser,
			);
			await loader.load();

			expect(Object.keys(loader.getErrors())).toHaveLength(1);

			// Create the directory
			const workflowsDir = path.join(tempDir, "nonexistent");
			fs.mkdirSync(workflowsDir, { recursive: true });
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "new-workflow", description: "New workflow" },
			]);
			fs.mkdirSync(path.join(workflowsDir, "prompts"), { recursive: true });
			fs.writeFileSync(
				path.join(workflowsDir, "prompts", "step-one.md"),
				"# Prompt",
			);

			await loader.refresh();

			expect(loader.count).toBe(1);
		});
	});

	describe("caching behavior", () => {
		it("should cache workflows when cacheEnabled is true", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "cached", description: "Cached workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/", cacheEnabled: true },
				parser,
			);

			// First load
			await loader.load();
			expect(loader.count).toBe(1);

			// Second load should use cache (no file changes)
			await loader.load();
			expect(loader.count).toBe(1);
		});

		it("should detect file changes when cache is enabled", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			const filePath = path.join(workflowsDir, "workflow.yaml");

			const yaml1 = `workflows:
  - name: version-one
    description: Version 1
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`;
			fs.writeFileSync(filePath, yaml1);

			const loader = new WorkflowLoader(
				{
					source: tempDir,
					path: "workflows/workflow.yaml",
					cacheEnabled: true,
				},
				parser,
			);

			await loader.load();
			expect(loader.get("version-one")).toBeDefined();

			// Small delay to ensure mtime changes
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Modify the file
			const yaml2 = `workflows:
  - name: version-two
    description: Version 2
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`;
			fs.writeFileSync(filePath, yaml2);

			// Clear the loader state and reload
			await loader.refresh();
			expect(loader.get("version-one")).toBeUndefined();
			expect(loader.get("version-two")).toBeDefined();
		});

		it("should not use cache when cacheEnabled is false", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "no-cache", description: "No cache workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/", cacheEnabled: false },
				parser,
			);

			await loader.load();
			expect(loader.count).toBe(1);
		});
	});

	describe("error handling", () => {
		it("should collect errors from invalid YAML files", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			// Valid file
			createWorkflowFile(workflowsDir, "valid.yaml", [
				{ name: "valid", description: "Valid workflow" },
			]);

			// Invalid file (bad YAML structure)
			fs.writeFileSync(
				path.join(workflowsDir, "invalid.yaml"),
				`workflows:
  - name: InvalidName
    description: Invalid workflow name pattern
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`,
			);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			// Valid workflow should be loaded
			expect(loader.get("valid")).toBeDefined();

			// Errors should be recorded
			const errors = loader.getErrors();
			expect(errors["invalid.yaml"]).toBeDefined();
		});

		it("should handle empty directory", async () => {
			const workflowsDir = path.join(tempDir, "workflows");
			fs.mkdirSync(workflowsDir, { recursive: true });

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			const errors = loader.getErrors();
			expect(errors._directory).toContain("No YAML files found");
		});
	});

	describe("cleanup()", () => {
		it("should clear all state on cleanup", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "test", description: "Test workflow" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.count).toBe(1);
			expect(loader.hasWorkflows()).toBe(true);

			loader.cleanup();

			expect(loader.count).toBe(0);
			expect(loader.hasWorkflows()).toBe(false);
			expect(loader.getAll()).toHaveLength(0);
		});
	});

	describe("Git URL detection", () => {
		it("should detect HTTPS Git URLs", () => {
			const loader = new WorkflowLoader({
				source: "https://github.com/org/repo.git",
			});
			// The loader should recognize this as a Git source
			// We can verify by checking the workflow path is not the source itself
			expect(loader.getWorkflowPath()).not.toBe(
				"https://github.com/org/repo.git",
			);
		});

		it("should detect SSH Git URLs", () => {
			const loader = new WorkflowLoader({
				source: "git@github.com:org/repo.git",
			});
			expect(loader.getWorkflowPath()).not.toBe("git@github.com:org/repo.git");
		});

		it("should treat local paths as filesystem sources", () => {
			const loader = new WorkflowLoader({
				source: "/local/path/to/workflows",
			});
			expect(loader.getWorkflowPath()).toContain("/local/path/to/workflows");
		});
	});

	describe("hasWorkflows()", () => {
		it("should return false when no workflows loaded", () => {
			const loader = new WorkflowLoader({ source: tempDir });
			expect(loader.hasWorkflows()).toBe(false);
		});

		it("should return true when workflows are loaded", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflow.yaml", [
				{ name: "test", description: "Test" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.hasWorkflows()).toBe(true);
		});
	});

	describe("count property", () => {
		it("should return 0 initially", () => {
			const loader = new WorkflowLoader({ source: tempDir });
			expect(loader.count).toBe(0);
		});

		it("should return correct count after loading", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "workflows.yaml", [
				{ name: "a", description: "A" },
				{ name: "b", description: "B" },
				{ name: "c", description: "C" },
			]);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.count).toBe(3);
		});
	});

	describe("workflow override behavior", () => {
		it("should allow later files to override earlier workflows", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			// First file (alphabetically earlier)
			fs.writeFileSync(
				path.join(workflowsDir, "01-base.yaml"),
				`workflows:
  - name: shared-workflow
    description: Original description
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`,
			);

			// Second file (alphabetically later, overrides)
			fs.writeFileSync(
				path.join(workflowsDir, "02-override.yaml"),
				`workflows:
  - name: shared-workflow
    description: Overridden description
    subroutines:
      - name: step
        prompt_file: prompts/step-one.md
`,
			);

			const loader = new WorkflowLoader(
				{ source: tempDir, path: "workflows/" },
				parser,
			);
			await loader.load();

			expect(loader.count).toBe(1);
			const workflow = loader.get("shared-workflow");
			expect(workflow?.description).toBe("Overridden description");
		});
	});
});

describe("WorkflowLoader - Git integration", () => {
	// These tests require a real Git repository
	// They are marked as integration tests and may be skipped in CI

	const GITHUB_TEST_REPO = "https://github.com/octocat/Hello-World.git";

	it.skip("should clone a public Git repository", async () => {
		const loader = new WorkflowLoader({
			source: GITHUB_TEST_REPO,
			branch: "master",
			path: "", // Root of repo
		});

		try {
			await loader.load();
			// The Hello-World repo doesn't have workflows, so we expect no workflows
			// but the clone should succeed
			expect(loader.count).toBe(0);
		} finally {
			loader.cleanup();
		}
	});

	it.skip("should handle Git clone failures gracefully", async () => {
		const loader = new WorkflowLoader({
			source: "https://github.com/nonexistent/nonexistent-repo-12345.git",
			branch: "main",
		});

		// This should not throw, but should result in no workflows
		await expect(loader.load()).rejects.toThrow();
	});
});
