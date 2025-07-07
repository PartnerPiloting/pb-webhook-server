# Project Requirements & Specifications

## Functional Requirements

### Chrome Extension Requirements

#### Core Features
- **Message Capture**: Extract current message content and thread history
- **Profile Data Extraction**: Name, title, company, LinkedIn URL, profile image
- **Lead Deduplication**: Search existing Airtable records by LinkedIn profile URL
- **Quick Actions**: Add to Airtable, set follow-up date, view existing record
- **Minimal UI**: Non-intrusive button placement in LinkedIn interface

#### Technical Requirements
- Compatible with LinkedIn.com and Sales Navigator
- Manifest V3 compliance
- Minimal permissions (activeTab, storage)
- Real-time API communication
- Error handling and offline capability

### Web Portal Requirements

#### Dashboard Features
- **Follow-up Queue**: Leads due for contact today/this week
- **High-Scoring Posts**: Integration with existing AI scoring system
- **Lead Management**: Search, filter, and bulk operations
- **Analytics**: Conversion rates, response rates, pipeline metrics

#### Advanced Features
- **Template Management**: Message templates and follow-up sequences
- **Campaign Tracking**: Group leads by campaign/source
- **Team Collaboration**: Notes, task assignment, activity history
- **Reporting**: Export capabilities, performance dashboards

#### Premium Features (Future)
- **Mass Messaging**: Bulk LinkedIn outreach (compliance required)
- **A/B Testing**: Message template performance testing
- **Advanced Analytics**: Predictive scoring, optimal timing
- **Integrations**: CRM sync, email automation, calendar booking

### API Requirements

#### Extension Endpoints
- `POST /api/leads/check` - Check if lead exists by LinkedIn URL
- `POST /api/leads/create` - Create new lead record
- `PUT /api/leads/:id/message` - Add message to existing lead
- `PUT /api/leads/:id/follow-up` - Set follow-up date and notes

#### Portal Endpoints
- `GET /api/leads/due` - Get leads due for follow-up
- `GET /api/leads/search` - Search and filter leads
- `POST /api/leads/batch` - Bulk operations on multiple leads
- `GET /api/analytics/dashboard` - Dashboard metrics and stats

## Non-Functional Requirements

### Performance
- Chrome extension response time < 500ms
- Web portal page load time < 2 seconds
- API response time < 200ms for most operations
- Support for 1000+ concurrent users

### Scalability
- Leverage existing multi-tenant architecture
- Support 100+ client organizations
- Handle 10,000+ leads per client
- Efficient database queries and caching

### Security
- Multi-tenant data isolation
- Secure API authentication (JWT tokens)
- LinkedIn TOS compliance
- GDPR/privacy compliance
- Audit logging for all actions

### Usability
- Intuitive Chrome extension interface
- Responsive web portal design
- Mobile-friendly portal access
- Comprehensive help documentation

## Data Schema Requirements

### Extend Existing "Leads" Table (Minimal Changes)
The pb-webhook-server already has a comprehensive "Leads" table structure. We only need to add LinkedIn messaging-specific fields:

#### Field Specifications
> ⚠️ **Field Specifications**: For current field names, types, and detailed specifications, see [airtable-field-master-list.md](./airtable-field-master-list.md)

The LinkedIn extension adds messaging-specific fields to the existing "Leads" table while leveraging the comprehensive lead profile fields already implemented in pb-webhook-server.

### Multi-Tenant Data Structure (Already Implemented)
**Master Control**: "Clients" base manages all client configurations
**Client Bases**: "My Leads - [Client Name]" pattern with dedicated Airtable bases
**Current Example**: "My Leads - Guy Wilson" (appXySOLo6V9PfMfa)

### Integration with Existing AI Systems
- **Lead Scoring**: Google Gemini 2.5 already scoring leads for relevance
- **Post Analysis**: AI evaluation of LinkedIn posts for engagement potential  
- **Batch Processing**: Overnight scoring pipeline already operational
- **Multi-Tenant**: AI scoring runs across all active client bases

## Success Metrics

### User Adoption
- Chrome extension installation rate
- Daily active users
- Messages captured per user per day
- Follow-up completion rate

### Business Impact
- Lead response rate improvement
- Conversion rate from lead to client
- Time savings in lead management
- User satisfaction scores

### Technical Performance
- System uptime (99.9% target)
- API response times
- Error rates (<1% target)
- Data sync accuracy (99.99% target)
