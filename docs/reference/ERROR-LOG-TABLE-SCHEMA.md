# Error Log Table Schema

**Table Name:** `Error Log`  
**Location:** Master Clients Base  
**Purpose:** Capture production errors with full debugging context

---

## Field Definitions

### Core Error Information

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| **Error ID** | Auto Number | Unique identifier | 1, 2, 3... |
| **Timestamp** | Created Time | When error occurred | 2025-10-06T14:30:45Z |
| **Severity** | Single Select | Error severity level | CRITICAL, ERROR, WARNING |
| **Error Type** | Single Select | Category of error | Module Import, AI Service, Airtable API, Data Validation, etc. |
| **Error Message** | Long Text | The actual error message | "Cannot find module './breakdown'" |
| **Stack Trace** | Long Text | Full stack trace | "at require (/app/batchScorer.js:54)" |

### Context & Debugging

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| **File Path** | Single Line Text | File where error occurred | "/app/batchScorer.js" |
| **Function Name** | Single Line Text | Function where error occurred | "scoreBatchOfLeads" |
| **Line Number** | Number | Line number in file | 54 |
| **Context JSON** | Long Text | Full context as JSON | See below |

### Relationships

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| **Client ID** | Link to Clients | Which client (if applicable) | [Link to Guy Wilson] |
| **Run ID** | Single Line Text | Job run identifier | "251006-143022-GuyWilson" |

### Resolution Tracking

| Field Name | Type | Description | Example |
|------------|------|-------------|---------|
| **Status** | Single Select | Resolution status | NEW, INVESTIGATING, FIXED, IGNORED |
| **Resolution Notes** | Long Text | How it was fixed | "Updated import path to ./scripts/analysis/breakdown" |
| **Fixed In Commit** | Single Line Text | Git commit hash | "d5ac72d" |
| **Fixed By** | Single Line Text | Who fixed it | "AI Assistant" / "Guy Wilson" |
| **Fixed Date** | Date | When it was fixed | 2025-10-06 |

---

## Severity Levels

### CRITICAL
- System crashes
- Data loss
- Service completely unavailable
- Security breaches

### ERROR
- Feature broken but system runs
- Missing imports
- API failures
- Invalid data causing skips

### WARNING
- Degraded performance
- Approaching resource limits
- Deprecated code usage
- Configuration issues

---

## Error Types

| Error Type | Description | Examples |
|------------|-------------|----------|
| **Module Import** | Missing or incorrect module paths | "Cannot find module" |
| **AI Service** | Gemini/OpenAI failures | Timeout, quota exceeded, API error |
| **Airtable API** | Airtable read/write failures | Rate limit, invalid field name, network error |
| **Data Validation** | Invalid or missing data | Required field missing, type mismatch |
| **Authentication** | Auth/permission failures | Invalid credentials, expired token |
| **Memory/Resources** | Resource exhaustion | Out of memory, disk full |
| **Business Logic** | Logic errors in code | Null pointer, undefined function |
| **Job Tracking** | Job/run tracking failures | Duplicate run ID, invalid status |
| **Network** | External service failures | DNS, timeout, connection refused |
| **Unknown** | Uncategorized errors | (Default until classified) |

---

## Context JSON Structure

```json
{
  "runId": "251006-143022-GuyWilson",
  "clientId": "recABC123",
  "clientName": "Guy Wilson",
  "operation": "Batch scoring profiles",
  "endpoint": "/api/smart-resume",
  "method": "POST",
  "inputData": {
    "leadId": "rec123",
    "profileUrl": "https://linkedin.com/in/johndoe"
  },
  "systemState": {
    "memoryUsage": {
      "rss": 123456789,
      "heapTotal": 98765432,
      "heapUsed": 87654321,
      "external": 12345678
    },
    "activeJobs": 3,
    "uptime": 3600
  },
  "requestHeaders": {
    "user-agent": "Mozilla/5.0...",
    "x-client-id": "recABC123"
  },
  "additionalContext": "Any other relevant debugging info"
}
```

---

## Usage Example

When I (AI) need to debug an error, I can query:

```javascript
// Get all errors from last deploy
SELECT * FROM Error Log 
WHERE Timestamp > '2025-10-06T02:29:00Z' 
AND Status = 'NEW'
ORDER BY Timestamp DESC

// Get all Module Import errors
SELECT * FROM Error Log 
WHERE Error Type = 'Module Import'

// Get all errors for specific client
SELECT * FROM Error Log 
WHERE Client ID = 'recABC123'
AND Status != 'FIXED'
```

---

## Implementation Notes

1. **Auto-capture** - Errors logged automatically by global middleware
2. **Selective logging** - Only CRITICAL and ERROR severity go to Airtable
3. **Deduplication** - Same error within 5 minutes = update count, don't create new record
4. **Rate limiting** - Max 100 error logs per hour to prevent spam
5. **Retention** - Auto-archive errors older than 90 days

---

**Created:** October 6, 2025  
**Status:** Ready for implementation
