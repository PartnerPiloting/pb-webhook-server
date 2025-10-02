# PB Webhook Server

Multi-tenant LinkedIn lead management system with AI-powered scoring.

## Architecture Overview

- **Backend**: Node.js/Express API deployed on Render
- **Frontend**: Next.js React app deployed on Vercel
- **Data**: Multi-tenant Airtable architecture with Master Clients base + individual client bases
- **AI**: Google Gemini (primary) + OpenAI (backup) for lead scoring

## Documentation

See the `/docs` folder for detailed documentation:

- [System Overview](./SYSTEM-OVERVIEW.md)
- [Backend Deep Dive](./BACKEND-DEEP-DIVE.md)
- [On-The-Fly Metrics Calculation](./docs/ON-THE-FLY-METRICS-CALCULATION.md) - NEW: Single source of truth for job metrics
- [Apify Integration Guide](./APIFY-INTEGRATION-GUIDE.md)
- [Multi-tenant Guide](./APIFY-MULTITENANT-GUIDE.md)

## Development Workflow

### Local Development Commands
```bash
# Start development (use VS Code tasks)
npm run dev:api        # Backend on port 3001
npm run dev:front      # Frontend on port 3000
npm run dev:simple     # Both concurrently

# Debug/restart
npm run dev:reset      # Kill stray node processes
npm run ports:free 3000 3001  # Force-kill ports
```