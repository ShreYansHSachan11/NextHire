import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getSession,
  requireRole,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
  type SessionUser,
} from '@/lib/auth';
import { cleanString } from '@/lib/validation';

/**
 * Screening questions attached to a posting.
 *
 * `GET` is public because the applicant has to read the questions before they
 * can answer them; the answer key (`knockout`, `expected`) is stripped for
 * anyone who does not own the job, since a published expected answer is not a
 * screen, it is a hint.
 *
 * `PUT` replaces the set. Ownership is read from the session on every mutation —
 * the body never carries a company id.
 */

/** Ten is already more than most applicants will finish. */
const MAX_QUESTIONS = 10;
const MAX_PROMPT_CHARS = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 80;
const MAX_EXPECTED_CHARS = 80;

const KINDS = ['TEXT', 'BOOLEAN', 'SINGLE_CHOICE', 'NUMBER'] as const;
type Kind = (typeof KINDS)[number];

/** Boolean answers are stored as these two literals, so knockouts can compare. */
const BOOLEAN_ANSWERS = ['Yes', 'No'] as const;

interface CleanQuestion {
  /** Present when the client is keeping a question that already exists. */
  id: string | null;
  prompt: string;
  kind: Kind;
  options: string[];
  required: boolean;
  knockout: boolean;
  expected: string | null;
  position: number;
}

/** What every caller sees. */
const PUBLIC_SELECT = {
  id: true,
  prompt: true,
  kind: true,
  options: true,
  required: true,
  position: true,
} as const;

/** The owner additionally sees the knockout configuration. */
const OWNER_SELECT = {
  ...PUBLIC_SELECT,
  knockout: true,
  expected: true,
} as const;

function isOwner(session: SessionUser | null, companyId: string): boolean {
  if (!session) return false;
  if (session.role === 'ADMIN') return true;
  return session.role === 'COMPANY' && !!session.companyId && session.companyId === companyId;
}

/**
 * Loads the job purely to authorise against it. Returning the row rather than a
 * boolean keeps the "does this job exist" 404 distinct from the "not yours" 403.
 */
async function loadJobForOwner(jobId: string, session: SessionUser) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true },
  });
  if (!job) return { error: notFound('Job not found') } as const;
  if (!isOwner(session, job.companyId)) {
    return { error: forbidden('You can only manage questions on your own postings') } as const;
  }
  return { job } as const;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validates one incoming question.
 *
 * Returns a message rather than throwing so the caller can say which entry was
 * wrong — "question 3 needs at least two options" is actionable, "invalid
 * request body" is not.
 */
function readQuestion(
  raw: unknown,
  index: number
): { question: CleanQuestion } | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: `Question ${index + 1} is not valid` };
  }
  const entry = raw as Record<string, unknown>;

  const prompt = cleanString(entry.prompt, MAX_PROMPT_CHARS);
  if (!prompt) return { error: `Question ${index + 1} needs a prompt` };

  const kindValue = typeof entry.kind === 'string' ? entry.kind.toUpperCase() : 'TEXT';
  if (!(KINDS as readonly string[]).includes(kindValue)) {
    return { error: `Question ${index + 1} has an unknown answer type` };
  }
  const kind = kindValue as Kind;

  // Options only mean anything for a choice question; carrying them on the
  // others would put a list on screen the applicant cannot pick from.
  let options: string[] = [];
  if (kind === 'SINGLE_CHOICE') {
    const seen = new Set<string>();
    for (const value of Array.isArray(entry.options) ? entry.options : []) {
      const option = cleanString(value, MAX_OPTION_CHARS);
      if (!option) continue;
      const key = option.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(option);
      if (options.length >= MAX_OPTIONS) break;
    }
    if (options.length < MIN_OPTIONS) {
      return { error: `Question ${index + 1} needs at least ${MIN_OPTIONS} choices` };
    }
  } else if (kind === 'BOOLEAN') {
    options = [...BOOLEAN_ANSWERS];
  }

  const required = entry.required === undefined ? true : entry.required === true;

  const statedExpected = cleanString(entry.expected, MAX_EXPECTED_CHARS);
  let expected: string | null = statedExpected;
  if (statedExpected) {
    const wanted = statedExpected.toLowerCase();
    if (kind === 'SINGLE_CHOICE') {
      // Snap to the stored casing, so the knockout comparison is against a value
      // the applicant can actually produce.
      expected = options.find((option) => option.toLowerCase() === wanted) ?? null;
      if (!expected) {
        return { error: `Question ${index + 1}: the expected answer must be one of its choices` };
      }
    } else if (kind === 'BOOLEAN') {
      expected = BOOLEAN_ANSWERS.find((answer) => answer.toLowerCase() === wanted) ?? null;
      if (!expected) {
        return { error: `Question ${index + 1}: the expected answer must be Yes or No` };
      }
    }
  }

  // A knockout with nothing to compare against cannot knock anything out, and a
  // free-text answer has no single right form. Rather than storing a flag that
  // silently does nothing, drop it.
  const knockout = entry.knockout === true && expected !== null;

  return {
    question: {
      id: isUuid(entry.id) ? entry.id : null,
      prompt,
      kind,
      options,
      required,
      knockout,
      expected,
      position: index,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/jobs/:jobId/questions — public.
 *
 * An applicant needs the questions before they apply, so this is not gated on a
 * session; what it returns is gated on who is asking.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true },
    });
    if (!job) return notFound('Job not found');

    const owner = isOwner(getSession(req), job.companyId);

    const questions = await prisma.jobQuestion.findMany({
      where: { jobId },
      orderBy: { position: 'asc' },
      select: owner ? OWNER_SELECT : PUBLIC_SELECT,
    });

    return NextResponse.json({ questions, isOwner: owner });
  } catch (error) {
    console.error('GET /api/jobs/[jobId]/questions failed:', error);
    return serverError('Could not load the screening questions');
  }
}

/**
 * PUT /api/jobs/:jobId/questions — the owning company replaces the whole set.
 *
 * Questions the client sends back with their existing id are updated in place
 * rather than deleted and recreated. `ApplicationAnswer` cascades on question
 * delete, so a naive delete-all-then-insert would quietly destroy every answer
 * already collected on a posting the employer only meant to reword.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const owned = await loadJobForOwner(jobId, session);
    if ('error' in owned) return owned.error;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid request body');
    }

    const incoming = body.questions;
    if (!Array.isArray(incoming)) {
      return badRequest('Send a `questions` array');
    }
    if (incoming.length > MAX_QUESTIONS) {
      return badRequest(`A posting can carry at most ${MAX_QUESTIONS} screening questions`);
    }

    const questions: CleanQuestion[] = [];
    for (let index = 0; index < incoming.length; index += 1) {
      const result = readQuestion(incoming[index], index);
      if ('error' in result) return badRequest(result.error);
      questions.push(result.question);
    }

    const existing = await prisma.jobQuestion.findMany({
      where: { jobId },
      select: { id: true },
    });
    // Only ids that already belong to *this* job may be reused — an id copied
    // from another posting must not become a way to rewrite it.
    const existingIds = new Set(existing.map((question) => question.id));

    const kept = new Set<string>();
    const updates = [];
    const creates = [];

    for (const question of questions) {
      const reuse = question.id && existingIds.has(question.id) ? question.id : null;
      if (reuse) {
        kept.add(reuse);
        updates.push(
          prisma.jobQuestion.update({
            where: { id: reuse },
            data: {
              prompt: question.prompt,
              kind: question.kind,
              options: question.options,
              required: question.required,
              knockout: question.knockout,
              expected: question.expected,
              position: question.position,
            },
          })
        );
      } else {
        creates.push({
          jobId,
          prompt: question.prompt,
          kind: question.kind,
          options: question.options,
          required: question.required,
          knockout: question.knockout,
          expected: question.expected,
          position: question.position,
        });
      }
    }

    const removed = [...existingIds].filter((id) => !kept.has(id));

    await prisma.$transaction([
      ...(removed.length > 0
        ? [prisma.jobQuestion.deleteMany({ where: { id: { in: removed }, jobId } })]
        : []),
      ...updates,
      ...(creates.length > 0 ? [prisma.jobQuestion.createMany({ data: creates })] : []),
    ]);

    const saved = await prisma.jobQuestion.findMany({
      where: { jobId },
      orderBy: { position: 'asc' },
      select: OWNER_SELECT,
    });

    return NextResponse.json({ questions: saved, isOwner: true });
  } catch (error) {
    console.error('PUT /api/jobs/[jobId]/questions failed:', error);
    return serverError('Could not save the screening questions');
  }
}

/**
 * DELETE /api/jobs/:jobId/questions — the owning company clears the set, or one
 * question via `?questionId=`.
 *
 * Answers already given to a removed question go with it (the schema cascades),
 * which is why this is a deliberate action rather than a side effect of PUT.
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return notFound('Job not found');

    const owned = await loadJobForOwner(jobId, session);
    if ('error' in owned) return owned.error;

    const questionId = new URL(req.url).searchParams.get('questionId');
    if (questionId !== null && !isUuid(questionId)) {
      return badRequest('Invalid question id');
    }

    // The `jobId` clause stays on the where even when an id is named: deleting
    // by id alone would reach into another company's posting.
    const { count } = await prisma.jobQuestion.deleteMany({
      where: questionId ? { id: questionId, jobId } : { jobId },
    });

    if (questionId && count === 0) return notFound('Question not found');

    return NextResponse.json({ deleted: count });
  } catch (error) {
    console.error('DELETE /api/jobs/[jobId]/questions failed:', error);
    return serverError('Could not remove the screening questions');
  }
}
