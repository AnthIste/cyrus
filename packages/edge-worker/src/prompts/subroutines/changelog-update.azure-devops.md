# Azure DevOps PR Create - Draft Pull Request Creation

All verification checks have passed. Now create a draft pull request in Azure DevOps and update the changelog if the project uses one.

## Azure DevOps Context

**IMPORTANT:** Extract the organization, project, and repository from the `<azure_devops>` context in your system prompt. You MUST pass these to all `az repos` commands:

```
--organization https://dev.azure.com/{organization} --project {project}
```

For example, if your context shows:
```xml
<azure_devops>
  <organization>myorg</organization>
  <project>MyProject</project>
  <repository>my-repo</repository>
</azure_devops>
```

Then use: `--organization https://dev.azure.com/myorg --project MyProject`

## Your Tasks

### 1. Push Current Branch
First, push the current branch to the remote:

```bash
# Push the branch to remote
git push -u origin HEAD
```

### 2. Create Draft PR in Azure DevOps
Check if a PR already exists, if not create a draft PR:

```bash
# Check if PR already exists for this branch
az repos pr list \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --repository {repository} \
  --source-branch "$(git branch --show-current)" \
  --status active \
  --output json

# If no PR exists, create a draft PR
az repos pr create \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --repository {repository} \
  --draft true \
  --title "WIP: [brief description]" \
  --description "Work in progress for [ISSUE-ID]. Full description to follow." \
  --source-branch "$(git branch --show-current)" \
  --output json
```

If a PR already exists, get its details:
```bash
az repos pr show \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --id <PR_ID> \
  --output json
```

Record the PR URL and ID for use in the changelog entry.

**Note:** The PR URL format for Azure DevOps is:
`https://dev.azure.com/{organization}/{project}/_git/{repository}/pullrequest/{prId}`

### 3. Check for Changelog Files
Check if the project has changelog files:
```bash
ls -la CHANGELOG.md CHANGELOG.internal.md 2>/dev/null || echo "NO_CHANGELOG"
```

**If no changelog files exist, complete with:** `Draft PR created at [PR URL]. No changelog files found.`

### 4. Check for Existing Changelog Entry
If changelog files exist, check if there's already a changelog entry for this issue:
- Look in the `## [Unreleased]` section for entries mentioning the current Linear issue identifier
- If an entry already exists for this issue, you may update it to add the PR link, but do NOT add duplicate entries

### 5. Update Changelog with PR Link
If changelog files exist and no entry exists (or entry needs PR link):

**For user-facing changes (CHANGELOG.md):**
- Add entry under `## [Unreleased]` in the appropriate subsection (`### Added`, `### Changed`, `### Fixed`, `### Removed`)
- Focus on end-user impact from the perspective of users running the CLI
- Be concise but descriptive about what users will experience differently
- Include both the Linear issue identifier AND the PR link
- Format: `- **Feature name** - Description. ([ISSUE-ID](https://linear.app/...), [PR #NUMBER](PR_URL))`

**For internal/technical changes (CHANGELOG.internal.md):**
- Add entry if the changes are internal development, refactors, or tooling updates
- Follow the same format as CHANGELOG.md

## Important Notes

- **Create draft PR first** - this gives you the PR ID to include in the changelog
- **Only update changelogs if they exist** - not all projects use changelogs
- **Avoid duplicate entries** - check if an entry already exists for this issue before adding
- **Follow Keep a Changelog format** - https://keepachangelog.com/
- **Group related changes** - consolidate multiple commits into a single meaningful entry
- **Do NOT commit or push the changelog changes** - that happens in the next subroutine
- Take as many turns as needed to complete these tasks

## Azure DevOps CLI Reference

Key commands you may need:
- `az repos pr list` - List pull requests
- `az repos pr create` - Create a new pull request
- `az repos pr show` - Get details of a pull request
- `az repos pr update` - Update a pull request

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max):

```
Draft PR created at [PR URL]. Changelog updated for [ISSUE-ID].
```

Or if no changelog exists:

```
Draft PR created at [PR URL]. No changelog files found.
```

Or if entry already existed:

```
Draft PR created at [PR URL]. Changelog entry already exists for this issue.
```
