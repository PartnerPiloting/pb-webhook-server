# Krisp Transcript Workflow — Reference Guide

**Partner Piloting / pb-webhook-server**  
*High-level overview: why Krisp, how data flows, what to test, and where Claude fits next.*

---

## 1. Why we use Krisp

Krisp records and transcribes coaching calls so you get a **reliable text record** without manual note-taking during the conversation. The webhook delivers each transcript to our server as structured JSON; we **store it**, **match it to calendar and CRM where possible**, and route it through a **human review step** before we trust speaker names, splits, and downstream AI.

Krisp is the **capture layer**. It is not the analysis layer—that is intentionally separate so we can swap or combine models (e.g. Gemini today for split/speaker hints; **Claude planned** for summaries, advice, and drafts).

---

## 2. What “success” looks like (plain English)

1. You finish a call; Krisp sends a webhook.  
2. We save the **raw payload** forever (immutable).  
3. We create one **meeting** row with the extracted transcript text—that is what you review.  
4. We try to **link participants to Airtable leads** by email (and name in some cases).  
5. Calendar overlap and optional AI may flag **back-to-back** calls so you can **split** one meeting into several.  
6. You **verify speakers** (names/emails) in the portal when needed and set status to **Verified**, **Skipped**, or leave **To verify**.  
7. Leads see linked transcripts on their **lead detail** panel in the portal.  
8. **Next phase:** feed cleaned transcript + context into **Claude** for summaries, coaching advice, and email drafts **in the tone of the participants** (not implemented as a single “go” button yet—this is the product direction).

---

## 3. Database structure (three tables)

| Table | Role | Think of it as… |
|--------|------|------------------|
| **`krisp_webhook_events`** | One row per Krisp POST. Full **`payload` JSONB** unchanged after insert. | The **audit trail** and legal/technical source of truth. |
| **`krisp_meetings`** | One row per **logical conversation** after ingest. Holds **`transcript_text`**, **`status`**, **`needs_split`**, optional line range, title, times. | The **review queue** and what you split. |
| **`krisp_meeting_participants`** | Rows per meeting: speaker label, verified name/email, optional **`airtable_lead_id`**, match method. | **Who was on the call** and **CRM linkage**. |

**Relationships**

- Every meeting points to exactly one **`webhook_event_id`** (same raw recording can spawn **multiple meetings** after splits).  
- **`krisp_event_leads`** was removed; participant rows replaced that plus the old `verified_speakers` JSON on events.

**Alerts (dedup)** stay on **`krisp_webhook_events`** (e.g. conversation email “already sent”) so you do not get duplicate pings per split child.

---

## 4. End-to-end workflow

```
Krisp → POST /webhooks/krisp
         → INSERT krisp_webhook_events (raw)
         → INSERT krisp_meetings (transcript + defaults)
         → linkKrispEventToLeadsByEmail (Airtable lookup only)
         → upsert krisp_meeting_participants for matched leads
         → HTTP 200 to Krisp quickly
         → async: calendar overlap, Gemini analysis, setMeetingIngestStatus, conversation email
```

**Review (portal / API)**

- Queue: **`GET /krisp-review/api/queue`** (defaults to **to_verify**).  
- Detail: **`GET /krisp-review/api/event/:meetingId`**.  
- Save speakers: **`POST .../speakers`** → updates participants, may attach leads, sets status **verified**.  
- Split: **`POST .../split`** with **`splitAtLine`** → trims parent meeting text, creates second meeting with remainder.  
- Re-run AI: **`POST .../analyze`**.

---

## 5. Where transcripts are available

| Surface | What you get |
|---------|----------------|
| **Next.js portal — Krisp Review** (`/krisp-review`) | Queue + per-meeting review, speaker grid, split mode, AI assist. |
| **Lead detail — Krisp panel** | Meetings where that lead appears in **`krisp_meeting_participants`** (by `airtable_lead_id`). |
| **Admin HTML** (`/krisp-review`, `/krisp-portal`) | Simpler list / raw event copy (secret auth). |
| **Email after ingest** | Light notification + **link to portal review** (meeting id), not full transcript in body. |
| **Signed public links** (if configured) | View/fix flows tied to **webhook event id** in token—separate from meeting id; know which link type you are using. |

---

## 6. Status model (meetings)

| Status | Meaning |
|--------|---------|
| **to_verify** | Needs your attention or system could not auto-verify. |
| **verified** | Speakers saved (or strong auto-link + calendar path set this). |
| **skipped** | You chose to skip review for this meeting. |

**`needs_split`** is a flag (often from **two+ overlapping timed calendar events** or **AI**), not a status—action is manual split in the UI.

---

## 7. Back-to-back calls and splits

- One Krisp recording can contain **multiple real meetings**.  
- We **do not** mutate the raw webhook row’s payload for splits; we **only** change **`krisp_meetings.transcript_text`** (and add another meeting row).  
- After two splits you might have **three meetings**, all sharing one **`webhook_event_id`**.

---

## 8. What to test (checklist)

**Ingest**

- [ ] Webhook returns **200** quickly; Krisp does not time out.  
- [ ] New row in **`krisp_webhook_events`**; new row in **`krisp_meetings`**.  
- [ ] Transcript text matches what you expect from **`extractKrispDisplayText`**.

**Linking**

- [ ] Participant emails in payload → **participant rows** + **`airtable_lead_id`** when lead exists.  
- [ ] Lead panel shows the meeting with correct **status badge**.  
- [ ] Unmatched participants still trigger **unmatched alert** behaviour if configured.

**Review**

- [ ] Queue default **to_verify**; filters work (**all / verified / skipped**).  
- [ ] Speaker save updates DB and sets **verified**.  
- [ ] Split at line *N* creates child meeting; parent text truncated correctly.

**Email**

- [ ] Conversation email fires once per webhook (dedup on event).  
- [ ] Link opens **correct meeting** in portal (`reviewId` = meeting id).

**Edge cases**

- [ ] No `DATABASE_URL` → graceful skip (no crash).  
- [ ] Calendar unavailable → status/reason still sensible.  
- [ ] AI unavailable → ingest still succeeds; optional flag may be missing.

---

## 9. Roadmap: Claude on transcripts (planned direction)

**Goal:** Take the **reviewed** (or at least **speaker-labeled**) transcript, strip **noise** (filler, duplicates, obvious ASR glitches where safe), and run a **Claude** (or similar) pipeline to produce:

- **Executive summary** of the call  
- **Action items and advice** aligned with coaching context  
- **Draft emails** (follow-ups, recaps) **in the style and tone of the participants**—using verified names/emails and optional CRM fields as constraints  

**Design notes**

- Raw webhook stays immutable; **meetings** hold the text we feed forward.  
- Prefer **gated** flow: only after **verified** (or explicit “generate” button) to avoid drafting on wrong speakers.  
- Keep **human edit** step before any automated send; email drafts are **suggestions**.

---

## 10. Key environment / integration reminders

- **Krisp:** `KRISP_WEBHOOK_INBOUND_SECRET` (or `PB_WEBHOOK_SECRET`) for inbound auth.  
- **Postgres:** `DATABASE_URL` — required for persistence.  
- **Calendar matching:** service account + client’s Google Calendar email from Airtable (or env override).  
- **AI (Vertex / Gemini):** used for **split detection** and **speaker hints** on ingest/review—not yet the Claude summarisation layer.  
- **Portal auth:** `x-portal-token`, `x-client-id`, or admin/dev key for review API.

---

## 11. One-page mental model

**Krisp = microphone + transcript factory.**  
**Postgres = raw archive + meetings + people.**  
**Portal = quality gate.**  
**Claude (next) = thinking partner on clean text.**

---

*Regenerate the PDF after editing this file:* `pip install fpdf2` then `python scripts/generate-krisp-guide-pdf.py` (writes `docs/KRISP-TRANSCRIPT-WORKFLOW-GUIDE.pdf`).*
