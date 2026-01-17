import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create mock functions that can be used in vi.mock
const mocks = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockStatSync: vi.fn(),
	mockReadFileSync: vi.fn(),
}));

// Mock node:fs
vi.mock("node:fs", () => ({
	existsSync: mocks.mockExistsSync,
	statSync: mocks.mockStatSync,
	readFileSync: mocks.mockReadFileSync,
}));

// Mock path.resolve to work properly in tests
vi.mock("node:path", async () => {
	const actual = await vi.importActual("node:path");
	return {
		...actual,
		resolve: vi.fn((...parts: string[]) => parts.join("/")),
	};
});

// Mock edge-worker exports
const mockWorkflowLoaderInstance = {
	load: vi.fn().mockResolvedValue(new Map()),
	refresh: vi.fn().mockResolvedValue(undefined),
	getAllWorkflows: vi.fn().mockReturnValue([]),
	getWorkflow: vi.fn().mockReturnValue(undefined),
	getErrors: vi.fn().mockReturnValue({}),
	count: 0,
	getWorkflowPath: vi.fn().mockReturnValue("/test/workflows"),
};

const mockWorkflowParserInstance = {
	parseAndValidate: vi.fn(),
	parseDirectory: vi.fn(),
};

vi.mock("cyrus-edge-worker", () => ({
	PROCEDURES: {
		"simple-question": {
			name: "simple-question",
			description: "For questions or requests that don't modify the codebase",
			subroutines: [
				{
					name: "question-investigation",
					promptPath: "subroutines/question-investigation.md",
					description: "Gather information needed to answer a question",
				},
				{
					name: "question-answer",
					promptPath: "subroutines/question-answer.md",
					description: "Format final answer to user question",
					singleTurn: true,
					suppressThoughtPosting: true,
					disallowAllTools: true,
				},
			],
		},
		"full-development": {
			name: "full-development",
			description:
				"For code changes requiring full verification and PR creation",
			subroutines: [
				{
					name: "coding-activity",
					promptPath: "subroutines/coding-activity.md",
					description: "Implementation phase for code changes",
				},
				{
					name: "verifications",
					promptPath: "subroutines/verifications.md",
					description: "Run tests, linting, and type checking",
					usesValidationLoop: true,
				},
			],
		},
	},
	WorkflowLoader: vi.fn().mockImplementation(() => mockWorkflowLoaderInstance),
	WorkflowParser: vi.fn().mockImplementation(() => mockWorkflowParserInstance),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
	throw new Error("process.exit called");
});

// Mock console methods
const _mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

// Import after mocks
import { WorkflowsCommand } from "./WorkflowsCommand.js";

// Mock Application
const createMockApp = () => ({
	cyrusHome: "/home/user/.cyrus",
	config: {
		exists: vi.fn().mockReturnValue(true),
		load: vi.fn().mockReturnValue({ repositories: [] }),
		update: vi.fn(),
	},
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		divider: vi.fn(),
		raw: vi.fn(),
	},
});

describe("WorkflowsCommand", () => {
	let mockApp: ReturnType<typeof createMockApp>;
	let command: WorkflowsCommand;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = createMockApp();
		command = new WorkflowsCommand(mockApp as any);
		mockWorkflowLoaderInstance.load.mockResolvedValue(new Map());
		mockWorkflowLoaderInstance.getAllWorkflows.mockReturnValue([]);
		mockWorkflowLoaderInstance.getWorkflow.mockReturnValue(undefined);
		mockWorkflowLoaderInstance.getErrors.mockReturnValue({});
		mockWorkflowLoaderInstance.count = 0;
	});

	describe("help", () => {
		it("should show help when no subcommand provided", async () => {
			await command.execute([]);

			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("Usage: cyrus workflows"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("list"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("refresh"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("validate"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("show"),
			);
		});

		it("should show error and help for unknown subcommand", async () => {
			await expect(command.execute(["unknown"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Unknown subcommand"),
			);
		});
	});

	describe("list", () => {
		it("should list built-in workflows when no external source configured", async () => {
			mockApp.config.load.mockReturnValue({ repositories: [] });

			await command.execute(["list"]);

			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("NAME"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("SOURCE"),
			);
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Total: 2 workflow(s)"),
			);
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("No external workflow repository configured"),
			);
		});

		it("should list both built-in and external workflows", async () => {
			mockApp.config.load.mockReturnValue({
				repositories: [],
				workflowsRepository: {
					source: "https://github.com/test/workflows.git",
				},
			});

			mockWorkflowLoaderInstance.getAllWorkflows.mockReturnValue([
				{
					name: "custom-workflow",
					description: "A custom workflow",
					triggers: { labels: ["custom"] },
					subroutines: [{ name: "step1", prompt_file: "step1.md" }],
				},
			]);

			await command.execute(["list"]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Total: 3 workflow(s)"),
			);
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("External source:"),
			);
		});

		it("should show external workflows overriding built-in", async () => {
			mockApp.config.load.mockReturnValue({
				repositories: [],
				workflowsRepository: {
					source: "https://github.com/test/workflows.git",
				},
			});

			// External workflow with same name as built-in
			mockWorkflowLoaderInstance.getAllWorkflows.mockReturnValue([
				{
					name: "full-development",
					description: "Custom full development workflow",
					triggers: { classifications: ["code"] },
					subroutines: [{ name: "custom-step", prompt_file: "custom.md" }],
				},
			]);

			await command.execute(["list"]);

			// Should still have 2 workflows (external overrides built-in)
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Total: 2 workflow(s)"),
			);
		});
	});

	describe("refresh", () => {
		it("should inform user when no external source configured", async () => {
			mockApp.config.load.mockReturnValue({ repositories: [] });

			await command.execute(["refresh"]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				expect.stringContaining("No external workflow repository configured"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("workflowsRepository"),
			);
		});

		it("should refresh external workflows", async () => {
			mockApp.config.load.mockReturnValue({
				repositories: [],
				workflowsRepository: {
					source: "https://github.com/test/workflows.git",
				},
			});
			mockWorkflowLoaderInstance.count = 3;

			await command.execute(["refresh"]);

			expect(mockWorkflowLoaderInstance.load).toHaveBeenCalled();
			expect(mockWorkflowLoaderInstance.refresh).toHaveBeenCalled();
			expect(mockApp.logger.success).toHaveBeenCalledWith(
				expect.stringContaining("Loaded 3 workflow(s)"),
			);
		});

		it("should show errors during refresh", async () => {
			mockApp.config.load.mockReturnValue({
				repositories: [],
				workflowsRepository: {
					source: "https://github.com/test/workflows.git",
				},
			});
			mockWorkflowLoaderInstance.getErrors.mockReturnValue({
				"bad.yaml": "Parse error",
			});
			mockWorkflowLoaderInstance.count = 2;

			await command.execute(["refresh"]);

			expect(mockApp.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Some workflows failed to load"),
			);
			expect(mockApp.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("bad.yaml: Parse error"),
			);
		});
	});

	describe("validate", () => {
		it("should error when no path provided", async () => {
			await expect(command.execute(["validate"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Please provide a path"),
			);
		});

		it("should error when path does not exist", async () => {
			mocks.mockExistsSync.mockReturnValue(false);

			await expect(
				command.execute(["validate", "./test.yaml"]),
			).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("does not exist"),
			);
		});

		it("should validate a single file successfully", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockStatSync.mockReturnValue({ isDirectory: () => false });
			mocks.mockReadFileSync.mockReturnValue("version: '1.0'\nworkflows: []");

			mockWorkflowParserInstance.parseAndValidate.mockReturnValue({
				version: "1.0",
				workflows: [
					{
						name: "test-workflow",
						description: "Test",
						subroutines: [{ name: "step1", prompt_file: "prompts/step1.md" }],
					},
				],
			});

			// Mock prompt file exists
			mocks.mockExistsSync.mockImplementation((path: string) => {
				if (path.includes("step1.md")) return true;
				return true;
			});

			await command.execute(["validate", "./test.yaml"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith("Schema valid");
			expect(mockApp.logger.success).toHaveBeenCalledWith(
				expect.stringContaining("All referenced prompt files exist"),
			);
		});

		it("should report missing prompt files", async () => {
			mocks.mockExistsSync.mockImplementation((path: string) => {
				if (path.includes("missing.md")) return false;
				return true;
			});
			mocks.mockStatSync.mockReturnValue({ isDirectory: () => false });
			mocks.mockReadFileSync.mockReturnValue("version: '1.0'\nworkflows: []");

			mockWorkflowParserInstance.parseAndValidate.mockReturnValue({
				version: "1.0",
				workflows: [
					{
						name: "test-workflow",
						description: "Test",
						subroutines: [{ name: "step1", prompt_file: "prompts/missing.md" }],
					},
				],
			});

			await expect(
				command.execute(["validate", "./test.yaml"]),
			).rejects.toThrow("process.exit called");

			expect(mockApp.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Missing prompt files"),
			);
		});

		it("should validate a directory", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockStatSync.mockReturnValue({ isDirectory: () => true });

			mockWorkflowParserInstance.parseDirectory.mockReturnValue({
				collection: { workflows: [{ name: "wf1", subroutines: [] }] },
				parsedFiles: ["workflow1.yaml", "workflow2.yaml"],
				errors: {},
			});

			await command.execute(["validate", "./workflows"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				expect.stringContaining("Successfully parsed 2 file(s)"),
			);
		});
	});

	describe("show", () => {
		it("should error when no name provided", async () => {
			await expect(command.execute(["show"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Please provide a workflow name"),
			);
		});

		it("should show built-in workflow details", async () => {
			mockApp.config.load.mockReturnValue({ repositories: [] });

			await command.execute(["show", "full-development"]);

			expect(mockApp.logger.raw).toHaveBeenCalledWith("Name: full-development");
			expect(mockApp.logger.raw).toHaveBeenCalledWith("Source: built-in");
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("For code changes"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith("Subroutines:");
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("1. coding-activity"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("2. verifications (validation_loop)"),
			);
		});

		it("should show external workflow details", async () => {
			mockApp.config.load.mockReturnValue({
				repositories: [],
				workflowsRepository: {
					source: "https://github.com/test/workflows.git",
				},
			});

			mockWorkflowLoaderInstance.getWorkflow.mockReturnValue({
				name: "custom-workflow",
				description: "A custom external workflow",
				triggers: {
					classifications: ["code"],
					labels: ["custom", "feature"],
					keywords: ["implement"],
				},
				priority: 10,
				subroutines: [
					{ name: "custom-step", prompt_file: "custom.md", single_turn: true },
				],
			});

			await command.execute(["show", "custom-workflow"]);

			expect(mockApp.logger.raw).toHaveBeenCalledWith("Name: custom-workflow");
			expect(mockApp.logger.raw).toHaveBeenCalledWith("Source: external");
			expect(mockApp.logger.raw).toHaveBeenCalledWith("Triggers:");
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("Classifications: code"),
			);
			expect(mockApp.logger.raw).toHaveBeenCalledWith(
				expect.stringContaining("Labels: custom, feature"),
			);
		});

		it("should error when workflow not found", async () => {
			mockApp.config.load.mockReturnValue({ repositories: [] });

			await expect(
				command.execute(["show", "nonexistent-workflow"]),
			).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Workflow not found"),
			);
		});
	});
});
