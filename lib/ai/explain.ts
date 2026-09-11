import { Type } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { cleanString } from '@/lib/validation';
import { TEXT_MODEL, isAiEnabled } from './config';
import { contentHash } from './documents';
import { generateJson } from './gemini';
import { computeMatch, loadProfileContext, type MatchBreakdown } from './matching';

/**
 * One grounded sentence explaining why a seeker matches a posting.
 *
 * The number on the job page is a weighted blend of four facets, and a bare
 * "84%" invites distrust — this turns the breakdown that produced it into a
 * sentence. What makes the sentence trustworthy is that the model never sees
 * the CV or the posting: its whole input is the breakdown `computeMatch`
 * already returned. It therefore cannot assert an overlap the score does not
 * contain, and the words and the number cannot drift apart.
 *
 * Cached per `(userId, jobId)` and invalidated by `contentHash`, so a pair
 * costs one generation call for as long as neither side materially changes.
 */

/**
 * Bumped whenever the prompt or the facts document below changes shape.
 *
 * It occupies the slot `lib/ai/documents.ts` gives the vector width, and for
 * the same reason: it is the other input that changes the output for identical
 * source text, so a hash stored under the previous prompt must not look fresh.
 */
const PROMPT_VERSION = 1;

/** Hard cap on the stored sentence. Model output is untrusted input. */
export const MAX_EXPLANATION_CHARS = 240;

/** Below this there is no sentence left worth showing. */
const MIN_EXPLANATION_CHARS = 20;

export interface ExplainJob {
  title: string;
  companyName: string | null;
}

export interface StoredExplanation {
  jobId: string;
  text: string;
  /** The score the sentence was written about — always the one the UI shows. */
  score: number;
  /** True when this came out of the cache rather than off a fresh call. */
  cached: boolean;
}

/**
 * Why an explanation could not be produced, so the route can answer honestly
 * rather than invent a sentence.
 *
 * `no-match` is not a failure: `computeMatch` returns null when there is no
 * semantic signal on either side, and there is then genuinely nothing to
 * explain — the job page shows no score in that case either.
 */
export type ExplainOutcome =
  | { status: 'ok'; explanation: StoredExplanation }
  | { status: 'no-match' }
  | { status: 'disabled' }
  | { status: 'unavailable' };

/* -------------------------------------------------------------------------- */
/* The facts the model is allowed to see                                       */
/* -------------------------------------------------------------------------- */

/**
 * Labelled prose, in the same shape as the embedded documents next door and for
 * the same reason — the model reads natural language better than it reads JSON.
 *
 * This string is both the prompt input and the cache key, which is deliberate:
 * everything that would change the sentence is in here, and everything in here
 * changes the hash. Add a fact to the prompt and the cache invalidates itself.
 */
export function buildMatchFacts(job: ExplainJob, match: MatchBreakdown): string {
  const lines: string[] = [`Role: ${job.title}.`];

  if (job.companyName) lines.push(`Company: ${job.companyName}.`);

  lines.push(
    `Overall match: ${match.score} out of 100.`,
    'Facet scores out of 100 — ' +
      `semantic fit: ${match.facets.semantic}, ` +
      `skills overlap: ${match.facets.skills}, ` +
      `location fit: ${match.facets.location}, ` +
      `seniority fit: ${match.facets.seniority}.`
  );

  lines.push(
    match.sharedSkills.length
      ? `Skills present on both sides: ${match.sharedSkills.join(', ')}.`
      : 'Skills present on both sides: none recorded.'
  );

  lines.push(
    match.missingSkills.length
      ? `Skills the posting asks for that the profile does not list: ${match.missingSkills.join(', ')}.`
      : 'The posting asks for no skill the profile is missing.'
  );

  return lines.join('\n');
}

/** Fingerprint of the facts, so an unchanged pair never pays for a second call. */
export function explanationHash(facts: string): string {
  return contentHash(facts, TEXT_MODEL, PROMPT_VERSION);
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

const EXPLANATION_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: { explanation: { type: Type.STRING } },
  required: ['explanation'],
};

const SYSTEM_INSTRUCTION =
  'You write one short sentence describing the overlap between a candidate profile ' +
  'and a job posting, for a job portal. You are given a scored breakdown and nothing ' +
  'else: use only the facts in it. Never invent skills, employers, titles, years of ' +
  'experience or credentials, and never refer to anything you were not given. ' +
  'The sentence describes the fit between a profile and a posting — it is never a ' +
  'verdict on the person. Do not say whether they are qualified, a strong candidate ' +
  'or likely to be hired, and do not tell them to apply or not to apply. State missing ' +
  'skills neutrally, as things the posting asks for that the profile does not list, ' +
  'never as deficiencies. Never mention age, gender, nationality or any other ' +
  'protected characteristic.';

const PROMPT_INSTRUCTIONS = [
  '',
  'Write one sentence of at most 200 characters, addressing the candidate as "you".',
  'Name the strongest one or two areas of overlap, drawn from the shared skills and',
  'the facets that scored highest. If there are missing skills, name at most two of',
  'them as something the role asks for that the profile does not list.',
  'Describe the scores rather than quoting the numbers back.',
  'No preamble, no bullet points, no quotation marks.',
].join('\n');

interface ExplanationReply {
  explanation: string;
}

/**
 * Model output is untrusted: collapse it to a single line, length-cap it, and
 * reject anything that survives sanitising with nothing usable left.
 */
function cleanExplanation(value: unknown): string | null {
  // `cleanString` collapses newlines as well as spaces, which is what we want
  // here — a stray list from the model becomes one line rather than a layout
  // break in the sidebar.
  const text = cleanString(value, MAX_EXPLANATION_CHARS);
  if (!text || text.length < MIN_EXPLANATION_CHARS) return null;

  // A cap that lands mid-word reads as a bug, so cut back to the last boundary.
  if (text.length < MAX_EXPLANATION_CHARS) return text;
  const lastBreak = text.lastIndexOf(' ');
  const trimmed = lastBreak > MAX_EXPLANATION_CHARS * 0.7 ? text.slice(0, lastBreak) : text;
  return `${trimmed.replace(/[\s,;:—-]+$/, '')}…`;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const JOB_SELECT = {
  id: true,
  title: true,
  skills: true,
  location: true,
  experience: true,
  company: { select: { name: true } },
  embedding: { select: { vector: true } },
} as const;

/**
 * Explains `userId`'s match against `jobId`, from cache wherever possible.
 *
 * The score is recomputed here rather than accepted from the caller: the
 * sentence has to be about the number the portal itself would show, and a score
 * arriving in a request body is a number the client chose.
 *
 * The job vector is loaded to score against and then dropped on the floor —
 * nothing in the returned shape carries it.
 */
export async function explainMatch(userId: string, jobId: string): Promise<ExplainOutcome> {
  const [profile, job] = await Promise.all([
    loadProfileContext(userId),
    prisma.job.findUnique({ where: { id: jobId }, select: JOB_SELECT }),
  ]);

  if (!profile || !job) return { status: 'no-match' };

  const match = computeMatch(profile, {
    vector: job.embedding?.vector ?? null,
    skills: job.skills ?? [],
    location: job.location,
    experience: job.experience,
  });

  if (!match) return { status: 'no-match' };

  const facts = buildMatchFacts({ title: job.title, companyName: job.company?.name ?? null }, match);
  const hash = explanationHash(facts);

  // The cache is read before the AI gate on purpose: a sentence already stored
  // is ordinary data, and unsetting the API key should not blank out the
  // explanations that were paid for while it was set.
  const cached = await prisma.matchExplanation.findUnique({
    where: { userId_jobId: { userId, jobId } },
    select: { text: true, score: true, contentHash: true },
  });

  if (cached && cached.contentHash === hash) {
    // The score is part of the hashed facts, so a hash hit guarantees the stored
    // score is still the live one — a cached sentence cannot describe a stale
    // number, which is the whole reason the score is in the document.
    return {
      status: 'ok',
      explanation: { jobId, text: cached.text, score: cached.score, cached: true },
    };
  }

  if (!isAiEnabled()) return { status: 'disabled' };

  const reply = await generateJson<ExplanationReply>({
    prompt: `${facts}\n${PROMPT_INSTRUCTIONS}`,
    schema: EXPLANATION_SCHEMA,
    systemInstruction: SYSTEM_INSTRUCTION,
    // Low, but not zero: this is one sentence of prose. It still has to stay
    // tied to the facts rather than reach for a livelier phrasing of them.
    temperature: 0.3,
  });

  const text = cleanExplanation(reply?.explanation);
  if (!text) return { status: 'unavailable' };

  // Upsert rather than create: the row is keyed by the pair, so a re-score after
  // a profile edit replaces the sentence instead of accumulating rows.
  await prisma.matchExplanation.upsert({
    where: { userId_jobId: { userId, jobId } },
    create: { userId, jobId, text, score: match.score, contentHash: hash },
    update: { text, score: match.score, contentHash: hash },
  });

  return { status: 'ok', explanation: { jobId, text, score: match.score, cached: false } };
}
