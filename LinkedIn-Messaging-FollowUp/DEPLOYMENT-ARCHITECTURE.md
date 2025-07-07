# LinkedIn Follow-Up System - Deployment Architecture

## 🏗️ **Current Architecture (CORRECTED)**

### **Backend - Render.com ✅**
- **Platform**: Render.com
- **URL**: `https://pb-webhook-server.onrender.com`
- **Purpose**: API endpoints and server logic
- **Status**: ✅ Working correctly

#### **API Endpoints**
- `GET /api/linkedin/test` - Connection test
- `GET /api/linkedin/leads/search?q=query&client=Guy-Wilson` - Search leads
- `GET /api/linkedin/leads/:id?client=Guy-Wilson` - Get lead details
- `POST /api/linkedin/leads/:id/update?client=Guy-Wilson` - Update lead
- `GET /api/linkedin/debug` - Debug information

### **Frontend - Vercel.com ✅**
- **Platform**: Vercel.com
- **URL**: `https://pb-webhook-server.vercel.app`
- **Purpose**: Next.js user interface
- **Directory**: `linkedin-messaging-followup-next/`
- **Status**: ✅ Deployed (with latest Airtable-style improvements)

#### **Frontend Features**
- Lead search and management
- Airtable-style left-aligned labels
- Optimized width distribution (25% sidebar, 75% main)
- Professional styling and typography

## 🚨 **Issues Fixed**

### **❌ REMOVED: Broken Portal Routes**
The following routes were **removed** from `index.js` as they were serving non-existent files:
```javascript
// REMOVED - These were broken:
app.get('/portal', (req, res) => { ... });
app.get('/linkedin', (req, res) => { ... });
```

### **✅ CORRECTED: Documentation**
- Updated all references to point to correct URLs
- Removed false claims about `/portal` working
- Clarified separation between backend and frontend

## 🔧 **Development Workflow**

### **Backend Development (Render)**
```bash
# Make API changes
git add .
git commit -m "API updates"
git push origin main
# Auto-deploys to Render
```

### **Frontend Development (Vercel)**
```bash
cd linkedin-messaging-followup-next
# Make UI changes
npm run build
git add .
git commit -m "UI improvements"  
git push origin main
# Auto-deploys to Vercel
```

## 🌐 **CORS Configuration**
Backend correctly configured to allow frontend requests:
```javascript
origin: [
    'https://pb-webhook-server.vercel.app',
    'https://pb-webhook-server-*.vercel.app'
]
```

## 📋 **Testing URLs**
- **Frontend**: `https://pb-webhook-server.vercel.app`
- **API Test**: `https://pb-webhook-server.onrender.com/api/linkedin/test`
- **API Debug**: `https://pb-webhook-server.onrender.com/api/linkedin/debug`

## 📚 **Related Files**
- **Backend Config**: `index.js`, `LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js`
- **Frontend Config**: `linkedin-messaging-followup-next/services/api.js`
- **Deployment**: `linkedin-messaging-followup-next/render.yaml` (alternative), Vercel auto-deploy

---

*This document replaces previous confusing deployment references and provides the correct, working architecture.* 