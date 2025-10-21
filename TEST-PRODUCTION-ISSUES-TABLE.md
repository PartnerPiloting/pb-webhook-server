# Test Production Issues Table on Render

## Step 1: Wait for Deployment
1. Go to Render dashboard: https://dashboard.render.com
2. Wait for deployment to complete (~2-3 minutes)
3. Look for "Live" status

---

## Step 2: Verify Table Schema

Once deployed, run this command to verify your Airtable table matches the code:

```bash
curl -X GET "https://pb-webhook-server.onrender.com/api/verify-production-issues-table" \
  -H "Authorization: Bearer Diamond9753!!@@pb"
```

### ✅ Success Response:
```json
{
  "ok": true,
  "message": "Table verification successful!",
  "verified": {
    "table_name": "Production Issues",
    "fields_tested": [
      "Timestamp",
      "Severity", 
      "Pattern Matched",
      "Error Message",
      "Context",
      "Status",
      "Occurrences",
      "First Seen",
      "Last Seen"
    ],
    "single_select_values_tested": {
      "Status": "NEW",
      "Severity": "WARNING"
    },
    "total_expected_fields": 19,
    "test_record_created_and_deleted": true
  },
  "next_steps": [
    "All core field names match ✓",
    "Single select options match ✓",
    "Ready to analyze production logs!",
    "Try: POST /api/analyze-logs/text with sample logs"
  ]
}
```

### ❌ Error Response (Field Mismatch):
```json
{
  "ok": false,
  "error": "Unknown field name: \"Pattern Matched\"",
  "troubleshooting": [
    "Field name mismatch detected: \"Pattern Matched\"",
    "Check that field exists in Airtable with exact spelling and capitalization",
    "Expected fields: Timestamp, Severity, Pattern Matched, Error Message, Context, Status, Occurrences, First Seen, Last Seen"
  ]
}
```

If you get an error, I'll update the code to match your exact field names!

---

## Step 3: Test with Sample Logs (After Verification Passes)

Test the analysis endpoint with some sample error logs:

```bash
curl -X POST "https://pb-webhook-server.onrender.com/api/analyze-logs/text" \
  -H "Authorization: Bearer Diamond9753!!@@pb" \
  -H "Content-Type: application/json" \
  -d '{
    "logText": "2024-10-08T14:32:15Z ERROR: Unhandled exception in batch scorer\nTypeError: Cannot read property '\''score'\'' of undefined\n    at scoreLeadBatch (batchScorer.js:145:22)\n    at processClientRun (jobTracking.js:89:15)",
    "createRecords": true
  }'
```

### Expected Response:
```json
{
  "ok": true,
  "summary": {
    "total": 1,
    "critical": 0,
    "error": 1,
    "warning": 0,
    "duplicates_filtered": 0
  },
  "issues": [
    {
      "timestamp": "2024-10-08T14:32:15.000Z",
      "severity": "ERROR",
      "pattern": "Stack trace detected",
      "message": "TypeError: Cannot read property 'score' of undefined",
      "context": "...",
      "stackTrace": "..."
    }
  ],
  "records_created": 1
}
```

---

## Step 4: Check Airtable

1. Open Master Clients base in Airtable
2. Go to "Production Issues" table
3. Check the "🔥 Critical Issues" view
4. You should see the test issue created from Step 3

---

## Troubleshooting

### If verification fails with "Unknown field name":
Tell me which field is failing and I'll check the exact spelling in your table.

### If verification fails with "Invalid value":
The single select options don't match. Make sure:
- **Status**: NEW, INVESTIGATING, FIXED, IGNORED (all caps)
- **Severity**: CRITICAL, ERROR, WARNING (all caps)

### If you see "Could not find table":
Make sure the table is named exactly "Production Issues" (with space and capital P and I).

---

## Next Steps After Successful Verification

1. ✅ Table verified
2. Get Render API credentials (see RENDER-API-QUESTIONS.md)
3. Analyze real production logs
4. Fix issues as they appear

Let me know the result of the verification endpoint!
