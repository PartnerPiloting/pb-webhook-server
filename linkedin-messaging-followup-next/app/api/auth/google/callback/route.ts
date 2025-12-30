import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?error=oauth_denied`
      );
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing OAuth parameters' }, { status: 400 });
    }

    // Decode state to get client ID
    const { clientId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('Token exchange error:', tokens);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?client=${clientId}&error=token_failed`
      );
    }

    // Calculate token expiry (tokens.expires_in is in seconds)
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000);

    // First, find the client record (case-insensitive lookup)
    const lookupResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        },
      }
    );

    if (!lookupResponse.ok) {
      console.error('Failed to lookup client:', await lookupResponse.text());
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?client=${clientId}&error=lookup_failed`
      );
    }

    const lookupData = await lookupResponse.json();
    
    if (!lookupData.records || lookupData.records.length === 0) {
      console.error('Client not found:', clientId);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?client=${clientId}&error=client_not_found`
      );
    }

    // Save tokens to Airtable Master Clients base (update existing record)
    const recordId = lookupData.records[0].id;
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Google Calendar Token': tokens.access_token,
            'Google Calendar Refresh Token': tokens.refresh_token,
            'Google Calendar Token Expiry': expiryDate.toISOString(),
            'Calendar Connected': true,
          },
        }),
      }
    );

    if (!airtableResponse.ok) {
      const error = await airtableResponse.text();
      console.error('Failed to save tokens to Airtable:', error);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?client=${clientId}&error=save_failed`
      );
    }

    console.log('Tokens saved successfully for client:', clientId);
    
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?client=${clientId}&connected=true`
    );

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar-booking?error=callback_failed`
    );
  }
}
