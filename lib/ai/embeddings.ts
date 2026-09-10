import { prisma } from '@/lib/prisma';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, isAiEnabled } from './config';
import { embedText, embedTexts } from './gemini';
import {
  buildJobDocument,
  buildProfileDocument,
  contentHash,
  isDocumentUseful,
} from './documents';

/**
 * Keeps the vector index in step with the database.
 *
 * Every function here is safe to call and safe to ignore: if Gemini is not
 * configured, or the call fails, they return `false` and the caller carries on.
 * Nothing in the product blocks on an embedding.
 */

export type SyncResult = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

/* -------------------------------------------------------------------------- */
/* Jobs                                                                        */
/* -------------------------------------------------------------------------- */

const JOB_SELECT = {
  id: true,
  title: true,
  description: true,
  skills: true,
  location: true,
  type: true,
  experience: true,
  salary: true,
  company: { select: { name: true } },
} as const;

/** Re-embeds one job if its source text has changed. */
export async function syncJobEmbedding(jobId: string): Promise<SyncResult> {
  if (!isAiEnabled()) return 'skipped';

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_SELECT });
    if (!job) return 'skipped';

    const document = buildJobDocument({
      title: job.title,
      description: job.description,
      skills: job.skills,
      location: job.location,
      type: job.type,
      experience: job.experience,
      salary: job.salary,
      companyName: job.company?.name ?? null,
    });

    if (!isDocumentUseful(document)) return 'skipped';

    const hash = contentHash(document, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS);
    const existing = await prisma.jobEmbedding.findUnique({
      where: { jobId },
      select: { contentHash: true },
    });
    if (existing?.contentHash === hash) return 'unchanged';

    const vector = await embedText(document, 'document');
    if (!vector) return 'failed';

    await prisma.jobEmbedding.upsert({
      where: { jobId },
      create: {
        jobId,
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        contentHash: hash,
      },
      update: {
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        contentHash: hash,
      },
    });

    return existing ? 'updated' : 'created';
  } catch (error) {
    console.error('syncJobEmbedding failed:', error);
    return 'failed';
  }
}

/**
 * Fire-and-forget variant for request handlers.
 *
 * Posting a job must not wait on — or fail because of — an embedding call, so
 * this deliberately does not return a promise the caller can await.
 */
export function queueJobEmbedding(jobId: string): void {
  if (!isAiEnabled()) return;
  void syncJobEmbedding(jobId).catch((error) => {
    console.error('queueJobEmbedding failed:', error);
  });
}

/* -------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* -------------------------------------------------------------------------- */

/** Re-embeds one seeker profile if its source text has changed. */
export async function syncProfileEmbedding(userId: string): Promise<SyncResult> {
  if (!isAiEnabled()) return 'skipped';

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        headline: true,
        seniority: true,
        yearsOfExp: true,
        skills: true,
        location: true,
        industry: true,
        aiSummary: true,
        profile: true,
        description: true,
        applications: {
          select: { job: { select: { title: true } } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        },
      },
    });

    // Only seekers are matched against jobs; a company profile has no use for a
    // vector and embedding one would just cost money.
    if (!user || user.role !== 'SEEKER') return 'skipped';

    const document = buildProfileDocument({
      headline: user.headline,
      seniority: user.seniority,
      yearsOfExp: user.yearsOfExp,
      skills: user.skills,
      location: user.location,
      industry: user.industry,
      aiSummary: user.aiSummary,
      profile: user.profile,
      description: user.description,
      appliedTitles: user.applications.map((application) => application.job.title),
    });

    if (!isDocumentUseful(document)) return 'skipped';

    const hash = contentHash(document, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS);
    const existing = await prisma.profileEmbedding.findUnique({
      where: { userId },
      select: { contentHash: true },
    });
    if (existing?.contentHash === hash) return 'unchanged';

    const vector = await embedText(document, 'document');
    if (!vector) return 'failed';

    await prisma.profileEmbedding.upsert({
      where: { userId },
      create: {
        userId,
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        contentHash: hash,
      },
      update: {
        vector,
        model: EMBEDDING_MODEL,
        dimensions: vector.length,
        contentHash: hash,
      },
    });

    return existing ? 'updated' : 'created';
  } catch (error) {
    console.error('syncProfileEmbedding failed:', error);
    return 'failed';
  }
}

/** Fire-and-forget variant for request handlers. */
export function queueProfileEmbedding(userId: string): void {
  if (!isAiEnabled()) return;
  void syncProfileEmbedding(userId).catch((error) => {
    console.error('queueProfileEmbedding failed:', error);
  });
}

/* -------------------------------------------------------------------------- */
/* Bulk re-index                                                               */
/* -------------------------------------------------------------------------- */

export interface ReindexReport {
  jobs: { total: number; embedded: number; unchanged: number; failed: number };
  profiles: { total: number; embedded: number; unchanged: number; failed: number };
}

/**
 * Backfills every missing or stale vector.
 *
 * Batched through `embedTexts` rather than looping `syncJobEmbedding`, because
 * one request carrying fifty documents is far cheaper than fifty requests.
 */
export async function reindexAll(options: { limit?: number } = {}): Promise<ReindexReport> {
  const limit = options.limit ?? 500;
  const report: ReindexReport = {
    jobs: { total: 0, embedded: 0, unchanged: 0, failed: 0 },
    profiles: { total: 0, embedded: 0, unchanged: 0, failed: 0 },
  };

  if (!isAiEnabled()) return report;

  /* ---- Jobs ---- */
  const jobs = await prisma.job.findMany({
    where: { isActive: true },
    select: { ...JOB_SELECT, embedding: { select: { contentHash: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  report.jobs.total = jobs.length;

  const staleJobs = jobs
    .map((job) => {
      const document = buildJobDocument({
        title: job.title,
        description: job.description,
        skills: job.skills,
        location: job.location,
        type: job.type,
        experience: job.experience,
        salary: job.salary,
        companyName: job.company?.name ?? null,
      });
      const hash = contentHash(document, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS);
      return { id: job.id, document, hash, current: job.embedding?.contentHash };
    })
    .filter((entry) => {
      if (!isDocumentUseful(entry.document)) return false;
      if (entry.current === entry.hash) {
        report.jobs.unchanged++;
        return false;
      }
      return true;
    });

  if (staleJobs.length > 0) {
    const vectors = await embedTexts(
      staleJobs.map((entry) => entry.document),
      'document'
    );

    for (let i = 0; i < staleJobs.length; i++) {
      const entry = staleJobs[i];
      const vector = vectors[i];
      if (!vector) {
        report.jobs.failed++;
        continue;
      }

      try {
        await prisma.jobEmbedding.upsert({
          where: { jobId: entry.id },
          create: {
            jobId: entry.id,
            vector,
            model: EMBEDDING_MODEL,
            dimensions: vector.length,
            contentHash: entry.hash,
          },
          update: {
            vector,
            model: EMBEDDING_MODEL,
            dimensions: vector.length,
            contentHash: entry.hash,
          },
        });
        report.jobs.embedded++;
      } catch (error) {
        console.error('reindex job upsert failed:', error);
        report.jobs.failed++;
      }
    }
  }

  /* ---- Profiles ---- */
  const seekers = await prisma.user.findMany({
    where: { role: 'SEEKER' },
    select: {
      id: true,
      headline: true,
      seniority: true,
      yearsOfExp: true,
      skills: true,
      location: true,
      industry: true,
      aiSummary: true,
      profile: true,
      description: true,
      embedding: { select: { contentHash: true } },
      applications: {
        select: { job: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      },
    },
    take: limit,
  });

  report.profiles.total = seekers.length;

  const staleProfiles = seekers
    .map((user) => {
      const document = buildProfileDocument({
        headline: user.headline,
        seniority: user.seniority,
        yearsOfExp: user.yearsOfExp,
        skills: user.skills,
        location: user.location,
        industry: user.industry,
        aiSummary: user.aiSummary,
        profile: user.profile,
        description: user.description,
        appliedTitles: user.applications.map((application) => application.job.title),
      });
      const hash = contentHash(document, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS);
      return { id: user.id, document, hash, current: user.embedding?.contentHash };
    })
    .filter((entry) => {
      if (!isDocumentUseful(entry.document)) return false;
      if (entry.current === entry.hash) {
        report.profiles.unchanged++;
        return false;
      }
      return true;
    });

  if (staleProfiles.length > 0) {
    const vectors = await embedTexts(
      staleProfiles.map((entry) => entry.document),
      'document'
    );

    for (let i = 0; i < staleProfiles.length; i++) {
      const entry = staleProfiles[i];
      const vector = vectors[i];
      if (!vector) {
        report.profiles.failed++;
        continue;
      }

      try {
        await prisma.profileEmbedding.upsert({
          where: { userId: entry.id },
          create: {
            userId: entry.id,
            vector,
            model: EMBEDDING_MODEL,
            dimensions: vector.length,
            contentHash: entry.hash,
          },
          update: {
            vector,
            model: EMBEDDING_MODEL,
            dimensions: vector.length,
            contentHash: entry.hash,
          },
        });
        report.profiles.embedded++;
      } catch (error) {
        console.error('reindex profile upsert failed:', error);
        report.profiles.failed++;
      }
    }
  }

  return report;
}
