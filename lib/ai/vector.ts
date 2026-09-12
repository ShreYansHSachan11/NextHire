/**
 * Vector helpers.
 *
 * Vectors are stored as `Float[]` (Postgres `double precision[]`) and compared
 * in Node rather than in the database. For a portal of this size that is fast
 * enough — a few thousand jobs is a sub-millisecond loop — and it avoids
 * requiring the `pgvector` extension, which many managed Postgres tiers do not
 * offer. See the note in README on the pgvector upgrade path if the corpus
 * grows past the tens of thousands.
 */

import { canonicalSkill } from './skills';

/** Scales a vector to unit length so a dot product is the cosine similarity. */
export function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;

  const magnitude = Math.sqrt(sumSquares);
  if (!Number.isFinite(magnitude) || magnitude === 0) return vector.slice();

  return vector.map((value) => value / magnitude);
}

/**
 * Whether the "vectors of different widths" warning has already been logged.
 *
 * Once, not once per comparison: the mismatch is a property of a stored row, so
 * a single search can hit it two thousand times in one loop and every line would
 * say the same thing. One line names the problem; the rest are a denial of
 * service on the log.
 */
let warnedAboutWidth = false;

/**
 * Cosine similarity in [-1, 1]. Both inputs are expected to be normalised, in
 * which case this is a plain dot product; it stays correct either way because
 * we divide by the magnitudes.
 *
 * **Vectors of different widths are not comparable, and return 0.** They happen
 * for one reason: `GEMINI_EMBEDDING_DIMENSIONS` changed and some rows were
 * written at the old width. The previous code claimed to guard against exactly
 * this and did not — it compared `Math.min(a.length, b.length)` dimensions and
 * returned a confident number for the overlapping prefix. A 768-wide row
 * against its own 3072-wide re-embedding shares that prefix almost exactly and
 * scored a near-perfect match, so the one case the guard existed for was the
 * case it got most wrong.
 *
 * Returning 0 rather than throwing, deliberately. Every caller is on a
 * fail-soft read path — the jobs feed, search, similar postings, skill pairing
 * — and a `Float[]` column written at the wrong width is a data problem, not a
 * request problem; a throw would turn it into a 500 on the feed for everyone,
 * which is a strictly worse outcome than a missing match score. 0 is also
 * already this function's established "no signal" answer for an empty vector,
 * and `blend` in `matching.ts` passes `[]` on purpose to get it, so callers
 * already handle it: `similarityToScore(0)` clamps to the floor and reports 0,
 * every threshold in the AI layer filters it out, and a mismatch can therefore
 * only ever suppress a match, never invent one. The failure is logged once per
 * process so the stale rows can be found and re-indexed.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  if (a.length !== b.length) {
    if (!warnedAboutWidth) {
      warnedAboutWidth = true;
      console.warn(
        `cosineSimilarity: vectors of different widths (${a.length} vs ${b.length}) are not ` +
          'comparable and scored 0. Some embeddings were written at a different ' +
          'GEMINI_EMBEDDING_DIMENSIONS; re-index to restore them. Logged once per process.'
      );
    }
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Maps a raw cosine score onto the 0–100 figure shown in the UI.
 *
 * Rescaling the working band to 0–100 keeps the number meaningful: a straight
 * `cosine * 100` compresses every job into a narrow range and is useless for
 * ranking by eye.
 *
 * **The defaults are measured, not assumed.** They were originally 0.35/0.92,
 * from the folklore that unrelated documents sit near 0.35. That is false for
 * `gemini-embedding-001`: across 672 profile↔job pairs the observed range was
 * 0.612–0.804 (p1 0.621, p50 0.667, p99 0.775). *Zero* pairs reached either end
 * of the old band, so scores only ever spanned 46–80 — two thirds of the scale
 * was unreachable and an entirely irrelevant posting still scored 46.
 *
 * The band is slightly wider than the measured p1/p99 (0.621/0.775), and that
 * gap is deliberate. Rescaling used to be purely linear — nothing ever reached
 * a limit — so it could not change *ordering*, only the number shown. A band
 * tight enough to clamp starts collapsing distinct scores into ties at both
 * tails: at p1/p99 exactly, `npm run eval` measured match nDCG@10 falling to
 * 91.2, which widening to 0.60/0.80 recovered to 92.8.
 *
 * Against the original 0.35/0.92 that is 92.8 vs 93.5 nDCG@10 — a real but
 * small ranking cost — in exchange for intrusions (an irrelevant posting
 * reaching a top 5) dropping from 3 to 1, and for a score that finally uses the
 * whole scale instead of the 46–80 slice. Worth it: a bad job in someone's top
 * five is the more visible failure, and an uninterpretable number was the thing
 * being fixed.
 *
 * Caveat worth keeping: calibrated on the synthetic corpus in `scripts/eval`,
 * so treat it as the right method and magnitude rather than a universal
 * constant. Re-derive against production data with `npm run eval`, which prints
 * these percentiles. The band is model-specific — changing
 * `GEMINI_EMBEDDING_MODEL` invalidates it.
 */
export function similarityToScore(cosine: number, floor = 0.60, ceiling = 0.80): number {
  if (!Number.isFinite(cosine)) return 0;
  const clamped = Math.max(floor, Math.min(ceiling, cosine));
  const scaled = (clamped - floor) / (ceiling - floor);
  return Math.round(scaled * 100);
}

/**
 * Jaccard overlap of two tag sets, compared on their canonical form.
 *
 * Kept synchronous and exported because several call sites rank whole lists of
 * jobs and cannot await per pair. It gets the alias benefit for free — see
 * `canonicalTag` — but not the embedding layer; `scoreSkills` in
 * `lib/ai/skills.ts` is the version that does.
 */
export function tagOverlap(a: string[], b: string[]): number {
  const left = new Set(a.map(canonicalTag).filter(Boolean));
  const right = new Set(b.map(canonicalTag).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const tag of left) if (right.has(tag)) intersection++;

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Case and punctuation used to be the whole of the normalisation here, which
 * meant `Postgres` and `PostgreSQL` counted as two unrelated skills. The rule
 * now lives in `lib/ai/skills.ts` so that the free, synchronous alias layer
 * applies everywhere a tag is compared, not only on the paths that can await.
 */
function canonicalTag(tag: string): string {
  return canonicalSkill(tag);
}
