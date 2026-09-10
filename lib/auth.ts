import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { env } from './env';

export const TOKEN_COOKIE = 'token';
export const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches the JWT lifetime

export type Role = 'SEEKER' | 'COMPANY' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
  companyName: string | null;
}

/** Everything we put in the JWT. Keep this in sync with `AuthRehydrator`. */
export function signToken(user: SessionUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      companyName: user.companyName,
    },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Reads the session token from the `Authorization: Bearer` header, falling back
 * to the cookie. Returns null for anything that doesn't verify.
 */
export function getSession(req: NextRequest): SessionUser | null {
  const header = req.headers.get('authorization');
  const token = header?.startsWith('Bearer ')
    ? header.slice(7)
    : req.cookies.get(TOKEN_COOKIE)?.value;

  if (!token) return null;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;
    if (typeof decoded.id !== 'string' || typeof decoded.role !== 'string') return null;

    return {
      id: decoded.id,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      name: typeof decoded.name === 'string' ? decoded.name : '',
      role: decoded.role as Role,
      companyId: typeof decoded.companyId === 'string' ? decoded.companyId : null,
      companyName: typeof decoded.companyName === 'string' ? decoded.companyName : null,
    };
  } catch {
    return null;
  }
}

/** Standard error bodies so the client always gets the same shape. */
export function unauthorized(message = 'You must be signed in to do that') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "You don't have permission to do that") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message = 'Something went wrong. Please try again.') {
  return NextResponse.json({ error: message }, { status: 500 });
}

type Guard<T> = { session: SessionUser; response?: never } | { session?: never; response: T };

/** Requires any signed-in user. */
export function requireAuth(req: NextRequest): Guard<NextResponse> {
  const session = getSession(req);
  if (!session) return { response: unauthorized() };
  return { session };
}

/** Requires a signed-in user holding one of `roles`. ADMIN always passes. */
export function requireRole(req: NextRequest, ...roles: Role[]): Guard<NextResponse> {
  const session = getSession(req);
  if (!session) return { response: unauthorized() };
  if (session.role !== 'ADMIN' && !roles.includes(session.role)) {
    return { response: forbidden(`This action is only available to ${roles.join(' or ')} accounts`) };
  }
  return { session };
}

/** Requires a COMPANY account that actually has a company attached. */
export function requireCompany(req: NextRequest): Guard<NextResponse> {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard;
  if (!guard.session.companyId && guard.session.role !== 'ADMIN') {
    return {
      response: badRequest(
        'Your account is not linked to a company yet. Sign out and back in, or contact support.'
      ),
    };
  }
  return guard;
}

/** True when the session may act on behalf of `userId`. */
export function canActAs(session: SessionUser, userId: string): boolean {
  return session.id === userId || session.role === 'ADMIN';
}

/** Cookie options used everywhere the auth cookie is written from the server. */
export function authCookieOptions() {
  return {
    // Deliberately readable by JS: the Redux store rehydrates from this cookie.
    httpOnly: false,
    path: '/',
    maxAge: TOKEN_MAX_AGE_SECONDS,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** UUID v4 shape check used by routes that take ids from the client. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
