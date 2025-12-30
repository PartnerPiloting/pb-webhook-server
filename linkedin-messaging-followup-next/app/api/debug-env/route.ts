import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    hasClientId: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientIdLength: process.env.GOOGLE_OAUTH_CLIENT_ID?.length || 0,
    clientIdPreview: process.env.GOOGLE_OAUTH_CLIENT_ID?.substring(0, 20) + '...',
    hasClientSecret: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    secretLength: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.length || 0,
    secretPreview: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.substring(0, 15) + '...',
  });
}
