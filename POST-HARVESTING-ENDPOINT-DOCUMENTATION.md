# Post Harvesting Endpoint Documentation

## `/api/apify/process-level2-v2` Endpoint

### Overview
This endpoint provides a fire-and-forget implementation for post harvesting in the client-by-client workflow. It is designed to be called asynchronously and returns a 202 Accepted response immediately while processing continues in the background.

### Key Features
- **Fire-and-forget pattern**: Returns a 202 Accepted response immediately
- **Background processing**: Continues processing after client disconnect
- **Enhanced logging**: Tracks execution flow with detailed logs
- **Error handling**: Properly handles errors in background processing
- **Parent run tracking**: Supports parent run IDs for execution tracking

### Request Format

#### Headers
- `Authorization`: Bearer token (required, must match `PB_WEBHOOK_SECRET`)
- `x-client-id`: Client ID (required if not provided in query parameters)

#### Query Parameters
- `clientId`: Client ID (required if not provided in headers)
- `stream`: Stream ID for tracking (optional, default: "default")
- `parentRunId`: Parent run ID for tracking execution flow (optional)
- `limit`: Maximum number of leads to process (optional)

#### Body (optional)
```json
{
  "maxBatchesOverride": 3,  // Optional: Override the default max batches
  "clientId": "ClientName", // Optional: Alternative to header/query param
  "parentRunId": "run-id"   // Optional: Alternative to query param
}
```

### Response Format

#### Success Response (202 Accepted)
```json
{
  "ok": true,
  "message": "Post harvesting initiated",
  "accepted": true,
  "stream": "streamId",
  "clientId": "ClientName"
}
```

#### Error Responses
- **400 Bad Request**: Missing clientId
- **401 Unauthorized**: Invalid or missing authorization
- **500 Internal Server Error**: Server configuration issue

### Implementation Details

The endpoint is implemented in `routes/apifyProcessRoutes.js` and follows these steps:
1. Validates authorization
2. Extracts client ID from headers, query parameters, or body
3. Returns an immediate 202 Accepted response
4. Processes the client's leads in the background using `processClientHandler()`
5. Handles any errors during background processing

### Usage
This endpoint is designed to be called as part of the smart-resume workflow in the client-by-client processing pattern. It's typically called after lead scoring and before post scoring to harvest LinkedIn posts for leads.

### Fixes Applied
- Fixed null response handling in the `processClientHandler` function
- Added enhanced logging for better debugging
- Improved error handling for background processing
- Added request cloning with metadata for tracking

### Integration with Smart Resume Workflow
The endpoint is called by `scripts/smart-resume-client-by-client.js` during the post harvesting step of the workflow:

```javascript
// From smart-resume-client-by-client.js
const response = await fetch(baseUrl + '/api/apify/process-level2-v2?stream=' + 
  params.stream + '&clientId=' + clientId + '&parentRunId=' + runId, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${secret}`,
    'Content-Type': 'application/json'
  }
});
```