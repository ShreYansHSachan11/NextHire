/**
 * A stand-in for the Postgres text-search primitives the lexical arm uses.
 *
 * **This is the one piece of the harness that is NOT the product's own code,
 * and it is an approximation.** `lib/ai/search.ts` matches documents with
 * `to_tsvector`/`websearch_to_tsquery`/`ts_rank` and falls back to `pg_trgm`.
 * Those live inside Postgres. The harness is required to run without a
 * database, so the alternatives were: skip the lexical arm entirely and never
 * measure hybrid retrieval at all, or re-create the primitives here and say so
 * loudly. This file is the second choice.
 *
 * What that costs, stated plainly:
 *
 *   - The stemmer is a reduced Porter, not Snowball. It is applied identically
 *     to the document and the query, so matching stays self-consistent, but a
 *     word Postgres would conflate and this does not (or the reverse) shifts a
 *     lexical rank by a position or two.
 *   - `tsRank` is a monotone relevance proxy, not Postgres's `ts_rank` density
 *     formula. Only the *order* it produces reaches the product code — RRF
 *     fuses positions, never scores — so the proxy has to get the order roughly
 *     right, not the number.
 *   - Phrase queries are treated as a conjunction of their lexemes; adjacency
 *     is not checked.
 *
 * `trigramSimilarity` is the exception: `pg_trgm`'s definition is public and
 * small, so it is reproduced exactly rather than approximated.
 *
 * Everything measured through this file is therefore a smoke test of *ranking
 * behaviour*, not a prediction of production `ts_rank` ordering. See EVAL.md.
 */

/** The default `english` stopword list, trimmed to what this corpus can hit. */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'me', 'more', 'most', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'you', 'your', 'yours', 'yourself', 'yourselves',
]);

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

function hasVowel(word: string): boolean {
  for (const character of word) if (VOWELS.has(character)) return true;
  return false;
}

/**
 * Reduced Porter stemmer: plural and past/progressive endings only.
 *
 * Words of three characters or fewer are returned untouched, which is not a
 * performance shortcut — it is what keeps `dbt`, `SRE`, `K8s` and `Go` intact.
 * Stripping the `s` off `k8s` would make the synonym query in the fixtures
 * unanswerable for reasons that have nothing to do with retrieval quality.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;

  let result = word;

  if (result.endsWith('sses')) result = result.slice(0, -2);
  else if (result.endsWith('ies')) result = `${result.slice(0, -3)}i`;
  else if (result.endsWith('ss')) {
    /* `ss` is not a plural marker — leave it alone. */
  } else if (result.endsWith('s')) result = result.slice(0, -1);

  if (result.endsWith('eed')) {
    if (hasVowel(result.slice(0, -3))) result = result.slice(0, -1);
  } else if (result.endsWith('ed') && hasVowel(result.slice(0, -2))) {
    result = result.slice(0, -2);
  } else if (result.endsWith('ing') && hasVowel(result.slice(0, -3))) {
    result = result.slice(0, -3);
  }

  return result.length === 0 ? word : result;
}

/**
 * Document/query tokenisation.
 *
 * Splits on anything that is not a letter or a digit, which is how the default
 * Postgres parser ends up treating `io_uring` (two lexemes) and `Next.js` (two
 * lexemes) once its compound token types are expanded.
 */
export function lexemes(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Lexeme -> occurrence count, the shape a `tsvector` actually stores. */
export type TsVector = Map<string, number>;

export function tsVector(text: string): TsVector {
  const vector: TsVector = new Map();
  for (const lexeme of lexemes(text)) vector.set(lexeme, (vector.get(lexeme) ?? 0) + 1);
  return vector;
}

/** One OR-branch: every `include` phrase must match, no `exclude` lexeme may. */
interface QueryGroup {
  include: string[][];
  exclude: string[];
}

export interface TsQuery {
  groups: QueryGroup[];
  /** Flat list of positive lexemes, for ranking. */
  positives: string[];
}

/**
 * `websearch_to_tsquery('english', …)`: quoted phrases, a bare `or`, and a
 * leading `-` to exclude. Anything else is an AND of the remaining words, and
 * nothing is ever a syntax error — which is the property the product relies on.
 */
export function websearchToTsQuery(input: string): TsQuery {
  const groups: QueryGroup[] = [];
  let current: QueryGroup = { include: [], exclude: [] };
  const positives: string[] = [];

  const tokens = input.match(/"[^"]*"|\S+/g) ?? [];

  for (const token of tokens) {
    if (token.toLowerCase() === 'or') {
      groups.push(current);
      current = { include: [], exclude: [] };
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      current.exclude.push(...lexemes(token.slice(1)));
      continue;
    }

    const phrase = lexemes(token.replace(/"/g, ''));
    if (phrase.length === 0) continue;
    current.include.push(phrase);
    positives.push(...phrase);
  }

  groups.push(current);
  return { groups: groups.filter((group) => group.include.length > 0), positives };
}

export function tsMatch(vector: TsVector, query: TsQuery): boolean {
  if (query.groups.length === 0) return false;

  return query.groups.some(
    (group) =>
      group.include.every((phrase) => phrase.every((lexeme) => vector.has(lexeme))) &&
      !group.exclude.some((lexeme) => vector.has(lexeme))
  );
}

/**
 * Relevance proxy standing in for `ts_rank`.
 *
 * Coverage first (how many of the query's distinct lexemes the document
 * contains at all), frequency second and heavily damped. That ordering is the
 * part of `ts_rank`'s behaviour that matters to a fused ranking; the exact
 * density arithmetic is not reproduced. See the header.
 */
export function tsRank(vector: TsVector, query: TsQuery): number {
  if (!tsMatch(vector, query)) return 0;

  const distinct = new Set(query.positives);
  if (distinct.size === 0) return 0;

  let covered = 0;
  let frequency = 0;

  for (const lexeme of distinct) {
    const count = vector.get(lexeme) ?? 0;
    if (count === 0) continue;
    covered++;
    frequency += Math.log1p(count);
  }

  return covered / distinct.size + 0.01 * frequency;
}

/**
 * `pg_trgm`'s `similarity()`, reproduced exactly: the strings are lower-cased,
 * each word is padded with two leading and one trailing space, and the result
 * is the Jaccard index of the resulting trigram sets.
 */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;

  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function trigrams(value: string): Set<string> {
  const grams = new Set<string>();

  for (const word of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  }

  return grams;
}
