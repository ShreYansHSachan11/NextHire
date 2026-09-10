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

/** Scales a vector to unit length so a dot product is the cosine similarity. */
export function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;

  const magnitude = Math.sqrt(sumSquares);
  if (!Number.isFinite(magnitude) || magnitude === 0) return vector.slice();

  return vector.map((value) => value / magnitude);
}

/**
 * Cosine similarity in [-1, 1]. Both inputs are expected to be normalised, in
 * which case this is a plain dot product; it stays correct either way because
 * we divide by the magnitudes.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  // Guard against a dimension change between when two rows were embedded —
  // comparing across widths would silently produce nonsense.
  const length = Math.min(a.length, b.length);

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < length; i++) {
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
 * Real-world text embeddings of two loosely-related documents rarely fall below
 * about 0.35, and near-identical ones rarely exceed about 0.92. Rescaling that
 * working band to 0–100 keeps the number meaningful: a straight `cosine * 100`
 * would compress every job into the 60–80 range and make the score useless for
 * ranking by eye.
 */
export function similarityToScore(cosine: number, floor = 0.35, ceiling = 0.92): number {
  if (!Number.isFinite(cosine)) return 0;
  const clamped = Math.max(floor, Math.min(ceiling, cosine));
  const scaled = (clamped - floor) / (ceiling - floor);
  return Math.round(scaled * 100);
}

/** Jaccard overlap of two tag sets, case- and whitespace-insensitive. */
export function tagOverlap(a: string[], b: string[]): number {
  const left = new Set(a.map(canonicalTag).filter(Boolean));
  const right = new Set(b.map(canonicalTag).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const tag of left) if (right.has(tag)) intersection++;

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function canonicalTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

/** Which tags actually appear in both sets — used to explain a match. */
export function sharedTags(a: string[], b: string[]): string[] {
  const right = new Map(b.map((tag) => [canonicalTag(tag), tag]));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of a) {
    const key = canonicalTag(tag);
    if (key && right.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(right.get(key) ?? tag);
    }
  }

  return result;
}

/**
 * Returns the top `limit` entries by score, descending. Kept as a partial
 * selection rather than a full sort because ranking every job in the corpus to
 * show ten of them is wasted work once the corpus is large.
 */
export function topBy<T>(items: T[], score: (item: T) => number, limit: number): T[] {
  return items
    .map((item) => ({ item, value: score(item) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((entry) => entry.item);
}
