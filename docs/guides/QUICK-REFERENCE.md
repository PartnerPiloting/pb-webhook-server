# 🚀 Quick Reference Cards

> **Fast access to common operations and essential information**

---

## **📋 CURRENT PROJECT STATUS** 

```
✅ COMPLETE: Multi-Tenant Phase 1, LinkedIn Follow-Up, Apify Analysis
🔥 CRITICAL: Complex lead profile scoring failures (production issue)
🎯 NEXT: Phase 2 Endpoint Refactoring, Apify Integration
```

---

## **🏃‍♂️ DAILY OPERATIONS**

### **Check System Health**
```bash
# Health check
curl https://pb-webhook-server.onrender.com/health

# Gemini debug info  
curl https://pb-webhook-server.onrender.com/debug-gemini-info

# Client debug (requires DEBUG_API_KEY)
curl -H "x-debug-key: YOUR_KEY" https://pb-webhook-server.onrender.com/debug-clients
```

### **Manual Operations**
```bash
# Manual post scoring (all clients)
POST https://pb-webhook-server.onrender.com/run-post-batch-score

# Single client batch scoring
GET https://pb-webhook-server.onrender.com/run-batch-score?clientId=Guy-Wilson

# Manual PB posts sync
GET https://pb-webhook-server.onrender.com/api/sync-pb-posts
```

---

## **🔧 DEVELOPMENT WORKFLOW**

### **Local Development**
```bash
# Start development server
npm start

# Environment setup
cp .env.example .env.local
# Edit .env.local with your credentials

# Key environment variables
AIRTABLE_API_KEY=key...
MASTER_CLIENTS_BASE_ID=app...
PB_WEBHOOK_SECRET=Diamond9753!!@@pb
```

### **Common File Locations**
- **Main API Routes**: `routes/apiAndJobRoutes.js`
- **Multi-Tenant Config**: `config/airtableClient.js` 
- **Client Service**: `services/clientService.js`
- **Scoring Engine**: `singleScorer.js`, `batchScorer.js`

---

## **🚨 TROUBLESHOOTING QUICK FIXES**

### **Scoring Failures**
```javascript
// Check if it's a JSON issue
recordId = "recXXXXXXX"
// Look for "JSON Parse Error at position XXXX" in logs
```

### **Multi-Tenant Issues**
```javascript
// Verify client configuration
const clientService = require('./services/clientService');
const clients = await clientService.getAllActiveClients();
console.log(clients);
```

### **Webhook Problems**
```bash
# Test PB webhook locally
curl -X POST http://localhost:3000/api/pb-webhook?secret=Diamond9753!!@@pb \
  -H "Content-Type: application/json" \
  -d '{"resultObject": "[{\"profileUrl\": \"test\"}]"}'
```

---

## **📊 TASK PRIORITIES**

### **🔥 THIS WEEK**
1. **Fix production scoring failures** (complex profiles)
2. **Complete Phase 2 endpoints** (remove hardcoded clients)
3. **Start Apify webhook implementation**

### **📅 THIS MONTH** 
1. **Complete multi-tenant migration** (Phases 2-3)
2. **Implement Apify integration** (Phase 4)  
3. **Add system monitoring**

### **🎯 THIS QUARTER**
1. **Onboard first multi-tenant client**
2. **Migrate clients from PhantomBuster to Apify**
3. **Enhanced analytics and reporting**

---

## **💡 CODE SNIPPETS**

### **Multi-Tenant Client Detection**
```javascript
// Get client from header
const clientId = req.headers['x-client-id'];
const clientBase = await getClientBase(clientId);
```

### **Apify Webhook Template** 
```javascript
// Ready to implement
router.post("/api/apify-webhook", async (req, res) => {
  const authToken = req.headers.authorization;
  if (token !== process.env.APIFY_WEBHOOK_TOKEN) {
    return res.status(403).json({ error: "Invalid token" });
  }
  // Transform Apify data → syncPBPostsToAirtable()
});
```

---

## **📞 SUPPORT CONTACTS**

- **Render Platform**: render.com support dashboard
- **Airtable API**: airtable.com/developers  
- **Google VertexAI**: cloud.google.com/support
- **Apify Support**: 1.2 hour avg response time

---

## **🔗 ESSENTIAL LINKS**

| Service | URL | Purpose |
|---------|-----|---------|
| **Production App** | https://pb-webhook-server.onrender.com | Live system |
| **LinkedIn Portal** | https://pb-webhook-server.onrender.com/portal | Follow-up interface |
| **Render Dashboard** | render.com/dashboard | Hosting management |
| **Airtable Bases** | airtable.com/workspace | Data management |
| **GitHub Repo** | github.com/PartnerPiloting/pb-webhook-server | Source code |

---

*Keep this card handy for daily operations. Update when workflows change.*
