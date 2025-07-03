# Web Portal Interface Specification

## Overview
The web portal provides a custom interface to replace Airtable interfaces, maintaining familiar functionality while enabling multi-tenant deployment and advanced features.

## Main Navigation Menu

### "Lead Search & Update"
**Purpose**: Find and update existing leads (replaces current "Existing Leads" Airtable interface)
**Primary Use Case**: Manual lead lookup and message logging when Chrome extension is not used

#### Interface Layout
```
┌─────────────────────────────────────────────────────┐
│ Lead Search & Update                                │
├─────────────────────────────────────────────────────┤
│ Search: [________________] (🔍)                     │
├─────────────────────────────────────────────────────┤
│ Results List:                                       │
│ • www.linkedin.com/in/drfrankheibel - Heibel       │
│ • www.linkedin.com/in/vinkogrgic - Grgić           │
│ • www.linkedin.com/in/aaronknowles - Aaron Knowles │
│ • ...                                               │
├─────────────────────────────────────────────────────┤
│ Selected Lead Details:                              │
│ [Lead profile and update form]                      │
└─────────────────────────────────────────────────────┘
```

#### Search Functionality
- **Search Field**: Global search across First Name and Last Name
- **Keep Simple**: No advanced filters (dedicated Follow-Up interface handles date filtering)
- **Live Results**: Display matching records immediately as user types
- **Visual Confirmation**: Show list of matching records before selection

#### Results Display
- **Format**: LinkedIn Profile URL - First Name Last Name
- **Selection**: Click on result to load details in bottom panel
- **Unique Records**: Each LinkedIn Profile URL should be unique (primary key)
- **Note**: Both First Name and Last Name are editable in the detail panel for corrections and updates

## Chrome Extension Integration

### Automated Lead Lookup
When Chrome extension captures a message from LinkedIn/Sales Navigator:

1. **Extract LinkedIn Profile URL** from current page
2. **API Call**: Check for existing lead by LinkedIn Profile URL
3. **Single Record Expected**: Should find exactly one matching record (unique key)
4. **Display Behavior**: 
   ```
   ┌──────────────────────────────────────────┐
   │ ✅ Found Lead: [First Name Last Name]    │
   │                                          │
   │ Add conversation to their notes?         │
   │                                          │
   │ [Preview & Add] [Cancel]                 │
   └──────────────────────────────────────────┘
   ```
5. **Preview Process**: Show extracted conversation with timestamp-based deduplication
6. **User Approval**: User reviews what will be added before saving to Notes field
7. **Confirmation**: Show success message with link to view full record

### Integration Workflow
```
LinkedIn/Sales Navigator Conversation
        ↓
Chrome Extension Extracts Conversation Text + Profile URL
        ↓
API: Check for existing lead by LinkedIn Profile URL
        ↓
IF FOUND: Extract timestamps, check against existing notes
        ↓
Show Preview Dialog (new content only) → User Approves → Append to Notes
```

## Data Integration

### Core Fields (Existing)
- **Profile Key** - Auto-calculated unique identifier (read-only, formula-based)
- **LinkedIn Profile URL** - Primary identifier/deduplication key (editable - users can change LinkedIn URLs)
- **View In Sales Navigator** - System-generated, user can manually update from address bar (editable)
- **First Name**, **Last Name** - Both editable for corrections and updates
- **AI Score** - Universal lead profile scoring based on headline, about section, and experience (visible, read-only - all users have this)
- **Posts Relevance Percentage** - Existing post analysis (visible, read-only)
- **Source** - Lead origin tracking
- **Notes** - Manual message logging (current focus)

### New Fields for LinkedIn Messaging
- **LinkedIn Messages** - JSON array of captured messages
- **Follow Up Date** - Next contact scheduling
- **Follow Up Notes** - Context for next interaction
- **Last Message Date** - Timeline tracking
- **Extension Last Sync** - Chrome extension sync timestamp

**Owner-Specific Fields (Hidden from Client View)**:
- **Guy's Workshop Email** - Boolean checkbox for workshop invitation tracking (Guy-specific functionality)

**Field Visibility Control**:
- **Standard Fields**: Displayed in all client interfaces
- **Hidden Fields**: Present in Airtable but not shown in web portal or Chrome extension
- **Customization Path**: Clients can purchase Airtable access + development for custom fields

**Removed Field**: **Message Source** - Eliminated due to Sales Navigator-first policy
- **Rationale**: Policy of always initiating from Sales Navigator makes this field redundant
- **Simplification**: Reduces interface complexity while maintaining full functionality

## Interface Specifications

### Search Field
- **Placeholder Text**: "Search by first name or last name..."
- **Search Behavior**: Live search (debounced, ~300ms delay)
- **Search Scope**: First Name + Last Name fields only
- **Case Insensitive**: Yes
- **Partial Matching**: Yes (contains search)

### Results List
- **Format**: `{LinkedIn Profile URL} - {First Name} {Last Name}`
- **Sorting**: Alphabetical by Last Name, then First Name
- **Selection**: Single-click to select and load details
- **Visual Feedback**: Highlight selected result
- **Max Results**: Display all matches (no pagination needed for current volume)

### Lead Details Panel
- **Layout**: Form-style with editable fields
- **Read-Only Fields**: Profile Key (formula-calculated), AI Score (universal feature), Posts Relevance Percentage
- **Editable Fields**: 
  - LinkedIn Profile URL (users can change their LinkedIn URLs)
  - View In Sales Navigator (system-generated but user can manually update from address bar)
  - First Name, Last Name (both editable for corrections and updates)
  - Notes (free-form text with conversation capture integration)
  - Follow Up Date, Follow Up Notes
- **Action Buttons**: Save Changes, View LinkedIn Profile, View in Sales Navigator, Add Manual Note
- **Success Feedback**: "Lead updated successfully" message

### Manual Note Entry
- **Access**: "Add Manual Note" button in lead detail view
- **Dialog Box**: Text area for note content with auto-filled date
- **Date Format**: Same format as conversation captures (e.g., "2025-01-15")
- **Append Behavior**: Manual notes are always appended at the top of the Notes field
- **Section Header**: Manual notes get "📝 Manual Notes" section if not existing
- **Format**: Follows same timestamp-based structure as auto-captured conversations
- **Follow-Up Reminder**: Two-step process includes follow-up date prompt
- **Preview**: User can preview how the note will appear before saving

### Manual Note Entry Workflow
```
Step 1: Add Manual Note
┌──────────────────────────────────────────┐
│ Add Manual Note                          │
│ ┌──────────────────────────────────────┐ │
│ │ Called Frank today - very interested │ │
│ │ in our services. Wants to discuss... │ │
│ │                                      │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ Date: 2025-01-15 (auto-filled)          │
│                                          │
│ [Next: Set Follow-Up] [Cancel]           │
└──────────────────────────────────────────┘

Step 2: Follow-Up Reminder
┌──────────────────────────────────────────┐
│ 📅 Update follow-up date?               │
│ Current: No follow-up set                │
│                                          │
│ ○ Tomorrow (Jan 16)                      │
│ ● Next week (Jan 22)                     │
│ ○ Custom date: [Date picker]             │
│ ○ Skip for now                           │
│                                          │
│ [Save Note & Follow-Up] [Back] [Cancel]  │
└──────────────────────────────────────────┘
```

## Technical Requirements

### Field Visibility Configuration
```javascript
// Web portal field visibility control
const fieldVisibility = {
  // Standard fields - visible to all clients
  "LinkedIn Profile URL": { visible: true, editable: true },
  "First Name": { visible: true, editable: true },
  "Last Name": { visible: true, editable: true },
  "Follow Up Date": { visible: true, editable: true },
  "Follow Up Notes": { visible: true, editable: true },
  "Notes": { visible: true, editable: true },
  
  // Read-only fields
  "Profile Key": { visible: true, editable: false },
  "AI Score": { visible: true, editable: false },
  "Posts Relevance Percentage": { visible: true, editable: false },
  
  // Owner-specific fields - hidden from clients
  "Guy's Workshop Email": { visible: false, editable: false }
};
```

### API Endpoints Needed
- `GET /api/leads/search?q={searchTerm}` - Search leads by name
- `GET /api/leads/by-linkedin-url?url={linkedinUrl}` - Find lead by LinkedIn URL (Chrome extension)
- `PUT /api/leads/{id}/notes` - Update notes field
- `POST /api/leads/{id}/manual-note` - Add manual note (appends at top with timestamp)
- `POST /api/leads/{id}/note-with-followup` - Add note and set follow-up date in single operation
- `PUT /api/leads/{id}/followup` - Set follow-up date and notes

### Error Handling
- **No Results**: "No leads found matching '{search term}'"
- **Multiple Results**: Display all matches (expected behavior)
- **Network Error**: "Unable to load leads. Please try again."
- **Save Error**: "Failed to save changes. Please try again."

## Chrome Extension API Integration

### Lead Lookup Response Format
```json
{
  "found": true,
  "lead": {
    "id": "rec123456",
    "firstName": "Frank",
    "lastName": "Heibel", 
    "company": "Company Name",
    "linkedinUrl": "www.linkedin.com/in/drfrankheibel",
    "aiScore": 74,
    "notes": "Current notes content..."
  }
}
```

### Message Update Request Format
```json
{
  "leadId": "rec123456",
  "newMessage": {
    "date": "2025-01-15T10:30:00Z",
    "content": "Hi Frank, I saw your recent post about...",
    "source": "linkedin", // or "sales_navigator"
    "platform": "linkedin.com"
  }
}
```

### Manual Note Request Format
```json
{
  "leadId": "rec123456",
  "manualNote": {
    "content": "Called Frank today - very interested in our services. Follow up next week.",
    "timestamp": "2025-01-15" // Auto-filled by system
  }
}
```

### Note with Follow-Up Request Format
```json
{
  "leadId": "rec123456",
  "manualNote": {
    "content": "Called Frank today - very interested in our services. Follow up next week.",
    "timestamp": "2025-01-15"
  },
  "followUp": {
    "date": "2025-01-22",
    "notes": "Follow up on service discussion"
  }
}
```

## Business Decisions

### Sales Navigator Requirement
- **Required for All Clients** - Sales Navigator access is mandatory
- **Rationale**: Simplifies development, ensures consistent experience, enables enhanced lead quality
- **Implementation**: Include SN requirement in service onboarding and pricing
- **Field Impact**: "View In Sales Navigator" field will be populated for all leads

### Scoring Features
- **AI Score (Lead Scoring)** - Universal profile scoring feature that evaluates lead's headline, about section, and experience against attribute instructions (all clients have access)
- **Post Scoring** - Optional paid extra that analyzes lead's posts against user-defined criteria to identify top-scoring posts for interaction opportunities
- **Distinction**: AI Score evaluates the individual person's profile data; Post Scoring evaluates their content for engagement opportunities

## Status: Lead Search & Update Interface Complete
- ✅ Menu name decided: "Lead Search & Update"
- ✅ Search functionality defined (simple, name-based)
- ✅ Chrome extension integration behavior specified
- ✅ Unique record handling confirmed
- ✅ **Field editability finalized** - Profile Key (read-only), LinkedIn Profile URL (editable), Both names (editable), Sales Navigator field (editable)
- ✅ **Notes field strategy complete** - timestamp-based deduplication with conversation capture
- ✅ **Manual note entry specified** - web portal dialog with auto-filled date, always appended at top
- ✅ **Follow-up date reminders** - prompts after note entry in both Chrome extension and web portal
- ✅ **Business decisions documented** - Sales Navigator required, AI Score universal, Post Scoring optional
- ⏳ Follow-up interface specifications (pending)

---

*This interface maintains familiar Airtable functionality while enabling seamless Chrome extension integration and multi-tenant deployment.*
