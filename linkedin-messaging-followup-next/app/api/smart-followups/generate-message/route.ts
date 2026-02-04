import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend API for smart follow-up message generation
// Matches the pattern used by calendar-chat which works correctly

export async function POST(request: Request) {
  try {
    // Get auth headers from the request
    const clientId = request.headers.get('x-client-id');
    const portalToken = request.headers.get('x-portal-token');
    const devKey = request.headers.get('x-dev-key');
    
    if (!clientId && !portalToken) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    // Get backend URL - same logic as calendar-chat
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const targetUrl = `${backendUrl}/api/linkedin/leads/generate-followup-message`;
    
    console.log(`[Smart Follow-ups Proxy] Calling: ${targetUrl}`);

    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (clientId) headers['x-client-id'] = clientId;
    if (portalToken) headers['x-portal-token'] = portalToken;
    if (devKey) headers['x-dev-key'] = devKey;

    // Forward request to backend
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
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
