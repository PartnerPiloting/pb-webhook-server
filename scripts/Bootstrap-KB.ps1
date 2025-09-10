param(
  [string]$RepoOwner = 'PartnerPiloting',
  [string]$RepoName = 'shared-tech-docs',
  [ValidateSet('public','private','internal')][string]$Visibility = 'public',
  [string]$Branch = 'main',
  [string]$RemoteUrl,
  [switch]$AutoApply,
  [switch]$SkipMoves,
  [switch]$ForceContinueDirty
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg){ Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg){ Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Ensure-AtRepoRoot(){ if (-not (Test-Path .git -PathType Container)){ throw "Run at repo root" } }
function Ensure-Git(){ git --version | Out-Null }
function Ensure-Node(){ node --version | Out-Null }
function Get-GhExe(){
  # Prefer PATH resolution
  $cmd = (Get-Command gh -ErrorAction SilentlyContinue)
  if ($cmd) { return $cmd.Source }
  # Common install path
  $candidate = Join-Path ${env:ProgramFiles} 'GitHub CLI\gh.exe'
  if (Test-Path $candidate) { return $candidate }
  # Fallback hard-coded path
  if (Test-Path 'C:\Program Files\GitHub CLI\gh.exe') { return 'C:\Program Files\GitHub CLI\gh.exe' }
  return $null
}
function Has-GH(){ $exe = Get-GhExe; return -not [string]::IsNullOrWhiteSpace($exe) }
function WorkingTree-Clean(){
  $out = git status --porcelain 2>$null
  if ($LASTEXITCODE -ne 0) { return $true }
  return [string]::IsNullOrWhiteSpace($out)
}
function Backup-KB(){ $name = 'kb_local_backup_' + (Get-Date -Format 'yyyyMMdd-HHmmss'); if(Test-Path kb){ Write-Step "Backing up kb/ to $name"; Rename-Item -Path kb -NewName $name; return $name } return $null }
function Clear-KB-Index(){ try { git rm -r --cached kb 2>$null | Out-Null } catch {} }
function Deinit-KB(){ if(Test-Path .gitmodules){ $paths = git config -f .gitmodules --get-regexp path 2>$null | ForEach-Object { ($_ -split '\s+')[1] }; if ($paths -contains 'kb'){ Write-Step "Deinit previous kb submodule"; git submodule deinit -f kb 2>$null | Out-Null; Remove-Item -Recurse -Force .git\modules\kb -ErrorAction SilentlyContinue; git rm -f kb 2>$null | Out-Null } } }

Ensure-AtRepoRoot; Ensure-Git; Ensure-Node

Write-Step "Preflight checks"
if (-not (WorkingTree-Clean)) {
  if ($ForceContinueDirty) {
    Write-Warn "Working tree not clean, continuing due to -ForceContinueDirty."
  } else {
    Write-Warn "Working tree not clean. It's safer to commit/stash first."
    $cont = Read-Host "Continue anyway? (Y/N)"; if ($cont -notin @('Y','y')){ throw "Aborted by user" }
  }
}

$logDir = Join-Path (Get-Location) 'tools'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$reportJson = Join-Path $logDir 'classify-report.json'
$planJson = Join-Path $logDir 'move-plan.json'

Write-Step "Classifying docs (dry-run)"
node tools/classifyDocsDryRun.js --all --plan | Tee-Object -FilePath (Join-Path $logDir 'bootstrap-kb.log') -Append

if (-not (Test-Path $reportJson)) { Write-Warn "No report found at tools/classify-report.json (classifier may have failed)." } else {
  $report = Get-Content $reportJson -Raw | ConvertFrom-Json
  # PowerShell 5.1 compatibility: iterate PSCustomObject properties via PSObject.Properties
  $totalsArray = $report.summary.PSObject.Properties | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }
  $totals = ($totalsArray -join ', ')
  Write-Ok ("Totals: " + $totals)
}

if (Test-Path $planJson) {
  $plan = Get-Content $planJson -Raw | ConvertFrom-Json
  $moves = @($plan.items | Where-Object { $_.action -eq 'move' })
  Write-Step ("Proposed moves: " + $moves.Count)
  $moves | Select-Object -First 5 | ForEach-Object { Write-Host ("  - " + $_.src + " -> " + $_.dest) }
} else { Write-Warn "No move plan found." }

$apply = $false
if ($SkipMoves) {
  Write-Warn "Skipping file moves due to -SkipMoves"
} elseif ($AutoApply) {
  $apply = $true
  Write-Step "Auto-applying move plan due to -AutoApply"
} else {
  $resp = Read-Host "Apply the move plan now (docs only; tasks/ambiguous untouched)? (Y/N)"
  if ($resp -in @('Y','y')) { $apply = $true }
}

if ($apply) {
  Write-Step "Applying move plan"
  $backup = Backup-KB
  node tools/applyMovePlan.js | Tee-Object -FilePath (Join-Path $logDir 'bootstrap-kb.log') -Append
  Clear-KB-Index
} else {
  Write-Warn "Skipping file moves"
}

# Determine remote URL
if (-not $RemoteUrl) { $RemoteUrl = "https://github.com/$RepoOwner/$RepoName.git" }
Write-Step "Target remote: $RemoteUrl ($Visibility)"

# Ensure remote repo exists
if (Has-GH) {
  $gh = Get-GhExe
  $exists = $true
  try { & $gh repo view "$RepoOwner/$RepoName" 1>$null 2>$null } catch { $exists = $false }
  if (-not $exists) {
    Write-Step "Creating GitHub repo via gh: $RepoOwner/$RepoName ($Visibility)"
  $visFlag = ''
  if ($Visibility -eq 'public') { $visFlag = '--public' }
  elseif ($Visibility -eq 'private') { $visFlag = '--private' }
  else { $visFlag = '--internal' }
  & $gh repo create "$RepoOwner/$RepoName" $visFlag --disable-issues --disable-wiki --confirm
  } else { Write-Ok "Remote exists" }
} else {
  Write-Warn "gh CLI not found. Ensuring remote exists: $RemoteUrl"
  $remoteOk = $true
  try {
    git ls-remote $RemoteUrl 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) { $remoteOk = $false }
  } catch { $remoteOk = $false }
  if (-not $remoteOk) {
    throw "Remote does not exist or is inaccessible: $RemoteUrl. Create it first or install GitHub CLI (gh)."
  }
}

# Attach submodule using existing helper (handles seeding and clean add)
Write-Step "Attaching kb as submodule"
& scripts/Setup-KBSubmodule.ps1 -RemoteUrl $RemoteUrl -Branch $Branch

Write-Step "Verification"
if (Test-Path .gitmodules) { Write-Host (Get-Content .gitmodules | Out-String) }
Write-Host (git submodule status | Out-String)
Write-Host (git -C kb remote -v | Out-String)

Write-Ok "Done. Next steps:"
Write-Host "  1) Review changes (git status)" -ForegroundColor Green
Write-Host "  2) Commit and push kb repo if you made edits inside it" -ForegroundColor Green
Write-Host "  3) Commit and push parent repo to update the kb pointer" -ForegroundColor Green
