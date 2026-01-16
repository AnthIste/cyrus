import { describe, expect, it } from "vitest";
import {
	type EdgeConfig,
	migrateToWorkspaceCredentials,
	type RepositoryConfig,
	resolveCredentialsForRepository,
	type WorkspaceCredentials,
} from "../src/config-types.js";

describe("resolveCredentialsForRepository", () => {
	const baseRepo: RepositoryConfig = {
		id: "repo-1",
		name: "test-repo",
		repositoryPath: "/path/to/repo",
		baseBranch: "main",
		workspaceBaseDir: "/path/to/worktrees",
		linearWorkspaceId: "ws-123",
	};

	describe("workspace credentials as primary source", () => {
		it("should resolve credentials from workspaceCredentials when repo has no token", () => {
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "Test Workspace",
					linearToken: "workspace-token",
					linearRefreshToken: "workspace-refresh",
				},
			];

			const result = resolveCredentialsForRepository(
				baseRepo,
				workspaceCredentials,
			);

			expect(result.linearWorkspaceId).toBe("ws-123");
			expect(result.linearWorkspaceName).toBe("Test Workspace");
			expect(result.linearToken).toBe("workspace-token");
			expect(result.linearRefreshToken).toBe("workspace-refresh");
		});

		it("should prefer repo linearWorkspaceName over workspace credential name", () => {
			const repoWithName: RepositoryConfig = {
				...baseRepo,
				linearWorkspaceName: "Repo Custom Name",
			};
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "Workspace Name",
					linearToken: "workspace-token",
				},
			];

			const result = resolveCredentialsForRepository(
				repoWithName,
				workspaceCredentials,
			);

			expect(result.linearWorkspaceName).toBe("Repo Custom Name");
		});
	});

	describe("repository credentials as override", () => {
		it("should use repo-level credentials when linearToken is set", () => {
			const repoWithCredentials: RepositoryConfig = {
				...baseRepo,
				linearWorkspaceName: "Repo Workspace",
				linearToken: "repo-token",
				linearRefreshToken: "repo-refresh",
			};
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "Workspace Name",
					linearToken: "workspace-token",
					linearRefreshToken: "workspace-refresh",
				},
			];

			const result = resolveCredentialsForRepository(
				repoWithCredentials,
				workspaceCredentials,
			);

			expect(result.linearToken).toBe("repo-token");
			expect(result.linearRefreshToken).toBe("repo-refresh");
			expect(result.linearWorkspaceName).toBe("Repo Workspace");
		});

		it("should use repo credentials even when workspace credentials exist", () => {
			const repoWithToken: RepositoryConfig = {
				...baseRepo,
				linearToken: "override-token",
			};
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "ws-123",
					linearToken: "workspace-token",
				},
			];

			const result = resolveCredentialsForRepository(
				repoWithToken,
				workspaceCredentials,
			);

			expect(result.linearToken).toBe("override-token");
		});
	});

	describe("error handling", () => {
		it("should throw when no credentials found for workspace", () => {
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "different-workspace",
					linearToken: "other-token",
				},
			];

			expect(() =>
				resolveCredentialsForRepository(baseRepo, workspaceCredentials),
			).toThrow(/No credentials found for workspace ws-123/);
		});

		it("should throw when workspaceCredentials is undefined and repo has no token", () => {
			expect(() =>
				resolveCredentialsForRepository(baseRepo, undefined),
			).toThrow(/No credentials found for workspace ws-123/);
		});

		it("should throw when workspaceCredentials is empty and repo has no token", () => {
			expect(() => resolveCredentialsForRepository(baseRepo, [])).toThrow(
				/No credentials found for workspace ws-123/,
			);
		});
	});

	describe("multiple workspaces", () => {
		it("should resolve correct workspace from multiple credentials", () => {
			const workspaceCredentials: WorkspaceCredentials[] = [
				{
					linearWorkspaceId: "ws-111",
					linearToken: "token-111",
				},
				{
					linearWorkspaceId: "ws-123",
					linearToken: "token-123",
				},
				{
					linearWorkspaceId: "ws-222",
					linearToken: "token-222",
				},
			];

			const result = resolveCredentialsForRepository(
				baseRepo,
				workspaceCredentials,
			);

			expect(result.linearToken).toBe("token-123");
		});
	});
});

describe("migrateToWorkspaceCredentials", () => {
	it("should extract unique workspace credentials from repositories", () => {
		const config: EdgeConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "Workspace A",
					linearToken: "token-a",
					linearRefreshToken: "refresh-a",
				},
				{
					id: "repo-2",
					name: "Repo 2",
					repositoryPath: "/path/2",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-456",
					linearWorkspaceName: "Workspace B",
					linearToken: "token-b",
					linearRefreshToken: "refresh-b",
				},
			],
		};

		const migrated = migrateToWorkspaceCredentials(config);

		expect(migrated).toBe(true);
		expect(config.workspaceCredentials).toHaveLength(2);
		expect(config.workspaceCredentials).toContainEqual({
			linearWorkspaceId: "ws-123",
			linearWorkspaceName: "Workspace A",
			linearToken: "token-a",
			linearRefreshToken: "refresh-a",
		});
		expect(config.workspaceCredentials).toContainEqual({
			linearWorkspaceId: "ws-456",
			linearWorkspaceName: "Workspace B",
			linearToken: "token-b",
			linearRefreshToken: "refresh-b",
		});
	});

	it("should deduplicate repositories with same workspace", () => {
		const config: EdgeConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "Workspace A",
					linearToken: "token-a",
					linearRefreshToken: "refresh-a",
				},
				{
					id: "repo-2",
					name: "Repo 2",
					repositoryPath: "/path/2",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123", // Same workspace
					linearWorkspaceName: "Workspace A Updated", // Different name
					linearToken: "token-a-new", // Different token
				},
			],
		};

		const migrated = migrateToWorkspaceCredentials(config);

		expect(migrated).toBe(true);
		// Should only have one entry (first one wins)
		expect(config.workspaceCredentials).toHaveLength(1);
		expect(config.workspaceCredentials![0].linearToken).toBe("token-a");
	});

	it("should skip migration if workspaceCredentials already exists", () => {
		const config: EdgeConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123",
					linearToken: "token-from-repo",
				},
			],
			workspaceCredentials: [
				{
					linearWorkspaceId: "ws-existing",
					linearToken: "existing-token",
				},
			],
		};

		const migrated = migrateToWorkspaceCredentials(config);

		expect(migrated).toBe(false);
		// Should not modify existing workspaceCredentials
		expect(config.workspaceCredentials).toHaveLength(1);
		expect(config.workspaceCredentials![0].linearWorkspaceId).toBe(
			"ws-existing",
		);
	});

	it("should skip repositories without credentials", () => {
		const config: EdgeConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123",
					// No linearToken
				},
				{
					id: "repo-2",
					name: "Repo 2",
					repositoryPath: "/path/2",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-456",
					linearToken: "token-b",
				},
			],
		};

		const migrated = migrateToWorkspaceCredentials(config);

		expect(migrated).toBe(true);
		// Should only include repo-2 which has credentials
		expect(config.workspaceCredentials).toHaveLength(1);
		expect(config.workspaceCredentials![0].linearWorkspaceId).toBe("ws-456");
	});

	it("should return false when no credentials to migrate", () => {
		const config: EdgeConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					workspaceBaseDir: "/worktrees",
					linearWorkspaceId: "ws-123",
					// No linearToken
				},
			],
		};

		const migrated = migrateToWorkspaceCredentials(config);

		expect(migrated).toBe(false);
		expect(config.workspaceCredentials).toBeUndefined();
	});
});
