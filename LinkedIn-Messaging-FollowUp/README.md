# LinkedIn Messaging Follow-Up System

## Overview
The LinkedIn Messaging Follow-Up system provides a web-based interface for managing LinkedIn leads, scheduling follow-ups, and tracking communication history.

## System Components

### Frontend Portal (Next.js - Deployed on Vercel)
- **Primary Interface**: Lead search, filtering, and management
- **Key Features**: Priority filtering, lead updates, follow-up scheduling
- **Main Component**: `components/LeadSearchUpdate.js`

### Backend API (Node.js - Deployed on Render)
- **Base URL**: https://pb-webhook-server.onrender.com
- **Purpose**: Data management, AI scoring, webhook handling
- **Database**: Airtable integration

## Quick Start for Developers

### Understanding the System
1. **Read**: `../SYSTEM-OVERVIEW.md` for complete system context
2. **Frontend**: Next.js app in `../linkedin-messaging-followup-next/`
3. **Backend**: Express API in root directory

### Common Development Tasks
- **UI Issues**: Check `components/LeadSearchUpdate.js`
- **API Issues**: Check `../index.js` and `../services/`
- **Data Issues**: Check `../config/airtableClient.js`

## Key Features

### Lead Management
- Search and filter leads by priority, status, name
- Update lead information and priority
- Automatic list refresh after updates
- Manual lead creation

### Follow-Up Scheduling
- Schedule follow-up dates
- Track communication history
- Manage follow-up status

### AI Integration
- Automated lead scoring via Gemini AI
- Post relevance analysis
- Attribute-based scoring

## Development Notes

### Working with the System
- Follow the user's preference for plain English explanations
- Test on deployed environments (not local)
- Commit → Deploy → Test workflow

### Common Issues
- **Priority filtering**: Leads not disappearing when priority changes
- **Data sync**: Airtable field mapping and updates
- **Search functionality**: Debounced search and race conditions

## Related Documentation
- **System Overview**: `../SYSTEM-OVERVIEW.md`
- **Technical Details**: `../PB-Webhook-Server-Documentation.md`
- **User Preferences**: `../GENERAL-INSTRUCTIONS.md`
