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
    // Explicitly request the Calendar Connected field
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Client ID&fields[]=Client Name&fields[]=Status&fields[]=Calendar Connected&fields[]=Google Calendar Token`,
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
    
    // Debug: Log ALL fields returned by Airtable
    console.log('Record ID:', data.records[0].id);
    console.log('All Airtable fields:', JSON.stringify(client, null, 2));
    console.log('Field names:', Object.keys(client));
    console.log('Calendar Connected raw value:', client['Calendar Connected']);
    console.log('Google Calendar Token exists:', !!client['Google Calendar Token']);
    
    // Check if client is active
    if (client.Status !== 'Active') {
      return NextResponse.json(
        { error: 'Client is not active' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      clientId: client['Client ID'],
      clientName: client['Client Name'],
      calendarConnected: !!client['Calendar Connected'],
    });

  } catch (error) {
    console.error('Client info error:', error);
    return NextResponse.json(
      { error: 'Failed to load client information' },
      { status: 500 }
    );
  }
}
