# ASH LinkedIn Outreach Extension - Build Plan & Constraints

> **Purpose of this file:** A handoff brief for Claude Code. It captures the decisions and constraints we landed on in planning, *not* the reasoning behind them. Read this, then read the existing codebase, then reconcile the two (see "First job" at the bottom). Treat this plan as a proposal to be tested against the real code - not a spec to execute blindly.

---

## 1. The problem we are solving

ASH (Australian Side Hustles) does LinkedIn outreach built on a personalised "thanks for connecting" approach. Personalised messages massively outperform the old generic auto-send, but personalising takes effort.

There are two client types, and they have opposite working styles:

- **Type 1 - One-man bands.** See the value of network-building and will do the grunt work themselves, even after hours. They want power and control.
- **Type 2 - "Mr Busy".** Runs a bigger business, sees the value, but realistically will not do the legwork. He will answer warm leads and is open to an outsourcer (a VA) doing the work for him.

Two friction points drive the whole design:

1. **Mr Busy won't do it unless it is nearly effortless** - so the personalised approach only reaches him if a VA can do it in seconds, not minutes.
2. **The current personal workflow is clunky** - manually tracking where you are up to in LinkedIn connections, opening each profile in a separate window, running the AI Blaze prompt, then hunting down the lead's record in the portal to update it and set a follow-up date. The drafting itself is fast; the switching, finding and bookkeeping around it is what eats the time.

## 2. The core insight (the thing the whole build hangs on)

**Separate the skilled judgment (qualifying + drafting) from the dumb bookkeeping (tracking, finding records, setting follow-ups). Automate the bookkeeping to zero. Shrink the remaining human action to a single approve-click.**

Once that is done, it does not matter whether the person clicking approve is Guy, Mr Busy, or Mr Busy's VA - they are doing seconds of work, not minutes. **So we build it once.** The workflow built for Guy *is* the product sold to Mr Busy. Do not design them twice.

## 3. Build order (do not skip the sequence)

1. **Prove the brains first.** Build a backend endpoint: profile text in -> qualifier verdict + (if yes) drafted message + Airtable upsert keyed on LinkedIn URL -> out. Validate it on a handful of real leads with rules sitting in simple config (or hardcoded) before anything else. This de-risks everything - do not debug UI and logic at the same time.
2. **Add the versioned-rules layer** (section 6) - needed before onboarding any external Mr Busy.
3. **Build the Chrome extension shell** (section 5) - the convenient front door bolted onto the proven engine.
4. **Mr Busy batch + VA queue** (section 8).
5. **Refinement-as-observation** (section 6) - a month-three feature, needs history to have accumulated first.

## 4. The two-prompt split (keep them separate)

- **Qualifier prompt** - one job: is this person worth a thanks-for-connecting? Returns a verdict (yes/no), the classification (Employee / Consultant-Business Owner / Both), and a one-line reason. Cheap. Can run in overnight batch.
- **Drafter prompt** - the existing AI Blaze prompt, kept *untouched*. Writes the message in Guy's voice with all formatting rules.

Reasons for the split: run the cheap qualifier in batch across a whole pending list and only spend the heavier drafting call on the ones that pass; tune each prompt independently without one change risking the other. **Do not blend them into one prompt.**

> NOTE: The canonical drafter prompt (the AI Blaze prompt) currently lives in Notion and should be treated as the backbone of the drafting layer. It needs to be pulled in as the source of truth for the drafter.

## 5. The Chrome extension (the front door)

A sidebar that opens when the user visits a **LinkedIn profile OR a Sales Navigator profile**. The user can dismiss it.

**How a Chrome extension does this, mechanically:** a *content script* runs inside the page the user already has open and reads what is on screen (About section, experience, name, profile URL). It is NOT scraping from outside or logging in separately - it reads the page the user is already looking at, as them, at human pace. A *side panel* shows the draft + edit box + approve button. A *background worker* talks to the backend (Claude endpoint) and the MCP server (Airtable).

**Panel UX:**
- A shortlist of lettered options (A. ... B. ... C. ...) **plus** a free-form instruction box. Letters = fast no-thinking path for the VA; free-form = override power for Guy.
- **The lettered options must be dynamic, not fixed.** Their content depends on the qualifier verdict (clear yes -> "A. draft the message"; maybe -> "A. softer opener / B. skip, here's why"; already messaged -> different options again). Lettered for speed, but the system decides *which* letters based on the verdict.
- Editable draft -> approve -> message goes into the LinkedIn box AND Airtable upserts in one action.

## 6. The rules system (Postgres, versioned, seed-then-diverge)

Move rules out of Notion into a Postgres database the prompts read at runtime - single source of truth shared by the personal extension and the batch queue.

**Critical: rules are append-events, not editable text.** Never overwrite a rule. Each rule is a row: ID, text, version number, status (proposed / active / retired), timestamp, one-line "why". An update writes a *new row* (version+1, status "proposed"); the system keeps reading the active version until the user confirms; confirm flips new->active and old->retired. Nothing is ever destroyed. This kills the "mess at the back" - exactly one version of each rule is active at any moment, with full queryable lineage and one-click revert.

**Cold start = seed, then diverge.** A new Mr Busy has no rules and will not write them, so an empty start is a dead start. Every new instance is **forked from Guy's master ruleset** at signup - it works as well as Guy's from day one because it *is* his. The instance then diverges as the client/VA tweaks. Master improvements seed *new* clients only - they are NOT auto-pushed into existing instances (that would overwrite accumulated tuning). If a client ever wants the latest master, that is another *proposed* change they confirm - never silent.

For Guy's very first setup, "from scratch" is the one genuinely manual step: translate the existing Notion rules into structured rows once = master v1.

## 7. The three layers and the single write-door

Three independent pieces, each with one job:

- **Dialogue** - discusses a proposed rule change before committing. Takes the user request + current ruleset, works out which rule it touches, **checks for conflicts with existing rules** (this conflict-catching is the main value - contradictory rules are the biggest source of mess), and comes back to confirm or flag. Build it to be a little suspicious, not just a polite confirm.
- **Commit** - the only thing that writes to the rules table, and only ever on a confirmed proposal.
- **History** - a **separate, append-only** log that observes every committed change: raw user request, system interpretation, old->new rule versions, timestamp, confirm. Separate so a bug in the change logic cannot corrupt the audit trail.

**The decision that makes or breaks it:** only the commit layer writes to the rules table, only on a confirmed proposal. Dialogue proposes, history observes, refinement reads - none of them touch live rules directly. One door into the rules, locked by a human confirm.

**Refinement = observation, not authorship (at first).** History makes patterns visible ("you've tweaked this rule 4 times in 3 weeks"). The system may *surface the pattern and ask* - it must NOT propose-and-auto-apply. Anything it later suggests goes back through the same dialogue-and-confirm gate. Never silent.

## 8. Mr Busy batch + VA queue

- Capture profile text into Airtable (a button, or LinkedHelper's connection sync).
- The same engine generates personalised drafts overnight in **batch** against pending leads, stored against the records.
- The VA does a fast first pass on **only the qualified leads**, each with its reason line, approving or tweaking, and passing standouts up to Mr Busy.
- Approved drafts feed Mr Busy's **own LinkedHelper** (per-row custom-message field) so the **send stays inside his own account/session**.

This turns a thing Mr Busy would never do into a sellable done-with-you service on infrastructure already built.

## 9. Access gating (get this right at the start)

**Gate on "authorised to act on behalf of an active subscription" - NOT "is this user a subscriber".** The VA operates the panel but the VA is not the subscriber (Mr Busy is). A subscription has multiple authorised **seats** (Mr Busy + his VA); the panel checks seat-authorisation.

The check must be **server-side** - a Chrome extension runs on the user's machine, so anything checked locally can be bypassed. The backend that holds the rules and does the drafting also enforces "are you allowed to be here", checked per session.

Same shape of mistake to avoid throughout: assuming "user = subscriber" or "user = owner of these rules". True for Guy, false for the product.

## 10. Calendar

Surface the relevant person's open slots and **drop them into the draft** - on LinkedIn you cannot book into the other person's calendar, only propose times or share a booking link. Fits Guy's rule: always name the format (Zoom), give specific slots, earliest 9:30am AEST, offer three across different days.

**Whose calendar matters:** for Mr Busy it is *his* calendar the VA offers from, so this is a per-instance setting, not universal.

## 11. The iron constraint (repeat everywhere)

**Reading and sending on LinkedIn stay inside a real, human-paced browser session.** There is always a human at the glass for those two moments - for Guy and for Mr Busy's VA. Never scrape-and-send headless server-side (gets accounts throttled/banned). Automate everything *between and around* the read and the send; never the read or the send themselves. This is the one irreducible human cost and it is a low one.

## 12. Stickiness philosophy

The moat is NOT the prompt (copyable). It is the **accumulated, tuned state**: each client's pipeline history, refined rules, follow-up cadence, record of who replied and booked. Not portable - leaving means abandoning a tuned asset built over months. Build the *good* kind of stickiness (costly to leave because of accumulated value) and **still offer clean export** - never lock-in by trapping data, which breeds churn the moment a competitor offers clean migration.

Build for the *usage* wow (it never loses your place, follow-ups never slip, records always current), not just the *demo* wow (the one-click theatre). Lead sales with the demo moment; build the product for the unglamorous reliability. Instrument the proving step to measure it: time-per-lead and follow-ups-missed, before and after.

---

## Known infrastructure (verify against the actual repo)

- MCP server: `inmail_mcp/` (FastMCP), hosted alongside the `pb-webhook-server` repo.
- Stack: Render, Vercel, Google Cloud, Airtable.
- Airtable Leads: base `appXySOLo6V9PfMfa`, table `tbluGVPzz6XYbqtLD`. LinkedIn URL field = `fldwC8NfmL84YoaoT` (the upsert key). Status = `fld1X6maghlJlpY8h`, Follow-up Date = `fldtGi5EFfG4RZA9o`. Always `typecast:true`.
- Existing transcript pipeline: Recall.ai via MCP.
- Rules currently live in Notion (the AI Blaze drafter prompt, outreach rules, follow-up rules, intro templates) - these are the source for master v1 of the Postgres ruleset.
- Follow-up loop: a daily Render cron over Airtable pulling leads where Follow-up Date <= today and status = awaiting reply, surfacing a "due today" digest/view. Do NOT try to detect LinkedIn replies programmatically (ToS-risky and flaky) - replies land in the inbox; inbox triage is a separate small human queue.

## Writing / formatting rules (apply to any generated copy)

- Australian spelling.
- Simple short dash " - " only. Never em or en dash.
- Each sentence on its own line in email drafts.
- Email draft workflow: show in chat first, push to Gmail only on explicit go-ahead.
- Use "recommending" not "selling".
- Sign-off: "(I know a) Guy."

---

## First job in Claude Code (do this before building anything)

**Survey and reconcile - do not start building.**

Read this plan, then read the existing codebase (start with `inmail_mcp/` and the `pb-webhook-server` structure, and how Airtable writes are currently done). Then answer:

1. Where does this plan **duplicate** something that already exists (e.g. an Airtable-write path, an MCP endpoint)?
2. Where does it **conflict** with how the code is already structured?
3. Where should **the plan change to fit reality** rather than the code being bent to fit the plan?

Then propose a revised build order for step 1 (the proving endpoint) that reuses what is already there.
