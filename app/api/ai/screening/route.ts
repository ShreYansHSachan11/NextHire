import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, forbidden, notFound, serverError, isUuid } from '@/lib/auth';
import { cleanString, cleanTagList, cleanText } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJson } from '@/lib/ai/gemini';
import { containsProtectedTerm } from '@/lib/ai/fairness';

/**
 * Suggested screening questions for a posting.
 *
 * This endpoint only suggests. Nothing it returns is stored — the employer
 * picks what they want and saves it through
 * `PUT /api/jobs/:jobId/questions`, which validates independently. That split
 * is deliberate: a generated question should never become part of a posting
 * without a person having read it.
 *
 * The protected-characteristic rule is enforced twice. The system instruction
 * tells the model what it may not ask, and `containsProtectedTerm` drops
 * anything that asks it anyway, because an instruction the model can drift away
 * from is guidance, not a control.
 */

export const maxDuration = 30;

/** More than this and the applicant abandons the form. */
const MAX_SUGGESTIONS = 8;
const DEFAULT_SUGGESTIONS = 6;

/** Mirrors the caps `PUT /api/jobs/:jobId/questions` enforces on save. */
const MAX_PROMPT_CHARS = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 80;
const MAX_EXPECTED_CHARS = 80;
const MAX_RATIONALE_CHARS = 200;

const KINDS = ['TEXT', 'BOOLEAN', 'SINGLE_CHOICE', 'NUMBER'] as const;
type Kind = (typeof KINDS)[number];

const BOOLEAN_ANSWERS = ['Yes', 'No'] as const;

const SYSTEM_INSTRUCTION =
  'You draft screening questions for a hiring portal. Ask only about the work: ' +
  'demonstrable skills, tools, relevant experience, availability to start, ' +
  'notice period, willingness to work the stated location or hours, and ' +
  'requirements the posting itself states. Each question must be answerable in ' +
  'one short answer and must be one a candidate could reasonably answer before ' +
  'an interview.\n\n' +
  'You must never ask about, hint at, or require an answer that reveals a ' +
  'protected characteristic: age or date of birth, race or ethnicity, national ' +
  'origin or citizenship, religion or belief, sex, gender or gender identity, ' +
  'sexual orientation, disability or health, pregnancy, marital or family ' +
  'status, caring responsibilities, veteran status, political affiliation or ' +
  'union membership. Do not ask for them indirectly either - no graduation ' +
  'years, no "digital native", no "recent graduate", no questions about ' +
  'childcare, no native-speaker requirements. Asking whether a candidate ' +
  'requires visa sponsorship for the role is permitted; asking their ' +
  'nationality or citizenship is not.\n\n' +
  'Do not invent requirements the posting does not state, and do not ask ' +
  'anything about salary history.';

const SCREENING_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          kind: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          knockout: { type: Type.BOOLEAN },
          expected: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: ['prompt', 'kind', 'options', 'knockout', 'expected', 'rationale'],
      },
    },
  },
  required: ['questions'],
};

interface ScreeningDraft {
  questions?: unknown;
}

/** The shape the questions route accepts, plus a note for the employer. */
interface Suggestion {
  prompt: string;
  kind: Kind;
  options: string[];
  required: boolean;
  knockout: boolean;
  expected: string | null;
  rationale: string;
}

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

function aiFailed() {
  return NextResponse.json(
    { error: 'The question assistant is unavailable right now. Please try again in a moment.' },
    { status: 502 }
  );
}

/* -------------------------------------------------------------------------- */
/* Outbound sanitisation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Choice labels, capped and de-duplicated. Not `cleanTagList`: that exists for
 * skill tags and caps at 40 characters, which is too short for a real answer
 * option like "Yes, I hold a valid certification".
 */
function cleanChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const options: string[] = [];

  for (const entry of value) {
    const option = cleanString(entry, MAX_OPTION_CHARS);
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
    if (options.length >= MAX_OPTIONS) break;
  }

  return options;
}

/**
 * Turns one generated entry into something the questions route would accept, or
 * null.
 *
 * Nothing here trusts a field: the kind is taken from an allowlist, every string
 * is length-capped, and a knockout is only honoured when it has a comparable
 * expected answer — otherwise the flag would sit in the database doing nothing
 * while reading as if it screened somebody.
 */
function readSuggestion(raw: unknown): Suggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  const prompt = cleanString(entry.prompt, MAX_PROMPT_CHARS);
  if (!prompt) return null;

  const kindValue = typeof entry.kind === 'string' ? entry.kind.toUpperCase() : 'TEXT';
  let kind: Kind = (KINDS as readonly string[]).includes(kindValue) ? (kindValue as Kind) : 'TEXT';

  let options: string[] = [];
  if (kind === 'SINGLE_CHOICE') {
    options = cleanChoices(entry.options);
    // A choice question with nothing to choose from is a text question that
    // renders as a broken dropdown. Demote rather than discard: the prompt is
    // usually still worth offering.
    if (options.length < MIN_OPTIONS) {
      kind = 'TEXT';
      options = [];
    }
  } else if (kind === 'BOOLEAN') {
    options = [...BOOLEAN_ANSWERS];
  }

  const statedExpected = cleanString(entry.expected, MAX_EXPECTED_CHARS);
  let expected: string | null = null;
  if (statedExpected) {
    const wanted = statedExpected.toLowerCase();
    if (kind === 'SINGLE_CHOICE') {
      expected = options.find((option) => option.toLowerCase() === wanted) ?? null;
    } else if (kind === 'BOOLEAN') {
      expected = BOOLEAN_ANSWERS.find((answer) => answer.toLowerCase() === wanted) ?? null;
    }
    // TEXT and NUMBER answers have no single correct form, so no expected value
    // is carried for them and they can never arrive pre-set as a knockout.
  }

  return {
    prompt,
    kind,
    options,
    required: true,
    knockout: entry.knockout === true && expected !== null,
    expected,
    rationale: cleanText(entry.rationale, MAX_RATIONALE_CHARS) ?? '',
  };
}

/**
 * The outbound control.
 *
 * Every string the employer would ever see — the prompt, each choice, the
 * expected answer and the rationale — is checked against the denylist, and the
 * whole suggestion goes if any of them trips. Per-field redaction was the
 * alternative and is worse: a question whose prompt is clean but whose choices
 * are "Married / Single" is still an unlawful question, and stripping the
 * choices would leave a prompt that only makes sense with them.
 */
function isSafeToSuggest(suggestion: Suggestion): boolean {
  if (containsProtectedTerm(suggestion.prompt)) return false;
  if (containsProtectedTerm(suggestion.rationale)) return false;
  if (containsProtectedTerm(suggestion.expected)) return false;
  return !suggestion.options.some((option) => containsProtectedTerm(option));
}

/* -------------------------------------------------------------------------- */
/* Route                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/ai/screening — suggest screening questions.
 *
 * Takes either a `jobId` the caller owns, or the draft fields straight from the
 * post form so an unsaved posting can be worked on too.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard.response;
  const { session } = guard;

  if (!isAiEnabled()) return aiUnavailable();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const count = Math.max(
    1,
    Math.min(MAX_SUGGESTIONS, Number(body.count) || DEFAULT_SUGGESTIONS)
  );

  let title = cleanString(body.title, 150);
  let description = cleanText(body.description, 10_000);
  let skills = cleanTagList(body.skills, 25);
  let location: string | null = cleanString(body.location, 120);
  let experience: string | null = cleanString(body.experience, 60);

  try {
    // A named job wins over anything in the body — and only after the session is
    // checked against the job's owning company. `body.companyId` is never read.
    if (body.jobId !== undefined) {
      if (!isUuid(body.jobId)) return badRequest('Invalid job id');

      const job = await prisma.job.findUnique({
        where: { id: body.jobId },
        select: {
          title: true,
          description: true,
          skills: true,
          location: true,
          experience: true,
          companyId: true,
        },
      });
      if (!job) return notFound('Job not found');
      if (session.role !== 'ADMIN' && job.companyId !== session.companyId) {
        return forbidden('You can only draft questions for your own postings');
      }

      title = job.title;
      description = cleanText(job.description, 10_000);
      skills = job.skills ?? [];
      location = job.location;
      experience = job.experience;
    }

    if (!title) return badRequest('A job title is required');

    const context = [
      `Job title: ${title}`,
      location ? `Location: ${location}` : '',
      experience ? `Experience level: ${experience}` : '',
      skills.length > 0 ? `Skills: ${skills.join(', ')}` : '',
      description ? `\nPosting:\n${description}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const draft = await generateJson<ScreeningDraft>({
      prompt: [
        'Draft screening questions for this role.',
        '',
        context,
        '',
        `Return up to ${count} questions, most useful first. Each has:`,
        '- prompt: the question, under 300 characters, answerable in one short answer.',
        '- kind: TEXT, BOOLEAN, SINGLE_CHOICE or NUMBER. Prefer BOOLEAN or',
        '  SINGLE_CHOICE where the answer is genuinely closed, so it can be compared.',
        `- options: ${MIN_OPTIONS} to ${MAX_OPTIONS} choices for SINGLE_CHOICE; an empty list otherwise.`,
        '- knockout: true only where a specific answer is a hard requirement the',
        '  posting itself states. Most questions are not knockouts.',
        '- expected: for a knockout, the answer that passes - one of the options for',
        '  SINGLE_CHOICE, or Yes/No for BOOLEAN. Empty string otherwise.',
        '- rationale: one short sentence on what the question is really probing.',
        '',
        'Ground every question in the posting above. Ask nothing about a protected',
        'characteristic, directly or indirectly.',
      ].join('\n'),
      schema: SCREENING_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.3,
    });

    if (!draft) return aiFailed();

    const raw = Array.isArray(draft.questions) ? draft.questions : [];
    const questions: Suggestion[] = [];
    const seen = new Set<string>();
    let filtered = 0;

    for (const entry of raw) {
      if (questions.length >= count) break;

      const suggestion = readSuggestion(entry);
      if (!suggestion) continue;

      if (!isSafeToSuggest(suggestion)) {
        // Logged without the text: this is the signal that the prompt alone was
        // not holding, and it is worth knowing how often it happens.
        console.warn('POST /api/ai/screening dropped a suggestion on the protected-term check');
        filtered += 1;
        continue;
      }

      const key = suggestion.prompt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(suggestion);
    }

    return NextResponse.json({
      questions,
      // Reported rather than hidden, so a deployment can see the outbound filter
      // doing work instead of assuming it never fires.
      filtered,
    });
  } catch (error) {
    console.error('POST /api/ai/screening failed:', error);
    return serverError('Could not draft screening questions');
  }
}
