/**
 * Retrieval metrics and the distribution arithmetic behind the score-band
 * verdict. Nothing here touches the product; it only scores what the product
 * returned against the judgements in `fixtures/queries.ts`.
 */

import type { Grade } from '../fixtures/queries';

/**
 * Fraction of the judged-relevant set that appears in the top `k`.
 *
 * Ungraded — a grade-1 "defensible" result counts the same as the grade-3
 * answer, which is exactly why recall alone is not enough and nDCG is reported
 * beside it. A run can hold recall flat while moving every good result from
 * position 1 to position 9, and only nDCG will say so.
 */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1;

  let found = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) found++;

  return found / relevant.size;
}

export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const window = ranked.slice(0, k);
  if (window.length === 0) return 0;

  let found = 0;
  for (const id of window) if (relevant.has(id)) found++;

  return found / window.length;
}

/**
 * Normalised discounted cumulative gain, exponential gain (`2^g - 1`).
 *
 * The exponential form is the one that makes a graded scale worth having: it
 * puts a grade-3 result three and a half times above a grade-1, so burying the
 * actual answer under two "defensible" ones is visibly punished. Linear gain
 * would barely notice.
 */
export function ndcgAtK(ranked: string[], grades: Record<string, Grade>, k: number): number {
  const gain = (grade: number): number => 2 ** grade - 1;

  let dcg = 0;
  ranked.slice(0, k).forEach((id, index) => {
    const grade = grades[id] ?? 0;
    if (grade > 0) dcg += gain(grade) / Math.log2(index + 2);
  });

  const ideal = Object.values(grades)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((total, grade, index) => total + gain(grade) / Math.log2(index + 2), 0);

  return ideal === 0 ? 0 : dcg / ideal;
}

/** Reciprocal rank of the first grade-3 result, 0 when none is retrieved. */
export function mrrOfBest(ranked: string[], grades: Record<string, Grade>): number {
  for (let index = 0; index < ranked.length; index++) {
    if (grades[ranked[index]] === 3) return 1 / (index + 1);
  }
  return 0;
}

/** 1-based position, or null when the id was never returned. */
export function rankOf(ranked: string[], id: string): number | null {
  const index = ranked.indexOf(id);
  return index === -1 ? null : index + 1;
}

/** How many `mustNotRank` ids leaked into the top `k`. */
export function intrusionsAtK(ranked: string[], forbidden: string[], k: number): string[] {
  const window = new Set(ranked.slice(0, k));
  return forbidden.filter((id) => window.has(id));
}

/* -------------------------------------------------------------------------- */
/* Distributions                                                               */
/* -------------------------------------------------------------------------- */

export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return Number.NaN;

  const position = (p / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedAscending[lower];

  return sortedAscending[lower] + (sortedAscending[upper] - sortedAscending[lower]) * (position - lower);
}

export interface Distribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  stdev: number;
  p: Record<string, number>;
}

export function describe(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((total, value) => total + value, 0) / (sorted.length || 1);
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / (sorted.length || 1);

  const marks = [1, 5, 10, 25, 50, 75, 90, 95, 99];
  const p: Record<string, number> = {};
  for (const mark of marks) p[`p${mark}`] = percentile(sorted, mark);

  return {
    count: sorted.length,
    min: sorted[0] ?? Number.NaN,
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean,
    stdev: Math.sqrt(variance),
    p,
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
