# Bring your connections in from a search - build plan

Planned with Guy, 27 Nov 2026 (the Steve Nelson case). NOT BUILT - this is the plan.

## What it does, in one paragraph

A client searches their OWN connections on LinkedIn (Connections: 1st, plus filters such as title and
location), copies the link, and pastes it where they already top up a campaign - with one sentence on
why they want these people and, optionally, a link to share with the ones who are interested. Overnight
their Linked Helper machine collects the search and visits each profile (no invite, no message), so each
person arrives in Wingguy as a full lead with About, job history, score and the real connected date.
They then appear a few a day in the Reconnect section of the Follow-Ups screen, after the people the
client has actually talked to. The client opens each one and types /wg, which writes a first message to
an existing connection (no "thanks for connecting") ending in a small ask built from the client's reason.
When the person says yes, the next message carries the client's link.

It is step 7 of the Reconnect plan ("signals tier", docs/RECONNECT-BUILD-PLAN.md), now possible because
/wg can tell an old connection from a new one (commit 52c8ca5b).

## The lines held (Guy, 27 Nov 2026)

- **The campaign collects and visits. It never messages.** No message step, even if a client asks. A
  Linked Helper message to hundreds of old connections is the marketing blast; every first message is
  written by /wg and sent by the client.
- **The link waits for a yes** by default. A client may switch "link in the first message" on for a
  search, and is told plainly that it usually means fewer replies.
- **The search must be narrowed.** A link with no filter beyond "1st" is refused - that is the
  Connections.csv problem again.
- **Its own daily cap**, so it never starves the invite campaign of the shared ~150 actions a day.
- **In addition to Reconnect, not instead.** Conversation people stay first; search people follow.

## What the client sees

1. On the top-up page (or in Claude: "bring these connections into Wingguy" + the link) a 1st-degree
   link is no longer refused - it is recognised as "your own connections" and the page asks:
   - Why are you reaching out to these people? (required, one sentence)
   - A link to share with the ones who are interested? (optional)
   - [ ] Put the link in the first message (off, with the warning)
2. Email when the collect finishes: "N of your connections found; Linked Helper visits about X a day,
   so they will all be in Wingguy by about <date>."
3. Follow-Ups > Reconnect: search people appear with a chip "From your search: <reason, shortened>",
   their score, and "open their profile and use /wg".
4. /wg on one of them: the draft opens on a post or profile detail, frames it as an existing
   connection, and ends with an ask from the reason. Chat line says which search they came from.

## The pieces

### 1. Link check (server) - `utils/linkedinSearchUrl.js`
- New result: `own: true` when the link is 1st-degree ONLY (any 2nd/3rd mixed in = refuse, "split it into
  two searches"). Python twin `check_url()` in `lh-topup.py` in step.
- "Too broad" refusal: a LinkedIn people search with `network=["F"]` and no keywords, title, geo,
  industry or company filter; a Sales Navigator search with only the RELATIONSHIP filter.
- `degreeObjection` keeps refusing 1st-degree for INVITE top-ups; the own-connections route skips it.

### 2. The search record (server, Postgres) - new `services/connectionSearches.js`
- Table `connection_searches`: id, client_id, url, url_kind, reason, share_link, link_first (bool),
  topup_job_id, collected, created_at, finished_at.
- Table `connection_search_people`: client_id, search_id, profile_slug (clean_slug form), lead_rec_id
  (filled when the lead lands), added_at, status (waiting / shown / done / skipped / never).
  Unique (client_id, profile_slug) - a person in two searches keeps the FIRST reason.
- `forgetClient` called from `clientOffboardService.js` (same as lead_fill_ins).
- Share link goes through the existing dead-link check (retired asset URLs refused).

### 3. Queueing (server) - `services/lhTopUp.js` + `lhTopUpStore.js`
- `requestTopUp` branches on `check.own`: no campaign pick; the target is always the client's
  "Connections from your searches" campaign; job carries `kind: 'own-connections'` and the search id.
- One live own-connections job per client (as now for top-ups); a new one replaces a queued one.
- Chat tool `wingguy_top_up_campaign` gains `reason`, `share_link`, `link_first`; a 1st-degree link
  without a reason gets "why are you reaching out to them?" back instead of queueing.
- Top-up page template `content/site/top-up.html`: the three fields appear once the pasted link reads
  as 1st-degree (small inline script calling a check endpoint; works without it - the POST re-checks).

### 4. The machine (Linked Helper)
- New recipe `scripts/linked-helper/campaigns/07-connections-from-search.json`, campaign
  "Connections from your searches": auto-collect head step (the proven `AutoCollectPeople`) -> visit +
  extract -> send to webhook. No invite, no message. Visit step daily limit = `SEARCH_VISITS_PER_DAY`
  from machine config (default 25).
- `lh-topup.py apply` learns `--own`: builds the campaign from recipe 07 if missing, swaps the URL on the
  head step, postpone-to-now (as today). Hold-the-others / release unchanged.
- After the collect: the agent reads lh.db for the people the head step added beyond the baseline and
  POSTs their profile slugs with the job id - `POST /webhooks/lh-machine/:clientId/connection-search`
  (per-machine secret, new route in `routes/linkedHelperMachineRoutes.js`). This is how each person is
  tied to the search and its reason; the webhook alone only says the campaign.
- Rolled out with step 6 of the update only (as the top-up was), never during a client call.

### 5. Leads (server) - webhook path, `services/leadService.js`
- No change to create/update: the visit's webhook makes or tops up the lead as for any campaign
  (connected date from LH, never "today" - commit 52c8ca5b).
- `services/leadCampaign.js`: "Connections from your searches" is NOT an invite campaign - leads keep
  the campaign name but are not counted in invite numbers or the Monday campaign email's queue.
- After each webhook lead save, match `connection_search_people` by slug and fill `lead_rec_id`.
- Already-a-lead people: topped up (fill blanks only), not duplicated. If the client has written to
  them in the last 90 days they stay with the live Follow-Ups queue and are marked `done` here.

### 6. Reconnect list - `services/reconnectQueue.js`
- Second pool: `connection_search_people` with a lead, status waiting/shown, joined to the lead.
- Show the Reconnect section when Reconnect = Yes OR the client has search people (Steve has no
  Unipile history, so his Reconnect switch is blank).
- Order: today's carried rows, then conversation people (as now), then search people by AI Score, a
  fresh signal (posted / changed job) first when known. Same daily number; search people only fill
  what conversation people leave.
- Same buttons: Done / Skip 90 days / Never / (no Disconnect for search people). Actions write
  `connection_search_people.status`; Never = Cease FUP as now.
- Chip "From your search", reason under the name (`ReconnectSection.js`).

### 7. /wg - `services/wingguyChat.js` + `routes/wingguyRoutes.js`
- `portalFieldsFromRecord` (or the profile lookup beside it) adds `_searchReason`, `_shareLink`,
  `_linkFirst` from `connection_search_people` by slug.
- New context line when `_searchReason` is set: "WHY <coach> PICKED THIS PERSON: <reason>. End the
  first message with ONE small ask that fits this reason - offer to send details, never the details."
- Link handling:
  - First message: link held back unless `_linkFirst`. A code guard refuses a draft carrying the
    share link in the first message when `_linkFirst` is off (once per turn, like the thanks guard).
  - Reply flow: when the lead's reply reads as a yes to the offer, the context gives the link and says
    put it in this message. When it reads as anything else, the link is not offered.
- Works with the established-connection line already live: under 30 days = thanks as before.

### 8. Words for clients
- Playbook topic: extend YOUR CONTACTS / RECONNECT with "Bringing in connections from a search" -
  how to build the search, why the reason matters, why the link waits. Alias "bring my connections in",
  "search my connections"; near-miss tests in `content/client-phrases.json`.
- `content/site/pick-your-people.html`: a short "your own connections" section.
- `docs/linked-helper-machine-setup.md`: recipe 07, the cap, the report-back route.

## Build order and checks

1. Link check + search tables + queueing + page/chat fields (server only; testable with no machine).
2. Recipe 07 + `lh-topup.py --own` + report-back - prove on GUY'S machine with a small search
   (10-20 people) end to end: collected, visited, leads full, people tied to the search.
3. Reconnect second pool + chip - check on Guy's Follow-Ups screen.
4. /wg reason line + link guard + reply-yes link - test file like
   `tests/wingguy-established-connection.test.js`; then one real /wg on Guy's own search person.
5. Playbook words, then roll the machine step to Steve's machine first (he is the case), then others.

## Open questions for Guy (answer before step 4)

- Daily visit cap default: 25 suggested. Lower for clients whose invite campaign runs hot?
- Should search people appear for clients who also have conversation Reconnect, or only once the
  conversation list for the day is used up (the plan above says the latter)?
- "Link in the first message" switch: offer it at all, or leave it out until a client asks?

## Not in this build

- Any automated message, comment or like.
- Re-running a search monthly for new matches (possible later, as for top-ups).
- Clients running Linked Helper on their own computer (decided 5 Nov: nothing for self-run clients).
