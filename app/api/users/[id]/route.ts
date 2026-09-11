import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  canActAs,
  signToken,
  authCookieOptions,
  TOKEN_COOKIE,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
  type SessionUser,
} from '@/lib/auth';
import { cleanString, cleanText, cleanUrl, isValidEmail, cleanYearsOfExperience } from '@/lib/validation';
import { queueProfileEmbedding } from '@/lib/ai/embeddings';

/**
 * Seniority labels the matcher understands. A value outside this set scores as
 * "unknown" and quietly flattens every match, so it is dropped rather than
 * stored. Mirrors the list `/api/ai/resume` extracts against.
 */
const SENIORITY_LEVELS = [
  'Intern',
  'Entry',
  'Junior',
  'Mid',
  'Senior',
  'Lead',
  'Staff',
  'Principal',
  'Director',
] as const;

function cleanSeniority(value: unknown): string | null {
  const raw = cleanString(value, 40);
  if (!raw) return null;
  return SENIORITY_LEVELS.find((level) => level.toLowerCase() === raw.toLowerCase()) ?? null;
}

function cleanSkillTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    const tag = cleanString(entry, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 25) break;
  }

  return tags;
}

/**
 * Full record for the owner (or an admin); a minimal public card for everybody
 * else, so browsing a profile can't leak an email address or a phone-book of
 * accounts. The password hash is never included either way.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('That user id is not valid');

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!user) return notFound('We could not find that account');

    if (!canActAs(session, id)) {
      return NextResponse.json({
        id: user.id,
        name: user.name,
        company: user.company,
      });
    }

    const { password: _password, ...safeUser } = user;
    return NextResponse.json(safeUser);
  } catch (error) {
    console.error('GET /api/users/[id] failed:', error);
    return serverError('We could not load that profile. Please try again.');
  }
}

/**
 * Updates a profile. Only the owner or an admin may call it, and only the
 * fields below are writable — `role`, `companyId` and `password` are not, so a
 * profile save can never escalate an account.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('That user id is not valid');
  if (!canActAs(session, id)) return forbidden('You can only update your own profile');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const name = cleanString(body.name, 100);
  if (!name) return badRequest('Name is required');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return badRequest('Please enter a valid email address');

  // Name and email are required by the validation above, so they are always
  // written. Everything else is presence-gated.
  const data: Prisma.UserUpdateInput = { name, email };

  /*
   * These six were written unconditionally, and that destroyed data.
   *
   * The company profile editor seeds its form from the Redux `user`, which on a
   * cold load is rehydrated from the JWT — and the JWT carries only id, name,
   * email, role and company. Website, industry, size, location, description and
   * profile therefore seeded as empty strings, and submitting the form sent
   * those empty strings, and this handler wrote every one of them. An employer
   * who filled in their profile, came back the next day and corrected a typo in
   * their company name had all six columns nulled — while the page reported
   * "Company profile updated".
   *
   * Presence-gating them is the fix that holds regardless of which client is
   * calling: an absent key now means "leave alone", exactly as it already did
   * for the AI-derived fields below. A caller that genuinely wants to clear one
   * still can, by sending it explicitly as an empty string.
   */
  if ('profile' in body) data.profile = cleanText(body.profile, 2000);
  // Run links through `cleanUrl` so a profile can never store `javascript:`.
  if ('website' in body) data.website = cleanUrl(body.website);
  if ('industry' in body) data.industry = cleanString(body.industry, 100);
  if ('size' in body) data.size = cleanString(body.size, 50);
  if ('location' in body) data.location = cleanString(body.location, 100);
  if ('description' in body) data.description = cleanText(body.description, 5000);

  // The AI-derived fields are only touched when the caller actually sends them.
  // The general profile form does not, and an absent key must not wipe what
  // `/api/ai/resume` extracted from the seeker's CV.
  if ('headline' in body) data.headline = cleanString(body.headline, 140);
  if ('skills' in body) data.skills = cleanSkillTags(body.skills);
  if ('seniority' in body) data.seniority = cleanSeniority(body.seniority);
  if ('yearsOfExp' in body) data.yearsOfExp = cleanYearsOfExperience(body.yearsOfExp);

  try {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { role: true, companyId: true },
    });
    if (!existing) return notFound('We could not find that account');

    const emailTaken = await prisma.user.findFirst({
      where: { email, id: { not: id } },
      select: { id: true },
    });
    if (emailTaken) return badRequest('That email address is already in use');

    // A company account's display name lives in two places. Keeping only
    // `User.name` in sync left every job card showing the old employer name.
    const updated = await prisma.$transaction(async (tx) => {
      if (existing.role === 'COMPANY' && existing.companyId) {
        await tx.company.update({ where: { id: existing.companyId }, data: { name } });
      }
      return tx.user.update({
        where: { id },
        data,
        include: { company: { select: { id: true, name: true } } },
      });
    });

    // Anything on this row can feed the profile document, so refresh the
    // vector. Fire-and-forget: a profile save must never wait on Gemini.
    queueProfileEmbedding(id);

    const { password: _password, ...safeUser } = updated;

    // The JWT carries `name`/`companyName`, so without re-issuing it the stale
    // cookie overwrites the fresh Redux state on the next load and the edit
    // looks like it silently reverted. Only refresh the caller's own session:
    // an admin editing someone else must not be handed their token.
    let token: string | null = null;
    if (session.id === id) {
      const sessionUser: SessionUser = {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role as SessionUser['role'],
        companyId: updated.companyId,
        companyName: updated.company?.name ?? null,
      };
      token = signToken(sessionUser);
    }

    const response = NextResponse.json({ ...safeUser, token });
    if (token) response.cookies.set(TOKEN_COOKIE, token, authCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return badRequest('That email address is already in use');
      if (error.code === 'P2025') return notFound('We could not find that account');
    }
    console.error('PUT /api/users/[id] failed:', error);
    return serverError('We could not save your profile. Please try again.');
  }
}

/** Owner or admin. Applications, resumes and messages cascade with the row. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('That user id is not valid');
  if (!canActAs(session, id)) return forbidden('You can only delete your own account');

  try {
    await prisma.user.delete({ where: { id } });

    const response = NextResponse.json({ message: 'Account deleted' });
    // Deleting yourself ends the session; clear the cookie so the client isn't
    // left holding a token for a user that no longer exists.
    if (session.id === id) {
      response.cookies.set(TOKEN_COOKIE, '', { ...authCookieOptions(), maxAge: 0 });
    }
    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound('We could not find that account');
    }
    console.error('DELETE /api/users/[id] failed:', error);
    return serverError('We could not delete the account. Please try again.');
  }
}
