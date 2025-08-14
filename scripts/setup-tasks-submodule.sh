#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL=""
BRANCH="main"
SEED="yes"

usage() {
  echo "Usage: $0 <remote-url> [--branch <branch>] [--skip-seed]" >&2
  echo "  remote-url   Git URL of the shared tasks repo (e.g., git@github.com:PartnerPiloting/shared-tasks.git)" >&2
  echo "  --branch     Submodule branch to track (default: main)" >&2
  echo "  --skip-seed  Skip seeding the remote with current tasks/ content" >&2
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" || ${#} -lt 1 ]]; then
  usage
  exit 1
fi

REMOTE_URL="$1"; shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="${2:-main}"; shift 2;;
    --skip-seed)
      SEED="no"; shift;;
    *)
      echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed or not in PATH" >&2
  exit 1
fi

if [[ ! -d "tasks" ]]; then
  echo "Error: tasks/ directory not found at repo root." >&2
  exit 1
fi

# Ensure we are at repo root (contains .git)
if [[ ! -d ".git" ]]; then
  echo "Error: Run this script from the repository root (where .git exists)." >&2
  exit 1
fi

echo "==> Remote: $REMOTE_URL"
echo "==> Branch: $BRANCH"
echo "==> Seed remote: $SEED"

# Optional: prompt if working tree is dirty
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Warning: You have uncommitted changes. It's recommended to commit or stash before proceeding." >&2
  read -p "Continue anyway? [y/N] " -r REPLY
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."; exit 1
  fi
fi

TEMP_DIR=".tmp-shared-tasks-init"
BACKUP_DIR="tasks_local_backup_$(date +%Y%m%d-%H%M%S)"

if [[ "$SEED" == "yes" ]]; then
  echo "==> Seeding remote with current tasks/ content..."
  rm -rf "$TEMP_DIR"
  mkdir -p "$TEMP_DIR"
  # Copy tasks content into temp dir
  # Exclude potential nested repos
  rsync -a --exclude ".git" tasks/ "$TEMP_DIR"/

  pushd "$TEMP_DIR" >/dev/null
  git init -b "$BRANCH"
  git remote add origin "$REMOTE_URL"
  git add .
  git commit -m "feat: seed shared tasks from pb-webhook-server"
  # Requires that your git auth is configured for this remote
  git push -u origin "$BRANCH"
  popd >/dev/null

  rm -rf "$TEMP_DIR"
else
  echo "==> Skipping remote seeding (assuming remote already contains tasks)."
fi

echo "==> Backing up local tasks/ to $BACKUP_DIR"
mv tasks "$BACKUP_DIR"

echo "==> Adding submodule at tasks/"
git submodule add -b "$BRANCH" "$REMOTE_URL" tasks
git submodule update --init --recursive

echo "==> Verifying submodule content..."
if [[ ! -f "tasks/README.md" && ! -f "tasks/.git" ]]; then
  echo "Note: tasks/ appears empty; ensure the remote branch ($BRANCH) has content." >&2
fi

echo "==> Staging submodule config and tasks/"
git add .gitmodules tasks

echo "==> Committing submodule migration"
git commit -m "chore: migrate tasks folder to shared submodule ($REMOTE_URL@$BRANCH)"

echo "==> Cleanup: removing backup folder (already preserved by git history): $BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "Done. Next: push changes (including .gitmodules) and share submodule update instructions with the team."
