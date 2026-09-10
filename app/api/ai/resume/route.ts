import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { requireRole, badRequest, notFound, serverError } from '@/lib/auth';
import { cleanString, cleanText } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJsonFromDocument } from '@/lib/ai/gemini';
import { syncProfileEmbedding } from '@/lib/ai/embeddings';

/**
 * Turns the seeker's uploaded resume into the structured profile the matcher
 * needs (headline, seniority, years, skills, summary).
 *
 * The file is handed to Gemini as raw bytes rather than parsed here: shipping a
 * PDF/DOCX text extractor would only produce a wall of unstructured text that
 * still needs a model to interpret.
 */

// Cloudinary fetch plus a document-grounded generation - the default budget is
// not enough, and this route buffers bytes, so it cannot run on the edge.
export const runtime = 'nodejs';
export const maxDuration = 60;

/** ~10 MB. Well above the 5 MB upload cap, but a remote URL is not trusted. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const PDF = 'application/pdf';
const DOC = 'application/msword';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUPPORTED_MIME_TYPES = [PDF, DOC, DOCX];

/**
 * The labels the matcher's seniority ladder understands. Anything outside this
 * set is dropped rather than stored, because a stray label scores as "unknown"
 * and silently flattens every match.
 */
const SENIORITY_LEVELS = [
  'Intern',
  'Entry',
  'Junior',
  'Mid',
  'Senior',
  'Lead',
  'Staff',
  'Principal',
  'Director',
] as const;

interface ResumeInsights {
  headline: string;
  seniority: string;
  yearsOfExperience: number;
  skills: string[];
  summary: string;
  strengths: string[];
}

const RESUME_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    seniority: { type: Type.STRING, enum: [...SENIORITY_LEVELS] },
    yearsOfExperience: { type: Type.INTEGER },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['headline', 'seniority', 'yearsOfExperience', 'skills', 'summary', 'strengths'],
};

const SYSTEM_INSTRUCTION =
  'You extract structured professional profiles from resumes for a job portal. ' +
  'Report only what the document itself evidences. Never invent employers, job ' +
  'titles, dates, credentials or skills that do not appear in it, and never ' +
  'infer or record age, gender, nationality, marital status or any other ' +
  'protected characteristic. Where the document does not support a field, give ' +
  'the most conservative value rather than a guess.';

const PROMPT = [
  'Read this resume and extract a factual professional profile.',
  '',
  '- headline: one line of at most 120 characters describing what this person does.',
  `- seniority: exactly one of ${SENIORITY_LEVELS.join(', ')}.`,
  '- yearsOfExperience: total years of professional experience as a whole number. Use 0 when the resume shows no professional roles.',
  '- skills: up to 20 concrete technical and professional skills as short tags of one to three words. No sentences, and nothing the resume does not evidence.',
  '- summary: two to three factual sentences in the third person, no marketing language.',
  '- strengths: up to 5 short phrases naming what this candidate is demonstrably strong at.',
].join('\n');

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

/** Cloudinary serves DOC/DOCX as `raw`, so the response header alone is not enough. */
function resolveMimeType(contentType: string | null, ...names: string[]): string | null {
  const header = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (SUPPORTED_MIME_TYPES.includes(header)) return header;

  for (const name of names) {
    const extension = name.toLowerCase().match(/\.(pdf|docx|doc)(?:$|\?)/)?.[1];
    if (extension === 'pdf') return PDF;
    if (extension === 'docx') return DOCX;
    if (extension === 'doc') return DOC;
  }

  return null;
}

/** Model output is untrusted input: everything stored goes through here. */
function cleanTagList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    const tag = cleanString(entry, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= max) break;
  }

  return tags;
}

function cleanSeniority(value: unknown): string | null {
  const raw = cleanString(value, 40);
  if (!raw) return null;
  return SENIORITY_LEVELS.find((level) => level.toLowerCase() === raw.toLowerCase()) ?? null;
}

function cleanYears(value: unknown): number | null {
  const years = Number(value);
  if (!Number.isFinite(years)) return null;
  return Math.min(60, Math.max(0, Math.trunc(years)));
}

/** POST /api/ai/resume - read the caller's latest resume into their profile. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  if (!isAiEnabled()) return aiUnavailable();

  try {
    const [resume] = await prisma.resume.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { url: true, fileName: true },
    });

    if (!resume) {
      return notFound('Upload a resume first and we will read it into your profile.');
    }

    let file: Response;
    try {
      file = await fetch(resume.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      console.error('POST /api/ai/resume download failed:', error);
      return NextResponse.json(
        { error: 'We could not download your resume file. Please try again in a moment.' },
        { status: 502 }
      );
    }

    if (!file.ok) {
      console.error('POST /api/ai/resume download status:', file.status);
      return NextResponse.json(
        { error: 'We could not download your resume file. Please try re-uploading it.' },
        { status: 502 }
      );
    }

    // Check the advertised size before buffering, so an oversized file never
    // makes it into memory in the first place.
    const declaredSize = Number(file.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_BYTES) {
      return badRequest('That resume file is too large for us to read. Please upload a smaller one.');
    }

    const mimeType = resolveMimeType(
      file.headers.get('content-type'),
      resume.fileName ?? '',
      resume.url
    );
    if (!mimeType) {
      return badRequest('We can only read PDF, DOC and DOCX resumes.');
    }

    const data = new Uint8Array(await file.arrayBuffer());
    if (data.byteLength === 0) {
      return badRequest('That resume file appears to be empty. Please upload it again.');
    }
    if (data.byteLength > MAX_FILE_BYTES) {
      return badRequest('That resume file is too large for us to read. Please upload a smaller one.');
    }

    const insights = await generateJsonFromDocument<ResumeInsights>({
      data,
      mimeType,
      prompt: PROMPT,
      schema: RESUME_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    if (!insights) {
      return NextResponse.json(
        { error: 'We could not read your resume right now. Please try again in a moment.' },
        { status: 502 }
      );
    }

    const headline = cleanString(insights.headline, 140);
    const seniority = cleanSeniority(insights.seniority);
    const yearsOfExp = cleanYears(insights.yearsOfExperience);
    const skills = cleanTagList(insights.skills, 25);
    const summary = cleanText(insights.summary, 2000);
    const strengths = cleanTagList(insights.strengths, 5);

    // A reply that survives sanitising with nothing usable left in it means the
    // file was not really a resume - a scanned photo, or an empty template.
    if (!headline && !summary && skills.length === 0) {
      return NextResponse.json(
        {
          error:
            'We could not find a professional profile in that file. Please upload a text-based resume.',
        },
        { status: 422 }
      );
    }

    const aiUpdatedAt = new Date();

    await prisma.user.update({
      where: { id: session.id },
      data: { headline, skills, seniority, yearsOfExp, aiSummary: summary, aiUpdatedAt },
    });

    // Awaited rather than queued: the client renders the new profile straight
    // away, and a stale vector sitting behind a fresh summary is exactly the
    // inconsistency that makes a match score look broken.
    await syncProfileEmbedding(session.id);

    return NextResponse.json({
      headline,
      seniority,
      yearsOfExp,
      skills,
      summary,
      strengths,
      updatedAt: aiUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error('POST /api/ai/resume failed:', error);
    return serverError('We could not analyse your resume. Please try again.');
  }
}
