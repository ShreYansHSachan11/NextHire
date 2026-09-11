import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, serverError } from '@/lib/auth';
import { DUPLICATE_THRESHOLD, isAiEnabled } from '@/lib/ai/config';
import { findDuplicateJobs, MAX_CLUSTER_LIMIT } from '@/lib/ai/similar';

/**
 * Near-duplicate postings, for moderation — ROADMAP H10.
 *
 * Costs nothing to run: every job vector already exists, so the whole report is
 * a pairwise cosine over rows we hold rather than a single model call. That is
 * what makes it worth running on a schedule rather than only on suspicion.
 *
 * Read-only by design. It never deactivates or deletes anything: a high cosine
 * is evidence that two adverts are the same, not proof that either should go,
 * and a person decides what happens next.
 */

// The scan is quadratic in the corpus (see `DUPLICATE_SCAN_LIMIT`), so give it
// more than the default serverless budget — but far less than a reindex, which
// is bounded by the model rather than by arithmetic.
export const maxDuration = 30;

/** Columns a moderator needs to judge a cluster. No vectors, here or anywhere. */
const CLUSTER_JOB_SELECT = {
  id: true,
  title: true,
  location: true,
  type: true,
  createdAt: true,
  isActive: true,
  company: { select: { id: true, name: true } },
  _count: { select: { applications: true } },
} as const;

/**
 * GET /api/ai/duplicates — clusters of near-identical active postings.
 *
 * `?threshold=` and `?scan=` exist so an operator can tune the cut against a
 * real corpus without a deploy; both are clamped in `findDuplicateJobs`.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  try {
    // Reported rather than refused, matching `GET /api/ai/reindex`: an operator
    // needs to tell "the key is missing" apart from "nothing was flagged", and
    // this endpoint spends nothing either way.
    if (!isAiEnabled()) {
      return NextResponse.json({
        enabled: false,
        threshold: DUPLICATE_THRESHOLD,
        scanned: 0,
        truncated: false,
        clusters: [],
      });
    }

    const { searchParams } = new URL(req.url);
    const asNumber = (value: string | null) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const report = await findDuplicateJobs({
      limit: asNumber(searchParams.get('limit')),
      threshold: asNumber(searchParams.get('threshold')),
      scanLimit: asNumber(searchParams.get('scan')),
    });

    // One query for every posting in every cluster rather than one per cluster.
    const jobIds = report.clusters.flatMap((cluster) => cluster.jobIds);
    const jobs = jobIds.length
      ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: CLUSTER_JOB_SELECT })
      : [];

    const byId = new Map(jobs.map((job) => [job.id, job] as const));

    return NextResponse.json({
      enabled: true,
      threshold: report.threshold,
      scanned: report.scanned,
      truncated: report.truncated,
      maxClusters: MAX_CLUSTER_LIMIT,
      clusters: report.clusters.map((cluster) => ({
        size: cluster.size,
        similarity: cluster.similarity,
        // The interesting split for triage: one company reposting is usually
        // carelessness, the same advert under two companies usually is not.
        sameCompany: cluster.sameCompany,
        jobs: cluster.jobIds.flatMap((jobId) => {
          const job = byId.get(jobId);
          return job ? [job] : [];
        }),
      })),
    });
  } catch (error) {
    console.error('GET /api/ai/duplicates failed:', error);
    return serverError('Could not run the duplicate scan');
  }
}
