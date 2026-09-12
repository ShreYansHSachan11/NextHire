import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, serverError } from '@/lib/auth';
import { cleanText, isJobType } from '@/lib/validation';
import { hybridJobSearch, type HybridHit } from '@/lib/ai/search';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';

/**
 * POST /api/alerts/run — deliver job alerts for every saved search that is due.
 *
 * **Auth model.** ADMIN only, because this is a scheduled job trigger and not a
 * user action: it writes notifications to accounts other than the caller's, so
 * it is held to the highest role the portal has. There is no cron in this
 * project and no scheduler primitive on the deployment target, so it is
 * designed to be called from *outside* — a platform cron, a CI schedule, an
 * uptime pinger — presenting an ADMIN session token in the `Authorization`
 * header, exactly as a signed-in admin would:
 *
 *     curl -X POST https://…/api/alerts/run -H "Authorization: Bearer $ADMIN_TOKEN"
 *
 * Deliberately *not* a bespoke `x-cron-secret` header. That would be a second
 * authentication path with its own rotation story and its own way of leaking,
 * for a route that already has one. Running more often than any search is due
 * is harmless — due-ness is decided per row, below.
 *
 * The run is bounded at every level (searches per run, jobs scanned per search,
 * notifications per search) so a backlog costs several short runs rather than
 * one that never finishes.
 */

// Embeds a query per search and writes in transactions; not an edge workload.
export const runtime = 'nodejs';
export const maxDuration = 60;

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** Searches processed per run. The rest wait for the next one, oldest first. */
const MAX_SEARCHES_PER_RUN = 25;

/** Postings examined per search before the run defers the remainder. */
const MAX_JOBS_PER_SEARCH = 100;

/** Notifications one search may raise in one run. A bell with forty new rows in
 *  it is not an alert, it is a mailing list. */
const MAX_NOTIFICATIONS_PER_SEARCH = 5;

/**
 * How far back a first run — or one resuming after a long pause — may reach.
 *
 * Without this, switching a search from OFF back to DAILY after two months
 * would replay two months of postings into the bell in one go.
 */
const MAX_LOOKBACK_DAYS = 14;

/**
 * How far behind "now" the window is allowed to end. See the watermark note.
 *
 * `Job.createdAt` is stamped when the INSERT runs, but the row only becomes
 * visible when its transaction commits. A window that ends at `now` can
 * therefore miss a row whose timestamp is already inside it, and advancing the
 * watermark past that timestamp would lose the posting permanently. Ending the
 * window a minute in the past means any write that was in flight has long since
 * committed and become visible before its timestamp enters a window.
 */
const WATERMARK_LAG_MS = 60_000;

/**
 * Slack on the due check, so a scheduler that fires at 09:00 every day is not
 * turned away at 08:59:58 and pushed a whole day late by clock drift.
 */
const DUE_SLACK_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Relevance floor for the semantic pass. Higher than the feed's: an alert the
 *  user did not ask to read has to earn the interruption. */
const MIN_RELEVANCE = 45;

/** Fraction of a query's words a posting must contain in the keyword fallback. */
const KEYWORD_MATCH_RATIO = 0.6;

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

interface SavedSearchFilters {
  remote?: boolean;
  type?: string;
  location?: string;
}

/** Re-validated on read: the column is JSON that a client once supplied. */
function readFilters(value: Prisma.JsonValue | null): SavedSearchFilters {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const filters: SavedSearchFilters = {};

  if (source.remote === true) filters.remote = true;
  if (isJobType(source.type)) filters.type = source.type;
  if (typeof source.location === 'string' && source.location.trim()) {
    filters.location = source.location.trim().slice(0, 80);
  }

  return filters;
}

const REMOTE_CLAUSE: Prisma.JobWhereInput = {
  OR: [{ type: 'Remote' }, { location: { contains: 'remote', mode: 'insensitive' } }],
};

/** Turns the stored filters into `where` clauses, so they cost nothing extra. */
function filterClauses(filters: SavedSearchFilters): Prisma.JobWhereInput[] {
  const clauses: Prisma.JobWhereInput[] = [];

  if (filters.type) clauses.push({ type: filters.type });
  if (filters.location) {
    clauses.push({ location: { contains: filters.location, mode: 'insensitive' } });
  }
  if (filters.remote) clauses.push(REMOTE_CLAUSE);

  return clauses;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

const JOB_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  description: true,
  skills: true,
  location: true,
  type: true,
  company: { select: { name: true } },
} as const;

type CandidateJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'job',
  'jobs', 'of', 'on', 'or', 'role', 'roles', 'that', 'the', 'to', 'with', 'work',
]);

/** Meaningful words of a query, capped so a pasted paragraph cannot match everything. */
function keywordTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    )
  ).slice(0, 8);
}

/**
 * The no-API-key path.
 *
 * Requires most of the query's words rather than any one of them: for a feed
 * the user is reading, a loose match costs a scroll, but for an alert it costs
 * an unwanted interruption, so this leans on precision.
 */
function matchesKeywords(job: CandidateJob, tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const haystack = [
    job.title,
    job.skills.join(' '),
    job.location ?? '',
    job.type ?? '',
    job.company?.name ?? '',
    // Enough of the body to be representative without scanning a whole advert.
    job.description.slice(0, 2000),
  ]
    .join(' ')
    .toLowerCase();

  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length >= KEYWORD_MATCH_RATIO;
}

/* -------------------------------------------------------------------------- */
/* Watermark bookkeeping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Takes at most `limit` rows from a list already sorted by `createdAt` ascending,
 * never splitting a group of rows that share a timestamp.
 *
 * This is what makes a partial batch resumable. The watermark is a `createdAt`
 * compared with `>`, so if a cut landed in the middle of two postings stamped
 * the same millisecond, advancing to that timestamp would step over the second
 * one for ever. Cutting strictly below the first excluded timestamp guarantees
 * that everything sharing the watermark's timestamp has already been handled.
 */
function completePrefix<T extends { createdAt: Date }>(
  rows: T[],
  limit: number
): { taken: T[]; complete: boolean } {
  if (rows.length <= limit) return { taken: rows, complete: true };

  const boundary = rows[limit].createdAt.getTime();
  return {
    taken: rows.slice(0, limit).filter((row) => row.createdAt.getTime() < boundary),
    complete: false,
  };
}

interface SearchOutcome {
  id: string;
  name: string;
  notified: number;
  scanned: number;
  /** True when the whole window was processed and the watermark reached its end. */
  drained: boolean;
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  // A single run fans out over every due saved search, runs each one's query
  // against the corpus and writes a notification per hit — by far the largest
  // unit of work any one request in this app can ask for. It is meant to be
  // called by a scheduler on a daily or weekly cadence, so two an hour is
  // generous for its actual use and a hard stop for a retry loop that has got
  // stuck. The watermark makes a repeat run cheap but not free.
  const budget = checkRateLimit(req, RATE_TIERS.ADMIN_BULK, guard.session);
  if (!budget.ok) return rateLimited(budget);

  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() - WATERMARK_LAG_MS);
    const floor = new Date(now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS);

    const dailyDueBefore = new Date(now.getTime() - DAY_MS + DUE_SLACK_MS);
    const weeklyDueBefore = new Date(now.getTime() - 7 * DAY_MS + DUE_SLACK_MS);

    const due = await prisma.savedSearch.findMany({
      where: {
        // OFF means never, and it is checked here rather than after the work so
        // a paused search costs nothing at all.
        frequency: { not: 'OFF' },
        OR: [
          { lastRunAt: null },
          { frequency: 'DAILY', lastRunAt: { lte: dailyDueBefore } },
          { frequency: 'WEEKLY', lastRunAt: { lte: weeklyDueBefore } },
        ],
      },
      select: {
        id: true,
        userId: true,
        name: true,
        query: true,
        filters: true,
        lastNotifiedAt: true,
      },
      // Longest-waiting first, so that when there are more due searches than one
      // run can take, the backlog drains in order instead of starving the tail.
      orderBy: [{ lastRunAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: MAX_SEARCHES_PER_RUN,
    });

    const outcomes: SearchOutcome[] = [];
    let notified = 0;
    let stalled = 0;

    /**
     * Jobs already announced to a user in *this* run, so two of their searches
     * both matching one posting produce one bell entry rather than two. Each
     * search still advances its own watermark past the job, so the suppressed
     * one does not re-announce it tomorrow: the guarantee is one notification
     * per user per posting, not one per search.
     */
    const announced = new Set<string>();

    for (const search of due) {
      // A search that has never alerted, or has been paused for months, starts
      // at the lookback floor rather than at the beginning of time.
      const previous = search.lastNotifiedAt;
      const since = previous && previous > floor ? previous : floor;

      if (since >= windowEnd) {
        // Nothing can be in the window. Still record the run so the scheduler
        // does not keep re-picking this row.
        await prisma.savedSearch.update({
          where: { id: search.id },
          data: { lastRunAt: now },
        });
        outcomes.push({ id: search.id, name: search.name, notified: 0, scanned: 0, drained: true });
        continue;
      }

      const clauses = filterClauses(readFilters(search.filters));

      // One row past the cap, purely as a "there is more" probe — see
      // `completePrefix`. Ascending, because the batch has to be a prefix of the
      // window for a partial run to be resumable from its last timestamp.
      const fetched = await prisma.job.findMany({
        where: {
          isActive: true,
          createdAt: { gt: since, lte: windowEnd },
          // No point alerting someone about a role they have already applied to.
          applications: { none: { userId: search.userId } },
          ...(clauses.length ? { AND: clauses } : {}),
        },
        select: JOB_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: MAX_JOBS_PER_SEARCH + 1,
      });

      const scanned = completePrefix(fetched, MAX_JOBS_PER_SEARCH);

      // The same retrieval the feed uses, so an alert fires on what the seeker
      // would actually have seen. `hybridJobSearch` degrades internally to its
      // lexical arm when the model is unavailable, which matters more here than
      // on the feed: a keyless deployment that silently stopped firing prose
      // alerts would look like nothing was ever posted.
      //
      // `null` still means "switched off or unusable query", not "nothing
      // matched", so the in-memory keyword pass below remains the last resort.
      let hits: HybridHit[] | null = null;
      try {
        const result = await hybridJobSearch(search.query, {
          limit: 500,
          minRelevance: MIN_RELEVANCE,
        });
        hits = result?.hits ?? null;
      } catch (searchError) {
        console.error(`alerts/run hybrid search failed for ${search.id}:`, searchError);
      }

      let matched: CandidateJob[];
      if (hits) {
        // Intersected with the window rather than trusted for ordering: the
        // semantic pass ranks the whole corpus, and we only want what is new.
        const relevant = new Set(hits.map((hit) => hit.jobId));
        matched = scanned.taken.filter((job) => relevant.has(job.id));
      } else {
        const tokens = keywordTokens(search.query);
        matched = scanned.taken.filter((job) => matchesKeywords(job, tokens));
      }

      const chosen = completePrefix(matched, MAX_NOTIFICATIONS_PER_SEARCH);

      /*
       * Where the watermark lands.
       *
       * It only ever moves to a point everything before which is genuinely
       * finished:
       *
       *  - capped on notifications  → the last posting we actually notified about;
       *  - capped on the window scan → the last posting we actually examined;
       *  - neither                   → the end of the window itself.
       *
       * Ordering is ascending throughout, so "everything before" is a real
       * prefix, and `completePrefix` guarantees the cut never lands inside a
       * group of postings sharing one timestamp.
       */
      let watermark: Date | null;
      if (!chosen.complete) {
        watermark = chosen.taken[chosen.taken.length - 1]?.createdAt ?? null;
      } else if (!scanned.complete) {
        watermark = scanned.taken[scanned.taken.length - 1]?.createdAt ?? null;
      } else {
        watermark = windowEnd;
      }

      if (watermark === null) {
        // Only reachable if a whole cap's worth of postings share one timestamp.
        // Leaving the watermark alone re-reads the same window next time, which
        // loses nothing; advancing it would silently drop postings.
        stalled += 1;
        console.warn(
          `alerts/run: saved search ${search.id} could not advance its watermark — ` +
            `more than ${MAX_NOTIFICATIONS_PER_SEARCH} postings share one timestamp`
        );
      }

      const rows = chosen.taken
        .filter((job) => !announced.has(`${search.userId}:${job.id}`))
        .map((job) => ({
          userId: search.userId,
          content:
            cleanText(
              `New match for “${search.name}”: ${job.title}${
                job.company?.name ? ` at ${job.company.name}` : ''
              }`,
              500
            ) ?? job.title,
          link: `/jobs/${job.id}`,
        }));

      /*
       * The notifications and the watermark move in one transaction, and that is
       * the whole double-notify story.
       *
       * Written separately, a crash between them leaves either postings
       * announced with the watermark still behind them — every one of them
       * announced again on the next run — or a watermark past postings nobody
       * was told about. Committed together, a failure rolls both back: the next
       * run re-reads exactly the same window and does exactly the same work.
       * Each search commits on its own, so a failure on the seventh does not
       * undo the six before it.
       */
      try {
        await prisma.$transaction([
          prisma.notification.createMany({ data: rows }),
          prisma.savedSearch.update({
            where: { id: search.id },
            data: {
              lastRunAt: now,
              // `undefined` leaves the column alone — the stalled case above.
              ...(watermark ? { lastNotifiedAt: watermark } : {}),
            },
          }),
        ]);
      } catch (writeError) {
        // Nothing was written, including `lastRunAt`, so this search is simply
        // still due. Better a retry than a search that quietly stops alerting.
        console.error(`alerts/run write failed for saved search ${search.id}:`, writeError);
        outcomes.push({
          id: search.id,
          name: search.name,
          notified: 0,
          scanned: scanned.taken.length,
          drained: false,
        });
        continue;
      }

      for (const job of chosen.taken) announced.add(`${search.userId}:${job.id}`);
      notified += rows.length;

      outcomes.push({
        id: search.id,
        name: search.name,
        notified: rows.length,
        scanned: scanned.taken.length,
        drained: chosen.complete && scanned.complete,
      });
    }

    return NextResponse.json({
      ranAt: now.toISOString(),
      searches: due.length,
      notified,
      stalled,
      /** True when at least one search still has window left — call again. */
      more: outcomes.some((outcome) => !outcome.drained) || due.length === MAX_SEARCHES_PER_RUN,
      outcomes,
    });
  } catch (error) {
    console.error('POST /api/alerts/run failed:', error);
    return serverError('Could not run job alerts');
  }
}
