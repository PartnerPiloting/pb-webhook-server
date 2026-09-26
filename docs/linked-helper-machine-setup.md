# Linked Helper machine setup - the client's VPS, and how it heals itself

> **Method status: CURRENT since 10 Sep 2026.** Every client's Linked Helper runs on a small Ubuntu
> VPS at Binary Lane, built by `scripts/linked-helper/setup-ubuntu-vps.sh`. This doc describes that
> method; nothing else is to be built. **Supersedes:** the Windows laptop method of August 2026
> (netplwiz, powercfg, the keepalive task, Chrome Remote Desktop), kept at the very end under RETIRED
> for the record only. When the method changes again: update this line, move the old method under
> RETIRED, add its terms to `content/retired-terms.json`, and run `node tests/retired-terms.test.js`
> - it names every doc still describing the old way.

**Why this exists:** the common failure is not dramatic. The machine restarts, nobody is signed in,
Linked Helper never reopens, and the client's collection is dead for weeks before anyone notices.
Roland's ran dead for ten weeks on his own laptop. Luke's stopped when a trial lapsed. A machine
that lives in a data centre, restarts itself, backs itself up and reports in every five minutes
closes that hole - and the client never has to open it.

**The shape, in one paragraph.** The client buys the machine - the playbook topic YOUR LINKED
HELPER MACHINE walks them through it in ten minutes; concierge clients do it in step 5 of the run
sheet with Guy driving. Guy builds it alone with one command. It joins Tailscale by name, Linked
Helper autostarts, the watchdog restarts it and presses the runner, the backup lands in Drive at
02:30 and a daily watcher emails Guy if it stops, and the machine writes its own health onto the
client's record. Then one short call where the client signs in to LinkedIn on it, and the standard
campaigns go in by script.

---

## The Ubuntu VPS - the only method since 10 Sep 2026

★ **Every client's machine is a small Ubuntu VPS at Binary Lane** (binarylane.com.au), bought by
the client in their own account on their own card, so it is theirs and the exit is clean: the
2 vCPU / 4 GB / 60 GB plan, about A$19.60 a month before GST, any Australian city (same price, same
speed - the client's own if it is on the list), the newest Ubuntu LTS, hostname `linkedinhelper`,
the wg_clients SSH key added at purchase. The client-facing purchase walk-through is the playbook
topic YOUR LINKED HELPER MACHINE; the concierge run sheet buys it in step 5. No proxy - one client
per VPS is its own Australian IP. Access for everyone is RDP over Tailscale (below).
(History: the 29 Aug direction was an OVH Sydney VPS at about A$7, and Guy's own machine was built
there on 1 Sep; Binary Lane replaced it from the first client build on 9 Sep 2026.)

**The build is `scripts/linked-helper/setup-ubuntu-vps.sh`** - one command on a fresh VPS installs
the desktop, remote access, Linked Helper (their official .deb), auto-login, the watchdog
(`lh-watchdog.py`, the Linux port of the proven Windows presser + title health check), and a 03:00
nightly maintenance reboot. A script rather than a snapshot because snapshots do not move between
provider accounts and each client owns theirs.

### Nightly backup - PROVEN END TO END 1 Sep 2026

`scripts/linked-helper/lh-nightly-backup.sh`, cron at **02:30** (deliberately before the 03:00
reboot, while the machine is quiet). Sequence, all unattended:

**stop Linked Helper -> archive `~/.config/linked-helper` (caches excluded) -> upload to Google
Drive -> restart Linked Helper -> watchdog presses "Start campaigns runner" within 5 min.**

Watched live on Guy's machine: 1.8 GB of data compressed to **856 MB**, uploaded in ~60 s, LH back
up, and the watchdog logged `press result: CLICKED <BUTTON>` -> `state: RUNNING`. **LinkedIn stayed
logged in through the restart** - no re-verification, which matters because it means the nightly
cycle costs nothing in disruption. Keeps 21 days, prunes older.

Why stop LH first: its own backup feature refuses to run on an open account, for the same reason a
copy would be unsafe - the database is mid-write. The archive is a data-directory copy, not their
`.lhd2` format; for **disaster recovery onto a NEW machine the supported `.lhd2` export is still
the right artefact**, so keep taking one occasionally until that too is automated (it needs the
same DevTools button-press trick).

⚠ **Exclusions matter more than they look (fixed 3 Sep 2026).** The archive ballooned 897 MB ->
1.4 GB overnight. Cause: Linked Helper writes a **292 MB `lh.db.backup.<version>.archived.lhd2`
every time it self-updates**, and those piled up alongside our own `.imported.lhd2` from the
migration - 876 MB of stale copies. The nightly job was also packing up the **Linked Helper program
itself** (`Instances/`, 676 MB), which is a free download and never needs backing up. With both
excluded the archive is **292 MB** - and the only thing that actually matters, `lh.db` (1.2 GB
uncompressed), is verified present. ⚠ tar patterns match the member name as stored, so
`--exclude="./.config/..."` silently matches nothing; use `--exclude="*/Instances"` plus
`--exclude="*/Instances/*"`.

Drive credentials go on per machine with `lh-rclone-credentials.sh` (Guy's own Google OAuth client,
project "Linked Helper backups", since 8 Sep 2026). It validates the secret and tests a real upload
before leaving anything in place - a secret pasted seven times into a hidden prompt killed every
backup from 9 to 19 Sep, and nothing said so. The publishing status on the Google Auth Platform
page must stay "In production": in "Testing" the refresh tokens expire after seven days.

⚠ Bug found and fixed the same evening: the watchdog re-read the window title 8 s after pressing,
catching a transient `LinkedIn logged out` mid-refresh. Now 20 s.

### ⚠⚠ Watchdog bugs found 7 Sep 2026 - it could NEVER start a stopped Linked Helper

Found while testing the tidy-up, after a throttled upload left LH down for ~30 min and the watchdog
sat through six cycles doing nothing.

**1. `pgrep -f 'linked-helper'` matched its own shell.** The command line of the shell running that
very pgrep contains the string, so `lh_pids()` never returned empty, the watchdog always concluded
LH was running, and **the "start it if it's down" branch had never once executed.** Invisible until
now because the desktop autostart covers the boot case - this was the first time LH was down while
the machine stayed up. Fix: the `[l]inked-helper` bracket trick.

**2. It decided from processes, not from the window.** Stray child processes with no instance window
left it doing nothing at all. Now it reads the window title first and starts LH whenever the state
is `NOT OPEN`, regardless of what processes exist.

**3. A fixed 60 s wait after starting landed mid-load** ("Initializing.../Loading...") and wasted the
cycle. Now polls up to ~3 min until the state settles to IDLE or RUNNING.

**Proven after the fix:** LH killed outright -> watchdog started it -> waited for settle -> pressed
"Start campaigns runner" -> `Running campaigns... | LinkedIn logged in`. The first press right after
a cold start can return `NOT FOUND` (screen still drawing); the next 5-minute cycle gets it.

### ⚠ Google Drive throttling holds LH down - backup reordered

7 Sep: a manual daytime backup stalled on `rateLimitExceeded` from Google and, because the old
script restarted LH only *after* the upload, campaigns stayed down for the whole transfer. **The
upload never needed LH stopped.** Now: stop -> tidy -> archive (~10 s) -> **restart LH** -> upload.
Downtime is seconds, not the length of the transfer. Upload also gets `timeout 40m`, `--retries 3`
and a drive pacer so a throttled transfer fails cleanly instead of hanging forever.

Resolved 8 Sep 2026: Guy's own OAuth client replaced rclone's shared one (above). And since 19 Sep
the backups are WATCHED: the nightly job writes `/var/lib/lh-backup-state.json`, the watchdog carries
it on its report, the client's row shows `backup ok 14h ago` / `backup FAILING` / `backup NOT
INSTALLED` at the end of Machine Status, and `services/lhBackupWatch.js` emails Guy at 06:00 when
any machine has gone two days without a good upload. A clean fleet sends nothing.

### Nightly tidy-up (added 7 Sep 2026)

Linked Helper parks a ~292 MB `lh.db.backup.<version>.archived.lhd2` on every self-update and never
removes them - 1.17 GB had accumulated in a week, and disk went 23% -> 40%. The nightly job now
keeps the **most recent** one (LH's own safety net if an update goes bad) and deletes the rest once
older than 3 days, plus our `.imported.lhd2` migration artefact. Runs while LH is stopped, so the
files are safe to touch, and `lh.db` itself is never a candidate. First run freed 584 MB.

### The machine fills in its own client record (built 10 Sep 2026)

Every machine's watchdog already posts a status report at the end of each five-minute cycle when
`/etc/linked-helper-machine.conf` carries `REPORT_URL` and `REPORT_SECRET`. The server end is
`routes/linkedHelperMachineRoutes.js`: it verifies the secret against the client's **Machine
Report Secret** field and writes onto their Clients row **LH Account ID**, **Machine Address**
(hostname + public IP), **Machine Tailscale** (name + 100.x), **Machine Status** (one line: runner
state, LinkedIn state, LH version, launcher, disk, what the watchdog did) and **Machine Last
Seen**. So the record fills itself in and a machine that goes quiet shows as a stale last-seen in
Airtable - the fleet health signal, no remoting in.

**Wiring a machine (once per client, ~2 minutes):**

1. Mint a secret (any 24+ random characters, e.g. `openssl rand -base64 24 | tr -d '/+='`).
2. Put it on the client's row: `node scripts/set-client-flag.js --client=<Client-ID>
   --field="Machine Report Secret" --value=<secret>` (Render one-off job - needs the server env).
3. Pass `REPORT_URL=https://pb-webhook-server.onrender.com/webhooks/lh-machine/<Client-ID>` and
   `REPORT_SECRET=<secret>` to `setup-ubuntu-vps.sh` on a new build, or on an existing machine set
   the two lines in `/etc/linked-helper-machine.conf` (mode 644 - the watchdog runs as `lh`; the
   secret only lets a machine write its own status line, nothing else).
4. Prove it: `systemctl start lh-watchdog.service`, then `GET /webhooks/lh-machine/<Client-ID>`
   shows `last_seen` just now, and the row's Machine Status reads the same as the window title.

Two fields stay human because the machine cannot know them: **Remote Access Method** and
**Remote Access Consent Date** - set at the build-session wrap (the onboard skill says so).
Never write the machine fields by hand; if they are blank a day after a build, the wiring above
was skipped.

### Standard campaigns by script (PROVEN 11 Sep 2026)

**ONE campaign by default (Guy, 25 Sep 2026).** `lh-build-campaigns.sh` with no arguments builds only
recipe 03, the connect campaign: connection request, keep only who accepts, extract them into Wingguy,
where they are scored and worked on Thanks for Connecting. That is the whole method now. Recipes 01
(visit and extract - used to wake up a client's existing network) and 02 (top scorers - the old
score-first route, for a narrow-audience client) stay installed and are built by name when needed:
`lh-build-campaigns.sh visit-and-extract`, or `--all`. Recipe 03 carries Guy's own name and connection
note - rename it and rewrite the note in the client's words in the UI straight after building.

Nobody builds campaigns by hand or from a CSV template any more. `lh-build-campaigns.sh` (installed
by the build) asks the running instance to create each campaign in
`/usr/local/share/linked-helper/campaigns/*.json` through Linked Helper's own create command - the
same one the "Create campaign" button uses - with the client's webhook address filled from
`/etc/linked-helper-machine.conf`. Idempotent by campaign name, so running it twice is harmless; an
ARCHIVED campaign does not count, so re-running after an archive creates it fresh (LH cannot delete,
only archive). It refuses while an action is mid-flight ("Running campaign #N" in the title).

**It is a post-login step, not part of the unattended build:** the campaign attaches to the
LinkedIn account row that only exists after the client has logged in once. Run it, then walk the
client through what was built on a screen share - that replaces the old "download a template" step.

Source of truth for the recipes = `scripts/linked-helper/campaigns/` in the repo. Recipe 1 = visit
and extract (from Guy's campaign 33 + the playbook), 2 = TOP SCORERS (Guy's campaign 32, his own
messages - the client rewrites them in the UI), 3 = Fractional in profile (Guy's campaign 40).
To make a recipe from any campaign: `lh-campaigns.py export <id> --out x.json` (webhook swapped for
the placeholder, hours converted to local, with a check that it rebuilds the exact rows).
Other commands: `list`, `show <id>`, `diff <a> <b>`, `plan <recipe>`.

How it reaches Linked Helper: the instance's DevTools port -> its interface page -> the webpack
bundle's require (`self.webpackChunk_linked_helper_front.push(...)`) -> the data-layer singleton
(found by TEXT, `async _callWriteImpl`, never by module id) -> `callWrite("people.campaigns.createCampaign", ...)`.
Working hours are stored in UTC minutes; recipes are written in the machine's local time and
converted. Every action must carry `target: []` and `excludeList: []` or the engine throws
"invalid `people`".

⚠ **Never enumerate `mainWindowService.mainWindow / browserWindow / window / contentWindow`
from a probe.** They are @electron/remote proxies; enumerating them raised "An object could not be
cloned" in the main process, a modal error box appeared, DevTools hung and the instance exited
(Guy's box, 11 Sep 2026). The watchdog's normal path recovered it, LinkedIn stayed logged in.

### Access: Tailscale, not an open port (settled 1 Sep 2026)

**Every machine joins a Tailscale private network and is reached by NAME** - `lh-guy-wilson`,
`lh-julian-davis` - never by address. Pass `TS_AUTHKEY` to the setup script and it joins itself.
RDP is then firewalled to the tailnet interface only, so **port 3389 is never exposed to the
internet**.

Why this is not optional: IP-allowlisting locked Guy out **twice in one afternoon** as his home
address changed. On a client's home broadband it would be worse, and an internet-facing RDP port is
among the most brute-forced things there is. Tailscale's free tier covers 100 devices; when this
goes commercial the correct plan is their Starter tier, billed **per person, not per machine** - one
user, thirty client machines, still cheap.

Guy's laptop and the Sydney machine joined 1 Sep 2026; latency Brisbane->Sydney measured at 61 ms.
His desktop shortcut (`Sydney Linked Helper.rdp`) points at `lh-guy-wilson`.

**Every client gets the same kind of icon on their own laptop (since 26 Sep 2026)** - Tailscale
installed under their OWN account, the one machine shared to them, and a `.rdp` built by
`node scripts/make-client-rdp.js <Client-ID>` pointing at the machine's 100.x address (a shared
machine's name does not resolve the same on their side). xrdp.ini carries the screen password, so
the double-click lands straight on the Linked Helper screen. Done and proven at the machine session,
then `Machine Icon Proven` is set on their row - steps in `docs/wingguy-onboarding-checklist.md`,
"The client's desktop icon".
⚠ Auth keys expire (90 days max) and should be **revoked after use** - they only add machines, and
revoking does not disconnect machines already joined.

★ **Splashtop is being dropped** - no Linux build via team deployment (checked live: Windows and Mac
only), and Tailscale + RDP does the same job for free on both platforms.

### ⚠ Gotchas found on the FIRST real build (Guy's Sydney VPS, 1 Sep 2026)

All four are now fixed in the setup script - they are recorded here because each cost real time and
would otherwise be re-discovered per client.

1. **★ Ubuntu 24.04 kills Linked Helper on launch.** 24.04 restricts unprivileged user namespaces,
   which Electron needs for its sandbox. LH dies instantly showing only `'disconnect' fired`; the
   real evidence is `traps: linked-helper ... trap int3` plus an apparmor `userns_create` line in
   `journalctl`. Fix: `kernel.apparmor_restrict_unprivileged_userns=0` (persisted in
   `/etc/sysctl.d/60-linked-helper.conf`). **Without this the whole thing looks broken for no
   visible reason.**
2. **The VPS image ships with no swap at all**, so any memory spike would OOM-kill LH outright
   rather than merely slow down. Script now adds a 4 GB swapfile with `swappiness=10`.
3. **No browser installed**, so LH throws "Failed to execute default Web Browser" whenever it tries
   to open a link (help, verification). Script now installs Firefox.
4. **The script installed XFCE/lightdm but configured gdm3** - a half-applied edit. Everything
   downstream (autologin, x11vnc) silently did nothing. Now consistently lightdm + XFCE.

Two more from the first CLIENT build (Julian Davis, Binary Lane, Ubuntu 26.04, 9 Sep 2026), both
now fixed in the script:

5. **`install -d` on `~/.config/autostart` left `.config` itself owned by root**, so Linked Helper
   died on login with "Failed to get 'userData' path" and XFCE came up with no window manager or
   panel. The script now creates `.config` first as the LH user and finishes with a `chown -R` of
   the whole home directory. Hand fix on a built machine: `chown -R lh:lh /home/lh`, restart lightdm.
6. **Binary Lane ships `/etc/ssh/sshd_config.d/10-binarylane.conf` with `PasswordAuthentication
   yes`**, and sshd keeps the FIRST value it reads, so a `99-*` override does nothing. The script
   now writes `00-keys-only.conf` (sorts before theirs), only when root already has a key, and
   checks `sshd -t` before reloading. Verify from outside: password SSH refused, key SSH accepted.

(History, OVH only - Guy's own first build. Binary Lane takes the SSH key at purchase and has no
such gate.) OVH's default install expires the `ubuntu` password immediately and demands an
interactive change, which blocks all automation; the way round was rebuilding via the API with
`doNotSendPassword:true` and the SSH key in the payload.

⚠ **STATUS: PROVEN.** First build 1 Sep 2026 (Guy's machine): unattended reboot -> autologin -> LH
starts -> screen reachable over RDP -> 1.2 GB data import -> instance runs clean. First client build
9 Sep (Julian Davis, Binary Lane). Five machines on it by 19 Sep 2026 - Guy, Roland, Rick, Sam,
Julian - all with the watchdog reporting, the nightly backup and the daily backup watcher.

**Official sizing (LH requirements page, checked 29 Aug 2026):** one account needs 2.5 GB free
RAM, 0.5-1 "real core" (their definition: **2 VPS vCores = 1 real core**), 4 GB disk, SSD. So the
Binary Lane 2 vCPU / 4 GB / 60 GB plan meets the single-account spec; go up a tier only if it
strains. Also per that page: **"Gnome GUI is mandatory"**
on Linux (KDE/LXDE/XFCE not officially supported) - the setup script installs GNOME for that
reason, with Wayland disabled (x11vnc/xdotool need X11) - and **ARM processors are not supported**
on Windows/Linux (irrelevant for x86 VPSes; it is why LH cannot run on Guy's ARM Surface).

⚠ **Linked Helper's own caveat, stated on their downloads page:** Ubuntu is supported (18.04+, GUI
required) but "we do not recommend using Ubuntu because of the unstable graphical interface" -
aimed mostly at multi-account setups (they push Windows Server there). We run one account per
machine, the easy case; the dogfood fortnight is what settles whether their caveat bites.

---

## Gotchas

- **Never Sign Out of a remote session.** Close the window. Signing out kills the campaigns.
- (Windows method, retired) **Never write the version-numbered path into anything permanent.** Always `Update.exe`.
- **A dedicated machine is a requirement, not a preference.** Auto sign-in means the machine boots
  to an unlocked desktop. Fine for a box that does nothing else; not fine for a personal laptop, and
  usually forbidden on a work-issued one.
- **Delete any diagnostic files afterwards.** The process command line contains the client's Linked
  Helper login as an encrypted blob. Anything you dump to the Desktop while working, remove.
- **A restart or a new machine may trigger a LinkedIn verification prompt.** Handle it while the
  client is still with you, not afterwards.

---

## RETIRED - the Windows laptop method (August 2026) - do not build this

Kept for the record only. Every client's machine is the Ubuntu VPS above; nothing below is to be
built, and its terms (netplwiz, powercfg, the keepalive task, Chrome Remote Desktop, RustDesk, a
spare laptop or mini PC, Guy's Acer) are on the retired list in `content/retired-terms.json`. What
survives from this work is the mechanism: Linked Helper's DevTools channel to press "Start campaigns
runner" (Part 3a) and the window-title health string (Part 3b), both ported into `lh-watchdog.py`.

What was proven, at the time:

- **Proven on real hardware (Guy's Acer, 26 Aug 2026):** the launch command, the version-proof
  path via `Update.exe`, "Restart after updates" already ticked by default, the fact that nothing
  reopens by itself after a restart, and that the command starts **both** the Launcher and the
  instance - so the hourly update check keeps running rather than being bypassed.
- **Proven 28 Aug 2026:** the campaigns runner can be started with no mouse, via Linked Helper's
  own control channel (Part 3a), and a machine's full health reads out of its window title (Part 3b).
  Watched live: `Idle` -> `CLICKED <BUTTON>` -> `Running campaigns...`.
- **Written but NOT yet tested end to end:** the two scheduled tasks in Part 4, and the nightly
  backup cycle. Both are assembly of proven parts now, but neither has run unattended.

---

### Before you start - does this client qualify?

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

### Part 1 - Windows, so the machine comes back by itself

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

### Part 2 - Find this client's account ID

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

### Part 3 - The command that starts everything

This is the whole trick. The "Open and run campaigns" button in the Launcher is not magic - it
runs a command, and Linked Helper hands us that command in its own process arguments. Windows can
run the same thing without a human.

```
"%LOCALAPPDATA%\linked-helper\Update.exe" --processStart linked-helper.exe --process-start-args "--start-account-id=NNNNN"
```

**Always go through `Update.exe`.** The direct path to the app contains its version number
(`app-2.130.25`), which changes every time Linked Helper updates itself - a command written that
way works today and silently breaks in a month. `Update.exe` always points at the current version.

#### The runner does NOT start with the account - and here is how we start it

The command above opens the Launcher and the instance, but the instance comes up with
`--app-start-running-campaigns=false` and the runner stopped. `--start-account-id` is the equivalent
of the Launcher's plain **"Open"**, not **"Open and run campaigns"**, and appending
`--app-start-running-campaigns=true` makes no difference - the Launcher ignores it.

This is deliberate on Linked Helper's part, not an oversight. Their code takes a
`shouldStartRunningCampaigns` flag which **defaults to false** unless the caller explicitly asks for
it, and only the two menu items ("Open" / "Open and run campaigns") ever set it. There is no
command-line route. Do not go looking for a flag; there isn't one.

**So something has to press the button - see Part 3a. That is solved.**

---

### Part 3a - Pressing the campaigns runner button (PROVEN 28 Aug 2026)

Windows' own accessibility route is a dead end: Linked Helper's windows are visible to it but their
contents are not - a probe returns the two window names and zero buttons.

The way in is that **Linked Helper already runs with Chrome's control channel open**. Its instance
carries `--remote-debugging-port=0` ("pick any free port"), listening on 127.0.0.1 only. We connect
to that, find its own interface page (`type: page`, `title: "Linked Helper 2"`), and activate the
control in the page - the same thing a mouse click does, with no dependence on window position,
size, zoom or theme.

⚠ **The port changes on every launch.** Never hardcode it - discover it each run by looking at what
the `linked-helper` processes are listening on and asking each port for `/json/version`.

⚠ **Match `^start campaigns runner$` exactly.** A looser match (e.g. `campaigns runner`) also finds
the **Stop** button on a healthy machine and would switch a working client off. Matching only Start
means the script is a no-op when the runner is already going, so it is safe to run every 15 minutes
forever.

The script is `scripts/linked-helper/lh-start-runner.ps1`. It reports the state before, what it did,
and the state after, and refuses to act if the runner is already running.

Live proof on Guy's Acer, 28 Aug 2026:

```
BEFORE : IDLE      ... | 2.130.28 | Idle | LinkedIn messaging page ...
ACTION : CLICKED <BUTTON>
AFTER  : RUNNING   ... | 2.130.28 | Running campaigns... | LinkedIn messaging page ...
```

---

### Part 3b - Reading a machine's health from its window title

The instance's window title carries the whole health picture, with no accessibility and nothing that
breaks when Linked Helper redesigns a screen:

```
Guy Wilson | Linked Helper 2 Instance #16045 | 2.130.28 | Running campaigns... | LinkedIn logged in (...)
```

Four signals in one string: **which account** (`Instance #16045`), **which version**, **runner state**
(`Idle` vs `Running campaigns...`), and **whether the LinkedIn session is still alive**
(`LinkedIn logged in`) - that last one catches a logged-out session, which would otherwise be
completely silent.

```powershell
$t=(Get-Process linked-helper | Where-Object {$_.MainWindowTitle -like '*Instance*'}).MainWindowTitle
$id=if($t -match 'Instance #(\d+)'){$Matches[1]}
$st=if($t -match 'Running campaigns'){'RUNNING'}elseif($t -match '\| Idle \|'){'IDLE'}else{'UNKNOWN'}
$li=if($t -match 'LinkedIn logged in'){'ok'}else{'LOGGED OUT'}
"account=$id runner=$st linkedin=$li"
```

This is what each machine should report in every 15 minutes. **Detection matters more than the
fix:** the failure that hurt (Roland's ten weeks, Luke's lapsed trial) was never "a machine needed a
click", it was "nobody noticed". Even if the presser ever breaks, a reporting machine turns a silent
death into an email.

⚠ Not yet confirmed: whether the title stays on `Running campaigns...` when the runner is on but the
campaigns are sleeping (outside working hours, daily limit reached, empty queue). It held over
several minutes on 28 Aug. If it does drift, read `Idle` as "possibly fine" rather than "broken".

---

### Part 4 - Make Windows do it

⚠ **Not yet tested end to end. Prove this on the Acer first.** The watchdog below must be
upgraded to check the **runner** (Part 3b) and not merely that the process exists - a Linked Helper
sitting open with the runner off looks perfectly healthy to a process check.

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

### Part 5 - Linked Helper's own settings

- **Launcher - Check and install updates - "Restart after updates": ticked.** It was already ticked
  by default on Guy's install, but confirm per machine. Without it the app sits on a notification
  nobody sees, running a version LinkedIn has already broken. Linked Helper patch within hours of a
  LinkedIn change, but only an updated, restarted app gets the fix.
- **Open the account with "Open and run campaigns", never plain "Open".** Plain "Open" starts the
  instance with the campaigns runner stopped.

---

### Part 6 - Remote access

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

### Part 7 - Prove it before you leave

1. Restart the machine. Walk away for five minutes. Come back: campaigns running, nothing clicked.
2. Close the remote session by **closing the window - never Sign Out.** Signing out shuts Linked
   Helper down and stops the campaigns. Say this out loud to the client too.
3. An hour later, check the numbers moved. Some remote-desktop setups let a disconnected session go
   idle; this is the check that catches it.

---

### Part 8 - How to check on it afterwards

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

