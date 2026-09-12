import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { prisma } from '@/lib/prisma';
import { env, validateEnv } from '@/lib/env';
import {
  requireAuth,
  requireRole,
  canActAs,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
  type SessionUser,
} from '@/lib/auth';
import { validateResumeFile } from '@/lib/validation';
import { queueProfileEmbedding } from '@/lib/ai/embeddings';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';

// Cloudinary's SDK needs Node APIs (streams, Buffer), so this route can never
// run on the edge runtime.
export const runtime = 'nodejs';

let cloudinaryReady = false;

/**
 * Configured on first use rather than at module scope: `env.CLOUDINARY.*` throws
 * when a variable is missing, and this module is evaluated during `next build`,
 * so configuring eagerly took the whole build down instead of failing the one
 * request that actually needs Cloudinary.
 */
function configureCloudinary(): void {
  if (cloudinaryReady) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY.CLOUD_NAME,
    api_key: env.CLOUDINARY.API_KEY,
    api_secret: env.CLOUDINARY.API_SECRET,
  });
  cloudinaryReady = true;
}

/**
 * `upload_stream` is callback-based; wrap it so failures reject instead of
 * silently resolving `undefined` into the Prisma call.
 */
function uploadToCloudinary(buffer: Buffer): Promise<UploadApiResponse> {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'resumes', resource_type: 'auto' },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Cloudinary returned no result'));
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Best-effort fallback for rows created before `publicId` was stored. The old
 * code took `url.split('/').pop().split('.')[0]`, which dropped the folder and
 * broke on nested or versioned paths, so nothing was ever really deleted.
 */
function publicIdFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname; // /<cloud>/<type>/upload/v123/resumes/abc.pdf
    const marker = '/upload/';
    const index = path.indexOf(marker);
    if (index === -1) return null;

    let rest = path.slice(index + marker.length);
    // Strip the optional version segment and any transformation prefix.
    rest = rest.replace(/^v\d+\//, '');
    // Drop only the final extension; folder names may contain dots.
    return decodeURIComponent(rest.replace(/\.[^./]+$/, '')) || null;
  } catch {
    return null;
  }
}

type StoredResume = { url: string; publicId: string | null };

/** Removing the asset is housekeeping — never fail the request over it. */
async function destroyAssets(resumes: StoredResume[]) {
  if (resumes.length > 0) configureCloudinary();

  for (const resume of resumes) {
    const publicId = resume.publicId ?? publicIdFromUrl(resume.url);
    if (!publicId) continue;

    // `resource_type: 'auto'` files land under `image` for PDFs and `raw` for
    // DOC/DOCX, and the public id doesn't record which, so try both.
    for (const resourceType of ['image', 'raw'] as const) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      } catch (error) {
        console.error('Cloudinary destroy failed:', error);
      }
    }
  }
}

/**
 * A company may see a seeker's resume only once that seeker has applied to one
 * of its jobs — that application is the consent to share it.
 */
async function mayViewResumesOf(session: SessionUser, userId: string): Promise<boolean> {
  if (canActAs(session, userId)) return true;
  if (session.role !== 'COMPANY' || !session.companyId) return false;

  const application = await prisma.application.findFirst({
    where: { userId, job: { companyId: session.companyId } },
    select: { id: true },
  });
  return application !== null;
}

/**
 * Returns the caller's own resumes by default. `?userId=` is honoured only for
 * the caller, an admin, or a company that has received an application from that
 * user — this route used to return every resume in the database.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const requestedId = new URL(req.url).searchParams.get('userId');
  const userId = requestedId ?? session.id;

  if (requestedId && !isUuid(requestedId)) return badRequest('That user id is not valid');

  try {
    if (!(await mayViewResumesOf(session, userId))) {
      return forbidden('You can only view your own resume');
    }

    const resumes = await prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(resumes);
  } catch (error) {
    console.error('GET /api/resumes failed:', error);
    return serverError('We could not load the resume. Please try again.');
  }
}

/**
 * Uploads a resume for the signed-in seeker. The owner comes from the session,
 * never the form body, and the upload replaces any previous resume so a seeker
 * always has exactly one current file.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'SEEKER');
  if (guard.response) return guard.response;
  const { session } = guard;

  // Checked before the file is read off the wire, not after: the point is to
  // avoid paying for the upload at all. Every accepted résumé is up to 5 MB
  // through the function and an object in Cloudinary that nothing
  // garbage-collects, so the ceiling here is lower than for a database row.
  const budget = checkRateLimit(req, RATE_TIERS.UPLOAD, session);
  if (!budget.ok) return rateLimited(budget);

  // The one place `validateEnv()` earns its keep, and the reason it exists as
  // an explicit call rather than an import-time check. `env.CLOUDINARY.*`
  // throws at the point of use — which is *after* the file has crossed the
  // wire — so a deployment missing a Cloudinary variable answered a résumé
  // upload with a 500 halfway through it. Checked here it costs five
  // `process.env` reads and gives an honest answer before anything is spent.
  try {
    validateEnv();
  } catch (error) {
    console.error('POST /api/resumes: environment incomplete:', error);
    return NextResponse.json(
      { error: 'Résumé uploads are not configured on this deployment.' },
      { status: 503 }
    );
  }

  let entry: FormDataEntryValue | null = null;
  try {
    const formData = await req.formData();
    entry = formData.get('resume');
  } catch {
    return badRequest('We could not read the uploaded file');
  }

  if (!(entry instanceof File) || entry.size === 0) {
    return badRequest('Please choose a resume file to upload');
  }
  const file = entry;

  // Validate before spending a Cloudinary round-trip on a 40 MB zip.
  const fileError = validateResumeFile({ size: file.size, type: file.type, name: file.name });
  if (fileError) return badRequest(fileError);

  try {
    // Read the previous rows first: if the new upload fails we leave them intact.
    const previous = await prisma.resume.findMany({
      where: { userId: session.id },
      select: { id: true, url: true, publicId: true },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadToCloudinary(buffer);

    const resume = await prisma.$transaction(async (tx) => {
      if (previous.length > 0) {
        await tx.resume.deleteMany({ where: { id: { in: previous.map((r) => r.id) } } });
      }
      return tx.resume.create({
        data: {
          userId: session.id,
          url: uploaded.secure_url,
          publicId: uploaded.public_id,
          fileName: file.name,
        },
      });
    });

    await destroyAssets(previous);

    // The file itself is only read on an explicit `/api/ai/resume` call, but a
    // new upload still means the profile has moved on - refresh its vector.
    queueProfileEmbedding(session.id);

    return NextResponse.json(resume, { status: 201 });
  } catch (error) {
    console.error('POST /api/resumes failed:', error);
    return serverError('We could not upload your resume. Please try again.');
  }
}

/** Deletes a resume and its Cloudinary asset. Owner (or admin) only. */
export async function DELETE(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const id = body.id;
  if (!isUuid(id)) return badRequest('A valid resume id is required');

  try {
    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) return notFound('That resume no longer exists');
    if (!canActAs(session, resume.userId)) {
      return forbidden('You can only delete your own resume');
    }

    await prisma.resume.delete({ where: { id } });
    await destroyAssets([{ url: resume.url, publicId: resume.publicId }]);

    return NextResponse.json({ message: 'Resume deleted' });
  } catch (error) {
    console.error('DELETE /api/resumes failed:', error);
    return serverError('We could not delete your resume. Please try again.');
  }
}
