#!/bin/bash

# Test AI description generation for a single variable

echo "🧪 Testing AI description generation for AIRTABLE_API_KEY"
echo ""

curl -X POST \
  https://pb-webhook-server-staging.onrender.com/api/test-ai-description \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: Diamond9753!!@@pb" \
  -d '{"varName": "AIRTABLE_API_KEY"}' \
  | python -m json.tool
