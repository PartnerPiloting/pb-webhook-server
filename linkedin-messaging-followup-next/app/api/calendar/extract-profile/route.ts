import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/calendar/extract-profile
 * Proxies to the backend's Gemini-powered profile extraction
 * The backend has proper Gemini (Vertex AI) configuration - we don't duplicate it here
 */
export async function POST(request: Request) {
  try {
    const { rawText, clientId } = await request.json();

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ error: 'rawText is required' }, { status: 400 });
    }

    // Get backend URL from environment (strip /api/linkedin suffix if present)
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server-staging.onrender.com';
    
    console.log(`Calling backend: ${backendUrl}/api/calendar/extract-profile`);
    
    // Call the backend's extract-profile endpoint
    const backendResponse = await fetch(`${backendUrl}/api/calendar/extract-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId || 'unknown',
      },
      body: JSON.stringify({ rawText }),
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({ error: 'Backend request failed' }));
      console.error('Backend extract-profile error:', errorData);
      return NextResponse.json(
        { error: errorData.error || 'AI extraction failed' },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Profile extraction proxy error:', error);
    return NextResponse.json(
      { error: 'Profile extraction failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
