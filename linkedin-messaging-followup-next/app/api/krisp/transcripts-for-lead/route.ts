import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function webhookServerBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const stripped = envUrl.replace(/\/api\/linkedin\/?$/i, '').replace(/\/$/, '');
  if (stripped) return stripped;
  return 'https://pb-webhook-server.onrender.com';
}

/**
 * GET /api/krisp/transcripts-for-lead?leadId=rec…
 * Proxies to Render /api/linkedin/krisp-transcripts-for-lead with the same headers as the portal
 * (x-client-id, x-portal-token, x-dev-key) — same pattern as smart-followups / calendar proxies.
 */
export async function GET(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId?.trim()) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('leadId')?.trim();
    if (!leadId) {
      return NextResponse.json({ error: 'leadId query required' }, { status: 400 });
    }

    const headers: Record<string, string> = {
      'x-client-id': clientId.trim(),
    };
    const portalToken = request.headers.get('x-portal-token');
    if (portalToken) {
      headers['x-portal-token'] = portalToken;
    }
    const devKey = request.headers.get('x-dev-key');
    if (devKey) {
      headers['x-dev-key'] = devKey;
    }

    const backendUrl = webhookServerBase();
    const targetUrl = `${backendUrl}/api/linkedin/krisp-transcripts-for-lead?leadId=${encodeURIComponent(leadId)}`;

    const backendResponse = await fetch(targetUrl, {
      headers,
      cache: 'no-store',
    });

    const data = await backendResponse.json();
    return NextResponse.json(data, {
      status: backendResponse.status,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    console.error('Krisp transcripts proxy error:', error);
    return NextResponse.json({ error: 'Krisp transcripts request failed' }, { status: 500 });
  }
}
