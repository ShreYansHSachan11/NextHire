/**
 * The evaluation run itself.
 *
 * Four rankers are measured over the same fixtures and the same judgements, so
 * the difference between them is attributable:
 *
 *   legacy    `semanticJobSearch` — the pre-hybrid path, kept because the
 *             "hybrid improved relevance" claim is a claim *about* it.
 *   vector    `hybridJobSearch` with the lexical arm unavailable.
 *   lexical   `hybridJobSearch` with the vector arm unavailable.
 *   hybrid    `hybridJobSearch` with both arms.
 *
 * `vector` and `lexical` are not re-implementations: they are the real
 * `hybridJobSearch` running in the degraded states it is designed to survive,
 * produced by making one side's data source look empty. Every number below
 * comes out of `lib/**`; this file only feeds it fixtures and scores what came
 * back.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { invalidateJobVectorCache, queryVectorKey } from '@/lib/ai/cache';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MATCH_WEIGHTS } from '@/lib/ai/config';
import { buildJobDocument, buildProfileDocument } from '@/lib/ai/documents';
import {
  rankJobs,
  semanticJobSearch,
  type MatchBreakdown,
  type ProfileVectorContext,
} from '@/lib/ai/matching';
import { hybridJobSearch, parseQuery } from '@/lib/ai/search';
import { canonicalSkill, scoreSkills, scoreSkillsSync } from '@/lib/ai/skills';
import { cosineSimilarity, similarityToScore } from '@/lib/ai/vector';
import { POSTINGS, type EvalPosting } from '../fixtures/postings';
import { QUERIES, type EvalQuery } from '../fixtures/queries';
import {
  CACHE_DIR,
  embedCached,
  embedStats,
  loadCache,
  readQueryVectorRow,
  saveCache,
} from './embed-cache';
import {
  describe,
  intrusionsAtK,
  mean,
  mrrOfBest,
  ndcgAtK,
  precisionAtK,
  rankOf,
  recallAtK,
  type Distribution,
} from './metrics';
import {
  dbStats,
  setJobs,
  setJobVectors,
  setLexicalArmEnabled,
  setVectorArmEnabled,
  type JobRow,
} from './prisma-double';

const K_VALUES = [1, 3, 5, 10] as const;
const RANKERS = ['legacy', 'vector', 'lexical', 'hybrid'] as const;
type Ranker = (typeof RANKERS)[number];

/* -------------------------------------------------------------------------- */
/* Fixtures -> the shapes the product expects                                  */
/* -------------------------------------------------------------------------- */

function toJobRow(posting: EvalPosting, index: number): JobRow {
  return {
    id: posting.id,
    title: posting.title,
    companyName: posting.companyName,
    location: posting.location,
    type: posting.type,
    experience: posting.experience,
    salary: posting.salary,
    skills: posting.skills,
    description: posting.description,
    isActive: true,
    // Earlier entries read as newer, which only matters as a deterministic
    // tie-break — several product queries order by `createdAt DESC`.
    createdAt: POSTINGS.length - index,
  };
}

/**
 * A query, expressed as the seeker profile that would have typed it.
 *
 * The judgements in `queries.ts` are retrieval judgements, and the matching
 * code scores a *profile* against a posting rather than a query against one.
 * Rather than invent a second judgement set, each query is turned into the
 * minimal profile consistent with it, using the product's own
 * `parseQuery` and `canonicalSkill` to read the seniority and the skills out of
 * the words. That makes the match-score ranking measurable on the same ground
 * truth — with the caveat, stated in EVAL.md, that a real profile is a résumé
 * and this is one sentence.
 */
function toProfile(query: EvalQuery, vocabulary: Map<string, string>): {
  skills: string[];
  seniority: string | null;
  location: string | null;
  document: string;
} {
  const parsed = parseQuery(query.text);

  const words = query.text.split(/[\s,;/()]+/).filter(Boolean);
  const candidates = new Set<string>(words);
  for (let index = 0; index + 1 < words.length; index++) {
    candidates.add(`${words[index]} ${words[index + 1]}`);
  }

  const skills: string[] = [];
  for (const candidate of candidates) {
    const key = canonicalSkill(candidate);
    const label = key ? vocabulary.get(key) : undefined;
    if (label && !skills.includes(label)) skills.push(label);
  }

  const location = query.expectedFilters?.location ?? null;

  return {
    skills,
    seniority: parsed.filters.seniority ?? null,
    location,
    document: buildProfileDocument({
      headline: query.text,
      seniority: parsed.filters.seniority ?? null,
      skills,
      location,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

interface QueryResult {
  ranked: string[];
  mode: string;
}

interface ScoreCard {
  recall: Record<number, number>;
  precision: Record<number, number>;
  ndcg: Record<number, number>;
  mrr: number;
  intrusions: number;
}

function score(ranked: string[], query: EvalQuery): ScoreCard {
  const relevant = new Set(Object.keys(query.relevant));
  const recall: Record<number, number> = {};
  const precision: Record<number, number> = {};
  const ndcg: Record<number, number> = {};

  for (const k of K_VALUES) {
    recall[k] = recallAtK(ranked, relevant, k);
    precision[k] = precisionAtK(ranked, relevant, k);
    ndcg[k] = ndcgAtK(ranked, query.relevant, k);
  }

  return {
    recall,
    precision,
    ndcg,
    mrr: mrrOfBest(ranked, query.relevant),
    intrusions: intrusionsAtK(ranked, query.mustNotRank ?? [], 5).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const pad = (value: string, width: number): string => value.padEnd(width);
const padStart = (value: string, width: number): string => value.padStart(width);
const pct = (value: number): string => `${(value * 100).toFixed(1)}`;
const fixed = (value: number, places = 3): string =>
  Number.isFinite(value) ? value.toFixed(places) : '—';

const out: string[] = [];
function say(line = ''): void {
  out.push(line);
  console.log(line);
}

function rule(character = '─', width = 78): void {
  say(character.repeat(width));
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

export async function run(): Promise<void> {
  loadCache();

  const started = Date.now();
  const jobRows = POSTINGS.map(toJobRow);
  setJobs(jobRows);

  /* ---- 1. Embed the corpus --------------------------------------------- */

  const jobDocuments = POSTINGS.map((posting) =>
    buildJobDocument({
      title: posting.title,
      description: posting.description,
      skills: posting.skills,
      location: posting.location,
      type: posting.type,
      experience: posting.experience,
      salary: posting.salary,
      companyName: posting.companyName,
    })
  );

  const jobVectorList = await embedCached(jobDocuments, 'document', 'the job corpus');
  const jobVectors = new Map(POSTINGS.map((posting, index) => [posting.id, jobVectorList[index]]));
  setJobVectors(jobVectors);

  /* ---- 2. Embed the query-derived profiles ------------------------------ */

  const vocabulary = new Map<string, string>();
  for (const posting of POSTINGS) {
    for (const skill of posting.skills) {
      const key = canonicalSkill(skill);
      if (key && !vocabulary.has(key)) vocabulary.set(key, skill);
    }
  }

  const profiles = QUERIES.map((query) => toProfile(query, vocabulary));
  const profileVectors = await embedCached(
    profiles.map((profile) => profile.document),
    'document',
    'the query-derived profiles'
  );

  /* ---- 3. Run every ranker over every query ----------------------------- */

  const results = new Map<Ranker, Map<string, QueryResult>>();
  for (const ranker of RANKERS) results.set(ranker, new Map());

  const limit = POSTINGS.length;

  for (const ranker of RANKERS) {
    setVectorArmEnabled(ranker !== 'lexical');
    setLexicalArmEnabled(ranker !== 'vector');
    invalidateJobVectorCache();

    for (const query of QUERIES) {
      if (ranker === 'legacy') {
        const hits = await semanticJobSearch(query.text, { limit, minRelevance: 0 });
        results.get(ranker)?.set(query.id, {
          ranked: (hits ?? []).map((hit) => hit.jobId),
          mode: hits === null ? 'unavailable' : 'semantic',
        });
        continue;
      }

      const result = await hybridJobSearch(query.text, { limit });
      results.get(ranker)?.set(query.id, {
        ranked: (result?.hits ?? []).map((hit) => hit.jobId),
        mode: result?.mode ?? 'null',
      });
    }
  }

  setVectorArmEnabled(true);
  setLexicalArmEnabled(true);
  invalidateJobVectorCache();

  /* ---- 4. Match-score ranking (rankJobs / computeMatch) ------------------ */

  const rankableJobs = POSTINGS.map((posting) => ({
    id: posting.id,
    skills: posting.skills,
    location: posting.location,
    experience: posting.experience,
    embedding: { vector: jobVectors.get(posting.id) ?? [] },
  }));

  const matchRanked = new Map<string, string[]>();
  const breakdowns = new Map<string, Map<string, MatchBreakdown>>();

  QUERIES.forEach((query, index) => {
    const profile: ProfileVectorContext = {
      vector: profileVectors[index],
      skills: profiles[index].skills,
      location: profiles[index].location,
      seniority: profiles[index].seniority,
      yearsOfExp: null,
    };

    const ranked = rankJobs(profile, rankableJobs);
    const perJob = new Map<string, MatchBreakdown>();
    for (const entry of ranked) if (entry.match) perJob.set(entry.job.id, entry.match);
    breakdowns.set(query.id, perJob);

    matchRanked.set(
      query.id,
      [...ranked]
        .sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1))
        .map((entry) => entry.job.id)
    );
  });

  /* ---- 5. Report -------------------------------------------------------- */

  say();
  rule('═');
  say('NextHire retrieval evaluation');
  rule('═');
  say(`date            ${new Date().toISOString()}`);
  say(`model           ${EMBEDDING_MODEL} @ ${EMBEDDING_DIMENSIONS}d`);
  say(`corpus          ${POSTINGS.length} synthetic postings, ${QUERIES.length} judged queries`);
  say(`cache           ${CACHE_DIR}`);

  reportHeadline(results, matchRanked);
  reportPerQuery(results, matchRanked);
  reportByCategory(results);
  reportIntrusions(results, matchRanked);

  const bands = reportScoreBand(jobVectors, profileVectors);
  await reportSkillLayers(
    new Map(QUERIES.map((query, index) => [query.id, profiles[index].skills]))
  );
  reportWeightSensitivity(breakdowns);
  reportQueryUnderstanding();
  reportCost(results);

  rule('═');
  say(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  say();

  saveCache();

  writeFileSync(
    resolve(CACHE_DIR, 'last-run.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        rankers: Object.fromEntries(
          RANKERS.map((ranker) => [
            ranker,
            aggregate(QUERIES.map((query) => score(results.get(ranker)?.get(query.id)?.ranked ?? [], query))),
          ])
        ),
        match: aggregate(QUERIES.map((query) => score(matchRanked.get(query.id) ?? [], query))),
        bands,
      },
      null,
      2
    ),
    'utf8'
  );

  writeFileSync(resolve(CACHE_DIR, 'last-run.txt'), `${out.join('\n')}\n`, 'utf8');
}

function aggregate(cards: ScoreCard[]): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const k of K_VALUES) {
    summary[`recall@${k}`] = mean(cards.map((card) => card.recall[k]));
    summary[`precision@${k}`] = mean(cards.map((card) => card.precision[k]));
    summary[`ndcg@${k}`] = mean(cards.map((card) => card.ndcg[k]));
  }

  summary.mrr = mean(cards.map((card) => card.mrr));
  summary.intrusions = cards.reduce((total, card) => total + card.intrusions, 0);
  return summary;
}

/* -------------------------------------------------------------------------- */
/* Report sections                                                             */
/* -------------------------------------------------------------------------- */

function reportHeadline(
  results: Map<Ranker, Map<string, QueryResult>>,
  matchRanked: Map<string, string[]>
): void {
  say();
  rule();
  say('RETRIEVAL — averaged over all queries (percent)');
  rule();
  say(
    `${pad('ranker', 10)}${K_VALUES.map((k) => padStart(`R@${k}`, 8)).join('')}` +
      `${K_VALUES.map((k) => padStart(`nDCG@${k}`, 9)).join('')}${padStart('MRR', 8)}${padStart('intr', 6)}`
  );

  const rows: Array<[string, ScoreCard[]]> = RANKERS.map((ranker) => [
    ranker,
    QUERIES.map((query) => score(results.get(ranker)?.get(query.id)?.ranked ?? [], query)),
  ]);
  rows.push(['match', QUERIES.map((query) => score(matchRanked.get(query.id) ?? [], query))]);

  for (const [name, cards] of rows) {
    const summary = aggregate(cards);
    say(
      pad(name, 10) +
        K_VALUES.map((k) => padStart(pct(summary[`recall@${k}`]), 8)).join('') +
        K_VALUES.map((k) => padStart(pct(summary[`ndcg@${k}`]), 9)).join('') +
        padStart(pct(summary.mrr), 8) +
        padStart(String(summary.intrusions), 6)
    );
  }

  say();
  say('  R@k        share of judged-relevant postings inside the top k');
  say('  nDCG@k     ranking quality, graded 3/2/1, exponential gain');
  say('  MRR        1/rank of the first grade-3 ("this is the answer") posting');
  say('  intr       total `mustNotRank` postings that appeared in a top 5');
  say('  match      rankJobs/computeMatch over query-derived profiles, not retrieval');
}

function reportPerQuery(
  results: Map<Ranker, Map<string, QueryResult>>,
  matchRanked: Map<string, string[]>
): void {
  say();
  rule();
  say('PER QUERY — nDCG@10, and the rank the grade-3 answer landed at');
  rule();
  say(
    pad('query', 34) +
      pad('cat', 11) +
      RANKERS.map((ranker) => padStart(ranker.slice(0, 6), 8)).join('') +
      padStart('match', 8) +
      '  best-answer rank (hybrid)'
  );

  for (const query of QUERIES) {
    const answers = Object.entries(query.relevant)
      .filter(([, grade]) => grade === 3)
      .map(([id]) => id);

    const hybrid = results.get('hybrid')?.get(query.id)?.ranked ?? [];
    const positions = answers
      .map((id) => {
        const position = rankOf(hybrid, id);
        return `${id.split('-')[0]}=${position ?? 'MISS'}`;
      })
      .join(' ');

    say(
      pad(query.id, 34) +
        pad(query.category, 11) +
        RANKERS.map((ranker) =>
          padStart(pct(ndcgAtK(results.get(ranker)?.get(query.id)?.ranked ?? [], query.relevant, 10)), 8)
        ).join('') +
        padStart(pct(ndcgAtK(matchRanked.get(query.id) ?? [], query.relevant, 10)), 8) +
        '  ' +
        positions
    );
  }
}

function reportByCategory(results: Map<Ranker, Map<string, QueryResult>>): void {
  const categories = [...new Set(QUERIES.map((query) => query.category))];

  say();
  rule();
  say('BY CATEGORY — nDCG@10, so a change can be attributed rather than averaged away');
  rule();
  say(pad('category', 12) + padStart('n', 3) + RANKERS.map((r) => padStart(r, 10)).join(''));

  for (const category of categories) {
    const subset = QUERIES.filter((query) => query.category === category);
    say(
      pad(category, 12) +
        padStart(String(subset.length), 3) +
        RANKERS.map((ranker) =>
          padStart(
            pct(
              mean(
                subset.map((query) =>
                  ndcgAtK(results.get(ranker)?.get(query.id)?.ranked ?? [], query.relevant, 10)
                )
              )
            ),
            10
          )
        ).join('')
    );
  }
}

function reportIntrusions(
  results: Map<Ranker, Map<string, QueryResult>>,
  matchRanked: Map<string, string[]>
): void {
  const lines: string[] = [];

  for (const query of QUERIES) {
    if (!query.mustNotRank?.length) continue;

    for (const ranker of RANKERS) {
      const found = intrusionsAtK(
        results.get(ranker)?.get(query.id)?.ranked ?? [],
        query.mustNotRank,
        5
      );
      if (found.length) lines.push(`  ${pad(query.id, 34)}${pad(ranker, 9)}${found.join(', ')}`);
    }

    const matchFound = intrusionsAtK(matchRanked.get(query.id) ?? [], query.mustNotRank, 5);
    if (matchFound.length) lines.push(`  ${pad(query.id, 34)}${pad('match', 9)}${matchFound.join(', ')}`);
  }

  say();
  rule();
  say('INTRUSIONS — postings the judgements say must stay out of the top 5');
  rule();
  if (lines.length === 0) say('  none');
  else for (const line of lines) say(line);
}

interface BandReport {
  profileToJob: Distribution;
  queryToJob: Distribution;
  jobToJob: Distribution;
  clampedLow: number;
  clampedHigh: number;
  scoreSpread: Distribution;
  /** What the band should be for this corpus, measured rather than remembered. */
  suggestedFloor: number;
  suggestedCeiling: number;
}

function reportScoreBand(
  jobVectors: Map<string, number[]>,
  profileVectors: number[][]
): BandReport {
  const ids = [...jobVectors.keys()];

  const profileToJob: number[] = [];
  for (const vector of profileVectors) {
    for (const id of ids) profileToJob.push(cosineSimilarity(vector, jobVectors.get(id) ?? []));
  }

  const jobToJob: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      jobToJob.push(cosineSimilarity(jobVectors.get(ids[i]) ?? [], jobVectors.get(ids[j]) ?? []));
    }
  }

  // The retrieval-side distribution: a RETRIEVAL_QUERY vector against
  // RETRIEVAL_DOCUMENT vectors. Read from the product's own query-vector cache,
  // keyed the way `lib/ai/cache.ts` keys it, so these are exactly the vectors
  // the vector arm searched with.
  const queryToJob: number[] = [];
  for (const query of QUERIES) {
    const remainder = parseQuery(query.text).remainder;
    const normalised = remainder.trim().replace(/\s+/g, ' ').toLowerCase();
    const row = readQueryVectorRow(queryVectorKey(normalised));
    if (!row) continue;
    for (const id of ids) queryToJob.push(cosineSimilarity(row.vector, jobVectors.get(id) ?? []));
  }

  const clampedLow = profileToJob.filter((value) => value <= 0.35).length / profileToJob.length;
  const clampedHigh = profileToJob.filter((value) => value >= 0.92).length / profileToJob.length;
  const scores = profileToJob.map((value) => similarityToScore(value));

  const report: Omit<BandReport, 'suggestedFloor' | 'suggestedCeiling'> = {
    profileToJob: describe(profileToJob),
    queryToJob: describe(queryToJob),
    jobToJob: describe(jobToJob),
    clampedLow,
    clampedHigh,
    scoreSpread: describe(scores),
  };

  say();
  rule();
  say('COSINE DISTRIBUTION — the evidence for or against the 0.35 / 0.92 band');
  rule();
  say(
    pad('pairs', 22) +
      padStart('n', 6) +
      ['min', 'p1', 'p5', 'p25', 'p50', 'p75', 'p95', 'p99', 'max'].map((label) => padStart(label, 7)).join('')
  );

  const line = (label: string, distribution: Distribution): void => {
    say(
      pad(label, 22) +
        padStart(String(distribution.count), 6) +
        [
          distribution.min,
          distribution.p.p1,
          distribution.p.p5,
          distribution.p.p25,
          distribution.p.p50,
          distribution.p.p75,
          distribution.p.p95,
          distribution.p.p99,
          distribution.max,
        ]
          .map((value) => padStart(fixed(value), 7))
          .join('')
    );
  };

  line('profile x job (doc)', report.profileToJob);
  line('job x job (doc)', report.jobToJob);
  line('query x job (query)', report.queryToJob);

  say();
  say(`  similarityToScore(cosine) default band          floor 0.350  ceiling 0.920`);
  say(`  profile x job pairs clamped to 0                ${pct(clampedLow)}%`);
  say(`  profile x job pairs clamped to 100              ${pct(clampedHigh)}%`);
  say(
    `  resulting 0-100 score spread                    min ${fixed(report.scoreSpread.min, 0)} ` +
      `p50 ${fixed(report.scoreSpread.p.p50, 0)} max ${fixed(report.scoreSpread.max, 0)} ` +
      `(sd ${fixed(report.scoreSpread.stdev, 1)})`
  );
  // The point of V8: a band is only useful if the corpus actually spans it.
  // Floor at p1 and ceiling at p99 clips the two tails that are noise and hands
  // the remaining 98% of pairs the whole 0-100 range to be distinguished in.
  const suggestedFloor = report.profileToJob.p.p1;
  const suggestedCeiling = report.profileToJob.p.p99;
  const rescored = describe(
    profileToJob.map((value) => similarityToScore(value, suggestedFloor, suggestedCeiling))
  );

  say();
  say(`  measured band for THIS corpus (p1 / p99)        ${fixed(suggestedFloor)} / ${fixed(suggestedCeiling)}`);
  say(
    `  score spread under the measured band            min ${fixed(rescored.min, 0)} ` +
      `p50 ${fixed(rescored.p.p50, 0)} max ${fixed(rescored.max, 0)} (sd ${fixed(rescored.stdev, 1)})`
  );
  say();
  say(`  semanticJobSearch uses a separate hard-coded band, 0.30 / 0.85, against the`);
  say(`  query x job distribution above; its default minRelevance of 25 corresponds`);
  say(`  to a cosine of ${fixed(0.3 + 0.25 * 0.55)}, which this corpus almost never falls below.`);

  return { ...report, suggestedFloor, suggestedCeiling };
}

async function reportSkillLayers(profileSkills: Map<string, string[]>): Promise<void> {
  let pairs = 0;
  let liftedByAlias = 0;
  let liftedByEmbedding = 0;
  const deltas: number[] = [];

  const bySkill = new Map(POSTINGS.map((posting) => [posting.id, posting.skills]));

  for (const query of QUERIES) {
    const skills = profileSkills.get(query.id) ?? [];
    if (skills.length === 0) continue;

    for (const [id, grade] of Object.entries(query.relevant)) {
      if (grade !== 3) continue;
      const jobSkills = bySkill.get(id) ?? [];
      if (jobSkills.length === 0) continue;

      pairs++;
      const sync = scoreSkillsSync(skills, jobSkills);
      const full = await scoreSkills(skills, jobSkills);

      if (sync.shared.length > 0) liftedByAlias++;
      if (full.fuzzy.length > sync.fuzzy.length) liftedByEmbedding++;
      deltas.push(full.score - sync.score);
    }
  }

  say();
  rule();
  say('SKILL MATCHING — what each layer of lib/ai/skills.ts actually contributes');
  rule();
  say(`  grade-3 (profile, posting) pairs compared      ${pairs}`);
  say(`  pairs with an exact/alias overlap (layers 1-2) ${liftedByAlias}`);
  say(`  pairs the embedding layer (3) added a pair to  ${liftedByEmbedding}`);
  say(`  mean score delta, scoreSkills - scoreSkillsSync ${fixed(mean(deltas))}`);
}

/**
 * Weight sensitivity.
 *
 * `MATCH_WEIGHTS` has never been checked against anything. The facets come back
 * from `computeMatch` already computed by the product; all this does is blend
 * the *reported* facets under alternative weights and re-rank. It is arithmetic
 * on the product's own output, not a second implementation of the scorer — but
 * the facets are rounded to whole numbers on the way out, so treat differences
 * under about a point as noise.
 */
function reportWeightSensitivity(breakdowns: Map<string, Map<string, MatchBreakdown>>): void {
  // `MATCH_WEIGHTS` is `as const`, so its type is the four shipped literals.
  // The alternatives have to be typed as plain numbers to sit beside it.
  interface Weights {
    semantic: number;
    skills: number;
    location: number;
    seniority: number;
  }

  const candidates: Array<[string, Weights]> = [
    ['shipped 70/18/7/5', MATCH_WEIGHTS],
    ['semantic only', { semantic: 1, skills: 0, location: 0, seniority: 0 }],
    ['skills-heavy 50/40/5/5', { semantic: 0.5, skills: 0.4, location: 0.05, seniority: 0.05 }],
    ['60/30/5/5', { semantic: 0.6, skills: 0.3, location: 0.05, seniority: 0.05 }],
    ['80/15/3/2', { semantic: 0.8, skills: 0.15, location: 0.03, seniority: 0.02 }],
    ['no location/seniority', { semantic: 0.79, skills: 0.21, location: 0, seniority: 0 }],
  ];

  say();
  rule();
  say('MATCH WEIGHT SENSITIVITY — nDCG@10 of the match ranking under other weights');
  rule();
  say(pad('weights', 26) + padStart('nDCG@10', 10) + padStart('nDCG@5', 10) + padStart('MRR', 10));

  for (const [label, weights] of candidates) {
    const ndcg10: number[] = [];
    const ndcg5: number[] = [];
    const mrr: number[] = [];

    for (const query of QUERIES) {
      const perJob = breakdowns.get(query.id);
      if (!perJob) continue;

      const ranked = [...perJob.entries()]
        .map(([id, breakdown]) => ({
          id,
          value:
            (breakdown.facets.semantic * weights.semantic +
              breakdown.facets.skills * weights.skills +
              breakdown.facets.location * weights.location +
              breakdown.facets.seniority * weights.seniority) /
            100,
        }))
        .sort((a, b) => b.value - a.value)
        .map((entry) => entry.id);

      ndcg10.push(ndcgAtK(ranked, query.relevant, 10));
      ndcg5.push(ndcgAtK(ranked, query.relevant, 5));
      mrr.push(mrrOfBest(ranked, query.relevant));
    }

    say(
      pad(label, 26) + padStart(pct(mean(ndcg10)), 10) + padStart(pct(mean(ndcg5)), 10) + padStart(pct(mean(mrr)), 10)
    );
  }
}

/**
 * What the run cost, and — more usefully — proof that each ranker was really in
 * the mode it claims. `hybridJobSearch` reports its own mode, so a `hybrid` row
 * that quietly degraded to `lexical` because the vector arm was unavailable
 * cannot masquerade as a measurement of hybrid retrieval.
 */
function reportCost(results: Map<Ranker, Map<string, QueryResult>>): void {
  say();
  rule();
  say('RUN COST AND MODE — did each ranker actually run in the mode it claims?');
  rule();

  for (const ranker of RANKERS) {
    const modes = new Map<string, number>();
    for (const query of QUERIES) {
      const mode = results.get(ranker)?.get(query.id)?.mode ?? 'missing';
      modes.set(mode, (modes.get(mode) ?? 0) + 1);
    }
    say(
      `  ${pad(ranker, 10)}${[...modes.entries()].map(([mode, count]) => `${mode} x${count}`).join(', ')}`
    );
  }

  say();
  say(`  fixture embeddings          ${embedStats.fromCache} cached, ${embedStats.fromApi} fresh ` +
      `(${embedStats.apiCalls} Gemini round trips)`);
  say(`  SQL statements interpreted  ${dbStats.statements}`);
  say(
    `  query-vector cache          ${dbStats.queryVectorHits} hits, ${dbStats.queryVectorMisses} misses ` +
      `(lib/ai/cache.ts, exercised for real)`
  );
  say(
    `  skill-vector table          ${dbStats.skillVectorReads} tags looked up, ` +
      `${dbStats.skillVectorWrites} newly embedded (lib/ai/skills.ts layer 3)`
  );
  say();
  say(`  semanticJobSearch calls embedText directly and predates the query-vector`);
  say(`  cache, so the 'legacy' ranker pays one embedding per query on every run.`);
  say(`  That is a property of the product, not of the harness.`);
}

/**
 * `parseQuery` against the filters the fixtures say a structured query ought to
 * yield. Checked directly rather than inferred from whether the ranking moved.
 */
function reportQueryUnderstanding(): void {
  say();
  rule();
  say('QUERY UNDERSTANDING — parseQuery vs the filters the fixtures expect');
  rule();

  for (const query of QUERIES) {
    if (!query.expectedFilters) continue;

    const parsed = parseQuery(query.text);
    const expected = query.expectedFilters;
    const problems: string[] = [];

    if (expected.remote !== undefined && parsed.filters.remote !== expected.remote) {
      problems.push(`remote: expected ${expected.remote}, got ${String(parsed.filters.remote)}`);
    }
    if (expected.minSeniority !== undefined && parsed.filters.seniority !== expected.minSeniority) {
      problems.push(`seniority: expected ${expected.minSeniority}, got ${String(parsed.filters.seniority)}`);
    }
    if (expected.minSalaryUsd !== undefined && parsed.filters.minSalary !== expected.minSalaryUsd) {
      problems.push(`minSalary: expected ${expected.minSalaryUsd}, got ${String(parsed.filters.minSalary)}`);
    }
    if (expected.location !== undefined) {
      problems.push(`location: expected ${expected.location}, but parseQuery has no location rule`);
    }

    say(`  ${pad(query.id, 34)}${problems.length === 0 ? 'ok' : 'MISMATCH'}`);
    say(`  ${pad('', 34)}remainder: "${parsed.remainder}"`);
    for (const problem of problems) say(`  ${pad('', 34)}${problem}`);
  }
}
