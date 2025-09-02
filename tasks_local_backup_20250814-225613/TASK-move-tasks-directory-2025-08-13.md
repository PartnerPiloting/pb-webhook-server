# TASK: Move tasks Directory to Shared Location and Connect to All Environments

**Created:** August 13, 2025
**Owner:** (assign name)

## Description
Move the `tasks/` directory out of the main repo to a shared/global location (e.g. a dedicated docs repo or a central folder). Connect this shared directory to all development environments so everyone can access and update tasks from anywhere.

## Checklist
- [ ] Decide on shared location (e.g. new repo, network folder, cloud drive)
- [ ] Move/copy `tasks/` directory to shared location
- [ ] In each environment, connect to shared tasks directory:
    - Option 1: Git submodule (recommended for version control)
    - Option 2: Symlink/junction (for local-only setups)
    - Option 3: Cloud sync (e.g. Dropbox, OneDrive)
- [ ] Test editing and syncing tasks from each environment
- [ ] Document the workflow for team members

## Status
- Current status: Not started
- Last updated: August 13, 2025

## Notes
- See previous recommendations for submodule setup.
- Consider access control and backup for shared tasks.
