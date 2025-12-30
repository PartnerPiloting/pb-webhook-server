import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Helper to refresh access token if expired
async function getValidAccessToken(clientId: string): Promise<{ token: string; error?: string }> {
  // Get client record with tokens
  const lookupResponse = await fetch(
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Google Calendar Token&fields[]=Google Calendar Refresh Token&fields[]=Google Calendar Token Expiry`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      },
      cache: 'no-store',
    }
  );

  if (!lookupResponse.ok) {
    return { token: '', error: 'Failed to lookup client' };
  }

  const data = await lookupResponse.json();
  if (!data.records || data.records.length === 0) {
    return { token: '', error: 'Client not found' };
  }

  const record = data.records[0];
  const fields = record.fields;
  const accessToken = fields['Google Calendar Token'];
  const refreshToken = fields['Google Calendar Refresh Token'];
  const tokenExpiry = fields['Google Calendar Token Expiry'];

  if (!accessToken || !refreshToken) {
    return { token: '', error: 'Calendar not connected' };
  }

  // Check if token is expired (with 5 minute buffer)
  const expiryDate = new Date(tokenExpiry);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiryDate.getTime() - bufferMs > now.getTime()) {
    // Token still valid
    return { token: accessToken };
  }

  // Token expired, refresh it
  console.log('Refreshing expired token for client:', clientId);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    console.error('Token refresh error:', tokens);
    return { token: '', error: 'Failed to refresh token' };
  }

  // Calculate new expiry
  const newExpiryDate = new Date(Date.now() + tokens.expires_in * 1000);

  // Update token in Airtable
  await fetch(
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients/${record.id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Google Calendar Token': tokens.access_token,
          'Google Calendar Token Expiry': newExpiryDate.toISOString(),
        },
      }),
    }
  );

  return { token: tokens.access_token };
}

export async function POST(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();
    const { date, startHour = 9, endHour = 17 } = body;

    if (!date) {
      return NextResponse.json({ error: 'Date required (YYYY-MM-DD format)' }, { status: 400 });
    }

    // Get valid access token
    const { token, error } = await getValidAccessToken(clientId);
    if (error) {
      return NextResponse.json({ error }, { status: 401 });
    }

    // Build time range for the query (in Brisbane timezone)
    const brisbaneTimezone = 'Australia/Brisbane';
    const startTime = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
    const endTime = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`);

    // Query Google Calendar FreeBusy API
    const freebusyResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          timeZone: brisbaneTimezone,
          items: [{ id: 'primary' }],
        }),
      }
    );

    if (!freebusyResponse.ok) {
      const errorText = await freebusyResponse.text();
      console.error('FreeBusy API error:', errorText);
      return NextResponse.json({ error: 'Failed to query calendar' }, { status: 500 });
    }

    const freebusyData = await freebusyResponse.json();
    const busySlots = freebusyData.calendars?.primary?.busy || [];

    // Generate 30-minute slots for the day
    const slots: Array<{ time: string; available: boolean; display: string }> = [];
    const slotDuration = 30 * 60 * 1000; // 30 minutes in ms

    for (let time = startTime.getTime(); time < endTime.getTime(); time += slotDuration) {
      const slotStart = new Date(time);
      const slotEnd = new Date(time + slotDuration);

      // Check if this slot overlaps with any busy period
      const isAvailable = !busySlots.some((busy: { start: string; end: string }) => {
        const busyStart = new Date(busy.start).getTime();
        const busyEnd = new Date(busy.end).getTime();
        // Overlap check: slot overlaps if it starts before busy ends AND ends after busy starts
        return slotStart.getTime() < busyEnd && slotEnd.getTime() > busyStart;
      });

      // Format display time
      const displayTime = slotStart.toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: brisbaneTimezone,
      });

      slots.push({
        time: slotStart.toISOString(),
        available: isAvailable,
        display: displayTime,
      });
    }

    return NextResponse.json({
      date,
      timezone: brisbaneTimezone,
      slots,
      busySlots, // Include raw busy data for debugging
    });

  } catch (error) {
    console.error('FreeBusy error:', error);
    return NextResponse.json(
      { error: 'Failed to check availability' },
      { status: 500 }
    );
  }
}
