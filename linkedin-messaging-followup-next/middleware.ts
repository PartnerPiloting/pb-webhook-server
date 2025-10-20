import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for membership gating
 * Runs on Vercel Edge before any page loads
 * Checks for clientId parameter and redirects if missing
 */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
  // Allow access to the membership-required page and static assets
  if (
    pathname === '/membership-required' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }
  
  // Check for clientId or testClient parameter
  const clientId = searchParams.get('clientId') || searchParams.get('testClient');
  
  // If no clientId, redirect to membership-required page
  if (!clientId) {
    const url = request.nextUrl.clone();
    url.pathname = '/membership-required';
    return NextResponse.redirect(url);
  }
  
  // Client ID exists, allow access
  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
