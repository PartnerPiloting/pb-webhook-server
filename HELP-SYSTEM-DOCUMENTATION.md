# Help/Start Here System Architecture Overview

This is a context-sensitive help system for a Next.js frontend with an Express.js backend, using Airtable as the content database.

---

## AIRTABLE DATA MODEL (3 Tables)

### 1. Categories Table
| Field | Type | Description |
|-------|------|-------------|
| `category_name` | Text | Display name (e.g., "Getting Started") |
| `category_order` | Number | Sort order (lower = first) |
| `description` | Text | Optional description |

### 2. Sub-Categories Table
| Field | Type | Description |
|-------|------|-------------|
| `sub_category_name` | Text | Display name |
| `sub_category_order` | Number | Sort order within category |
| `Categories` | Linked Record | Links to parent Category (array, uses first item) |
| `description` | Text | Optional description |

### 3. Help Table (Topics)
| Field | Type | Description |
|-------|------|-------------|
| `title` | Text | Topic title |
| `topic_order` | Number | Sort order within subcategory |
| `sub_category` | Linked Record | Links to parent Sub-Category |
| `help_area` | Text | **Key field** - determines where help appears (e.g., "lead_search", "scoring", "start_here") |
| `Section` | Text | For Start Here only - groups topics into tabs (e.g., "Getting Started", "Regular Tasks") |
| `monologue_context` | Long Text | The actual help content (HTML or Markdown) |
| `context_type` | Text | Optional metadata about the context |

---

## HIERARCHY & RELATIONSHIPS

```
Categories (top level)
  └── Sub-Categories (linked via "Categories" field)
        └── Help Topics (linked via "sub_category" field)
              - Filtered by "help_area" for context-specific help
              - Filtered by "Section" for Start Here tabs
```

**Key Filtering Logic:**
- **Context Help**: Filters topics by `help_area` field matching the current UI area
- **Start Here**: Filters by `help_area = 'start_here'` AND optionally by `Section` field

---

## BACKEND API ENDPOINTS (index.js)

### 1. `GET /api/help/context?area=<area>`
- Fetches help for a specific UI context (e.g., `?area=lead_search`)
- Supports area aliases (e.g., "lead_search" also matches "leads")
- Returns hierarchical structure: Categories → SubCategories → Topics
- Includes `body` (markdown) or `bodyHtml` (HTML) based on content format
- 10-minute cache per area
- Location: index.js ~line 2620-2800

### 2. `GET /api/help/start-here?section=<section>`
- Same structure but filters for `help_area = 'start_here'`
- Optional `section` param filters by Section field
- If no section specified, returns first non-empty section
- Also returns list of available sections
- Location: index.js ~line 2160-2400

### 3. `GET /api/help/topic/:id`
- Fetches single topic by Airtable record ID
- Resolves media placeholders
- Returns related topics from same subcategory
- Location: index.js ~line 3630-3750

---

## CONTENT FORMAT HANDLING

The `monologue_context` field supports two formats:

**HTML (auto-detected):**
- Detected by presence of tags like `<p>`, `<h1-h6>`, `<ul>`, `<img>`, etc.
- Stored as `bodyHtml`, `bodyFormat: 'html'`

**Markdown (default):**
- Plain text or markdown syntax
- Stored as `body`, `bodyFormat: 'markdown'`

---

## MEDIA EMBEDDING

Topics can embed media using tokens: `{{media:123}}`

**How it works:**
1. Backend scans `bodyHtml` for `{{media:ID}}` patterns
2. Fetches matching records from **Media table** (field: `media_id`)
3. Replaces tokens with actual URLs from media attachments
4. Supports `<img src="{{media:123}}">` and `<a href="{{media:123}}">`

---

## FRONTEND COMPONENTS

### 1. HelpButton.js (~35 lines)
- Simple button that dispatches `CustomEvent('open-help')` with area parameter
- Used throughout the app to trigger contextual help
- Usage: `<HelpButton area="lead_search" />`
- Location: `linkedin-messaging-followup-next/components/HelpButton.js`

### 2. ContextHelpPanel.js (~273 lines)
- Modal/slide-out panel that displays help
- Listens for `open-help` event
- Fetches help via `getContextHelp(area)`
- Renders collapsible tree: Categories → SubCategories → Topics
- Uses HelpHtmlRenderer for topic content
- Location: `linkedin-messaging-followup-next/components/ContextHelpPanel.js`

### 3. HelpHtmlRenderer.js (~214 lines)
- Sanitizes and styles HTML help content
- Adds Tailwind classes to headings, lists, links, kbd tags
- Integrates `react-medium-image-zoom` for clickable images
- Handles `/start-here` links with query string preservation
- Location: `linkedin-messaging-followup-next/components/HelpHtmlRenderer.js`

### 4. start-here/page.tsx (~150+ lines)
- Full-page onboarding experience
- Section tabs at top (from Section field)
- Same tree structure as ContextHelpPanel
- Expands topic detail inline when clicked
- Location: `linkedin-messaging-followup-next/app/start-here/page.tsx`

---

## FRONTEND API CALLS (services/api.js)

```javascript
// Fetch help for a UI area
export async function getContextHelp(area, options = {}) {
  // GET /api/help/context?area=<area>&includeBody=true
}

// Fetch a single topic by ID
export async function getHelpTopic(topicId, options = {}) {
  // GET /api/help/topic/<id>
}

// Fetch Start Here content
export async function getStartHereHelp(section = null) {
  // GET /api/help/start-here?section=<section>
}
```

Location: `linkedin-messaging-followup-next/services/api.js` ~line 1170-1260

---

## CACHING STRATEGY

- **Backend**: 10-minute TTL cache per area (Map with timestamp)
- **Frontend**: No explicit cache, relies on backend caching
- Cache key format: area string (lowercased)

---

## ORDER/SORTING LOGIC

All items support numeric ordering with fallback:
1. Use `*_order` field if valid number
2. Parse prefix from name (e.g., "01 - Getting Started" → order 1)
3. Default to 9999 (sorts last)

---

## COMMON HELP_AREA VALUES

| Area | Used For |
|------|----------|
| `start_here` | Start Here page (onboarding) |
| `lead_search` | Lead search/update tab |
| `scoring` | AI scoring interface |
| `follow_ups` | Follow-up management |
| `calendar` | Calendar/booking features |

---

## SUMMARY OF DATA FLOW

```
1. User clicks HelpButton(area="lead_search")
   ↓
2. CustomEvent('open-help', {area}) dispatched
   ↓
3. ContextHelpPanel catches event, calls getContextHelp("lead_search")
   ↓
4. Frontend API calls GET /api/help/context?area=lead_search
   ↓
5. Backend filters Help table by help_area, joins to Sub-Categories → Categories
   ↓
6. Returns nested JSON: {categories: [{subCategories: [{topics: [...]}]}]}
   ↓
7. ContextHelpPanel renders collapsible tree
   ↓
8. User clicks topic → HelpHtmlRenderer displays content
```

---

## KEY FILES REFERENCE

| File | Purpose |
|------|---------|
| `index.js` | Backend API endpoints for help |
| `linkedin-messaging-followup-next/components/HelpButton.js` | Trigger button component |
| `linkedin-messaging-followup-next/components/ContextHelpPanel.js` | Help modal/panel |
| `linkedin-messaging-followup-next/components/HelpHtmlRenderer.js` | HTML content renderer |
| `linkedin-messaging-followup-next/app/start-here/page.tsx` | Start Here onboarding page |
| `linkedin-messaging-followup-next/services/api.js` | Frontend API functions |

---

## ARCHITECTURE SUMMARY

The key insight is that it's a **3-table hierarchy** (Categories → Sub-Categories → Help) filtered by the **`help_area` field** to show context-specific help, with the **`Section` field** providing tabs specifically for the Start Here onboarding page.

The system uses:
- **Event-driven UI**: HelpButton dispatches events, ContextHelpPanel listens
- **Content-type detection**: Auto-detects HTML vs Markdown in topic bodies
- **Media embedding**: Token-based media insertion with Airtable Media table
- **Caching**: 10-minute backend cache per help area
