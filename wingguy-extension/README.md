# Wingguy (LinkedIn) — Chrome extension

Forked from the `chrome-extension/` "Network Accelerator" extension (2026-06-24, Slice 1). Reuses
its proven auth plumbing (portal → `clientId`/`portalToken` → `x-client-id`/`x-portal-token`
headers) and adds the Wingguy drafting surface. The old extension stays installed and untouched;
this runs **side-by-side** until it's proven, then the old one is decommissioned. End state = ONE
extension.

**Visually distinct (teal) and DOM-namespaced (`wingguy-*`)** so it never collides with the legacy
extension when both are loaded at once.

## What it does (Slice 1)

On any LinkedIn **profile** page (`/in/...`):

1. Click the teal **Wingguy** launcher (bottom-right).
2. Wingguy reads the profile (name, headline, About — auto-expands "see more" — and light recent
   activity).
3. Pick a **campaign template** (General thanks / Fractional). These are served by the backend
   (`GET /api/wingguy/templates`).
4. The backend drafts a personalised thanks-for-connecting **in Guy's voice** (Claude Sonnet, one
   AI call, no tools) and returns it.
5. Edit if you like, then **Insert into LinkedIn** (preserves line breaks straight into the message
   composer) or **Copy**. **You click send.** — human-at-the-glass.

Single-tenant for now: the backend endpoint is **owner-gated to `Guy-Wilson`**. Replies, booking,
the conversation engine, the Postgres rules store, metering and multi-tenant are later slices.

## Install (developer mode)

1. Chrome → `chrome://extensions/` → enable **Developer mode**.
2. **Load unpacked** → select this `wingguy-extension/` folder.
3. Open your portal once (any tab) so the extension syncs your credentials.
4. Go to a LinkedIn profile → click the teal **Wingguy** button.

(Both this and the old extension can be loaded together — they have separate IDs and isolated
storage.)

## Files

```
wingguy-extension/
├── manifest.json        # name "Wingguy (LinkedIn)", loads content-wingguy.js on linkedin
├── background.js        # service worker — reused auth + Wingguy /api/wingguy calls
├── content-wingguy.js   # NEW: profile panel (scrape → pick template → draft → insert)
├── content-portal.js    # reused: broadcasts portal auth to the extension
├── styles.css           # wingguy-* teal styles
├── popup.html / popup.js # toolbar popup (connection status)
└── icons/
```

## Backend

- `GET  /api/wingguy/status`       — `{ ok, enabled, aiConfigured }`
- `GET  /api/wingguy/templates`    — quick-pick button set (auth + owner-gated)
- `POST /api/wingguy/draft-thanks` — `{ templateId, profile }` → `{ ok, draft, model }`

Templates are **seeded directly** in `config/wingguyTemplates.js` (no Postgres yet — that's Slice 3).
Model is Sonnet by default (`WINGGUY_DRAFT_MODEL_ID`, default `claude-sonnet-4-6`); the stable
voice/rules block is prompt-cached. Kill-switch: `WINGGUY_DRAFT_ENABLED` (default on).

## LinkedIn DOM selectors ("landmarks")

LinkedIn's markup shifts. Every selector Wingguy uses to find something on a page lives in ONE place
- `SELECTOR_DEFAULTS` at the top of `content-wingguy.js` - and each value is a comma-separated list
of alternatives tried in order.

Those built-ins are the permanent **fallback**, not a bootstrap. On startup the extension asks
`GET /api/wingguy/selectors` whether any landmark has been corrected since it shipped, and merges
what comes back over the defaults. No database, no network, an expired token, a 500: all land on the
shipped defaults, so the store can make Wingguy better but can never be why it stopped working.

**When LinkedIn renames something**, the fix is a row in Postgres (`wingguy_selectors`, via
`services/wingguySelectorStore.js`) - no release, no client reinstall. Add the new markup in FRONT of
the old in the list rather than replacing it: LinkedIn rolls changes out gradually, so two clients
can be on different markup on the same day. Rollback is `retireSelector`, which drops the override
and falls back to whatever sits behind it.

Per-client overrides (`tenant_id`) are built but unused - one shared set serves everyone today.

### Self-check

The extension grades its own homework on every read: which landmarks resolved, and whether each
value came from the store or from the shipped defaults. That second half matters - if the store
silently stops being reached, Wingguy still works perfectly on defaults, so "it looks fine" is
exactly what a broken pipe looks like. Results go to `POST /api/wingguy/selectors/health`; the
diagnostic read is `GET /api/wingguy/selectors/health` (owner only).

Nothing from the self-check ever reaches the screen. What the person DOES see, when a gap actually
changes their draft, is one plain line: *"I couldn't read their About section, so this draft is
thinner than usual - I'm on it."*

Alerting thresholds are deliberately NOT built. They need real traffic to be worth anything, and
guessed thresholds are how these systems become noise you learn to ignore.

**What this does not cover:** renames only. If LinkedIn restructures how something *works* - a
different flow for contact info, a new step in the composer - that needs code, and no row in
Postgres will save you.
