# System Architecture Document

## Overview
The LinkedIn Messaging Follow-Up system extends the existing pb-webhook-server infrastructure to provide seamless LinkedIn lead management capabilities.

## System Components

### 1. Chrome Extension
**Purpose**: In-LinkedIn message capture and lead management
**Integration Points**: LinkedIn.com, Sales Navigator
**Key Features**:
- Add to Airtable button in LinkedIn UI
- Message scraping and profile data extraction
- Lead deduplication logic
- Real-time sync with Airtable backend

### 2. Web Portal
**Purpose**: Advanced management interface
**Features**:
- Leads due for follow-up dashboard
- High-scoring posts management
- Batch follow-up operations
- Analytics and reporting
- Premium feature access
- Template management

### 3. API Layer Extensions
**Purpose**: Extend existing pb-webhook-server APIs
**Base Infrastructure**: Express.js app with existing routes and services

**Existing Endpoints to Leverage**:
- `/run-batch-score` - Lead scoring integration
- `/run-post-batch-score` - Post scoring integration
- Multi-tenant client management via `clientService.js`
- Airtable integration via `airtableClient.js` with dynamic base switching

**New LinkedIn-Specific Endpoints**:
- `POST /api/linkedin/leads/check` - Check if lead exists by LinkedIn URL
- `POST /api/linkedin/leads/create` - Create new lead record
- `PUT /api/linkedin/leads/:id/message` - Add message to existing lead
- `PUT /api/linkedin/leads/:id/follow-up` - Set follow-up date and notes
- `GET /api/linkedin/leads/due` - Get leads due for follow-up
- `GET /api/linkedin/leads/search` - Search and filter leads
- `POST /api/linkedin/leads/batch` - Bulk operations on multiple leads

**Shared Infrastructure to Reuse**:
- `services/clientService.js` - Multi-tenant client management
- `config/airtableClient.js` - Dynamic base switching
- `services/leadService.js` - Lead upsert functionality
- Authentication middleware for WordPress integration
- Error handling and logging patterns

### 4. Data Integration
**Backend**: Existing pb-webhook-server multi-tenant Airtable infrastructure

**Master Control**: "Clients" base (MASTER_CLIENTS_BASE_ID)
- Clients table: Registry of all client configurations
- Execution logging for monitoring and debugging
- Client status management (Active/Inactive)

**Client Data Bases**: "My Leads - [Client Name]" pattern
- Each client has dedicated Airtable base (e.g., "My Leads - Guy Wilson")
- LinkedIn leads stored in existing "Leads" table structure
- Leverages current multi-tenant architecture

**Existing Lead Schema** (established in pb-webhook-server):
- `LinkedIn Profile URL` - Primary identifier for deduplication
- `First Name`, `Last Name` - Contact details
- `Headline`, `Job Title`, `Company Name` - Professional info
- `About`, `Job History` - Profile content for AI scoring
- `LinkedIn Connection Status` - Connection state tracking
- `Date Connected` - Relationship timeline
- `AI Score` - Existing lead scoring via Gemini AI
- `Scoring Status` - Processing status tracking
- `Profile Full JSON` - Complete LinkedIn profile data
- `Posts Content` - JSON array of LinkedIn posts (from PhantomBuster)
- `Post Relevance Score` - AI scoring of posts
- `Top Scoring Post` - Best post analysis

**New Fields for LinkedIn Messaging**:
- `LinkedIn Messages` - JSON array of message history
- `Follow-Up Date` - Next contact scheduling
- `Follow Up Notes` - Context for next interaction
- `Message Source` - LinkedIn vs Sales Navigator tracking
- `Last Message Date` - Timeline tracking

**Integration with Existing AI Systems**:
- Lead scoring system (Google Gemini 2.5) already operational
- Post analysis system for engagement context
- Multi-tenant processing via existing batch scoring services
- Overnight processing pipeline integration

## Data Flow

### Message Capture Workflow
1. User sends/receives LinkedIn message
2. Chrome extension detects message context
3. User clicks "Add to Airtable" button
4. Extension scrapes message and profile data
5. API call to check for existing lead (by LinkedIn URL)
6. If exists: Append message to notes, prompt for follow-up
7. If new: Create lead record, display confirmation
8. Sync with existing AI scoring and processing systems

### Follow-up Management
1. Web portal displays leads due for follow-up
2. Integration with high-scoring posts from existing system
3. Batch operations for multiple leads
4. Automated follow-up suggestions based on AI scoring

## Technical Integration Points

### Shared Infrastructure
- Airtable client configuration
- Multi-tenant architecture
- AI scoring services
- Authentication and authorization
- Environment configuration

### New Components
- Chrome extension manifest and scripts
- LinkedIn DOM interaction utilities
- Message parsing and extraction
- Web portal frontend (React/Vue suggested)
- Extended API routes

## Security Considerations
- Chrome extension permissions (minimal required)
- LinkedIn TOS compliance
- Data privacy and GDPR compliance
- Secure API authentication
- Multi-tenant data isolation
