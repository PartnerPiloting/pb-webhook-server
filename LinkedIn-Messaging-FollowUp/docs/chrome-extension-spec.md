# Chrome Extension Functional Specification

## Overview
Single Chrome extension that works on both LinkedIn.com and Sales Navigator, providing seamless message capture and lead management integration with the existing pb-webhook-server multi-tenant infrastructure.

## Decisions Made

### Platform Support
- **Target Platforms**: LinkedIn.com AND Sales Navigator (single extension)
- **Rationale**: Unified user experience, single installation, shared authentication
- **Implementation**: Platform detection with adaptive DOM selectors

### Authentication Strategy
- **Method**: WordPress Application Passwords (long-lived, secure)
- **Setup**: One-time credential entry in extension settings
- **Integration**: PMpro subscription validation via existing pb-webhook-server
- **Multi-tenant**: WordPress user → Client ID → Airtable base mapping

### Data Integration
- **Backend**: Existing pb-webhook-server multi-tenant infrastructure
- **Storage**: Extend existing "Leads" table with 6 new fields
- **AI Integration**: Leverage existing Gemini scoring for engagement context
- **Deduplication**: Use existing LinkedIn Profile URL as primary key

## Chrome Extension Permissions
```json
{
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://salesnavigator.linkedin.com/*"
  ],
  "permissions": [
    "storage",
    "activeTab"
  ]
}
```

## Core Functionality

### Message Capture Workflow
**When user clicks "Capture Conversation" on LinkedIn/Sales Navigator:**

1. **Platform Detection**: Determine if on LinkedIn.com or Sales Navigator
2. **Text Extraction**: Extract conversation content from messaging area using simple DOM queries
3. **Profile URL Extraction**: Get LinkedIn Profile URL from current page
4. **API Call**: Check for existing lead by LinkedIn Profile URL  
5. **Expected Result**: Single matching record (LinkedIn Profile URL is unique key)
6. **Timestamp Analysis**: Extract timestamps from conversation text
7. **Deduplication Check**: Compare timestamps against existing notes content
8. **Preview Dialog**: Show only new content that will be added
9. **User Approval**: Get confirmation before updating notes
4. **Display Confirmation**: 
   ```
   ┌──────────────────────────────────────────┐
   │ ✅ Found Lead: [First Name Last Name]    │
   │                                          │
   │ New conversation content to add:         │
   │ Today 7:31 AM - Sam: Is it possible...   │
   │ Today 12:22 PM - You: Hi Sam, Yes...     │
   │                                          │
   │ [Add to Notes] [Cancel]                  │
   └──────────────────────────────────────────┘
   ```
5. **Notes Update**: Append new conversation content to existing Notes field
6. **Follow-Up Reminder Modal**: Prompt user to set/update follow-up date
   ```
   ┌──────────────────────────────────────────┐
   │ ✅ Message captured and saved!           │
   │                                          │
   │ 📅 Set follow-up reminder?              │
   │ Current: Jan 10, 2025 (overdue)         │
   │                                          │
   │ [Tomorrow] [Next Week] [Custom] [Skip]   │
   └──────────────────────────────────────────┘
   ```
7. **Success Confirmation**: Show "Conversation added successfully" with link to view record

### Lead Management
- **Deduplication**: Check existing leads by LinkedIn Profile URL (unique key)
- **Timestamp-based Updates**: Only add conversation content with timestamps not already in Notes field
- **Profile Data**: Leverage existing profile extraction patterns from pb-webhook-server
- **Follow-up Scheduling**: Prompt user to set next contact date and notes after conversation capture

### Follow-Up Date Reminder System

**Trigger**: After successful message capture and notes update

**Smart Logic**:
- **No Existing Follow-Up**: Default to "Next Week" (7 days from today)
- **Existing Follow-Up in Past**: Highlight as "overdue" and suggest new date
- **Existing Follow-Up in Future**: Show current date, ask "Keep or update?"

**Quick Options**:
- **Tomorrow**: +1 day from today
- **Next Week**: +7 days from today  
- **Custom**: Date picker for specific date
- **Skip**: No follow-up update (can set later via web portal)

**UI Behavior**:
- Modal appears immediately after successful notes save
- Pre-selects "Next Week" as sensible default for most sales workflows
- Shows current follow-up status for context
- One-click acceptance or easy customization

### Web Portal Integration
**Chrome Extension ↔ "Lead Search & Update" Interface:**
- Extension uses same API endpoints as web portal
- Both interfaces access same Airtable data via pb-webhook-server
- Web portal provides fallback for manual lead lookup when extension not available
- Consistent data format and update patterns across both interfaces

### Sales Navigator-First Messaging Policy
**Recommended Workflow for All Clients:**
1. **Lead Discovery**: Find prospects using Sales Navigator search
2. **Initiate Contact**: Always send first message via Sales Navigator messaging
3. **Connection Requests**: Accept requests, then immediately message via Sales Navigator
4. **Conversation Continuity**: Replies typically stay within Sales Navigator ecosystem
5. **Edge Case - InMail**: Reply once in LinkedIn, then move conversation to Sales Navigator if possible

**Benefits**:
- **Consistent Platform**: Reduces platform-switching confusion
- **Enhanced Data**: Sales Navigator provides richer context during messaging
- **Simplified Tracking**: No need to track "where" conversations happen
- **Better Deliverability**: Sales Navigator messages often have higher engagement rates

### Platform Adaptation
```javascript
// Platform detection and adaptive behavior
if (window.location.hostname.includes('linkedin.com')) {
  // LinkedIn-specific DOM selectors and logic
} else if (window.location.hostname.includes('salesnavigator.linkedin.com')) {
  // Sales Navigator-specific DOM selectors and logic
}
```

## New Airtable Fields Integration
The extension will populate these 5 new standard fields in the existing "Leads" table:
- `LinkedIn Messages` - JSON array of message history
- `Follow-Up Date` - Next contact scheduling  
- `Follow Up Notes` - Context for next interaction
- `Last Message Date` - Timeline tracking
- `Extension Last Sync` - Chrome extension sync timestamp

**Owner-Specific Fields (Not Exposed in Extension UI)**:
- `Guy's Workshop Email` - Workshop invitation tracking (Guy-specific, hidden from clients)

**Field Visibility Strategy**:
- **Chrome Extension**: Only interacts with standard messaging-related fields
- **Hidden Fields**: Present in Airtable but not exposed in extension interface
- **Client Experience**: Clean, focused interface without owner-specific functionality

**Removed Field**: `Message Source` - Eliminated due to Sales Navigator-first messaging policy
- **Policy**: Always initiate conversations from Sales Navigator
- **Auto-Detection**: Extension automatically detects platform but doesn't store selection
- **Simplification**: Reduces user interface complexity and decision fatigue

## API Integration Points
Extension will use these pb-webhook-server endpoints (to be created):
- `POST /api/linkedin/leads/check-exists` - Check if lead exists by LinkedIn URL
- `POST /api/linkedin/leads/add-message` - Add message to existing lead
- `POST /api/linkedin/leads/create` - Create new lead with message
- `PUT /api/linkedin/leads/set-followup` - Set follow-up date and notes

## Technical Architecture

### File Structure
```
chrome-extension/
├── manifest.json
├── background.js
├── content-scripts/
│   ├── linkedin.js
│   └── sales-navigator.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── settings/
│   ├── settings.html
│   ├── settings.js
│   └── settings.css
└── utils/
    ├── auth.js
    ├── api.js
    └── storage.js
```

### Key Components
- **Content Scripts**: Platform-specific DOM interaction
- **Background Script**: API communication and data processing
- **Popup Interface**: Quick actions and status display
- **Settings Page**: Authentication setup and configuration
- **Utilities**: Shared authentication, API, and storage functions

## User Workflow (To Be Detailed)

### First-Time Setup
1. Install extension from Chrome Web Store
2. Click extension icon → Settings
3. Generate WordPress Application Password
4. Enter credentials → Validate subscription
5. Extension ready for use

### Daily Usage
1. Send/receive LinkedIn message
2. Click "Add to Airtable" button (injected by extension)
3. Extension checks for existing lead
4. If new: Create lead, If exists: Add message
5. Prompt for follow-up date and notes
6. Sync to Airtable via pb-webhook-server APIs
7. Show confirmation with link to Airtable record

## Integration with Existing Systems

### Leverage Current Infrastructure
- **Multi-tenant client management** via `clientService.js`
- **Airtable dynamic base switching** via `airtableClient.js`
- **Lead upsert functionality** via `leadService.js`
- **AI scoring context** from existing post and lead scoring
- **Error handling patterns** from pb-webhook-server

### Extend Current Capabilities
- **Message history tracking** alongside existing profile data
- **Follow-up scheduling** complementing existing lead scoring
- **Real-time sync** enhancing existing batch processing

## Status: Core Specification Complete
- ✅ Platform scope defined (LinkedIn + Sales Navigator)
- ✅ Authentication strategy confirmed (WordPress App Passwords)
- ✅ Data integration approach finalized (extend existing schema)
- ✅ Technical architecture outlined
- ✅ **Sales Navigator requirement confirmed** - all clients must have Sales Navigator access
- ✅ **Field editability decisions finalized** - all names editable, Sales Navigator field editable
- ✅ **Notes field strategy complete** - timestamp-based deduplication with simple conversation capture
- ✅ **Message capture workflow defined** - simplified text extraction with user preview and approval
- ⏳ UI/UX specifications (button placement, visual design)
- ⏳ Implementation roadmap (pending)

## Next Steps
1. **DOM Analysis** - Identify CSS selectors for conversation areas in LinkedIn/Sales Navigator
2. **MVP Development** - Build basic conversation capture with timestamp deduplication
3. **API Endpoint Implementation** - Develop lead lookup and notes update endpoints
4. **User Testing** - Validate workflow with real conversation data

---

*Core functionality and business logic are now fully specified. Ready for implementation phase.*
