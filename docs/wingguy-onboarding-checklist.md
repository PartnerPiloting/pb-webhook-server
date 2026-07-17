# Wingguy client onboarding - the checklist

The end-to-end sequence for putting a new client live on Wingguy, in order. Each step says what
Guy does, what the client does, and how to verify it before moving on. Battle-tested on Julian
(pilot #1, 2026-07) - the traps below are ones that actually happened.

Related docs: [wingguy-connector-install.md](wingguy-connector-install.md) (step 2 in detail),
[wingguy.md](wingguy.md) (the living build doc).

---

## 0. Record setup (Guy, ~5 min)

- [ ] Client row on the Master Clients Base: **Active** status, **Portal Token** set, own leads base linked, **Timezone** set.
- [ ] **Wingguy Enabled = Yes** only if they're getting the Chrome extension (it gates the extension, NOT the connector).
- [ ] Decide the plan: **Managed Claude Key = Yes** (they pay Guy, drafting runs on the platform key) or blank (BYO key / own Claude subscription).
- [ ] Verify: run `scripts/wingguy-julian-preflight.js <clientId>` as a Render one-off job - all green before sending anything.

## 1. Connector (client, ~2 min)

- [ ] Send their private URL + the copy-paste message from [wingguy-connector-install.md](wingguy-connector-install.md) §2. DM or direct email - the URL is their key.
- [ ] Client adds it in claude.ai → Settings → Connectors, starts a fresh chat, types **"what can I do with Wingguy?"**
- [ ] ⚠ **Trap:** claude.ai caches a connector's tool list at connection init. After WE ship new tools, clients must disconnect/reconnect the connector and start a fresh chat to see them.

## 2. Rules session (client + Wingguy, ~20 min)

- [ ] Client types **"let's set up my rules"** (fires `wingguy_setup_rules`); Wingguy walks them through it.
- [ ] The first wow - chat-only, needs nothing else connected.

## 3. Calendar (client, ~5 min + verification)

- [ ] Client connects their calendar (Google/Outlook via Nylas hosted auth; Zoho via `/auth/zoho/start?clientId=<id>&token=<Portal Token>`).
- [ ] ⚠ **THE ZOHO ACCOUNT TRAP (bit Julian):** the consent screen binds to whoever is logged in at
      that moment. Tell them: use a private window, or check the consent screen shows the WORK
      account before approving. **Verify the account on every single Zoho client.** Re-running the
      link is safe if they got it wrong.
- [ ] **Multi-calendar scope** (roster fields): set **Calendar Read IDs = `all`** so busy checks see
      every calendar they keep (the no-double-book guarantee is only true then). Leave **Calendar
      Write ID** blank unless their meetings belong somewhere other than their default calendar.
- [ ] Verify: `scripts/wingguy-list-calendars.js <clientId>` (their calendar list + which is default),
      then `scripts/wingguy-multi-calendar-check.js <clientId>` (fields → calendars → availability →
      listing). For Zoho also `scripts/wingguy-zoho-diagnose.js <clientId>` on first connect.
- [ ] Have the client ask Wingguy **"what's on my calendar this week?"** and confirm it matches reality.

## 4. Meeting link (the onboarding conversation, ~5 min)

The policy: **one reusable personal meeting link on every invite.** Simple, unbreakable, and what
back-to-back call days are built on. We deliberately do NOT generate per-meeting links.

The talk track:

1. Ask: **"Do you have a personal meeting link?"** (Zoom calls it your Personal Meeting Room / PMI;
   Meet and Teams both let you create a reusable meeting link too.)
2. If no: **"Let's create one now"** - two minutes in any platform, do it together on the call.
3. The sell: one link, on every invite, automatically. Leads just click and they're in. Nothing to
   generate, nothing to forget, nothing to break - and back-to-back calls flow through one door.
4. While in there: turn on **waiting room** (Zoom) / **"ask to join"** (Meet) - a link that never
   changes shouldn't let a late-running lead wander into the next call.
5. Paste it into their **Meeting Link** field on the Master Clients row.

- [ ] ⚠ **Do not skip:** a blank Meeting Link means every invite Wingguy books goes out with NO join
      link. Catch it here, with them on the call - not after their first real booking goes out bare.
- [ ] While you're on that row: fill **LinkedIn URL** + **Phone** if empty (they go on the invite too).

## 5. Email (client + Guy)

- [ ] Connect their mailbox to Nylas: Gmail/Outlook via hosted auth; **Zoho mail = app-specific
      password + Nylas custom/IMAP auth** (no hosted OAuth for Zoho).
- [ ] `Nylas Grant ID` lands on their row. This unlocks the whole mail toolset: clean-link drafts,
      threaded replies, lead correspondence history, the asset-usage gate, replied-since checks.
- [ ] ⚠ IMAP grants serve mail from Nylas' ~90-day rolling cache; the tools auto-retry live IMAP for
      older windows - expect the first deep-history query to be slower, not broken.
- [ ] Verify: client asks Wingguy to find a recent message from a known sender.

## 6. Fathom (client + Guy)

- [ ] Client signs up for Fathom and gets an API key; it goes in **Fathom API Key** on their row.
- [ ] ⚠ Check first: confirm their plan actually exposes an API key, and note the Fathom ingest was
      built single-tenant (Guy) - the first non-Guy tenant likely needs a dev pass. Don't promise
      dates until both are checked.

## 7. Close-out

- [ ] Client reconnects the connector + fresh chat (picks up any tools shipped since step 1).
- [ ] End-to-end proof: client asks Wingguy to offer times for a real lead → books a test meeting →
      invite arrives with the meeting link on it → cancel it together.
- [ ] Booking rules sanity check: their booking hours, lunch hold, daily-load preference and meeting
      length all live in their prefs - confirm they match how they actually work.
