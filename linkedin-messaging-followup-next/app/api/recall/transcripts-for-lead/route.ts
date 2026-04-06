import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function webhookServerBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const stripped = envUrl.replace(/\/api\/linkedin\/?$/i, '').replace(/\/$/, '');
  if (stripped) return stripped;
  return 'https://pb-webhook-server.onrender.com';
}

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
    if (portalToken) headers['x-portal-token'] = portalToken;
    const devKey = request.headers.get('x-dev-key');
    if (devKey) headers['x-dev-key'] = devKey;

    const backendUrl = webhookServerBase();
    const targetUrl = `${backendUrl}/api/linkedin/recall-transcripts-for-lead?leadId=${encodeURIComponent(leadId)}`;

    const backendResponse = await fetch(targetUrl, { headers, cache: 'no-store' });
    const data = await backendResponse.json();
    return NextResponse.json(data, {
      status: backendResponse.status,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' },
    });
  } catch (error) {
    console.error('Recall transcripts proxy error:', error);
    return NextResponse.json({ error: 'Recall transcripts request failed' }, { status: 500 });
  }
}
