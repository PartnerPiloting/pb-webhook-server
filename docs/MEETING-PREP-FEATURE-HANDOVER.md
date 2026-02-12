# Meeting Prep Feature – Handover Document

**Purpose:** Use this document to start a new chat to implement the Meeting Prep feature. It builds on patterns from Smart Follow-ups and related systems.

---

## 1. Feature Overview

**Problem:** As call volume grows, you have many calls a day with leads: brand new leads, second calls, people who have come onto the system. You need quick, contextual prep before each call.

**Solution:** Add a **"Meeting Prep"** button (alongside existing "+ Add Note", "Book Meeting", "Edit Notes") that opens a **smart chat** which:

- Detects what stage the lead is at (first call, second call, new vs returning, etc.)
- Surfaces key points from notes
- Accesses all lead notes
- Fetches Fathom meeting transcripts via API (for past calls with this lead)
- Provides suggestions and context
- Incorporates instructions from a field in the Client Master (per-client prep guidance)

---

## 2. Button Location

The button sits in the **Notes section** next to:

- **+ Add Note** (green) – links to Quick Update
- **Book Meeting** (purple) – links to Calendar Booking
- **Edit Notes** (blue) – opens inline note editing

**Files to modify:**

- `linkedin-messaging-followup-next/components/LeadDetailForm.js` – lines ~472–497 (primary location)
- `linkedin-messaging-followup-next/components/TopScoringPosts.js` – similar button row (lines ~380–401)
- `linkedin-messaging-followup-next/components/QuickUpdateModal.js` – may also need the button if lead context is shown there

Add **Meeting Prep** (e.g. amber/orange styling) that opens the smart chat, either as a modal or a dedicated page.

---

## 3. Technical Context – What Already Exists

### Fathom Integration

- **Service:** `services/smartFollowUpService.js`
  - `fetchFathomTranscripts(email, fathomApiKey)` – fetches meetings from last 90 days, filters by invitee email, returns formatted transcripts
  - Fathom API base: `https://api.fathom.ai/external/v1`
  - Params: `include_transcript=true`, `include_summary=true`, `created_after` (90 days ago)
  - Transcript format: `[timestamp] SpeakerName: text` per utterance

- **Client data:** `fathomApiKey` lives in Client Master (Clients table) and is loaded in `clientService.js` alongside `fupInstructions`.

### Client Master / Instructions

- **Table:** Clients (Master Clients base)
- **Fields:**
  - `FUP AI Instructions` – used for Smart Follow-up AI context
  - `Fathom API Key` – used for transcript fetch
  - You may want a new field: **"Meeting Prep Instructions"** or similar for call-prep-specific guidance

### Smart Follow-ups Chat Pattern

- **Frontend:** `linkedin-messaging-followup-next/app/smart-followups/page.tsx` – chat-style UI with Gemini
- **Backend:** `routes/apiAndJobRoutes.js` – `/api/smart-followups/generate-message` (POST)
- **Pattern:** Send `context` (story, waitingOn, priority, notes, fathomTranscripts) + optional `query` for free-form Q&A
- **Gemini:** Uses `config/geminiClient.js`; same pattern as calendar-chat

### Calendar Chat Pattern

- **Page:** `linkedin-messaging-followup-next/app/calendar-booking/page.tsx` – good example of chat + calendar integration
- Uses Gemini for conversational flow and context

---

## 4. Data Sources for Meeting Prep

| Source | How to Access | Notes |
|-------|----------------|-------|
| Lead Notes | Lead record `Notes` field | Full conversation history, sections (meeting, etc.) |
| Fathom transcripts | `fetchFathomTranscripts(leadEmail, fathomApiKey)` in smartFollowUpService | Past meetings with this lead (90 days) |
| Client instructions | Client Master → new field or reuse `FUP AI Instructions` | Per-client prep philosophy |
| Lead metadata | First Name, Last Name, Email, Company, Status, Follow-Up Date | Stage inference, personalization |

---

## 5. Stage Detection (Possible Approaches)

- **First call:** No prior meeting notes; no Fathom transcripts (or none for this email)
- **Second call:** Meeting notes present; Fathom transcript(s) exist
- **New vs returning:** Inferred from Notes / Fathom / status

AI can infer stage from Notes + Fathom transcripts. Consider an explicit prompt instruction like: "Classify stage: first call, second call, follow-up, returning lead, etc."

---

## 6. Architecture Options

**Option A – Modal chat (recommended):**  
Meeting Prep opens a modal overlay with chat UI. Context: lead notes, Fathom transcripts (fetched on open), client instructions. User can ask questions; AI responds with key points and suggestions.

**Option B – Dedicated page:**  
`/meeting-prep?linkedinUrl=...` or `?leadId=...`. Same model as Quick Update / Calendar Booking.

**Option C – Side panel:**  
Chat slides in from the right; lead stays visible on the left.

---

## 7. Questions for the New Chat

1. **Client Master field:** Create a new "Meeting Prep Instructions" field, or reuse "FUP AI Instructions"? (FUP is follow-up focused; Meeting Prep is call-prep focused – may warrant a separate field.)

2. **Entry points:** Should Meeting Prep appear only in LeadDetailForm, or also in QuickUpdateModal, TopScoringPosts, and/or Calendar Booking when a lead is selected?

3. **Chat persistence:** Should the chat history persist (e.g. in Airtable) or be session-only (fresh each time)?

4. **Pre-populated context:** On open, should the AI automatically output a short "Stage + Key Points + Suggestions" block, or wait for the user to ask?

5. **Fathom fetch timing:** Fetch Fathom transcripts when the chat opens (may add 2–5s delay) or lazy-load when the user asks about past meetings?

6. **Auth and routing:** Meeting Prep should be client-scoped (`x-client-id`) and use the same auth pattern as Smart Follow-ups and Calendar Booking.

---

## 8. Suggested Files to Study First

1. `services/smartFollowUpService.js` – `fetchFathomTranscripts`, `analyzeLeadNotes`, client instructions usage
2. `linkedin-messaging-followup-next/app/smart-followups/page.tsx` – chat UI, context passing, Gemini integration
3. `routes/apiAndJobRoutes.js` – `/api/smart-followups/generate-message` handler
4. `linkedin-messaging-followup-next/components/LeadDetailForm.js` – button row and lead context
5. `services/clientService.js` – how client data (fupInstructions, fathomApiKey) is loaded
6. `docs/SMART-FOLLOWUP-DECISIONS.md` – background on Smart Follow-up design

---

## 9. Check Existing Patterns First

Before creating anything new:

- Search for similar functionality (e.g. "Meeting Prep", "calendar chat", "Fathom transcript")
- Follow existing patterns for auth, AI calls, and API structure
- Reuse `fetchFathomTranscripts` where possible instead of reimplementing

---

*Document created: 2026-02-05 | For use as handover to new chat*
