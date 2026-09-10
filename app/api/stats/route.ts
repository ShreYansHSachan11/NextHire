import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serverError } from '@/lib/auth';

// Public, cacheable counters for the homepage. Five minutes is fresh enough for
// a marketing panel and keeps four counts off the hot path of every visit.
export const revalidate = 300;

/** Live counts behind the homepage stat cards, which used to be invented. */
export async function GET() {
  try {
    const [jobs, companies, seekers, applications] = await prisma.$transaction([
      prisma.job.count({ where: { isActive: true } }),
      prisma.company.count(),
      prisma.user.count({ where: { role: 'SEEKER' } }),
      prisma.application.count(),
    ]);

    return NextResponse.json({ jobs, companies, seekers, applications });
  } catch (error) {
    console.error('GET /api/stats failed:', error);
    return serverError('We could not load the latest numbers.');
  }
}
