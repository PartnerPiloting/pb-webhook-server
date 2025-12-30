import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend API for calendar chat
// All Gemini/AI logic is centralized on the backend (Render)

export async function POST(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    // Get backend URL
    const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server-staging.onrender.com';

    // Forward request to backend
    const response = await fetch(`${backendUrl}/api/calendar/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('Chat proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}
