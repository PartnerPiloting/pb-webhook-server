# LinkedIn Follow-Up Portal - React Interface

This is the React-based web portal for the LinkedIn Follow-Up system, providing a custom interface to replace Airtable interfaces for multi-tenant lead management.

## Overview

The portal provides the **Lead Search & Update** screen as a client-facing replacement for the Airtable "Leads" interface, with additional screens planned for follow-up management and new lead processing.

## Features

### Lead Search & Update (Primary Screen)
- **Global Search**: Search across first name and last name fields
- **Live Results**: Real-time search results as you type
- **Lead Details**: Comprehensive form for editing lead information
- **Field Management**: Based on the master Airtable field list
- **Chrome Extension Integration**: Designed to work with LinkedIn message capture

### Field Support
Based on the master field list from `docs/airtable-field-master-list.md`:

#### Editable Fields
- Basic Info: First Name, Last Name, LinkedIn Profile URL, Sales Navigator URL, Email
- Status: Source, Status, Priority, LinkedIn Connection Status
- Follow-up: Follow-up Date, Follow-up Notes
- Communication: Notes (manual + auto-captured conversations)

#### Read-only Fields
- Profile Key (auto-generated formula)
- AI Score (system-generated)
- Posts Relevance Percentage (calculated)
- Last Message Date (system-updated)

#### Hidden Fields (Multi-tenant)
- Owner-specific fields (e.g., "Add to Workshop Invite List")
- System fields (LinkedIn Messages JSON, Extension Last Sync)

## Installation

```bash
# Navigate to the web portal directory
cd LinkedIn-Messaging-FollowUp/web-portal

# Install dependencies
npm install

# Start development server
npm start
```

## Development Scripts

```bash
# Start development server (http://localhost:3000)
npm start

# Build for production
npm build

# Run tests
npm test

# Eject (not recommended)
npm run eject
```

## Project Structure

```
src/
├── components/
│   ├── Layout.js              # Main layout with navigation
│   ├── LeadSearchUpdate.js    # Primary lead search interface
│   ├── LeadDetailForm.js      # Lead editing form
│   ├── FollowUpManager.js     # Placeholder for follow-up screen
│   └── NewLeads.js           # Placeholder for new leads screen
├── services/
│   └── api.js                # API service layer
├── utils/
│   └── helpers.js            # Utility functions
├── index.css                 # Tailwind CSS and custom styles
├── index.js                  # React app entry point
└── App.js                    # Main app component with routing
```

## API Integration

The portal expects API endpoints for:

### Lead Management
- `GET /api/leads/search?q={query}` - Search leads by name
- `GET /api/leads/{id}` - Get lead details
- `PUT /api/leads/{id}` - Update lead
- `GET /api/leads/by-linkedin-url?url={url}` - Find lead by LinkedIn URL

### Message History
- `POST /api/leads/{id}/messages` - Add message to history
- `GET /api/leads/{id}/messages` - Get message history

### Chrome Extension Integration
- `POST /api/extension/sync` - Sync data from Chrome extension

## Configuration

### Environment Variables
Create a `.env` file in the web-portal directory:

```env
REACT_APP_API_BASE_URL=http://localhost:3000/api
```

### Tailwind CSS
The project uses Tailwind CSS with custom LinkedIn-themed colors and utility classes. Configuration is in `tailwind.config.js`.

## Integration Points

### Chrome Extension
The portal is designed to work seamlessly with the Chrome extension:
- Extension captures LinkedIn conversations and profile data
- Portal provides interface for manual updates and notes
- Shared API endpoints for data synchronization

### Airtable Backend
- Maps directly to Airtable "Leads" table structure
- Maintains field compatibility with existing data
- Supports the complete field visibility strategy

### Multi-tenant Support
- Field visibility based on user role (owner vs client)
- Owner-specific fields hidden from client interfaces
- Authentication integration ready (WordPress Application Passwords)

## Development Status

### ✅ Completed
- Project setup with React 18 and Tailwind CSS
- Main layout with navigation tabs
- Lead Search & Update interface
- Comprehensive lead detail form
- API service layer with error handling
- Utility functions for data formatting
- Field visibility and validation logic

### 🚧 In Progress
- API endpoint implementation in pb-webhook-server
- Chrome extension integration
- Authentication integration

### 📋 Planned (Phase 2)
- Follow-Up Manager screen
- New Leads processing screen
- Advanced filtering and sorting
- Bulk operations
- Export functionality

## Field Mapping

The interface maps directly to Airtable fields as documented in `docs/airtable-field-master-list.md`:

| Portal Field | Airtable Field | Type | Editable |
|-------------|---------------|------|----------|
| firstName | First Name | Text | Yes |
| lastName | Last Name | Text | Yes |
| linkedinProfileUrl | LinkedIn Profile URL | URL | Yes |
| viewInSalesNavigator | View In Sales Navigator | URL | Yes |
| email | Email | Email | Yes |
| notes | Notes | Long Text | Yes |
| followUpDate | Follow Up Date | Date | Yes |
| followUpNotes | Follow Up Notes | Text | Yes |
| source | Source | Single Select | Yes |
| status | Status | Single Select | Yes |
| priority | Priority | Single Select | Yes |
| linkedinConnectionStatus | LinkedIn Connection Status | Single Select | Yes |
| profileKey | Profile Key | Formula | No |
| aiScore | AI Score | Number | No |
| postsRelevancePercentage | Posts Relevance Percentage | Formula | No |
| lastMessageDate | Last Message Date | Date | No |

## Notes Field Strategy

Implements the comprehensive notes strategy from `docs/notes-field-specification.md`:
- Manual notes preserved with timestamps
- Auto-captured conversations appended
- Deduplication logic prevents double-capture
- Sectioned approach for readability

## Next Steps

1. **Backend API Implementation**: Create corresponding API endpoints in pb-webhook-server
2. **Authentication Setup**: Integrate WordPress Application Password authentication
3. **Chrome Extension**: Build companion extension for LinkedIn message capture
4. **Testing**: Integration testing with real Airtable data
5. **Deployment**: Production deployment strategy

## Related Documentation

- `../docs/web-portal-spec.md` - Detailed interface specifications
- `../docs/airtable-field-master-list.md` - Complete field reference
- `../docs/notes-field-specification.md` - Notes handling strategy
- `../docs/chrome-extension-spec.md` - Extension integration details
