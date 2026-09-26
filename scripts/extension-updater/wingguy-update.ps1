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

  AFTER THAT: the scheduled task runs hourly and at logon, catching up if the machine was off.
  Ship a version and every machine collects it without anyone touching anything.
#>

[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
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

# THE CADENCE, in one place. Bump the tag whenever the schedule below changes and every machine
# re-registers itself on its next run - see Set-UpdateSchedule.
$script:CadenceTag = "hourly-1"

# THE UPDATER'S OWN VERSION. Bump it whenever this file changes: every installed copy compares it
# with the one the server holds on each run and replaces itself when they differ (Update-Self).
# Before 2026-09-26 an installed copy never changed, so improvements only reached machines that
# were re-installed by hand.
$script:UpdaterVersion = "2026-09-26.1"

# Extra fields for this run's check-in (the machine icon step fills them in).
$script:CheckinExtra = @{}

function Set-UpdateSchedule($scriptHome, $taskName) {
  # WHY HOURLY AND NOT DAILY (Guy, 2026-09-17). It was daily at 3am plus a login run. That is fine
  # for a machine that gets shut at night - it catches up at login - but Guy's own PC stays logged
  # in for days, so 3am was his ONLY trigger. A fix that went live at 07:46 was still not in his
  # browser when he went to test it. A run where nothing has changed is one small request and an
  # immediate exit, so asking twenty times a day costs nothing and turns a 24-hour worst case into
  # an hour. The login run stays: it covers a laptop that was off for the last few hours.
  #
  # There is deliberately no push. Nothing can reach a client's laptop when it is asleep or behind
  # their home router, so the only real question was ever how often the machine asks.
  $launcher = Join-Path $scriptHome "run-update.cmd"
  if (-not (Test-Path $launcher)) { return $false }   # not an installed machine; nothing to schedule
  $tr = '"' + $launcher + '"'
  # /SC HOURLY /MO 1 = every hour, from $st onward. A few minutes past the hour rather than on it.
  schtasks /Create /TN $taskName /TR $tr /SC HOURLY /MO 1 /ST 00:05 /F | Out-Null
  schtasks /Query /TN $taskName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  Set-Content -Path (Join-Path $scriptHome "schedule.tag") -Value $script:CadenceTag -Encoding ascii
  return $true
}

function Sync-UpdateSchedule($taskName) {
  # SELF-HEAL, so a cadence change reaches machines already in the field without visiting any of
  # them: each one re-registers its own task on its next run and is on the new schedule from then
  # on. Guarded by a tag file so the normal case is a single file read and nothing else, and
  # wrapped so a scheduling failure can never cost the update itself - the old schedule simply
  # stays, which is the safe direction.
  try {
    $scriptHome = Join-Path $env:LOCALAPPDATA "Wingguy"
    $tagFile = Join-Path $scriptHome "schedule.tag"
    if ((Test-Path $tagFile) -and ((Get-Content $tagFile -Raw).Trim() -eq $script:CadenceTag)) { return }
    if (Set-UpdateSchedule $scriptHome $taskName) {
      Write-Log "Schedule moved to $($script:CadenceTag) (every hour, plus the login run)."
    }
  } catch {
    Write-Log "Could not update the schedule (continuing on the old one): $($_.Exception.Message)"
  }
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
    foreach ($k in $script:CheckinExtra.Keys) { $payload[$k] = $script:CheckinExtra[$k] }
    $payload["updater"] = $script:UpdaterVersion
    Invoke-RestMethod -Method Post -Uri "$server/extension/dist/checkin" -Headers @{ "x-portal-token" = $token } -ContentType "application/json" -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 20 | Out-Null
  } catch { Write-Log "check-in failed (ignored): $($_.Exception.Message)" }
}

function Update-Self($server, $headers, $wanted) {
  # SELF-UPDATE (2026-09-26). The server says which updater version it holds; when that differs
  # from this copy, fetch it, prove it is a complete, parseable PowerShell script carrying that
  # version, and only then write it over the installed copy. It takes effect on the NEXT run -
  # this run carries on as it started. Wrapped so a failure can never cost the extension update:
  # the old copy simply stays, which is the safe direction.
  try {
    if (-not $wanted -or $wanted -eq $script:UpdaterVersion) { return }
    $installed = Join-Path (Join-Path $env:LOCALAPPDATA "Wingguy") "wingguy-update.ps1"
    if ($PSCommandPath -ne $installed) { return }   # a one-off run from elsewhere never rewrites the install
    $tmp = Join-Path $env:TEMP ("wingguy-update-" + [guid]::NewGuid().ToString("N") + ".ps1")
    Invoke-WebRequest -Uri "$server/extension/dist/installer" -Headers $headers -OutFile $tmp -TimeoutSec 60 -UseBasicParsing
    $body = Get-Content $tmp -Raw
    $errs = $null
    [System.Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$errs) | Out-Null
    if ($errs -and $errs.Count -gt 0) { throw "downloaded updater does not parse ($($errs.Count) error(s))" }
    if ($body -notmatch [regex]::Escape('$script:UpdaterVersion = "' + $wanted + '"')) { throw "downloaded updater is not version $wanted" }
    Copy-Item -Path $tmp -Destination $installed -Force
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
    Write-Log "Updater replaced itself: $($script:UpdaterVersion) -> $wanted (takes effect next run)."
  } catch {
    Write-Log "Updater self-update skipped (keeping $($script:UpdaterVersion)): $($_.Exception.Message)"
  }
}

function Sync-MachineIcon($server, $headers) {
  # THE CLIENT'S DESKTOP ICON (2026-09-26). Every client needs a way into their own Linked Helper
  # machine: a Remote Desktop file on the desktop that opens it. Once their machine is built the
  # server hands us that file, and we keep it on the desktop - written when missing or changed,
  # so it is already there at the onboarding call and comes back if it is ever deleted.
  # It cannot connect until the client has accepted the Tailscale share; that is the call's job.
  #
  # Then the PROOF: can this laptop actually reach the machine's Remote Desktop port? The first
  # time it can, the server fills in Machine Icon Proven - nobody has to remember to.
  # Wrapped: nothing here may ever cost the extension update.
  try {
    $icon = Invoke-RestMethod -Uri "$server/extension/dist/machine-icon" -Headers $headers -TimeoutSec 30
    if (-not $icon -or -not $icon.rdp) { return }   # no machine built yet - nothing to place
    $desktop = [Environment]::GetFolderPath('Desktop')
    $file = Join-Path $desktop "Linked Helper machine.rdp"
    $current = $null
    if (Test-Path $file) { $current = Get-Content $file -Raw }
    if ($current -ne $icon.rdp) {
      [System.IO.File]::WriteAllText($file, $icon.rdp, [System.Text.Encoding]::ASCII)
      Write-Log "Machine icon placed on the desktop ($($icon.address))."
      $script:CheckinExtra["icon"] = "placed"
    } else {
      $script:CheckinExtra["icon"] = "present"
    }
    $reachable = $false
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
      $wait = $tcp.BeginConnect($icon.address, 3389, $null, $null)
      if ($wait.AsyncWaitHandle.WaitOne(4000) -and $tcp.Connected) { $reachable = $true }
    } catch { $reachable = $false } finally { $tcp.Close() }
    $script:CheckinExtra["machine_reachable"] = $reachable
    if ($reachable) { Write-Log "Machine reachable from this laptop ($($icon.address))." }
  } catch {
    Write-Log "Machine icon step skipped: $($_.Exception.Message)"
  }
}

# -------------------------------------------------------------- uninstall ----
# Removes every piece the install put on the machine, and says so line by line. A client who
# leaves, or who asks "how do I get rid of it?", deserves a one-line answer - and being able to
# take it off cleanly is part of being trusted to put it on. Run as the same user who installed.
#
#   powershell -ExecutionPolicy Bypass -File wingguy-update.ps1 -Uninstall
#
# Leaves the browser alone: the extension must be removed from the extensions page by hand
# (Chrome/Edge do not let a script do that), so that is the one step this cannot take.
if ($Uninstall) {
  $scriptHome = Join-Path $env:LOCALAPPDATA "Wingguy"
  $startupFile = Join-Path ([Environment]::GetFolderPath('Startup')) "Wingguy Extension Update.vbs"

  schtasks /Delete /TN $TaskName /F 2>&1 | Out-Null
  schtasks /Query /TN $TaskName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "removed  scheduled task '$TaskName'" } else { Write-Host "FAILED   scheduled task '$TaskName' is still present" }

  if (Test-Path $startupFile) { Remove-Item -Path $startupFile -Force }
  if (-not (Test-Path $startupFile)) { Write-Host "removed  login run (Startup folder)" } else { Write-Host "FAILED   login run still present: $startupFile" }

  if (Test-Path $Folder) { Remove-Item -Path $Folder -Recurse -Force }
  if (-not (Test-Path $Folder)) { Write-Host "removed  extension folder $Folder" } else { Write-Host "FAILED   extension folder still present: $Folder" }

  # The script home goes last because the log lives in it - and this very script may be running
  # from it, which Windows allows (the file is already loaded).
  if (Test-Path $scriptHome) { Remove-Item -Path $scriptHome -Recurse -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path $scriptHome)) { Write-Host "removed  updater script and log ($scriptHome)" } else { Write-Host "FAILED   updater files still present: $scriptHome" }

  Write-Host ""
  Write-Host "One step left that a script cannot do: open chrome://extensions or edge://extensions"
  Write-Host "and click Remove on the Wingguy card."
  return
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

  # THE HOURLY RUN: schtasks, proven to work unelevated. See Set-UpdateSchedule for why hourly.
  if (-not (Set-UpdateSchedule $scriptHome $TaskName)) {
    throw "Could not create the scheduled task '$TaskName'. The extension would never update itself. Check you are in a NORMAL (non-admin) PowerShell as the machine's own user, and that policy allows scheduled tasks."
  }
  Write-Log "Hourly task '$TaskName' created and verified"

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
    Write-Log "SCHEDULED: every hour, and again at login. Ready."
  } else {
    Write-Log "WARNING: the hourly task is in place, but the login run could not be installed."
    Write-Log "SCHEDULED: hourly ONLY. A machine that is off will not catch up until it is on at the top of an hour."
  }

  # Prove it works before walking away - the whole point of installing this in person.
  & $installedScript -Server $Server -Token $Token -Folder $Folder -Force
  $updateExit = $LASTEXITCODE

  # VERIFY the folder. Do NOT infer success from the absence of an error, because there are two
  # ways to reach this line with $Folder still empty:
  #   1. the update threw - it logs ERROR and exits 1, but `&` hands control back here, so the
  #      old code went straight on to announce "Install complete" over nothing;
  #   2. the update was KILLED mid-download - a dropped Splashtop session, a closed window, a
  #      laptop that slept. That writes no log line at all, so a quiet log proves nothing either.
  # Both end the same way: a registered updater, an empty folder, and Load unpacked failing in
  # front of the client. Guy hit case 2 on his own Acer on 2026-09-05 - task registered,
  # C:\Wingguy empty, nothing on screen saying so. The hourly and login runs do repair it within a
  # day, but that is no help while you are still sitting at the machine.
  $installedVersion = Get-LocalVersion $Folder
  if (-not $installedVersion) {
    Write-Log "FAILED: updater is scheduled, but nothing was downloaded to $Folder (update exit $updateExit)."
    Write-Host ""
    Write-Host "INSTALL INCOMPLETE - DO NOT load the extension yet." -ForegroundColor Red
    Write-Host "Scheduling worked, but $Folder is empty - the download did not finish."
    Write-Host "Re-run it with:  $scriptHome\run-update.cmd"
    Write-Host "(The hourly and login runs will also repair this on their own.)"
    Write-Host ""
    exit 1
  }

  Write-Log "Install complete, verified $Folder at $installedVersion."
  Write-Host ""
  Write-Host "Verified: $Folder contains version $installedVersion." -ForegroundColor Green
  Write-Host "Now load $Folder into the browser (developer mode -> Load unpacked)."
  return
}

# ----------------------------------------------------------------- update ----
if (-not $Token) { throw "-Token is required" }

$machine = "$env:COMPUTERNAME"
$agent = "windows-ps"

# Before the network call, so the cadence heals even on a run where the server is unreachable.
Sync-UpdateSchedule $TaskName

try {
  $headers = @{ "x-portal-token" = $Token }
  $list = Invoke-RestMethod -Uri "$Server/extension/dist" -Headers $headers -TimeoutSec 60
  Update-Self $Server $headers $list.updaterVersion
  Sync-MachineIcon $Server $headers

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
