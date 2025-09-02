# Shared Tasks Submodule

This repository uses a Git submodule at `tasks/` to share task docs across projects/environments.

## Create/attach the shared repo
1) Create an empty repo for shared tasks, e.g. `PartnerPiloting/shared-tasks` (private is fine).
2) From this repo root, run the helper script to seed and attach:

```bash
bash ./scripts/setup-tasks-submodule.sh git@github.com:PartnerPiloting/shared-tasks.git --branch main
```

Notes:
- The script will seed the remote with your current `tasks/` content, back up the local folder, and add the submodule.
- If the remote already has content, append `--skip-seed`.

## Daily usage
- Pull latest: `git submodule update --init --recursive` then `git submodule foreach git pull`.
- Make edits inside `tasks/`, then commit and push from the submodule:
  - `cd tasks && git checkout main && git add -A && git commit -m "docs: update tasks" && git push`
  - `cd .. && git add tasks && git commit -m "chore: bump tasks submodule" && git push`

## Teammate instructions
When cloning the main repo:
```bash
git clone <main-repo-url>
cd pb-webhook-server
git submodule update --init --recursive
```
If already cloned:
```bash
git submodule update --init --recursive
```

## CI/CD
Ensure your pipelines run:
```bash
git submodule update --init --recursive
```
before build steps.

## Troubleshooting
- If tasks/ appears empty, verify the submodule remote and branch:
  - `.gitmodules` should list `path = tasks` and the correct `url`.
  - Run: `git submodule sync --recursive && git submodule update --init --recursive`.
