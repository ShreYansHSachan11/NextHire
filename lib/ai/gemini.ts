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

    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: batch.map((entry) => entry.text),
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          ...(SUPPORTS_TASK_TYPE ? { taskType: TaskType[purpose] } : {}),
          abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      });

      const embeddings = response.embeddings ?? [];
      batch.forEach((entry, position) => {
        const values = embeddings[position]?.values;
        if (Array.isArray(values) && values.length > 0) {
          // Truncated (non-default) dimensions come back un-normalised on the
          // -001 family, so cosine similarity would be wrong without this.
          results[entry.index] = normalize(values);
        }
      });
    } catch (error) {
      console.error('Gemini embedContent failed:', describeError(error));
      // Leave this batch as nulls and carry on with the next one.
    }
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

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: options.prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: options.schema as never,
        temperature: options.temperature ?? 0.2,
        ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Gemini generateContent failed:', describeError(error));
    return null;
  }
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

  try {
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
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2),
      },
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Gemini document read failed:', describeError(error));
    return null;
  }
}

/** Keeps API keys and long payloads out of the logs. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 300)}`;
  return String(error).slice(0, 300);
}

export { isAiEnabled };
