import { NextRequest, NextResponse } from 'next/server';
import { requireRole, badRequest, notFound, serverError, isUuid } from '@/lib/auth';
import { explainMatch } from '@/lib/ai/explain';

/**
 * POST /api/ai/explain — one sentence on why the caller matches a posting.
 *
 * Seeker-only, and always about the *caller's* own match: the user id comes off
 * the verified session and is never read from the body, so there is no shape of
 * request that explains one person's profile to another.
 *
 * A POST rather than a GET because the first call for a pair may spend a
 * generation call. Every call after that is served from `MatchExplanation`.
 */

// A generation call plus two queries; the default budget is tight for that.
export const runtime = 'nodejs';
export const maxDuration = 30;

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

  if (!isUuid(body.jobId)) return badRequest('Invalid job id');
  const jobId = body.jobId;

  try {
    const outcome = await explainMatch(session.id, jobId);

    switch (outcome.status) {
      case 'ok':
        return NextResponse.json(outcome.explanation);

      case 'no-match':
        // Either the job is gone, or one side has no vector yet. The job page
        // shows no score in that case either, so the two stay consistent.
        return notFound('There is no match to explain for this role yet.');

      case 'disabled':
        return NextResponse.json(
          { error: 'AI features are not configured on this deployment.' },
          { status: 503 }
        );

      case 'unavailable':
      default:
        // Nothing is stored on a failed generation, so the next attempt is a
        // clean retry rather than a cached apology.
        return NextResponse.json(
          { error: 'We could not write an explanation right now. Please try again in a moment.' },
          { status: 502 }
        );
    }
  } catch (error) {
    console.error('POST /api/ai/explain failed:', error);
    return serverError('Could not explain this match');
  }
}
