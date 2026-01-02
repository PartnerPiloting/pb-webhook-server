import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/calendar/lookup-lead
 * Proxy to backend - lookup lead by LinkedIn URL, email, or name
 */
export async function GET(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    // Support both 'query' (new) and 'url' (legacy) parameters
    const query = searchParams.get('query') || searchParams.get('url');

    if (!query) {
      return NextResponse.json({ error: 'Search query required (URL, email, or name)' }, { status: 400 });
    }

    // Get backend URL - strip /api/linkedin suffix if present
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server-staging.onrender.com';

    const backendResponse = await fetch(
      `${backendUrl}/api/calendar/lookup-lead?query=${encodeURIComponent(query)}`,
      {
        headers: {
          'x-client-id': clientId,
        },
      }
    );

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });

  } catch (error) {
    console.error('Lookup lead proxy error:', error);
    return NextResponse.json(
      { error: 'Lead lookup failed' },
      { status: 500 }
    );
  }
}
