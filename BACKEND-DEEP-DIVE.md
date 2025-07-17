# Backend Deep Dive Documentation

## 🏗️ Architecture Overview

The PB-Webhook-Server backend is a **Node.js/Express** application deployed on **Render** that serves as the central hub for LinkedIn lead management automation. It integrates multiple external services and provides APIs for the frontend while handling webhook-triggered data processing.

---

## 🔧 Core Technology Stack

### **Runtime & Framework**
- **Node.js** - JavaScript runtime environment
- **Express.js** - Web application framework
- **Render** - Cloud hosting platform

### **External Integrations**
- **Airtable** - Primary database (multiple bases)
- **Google Gemini AI** - AI scoring and analysis
- **OpenAI** - Backup AI service for attribute editing
- **LinkedHelper** - LinkedIn automation webhooks
- **PhantomBuster** - Data scraping and automation

### **Key Dependencies**
- `@google-cloud/vertexai` - Google AI integration
- `airtable` - Airtable API client
- `express` - Web framework
- `dotenv` - Environment variable management
- `cors` - Cross-origin resource sharing
- `dirty-json` - JSON parsing for malformed data
- `node-fetch` - HTTP requests

---

## 📂 File Structure Deep Dive

### **Entry Point**
```
index.js                    # Main server file - initializes all services
```

### **API Routes**
```
routes/
├── apiAndJobRoutes.js      # Main API endpoints (1006 lines)
└── webhookHandlers.js      # Webhook endpoints (125 lines)
```

### **Business Logic**
```
services/
├── leadService.js          # Lead data operations
├── clientService.js        # Multi-tenant client management
└── (other services)
```

### **Configuration**
```
config/
├── airtableClient.js       # Airtable database connections
├── geminiClient.js         # Google AI configuration
└── openaiClient.js         # OpenAI configuration
```

### **Utilities**
```
utils/
├── appHelpers.js           # Common utility functions
├── pbPostsSync.js          # PhantomBuster data sync
└── (other utilities)
```

---

## 🔥 Critical Components Analysis

### **1. Main Server (index.js)**

**Purpose**: Server initialization and route mounting
**Key Functions**:
- Environment setup and validation
- Service client initialization (Airtable, Gemini, OpenAI)
- Route mounting and middleware configuration
- CORS configuration for frontend communication
- Error handling and logging

**Critical Code Sections**:
```javascript
// Lines 11-20: Service initialization
const geminiConfig = require('./config/geminiClient.js');
const globalGeminiModel = geminiConfig ? geminiConfig.geminiModel : null;
const base = require('./config/airtableClient.js');

// Lines 106-118: CORS configuration
app.use(cors({
    origin: [
        'https://pb-webhook-server.vercel.app',
        'https://pb-webhook-server-*.vercel.app'
    ],
    credentials: true
}));

// Lines 220-240: Route mounting
app.use('/api/linkedin', linkedinRoutes);
app.use(appRoutes);
```

### **2. API Routes (routes/apiAndJobRoutes.js)**

**Purpose**: Main API endpoint handlers
**Size**: 1,006 lines - the largest backend file
**Key Endpoints**:

#### **Lead Management**
- `GET /api/linkedin/leads` - Lead search with filters
- `POST /api/linkedin/leads` - Create new lead
- `PUT /api/linkedin/leads/:id` - Update lead
- `DELETE /api/linkedin/leads/:id` - Delete lead

#### **AI Scoring**
- `GET /run-batch-score` - Batch AI scoring
- `GET /score-lead` - Single lead scoring
- `POST /run-post-batch-score` - Multi-tenant post scoring

#### **PhantomBuster Integration**
- `POST /api/pb-webhook` - PhantomBuster webhook handler
- `GET /api/initiate-pb-message` - Trigger PB message sending

#### **Attribute Management**
- `GET /api/attributes` - List scoring attributes
- `GET /api/attributes/:id/edit` - Get attribute for editing
- `POST /api/attributes/:id/ai-edit` - AI-powered attribute editing
- `POST /api/attributes/:id/save` - Save attribute changes

**Critical Dependencies**:
```javascript
// Lines 1-25: Core dependencies
const geminiConfig = require("../config/geminiClient.js");
const airtableBase = require("../config/airtableClient.js");
const { scoreLeadNow } = require("../singleScorer.js");
const batchScorer = require("../batchScorer.js");
const { loadAttributes } = require("../attributeLoader.js");
```

### **3. Webhook Handlers (routes/webhookHandlers.js)**

**Purpose**: External webhook processing
**Key Webhook**:
- `POST /lh-webhook/upsertLeadOnly` - LinkedHelper webhook

**Critical Logic**:
```javascript
// Lines 40-90: Lead data processing
const isLikelyExistingConnectionUpdate = (
    lh.connectionDegree === "1st" ||
    lh.connectionStatus === "Connected"
);

const scoringStatusForThisLead = isLikelyExistingConnectionUpdate 
    ? undefined 
    : "To Be Scored";
```

### **4. Lead Service (services/leadService.js)**

**Purpose**: Core lead data operations
**Key Function**: `upsertLead()` - Create or update lead records

**Critical Features**:
- Profile URL canonicalization
- Connection status management
- Date handling for connections
- Field mapping and validation
- Scoring status preservation

**Key Code Sections**:
```javascript
// Lines 20-30: Field extraction and mapping
const {
    firstName = "", lastName = "", headline = "",
    linkedinProfileUrl = "", connectionDegree = "",
    connectionSince, scoringStatus, raw,
    "View In Sales Navigator": viewInSalesNavigatorUrl,
    ...rest
} = lead;

// Lines 85-95: Airtable record creation/update
if (existing.length) {
    await base("Leads").update(existing[0].id, fields);
} else {
    const createdRecords = await base("Leads").create([{ fields }]);
}
```

### **5. Client Service (services/clientService.js)**

**Purpose**: Multi-tenant client management
**Key Features**:
- Client data caching (5-minute TTL)
- Active client filtering
- Environment variable validation

**Critical Functions**:
- `getAllClients()` - Fetch all clients
- `getAllActiveClients()` - Fetch active clients only
- `getActiveClients(clientId)` - Get specific or all active clients

### **6. Batch Scorer (batchScorer.js)**

**Purpose**: AI-powered lead scoring automation
**Size**: 632 lines
**Key Features**:
- Multi-tenant support
- Chunk processing (55 leads per batch)
- Error isolation and recovery
- Timeout handling (15-minute timeout)

**Critical Configuration**:
```javascript
// Lines 16-20: Configuration
const CHUNK_SIZE = 55;
const GEMINI_TIMEOUT_MS = 900000; // 15 minutes
const DEFAULT_MODEL_ID = "gemini-2.5-pro-preview-05-06";
```

**Processing Flow**:
1. Fetch leads with `{Scoring Status} = "To Be Scored"`
2. Process in chunks of 55 leads
3. Generate AI prompts for each lead
4. Score leads using Gemini AI
5. Update Airtable with scores and assessments

---

## 🔌 Configuration Deep Dive

### **1. Airtable Client (config/airtableClient.js)**

**Purpose**: Database connection management
**Key Features**:
- Base instance caching
- Multi-tenant base support
- Error handling and validation

**Critical Environment Variables**:
- `AIRTABLE_API_KEY` - API authentication
- `AIRTABLE_BASE_ID` - Primary base ID
- `MASTER_CLIENTS_BASE_ID` - Multi-tenant clients base

### **2. Gemini Client (config/geminiClient.js)**

**Purpose**: Google AI service configuration
**Authentication**: Uses `GOOGLE_APPLICATION_CREDENTIALS` environment variable

**Critical Configuration**:
```javascript
// Lines 15-25: Client initialization
const initializedVertexAIClient = new VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_LOCATION
});

const defaultGeminiModelInstance = initializedVertexAIClient.getGenerativeModel({ 
    model: MODEL_ID_FROM_ENV 
});
```

**Key Environment Variables**:
- `GOOGLE_APPLICATION_CREDENTIALS` - Service account key file path
- `GCP_PROJECT_ID` - Google Cloud project ID
- `GCP_LOCATION` - Google Cloud region
- `GEMINI_MODEL_ID` - AI model version

### **3. OpenAI Client (config/openaiClient.js)**

**Purpose**: Backup AI service for attribute editing
**Usage**: Fallback when Gemini is unavailable

---

## 🌐 API Endpoints Reference

### **Core Lead Management**
```
GET    /api/linkedin/leads              # Search leads with filters
POST   /api/linkedin/leads              # Create new lead
PUT    /api/linkedin/leads/:id          # Update lead
DELETE /api/linkedin/leads/:id          # Delete lead
GET    /api/linkedin/leads/:id          # Get lead details
```

### **AI Scoring**
```
GET    /run-batch-score                 # Batch scoring (limit param)
GET    /score-lead                      # Single lead scoring
POST   /run-post-batch-score            # Multi-tenant post scoring
```

### **Webhooks**
```
POST   /lh-webhook/upsertLeadOnly       # LinkedHelper webhook
POST   /api/pb-webhook                  # PhantomBuster webhook
```

### **Attribute Management**
```
GET    /api/attributes                  # List all attributes
GET    /api/attributes/:id/edit         # Get attribute for editing
POST   /api/attributes/:id/ai-edit      # AI-powered editing
POST   /api/attributes/:id/save         # Save changes
```

### **Utility Endpoints**
```
GET    /health                          # Health check
GET    /status                          # Server status
GET    /debug-gemini-info              # AI client debug info
GET    /debug-clients                  # Client debug info
```

---

## 📊 Data Flow Analysis

### **1. Lead Creation Flow**
```
LinkedHelper → Webhook → leadService.upsertLead() → Airtable
```

### **2. AI Scoring Flow**
```
Scheduler → batchScorer.run() → fetchLeads() → scoreChunk() → Gemini AI → Airtable
```

### **3. Frontend API Flow**
```
Frontend → API Routes → Service Layer → Airtable → Response
```

### **4. PhantomBuster Integration**
```
PhantomBuster → /api/pb-webhook → JSON Processing → Airtable Updates
```

---

## 🛠️ Key Utilities Analysis

### **1. App Helpers (utils/appHelpers.js)**

**Critical Functions**:
- `alertAdmin()` - Email notifications via Mailgun
- `getJsonUrl()` - Extract JSON URLs from complex objects
- `canonicalUrl()` - Normalize LinkedIn URLs
- `safeDate()` - Safe date parsing
- `isMissingCritical()` - Validate required fields

### **2. Scoring Components**
- `promptBuilder.js` - Generate AI prompts
- `attributeLoader.js` - Load scoring attributes
- `scoring.js` - Calculate final scores
- `breakdown.js` - Generate score breakdowns

---

## 🚀 Performance Considerations

### **Batch Processing**
- **Chunk Size**: 55 leads per batch (optimized for Gemini API)
- **Timeout**: 15-minute timeout for AI requests
- **Queue System**: Internal queuing for chunk processing
- **Error Isolation**: Failed chunks don't affect others

### **Caching Strategy**
- **Client Data**: 5-minute TTL cache
- **Airtable Bases**: Instance caching for multi-tenant support

### **Resource Management**
- **Memory**: JSON parsing with dirty-json for malformed data
- **CPU**: Concurrent processing with queue management
- **Network**: Retry logic for external API calls

---

## 🔐 Security & Environment

### **Authentication**
- **Webhook Security**: Secret-based authentication
- **API Keys**: Environment variable storage
- **CORS**: Configured for specific frontend domains

### **Critical Environment Variables**
```bash
# Database
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
MASTER_CLIENTS_BASE_ID=your_clients_base_id

# AI Services
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCP_PROJECT_ID=your_project_id
GCP_LOCATION=your_location
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
OPENAI_API_KEY=your_openai_key

# Webhooks
PB_WEBHOOK_SECRET=your_webhook_secret

# Notifications
MAILGUN_API_KEY=your_mailgun_key
MAILGUN_DOMAIN=your_domain
ALERT_EMAIL=admin@yourdomain.com
FROM_EMAIL=noreply@yourdomain.com
```

---

## 🐛 Common Issues & Debugging

### **1. Gemini AI Issues**
- **Symptom**: Scoring fails with timeout
- **Check**: `debug-gemini-info` endpoint
- **Solution**: Verify GCP credentials and project settings

### **2. Airtable Connection Issues**
- **Symptom**: API calls fail with 401/403
- **Check**: API key validity and base permissions
- **Solution**: Verify environment variables and base access

### **3. Multi-tenant Issues**
- **Symptom**: Wrong client data accessed
- **Check**: `debug-clients` endpoint
- **Solution**: Verify `MASTER_CLIENTS_BASE_ID` configuration

### **4. Webhook Processing Issues**
- **Symptom**: LinkedHelper data not updating
- **Check**: Webhook logs and payload structure
- **Solution**: Verify field mapping in `webhookHandlers.js`

---

## 📈 Monitoring & Logging

### **Log Levels**
- **Console.log**: Normal operations
- **Console.warn**: Non-critical issues
- **Console.error**: Critical errors
- **alertAdmin()**: Critical failures requiring attention

### **Key Metrics to Monitor**
- Batch scoring success rates
- API response times
- Webhook processing counts
- Error frequencies by endpoint

---

## 🔮 Future Enhancements

### **Performance Optimizations**
- Database connection pooling
- Redis caching layer
- Batch API optimizations

### **Feature Additions**
- Real-time scoring updates
- Advanced filtering options
- Analytics dashboard APIs

### **Architecture Improvements**
- Microservices migration
- Event-driven architecture
- Automated testing suite

---

*This documentation provides comprehensive coverage of the backend architecture, key components, and operational considerations for the PB-Webhook-Server system.*
