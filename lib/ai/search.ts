import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { JOB_TYPES, type SeniorityLevel } from '@/lib/validation';
import { RETRIEVAL_DEPTH, RRF_K } from './config';
import { embedQueryCached, getActiveJobVectors } from './cache';
import { cosineSimilarity } from './vector';
import type { SemanticHit } from './matching';

/**
 * Hybrid job retrieval — the lexical and vector arms, fused by rank.
 *
 * `semanticJobSearch` embedded the query and scanned every stored vector. That
 * is a good recall engine and a poor precision one: embeddings blur rare literal
 * tokens, so searching a company name, `K8s`, `SRE` or a framework version — the
 * queries where the user already knows exactly what they want — retrieved
 * poorly. It also spent a model call and read the whole corpus per keystroke-
 * driven search, and treated "remote senior Go above 120k" as four words to
 * embed rather than three filters and one word.
 *
 * This module fixes all four:
 *
 *   1. A Postgres full-text arm runs beside the vector arm, so literal tokens
 *      are matched literally (`lexicalSearch`).
 *   2. Query vectors are cached and job vectors are held in process
 *      (`lib/ai/cache.ts`).
 *   3. Structured filters are parsed out of the query and applied as SQL
 *      predicates; only the prose remainder is embedded (`parseQuery`).
 *   4. With no key, no vector, or a failed embedding call it returns the
 *      lexical ranking rather than `null` — strictly better than today, where
 *      search gave up and the client fell back to substring filtering.
 */

/* -------------------------------------------------------------------------- */
/* Query understanding                                                         */
/* -------------------------------------------------------------------------- */

export type FilterKey = 'remote' | 'seniority' | 'type' | 'minSalary';

/** Employment types a query may filter to — the same allowlist the post-a-job form writes. */
export type JobType = (typeof JOB_TYPES)[number];

export interface SearchFilters {
  /** True for remote-only, false for on-site-only, absent when unstated. */
  remote?: boolean;
  seniority?: SeniorityLevel;
  type?: JobType;
  minSalary?: number;
}

/**
 * One filter, as the UI shows it back to the user.
 *
 * `token` is the literal text from the query that produced the filter, which is
 * what makes the chip removable: the client rebuilds the query from the
 * remainder plus the tokens of the chips that are left, and re-parsing that
 * string yields exactly the filters that were kept.
 */
export interface SearchFilterChip {
  key: FilterKey;
  label: string;
  token: string;
}

export interface ParsedQuery {
  filters: SearchFilters;
  chips: SearchFilterChip[];
  /** What is left once the filter words are removed. This is what gets embedded. */
  remainder: string;
}

/**
 * Salary figures below this are not a compensation band.
 *
 * "over 5 years", "3+ yoe" and a bare "12" (lakhs, or a multiple nobody stated)
 * all parse as small numbers. Treating them as a salary floor would silently
 * filter the corpus on a misreading, so anything under the floor is discarded
 * and the query keeps those words instead.
 */
const SALARY_FLOOR = 1000;

/** Nothing legitimate is above this; it exists to bound a typo like `120kk`. */
const SALARY_CEILING = 100_000_000;

/** Time units that follow a number in a *duration*, never in a salary. */
const DURATION_UNIT = String.raw`(?!\s*(?:years?|yrs?|yoe|months?|mos?|weeks?|days?|hours?|hrs?)\b)`;

const CURRENCY = String.raw`[$£€₹]?\s*`;
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*([kmKM]?)`;

/**
 * Ordered by how explicit the signal is. Every alternative is tried and the
 * earliest match in the string that yields a plausible figure wins, so
 * "5+ years, paying over 120k" reads the salary rather than the experience.
 */
const SALARY_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\b(?:above|over|at least|more than|greater than|minimum|min\.?|starting at|paying|upwards of|north of|from)\s+${CURRENCY}${AMOUNT}\b${DURATION_UNIT}`,
    'gi'
  ),
  new RegExp(String.raw`>=?\s*${CURRENCY}${AMOUNT}\b${DURATION_UNIT}`, 'gi'),
  new RegExp(String.raw`${CURRENCY}${AMOUNT}\s*\+${DURATION_UNIT}`, 'gi'),
  // A currency symbol on its own is signal enough: "$120k backend role".
  new RegExp(String.raw`[$£€₹]\s*${AMOUNT}\b${DURATION_UNIT}`, 'gi'),
];

const REMOTE_PATTERN = /\b(?:fully\s+)?(?:remote(?:ly)?|work from home|wfh|distributed team)\b/i;
const ONSITE_PATTERN = /\b(?:on[\s-]?site|in[\s-]?office|in[\s-]?person)\b/i;

/**
 * `JOB_TYPES` includes `Remote`, which is deliberately absent here: "remote" is
 * read as the location filter instead, because postings express it as a
 * location at least as often as they do as an employment type, and the remote
 * predicate below checks both columns.
 */
const TYPE_PATTERNS: ReadonlyArray<{ type: JobType; pattern: RegExp }> = [
  { type: 'Full Time', pattern: /\bfull[\s-]?time\b|\bfulltime\b/i },
  { type: 'Part Time', pattern: /\bpart[\s-]?time\b|\bparttime\b/i },
  { type: 'Internship', pattern: /\binternships?\b/i },
  { type: 'Contract', pattern: /\bcontract(?:or|ing)?\b|\bfreelance\b/i },
];

/**
 * Seniority synonyms, most senior first.
 *
 * Precedence matters for a query like "senior staff engineer" — either reading
 * is defensible, so the order simply has to be *decided* rather than left to
 * whichever regex happens to run first.
 */
const SENIORITY_PATTERNS: ReadonlyArray<{ level: SeniorityLevel; pattern: RegExp }> = [
  { level: 'Director', pattern: /\bdirector\b|\bhead of\b|\bvp\b/i },
  { level: 'Principal', pattern: /\bprincipal\b/i },
  { level: 'Staff', pattern: /\bstaff\b/i },
  { level: 'Lead', pattern: /\b(?:tech(?:nical)?\s+)?lead\b/i },
  { level: 'Senior', pattern: /\bsenior\b|\bsr\.?(?=\s|$)/i },
  { level: 'Mid', pattern: /\bmid[\s-]?level\b|\bmid\b|\bintermediate\b/i },
  { level: 'Junior', pattern: /\bjunior\b|\bjr\.?(?=\s|$)/i },
  { level: 'Entry', pattern: /\bentry[\s-]?level\b|\bentry\b|\bnew grad\b|\bgraduate\b|\bfresher\b/i },
  { level: 'Intern', pattern: /\bintern\b/i },
];

/** How the parsed value reads back to the user, in the chip. */
function salaryLabel(amount: number): string {
  return amount >= 1000 ? `${Math.round(amount / 1000)}k+` : `${amount}+`;
}

/**
 * Turns "remote senior Go role above 120k" into
 * `{ remote: true, seniority: 'Senior', minSalary: 120000 }` plus `"Go role"`.
 *
 * **Deterministic on purpose.** A structured-output model call would do this
 * too, but it would cost a request, ~300ms and a dependency on the key being
 * present, on the request path, for a job that four regexes do exactly. It
 * would also make the parse unpredictable: a filter that silently narrows the
 * corpus has to be reproducible, testable, and identical for every user typing
 * the same words. The vocabulary here is closed — `SENIORITY_LEVELS`,
 * `JOB_TYPES`, remote/on-site, a number — which is precisely the case where a
 * model adds variance rather than coverage. If the query language ever grows an
 * open-ended dimension, that is the point to revisit it.
 */
export function parseQuery(query: string): ParsedQuery {
  const source = query.trim().replace(/\s+/g, ' ');
  const filters: SearchFilters = {};
  const chips: SearchFilterChip[] = [];

  // Matched spans are blanked out as they are consumed, so a later rule cannot
  // re-read words an earlier one already claimed — "internship" is an
  // employment type, and the "intern" inside it is not also a seniority.
  let working = source;

  const consume = (index: number, length: number) => {
    working = working.slice(0, index) + ' '.repeat(length) + working.slice(index + length);
  };

  /* ---- Salary. First, because it is the only rule that owns digits. ---- */
  const salary = findSalary(working);
  if (salary) {
    filters.minSalary = salary.amount;
    chips.push({ key: 'minSalary', label: salaryLabel(salary.amount), token: salary.text.trim() });
    consume(salary.index, salary.text.length);
  }

  /* ---- Remote / on-site ---- */
  const onsite = ONSITE_PATTERN.exec(working);
  if (onsite) {
    filters.remote = false;
    chips.push({ key: 'remote', label: 'On-site', token: onsite[0] });
    consume(onsite.index, onsite[0].length);
  } else {
    const remote = REMOTE_PATTERN.exec(working);
    if (remote) {
      filters.remote = true;
      chips.push({ key: 'remote', label: 'Remote', token: remote[0] });
      consume(remote.index, remote[0].length);
    }
  }

  /* ---- Employment type ---- */
  for (const { type, pattern } of TYPE_PATTERNS) {
    const match = pattern.exec(working);
    if (!match) continue;
    filters.type = type;
    chips.push({ key: 'type', label: type, token: match[0] });
    consume(match.index, match[0].length);
    break;
  }

  /* ---- Seniority ---- */
  for (const { level, pattern } of SENIORITY_PATTERNS) {
    const match = pattern.exec(working);
    if (!match) continue;
    filters.seniority = level;
    chips.push({ key: 'seniority', label: level, token: match[0] });
    consume(match.index, match[0].length);
    break;
  }

  return { filters, chips, remainder: tidyRemainder(working) };
}

function findSalary(text: string): { amount: number; index: number; text: string } | null {
  let best: { amount: number; index: number; text: string } | null = null;

  for (const pattern of SALARY_PATTERNS) {
    // `lastIndex` is shared state on a /g regex, so it is reset per use rather
    // than trusted to be where the previous call left it.
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const amount = toAmount(match[1], match[2]);
      if (amount === null || match.index === undefined) continue;
      if (best === null || match.index < best.index) {
        best = { amount, index: match.index, text: match[0] };
      }
    }
  }

  return best;
}

function toAmount(digits: string | undefined, suffix: string | undefined): number | null {
  if (!digits) return null;

  const base = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;

  const unit = suffix?.toLowerCase();
  const amount = unit === 'k' ? base * 1000 : unit === 'm' ? base * 1_000_000 : base;

  if (amount < SALARY_FLOOR || amount > SALARY_CEILING) return null;
  return Math.round(amount);
}

/**
 * Cleans up what the filter rules left behind.
 *
 * Whitespace and dangling punctuation only. Stopwords are deliberately left
 * alone: `to_tsvector` drops them anyway, and the embedding model reads natural
 * phrasing better than a de-worded one, so stripping them would be work that
 * can only make the remainder worse.
 */
function tidyRemainder(working: string): string {
  return working
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)[-–—,;:/&+]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether anything was actually parsed out. */
export function hasFilters(filters: SearchFilters): boolean {
  return (
    filters.remote !== undefined ||
    filters.seniority !== undefined ||
    filters.type !== undefined ||
    filters.minSalary !== undefined
  );
}

/* -------------------------------------------------------------------------- */
/* SQL fragments                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The lexical document, character for character as `Job_fulltext_idx` defines
 * it (see `20260911100000_ai_phase_two/migration.sql`).
 *
 * An expression index is only usable when the query's expression parses to the
 * same tree, so this is not a place to tidy the formatting or re-order a column:
 * any edit here silently drops the search from a bitmap index scan to a full
 * scan with a `to_tsvector` call per row, and nothing fails visibly.
 */
const JOB_TSVECTOR = Prisma.sql`to_tsvector('english',
    coalesce(j."title", '') || ' ' ||
    coalesce(j."location", '') || ' ' ||
    coalesce(j."type", '') || ' ' ||
    coalesce(j."description", ''))`;

/** ILIKE patterns per seniority level, matched against the title or the experience column. */
const SENIORITY_SQL: Record<SeniorityLevel, string[]> = {
  Intern: ['%intern%'],
  Entry: ['%entry%', '%graduate%', '%fresher%'],
  Junior: ['%junior%', 'jr %', '% jr%'],
  Mid: ['%mid%', '%intermediate%'],
  Senior: ['%senior%', 'sr %', '% sr%'],
  Lead: ['%lead%'],
  Staff: ['%staff%'],
  Principal: ['%principal%'],
  Director: ['%director%', '%head of%', '%vp %'],
};

/**
 * Salary predicate.
 *
 * `Job.salary` is free text ("$160k", "$120,000 - $150,000", "12 LPA",
 * "Competitive"), so the top of the band is extracted in SQL: every
 * digits-and-commas run with an optional `k`, take the maximum. The pattern
 * cannot match anything but digits and commas, which is what makes the
 * `::numeric` cast safe — a cast error here would be a 500, not a bad ranking.
 *
 * Two deliberate exclusions from the exclusion:
 *
 * - **Unstated salary stays in.** Most postings do not name a figure, and the
 *   codebase's existing convention is that missing data is neutral rather than
 *   a penalty (see `scoreLocation`). Dropping every silent posting would leave
 *   almost nothing behind and make the filter feel broken.
 * - **Figures under `SALARY_FLOOR` stay in.** The comparison is currency-blind,
 *   so "12 LPA" is not on the same scale as "120000" and cannot be honestly
 *   compared with it. A row is only removed when a comparable figure was parsed
 *   *and* it fell short.
 */
function salaryPredicate(minSalary: number): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1
    FROM (
      SELECT MAX(
        CASE WHEN lower(t[2]) = 'k' THEN replace(t[1], ',', '')::numeric * 1000
             ELSE replace(t[1], ',', '')::numeric END
      ) AS top
      FROM regexp_matches(coalesce(j."salary", ''), '([0-9][0-9,]*)\\s*([kK]?)', 'g') AS t
    ) s
    WHERE s.top >= ${SALARY_FLOOR} AND s.top < ${minSalary}
  )`;
}

/**
 * The parsed filters as SQL. Every value is a bound parameter — user text never
 * reaches the statement itself.
 */
function filterPredicates(filters: SearchFilters): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (filters.remote === true) {
    conditions.push(Prisma.sql`(
      coalesce(j."type", '') ILIKE '%remote%'
      OR coalesce(j."location", '') ILIKE '%remote%'
      OR coalesce(j."title", '') ILIKE '%remote%'
    )`);
  } else if (filters.remote === false) {
    conditions.push(Prisma.sql`(
      coalesce(j."type", '') NOT ILIKE '%remote%'
      AND coalesce(j."location", '') NOT ILIKE '%remote%'
    )`);
  }

  if (filters.seniority) {
    const patterns = SENIORITY_SQL[filters.seniority].map(
      (pattern) =>
        Prisma.sql`coalesce(j."title", '') ILIKE ${pattern} OR coalesce(j."experience", '') ILIKE ${pattern}`
    );
    conditions.push(Prisma.sql`(${Prisma.join(patterns, ' OR ')})`);
  }

  if (filters.type) {
    // Postings spell it "Full Time", "full-time" and "Full-time"; normalising
    // both sides is cheaper than four ILIKE alternatives.
    conditions.push(
      Prisma.sql`replace(lower(coalesce(j."type", '')), '-', ' ') = ${filters.type.toLowerCase()}`
    );
  }

  if (typeof filters.minSalary === 'number') {
    conditions.push(salaryPredicate(filters.minSalary));
  }

  return conditions;
}

/* -------------------------------------------------------------------------- */
/* Retrieval arms                                                              */
/* -------------------------------------------------------------------------- */

interface RankedRow {
  id: string;
  rank: number;
}

/**
 * Full-text arm.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery` because it understands
 * what people already type into a search box — quoted phrases, `or`, and a
 * leading `-` to exclude — and it never raises a syntax error on input it does
 * not understand, which `to_tsquery` would.
 */
async function lexicalSearch(
  text: string,
  filters: SearchFilters,
  depth: number
): Promise<RankedRow[]> {
  const conditions = [Prisma.sql`j."isActive" = true`, ...filterPredicates(filters)];

  // Nothing to match on: the query was pure filters ("remote full time above
  // 120k"). The filtered listing itself is then the lexical arm, newest first.
  if (!text) {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT j."id"
      FROM "Job" j
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY j."createdAt" DESC
      LIMIT ${depth}
    `);
    return rows.map((row, index) => ({ id: row.id, rank: rows.length - index }));
  }

  const rows = await prisma.$queryRaw<RankedRow[]>(Prisma.sql`
    SELECT j."id",
           ts_rank(${JOB_TSVECTOR}, websearch_to_tsquery('english', ${text})) AS rank
    FROM "Job" j
    WHERE ${Prisma.join(
      [...conditions, Prisma.sql`${JOB_TSVECTOR} @@ websearch_to_tsquery('english', ${text})`],
      ' AND '
    )}
    ORDER BY rank DESC, j."createdAt" DESC
    LIMIT ${depth}
  `);

  return rows;
}

/**
 * Trigram fallback for the case full text cannot help with: a typo.
 *
 * `to_tsvector` stems, it does not spell-correct, so "backnd enginer" matches
 * nothing at all. Run only when the lexical arm came back empty, so the common
 * path never pays for it, and wrapped because `pg_trgm` is created
 * best-effort in the migration and may legitimately be absent on a locked-down
 * managed tier.
 */
async function trigramSearch(
  text: string,
  filters: SearchFilters,
  depth: number
): Promise<RankedRow[]> {
  const conditions = [
    Prisma.sql`j."isActive" = true`,
    ...filterPredicates(filters),
    Prisma.sql`j."title" % ${text}`,
  ];

  try {
    return await prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      SELECT j."id", similarity(j."title", ${text}) AS rank
      FROM "Job" j
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY rank DESC, j."createdAt" DESC
      LIMIT ${depth}
    `);
  } catch {
    // No pg_trgm, no fuzzy arm. The vector arm still covers this query.
    return [];
  }
}

/** Ids passing the filters, used to mask the vector arm to the same corpus. */
async function filteredJobIds(filters: SearchFilters): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT j."id"
    FROM "Job" j
    WHERE ${Prisma.join([Prisma.sql`j."isActive" = true`, ...filterPredicates(filters)], ' AND ')}
  `);
  return new Set(rows.map((row) => row.id));
}

/**
 * Vector arm, against the in-process corpus cache rather than a fresh read of
 * every row. Returns `null` — not an empty list — when there is no vector to
 * search with, so fusion can tell "no semantic signal available" apart from
 * "semantic search found nothing".
 */
async function vectorSearch(
  text: string,
  allowed: Set<string> | null,
  depth: number
): Promise<RankedRow[] | null> {
  const queryVector = await embedQueryCached(text);
  if (!queryVector) return null;

  const corpus = await getActiveJobVectors();
  if (corpus.length === 0) return null;

  const scored: RankedRow[] = [];
  for (const entry of corpus) {
    if (allowed && !allowed.has(entry.jobId)) continue;
    scored.push({ id: entry.jobId, rank: cosineSimilarity(queryVector, entry.vector) });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, depth);
}

/* -------------------------------------------------------------------------- */
/* Fusion                                                                      */
/* -------------------------------------------------------------------------- */

export interface HybridHit extends SemanticHit {
  /** 1-based position in the lexical ranking, or null if that arm missed it. */
  lexicalRank: number | null;
  /** 1-based position in the vector ranking, or null if that arm missed it. */
  vectorRank: number | null;
}

export type SearchMode = 'hybrid' | 'lexical' | 'filters';

export interface HybridSearchResult {
  /**
   * Element shape is exactly `SemanticHit` (`{ jobId, relevance }`) plus the two
   * rank fields, so a caller that only reads `jobId` and `relevance` — which is
   * every caller today — needs no change at all.
   */
  hits: HybridHit[];
  filters: SearchFilters;
  chips: SearchFilterChip[];
  /** The prose that was actually embedded, once filters were removed. */
  remainder: string;
  /** `lexical` means the vector arm was unavailable, not that it found nothing. */
  mode: SearchMode;
}

export interface HybridSearchOptions {
  limit?: number;
  /** Candidates each arm contributes before fusion. */
  depth?: number;
  /** Floor on the fused 0–100 figure. Defaults to 0 — see the note below. */
  minRelevance?: number;
}

/**
 * Reciprocal Rank Fusion.
 *
 * `score(doc) = Σ 1 / (RRF_K + rank_i(doc))`, over the arms that ranked it.
 *
 * The fusion is over *ranks*, never over the arms' own scores, and that is the
 * whole reason to use it here: `ts_rank` is an unbounded lexical density figure
 * whose scale depends on the document and the query, while cosine similarity is
 * a bounded [-1, 1] geometric one that, in practice, only ever varies between
 * about 0.3 and 0.9. Any weighted sum of the two would be tuning a ratio between
 * numbers that mean different things — the weights would look principled and be
 * arbitrary. Positions are comparable by construction, and `RRF_K = 60` (the
 * value from the original TREC work) flattens the head enough that a confident
 * arm cannot bully the other one out of the result.
 */
function fuse(arms: RankedRow[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();

  for (const arm of arms) {
    for (let index = 0; index < arm.length; index++) {
      const id = arm[index].id;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }

  return scores;
}

/**
 * Hybrid search over active jobs.
 *
 * Returns `null` only when there is nothing to search for — a query under two
 * characters. Every other degradation (no API key, an embedding failure, an
 * empty corpus) comes back as a lexical-only ranking, which is the fail-soft
 * rule applied properly: the old `semanticJobSearch` returned `null` the moment
 * AI was unavailable and left the client to substring-match, which threw away a
 * perfectly good full-text index that was sitting right there.
 */
export async function hybridJobSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const depth = options.depth ?? RETRIEVAL_DEPTH;
  const limit = options.limit ?? 50;
  // Default 0, unlike the old `minRelevance: 25`. That floor was a cosine
  // threshold in disguise; a fused RRF score is a position, not a similarity, so
  // the same number would mean nothing here. `depth` is the bound instead.
  const minRelevance = options.minRelevance ?? 0;

  const parsed = parseQuery(trimmed);
  const filtered = hasFilters(parsed.filters);
  const text = parsed.remainder;

  // Only masked when there is something to mask by; an unfiltered query must not
  // pay for an extra round trip.
  const allowed = filtered ? await filteredJobIds(parsed.filters) : null;

  // The arms are independent, so they run together: the vector arm's cost is a
  // possible embedding call, and there is no reason for the SQL to wait on it.
  const [lexicalSettled, vectorSettled] = await Promise.allSettled([
    lexicalSearch(text, parsed.filters, depth),
    // With no prose left, embedding the filter words we just removed would
    // reintroduce exactly the bug this module exists to fix.
    text ? vectorSearch(text, allowed, depth) : Promise.resolve(null),
  ]);

  let lexical = settled(lexicalSettled, 'lexical arm', []);
  const vector = settled(vectorSettled, 'vector arm', null);

  if (lexical.length === 0 && text) {
    lexical = await trigramSearch(text, parsed.filters, depth);
  }

  const arms: RankedRow[][] = [lexical];
  if (vector) arms.push(vector);

  const scores = fuse(arms);
  if (scores.size === 0) {
    return { hits: [], filters: parsed.filters, chips: parsed.chips, remainder: text, mode: modeOf(text, vector) };
  }

  const lexicalPositions = positions(lexical);
  const vectorPositions = positions(vector ?? []);

  // Best achievable fused score *given the arms that actually ran*, so a
  // lexical-only result set is not scaled against a vector arm that never
  // contributed and reported as half as relevant as it is.
  const bestPossible = arms.length / (RRF_K + 1);

  const hits: HybridHit[] = [...scores.entries()]
    .map(([jobId, score]) => ({
      jobId,
      relevance: Math.max(0, Math.min(100, Math.round((score / bestPossible) * 100))),
      lexicalRank: lexicalPositions.get(jobId) ?? null,
      vectorRank: vectorPositions.get(jobId) ?? null,
    }))
    .filter((hit) => hit.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);

  return {
    hits,
    filters: parsed.filters,
    chips: parsed.chips,
    remainder: text,
    mode: modeOf(text, vector),
  };
}

function modeOf(text: string, vector: RankedRow[] | null): SearchMode {
  if (!text) return 'filters';
  return vector ? 'hybrid' : 'lexical';
}

function positions(rows: RankedRow[]): Map<string, number> {
  return new Map(rows.map((row, index) => [row.id, index + 1]));
}

/**
 * One arm failing must not take the search with it — a Postgres hiccup should
 * leave the vector results standing, and vice versa.
 */
function settled<T>(result: PromiseSettledResult<T>, label: string, fallback: T): T {
  if (result.status === 'fulfilled') return result.value;
  console.error(`hybridJobSearch ${label} failed:`, result.reason);
  return fallback;
}
