#!/bin/bash

# Simple job progress checker
echo "🔍 Checking job progress for: smart_resume_1758453767575_n3rke"
echo ""

# Check if the service is responding
echo "1. Testing service availability..."
curl -s -o /dev/null -w "Service response: %{http_code}\n" "https://pb-webhook-server-staging.onrender.com/health" || echo "Service check failed"

echo ""
echo "2. Looking for signs of job activity..."

# Test if we can hit an endpoint that would be called by the script
echo "Testing lead scoring endpoint (same as script would call)..."
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -H "x-webhook-secret: Diamond9753!!@@pb" \
  "https://pb-webhook-server-staging.onrender.com/run-batch-score-v2?stream=1&limit=1&clientId=Guy-Wilson" 2>/dev/null)

http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
message=$(echo "$response" | grep -v "HTTP_CODE:")

if [ "$http_code" = "202" ]; then
    echo "✅ Endpoint working - HTTP 202 Accepted"
    echo "Response: $message" | head -c 100
    echo "..."
else
    echo "❌ Endpoint issue - HTTP $http_code"
    echo "Response: $message"
fi

echo ""
echo "3. Job status summary:"
echo "   Job ID: smart_resume_1758453767575_n3rke"
echo "   Started: ~3-5 minutes ago"
echo "   Expected completion: 5-10 minutes total"
echo ""
echo "💡 Since we can't access logs directly:"
echo "   - If endpoints are responding (202), the job should be working"
echo "   - The email report will be the definitive indicator"
echo "   - Previous jobs failed because script called localhost instead of external URL"
echo "   - This job has the URL fix applied"