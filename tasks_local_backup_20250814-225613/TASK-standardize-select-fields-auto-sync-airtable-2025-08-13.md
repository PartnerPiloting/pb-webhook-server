# TASK: Standardize Select Fields with Auto-Sync from Airtable

**Created:** August 13, 2025
**Owner:** (assign name)

## Description
Standardize all single-select and multi-select fields in the Vercel (Next.js) frontend so their options are loaded live from Airtable metadata. Any change in Airtable (add/rename/remove choices) instantly reflects in the UI, with no code change required. All select fields go through a single function/API route that fetches options live. Multi-tenant support: pass tenant to map to correct Airtable base.

## Checklist
- [ ] Design API route to fetch select field options from Airtable metadata
- [ ] Implement server route (e.g. `/api/airtable/select-options`) to return choices for all select fields
- [ ] Add environment variables for Airtable PAT, Base ID, and Base Map (multi-tenant)
- [ ] Create React hook (`useAirtableOptions`) to load options for a table/field set
- [ ] Build reusable `<AirtableSelect/>` component for single/multi-select fields
- [ ] Refactor all select fields in the frontend to use `<AirtableSelect/>`
- [ ] Test with multiple tenants and tables
- [ ] Document workflow for adding/removing choices in Airtable
- [ ] Optional: Add caching or webhook-triggered revalidation for performance

## Status
- Current status: Not started
- Last updated: August 13, 2025

## Notes
- No code change needed when Airtable choices are updated—UI always loads options live.
- Multi-tenant ready: pass tenant to map to correct Airtable base.
- See example implementation in previous chat for API route, hook, and component code.
- Consider edge caching for performance if option changes are infrequent.
- Document for all client projects to standardize approach.
