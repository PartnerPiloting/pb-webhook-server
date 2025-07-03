# LinkedIn Messaging Follow-Up System

## Project Overview

Extension of the existing pb-webhook-server multi-tenant system to provide LinkedIn lead management capabilities through:
- Chrome extension for in-LinkedIn message capture and lead management
- Custom web portal for advanced features, reporting, and bulk operations
- Integration with existing multi-tenant Airtable infrastructure and AI scoring systems

**Key Integration Benefits**:
- Leverages existing "Leads" table schema (minimal 5 field additions)
- Reuses multi-tenant client management (`clientService.js`)
- Extends current AI scoring capabilities (Google Gemini 2.5)
- Builds on proven Airtable dynamic base switching architecture

## Architecture

### Hybrid Approach
- **Chrome Extension**: In-LinkedIn actions and real-time sync
- **Web Portal**: Advanced features, reporting, and premium capabilities
- **Shared Backend**: Leverages existing pb-webhook-server infrastructure

### Key Components
1. Chrome Extension (LinkedIn/Sales Navigator integration)
2. Web Application/Portal (advanced management interface)
3. API Layer (extends existing pb-webhook-server APIs)
4. Airtable Integration (uses existing multi-tenant setup)

## Authentication Strategy
- **Chrome Extension**: WordPress Application Passwords (long-lived, secure)
- **Web Portal**: WordPress Cookie Authentication + Nonces
- **Authorization**: PMpro subscription validation for all access
- **Multi-tenant**: Client isolation via WordPress user mapping

See [`docs/authentication.md`](docs/authentication.md) for detailed implementation.

## Development Status
- 📋 Documentation phase (current)
  - ✅ Authentication strategy documented
  - ✅ System architecture defined  
  - ✅ Requirements specification complete
  - ✅ **Integration analysis complete** - leverages 80% of existing infrastructure
  - ✅ **Existing schema analyzed** - only 5 new fields needed in "Leads" table
  - ✅ **Interface development methodology established** - systematic approach for Airtable → custom portal translation
  - ✅ **Notes field strategy finalized** - timestamp-based deduplication with simplified text extraction approach
  - ✅ **Deployment strategy documented** - developer distribution approach with Chrome Store transition plan
  - ✅ **Manual note entry via web portal specified** - always appended at top with auto-filled date in consistent format
  - ✅ **Follow-up date reminders implemented** - prompts after note updates in both Chrome extension and web portal
  - ✅ **Field optimization completed** - removed "Message Source" field, implemented Sales Navigator-first policy
  - ✅ **Field visibility strategy implemented** - owner-specific fields hidden from client interfaces
  - ✅ **PhantomBuster messaging deprecation documented** - transition to manual control for cost/complexity reduction
- ✅ **"Lead Search & Update" interface complete** - first web portal interface fully specified
- ⏳ Other interface specifications (Follow Up, New Leads, Workshop Reminder, Lead Scoring, Top Scoring Posts)
- ⏳ Chrome extension development (pending)
- ⏳ Web portal development (pending)
- ⏳ API extensions (pending)

## Related Systems
- Parent project: `../` (pb-webhook-server)
- Leverages: Multi-tenant Airtable, AI scoring, overnight processing
- Authentication: WordPress + PMpro at `australiansidehustles.com.au`
- **Current Data**: "My Leads - Guy Wilson" base (appXySOLo6V9PfMfa) with established schema

## Documentation Files
- [`docs/authentication.md`](docs/authentication.md) - WordPress/PMpro authentication strategy
- [`docs/architecture.md`](docs/architecture.md) - System components and data flow
- [`docs/requirements.md`](docs/requirements.md) - Functional requirements and specifications
- [`docs/integration-analysis.md`](docs/integration-analysis.md) - **Detailed analysis of pb-webhook-server integration**
- [`docs/chrome-extension-spec.md`](docs/chrome-extension-spec.md) - **Chrome extension functional specification and decisions**
- [`docs/web-portal-spec.md`](docs/web-portal-spec.md) - **Web portal interface specifications including "Lead Search & Update"**
- [`docs/interface-development-methodology.md`](docs/interface-development-methodology.md) - **Systematic approach for translating Airtable interfaces to custom web portal screens**
- [`docs/notes-field-specification.md`](docs/notes-field-specification.md) - **Notes field handling and conversation capture strategy based on AI Blaze methodology**
- [`docs/deployment-strategy.md`](docs/deployment-strategy.md) - **Chrome extension deployment approach, risk mitigation, and client communication strategy**
- [`docs/airtable-field-master-list.md`](docs/airtable-field-master-list.md) - **Complete Airtable field specifications, types, and visibility configuration** 