import { createHash } from 'crypto';

/**
 * Builds the plain-text documents that get embedded.
 *
 * These are deliberately written as short, labelled prose rather than as JSON
 * blobs: embedding models are trained on natural language, and a labelled
 * sentence ("Role: Senior Backend Engineer. Required skills: Go, Postgres.")
 * retrieves noticeably better than `{"title":"...","skills":[...]}`.
 *
 * The exact shape matters for cache correctness too — `contentHash` is taken
 * over the finished document, so any change here invalidates every stored
 * vector on the next re-index, which is the intended behaviour.
 */

export interface JobDocumentInput {
  title: string;
  description: string;
  skills?: string[];
  location?: string | null;
  type?: string | null;
  experience?: string | null;
  salary?: string | null;
  companyName?: string | null;
}

export function buildJobDocument(job: JobDocumentInput): string {
  const lines: string[] = [`Role: ${job.title}.`];

  if (job.companyName) lines.push(`Company: ${job.companyName}.`);
  if (job.type) lines.push(`Employment type: ${job.type}.`);
  if (job.location) lines.push(`Location: ${job.location}.`);
  if (job.experience) lines.push(`Experience required: ${job.experience}.`);
  if (job.salary) lines.push(`Compensation: ${job.salary}.`);
  if (job.skills?.length) lines.push(`Key skills: ${job.skills.join(', ')}.`);

  lines.push('', 'Role description:', job.description);

  return lines.join('\n');
}

export interface ProfileDocumentInput {
  headline?: string | null;
  seniority?: string | null;
  yearsOfExp?: number | null;
  skills?: string[];
  location?: string | null;
  industry?: string | null;
  aiSummary?: string | null;
  profile?: string | null;
  description?: string | null;
  /** Titles of roles the seeker has applied to — a strong signal of intent. */
  appliedTitles?: string[];
}

export function buildProfileDocument(profile: ProfileDocumentInput): string {
  const lines: string[] = [];

  if (profile.headline) lines.push(`Professional headline: ${profile.headline}.`);
  if (profile.seniority) lines.push(`Seniority: ${profile.seniority}.`);
  if (typeof profile.yearsOfExp === 'number') {
    lines.push(`Years of experience: ${profile.yearsOfExp}.`);
  }
  if (profile.industry) lines.push(`Industry: ${profile.industry}.`);
  if (profile.location) lines.push(`Based in: ${profile.location}.`);
  if (profile.skills?.length) lines.push(`Skills: ${profile.skills.join(', ')}.`);

  // De-duplicated, because someone who applied to five "Frontend Engineer"
  // roles should not have that phrase dominate their whole vector.
  const intent = Array.from(new Set(profile.appliedTitles ?? [])).slice(0, 8);
  if (intent.length) lines.push(`Roles of interest: ${intent.join(', ')}.`);

  const narrative = [profile.aiSummary, profile.profile, profile.description]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);

  if (narrative.length) {
    lines.push('', 'Background:', narrative.join('\n\n'));
  }

  return lines.join('\n').trim();
}

/**
 * Stable fingerprint of a document. Stored alongside the vector so a re-index
 * can skip rows whose source text has not changed — editing a job's salary
 * band should not spend an embedding call if the salary is not in the document.
 */
export function contentHash(document: string, model: string, dimensions: number): string {
  return createHash('sha256')
    .update(`${model}:${dimensions}:${document}`)
    .digest('hex')
    .slice(0, 40);
}

/**
 * A profile with nothing but a name in it would embed to noise and then match
 * everything equally, which is worse than showing no match at all.
 */
export function isDocumentUseful(document: string): boolean {
  return document.trim().length >= 40;
}
