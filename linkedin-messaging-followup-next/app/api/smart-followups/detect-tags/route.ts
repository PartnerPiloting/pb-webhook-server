import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend API for AI tag detection
// Matches the pattern used by generate-message

export async function POST(request: Request) {
  try {
    // Get client ID from header
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    // Get backend URL
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const targetUrl = `${backendUrl}/api/smart-followups/detect-tags`;
    
    console.log(`[Tag Detection Proxy] Calling: ${targetUrl}`);

    // Forward request to backend
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
    
    console.log(`[Tag Detection Proxy] Response status: ${response.status}`);

    if (!response.ok) {
      console.error(`[Tag Detection Proxy] Error:`, data);
      return NextResponse.json({ 
        ...data, 
        _debug: { targetUrl, status: response.status } 
      }, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[Tag Detection Proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to detect tags', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
