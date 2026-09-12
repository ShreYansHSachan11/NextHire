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
import { ASKED_QUESTIONS, RETIRED_POSITION } from '../../../_lib/screening';

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

  /*
   * An expected answer only means anything for a closed kind.
   *
   * The kind test is outside the `if (statedExpected)` below, and that position
   * is the fix rather than a tidy-up. Nested inside it, `TEXT` and `NUMBER`
   * matched neither branch, so `expected` kept whatever 80-character string was
   * posted and `knockout` — computed from `expected !== null` — came out true.
   * The consequence was not a dormant flag: the applications view compares that
   * string to the candidate's answer, so a TEXT knockout of "Because I love it"
   * flags *every* applicant as having missed it, and a NUMBER one can never
   * match at all, because answers are canonicalised through `String(Number(x))`
   * and "3.50" is stored as "3.5". A red screening flag that is wrong for
   * everyone, sitting in front of a hiring decision.
   *
   * Every other layer already held this line — the AI suggestion route nulls
   * `expected` for these kinds, and both authoring forms refuse to offer it —
   * but this route is the authority, and it was the one that did not check.
   *
   * Dropped silently rather than rejected: it is not something a person can ask
   * for through either form, so a 400 here would only ever answer a client that
   * sent a field it should not have, and the honest storage is "no expected
   * answer" rather than an error about one.
   */
  const closedKind = kind === 'SINGLE_CHOICE' || kind === 'BOOLEAN';
  const statedExpected = closedKind ? cleanString(entry.expected, MAX_EXPECTED_CHARS) : null;

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
    } else {
      expected = BOOLEAN_ANSWERS.find((answer) => answer.toLowerCase() === wanted) ?? null;
      if (!expected) {
        return { error: `Question ${index + 1}: the expected answer must be Yes or No` };
      }
    }
  }

  // A knockout with nothing to compare against cannot knock anything out, and a
  // free-text answer has no single right form. Rather than storing a flag that
  // silently does nothing, drop it. With `expected` now null for every open
  // kind, this one line enforces both halves of that sentence.
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

    // Retired questions are excluded for *everyone*, owner included. This list
    // is what the posting asks — the applicant's form is built from it and the
    // owner's editor round-trips it straight back into `PUT`. A retired
    // question appearing here would be asked again by the first reader and
    // duplicated by the second. Its answers are read through the application
    // they belong to, not through the job.
    const questions = await prisma.jobQuestion.findMany({
      where: { jobId, ...ASKED_QUESTIONS },
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
 * `ApplicationAnswer` cascades on question delete, so the naive reading of
 * "replace the set" — delete every row, insert the new ones — destroys every
 * answer already collected on a posting the employer only meant to reword. Two
 * things stop that here:
 *
 * - a question that is still in the set is **updated in place**, matched by its
 *   id or, failing that, by an identical prompt, so a client that loses track
 *   of its ids cannot turn a reword into a deletion;
 * - a question that leaves the set is **retired rather than deleted** when
 *   anyone has answered it (`app/api/_lib/screening.ts`).
 *
 * The result is that no request to this route can destroy a submitted answer.
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

    // Only questions this job currently asks take part in the reconciliation.
    // Retired rows are not candidates to reuse and are not "removed" by their
    // absence — they left the set once already.
    const existing = await prisma.jobQuestion.findMany({
      where: { jobId, ...ASKED_QUESTIONS },
      select: { id: true, prompt: true, _count: { select: { answers: true } } },
    });

    // Only ids that already belong to *this* job may be reused — an id copied
    // from another posting must not become a way to rewrite it.
    const byId = new Map(existing.map((question) => [question.id, question]));

    /*
     * Identity by prompt, as a fallback when no usable id arrives.
     *
     * Sending a question's id back is what tells this route "reword this one"
     * rather than "delete that one and add this one", and the whole of a
     * candidate's answer to it rides on the distinction. That is a lot to hang
     * on a client remembering to round-trip a field: a re-created draft, a
     * different client, a future editor that rebuilds its state from the form
     * rather than from the response — any of them loses the id and, with it,
     * every answer, silently, on a save the employer thought was a reword.
     *
     * So an idless question with a prompt this posting already asks, character
     * for character, is taken to *be* that question. It is the same judgement a
     * person reading the two lists would make, and being wrong about it costs a
     * reworded question keeping its old answers — which is the intended
     * behaviour anyway. First match wins and `claimed` stops two incoming
     * questions from both landing on it.
     */
    const byPrompt = new Map<string, (typeof existing)[number]>();
    for (const question of existing) {
      const key = question.prompt.toLowerCase();
      if (!byPrompt.has(key)) byPrompt.set(key, question);
    }

    const claimed = new Set<string>();
    const updates = [];
    const creates = [];

    for (const question of questions) {
      const match =
        (question.id ? byId.get(question.id) : undefined) ??
        byPrompt.get(question.prompt.toLowerCase());
      const reuse = match && !claimed.has(match.id) ? match.id : null;

      if (reuse) {
        claimed.add(reuse);
        updates.push(
          prisma.jobQuestion.update({
            where: { id: reuse },
            data: {
              // Every field is writable on a kept question, `kind` included.
              // Changing the kind can leave an already-collected answer in a
              // shape the new kind would not accept — a sentence under a
              // question that now offers three choices. The answer is still the
              // words the candidate wrote, and they stay readable exactly as
              // written; what is never done is to throw them away to keep the
              // column tidy.
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

    /*
     * What leaves the set, and what that costs.
     *
     * A question nobody has answered is deleted: there is nothing to protect.
     * A question somebody has answered is retired instead — see
     * `app/api/_lib/screening.ts`. The employer gets what they asked for (it is
     * no longer asked, and it is gone from the editor and the apply form) and
     * the candidates' words survive on the applications they belong to, where
     * the employer can still read them.
     *
     * The alternative was `deleteMany`, which took the answers with it through
     * the schema's cascade. That was written as a deliberate trade when no
     * posting had answers yet; it is now a save that quietly destroys evidence
     * a hiring decision was made on, and which the candidate cannot reproduce.
     */
    const dropped = existing.filter((question) => !claimed.has(question.id));
    const deletable = dropped.filter((question) => question._count.answers === 0);
    const retirable = dropped.filter((question) => question._count.answers > 0);

    await prisma.$transaction([
      ...(deletable.length > 0
        ? [
            prisma.jobQuestion.deleteMany({
              where: { id: { in: deletable.map((question) => question.id) }, jobId },
            }),
          ]
        : []),
      ...(retirable.length > 0
        ? [
            prisma.jobQuestion.updateMany({
              where: { id: { in: retirable.map((question) => question.id) }, jobId },
              // All to the same position: retired questions are no longer a set,
              // so there is no order among them worth encoding.
              data: { position: RETIRED_POSITION },
            }),
          ]
        : []),
      ...updates,
      ...(creates.length > 0 ? [prisma.jobQuestion.createMany({ data: creates })] : []),
    ]);

    const saved = await prisma.jobQuestion.findMany({
      where: { jobId, ...ASKED_QUESTIONS },
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
 * Same rule as `PUT`, for the same reason: an unanswered question is deleted, an
 * answered one is retired. It used to cascade, on the argument that an explicit
 * DELETE is a deliberate act and the caller knows what they are asking for. Two
 * things are wrong with that now. The act is deliberate but the *consequence*
 * was never stated — nothing in the request, the response or the UI said "this
 * also erases what eleven people wrote" — and the words being erased are not
 * the employer's to erase. "Stop asking this question" is a complete request on
 * its own, and it is the one this endpoint can honour without destroying
 * somebody else's evidence.
 *
 * Nothing loses a capability by this. The set stops being asked exactly as
 * before; what changes is that the answers remain readable on the applications
 * that carry them.
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
    // by id alone would reach into another company's posting. `ASKED_QUESTIONS`
    // keeps an already-retired row out of both counts, so repeating the call is
    // a no-op rather than a second report of the same removal.
    const targets = await prisma.jobQuestion.findMany({
      where: questionId ? { id: questionId, jobId, ...ASKED_QUESTIONS } : { jobId, ...ASKED_QUESTIONS },
      select: { id: true, _count: { select: { answers: true } } },
    });

    if (questionId && targets.length === 0) return notFound('Question not found');

    const deletable = targets.filter((question) => question._count.answers === 0);
    const retirable = targets.filter((question) => question._count.answers > 0);

    await prisma.$transaction([
      ...(deletable.length > 0
        ? [
            prisma.jobQuestion.deleteMany({
              where: { id: { in: deletable.map((question) => question.id) }, jobId },
            }),
          ]
        : []),
      ...(retirable.length > 0
        ? [
            prisma.jobQuestion.updateMany({
              where: { id: { in: retirable.map((question) => question.id) }, jobId },
              data: { position: RETIRED_POSITION },
            }),
          ]
        : []),
    ]);

    // `deleted` keeps its old meaning — how many questions the posting stopped
    // asking — so an existing caller reading it still gets the right number.
    // `retired` says how many of those kept their answers, which is the part
    // worth reporting rather than doing quietly.
    return NextResponse.json({
      deleted: targets.length,
      retired: retirable.length,
    });
  } catch (error) {
    console.error('DELETE /api/jobs/[jobId]/questions failed:', error);
    return serverError('Could not remove the screening questions');
  }
}
