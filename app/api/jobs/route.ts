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
import { cleanString, cleanText, cleanTagList, isJobType } from '@/lib/validation';
import {
  loadProfileContext,
  rankJobs,
  semanticJobSearch,
  type SemanticHit,
  type ProfileVectorContext,
} from '@/lib/ai/matching';
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

/**
 * GET /api/jobs
 *   ?companyId=…  jobs for one company, with applicant details (owner/admin only)
 *   ?q=…          semantic search over active jobs (falls back to the full
 *                 listing when AI is off, so the client can keyword-filter)
 *   ?sort=match   order by match score, for a signed-in seeker
 *   ?meta=1       return { jobs, semantic, matched } instead of a bare array
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
    const query = searchParams.get('q')?.trim() ?? '';
    const wantsMeta = searchParams.get('meta') === '1';
    const sortByMatch = searchParams.get('sort') === 'match';

    // Semantic search is best-effort: a model outage must degrade the feed to a
    // plain listing, never fail it.
    let hits: SemanticHit[] | null = null;
    if (query) {
      try {
        hits = await semanticJobSearch(query, { limit: SEMANTIC_LIMIT });
      } catch (searchError) {
        console.error('GET /api/jobs semantic search failed:', searchError);
        hits = null;
      }
    }

    // `null` means AI is off; an empty array means nothing cleared the relevance
    // floor. Both fall back to the full listing for the client to keyword-filter.
    const semanticHits = hits && hits.length > 0 ? hits : null;
    const semantic = semanticHits !== null;

    const relevanceById = new Map<string, number>(
      semanticHits?.map((hit) => [hit.jobId, hit.relevance] as const) ?? []
    );

    const where: Prisma.JobWhereInput = semanticHits
      ? { id: { in: semanticHits.map((hit) => hit.jobId) }, isActive: true }
      : { isActive: true };

    // Public feed: active jobs only, with application counts rather than rows.
    const rows: FeedJob[] = isSeeker
      ? await prisma.job.findMany({
          where,
          include: FEED_INCLUDE_WITH_VECTOR,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        })
      : await prisma.job.findMany({
          where,
          include: FEED_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: FEED_LIMIT,
        });

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
      return NextResponse.json({
        jobs: payload,
        semantic,
        matched: !!profile?.vector?.length,
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
