import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import * as jwt from 'jsonwebtoken';

export async function GET(req: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.redirect(new URL('/auth/login?error=google_failed', req.url));
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { company: true },
  });

  if (!dbUser) {
    return NextResponse.redirect(new URL('/auth/login?error=user_not_found', req.url));
  }

  // Issue your app JWT
  const token = jwt.sign(
    {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      companyId: dbUser.companyId,
      name: dbUser.name,
      companyName: dbUser.company?.name ?? null,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  // Encode user + token for the client to pick up
  const userData = encodeURIComponent(
    JSON.stringify({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        companyId: dbUser.companyId,
        company: dbUser.company,
      },
      token,
    })
  );

  const destination = dbUser.role === 'COMPANY' ? '/company/dashboard' : '/seeker/dashboard';

  const response = NextResponse.redirect(new URL(`${destination}?googleAuth=${userData}`, req.url));

  // Set the token cookie
  response.cookies.set('token', token, {
    httpOnly: false, // needs to be readable by client JS for Redux rehydration
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
  });

  return response;
}
