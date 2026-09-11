import { prisma } from '@/lib/prisma';
import { MATCH_WEIGHTS, isAiEnabled } from './config';
import { embedText } from './gemini';
import { scoreSkills, scoreSkillsSync, type SkillMatch } from './skills';
import { cosineSimilarity, similarityToScore } from './vector';

/**
 * Turns stored vectors into the numbers the UI shows.
 *
 * A single cosine value is accurate but not explainable — "84%" with nothing
 * behind it invites distrust. So the score is a weighted blend of four facets
 * (see `MATCH_WEIGHTS`) and every facet is returned alongside it, which is what
 * feeds the match breakdown in the job sidebar.
 */

export interface MatchBreakdown {
  /** 0–100 composite, the headline figure. */
  score: number;
  facets: {
    /** Semantic closeness of the whole profile to the whole posting. */
    semantic: number;
    /** Overlap between the seeker's skills and the ones the posting names. */
    skills: number;
    /** Whether the location is compatible (remote counts as compatible). */
    location: number;
    /** Whether the seniority the posting asks for matches what the seeker has. */
    seniority: number;
  };
  /** Skills present on both sides, for "why this matched". */
  sharedSkills: string[];
  /** Skills the posting asks for that the profile does not evidence. */
  missingSkills: string[];
}

export interface ProfileVectorContext {
  vector: number[] | null;
  skills: string[];
  location: string | null;
  seniority: string | null;
  yearsOfExp: number | null;
}

export interface JobVectorContext {
  vector: number[] | null;
  skills: string[];
  location: string | null;
  experience: string | null;
}

/* -------------------------------------------------------------------------- */
/* Facet scoring                                                               */
/* -------------------------------------------------------------------------- */

const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;

/**
 * Location compatibility, 0–1.
 *
 * Deliberately generous: either side saying "remote" is a match, an exact town
 * match is a match, and a missing value is neutral rather than a penalty —
 * most postings do not state a location precisely enough to punish anyone over.
 */
function scoreLocation(profileLocation: string | null, jobLocation: string | null): number {
  if (!jobLocation || !profileLocation) return 0.6;

  const job = jobLocation.toLowerCase().trim();
  const profile = profileLocation.toLowerCase().trim();

  if (REMOTE.test(job) || REMOTE.test(profile)) return 1;
  if (job === profile) return 1;
  if (job.includes(profile) || profile.includes(job)) return 0.9;

  // Compare the coarsest component — "Bengaluru, India" vs "India".
  const jobParts = job.split(/[,/|]/).map((part) => part.trim());
  const profileParts = profile.split(/[,/|]/).map((part) => part.trim());
  if (jobParts.some((part) => part && profileParts.includes(part))) return 0.8;

  return 0.15;
}

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  entry: 1,
  junior: 1,
  associate: 2,
  mid: 3,
  intermediate: 3,
  senior: 4,
  lead: 5,
  staff: 5,
  principal: 6,
  head: 6,
  director: 7,
  vp: 8,
  executive: 8,
};

function rankSeniority(value: string | null | undefined): number | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const [key, rank] of Object.entries(SENIORITY_RANK)) {
    if (lower.includes(key)) return rank;
  }
  return null;
}

/** Pulls the lower bound out of "3-5 years", "5+ years", "3 yrs". */
function parseYears(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+)/);
  if (!match) return null;
  const years = Number(match[1]);
  return Number.isFinite(years) ? years : null;
}

/**
 * Seniority fit, 0–1. Being slightly over-qualified costs less than being
 * under-qualified, which is how hiring actually works.
 */
function scoreSeniority(profile: ProfileVectorContext, job: JobVectorContext): number {
  const profileRank = rankSeniority(profile.seniority);
  const jobRank = rankSeniority(job.experience);

  if (profileRank !== null && jobRank !== null) {
    const gap = profileRank - jobRank;
    if (gap === 0) return 1;
    if (gap > 0) return Math.max(0.6, 1 - gap * 0.12);
    return Math.max(0.2, 1 + gap * 0.22);
  }

  const profileYears = profile.yearsOfExp;
  const jobYears = parseYears(job.experience);

  if (profileYears !== null && jobYears !== null) {
    const gap = profileYears - jobYears;
    if (gap >= 0) return Math.min(1, 0.85 + gap * 0.05);
    return Math.max(0.2, 1 + gap * 0.18);
  }

  // Nothing to compare — neutral, not a penalty.
  return 0.6;
}

/* -------------------------------------------------------------------------- */
/* Composite score                                                             */
/* -------------------------------------------------------------------------- */

/** Blends the facets, given a skill comparison that has already been made. */
function blend(
  profile: ProfileVectorContext,
  job: JobVectorContext,
  skillMatch: SkillMatch
): MatchBreakdown {
  const cosine = cosineSimilarity(profile.vector ?? [], job.vector ?? []);
  const semantic = similarityToScore(cosine) / 100;

  // A posting that names no skills gets the same neutral 0.5 it always has:
  // absent data is not evidence against a candidate.
  const skills = job.skills.length > 0 ? skillMatch.score : 0.5;
  const location = scoreLocation(profile.location, job.location);
  const seniority = scoreSeniority(profile, job);

  const composite =
    semantic * MATCH_WEIGHTS.semantic +
    skills * MATCH_WEIGHTS.skills +
    location * MATCH_WEIGHTS.location +
    seniority * MATCH_WEIGHTS.seniority;

  return {
    score: Math.max(0, Math.min(100, Math.round(composite * 100))),
    facets: {
      semantic: Math.round(semantic * 100),
      skills: Math.round(skills * 100),
      location: Math.round(location * 100),
      seniority: Math.round(seniority * 100),
    },
    // A fuzzy pair is still a reason this matched, so it belongs in the shown
    // list — after the certain ones — and, more importantly, out of `missing`,
    // which is what used to tell people they lacked `PostgreSQL` while their
    // profile said `Postgres`.
    sharedSkills: [...skillMatch.shared, ...skillMatch.fuzzy.map((pair) => pair.job)].slice(0, 8),
    missingSkills: skillMatch.missing.slice(0, 6),
  };
}

/**
 * Blends the facets into the headline score.
 *
 * Returns `null` when there is no semantic signal at all — better to show no
 * match than to show one computed purely from a location string.
 *
 * **Deliberately still synchronous.** `rankJobs` scores a whole page of jobs
 * against one profile, and `app/api/jobs/route.ts` calls it on the main feed;
 * making this async would push an await into every list path and turn one page
 * of results into dozens of round trips. Layers 1–2 of the skill matcher are
 * free and cover `Postgres`/`PostgreSQL` and friends, which was the actual
 * complaint. Use `computeMatchAsync` where a single pair is being scored and
 * the embedding fallback is worth the wait.
 */
export function computeMatch(
  profile: ProfileVectorContext,
  job: JobVectorContext
): MatchBreakdown | null {
  if (!profile.vector?.length || !job.vector?.length) return null;
  return blend(profile, job, scoreSkillsSync(profile.skills, job.skills));
}

/**
 * `computeMatch` plus the embedding-backed skill layer.
 *
 * Worth it on the one-job paths — the detail page and the moment of applying —
 * where the candidate reads the "missing skills" list closely and the extra
 * work is bounded to a single profile-against-posting comparison. Scoring a
 * list of jobs this way is not worth it and is not offered.
 *
 * Fails soft to exactly what `computeMatch` returns: `scoreSkills` never throws
 * and falls back to layers 1–2 whenever the model or the cache is unavailable.
 */
export async function computeMatchAsync(
  profile: ProfileVectorContext,
  job: JobVectorContext
): Promise<MatchBreakdown | null> {
  if (!profile.vector?.length || !job.vector?.length) return null;
  return blend(profile, job, await scoreSkills(profile.skills, job.skills));
}

/* -------------------------------------------------------------------------- */
/* Loading contexts                                                            */
/* -------------------------------------------------------------------------- */

/** Loads everything needed to score a seeker against any job. */
export async function loadProfileContext(userId: string): Promise<ProfileVectorContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      skills: true,
      location: true,
      seniority: true,
      yearsOfExp: true,
      embedding: { select: { vector: true } },
    },
  });

  if (!user || user.role !== 'SEEKER') return null;

  return {
    vector: user.embedding?.vector ?? null,
    skills: user.skills ?? [],
    location: user.location,
    seniority: user.seniority,
    yearsOfExp: user.yearsOfExp,
  };
}

export interface RankedJob<T> {
  job: T;
  match: MatchBreakdown | null;
}

/**
 * Scores a list of already-fetched jobs against a profile.
 *
 * Takes the jobs rather than querying for them so the caller keeps control of
 * its own `where` clause and `include` shape — the feed, the recommendations
 * panel and the job detail page all need different columns.
 */
export function rankJobs<
  T extends {
    id: string;
    skills?: string[];
    location?: string | null;
    experience?: string | null;
    embedding?: { vector: number[] } | null;
  },
>(profile: ProfileVectorContext | null, jobs: T[]): RankedJob<T>[] {
  if (!profile?.vector?.length) {
    return jobs.map((job) => ({ job, match: null }));
  }

  return jobs.map((job) => ({
    job,
    match: computeMatch(profile, {
      vector: job.embedding?.vector ?? null,
      skills: job.skills ?? [],
      location: job.location ?? null,
      experience: job.experience ?? null,
    }),
  }));
}

/* -------------------------------------------------------------------------- */
/* Semantic search                                                             */
/* -------------------------------------------------------------------------- */

export interface SemanticHit {
  jobId: string;
  /** 0–100, comparable with a match score but derived from the query. */
  relevance: number;
}

/**
 * Ranks active jobs against a free-text query using the query task type, which
 * is what makes asymmetric retrieval work: the query is embedded differently
 * from the documents it is searching.
 *
 * Returns `null` — not an empty list — when AI is unavailable, so the caller can
 * tell "no semantic results" apart from "semantic search is switched off" and
 * fall back to keyword filtering.
 */
export async function semanticJobSearch(
  query: string,
  options: { limit?: number; minRelevance?: number } = {}
): Promise<SemanticHit[] | null> {
  if (!isAiEnabled()) return null;

  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const queryVector = await embedText(trimmed, 'query');
  if (!queryVector) return null;

  const rows = await prisma.jobEmbedding.findMany({
    where: { job: { isActive: true } },
    select: { jobId: true, vector: true },
    take: 2000,
  });

  const limit = options.limit ?? 50;
  const minRelevance = options.minRelevance ?? 25;

  return rows
    .map((row) => ({
      jobId: row.jobId,
      relevance: similarityToScore(cosineSimilarity(queryVector, row.vector), 0.3, 0.85),
    }))
    .filter((hit) => hit.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Applicant ranking                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Scores a job's applicants by fit, for the company side. The job vector is
 * loaded once and every applicant profile compared against it.
 *
 * Uses the synchronous skill path even though this function can await: an
 * applicant pool has no upper bound, and embedding every unseen tag across it
 * would make the first load of a busy posting arbitrarily slow for a ranking
 * the alias layer already gets substantially right.
 */
export async function rankApplicantsForJob(
  jobId: string
): Promise<Map<string, MatchBreakdown>> {
  const scores = new Map<string, MatchBreakdown>();

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      skills: true,
      location: true,
      experience: true,
      embedding: { select: { vector: true } },
      applications: {
        select: {
          userId: true,
          user: {
            select: {
              skills: true,
              location: true,
              seniority: true,
              yearsOfExp: true,
              embedding: { select: { vector: true } },
            },
          },
        },
      },
    },
  });

  if (!job?.embedding?.vector?.length) return scores;

  const jobContext: JobVectorContext = {
    vector: job.embedding.vector,
    skills: job.skills ?? [],
    location: job.location,
    experience: job.experience,
  };

  for (const application of job.applications) {
    const match = computeMatch(
      {
        vector: application.user.embedding?.vector ?? null,
        skills: application.user.skills ?? [],
        location: application.user.location,
        seniority: application.user.seniority,
        yearsOfExp: application.user.yearsOfExp,
      },
      jobContext
    );
    if (match) scores.set(application.userId, match);
  }

  return scores;
}
