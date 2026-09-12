import { NextRequest, NextResponse } from 'next/server';
import { Prisma, type $Enums } from '@prisma/client';
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
import { cleanString, cleanText, isApplicationStatus, STATUS_LABELS } from '@/lib/validation';
import {
  computeMatchAsync,
  loadProfileContext,
  rankApplicantsForJob,
  type MatchBreakdown,
} from '@/lib/ai/matching';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';
import { ASKED_QUESTIONS } from '../_lib/screening';

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
 * The screening answers, joined to the question each one answers.
 *
 * Only ever spread onto the employer's view. `knockout` and `expected` are the
 * answer key — `GET /api/jobs/:jobId/questions` already withholds both from
 * anyone who does not own the posting, and handing them back on the applicant's
 * own application row would publish the key to the person being screened.
 *
 * Ordered by the question's position rather than by when the answer was
 * written, so the employer reads the set back in the order they authored it.
 */
const SCREENING_INCLUDE = {
  answers: {
    orderBy: { question: { position: 'asc' } },
    select: {
      id: true,
      value: true,
      question: {
        select: {
          id: true,
          prompt: true,
          kind: true,
          options: true,
          required: true,
          knockout: true,
          expected: true,
          position: true,
        },
      },
    },
  },
} as const;

/** The applicant, plus the answers only the owning company may read. */
const EMPLOYER_INCLUDE = {
  ...APPLICANT_INCLUDE,
  ...SCREENING_INCLUDE,
} as const;

/**
 * The same answers, read back by the person who wrote them.
 *
 * A seeker answered these questions from memory, under time pressure, and then
 * had no way to see what they had said — not on the dashboard, not anywhere.
 * They are being screened on those words and they are their own words, so
 * withholding them was never a security property; it was an omission.
 *
 * What is withheld is the *answer key*. `knockout` and `expected` are missing
 * from the question selection here and that is the whole difference from
 * `SCREENING_INCLUDE`: `GET /api/jobs/:jobId/questions` already strips both for
 * anyone who does not own the posting, and handing them to the candidate on
 * their own application row would publish the screen to the person being
 * screened — and, worse, tell them retrospectively which answer had failed.
 *
 * Two readers, and only two: the author, and the company that owns the job.
 * Both are established from the verified session — the seeker branch below
 * filters on `userId: session.id` and the employer branch on the job's
 * `companyId` — so neither can be asked for by a request that merely names an
 * application id.
 */
const OWN_SCREENING_INCLUDE = {
  answers: {
    orderBy: { question: { position: 'asc' } },
    select: {
      id: true,
      value: true,
      createdAt: true,
      question: {
        select: {
          id: true,
          prompt: true,
          kind: true,
          options: true,
          required: true,
          position: true,
        },
      },
    },
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Screening answers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Caps on a stored answer. This route is the authority; the apply form mirrors
 * them, the same way the posting editor mirrors the questions route.
 *
 * `cleanText` and `cleanString` from `lib/validation` do the actual trimming and
 * slicing, so an answer cannot be stored in a shape the rest of the app has
 * never had to handle. Long-form answers keep their newlines; the closed kinds
 * are collapsed to a single line because they are compared, not read.
 */
const MAX_ANSWER_CHARS = 1000;
/** The cover letter, named rather than inlined so the form has one figure to mirror. */
const MAX_MESSAGE_CHARS = 2000;
/** Wide enough for any figure a person could mean, narrow enough to bound the parse. */
const MAX_NUMBER_CHARS = 24;

/** The two literals a BOOLEAN answer is stored as, so a knockout can compare. */
const BOOLEAN_ANSWERS = ['Yes', 'No'] as const;

/** Exactly what answering needs to know about a question — never the answer key. */
type ScreeningQuestion = {
  id: string;
  prompt: string;
  kind: $Enums.QuestionKind;
  options: string[];
  required: boolean;
};

/** A prompt is up to 300 characters; an error message quoting one is not. */
function questionLabel(question: ScreeningQuestion): string {
  return cleanString(question.prompt, 80) ?? 'A screening question';
}

/**
 * Normalises one answer against the kind of question it answers.
 *
 * An empty result means "not answered" rather than an error — the caller
 * decides whether that is allowed, because only it knows whether the question
 * was required. Values for the closed kinds are snapped to the stored casing so
 * the employer's knockout comparison runs against a value the schema produced
 * rather than whatever the applicant's keyboard did.
 */
function readAnswerValue(
  question: ScreeningQuestion,
  raw: unknown
): { value: string } | { error: string } {
  // A JSON client that sends 3 or true rather than "3"/"true" means the same
  // thing; the string coercion happens here so the cleaners below see a string.
  const stated =
    typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;

  switch (question.kind) {
    case 'BOOLEAN': {
      const text = cleanString(stated, MAX_ANSWER_CHARS);
      if (!text) return { value: '' };
      const answer = BOOLEAN_ANSWERS.find((option) => option.toLowerCase() === text.toLowerCase());
      if (!answer) return { error: `“${questionLabel(question)}” takes Yes or No` };
      return { value: answer };
    }
    case 'SINGLE_CHOICE': {
      const text = cleanString(stated, MAX_ANSWER_CHARS);
      if (!text) return { value: '' };
      // The options come from the posting, not from the request, so a value
      // outside them is rejected rather than stored as a new de facto choice.
      const choice = question.options.find((option) => option.toLowerCase() === text.toLowerCase());
      if (!choice) return { error: `“${questionLabel(question)}” must be one of its choices` };
      return { value: choice };
    }
    case 'NUMBER': {
      const text = cleanString(stated, MAX_NUMBER_CHARS);
      if (!text) return { value: '' };
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return { error: `“${questionLabel(question)}” takes a number` };
      // Stored canonically: "007", "3.50" and "3e0" are the same answer, and the
      // employer should not have to notice which one was typed.
      return { value: String(parsed) };
    }
    default: {
      // TEXT is the only kind a person writes freely, so it is the only one that
      // keeps its line breaks.
      return { value: cleanText(stated, MAX_ANSWER_CHARS) ?? '' };
    }
  }
}

/**
 * Validates the whole answer set against the questions *this* job actually asks.
 *
 * Nothing in the body is trusted: the question set is loaded from the job being
 * applied to, and an id that is not in it — copied from another posting, or
 * invented — is rejected outright rather than written. `ApplicationAnswer` has
 * no constraint that would catch that on its own: its unique key is
 * (applicationId, questionId), and a foreign question id satisfies it perfectly.
 */
function readAnswers(
  raw: unknown,
  questions: ScreeningQuestion[]
): { answers: { questionId: string; value: string }[] } | { error: string } {
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    return { error: 'Send `answers` as an array' };
  }
  const entries: unknown[] = Array.isArray(raw) ? raw : [];
  if (entries.length > questions.length) {
    return { error: 'That is more answers than this job asks for' };
  }

  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const values = new Map<string, string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return { error: 'One of the answers is not valid' };
    const { questionId, value } = entry as Record<string, unknown>;

    if (!isUuid(questionId)) return { error: 'One of the answers names an invalid question' };
    const question = byId.get(questionId);
    if (!question) return { error: 'One of the answers is not a question on this job' };

    // Caught here rather than at the unique constraint: a P2002 raised mid-write
    // is indistinguishable from the duplicate-application P2002 below it.
    if (seen.has(question.id)) {
      return { error: `“${questionLabel(question)}” was answered twice` };
    }
    seen.add(question.id);

    const read = readAnswerValue(question, value);
    if ('error' in read) return { error: read.error };
    // Blank answers to optional questions are simply not rows. An absent answer
    // and an empty one mean the same thing to the employer, and only one of
    // them needs storing.
    if (read.value) values.set(question.id, read.value);
  }

  for (const question of questions) {
    if (question.required && !values.has(question.id)) {
      return { error: `“${questionLabel(question)}” needs an answer` };
    }
  }

  return {
    answers: [...values].map(([questionId, value]) => ({ questionId, value })),
  };
}

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
          // What they told this employer when they applied, in the order they
          // were asked. Scoped by `userId: session.id` above, so a seeker can
          // only ever reach their own.
          ...OWN_SCREENING_INCLUDE,
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
      include: EMPLOYER_INCLUDE,
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

  // The (userId, jobId) unique already stops a double-click becoming two rows,
  // but it does nothing about one account applying to every posting on the
  // board in a loop: each application notifies the employer, and each one runs
  // a match score. A 429 rather than a silent no-op, because the applicant is
  // waiting on a definite answer.
  const budget = checkRateLimit(req, RATE_TIERS.WRITE, session);
  if (!budget.ok) return rateLimited(budget);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.jobId)) return badRequest('Invalid job id');
  const jobId = body.jobId;
  const message = cleanText(body.message, MAX_MESSAGE_CHARS);

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
        // The screening set is read from the job being applied to, which is what
        // makes "does this question belong here" answerable without trusting a
        // single field of the request. The answer key is not selected: nothing
        // in this handler needs it, and the applicant must never see it.
        questions: {
          // Retired questions are not part of the set any more — they are kept
          // only so the answers already given to them survive. Asking here
          // would reject an applicant for not answering a required question the
          // posting stopped asking, and store an answer to a question nobody
          // was shown. See `app/api/_lib/screening.ts`.
          where: ASKED_QUESTIONS,
          orderBy: { position: 'asc' },
          select: { id: true, prompt: true, kind: true, options: true, required: true },
        },
      },
    });

    if (!job) return notFound('Job not found');
    if (!job.isActive) return badRequest('This job is no longer accepting applications');

    // Validated in full before anything is written, so a rejected answer costs
    // the applicant a 400 rather than an application they then cannot re-submit.
    const screening = readAnswers(body.answers, job.questions);
    if ('error' in screening) return badRequest(screening.error);
    const answers = screening.answers;

    // The applicant is always the signed-in user. The old handler took `userId`
    // from the body, which let anyone apply on somebody else's behalf.
    const applicationData = {
      jobId: job.id,
      userId: session.id,
      message,
      status: 'PENDING',
    } as const;

    // The posting is the gate, not the body: a job that asks nothing takes
    // exactly the path it always has — one insert, no transaction to open.
    //
    // When there are answers the two writes are one transaction, because an
    // application whose answers half-landed is worse than no application at all:
    // the (userId, jobId) unique means the applicant cannot simply apply again
    // to fix it, and the employer would read a required question as unanswered.
    const application =
      job.questions.length === 0
        ? await prisma.application.create({ data: applicationData, include: APPLICANT_INCLUDE })
        : await prisma.$transaction(async (tx) => {
            const created = await tx.application.create({
              data: applicationData,
              include: APPLICANT_INCLUDE,
            });
            if (answers.length > 0) {
              await tx.applicationAnswer.createMany({
                data: answers.map((answer) => ({
                  applicationId: created.id,
                  questionId: answer.questionId,
                  value: answer.value,
                })),
              });
            }
            return created;
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
