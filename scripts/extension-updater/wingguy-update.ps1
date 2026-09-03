<#
  Wingguy extension updater - Windows.

  WHY THIS EXISTS: every cloud-sync lane has a wall we hit in the field. OneDrive allows exactly
  ONE personal account per machine (Rick Wong's slot was taken by a family account, 2026-09-03);
  a work/M365 account cannot accept a share from a consumer account at all (Ashley Knowles,
  2026-08-20); Google Drive's streamed G: is not mounted when the browser launches, so the
  browser silently DELETES the extension (hit Guy twice, diagnosed 2026-08-25). This lane
  removes the cloud account entirely - a scheduled job pulls from the server into a fixed
  local folder.

  WHY IT SURVIVES: the folder is real local files on C:, so it exists before any browser starts;
  the path NEVER changes, so the extension keeps its identity and therefore its sign-in; files
  are written IN PLACE, so there is never a second copy; and a run that does nothing is the
  normal case, so it is safe to run every day forever.

  INSTALL (Guy does this once, over remote access - the client never runs anything):
    powershell -ExecutionPolicy Bypass -File wingguy-update.ps1 -Install -Server "https://pb-webhook-server.onrender.com" -Token "<their portal token>"

  Then load C:\Wingguy into the browser once (developer mode -> Load unpacked) and open their
  portal once in that browser to sign the extension in.

  AFTER THAT: the scheduled task runs daily and at logon, catching up if the machine was off.
  Ship a version and every machine collects it without anyone touching anything.
#>

[CmdletBinding()]
param(
  [switch]$Install,
  [string]$Server = "https://pb-webhook-server.onrender.com",
  [string]$Token,
  [string]$Folder = "C:\Wingguy",
  [switch]$Force,
  [string]$TaskName = "Wingguy Extension Update"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is far faster without the progress bar

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  try {
    $logDir = Join-Path $env:LOCALAPPDATA "Wingguy"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path (Join-Path $logDir "update.log") -Value $line -Encoding utf8
  } catch { }   # logging must never be the thing that fails a run
}

function Get-LocalVersion($folder) {
  $manifest = Join-Path $folder "manifest.json"
  if (-not (Test-Path $manifest)) { return $null }
  try { return (Get-Content $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

function Send-Checkin($server, $token, $payload) {
  # Monitoring only. A machine that stops checking in is the signal we want - but a failed
  # check-in must never fail the update itself.
  try {
    Invoke-RestMethod -Method Post -Uri "$server/extension/dist/checkin" -Headers @{ "x-portal-token" = $token } -ContentType "application/json" -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 20 | Out-Null
  } catch { Write-Log "check-in failed (ignored): $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- install ----
if ($Install) {
  if (-not $Token) { throw "-Token is required when installing" }

  Write-Log "Installing Wingguy updater -> $Folder"
  if (-not (Test-Path $Folder)) { New-Item -ItemType Directory -Path $Folder -Force | Out-Null }

  # Keep the script beside the folder so the scheduled task has a stable path to call, and so a
  # client who goes looking can see exactly what runs on their machine.
  $scriptHome = Join-Path $env:LOCALAPPDATA "Wingguy"
  if (-not (Test-Path $scriptHome)) { New-Item -ItemType Directory -Path $scriptHome -Force | Out-Null }
  $installedScript = Join-Path $scriptHome "wingguy-update.ps1"
  Copy-Item -Path $PSCommandPath -Destination $installedScript -Force

  # SCHEDULING: schtasks.exe, NOT Register-ScheduledTask.
  #
  # Register-ScheduledTask creates in Task Scheduler's ROOT folder, which needs elevation - it
  # failed with "Access is denied" on Guy's own machine in a normal PowerShell as himself
  # (2026-09-03). schtasks creates a task in the user's own context and works unelevated; proven
  # on that same machine minutes later. Do not switch back.
  #
  # A .cmd launcher carries the arguments so the /TR value is ONE quoted path with nothing to
  # escape. Building a /TR full of nested quotes is the classic way to get a task that registers
  # happily and then fails silently every night.
  $launcher = Join-Path $scriptHome "run-update.cmd"
  $launcherBody = @"
@echo off
rem Written by wingguy-update.ps1 -Install. Keeps the Wingguy browser extension up to date.
powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0wingguy-update.ps1" -Server "$Server" -Token "$Token" -Folder "$Folder"
"@
  Set-Content -Path $launcher -Value $launcherBody -Encoding ascii

  # THE DAILY RUN: schtasks, proven to work unelevated.
  $tr = '"' + $launcher + '"'
  schtasks /Create /TN $TaskName /TR $tr /SC DAILY /ST 03:00 /F | Out-Null
  schtasks /Query /TN $TaskName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the scheduled task '$TaskName'. The extension would never update itself. Check you are in a NORMAL (non-admin) PowerShell as the machine's own user, and that policy allows scheduled tasks."
  }
  Write-Log "Daily task '$TaskName' created and verified (3am)"

  # THE LOGIN RUN: the Startup folder, NOT schtasks /SC ONLOGON.
  #
  # ONLOGON was denied on Guy's own machine even though the DAILY task registered fine
  # (2026-09-03) - it wants rights a per-user daily task does not. The Startup folder needs no
  # permissions whatsoever, and it matters: schtasks cannot set "run as soon as possible after a
  # missed start", so without a login run a laptop that is shut at 3am would simply skip that day.
  #
  # A .vbs wrapper rather than the .cmd directly, so nothing flashes on screen at login.
  $startupDir = [Environment]::GetFolderPath('Startup')
  $startupFile = Join-Path $startupDir "Wingguy Extension Update.vbs"
  $vbs = 'CreateObject("WScript.Shell").Run """' + $launcher + '""", 0, False'
  $loginOk = $false
  try {
    Set-Content -Path $startupFile -Value $vbs -Encoding ascii -ErrorAction Stop
    $loginOk = Test-Path $startupFile
  } catch { $loginOk = $false }

  if ($loginOk) {
    Write-Log "Login run installed and verified (Startup folder)"
    Write-Log "SCHEDULED: daily at 3am, and again at login. Ready."
  } else {
    Write-Log "WARNING: the daily 3am task is in place, but the login run could not be installed."
    Write-Log "SCHEDULED: daily at 3am ONLY. A machine that is off at 3am will not catch up until the next 3am."
  }

  # Prove it works before walking away - the whole point of installing this in person.
  & $installedScript -Server $Server -Token $Token -Folder $Folder -Force
  Write-Log "Install complete. Now load $Folder into the browser (developer mode -> Load unpacked)."
  return
}

# ----------------------------------------------------------------- update ----
if (-not $Token) { throw "-Token is required" }

$machine = "$env:COMPUTERNAME"
$agent = "windows-ps"

try {
  $headers = @{ "x-portal-token" = $Token }
  $list = Invoke-RestMethod -Uri "$Server/extension/dist" -Headers $headers -TimeoutSec 60

  $remoteVersion = $list.version
  $localVersion = Get-LocalVersion $Folder
  if ($localVersion) { $shown = $localVersion } else { $shown = "none" }
  Write-Log "server=$remoteVersion local=$shown"

  if ($localVersion -eq $remoteVersion -and -not $Force) {
    Send-Checkin $Server $Token @{ version = $localVersion; action = "current"; agent = $agent; machine = $machine }
    Write-Log "Already current - nothing to do."
    return
  }

  # Download EVERYTHING to a staging folder first. Writing in place only starts once we know the
  # whole set arrived, so a dropped connection can never leave a half-updated extension.
  $staging = Join-Path $env:TEMP ("wingguy-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  try {
    foreach ($f in $list.files) {
      $dest = Join-Path $staging ($f.path -replace '/', '\')
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      $uri = "$Server/extension/dist/file?path=" + [uri]::EscapeDataString($f.path)
      Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $dest -TimeoutSec 60 -UseBasicParsing
      $got = (Get-Item $dest).Length
      if ($got -ne $f.bytes) { throw "size mismatch on $($f.path): got $got, expected $($f.bytes)" }
    }
    Write-Log "staged $($list.files.Count) file(s)"

    if (-not (Test-Path $Folder)) { New-Item -ItemType Directory -Path $Folder -Force | Out-Null }

    # manifest.json goes LAST and on its own. If anything interrupts the copy, the version on
    # disk still reads as the OLD one, so the next run simply tries again. Self-correcting.
    foreach ($f in $list.files) {
      if ($f.path -eq "manifest.json") { continue }
      $src = Join-Path $staging ($f.path -replace '/', '\')
      $dst = Join-Path $Folder ($f.path -replace '/', '\')
      $dstDir = Split-Path $dst -Parent
      if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
      Copy-Item -Path $src -Destination $dst -Force
    }
    Copy-Item -Path (Join-Path $staging "manifest.json") -Destination (Join-Path $Folder "manifest.json") -Force

    $now = Get-LocalVersion $Folder
    Write-Log "updated to $now"
    Send-Checkin $Server $Token @{ version = $now; action = "updated"; agent = $agent; machine = $machine }
  } finally {
    Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
} catch {
  $msg = $_.Exception.Message
  Write-Log "ERROR: $msg"
  Send-Checkin $Server $Token @{ version = (Get-LocalVersion $Folder); action = "error"; agent = $agent; machine = $machine; note = $msg }
  exit 1
}
