import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create mock functions that can be used in vi.mock
const mocks = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockReadFile: vi.fn(),
	mockWriteFile: vi.fn(),
}));

// Mock modules
vi.mock("node:fs", () => ({
	existsSync: mocks.mockExistsSync,
}));

vi.mock("node:fs/promises", () => ({
	readFile: mocks.mockReadFile,
	writeFile: mocks.mockWriteFile,
}));

vi.mock("node:path", () => ({
	join: vi.fn((...parts) => parts.join("/")),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
	throw new Error("process.exit called");
});

// Import after mocks
import { CacheClearCommand } from "./CacheClearCommand.js";

// Mock Application
const createMockApp = () => ({
	cyrusHome: "/home/user/.cyrus",
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		divider: vi.fn(),
	},
});

// Sample state file content
const createStateFile = (
	issueRepositoryCache: Record<string, string>,
	agentSessions?: Record<string, Record<string, any>>,
) =>
	JSON.stringify({
		version: "2.0",
		savedAt: new Date().toISOString(),
		state: {
			issueRepositoryCache,
			agentSessions,
		},
	});

describe("CacheClearCommand", () => {
	let mockApp: ReturnType<typeof createMockApp>;
	let command: CacheClearCommand;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = createMockApp();
		command = new CacheClearCommand(mockApp as any);
	});

	describe("Pattern Required", () => {
		it("should exit with error when no pattern is provided", async () => {
			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith("Pattern is required.");
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				'Use "cyrus cache list" to see cached entries.',
			);
		});
	});

	describe("No State File", () => {
		it("should report nothing to clear when state file does not exist", async () => {
			mocks.mockExistsSync.mockReturnValue(false);

			await command.execute(["*"]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				"No cache file found. Nothing to clear.",
			);
		});
	});

	describe("Empty Cache", () => {
		it("should report empty cache when no entries exist", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(createStateFile({}));

			await command.execute(["*"]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				"Cache is empty. Nothing to clear.",
			);
		});
	});

	describe("Clear All Entries", () => {
		it('should clear all entries when pattern is "*"', async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile(
					{
						"issue-uuid-1": "repo-uuid-1",
						"issue-uuid-2": "repo-uuid-2",
					},
					{
						"repo-uuid-1": {
							"session-1": {
								issueId: "issue-uuid-1",
								issue: { identifier: "RUB-101" },
							},
						},
					},
				),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["*"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				"Cleared 2 cache entries.",
			);

			// Verify the state file was written with empty cache
			expect(mocks.mockWriteFile).toHaveBeenCalled();
			const writtenContent = JSON.parse(mocks.mockWriteFile.mock.calls[0][1]);
			expect(writtenContent.state.issueRepositoryCache).toEqual({});
		});
	});

	describe("Clear By Exact Match", () => {
		it("should clear a specific entry by exact issue identifier", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile(
					{
						"issue-uuid-1": "repo-uuid-1",
						"issue-uuid-2": "repo-uuid-2",
					},
					{
						"repo-uuid-1": {
							"session-1": {
								issueId: "issue-uuid-1",
								issue: { identifier: "RUB-101" },
							},
						},
						"repo-uuid-2": {
							"session-2": {
								issueId: "issue-uuid-2",
								issue: { identifier: "RUB-102" },
							},
						},
					},
				),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["RUB-101"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				"Cleared 1 cache entry.",
			);

			// Verify the state file was written with only RUB-102 remaining
			const writtenContent = JSON.parse(mocks.mockWriteFile.mock.calls[0][1]);
			expect(writtenContent.state.issueRepositoryCache).toEqual({
				"issue-uuid-2": "repo-uuid-2",
			});
		});

		it("should clear entry by exact issue UUID when identifier is unknown", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile({
					"issue-uuid-orphan": "repo-uuid-orphan",
				}),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["issue-uuid-orphan"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				"Cleared 1 cache entry.",
			);
		});

		it("should report no match when issue identifier not found", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile(
					{
						"issue-uuid-1": "repo-uuid-1",
					},
					{
						"repo-uuid-1": {
							"session-1": {
								issueId: "issue-uuid-1",
								issue: { identifier: "RUB-101" },
							},
						},
					},
				),
			);

			await command.execute(["RUB-999"]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				'No cache entries match pattern "RUB-999".',
			);
			expect(mocks.mockWriteFile).not.toHaveBeenCalled();
		});
	});

	describe("Clear By Prefix Match", () => {
		it("should clear entries matching a prefix pattern", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile(
					{
						"issue-uuid-1": "repo-uuid-1",
						"issue-uuid-2": "repo-uuid-2",
						"issue-uuid-3": "repo-uuid-3",
					},
					{
						"repo-uuid-1": {
							"session-1": {
								issueId: "issue-uuid-1",
								issue: { identifier: "RUB-101" },
							},
							"session-3": {
								issueId: "issue-uuid-3",
								issue: { identifier: "RUB-102" },
							},
						},
						"repo-uuid-2": {
							"session-2": {
								issueId: "issue-uuid-2",
								issue: { identifier: "ABC-001" },
							},
						},
					},
				),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["RUB-*"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				"Cleared 2 cache entries.",
			);

			// Verify only ABC-001 remains
			const writtenContent = JSON.parse(mocks.mockWriteFile.mock.calls[0][1]);
			expect(writtenContent.state.issueRepositoryCache).toEqual({
				"issue-uuid-2": "repo-uuid-2",
			});
		});

		it("should match on issue UUID prefix when identifier is unknown", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile({
					"abc-123-uuid": "repo-uuid-1",
					"xyz-456-uuid": "repo-uuid-2",
				}),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["abc-*"]);

			expect(mockApp.logger.success).toHaveBeenCalledWith(
				"Cleared 1 cache entry.",
			);

			const writtenContent = JSON.parse(mocks.mockWriteFile.mock.calls[0][1]);
			expect(writtenContent.state.issueRepositoryCache).toEqual({
				"xyz-456-uuid": "repo-uuid-2",
			});
		});
	});

	describe("Error Handling", () => {
		it("should exit with error on invalid JSON", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue("invalid json{");

			await expect(command.execute(["*"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("should exit with error on unsupported state version", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				JSON.stringify({
					version: "1.0",
					savedAt: new Date().toISOString(),
					state: {},
				}),
			);

			await expect(command.execute(["*"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				"Unsupported state file version: 1.0. Expected 2.0",
			);
		});

		it("should exit with error when read fails", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockRejectedValue(new Error("Read error"));

			await expect(command.execute(["*"])).rejects.toThrow(
				"process.exit called",
			);
			expect(mockExit).toHaveBeenCalledWith(1);
		});
	});

	describe("State File Update", () => {
		it("should update savedAt timestamp when clearing entries", async () => {
			const originalDate = "2024-01-01T00:00:00.000Z";
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				JSON.stringify({
					version: "2.0",
					savedAt: originalDate,
					state: {
						issueRepositoryCache: { "issue-uuid-1": "repo-uuid-1" },
					},
				}),
			);
			mocks.mockWriteFile.mockResolvedValue(undefined);

			await command.execute(["*"]);

			const writtenContent = JSON.parse(mocks.mockWriteFile.mock.calls[0][1]);
			expect(writtenContent.savedAt).not.toBe(originalDate);
		});
	});
});
