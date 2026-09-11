import { prisma } from '@/lib/prisma';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  QUERY_CACHE_TTL_MS,
  VECTOR_CACHE_TTL_MS,
  isAiEnabled,
} from './config';
import { contentHash } from './documents';
import { embedText } from './gemini';

/**
 * The two caches that stand between search and its two costs.
 *
 * Search is the only read path in the portal that has to embed on the request
 * itself, and the only one that reads the whole vector corpus. Before this
 * module, every `?q=` spent a Gemini call (~300ms) and pulled up to 2000 rows of
 * 768 doubles out of Postgres to do a millisecond of arithmetic. Neither cost
 * is inherent: a query's *meaning* does not change between two people typing
 * it, and the corpus does not change between two searches a second apart.
 *
 * Both layers fail soft. A cache read or write that throws is logged and
 * ignored — a caching problem must degrade search to its old cost, never to an
 * error.
 */

/* -------------------------------------------------------------------------- */
/* Query vectors — persisted, shared across processes                          */
/* -------------------------------------------------------------------------- */

/**
 * Normalises the surface form of a query so that trivially different spellings
 * share one cache entry.
 *
 * Case and whitespace only. Stemming or stopword removal would change what the
 * embedding model actually sees, and the cached vector must correspond to the
 * text that was really embedded.
 */
function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Cache key for a query vector.
 *
 * Built with the same `contentHash` construction the job and profile indexes
 * use, so all three key spaces are derived identically and a change to the
 * hashing rule cannot leave one of them behind. The model and the dimensions
 * are inside the hash rather than beside it, which is the point: bumping
 * `GEMINI_EMBEDDING_MODEL` or `GEMINI_EMBEDDING_DIMENSIONS` moves every query
 * to a fresh key, so a stale vector of the wrong shape can never be served.
 */
export function queryVectorKey(
  query: string,
  model: string = EMBEDDING_MODEL,
  dimensions: number = EMBEDDING_DIMENSIONS
): string {
  return contentHash(normaliseQuery(query), model, dimensions);
}

/** Longest query we will key on. Beyond this it is not a search, it is a paste. */
const MAX_QUERY_CHARS = 400;

/**
 * Embeds a search query, reusing a stored vector when one is fresh.
 *
 * Returns `null` when AI is off or the embedding call fails — callers treat
 * that as "no vector arm", not as an error.
 */
export async function embedQueryCached(query: string): Promise<number[] | null> {
  if (!isAiEnabled()) return null;

  const normalised = normaliseQuery(query).slice(0, MAX_QUERY_CHARS);
  if (normalised.length < 2) return null;

  const key = queryVectorKey(normalised);

  const cached = await readQueryVector(key);
  if (cached) return cached;

  const vector = await embedText(normalised, 'query');
  if (!vector) return null;

  await writeQueryVector(key, normalised, vector);
  return vector;
}

async function readQueryVector(key: string): Promise<number[] | null> {
  try {
    const row = await prisma.queryVector.findUnique({
      where: { queryHash: key },
      select: { vector: true, model: true, dimensions: true, createdAt: true },
    });

    if (!row?.vector.length) return null;

    // TTL is measured from `createdAt`, not `updatedAt`. Bumping the clock on
    // every hit would mean a popular query's vector never expires at all, which
    // is exactly the entry most worth re-checking against a newer model.
    if (Date.now() - row.createdAt.getTime() > QUERY_CACHE_TTL_MS) return null;

    // Belt and braces against a hash collision: the model and width are already
    // inside the key, so a mismatch here means the row is not what we asked for.
    if (row.model !== EMBEDDING_MODEL || row.dimensions !== row.vector.length) return null;

    // Popularity accounting is not worth latency on the request path, so the
    // counter is bumped without being awaited.
    void prisma.queryVector
      .update({ where: { queryHash: key }, data: { hits: { increment: 1 } } })
      .catch(() => {
        /* A lost hit count is not worth a log line, let alone a failed search. */
      });

    return row.vector;
  } catch (error) {
    console.error('query vector cache read failed:', error);
    return null;
  }
}

async function writeQueryVector(key: string, query: string, vector: number[]): Promise<void> {
  try {
    await prisma.queryVector.upsert({
      where: { queryHash: key },
      create: {
        queryHash: key,
        query,
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        hits: 1,
      },
      // An update path exists because a TTL expiry re-embeds an existing row.
      // `createdAt` is reset so the refreshed vector gets a full new lifetime.
      update: {
        query,
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    console.error('query vector cache write failed:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Job vectors — in-process, short-lived                                       */
/* -------------------------------------------------------------------------- */

export interface CachedJobVector {
  jobId: string;
  vector: number[];
}

/**
 * Hard ceiling on how many job vectors are held in memory.
 *
 * 2000 × 768 doubles is roughly 12 MB, which is the same volume the old
 * un-cached scan pulled out of Postgres on *every* search; holding it costs one
 * process's worth of heap and pays for itself after two queries a minute. The
 * cap is what stops the cache growing with the corpus: past it, the newest
 * postings are cached and older ones drop out of the vector arm rather than the
 * process quietly consuming a gigabyte.
 *
 * This whole layer is the thing the pgvector upgrade path (AI.md §3) removes.
 * Once similarity is an `ORDER BY vector <=> $1 LIMIT n` inside Postgres there
 * is nothing to hold in Node, and `getActiveJobVectors` goes away with it.
 */
export const JOB_VECTOR_CACHE_LIMIT = 2000;

interface JobVectorCacheEntry {
  rows: CachedJobVector[];
  loadedAt: number;
  /** True when the corpus is larger than the cap and the tail was dropped. */
  truncated: boolean;
}

/**
 * Parked on `globalThis` for the same reason the Prisma client is: Next's dev
 * server re-evaluates modules on every edit, and a module-local cache would be
 * thrown away on each hot reload while the old one stayed pinned by closures.
 */
const globalForCache = globalThis as unknown as { nextHireJobVectors?: JobVectorCacheEntry | null };

/**
 * Active job vectors, loaded at most once per `VECTOR_CACHE_TTL_MS`.
 *
 * Ordered newest-first so that when the corpus outgrows the cap it is the
 * stalest postings that fall out of semantic reach, not the ones people are
 * searching for.
 */
export async function getActiveJobVectors(): Promise<CachedJobVector[]> {
  const cached = globalForCache.nextHireJobVectors;
  if (cached && Date.now() - cached.loadedAt < VECTOR_CACHE_TTL_MS) return cached.rows;

  try {
    const rows = await prisma.jobEmbedding.findMany({
      where: { job: { isActive: true } },
      select: { jobId: true, vector: true },
      orderBy: { job: { createdAt: 'desc' } },
      // One extra row is fetched purely to tell "exactly at the cap" apart from
      // "over it", which is what `truncated` reports.
      take: JOB_VECTOR_CACHE_LIMIT + 1,
    });

    const truncated = rows.length > JOB_VECTOR_CACHE_LIMIT;
    const entry: JobVectorCacheEntry = {
      rows: (truncated ? rows.slice(0, JOB_VECTOR_CACHE_LIMIT) : rows).map((row) => ({
        jobId: row.jobId,
        vector: row.vector,
      })),
      loadedAt: Date.now(),
      truncated,
    };

    globalForCache.nextHireJobVectors = entry;
    return entry.rows;
  } catch (error) {
    console.error('job vector cache load failed:', error);
    // Serve whatever is still in hand rather than losing the vector arm over a
    // transient database blip; an empty list simply degrades search to lexical.
    return cached?.rows ?? [];
  }
}

/**
 * Drops the cached corpus so the next search reloads it.
 *
 * Exported for the write paths that index a posting (`syncJobEmbedding` and the
 * bulk re-index): without it a newly embedded job is invisible to the vector arm
 * for up to `VECTOR_CACHE_TTL_MS`. That window is deliberately short, so calling
 * this is an optimisation rather than a correctness requirement.
 */
export function invalidateJobVectorCache(): void {
  globalForCache.nextHireJobVectors = null;
}
