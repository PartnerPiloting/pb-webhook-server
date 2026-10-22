#!/bin/bash

# Test smart resume endpoint
curl -X POST "https://pb-webhook-server-staging.onrender.com/smart-resume-client-by-client" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $PB_WEBHOOK_SECRET" \
  -d '{"stream": 1}' \
  -v