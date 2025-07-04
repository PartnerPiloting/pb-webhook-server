# PB-Webhook-Server Technical Documentation

## Project Overview

### Purpose
The PB-Webhook-Server system is designed to improve the efficiency and effectiveness of building a trust-based network on LinkedIn through automated lead scoring and post analysis. The system optimizes the limited LinkedIn connection requests (100-200 per week) by ensuring outreach targets are highly relevant prospects.

### Core Architecture
The system operates as a Node.js application deployed on Render, integrating with:
- **Airtable** (data storage and management)
- **LinkedHelper** (LinkedIn automation)
- **PhantomBuster** (post extraction)
- **Google Gemini AI** (scoring and analysis)
- **Google Sheets** (data orchestration)

---

## Data Flow & Process Pipeline

### Phase 1: Lead Discovery & Enrichment

#### 1.1 Boolean Search Creation
- **LinkedIn**: Maximum 5 boolean operators (AND, OR, NOT)
- **Sales Navigator**: Unlimited boolean operators with advanced filtering
- **Key Filter**: "Posted in last 30 days" (ensures active users)
- **Capacity**: Sales Navigator allows up to 2,500 connections vs LinkedIn's 1,000

#### 1.2 Profile Extraction via LinkedHelper
**Campaign**: "Visit 2nd level Contacts then channel them into AT Leads for Scoring"
- **Webhook Endpoint**: `https://pb-webhook-server.onrender.com/lh-webhook/upsertLeadOnly`
- **Schedule**: 12:00 AM - 3:00 AM daily
- **Volume**: 40 profiles per day
- **Process**: Visit and extract profile data, upsert to Airtable Leads table
- **Secondary Benefit**: Profile visits often generate incoming connection requests

#### 1.3 Post Extraction via PhantomBuster
**Phantom**: LinkedIn Activity Extractor
- **Schedule**: 3:30 AM daily (immediately after LH to minimize LinkedIn visit count)
- **Source Sheet**: [LinkedIn Activity Extractor Google Sheet](https://docs.google.com/spreadsheets/d/1LwX8mzL4VsOYetlGtiVUZFyvUTqh2zdDseQoDKxLuns/edit?gid=0#gid=0)
- **Volume**: 2 posts per profile (40 profiles = 80 posts)
- **Webhook Endpoint**: `https://pb-webhook-server.onrender.com/api/pb-webhook?secret=Diamond9753!!@@pb`
- **Data Storage**: Posts stored in Leads table "Posts Content" field as JSON

**Google Apps Script Integration**:
The Google Sheet contains a script that automatically syncs Airtable "Created Today" leads to provide PhantomBuster with fresh profile URLs for post extraction.

**Key Script Configuration**:
```javascript
var AIRTABLE_BASE_ID = 'appXySOLo6V9PfMfa';
var AIRTABLE_TABLE_NAME = 'Leads';
var AIRTABLE_VIEW_NAME = 'Created Today';
var GOOGLE_SHEET_ID = '1LwX8mzL4VsOYetlGtiVUZFyvUTqh2zdDseQoDKxLuns';
```

---

## Phase 2: AI-Powered Scoring Systems

### 2.1 Lead Scoring System

#### Technical Implementation
- **Render Service**: "Daily Batch Lead Scoring"
- **Endpoint**: `https://pb-webhook-server.onrender.com/run-batch-score`
- **Schedule**: `0 2 * * *` (2:00 AM UTC / 12:00 PM AEST daily)
- **AI Backend**: Google Gemini 2.5

#### Scoring Process
1. **Lead Selection**: Filters leads with "Scoring Status" = "To Be Scored"
2. **Data Extraction**: Analyzes headline, About section, and employment history
3. **Attribute Loading**: Dynamically loads scoring criteria from "Scoring Attributes" table
4. **Batch Processing**: Processes ~10 leads per batch for efficiency
5. **Score Calculation**: 
   - Calculates positive/negative points per attribute
   - Generates percentage score stored in "AI Score" field
   - Provides detailed breakdown and reasoning

#### Key Files & Components
- `batchScorer.js` - Main batch processing logic
- `singleScorer.js` - Individual lead scoring
- `scoring.js` - Score calculation mathematics
- `promptBuilder.js` - AI prompt generation
- `attributeLoader.js` - Dynamic attribute loading
- `breakdown.js` - Score explanation generation

### 2.2 Post Scoring System

#### Technical Implementation
- **Render Service**: "Daily Batch Lead Scoring" (same service, different process)
- **Multi-Tenant Endpoint**: `https://pb-webhook-server.onrender.com/run-post-batch-score`
- **Legacy Endpoint**: `https://pb-webhook-server.onrender.com/api/internal/trigger-post-scoring-batch` (single-tenant)
- **Schedule**: `30 2 * * *` (2:30 AM UTC / 12:30 PM AEST daily)
- **AI Backend**: Google Gemini

#### Multi-Tenant Post Scoring Process
1. **Client Discovery**: Loads active clients from "Clients" base
2. **Sequential Processing**: Processes each client's base individually
3. **Post Pre-filtering**: Only posts containing AI-related keywords sent for scoring
4. **Attribute Loading**: Loads criteria from each client's "Post Scoring Attributes" table
5. **AI Analysis**: Scores posts for relevance and engagement potential
6. **Result Storage**: Updates "Top Scoring Post" and relevance score in each client's Leads table
7. **Execution Logging**: Records detailed results per client with error isolation

#### API Endpoints
- `POST /run-post-batch-score` - Process all active clients
- `POST /run-post-batch-score?clientId=guy-wilson` - Process specific client
- `POST /run-post-batch-score?clientId=guy-wilson&limit=50` - Process specific client with limit

#### Key Files & Components
- `postAnalysisService.js` - Main post scoring logic
- `postScoreBatchApi.js` - Batch processing API
- `postGeminiScorer.js` - AI scoring integration
- `postPromptBuilder.js` - Post-specific prompts
- `postAttributeLoader.js` - Post scoring attributes

---

## Data Management & Storage

### Airtable Architecture

#### Master Control Base: "Clients"
- **Clients Table**: Central registry for all client configurations
- **Purpose**: Multi-tenant control panel and execution monitoring

#### Client Data Bases: "My Leads - [Client Name]" Pattern
- **Guy Wilson**: "My Leads - Guy Wilson" (Base ID: appXySOLo6V9PfMfa)
- **Future Clients**: "My Leads - John Smith", "My Leads - Sarah Johnson", etc.

#### Standard Tables per Client Base
- **Leads**: Central repository for all prospect data
- **Scoring Attributes**: Dynamic lead scoring criteria  
- **Post Scoring Attributes**: Dynamic post scoring criteria

#### Key Fields in Leads Table
- `LinkedIn Profile URL` - Primary identifier
- `Profile Full JSON` - Complete profile data
- `Posts Content` - JSON array of LinkedIn posts
- `AI Score` - Calculated lead score (percentage)
- `Scoring Status` - Processing status tracking
- `Post Relevance Score` - Top post score
- `Top Scoring Post` - Best post content and analysis

### Data Quality & Error Handling
- **JSON Parsing**: Uses `dirty-json` library to handle malformed JSON from PhantomBuster
- **Error Recovery**: Continues processing when individual records fail
- **Logging**: Comprehensive logging for debugging and monitoring
- **Posts JSON Status Tracking**: Simple `Posts JSON Status` field tracks whether parsing succeeded (Parsed/Failed)

#### Known JSON Issues
**Root Cause**: PhantomBuster's LinkedIn Activity Extractor fails to properly escape quotes in post content, leading to malformed JSON.

**Common Problems**:
- Unescaped quotes in post content: `"Agent memory"? "Tools"?`
- Unicode characters: Arrow symbols (→), emojis, special characters
- Control characters and null bytes from data transmission
- Truncated JSON due to character limits or processing errors

**Current Solutions**:
1. **Multi-Step JSON Repair**: Progressive parsing with `JSON.parse()` → preprocessing → quote repair → `dirty-json`
2. **Simple Status Tracking**: Mark records as Parsed or Failed for monitoring
3. **High Success Rate**: Testing shows 95-98% success rate on PhantomBuster data
4. **Error Logging**: Detailed diagnostics for failed parsing attempts  
5. **Graceful Degradation**: Mark unparseable records as processed to prevent infinite retry loops

**Diagnostic Tools**:
- `GET /api/json-quality-analysis` - Analyze parsing issues across all clients
- `jsonDiagnosticTool.js` - Command-line tool for detailed JSON quality analysis
- Enhanced logging with JSON snippets and character analysis

---

## Webhook Endpoints & APIs

### Core Webhooks
1. **LinkedHelper Profile Upsert**
   - `POST /lh-webhook/upsertLeadOnly`
   - Purpose: Receive enriched profile data from LinkedHelper
   - No authentication parameters

2. **PhantomBuster Post Update**
   - `POST /api/pb-webhook?secret=Diamond9753!!@@pb`
   - Purpose: Receive extracted posts and update lead records
   - Authentication: Secret parameter required

### Internal APIs
1. **Batch Lead Scoring**
   - `POST /run-batch-score`
   - Purpose: Trigger daily lead scoring process
   - Called by Render cron job

2. **Multi-Tenant Post Scoring Batch**
   - `POST /run-post-batch-score`
   - Purpose: Trigger daily post scoring process (multi-tenant)
   - Supports clientId and limit parameters

3. **Legacy Post Scoring Batch**
   - `POST /api/internal/trigger-post-scoring-batch`
   - Purpose: Trigger daily post scoring process (single-tenant legacy)
   - View: "Leads with Posts not yet scored"

4. **JSON Quality Diagnostic**
   - `GET /api/json-quality-analysis`
   - Purpose: Analyze JSON parsing issues and data quality
   - Parameters: clientId, limit, mode (analyze/repair)

---

## Multi-Tenant Architecture

### Current Implementation
**Master Control Base**: "Clients"
- **Clients Table**: Central registry of all clients and their configurations
- **Purpose**: Control panel for multi-tenant operations

**Client Data Bases**: Named pattern "My Leads - [Client Name]"
- **Current**: "My Leads - Guy Wilson" (owner as first client)
- **Future**: "My Leads - John Smith", "My Leads - Sarah Johnson", etc.
- **Structure**: Each client gets identical table structure (Leads, Scoring Attributes, Post Scoring Attributes)

### Clients Table Schema
| Field | Type | Purpose |
|-------|------|---------|
| Client ID | Text | Unique identifier (e.g., "guy-wilson") |
| Client Name | Text | Display name (e.g., "Guy Wilson") |
| Status | Select | Active/Paused |
| Airtable Base ID | Text | Target base ID for this client |
| Execution Log | Long Text | Historical execution logs with errors, stats, performance |

### Multi-Tenant Processing Flow
1. **Client Discovery**: Read active clients from "Clients" base
2. **Sequential Processing**: Process each client's base individually
3. **Dynamic Connection**: Switch Airtable base connection per client
4. **Execution Logging**: Update client's execution log with detailed results
5. **Error Isolation**: Individual client failures don't affect others

### Implementation Details
**API Endpoints**:
- `POST /api/trigger-lead-scoring-batch?clientId=guy-wilson&limit=100`
- `POST /api/trigger-post-scoring-batch?clientId=guy-wilson`

**Execution Log Format** (supports multiple entries):
```
=== EXECUTION: 2025-06-26 16:00:15 UTC ===
STATUS: Completed with errors
LEADS PROCESSED: 8/10 successful
POST SCORING: 6/8 successful
DURATION: 2m 34s
TOKENS USED: 15,420
ERRORS: Lead ID L001: JSON parsing failed...

=== EXECUTION: 2025-06-25 16:00:10 UTC ===
STATUS: Completed successfully
LEADS PROCESSED: 12/12 successful
...
```

---

## AI Integration & Rate Limits

### Current AI Setup
- **Provider**: Google Gemini (Pay-as-you-go plan)
- **Rate Limits**: 1,000 requests/minute, token-based throttling
- **Model**: Gemini 2.5 Pro for lead scoring
- **Optimization**: Batch processing to maximize token efficiency

### Scaling Considerations
- **Token Usage**: High tokens per request due to rich profile data
- **Bottleneck**: Token-per-minute limits rather than request limits
- **Solutions**: Quota increases, multi-region deployment, multiple projects

---

## Automation & Scheduling

### Render Cron Jobs
1. **Daily Lead Scoring**: `0 2 * * *` (2:00 AM UTC / 12:00 PM AEST)
2. **Daily Post Scoring**: `30 2 * * *` (2:30 AM UTC / 12:30 PM AEST)

### External Automation
1. **LinkedHelper**: Runs 12:00 AM - 3:00 AM daily
2. **PhantomBuster**: 3:30 AM daily (coordinated timing)
3. **Google Apps Script**: Syncs Airtable to Google Sheets for PB

### Optimized Daily Flow (AEST)
1. **12:00 AM - 3:00 AM**: LinkedHelper extracts and upserts lead profiles
2. **3:30 AM**: PhantomBuster extracts posts from newly added leads  
3. **12:00 PM**: Lead scoring processes all leads with complete profile data
4. **12:30 PM**: Post scoring analyzes posts for leads with extracted content
5. **Afternoon**: Results available for review and LinkedIn outreach planning

This timing ensures all data collection completes overnight, with scoring happening during business hours for monitoring and immediate action.

---

## Output & Usage

### Lead Scoring Output
- **Top Scorers**: Leads above configurable percentage threshold
- **Action**: LinkedIn profile URLs copied to LinkedHelper for connection campaigns
- **Follow-up**: Automated message sequences with manual override

### Post Scoring Output
- **Best Posts**: Highest scoring posts identified per lead
- **Action**: Manual outreach via LinkedIn mentioning relevant posts
- **Tool Integration**: AI Blaze Chrome extension for message construction

### AI Blaze Prompt Example
```
"You are an agent that looks at the field "Top Scoring Post" and also the field "AI Profile Assessment" to construct an inmail message via Sales Navigator. My objective is to have them respond or connect with me as a result of this message. Start with Hi [firstname], I loved your recent post. Pick out some positives from their post and construct a message which is about 300 characters in length. If appropriate, indicate that there could be scope of collaboration with some of my contacts. I am helping mid-life corporate captives develop Ai powered side ventures while at the same time increasing their AI skills so that they can perform better in their current roles.
Show me (once only) the content of the post from the Top Scoring Post field 
Don't mention "like yourself"
Add lines between paragraphs
Don't leave a signature"
```

---

## LinkedIn Follow-Up System Integration

### Overview
The LinkedIn Follow-Up System is a web-based extension to the PB-Webhook-Server that provides a modern interface for lead management, replacing the need for direct Airtable access. **Status: LIVE AND OPERATIONAL** (January 2025).

### Live Access
- **Portal**: https://pb-webhook-server.onrender.com/portal
- **API**: https://pb-webhook-server.onrender.com/api/linkedin/*

### Key Features
- **✅ Lead Search**: Real-time search across client Airtable bases
- **✅ API Integration**: Complete REST API for lead management
- **✅ Multi-tenant Support**: Leverages existing client infrastructure
- **✅ Responsive UI**: Modern, mobile-friendly interface

### Technical Implementation
- **Backend**: Express.js routes mounted at `/api/linkedin`
- **Frontend**: Single-page portal served via `/portal` route
- **Database**: Reuses existing Airtable multi-tenant architecture
- **Authentication**: Ready for WordPress integration (currently testing mode)

### Architecture Benefits
- **Code Reuse**: 80% leverages existing pb-webhook-server infrastructure
- **Zero Downtime**: Integrated deployment with main system
- **Scalability**: Built on proven multi-tenant foundation
- **Maintainability**: Single codebase for all lead management functions

### Development Status
- ✅ Web portal and API fully functional
- ✅ Multi-client support implemented  
- ✅ Error handling and logging complete
- ✅ Documentation updated (January 2025)
- 🚧 Chrome extension development (next phase)

See `/LinkedIn-Messaging-FollowUp/README.md` for detailed documentation.

---

## Technical Stack Summary

- **Runtime**: Node.js on Render
- **Database**: Airtable (multiple bases)
- **AI Provider**: Google Gemini via Vertex AI
- **Automation**: LinkedHelper, PhantomBuster
- **Orchestration**: Google Apps Script
- **Scheduling**: Render Cron Jobs
- **Error Handling**: dirty-json, comprehensive logging
- **Output Tools**: AI Blaze, Airtable interfaces

This documentation provides the context needed for future development, troubleshooting, and expansion of the PB-Webhook-Server system.
