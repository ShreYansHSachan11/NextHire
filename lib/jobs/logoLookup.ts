/**
 * Finds the website (and so the logo) of imported companies that only came
 * with a name, using Logo.dev's brand search.
 *
 * Runs on the server during an import, with the secret key; the key never
 * reaches the browser. To avoid showing the wrong brand, a result is accepted
 * only when its name matches the company's name exactly once legal suffixes
 * ("GmbH", "Ltd", "Inc"…) are set aside; anything else keeps the initial.
 * Each company is searched once (`logoCheckedAt`), and each run is capped.
 */
import { prisma } from '@/lib/prisma';

const SEARCH_URL = 'https://api.logo.dev/search';
/** Lookups per import run, so a large backlog is worked through over days. */
const PER_RUN = 150;
const CONCURRENCY = 4;

export interface BrandResult {
  name?: string;
  domain?: string;
}

const LEGAL_SUFFIXES = new Set([
  'gmbh', 'ag', 'se', 'kg', 'ug', 'mbh', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'ab', 'as', 'oy', 'aps',
  'inc', 'llc', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'company', 'pvt', 'private', 'pte', 'pty', 'llp',
]);

/** "Surplex GmbH" → "surplex"; "Acme Pvt. Ltd." → "acme". */
export function normaliseCompanyName(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** "The Hut Group" and "Thehutgroup" both become "thehutgroup". */
const collapse = (value: string) => normaliseCompanyName(value).replace(/ /g, '');

/** `lightspeedhq.com` → `lightspeedhq`; `app.muckrack.co.uk` → `muckrack`. */
function domainLabel(domain: string): string {
  const parts = domain.toLowerCase().replace(/^www\./, '').split('.');
  const generic = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);
  // Drop the TLD, and a second-level like the "co" in .co.uk.
  parts.pop();
  if (parts.length > 1 && generic.has(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? '';
}

/** A company "name" that is really a web address, e.g. "Lemon.io". */
export function domainFromName(name: string): string | null {
  const value = name.trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(value) ? value : null;
}

/**
 * The most popular result that is clearly the same company: its name matches
 * (spaces, case and legal suffixes aside), or its domain is the company name
 * itself, as with "Muckrack" and muckrack.com. Otherwise null.
 */
export function pickDomain(results: BrandResult[], companyName: string): string | null {
  const wanted = collapse(companyName);
  if (!wanted) return null;
  for (const result of results) {
    if (!result.name || !result.domain) continue;
    if (collapse(result.name) === wanted || domainLabel(result.domain) === wanted) {
      return result.domain.toLowerCase();
    }
  }
  return null;
}

class StopLookups extends Error {}

async function search(name: string, key: string): Promise<BrandResult[] | null> {
  const url = `${SEARCH_URL}?${new URLSearchParams({ q: name, strategy: 'match' })}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  } catch {
    return null; // network trouble: try this company again next run
  }
  // A bad key, a plan without search, or a rate limit: stop the whole run.
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new StopLookups(`Logo search returned ${response.status}`);
  }
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as unknown;
  return Array.isArray(body) ? (body as BrandResult[]) : [];
}

export interface LogoLookupReport {
  looked: number;
  found: number;
  error?: string;
}

/** Looks up websites for imported companies with open jobs that have none yet. */
export async function lookUpCompanyWebsites(limit = PER_RUN): Promise<LogoLookupReport> {
  const key = process.env.LOGO_DEV_SECRET_KEY?.trim();
  const report: LogoLookupReport = { looked: 0, found: 0 };
  if (!key) return report;

  const companies = await prisma.company.findMany({
    where: {
      isExternal: true,
      website: null,
      logoUrl: null,
      logoCheckedAt: null,
      jobs: { some: { isActive: true } },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const direct = domainFromName(company.name);
      if (direct) {
        report.looked++;
        report.found++;
        await prisma.company.update({ where: { id: company.id }, data: { logoCheckedAt: new Date(), website: direct } });
        continue;
      }
      const results = await search(company.name, key);
      if (results === null) continue;
      const domain = pickDomain(results, company.name);
      report.looked++;
      if (domain) report.found++;
      await prisma.company.update({
        where: { id: company.id },
        data: { logoCheckedAt: new Date(), ...(domain ? { website: domain } : {}) },
      });
    }
  };

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (!(error instanceof StopLookups)) console.error('Company logo lookup failed:', error);
  }
  return report;
}
