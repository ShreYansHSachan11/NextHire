import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { requireRole, serverError } from '@/lib/auth';
import { cleanString } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJsonFromDocument } from '@/lib/ai/gemini';
import { canonicalSkill } from '@/lib/ai/skills';
import { loadResumeDocument } from '@/lib/resumes';
import {
  CHECK_AREAS,
  CHECK_STATUSES,
  PRIORITIES,
  loadMarketInsights,
  type MarketInsights,
  type ResumeReview,
} from '@/lib/resumeInsights';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';

/**
 * Resume insights for the seeker.
 *
 * GET  — what employers hiring for roles like theirs ask for, counted over the
 *        open jobs nearest their resume. No model call; cheap on every view.
 * POST — a read of the resume file itself against that demand: which of the
 *        sought-after keywords it really contains, a section-by-section check,
 *        what to fix first, and bullet points rewritten. One model call.
 *
 * Both only ever read the caller's own resume; no user id is accepted.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;

  try {
    const result = await loadMarketInsights(guard.session.id);
    if (!result.ok) return NextResponse.json({ insights: null, reason: result.reason });
    return NextResponse.json({ insights: result.insights, aiEnabled: isAiEnabled() });
  } catch (error) {
    console.error('GET /api/resume-insights failed:', error);
    return serverError('We could not load your resume insights. Please try again.');
  }
}

/* -------------------------------------------------------------------------- */
/* The resume check                                                            */
/* -------------------------------------------------------------------------- */

interface RawReview {
  score: number;
  verdict: string;
  checks: Array<{ area: string; status: string; note: string }>;
  keywordsFound: string[];
  strengths: string[];
  improvements: Array<{ title: string; detail: string; priority: string }>;
  rewrites: Array<{ before: string; after: string }>;
  searchTips: string[];
}

const REVIEW_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER },
    verdict: { type: Type.STRING },
    checks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          area: { type: Type.STRING, enum: [...CHECK_AREAS] },
          status: { type: Type.STRING, enum: [...CHECK_STATUSES] },
          note: { type: Type.STRING },
        },
        required: ['area', 'status', 'note'],
      },
    },
    keywordsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    improvements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          priority: { type: Type.STRING, enum: [...PRIORITIES] },
        },
        required: ['title', 'detail', 'priority'],
      },
    },
    rewrites: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { before: { type: Type.STRING }, after: { type: Type.STRING } },
        required: ['before', 'after'],
      },
    },
    searchTips: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['score', 'verdict', 'checks', 'keywordsFound', 'strengths', 'improvements', 'rewrites', 'searchTips'],
};

const SYSTEM_INSTRUCTION =
  'You review resumes for job seekers on a job board and tell them, plainly and ' +
  'specifically, how to make the resume stronger for the jobs they are going ' +
  'after. Base every statement on the resume itself and the market data you are ' +
  'given. Never invent employers, job titles, dates, degrees, numbers or ' +
  'achievements, and never tell the candidate to claim a skill: a missing skill ' +
  'is something to add only if they really have it. Never mention or infer age, ' +
  'gender, nationality, marital status, religion, health or any other protected ' +
  'characteristic, and never suggest adding a photo or personal details beyond ' +
  'contact information. Write in plain English to the candidate as "you", with ' +
  'no markdown and no emoji.';

function buildPrompt(market: MarketInsights): string {
  const keywords = market.keywords.map((row) => `${row.label} (${Math.round(row.share * 100)}%)`);
  const titles = market.titles.map((row) => row.label);
  const levels = market.experience
    .filter((row) => row.count > 0 && row.id !== 'not-stated')
    .map((row) => `${row.label}: ${Math.round(row.share * 100)}%`);

  return [
    `MARKET DATA - the ${market.jobsAnalysed} open jobs closest to this resume:`,
    `- Keywords employers ask for, with the share of those jobs asking: ${keywords.join(', ') || 'none found'}.`,
    `- Common job titles: ${titles.join(', ') || 'varied'}.`,
    `- Experience asked for: ${levels.join('; ') || 'mostly not stated'}.`,
    `- Remote jobs: ${Math.round(market.remoteShare * 100)}%.`,
    '',
    'Read the attached resume and return:',
    '- score: 0 to 100 for how ready this resume is for those jobs. Most real resumes score 45 to 85; reserve 90+ for ones with nothing left to fix.',
    '- verdict: one sentence saying where the resume stands and the single biggest thing holding it back.',
    `- checks: one entry for each area in ${CHECK_AREAS.join(', ')}. contact = name, email, phone, location and a profile link; summary = a short summary at the top; experience = roles with dates and what was done; skills = a clear skills section; education; results = numbers that show impact; verbs = bullets that start with strong action verbs; length = one page early in a career, two at most later; readable = plain layout hiring software can parse (no tables, columns, images or text in headers for key facts). status is good, improve or missing; note is one specific sentence about this resume.`,
    '- keywordsFound: the keywords from the market list above that the resume itself contains, written exactly as in the list. Count a keyword when the resume names it or an obvious variant (Postgres for PostgreSQL).',
    '- strengths: up to 4 short phrases naming what the resume does well.',
    '- improvements: the 3 to 6 changes that would help most, most important first. title is a short instruction; detail is one or two sentences saying exactly what to change and where. Use the market data: name keywords that are missing but that the resume suggests the person may have.',
    '- rewrites: up to 3 weak bullet points from the resume. before is copied word for word from the resume; after is a stronger version that starts with an action verb. Do not add numbers that are not in the original; where a number would help, write a placeholder such as [X%] or [N users] for the candidate to fill in.',
    '- searchTips: 2 to 4 sentences of advice for the job search itself based on the resume and the market data, such as job titles to search for, the experience range to aim at, or where the openings are.',
  ].join('\n');
}

function cleanList(value: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = cleanString(entry, maxChars);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/** Model output is untrusted input: every field is checked and capped here. */
function cleanReview(raw: RawReview, market: MarketInsights, resumeId: string): ResumeReview | null {
  const score = Number(raw.score);
  const verdict = cleanString(raw.verdict, 300);
  if (!Number.isFinite(score) || !verdict) return null;

  const checks: ResumeReview['checks'] = [];
  const seenAreas = new Set<string>();
  for (const check of Array.isArray(raw.checks) ? raw.checks : []) {
    const area = oneOf(check?.area, CHECK_AREAS);
    const status = oneOf(check?.status, CHECK_STATUSES);
    const note = cleanString(check?.note, 300);
    if (!area || !status || !note || seenAreas.has(area)) continue;
    seenAreas.add(area);
    checks.push({ area, status, note });
  }
  checks.sort((a, b) => CHECK_AREAS.indexOf(a.area) - CHECK_AREAS.indexOf(b.area));

  // Only keywords from the list we sent, in our spelling, so the page can tick
  // them off against its own table.
  const byKey = new Map(market.keywords.map((row) => [canonicalSkill(row.label), row.label]));
  const keywordsFound = [
    ...new Set(
      (Array.isArray(raw.keywordsFound) ? raw.keywordsFound : [])
        .map((entry) => (typeof entry === 'string' ? byKey.get(canonicalSkill(entry)) : undefined))
        .filter((label): label is string => !!label)
    ),
  ];

  const improvements: ResumeReview['improvements'] = [];
  for (const item of Array.isArray(raw.improvements) ? raw.improvements : []) {
    const title = cleanString(item?.title, 120);
    const detail = cleanString(item?.detail, 400);
    if (!title || !detail) continue;
    improvements.push({ title, detail, priority: oneOf(item?.priority, PRIORITIES) ?? 'medium' });
    if (improvements.length >= 6) break;
  }

  const rewrites: ResumeReview['rewrites'] = [];
  for (const item of Array.isArray(raw.rewrites) ? raw.rewrites : []) {
    const before = cleanString(item?.before, 400);
    const after = cleanString(item?.after, 400);
    if (!before || !after || before === after) continue;
    rewrites.push({ before, after });
    if (rewrites.length >= 3) break;
  }

  return {
    resumeId,
    score: Math.max(0, Math.min(100, Math.round(score))),
    verdict,
    checks,
    keywordsFound,
    strengths: cleanList(raw.strengths, 4, 120),
    improvements,
    rewrites,
    searchTips: cleanList(raw.searchTips, 4, 400),
    reviewedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  if (!isAiEnabled()) {
    return NextResponse.json({ error: 'The resume check is not available right now.' }, { status: 503 });
  }

  // Uploads a whole document to the model, so it shares the resume reader's tier.
  const limit = checkRateLimit(req, RATE_TIERS.AI_EXPENSIVE, session);
  if (!limit.ok) return rateLimited(limit);

  try {
    const market = await loadMarketInsights(session.id);
    if (!market.ok) {
      return NextResponse.json(
        {
          error:
            market.reason === 'no-profile'
              ? 'Upload your resume on the dashboard first, then check it here.'
              : 'There are not enough open jobs like yours yet to compare your resume against.',
        },
        { status: 409 }
      );
    }

    const loaded = await loadResumeDocument(session.id);
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

    const raw = await generateJsonFromDocument<RawReview>({
      data: loaded.data,
      mimeType: loaded.mimeType,
      prompt: buildPrompt(market.insights),
      schema: REVIEW_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const review = raw ? cleanReview(raw, market.insights, loaded.resume.id) : null;
    if (!review) {
      return NextResponse.json(
        { error: 'We could not check your resume right now. Please try again in a moment.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ review });
  } catch (error) {
    console.error('POST /api/resume-insights failed:', error);
    return serverError('We could not check your resume. Please try again.');
  }
}
