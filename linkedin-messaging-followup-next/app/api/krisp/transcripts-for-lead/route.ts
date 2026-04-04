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
 * Proxies to pb-webhook-server with PB_WEBHOOK_SECRET (server-only).
 * Browser sends x-client-id (portal session) — same pattern as calendar lookup.
 */
export async function GET(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId?.trim()) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const secret = process.env.PB_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return NextResponse.json(
        { error: 'Krisp transcripts proxy not configured (set PB_WEBHOOK_SECRET on Vercel).' },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('leadId')?.trim();
    if (!leadId) {
      return NextResponse.json({ error: 'leadId query required' }, { status: 400 });
    }

    const backendUrl = webhookServerBase();
    const backendResponse = await fetch(
      `${backendUrl}/webhooks/krisp/transcripts-for-lead?leadId=${encodeURIComponent(leadId)}`,
      {
        headers: {
          Authorization: `Bearer ${secret}`,
        },
        cache: 'no-store',
      },
    );

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
