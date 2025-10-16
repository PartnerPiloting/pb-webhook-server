#!/bin/bash

# Phase 2: Enhance environment variable descriptions with AI
# Shows real-time progress as each variable is processed

echo "🚀 Starting Phase 2: AI Description Enhancement"
echo ""

curl -N \
  -X POST \
  https://pb-webhook-server-staging.onrender.com/api/enhance-env-descriptions \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: Diamond9753!!@@pb" \
  2>/dev/null | while IFS= read -r line; do
    # Parse the SSE data line
    if [[ $line == data:* ]]; then
        json="${line#data: }"
        
        # Extract type using grep/sed
        type=$(echo "$json" | grep -o '"type":"[^"]*"' | cut -d'"' -f4)
        
        if [ "$type" = "start" ]; then
            total=$(echo "$json" | grep -o '"total":[0-9]*' | cut -d':' -f2)
            echo "📋 Found $total variables to enhance"
            echo ""
        elif [ "$type" = "progress" ]; then
            current=$(echo "$json" | grep -o '"current":[0-9]*' | cut -d':' -f2)
            total=$(echo "$json" | grep -o '"total":[0-9]*' | cut -d':' -f2)
            varName=$(echo "$json" | grep -o '"varName":"[^"]*"' | cut -d'"' -f4)
            status=$(echo "$json" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            
            if [ "$status" = "analyzing" ]; then
                echo "[$current/$total] 🤖 Analyzing: $varName"
            elif [ "$status" = "completed" ]; then
                echo "[$current/$total] ✅ Updated: $varName"
            elif [ "$status" = "error" ]; then
                error=$(echo "$json" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
                echo "[$current/$total] ❌ Error: $varName - $error"
            fi
        elif [ "$type" = "complete" ]; then
            updated=$(echo "$json" | grep -o '"updated":[0-9]*' | cut -d':' -f2)
            errors=$(echo "$json" | grep -o '"errors":[0-9]*' | cut -d':' -f2)
            echo ""
            echo "✅ Enhancement Complete!"
            echo "   Updated: $updated"
            echo "   Errors: $errors"
        elif [ "$type" = "error" ]; then
            error=$(echo "$json" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
            echo ""
            echo "💥 Fatal error: $error"
        fi
    fi
done

echo ""
echo "🎉 All done! Check your Airtable Environment Variables table"
