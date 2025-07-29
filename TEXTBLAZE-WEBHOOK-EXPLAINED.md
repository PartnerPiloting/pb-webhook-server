# 📋 Text Blaze LinkedIn Webhook Explained
*What `/textblaze-linkedin-webhook` does and how it works*

## 🎯 Purpose
The `/textblaze-linkedin-webhook` endpoint automatically tracks LinkedIn messages you send to prospects by logging them in your Airtable CRM.

## 🔄 How It Works

### The Workflow
1. **You send a LinkedIn message** using Text Blaze (browser extension for text snippets)
2. **Text Blaze automatically calls** the webhook with message details
3. **Webhook finds the prospect** in your Airtable "Leads" table
4. **Webhook adds the message** to the prospect's Notes field
5. **You have a complete conversation history** in Airtable

### Example Flow
```
You type: {LinkedIn-outreach}  (Text Blaze snippet)
↓
Text Blaze sends: "Hi John, I noticed your background in..."  
↓
Text Blaze calls webhook with:
{
  "linkedinMessage": "Hi John, I noticed your background in...",
  "profileUrl": "https://linkedin.com/in/john-smith",
  "timestamp": "2025-07-29 10:30:00"
}
↓
Webhook finds John Smith in Airtable
↓
Webhook adds to John's Notes: "📅 2025-07-29 10:30:00 – Sent: Hi John, I noticed..."
```

## 📥 What The Webhook Receives

### Required Data
```json
{
  "linkedinMessage": "The actual message you sent",
  "profileUrl": "https://linkedin.com/in/prospect-name", 
  "timestamp": "2025-07-29 10:30:00"
}
```

### Example Real Payload
```json
{
  "linkedinMessage": "Hi Sarah! I saw your post about digital marketing automation. As someone working with Australian businesses on similar challenges, I'd love to connect and share some insights that might be valuable for your work at TechCorp.",
  "profileUrl": "https://linkedin.com/in/sarah-johnson-marketing",
  "timestamp": "2025-07-29 14:25:33"
}
```

## 🔍 What The Webhook Does

### Step 1: Validate Data
- Checks that message, URL, and timestamp are provided
- Normalizes LinkedIn URL (removes trailing slash)
- Validates Airtable connection

### Step 2: Find The Prospect
```javascript
// Searches Airtable Leads table for matching LinkedIn URL
filterByFormula: `({LinkedIn Profile URL} = 'https://linkedin.com/in/sarah-johnson-marketing')`
```

### Step 3: Update Notes Field
```javascript
// Prepends new message to existing notes
const newNoteEntry = `📅 2025-07-29 14:25:33 – Sent: Hi Sarah! I saw your post...`;
const updatedNotes = existingNotes 
  ? `${newNoteEntry}\n\n---\n\n${existingNotes}` 
  : newNoteEntry;
```

### Step 4: Save to Airtable
- Updates the prospect's record with the new note
- Returns success confirmation with Airtable record link

## 📊 What You See in Airtable

### Before Message
| Name | LinkedIn Profile URL | Notes |
|------|---------------------|--------|
| Sarah Johnson | https://linkedin.com/in/sarah-johnson-marketing | *empty* |

### After Message
| Name | LinkedIn Profile URL | Notes |
|------|---------------------|--------|
| Sarah Johnson | https://linkedin.com/in/sarah-johnson-marketing | 📅 2025-07-29 14:25:33 – Sent: Hi Sarah! I saw your post about digital marketing... |

### After Multiple Messages
| Name | LinkedIn Profile URL | Notes |
|------|---------------------|--------|
| Sarah Johnson | https://linkedin.com/in/sarah-johnson-marketing | 📅 2025-07-29 16:45:12 – Sent: Thanks for connecting Sarah!<br><br>---<br><br>📅 2025-07-29 14:25:33 – Sent: Hi Sarah! I saw your post about digital marketing... |

## ⚠️ Current Limitation

### Single-Tenant Issue
The webhook currently uses a **hardcoded Airtable base** instead of looking up which client sent the message:

```javascript
// Current (problematic):
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; // Always Guy Wilson's base

// Should be (multi-tenant):
const clientBase = getClientBase(clientId); // Client-specific base
```

### Impact
- All webhook data goes to one Airtable base (currently Guy Wilson's)
- When you have multiple clients, their messages would mix together
- Security risk: clients could see each other's data

## 🛠️ Text Blaze Setup

### What Text Blaze Needs
1. **Snippet with webhook call** in your Text Blaze templates
2. **LinkedIn profile detection** to get the prospect's URL
3. **Webhook endpoint** configured to call your server

### Example Text Blaze Snippet
```javascript
// In your Text Blaze snippet:
{note: {webhookpost: https://pb-webhook-server.onrender.com/textblaze-linkedin-webhook; 
linkedinMessage={formtext: name=message; default=Hi {linkedinname}...}; 
profileUrl={linkedinurl}; 
timestamp={time: MM/DD/YYYY HH:mm:ss}}}
```

## 🚨 Security Status

### ❌ **NOT READY for Multi-Client Use**
- No client identification in webhook payload
- Uses single Airtable base for all users
- Could cause data mixing between clients

### ✅ **Safe Alternatives**
1. **Manual note entry** through authenticated portal
2. **Copy-paste workflow** instead of automatic webhook
3. **Use authenticated API endpoints** for message logging

## 🔧 Quick Fix Options

### Option 1: Add Client ID to Payload
```json
{
  "linkedinMessage": "Hi Sarah...",
  "profileUrl": "https://linkedin.com/in/sarah-johnson",
  "timestamp": "2025-07-29 14:25:33",
  "clientId": "actual-client-id"  // Add this
}
```

### Option 2: Use Authenticated Endpoint
Instead of webhook, use existing authenticated API:
```
POST /api/linkedin/leads/add-note
Authorization: WordPress session
Body: { message: "...", profileUrl: "..." }
```

## 💡 Business Value

### Why It's Useful
✅ **Automatic conversation tracking** - No manual data entry  
✅ **Complete message history** - See all interactions with each prospect  
✅ **CRM integration** - LinkedIn activity flows into your lead management  
✅ **Follow-up reminders** - Know when you last contacted someone  
✅ **Team visibility** - Shared conversation history  

### Current Recommendation
**Wait for multi-tenant fix** before using with real clients, or use manual note-taking through the authenticated portal until the webhook is updated.
