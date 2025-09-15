# Apify Multi-Tenant Integration Guide

## Overview

The Apify LinkedIn posts integration now supports multi-tenant operations, allowing multiple clients to use the same Apify integration while maintaining data isolation. The system maps Apify run IDs to client IDs, enabling webhooks to route data to the correct client's Airtable base.

## Architecture

### Flow
1. **API Trigger** → Client calls `/api/apify/run` with `x-client-id` header
2. **Run Creation** → Apify Actor starts, run record created in Master Clients base
3. **Webhook Callback** → Apify calls `/api/apify-webhook` with run results  
4. **Client Lookup** → Webhook extracts run ID, looks up client ID from run record
5. **Data Sync** → Posts synced to correct client's Airtable base

### Database Structure

**Master Clients Base (appJ9XAZeJeK5x55r)**
- **Clients Table**: Client configurations with `Airtable Base ID` field
- **Apify Runs Table**: Maps run IDs to client IDs

#### Apify Runs Table Schema
| Field | Type | Description |
|-------|------|-------------|
| Run ID | Text | Apify run identifier (primary key) |
| Client ID | Text | Client identifier |
| Status | Select | RUNNING, SUCCEEDED, FAILED |
| Created At | DateTime | When run was initiated |
| Actor ID | Text | Apify Actor used |
| Target URLs | Long Text | LinkedIn URLs being scraped |
| Mode | Select | webhook, inline |
| Dataset ID | Text | Apify dataset ID (populated on success) |
| Completed At | DateTime | When run finished |
| Last Updated | DateTime | Latest status update |
| Error | Long Text | Error message if failed |

## API Endpoints

### Start Apify Run
```http
POST /api/apify/run
Authorization: Bearer <PB_WEBHOOK_SECRET>
x-client-id: <ClientId>
Content-Type: application/json

{
  "targetUrls": ["https://linkedin.com/in/username"],
  "options": {
    "maxPosts": 2,
    "postedLimit": "any"
  },
  "mode": "webhook"
}
```

**Response:**
```json
{
  "ok": true,
  "mode": "webhook",
  "runId": "abc123",
  "status": "RUNNING"
}
```

### Webhook Endpoint
```http
POST /api/apify-webhook
Authorization: Bearer <APIFY_WEBHOOK_TOKEN>
Content-Type: application/json

{
  "resource": {
    "id": "abc123",
    "defaultDatasetId": "xyz789",
    "status": "SUCCEEDED"
  }
}
```

### Monitor Runs
```http
GET /api/apify/runs/:runId
Authorization: Bearer <PB_WEBHOOK_SECRET>
```

```http
GET /api/apify/runs/client/:clientId?limit=10
Authorization: Bearer <PB_WEBHOOK_SECRET>
```

## Environment Variables

### Required
```env
# Master Clients Base
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r

# Apify Configuration  
APIFY_API_TOKEN=apify_api_xxx
APIFY_WEBHOOK_TOKEN=apify_webhook_dev_xxx
APIFY_ACTOR_ID=harvestapi~linkedin-profile-posts

# Authentication
PB_WEBHOOK_SECRET=your_webhook_secret

# Default Limits
APIFY_MAX_POSTS=2
APIFY_POSTED_LIMIT=any
```

## Client Setup

### 1. Add Client to Master Clients Base
Add record to Clients table with:
- **Client ID**: Unique identifier (e.g., "Guy-Wilson")
- **Airtable Base ID**: Client's Airtable base ID
- **Status**: "Active"

### 2. Test Integration
```bash
curl -X POST https://pb-webhook-server-staging.onrender.com/api/apify/run \
  -H "Authorization: Bearer ${PB_WEBHOOK_SECRET}" \
  -H "x-client-id: Guy-Wilson" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUrls": ["https://linkedin.com/in/annabelle-reed"],
    "options": { "maxPosts": 2 }
  }'
```

### 3. Monitor Run
```bash
curl -X GET https://pb-webhook-server-staging.onrender.com/api/apify/runs/client/Guy-Wilson \
  -H "Authorization: Bearer ${PB_WEBHOOK_SECRET}"
```

## Error Handling

### Common Issues

#### 1. Missing Client Mapping
```json
{
  "ok": false,
  "error": "No client mapping found for run: abc123"
}
```
**Solution**: Check if run was properly created with `createApifyRun()`

#### 2. Invalid Client ID
```json
{
  "ok": false, 
  "error": "Missing x-client-id header"
}
```
**Solution**: Include `x-client-id` header in API requests

#### 3. Run Tracking Failure
- Non-fatal: Run continues but won't be tracked
- Check logs for `Failed to track run` warnings
- Manual cleanup may be required

### Recovery

**Check Run Status:**
```bash
curl -X GET /api/apify/runs/{runId} \
  -H "Authorization: Bearer ${PB_WEBHOOK_SECRET}"
```

**Update Run Status:**
```bash
curl -X PUT /api/apify/runs/{runId} \
  -H "Authorization: Bearer ${PB_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"status": "FAILED", "error": "Manual intervention"}'
```

## Development

### Cache Management
```bash
# Clear runs cache (development only)
curl -X POST /api/apify/runs/cache/clear \
  -H "Authorization: Bearer ${PB_WEBHOOK_SECRET}"
```

### Testing Locally
1. Set `NODE_ENV=development`
2. Use localhost webhook URL in Actor configuration
3. Enable debug endpoints for testing

## Migration Notes

### From Single-Tenant
- Old hard-coded `clientId = "Guy-Wilson"` removed
- Now requires `x-client-id` header for all API calls
- Webhook payload must include run ID for client lookup

### Backward Compatibility
- Existing client configurations preserved
- No changes to Airtable base structures
- Posts sync logic unchanged

## Monitoring

### Run Lifecycle
1. **RUNNING**: Run started, tracking record created
2. **SUCCEEDED**: Webhook received, dataset processed
3. **FAILED**: Error occurred, check Error field

### Key Metrics
- Run success/failure rates per client
- Webhook processing times
- Dataset fetch performance
- Posts sync results

### Logs to Monitor
```
[ApifyRuns] Creating run record: {runId} for client: {clientId}
[ApifyWebhook] Processing webhook for run {runId} -> client {clientId}
[ApifyWebhook] Successfully synced {count} posts for client {clientId}
```

## Security

### Authentication
- **API Endpoint**: Bearer token using `PB_WEBHOOK_SECRET`
- **Webhook**: Bearer token using `APIFY_WEBHOOK_TOKEN`
- **Client Isolation**: Airtable base-level separation

### Data Isolation
- Each client has separate Airtable base
- Run records contain client mapping only
- No cross-client data access possible

## Support

### Debug Information
```bash
# Get client runs
GET /api/apify/runs/client/{clientId}

# Get specific run
GET /api/apify/runs/{runId}

# Check webhook config (dev only)
GET /api/_debug/apify-webhook-config
```

### Common Troubleshooting
1. Verify client exists in Master Clients base
2. Check Airtable Base ID is correct
3. Confirm Actor webhook configuration
4. Review run tracking in Apify Runs table
5. Check error messages in run records
