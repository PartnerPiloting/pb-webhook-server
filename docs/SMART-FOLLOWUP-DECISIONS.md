# Smart Follow-Up v1 - Design Decisions

This document captures decisions made during spec review sessions.
Updated: 2026-02-05

---

## Decision 1: Email UX Flow

**Question:** Should the system send emails directly to leads (one-click) or send drafts to the user who then forwards?

**Decision:** Send email TO THE USER, user forwards manually.

**Rationale:**
- Safest for multi-tenant (no sending on behalf of clients)
- User's own email identity/signature used
- Final human check before any lead receives message
- No SMTP credentials or domain verification needed per client
- Better deliverability (user's established email reputation)

**Flow:**
1. User refines message in Smart Follow-up UI
2. Clicks "Send to me"
3. User receives email containing: context block + lead's email + HTML message
4. User forwards from their email client (deletes context block first)
5. User clicks "Done - sent" in UI to update state

**Email Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 FOLLOW-UP CONTEXT (delete before sending)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lead: [Name]
Email: [lead@email.com]
Story: [Brief context...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✉️ MESSAGE TO SEND (forward from here)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[HTML formatted message - links and formatting preserved on forward]
```

---

## Decision 2: Follow Up Date Field

**Question:** Does Follow Up Date field exist? Should SFU block replace or sync with it?

**Decision:** Keep using the existing Airtable `Follow-Up Date` field.

**Rationale:**
- The spec proposed an SFU block because ChatGPT didn't know this field already exists
- The field is already integrated throughout the codebase
- It's queryable in Airtable (e.g., `{Follow-Up Date} <= TODAY()`)
- No migration or parsing complexity needed
- Works with existing UI and inbound email service

---

## Decision 3: Cron Notification

**Question:** Proactive email to user or just prepare data for UI?

**Decision:** No notification email. User checks the UI when ready.

**Rationale:**
- Keeps the system quiet and non-intrusive
- Avoids adding another email to user's inbox
- User forms a habit of checking Smart Follow-ups
- Data is ready when they open the UI

---

## Decision 4: AI Output Storage & Data Sources

**Question:** What storage options exist beyond Leads Airtable?

**Decision:** Create new table `Smart FUP State` in client master Airtable base.

**Structure (as created in Airtable):**
- Client ID (Primary field, single line text)
- Lead ID (single line text)
- Lead Email (email)
- Lead LinkedIn Profile (URL)
- Generated Time (date with time)
- Story (long text - AI summary)
- Priority (single select: High/Medium/Low)
- Suggested Message (long text)
- Recommended Channel (single select: LinkedIn/Email/None)
- Waiting On (single select: User/Lead/None) - see Decision 5
- Fathom Transcripts (long text)

**Behavior:**
- Upsert approach: one record per client+lead combination
- When AI regenerates, it overwrites existing record
- Table is self-managing, no cleanup job needed
- If cache is lost/stale, regenerate from Notes (source of truth)
- Not shown to users, purely for caching AI output

**AI Data Sources (v1):**
1. **Notes field** - primary source of truth
2. **Fathom transcripts** - via API integration (optional per client)

**Fathom Integration (v1):**
- Fathom has public API: `GET /recordings/{recording_id}/transcript`
- Returns speaker info, text, timestamps
- New fields in Client Master: `Fathom API Key` (optional)
- Only affects clients who opt in and provide API key
- Currently only one client (you) uses Fathom

**Fathom Implementation Details:**

| Aspect | Decision |
|--------|----------|
| When to pull | Daily sync (not on-demand) |
| Where to store | In the Smart FUP State table |
| Matching logic | Client ID + Lead email |
| Multiple recordings | API returns list by date - pull all, match by attendee email |

**Flow:**
1. Daily sync fetches all recordings from Fathom API
2. For each recording, extract attendee emails
3. Match attendee email to Lead email (by Client ID)
4. Store transcript in AI Cache for that lead
5. AI uses stored transcripts when analyzing lead

**Why full transcripts:**
- AI learns tone of both user and lead
- Earlier meetings have key context
- Better recommendations than summaries alone

---

## Decision 5: 'Waiting On' Concept

**Question:** Introduce user/lead/none tracking or too complex for v1?

**Decision:** Yes, include in v1. Store in Smart FUP State table (derived, not manual).

**How it works:**
- AI analyzes Notes (and Fathom transcripts if available)
- Determines who sent the last message
- Sets `waiting_on`:
  - `user` - lead sent last message, user owes response
  - `lead` - user sent last message, waiting for lead
  - `none` - no active thread

**Rationale:**
- Follow-Up Date is manual and may not be accurate
- `waiting_on` augments it with actual conversation state
- Stored in AI Cache, so it's derived fresh each time AI runs
- No new field on Leads table needed

---

## Decision 6: Grace Periods

**Question:** Important for v1 or overkill?

**Decision:** Skip for v1. Keep it simple.

**Behavior:**
- If `waiting_on: user`, show in queue immediately
- No silent delay after inbound replies
- User can snooze manually if they need time

**Rationale:**
- Simpler to implement and understand
- User is in control
- Can revisit for v2 if needed

---

## Decision 7: SFU Block in Notes

**Question:** Feasibility of machine-readable block in Notes field?

**Decision:** No SFU block needed. Use existing Follow-Up Date field.

**How it works:**
| Follow-Up Date | Meaning |
|----------------|---------|
| Has date (past/future) | Active - eligible for follow-up |
| Blank/empty | Not being followed up (ceased) |

**Actions:**
- **Cease follow-up:** Clear the Follow-Up Date field
- **Snooze:** Set Follow-Up Date to a future date

**Rationale:**
- Simpler than adding machine-readable blocks to Notes
- Uses existing field, no new concepts
- AI derives everything else from Notes content

---

## Decision 8: UI Simplification

**Question:** Single queue vs tabs?

**Decision:** Single queue, no tabs. With smart logic to catch missed dates.

**Queue shows leads where:**
1. `waiting_on = user` - regardless of Follow-Up Date (catches forgotten dates)
2. `waiting_on = lead` AND Follow-Up Date ≤ today (time to nudge again)
3. Recent Notes activity but no Follow-Up Date set (forgotten scheduling)

**Sorted by:**
1. Priority (High → Medium → Low)
2. How overdue (oldest Follow-Up Date first)

**Each lead displays:**
- Name
- Priority badge
- AI story summary
- Days overdue (if applicable)
- Action buttons (Send LinkedIn / Email to me / Snooze / Cease)

**Follow-Up Date reliability:**
- Don't auto-set dates (user wants considered decisions)
- AI suggests dates based on context (e.g., "You said 'next week' → suggest 7 days")
- Surface leads with recent activity but missing dates
- `waiting_on = user` overrides missing/future dates

**Rationale:**
- Simpler than tabs
- Catches human error (forgotten dates)
- AI helps but doesn't force decisions

---

## Decision 9: 'No New Fields' Constraint

**Question:** Absolute or flexible?

**Decision:** Flexible. No changes to Leads schema, but new infrastructure allowed.

**What we're adding:**

| Location | Addition |
|----------|----------|
| Leads table | Nothing new (using existing Follow-Up Date) |
| Client Master | Fathom API Key (optional) |
| New table: Smart FUP State | Client ID, Lead ID, Generated Date, Story, Priority, Suggested Message, Recommended Channel, Waiting On |

**Priority Logic (AI-determined):**

| Priority | Signals |
|----------|---------|
| Highest | `waiting_on = user` - they replied, you owe response |
| High | Had meeting, then silence / Agreed to meet, then went quiet |
| Medium | You reached out, generic silence |
| Low | Cold lead, no real engagement |

**Additional factors:**
- Recency of silence (7 days > 2 days)
- Engagement level before silence
- Context from Notes and Fathom transcripts

**Refinement approach:**
- Priority logic will be tuned through real usage
- Edge cases discovered and addressed as they arise

---

## Decision 10: Client Types & Follow-Up Philosophy

**Question:** Should different clients have different follow-up philosophies?

**Decision:** Yes. Implement Client Types in code, with client-specific settings in Airtable.

**Architecture:**

| Layer | What it controls | Where it lives |
|-------|------------------|----------------|
| Client Type (A/B/C) | Follow-up philosophy, decision logic, brain behaviour | Code |
| Client Settings | Templates, wording, tone, spelling, signature | Airtable (per client) |

**Client Types:**

**Type A - Partner-Selection / Leadership (v1 - implement first)**
- Early conviction over perfect timing
- Energy as filter - comfortable losing people who don't resonate
- Selection > reply rate
- Leadership signalling, not chasing
- "Come with me if this resonates" posture
- Enthusiasm is intentional, not accidental
- Optimised for people who respond to conviction, momentum, direction

**Type B - Client-Acquisition / Conversion (v2 - add later)**
- Softer sequencing
- Nurture before conviction
- Reply rate matters more
- Optimised for momentum and pipeline

**Type C - Mixed / Per-Lead Selection (v3 - add later)**
- Client has leads that could be either partners or clients
- Per-lead specification of which philosophy applies
- UI allows choosing A or B mode per lead

**Critical Design Rules:**
1. Client Type is set in Client Master Airtable (field: `Client Type`)
   - Options: "A - Partner Selection", "B - Client Acquisition", "C - Mixed (per lead)"
   - Code extracts first letter (A/B/C) for logic
2. Code reads Client Type and switches brain behaviour accordingly
3. Types are mutually exclusive - no sliding scale or blending
4. Airtable controls expression (how it sounds), Code controls philosophy (how it decides)
5. Client-specific instructions stored in `FUP AI Instructions` field

**Why this matters (from user insight):**

Default AI posture (polite, maximize replies, avoid friction) is WRONG for Type A clients. Without explicit override, the brain would:
- Optimise for reply rate
- Avoid friction
- Choose politeness over conviction
- Defer strong signals "until appropriate"

Type A deliberately rejects this. The system must respect that leadership energy is a feature, not a bug.

**Key quote to preserve:**
> "The Smart Follow-Up system is optimised for partner selection via early, confident leadership signalling, not for maximising reply rates. This posture is a core behavioural invariant."

**For AI Coder:**
> "Implement explicit client archetypes in code (e.g. Partner-Selection vs Client-Acquisition). Archetype selection determines follow-up philosophy and decision logic; Airtable may only adjust expression within the chosen archetype."

---

## Decision 11: Client AI Instructions Field

**Question:** How should client-specific AI instructions (tone, spelling, templates, etc.) be stored?

**Decision:** Single field in Client Master: `FUP AI Instructions`

**Why one field (not multiple):**
- System reads one field per client from Client Master
- Simpler implementation
- Flexible - client structures content however they want
- AI handles interpretation

**Field contains (all in one text block):**
- Tone rules
- Spelling preferences (e.g., "Use Australian spelling")
- Signature block
- Message templates
- Personalization instructions
- Phrases to avoid
- Any other AI guidance

**Example content:**
```
Message to be between 300 to 500 characters
Use Australian spelling
Use "-" rather than long dash

Always use My Signature which is:
Talk soon
I know a (Guy)

[Templates and personalization instructions...]

Remove "that really resonates" or similar - saying "love..." is enough
```

**How it works:**
1. Code reads `AI Instructions` field for the client
2. Passes it to AI as part of the prompt context
3. AI follows whatever instructions are in there

**Client responsibility:**
- Structure and maintain their own instructions
- Refine based on output quality
- AI handles unclear/incomplete instructions gracefully

---

## Decision 12: Nudges Library

**Question:** How do we help users re-engage leads who went quiet after showing interest?

**Decision:** Implement a Nudges Library - compelling hooks stored in Airtable that AI combines with Fathom transcript context.

**What is a nudge:**
A timely, relevant reason to reach out beyond "just checking in":
- New feature/offering
- Upcoming workshop/event
- Case study or success story
- Industry insight
- Anything that gives the lead a reason to re-engage

**Where nudges are stored:**
- In Airtable (part of AI Instructions or separate field)
- Per client - each client maintains their own nudge library
- Should include date/freshness to avoid stale nudges

**How AI uses nudges:**

1. AI reads Fathom transcript - identifies what lead was excited about / concerned about
2. AI reads available nudges from client's library
3. AI matches relevant nudge to lead's interests
4. AI generates message combining:
   - Personal context from transcript
   - Relevant nudge
   - Natural, leadership-energy tone

**Example output:**
> "Really excited to catch up and hear how you're going with [thing from transcript]. I'm also keen to tell you about [nudge] - I think it plays right into what we discussed around [topic from transcript]."

**Chat interaction in Smart Follow-up UI:**
- User: "List the nudges we have"
- AI: "1. New partnership model, 2. Workshop Feb 20, 3. Case study..."
- User: "Use nudge 2, roughly like 'excited to tell you about the workshop...'"
- AI: Generates refined message incorporating that nudge + transcript context

**Why this is high value:**

Most follow-ups fail because they are:
- Generic ("circling back")
- Tone-deaf (irrelevant to recipient)
- Empty (no reason to reply)

Nudges + transcript context solves all three.

**Risks and mitigations:**

| Risk | Mitigation |
|------|------------|
| Stale nudges | Date-stamp them, keep library updated |
| Feels salesy | AI varies approach, doesn't always use a nudge |
| Thin transcript | Fallback to Notes-only context |

---

## Decision 13: Smart FUP State Table Lifecycle

**Question:** When should records in Smart FUP State be deleted?

**Decision:** Don't delete. Let records go "stale" and overwrite when needed.

**Behavior:**
- Records persist even when lead is ceased or date pushed to future
- When lead becomes due again, cron runs and overwrites stale record
- Table is self-managing through upserts

**Rationale:**
- Simpler - no delete logic needed
- No harm - UI filters anyway
- If user un-ceases a lead, we just regenerate
- Avoids race conditions

---

## Decision 14: AI Suggested Follow-Up Date

**Question:** Should AI suggest follow-up dates separately from user-set dates?

**Decision:** Yes. Add two fields to Smart FUP State table.

**New fields:**
- `AI Suggested FUP Date` (date) - AI's recommendation
- `AI Date Reasoning` (text) - e.g., "They said 'next week' on Feb 3"

**Behavior:**
- AI suggestion is advisory only
- Does NOT change the `Follow-Up Date` in Leads table
- User can "Accept" suggestion in UI → copies to Leads table
- If user ignores, nothing happens automatically

**User date precedence (Option C):**
- If user has set a Follow-Up Date, never second-guess it
- AI only generates suggestions when no date is set
- Keeps system quiet and trustworthy

---

## Decision 15: Safety Net for Forgotten Dates

**Question:** How do we catch leads with activity but no Follow-Up Date?

**Decision:** Two-stage filter with 14-day window.

**Stage 1 - Airtable filter (broad):**
```
AND(
  OR({Cease FUP} != 'Yes', {Cease FUP} = BLANK()),
  OR({Follow-Up Date} = BLANK(), {Follow-Up Date} = ''),
  LAST_MODIFIED_TIME() >= DATEADD(TODAY(), -14, 'days')
)
```
Returns ~50-100 candidates, not 12k+.

**Stage 2 - Code/AI filter (smart):**
- Examine Notes content
- Does it contain conversation indicators? (message timestamps, LinkedIn conversation, etc.)
- If no → Skip (probably just data cleanup)
- If yes → AI generates suggested date, include in queue

**Rationale:**
- Efficient (Airtable does heavy lifting)
- Accurate (AI confirms it's actually a conversation)
- No false positives from typo fixes or email updates

---

## Decision 16: Updated Smart FUP State Table Schema

**Final field list:**

| Field | Type | Purpose |
|-------|------|---------|
| Client ID | Single line text (Primary) | Client identifier |
| Lead ID | Single line text | Airtable record ID |
| Lead Email | Email | For Fathom matching |
| Lead LinkedIn Profile | URL | For quick access |
| Generated Time | Date with time | When AI last ran |
| Story | Long text | AI summary of relationship |
| Priority | Single select (High/Medium/Low) | AI-determined urgency |
| Waiting On | Single select (User/Lead/None) | Who owes next action |
| Suggested Message | Long text | AI-generated follow-up message |
| Recommended Channel | Single select (LinkedIn/Email/None) | Best channel for this lead |
| Fathom Transcripts | Long text | Stored meeting transcripts |
| AI Suggested FUP Date | Date | AI's recommended follow-up date |
| AI Date Reasoning | Long text | Why AI suggested this date |

---

---
---

# APPENDIX: Original Spec (ChatGPT-written)

> **Context:** This spec was written by ChatGPT without access to the codebase.
> It defines intent, structure, and invariants - not implementation details.

---

## Smart Follow-Up v1 - Structural & Behavioural Specification

### 1. Purpose of Smart Follow-Up

Smart Follow-Up exists to solve one problem only:

**Help the user notice when they owe a follow-up, without nagging, noise, or automation errors.**

It is not:
- a CRM pipeline
- a tagging system
- a scoring engine
- an automation tool
- a messaging bot

The system must always feel calm, trustworthy, and human-controlled.

### 2. Core invariants (must never be violated)

These are non-negotiable.

- AI never changes lead state
- Only explicit user actions change state
- No messages are ever auto-sent to leads
- No new fields are added to the Leads schema
- All durable state lives in the existing Notes field
- AI output is opinionated, ephemeral, and disposable
- If unsure, the system does nothing

If any implementation would violate one of these, stop and ask.

### 3. Data boundaries (very important)

#### 3.1 System of record (truth)
- The existing Leads table
- The existing Notes field
- This is the only durable truth

#### 3.2 Persistent state (minimal, explicit)
Persistent follow-up state is stored inside Notes, using a machine-readable block.
Nothing else is persistent.

#### 3.3 AI output
AI output is:
- derived
- regenerable
- non-authoritative
- safe to delete

It must not be treated as truth.

### 4. SFU state block (pseudo-fields in Notes)

All persistent state is stored in a single block at the bottom of Notes.

#### 4.1 Required format
```
---
[SFU]
status: active | paused | ceased
waiting_on: user | lead | none
last_action: linkedin_sent | email_sent | meeting_booked | none
last_action_at: YYYY-MM-DD
next_follow_up: YYYY-MM-DD
[/SFU]
```

#### 4.2 Rules
The SFU block:
- must be appended or replaced atomically
- must never be interleaved with human notes
- Human notes above the block must never be rewritten

If no SFU block exists:
- treat the lead as status=active
- treat it as eligible for evaluation

If this block is malformed or missing fields, do not guess — ask.

### 5. AI output storage (ephemeral, multi-tenant)

AI output must be stored outside the Leads table, in a single internal store shared by all clients, keyed at minimum by:
- client identifier
- lead identifier
- run date (or equivalent)

The storage technology is flexible (internal DB, internal Airtable base, etc.), but it must satisfy:
- safe to wipe
- regenerated daily
- not client-visible
- not relied on as history

If this conflicts with existing infrastructure, propose an alternative.

### 6. Daily evaluation (cron or equivalent)

Once per day, per client:
1. Load leads
2. Parse Notes
3. Extract SFU state if present
4. Select candidate leads for evaluation

#### 6.1 Candidate lead selection (intent, not exact logic)

A lead is a candidate if any of the following are true:
- No SFU block exists
- status=active AND next_follow_up <= today
- Notes have changed since last evaluation
- A meeting appears to have occurred but no follow-up action is logged

Over-selection is worse than under-selection.
If unsure, skip the lead.

### 7. AI input contract (per lead)

AI is given:
- Full Notes text (including message logs)
- Parsed SFU state
- Time since last action
- Time since last inbound message (best available heuristic)

#### 7.1 AI instruction constraints
- AI must ignore SFU content when summarising
- AI may use SFU content only for state awareness
- AI must not infer that a message was sent
- AI must not change or suggest state transitions

### 8. AI output contract (what the AI returns)

AI returns recommendations only, including:
- Story so far (1–2 short paragraphs)
- Who is waiting on whom
- Is action needed now (yes / no)
- Recommended channel (LinkedIn / Email / None)
- Priority (High / Medium / Low)
- Suggested message:
  - LinkedIn: short, copy-paste text
  - Email: subject + body (simple HTML)

This output is not persisted to Notes.

### 9. Smart Follow-Up UI (behavioural requirements)

The UI shows only leads where the user owes an action now.

For each lead, display:
- name
- priority
- AI story so far
- suggested message

Available user actions:
- Send LinkedIn message
- Create email draft
- Snooze
- Cease follow-up

No bulk actions.
No filters.
No auto-refreshing state changes.

### 10. LinkedIn action flow (explicit)

When the user:
1. Sends a LinkedIn message externally
2. Logs that message in Notes (existing behaviour)
3. Clicks "LinkedIn message sent – waiting on lead"

Then and only then:
- Update SFU block:
  - last_action = linkedin_sent
  - waiting_on = lead
  - last_action_at = today
  - next_follow_up = today + ~7 days
- Remove lead from the visible queue immediately

### 11. Email action flow (explicit)

#### 11.1 Before any email exists
- User sees the fully formatted email in the UI
- User may refine it (AI-assisted or manual)
- No email is created yet

#### 11.2 Create email draft
When user clicks Create email draft:
- System sends an email to the user, not the lead
- Email must contain:
  - a clear meta block: lead name, lead email address, reminder context
  - the actual email content (simple HTML only)
- No state is changed yet.

#### 11.3 After sending to the lead
Only when the user confirms "Done – email sent":
- Update SFU block:
  - last_action = email_sent
  - waiting_on = lead
  - last_action_at = today
  - next_follow_up = today + ~7 days

### 12. Inbound replies

When the user logs an inbound reply in Notes:
- Update SFU: waiting_on = user
- Do not surface immediately
- Start a silent grace period:
  - LinkedIn: ~24–48 hours
  - Email: ~24 hours
- Only surface if the user does not respond within the grace period.

### 13. Snooze & cease

**Snooze:**
- User chooses duration (e.g. 7 / 14 / 30 days)
- Update next_follow_up
- Remove from queue

**Cease follow-up:**
- Set status=ceased
- Never surface again unless manually changed

### 14. Anti-patterns (explicit "do not" list)

The system must not:
- infer actions
- auto-advance state
- auto-send messages
- write AI output into Notes
- add schema fields
- create hidden state
- surface leads "just in case"

If unsure, do nothing.

### 15. Success criteria (human-level)

This is successful if:
- The user can clear follow-ups in ~15–30 minutes
- Leads disappear immediately after action
- Nothing reappears prematurely
- The user trusts the system
- The system feels quiet, not clever

---

*End of specification*
