/** Shared, framework-agnostic input validation used by both the API and the forms. */

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > 200) return 'Password is too long';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}

/** Trims and collapses whitespace; returns null when nothing is left. */
export function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Like `cleanString` but preserves newlines, for descriptions and messages. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Accepts only http(s) URLs, so a stored profile link can't become `javascript:`. */
export function cleanUrl(value: unknown): string | null {
  const raw = cleanString(value, 500);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const APPLICATION_STATUSES = [
  'PENDING',
  'SHORTLISTED',
  'INTERVIEW',
  'REJECTED',
  'ACCEPTED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export const JOB_TYPES = ['Full Time', 'Part Time', 'Internship', 'Contract', 'Remote'] as const;

export function isJobType(value: unknown): value is string {
  return typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);
}

/** Human-readable labels for application statuses. */
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  PENDING: 'Pending',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  REJECTED: 'Rejected',
  ACCEPTED: 'Accepted',
};

/** Resume upload constraints, enforced on both the client and the server. */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
export const RESUME_ACCEPT = '.pdf,.doc,.docx';

export function validateResumeFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size > RESUME_MAX_BYTES) return 'Resume must be smaller than 5 MB';
  const extensionOk = /\.(pdf|docx?)$/i.test(file.name);
  // Some browsers send an empty or generic type, so fall back to the extension.
  if (!extensionOk && !RESUME_MIME_TYPES.includes(file.type)) {
    return 'Resume must be a PDF, DOC or DOCX file';
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Profile taxonomy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The seniority ladder the matcher understands (see `lib/ai/matching.ts`).
 *
 * Kept here rather than in `lib/ai` because it is ordinary profile validation:
 * a seeker can set it by hand on the profile form, and the résumé parser is
 * simply another writer. Anything outside this set is dropped rather than
 * stored — a stray label scores as "unknown" and silently flattens every match.
 */
export const SENIORITY_LEVELS = [
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

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** Normalises a seniority label to its canonical casing, or null if unknown. */
export function cleanSeniority(value: unknown): SeniorityLevel | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  return SENIORITY_LEVELS.find((level) => level.toLowerCase() === raw.toLowerCase()) ?? null;
}

/** Upper bound on a stored skill list, and on each tag's length. */
export const MAX_SKILLS = 25;
export const MAX_SKILL_LENGTH = 40;

/**
 * Cleans a list of short tags (skills, strengths): trims, length-caps, drops
 * empties and de-duplicates case-insensitively while keeping the first casing
 * seen. Used on both model output and user input — both are untrusted.
 */
export function cleanTagList(value: unknown, max: number = MAX_SKILLS): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    const tag = cleanString(entry, MAX_SKILL_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= max) break;
  }

  return tags;
}

/**
 * Clamps a years-of-experience figure to something a person could plausibly have.
 *
 * Absent values return null, not 0. `Number(null)` and `Number('')` are both 0,
 * so a naive coercion would record "zero years of experience" for anyone who
 * simply left the field blank — and because the field is presence-gated on the
 * profile route, a blank box does get sent.
 */
export function cleanYearsOfExperience(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const years = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(years)) return null;
  return Math.max(0, Math.min(60, Math.trunc(years)));
}
