import { prisma } from '@/lib/prisma';
import { canonicalSkill, findSkillsInText, skillLabel } from '@/lib/ai/skills';
import { cosineSimilarity } from '@/lib/ai/vector';
import { getActiveJobVectors } from '@/lib/ai/cache';
import {
  EXPERIENCE_BUCKETS,
  EXPERIENCE_ORDER,
  experienceBucketLabel,
  experienceBuckets,
  placesIn,
} from '@/lib/jobs/filters';

/**
 * What employers hiring for roles like the seeker's actually ask for.
 *
 * "Roles like yours" is the set of open jobs nearest the seeker's profile
 * vector, which is built from their resume. Everything on the insights page is
 * counted over that set, so "Docker is asked for in 41% of jobs" means 41% of
 * the jobs this person would realistically apply to, not of the whole board.
 *
 * No model call happens here: it is counting over rows we already hold, so it
 * is cheap enough to run on every page view.
 */

/** Enough to make the percentages steady, few enough to stay on topic. */
const PEER_JOBS = 150;
const TOP_KEYWORDS = 20;
const TOP_MISSING = 8;
const TOP_TITLES = 6;
const TOP_LOCATIONS = 6;
/** A skill on the profile that fewer than this share of jobs ask for. */
const RARE_SHARE = 0.03;
/** With fewer jobs than this the percentages say more about luck than demand. */
export const MIN_PEER_JOBS = 5;

export interface KeywordDemand {
  label: string;
  /** Jobs that ask for it. */
  count: number;
  /** 0–1, of the jobs analysed. */
  share: number;
  /** Named on the seeker's profile or in the summary read from their resume. */
  onProfile: boolean;
}

export interface CountRow {
  label: string;
  count: number;
  share: number;
}

export interface ExperienceRow extends CountRow {
  id: string;
  /** The range the seeker's own years fall in. */
  yours: boolean;
}

export interface MarketInsights {
  /** How the peer jobs were chosen: by the resume's vector, or by shared skills. */
  basis: 'resume' | 'skills';
  jobsAnalysed: number;
  openJobs: number;
  keywords: KeywordDemand[];
  missing: KeywordDemand[];
  rareSkills: string[];
  titles: CountRow[];
  locations: CountRow[];
  remoteShare: number;
  experience: ExperienceRow[];
  types: CountRow[];
  profile: {
    headline: string | null;
    seniority: string | null;
    yearsOfExp: number | null;
    skills: string[];
  };
}

export type MarketResult =
  | { ok: true; insights: MarketInsights }
  | { ok: false; reason: 'no-profile' | 'too-few-jobs' };

/* -------------------------------------------------------------------------- */
/* Picking the jobs to count over                                              */
/* -------------------------------------------------------------------------- */

async function nearestJobIds(vector: number[]): Promise<string[]> {
  const rows = await getActiveJobVectors();
  return rows
    .filter((row) => row.vector.length === vector.length)
    .map((row) => ({ id: row.jobId, score: cosineSimilarity(vector, row.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, PEER_JOBS)
    .map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* Counting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * "Senior Backend Engineer (m/w/d) - Payments" → "Backend Engineer", so the
 * same role at different levels and teams is counted once. Level words are
 * dropped because the experience chart already covers level.
 */
const LEVEL_WORDS =
  /\b(?:senior|sr|junior|jr|mid[\s-]?level|entry[\s-]?level|associate|intern(?:ship)?|trainee|i{1,3}|iv|[0-9]+)\b\.?/gi;

function roleTitle(title: string): string | null {
  const head = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s[-–—|:]\s|,|\s\/\s|\s@\s|\sat\s/)[0]
    .replace(LEVEL_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (head.length < 3 || head.length > 60) return null;
  // "Engineer" or "Director" on its own is not something worth searching for.
  if (!/\s/.test(head)) return null;
  return head;
}

function tally<T extends string>(values: Iterable<T>, into: Map<T, number>): void {
  for (const value of values) into.set(value, (into.get(value) ?? 0) + 1);
}

function topRows(
  counts: Map<string, number>,
  labels: Map<string, string>,
  total: number,
  limit: number
): CountRow[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ label: labels.get(key) ?? key, count, share: count / total }));
}

function bucketForYears(years: number | null): string | null {
  if (years == null) return null;
  return EXPERIENCE_BUCKETS.find((bucket) => years >= bucket.from && years < bucket.to)?.id ?? null;
}

function sentenceCase(value: string): string {
  const lower = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function loadMarketInsights(userId: string): Promise<MarketResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      headline: true,
      seniority: true,
      yearsOfExp: true,
      skills: true,
      aiSummary: true,
      profile: true,
      embedding: { select: { vector: true } },
    },
  });
  if (!user) return { ok: false, reason: 'no-profile' };

  let basis: MarketInsights['basis'] = 'resume';
  let ids: string[] = [];

  if (user.embedding?.vector?.length) {
    ids = await nearestJobIds(user.embedding.vector);
  }

  // No vector (AI switched off, or not read yet): fall back to jobs that share
  // at least one of the seeker's skills, newest first.
  if (ids.length === 0 && user.skills.length > 0) {
    basis = 'skills';
    const variants = [...new Set(user.skills.flatMap((skill) => [skill, skillLabel(skill)]))];
    const rows = await prisma.job.findMany({
      where: { isActive: true, skills: { hasSome: variants } },
      orderBy: { createdAt: 'desc' },
      take: PEER_JOBS,
      select: { id: true },
    });
    ids = rows.map((row) => row.id);
  }

  if (ids.length === 0 && user.skills.length === 0 && !user.embedding) {
    return { ok: false, reason: 'no-profile' };
  }

  const [jobs, openJobs] = await Promise.all([
    prisma.job.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { title: true, description: true, skills: true, location: true, experience: true, type: true },
    }),
    prisma.job.count({ where: { isActive: true } }),
  ]);

  if (jobs.length < MIN_PEER_JOBS) return { ok: false, reason: 'too-few-jobs' };
  const total = jobs.length;

  // What the seeker already has: their tags, plus skills named in the headline
  // and the summary read from their resume.
  const narrative = [user.headline, user.aiSummary, user.profile].filter(Boolean).join('\n');
  const have = new Set(
    [...user.skills, ...findSkillsInText(narrative, 40)].map(canonicalSkill).filter(Boolean)
  );

  const skillCounts = new Map<string, number>();
  const skillLabels = new Map<string, string>();
  const titleCounts = new Map<string, number>();
  const titleLabels = new Map<string, string>();
  const placeCounts = new Map<string, number>();
  const placeLabels = new Map<string, string>();
  const bucketCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const typeLabels = new Map<string, string>();
  let remote = 0;

  for (const job of jobs) {
    // A posting with no tags of its own (most imports) is read for them.
    const tags = job.skills.length > 0 ? job.skills : findSkillsInText(job.description, 12);
    const keys = new Set<string>();
    for (const tag of tags) {
      const key = canonicalSkill(tag);
      if (!key) continue;
      keys.add(key);
      if (!skillLabels.has(key)) skillLabels.set(key, skillLabel(tag));
    }
    tally(keys, skillCounts);

    const title = roleTitle(job.title);
    if (title) {
      const key = title.toLowerCase();
      tally([key], titleCounts);
      if (!titleLabels.has(key)) titleLabels.set(key, title);
    }

    const places = placesIn(job.location);
    if (places.some((place) => place.kind === 'remote')) remote++;
    const named = places.filter((place) => place.kind !== 'remote');
    tally(
      named.map((place) => place.key),
      placeCounts
    );
    for (const place of named) if (!placeLabels.has(place.key)) placeLabels.set(place.key, place.name);

    tally(experienceBuckets(job.experience), bucketCounts);

    if (job.type?.trim()) {
      const key = job.type.trim().toLowerCase().replace(/[_\s-]+/g, '-');
      tally([key], typeCounts);
      if (!typeLabels.has(key)) typeLabels.set(key, sentenceCase(job.type));
    }
  }

  const ranked = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({
      label: skillLabels.get(key) ?? key,
      count,
      share: count / total,
      onProfile: have.has(key),
    }));

  const yours = bucketForYears(user.yearsOfExp);

  return {
    ok: true,
    insights: {
      basis,
      jobsAnalysed: total,
      openJobs,
      keywords: ranked.slice(0, TOP_KEYWORDS),
      // Asked for by at least two jobs, so one odd posting is not advice.
      missing: ranked.filter((row) => !row.onProfile && row.count >= 2).slice(0, TOP_MISSING),
      rareSkills: user.skills.filter(
        (skill) => (skillCounts.get(canonicalSkill(skill)) ?? 0) / total < RARE_SHARE
      ),
      titles: topRows(titleCounts, titleLabels, total, TOP_TITLES).filter((row) => row.count >= 2),
      locations: topRows(placeCounts, placeLabels, total, TOP_LOCATIONS),
      remoteShare: remote / total,
      experience: EXPERIENCE_ORDER.map((id) => ({
        id,
        label: experienceBucketLabel(id),
        count: bucketCounts.get(id) ?? 0,
        share: (bucketCounts.get(id) ?? 0) / total,
        yours: id === yours,
      })),
      types: topRows(typeCounts, typeLabels, total, 4),
      profile: {
        headline: user.headline,
        seniority: user.seniority,
        yearsOfExp: user.yearsOfExp,
        skills: user.skills,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The resume check (POST /api/resume-insights)                                */
/* -------------------------------------------------------------------------- */

export const CHECK_AREAS = [
  'contact',
  'summary',
  'experience',
  'skills',
  'education',
  'results',
  'verbs',
  'length',
  'readable',
] as const;
export type CheckArea = (typeof CHECK_AREAS)[number];

export const CHECK_STATUSES = ['good', 'improve', 'missing'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface ResumeReview {
  resumeId: string;
  score: number;
  verdict: string;
  checks: Array<{ area: CheckArea; status: CheckStatus; note: string }>;
  keywordsFound: string[];
  strengths: string[];
  improvements: Array<{ title: string; detail: string; priority: Priority }>;
  rewrites: Array<{ before: string; after: string }>;
  searchTips: string[];
  reviewedAt: string;
}
