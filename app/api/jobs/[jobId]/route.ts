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
import { computeMatchAsync, loadProfileContext, type MatchBreakdown } from '@/lib/ai/matching';
import { queueJobEmbedding } from '@/lib/ai/embeddings';

/** Columns the detail page needs. `skills` rides along as a Job scalar. */
const DETAIL_INCLUDE = {
  company: { select: { id: true, name: true, profile: true } },
  _count: { select: { applications: true } },
} as const;

/** The same, plus the vector — loaded only for a seeker we are about to score. */
const DETAIL_INCLUDE_WITH_VECTOR = {
  ...DETAIL_INCLUDE,
  embedding: { select: { vector: true } },
} as const;

type DetailJob = Prisma.JobGetPayload<{ include: typeof DETAIL_INCLUDE }> & {
  /** Present for seekers only, and stripped before serialising. */
  embedding?: { vector: number[] } | null;
};

/**
 * Drops the embedding relation so the 768-float vector never reaches the client;
 * it is loaded purely to score the match on the server.
 */
function withoutVector(job: DetailJob): Omit<DetailJob, 'embedding'> {
  const { embedding: _embedding, ...rest } = job;
  return rest;
}

/**
 * GET /api/jobs/:jobId — public job detail, plus `hasApplied` for a signed-in
 * seeker and, for a seeker with a profile vector, a `match` breakdown. The
 * job's `skills` array rides along as a scalar for the detail page's chips.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const session = getSession(req);
    const isSeeker = session?.role === 'SEEKER';

    // The vector is only worth fetching for someone we are going to score.
    const job: DetailJob | null = isSeeker
      ? await prisma.job.findUnique({
          where: { id: jobId },
          include: DETAIL_INCLUDE_WITH_VECTOR,
        })
      : await prisma.job.findUnique({
          where: { id: jobId },
          include: DETAIL_INCLUDE,
        });

    if (!job) return notFound('Job not found');

    const isOwner = !!session && (session.companyId === job.companyId || session.role === 'ADMIN');

    // A closed job stays reachable by direct link for anyone who already applied
    // or owns it, but is not exposed to the general public.
    let hasApplied = false;
    if (session?.role === 'SEEKER') {
      const existing = await prisma.application.findUnique({
        where: { userId_jobId: { userId: session.id, jobId } },
        select: { id: true, status: true, createdAt: true, matchScore: true },
      });
      hasApplied = !!existing;

      // Scoring is best-effort: a seeker with no profile vector, or a job that
      // has not been indexed yet, simply gets `null` rather than an error page.
      let match: MatchBreakdown | null = null;
      try {
        const profile = await loadProfileContext(session.id);
        if (profile) {
          // One profile against one posting, so the embedding-backed skill
          // layer is affordable — and this is the page where the missing-skills
          // list is actually read.
          match = await computeMatchAsync(profile, {
            vector: job.embedding?.vector ?? null,
            skills: job.skills ?? [],
            location: job.location,
            experience: job.experience,
          });
        }
      } catch (matchError) {
        console.error('GET /api/jobs/[jobId] match failed:', matchError);
      }

      return NextResponse.json({
        ...withoutVector(job),
        hasApplied,
        application: existing,
        isOwner,
        match,
      });
    }

    return NextResponse.json({ ...withoutVector(job), hasApplied, isOwner });
  } catch (error) {
    console.error('GET /api/jobs/[jobId] failed:', error);
    return serverError('Could not load the job');
  }
}

/** PUT /api/jobs/:jobId — owning company only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const guard = requireCompany(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { jobId } = await params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true },
    });
    if (!existing) return notFound('Job not found');
    if (session.role !== 'ADMIN' && existing.companyId !== session.companyId) {
      return forbidden('You can only edit jobs posted by your company');
    }

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

    // Only these fields are writable. The old handler spread the whole body into
    // `data`, so a caller could rewrite companyId or createdAt.
    const job = await prisma.job.update({
      where: { id: jobId },
      data: {
        title,
        description,
        salary: cleanString(body.salary, 100),
        experience: cleanString(body.experience, 60),
        location: cleanString(body.location, 120),
        type: isJobType(body.type) ? body.type : null,
        // Presence-gated: the edit form may not carry a skills editor yet, and
        // omitting the field must not silently wipe what is already stored.
        skills: 'skills' in body ? cleanTagList(body.skills) : undefined,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      },
      include: { company: { select: { id: true, name: true, profile: true } } },
    });

    // The posting text just changed, so its vector is stale. Fire-and-forget:
    // an edit must save even when Gemini is unreachable.
    queueJobEmbedding(jobId);

    return NextResponse.json(job);
  } catch (error) {
    console.error('PUT /api/jobs/[jobId] failed:', error);
    return serverError('Could not update the job');
  }
}

/** PATCH /api/jobs/:jobId — partial update, used by the dashboard's open/close toggle. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const guard = requireCompany(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { jobId } = await params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true },
    });
    if (!existing) return notFound('Job not found');
    if (session.role !== 'ADMIN' && existing.companyId !== session.companyId) {
      return forbidden('You can only edit jobs posted by your company');
    }

    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.isActive !== 'boolean') {
      return badRequest('isActive must be true or false');
    }

    const job = await prisma.job.update({
      where: { id: jobId },
      data: { isActive: body.isActive },
      include: { company: { select: { id: true, name: true } } },
    });

    return NextResponse.json(job);
  } catch (error) {
    console.error('PATCH /api/jobs/[jobId] failed:', error);
    return serverError('Could not update the job');
  }
}

/** DELETE /api/jobs/:jobId — owning company only; removes its applications too. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const guard = requireCompany(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { jobId } = await params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true, title: true, _count: { select: { applications: true } } },
    });
    if (!existing) return notFound('Job not found');
    if (session.role !== 'ADMIN' && existing.companyId !== session.companyId) {
      return forbidden('You can only delete jobs posted by your company');
    }

    // Applications used to block the delete with a raw foreign-key error.
    await prisma.$transaction([
      prisma.application.deleteMany({ where: { jobId } }),
      prisma.job.delete({ where: { id: jobId } }),
    ]);

    return NextResponse.json({
      message: 'Job deleted',
      deletedApplications: existing._count.applications,
    });
  } catch (error) {
    console.error('DELETE /api/jobs/[jobId] failed:', error);
    return serverError('Could not delete the job');
  }
}
