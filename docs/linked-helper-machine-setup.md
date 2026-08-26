# Linked Helper machine setup - make it heal itself

Turns a client's dedicated Linked Helper machine into one that recovers on its own from Windows
restarts, Linked Helper crashes, and Linked Helper updating itself. No click, no phone call, no
dependency on Linked Helper's own cloud or support.

**Why this exists:** the common failure is not dramatic. The machine reboots overnight, nobody is
signed in, Linked Helper never reopens, and the client's collection is dead for weeks before anyone
notices. Roland's ran dead for ten weeks. Luke's stopped when a trial lapsed. This checklist closes
that hole.

Status of what is below:

- **Proven on real hardware (Guy's Acer, 26 Aug 2026):** the launch command, the version-proof
  path via `Update.exe`, "Restart after updates" already ticked by default, the fact that nothing
  reopens by itself after a restart, and that the command starts **both** the Launcher and the
  instance - so the hourly update check keeps running rather than being bypassed.
- **Written but NOT yet tested end to end:** the two scheduled tasks in Part 4. The command they
  run is proven; the Task Scheduler wrapper around it is not. Test it on the Acer before running
  it on a client machine.

---

## Before you start - does this client qualify?

- **A dedicated machine.** Nothing personal on it, used only for Linked Helper. Auto sign-in and
  standing remote access are both reasonable on a dedicated box and are not reasonable on
  someone's everyday laptop.
- **It stays plugged in and on the internet.** None of this helps a laptop that goes home at
  five o'clock. If theirs does, they belong on a hosted machine instead.
- **Windows 10 or 11.**
- **They have agreed, in writing, to two things:** you having remote access, and the LinkedIn
  account risk staying theirs. Linked Helper's own words, on their proxy page: "LinkedIn does not
  endorse when you manage someone else's account, no matter with or without automation tools."
  That sentence belongs in the agreement, not in a footnote.

If they do not have a spare machine, a small mini PC is roughly $400 once - about four months of
the hosted tier. Tell them that; the ones who buy the mini PC would have resented a subscription.

---

## Part 1 - Windows, so the machine comes back by itself

**1. Sign in automatically after a restart.**

Run `netplwiz`, untick "Users must enter a user name and password to use this computer", enter the
password twice.

If that tickbox is missing (common on Windows 11 with a Microsoft account), run this in an
Administrator PowerShell, then run `netplwiz` again:

```powershell
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device" `
  -Name DevicePasswordLessBuildVersion -Value 0
```

**2. Never sleep on mains.**

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 20
```

**3. Closing the lid does nothing** (laptops only).

Control Panel - Power Options - "Choose what closing the lid does" - Plugged in: **Do nothing**.

**4. Windows restarts happen at a civilised hour.**

Settings - Windows Update - Advanced options - Active hours. Set them so any forced restart lands
around 3am, when Parts 1 and 4 will bring everything back before the client wakes up.

---

## Part 2 - Find this client's account ID

Different for every client. With Linked Helper running and the instance open, run this on their
machine:

```powershell
Get-CimInstance Win32_Process -Filter "Name='linked-helper.exe'" |
  ForEach-Object { if ($_.CommandLine -match '--start-account-id=(\d+)') { "Account ID: $($Matches[1])" } } |
  Select-Object -First 1
```

Write the number down. Guy's is `16045`. It goes on the client record - it is not a secret and it
is a nuisance to re-derive.

---

## Part 3 - The command that starts everything

This is the whole trick. The "Open and run campaigns" button in the Launcher is not magic - it
runs a command, and Linked Helper hands us that command in its own process arguments. Windows can
run the same thing without a human.

```
"%LOCALAPPDATA%\linked-helper\Update.exe" --processStart linked-helper.exe --process-start-args "--start-account-id=NNNNN"
```

**Always go through `Update.exe`.** The direct path to the app contains its version number
(`app-2.130.25`), which changes every time Linked Helper updates itself - a command written that
way works today and silently breaks in a month. `Update.exe` always points at the current version.

To test it by hand: quit Linked Helper completely (check Task Manager shows no `linked-helper.exe`),
then run it and watch. Campaigns should come back running, from where they left off, with no clicks.

---

## Part 4 - Make Windows do it

⚠ **Not yet tested end to end. Prove this on the Acer first.**

Two jobs in one: run at sign-in, and check every fifteen minutes that it is still alive. The second
half is what covers crashes rather than just restarts - worst case, fifteen minutes of downtime.

Run in PowerShell **on the client machine, as the user Linked Helper runs under**, after setting
`$id`:

```powershell
$id = '16045'   # <-- this client's account ID from Part 2

$script = @"
`$id = '$id'
`$running = Get-CimInstance Win32_Process -Filter "Name='linked-helper.exe'" |
  Where-Object { `$_.CommandLine -like "*--app-id=`$id*" -and `$_.CommandLine -notlike '*--type=*' }
if (-not `$running) {
  Start-Process "`$env:LOCALAPPDATA\linked-helper\Update.exe" ``
    -ArgumentList "--processStart linked-helper.exe --process-start-args ```"--start-account-id=`$id```""
}
"@

$path = "$env:LOCALAPPDATA\linked-helper\lh-keepalive.ps1"
Set-Content -Path $path -Value $script -Encoding UTF8

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$path`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$every15 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName 'Linked Helper keepalive' -Action $action `
  -Trigger $atLogon, $every15 -Principal $principal -Force
```

`LogonType Interactive` matters - Linked Helper is a desktop app and needs a real signed-in desktop
to appear on. A task set to "run whether user is logged on or not" will start the process where
nobody can see it and campaigns will not run.

To check it later: `Get-ScheduledTask 'Linked Helper keepalive' | Get-ScheduledTaskInfo`

---

## Part 5 - Linked Helper's own settings

- **Launcher - Check and install updates - "Restart after updates": ticked.** It was already ticked
  by default on Guy's install, but confirm per machine. Without it the app sits on a notification
  nobody sees, running a version LinkedIn has already broken. Linked Helper patch within hours of a
  LinkedIn change, but only an updated, restarted app gets the fix.
- **Open the account with "Open and run campaigns", never plain "Open".** Plain "Open" starts the
  instance with the campaigns runner stopped.

---

## Part 6 - Remote access

- **Chrome Remote Desktop** is the pragmatic pick - free, works unattended, fine on a dedicated box.
  **RustDesk** if you would rather not involve a Google account.
- **Not TeamViewer or AnyDesk.** Their free tiers are personal-use only and will start blocking a
  commercial-looking pattern, which this is.
- **The access PIN goes in your password manager. Never on the client record.** A remote-access PIN
  in the Clients base is a plaintext key to a machine, sitting somewhere routinely read by
  automation.
- On the client record (master `Clients` table, rolled out via `scripts/ensure-client-fields.js` -
  see `MASTER_FIELDS`, and read the field-rollout memory first), three plain facts:
  - **Remote Access Method** - None / Chrome Remote Desktop / RustDesk / Hosted
  - **Remote Access Notes** - which machine, LH account ID, who owns it
  - **Remote Access Consent Date**

---

## Part 7 - Prove it before you leave

1. Restart the machine. Walk away for five minutes. Come back: campaigns running, nothing clicked.
2. Close the remote session by **closing the window - never Sign Out.** Signing out shuts Linked
   Helper down and stops the campaigns. Say this out loud to the client too.
3. An hour later, check the numbers moved. Some remote-desktop setups let a disconnected session go
   idle; this is the check that catches it.

---

## Part 8 - How to check on it afterwards

**Do not remote in to see whether it is running.** Look at whether new leads are arriving in their
Airtable - that answers it for every client at once, in seconds, and it is the same live probe used
before any follow-up call.

Remote in when the data says it has stopped, or when you actually want to change a campaign.

**Check the version number occasionally.** The command starts the Launcher, so updates should apply
normally - confirmed as far as "the Launcher is running", not as far as "an update has been watched
landing". Guy's Acer was on **2.130.25 on 26 Aug 2026**. If a machine has not moved off its version
after a month, updates are not applying and it needs looking at - the failure would be silent, and a
machine running a version LinkedIn has already broken looks perfectly alive while doing nothing.

Note also that Linked Helper's Launcher can start an account on a machine other than the one you are
sitting at - "Open on remote machine and run campaigns" - so routine campaign work may not need a
remote desktop session at all. Not yet tested; worth ten minutes.

---

## Gotchas

- **Never Sign Out of a remote session.** Close the window. Signing out kills the campaigns.
- **Never write the version-numbered path into anything permanent.** Always `Update.exe`.
- **A dedicated machine is a requirement, not a preference.** Auto sign-in means the machine boots
  to an unlocked desktop. Fine for a box that does nothing else; not fine for a personal laptop, and
  usually forbidden on a work-issued one.
- **Delete any diagnostic files afterwards.** The process command line contains the client's Linked
  Helper login as an encrypted blob. Anything you dump to the Desktop while working, remove.
- **A restart or a new machine may trigger a LinkedIn verification prompt.** Handle it while the
  client is still with you, not afterwards.
