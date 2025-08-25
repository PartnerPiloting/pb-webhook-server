# Search Terms Feature – Brief

Status: draft (awaiting requirements)
Branch: feature/search-terms

## Goals
- Enable users to search leads using flexible “search terms”.
- Keep performance fast and results relevant.

## Scope (to confirm)
- API: Extend/adjust `/api/linkedin/leads/search` parameters and filtering logic.
- UI (Next.js app): Add/adjust search input UX, debouncing, and results display.
- Data: Define any saved search term presets per client (if required).

## Requirements (fill in plain English)
- What is a "search term"? (free text, exact phrases, AND/OR, field-specific like name/company/title?)
- Should multiple words imply AND or OR? e.g., "sally kuter" => match both words
- Do we need field filters? e.g., company:Acme title:Founder country:AU
- Result limits/pagination? default 25 or 50?
- Sort order? recent updated, priority first, name, etc.
- Any exclusions (e.g., exclude multi-tenant leads) or client scoping rules
- Should users save named search presets? if yes: create/list/delete?

Write your answers here and I’ll convert them into implementation tasks.

## Proposed API Contract (draft)
- GET `/api/linkedin/leads/search`
  - Query params:
    - `q`: string (free-text terms)
    - `priority`: enum(all|High|Medium|Low) – optional
    - `limit`: number – optional (cap at 50)
  - Auth: existing client auth headers/cookies
  - Response: array of leads (capped), safe for UI rendering

## UI Changes (draft)
- Search box with debounce (500ms)
- Show result count and cap notice
- Clear filters button
- Optional: chips for parsed field filters (company:, title:, etc.)

## Edge Cases
- Empty query => default recent leads (limit)
- Very long queries => trim and cap length
- Special characters / quotes => safely escaped for Airtable formula
- Rate limits / timeouts => graceful error in UI

## Test Plan (draft)
- Unit: term parsing (words, quotes, field:value)
- API: filter formulas built correctly; cap respected
- UI: debounce works; cancellation of stale requests; empty state

## Rollout
- Behind feature branch; test against dev API
- If new env/config required, document in README
