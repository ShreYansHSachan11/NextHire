import { NextRequest, NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import {
  signToken,
  getSession,
  authCookieOptions,
  TOKEN_COOKIE,
  badRequest,
  serverError,
  type SessionUser,
} from '@/lib/auth';
import { isValidEmail, validatePassword, cleanString } from '@/lib/validation';

/** Returns the current session, or 401. Used by the client to re-check auth. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const action = body.action;
  if (action === 'register') return register(body);
  if (action === 'login') return login(body);
  if (action === 'logout') return logout();
  return badRequest('Unknown action');
}

async function register(body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = cleanString(body.name, 100);
  const password = body.password;

  if (!isValidEmail(email)) return badRequest('Please enter a valid email address');
  if (!name) return badRequest('Name is required');

  const passwordError = validatePassword(password);
  if (passwordError) return badRequest(passwordError);

  // Only SEEKER and COMPANY can be self-assigned; ADMIN must be granted directly
  // in the database. Previously any caller could register themselves as ADMIN.
  const role = body.role === 'COMPANY' ? 'COMPANY' : 'SEEKER';

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password as string, 12);

    // A company account owns a Company record; create both atomically so we can
    // never end up with a COMPANY user that has no company to post jobs under.
    const user = await prisma.$transaction(async (tx) => {
      const company =
        role === 'COMPANY'
          ? await tx.company.create({ data: { name, profile: null } })
          : null;

      return tx.user.create({
        data: {
          email,
          password: hashed,
          name,
          role,
          companyId: company?.id ?? null,
        },
        include: { company: true },
      });
    });

    return respondWithSession(user, 'Account created', 201);
  } catch (error) {
    console.error('POST /api/auth register failed:', error);
    return serverError('We could not create your account. Please try again.');
  }
}

async function login(body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) return badRequest('Email and password are required');

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    // Same message and roughly the same work either way, so the response doesn't
    // reveal whether an account exists.
    const hash = user?.password || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !user.password || !valid) {
      return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 });
    }

    return respondWithSession(user, 'Signed in');
  } catch (error) {
    console.error('POST /api/auth login failed:', error);
    return serverError('We could not sign you in. Please try again.');
  }
}

function logout() {
  const response = NextResponse.json({ message: 'Signed out' });
  response.cookies.set(TOKEN_COOKIE, '', { ...authCookieOptions(), maxAge: 0 });
  return response;
}

type UserWithCompany = {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string | null;
  company: { id: string; name: string } | null;
};

/** Issues the JWT, sets the cookie, and returns the safe user shape. */
function respondWithSession(user: UserWithCompany, message: string, status = 200) {
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser['role'],
    companyId: user.companyId,
    companyName: user.company?.name ?? null,
  };

  const token = signToken(sessionUser);

  const response = NextResponse.json(
    {
      message,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        company: user.company ? { name: user.company.name } : undefined,
      },
    },
    { status }
  );

  response.cookies.set(TOKEN_COOKIE, token, authCookieOptions());
  return response;
}
