import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  canActAs,
  requireAuth,
  requireRole,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';
import { cleanText, isApplicationStatus, STATUS_LABELS } from '@/lib/validation';
import {
  computeMatchAsync,
  loadProfileContext,
  rankApplicantsForJob,
  type MatchBreakdown,
} from '@/lib/ai/matching';

/**
 * Prisma tags its known request errors with a string `code`. Reading it this way
 * keeps the catch blocks free of `any` while still letting us map P2002 (unique
 * constraint) onto a friendly 409.
 */
function prismaErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** What a company needs to triage an applicant: contact details and the latest CV. */
const APPLICANT_INCLUDE = {
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
  job: {
    select: {
      id: true,
      title: true,
      company: { select: { name: true } },
    },
  },
} as const;

/**
 * GET /api/applications
 *   SEEKER   → only their own applications
 *   COMPANY  → applications on their own jobs (?companyId= is optional and must
 *              match the session; ADMIN may name any company)
 *              ?jobId=    narrow to one of those jobs
 *              ?rank=fit  attach `match` and order by fit rather than by date
 *
 * There is deliberately no "no filter" branch any more: the old handler fell
 * through to every application in the database — names, emails and resumes included.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { searchParams } = new URL(req.url);
    const requestedCompanyId = searchParams.get('companyId');

    if (session.role === 'SEEKER') {
      const applications = await prisma.application.findMany({
        where: { userId: session.id },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              location: true,
              type: true,
              // `companyId` is what the dashboard's "Message" button posts to
              // /api/conversations. It used to look the employer up by name and
              // take the first fuzzy match, which could message a different company.
              companyId: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // `matchScore` is an Application scalar, so it rides along with the include
      // above. The dashboard shows the fit as it stood on the day of applying,
      // which is why it is stored rather than recomputed here.
      return NextResponse.json(applications);
    }

    if (requestedCompanyId && !isUuid(requestedCompanyId)) {
      return badRequest('Invalid company id');
    }
    if (requestedCompanyId && session.role !== 'ADMIN' && requestedCompanyId !== session.companyId) {
      return forbidden('You can only view applications for your own company');
    }

    // No id supplied → fall back to the caller's own company rather than to
    // "everything". An ADMIN has no company of their own, so they must name one.
    const companyId = requestedCompanyId ?? session.companyId;
    if (!companyId) {
      return badRequest('A company id is required to list applications');
    }

    const requestedJobId = searchParams.get('jobId');
    if (requestedJobId && !isUuid(requestedJobId)) {
      return badRequest('Invalid job id');
    }

    // The `job: { companyId }` clause stays on both branches: narrowing by job
    // must never become a way to read another company's pipeline.
    const where: Prisma.ApplicationWhereInput = requestedJobId
      ? { jobId: requestedJobId, job: { companyId } }
      : { job: { companyId } };

    const applications = await prisma.application.findMany({
      where,
      include: APPLICANT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    if (searchParams.get('rank') !== 'fit') {
      return NextResponse.json(applications);
    }

    // Live scoring only makes sense against a single posting. Across a whole
    // company we fall back to the score stored at apply time rather than
    // scoring every applicant against every job on every page load.
    let scores: Map<string, MatchBreakdown> | null = null;
    if (requestedJobId) {
      try {
        scores = await rankApplicantsForJob(requestedJobId);
      } catch (rankError) {
        console.error('GET /api/applications ranking failed:', rankError);
      }
    }

    const ranked = applications.map((application) => ({
      ...application,
      match: scores?.get(application.userId) ?? null,
    }));

    // Unscored applicants sort last, hence `-1` rather than `0`.
    ranked.sort(
      (a, b) => (b.match?.score ?? b.matchScore ?? -1) - (a.match?.score ?? a.matchScore ?? -1)
    );

    return NextResponse.json(ranked);
  } catch (error) {
    console.error('GET /api/applications failed:', error);
    return serverError('Could not load applications');
  }
}

/** POST /api/applications — a seeker applies to a job. */
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
  const message = cleanText(body.message, 2000);

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        isActive: true,
        companyId: true,
        // Scoring inputs. One row's worth of vector, and it never leaves the
        // server: the response is built from `application`, not from `job`.
        skills: true,
        location: true,
        experience: true,
        embedding: { select: { vector: true } },
      },
    });

    if (!job) return notFound('Job not found');
    if (!job.isActive) return badRequest('This job is no longer accepting applications');

    // The applicant is always the signed-in user. The old handler took `userId`
    // from the body, which let anyone apply on somebody else's behalf.
    const application = await prisma.application.create({
      data: {
        jobId: job.id,
        userId: session.id,
        message,
        status: 'PENDING',
      },
      include: APPLICANT_INCLUDE,
    });

    // Freeze the fit at the moment of applying so it does not drift as either
    // the posting or the profile is edited. Its own try/catch: a scoring failure
    // must never turn a successful application into an error.
    let matchScore: number | null = null;
    try {
      const profile = await loadProfileContext(session.id);
      if (profile) {
        // The same skill matcher the job detail page used, so the score frozen
        // here is the one the candidate was shown when they applied.
        const match = await computeMatchAsync(profile, {
          vector: job.embedding?.vector ?? null,
          skills: job.skills ?? [],
          location: job.location,
          experience: job.experience,
        });
        if (match) {
          await prisma.application.update({
            where: { id: application.id },
            data: { matchScore: match.score },
          });
          matchScore = match.score;
        }
      }
    } catch (scoreError) {
      console.error('POST /api/applications match scoring failed:', scoreError);
    }

    // Tell the employer. Done after the write and in its own try/catch: the
    // application is what matters, a missing bell entry must not fail the request.
    try {
      const recipients = await prisma.user.findMany({
        where: { companyId: job.companyId, role: 'COMPANY' },
        select: { id: true },
      });

      if (recipients.length > 0) {
        const applicantName = session.name || 'A candidate';
        await prisma.notification.createMany({
          data: recipients.map((recipient) => ({
            userId: recipient.id,
            content: `New application from ${applicantName} for ${job.title}`,
            link: '/applications',
          })),
        });
      }
    } catch (notifyError) {
      console.error('POST /api/applications notification failed:', notifyError);
    }

    return NextResponse.json({ ...application, matchScore }, { status: 201 });
  } catch (error) {
    // The compound unique on (userId, jobId) turns a double-click into P2002
    // instead of a second row.
    if (prismaErrorCode(error) === 'P2002') {
      return NextResponse.json({ error: 'You have already applied for this job' }, { status: 409 });
    }
    if (prismaErrorCode(error) === 'P2003') {
      return badRequest('That job could not be found');
    }

    console.error('POST /api/applications failed:', error);
    return serverError('Could not submit your application');
  }
}

/** PATCH /api/applications — the owning company moves an application along. */
export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.id)) return badRequest('Invalid application id');
  if (!isApplicationStatus(body.status)) {
    return badRequest('Please choose a valid application status');
  }
  const applicationId = body.id;
  const status = body.status;

  try {
    const existing = await prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        userId: true,
        job: {
          select: { title: true, companyId: true, company: { select: { name: true } } },
        },
      },
    });

    if (!existing) return notFound('Application not found');
    if (session.role !== 'ADMIN' && existing.job.companyId !== session.companyId) {
      return forbidden('You can only update applications for your own jobs');
    }

    // Only the status is writable here; the old handler spread the whole body
    // into `data`, so a caller could rewrite userId, jobId or createdAt.
    const application = await prisma.application.update({
      where: { id: applicationId },
      data: { status },
      include: APPLICANT_INCLUDE,
    });

    // Re-saving the same status shouldn't ping the applicant again.
    if (existing.status !== status) {
      try {
        await prisma.notification.create({
          data: {
            userId: existing.userId,
            content: `Your application for ${existing.job.title} at ${existing.job.company.name} is now ${STATUS_LABELS[status]}`,
            link: '/seeker/dashboard',
          },
        });
      } catch (notifyError) {
        console.error('PATCH /api/applications notification failed:', notifyError);
      }
    }

    return NextResponse.json(application);
  } catch (error) {
    console.error('PATCH /api/applications failed:', error);
    return serverError('Could not update the application');
  }
}

/** PUT /api/applications — kept as an alias so existing clients carry on working. */
export async function PUT(req: NextRequest) {
  return PATCH(req);
}

/**
 * DELETE /api/applications — a seeker withdraws their own application, or the
 * owning company removes one from its pipeline.
 */
export async function DELETE(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.id)) return badRequest('Invalid application id');
  const applicationId = body.id;

  try {
    const existing = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true, job: { select: { companyId: true } } },
    });

    if (!existing) return notFound('Application not found');

    const isApplicant = canActAs(session, existing.userId);
    const isEmployer =
      session.role === 'ADMIN' ||
      (session.role === 'COMPANY' &&
        !!session.companyId &&
        session.companyId === existing.job.companyId);

    if (!isApplicant && !isEmployer) {
      return forbidden('You can only remove your own applications');
    }

    await prisma.application.delete({ where: { id: applicationId } });

    return NextResponse.json({ message: 'Application removed' });
  } catch (error) {
    console.error('DELETE /api/applications failed:', error);
    return serverError('Could not remove the application');
  }
}
