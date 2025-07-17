# Bootstrap Guide for New Developers

## 🚀 Getting Started with the LinkedIn Follow-Up System

### First Steps
1. **Read the System Overview**: `../../SYSTEM-OVERVIEW.md`
2. **Understand the User**: Non-technical, prefers plain English explanations
3. **Know the Architecture**: Next.js frontend + Node.js backend + Airtable

### Key Concepts to Understand

#### System Purpose
- LinkedIn lead management and follow-up automation
- AI-powered lead scoring and post analysis
- Automated workflows for LinkedIn outreach optimization

#### Technology Stack
- **Frontend**: Next.js 14, React, Tailwind CSS, Heroicons
- **Backend**: Node.js, Express, Airtable API, Google Vertex AI
- **Deployment**: Vercel (frontend) + Render (backend)
- **Database**: Airtable (Leads table, Clients table)

### Project Structure Deep Dive

#### Frontend Application (`linkedin-messaging-followup-next/`)
```
app/                           # Next.js 13+ app directory
├── page.tsx                   # Main application page
├── layout.tsx                 # App layout wrapper
└── globals.css               # Global styles

components/                    # React components
├── LeadSearchUpdate.js        # 🔥 MAIN COMPONENT
├── LeadDetailForm.js          # Lead editing interface
├── FollowUpManager.js         # Follow-up scheduling
├── NewLeadForm.js            # Manual lead creation
└── [other components]         # Various UI components

services/                      # API integration
├── api.js                     # Backend API calls
├── leadService.js            # Lead-specific operations
└── clientService.js          # Client-specific operations

utils/                         # Utility functions
└── helpers.js                # Common helper functions
```

#### Backend Application (root directory)
```
index.js                       # Main Express server
routes/                        # API route handlers
├── apiAndJobRoutes.js         # Lead management APIs
└── webhookHandlers.js         # Webhook endpoints

services/                      # Business logic
├── leadService.js             # Lead operations
└── clientService.js           # Client operations

config/                        # External service clients
├── airtableClient.js          # Airtable connection
├── geminiClient.js            # Google AI client
└── openaiClient.js            # OpenAI client
```

### Critical Files to Know

#### 1. LeadSearchUpdate.js (Frontend)
- **Purpose**: Main user interface for lead management
- **Key Functions**:
  - `handleLeadUpdate()` - Updates lead data (lines 137-170)
  - `performSearch()` - Searches leads with filters
  - `handleLeadSelect()` - Loads full lead details
- **Common Issues**: Priority filtering, auto-refresh, state management

#### 2. index.js (Backend)
- **Purpose**: Main Express server with all API routes
- **Key Endpoints**:
  - `/api/leads/*` - Lead management
  - `/lh-webhook/*` - LinkedHelper webhooks
  - `/api/pb-webhook` - PhantomBuster webhook
- **Common Issues**: Route handling, Airtable connection, error handling

#### 3. services/api.js (Frontend)
- **Purpose**: Frontend API client for backend communication
- **Key Functions**:
  - `searchLeads()` - Search with filters
  - `updateLead()` - Update lead data
  - `getLeadById()` - Get full lead details
- **Common Issues**: API endpoint URLs, error handling, data formatting

### Development Workflow

#### Working with the User
- **Communication Style**: Plain English, step-by-step explanations
- **Technical Level**: Non-technical user who has built apps with AI help
- **Testing**: Deployed environments only (no local development)
- **Process**: Commit → Deploy → Test

#### Common Request Patterns
1. **"LinkedIn portal issue"** → Start with `LeadSearchUpdate.js`
2. **"API not working"** → Check `index.js` and services
3. **"Data sync problem"** → Airtable client and webhooks
4. **"AI scoring issue"** → Batch scorer and AI config

### Debugging Strategies

#### Frontend Issues
1. Check React component state management
2. Verify API calls in browser network tab
3. Check console for JavaScript errors
4. Review component props and data flow

#### Backend Issues
1. Check API endpoint responses
2. Verify Airtable field mapping
3. Review server logs on Render
4. Check webhook payload handling

#### Data Issues
1. Verify Airtable field names match code
2. Check data transformation logic
3. Review webhook endpoint handling
4. Validate AI scoring pipeline

### Testing Approach

#### Frontend Testing
- Deploy to Vercel via git push
- Test on deployed URL
- Use browser dev tools for debugging
- Check responsive design on mobile

#### Backend Testing
- Deploy to Render via git push
- Test API endpoints with tools like Postman
- Check server logs for errors
- Verify webhook endpoints with external tools

### Common Pitfalls to Avoid

1. **Don't assume local development** - User tests on deployed environments
2. **Don't use technical jargon** - Explain in plain English
3. **Don't skip the system overview** - Always reference it first
4. **Don't forget error handling** - User needs clear error messages

### Resources for Success

- **System Overview**: `../../SYSTEM-OVERVIEW.md` (READ FIRST)
- **User Preferences**: `../../GENERAL-INSTRUCTIONS.md`
- **Technical Details**: `../../PB-Webhook-Server-Documentation.md`
- **Quick Reference**: `../QUICK-REFERENCE.md`

---

*Remember: The user built this system with AI assistance and prefers collaborative problem-solving over just receiving code dumps.*
