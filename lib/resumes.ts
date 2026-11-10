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
