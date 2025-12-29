import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// Initialize Google Calendar API
function getCalendarClient() {
  try {
    // Option 1: Service Account (for server-side only)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      return google.calendar({ version: 'v3', auth });
    }

    // Option 2: OAuth2 (for user-specific calendars)
    // This would require OAuth flow - placeholder for now
    throw new Error('Google Calendar credentials not configured');

  } catch (error) {
    console.error('Google Calendar client initialization failed:', error);
    throw error;
  }
}

function convertToISODateTime(dateTimeStr: string, timezone: string): string {
  // Convert datetime-local format to ISO with timezone
  const date = new Date(dateTimeStr);
  return date.toISOString();
}

export async function POST(request: Request) {
  try {
    const {
      yourName,
      yourEmail,
      yourPhone,
      yourZoom,
      yourLinkedIn,
      leadName,
      leadEmail,
      leadPhone,
      leadLinkedIn,
      meetingTime,
      timezone,
    } = await request.json();

    if (!yourName || !leadName || !leadEmail || !meetingTime) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // For now, return mock success since Google Calendar setup requires OAuth
    // TODO: Implement full Google Calendar OAuth flow
    
    const mockEvent = {
      summary: `${leadName} and ${yourName} meeting`,
      description: `Meeting between ${leadName} and ${yourName}\n\n` +
        `${yourName}'s Details:\n` +
        `LinkedIn: ${yourLinkedIn}\n` +
        `Phone: ${yourPhone}\n` +
        `Zoom: ${yourZoom}\n\n` +
        `${leadName}'s Details:\n` +
        `LinkedIn: ${leadLinkedIn}\n` +
        (leadPhone ? `Phone: ${leadPhone}\n` : ''),
      start: {
        dateTime: convertToISODateTime(meetingTime, 'Australia/Brisbane'),
        timeZone: 'Australia/Brisbane',
      },
      end: {
        dateTime: convertToISODateTime(
          new Date(new Date(meetingTime).getTime() + 60 * 60 * 1000).toISOString().slice(0, 16),
          'Australia/Brisbane'
        ),
        timeZone: 'Australia/Brisbane',
      },
      attendees: [
        { email: leadEmail, displayName: leadName },
      ],
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 30 }, // 30 minutes before
        ],
      },
    };

    console.log('Would create calendar event:', mockEvent);

    // Mock response for now
    return NextResponse.json({
      success: true,
      message: 'Calendar booking system is set up. Google Calendar OAuth integration pending.',
      event: mockEvent,
    });

    /* Uncomment when Google Calendar OAuth is configured:
    
    const calendar = getCalendarClient();
    
    const event = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: mockEvent,
      sendUpdates: 'all',
    });

    return NextResponse.json({
      success: true,
      eventId: event.data.id,
      eventLink: event.data.htmlLink,
    });
    */

  } catch (error) {
    console.error('Book meeting error:', error);
    return NextResponse.json(
      { error: 'Failed to book meeting: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}
