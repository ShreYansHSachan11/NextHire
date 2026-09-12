import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, serverError } from '@/lib/auth';
import { isAiEnabled } from '@/lib/ai/config';
import { loadProfileContext, rankJobsAsync, type MatchBreakdown } from '@/lib/ai/matching';

/**
 * GET /api/jobs/recommended — "roles matched to you", for the seeker dashboard.
 *
 * This is a read of the profile vector built elsewhere, so it has three normal
 * empty states that are all 200s rather than errors: AI is switched off, the
 * seeker has not been indexed yet, or nothing cleared the score floor. `reason`
 * tells the UI which prompt to show.
 */

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

/**
 * Ranking happens in Node, so the candidate set is capped. Newest-first means a
 * seeker sees current openings; scoring the entire corpus to surface six cards
 * is not worth the query.
 */
const CANDIDATE_LIMIT = 300;

/** Below this the recommendation is noise — better to show fewer cards. */
const MIN_SCORE = 40;

const RECOMMENDED_INCLUDE = {
  company: { select: { id: true, name: true } },
  _count: { select: { applications: true } },
  embedding: { select: { vector: true } },
} as const;

type RecommendedJob = Prisma.JobGetPayload<{ include: typeof RECOMMENDED_INCLUDE }>;

/** The vector is loaded to score against and is never serialised. */
function withoutVector<T extends { embedding?: unknown }>(job: T): Omit<T, 'embedding'> {
  const { embedding: _embedding, ...rest } = job;
  return rest;
}

function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

export async function GET(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  // With no API key there are no fresh vectors to trust, so the panel hides
  // itself rather than showing a stale or empty list with no explanation.
  if (!isAiEnabled()) {
    return NextResponse.json({ jobs: [], reason: 'disabled' });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get('limit'));
    // Excluding applied jobs is the default; `?excludeApplied=0` opts out.
    const excludeApplied = searchParams.get('excludeApplied') !== '0';

    const profile = await loadProfileContext(session.id);
    if (!profile?.vector?.length) {
      // A brand-new seeker with no résumé yet. Not an error — the UI prompts
      // them to complete their profile.
      return NextResponse.json({ jobs: [], reason: 'no-profile' });
    }

    const where: Prisma.JobWhereInput = excludeApplied
      ? { isActive: true, applications: { none: { userId: session.id } } }
      : { isActive: true };

    const candidates = await prisma.job.findMany({
      where,
      include: RECOMMENDED_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_LIMIT,
    });

    // Same scale as the feed and the detail page — see `app/api/jobs/route.ts`.
    const scored = (await rankJobsAsync(profile, candidates)).filter(
      (entry): entry is { job: RecommendedJob; match: MatchBreakdown } =>
        (entry.match?.score ?? 0) >= MIN_SCORE
    );

    scored.sort((a, b) => b.match.score - a.match.score);

    const jobs = scored.slice(0, limit).map(({ job, match }) => ({
      ...withoutVector(job),
      match,
    }));

    return NextResponse.json({ jobs, reason: null });
  } catch (error) {
    console.error('GET /api/jobs/recommended failed:', error);
    return serverError('Could not load your recommendations');
  }
}
