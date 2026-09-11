import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  requireRole,
  canActAs,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';
import { cleanString, isJobType } from '@/lib/validation';

/**
 * One saved search: read it, edit it, delete it.
 *
 * Ownership is loaded from the row and compared against the session on every
 * verb. The id in the path is the only thing the client contributes, and it is
 * never enough on its own — a search belonging to someone else answers 403,
 * and a `userId` in the body is not read at all.
 *
 * The sanitising rules are repeated from `../route.ts` rather than shared: a
 * Next.js route module may only export route handlers, so the alternative is a
 * fourth file. `/api/users/[id]` and `/api/ai/resume` duplicate their seniority
 * cleaner for the same reason.
 */

const NAME_MAX = 60;
const QUERY_MAX = 200;
const LOCATION_MAX = 80;

const ALERT_FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;
type AlertFrequencyValue = (typeof ALERT_FREQUENCIES)[number];

const SEARCH_SELECT = {
  id: true,
  name: true,
  query: true,
  filters: true,
  frequency: true,
  lastNotifiedAt: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function prismaErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function isAlertFrequency(value: unknown): value is AlertFrequencyValue {
  return typeof value === 'string' && (ALERT_FREQUENCIES as readonly string[]).includes(value);
}

interface SavedSearchFilters {
  remote?: boolean;
  type?: string;
  location?: string;
}

/** The same short allowlist the create route applies. */
function cleanFilters(value: unknown): SavedSearchFilters | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const filters: SavedSearchFilters = {};

  if (source.remote === true) filters.remote = true;
  if (isJobType(source.type)) filters.type = source.type;

  const location = cleanString(source.location, LOCATION_MAX);
  if (location) filters.location = location;

  return Object.keys(filters).length > 0 ? filters : null;
}

/**
 * Loads the row's owner so the handler can check it. Returns the id only —
 * there is nothing else a caller who fails the check is entitled to know.
 */
async function loadOwner(id: string): Promise<{ userId: string } | null> {
  return prisma.savedSearch.findUnique({ where: { id }, select: { userId: true } });
}

/** GET /api/saved-searches/:id — the owner's own row. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('Invalid saved search id');

  try {
    const existing = await loadOwner(id);
    if (!existing) return notFound('That saved search could not be found');
    if (!canActAs(session, existing.userId)) {
      return forbidden('You can only view your own saved searches');
    }

    const search = await prisma.savedSearch.findUnique({ where: { id }, select: SEARCH_SELECT });
    if (!search) return notFound('That saved search could not be found');

    return NextResponse.json(search);
  } catch (error) {
    console.error('GET /api/saved-searches/[id] failed:', error);
    return serverError('Could not load that saved search');
  }
}

/**
 * PATCH /api/saved-searches/:id — rename, re-word, re-schedule.
 *
 * Every field is optional and only present keys are written, so the frequency
 * dropdown can save on its own without the name field having to send a value
 * back that it may not have loaded.
 *
 * The watermark fields are deliberately not writable. They are the alert
 * runner's bookkeeping; letting a client move `lastNotifiedAt` backwards would
 * replay every posting in the window as a fresh notification.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('Invalid saved search id');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const data: Prisma.SavedSearchUpdateInput = {};

  if (body.name !== undefined) {
    const name = cleanString(body.name, NAME_MAX);
    if (!name) return badRequest('Give this search a name');
    data.name = name;
  }

  if (body.query !== undefined) {
    const query = cleanString(body.query, QUERY_MAX);
    if (!query) return badRequest('A saved search needs something to search for');
    if (query.length < 2) return badRequest('That search is too short to match anything');
    data.query = query;
  }

  if (body.frequency !== undefined) {
    if (!isAlertFrequency(body.frequency)) return badRequest('Choose a valid alert frequency');
    data.frequency = body.frequency;
  }

  if (body.filters !== undefined) {
    // `DbNull` and not `undefined`: sending `filters: null` has to be able to
    // clear them, and `undefined` would mean "leave alone" to Prisma.
    const cleaned = cleanFilters(body.filters);
    // Cast through InputJsonValue: a structured interface is not assignable to
    // Prisma Json input, which requires an index signature.
    data.filters = cleaned ? (cleaned as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) return badRequest('Nothing to update');

  try {
    const existing = await loadOwner(id);
    if (!existing) return notFound('That saved search could not be found');
    if (!canActAs(session, existing.userId)) {
      return forbidden('You can only edit your own saved searches');
    }

    const search = await prisma.savedSearch.update({
      where: { id },
      data,
      select: SEARCH_SELECT,
    });

    return NextResponse.json(search);
  } catch (error) {
    if (prismaErrorCode(error) === 'P2002') {
      return NextResponse.json(
        { error: 'You already have a saved search with that name' },
        { status: 409 }
      );
    }
    if (prismaErrorCode(error) === 'P2025') {
      // Deleted between the ownership read and the update.
      return notFound('That saved search could not be found');
    }

    console.error('PATCH /api/saved-searches/[id] failed:', error);
    return serverError('Could not update that saved search');
  }
}

/** DELETE /api/saved-searches/:id — the owner's own row only. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('Invalid saved search id');

  try {
    const existing = await loadOwner(id);
    if (!existing) return notFound('That saved search could not be found');
    if (!canActAs(session, existing.userId)) {
      return forbidden('You can only delete your own saved searches');
    }

    await prisma.savedSearch.delete({ where: { id } });

    return NextResponse.json({ message: 'Saved search deleted' });
  } catch (error) {
    if (prismaErrorCode(error) === 'P2025') {
      return notFound('That saved search could not be found');
    }

    console.error('DELETE /api/saved-searches/[id] failed:', error);
    return serverError('Could not delete that saved search');
  }
}
