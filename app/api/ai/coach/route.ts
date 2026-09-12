import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { Type } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, forbidden, notFound, serverError, isUuid } from '@/lib/auth';
import { cleanString, cleanText, cleanTagList } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJson } from '@/lib/ai/gemini';
import { buildJobDocument, buildProfileDocument } from '@/lib/ai/documents';
import { computeMatchAsync, loadProfileContext, type MatchBreakdown } from '@/lib/ai/matching';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';

/**
 * Seeker-side career coaching against one posting: gap analysis, a cover letter
 * draft, and interview preparation.
 *
 * The three modes share one route because they share everything that matters —
 * the same two grounding blocks (this caller's profile, that posting), the same
 * "model output is untrusted" sanitising, and the same rule that nothing here is
 * load-bearing. Splitting them would have meant three copies of the loader and
 * three chances for one of them to drift off the grounding rules.
 *
 * The profile is always the caller's own: no user id is accepted from the
 * client, so there is no shape of request that coaches one seeker on another
 * seeker's history.
 */

// Three generation calls' worth of headroom over the default budget; the letter
// in particular is the longest thing the model writes anywhere in the product.
export const maxDuration = 45;

const MODES = ['gap', 'letter', 'interview'] as const;
type Mode = (typeof MODES)[number];

/** The posting body is user-authored and unbounded; the prompt is not. */
const MAX_JOB_DESCRIPTION_CHARS = 6000;

/* -------------------------------------------------------------------------- */
/* Grounding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The rules every mode inherits.
 *
 * Written in the same voice as the résumé parser's instruction, because it is
 * the same promise: what comes back describes the documents it was given and
 * nothing else.
 */
const BASE_INSTRUCTION =
  'You are a careers adviser inside a job portal, writing directly to the ' +
  'candidate about one specific posting. Use only the facts in the CANDIDATE ' +
  'PROFILE and JOB POSTING blocks you are given. Never invent employers, job ' +
  'titles, dates, degrees, certifications, metrics or achievements, and never ' +
  'mention or infer age, gender, nationality, marital status, religion, health ' +
  'or any other protected characteristic. Where the blocks do not support a ' +
  'claim, say less rather than guessing. Write plain factual English with no ' +
  'marketing language, no markdown and no emoji.';

const GAP_INSTRUCTION =
  `${BASE_INSTRUCTION} Be candid and specific: a gap the candidate can act on ` +
  'is worth more to them than reassurance. Judge the profile as evidence — ' +
  'something the profile does not mention is unevidenced, which is not the same ' +
  'as the candidate not having it, so phrase gaps as "your profile does not show ' +
  'X" rather than "you lack X".';

/**
 * The strictest instruction in the product.
 *
 * A cover letter is the one thing here that leaves the portal in the
 * candidate's own name, in front of an employer, as a first-person claim about
 * their career. A fabricated employer or degree in a match score is a bad
 * number; the same fabrication in a letter is the candidate lying on their
 * application without knowing it. Hence: no fact that is not traceable to a
 * line of the profile block, and no bracketed placeholders either — a
 * placeholder is just a fabrication the model is asking the user to sign off.
 */
const LETTER_INSTRUCTION =
  `${BASE_INSTRUCTION} You are drafting a cover letter the candidate will send ` +
  'under their own name, so every statement in it must be traceable to a line ' +
  'of the CANDIDATE PROFILE block. You may select from and rephrase those ' +
  'facts; you may not add to them. Specifically: do not name any employer, ' +
  'client, product, project, school, degree, certification, award, tool, date, ' +
  'duration or number that the profile does not state. Do not write phrases ' +
  'such as "at my current company" or "over the past five years" unless the ' +
  'profile says so. Do not claim familiarity with anything the posting asks for ' +
  'that the profile does not evidence — leave it out of the letter and list it ' +
  'under omitted instead. Never emit a bracketed placeholder such as [Company] ' +
  'or [X years] for the candidate to fill in. If the profile supports only a ' +
  'short letter, write a short letter.';

const INTERVIEW_INSTRUCTION =
  `${BASE_INSTRUCTION} Draw the questions from what the posting actually asks ` +
  'for and what the profile actually shows. Never write a question that assumes ' +
  'experience the profile does not evidence, and never suggest a question an ' +
  'interviewer would not be allowed to ask.';

/* -------------------------------------------------------------------------- */
/* Response schemas                                                            */
/* -------------------------------------------------------------------------- */

const SEVERITIES = ['Critical', 'Important', 'Nice to have'] as const;
const EFFORTS = ['Quick', 'Weeks', 'Months'] as const;
const QUESTION_KINDS = ['Technical', 'Experience', 'Behavioural', 'Role fit', 'Motivation'] as const;

const GAP_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    strengths: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { point: { type: Type.STRING }, evidence: { type: Type.STRING } },
        required: ['point', 'evidence'],
      },
    },
    gaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          requirement: { type: Type.STRING },
          why: { type: Type.STRING },
          severity: { type: Type.STRING, enum: [...SEVERITIES] },
        },
        required: ['requirement', 'why', 'severity'],
      },
    },
    nextSteps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          effort: { type: Type.STRING, enum: [...EFFORTS] },
        },
        required: ['action', 'effort'],
      },
    },
    emphasise: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['summary', 'strengths', 'gaps', 'nextSteps', 'emphasise'],
};

const LETTER_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    greeting: { type: Type.STRING },
    paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
    closing: { type: Type.STRING },
    groundedOn: { type: Type.ARRAY, items: { type: Type.STRING } },
    omitted: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['greeting', 'paragraphs', 'closing', 'groundedOn', 'omitted'],
};

const INTERVIEW_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          probes: { type: Type.STRING },
          prepare: { type: Type.STRING },
          kind: { type: Type.STRING, enum: [...QUESTION_KINDS] },
        },
        required: ['question', 'probes', 'prepare', 'kind'],
      },
    },
    askThem: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['questions', 'askThem'],
};

/* -------------------------------------------------------------------------- */
/* Raw model shapes                                                            */
/* -------------------------------------------------------------------------- */

interface RawGap {
  summary?: unknown;
  strengths?: unknown;
  gaps?: unknown;
  nextSteps?: unknown;
  emphasise?: unknown;
}

interface RawLetter {
  greeting?: unknown;
  paragraphs?: unknown;
  closing?: unknown;
  groundedOn?: unknown;
  omitted?: unknown;
}

interface RawInterview {
  questions?: unknown;
  askThem?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                  */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps a model-supplied array through a cleaner, dropping anything that comes
 * back empty and capping the length. Everything the model returns arrives here
 * first — an unbounded array is as much of a problem as an unbounded string.
 */
function cleanList<T>(value: unknown, max: number, map: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];

  const items: T[] = [];
  for (const entry of value) {
    const cleaned = map(entry);
    if (cleaned === null) continue;
    items.push(cleaned);
    if (items.length >= max) break;
  }
  return items;
}

/** Short free-text lines (a "next step", a question to ask them). */
function cleanLines(value: unknown, max: number, maxLength: number): string[] {
  return cleanList(value, max, (entry) => cleanString(entry, maxLength));
}

/** Enum fields are accepted only from the allowlist; anything else falls back. */
function cleanChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = cleanString(value, 40);
  if (!raw) return fallback;
  return allowed.find((option) => option.toLowerCase() === raw.toLowerCase()) ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Profile evidence                                                            */
/* -------------------------------------------------------------------------- */

interface SeekerProfile {
  name: string;
  headline: string | null;
  seniority: string | null;
  yearsOfExp: number | null;
  skills: string[];
  location: string | null;
  industry: string | null;
  aiSummary: string | null;
  profile: string | null;
}

/**
 * How much of a career the profile actually evidences, 0–5.
 *
 * The three modes need different amounts. Gap analysis and interview prep can
 * work off a headline and a couple of skills — "your profile shows almost
 * nothing yet" is itself the useful answer. A cover letter cannot: with nothing
 * to draw on, a model asked for a letter will write a plausible career instead
 * of refusing, which is the one failure mode this route exists to prevent. So
 * the letter is gated on a genuinely higher bar and the user is told which
 * fields would clear it.
 */
function scoreEvidence(profile: SeekerProfile): number {
  const narrative = [profile.aiSummary, profile.profile]
    .map((value) => value?.trim() ?? '')
    .join(' ')
    .trim().length;

  let score = 0;
  if (profile.headline) score += 1;
  if (profile.skills.length >= 3) score += 1;
  if (narrative >= 300) score += 2;
  else if (narrative >= 120) score += 1;
  if (profile.seniority || typeof profile.yearsOfExp === 'number') score += 1;
  return score;
}

const MIN_EVIDENCE_FOR_ADVICE = 1;
const MIN_EVIDENCE_FOR_LETTER = 3;

/** The concrete, actionable list behind a "your profile is too thin" answer. */
function missingProfileFields(profile: SeekerProfile): string[] {
  const narrative = [profile.aiSummary, profile.profile]
    .map((value) => value?.trim() ?? '')
    .join(' ')
    .trim().length;

  const missing: string[] = [];
  if (!profile.headline) missing.push('A headline saying what you do');
  if (profile.skills.length < 3) missing.push('At least three skills');
  if (narrative < 120) missing.push('A few sentences about your experience');
  if (!profile.seniority && typeof profile.yearsOfExp !== 'number') {
    missing.push('Your seniority or years of experience');
  }
  return missing;
}

/* -------------------------------------------------------------------------- */
/* Best-effort result cache                                                    */
/* -------------------------------------------------------------------------- */

/**
 * These are per-request generation calls, and the schema belongs to someone
 * else, so there is no table to cache them in. This in-process map is the
 * honest middle: it makes a double-submit, a re-mount or a user flipping back
 * to a tab free, and it disappears with the instance.
 *
 * Keyed on the two grounding documents, so editing the profile or the posting
 * invalidates the entry rather than serving advice about a career the user has
 * since changed. Nothing depends on a hit — a cold instance simply regenerates.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; body: unknown }>();

function cacheKey(mode: Mode, userId: string, jobId: string, documents: string): string {
  return createHash('sha256').update(`${mode}:${userId}:${jobId}:${documents}`).digest('hex');
}

function cacheGet(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.body;
}

function cacheSet(key: string, body: unknown): void {
  cache.set(key, { at: Date.now(), body });
  // Map iterates in insertion order, so the first key is the oldest write.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/* -------------------------------------------------------------------------- */
/* Failure responses                                                           */
/* -------------------------------------------------------------------------- */

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

function aiFailed() {
  return NextResponse.json(
    { error: 'The career coach is unavailable right now. Please try again in a moment.' },
    { status: 502 }
  );
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

/** POST /api/ai/coach — gap analysis, a cover letter draft, or interview prep. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  if (!isAiEnabled()) return aiUnavailable();

  // The expensive tier: the prompt carries a whole profile document and a whole
  // posting, and the route is the largest single generation a seeker can ask
  // for. Nobody coaches themselves five times a minute by hand.
  //
  // After the key check, so a deployment without AI is bit-for-bit unchanged.
  const limit = checkRateLimit(req, RATE_TIERS.AI_EXPENSIVE, session);
  if (!limit.ok) return rateLimited(limit);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const rawMode = body.mode;
  if (typeof rawMode !== 'string' || !(MODES as readonly string[]).includes(rawMode)) {
    return badRequest(`Choose a valid coaching mode: ${MODES.join(', ')}`);
  }
  const mode = rawMode as Mode;

  const jobId = body.jobId;
  if (!isUuid(jobId)) return badRequest('A valid job id is required');

  try {
    // `session.id` and nothing else: the caller cannot name whose profile to
    // coach, so there is no request that reaches another seeker's history.
    const [user, job] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.id },
        select: {
          role: true,
          name: true,
          headline: true,
          seniority: true,
          yearsOfExp: true,
          skills: true,
          location: true,
          industry: true,
          aiSummary: true,
          profile: true,
        },
      }),
      prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          title: true,
          description: true,
          salary: true,
          experience: true,
          location: true,
          type: true,
          skills: true,
          isActive: true,
          company: { select: { name: true } },
          // Read only to score the gap. Never serialised — see the payload below.
          embedding: { select: { vector: true } },
        },
      }),
    ]);

    // An ADMIN passes `requireRole`, but there is no seeker profile behind the
    // account, and coaching an empty one would be noise rather than advice.
    if (!user || user.role !== 'SEEKER') {
      return forbidden('Career coaching works from a job seeker profile.');
    }
    if (!job) return notFound('That job no longer exists.');

    const profile: SeekerProfile = {
      name: cleanString(user.name, 100) ?? 'the candidate',
      headline: user.headline,
      seniority: user.seniority,
      yearsOfExp: user.yearsOfExp,
      skills: user.skills ?? [],
      location: user.location,
      industry: user.industry,
      aiSummary: user.aiSummary,
      profile: user.profile,
    };

    const jobRef = {
      id: job.id,
      title: job.title,
      company: job.company?.name ?? null,
      location: job.location,
      type: job.type,
      isActive: job.isActive,
    };

    /**
     * The profile block, minus one thing `buildProfileDocument` would otherwise
     * add: the titles of roles applied to. Those are intent, not experience, and
     * a letter grounded on "roles of interest" is exactly how a model talks
     * itself into a job the candidate has never held.
     */
    const profileDocument = buildProfileDocument({
      headline: profile.headline,
      seniority: profile.seniority,
      yearsOfExp: profile.yearsOfExp,
      skills: profile.skills,
      location: profile.location,
      industry: profile.industry,
      aiSummary: profile.aiSummary,
      profile: profile.profile,
    });

    const jobDocument = buildJobDocument({
      title: job.title,
      description: cleanText(job.description, MAX_JOB_DESCRIPTION_CHARS) ?? '',
      skills: job.skills ?? [],
      location: job.location,
      type: job.type,
      experience: job.experience,
      salary: job.salary,
      companyName: job.company?.name ?? null,
    });

    const evidence = scoreEvidence(profile);
    const required = mode === 'letter' ? MIN_EVIDENCE_FOR_LETTER : MIN_EVIDENCE_FOR_ADVICE;

    if (evidence < required) {
      // Deliberately a 200, not a 4xx. Nothing failed: this is the correct
      // answer to the question asked, and the UI shows it as guidance with a
      // link to the profile editor rather than as a red error.
      return NextResponse.json({
        mode,
        job: jobRef,
        blocked: {
          reason: 'thin-profile',
          message:
            mode === 'letter'
              ? 'There is not enough in your profile yet to write a letter we can stand behind. Rather than inventing a career for you, we would rather you filled these in first.'
              : 'Your profile is too sparse to compare against this role yet. Add a little more and this becomes genuinely useful.',
          missing: missingProfileFields(profile),
        },
      });
    }

    //  (unit separator) rather than a literal NUL: a raw 0x00 byte makes
    // grep and ripgrep classify this whole file as binary and skip it silently,
    // so every codebase-wide search quietly missed 750 lines of route. Any
    // control character that cannot occur in a document works as a separator.
    const key = cacheKey(mode, session.id, job.id, `${profileDocument}${jobDocument}`);
    const cached = cacheGet(key);
    if (cached) return NextResponse.json(cached);

    const context = [
      'CANDIDATE PROFILE (the only facts you may use about the candidate)',
      profileDocument,
      '',
      'JOB POSTING',
      jobDocument,
    ].join('\n');

    let payload: Record<string, unknown> | null = null;

    if (mode === 'gap') {
      payload = await runGap(context, session.id, job, jobRef);
    } else if (mode === 'letter') {
      payload = await runLetter(context, profile, jobRef);
    } else {
      payload = await runInterview(context, jobRef);
    }

    if (!payload) return aiFailed();

    cacheSet(key, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('POST /api/ai/coach failed:', error);
    return serverError('We could not prepare your coaching notes. Please try again.');
  }
}

/* -------------------------------------------------------------------------- */
/* Modes                                                                       */
/* -------------------------------------------------------------------------- */

type JobRef = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  type: string | null;
  isActive: boolean;
};

/**
 * Gap analysis.
 *
 * The stored match breakdown goes into the prompt as a hint and comes back in
 * the payload as context: the score is what sent the user here, and answering
 * "why is this 61%" with prose that ignores the 61% would read as two unrelated
 * opinions about the same role.
 */
async function runGap(
  context: string,
  userId: string,
  job: {
    skills: string[];
    location: string | null;
    experience: string | null;
    embedding: { vector: number[] } | null;
  },
  jobRef: JobRef
): Promise<Record<string, unknown> | null> {
  let match: MatchBreakdown | null = null;
  try {
    const profileContext = await loadProfileContext(userId);
    if (profileContext) {
      // The whole output of this screen is the missing-skills narrative, so it
      // has to agree with the detail page it is explaining. One pair, on a path
      // that already makes a generate call, so the extra embed is free by
      // comparison.
      match = await computeMatchAsync(profileContext, {
        vector: job.embedding?.vector ?? null,
        skills: job.skills ?? [],
        location: job.location,
        experience: job.experience,
      });
    }
  } catch (error) {
    // The score is context, not the answer. A missing vector must not cost the
    // user the advice they actually asked for.
    console.error('POST /api/ai/coach match context failed:', error);
  }

  const hints: string[] = [];
  if (match) {
    hints.push('', `Computed fit score: ${match.score}/100.`);
    if (match.sharedSkills.length) {
      hints.push(`Skills on both sides: ${match.sharedSkills.join(', ')}.`);
    }
    if (match.missingSkills.length) {
      hints.push(`Skills the posting names that the profile does not: ${match.missingSkills.join(', ')}.`);
    }
  }

  const draft = await generateJson<RawGap>({
    prompt: [
      'Compare this candidate with this posting and write a gap analysis they can act on.',
      '',
      context,
      ...hints,
      '',
      'Return:',
      '- summary: two or three sentences on how this candidate lines up with this role, naming the single biggest thing standing between them and it.',
      '- strengths: up to 5 things the profile already demonstrates for this role. Each has a point (what they have) and evidence (the line of the profile that shows it).',
      '- gaps: up to 6 things the posting asks for that the profile does not evidence. Each has a requirement (short, in the posting\'s own words), a why (one sentence on why this role needs it), and a severity of Critical, Important or Nice to have.',
      '- nextSteps: up to 5 concrete actions, most useful first, each with an effort of Quick, Weeks or Months. Prefer things that close a gap listed above. "Add X to your profile" is a valid step when the gap is evidence rather than ability.',
      '- emphasise: up to 8 short tags naming what this candidate should foreground in an application for this role. Only things the profile already supports.',
    ].join('\n'),
    schema: GAP_SCHEMA,
    systemInstruction: GAP_INSTRUCTION,
    temperature: 0.3,
  });

  if (!draft) return null;

  const summary = cleanText(draft.summary, 800);
  const strengths = cleanList(draft.strengths, 5, (entry) => {
    if (!isRecord(entry)) return null;
    const point = cleanString(entry.point, 160);
    if (!point) return null;
    return { point, evidence: cleanString(entry.evidence, 240) ?? '' };
  });
  const gaps = cleanList(draft.gaps, 6, (entry) => {
    if (!isRecord(entry)) return null;
    const requirement = cleanString(entry.requirement, 140);
    if (!requirement) return null;
    return {
      requirement,
      why: cleanString(entry.why, 240) ?? '',
      severity: cleanChoice(entry.severity, SEVERITIES, 'Important'),
    };
  });
  const nextSteps = cleanList(draft.nextSteps, 5, (entry) => {
    if (!isRecord(entry)) return null;
    const action = cleanString(entry.action, 220);
    if (!action) return null;
    return { action, effort: cleanChoice(entry.effort, EFFORTS, 'Weeks') };
  });

  // Nothing left after sanitising means the reply was unusable, not that this
  // candidate is a perfect fit — say so rather than rendering an empty panel.
  if (!summary && strengths.length === 0 && gaps.length === 0) return null;

  return {
    mode: 'gap' as const,
    job: jobRef,
    match,
    gap: {
      summary: summary ?? '',
      strengths,
      gaps,
      nextSteps,
      emphasise: cleanTagList(draft.emphasise, 8),
    },
  };
}

/** The cover letter. See `LETTER_INSTRUCTION` for why this one is the strict one. */
async function runLetter(
  context: string,
  profile: SeekerProfile,
  jobRef: JobRef
): Promise<Record<string, unknown> | null> {
  const draft = await generateJson<RawLetter>({
    prompt: [
      `Draft a cover letter for ${profile.name} to send for this role.`,
      '',
      context,
      '',
      'Return:',
      `- greeting: one line addressed to the hiring team${jobRef.company ? ` at ${jobRef.company}` : ''}. No name unless the posting gives one.`,
      '- paragraphs: three or four short paragraphs, first person, under 120 words each. Open with the role being applied for and why it fits; then the profile facts that are relevant to it; then what the candidate is looking for. Every claim must come from the CANDIDATE PROFILE block.',
      `- closing: one closing line, then the candidate's name on its own: ${profile.name}. No address, phone number or email.`,
      '- groundedOn: up to 8 short phrases naming the profile facts you used. This is an audit trail — if it is not in the profile block, it must not be here or in the letter.',
      '- omitted: up to 5 short phrases naming things this posting asks for that you deliberately left out because the profile does not evidence them.',
    ].join('\n'),
    schema: LETTER_SCHEMA,
    // Lowest temperature in the product. This is not a creative writing task:
    // the more freely the model writes, the more it fills gaps with invention.
    temperature: 0.2,
    systemInstruction: LETTER_INSTRUCTION,
  });

  if (!draft) return null;

  const greeting = cleanString(draft.greeting, 160);
  const paragraphs = cleanList(draft.paragraphs, 5, (entry) => cleanText(entry, 1200));
  const closing = cleanText(draft.closing, 300);

  // A letter with no body is not a short letter, it is a failed one.
  if (paragraphs.length === 0) return null;

  return {
    mode: 'letter' as const,
    job: jobRef,
    letter: {
      greeting: greeting ?? 'Dear Hiring Team,',
      paragraphs,
      closing: closing ?? profile.name,
      groundedOn: cleanLines(draft.groundedOn, 8, 140),
      omitted: cleanLines(draft.omitted, 5, 140),
    },
  };
}

/** Likely questions, and what each one is really probing for. */
async function runInterview(
  context: string,
  jobRef: JobRef
): Promise<Record<string, unknown> | null> {
  const draft = await generateJson<RawInterview>({
    prompt: [
      'Prepare this candidate for an interview for this role.',
      '',
      context,
      '',
      'Return:',
      '- questions: up to 8 questions this candidate is likely to be asked for this specific role, hardest-to-prepare first. Each has a question (as an interviewer would phrase it), a probes (one sentence on what the interviewer is really assessing), a prepare (one or two sentences on what this candidate specifically should have ready, drawing on their profile), and a kind of Technical, Experience, Behavioural, Role fit or Motivation.',
      '- askThem: up to 5 questions worth asking the interviewer, drawn from what this posting leaves unsaid.',
    ].join('\n'),
    schema: INTERVIEW_SCHEMA,
    systemInstruction: INTERVIEW_INSTRUCTION,
    temperature: 0.4,
  });

  if (!draft) return null;

  const questions = cleanList(draft.questions, 8, (entry) => {
    if (!isRecord(entry)) return null;
    const question = cleanString(entry.question, 300);
    if (!question) return null;
    return {
      question,
      probes: cleanString(entry.probes, 260) ?? '',
      prepare: cleanString(entry.prepare, 340) ?? '',
      kind: cleanChoice(entry.kind, QUESTION_KINDS, 'Role fit'),
    };
  });

  if (questions.length === 0) return null;

  return {
    mode: 'interview' as const,
    job: jobRef,
    interview: {
      questions,
      askThem: cleanLines(draft.askThem, 5, 220),
    },
  };
}
