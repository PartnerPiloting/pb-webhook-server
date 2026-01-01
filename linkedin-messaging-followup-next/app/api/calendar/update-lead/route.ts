import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/calendar/update-lead
 * Proxy to backend - update lead details (location, email, phone)
 */
export async function PATCH(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    // Get backend URL - strip /api/linkedin suffix if present
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server-staging.onrender.com';

    const backendResponse = await fetch(
      `${backendUrl}/api/calendar/update-lead`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });

  } catch (error) {
    console.error('Update lead proxy error:', error);
    return NextResponse.json(
      { error: 'Lead update failed' },
      { status: 500 }
    );
  }
}
