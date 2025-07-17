# PB-Webhook-Server System Overview

**Last Updated:** July 17, 2025  
**Purpose:** Central navigation and context file for AI development assistance

---

## 🏗️ System Architecture Overview

### **Core System Purpose**
LinkedIn lead management and automation system that optimizes connection requests through AI-powered scoring and automated follow-up workflows.

### **Deployment Architecture**
- **Backend API**: Node.js/Express deployed on Render
- **Frontend Portal**: Next.js React app deployed on Vercel
- **Data Storage**: Airtable (primary database)
- **AI Services**: Google Gemini AI + OpenAI (backup)

---

## 📁 Project Structure

```
pb-webhook-server/
├── 🔧 Backend (Node.js/Express) - Deployed on Render
│   ├── index.js                    # Main server entry point
│   ├── routes/                     # API route handlers
│   │   ├── apiAndJobRoutes.js      # Lead management APIs
│   │   └── webhookHandlers.js      # Webhook endpoints
│   ├── services/                   # Business logic
│   │   ├── leadService.js          # Lead operations
│   │   └── clientService.js        # Client operations  
│   ├── config/                     # External service clients
│   │   ├── airtableClient.js       # Airtable connection
│   │   ├── geminiClient.js         # Google AI client
│   │   └── openaiClient.js         # OpenAI client
│   ├── utils/                      # Utility functions
│   └── 📄 Individual API files     # Legacy direct endpoints
│
├── 🎨 Frontend (Next.js/React) - Deployed on Vercel
│   ├── linkedin-messaging-followup-next/
│   │   ├── app/                    # Next.js 13+ app directory
│   │   ├── components/             # React components
│   │   │   ├── LeadSearchUpdate.js # 🔥 MAIN LEAD MANAGEMENT
│   │   │   ├── LeadDetailForm.js   # Lead editing form
│   │   │   ├── FollowUpManager.js  # Follow-up scheduling
│   │   │   └── NewLeadForm.js      # Manual lead creation
│   │   ├── services/               # Frontend API clients
│   │   │   └── api.js              # Backend API calls
│   │   └── utils/                  # Frontend utilities
│
└── 📚 Documentation/
    ├── SYSTEM-OVERVIEW.md          # 👈 THIS FILE
    ├── PB-Webhook-Server-Documentation.md # Technical specs
    ├── GENERAL-INSTRUCTIONS.md     # Working preferences
    └── LinkedIn-Messaging-FollowUp/ # Feature-specific docs
```

---

## 🔥 Key Components & Critical Files

### **Primary User Interface**
- **File**: `linkedin-messaging-followup-next/components/LeadSearchUpdate.js`
- **Purpose**: Main lead management interface with search, filtering, and updates
- **Key Functions**:
  - `handleLeadUpdate()` - Lines 137-170 - Updates lead data
  - `performSearch()` - Lead search with priority filtering
  - `handleLeadSelect()` - Load full lead details
- **Common Issues**: Priority filtering, auto-refresh after updates

### **Backend API Core**
- **File**: `index.js`
- **Purpose**: Main Express server with all API routes
- **Key Endpoints**:
  - `/api/leads/search` - Lead search with filters
  - `/api/leads/update` - Update lead data
  - `/api/leads/create` - Create new leads
  - `/lh-webhook/upsertLeadOnly` - LinkedHelper webhook
  - `/api/pb-webhook` - PhantomBuster webhook

### **Data Services**
- **Frontend API**: `linkedin-messaging-followup-next/services/api.js`
- **Backend Services**: `services/leadService.js`, `services/clientService.js`
- **Database**: Airtable via `config/airtableClient.js`

---

## 🔄 Common Workflows

### **1. Lead Management (Most Common)**
```
User Request → LeadSearchUpdate.js → services/api.js → Backend API → Airtable
```
- **Files to Check**: `LeadSearchUpdate.js`, `services/api.js`, `leadService.js`
- **Common Issues**: Filtering, state management, data sync

### **2. AI Scoring & Analysis**
```
PhantomBuster → Webhook → batchScorer.js → Gemini AI → Airtable
```
- **Files to Check**: `batchScorer.js`, `config/geminiClient.js`, webhook endpoints

### **3. Follow-up Management**
```
User → FollowUpManager.js → Lead updates → Scheduling
```
- **Files to Check**: `FollowUpManager.js`, follow-up related APIs

---

## 🎯 Quick Problem Resolution

### **"LinkedIn follow-up portal issue"**
- **Primary File**: `linkedin-messaging-followup-next/components/LeadSearchUpdate.js`
- **Common Functions**: `handleLeadUpdate()`, `performSearch()`, filtering logic
- **Related Files**: `LeadDetailForm.js`, `services/api.js`

### **"API/Backend issue"**
- **Primary File**: `index.js`
- **Check**: Route handlers in `routes/`, service logic in `services/`
- **Common Issues**: Airtable connection, webhook endpoints

### **"AI/Scoring issue"**
- **Primary Files**: `batchScorer.js`, `config/geminiClient.js`
- **Check**: Gemini AI configuration, scoring logic

### **"Data sync issue"**
- **Check**: `config/airtableClient.js`, webhook handlers
- **Common Issues**: Field mapping, data transformation

---

## 🚀 Development Context

### **Working Style** (from GENERAL-INSTRUCTIONS.md)
- **Non-technical user**: "I am not a coder but with AI assistance I have created many apps"
- **Plain English**: Explain concepts in simple terms, avoid technical jargon
- **Step-by-step**: Break down complex tasks into sequential steps
- **AI does the coding**: User relies on AI for all code implementation
- **Collaborative approach**: Help think through problems and solutions together
- **Testing workflow**: Commit → Deploy on Render/Vercel → Test there (no local development)
- **Guidance style**: Provide clear, actionable instructions with explanations

### **Current Deployments**
- **Backend**: Render (https://pb-webhook-server.onrender.com)
- **Frontend**: Vercel (LinkedIn follow-up portal)
- **Data**: Airtable (Leads table, Clients table)

### **Key Dependencies**
- **Backend**: Express, Airtable, Google Vertex AI, OpenAI
- **Frontend**: Next.js, React, Tailwind CSS, Heroicons
- **External**: LinkedHelper, PhantomBuster, Google Sheets

---

## 📋 Development Checklist

### **For New AI Assistant Sessions**
1. ✅ Read this SYSTEM-OVERVIEW.md file first
2. ✅ Remember: User is non-technical, needs plain English explanations
3. ✅ User relies on AI for ALL coding - don't just suggest, implement
4. ✅ Break down solutions into simple, step-by-step explanations
5. ✅ Test on deployed environments (Render/Vercel), not locally
6. ✅ Identify the specific component/workflow involved
7. ✅ Check related files and functions
8. ✅ Provide clear, actionable solutions

### **For Common Requests**
- **UI Issues**: Start with `LeadSearchUpdate.js` or relevant component
- **API Issues**: Check `index.js` routes and service files
- **Data Issues**: Examine Airtable client and webhook handlers
- **AI Issues**: Review scoring files and AI client configuration

---

## 📚 Additional Documentation

### **Core System Documentation**
- **SYSTEM-OVERVIEW.md** - This file (central navigation)
- **GENERAL-INSTRUCTIONS.md** - User working style and approach
- **ENVIRONMENT-MANAGEMENT.md** - Environment variables and deployment
- **DEBUGGING-GUIDE.md** - Common issues and solutions

### **Backend Documentation**
- **BACKEND-DEEP-DIVE.md** - Comprehensive backend architecture and components
- **BACKEND-QUICK-REFERENCE.md** - Most commonly modified functions and patterns
- **PB-Webhook-Server-Documentation.md** - Legacy technical documentation

### **Frontend/LinkedIn Documentation**
- **linkedin-messaging-followup-next/README.md** - Frontend system overview
- **LinkedIn-Messaging-FollowUp/QUICK-REFERENCE.md** - Quick solutions
- **LinkedIn-Messaging-FollowUp/BOOTSTRAP_FOR_NEW_DEVS.md** - Developer onboarding

### **Deployment Documentation**
- **README-LIVE-DEPLOYMENTS.md** - Live deployment information
- **TASK-LIST.md** - Current development tasks

---

*This file serves as the central navigation hub for AI development assistance. Always reference this first when starting a new conversation or tackling a complex issue.*
