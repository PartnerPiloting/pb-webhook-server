#!/bin/bash
# Run the checkpoint-based log analyzer

curl -X POST "https://pb-webhook-server-staging.onrender.com/api/analyze-logs/recent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Diamond9753!!@@pb"
