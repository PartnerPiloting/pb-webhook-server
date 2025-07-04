# LinkedIn Follow-Up Portal: Bootstrap Guide for New Developers

## Where to Start

- **Main UI:** `LinkedIn-Messaging-FollowUp/web-portal/build/index.html` (vanilla JS/Tailwind, currently deployed)
- **React Source (for future migration):** `LinkedIn-Messaging-FollowUp/web-portal/src/`
- **Backend API:** `pb-webhook-server/index.js` and `LinkedIn-Messaging-FollowUp/backend-extensions/routes/`
- **API Base URL:** `/api/linkedin` (see `index.html`)

## Current State (as of July 2025)

- Real-time, debounced AJAX search (no Search button)
- Live, clickable list of leads below the search box
- Debug console at the bottom of the UI (shows API calls, errors, and responses)
- Clicking a lead card opens a modal with all available info (read-only for now)
- Client selection and API test features present
- Backend API is multi-tenant and connects to Airtable
- All core data flows are working

## What’s Working

- **Search:** Real-time, instant, and robust (matches Airtable feel)
- **Results:** Cards show lead info, clickable for details
- **Debugging:** All API and UI actions are logged visually and in the browser console
- **Deployment:** Portal is live at `/linkedin` and `/linkedin/`

## What’s Next (Highest Priority)

1. **Editable Lead Detail Modal**
    - Convert modal to a form with editable fields (First/Last Name, LinkedIn URL, Sales Navigator, Notes, Follow Up Date/Notes, etc.)
    - Add Save/Cancel buttons
    - Add action buttons: View LinkedIn Profile, View in Sales Navigator, Add Manual Note
    - Implement API calls for saving changes
2. **Manual Note Entry**
    - Add UI for appending a manual note (with timestamp)
    - Integrate with backend note handling
3. **(Optional) Move details to a bottom panel**
    - For a more Airtable-like experience, consider showing details in a bottom panel instead of a modal
4. **Field Validation and Error Handling**
    - Ensure all edits are validated and errors are shown to the user
5. **Testing and QA**
    - Test with real Airtable data and multiple clients

## Key Docs
- `docs/web-portal-spec.md` — Functional spec and UI requirements
- `docs/airtable-field-master-list.md` — Field mapping and visibility
- `web-portal/README.md` — Project structure, install, and dev notes

## Handoff Notes
- The portal is 70–80% of the way to spec for the main screen
- Main gap: editable detail panel/modal and save actions
- All code is committed and up to date as of this handoff

---

**For questions, see the debug console in the portal or check the README and spec docs.**
