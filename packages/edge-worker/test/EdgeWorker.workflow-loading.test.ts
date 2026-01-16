import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcedureAnalyzer } from "../src/procedures/ProcedureAnalyzer";
import { PROCEDURES } from "../src/procedures/registry";
import { WorkflowLoader } from "../src/workflows/index.js";

/**
 * Tests for EdgeWorker workflow loading integration
 * These tests verify that external workflows can be loaded and merged with built-in procedures
 */

describe("EdgeWorker - Workflow Loading Integration", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-loading-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	/**
	 * Helper to create a workflow YAML file
	 */
	function createWorkflowFile(
		dir: string,
		filename: string,
		workflows: Array<{
			name: string;
			description: string;
			subroutines?: Array<{ name: string; prompt_file: string }>;
		}>,
	): void {
		const workflowsYaml = workflows
			.map((w) => {
				const subroutines = w.subroutines || [
					{ name: "step-one", prompt_file: "prompts/step-one.md" },
				];
				const subroutinesYaml = subroutines
					.map(
						(s) => `      - name: ${s.name}
        prompt_file: ${s.prompt_file}`,
					)
					.join("\n");
				return `  - name: ${w.name}
    description: ${w.description}
    subroutines:
${subroutinesYaml}`;
			})
			.join("\n");

		const yaml = `workflows:\n${workflowsYaml}`;
		fs.writeFileSync(path.join(dir, filename), yaml);
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

		// Create sample prompt files
		fs.writeFileSync(
			path.join(promptsDir, "step-one.md"),
			"# Step One Prompt\n\nThis is the prompt content.",
		);
		fs.writeFileSync(
			path.join(promptsDir, "custom-step.md"),
			"# Custom Step Prompt\n\nCustom prompt content.",
		);

		return { workflowsDir, promptsDir };
	}

	describe("ProcedureAnalyzer with additionalProcedures", () => {
		it("should load additional procedures passed in config", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "custom.yaml", [
				{ name: "custom-workflow", description: "A custom workflow" },
			]);

			// Load workflows using WorkflowLoader
			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			expect(externalProcedures.size).toBe(1);
			expect(externalProcedures.has("custom-workflow")).toBe(true);

			// Create ProcedureAnalyzer with additional procedures
			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
				additionalProcedures: externalProcedures,
			});

			// Verify built-in procedures are still available
			expect(analyzer.getProcedure("full-development")).toBeDefined();
			expect(analyzer.getProcedure("simple-question")).toBeDefined();

			// Verify custom procedure is available
			const customProcedure = analyzer.getProcedure("custom-workflow");
			expect(customProcedure).toBeDefined();
			expect(customProcedure?.name).toBe("custom-workflow");
			expect(customProcedure?.description).toBe("A custom workflow");
		});

		it("should allow external procedures to override built-in procedures", async () => {
			const { workflowsDir, promptsDir } = createWorkflowStructure(tempDir);

			// Create a custom prompt file for the override
			fs.writeFileSync(
				path.join(promptsDir, "custom-coding.md"),
				"# Custom Coding\n\nOverridden coding activity.",
			);

			// Create an external workflow that overrides 'full-development'
			createWorkflowFile(workflowsDir, "override.yaml", [
				{
					name: "full-development",
					description: "Custom full development workflow",
					subroutines: [
						{ name: "custom-coding", prompt_file: "prompts/custom-coding.md" },
						{ name: "step-one", prompt_file: "prompts/step-one.md" },
					],
				},
			]);

			// Load external workflows
			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			// Create ProcedureAnalyzer with additional procedures
			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
				additionalProcedures: externalProcedures,
			});

			// Verify the built-in 'full-development' is overridden
			const fullDevProcedure = analyzer.getProcedure("full-development");
			expect(fullDevProcedure).toBeDefined();
			expect(fullDevProcedure?.description).toBe(
				"Custom full development workflow",
			);

			// Verify subroutines are from the external workflow
			expect(fullDevProcedure?.subroutines).toHaveLength(2);
			expect(fullDevProcedure?.subroutines[0].name).toBe("custom-coding");
		});

		it("should use registerProcedure to add procedures after construction", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "late-addition.yaml", [
				{ name: "late-workflow", description: "A workflow added later" },
			]);

			// Create analyzer without additional procedures
			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
			});

			// Verify the procedure doesn't exist yet
			expect(analyzer.getProcedure("late-workflow")).toBeUndefined();

			// Load workflows
			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			// Register procedures using registerProcedure (simulating EdgeWorker behavior)
			for (const [_name, procedure] of externalProcedures) {
				analyzer.registerProcedure(procedure);
			}

			// Verify the procedure is now available
			const lateProcedure = analyzer.getProcedure("late-workflow");
			expect(lateProcedure).toBeDefined();
			expect(lateProcedure?.name).toBe("late-workflow");
		});
	});

	describe("Workflow loading error handling", () => {
		it("should handle missing workflow directory gracefully", async () => {
			const loader = new WorkflowLoader({
				source: tempDir,
				path: "nonexistent/",
			});

			const procedures = await loader.load();

			// Should return empty map, not throw
			expect(procedures.size).toBe(0);

			// Should have recorded the error
			const errors = loader.getErrors();
			expect(Object.keys(errors)).toHaveLength(1);
			expect(errors._directory).toContain("does not exist");
		});

		it("should handle invalid YAML files gracefully", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			// Create an invalid YAML file
			fs.writeFileSync(
				path.join(workflowsDir, "invalid.yaml"),
				"this is not: valid: yaml: content:\n  broken",
			);

			// Also create a valid workflow
			createWorkflowFile(workflowsDir, "valid.yaml", [
				{ name: "valid-workflow", description: "A valid workflow" },
			]);

			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const procedures = await loader.load();

			// Valid workflow should still be loaded
			expect(procedures.has("valid-workflow")).toBe(true);

			// Error should be recorded for the invalid file
			const errors = loader.getErrors();
			expect(errors["invalid.yaml"]).toBeDefined();
		});

		it("should continue with built-in procedures when loading fails", async () => {
			// Create analyzer without any external procedures (simulating failed load)
			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
			});

			// Built-in procedures should be available
			expect(analyzer.getProcedure("full-development")).toBeDefined();
			expect(analyzer.getProcedure("simple-question")).toBeDefined();
			expect(analyzer.getProcedure("documentation-edit")).toBeDefined();

			// Verify the built-in full-development has the expected structure
			const fullDev = analyzer.getProcedure("full-development");
			expect(fullDev?.subroutines[0].name).toBe("coding-activity");
		});
	});

	describe("Workflow merging behavior", () => {
		it("should preserve built-in procedures when no external ones overlap", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "unique.yaml", [
				{ name: "unique-workflow", description: "A unique workflow" },
			]);

			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
				additionalProcedures: externalProcedures,
			});

			// All built-in procedures should be intact
			const builtInNames = Object.keys(PROCEDURES);
			for (const name of builtInNames) {
				expect(analyzer.getProcedure(name)).toBeDefined();
			}

			// External procedure should also be available
			expect(analyzer.getProcedure("unique-workflow")).toBeDefined();
		});

		it("should handle multiple external workflows from one file", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);
			createWorkflowFile(workflowsDir, "multi.yaml", [
				{ name: "workflow-a", description: "First workflow" },
				{ name: "workflow-b", description: "Second workflow" },
				{ name: "workflow-c", description: "Third workflow" },
			]);

			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			expect(externalProcedures.size).toBe(3);

			const analyzer = new ProcedureAnalyzer({
				cyrusHome: tempDir,
				additionalProcedures: externalProcedures,
			});

			expect(analyzer.getProcedure("workflow-a")).toBeDefined();
			expect(analyzer.getProcedure("workflow-b")).toBeDefined();
			expect(analyzer.getProcedure("workflow-c")).toBeDefined();
		});

		it("should handle multiple YAML files in workflow directory", async () => {
			const { workflowsDir } = createWorkflowStructure(tempDir);

			createWorkflowFile(workflowsDir, "file1.yaml", [
				{ name: "workflow-from-file1", description: "From file 1" },
			]);
			createWorkflowFile(workflowsDir, "file2.yaml", [
				{ name: "workflow-from-file2", description: "From file 2" },
			]);

			const loader = new WorkflowLoader({
				source: tempDir,
				path: "workflows/",
			});
			const externalProcedures = await loader.load();

			expect(externalProcedures.size).toBe(2);
			expect(externalProcedures.has("workflow-from-file1")).toBe(true);
			expect(externalProcedures.has("workflow-from-file2")).toBe(true);
		});
	});
});
