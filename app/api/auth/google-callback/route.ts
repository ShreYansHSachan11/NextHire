import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { signToken, authCookieOptions, TOKEN_COOKIE, type SessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lands here after a successful Google sign-in, swaps the NextAuth session for
 * the app's own JWT cookie, and sends the user to their dashboard.
 *
 * `getServerSession()` is called without options on purpose: Next 15 rejects any
 * export from a route file other than the handlers, so `authOptions` cannot be
 * shared out of `[...nextauth]/route.ts`. Reading the default session is enough
 * here — all we need from it is the verified email address.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/auth/login?error=google_failed', req.url));
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!dbUser) {
      return NextResponse.redirect(new URL('/auth/login?error=user_not_found', req.url));
    }

    const sessionUser: SessionUser = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role as SessionUser['role'],
      companyId: dbUser.companyId,
      companyName: dbUser.company?.name ?? null,
    };

    const token = signToken(sessionUser);
    const destination = dbUser.role === 'COMPANY' ? '/company/dashboard' : '/seeker/dashboard';

    // The token used to be appended as `?googleAuth=<encoded JSON>`, which put a
    // signed credential into browser history, referrer headers and access logs.
    // The cookie below is all the client needs to rehydrate.
    const response = NextResponse.redirect(new URL(destination, req.url));
    response.cookies.set(TOKEN_COOKIE, token, authCookieOptions());
    return response;
  } catch (error) {
    console.error('GET /api/auth/google-callback failed:', error);
    return NextResponse.redirect(new URL('/auth/login?error=google_failed', req.url));
  }
}
