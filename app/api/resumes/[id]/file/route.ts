import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, badRequest, forbidden, notFound, isUuid } from '@/lib/auth';
import { fetchResumeFile, mayViewResumesOf } from '@/lib/resumes';

/**
 * GET /api/resumes/:id/file - opens a stored resume.
 *
 * The View links used to point straight at the Cloudinary delivery URL, which
 * Cloudinary refuses for PDFs on accounts that block PDF delivery (401). The
 * file is now fetched server-side through the signed download API and streamed
 * back from our own origin, behind the same access rule as `GET /api/resumes`.
 */

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 20_000;

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function extensionOf(...names: (string | null | undefined)[]): string | null {
  for (const name of names) {
    const extension = name?.toLowerCase().match(/\.(pdf|docx|doc)(?:$|\?)/)?.[1];
    if (extension) return extension;
  }
  return null;
}

/** `filename=` must be ASCII; `filename*=` carries the real name. */
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('That resume id is not valid');

  const resume = await prisma.resume.findUnique({
    where: { id },
    select: { userId: true, url: true, publicId: true, fileName: true },
  });
  if (!resume) return notFound('That resume no longer exists');
  if (!(await mayViewResumesOf(session, resume.userId))) {
    return forbidden('You can only view your own resume');
  }

  let file: Response;
  try {
    file = await fetchResumeFile(resume, FETCH_TIMEOUT_MS);
  } catch (error) {
    console.error('GET /api/resumes/[id]/file download failed:', error);
    return NextResponse.json(
      { error: 'We could not open this resume right now. Please try again in a moment.' },
      { status: 502 }
    );
  }

  if (!file.ok || !file.body) {
    console.error('GET /api/resumes/[id]/file download status:', file.status);
    return NextResponse.json(
      { error: 'We could not open this resume right now. Please try again in a moment.' },
      { status: 502 }
    );
  }

  // Served from our own origin, so never trust the upstream type: only the
  // three resume formats render inline, anything else downloads.
  const extension = extensionOf(resume.fileName, resume.url);
  const contentType = extension ? TYPES[extension] : 'application/octet-stream';
  const fileName = resume.fileName || (extension ? `resume.${extension}` : 'resume');

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(extension === 'pdf' ? 'inline' : 'attachment', fileName),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  return new NextResponse(file.body, { status: 200, headers });
}
