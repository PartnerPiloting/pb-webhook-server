# Calendar Booking System - Setup Guide

## Overview
Calendar booking system that integrates with AI Blaze to extract LinkedIn data, convert timezones, generate AI messages, and book Google Calendar meetings.

## User Workflow

1. **Extract LinkedIn Data (AI Blaze)**
   - Navigate to LinkedIn profile
   - Run AI Blaze prompt (see below)
   - Data is copied to clipboard in format:
     ```
     My Name: Guy Wilson|||My LinkedIn: https://...|||My Phone: 0414 975 509|||My Zoom: https://...|||Lead Name: [extracted]|||Lead LinkedIn Profile: [extracted]|||Lead Location: [extracted]
     ```

2. **Open Calendar Form**
   - Navigate to: `your-app.vercel.app/calendar-booking`
   - Keep this tab pinned and open all day

3. **Load Data**
   - Click "📋 Read from Clipboard" button
   - System validates format and auto-fills all fields
   - Timezone is auto-detected from location

4. **Add Email/Phone**
   - Enter Lead Email (required for booking)
   - Optionally add Lead Phone

5. **Choose Action**
   - **Tab 1: Suggest Times** - Generate AI message with timezone conversion (email optional)
   - **Tab 2: Book Meeting** - Create calendar event and send invites (email required)

## AI Blaze Prompt

```
Your job is to look at the current page which should be a LinkedIn profile and extract data that I can copy in this format:

My Name: Guy Wilson|||My LinkedIn: https://www.linkedin.com/in/guy-wilson-safeur/|||My Phone: 0414 975 509|||My Zoom: https://us04web.zoom.us/j/9892817976|||Lead Name: [extracted]|||Lead LinkedIn Profile: [extracted]|||Lead Location: [extracted]

Rules:
- Lead Name: Extract first and last name (verify it sounds legitimate)
- Lead LinkedIn Profile: Current page URL with all parameters removed
- Lead Location: Extract exactly as shown on profile (city, state, country)
- Keep consistent spacing after all colons
```

## Files Created

### Frontend
- `app/calendar-booking/page.tsx` - Main booking interface with clipboard reader, form, and tabs

### API Routes
- `app/api/calendar/detect-timezone/route.ts` - Timezone detection (rule-based + Gemini fallback)
- `app/api/calendar/suggest-times/route.ts` - AI message generation with timezone conversion
- `app/api/calendar/book-meeting/route.ts` - Google Calendar event creation

## Environment Setup

### Required Variables (add to Vercel)

```bash
# Gemini AI
GEMINI_API_KEY=your_api_key

# Google Calendar (Service Account method)
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### Gemini API Setup
1. Go to: https://ai.google.dev/
2. Get API key
3. Add to Vercel environment variables

### Google Calendar Setup

**Option 1: Service Account (Recommended for testing)**
1. Go to Google Cloud Console: https://console.cloud.google.com
2. Create new project or select existing
3. Enable Google Calendar API
4. Create Service Account
5. Download JSON key file
6. Extract `client_email` and `private_key` 
7. Add to Vercel environment variables
8. Share your Google Calendar with the service account email (Editor permissions)

**Option 2: OAuth2 (For production with user calendars)**
- Requires implementing OAuth flow
- Currently shows mock response until OAuth is configured
- See commented code in `book-meeting/route.ts`

## Timezone Detection

### Automatic Detection
System automatically detects timezones for:
- **Australian cities**: Perth, Sydney, Melbourne, Brisbane, Adelaide, Darwin, Hobart, Canberra
- **Australian states**: Western Australia, NSW, Victoria, Queensland, South Australia
- **US cities**: New York, Los Angeles, Chicago, San Francisco
- **US states**: California, Texas, Florida, Illinois
- **International**: London, Singapore, Tokyo, Hong Kong, Dubai

### Fallback
- Unknown locations → Calls Gemini AI for timezone detection
- Generic "Australia" → Defaults to Brisbane (AEST UTC+10, no daylight saving)

## Features

### Suggest Times Tab
- Pick 2-3 meeting time options
- AI generates friendly message with timezone conversion
- Shows times in lead's local timezone
- Copy message to LinkedIn
- **Email optional** (message sent via LinkedIn anyway)

### Book Meeting Tab
- Pick single meeting time
- Creates Google Calendar event
- Sends invites to both parties
- Includes LinkedIn profiles and phone numbers in description
- Adds Zoom/Meet link
- **Email required** to send invite

### Meeting Format
- **Title**: "John Smith and Guy Wilson meeting"
- **Description**: Both parties' LinkedIn profiles, phones, Zoom links
- **Duration**: 1 hour (default)
- **Reminders**: Email (1 day before), Popup (30 min before)

## Testing Locally

```bash
cd linkedin-messaging-followup-next
npm run dev
```

Navigate to: http://localhost:3000/calendar-booking

## Deployment

Push to Vercel:
```bash
git add .
git commit -m "Add calendar booking system"
git push origin staging
```

Add environment variables in Vercel dashboard → Settings → Environment Variables

## Known Limitations

1. **Google Calendar OAuth**: Currently returns mock response. Full OAuth flow needed for production.
2. **Timezone conversion**: Uses simplified logic. Consider adding `date-fns-tz` for precise conversions.
3. **Conflict checking**: Not yet implemented. See TODO in code.
4. **Multi-calendar support**: Service account only accesses calendars shared with it.

## Next Steps

1. Set up Gemini API key
2. Configure Google Calendar service account
3. Test with real LinkedIn profiles
4. Implement OAuth flow for production
5. Add conflict checking before booking
6. Add calendar sync status indicator
7. Support multiple calendar providers

## Troubleshooting

**Clipboard not reading:**
- Check browser permissions (allow clipboard access)
- Try manually pasting into text box fallback

**Timezone not detected:**
- Check Gemini API key is configured
- Review location string format from AI Blaze

**Calendar booking fails:**
- Verify Google Calendar credentials
- Check service account has calendar access
- Review Vercel logs for errors

**AI message generation fails:**
- Check Gemini API key
- Verify request format
- Review API quota limits
