import { GoogleGenAI } from '@google/genai';
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBED_BATCH_SIZE,
  MAX_DOCUMENT_CHARS,
  REQUEST_TIMEOUT_MS,
  SUPPORTS_TASK_TYPE,
  TEXT_MODEL,
  TaskType,
  getApiKey,
  isAiEnabled,
} from './config';
import { normalize } from './vector';

/**
 * Thin wrapper around the Gemini SDK.
 *
 * Everything here fails soft: a missing key, a timeout or a bad response
 * resolves to `null`/`[]` rather than throwing, because none of the AI features
 * are load-bearing. Callers decide what to show when the signal is absent.
 */

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** Trim to the model's practical input budget without cutting mid-word. */
function clamp(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DOCUMENT_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAX_DOCUMENT_CHARS);
  const lastBreak = cut.lastIndexOf(' ');
  return lastBreak > MAX_DOCUMENT_CHARS * 0.8 ? cut.slice(0, lastBreak) : cut;
}

/* -------------------------------------------------------------------------- */
/* Transient failures                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Statuses the upstream itself describes as temporary.
 *
 * The one that prompted this is 503 UNAVAILABLE — "This model is currently
 * experiencing high demand. Spikes in demand are usually temporary. Please try
 * again later." Google says retry; we were not retrying, so a blip on their
 * side became a dead end on the career coach whose only way forward was the
 * user pressing the button again themselves.
 *
 * **429 is deliberately absent.** Retrying a rate limit inside a 20-second
 * budget mostly re-hits the same window: it spends the user's latency to arrive
 * at the same answer, and against a daily cap it cannot succeed at all. Quota
 * exhaustion should fail fast and degrade, which is what every caller here
 * already does.
 *
 * Other 4xx are never retried either — a malformed request, a revoked key or a
 * model that no longer exists fails identically however many times it is sent.
 */
const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

/**
 * Reads an HTTP status off an SDK error.
 *
 * The `@google/genai` `ApiError` carries the upstream JSON inside its message
 * rather than as a typed field, so the structured properties are tried first
 * and the body is parsed only as a fallback. An unrecognised error returns
 * null, which is treated as "do not retry" — the conservative direction, since
 * a wrong retry spends quota and latency to reach the same failure.
 */
function transientStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };

  for (const value of [candidate.status, candidate.code]) {
    if (typeof value === 'number') return TRANSIENT_STATUS.has(value) ? value : null;
  }

  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return TRANSIENT_STATUS.has(parsed) ? parsed : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a Gemini call, retrying only what the upstream calls temporary.
 *
 * `budgetMs` is the deadline for the whole operation rather than for one
 * attempt, and that is the property that matters: each attempt gets whatever
 * remains, so adding retries cannot push the total past the wait the caller
 * already expected. A slow first attempt simply leaves no room for a second,
 * which is the right trade for an interactive request.
 *
 * An abort is never retried. A timeout means the budget is gone by definition,
 * and re-running a call that has already spent twenty seconds is not a recovery.
 *
 * Failure returns null exactly as before, so nothing downstream changes: no
 * feature in this product is load-bearing on a model reply.
 */
async function withTransientRetry<T>(
  label: string,
  budgetMs: number,
  run: (signal: AbortSignal) => Promise<T | null>
): Promise<T | null> {
  const deadline = Date.now() + budgetMs;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      return await run(AbortSignal.timeout(remaining));
    } catch (error) {
      lastError = error;

      const status = transientStatus(error);
      if (status === null || attempt === MAX_ATTEMPTS) break;

      // Jittered, so a burst of requests that failed together does not come
      // back in lockstep and rebuild the spike being backed off from.
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      if (Date.now() + backoff >= deadline) break;

      console.warn(`${label}: ${status} from the model, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  console.error(`${label}:`, describeError(lastError));
  return null;
}

export type EmbedPurpose = 'document' | 'query' | 'similarity';

/**
 * Embeds a batch of texts, preserving input order. Returns one entry per input;
 * an entry is `null` when that text was empty or the call failed, so a partial
 * failure never silently shifts vectors onto the wrong records.
 */
export async function embedTexts(
  texts: string[],
  purpose: EmbedPurpose = 'document'
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const ai = getClient();
  if (!ai || texts.length === 0) return results;

  // Empty strings would be rejected by the API and would waste a slot in the
  // batch, so they never leave here.
  const pending = texts
    .map((text, index) => ({ text: clamp(text ?? ''), index }))
    .filter((entry) => entry.text.length > 0);

  for (let offset = 0; offset < pending.length; offset += EMBED_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + EMBED_BATCH_SIZE);

    // A failed batch leaves its slots null and the next batch still runs, so a
    // spike part-way through a reindex costs those rows rather than the job.
    const embeddings = await withTransientRetry(
      'Gemini embedContent failed',
      REQUEST_TIMEOUT_MS,
      async (signal) => {
        const response = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch.map((entry) => entry.text),
          config: {
            outputDimensionality: EMBEDDING_DIMENSIONS,
            ...(SUPPORTS_TASK_TYPE ? { taskType: TaskType[purpose] } : {}),
            abortSignal: signal,
          },
        });
        return response.embeddings ?? [];
      }
    );

    if (!embeddings) continue;

    batch.forEach((entry, position) => {
      const values = embeddings[position]?.values;
      if (Array.isArray(values) && values.length > 0) {
        // Truncated (non-default) dimensions come back un-normalised on the
        // -001 family, so cosine similarity would be wrong without this.
        results[entry.index] = normalize(values);
      }
    });
  }

  return results;
}

/** Convenience wrapper for a single text. */
export async function embedText(
  text: string,
  purpose: EmbedPurpose = 'document'
): Promise<number[] | null> {
  const [vector] = await embedTexts([text], purpose);
  return vector ?? null;
}

/**
 * Runs a prompt and parses the reply as JSON, using the model's structured
 * output mode so we are not regex-scraping a markdown code fence.
 */
export async function generateJson<T>(options: {
  prompt: string;
  schema: Record<string, unknown>;
  systemInstruction?: string;
  temperature?: number;
}): Promise<T | null> {
  const ai = getClient();
  if (!ai) return null;

  return withTransientRetry<T>(
    'Gemini generateContent failed',
    REQUEST_TIMEOUT_MS,
    async (signal) => {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: options.prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: options.schema as never,
          temperature: options.temperature ?? 0.2,
          ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
          abortSignal: signal,
        },
      });

      const text = response.text;
      if (!text) return null;
      // A parse failure throws, and `transientStatus` classifies it as final:
      // the same prompt returns the same malformed reply, so retrying it would
      // only spend quota to fail again.
      return JSON.parse(text) as T;
    }
  );
}

/**
 * Same as `generateJson`, but the document is supplied as raw bytes — used to
 * read an uploaded résumé PDF directly rather than shipping a PDF parser.
 */
export async function generateJsonFromDocument<T>(options: {
  data: Uint8Array;
  mimeType: string;
  prompt: string;
  schema: Record<string, unknown>;
  systemInstruction?: string;
}): Promise<T | null> {
  const ai = getClient();
  if (!ai) return null;

  // Double budget, as before: a résumé PDF is a far larger input than a prompt,
  // and the upload has already cost the user a wait.
  return withTransientRetry<T>(
    'Gemini document read failed',
    REQUEST_TIMEOUT_MS * 2,
    async (signal) => {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: options.mimeType,
                  data: Buffer.from(options.data).toString('base64'),
                },
              },
              { text: options.prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: options.schema as never,
          temperature: 0.1,
          ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
          abortSignal: signal,
        },
      });

      const text = response.text;
      if (!text) return null;
      return JSON.parse(text) as T;
    }
  );
}

/** Keeps API keys and long payloads out of the logs. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 300)}`;
  return String(error).slice(0, 300);
}

export { isAiEnabled };
