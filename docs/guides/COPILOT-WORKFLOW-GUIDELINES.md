# GitHub Copilot Workflow Guidelines

## Code Change & Commit Process

### Step 1: Gather ALL Changes
Before committing anything, all changes across all files must be collected and presented.

### Step 2: Present "Changes Summary"
When ready to commit, show a complete summary including:
- All modified files
- Summary of changes per file
- Reason/justification for each change
- Expected impact

Example format:
```
Changes to be committed:

1. File: postBatchScorer.js
   - Removed conflicting filter formula
   - Added post content validation
   - Reason: Fixes post scoring selection issues

2. File: apiAndJobRoutes.js
   - Changed getAllActiveClients to getActiveClientsByStream
   - Reason: Ensures lead scoring uses the correct function

3. File: clientService.js
   - Added null clientId handling
   - Reason: Prevents crashes on global operations
```

### Step 3: Request Explicit Approval
Ask for explicit approval of the complete set of changes.

### Step 4: Use Single Logical Commits
Group related changes into a single logical commit unless there's a specific reason for separate commits.

### Step 5: Verify After Commit
Show the result of `git status` after committing to verify nothing was missed.

## When Asking for Commits

When asking Copilot to commit changes, use the phrase:

> "Please show me ALL changes before committing"

This will remind Copilot to follow this workflow.

## Safety Commands

These special instructions can be used at any time:

- **"Show all modified files"** - Get a list of all files with uncommitted changes
- **"Summarize all changes"** - Get a detailed summary of all modifications
- **"Status check"** - Run git status and show the results

## Never:
- Commit changes without showing all modifications first
- Split related changes across multiple commits without explanation
- Push without verifying all changes were committed

Last updated: September 22, 2025