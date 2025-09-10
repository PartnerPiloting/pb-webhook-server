# TASK: Migrate `tasks/` to a Shared Repo and Link as Submodule

## Description
Create a dedicated shared repository for task docs, move existing task files into it, and link it back here as a Git submodule at `tasks/` so all environments (main/hotfix/staging/dev) see the same content.

## Checklist
- [ ] Create shared repo (e.g., `partnerpiloting/shared-tasks`)
- [ ] Seed it with current `tasks/*.md` from this repo
- [ ] Add as submodule here at `tasks/`
- [ ] Verify read/write from all local environments
- [ ] Document team usage (pull/update submodule)

## Implementation Steps (recommended: Git submodule)
1) Create the shared repo on your Git host (GitHub, GitLab): `partnerpiloting/shared-tasks` (private if needed).
2) Locally, clone it and seed with current files:
   - Copy `tasks/*.md` from this repo into the new repo
   - Commit and push (e.g., `feat: seed shared tasks from pb-webhook-server`)
3) In this repo, replace local tasks folder with the submodule:
   - Remove old files (keep folder path): commit cleanup
   - Add submodule at `tasks/`
4) Commit and push submodule update.

## Alternative (local-only): OS symlink
- Create a shared folder on disk/cloud drive; symlink `tasks/` here to that folder
- Note: brittle across different machines/OS/CIs; submodule preferred

## Status
- Current status: Not started

## Quick Start (copy/paste)
- Create the remote (example): PartnerPiloting/shared-tasks
- From repo root, run:
  - bash ./scripts/setup-tasks-submodule.sh git@github.com:PartnerPiloting/shared-tasks.git --branch main
- Commit/push the resulting changes (the script commits the submodule; just push):
  - git push
- Share teammate steps (see tasks/SUBMODULE-README.md)

## Notes
- Helper: scripts/setup-tasks-submodule.sh
- Docs: tasks/SUBMODULE-README.md
- Source: Conversation decision to make tasks globally accessible
- Access control: manage repo permissions on the shared tasks repo
- Backup: shared repo provides version history and recovery
