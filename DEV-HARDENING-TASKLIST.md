# Dev Hardening Tasklist (Temporary)

Derived from hotfix lessons. Mark items as you complete them. Adjust or promote to permanent doc later.

---
## Phase 1 – Config & Integrity
- [ ] 1. Verify dev `.env.local` contains `NEXT_PUBLIC_API_BASE_URL` (dev URL, no trailing slash)
- [ ] 2. (Optional) Add `NEXT_PUBLIC_API_TIMEOUT` (ms) or rely on default 30000
- [ ] 3. Run `scripts/validate-environment-urls.js` (adapt for dev if needed)
- [ ] 4. Confirm `services/api.js` full length matches main (no truncation)
- [ ] 5. Add safeguard script: warn if `api.js` line count/hash differs unexpectedly

## Phase 2 – URL & Auth
- [ ] 6. Global search for hardcoded production/onrender URLs (outside `api.js`) and replace with env usage
- [ ] 7. Ensure `clientUtils`, `AIEditModal`, `validateEnv` use env-derived base URL
- [ ] 8. Test `/api/auth/test?testClient=Dev-Test` works (returns success JSON)

## Phase 3 – Timeout & Resilience
- [ ] 9. Verify console shows `[DEBUG] API timeout (ms): 30000`
- [ ] 10. Implement retry (e.g. 2 attempts) for `ECONNABORTED` in API calls (backoff)
- [ ] 11. Add debounce + abort (AbortController) to search input to prevent overlapping requests

## Phase 4 – Performance & Payload
- [ ] 12. Add server timing logs around search handler (start/end + duration ms)
- [ ] 13. Implement pagination OR limit initial payload fields (lazy-load heavy JSON blobs on expand)
- [ ] 14. Confirm gzip/compression active (check `Content-Encoding` responses)
- [ ] 15. Document current query plan / Airtable or DB indices; plan optimizations

## Phase 5 – Observability & Health
- [ ] 16. Add `/version` (returns git SHA, build time, branch) 
- [ ] 17. Add keep-alive ping (cron or external uptime monitor every 5 min)
- [ ] 18. Optional Dev Info panel in UI (base URL, timeout, SHA)

## Phase 6 – Safety Nets
- [ ] 19. Pre-commit hook: block commit if `api.js` shrinks below threshold or forbidden domains appear
- [ ] 20. Backup script for critical files (`api.js`, `validateEnv.js`) producing hash manifest
- [ ] 21. CI smoke test script: 
  - Auth test
  - Empty search
  - Specific search term
  - Simulated slow endpoint (timeout handling)

## Phase 7 – Documentation
- [ ] 22. Update `VERCEL-ENV-SETUP.md` with dev-specific section
- [ ] 23. Create `DEV-OPERATIONS.md` (recovery steps: API file restore, timeout config, cold start tips)
- [ ] 24. Update `README` with branch flow (feature -> dev -> hotfix/main)

## Phase 8 – Rollback & Security
- [ ] 25. Practice revert of last 2 commits (comfort drill)
- [ ] 26. Ensure logs mask Basic auth creds / tokens
- [ ] 27. Sanitize error objects before sending to client (no stack/credentials)

## Optional Enhancements
- [ ] 28. Feature flags (`NEXT_PUBLIC_FEATURE_PAGINATION`, etc.)
- [ ] 29. Streaming or staged search response (return IDs first, details later)
- [ ] 30. GitHub Action alert on large `api.js` diff or size drop
- [ ] 31. Data anonymizer for any prod-like records in dev
- [ ] 32. UI notice if backend cold start duration > threshold (surface duration metric)

## Execution Order (Suggested)
1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8 / Optional

---
### Quick Progress Log
(Add dated notes as you work.)
- YYYY-MM-DD: Initialized checklist.

---
### Notes
Keep this file temporary; migrate finished sections into permanent docs.
