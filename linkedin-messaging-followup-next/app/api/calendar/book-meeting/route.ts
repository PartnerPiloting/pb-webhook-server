import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

function convertToISODateTime(dateTimeStr: string, timezone: string): string {
  // Convert datetime-local format to ISO with timezone
  const date = new Date(dateTimeStr);
  return date.toISOString();
}

export async function POST(request: Request) {
  try {
    const {
      clientId,
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

    if (!clientId || !yourName || !leadName || !leadEmail || !meetingTime) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Retrieve client's OAuth token from Airtable
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula={Client ID}='${clientId}'`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        },
      }
    );

    if (!airtableResponse.ok) {
      console.error('Failed to query Airtable:', await airtableResponse.text());
      return NextResponse.json(
        { error: 'Failed to retrieve client credentials' },
        { status: 500 }
      );
    }

    const data = await airtableResponse.json();
    
    if (!data.records || data.records.length === 0) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }

    const client = data.records[0].fields;
    
    if (!client['Calendar Connected'] || !client['Google Calendar Token']) {
      return NextResponse.json(
        { error: 'Calendar not connected. Please connect your Google Calendar first.' },
        { status: 403 }
      );
    }

    // Check if token needs refresh
    const tokenExpiry = new Date(client['Google Calendar Token Expiry']);
    const needsRefresh = tokenExpiry.getTime() < Date.now() + (5 * 60 * 1000); // Refresh if expires in < 5 min

    let accessToken = client['Google Calendar Token'];

    if (needsRefresh && client['Google Calendar Refresh Token']) {
      // Refresh the token
      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
          refresh_token: client['Google Calendar Refresh Token'],
          grant_type: 'refresh_token',
        }),
      });

      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        accessToken = refreshData.access_token;
        
        // Update token in Airtable
        const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000);
        await fetch(
          `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients/${data.records[0].id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fields: {
                'Google Calendar Token': accessToken,
                'Google Calendar Token Expiry': newExpiry.toISOString(),
              },
            }),
          }
        );
      }
    }

    // Create OAuth2 client with access token
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Calculate end time (1 hour after start)
    const endTime = new Date(new Date(meetingTime).getTime() + 60 * 60 * 1000);

    // Create the event
    const event = {
      summary: `${leadName} and ${yourName}`,
      description: `Meeting between ${leadName} and ${yourName}\n\n` +
        `${yourName}'s Details:\n` +
        `LinkedIn: ${yourLinkedIn}\n` +
        `Phone: ${yourPhone}\n` +
        `Zoom: ${yourZoom}\n\n` +
        `${leadName}'s Details:\n` +
        `LinkedIn: ${leadLinkedIn}\n` +
        (leadPhone ? `Phone: ${leadPhone}\n` : ''),
      start: {
        dateTime: convertToISODateTime(meetingTime, timezone),
        timeZone: timezone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: timezone,
      },
      attendees: [
        { email: leadEmail, displayName: leadName },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 30 }, // 30 minutes before
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'all',
    });

    return NextResponse.json({
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink,
      message: 'Meeting booked successfully!',
    });

  } catch (error) {
    console.error('Book meeting error:', error);
    return NextResponse.json(
      { error: 'Failed to book meeting: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}
