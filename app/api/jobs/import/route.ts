import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, serverError } from '@/lib/auth';
import { importJobs, type JobSource } from '@/lib/jobs/import';

/**
 * Imports real jobs from public job boards (see `lib/jobs/import.ts`).
 *
 *   POST /api/jobs/import            an ADMIN session, or the cron secret
 *   GET  /api/jobs/import            the cron secret only (Vercel Cron sends GET)
 *
 * Optional query: `?sources=careers,arbeitnow,remoteok,adzuna&pages=2`.
 * The cron secret is `CRON_SECRET`, sent as `Authorization: Bearer <secret>`.
 * Remote OK asks API users not to poll hard; a few runs a day is plenty.
 */

// Fetching a few hundred postings and embedding the new ones takes a while.
export const maxDuration = 300;

const SOURCES: JobSource[] = ['careers', 'arbeitnow', 'remoteok', 'adzuna'];

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';
  if (!secret || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseOptions(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get('sources') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is JobSource => (SOURCES as string[]).includes(value));
  const pages = Number(searchParams.get('pages'));
  return {
    sources: requested.length ? requested : undefined,
    pages: Number.isFinite(pages) && pages > 0 ? pages : undefined,
  };
}

async function run(req: NextRequest) {
  try {
    const report = await importJobs(parseOptions(req));
    return NextResponse.json(report);
  } catch (error) {
    console.error('Job import failed:', error);
    return serverError('Could not import jobs');
  }
}

export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const guard = requireRole(req, 'ADMIN');
    if (guard.response) return guard.response;
  }
  return run(req);
}

export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return run(req);
}
