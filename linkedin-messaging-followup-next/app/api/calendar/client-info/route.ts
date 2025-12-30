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
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        },
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
    
    // Debug: Log the raw Calendar Connected value
    console.log('Raw Calendar Connected value:', client['Calendar Connected'], 'Type:', typeof client['Calendar Connected']);
    
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
