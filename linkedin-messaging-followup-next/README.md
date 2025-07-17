# LinkedIn Follow-Up Portal (Next.js Frontend)

## Overview
This is the frontend interface for the LinkedIn Lead Management system. It provides a web-based portal for searching, filtering, and managing LinkedIn leads with follow-up scheduling capabilities.

## System Context
- **Backend API**: Node.js server in parent directory (deployed on Render)
- **Database**: Airtable integration
- **Deployment**: Vercel platform
- **Purpose**: Lead management UI for LinkedIn outreach optimization

## Key Features
- **Lead Search & Filtering**: Search by name, filter by priority/status
- **Lead Management**: View, edit, and update lead information
- **Follow-Up Scheduling**: Schedule and track follow-up activities
- **AI Integration**: Display AI-generated lead scores and analysis
- **Real-time Updates**: Automatic refresh after data changes

## Architecture
Built with Next.js 14 using:
- **React 18** for UI components
- **Tailwind CSS** for styling
- **Heroicons** for icons
- **Axios** for API communication

## Critical Components

### `components/LeadSearchUpdate.js`
**Primary interface** for lead management
- Search functionality with debounced queries
- Priority filtering (All/One/Two/Three)
- Lead selection and detail viewing
- Update handling with automatic list refresh

### `components/LeadDetailForm.js`
Lead editing interface with:
- Form fields for all lead properties
- AI-powered attribute editing
- Save/delete functionality
- Validation and error handling

### `services/api.js`
API client for backend communication:
- `searchLeads()` - Search with filters
- `updateLead()` - Update lead data
- `getLeadById()` - Get full lead details
- `createLead()` - Create new leads

## Development

### Local Development
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view in browser.

### Production Deployment
Automatically deployed to Vercel on git push to main branch.

## Common Issues & Solutions

### Priority Filtering
**Issue**: Leads don't disappear when priority changes
**Solution**: Check `handleLeadUpdate()` in `LeadSearchUpdate.js`

### Search Performance
**Issue**: Search results lag or don't update
**Solution**: Verify debounced search logic and race condition handling

### Data Sync
**Issue**: Updates not persisting
**Solution**: Check API endpoints and Airtable field mapping

## Related Documentation
- **System Overview**: `../SYSTEM-OVERVIEW.md` (READ FIRST)
- **Backend API**: `../index.js` and `../services/`
- **User Guide**: `../LinkedIn-Messaging-FollowUp/README.md`
- **Quick Reference**: `../LinkedIn-Messaging-FollowUp/QUICK-REFERENCE.md`

## For AI Development Assistance
When working with AI assistants on this project:
1. Always reference `../SYSTEM-OVERVIEW.md` first
2. User prefers plain English explanations
3. Focus on specific components mentioned in requests
4. Test on deployed Vercel environment, not locally
