import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge guard for protected pages.
 *
 * Purely a routing convenience: it stops a signed-out visitor from seeing a
 * protected page flash before the client-side guard redirects. It deliberately
 * does NOT verify the JWT signature — `jsonwebtoken` can't run on the edge
 * runtime — so it must never be the only thing standing between a request and
 * data. Every API route independently verifies the token via `lib/auth.ts`,
 * and that is where the real authorization lives.
 */

const SEEKER_ONLY = ['/seeker'];
const COMPANY_ONLY = ['/company', '/applications', '/conversations', '/jobs/post'];

const PROTECTED = [...SEEKER_ONLY, ...COMPANY_ONLY];

function decodePayload(token: string): { role?: string; exp?: number } | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    // `atob` exists on the edge runtime; Buffer does not.
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // `/jobs/[jobId]/edit` is company-only, but `/jobs` and `/jobs/[jobId]` are public.
  const isJobEdit = /^\/jobs\/[^/]+\/edit\/?$/.test(pathname);
  const needsAuth = isJobEdit || PROTECTED.some((prefix) => pathname.startsWith(prefix));
  if (!needsAuth) return NextResponse.next();

  const token = req.cookies.get('token')?.value;
  const payload = token ? decodePayload(token) : null;
  const expired = payload?.exp ? payload.exp * 1000 < Date.now() : false;

  if (!token || !payload || expired) {
    const login = new URL('/auth/login', req.url);
    login.searchParams.set('next', pathname);
    const response = NextResponse.redirect(login);
    if (token) response.cookies.delete('token');
    return response;
  }

  const role = payload.role;
  if (role === 'ADMIN') return NextResponse.next();

  const wantsCompany = isJobEdit || COMPANY_ONLY.some((prefix) => pathname.startsWith(prefix));
  const wantsSeeker = SEEKER_ONLY.some((prefix) => pathname.startsWith(prefix));

  // Signed in but on the wrong side of the app: send them to their own home
  // rather than to a login page they don't need.
  if (wantsCompany && role !== 'COMPANY') {
    return NextResponse.redirect(new URL('/seeker/dashboard', req.url));
  }
  if (wantsSeeker && role !== 'SEEKER') {
    return NextResponse.redirect(new URL('/company/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/seeker/:path*',
    '/company/:path*',
    '/applications/:path*',
    '/conversations/:path*',
    '/jobs/post',
    '/jobs/:jobId/edit',
  ],
};
