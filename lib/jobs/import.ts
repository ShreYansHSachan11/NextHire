import { prisma } from '@/lib/prisma';
import { queueJobEmbedding, reindexAll } from '@/lib/ai/embeddings';
import { invalidateJobVectorCache } from '@/lib/ai/cache';
import { findSkillsInText, isKnownSkill, skillLabel } from '@/lib/ai/skills';
import { CAREER_BOARDS, parseCareerId, type CareerBoard } from './boards';
import type { JobSource } from './sources';

/**
 * Imports real job postings from public job boards.
 *
 *   arbeitnow  https://www.arbeitnow.com/api/job-board-api   no key, mostly Europe
 *   remoteok   https://remoteok.com/api                       no key, remote only
 *   adzuna     https://api.adzuna.com/v1/api/jobs/in/search    free key, India
 *   careers    company careers boards on Greenhouse, Lever and Ashby (see
 *              `boards.ts`), no key; the employers' own listings, India only
 *
 * Imported jobs are read-only listings: they belong to an `isExternal` company
 * with no users, and they are applied for on the original posting
 * (`sourceUrl`), never through NextHire. Remote OK's API terms require a
 * followed link back to the posting and a credit by name; the job page does
 * both for every source.
 *
 * Each run upserts what the source returns, refreshes `lastSeenAt`, closes jobs
 * from a source that has not shown them for `STALE_AFTER_DAYS`, and then embeds
 * whatever is new so imported jobs rank in search and recommendations like any
 * other. A careers board is a complete list, so a job missing from one is
 * closed at once rather than after the grace period.
 *
 * Two refreshes happen without anyone running an import:
 *   - `refreshImportedJob`: opening a careers job re-checks that one posting
 *     at its source (at most every 15 minutes), so a page never offers a job
 *     the company has already taken down.
 *   - `refreshStaleSources`: opening the jobs feed re-imports any source not
 *     refreshed in 6 hours, after the response has been sent.
 */

export type { JobSource };

const USER_AGENT = 'NextHire job importer';
const STALE_AFTER_DAYS = 3;
const MAX_DESCRIPTION = 20_000;
const MAX_SKILLS = 8;

interface ImportedJob {
  source: JobSource;
  externalId: string;
  title: string;
  companyName: string;
  description: string;
  location: string | null;
  type: string | null;
  /** Filled from the description by `enrich` when the source has none. */
  experience?: string | null;
  salary: string | null;
  skills: string[];
  sourceUrl: string;
  postedAt: Date | null;
}

export interface SourceReport {
  source: JobSource;
  status: 'ok' | 'skipped' | 'failed';
  fetched: number;
  created: number;
  updated: number;
  closed: number;
  error?: string;
}

export interface ImportReport {
  sources: SourceReport[];
  embedded: number;
}

/* -------------------------------------------------------------------------- */
/* Text clean-up                                                               */
/* -------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const ENCODED_TAG = /&lt;\/?[a-z!][^]*?&gt;/i;
const RAW_TAG = /<\/?[a-z!][^>]*>/i;
const ENCODED_ENTITY = /&amp;(#x?[0-9a-f]+|[a-z]+);/i;

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // A tag cut off before its `>`, from a posting truncated mid-markup.
    .replace(/<\/?[a-z!][^<>]*$/i, '');
}

/**
 * Posting HTML to readable plain text: paragraphs and list items keep their
 * breaks. Several boards entity-encode their HTML, some of them twice, so the
 * markup is decoded until it is real tags, stripped, and decoded again until
 * no encoded entity is left. Each loop is bounded; three rounds covers every
 * board seen so far.
 */
export function htmlToText(html: string): string {
  let text = html;
  for (let round = 0; round < 3 && ENCODED_TAG.test(text); round++) text = decodeEntities(text);
  for (let round = 0; round < 3; round++) {
    text = decodeEntities(stripTags(text));
    if (!RAW_TAG.test(text) && !ENCODED_ENTITY.test(text)) break;
  }
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    // Word's Symbol-font bullets (,  …) sit in the private-use area, which
    // no web font draws: they rendered as boxes. Bullets become "•"; any other
    // private-use glyph is dropped.
    .replace(/[\uf0b7\uf0a7\uf0a8\uf076\uf0d8\uf0fc]\s*/g, '• ')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[ \t\f\v\u00a0\u2000-\u200a\u202f\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // List items arrive wrapped in paragraphs; keep a list tight.
    .replace(/\n{2,}(?=• )/g, '\n')
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

/**
 * Undoes UTF-8 that was decoded as Latin-1 somewhere upstream ("Platformâ¢"
 * for "Platform™"), which Remote OK serves for some postings. Only attempted
 * when every character fits in a byte, so genuine non-Latin text is untouched,
 * and only kept when the round trip decodes cleanly.
 */
function fixMojibake(text: string): string {
  if (!/[ÂÃâ][\u0080-\u00bf]/.test(text)) return text;
  if (/[^\u0000-\u00ff]/.test(text)) return text;
  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  return repaired.includes('\ufffd') ? text : repaired;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? htmlToText(fixMojibake(value)) : '';

/** Titles sometimes arrive with list bullets or dashes in front. */
function cleanTitle(value: unknown): string {
  return clean(value)
    .replace(/^[\s•·*\-–—|]+/, '')
    // Gender-inclusive markers: (m/w/d), (f/m/x), (all genders), and French F/H.
    .replace(/\s*\((?:[mwfdxh]\s*\/\s*){1,3}[mwfdxh]\*?\)|\s*\(all genders\)|\s+[FH]\/[FH]\b/gi, '')
    .trim();
}

const EN_WORDS = /\b(the|and|you|with|we|our|for|are|will|your|to|of|in|is|this|that|be|as|on|have)\b/gi;
// German, French, Dutch and Spanish, the other languages Arbeitnow lists most.
const OTHER_WORDS =
  /\b(und|die|der|das|wir|mit|für|sie|ist|zu|bei|auf|le|la|les|des|du|et|vous|nous|pour|une|avec|dans|sur|het|een|je|van|voor|wij|zijn|ons|naar|del|los|las|para|con|por|el|y)\b/gi;

/**
 * NextHire's interface and matching are English, and Arbeitnow lists many
 * postings in other languages, often under an English title. Keep a posting
 * only when English stop-words outnumber the others' *and* make up a normal
 * share of the text. Crude, but on a few hundred words of description it
 * separates the languages cleanly.
 */
function looksEnglish(text: string): boolean {
  const sample = text.slice(0, 3000);
  const words = sample.split(/\s+/).filter(Boolean).length || 1;
  const en = sample.match(EN_WORDS)?.length ?? 0;
  const other = sample.match(OTHER_WORDS)?.length ?? 0;
  return en > other && en / words >= 0.06;
}

/** Remote OK tags that describe the listing rather than a skill. */
const NOT_SKILLS = new Set([
  'dev',
  'exec',
  'technical',
  'non tech',
  'digital nomad',
  'senior',
  'junior',
  'lead',
  'remote',
  'full time',
  'part time',
  'contract',
  'engineer',
  'developer',
  'other',
  'management',
]);

function normaliseType(raw: string | null | undefined): string | null {
  const value = (raw ?? '').toLowerCase();
  if (/\bintern(ship)?s?\b|\bworking student\b/.test(value)) return 'Internship';
  if (/part[\s_-]?time/.test(value)) return 'Part Time';
  if (/contract|freelance|temporary/.test(value)) return 'Contract';
  if (/full[\s_-]?time|permanent/.test(value)) return 'Full Time';
  return null;
}

function cleanSkills(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = clean(tag).trim();
    const key = value.toLowerCase();
    if (!value || value.length > 30 || seen.has(key) || NOT_SKILLS.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

const thousands = (n: number) => `${Math.round(n / 1000)}k`;

/** Above this a posted salary is a data error at the source, not a salary. */
const SALARY_CEILING = 2_000_000;

function usdRange(min: number, max: number): string | null {
  if (min > SALARY_CEILING || max > SALARY_CEILING) return null;
  if (min > 0 && max > min) return `$${thousands(min)}–${thousands(max)}`;
  if (min > 0 || max > 0) return `$${thousands(Math.max(min, max))}`;
  return null;
}

/** Indian salaries read in lakhs per annum. */
function inrRange(min: number, max: number): string | null {
  // Rupees run higher than dollars; 10 crore a year is still past any real posting.
  if (min > 100_000_000 || max > 100_000_000) return null;
  const lpa = (n: number) => {
    const value = n / 100_000;
    return value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  };
  if (min > 0 && max > min) return `₹${lpa(min)}–${lpa(max)} LPA`;
  if (min > 0 || max > 0) return `₹${lpa(Math.max(min, max))} LPA`;
  return null;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

/**
 * Skill tags for an imported job: the source's own tags where they name a real
 * skill, then the skills its title and description mention. Source tags alone
 * were too noisy (Remote OK tags a recruiting role "golang"), and most boards
 * publish none at all.
 */
function skillsFor(tags: unknown, title: string, description: string): string[] {
  const fromTags = cleanSkills(tags).filter(isKnownSkill).map(skillLabel);
  const fromText = findSkillsInText(`${title}\n${description}`, MAX_SKILLS);
  return [...new Map([...fromTags, ...fromText].map((skill) => [skill.toLowerCase(), skill])).values()].slice(
    0,
    MAX_SKILLS
  );
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

interface ArbeitnowResponse {
  data: Array<{
    slug: string;
    company_name: string;
    title: string;
    description: string;
    remote: boolean;
    url: string;
    tags: string[];
    job_types: string[];
    location: string;
    created_at: number;
  }>;
}

async function fetchArbeitnow(pages: number): Promise<ImportedJob[]> {
  const jobs: ImportedJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const body = await getJson<ArbeitnowResponse>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    if (!body.data?.length) break;
    for (const item of body.data) {
      if (!item.slug || !item.title || !item.company_name || !item.url) continue;
      const description = clean(item.description);
      if (!looksEnglish(`${item.title} ${description}`)) continue;
      jobs.push({
        source: 'arbeitnow',
        externalId: item.slug,
        title: cleanTitle(item.title),
        companyName: clean(item.company_name),
        description,
        location: item.remote ? (item.location ? `Remote · ${clean(item.location)}` : 'Remote') : clean(item.location) || null,
        type: normaliseType(item.job_types?.join(' ')),
        salary: null,
        skills: skillsFor(item.tags, item.title, description),
        sourceUrl: item.url,
        postedAt: item.created_at ? new Date(item.created_at * 1000) : null,
      });
    }
  }
  return jobs;
}

interface RemoteOkItem {
  id?: string;
  epoch?: number;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
}

async function fetchRemoteOk(): Promise<ImportedJob[]> {
  // The first element is the API's legal notice, not a job.
  const body = await getJson<RemoteOkItem[]>('https://remoteok.com/api');
  const jobs: ImportedJob[] = [];
  for (const item of body.slice(1)) {
    if (!item.id || !item.position || !item.company || !item.url) continue;
    const place = clean(item.location);
    const description = clean(item.description);
    jobs.push({
      source: 'remoteok',
      externalId: String(item.id),
      title: cleanTitle(item.position),
      companyName: clean(item.company),
      description,
      location: !place || /^(worldwide|anywhere|remote)$/i.test(place) ? 'Remote' : `Remote · ${place}`,
      type: normaliseType(item.position),
      salary: usdRange(item.salary_min ?? 0, item.salary_max ?? 0),
      skills: skillsFor(item.tags, item.position, description),
      sourceUrl: item.url,
      postedAt: item.epoch ? new Date(item.epoch * 1000) : null,
    });
  }
  return jobs;
}

interface AdzunaResponse {
  results: Array<{
    id: string;
    title: string;
    description: string;
    redirect_url: string;
    created: string;
    company?: { display_name?: string };
    location?: { display_name?: string };
    salary_min?: number;
    salary_max?: number;
    contract_time?: string;
    contract_type?: string;
  }>;
}

async function fetchAdzuna(pages: number): Promise<ImportedJob[] | null> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return null;

  const country = process.env.ADZUNA_COUNTRY || 'in';
  const category = process.env.ADZUNA_CATEGORY || 'it-jobs';
  const jobs: ImportedJob[] = [];

  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '50',
      category,
      sort_by: 'date',
    });
    const body = await getJson<AdzunaResponse>(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`
    );
    if (!body.results?.length) break;
    for (const item of body.results) {
      const company = clean(item.company?.display_name);
      if (!item.id || !item.title || !company || !item.redirect_url) continue;
      const min = item.salary_min ?? 0;
      const max = item.salary_max ?? 0;
      jobs.push({
        source: 'adzuna',
        externalId: String(item.id),
        title: cleanTitle(item.title),
        companyName: company,
        // Adzuna returns a snippet, not the full posting; the full text is on
        // the original page.
        description: clean(item.description),
        location: clean(item.location?.display_name) || null,
        type: normaliseType(`${item.contract_time ?? ''} ${item.contract_type ?? ''}`),
        salary: country === 'in' ? inrRange(min, max) : usdRange(min, max),
        skills: skillsFor([], item.title, clean(item.description)),
        sourceUrl: item.redirect_url,
        postedAt: item.created ? new Date(item.created) : null,
      });
    }
  }
  return jobs;
}

/* -------------------------------------------------------------------------- */
/* Filling gaps from the description                                           */
/* -------------------------------------------------------------------------- */

/**
 * Employment type stated in prose. Stricter than `normaliseType`, which reads a
 * structured field: in a description "contract" also means "contract
 * manufacturers", so only unambiguous phrases count, and the earliest one wins.
 * Internships are left to the title: a description that mentions interns is
 * often a senior role that mentors them.
 */
const TYPE_PHRASES: Array<[RegExp, string]> = [
  [/\bpart[\s-]?time\b/i, 'Part Time'],
  [/\bfixed[\s-]?term\b|\bfreelance\b|\bcontract(?:or)?\s+(?:role|position|basis|job|assignment)\b|\b\d+[\s-]?months?\s+contract\b/i, 'Contract'],
  [/\bfull[\s-]?time\b|\bpermanent\s+(?:role|position|contract|employment|job)\b/i, 'Full Time'],
];

function typeFromText(text: string): string | null {
  let best: { at: number; type: string } | null = null;
  for (const [pattern, type] of TYPE_PHRASES) {
    const at = text.search(pattern);
    if (at >= 0 && (!best || at < best.at)) best = { at, type };
  }
  return best?.type ?? null;
}

const YEARS = String.raw`(\d{1,2})`;
const UNIT = String.raw`\s*(?:years?|yrs?)\b`;
/** "experience" (or a near synonym) within a short reach after the figure. */
const NEAR_EXPERIENCE = String.raw`(?=[^.\n]{0,80}\b(?:experience|expertise|track record|background|working in|in a similar role))`;

/**
 * Years of experience a posting asks for, written the way the job form
 * suggests ("3–5 years", "10+ years"). Only figures followed closely by
 * "experience" count, so "founded 10 years ago" or "a 2-year contract" do not.
 */
function experienceFromText(text: string): string | null {
  const range = new RegExp(String.raw`\b${YEARS}\s*(?:-|–|—|to)\s*${YEARS}\+?${UNIT}${NEAR_EXPERIENCE}`, 'i');
  const plus = new RegExp(String.raw`\b${YEARS}\s*(?:\+|plus)${UNIT}${NEAR_EXPERIENCE}`, 'i');
  const minimum = new RegExp(String.raw`\b(?:minimum(?:\s+of)?|at least|min\.?)\s*${YEARS}${UNIT}`, 'i');
  const bare = new RegExp(String.raw`\b${YEARS}${UNIT}(?:\s+of)?${NEAR_EXPERIENCE}`, 'i');

  const sane = (n: number) => n >= 0 && n <= 30;
  const r = text.match(range);
  if (r && sane(+r[1]) && sane(+r[2]) && +r[1] < +r[2]) return `${+r[1]}–${+r[2]} years`;
  const p = text.match(plus) ?? text.match(minimum) ?? text.match(bare);
  if (p && sane(+p[1]) && +p[1] > 0) return `${+p[1]}+ years`;
  return null;
}

/** Seniority from the title, for postings that state no years. */
function seniorityFromTitle(title: string): string | null {
  if (/\bintern(ship)?\b|\bworking student\b/i.test(title)) return 'Intern';
  if (/\b(head of|director|vp|vice president)\b/i.test(title)) return 'Director';
  if (/\bprincipal\b/i.test(title)) return 'Principal';
  if (/\bstaff\b/i.test(title)) return 'Staff';
  if (/\blead\b/i.test(title)) return 'Lead';
  if (/\b(senior|sr\.?)\b/i.test(title)) return 'Senior';
  if (/\b(junior|jr\.?|graduate|entry[\s-]level|fresher)\b/i.test(title)) return 'Junior';
  return null;
}

/** Fills the type and experience a source left empty, from the title and description. */
function enrich(job: ImportedJob): ImportedJob {
  return {
    ...job,
    type: job.type ?? normaliseType(job.title) ?? typeFromText(job.description),
    experience: job.experience ?? experienceFromText(job.description) ?? seniorityFromTitle(job.title),
  };
}

/* -------------------------------------------------------------------------- */
/* Company careers boards                                                      */
/* -------------------------------------------------------------------------- */

const INDIA =
  /\b(india|bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|ncr)\b/i;

/** The importer is India-focused; a plain "Remote" from an Indian company counts. */
function inIndia(...places: Array<string | null | undefined>): boolean {
  const text = places.filter(Boolean).join(' | ');
  return INDIA.test(text) || /^\s*remote\s*$/i.test(text);
}

const careerId = (board: CareerBoard, id: string | number) => `${board.platform}:${board.slug}:${id}`;

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
}

function fromGreenhouse(board: CareerBoard, item: GreenhouseJob): ImportedJob {
  // Greenhouse entity-encodes the HTML itself, so it is decoded once before
  // the tags can be read.
  const description = clean(decodeEntities(item.content ?? ''));
  const title = cleanTitle(item.title);
  return {
    source: 'careers',
    externalId: careerId(board, item.id),
    title,
    companyName: board.name,
    description,
    location: clean(item.location?.name) || null,
    type: normaliseType(title),
    salary: null,
    skills: skillsFor([], title, description),
    sourceUrl: item.absolute_url,
    postedAt: item.first_published ? new Date(item.first_published) : null,
  };
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  description?: string;
  additional?: string;
  lists?: Array<{ text: string; content: string }>;
  categories?: { location?: string; commitment?: string; allLocations?: string[] };
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
}

function fromLever(board: CareerBoard, item: LeverJob): ImportedJob {
  const html = [
    item.description ?? '',
    ...(item.lists ?? []).map((list) => `<h3>${list.text}</h3><ul>${list.content}</ul>`),
    item.additional ?? '',
  ].join('\n');
  const description = clean(html);
  const title = cleanTitle(item.text);
  const places = item.categories?.allLocations?.length
    ? item.categories.allLocations.join(' · ')
    : item.categories?.location;
  const range = item.salaryRange;
  const salary =
    range?.currency === 'INR'
      ? inrRange(range.min ?? 0, range.max ?? 0)
      : range?.currency === 'USD'
        ? usdRange(range.min ?? 0, range.max ?? 0)
        : null;
  return {
    source: 'careers',
    externalId: careerId(board, item.id),
    title,
    companyName: board.name,
    description,
    location: clean(places) || (item.workplaceType === 'remote' ? 'Remote' : null),
    type: normaliseType(item.categories?.commitment) ?? normaliseType(title),
    salary,
    skills: skillsFor([], title, description),
    sourceUrl: item.hostedUrl,
    postedAt: item.createdAt ? new Date(item.createdAt) : null,
  };
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  isListed?: boolean;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  employmentType?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  publishedAt?: string;
  compensation?: { compensationTierSummary?: string | null };
}

function fromAshby(board: CareerBoard, item: AshbyJob): ImportedJob {
  const description = clean(item.descriptionHtml ?? '');
  const title = cleanTitle(item.title);
  const places = [item.location, ...(item.secondaryLocations ?? []).map((l) => l.location)]
    .filter(Boolean)
    .join(' · ');
  return {
    source: 'careers',
    externalId: careerId(board, item.id),
    title,
    companyName: board.name,
    description,
    location: clean(places) || (item.isRemote ? 'Remote' : null),
    // "FullTime", "PartTime", "Intern", "Contract".
    type: normaliseType((item.employmentType ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')) ?? normaliseType(title),
    salary: item.compensation?.compensationTierSummary ?? null,
    skills: skillsFor([], title, description),
    sourceUrl: item.jobUrl,
    postedAt: item.publishedAt ? new Date(item.publishedAt) : null,
  };
}

const boardUrl = (board: CareerBoard) =>
  board.platform === 'greenhouse'
    ? `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`
    : board.platform === 'lever'
      ? `https://api.lever.co/v0/postings/${board.slug}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${board.slug}?includeCompensation=true`;

/** Every listed job on one board, India locations only. */
async function fetchBoard(board: CareerBoard, timeoutMs?: number): Promise<ImportedJob[]> {
  if (board.platform === 'greenhouse') {
    const body = await getJson<{ jobs: GreenhouseJob[] }>(boardUrl(board), timeoutMs);
    return body.jobs.filter((job) => inIndia(job.location?.name)).map((job) => fromGreenhouse(board, job));
  }
  if (board.platform === 'lever') {
    const body = await getJson<LeverJob[]>(boardUrl(board), timeoutMs);
    return body
      .filter((job) => inIndia(job.categories?.location, ...(job.categories?.allLocations ?? [])))
      .map((job) => fromLever(board, job));
  }
  const body = await getJson<{ jobs: AshbyJob[] }>(boardUrl(board), timeoutMs);
  return body.jobs
    .filter((job) => job.isListed !== false)
    .filter((job) => inIndia(job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)))
    .map((job) => fromAshby(board, job));
}

interface CareersFetch {
  jobs: ImportedJob[];
  /** `platform:slug:` prefixes of the boards read in full, which may be swept. */
  complete: string[];
  failed: string[];
}

async function fetchCareers(): Promise<CareersFetch> {
  const result: CareersFetch = { jobs: [], complete: [], failed: [] };
  const settled = await Promise.allSettled(CAREER_BOARDS.map((board) => fetchBoard(board)));
  settled.forEach((outcome, index) => {
    const board = CAREER_BOARDS[index];
    if (outcome.status === 'fulfilled') {
      result.jobs.push(...outcome.value);
      result.complete.push(`${board.platform}:${board.slug}:`);
    } else {
      console.error(`Careers board ${board.platform}/${board.slug} failed:`, outcome.reason);
      result.failed.push(board.name);
    }
  });
  return result;
}

/**
 * One careers posting, fresh from its board. `'gone'` when the board no longer
 * lists it. Greenhouse and Lever answer for a single job; Ashby only publishes
 * the whole board, which is still one request.
 */
async function fetchCareerJob(board: CareerBoard, id: string, timeoutMs: number): Promise<ImportedJob | 'gone'> {
  try {
    if (board.platform === 'greenhouse') {
      const item = await getJson<GreenhouseJob>(
        `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs/${encodeURIComponent(id)}`,
        timeoutMs
      );
      return fromGreenhouse(board, item);
    }
    if (board.platform === 'lever') {
      const item = await getJson<LeverJob>(
        `https://api.lever.co/v0/postings/${board.slug}/${encodeURIComponent(id)}?mode=json`,
        timeoutMs
      );
      return fromLever(board, item);
    }
    const body = await getJson<{ jobs: AshbyJob[] }>(boardUrl(board), timeoutMs);
    const item = body.jobs.find((job) => job.id === id && job.isListed !== false);
    return item ? fromAshby(board, item) : 'gone';
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return 'gone';
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

/** Finds or creates the external company rows for a batch, keyed by lower-cased name. */
async function companyIds(names: string[]): Promise<Map<string, string>> {
  const unique = [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
  const ids = new Map<string, string>();

  const existing = await prisma.company.findMany({
    where: { isExternal: true, name: { in: unique, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  for (const company of existing) ids.set(company.name.toLowerCase(), company.id);

  const missing = unique.filter((name) => !ids.has(name.toLowerCase()));
  if (missing.length) {
    await prisma.company.createMany({ data: missing.map((name) => ({ name, isExternal: true })) });
    const created = await prisma.company.findMany({
      where: { isExternal: true, name: { in: missing } },
      select: { id: true, name: true },
    });
    for (const company of created) ids.set(company.name.toLowerCase(), company.id);
  }
  return ids;
}

const sameSkills = (a: string[], b: string[]) => a.length === b.length && a.every((skill, i) => skill === b[i]);

async function syncSource(
  source: JobSource,
  jobs: ImportedJob[],
  /** Prefixes of external ids whose full list was read: anything missing there is closed now. */
  complete: string[] = []
): Promise<SourceReport> {
  const report: SourceReport = { source, status: 'ok', fetched: jobs.length, created: 0, updated: 0, closed: 0 };
  const now = new Date();

  // A source can list the same posting twice; the last one wins.
  const byId = new Map(
    jobs.filter((job) => job.title && job.companyName).map((job) => [job.externalId, enrich(job)])
  );
  const unique = [...byId.values()];
  const companies = await companyIds(unique.map((job) => job.companyName));

  const existing = await prisma.job.findMany({
    where: { source, externalId: { in: [...byId.keys()] } },
    select: {
      id: true,
      externalId: true,
      title: true,
      description: true,
      salary: true,
      location: true,
      type: true,
      experience: true,
      skills: true,
      isActive: true,
    },
  });
  const known = new Map(existing.map((job) => [job.externalId as string, job]));

  const fresh = unique.filter((job) => !known.has(job.externalId));
  if (fresh.length) {
    const result = await prisma.job.createMany({
      data: fresh.flatMap((job) => {
        const companyId = companies.get(job.companyName.toLowerCase());
        if (!companyId) return [];
        return [
          {
            source,
            externalId: job.externalId,
            sourceUrl: job.sourceUrl,
            title: job.title.slice(0, 200),
            description: job.description || `${job.title} at ${job.companyName}.`,
            location: job.location,
            type: job.type,
            experience: job.experience ?? null,
            salary: job.salary,
            skills: job.skills,
            companyId,
            lastSeenAt: now,
            ...(job.postedAt && !Number.isNaN(job.postedAt.getTime()) ? { createdAt: job.postedAt } : {}),
          },
        ];
      }),
      skipDuplicates: true,
    });
    report.created = result.count;
  }

  // Only rewrite a row whose content changed, or that the source re-listed.
  for (const job of unique) {
    const current = known.get(job.externalId);
    if (!current) continue;
    const description = job.description || current.description;
    if (
      current.isActive &&
      current.title === job.title &&
      current.description === description &&
      current.salary === job.salary &&
      current.location === job.location &&
      current.type === job.type &&
      current.experience === (job.experience ?? null) &&
      sameSkills(current.skills, job.skills)
    ) {
      continue;
    }
    await prisma.job.update({
      where: { id: current.id },
      data: {
        title: job.title.slice(0, 200),
        description,
        salary: job.salary,
        location: job.location,
        type: job.type,
        experience: job.experience ?? null,
        skills: job.skills,
        sourceUrl: job.sourceUrl,
        isActive: true,
      },
    });
    report.updated++;
  }

  if (known.size) {
    await prisma.job.updateMany({
      where: { source, externalId: { in: [...known.keys()] } },
      data: { lastSeenAt: now },
    });
  }

  const staleBefore = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const closed = await prisma.job.updateMany({
    where: { source, isActive: true, lastSeenAt: { lt: staleBefore } },
    data: { isActive: false },
  });
  report.closed = closed.count;

  // A complete list is authoritative: a job it no longer carries is closed.
  const seen = [...byId.keys()];
  for (const prefix of complete) {
    const gone = await prisma.job.updateMany({
      where: { source, isActive: true, externalId: { startsWith: prefix, notIn: seen } },
      data: { isActive: false },
    });
    report.closed += gone.count;
  }

  return report;
}

export async function importJobs(
  options: { sources?: JobSource[]; pages?: number } = {}
): Promise<ImportReport> {
  const sources = options.sources ?? ['careers', 'arbeitnow', 'remoteok', 'adzuna'];
  const pages = Math.max(1, Math.min(options.pages ?? 2, 5));
  const report: ImportReport = { sources: [], embedded: 0 };

  for (const source of sources) {
    try {
      if (source === 'careers') {
        const careers = await fetchCareers();
        const entry = await syncSource('careers', careers.jobs, careers.complete);
        if (careers.failed.length) entry.error = `Could not read: ${careers.failed.join(', ')}`;
        report.sources.push(entry);
        continue;
      }

      const jobs =
        source === 'arbeitnow'
          ? await fetchArbeitnow(pages)
          : source === 'remoteok'
            ? await fetchRemoteOk()
            : await fetchAdzuna(pages);

      if (jobs === null) {
        report.sources.push({
          source,
          status: 'skipped',
          fetched: 0,
          created: 0,
          updated: 0,
          closed: 0,
          error: 'ADZUNA_APP_ID and ADZUNA_APP_KEY are not set',
        });
        continue;
      }
      report.sources.push(await syncSource(source, jobs));
    } catch (error) {
      // A failed fetch never closes anything: the stale sweep only runs after a
      // successful one.
      console.error(`Job import from ${source} failed:`, error);
      report.sources.push({
        source,
        status: 'failed',
        fetched: 0,
        created: 0,
        updated: 0,
        closed: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (report.sources.some((entry) => entry.created + entry.updated + entry.closed > 0)) {
    invalidateJobVectorCache();
  }
  // Every run, not only when something changed: a job whose embedding failed
  // last time (a rate limit, say) is picked up here. Jobs whose text has not
  // changed are skipped by content hash, so this costs no tokens for them.
  const reindex = await reindexAll({ limit: 2000 });
  report.embedded = reindex.jobs.embedded;

  return report;
}

/* -------------------------------------------------------------------------- */
/* Refresh on view                                                             */
/* -------------------------------------------------------------------------- */

/** A careers job is re-checked when it is opened, at most this often. */
const JOB_REFRESH_AFTER_MS = 15 * 60 * 1000;
/** Opening the feed re-imports a source last refreshed longer ago than this. */
const SOURCE_REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
/** After a failed attempt, a source is left alone for this long. */
const SOURCE_RETRY_AFTER_MS = 30 * 60 * 1000;
/** How often the feed asks the database whether anything is stale. */
const STALENESS_CHECK_EVERY_MS = 5 * 60 * 1000;

const autoRefreshEnabled = () => process.env.JOBS_AUTO_REFRESH !== '0';

const jobRefreshes = new Map<string, Promise<void>>();

/**
 * Re-checks one careers job at its source, so the page reflects the company's
 * own listing: updated details, or closed if the company has taken it down.
 * The caller decides how long to wait (see `GET /api/jobs/:jobId`); the check
 * itself runs to completion, up to `timeoutMs`, so a slow board (Lever often
 * takes two seconds) still updates the stored copy for the next visitor.
 *
 * Arbeitnow, Remote OK and Adzuna only publish lists of recent postings, where
 * absence cannot tell "filled" from "older", so their jobs are refreshed by the
 * periodic import instead.
 */
export async function refreshImportedJob(jobId: string, timeoutMs = 10_000): Promise<void> {
  if (!autoRefreshEnabled()) return;
  const pending = jobRefreshes.get(jobId);
  if (pending) return pending;

  const run = (async () => {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        source: true,
        externalId: true,
        lastSeenAt: true,
        title: true,
        description: true,
        skills: true,
      },
    });
    if (job?.source !== 'careers' || !job.externalId) return;
    if (job.lastSeenAt && Date.now() - job.lastSeenAt.getTime() < JOB_REFRESH_AFTER_MS) return;

    const parsed = parseCareerId(job.externalId);
    if (!parsed) return;

    let fresh: ImportedJob | 'gone';
    try {
      const fetched = await fetchCareerJob(parsed.board, parsed.id, timeoutMs);
      fresh = fetched === 'gone' ? fetched : enrich(fetched);
    } catch (error) {
      // Slow or unreachable: show what is stored rather than nothing.
      console.warn(`Refreshing job ${jobId} from ${parsed.board.name} failed:`, error);
      return;
    }

    if (fresh === 'gone') {
      await prisma.job.update({ where: { id: jobId }, data: { isActive: false } });
      invalidateJobVectorCache();
      return;
    }

    const description = fresh.description || job.description;
    const textChanged = fresh.title !== job.title || description !== job.description;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        title: fresh.title.slice(0, 200),
        description,
        location: fresh.location,
        type: fresh.type,
        experience: fresh.experience ?? null,
        salary: fresh.salary,
        skills: fresh.skills,
        sourceUrl: fresh.sourceUrl,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });
    if (textChanged || !sameSkills(fresh.skills, job.skills)) {
      invalidateJobVectorCache();
      queueJobEmbedding(jobId);
    }
  })().finally(() => jobRefreshes.delete(jobId));

  jobRefreshes.set(jobId, run);
  return run;
}

let catalogRun: Promise<unknown> | null = null;
let lastStalenessCheck = 0;
const lastAttempt = new Map<JobSource, number>();

function enabledSources(): JobSource[] {
  const sources: JobSource[] = ['careers', 'arbeitnow', 'remoteok'];
  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) sources.push('adzuna');
  return sources;
}

/**
 * Re-imports any source that has not been refreshed for six hours. Called
 * after the jobs feed has responded (`after()`), so a visitor never waits on
 * it; the next visitor sees the result. One run at a time per server, a cheap
 * staleness query at most every five minutes, and a failing source is left
 * alone for half an hour, so a busy feed does not hammer the boards.
 */
export async function refreshStaleSources(): Promise<void> {
  if (!autoRefreshEnabled() || catalogRun) return;
  const now = Date.now();
  if (now - lastStalenessCheck < STALENESS_CHECK_EVERY_MS) return;
  lastStalenessCheck = now;

  const freshest = await prisma.job.groupBy({
    by: ['source'],
    where: { source: { not: null } },
    _max: { lastSeenAt: true },
  });
  const seenAt = new Map(freshest.map((row) => [row.source, row._max.lastSeenAt?.getTime() ?? 0]));

  const stale = enabledSources().filter(
    (source) =>
      now - (seenAt.get(source) ?? 0) > SOURCE_REFRESH_AFTER_MS &&
      now - (lastAttempt.get(source) ?? 0) > SOURCE_RETRY_AFTER_MS
  );
  if (!stale.length) return;

  for (const source of stale) lastAttempt.set(source, now);
  catalogRun = importJobs({ sources: stale })
    .then((report) => {
      const summary = report.sources.map((s) => `${s.source} ${s.status} +${s.created}/~${s.updated}/-${s.closed}`);
      console.log(`Background job refresh: ${summary.join(', ')}; embedded ${report.embedded}`);
    })
    .catch((error) => console.error('Background job refresh failed:', error))
    .finally(() => {
      catalogRun = null;
    });
  await catalogRun;
}
