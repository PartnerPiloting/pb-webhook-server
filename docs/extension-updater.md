# The extension updater - delivery without a cloud account

The third delivery lane, alongside the OneDrive share and the manual zip. See
`docs/wingguy-onboarding-checklist.md` for the lanes as a whole.

## Why this exists

Every sync lane depends on a cloud account the client controls, and each one has a wall we
found in the field, not in the documentation:

- **OneDrive allows exactly ONE personal account per machine.** Rick Wong's slot was already
  taken by a family account his wife also uses, so his own new account could not be added
  without unlinking hers (2026-09-03). No amount of instruction fixes that.
- **A work/M365 account cannot accept a share from a consumer account.** Different services
  underneath, not just different sign-ins. Ashley Knowles hit it first (2026-08-20) and Rick
  confirmed it (2026-09-03) - the folder opens in a browser and can never sync.
- **Google Drive's streamed `G:` is not mounted when the browser launches**, so the browser
  finds the folder unreadable and silently REMOVES the extension. Hit Guy twice before it was
  diagnosed (2026-08-25). Pinning files offline does not help: the drive letter itself is absent.

The updater removes the cloud account from the picture. A scheduled job on the client's own
machine pulls from us into a fixed local folder.

## Why it holds up

- **No cloud account anywhere** - no slot to be occupied, no tenant to refuse a share, no
  sign-in to expire.
- **Real local files on the system drive** - the folder exists before any browser starts, so the
  boot race cannot happen.
- **The path never changes** - the browser identifies an unpacked extension by where it was
  loaded from, so a stable path means the extension keeps its identity, and therefore its
  storage and sign-in, through every update.
- **Files are written IN PLACE** - no second copy, no re-loading, none of the double-panel mess.
- **Nothing depends on the client** - Guy installs it over remote access; the client never runs
  anything and never sees a security prompt.
- **Doing nothing is the normal case** - when the version matches, the run exits. Safe to run
  every day forever.
- **Self-correcting** - a failed run (machine asleep, no wifi, server down) leaves the old
  version working and the next run fixes it. There is no half-finished state.

## The pieces

| Piece | What it does |
|---|---|
| `routes/extensionDistRoutes.js` | Serves the file list and each file; takes check-ins. Portal-token gated. |
| `services/extensionDistStore.js` | The `wingguy_extension_checkins` table. Lazy pool, CREATE-IF-NOT-EXISTS. |
| `scripts/extension-updater/wingguy-update.ps1` | Windows: install + daily update. |
| `scripts/extension-updater/wingguy-update.sh` | macOS: same logic, launchd. **UNPROVEN** - see below. |
| `scripts/extension-fleet.js` | Who is on what version, and who has gone quiet. |
| `scripts/extension-install-command.js` | Prints the ready-to-paste install line for one client, token filled in. |

**Deliberately no zip.** No archive library is needed on either end, the client never unzips
(so the "which nested folder do I load?" trap disappears), and a partial download is detected
before anything is written in place. The extension is ~14 small files and they are only fetched
when the version actually differs.

**Auth is the client's own Portal Token** (`x-portal-token`) - the same one the extension and
portal already use. It authorises the pull *and* identifies who checked in, so the updater
carries exactly one secret.

**What is served is the deployed `wingguy-extension` folder** - identical to what
`scripts/ship-extension.js` copies into the OneDrive lane. One source of truth for both.

## Installing it for a client

On your own machine, get the line:

```
node scripts/extension-install-command.js <Client-ID>
```

That prints a single line for Windows and one for macOS, with the client's own Portal Token
already in it - nothing to look up or assemble while sitting in front of someone else's computer.
The server serves the updater itself (`GET /extension/dist/installer`), so **nothing has to be
copied across the remote session** - that used to be the clumsiest step of the job.

The token travels as a HEADER, never in the URL, so it never lands in the request logs.

Then, over remote access on their machine:

1. Open a **normal, NOT administrator** shell as the machine's own user. The scheduled job is
   per-user and must run as the person whose browser it is.
2. Paste the line. It creates the folder, registers the schedule, **verifies the schedule really
   exists**, and downloads immediately so you see it work before you leave.
3. Browser -> `chrome://extensions` or `edge://extensions`
4. **Developer mode** on - in Edge the toggle is in the **left sidebar**, not the top right
5. **Load unpacked** -> `C:\Wingguy` (Mac: `~/Wingguy`)
6. Open their portal once **in that browser** - extension storage is per browser, so it knows
   nothing until you do
7. `/wg` on any LinkedIn profile. A message about a missing Anthropic key is correct behaviour,
   not a broken install.

⚠ **If the install stops with "Could not register the scheduled task"**, that is the safety net
doing its job - see the note under Traps. Do not carry on; the extension would never update.

## Checking on it

```
node scripts/extension-fleet.js
```

One row per machine: client, version on disk, last check-in. **STALE means no check-in for three
days** - that machine has stopped collecting updates, which is the failure this lane exists to
make visible. Detection matters more than the fix (the Linked Helper lesson: Roland's ran dead
for ~10 weeks because nobody noticed, not because nobody could fix it).

## Traps and honest limits

- **New files are not running code.** The browser keeps the old code in memory until it restarts
  or the client clicks the refresh arrow. So "delivered" and "running" are different things, and
  the fleet view reports what is on disk.
- **Corporate endpoint software can block the scheduled download** on a locked-down machine.
  That machine defeats every other lane too, so it is not a reason to prefer something else.
- **Deleting the folder breaks the extension.** The check-in catches it.
- **Developer-mode nagging** continues, as it does today. Milder in Edge than Chrome.
- ⚠ **A denied scheduled-task registration used to look like success.**
  `Register-ScheduledTask` raises a NON-TERMINATING CIM error, which sails past
  `$ErrorActionPreference='Stop'` - the script logged "registered" and cheerfully downloaded
  files, so an install could look perfect and never update again. Found by testing 2026-09-03.
  Both scripts now VERIFY the schedule exists after creating it and fail loudly if it does not.
  **Do not remove that verify.**
- ⚠ **The macOS script is UNPROVEN as at 2026-09-03.** It is the proven Windows logic translated,
  but the only Mac in the client base is Julian's. Walk it with him before sending it to anyone.

## Proven

2026-09-03, against a local instance of the real route with a real portal token:

- auth (401 no token, 403 bad token), listing in both JSON and text form, single-file fetch,
  nested paths (`icons/icon128.png`), path traversal refused, check-in surviving a blank
  `DATABASE_URL`
- the Windows updater end to end: empty folder → 14 files at 0.3.17, **byte-identical to
  `origin/main`**; a second run correctly did nothing; a bad token failed cleanly without
  touching the folder
- the installer endpoints (both scripts served, 401 without a token) and the one-line install
  running start to finish from a paste

**NOT proven:** that `Register-ScheduledTask` succeeds on a real client machine. The test
environment denied it, which is what exposed the silent-success bug - so the failure path is
well proven and the success path is not. Worth confirming on the first real install; the script
now tells you plainly either way.
