# Git & Azure DevOps Setup

Cyrus can use Azure DevOps Repos for source code management (branches and Pull Requests) while continuing to use Linear for issue tracking. This guide explains how to configure your system for Azure DevOps integration.

---

## Prerequisites

Before setting up Azure DevOps integration, ensure you have:
1. An Azure DevOps organization and project
2. A repository in Azure DevOps Repos
3. Git configured locally
4. Azure CLI installed

---

## Understanding Permissions

**Important:** Cyrus operates with the same permissions as your authenticated Azure DevOps user.

When Cyrus creates commits and PRs:
- All commits are attributed to your Git user (`git config user.name` and `user.email`)
- All PRs are created under your Azure DevOps account
- Your repository access permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

---

## Git Configuration

Configure Git with your identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Repository URL Configuration

For Azure DevOps, your repository URL format is:
```
https://dev.azure.com/{organization}/{project}/_git/{repository}
```

Or with SSH:
```
git@ssh.dev.azure.com:v3/{organization}/{project}/{repository}
```

---

## Azure CLI Setup

### Installation

**macOS:**
```bash
brew install azure-cli
```

**Linux (Debian/Ubuntu):**
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**Windows:**
```bash
winget install Microsoft.AzureCLI
```

**Other platforms:** See [Azure CLI Installation](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)

### Install Azure DevOps Extension

After installing Azure CLI, add the Azure DevOps extension:

```bash
az extension add --name azure-devops
```

### Authentication

**Option 1: Personal Access Token (Recommended for Automation)**

1. Create a PAT at: `https://dev.azure.com/{organization}/_usersSettings/tokens`

2. Required scopes:
   - **Code**: Read & Write
   - **Pull Request Threads**: Read & Write
   - **Build**: Read (optional, for CI status)

3. Set the environment variable:
   ```bash
   export AZURE_DEVOPS_EXT_PAT="your-pat-token"
   ```

   Or add to your shell profile (~/.bashrc, ~/.zshrc):
   ```bash
   echo 'export AZURE_DEVOPS_EXT_PAT="your-pat-token"' >> ~/.zshrc
   ```

**Option 2: Interactive Login**

```bash
az login
az devops configure --defaults organization=https://dev.azure.com/{organization} project={project}
```

### Configure Defaults (Optional)

Set default organization and project to simplify commands:

```bash
az devops configure --defaults \
  organization=https://dev.azure.com/{organization} \
  project={project}
```

### Verify Setup

```bash
# Check Azure CLI auth
az account show

# Check DevOps extension
az devops project show --project {project}

# List repositories
az repos list --output table
```

---

## Cyrus Configuration

Add Azure DevOps configuration to your repository in your Cyrus config file:

```json
{
  "repositories": [
    {
      "id": "my-azure-repo",
      "name": "My Azure Repository",
      "repositoryPath": "/path/to/local/repo",
      "baseBranch": "main",
      "vcsType": "azure-devops",
      "repoUrl": "https://dev.azure.com/myorg/MyProject/_git/my-repo",
      "azureDevOps": {
        "organization": "myorg",
        "project": "MyProject",
        "repository": "my-repo"
      },
      "linearWorkspaceId": "...",
      "linearToken": "...",
      "workspaceBaseDir": "~/.cyrus/myorg/workspaces"
    }
  ]
}
```

### Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `vcsType` | Yes | Set to `"azure-devops"` |
| `repoUrl` | Recommended | Full Azure DevOps repository URL |
| `azureDevOps.organization` | Yes | Azure DevOps organization name |
| `azureDevOps.project` | Yes | Azure DevOps project name |
| `azureDevOps.repository` | Yes | Repository name |

---

## Azure DevOps CLI Commands Reference

Cyrus uses the following Azure CLI commands for PR operations:

### Create Draft PR
```bash
az repos pr create \
  --draft true \
  --title "WIP: Feature description" \
  --description "Work in progress..." \
  --source-branch "feature/my-branch"
```

### Update PR
```bash
az repos pr update \
  --id {pr-id} \
  --title "Final title" \
  --description "Full description..."
```

### Mark PR as Ready
```bash
az repos pr update --id {pr-id} --draft false
```

### View PR Details
```bash
az repos pr show --id {pr-id} --output json
```

### List PRs
```bash
az repos pr list --source-branch "feature/my-branch" --output json
```

---

## Troubleshooting

### "The resource could not be found"
- Verify your organization, project, and repository names are correct
- Check that your PAT has the required scopes
- Ensure the repository exists and you have access

### "Authentication failed"
- Regenerate your Personal Access Token
- Check that AZURE_DEVOPS_EXT_PAT is set correctly
- Try `az login` for interactive authentication

### "Branch not found"
- Ensure you've pushed your local branch: `git push -u origin HEAD`
- Check that the branch name matches exactly

### PR Creation Fails
- Verify branch protection policies allow PR creation
- Check that your account has permission to create PRs
- Ensure the source branch has commits not in the target branch

---

## Security Considerations

- **Use a dedicated PAT** with minimal required scopes
- **Don't commit PAT tokens** to version control
- **Rotate tokens regularly** (Azure DevOps recommends every 90 days)
- **Use repository-specific tokens** if possible
- **Review PR permissions** in project settings
- **Audit commits** - all Cyrus commits include the "Co-Authored-By" trailer for traceability

---

## Additional Resources

- [Azure DevOps CLI Documentation](https://learn.microsoft.com/en-us/cli/azure/devops)
- [Azure Repos PR Commands](https://learn.microsoft.com/en-us/cli/azure/repos/pr)
- [Create a Personal Access Token](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
