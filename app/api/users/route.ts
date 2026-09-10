import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, badRequest, notFound, serverError, canActAs, isUuid } from '@/lib/auth';

/**
 * Returns the signed-in user's own profile. `?id=` is accepted for backwards
 * compatibility but ignored unless it is the caller (or the caller is an admin).
 *
 * `POST`, `PUT` and `DELETE` used to live here with no authentication at all —
 * anyone could mint an ADMIN with a plaintext password, or edit and delete any
 * account by id. Registration now lives in `/api/auth` and profile updates in
 * `/api/users/[id]`, both of which check the session.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const requestedId = new URL(req.url).searchParams.get('id');
  if (requestedId && !isUuid(requestedId)) return badRequest('That user id is not valid');

  const userId = requestedId && canActAs(session, requestedId) ? requestedId : session.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { company: true },
    });

    if (!user) return notFound('We could not find that account');

    // Never let the password hash out, even to its owner.
    const { password: _password, ...safeUser } = user;
    return NextResponse.json(safeUser);
  } catch (error) {
    console.error('GET /api/users failed:', error);
    return serverError('We could not load your profile. Please try again.');
  }
}
