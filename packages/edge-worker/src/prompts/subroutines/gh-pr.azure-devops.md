# Azure DevOps PR Finalize - Pull Request Management

A draft PR exists and all changes have been committed and pushed. Now update the PR with a full description and mark it as ready for review.

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

### 1. Get PR Information
First, get the current PR details:
```bash
# List PRs for current branch
az repos pr list \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --repository {repository} \
  --source-branch "$(git branch --show-current)" \
  --status active \
  --output json
```

Extract the PR ID and URL from the output.

### 2. Update PR with Full Description
Update the PR with a comprehensive description:
```bash
az repos pr update \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --id <PR_ID> \
  --title "[descriptive title]" \
  --description "[full description in markdown]"
```

The PR description should include:
- Summary of changes
- Implementation approach
- Testing performed
- Any breaking changes or migration notes
- Link to the Linear issue

Ensure the PR has a clear, descriptive title (remove "WIP:" prefix if present).

### 3. Mark PR as Ready for Review
Convert the draft PR to ready for review:
```bash
az repos pr update \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --id <PR_ID> \
  --draft false
```

Unless the project instructions specify to keep it as draft, or the user has requested it remain as draft.

### 4. Final Checks
- Confirm the PR URL is valid and accessible
- Verify all commits are included in the PR
- Check that CI/CD pipelines start running (if applicable)

You can verify the PR status:
```bash
az repos pr show \
  --organization https://dev.azure.com/{organization} \
  --project {project} \
  --id <PR_ID> \
  --output json
```

## Important Notes

- **A draft PR already exists** - you're updating it and marking it ready
- **All commits are pushed** - the changelog already includes the PR link
- **Be thorough with the PR description** - it should be self-contained and informative
- **Verify the correct base branch** - ensure PR targets the right base branch
- Take as many turns as needed to complete these tasks

## Azure DevOps CLI Reference

Key commands you may need:
- `az repos pr show --organization {org} --project {proj} --id <id>` - Get PR details
- `az repos pr update --organization {org} --project {proj} --id <id> --title "..." --description "..."` - Update PR
- `az repos pr update --organization {org} --project {proj} --id <id> --draft false` - Mark PR as ready
- `az repos pr list --organization {org} --project {proj} --source-branch "branch-name"` - Find PR by branch

## Expected Output

**IMPORTANT: Do NOT post Linear comments.** Your output is for internal workflow only.

Provide a brief completion message (1 sentence max) that includes the PR URL:

```
PR ready at [PR URL].
```

Example: "PR ready at https://dev.azure.com/myorg/MyProject/_git/my-repo/pullrequest/123."
