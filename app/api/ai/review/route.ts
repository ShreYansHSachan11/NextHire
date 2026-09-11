import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, forbidden, notFound, serverError, isUuid } from '@/lib/auth';
import { cleanString, cleanText } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJson } from '@/lib/ai/gemini';
import { stripProtectedSentences, withoutProtectedTerms } from '@/lib/ai/fairness';

/**
 * Company-side review help. Two modes, both advisory.
 *
 * `inclusivity` reads a draft posting back to its author: phrasing that narrows
 * the pool, requirements nobody asked whether the role needs, jargon only an
 * insider parses. It never gates the post route — the employer can publish
 * whatever they like, and a review that failed is simply a review that did not
 * happen.
 *
 * `pipeline` describes the shape of an applicant pool. It is framed throughout
 * as a sorting aid rather than a verdict, matching how `match` is already framed
 * on the applications page, and it is fed an anonymised view of the pool so the
 * model has nothing to be prejudiced about in the first place.
 */

export const maxDuration = 30;

const MODES = ['inclusivity', 'pipeline'] as const;
type Mode = (typeof MODES)[number];

/* -------------------------------------------------------------------------- */
/* Caps — model output is untrusted, so every field has a ceiling              */
/* -------------------------------------------------------------------------- */

const MAX_FINDINGS = 8;
/** Long enough for a full sentence of quoted posting, short enough to locate. */
const MAX_PHRASE_CHARS = 200;
const MAX_REWRITE_CHARS = 300;
const MAX_NOTE_CHARS = 300;
const MAX_SUMMARY_CHARS = 400;

const MAX_OVERVIEW_CHARS = 700;
const MAX_POINTS = 6;
const MAX_POINT_CHARS = 200;

/**
 * How many applicants are described to the model. A pool larger than this is
 * sampled by recency: the prompt is meant to characterise the pool, and past a
 * few dozen rows another hundred adds tokens rather than shape.
 */
const PIPELINE_SAMPLE = 60;

/** Findings are only useful when the employer knows which bucket they are in. */
const FINDING_CATEGORIES = ['exclusionary', 'requirement', 'jargon'] as const;
type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

const INCLUSIVITY_SYSTEM =
  'You review job postings for a hiring portal and report what narrows the ' +
  'applicant pool without cause. You are advisory: you never decide whether a ' +
  'posting may be published, and you never rewrite it wholesale. Quote the ' +
  'offending words exactly as they appear in the posting - verbatim, character ' +
  'for character, never paraphrased - and give one concrete replacement that ' +
  'keeps the employer\'s meaning and voice. Flag only what you can point at: ' +
  'gendered or coded language, culture-fit and "rockstar" framing, arbitrary ' +
  'degree or years-of-experience demands the described work does not need, ' +
  'physical or availability requirements unrelated to the job, and jargon or ' +
  'internal acronyms an outsider cannot parse. Do not invent problems in a clean ' +
  'posting, do not comment on salary levels or company policy, and do not ' +
  'suggest wording that asks about any protected characteristic.';

const PIPELINE_SYSTEM =
  'You summarise the shape of an applicant pool for the employer who posted the ' +
  'role. You are a sorting aid, not a verdict. Describe the pool in aggregate: ' +
  'what kinds of background it contains, which skills recur, where the posting ' +
  'asks for something the pool has little of. Never rank, grade or label any ' +
  'individual, never call a candidate strong, weak, good or bad, and never ' +
  'recommend who to advance or reject - that decision is the employer\'s and you ' +
  'do not have the evidence for it. Never mention, infer or allude to age, race, ' +
  'ethnicity, national origin, religion, sex, gender, sexual orientation, ' +
  'disability, health, pregnancy, marital or family status, or any other ' +
  'protected characteristic, and never speculate about them from names, ' +
  'locations, schools or gaps in a history. Write about the pool, not about ' +
  'people. Say plainly when the pool is too small to characterise.';

const INCLUSIVITY_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phrase: { type: Type.STRING },
          category: { type: Type.STRING },
          why: { type: Type.STRING },
          rewrite: { type: Type.STRING },
        },
        required: ['phrase', 'category', 'why', 'rewrite'],
      },
    },
    summary: { type: Type.STRING },
  },
  required: ['findings', 'summary'],
};

const PIPELINE_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    overview: { type: Type.STRING },
    commonStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    notableGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    whatToProbe: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['overview', 'commonStrengths', 'notableGaps', 'whatToProbe'],
};

interface RawFinding {
  phrase?: unknown;
  category?: unknown;
  why?: unknown;
  rewrite?: unknown;
}

interface InclusivityDraft {
  findings?: unknown;
  summary?: unknown;
}

interface PipelineDraft {
  overview?: unknown;
  commonStrengths?: unknown;
  notableGaps?: unknown;
  whatToProbe?: unknown;
}

/** A finding the client can act on: the phrase is known to exist in the draft. */
interface Finding {
  phrase: string;
  category: FindingCategory;
  why: string;
  rewrite: string;
}

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

function aiFailed(what: string) {
  return NextResponse.json(
    { error: `The ${what} is unavailable right now. Please try again in a moment.` },
    { status: 502 }
  );
}

/* -------------------------------------------------------------------------- */
/* Inclusivity                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keeps only findings whose quoted phrase is genuinely in the draft.
 *
 * This is the control that makes one-click apply safe. The client applies a
 * rewrite by replacing `phrase` with `rewrite` in the textarea, so a
 * paraphrased or hallucinated quote would either silently do nothing or, worse,
 * match somewhere the model never meant. Locating the phrase here — and
 * returning the employer's own casing rather than the model's — means the
 * client only ever holds substrings that came out of the posting it sent.
 */
function locateFindings(value: unknown, description: string): Finding[] {
  if (!Array.isArray(value)) return [];

  const haystack = description.toLowerCase();
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const entry of value as RawFinding[]) {
    if (findings.length >= MAX_FINDINGS) break;
    if (!entry || typeof entry !== 'object') continue;

    const quoted = cleanText(entry.phrase, MAX_PHRASE_CHARS);
    const rewrite = cleanText(entry.rewrite, MAX_REWRITE_CHARS);
    const why = cleanText(entry.why, MAX_NOTE_CHARS);
    if (!quoted || !rewrite || !why) continue;

    const at = haystack.indexOf(quoted.toLowerCase());
    if (at === -1) continue; // Not actually in the posting — drop it.

    // The verbatim slice, so the client's replace is an exact string match.
    const phrase = description.slice(at, at + quoted.length);
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // A "rewrite" identical to the phrase is a no-op the employer would click
    // and see nothing happen.
    if (rewrite.toLowerCase() === key) continue;

    const category = (FINDING_CATEGORIES as readonly string[]).includes(
      typeof entry.category === 'string' ? entry.category.toLowerCase() : ''
    )
      ? ((entry.category as string).toLowerCase() as FindingCategory)
      : 'exclusionary';

    findings.push({ phrase, category, why, rewrite });
  }

  return findings;
}

async function reviewInclusivity(body: Record<string, unknown>) {
  const title = cleanString(body.title, 150);
  const description = cleanText(body.description, 10_000);
  if (!description) return badRequest('A job description is required to review');

  const context = [
    title ? `Job title: ${title}` : 'Job title: not given',
    '',
    'Posting:',
    description,
  ].join('\n');

  const draft = await generateJson<InclusivityDraft>({
    prompt: [
      'Review this job posting and report what would narrow its applicant pool',
      'without the work requiring it.',
      '',
      context,
      '',
      'Return:',
      `- findings: at most ${MAX_FINDINGS} entries, most important first. Each one has`,
      '  phrase (the exact words copied from the posting above, unchanged),',
      '  category (exclusionary, requirement or jargon),',
      '  why (one sentence on who this turns away and why the role does not need it),',
      '  rewrite (the replacement text for that phrase alone, in the same voice).',
      '  If the posting is already clean, return an empty list rather than padding it.',
      '- summary: one or two sentences on the posting overall. Say so plainly when',
      '  there is nothing to change.',
    ].join('\n'),
    schema: INCLUSIVITY_SCHEMA,
    systemInstruction: INCLUSIVITY_SYSTEM,
    temperature: 0.2,
  });

  if (!draft) return aiFailed('inclusivity check');

  const findings = locateFindings(draft.findings, description);
  const summary = cleanText(draft.summary, MAX_SUMMARY_CHARS);

  return NextResponse.json({
    mode: 'inclusivity',
    findings,
    summary: summary ?? '',
    // Said out loud in the payload as well as the UI: nothing here gates the
    // post route, and a client that ignores this response is behaving correctly.
    advisory: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

interface PoolRow {
  headline: string | null;
  seniority: string | null;
  yearsOfExp: number | null;
  skills: string[];
  aiSummary: string | null;
  status: string;
}

interface PoolStats {
  total: number;
  withProfile: number;
  byStatus: Record<string, number>;
  topSkills: { skill: string; count: number }[];
  seniorityMix: { level: string; count: number }[];
}

/** Deterministic counts, computed here rather than asked of the model. */
function summarisePool(rows: PoolRow[]): PoolStats {
  const byStatus: Record<string, number> = {};
  const skillCounts = new Map<string, { label: string; count: number }>();
  const seniorityCounts = new Map<string, number>();
  let withProfile = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.headline || row.skills.length > 0 || row.aiSummary) withProfile += 1;

    for (const skill of row.skills) {
      const key = skill.toLowerCase();
      const existing = skillCounts.get(key);
      if (existing) existing.count += 1;
      else skillCounts.set(key, { label: skill, count: 1 });
    }

    if (row.seniority) {
      seniorityCounts.set(row.seniority, (seniorityCounts.get(row.seniority) ?? 0) + 1);
    }
  }

  const topSkills = [...skillCounts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8)
    .map((entry) => ({ skill: entry.label, count: entry.count }));

  const seniorityMix = [...seniorityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([level, count]) => ({ level, count }));

  return { total: rows.length, withProfile, byStatus, topSkills, seniorityMix };
}

/**
 * Describes the pool to the model without identifying anyone.
 *
 * Names, emails, résumé links and locations are all deliberately left out. Not
 * because the model is asked to ignore them — it is — but because a model that
 * never sees a name cannot infer anything from one, and the cheapest way to
 * keep a protected characteristic out of the output is to keep it out of the
 * input. What remains is what the posting is actually about.
 */
function describePool(rows: PoolRow[], stats: PoolStats): string {
  const lines: string[] = [
    `Applicants in the pool: ${stats.total}${
      rows.length < stats.total ? ` (describing the ${rows.length} most recent)` : ''
    }`,
    '',
    'Candidates, anonymised:',
  ];

  rows.forEach((row, index) => {
    const parts: string[] = [];
    if (row.headline) parts.push(row.headline);
    if (row.seniority) parts.push(`level ${row.seniority}`);
    if (typeof row.yearsOfExp === 'number') parts.push(`${row.yearsOfExp} years`);
    if (row.skills.length > 0) parts.push(`skills: ${row.skills.slice(0, 12).join(', ')}`);
    if (row.aiSummary) parts.push(row.aiSummary.slice(0, 300));

    lines.push(
      `- Candidate ${index + 1}: ${parts.length > 0 ? parts.join('. ') : 'no profile details on file'}`
    );
  });

  return lines.join('\n');
}

/** Cleans, caps and de-duplicates a generated bullet list, then filters it. */
function cleanPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const points: string[] = [];

  for (const entry of value) {
    const point = cleanText(entry, MAX_POINT_CHARS);
    if (!point) continue;
    const key = point.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
    if (points.length >= MAX_POINTS) break;
  }

  // The same outbound denylist the screening route uses: the instruction asks,
  // this enforces.
  return withoutProtectedTerms(points);
}

async function reviewPipeline(
  body: Record<string, unknown>,
  session: { role: string; companyId: string | null }
) {
  if (!isUuid(body.jobId)) return badRequest('Invalid job id');
  const jobId = body.jobId;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, title: true, companyId: true, skills: true, experience: true },
  });
  if (!job) return notFound('Job not found');

  // Ownership comes from the session, never from the body. An ADMIN may name any
  // job; a COMPANY user may only summarise their own company's pipeline.
  if (session.role !== 'ADMIN' && job.companyId !== session.companyId) {
    return forbidden('You can only summarise pipelines for your own jobs');
  }

  const applications = await prisma.application.findMany({
    where: { jobId },
    orderBy: { createdAt: 'desc' },
    select: {
      status: true,
      // Only the profile fields the posting is about. `embedding` is not
      // selected anywhere on this path — a vector must never leave the server.
      user: {
        select: {
          headline: true,
          seniority: true,
          yearsOfExp: true,
          skills: true,
          aiSummary: true,
        },
      },
    },
  });

  const rows: PoolRow[] = applications.map((application) => ({
    headline: application.user.headline,
    seniority: application.user.seniority,
    yearsOfExp: application.user.yearsOfExp,
    skills: application.user.skills ?? [],
    aiSummary: application.user.aiSummary,
    status: application.status,
  }));

  const stats = summarisePool(rows);

  // An empty or near-empty pool is a real answer, not a failure. Spending a
  // model call to be told "two people applied" helps nobody.
  if (stats.total < 3) {
    return NextResponse.json({
      mode: 'pipeline',
      jobId: job.id,
      jobTitle: job.title,
      stats,
      summary: null,
      reason: stats.total === 0 ? 'empty' : 'too-small',
    });
  }

  const draft = await generateJson<PipelineDraft>({
    prompt: [
      'Summarise the shape of this applicant pool for the employer.',
      '',
      `Role: ${job.title}`,
      job.experience ? `Experience the posting asks for: ${job.experience}` : '',
      job.skills.length > 0 ? `Skills the posting asks for: ${job.skills.join(', ')}` : '',
      '',
      describePool(rows.slice(0, PIPELINE_SAMPLE), stats),
      '',
      'Return:',
      '- overview: two or three sentences on the shape of the pool as a whole -',
      '  the kinds of background in it and how varied it is. Aggregate only.',
      `- commonStrengths: up to ${MAX_POINTS} short phrases naming what recurs across`,
      '  the pool. Ground each one in the skills and backgrounds listed above.',
      `- notableGaps: up to ${MAX_POINTS} short phrases naming what the posting asks for`,
      '  that little of the pool evidences. A gap is a question to ask, not a fault.',
      `- whatToProbe: up to ${MAX_POINTS} things worth asking about in a first screen,`,
      '  given those gaps.',
      '',
      'Describe the pool, never an individual. Do not rank anyone and do not',
      'recommend who to advance.',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: PIPELINE_SCHEMA,
    systemInstruction: PIPELINE_SYSTEM,
    temperature: 0.3,
  });

  if (!draft) return aiFailed('pipeline summary');

  // Prose gets the sentence-level filter; lists get the whole-entry filter.
  const overview = stripProtectedSentences(cleanText(draft.overview, MAX_OVERVIEW_CHARS));
  if (!overview) return aiFailed('pipeline summary');

  return NextResponse.json({
    mode: 'pipeline',
    jobId: job.id,
    jobTitle: job.title,
    stats,
    summary: {
      overview,
      commonStrengths: cleanPoints(draft.commonStrengths),
      notableGaps: cleanPoints(draft.notableGaps),
      whatToProbe: cleanPoints(draft.whatToProbe),
      // The pool may be larger than what the model was shown; say so rather than
      // letting the reader assume the summary covers everyone.
      sampled: Math.min(rows.length, PIPELINE_SAMPLE),
    },
    reason: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Route                                                                       */
/* -------------------------------------------------------------------------- */

/** POST /api/ai/review — inclusivity check on a draft, or a pipeline summary. */
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

  const mode = body.mode;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return badRequest(`Choose a valid review mode: ${MODES.join(' or ')}`);
  }

  try {
    return (mode as Mode) === 'pipeline'
      ? await reviewPipeline(body, session)
      : await reviewInclusivity(body);
  } catch (error) {
    console.error(`POST /api/ai/review (${mode}) failed:`, error);
    return serverError('Could not run the review');
  }
}
