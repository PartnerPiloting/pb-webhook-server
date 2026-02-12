import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend: AI reviews instructions before save

export async function POST(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const targetUrl = `${backendUrl}/api/smart-followups/review-instructions`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Smart Follow-ups Review] Error:', error);
    return NextResponse.json(
      { error: 'Failed to review instructions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
