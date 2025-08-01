# Multi-Service Log Analysis API

This system can automatically analyze logs across ALL your Render services. Here's how to use it:

## 🔧 Setup

1. **Add your Render API Key to .env:**
```bash
RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxx
```

2. **Get your API key from Render:**
   - Go to https://dashboard.render.com/u/settings
   - Create API Key
   - Copy the key to your .env file

## 🚀 API Endpoints

### 1. List All Services
```bash
GET /api/logs/services
```
Shows all your Render services and their IDs.

### 2. Search Logs Across All Services
```bash
POST /api/logs/search
Content-Type: application/json

{
  "searchTerms": ["CLIENT:ABC123", "ERROR"],
  "timeRange": "2h"
}
```

### 3. Automatic Error Analysis
```bash
GET /api/logs/analyze-errors?timeRange=1h
```
Automatically finds and categorizes errors across all services.

### 4. Client-Specific Check
```bash
POST /api/logs/client-check
Content-Type: application/json

{
  "clientId": "ABC123",
  "timeRange": "2h",
  "includeTypes": ["ERROR", "WARN"]
}
```

## 💡 Example Usage

### Check for errors in the last hour:
```bash
curl -X GET "https://your-domain.com/api/logs/analyze-errors?timeRange=1h"
```

### Search for a specific client's issues:
```bash
curl -X POST "https://your-domain.com/api/logs/client-check" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "ABC123", "timeRange": "2h"}'
```

### Search for specific terms:
```bash
curl -X POST "https://your-domain.com/api/logs/search" \
  -H "Content-Type: application/json" \
  -d '{"searchTerms": ["timeout", "failed"], "timeRange": "1h"}'
```

## 🎯 Time Ranges Supported
- `15m` - Last 15 minutes
- `30m` - Last 30 minutes  
- `1h` - Last hour
- `2h` - Last 2 hours
- `6h` - Last 6 hours
- `12h` - Last 12 hours
- `24h` - Last 24 hours

## 🔍 Structured Logging Benefits

Thanks to our structured logging system, you can search for:
- `CLIENT:ABC123` - All logs for a specific client
- `SESSION:20250801-143022` - Complete operation traces
- `ERROR` - All error messages
- `GEMINI` - AI integration issues
- `WEBHOOK` - Webhook processing issues

## 🤖 AI-Powered Analysis (Future Enhancement)

The system is designed to integrate with Gemini AI for intelligent log analysis:
- Pattern recognition
- Root cause analysis
- Trend detection
- Automated recommendations

## 📱 Integration Ideas

1. **Slack Bot**: Get alerts when errors spike
2. **Dashboard Widget**: Real-time service health
3. **Automated Monitoring**: Schedule health checks
4. **Client Notifications**: Alert specific clients about their issues
