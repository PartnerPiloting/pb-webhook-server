param(
  [Parameter(Mandatory=$true)] [string]$RemoteUrl,
  [string]$Branch = "main",
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg){ Write-Host "==> $msg" -ForegroundColor Cyan }
function Ensure-Git(){ git --version | Out-Null }
function Ensure-AtRepoRoot(){ if (-not (Test-Path .git -PathType Container)){ throw "Run at repo root" } }
function Restore-KBIfMissing(){ if (-not (Test-Path kb -PathType Container)){ throw "kb/ not found" } }
function Copy-Dir($src,$dst){ New-Item -ItemType Directory -Force -Path $dst | Out-Null; Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue }
function Test-GitRemoteExists($name){ $remotes = git remote 2>$null; return $remotes -and ($remotes -split "\r?\n") -contains $name }

Ensure-Git; Ensure-AtRepoRoot; Restore-KBIfMissing
Write-Step "Remote: $RemoteUrl"; Write-Step "Branch: $Branch"; Write-Step ("Seed: " + ($(if($SkipSeed){'no'}else{'yes'})))

$seedDir = Join-Path $env:TEMP ('kb-seed-' + [guid]::NewGuid())
if (-not $SkipSeed){
  Write-Step "Seeding remote with current kb/ content"
  Copy-Dir 'kb' $seedDir
  Push-Location $seedDir
  if (-not (Test-Path .git)){ git init -b $Branch | Out-Null }
  if (Test-GitRemoteExists 'origin'){ git remote remove origin | Out-Null }
  git remote add origin $RemoteUrl
  git add -A
  $hasChanges = $(git diff --cached --quiet; if($LASTEXITCODE -eq 0){$false}else{$true})
  if ($hasChanges){ git commit -m "feat: seed shared kb from pb-webhook-server" | Out-Null; git push -u origin $Branch }
  Pop-Location; Remove-Item -Recurse -Force $seedDir
}

$backupName = 'kb_local_backup_' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Write-Step "Backing up kb/ to $backupName"; Rename-Item -Path kb -NewName $backupName
try { git rm -r --cached kb 2>$null | Out-Null } catch {}

Write-Step "Adding submodule at kb/"
if (Test-Path .gitmodules){ $paths = git config -f .gitmodules --get-regexp path 2>$null | ForEach-Object { ($_ -split '\s+')[1] }; if ($paths -contains 'kb'){ git submodule deinit -f kb 2>$null | Out-Null; Remove-Item -Recurse -Force .git\modules\kb -ErrorAction SilentlyContinue; git rm -f kb 2>$null | Out-Null } }

git submodule add -b $Branch $RemoteUrl kb

git submodule update --init --recursive

git add .gitmodules kb
try { git commit -m "chore: migrate kb folder to shared submodule ($RemoteUrl@$Branch)" | Out-Null } catch { Write-Step "(No changes to commit)" }

Write-Host "\nSuccess. Next steps:" -ForegroundColor Green
Write-Host "  1) git push" -ForegroundColor Green
Write-Host "  2) For teammates/CI: git submodule update --init --recursive" -ForegroundColor Green
