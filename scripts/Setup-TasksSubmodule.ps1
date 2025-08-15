param(
  [Parameter(Mandatory=$true)] [string]$RemoteUrl,
  [string]$Branch = "main",
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg){ Write-Host "==> $msg" -ForegroundColor Cyan }
function Ensure-Git(){
  Write-Step "Checking git"
  git --version | Out-Null
}
function Ensure-AtRepoRoot(){
  if (-not (Test-Path .git -PathType Container)){
    throw "Run this from the repository root (where .git exists)."
  }
}
function Restore-TasksIfMissing(){
  if (-not (Test-Path tasks -PathType Container)){
    $backup = Get-ChildItem -Directory -Filter 'tasks_local_backup_*' | Sort-Object Name | Select-Object -Last 1
    if ($null -eq $backup){ throw "tasks/ not found and no tasks_local_backup_* present." }
    Write-Step "Restoring tasks/ from $($backup.Name)"
    Rename-Item -Path $backup.FullName -NewName 'tasks'
  }
}
function Copy-Dir($src,$dst){
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-GitRemoteExists($name){
  $remotes = git remote 2>$null
  return $remotes -and ($remotes -split "\r?\n") -contains $name
}

Ensure-Git
Ensure-AtRepoRoot
Restore-TasksIfMissing

Write-Step "Remote: $RemoteUrl"
Write-Step "Branch: $Branch"
Write-Step ("Seed: " + ($(if($SkipSeed){'no'}else{'yes'})))

$seedDir = Join-Path $env:TEMP ('shared-tasks-seed-' + [guid]::NewGuid())
if (-not $SkipSeed){
  Write-Step "Seeding remote with current tasks/ content"
  Copy-Dir 'tasks' $seedDir
  Push-Location $seedDir
  if (-not (Test-Path .git)){ git init -b $Branch | Out-Null }
  if (Test-GitRemoteExists 'origin'){
    git remote remove origin | Out-Null
  }
  git remote add origin $RemoteUrl
  git add -A
  $hasChanges = $(git diff --cached --quiet; if($LASTEXITCODE -eq 0){$false}else{$true})
  if ($hasChanges){
    git commit -m "feat: seed shared tasks from pb-webhook-server" | Out-Null
    git push -u origin $Branch
  } else {
    Write-Step "Nothing to seed (tasks/ empty?)"
  }
  Pop-Location
  Remove-Item -Recurse -Force $seedDir
}

$backupName = 'tasks_local_backup_' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Write-Step "Backing up tasks/ to $backupName"
Rename-Item -Path tasks -NewName $backupName

# Ensure any previously tracked 'tasks' path is cleared from the index
try {
  git rm -r --cached tasks 2>$null | Out-Null
} catch { }

Write-Step "Adding submodule at tasks/"
# Clean any prior submodule entry
if (Test-Path .gitmodules){
  $paths = git config -f .gitmodules --get-regexp path 2>$null | ForEach-Object { ($_ -split '\s+')[1] }
  if ($paths -contains 'tasks'){
    git submodule deinit -f tasks 2>$null | Out-Null
    Remove-Item -Recurse -Force .git\modules\tasks -ErrorAction SilentlyContinue
    git rm -f tasks 2>$null | Out-Null
  }
}

git submodule add -b $Branch $RemoteUrl tasks

git submodule update --init --recursive

git add .gitmodules tasks

try {
  git commit -m "chore: migrate tasks folder to shared submodule ($RemoteUrl@$Branch)" | Out-Null
} catch {
  Write-Step "(No changes to commit)"
}

Write-Host "\nSuccess. Next steps:" -ForegroundColor Green
Write-Host "  1) git push" -ForegroundColor Green
Write-Host "  2) For teammates/CI: git submodule update --init --recursive" -ForegroundColor Green
