import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy to backend API for batch tagging leads
// This can take a while, so we set a longer timeout

export async function POST(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();

    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    const backendUrl = envUrl.replace('/api/linkedin', '') || 'https://pb-webhook-server.onrender.com';
    const targetUrl = `${backendUrl}/api/smart-followups/batch-tag-leads`;
    
    console.log(`[Batch Tag Proxy] Calling: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    console.log(`[Batch Tag Proxy] Response status: ${response.status}`);

    // Handle non-JSON responses gracefully
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[Batch Tag Proxy] Non-JSON response:`, responseText.slice(0, 200));
      return NextResponse.json({ 
        error: 'Backend returned non-JSON response', 
        details: responseText.slice(0, 200),
        _debug: { targetUrl, status: response.status } 
      }, { status: 500 });
    }

    if (!response.ok) {
      console.error(`[Batch Tag Proxy] Error:`, data);
      return NextResponse.json({ 
        ...data, 
        _debug: { targetUrl, status: response.status } 
      }, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[Batch Tag Proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to batch tag leads', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
