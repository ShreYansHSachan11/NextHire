import { prisma } from '@/lib/prisma';
import { DUPLICATE_THRESHOLD, isAiEnabled } from './config';
import { cosineSimilarity } from './vector';

/**
 * "More like this" and near-duplicate detection — ROADMAP H1 and H10.
 *
 * Neither feature spends a single model call. Posting or editing a job already
 * writes its vector, so both of these are pure arithmetic over rows we hold:
 * the expensive half shipped with the matcher, and this is the interest on it.
 * That is the whole reason they are worth building now rather than later.
 *
 * Both fail soft the way the rest of `lib/ai` does. No key, an unindexed
 * corpus, or a database that will not answer yields an empty result rather than
 * an error — a job page must render without its neighbours, and a moderation
 * report is allowed to say "nothing found".
 */

/* -------------------------------------------------------------------------- */
/* Similar jobs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ceiling on the neighbour scan. This is a linear pass against one vector, the
 * same shape of work `semanticJobSearch` already does per query, so it carries
 * the same 2000-row cap.
 */
const NEIGHBOUR_SCAN_LIMIT = 2000;

export const DEFAULT_SIMILAR_LIMIT = 6;
export const MAX_SIMILAR_LIMIT = 12;

/**
 * How many neighbours any one company may contribute.
 *
 * Not zero, and not unlimited. Excluding the source company outright would hide
 * a genuinely useful result — someone reading "Backend Engineer II" at Acme
 * often does want "Backend Engineer III" at Acme — but five slots filled by one
 * employer is a worse page than five employers, and it reads as promotion
 * rather than as a recommendation. A quota keeps the one useful sibling and
 * drops the rest. It applies to *every* company, not just the source's, because
 * a high-volume poster crowds the list in exactly the same way.
 *
 * Nothing refills the slots a quota costs: a short varied list beats a padded
 * one, so a page may legitimately show fewer than `limit` neighbours.
 */
const MAX_PER_COMPANY = 2;

/**
 * Floor below which a "similar role" is not similar enough to show.
 *
 * Deliberately loose. Postings share so much boilerplate that two plainly
 * unrelated roles at one company measure ~0.82 on the current corpus, so this
 * is a guard against a thin index surfacing noise rather than a tuned
 * parameter — it wants replacing with a measured percentile once the
 * calibration and evaluation work in ROADMAP V8/V11 exists.
 */
const MIN_NEIGHBOUR_SIMILARITY = 0.6;

export interface SimilarJobHit {
  jobId: string;
  /**
   * Raw cosine in [-1, 1] — deliberately *not* the 0–100 match score. This
   * measures one posting against another; a match score measures a person
   * against a posting. Putting it on the same 0–100 band the UI already uses
   * for fit would invite exactly that confusion.
   */
  similarity: number;
}

/** Cosine rounded for transport; three places is well past what any UI shows. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Nearest neighbours of a posting by cosine over the active job vectors.
 *
 * Returns an empty list — never an error — when AI is off, when the job has no
 * vector yet, or when nothing clears the floor. Callers are expected to render
 * nothing at all in that case.
 */
export async function findSimilarJobs(
  jobId: string,
  limit: number = DEFAULT_SIMILAR_LIMIT
): Promise<SimilarJobHit[]> {
  if (!isAiEnabled()) return [];

  const wanted = Math.min(MAX_SIMILAR_LIMIT, Math.max(1, Math.trunc(limit) || 0));

  try {
    const source = await prisma.jobEmbedding.findUnique({
      where: { jobId },
      select: { vector: true },
    });

    if (!source?.vector?.length) return [];

    // Ordered by recency so that when the cap does bite it keeps the live end
    // of the corpus rather than an arbitrary page of it.
    const rows = await prisma.jobEmbedding.findMany({
      where: { jobId: { not: jobId }, job: { isActive: true } },
      select: { jobId: true, vector: true, job: { select: { companyId: true } } },
      orderBy: { job: { createdAt: 'desc' } },
      take: NEIGHBOUR_SCAN_LIMIT,
    });

    const scored = rows
      .map((row) => ({
        jobId: row.jobId,
        companyId: row.job.companyId,
        vector: row.vector,
        similarity: cosineSimilarity(source.vector, row.vector),
      }))
      .filter(
        (candidate) =>
          candidate.similarity >= MIN_NEIGHBOUR_SIMILARITY &&
          // A posting this close is not a *similar* role, it is the same role
          // listed twice. Showing it makes the section look broken;
          // `findDuplicateJobs` is where that belongs instead.
          candidate.similarity < DUPLICATE_THRESHOLD
      )
      .sort((a, b) => b.similarity - a.similarity);

    const perCompany = new Map<string, number>();
    const chosen: typeof scored = [];

    for (const candidate of scored) {
      if (chosen.length >= wanted) break;

      const used = perCompany.get(candidate.companyId) ?? 0;
      if (used >= MAX_PER_COMPANY) continue;

      // The corpus can hold the same posting several times over, and those rows
      // are equally similar to the source, so they would all be picked. The
      // duplicate test therefore runs against what has already been chosen as
      // well. Cheap: at most `limit` comparisons per candidate.
      const duplicatesAChoice = chosen.some(
        (picked) => cosineSimilarity(picked.vector, candidate.vector) >= DUPLICATE_THRESHOLD
      );
      if (duplicatesAChoice) continue;

      perCompany.set(candidate.companyId, used + 1);
      chosen.push(candidate);
    }

    return chosen.map((candidate) => ({
      jobId: candidate.jobId,
      similarity: round(candidate.similarity),
    }));
  } catch (error) {
    console.error('findSimilarJobs failed:', error);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Duplicate detection                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ceiling on the corpus a duplicate scan will examine.
 *
 * Unlike the neighbour lookup this compares every posting with every other one,
 * so the work is quadratic: 1000 postings is 499,500 pairs, measured at roughly
 * 0.4s of arithmetic in Node — about the most an admin should wait on a report,
 * and half the row transfer `semanticJobSearch` already does per search. 2000
 * would be four times the pairs, not twice.
 *
 * Past this size the answer is not a larger cap. It is to block candidates
 * first — bucket by company, by title trigram or by a coarse projection of the
 * vector, and compare only within a bucket — or to push the comparison down
 * into pgvector on the upgrade path AI.md describes. The scan is isolated in
 * this one function so that swap stays local.
 */
const DUPLICATE_SCAN_LIMIT = 1000;

export const DEFAULT_CLUSTER_LIMIT = 50;
export const MAX_CLUSTER_LIMIT = 200;

export interface DuplicateCluster {
  /** Every posting in the group, most recently posted first. */
  jobIds: string[];
  size: number;
  /** Highest pairwise cosine inside the cluster. */
  similarity: number;
  /** True when the whole cluster belongs to one company. */
  sameCompany: boolean;
}

export interface DuplicateScanOptions {
  /** Maximum clusters returned. */
  limit?: number;
  /** Overrides `DUPLICATE_THRESHOLD`, for tuning against a real corpus. */
  threshold?: number;
  /** Lowers `DUPLICATE_SCAN_LIMIT`; can never raise it. */
  scanLimit?: number;
}

export interface DuplicateReport {
  /** How many postings were actually compared. */
  scanned: number;
  threshold: number;
  clusters: DuplicateCluster[];
  /** True when the cap bit and older postings went unexamined. */
  truncated: boolean;
}

/** Disjoint-set over array indices, path-flattened as it goes. */
function makeFinder(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index);

  function find(index: number): number {
    let root = index;
    while (parent[root] !== root) root = parent[root];

    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  return {
    find,
    union(a: number, b: number) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootB] = rootA;
    },
  };
}

/**
 * Finds near-identical active postings and groups them.
 *
 * Grouped transitively rather than returned as pairs: at this threshold the
 * relation is effectively "this is the same advert", so a moderator handed
 * A~B and then B~C would be reading the same posting twice. One cluster is
 * one decision.
 *
 * Purely a report. Nothing here writes, deactivates or deletes — a cosine is
 * evidence of a duplicate, not proof of one, and two teams genuinely can post
 * the same boilerplate role.
 */
export async function findDuplicateJobs(
  options: DuplicateScanOptions = {}
): Promise<DuplicateReport> {
  const threshold = Number.isFinite(options.threshold)
    ? Math.min(0.999, Math.max(0.5, options.threshold as number))
    : DUPLICATE_THRESHOLD;

  const empty: DuplicateReport = { scanned: 0, threshold, clusters: [], truncated: false };
  if (!isAiEnabled()) return empty;

  const scanLimit = Number.isFinite(options.scanLimit)
    ? Math.min(DUPLICATE_SCAN_LIMIT, Math.max(2, Math.trunc(options.scanLimit as number)))
    : DUPLICATE_SCAN_LIMIT;

  const clusterLimit = Number.isFinite(options.limit)
    ? Math.min(MAX_CLUSTER_LIMIT, Math.max(1, Math.trunc(options.limit as number)))
    : DEFAULT_CLUSTER_LIMIT;

  try {
    const rows = await prisma.jobEmbedding.findMany({
      where: { job: { isActive: true } },
      select: { jobId: true, vector: true, job: { select: { companyId: true } } },
      // Newest first: a duplicate is almost always a recent repost of something
      // recent, and the fresh end of the corpus is the end a moderator can
      // still act on.
      orderBy: { job: { createdAt: 'desc' } },
      take: scanLimit,
    });

    if (rows.length < 2) return { ...empty, scanned: rows.length };

    const finder = makeFinder(rows.length);
    // Only pairs at or above the threshold are kept, which on a healthy corpus
    // is a handful. This list never grows with the square of the corpus.
    const pairs: Array<{ a: number; b: number; similarity: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const similarity = cosineSimilarity(rows[i].vector, rows[j].vector);
        if (similarity < threshold) continue;
        pairs.push({ a: i, b: j, similarity });
        finder.union(i, j);
      }
    }

    const members = new Map<number, Set<number>>();
    const strongest = new Map<number, number>();

    for (const pair of pairs) {
      const root = finder.find(pair.a);
      const group = members.get(root) ?? new Set<number>();
      group.add(pair.a);
      group.add(pair.b);
      members.set(root, group);
      strongest.set(root, Math.max(strongest.get(root) ?? 0, pair.similarity));
    }

    const clusters: DuplicateCluster[] = [];
    for (const [root, indices] of members) {
      // `rows` came back newest-first, so index order is recency order.
      const ordered = [...indices].sort((a, b) => a - b);
      const companies = new Set(ordered.map((index) => rows[index].job.companyId));

      clusters.push({
        jobIds: ordered.map((index) => rows[index].jobId),
        size: ordered.length,
        similarity: round(strongest.get(root) ?? threshold),
        sameCompany: companies.size === 1,
      });
    }

    // Biggest first: a five-way repost is a more urgent read than a single
    // pair, so a moderator working top-down clears the worst offenders first.
    clusters.sort((a, b) => b.size - a.size || b.similarity - a.similarity);

    return {
      scanned: rows.length,
      threshold,
      clusters: clusters.slice(0, clusterLimit),
      truncated: rows.length >= scanLimit,
    };
  } catch (error) {
    console.error('findDuplicateJobs failed:', error);
    return empty;
  }
}
