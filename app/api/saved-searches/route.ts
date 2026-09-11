import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, serverError } from '@/lib/auth';
import { cleanString, isJobType } from '@/lib/validation';

/**
 * Saved searches — a stored query plus how often the owner wants to hear about
 * new postings that fit it.
 *
 * Nothing here touches the model. A saved search is a name, a string and a
 * frequency; `/api/alerts/run` is where AI enters, and even there it degrades to
 * a keyword pass. Saving, editing and deleting a search work identically with no
 * `GEMINI_API_KEY` set, which is the point — this is the one seeker feature that
 * must not quietly stop existing when a key expires.
 */

/**
 * Per-user ceiling.
 *
 * Every saved search is work the alert runner does on a schedule for as long as
 * it exists — a semantic pass over the new-postings window, per search, per run.
 * Twenty is well past what anyone manages by hand and keeps one account from
 * turning a scheduled job into an unbounded one. It is also the honest limit to
 * expose: silently ignoring searches past some hidden number would be worse.
 */
const MAX_SAVED_SEARCHES = 20;

const NAME_MAX = 60;
const QUERY_MAX = 200;
const LOCATION_MAX = 80;

const ALERT_FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;
type AlertFrequencyValue = (typeof ALERT_FREQUENCIES)[number];

/** Everything the alerts page needs. No user id — the caller is the owner. */
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

/**
 * Prisma tags its known request errors with a string `code`. Reading it this way
 * keeps the catch blocks free of `any` while still letting us map P2002 (the
 * unique constraint on `(userId, name)`) onto a 409 rather than a 500.
 */
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

/**
 * The structured half of a saved search.
 *
 * Deliberately a short allowlist, and deliberately only fields the alert runner
 * actually applies: a filter we store but never enforce is a promise the alert
 * quietly breaks, and the user has no way to see that it did. Anything else in
 * the object is dropped rather than persisted — this column is client-supplied
 * JSON, so it is exactly where unvalidated data would otherwise accumulate.
 */
interface SavedSearchFilters {
  remote?: boolean;
  type?: string;
  location?: string;
}

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

/** GET /api/saved-searches — the caller's own searches, newest first. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const searches = await prisma.savedSearch.findMany({
      // Scoped to the session, never to a `?userId=` — the same mistake the
      // notifications route had to be fixed for.
      where: { userId: session.id },
      select: SEARCH_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_SAVED_SEARCHES,
    });

    return NextResponse.json({ searches, limit: MAX_SAVED_SEARCHES });
  } catch (error) {
    console.error('GET /api/saved-searches failed:', error);
    return serverError('Could not load your saved searches');
  }
}

/** POST /api/saved-searches — save a query under a name. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const name = cleanString(body.name, NAME_MAX);
  if (!name) return badRequest('Give this search a name');

  const query = cleanString(body.query, QUERY_MAX);
  if (!query) return badRequest('A saved search needs something to search for');
  if (query.length < 2) return badRequest('That search is too short to match anything');

  const frequency: AlertFrequencyValue = isAlertFrequency(body.frequency) ? body.frequency : 'DAILY';
  const filters = cleanFilters(body.filters);

  try {
    const existing = await prisma.savedSearch.count({ where: { userId: session.id } });
    if (existing >= MAX_SAVED_SEARCHES) {
      return NextResponse.json(
        {
          error: `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one to add another.`,
        },
        { status: 409 }
      );
    }

    const search = await prisma.savedSearch.create({
      data: {
        // From the session, never from the body: ownership is not something the
        // client gets to assert.
        userId: session.id,
        name,
        query,
        frequency,
        // Cast through InputJsonValue: a structured interface is not assignable
        // to Prisma Json input, which requires an index signature. The shape is
        // validated by cleanFilters above, so this is narrowing, not trust.
        filters: filters ? (filters as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      select: SEARCH_SELECT,
    });

    return NextResponse.json(search, { status: 201 });
  } catch (error) {
    // `@@unique([userId, name])` turns a repeated name — or a double-submit —
    // into P2002. That is a naming collision the user can fix, not a fault.
    if (prismaErrorCode(error) === 'P2002') {
      return NextResponse.json(
        { error: 'You already have a saved search with that name' },
        { status: 409 }
      );
    }

    console.error('POST /api/saved-searches failed:', error);
    return serverError('Could not save that search');
  }
}
