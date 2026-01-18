import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create mock functions that can be used in vi.mock
const mocks = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockReadFile: vi.fn(),
}));

// Mock modules
vi.mock("node:fs", () => ({
	existsSync: mocks.mockExistsSync,
}));

vi.mock("node:fs/promises", () => ({
	readFile: mocks.mockReadFile,
}));

vi.mock("node:path", () => ({
	join: vi.fn((...parts) => parts.join("/")),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
	throw new Error("process.exit called");
});

// Import after mocks
import { CacheListCommand } from "./CacheListCommand.js";

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

describe("CacheListCommand", () => {
	let mockApp: ReturnType<typeof createMockApp>;
	let command: CacheListCommand;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = createMockApp();
		command = new CacheListCommand(mockApp as any);
	});

	describe("No State File", () => {
		it("should report no cache file when state file does not exist", async () => {
			mocks.mockExistsSync.mockReturnValue(false);

			await command.execute([]);

			expect(mockApp.logger.info).toHaveBeenCalledWith("No cache file found.");
		});
	});

	describe("Empty Cache", () => {
		it("should report empty cache when no entries exist", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(createStateFile({}));

			await command.execute([]);

			expect(mockApp.logger.info).toHaveBeenCalledWith("Cache is empty.");
		});
	});

	describe("List Cache Entries", () => {
		it("should list cache entries with identifiers", async () => {
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

			await command.execute([]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				"Found 2 cached repository selections:\n",
			);
			expect(mockApp.logger.info).toHaveBeenCalledWith("  RUB-101");
			expect(mockApp.logger.info).toHaveBeenCalledWith("  RUB-102");
		});

		it("should show unknown identifier when session data is missing", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile({
					"issue-uuid-orphan": "repo-uuid-orphan",
				}),
			);

			await command.execute([]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				"  (unknown identifier)",
			);
		});

		it("should show usage hint for cache clear", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue(
				createStateFile({
					"issue-uuid-1": "repo-uuid-1",
				}),
			);

			await command.execute([]);

			expect(mockApp.logger.info).toHaveBeenCalledWith(
				'Use "cyrus cache clear <pattern>" to clear entries. Pattern can be:',
			);
			expect(mockApp.logger.info).toHaveBeenCalledWith(
				"  *         - Clear all entries",
			);
		});
	});

	describe("Error Handling", () => {
		it("should exit with error on invalid JSON", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockResolvedValue("invalid json{");

			await expect(command.execute([])).rejects.toThrow("process.exit called");
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

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockApp.logger.error).toHaveBeenCalledWith(
				"Unsupported state file version: 1.0. Expected 2.0",
			);
		});

		it("should exit with error when read fails", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFile.mockRejectedValue(new Error("Read error"));

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
		});
	});
});
