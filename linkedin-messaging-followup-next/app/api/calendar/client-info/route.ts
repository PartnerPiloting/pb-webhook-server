import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    // Query Airtable Master Clients base (case-insensitive)
    // Check for Google Calendar Email (service account approach) and Timezone
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Client ID&fields[]=Client Name&fields[]=Status&fields[]=Google Calendar Email&fields[]=Timezone&fields[]=LinkedIn URL&fields[]=Phone&fields[]=Meeting Link`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        },
        cache: 'no-store',
      }
    );

    if (!airtableResponse.ok) {
      console.error('Airtable query failed:', await airtableResponse.text());
      return NextResponse.json(
        { error: 'Failed to query client database' },
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
    
    // Check if client is active
    if (client.Status !== 'Active') {
      return NextResponse.json(
        { error: 'Client is not active' },
        { status: 403 }
      );
    }

    // Calendar is connected if they have set their calendar email
    const calendarEmail = client['Google Calendar Email'];
    const timezone = client['Timezone'];
    
    // Client profile fields for form auto-fill
    const linkedInUrl = client['LinkedIn URL'];
    const phone = client['Phone'];
    const meetingLink = client['Meeting Link'];
    
    // Validate timezone using Intl.DateTimeFormat
    const isValidTimezone = (tz: string | undefined): boolean => {
      if (!tz) return false;
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    };

    return NextResponse.json({
      clientId: client['Client ID'],
      clientName: client['Client Name'],
      calendarConnected: !!calendarEmail,
      calendarEmail: calendarEmail || null,
      timezone: timezone || null,
      timezoneConfigured: isValidTimezone(timezone),
      // Profile fields for booking form
      linkedInUrl: linkedInUrl || null,
      phone: phone || null,
      meetingLink: meetingLink || null,
    });

  } catch (error) {
    console.error('Client info error:', error);
    return NextResponse.json(
      { error: 'Failed to load client information' },
      { status: 500 }
    );
  }
}
