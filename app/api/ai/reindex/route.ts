import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, serverError } from '@/lib/auth';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, isAiEnabled } from '@/lib/ai/config';
import { reindexAll } from '@/lib/ai/embeddings';

/**
 * Admin controls for the vector index.
 *
 * `GET` reports health without spending a single token, so an operator can tell
 * "the key is missing" apart from "the backfill has not run yet" before paying
 * for a `POST`.
 */

// A backfill embeds hundreds of documents in batches; the default serverless
// budget is nowhere near long enough for that.
export const maxDuration = 60;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

/** GET /api/ai/reindex - index health. Admin only. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  try {
    const [jobs, indexedJobs, profiles, indexedProfiles] = await Promise.all([
      prisma.job.count({ where: { isActive: true } }),
      prisma.jobEmbedding.count(),
      prisma.user.count({ where: { role: 'SEEKER' } }),
      prisma.profileEmbedding.count(),
    ]);

    return NextResponse.json({
      enabled: isAiEnabled(),
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      jobs: { total: jobs, indexed: indexedJobs },
      profiles: { total: profiles, indexed: indexedProfiles },
    });
  } catch (error) {
    console.error('GET /api/ai/reindex failed:', error);
    return serverError('Could not read the index status');
  }
}

/** POST /api/ai/reindex - backfill missing or stale vectors. Admin only. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  if (!isAiEnabled()) return aiUnavailable();

  // The body is optional, so an empty request is not a client error - only
  // malformed JSON is.
  let body: Record<string, unknown> = {};
  const raw = await req.text().catch(() => '');
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return badRequest('Invalid request body');
    }
  }

  const requested = Number(body.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requested)))
    : DEFAULT_LIMIT;

  try {
    const report = await reindexAll({ limit });

    return NextResponse.json({
      ...report,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    });
  } catch (error) {
    console.error('POST /api/ai/reindex failed:', error);
    return serverError('The reindex could not be completed. Please try again.');
  }
}
