# Backend Quick Reference Guide

## 🔥 Most Commonly Modified Functions

### **1. Lead Management (services/leadService.js)**
```javascript
// Main function: upsertLead()
// Location: Lines 8-134
// Purpose: Create or update lead records in Airtable

Key Parameters:
- lead: Lead data object
- finalScore: AI score (optional)
- aiProfileAssessment: AI assessment text (optional)
- scoringStatus: "To Be Scored" | "Scored" | "Failed"

Critical Logic:
- Profile URL canonicalization
- Connection status detection
- Date handling for connections
- Field mapping to Airtable structure
```

### **2. API Endpoints (routes/apiAndJobRoutes.js)**
```javascript
// Lead Search: Lines 850-900 (example)
// Lead Update: Lines 900-950 (example)
// Batch Scoring: Lines 228-260
// Single Lead Scoring: Lines 250-280

Common Patterns:
- Error handling with try/catch
- Airtable connection validation
- Response formatting with success/error structure
```

### **3. Webhook Processing (routes/webhookHandlers.js)**
```javascript
// LinkedHelper Webhook: Lines 17-110
// Main endpoint: POST /lh-webhook/upsertLeadOnly

Key Processing Steps:
1. Validate Airtable connection
2. Process lead array from webhook
3. Extract profile URLs and connection status
4. Determine scoring status
5. Build Sales Navigator URLs
6. Call upsertLead() for each lead
```

### **4. Batch Scoring (batchScorer.js)**
```javascript
// Main function: run()
// Chunk processing: scoreChunk()
// Lead fetching: fetchLeads()

Key Configuration:
- CHUNK_SIZE: 40 leads per batch
- GEMINI_TIMEOUT_MS: 900000 (15 minutes)
- Filter: {Scoring Status} = "To Be Scored"
```

---

## 🚀 Quick Problem Resolution

### **"Leads not updating"**
1. **Check**: API endpoint in `routes/apiAndJobRoutes.js`
2. **Verify**: `leadService.upsertLead()` function
3. **Common Issue**: Field mapping in line 85-95 of leadService.js
4. **Debug**: Check Airtable base connection

### **"AI scoring failing"**
1. **Check**: `batchScorer.js` line 80-100 for error handling
2. **Verify**: Gemini client in `config/geminiClient.js`
3. **Common Issue**: Timeout or API quota exceeded
4. **Debug**: `/debug-gemini-info` endpoint

### **"Webhook not processing"**
1. **Check**: `routes/webhookHandlers.js` line 17-30
2. **Verify**: Airtable base initialization
3. **Common Issue**: Field name mismatches
4. **Debug**: Console logs for payload structure

### **"Multi-tenant issues"**
1. **Check**: `services/clientService.js` caching
2. **Verify**: `MASTER_CLIENTS_BASE_ID` environment variable
3. **Common Issue**: Cache invalidation
4. **Debug**: `/debug-clients` endpoint

---

## 💡 Common Code Patterns

### **Error Handling Template**
```javascript
try {
    // Operation
    const result = await someOperation();
    res.json({ success: true, data: result });
} catch (error) {
    console.error("Operation failed:", error.message);
    res.status(500).json({ 
        success: false, 
        error: error.message 
    });
}
```

### **Airtable Update Pattern**
```javascript
// Check for existing record
const existing = await base("TableName")
    .select({ 
        filterByFormula: `{Key Field} = "${value}"`,
        maxRecords: 1 
    })
    .firstPage();

if (existing.length) {
    // Update existing
    await base("TableName").update(existing[0].id, fields);
} else {
    // Create new
    const created = await base("TableName").create([{ fields }]);
}
```

### **Multi-tenant Base Access**
```javascript
// Get client-specific base
const clientBase = getClientBase(clientId);
if (!clientBase) {
    throw new Error(`Base not found for client: ${clientId}`);
}

// Use client base for operations
const records = await clientBase("Leads").select().all();
```

---

## 📊 Database Schema Reference

**⚠️ MOVED TO SINGLE SOURCE OF TRUTH**
> Complete field definitions are now in `AIRTABLE-FIELD-REFERENCE.md`
> This includes all Leads table fields, Master Clients fields, and Scoring Attributes

### Quick Field Lookup
- **Core Identity:** First Name, Last Name, LinkedIn Profile URL
- **Scoring:** AI Score, AI Profile Assessment, Posts Relevance Status
- **Management:** Status, Priority, Follow-Up Date, Notes
- **Contact:** Email, Phone, Company, Job Title

**Full documentation:** See `AIRTABLE-FIELD-REFERENCE.md`

---

## 🔧 Environment Variables Quick Reference

### **Required for Basic Operation**
```bash
AIRTABLE_API_KEY=key123...
AIRTABLE_BASE_ID=app123...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
GCP_PROJECT_ID=your-project
GCP_LOCATION=us-central1
```

### **Multi-tenant Setup**
```bash
MASTER_CLIENTS_BASE_ID=app456...
```

### **AI Services**
```bash
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
OPENAI_API_KEY=sk-...
```

### **Webhooks & Notifications**
```bash
PB_WEBHOOK_SECRET=secret123
MAILGUN_API_KEY=key-...
MAILGUN_DOMAIN=mg.yourdomain.com
```

---

## 🚨 Critical Lines to Watch

### **leadService.js**
- **Line 45**: Profile key generation
- **Line 63**: Connection status logic
- **Line 75**: Scoring status handling
- **Line 85**: Field mapping to Airtable

### **batchScorer.js**
- **Line 80**: Gemini AI client check
- **Line 100**: Chunk processing logic
- **Line 200**: Error handling and recovery

### **apiAndJobRoutes.js**
- **Line 50**: Route handler setup
- **Line 150**: PB webhook processing
- **Line 650**: AI attribute editing

### **webhookHandlers.js**
- **Line 17**: Airtable validation
- **Line 40**: Lead processing loop
- **Line 60**: Sales Navigator URL construction

---

## 🎯 Testing Endpoints

### **Health Checks**
```bash
GET /health                    # Basic health check
GET /status                    # Server status
GET /debug-gemini-info         # AI service status
GET /debug-clients             # Multi-tenant status
```

### **Manual Operations**
```bash
GET /run-batch-score?limit=10  # Test batch scoring
GET /score-lead?recordId=123   # Test single scoring
POST /api/pb-webhook           # Test webhook processing
```

---

*This quick reference covers the most commonly accessed backend functions and patterns for rapid development and debugging.*
