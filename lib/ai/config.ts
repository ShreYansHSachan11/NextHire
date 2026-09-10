/**
 * Gemini configuration for NextHire.
 *
 * Every AI feature in the portal is optional. If `GEMINI_API_KEY` is not set,
 * `isAiEnabled()` returns false and each caller falls back to the non-AI path:
 * jobs still list, applications still work, search degrades to keyword matching.
 * Nothing in the product may hard-depend on the model being reachable.
 */

/** Embedding model. `gemini-embedding-001` supports asymmetric task types,
 *  which measurably improves query-vs-document retrieval. Override with
 *  `GEMINI_EMBEDDING_MODEL` to move to a newer model. */
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

/**
 * Generative model used for résumé parsing and drafting help.
 *
 * Pinned to an explicit version rather than a `-latest` alias: the résumé
 * parser depends on structured output matching a fixed schema, and an alias
 * that moves underneath us changes that behaviour with no code change and no
 * warning. Bump this deliberately after testing.
 */
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash';

/**
 * Stored vector width. The model emits 3072 by default; 768 keeps the row size
 * and the cosine loop about four times cheaper while losing very little
 * retrieval quality, which is the right trade for a portal of this size.
 */
export const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);

/**
 * Task types tell the model whether it is embedding a stored document or a
 * live query. Only the `-001` family accepts them; newer models take the
 * instruction inline, so we omit the parameter rather than sending an error.
 */
export const SUPPORTS_TASK_TYPE = EMBEDDING_MODEL.includes('embedding-001');

export const TaskType = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
  similarity: 'SEMANTIC_SIMILARITY',
} as const;

/** Requests are batched; the API caps a batch at 100 instances. */
export const EMBED_BATCH_SIZE = 50;

/** Hard ceiling on characters sent per document, well inside the 8k token cap. */
export const MAX_DOCUMENT_CHARS = 12_000;

export const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 20_000);

export function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function isAiEnabled(): boolean {
  return getApiKey() !== null;
}

/**
 * Weights for the composite match score. Semantic similarity carries the
 * decision, but a role that is remote when you want remote — or that matches
 * the seniority you actually have — should measurably move the number, so the
 * score is explainable rather than a single opaque cosine.
 */
export const MATCH_WEIGHTS = {
  semantic: 0.7,
  skills: 0.18,
  location: 0.07,
  seniority: 0.05,
} as const;

/* -------------------------------------------------------------------------- */
/* Phase two — retrieval, skills, caching                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reciprocal Rank Fusion constant for hybrid retrieval.
 *
 * RRF combines the lexical and vector rankings by *position* rather than by
 * score, which is the point: a full-text `ts_rank` and a cosine similarity are
 * not on comparable scales, and any weighted sum of the two would be tuning a
 * meaningless ratio. 60 is the value from the original TREC work and behaves
 * well without corpus-specific tuning.
 */
export const RRF_K = 60;

/** How many candidates each retrieval arm contributes before fusion. */
export const RETRIEVAL_DEPTH = 100;

/**
 * Similarity above which two skill tags are treated as the same skill.
 *
 * Deliberately high. Embedding neighbours degrade gracefully into "vaguely
 * related" ("Go" and "Rust" are close in embedding space but are not the same
 * skill), and a false skill match inflates a candidate's score against a role
 * they cannot do — a worse failure than missing a real one.
 */
export const SKILL_MATCH_THRESHOLD = 0.82;

/** Partial credit given to a skill matched by embedding rather than by alias. */
export const FUZZY_SKILL_CREDIT = 0.75;

/**
 * Query vectors older than this are re-embedded on next use. Postings change,
 * but a query's *meaning* does not, so this is long: it exists to pick up model
 * changes, not to chase freshness.
 */
export const QUERY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** In-process job-vector cache lifetime. Short, because postings do change. */
export const VECTOR_CACHE_TTL_MS = 60 * 1000;

/** Cosine at or above which two postings are treated as near-duplicates. */
export const DUPLICATE_THRESHOLD = 0.94;
