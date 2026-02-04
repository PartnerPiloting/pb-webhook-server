import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend API for smart follow-up message generation
// Matches the pattern used by calendar-chat which works correctly

export async function POST(request: Request) {
  try {
    // Get client ID from header (same pattern as calendar-chat)
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    // Get backend URL - same logic as calendar-chat
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    // Use the new endpoint in apiAndJobRoutes.js (same file as calendar-chat, no auth middleware)
    const targetUrl = `${backendUrl}/api/smart-followups/generate-message`;
    
    console.log(`[Smart Follow-ups Proxy] Calling: ${targetUrl}`);

    // Forward request to backend (same pattern as calendar-chat - just x-client-id)
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
    
    console.log(`[Smart Follow-ups Proxy] Response status: ${response.status}`);

    if (!response.ok) {
      console.error(`[Smart Follow-ups Proxy] Error:`, data);
      return NextResponse.json({ 
        ...data, 
        _debug: { targetUrl, status: response.status } 
      }, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[Smart Follow-ups Proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate message', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
