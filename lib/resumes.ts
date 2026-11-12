import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { canActAs, type SessionUser } from '@/lib/auth';

/**
 * Server-only helpers for reading a stored resume back out of Cloudinary.
 *
 * Resumes are uploaded with `resource_type: 'auto'`, which files a PDF under
 * `image`. Cloudinary accounts refuse to *deliver* PDF and ZIP files from
 * public `res.cloudinary.com` URLs unless "Allow delivery of PDF and ZIP files"
 * is switched on in the account's security settings - with it off, the stored
 * `secure_url` answers 401 ("deny or ACL failure") to everyone, signed or not.
 *
 * The authenticated download API (`api.cloudinary.com/.../download`) is not
 * subject to that setting, so every read goes through a short-lived signed URL
 * for it instead, made and fetched on the server.
 */

let configured = false;

export function configureCloudinary(): void {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY.CLOUD_NAME,
    api_key: env.CLOUDINARY.API_KEY,
    api_secret: env.CLOUDINARY.API_SECRET,
  });
  configured = true;
}

type ResourceType = 'image' | 'raw' | 'video';

interface ResumeAsset {
  publicId: string;
  resourceType: ResourceType;
  deliveryType: string;
  /** The file extension for image/video assets; raw public ids already carry it. */
  format: string | undefined;
}

/**
 * Reads `/<cloud>/<resource_type>/<type>/[v123/]<public_id>[.ext]` out of the
 * stored delivery URL. The stored `publicId` wins when present; the URL is the
 * only record of the resource type either way.
 */
export function resumeAsset(url: string, storedPublicId?: string | null): ResumeAsset | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }

  // [cloud, resource_type, type, ...rest]
  if (segments.length < 4) return null;
  const resourceType = segments[1] as ResourceType;
  if (!['image', 'raw', 'video'].includes(resourceType)) return null;
  const deliveryType = segments[2];

  let rest = segments.slice(3);
  if (/^v\d+$/.test(rest[0] ?? '')) rest = rest.slice(1);
  const path = rest.join('/');
  if (!path) return null;

  if (resourceType === 'raw') {
    return { publicId: storedPublicId || path, resourceType, deliveryType, format: undefined };
  }

  const match = path.match(/^(.*)\.([^./]+)$/);
  const publicId = storedPublicId || (match ? match[1] : path);
  return { publicId, resourceType, deliveryType, format: match?.[2]?.toLowerCase() };
}

const DOWNLOAD_TTL_SECONDS = 5 * 60;

/** A signed, five-minute link to the original file via the download API. */
export function resumeDownloadUrl(url: string, publicId?: string | null): string | null {
  const asset = resumeAsset(url, publicId);
  if (!asset) return null;

  configureCloudinary();
  return cloudinary.utils.private_download_url(asset.publicId, asset.format ?? '', {
    resource_type: asset.resourceType,
    type: asset.deliveryType,
    expires_at: Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS,
  });
}

/**
 * Fetches the stored file. Tries the download API first, then the plain
 * delivery URL (which still works for DOC/DOCX and on accounts that allow PDF
 * delivery), and returns whichever answered last so the caller can log it.
 */
export async function fetchResumeFile(
  resume: { url: string; publicId?: string | null },
  timeoutMs: number
): Promise<Response> {
  const signed = resumeDownloadUrl(resume.url, resume.publicId);

  if (signed) {
    try {
      const response = await fetch(signed, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      console.error('Cloudinary resume download API status:', response.status);
      await response.body?.cancel();
    } catch (error) {
      console.error('Cloudinary resume download API failed:', error);
    }
  }

  return fetch(resume.url, { signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * A company may see a seeker's resume only once that seeker has applied to one
 * of its jobs - that application is the consent to share it.
 */
export async function mayViewResumesOf(session: SessionUser, userId: string): Promise<boolean> {
  if (canActAs(session, userId)) return true;
  if (session.role !== 'COMPANY' || !session.companyId) return false;

  const application = await prisma.application.findFirst({
    where: { userId, job: { companyId: session.companyId } },
    select: { id: true },
  });
  return application !== null;
}

/* -------------------------------------------------------------------------- */
/* Reading the latest resume for the model                                     */
/* -------------------------------------------------------------------------- */

/** ~10 MB. Well above the 5 MB upload cap, but a remote URL is not trusted. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_FETCH_TIMEOUT_MS = 20_000;

const PDF = 'application/pdf';
const DOC = 'application/msword';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUPPORTED_MIME_TYPES = [PDF, DOC, DOCX];

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

export type ResumeDocument =
  | {
      ok: true;
      data: Uint8Array;
      mimeType: string;
      resume: { id: string; fileName: string | null; createdAt: Date };
    }
  | { ok: false; status: number; error: string };

/**
 * The seeker's latest resume as bytes the model can read, or the message to
 * show them when it cannot be had. Shared by every route that hands the file
 * to Gemini, so they all fail the same way for the same reason.
 */
export async function loadResumeDocument(userId: string): Promise<ResumeDocument> {
  const [resume] = await prisma.resume.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, url: true, publicId: true, fileName: true, createdAt: true },
  });

  if (!resume) {
    return { ok: false, status: 404, error: 'Upload a resume first and we will read it.' };
  }

  // Through the signed download API, not `resume.url`: Cloudinary answers
  // 401 to public PDF URLs on accounts that block PDF delivery.
  let file: Response;
  try {
    file = await fetchResumeFile(resume, DOCUMENT_FETCH_TIMEOUT_MS);
  } catch (error) {
    console.error('resume download failed:', error);
    return {
      ok: false,
      status: 502,
      error: 'We could not download your resume file. Please try again in a moment.',
    };
  }

  if (!file.ok) {
    console.error('resume download status:', file.status);
    // A 404 means the file really is gone; anything else is on our side, and
    // re-uploading would not help.
    return {
      ok: false,
      status: 502,
      error:
        file.status === 404
          ? 'We could not find your resume file. Please upload it again.'
          : 'We could not open your resume file right now. Please try again in a moment.',
    };
  }

  const tooLarge = {
    ok: false as const,
    status: 400,
    error: 'That resume file is too large for us to read. Please upload a smaller one.',
  };

  // Check the advertised size before buffering, so an oversized file never
  // makes it into memory in the first place.
  const declaredSize = Number(file.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_DOCUMENT_BYTES) {
    await file.body?.cancel();
    return tooLarge;
  }

  const mimeType = resolveMimeType(file.headers.get('content-type'), resume.fileName ?? '', resume.url);
  if (!mimeType) {
    await file.body?.cancel();
    return { ok: false, status: 400, error: 'We can only read PDF, DOC and DOCX resumes.' };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  if (data.byteLength === 0) {
    return { ok: false, status: 400, error: 'That resume file appears to be empty. Please upload it again.' };
  }
  if (data.byteLength > MAX_DOCUMENT_BYTES) return tooLarge;

  return {
    ok: true,
    data,
    mimeType,
    resume: { id: resume.id, fileName: resume.fileName, createdAt: resume.createdAt },
  };
}
