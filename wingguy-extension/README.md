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

## LinkedIn DOM selectors

LinkedIn's markup shifts; the scraping selectors in `content-wingguy.js` are redundant with
fallbacks and Copy is always available as a safety net. Moving these to remote `extension-config`
(as the legacy extension already does for its own selectors) is a later refinement.
