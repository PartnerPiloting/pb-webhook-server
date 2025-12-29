import { NextResponse } from 'next/server';

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

    // Store tokens in Airtable
    // TODO: Call backend API to store tokens
    console.log('Tokens obtained for client:', clientId);
    console.log('Access token:', tokens.access_token?.substring(0, 20) + '...');
    console.log('Refresh token:', tokens.refresh_token ? 'YES' : 'NO');

    // For now, just redirect back with success
    // In production, this would save to Airtable Master Clients base
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
