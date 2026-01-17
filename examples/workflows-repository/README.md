# Example Workflows Repository

This directory contains an example workflows repository structure that can be used as a reference for creating custom Cyrus workflows.

## Directory Structure

```
workflows-repository/
├── README.md                    # This file
└── workflows/
    ├── workflows.yaml           # Workflow definitions (YAML)
    └── prompts/                 # Prompt files referenced by workflows
        ├── coding-activity.md
        ├── verifications.md
        ├── changelog-update.md
        ├── git-commit.md
        ├── gh-pr.md
        ├── concise-summary.md
        ├── debugger-reproduction.md
        ├── get-approval.md
        ├── debugger-fix.md
        ├── question-investigation.md
        ├── question-answer.md
        ├── primary.md
        ├── security-analysis.md
        └── security-report.md
```

## Usage

### Option 1: Local Path

Configure Cyrus to use this directory as a local workflow source:

```json
{
  "workflowsRepository": {
    "source": "/path/to/examples/workflows-repository",
    "path": "workflows/"
  }
}
```

### Option 2: Git Repository

Host these files in a Git repository and configure:

```json
{
  "workflowsRepository": {
    "source": "git@github.com:your-org/your-workflows-repo.git",
    "branch": "main",
    "path": "workflows/"
  }
}
```

## Testing the Workflows

After configuring the workflow source, use the CLI to verify:

```bash
# List all workflows (built-in + external)
cyrus workflows list

# Validate the workflow YAML
cyrus workflows validate ./examples/workflows-repository/workflows/

# Show details of a specific workflow
cyrus workflows show full-development

# Test workflow resolution
cyrus workflows resolve "Add a new feature" --labels feature
```

## Workflow Schema

Workflow files must follow the schema defined in `packages/edge-worker/src/workflows/workflow-schema.json`.

Key elements:
- **name**: Unique identifier (lowercase, kebab-case)
- **description**: Human-readable description
- **triggers**: Optional routing configuration (classifications, labels, keywords, examples)
- **priority**: Higher priority workflows are preferred when multiple match
- **subroutines**: Ordered list of steps to execute

Each subroutine can have:
- **name**: Unique identifier
- **prompt_file**: Path to markdown prompt file (relative to workflows directory)
- **description**: What this step does
- **single_turn**: Run in single-turn mode (no tools)
- **validation_loop**: Enable retry logic
- **disallow_tools**: Disable all tool usage
- **requires_approval**: Pause for user approval

## Customization

1. Copy this directory to your own repository
2. Modify `workflows.yaml` to define your custom workflows
3. Edit or add prompt files in the `prompts/` directory
4. Update your Cyrus configuration to point to your repository
