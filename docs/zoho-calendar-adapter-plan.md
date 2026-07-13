# Zoho Calendar adapter — build checklist (weekend-slice sizing)

> **Why this exists.** Wingguy's first pilot (Julian Davis) runs **Zoho Calendar**, which **Nylas cannot
> serve** (Nylas connects Zoho as IMAP = email-only; its CalDAV calendar support is a fixed allow-list —
> iCloud/Fastmail/Yahoo/Google — that excludes Zoho). A **direct Zoho adapter** is the answer, and it's
> tractable because **Zoho has none of Google's/Microsoft's CASA restricted-scope audit** (that audit — not
> OAuth code — was the real reason Wingguy uses Nylas for the big providers). Full reasoning:
> `docs/wingguy.md` → **Provider notes** + the **2026-07-10 evening** session note. Memory:
> `project_julian_pilot_zoho_calendar`.
>
> **Scope of this build:** Julian's **calendar** only (read availability + write bookings + delete HOLDs).
> His **email** still rides Nylas (Zoho IMAP works) — do NOT rebuild email here.

---

## ▶▶ PROGRESS (2026-07-13) — items 1-3 (the code that doesn't need the Zoho app) BUILT + VERIFIED on prod
- **Credential fields (step 3): DONE.** Generic `Calendar Provider Token` + `Calendar Provider Domain` added to the Clients roster (Master Clients base `appJ9XAZeJeK5x55r`) via idempotent `scripts/add-calendar-provider-fields.js`. Chosen **generic, not Zoho-specific**, so a future direct provider reuses them (design note in the script + the 2026-07-13 session). Roster is one global table → no template copy (the template is a leads base; script skips it). `clientService.getClientById` + `wingguyCalendar.getCoachCalendarInfo` now read them; the "has a calendar" guard accepts a direct-provider token.
- **Zoho adapter (step 5): BUILT** in `services/calendarProvider.js` — `getViaZoho`/`createViaZoho`/`deleteViaZoho` + `mapZohoEvent`, OAuth refresh-token helper (in-memory access-token cache), region routing (`zohoHosts`), dispatch branches on `provider==='zoho'`. Pure helpers unit-tested (datetime round-trip, offset/all-day, host derivation, event mapping).
- **De-nylas-ify (step 6): DONE** — `readsViaNylas`/`coachForNylas`/`coachForHolds` → `providerForInfo`/`usesProviderSeam`/`coachForCalendar`/`writeProviderForCoach`. Reads AND writes now route on the real provider. **Verified behaviour-preserving for Guy on prod: availability = 21 days / 256 slots via Google, unchanged.** A synthetic Zoho coach dispatches to the Zoho branch (fails only on missing app creds — routing proven).
- **STILL TODO (needs the Zoho app):** step 1 (register the one Zoho OAuth app → `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET` env), step 4 (the `/auth/zoho/start` + `/callback` connect flow that writes the token/domain onto a client's record), step 7 (live-account test matrix — the mapZohoEvent edge cases + invite-email + delete-etag get confirmed here). The dormant `zoho` branch ships safely meanwhile (no tenant has `calendarProvider='zoho'`).

---

## The seam it plugs into (read this first)

All calendar access already funnels through **one** file — `services/calendarProvider.js`, "the ONE
swappable seam." It exposes three functions and one normalised event shape; everything above it is
provider-blind:

- `getMeetingsInWindow(coach, timeMin, timeMax)` → `{ events, error, provider }`
- `createCalendarEvent(coach, details)` → `{ ok, eventId, htmlLink, error, provider }`
- `deleteCalendarEvent(coach, eventId)` → `{ ok, error, provider }`
- `activeProvider(coach)` already routes on `coach.calendarProvider` (per-coach) or `CALENDAR_PROVIDER`
  (global default `'google'`). Google + Nylas are the two existing branches; **Zoho becomes the third.**

The normalised event shape every consumer expects (must match exactly):
```
{ id, summary, start /*ISO*/, end /*ISO*/, location, description, htmlLink, conferenceData,
  attendees: [{ email, displayName, self, organizer, responseStatus }] }
```
`responseStatus` ∈ `accepted | declined | tentative | needsAction`. `self` = the event row that is the
coach; `mapNylasEvent` even *synthesises* a `self` row when the organiser is absent from participants —
`mapZohoEvent` must do the same so `isCoachAttending()` works.

**Above the seam nothing changes** — `wingguyCalendar.js` (availability, clash checks, offer pipeline,
HOLDs, booking guard), the chat agent, and the MCP connector are all provider-blind — **except** the
de-nylas-ify cleanup in Step 6.

---

## Checklist

### 1. Register a Zoho OAuth app (one-time, Guy's Zoho API console)
- [ ] Create a **Server-based Application** at the Zoho API console → get **Client ID + Client Secret**.
- [ ] Set the **Authorized Redirect URI** to our backend callback (Step 4).
- [ ] Scopes: `ZohoCalendar.calendar.READ`, `ZohoCalendar.event.ALL` (list/create/delete). *(Verify exact
      scope names against current Zoho Calendar API docs — Zoho renames these.)*
- [ ] Request `access_type=offline` so the token exchange returns a **refresh token** (refresh tokens
      don't expire unless revoked; access tokens last ~1 hour).
- [ ] Store `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` as env vars (Render + the staging service). One app
      serves all Zoho tenants — this is not per-client.

### 2. Data-centre (region) routing — the "generic Zoho" gotcha
- [ ] Zoho accounts live on regional DCs: `.com`, `.com.au`, `.eu`, `.in`, `.jp`, `.ca`, `.sa`. The
      **API base host differs per client** — you cannot hard-code one.
- [ ] The OAuth callback returns the account's **`accounts-server` / `location`** — capture it and derive
      the calendar API base (e.g. `https://calendar.zoho.com.au/api/v1/...` for an AU account). Store the
      DC/base per client so every later call targets the right region.
- [ ] Julian is (almost certainly) `.com.au` — but build the detection, don't special-case him, or client
      #2 in another region breaks.

### 3. Per-tenant token storage (Airtable — mirror how `Nylas Grant ID` works)
- [ ] Add fields on the **Master Clients base** `Clients` table: `Zoho Refresh Token`, `Zoho API Domain`
      (the DC base from Step 2), and reuse/extend `Calendar Provider` to accept `'zoho'`. *(Optionally
      `Zoho Calendar UID` if the coach's default calendar isn't the primary.)*
- [ ] **Also add them to the Client Template base** (`app6W6k9GiDUlktvt`) — per the standing rule that
      Airtable field rollouts include the template; pattern = `scripts/add-cease-fup-field.js` idempotent
      `--template` flag. Memory: `feedback_airtable_field_rollout_includes_template`.
- [ ] Extend `getCoachCalendarInfo()` in `wingguyCalendar.js` to read the new fields (it already reads
      `Google Calendar Email`, `Nylas Grant ID`, `Calendar Provider`).

### 4. OAuth connect flow (small redirect handler in the backend/portal)
- [ ] `GET /auth/zoho/start?clientId=…` → redirect to Zoho's `/oauth/v2/auth` with our scopes +
      `access_type=offline` + `state=clientId`.
- [ ] `GET /auth/zoho/callback` → exchange the `code` at `/oauth/v2/token`, capture refresh token +
      `accounts-server`, resolve the DC base, and write both onto the client's record + set
      `Calendar Provider='zoho'`. This is the "connect your calendar" step in the provisioning handoff
      pack (the Nylas hosted-auth link's Zoho equivalent).
- [ ] Access-token helper: `getZohoAccessToken(coach)` — refresh on demand (POST refresh_token grant),
      cache in-memory with expiry. Every adapter call gets a fresh access token through this.

### 5. The three adapter functions + `mapZohoEvent` (the core, in `calendarProvider.js`)
- [ ] `activeProvider` → add `if (provider === 'zoho') return getViaZoho(...)` to all three dispatchers.
- [ ] `getViaZoho(coach, timeMin, timeMax)` — GET events in range from the coach's calendar; **paginate**
      (mirror the Nylas 5-page loop); **expand recurring** instances; map each via `mapZohoEvent`.
- [ ] `createViaZoho(coach, details)` — POST an event with title/description/when/participants; **must
      email the guest an invite** (confirm Zoho's notify behaviour) and **return a stable event id +
      link** (HOLDs + booking depend on the id round-trip).
- [ ] `deleteViaZoho(coach, eventId)` — DELETE by id (used to clear Wingguy offer HOLDs).
- [ ] `mapZohoEvent(ev, selfEmail)` — translate Zoho's event JSON into the normalised shape above.
      **The fiddly bits, get each right:**
  - [ ] **Times/timezone** → emit `start`/`end` as UTC ISO (Zoho returns its own dateTime + tz format).
  - [ ] **All-day vs timed** → drop/flag all-day the way the Nylas mapper drops eventless entries.
  - [ ] **Attendees + RSVP** → map Zoho's attendee status onto `accepted|declined|tentative|needsAction`.
  - [ ] **Organiser + self** → set `organizer`, and **synthesise a `self` row** if the coach is the
        organiser but absent from attendees (Nylas mapper does this — parity matters for `isCoachAttending`).
  - [ ] **Conferencing/location** → surface any meeting URL into `location`/`htmlLink`/`conferenceData`.

### 6. De-nylas-ify the hard-coded helpers (`wingguyCalendar.js`)
Three helpers currently assume "not-Google ⇒ Nylas" and hard-code the string `'nylas'`. Generalise them to
"this tenant's grant provider" so a Zoho tenant reads/writes/holds correctly:
- [ ] `readsViaNylas(info)` → a provider resolver (Google if a service-account calendar email exists, else
      `info.calendarProvider`), and branch on that instead of the boolean.
- [ ] `coachForNylas(info)` → build the coach object with the **real** provider, not literal `'nylas'`.
- [ ] `coachForHolds(coach)` → same; holds must be created/deleted via the tenant's actual write provider.
- [ ] Grep the file for `'nylas'` string literals and the `readsViaNylas` call sites; each is a touch-point.

### 7. Test matrix (verify against a REAL Zoho account — Julian's or a scratch one)
- [ ] **Read:** availability window returns his real busy blocks; recurring events expand; all-day events
      don't corrupt slots; timezone correct (offer times match what he sees in Zoho).
- [ ] **Clash:** a known-busy slot is flagged as a clash by `clashesForWindow`.
- [ ] **Write:** book a meeting → event appears in **his Zoho calendar** AND the **guest receives an
      invite email**; returned event id is stored.
- [ ] **HOLD lifecycle:** create a `HOLD:` event, confirm it reads back with an id, confirm booking clears
      it via `deleteOfferHolds`.
- [ ] **Isolation:** all of the above run off **his** token/DC only — zero leakage to Guy's calendar
      (ties into the step-3 per-tenant token work in the Julian plan).
- [ ] **Region:** if feasible, sanity-check the DC routing with a non-AU Zoho account (or at least assert
      the base URL is derived, never hard-coded).

---

## Effort read
A **focused, self-contained build**, not a settings toggle. The plumbing (dispatch branches, token
refresh, the connect handler) is routine; the time actually goes into **(a) the data-centre routing** and
**(b) the `mapZohoEvent` edge cases** (recurring / timezone / all-day / RSVP / guest-invite). Budget for
those two, not for the wiring. Everything above the seam is free.

## Sequencing note (open decision)
Julian's chat + transcript **wow-loop needs no calendar** — so a clean path is: start him on that first,
build this adapter in parallel, and land it **before booking goes live for him**. Alternatively build the
adapter up front if booking is central to his early value. Decide at the onboarding sitting.

## Verify-before-trusting flags
- Exact **scope names** and the **events range/query params** move around in Zoho's API — confirm against
  current docs at build time, don't trust this doc's names blindly.
- Confirm Zoho's **create-event invite email** actually reaches an external guest (the whole booking UX
  depends on it) and that **reminders** can be set the way `createBookingEvent` expects.
