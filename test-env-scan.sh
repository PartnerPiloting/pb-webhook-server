#!/bin/bash

# Test the filtered environment variable scan on Render staging

curl -X POST \
  https://pb-webhook-server-staging.onrender.com/api/scan-env-vars \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: Diamond9753!!@@pb" \
  -d '{"onlySetVariables": true, "includeAiDescriptions": false}' \
  | python -m json.tool
