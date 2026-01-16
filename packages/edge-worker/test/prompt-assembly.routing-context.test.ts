/**
 * Prompt Assembly Tests - Routing Context Generation
 *
 * Tests the routing context generation for orchestrator multi-repository scenarios.
 *
 * IMPORTANT: These tests assert the ENTIRE prompt, not partial checks with .toContain().
 * This ensures comprehensive test coverage and catches regressions in prompt structure.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Routing Context", () => {
	it("should not include routing context for single-repository setup", async () => {
		const repository = {
			id: "repo-single-123",
			name: "Single Repo",
			repositoryPath: "/test/single-repo",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-1",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/single-repo",
			routingLabels: ["backend"],
			teamKeys: ["BACK"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([repository]);

		const session = {
			issueId: "issue-123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-123",
			identifier: "BACK-100",
			title: "Single repo orchestration",
			description: "Test issue",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Orchestrate this task")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Single Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-123</id>
<identifier>BACK-100</identifier>
<title>Single repo orchestration</title>
<description>Test issue</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Orchestrate this task
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should include routing context for multi-repository setup", async () => {
		const frontendRepo = {
			id: "repo-frontend-123",
			name: "Frontend App",
			repositoryPath: "/test/frontend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/myorg/frontend-app",
			routingLabels: ["frontend", "ui"],
			teamKeys: ["FE"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const backendRepo = {
			id: "repo-backend-456",
			name: "Backend API",
			repositoryPath: "/test/backend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/myorg/backend-api",
			routingLabels: ["backend", "api"],
			teamKeys: ["BE"],
			projectKeys: ["API Project"],
		};

		const worker = createTestWorker([frontendRepo, backendRepo]);

		const session = {
			issueId: "issue-456",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-456",
			identifier: "FE-200",
			title: "Cross-repo feature",
			description: "Add feature spanning frontend and backend",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(frontendRepo)
			.withUserComment("Orchestrate this cross-repo feature")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Frontend App</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-456</id>
<identifier>FE-200</identifier>
<title>Cross-repo feature</title>
<description>Add feature spanning frontend and backend</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
When creating sub-issues that should be handled in a DIFFERENT repository, use one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="Frontend App" (current)>
    <vcs_type>github</vcs_type>
    <repo_url>https://github.com/myorg/frontend-app</repo_url>
    <github_url>https://github.com/myorg/frontend-app</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/frontend-app]\` to sub-issue description
    - Routing labels: "frontend", "ui"
    - Team keys: "FE" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Backend API">
    <vcs_type>github</vcs_type>
    <repo_url>https://github.com/myorg/backend-api</repo_url>
    <github_url>https://github.com/myorg/backend-api</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/backend-api]\` to sub-issue description
    - Routing labels: "backend", "api"
    - Team keys: "BE" (create issue in this team)
    - Project keys: "API Project" (add issue to this project)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate this cross-repo feature
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should exclude inactive repositories from routing context", async () => {
		const activeRepo = {
			id: "repo-active-123",
			name: "Active Repo",
			repositoryPath: "/test/active",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/active-repo",
			isActive: true,
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const inactiveRepo = {
			id: "repo-inactive-456",
			name: "Inactive Repo",
			repositoryPath: "/test/inactive",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/org/inactive-repo",
			isActive: false,
		};

		const worker = createTestWorker([activeRepo, inactiveRepo]);

		const session = {
			issueId: "issue-789",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-789",
			identifier: "TEST-300",
			title: "Test inactive filtering",
			description: "Should not show inactive repo",
		};

		// Only one active repo means no routing context (same as single-repo case)
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(activeRepo)
			.withUserComment("Check routing context")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Active Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-789</id>
<identifier>TEST-300</identifier>
<title>Test inactive filtering</title>
<description>Should not show inactive repo</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check routing context
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should only include repositories from the same workspace", async () => {
		const workspace1Repo = {
			id: "repo-ws1-123",
			name: "Workspace 1 Repo",
			repositoryPath: "/test/ws1",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-repo",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2Repo = {
			id: "repo-ws2-456",
			name: "Workspace 2 Repo",
			repositoryPath: "/test/ws2",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",
			linearToken: "test-token-456",
			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-repo",
		};

		const worker = createTestWorker([workspace1Repo, workspace2Repo]);

		const session = {
			issueId: "issue-999",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-999",
			identifier: "WS1-100",
			title: "Workspace isolation test",
			description: "Should not show other workspace repos",
		};

		// Only one repo in this workspace means no routing context
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(workspace1Repo)
			.withUserComment("Check workspace isolation")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Workspace 1 Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-999</id>
<identifier>WS1-100</identifier>
<title>Workspace isolation test</title>
<description>Should not show other workspace repos</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check workspace isolation
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should include Azure DevOps context for azure-devops repositories", async () => {
		const githubRepo = {
			id: "repo-github-123",
			name: "GitHub Repo",
			repositoryPath: "/test/github",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-ado",
			linearToken: "test-token-123",
			baseBranch: "main",
			githubUrl: "https://github.com/myorg/github-repo",
			routingLabels: ["github"],
			teamKeys: ["GH"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const azureRepo = {
			id: "repo-azure-456",
			name: "Azure Repo",
			repositoryPath: "/test/azure",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-ado",
			linearToken: "test-token-456",
			baseBranch: "main",
			vcsType: "azure-devops" as const,
			repoUrl: "https://dev.azure.com/myorg/MyProject/_git/azure-repo",
			azureDevOps: {
				organization: "myorg",
				project: "MyProject",
				repository: "azure-repo",
			},
			routingLabels: ["azure"],
			teamKeys: ["AZ"],
		};

		const worker = createTestWorker([githubRepo, azureRepo]);

		const session = {
			issueId: "issue-ado",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-ado",
			identifier: "GH-100",
			title: "Cross-platform feature",
			description: "Feature spanning GitHub and Azure DevOps",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(githubRepo)
			.withUserComment("Orchestrate this cross-platform feature")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>GitHub Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-ado</id>
<identifier>GH-100</identifier>
<title>Cross-platform feature</title>
<description>Feature spanning GitHub and Azure DevOps</description>
<url></url>
<assignee>
<id></id>
<name></name>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
When creating sub-issues that should be handled in a DIFFERENT repository, use one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=org/repo-name]\` or \`[repo=repo-name]\` to the sub-issue description. This is the most explicit and reliable method.
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.
</description>

<available_repositories>
  <repository name="GitHub Repo" (current)>
    <vcs_type>github</vcs_type>
    <repo_url>https://github.com/myorg/github-repo</repo_url>
    <github_url>https://github.com/myorg/github-repo</github_url>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/github-repo]\` to sub-issue description
    - Routing labels: "github"
    - Team keys: "GH" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Azure Repo">
    <vcs_type>azure-devops</vcs_type>
    <repo_url>https://dev.azure.com/myorg/MyProject/_git/azure-repo</repo_url>
    <azure_devops>
      <organization>myorg</organization>
      <project>MyProject</project>
      <repository>azure-repo</repository>
    </azure_devops>
    <routing_methods>
    - Description tag: Add \`[repo=myorg/MyProject/_git/azure-repo]\` to sub-issue description
    - Routing labels: "azure"
    - Team keys: "AZ" (create issue in this team)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate this cross-platform feature
</user_comment>`)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});
});
