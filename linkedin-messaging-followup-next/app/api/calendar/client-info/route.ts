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
    // Check for Google Calendar Email (service account approach)
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Client ID&fields[]=Client Name&fields[]=Status&fields[]=Google Calendar Email`,
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

    return NextResponse.json({
      clientId: client['Client ID'],
      clientName: client['Client Name'],
      calendarConnected: !!calendarEmail,
      calendarEmail: calendarEmail || null,
    });

  } catch (error) {
    console.error('Client info error:', error);
    return NextResponse.json(
      { error: 'Failed to load client information' },
      { status: 500 }
    );
  }
}
