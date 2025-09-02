# ASH Lead Filter — Task File (Condensed)
- Search screen (Filter → Table → Bulk Copy) using client mode by default.
- Guardrails for Search Terms on backend (store `searchTerms` + canonical `tokens[]`).
- Optional server mode via POST `/api/leads/query` (Prisma/Postgres).  
See `README-For-Copilot.md` for step-by-step prompts and acceptance criteria.
