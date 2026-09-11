import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notFound, serverError, isUuid } from '@/lib/auth';
import {
  findSimilarJobs,
  DEFAULT_SIMILAR_LIMIT,
  MAX_SIMILAR_LIMIT,
} from '@/lib/ai/similar';

/**
 * "More like this" for one posting — ROADMAP H1.
 *
 * Costs nothing to serve: the vectors were written when the jobs were posted,
 * so this is a cosine loop over stored rows and no model call at all.
 *
 * Public, matching the access on the job detail route it decorates. It returns
 * only what that page already shows anonymously — title, company, the metadata
 * chips — so a signed-out visitor learns nothing new from it.
 */

/**
 * The feed's public columns, so the client can render these with the same card
 * component it uses on `/jobs`.
 *
 * `embedding` is deliberately absent rather than selected and stripped: the
 * surest way not to serialise a 768-float vector is never to load one.
 */
const CARD_INCLUDE = {
  company: { select: { id: true, name: true, profile: true } },
  _count: { select: { applications: true } },
} as const;

/** GET /api/jobs/:jobId/similar?limit=n — neighbour postings, best first. */
export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const requested = Number(new URL(req.url).searchParams.get('limit'));
    const limit = Number.isFinite(requested)
      ? Math.min(MAX_SIMILAR_LIMIT, Math.max(1, Math.trunc(requested)))
      : DEFAULT_SIMILAR_LIMIT;

    // An unknown id, an unindexed job and a genuinely isolated posting all come
    // back the same way: an empty list. This is a decorative section, so there
    // is nothing to report and no reason to confirm whether an id exists.
    const hits = await findSimilarJobs(jobId, limit);
    if (hits.length === 0) return NextResponse.json([]);

    const jobs = await prisma.job.findMany({
      where: { id: { in: hits.map((hit) => hit.jobId) }, isActive: true },
      include: CARD_INCLUDE,
    });

    const byId = new Map(jobs.map((job) => [job.id, job] as const));

    // A Prisma `IN` returns rows in storage order, so the similarity ranking has
    // to be re-applied here — the same reason the feed re-sorts its search hits.
    return NextResponse.json(
      hits.flatMap((hit) => {
        const job = byId.get(hit.jobId);
        if (!job) return [];

        return [
          {
            ...job,
            // Shape parity with the feed so the same card renders either list.
            // Both are null by design: this section ranks postings against a
            // posting, not against the reader, and a second percentage next to
            // the profile-fit panel would be read as another fit score.
            match: null,
            relevance: null,
            /** Cosine against the job being viewed, for ordering. */
            similarity: hit.similarity,
          },
        ];
      })
    );
  } catch (error) {
    console.error('GET /api/jobs/[jobId]/similar failed:', error);
    return serverError('Could not load similar roles');
  }
}
