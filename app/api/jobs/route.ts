import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getSession,
  requireCompany,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';
import { cleanString, cleanText, cleanTagList, isJobType, JOB_TYPES } from '@/lib/validation';
import {
  loadProfileContext,
  rankJobs,
  type ProfileVectorContext,
} from '@/lib/ai/matching';
import {
  hybridJobSearch,
  parseQuery,
  type HybridSearchResult,
  type SearchFilterChip,
} from '@/lib/ai/search';
import { queueJobEmbedding } from '@/lib/ai/embeddings';

/** Public feed columns. Deliberately no `embedding` — see FEED_INCLUDE_WITH_VECTOR. */
const FEED_INCLUDE = {
  company: { select: { id: true, name: true, profile: true } },
  _count: { select: { applications: true } },
} as const;

/**
 * The same feed plus the job vector. Only used when a seeker is signed in: the
 * vector is 768 floats per row, so shipping it for anonymous visitors would cost
 * megabytes of query traffic for data nobody scores against.
 */
const FEED_INCLUDE_WITH_VECTOR = {
  ...FEED_INCLUDE,
  embedding: { select: { vector: true } },
} as const;

type FeedJob = Prisma.JobGetPayload<{ include: typeof FEED_INCLUDE }> & {
  /** Loaded for seekers only, and never serialised — see `withoutVector`. */
  embedding?: { vector: number[] } | null;
};

/** How many jobs the semantic pass may return before match scoring. */
const SEMANTIC_LIMIT = 60;
/** Cap on the plain (non-semantic) listing, unchanged from before. */
const FEED_LIMIT = 200;

/**
 * Drops the embedding relation. Every response path goes through this: a raw
 * vector is useless to the client and expensive to send.
 */
function withoutVector<T extends { embedding?: unknown }>(job: T): Omit<T, 'embedding'> {
  const { embedding: _embedding, ...rest } = job;
  return rest;
}

/* -------------------------------------------------------------------------- */
/* Feed filters                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The three selects on the feed's filter bar.
 *
 * They used to be applied in the browser, over whatever `FEED_LIMIT` rows had
 * already come back: a Berlin role at position 201 was invisible no matter what
 * was selected, and quietly more invisible the larger the corpus grew. They are
 * `where` clauses now, applied *before* `take`.
 */
interface FeedFilters {
  location: string | null;
  experience: string | null;
  type: string | null;
}

/** Length caps, matching what `POST /api/jobs` will store in each column. */
const FILTER_MAX = { location: 120, experience: 60, type: 60 } as const;

/** What `readFilter` returns for a value longer than its column allows. */
const TOO_LONG = Symbol('too-long');

/**
 * Reads one select off the query string.
 *
 * The vocabulary is deliberately *not* checked against a fixed list. The options
 * come from `facets` below, which are the corpus's own distinct values, so an
 * allowlist here would be a second copy of the same truth and free to drift from
 * it — and `type` is only an allowlist today because the post-a-job form happens
 * to enforce one. A value nobody could have picked simply matches nothing, which
 * is the honest answer rather than an error. What *is* validated is the shape: a
 * value longer than the column is a malformed request, and saying so costs less
 * than a table scan proving the result is empty.
 */
function readFilter(raw: string | null, max: number): string | null | typeof TOO_LONG {
  if (raw === null) return null;
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) return null;
  if (value.length > max) return TOO_LONG;
  return value;
}

/**
 * Exact equality, case-insensitively; `null` means "any".
 *
 * Exact rather than `contains`, because the value came out of a facet and is
 * therefore a value the corpus actually holds. A substring test would quietly
 * make "Berlin" also mean "Berlin, Germany" — a different option, with a
 * different count, that the dropdown offered separately.
 */
function equalsFilter(value: string | null): Prisma.StringNullableFilter | undefined {
  return value ? { equals: value, mode: 'insensitive' } : undefined;
}

/** The selects as `where` clauses. `undefined` is "no clause" to Prisma — which
 *  is what an unset select means; `null` would mean "the column is null". */
function filterWhere(filters: FeedFilters): Prisma.JobWhereInput {
  return {
    location: equalsFilter(filters.location),
    experience: equalsFilter(filters.experience),
    type: equalsFilter(filters.type),
  };
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                      */
/* -------------------------------------------------------------------------- */

interface Facet {
  value: string;
  count: number;
}

interface FeedFacets {
  location: Facet[];
  experience: Facet[];
  type: Facet[];
  /** Active postings in total, ignoring every filter — the feed's denominator. */
  total: number;
}

/** Cap on how many options one select may offer. */
const FACET_LIMIT = 200;

/**
 * Collapses a `groupBy` result into display options.
 *
 * Postings spell a location every way a free-text box allows, so rows are folded
 * case-insensitively and their counts summed. The spelling shown is the most
 * common one (alphabetically first on a tie) rather than whichever row Postgres
 * returned first, so the label is stable between requests.
 */
function foldFacet(
  rows: ReadonlyArray<{ value: string | null; count: number }>,
  compare: (a: Facet, b: Facet) => number = (a, b) => a.value.localeCompare(b.value)
): Facet[] {
  const folded = new Map<string, { value: string; count: number; best: number }>();

  for (const row of rows) {
    const value = row.value?.trim();
    // A null or blank column is "unstated", not an option to offer.
    if (!value) continue;

    const key = value.toLowerCase();
    const entry = folded.get(key);
    if (!entry) {
      folded.set(key, { value, count: row.count, best: row.count });
      continue;
    }

    entry.count += row.count;
    if (row.count > entry.best || (row.count === entry.best && value.localeCompare(entry.value) < 0)) {
      entry.value = value;
      entry.best = row.count;
    }
  }

  // Trimmed by popularity, then ordered for reading: a corpus with thousands of
  // distinct free-text locations must not ship a thousand-option select, and the
  // options worth keeping are the ones people actually posted.
  return [...folded.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, FACET_LIMIT)
    .map(({ value, count }) => ({ value, count }))
    .sort(compare);
}

/** Known employment types keep the canonical order; free text follows them. */
function byJobTypeOrder(a: Facet, b: Facet): number {
  const rank = (value: string) => {
    const index = (JOB_TYPES as readonly string[]).findIndex(
      (known) => known.toLowerCase() === value.toLowerCase()
    );
    return index === -1 ? JOB_TYPES.length : index;
  };
  return rank(a.value) - rank(b.value) || a.value.localeCompare(b.value);
}

/**
 * The options for the three selects, with counts, over the whole active corpus.
 *
 * Three deliberate decisions about *what each count counts*:
 *
 * - **After the other two selects.** Drill-down semantics: a count answers the
 *   question the user is about to ask — "how many roles do I get if I pick
 *   this" — so no listed option can lead to an empty result.
 * - **Never after its own select.** Choosing Berlin must not collapse the
 *   Location list to Berlin alone; the list is also the way back out to Munich.
 * - **Never after `?q=`.** Deriving the options from the result set is the bug
 *   this replaces: searching "frontend" narrowed the Location dropdown to the
 *   few locations among the hits, exactly when the user most needs the others
 *   offered. A query is a relevance ranking; a select is a fact about a posting.
 *   The facets describe the filterable corpus, and the UI says so, so the count
 *   in brackets is not read as the hit count.
 */
async function computeFacets(filters: FeedFilters): Promise<FeedFacets> {
  const active: Prisma.JobWhereInput = { isActive: true };

  const [locations, experiences, types, total] = await Promise.all([
    prisma.job.groupBy({
      by: ['location'],
      where: { ...active, ...filterWhere({ ...filters, location: null }) },
      _count: { _all: true },
    }),
    prisma.job.groupBy({
      by: ['experience'],
      where: { ...active, ...filterWhere({ ...filters, experience: null }) },
      _count: { _all: true },
    }),
    prisma.job.groupBy({
      by: ['type'],
      where: { ...active, ...filterWhere({ ...filters, type: null }) },
      _count: { _all: true },
    }),
    // Unfiltered on purpose: this is the denominator ("12 of 340 open roles")
    // and the one number that tells an empty feed apart from an empty filter.
    prisma.job.count({ where: active }),
  ]);

  return {
    location: foldFacet(locations.map((row) => ({ value: row.location, count: row._count._all }))),
    experience: foldFacet(
      experiences.map((row) => ({ value: row.experience, count: row._count._all }))
    ),
    type: foldFacet(
      types.map((row) => ({ value: row.type, count: row._count._all })),
      byJobTypeOrder
    ),
    total,
  };
}

/**
 * Facet bundles, cached in process.
 *
 * The aggregate is cheap — three `GROUP BY`s and a `COUNT` over one boolean —
 * but it would otherwise be paid on every feed load and on every debounced
 * keystroke of a search, for an answer that only changes when a posting is
 * created, closed or edited. A short TTL makes it roughly one aggregate a minute
 * per instance, and the unfiltered bundle (far and away the commonest key) stays
 * hot.
 *
 * The staleness that buys is bounded and harmless: the *listing* is never
 * cached, so the rows are always live, and it is only ever the number in
 * brackets that can be a minute old. The cache is per-process, like
 * `getActiveJobVectors`, so a new instance simply computes its own.
 */
const FACET_TTL_MS = 60_000;
/** Room for the unfiltered bundle plus the common drill-downs. */
const FACET_CACHE_MAX = 32;

const facetCache = new Map<string, { at: number; facets: FeedFacets }>();

async function loadFacets(filters: FeedFilters): Promise<FeedFacets> {
  // JSON rather than a delimiter join: with no separator to choose, no filter
  // value can contain one and collide with a different combination. Lowercased
  // because the `where` clauses themselves are case-insensitive.
  const key = JSON.stringify(
    [filters.location, filters.experience, filters.type].map((value) => (value ?? '').toLowerCase())
  );

  const cached = facetCache.get(key);
  if (cached && Date.now() - cached.at < FACET_TTL_MS) return cached.facets;

  const facets = await computeFacets(filters);

  // A Map iterates in insertion order, so the first key is the oldest one; the
  // re-insert is what keeps a refreshed entry from counting as old.
  facetCache.delete(key);
  if (facetCache.size >= FACET_CACHE_MAX) {
    const oldest = facetCache.keys().next().value;
    if (oldest !== undefined) facetCache.delete(oldest);
  }
  facetCache.set(key, { at: Date.now(), facets });

  return facets;
}

/* -------------------------------------------------------------------------- */
/* Inferred filters vs explicit selects                                        */
/* -------------------------------------------------------------------------- */

/**
 * Which inferred filters an explicit select overrules.
 *
 * `parseQuery` reads filters out of the query text — an employment type today, a
 * location as of a parallel change — and `hybridJobSearch` applies them as SQL
 * predicates against the same corpus the selects filter. A select set to
 * something else is then a straight contradiction: "berlin frontend" with
 * Location = Munich asks for both and gets nothing, from two filters neither of
 * which the user can see is fighting the other.
 *
 * **The explicit select wins.** It is the one the user set deliberately, in a
 * control they are looking at and can change; the inferred one is a reading of
 * prose. So the chip's span is cut out of the query before the search runs — the
 * same mechanism the chips' own remove button uses — and the dropped chip comes
 * back in `overridden`, so the UI can say what happened instead of silently
 * discarding half of what was typed.
 *
 * `remote` counts as a location claim, and is overruled by the Location select
 * for the same reason `lib/ai/search.ts` reads "remote" as a location rather
 * than an employment type in the first place: postings express it as one. A
 * Location of Berlin against an inferred remote-only predicate is the same
 * contradiction as Berlin against Munich, and resolving it the same way keeps
 * one rule instead of two.
 *
 * `seniority` is deliberately not here: it is not the Experience column. A
 * "Senior" chip and an Experience of "5-7 years" are two compatible facts about
 * a posting, and conjoining them is exactly what was asked for. Nor is
 * `minSalary`, which no select competes with at all.
 */
const OVERRIDABLE_CHIPS: ReadonlyArray<{ chip: string; select: keyof FeedFilters }> = [
  { chip: 'location', select: 'location' },
  { chip: 'remote', select: 'location' },
  { chip: 'type', select: 'type' },
];

/**
 * Cuts the spans of specific chips out of the query text.
 *
 * Mirrors `queryWithoutToken` in `app/jobs/page.tsx`, and for the same reason:
 * every chip claims its span first and only the targets' are then removed, so a
 * word that occurs twice is cut where the parser actually matched it rather than
 * at its first literal occurrence.
 */
function withoutChipTokens(
  query: string,
  chips: SearchFilterChip[],
  targets: ReadonlySet<number>
): string {
  const haystack = query.toLowerCase();
  const claimed = new Array<boolean>(query.length).fill(false);
  const cuts: { start: number; end: number }[] = [];

  for (let index = 0; index < chips.length; index++) {
    const needle = chips[index].token.toLowerCase();
    if (!needle) continue;

    for (let from = 0; from + needle.length <= haystack.length; ) {
      const start = haystack.indexOf(needle, from);
      if (start === -1) break;
      const end = start + needle.length;

      // Owned by an earlier chip already; look further along rather than
      // claiming the same characters twice.
      if (claimed.slice(start, end).some(Boolean)) {
        from = start + 1;
        continue;
      }

      for (let i = start; i < end; i++) claimed[i] = true;
      if (targets.has(index)) cuts.push({ start, end });
      break;
    }
  }

  // Back to front, so an earlier cut cannot move a later one's offsets.
  let text = query;
  for (const cut of cuts.sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, cut.start)} ${text.slice(cut.end)}`;
  }

  // The same tidy-up `tidyRemainder` applies server-side and `tidyQuery` applies
  // in the client, so cutting "remote" out of "remote, senior Go" leaves
  // "senior Go" and not ", senior Go".
  return text
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)[-–—,;:/&+]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The query to actually search with, plus the inferred filters that lost. */
function applyOverrides(
  query: string,
  filters: FeedFilters
): { query: string; overridden: SearchFilterChip[] } {
  const unchanged = { query, overridden: [] };
  if (!query) return unchanged;

  const contested = OVERRIDABLE_CHIPS.filter(({ select }) => filters[select]);
  if (contested.length === 0) return unchanged;

  // The same parser `hybridJobSearch` runs internally, so this says what the
  // query is about to filter on before it does.
  const { chips } = parseQuery(query);

  const targets = new Set<number>();
  for (let index = 0; index < chips.length; index++) {
    // `FilterKey` has no `location` member until the parser change lands, so the
    // comparison goes through a widened local: this file then compiles on either
    // side of that change rather than erroring on whichever version it meets.
    const key: string = chips[index].key;
    if (contested.some((entry) => entry.chip === key)) targets.add(index);
  }

  if (targets.size === 0) return unchanged;

  return {
    // If a token somehow is not found in the text it was parsed from, the cut is
    // a no-op and the inferred filter stands alongside the select — narrower
    // than intended, never wrong, and not reachable from a query we parsed
    // ourselves a line ago.
    query: withoutChipTokens(query, chips, targets),
    overridden: [...targets].map((index) => chips[index]),
  };
}

/**
 * GET /api/jobs
 *   ?companyId=…  jobs for one company, with applicant details (owner/admin only)
 *   ?q=…          hybrid search over active jobs (lexical + vector, fused by
 *                 rank; degrades to lexical-only when AI is off)
 *   ?location=…   exact (case-insensitive) match on the posting's location
 *   ?experience=… exact (case-insensitive) match on the experience column
 *   ?type=…       exact (case-insensitive) match on the employment type
 *   ?sort=match   order by match score, for a signed-in seeker
 *   ?meta=1       return an envelope — jobs, how the query was read (semantic,
 *                 chips, mode, query), what was filtered on (filters,
 *                 overridden), and the filter bar's options (facets, truncated)
 *                 — instead of a bare array
 *   (no params)   the public feed of active jobs
 *
 * The default response is still a **bare array** of jobs: the existing feed and
 * dashboard clients index straight into it, and changing that shape silently
 * would break them. The envelope is opt-in via `?meta=1`; `match` and
 * `relevance` ride along as properties on each job either way, so a client can
 * adopt them without adopting the envelope.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');

    if (companyId) {
      if (!isUuid(companyId)) return badRequest('Invalid company id');

      // Applicant names, emails and resumes are only for the company that owns
      // the jobs — this used to be readable by anyone who guessed an id.
      const session = getSession(req);
      if (!session) {
        return NextResponse.json({ error: 'You must be signed in to do that' }, { status: 401 });
      }
      if (session.role !== 'ADMIN' && session.companyId !== companyId) {
        return forbidden('You can only view your own company’s jobs');
      }

      const jobs = await prisma.job.findMany({
        where: { companyId },
        include: {
          company: { select: { id: true, name: true, profile: true } },
          applications: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  resumes: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { id: true, url: true, fileName: true, createdAt: true },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json(jobs);
    }

    const session = getSession(req);
    const isSeeker = session?.role === 'SEEKER';
    // Whitespace is collapsed, not merely trimmed, so that the chip tokens
    // `parseQuery` hands back are exact spans of the string that is searched —
    // which is what makes an override below an exact cut rather than a guess.
    const query = (searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
    const wantsMeta = searchParams.get('meta') === '1';
    const sortByMatch = searchParams.get('sort') === 'match';

    const location = readFilter(searchParams.get('location'), FILTER_MAX.location);
    const experience = readFilter(searchParams.get('experience'), FILTER_MAX.experience);
    const type = readFilter(searchParams.get('type'), FILTER_MAX.type);
    if (location === TOO_LONG || experience === TOO_LONG || type === TOO_LONG) {
      return badRequest('That filter value is too long');
    }
    const filters: FeedFilters = { location, experience, type };

    // An explicit select beats the same filter inferred from the query text; see
    // `OVERRIDABLE_CHIPS` for why, and what comes back to the UI as a result.
    const { query: searchQuery, overridden } = applyOverrides(query, filters);

    // Hybrid search is best-effort: a model outage must degrade the feed to a
    // plain listing, never fail it. `hybridJobSearch` already falls back to its
    // lexical arm when the vector arm is unavailable, so reaching the catch here
    // means something worse than "AI is off" went wrong.
    let search: HybridSearchResult | null = null;
    if (searchQuery) {
      try {
        search = await hybridJobSearch(searchQuery, { limit: SEMANTIC_LIMIT });
      } catch (searchError) {
        console.error('GET /api/jobs hybrid search failed:', searchError);
        search = null;
      }
    }

    const hits = search?.hits ?? null;

    // `null` means AI is off; an empty array means nothing cleared the relevance
    // floor. Both fall back to the full listing for the client to keyword-filter.
    const semanticHits = hits && hits.length > 0 ? hits : null;
    const semantic = semanticHits !== null;

    const relevanceById = new Map<string, number>(
      semanticHits?.map((hit) => [hit.jobId, hit.relevance] as const) ?? []
    );

    /*
     * The selects are `where` clauses, so they narrow the corpus *before*
     * `take` rather than trimming the page after it — the whole point of the
     * change. Under a semantic search they intersect the hit set: a select is a
     * fact about a posting and must still apply, but it can only ever remove
     * rows. The relevance order of whatever survives is untouched and is
     * re-applied below, so filtering never silently reorders the ranking.
     */
    const where: Prisma.JobWhereInput = {
      isActive: true,
      ...filterWhere(filters),
      ...(semanticHits ? { id: { in: semanticHits.map((hit) => hit.jobId) } } : {}),
    };

    // Public feed: active jobs only, with application counts rather than rows.
    const rowsPromise: Promise<FeedJob[]> = isSeeker
      ? prisma.job.findMany({
          where,
          include: FEED_INCLUDE_WITH_VECTOR,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        })
      : prisma.job.findMany({
          where,
          include: FEED_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        });

    // Facets are for the filter bar, which only the envelope clients render, so
    // a bare-array caller never pays for them. They do not depend on the
    // listing, so the two queries go out together.
    const [rows, facets] = await Promise.all([
      rowsPromise,
      wantsMeta ? loadFacets(filters) : Promise.resolve(null),
    ]);

    // One profile load for the whole page, not one per job.
    let profile: ProfileVectorContext | null = null;
    if (isSeeker && session) {
      try {
        profile = await loadProfileContext(session.id);
      } catch (profileError) {
        console.error('GET /api/jobs profile context failed:', profileError);
      }
    }

    const ranked = rankJobs(profile, rows);

    if (sortByMatch && profile?.vector?.length) {
      // Jobs with no vector yet have no score; they sort to the end rather than
      // to the top, which is what `?? -1` buys over `?? 0`.
      ranked.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
    } else if (semantic) {
      // A Prisma `IN` returns rows in storage order, so the relevance ranking has
      // to be re-applied here.
      ranked.sort(
        (a, b) => (relevanceById.get(b.job.id) ?? 0) - (relevanceById.get(a.job.id) ?? 0)
      );
    }

    const payload = ranked.map(({ job, match }) => ({
      ...withoutVector(job),
      match,
      relevance: relevanceById.get(job.id) ?? null,
    }));

    if (wantsMeta) {
      // Non-null whenever `wantsMeta` is; the `??` is a type guard that never
      // runs rather than a non-null assertion that would stop being true
      // silently if the promise above ever grew another branch.
      const bundle = facets ?? (await loadFacets(filters));

      return NextResponse.json({
        jobs: payload,
        semantic,
        matched: !!profile?.vector?.length,
        // What the query was understood to mean. Returned so the UI can show the
        // interpretation back to the user as removable chips — a search that
        // silently applies filters it inferred is worse than one that shows its
        // working.
        chips: search?.chips ?? [],
        mode: search?.mode ?? null,
        // What was actually filtered on, normalised. The client seeds its
        // selects from the URL, so it needs to know what the server made of the
        // values it sent rather than assuming they arrived intact.
        filters,
        // The text actually searched, once overridden filters were cut out of
        // it. The client keyword-filters with this rather than with what is in
        // the box: when a select overrules "internship", the word is no longer
        // part of the question, and testing for it would empty the list the
        // override just went to the trouble of filling.
        query: searchQuery,
        // Options for the three selects, over the corpus rather than the page.
        facets: bundle,
        // Inferred filters an explicit select overruled, so the UI can say so.
        overridden,
        // The listing is capped at `FEED_LIMIT`; filtering now happens before
        // that cap, but a filter matching more than the cap still only shows its
        // newest page. Saying so beats a silently short list.
        truncated: payload.length >= FEED_LIMIT,
      });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('GET /api/jobs failed:', error);
    return serverError('Could not load jobs');
  }
}

/** POST /api/jobs — create a job for the signed-in company. */
export async function POST(req: NextRequest) {
  const guard = requireCompany(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const title = cleanString(body.title, 150);
  const description = cleanText(body.description, 10_000);

  if (!title) return badRequest('Job title is required');
  if (!description) return badRequest('Job description is required');
  if (body.type !== undefined && body.type !== '' && !isJobType(body.type)) {
    return badRequest('Please choose a valid job type');
  }

  // The company always comes from the session — never from the request body,
  // which previously let anyone post jobs under someone else's company.
  const companyId = session.companyId!;

  try {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return notFound('Your company record could not be found');

    const job = await prisma.job.create({
      data: {
        title,
        description,
        salary: cleanString(body.salary, 100),
        experience: cleanString(body.experience, 60),
        location: cleanString(body.location, 120),
        type: isJobType(body.type) ? body.type : null,
        // Skills are both displayed as chips and used as one facet of the match
        // score, so they are cleaned the same way every other tag list is.
        skills: cleanTagList(body.skills),
        companyId,
        isActive: body.isActive === false ? false : true,
      },
      include: { company: { select: { id: true, name: true, profile: true } } },
    });

    // Fire-and-forget: a posting must go live even if Gemini is down or slow.
    queueJobEmbedding(job.id);

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs failed:', error);
    return serverError('Could not create the job posting');
  }
}
