# Overview for GitHub Copilot (Lead Search & Tags)

This is a one-pager for Copilot to implement and wire up the Search Terms + Search Screen work quickly.

## Architecture
- **Frontend:** Next.js (Vercel), components/libs under `src/`.
- **Backend:** Node/TS API (Render) with endpoints for leads and updates.
- **Optional server mode:** Prisma/Postgres with `tokens TEXT[]` + GIN index.

## UX
1) FilterPanel (ALL / ANY a|b / NOT -x / prefix *).
2) ResultsTable (sortable, column chooser via catalog, CSV).
3) BulkCopy (emails/linkedin/phones de-duped).
4) ManageTermsModal (dual-list for a single lead).

## Guardrails
- Canonical vocabulary + synonyms + banned.
- On save: convert raw `searchTerms` string → canonical `tokens[]` (store both).
- Shared rules in `src/lib/tags.ts`.

## Modes
- client (default), virtualized, server (`POST /api/leads/query`).

## Endpoints
- `GET /api/leads` (client mode feed).
- `PUT /api/leads/:id` (server canonicalises `searchTerms` → `tokens[]`).
- `POST /api/leads/query` (server mode).
- `GET /api/terms?scope=currentClient` (potential terms with counts).

## Files to copy
- Search screen: `app/lead-search-demo/page.tsx`, components `{FilterPanel,ResultsTable,BulkCopyLite}.tsx`, libs `{filter-helpers,field-detect}.ts`.
- Guardrails: `src/lib/{tags,tokenize}.ts`, `src/components/SearchTermsInput.tsx`, migration script.
- Server mode: `app/api/leads/query/route.ts`, `src/lib/server-datasource.ts`, `prisma/schema.prisma`, `src/server/prisma.ts`.
- Dual-list editor: `src/components/ManageTermsModal.tsx`.

## Acceptance
- Filter `sydney product* -do-not-contact` works (ALL + prefix + NOT).
- Saving `pm, melb` → `product, melbourne`, deduped, max enforced.
- Bulk Copy de-dupes correctly; CSV matches visible sort/columns.
- (Server mode) `/api/leads/query` returns `{rows,total}` and matches client semantics.
