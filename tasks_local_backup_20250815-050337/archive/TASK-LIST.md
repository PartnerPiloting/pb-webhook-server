# PB-Webhook-Server Task List
## Current Status ✅
- **Multi-tenant post scoring**: Complete and production-ready
- **JSON parsing robustness**: Enhanced with repair utilities
- **Gemini API flexibility**: Handles response format variations        
- **Render cron job**: Updated to use `/run-post-batch-score?limit=100` 
- **Status tracking**: "Posts JSON Status" and "Date Posts Scored" working
- **Testing validated**: 5/5 posts processed, 4/4 scored successfully   
- **✅ LinkedIn Follow-Up System**: **COMPLETE AND DEPLOYED** (January 2025)
	- **Web Portal**: Live at https://pb-webhook-server.onrender.com/portal
	- **API Integration**: Full multi-tenant LinkedIn API operational     
	- **Documentation**: Updated and comprehensive
---
## Critical Issues Requiring Investigation ��
### AI Scoring Failures for Complex Lead Profiles - PRODUCTION ISSUE IDENTIFIED
- [ ] **Issue**: Consistent scoring failures for specific leads (e.g., recHkqPSMfdQWyqus)
	- [ ] **Root Cause Identified**: Complex/large profile data causes Gemini AI to generate malformed JSON responses
	- [ ] **Investigation Status**: Extensive testing completed - confirmed NOT a batch vs individual scoring issue
	- [ ] **Current Impact**: ~10 leads consistently fail scoring attempts, remain in "To Be Scored" status
	- [ ] **Failed Solutions**:
		- ❌ dirty-json library: Cannot repair the specific JSON corruption patterns from AI
		- ❌ Response cleaning improvements: Issue occurs at AI generation level, not parsing
		- ❌ Individual vs batch processing: Fails consistently regardless of processing method
	**Technical Analysis**:
	- [ ] **Profile Data Characteristics**: Very large LinkedIn profiles (20K+ characters JSON)
	- [ ] **AI Behavior**: Gemini appears to hit internal limits and truncates/corrupts JSON mid-generation
	- [ ] **Error Pattern**: Broken JSON structure, not simple formatting issues
	- [ ] **Scope**: Affects ~10% of Guy-Wilson client leads with comprehensive LinkedIn data
	**�� CRITICAL DISCOVERY - August 4, 2025**:
	- [ ] **Production vs Local Discrepancy**: EXACT same code works locally but fails in production
		- ✅ **Local Environment**: Same lead (recHkqPSMfdQWyqus) scores successfully with 4096 tokens
		- ❌ **Production Environment**: Same lead fails with "JSON Parse Error at position 2486"
		- ⏱️ **Performance Gap**: Local ~10-12 seconds, Production 28+ seconds (timeout issues)
		- �� **Confirmed**: Issue is NOT token limits, but production environment constraints
	**Environment-Specific Issues Identified**:
	- [ ] **Render Resource Constraints**: Memory/CPU limits causing response truncation
	- [ ] **Network Timeouts**: Production API calls timing out mid-response
	- [ ] **Resource Pressure**: Gemini API responses incomplete due to server load
	- [ ] **Environment Variables**: Potential differences between local and production configs
	**Potential Solutions to Research**:
	- [ ] **Option 1**: Increase Gemini maxOutputTokens beyond current 4096 limit (may help with resource pressure)
	- [ ] **Option 2**: Upgrade Render service plan for more resources    
	- [ ] **Option 3**: Implement timeout/retry mechanisms for partial responses
	- [ ] **Option 4**: Optimize memory usage during AI calls
	- [ ] **Option 5**: Profile data preprocessing to reduce complexity   
	**Next Steps**:
	- [ ] **Priority 1**: Test increased token limits in production environment
	- [ ] **Priority 2**: Analyze Render resource usage during API calls  
	- [ ] **Priority 3**: Compare production vs local environment configurations
	- [ ] **Priority 4**: Implement production monitoring for timeout detection
	**Evidence**:
	- Production Error: `"error": "singleScorer: JSON Parse Error: Expected double-quoted property name in JSON at position 2486"`
	- Local Success: Same lead produces valid 1255-character JSON response
	- Performance: Local 10s vs Production 28s response times
	**Priority**: CRITICAL - Production environment issue affecting client data quality
---
## High Priority Tasks ��
### �� Airtable Logging System Implementation - MAJOR INITIATIVE
- [ ] **Strategic Initiative**: Replace Render-only console logging with hybrid Airtable + Render logging
	- [ ] **Goal**: Enable better analysis, client transparency, and proactive monitoring
	- [ ] **Documentation**: See `AIRTABLE-LOGGING-IMPLEMENTATION-PLAN.md` for comprehensive details
	- [ ] **Multi-tenant**: Full support for client-specific logging and filtering
	- [ ] **Performance**: Async logging to prevent application slowdown

#### Phase 1: Foundation (Week 1)
- [ ] **Create Airtable Logging Service** (`services/airtableLoggingService.js`)
	- [ ] Design service to handle async Airtable log writes with batch processing
	- [ ] Implement retry logic and graceful degradation (fallback to console-only)
	- [ ] Add environment configuration (base ID, table name, API key)
	- [ ] Create circuit breaker pattern for Airtable API failures
- [ ] **Extend StructuredLogger** (`utils/structuredLogger.js`)
	- [ ] Add Airtable logging capability while maintaining console logging
	- [ ] Implement configurable log levels (what gets logged to Airtable)
	- [ ] Add performance timing capture for detailed analysis
	- [ ] Test with simple operations first
- [ ] **Environment Configuration**
	- [ ] Add Airtable logging environment variables to `.env`
	- [ ] Create Airtable "System Logs" table with defined schema
	- [ ] Configure log levels and batch sizes for optimal performance

#### Phase 2: Core Applications (Week 2)  
- [ ] **Lead Scoring Applications**
	- [ ] Add Airtable logging to `batchScorer.js` - batch operations, timing, success/error counts
	- [ ] Add Airtable logging to `singleScorer.js` - individual operations, error details
	- [ ] Track multi-tenant client operations separately
	- [ ] Include cost governance data and token usage
- [ ] **Post Scoring Applications**
	- [ ] Add Airtable logging to `postBatchScorer.js` - batch post processing
	- [ ] Add Airtable logging to `postGeminiScorer.js` - individual post scoring
	- [ ] Track processing volumes and success rates
- [ ] **Multi-tenant Testing**
	- [ ] Validate client isolation in logging data
	- [ ] Test performance impact across all clients
	- [ ] Verify session tracking across operations

#### Phase 3: Integration & System Operations (Week 3)
- [ ] **LinkedIn Webhook Logging**
	- [ ] Add logging to `/lh-webhook/upsertLeadOnly` in `routes/webhookHandlers.js`
	- [ ] Track webhook volumes, processing times, and error patterns
	- [ ] Log lead creation vs update operations
- [ ] **API Endpoint Logging**
	- [ ] Add logging to critical API endpoints in `routes/apiAndJobRoutes.js`
	- [ ] Track manual operations and admin actions
	- [ ] Monitor API performance and usage patterns
- [ ] **System-level Operations**
	- [ ] Log server startup, configuration loading, and health checks
	- [ ] Track environment issues and service connectivity
	- [ ] Monitor resource usage and performance metrics

#### Phase 4: Analysis & Optimization (Week 4)
- [ ] **Performance Monitoring**
	- [ ] Measure logging overhead and optimize batch sizes
	- [ ] Monitor Airtable API rate limits and usage
	- [ ] Implement intelligent batching based on operation volume
- [ ] **Log Analysis Tools**
	- [ ] Create scripts to analyze Airtable log data for patterns
	- [ ] Build error aggregation and trending analysis
	- [ ] Develop client-specific reporting capabilities  
- [ ] **Documentation & Training**
	- [ ] Update development documentation with logging best practices
	- [ ] Create guide for using Airtable logs for troubleshooting
	- [ ] Document log analysis and client reporting procedures

#### Success Metrics
- [ ] **Reliability**: 99.9% logging success rate with graceful degradation
- [ ] **Performance**: < 50ms overhead per operation for Airtable logging
- [ ] **Coverage**: All major operations (scoring, webhooks, APIs) logging consistently
- [ ] **Analysis**: Faster issue resolution and proactive error detection
- [ ] **Client Value**: Transparent operation reporting and performance insights

### Post Scoring Content Display Fix
- [ ] **Fix "Top Scoring Post" empty content issue**
	- [ ] Problem: Occasional empty Content and URL in "Top Scoring Post" field despite valid post data
	- [ ] Root cause: URL matching failure between AI response and original post data during merge
	- [ ] **Solution Option 1 (Low Risk)**: Implement normalized URL comparison
		- Add `normalizeUrl()` function to handle protocol/www/trailing slash differences
		- Update URL matching logic in `postBatchScorer.js` lines 425-435   
		- Minimal code change, preserves existing flow
	- [ ] **Solution Option 2 (Safety Net)**: Fallback lookup from Posts Content field
		- Only triggers when current method fails (missing content)
		- Re-reads "Posts Content" field and finds post by normalized URL   
		- Keeps existing logic intact while fixing edge cases
	- [ ] **Testing Strategy**: Test with one client first, monitor logs, compare success rates
	- [ ] **Priority**: Medium-High (affects user experience but system mostly works)
### Bonus Points System Implementation
- [ ] **Phase 1: Frontend UX for Bonus Points**
	- [ ] Add "Bonus Points" Yes/No checkbox to attribute editing interface
	- [ ] Update attribute library view to show bonus point indicators    
	- [ ] Implement UI validation and user experience flow
	- [ ] **Backend Decision**: Bonus points get 25% added to denominator 
	- [ ] **Implementation Strategy**: Don't touch backend scoring initially - focus on UX first
	- [ ] Test frontend changes before any backend modifications
### LinkedIn Follow-Up System - Next Phase
- [ ] **Chrome Extension Development**
	- [ ] Build Chrome extension for in-LinkedIn lead actions
	- [ ] Implement WordPress authentication integration
	- [ ] Add LinkedIn message logging capabilities
	- [ ] Create in-page lead status updates
- [ ] **Advanced Portal Features**
	- [ ] Add lead editing capabilities
	- [ ] Implement bulk operations interface
	- [ ] Create advanced filtering and sorting
	- [ ] Add client switching for multi-tenant users
### Database Cleanup & Multi-Client Prep
- [ ] **Clean up unused Airtable fields** in Guy Wilson base before duplicating
	- Review active fields list from codebase analysis
	- Remove unused fields to create clean template
	- Test that cleanup doesn't break existing functionality
- [ ] **Set up development/testing workflow**
	- Create staging Airtable base for testing changes
	- Set up environment variables for prod vs test
	- Document safe development process
### Load More Pagination System ��
- [ ] **Complete Load More Implementation**
	- [x] Backend pagination logic with 50-record limits (✅ implemented) 
	- [x] Cursor-based pagination with record ID offsets (✅ implemented) 
	- [ ] Frontend Load More button UI components
	- [ ] Test pagination across all lead search/filter scenarios
	- [ ] Verify infinite scroll behavior and performance
	- [ ] Documentation update for Load More UX patterns
- [ ] **Referenced in**: `PAGINATION-IMPLEMENTATION-PLAN.md` - comprehensive implementation guide
- [ ] **Current Status**: Backend ready, frontend Load More buttons may need completion
### Custom Monitoring & Alerting System ��
- [ ] **Phase 1: Basic Monitoring Infrastructure**
	- [ ] Implement Render Logs API integration for automated log monitoring
	- [ ] Create `/api/monitor/all-clients` endpoint for client health tracking
	- [ ] Build `/api/monitor/client/:id` endpoint for individual client status
	- [ ] Set up background monitoring processes with configurable intervals
- [ ] **Phase 2: Email Alert System**
	- [ ] Implement nodemailer-based email alerting for critical issues   
	- [ ] Create configurable alert rules per client (error thresholds, timeout detection)
	- [ ] Build client-specific notification preferences and contact lists
	- [ ] Add alert escalation and frequency management
- [ ] **Phase 3: Real-time Dashboard**
	- [ ] Create `/monitor` route with Chart.js visualizations for client health
	- [ ] Implement real-time client status indicators and error tracking 
	- [ ] Build historical performance graphs and trend analysis
	- [ ] Add client comparison views and system-wide health overview     
- [ ] **Phase 4: Advanced Alerting**
	- [ ] Implement Slack webhook integration for team notifications      
	- [ ] Add SMS alerting via Twilio for critical system failures        
	- [ ] Create intelligent alert grouping and noise reduction
	- [ ] Build alert acknowledgment and resolution tracking
- [ ] **Estimated Implementation Time**:
	- Phase 1-2: 30-60 minutes (basic monitoring + email alerts)
	- Phase 3-4: 2-3 hours (dashboard + advanced features)
- [ ] **Benefits**: Zero ongoing costs, multi-tenant specific features, full customization vs BetterStack subscription
### Multi-Client Expansion
- [ ] **Create client template base** from cleaned Guy Wilson base      
- [ ] **Add new client** (when ready):
	- Add record to "Clients" master base
	- Duplicate template base with client-specific name
	- Configure AI keywords and scoring attributes
	- Test processing with new client
---
## Medium Priority Tasks ��
### System Improvements
- [ ] **Monitor JSON parsing success rates** over time
- [ ] **Add more robust error alerting** for failed processing
- [ ] **Implement client-specific AI keywords** if needed
- [ ] **Add batch processing metrics** and reporting
### Legacy Code Cleanup (After Testing Period)
- [ ] **Delete legacy single-tenant code** (WAIT 1-2 weeks after multi-tenant validation)
	- [ ] Remove `services/leadService.js` (old single-tenant lead service)
	- [ ] Remove old `/api/pb-webhook` route from `apiAndJobRoutes.js`    
	- [ ] Clean up unused imports in `routes/webhookHandlers.js` (line 11-12)
	- [ ] Update documentation to remove references to old system
	- [ ] **VALIDATION REQUIRED**: Confirm new multi-tenant webhook working perfectly
	- [ ] **TESTING REQUIRED**: Multiple clients tested successfully with new webhook
	- [ ] **BACKUP**: Ensure git history preserves old system for reference
### Lead Scoring System
- [ ] **Review lead scoring multi-tenant support** (currently single-tenant)
- [ ] **Update lead scoring to use new client discovery** if needed     
- [ ] **Optimize Gemini token usage** for cost efficiency
### Documentation & Maintenance
- [ ] **Update documentation** with final field list after cleanup      
- [ ] **Create client onboarding guide** for future clients
- [ ] **Set up monitoring dashboard** for system health
---
## Low Priority / Future Enhancements ��
### Feature Additions
- [ ] **Add post scoring thresholds** and filtering
- [ ] **Implement post categorization** beyond just relevance scoring   
- [ ] **Add lead-to-client assignment** logic
- [ ] **Create client-specific reporting** and analytics
### Technical Improvements
- [ ] **Add automated testing** for critical functions
- [ ] **Implement caching** for frequently accessed data
- [ ] **Add rate limiting** and quota management
- [ ] **Create backup/restore** procedures
### Integration Enhancements
- [ ] **LinkedIn Sales Navigator integration** improvements
- [ ] **AI Blaze template optimization**
- [ ] **PhantomBuster error handling** improvements
- [ ] **LinkedHelper webhook reliability** enhancements
---
## Completed Tasks ✅
### Recent Completions (January 2025)
- [x] **LinkedIn Follow-Up System COMPLETE**
	- [x] **Web Portal**: Fully functional lead search and management interface
	- [x] **API Layer**: Complete REST API at `/api/linkedin/*` with multi-tenant support
	- [x] **Backend Integration**: Seamlessly integrated into existing pb-webhook-server
	- [x] **Live Deployment**: Successfully deployed and operational on Render
	- [x] **Documentation**: Comprehensive documentation and quick reference guides
	- [x] **Testing**: End-to-end testing and verification complete       
	- [x] **Error Handling**: Robust error handling and user feedback implemented
	- [x] **Multi-tenant Ready**: Leverages existing client infrastructure
### Previous Completions (July 2025)
- [x] **Multi-tenant architecture** implemented and tested
- [x] **JSON parsing robustness** with repair utilities
- [x] **Gemini API format flexibility** for response variations
- [x] **Posts JSON Status tracking** for monitoring
- [x] **Render cron job update** to new multi-tenant endpoint
- [x] **Error isolation** between clients
- [x] **Execution logging** per client
- [x] **AI keyword pre-filtering** working correctly
- [x] **Test file cleanup** - removed temporary diagnostic files        
### Historical Completions
- [x] **Core lead scoring system** with Gemini AI
- [x] **Post scoring system** with AI analysis
- [x] **LinkedIn/PhantomBuster integration**
- [x] **Airtable data management**
- [x] **Basic multi-tenant structure**
---
## Notes & Considerations ��
### Development Workflow
- Always test changes in staging environment first
- Use feature flags for new functionality
- Validate multi-client compatibility for all changes
- Keep documentation updated with changes
### Field Analysis Results
**Key fields to keep:**
- LinkedIn Profile URL, Profile Full JSON, Posts Content
- AI Score, Scoring Status, Date Scored, Posts JSON Status
- Date Posts Scored, Posts Relevance Score, Top Scoring Post
- All configuration table fields (attributes, instructions, credentials)
### Monitoring Points
- JSON parsing success rates (target: >95%)
- Gemini API response times and costs
- Client processing success rates
- Daily automation execution logs
---
## Quick Reference ��
### Important Endpoints
- **Multi-tenant post scoring**: `POST /run-post-batch-score?limit=100` 
- **Single client test**: `POST /run-post-batch-score?clientId=guy-wilson&limit=5`
- **JSON diagnostics**: `GET /api/json-quality-analysis`
### Key Files for Development
- `postBatchScorer.js` - Multi-tenant post scoring
- `services/clientService.js` - Client management
- `utils/jsonRepair.js` - JSON parsing utilities
- `PB-Webhook-Server-Documentation.md` - System documentation
- `AIRTABLE-LOGGING-IMPLEMENTATION-PLAN.md` - New logging system details
- **LinkedIn-Messaging-FollowUp/** - Complete LinkedIn follow-up system 
	- `backend-extensions/routes/linkedinRoutes.js` - API routes
	- `README.md` - System documentation
	- `QUICK-REFERENCE.md` - Development quick reference
### Next Session Priorities
1. **�� Airtable Logging System** - Begin Phase 1 implementation       
2. **Chrome Extension Development** for LinkedIn Follow-Up System       
3. Database field cleanup
4. Development environment setup
5. First new client onboarding preparation
---
*Last Updated: August 5, 2025*
*Status: Production system stable with LinkedIn Follow-Up System fully operational*
*Major Initiative: Airtable Logging Implementation - Planning Complete*
