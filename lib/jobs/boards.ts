/**
 * Company careers boards to import from. Each company publishes its jobs
 * through its hiring system's free public API, so these are the employers' own
 * listings, with no key and no aggregator in between.
 *
 *   greenhouse  https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
 *   lever       https://api.lever.co/v0/postings/<slug>
 *   ashby       https://api.ashbyhq.com/posting-api/job-board/<slug>
 *
 * To add a company, find its careers page: a link to `job-boards.greenhouse.io/
 * <slug>`, `jobs.lever.co/<slug>` or `jobs.ashbyhq.com/<slug>` gives both the
 * platform and the slug. Companies on other systems (Workday, in-house pages)
 * cannot be added this way.
 *
 * Every entry was checked against its live API when it was added.
 */
export type BoardPlatform = 'greenhouse' | 'lever' | 'ashby';

export interface CareerBoard {
  platform: BoardPlatform;
  slug: string;
  /** How the company is named on NextHire. */
  name: string;
}

export const CAREER_BOARDS: CareerBoard[] = [
  { platform: 'lever', slug: 'paytm', name: 'Paytm' },
  { platform: 'lever', slug: 'meesho', name: 'Meesho' },
  { platform: 'lever', slug: 'zeta', name: 'Zeta' },
  { platform: 'lever', slug: 'cred', name: 'CRED' },
  { platform: 'lever', slug: 'fampay', name: 'FamPay' },
  { platform: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', name: 'Razorpay' },
  { platform: 'greenhouse', slug: 'inmobi', name: 'InMobi' },
  { platform: 'greenhouse', slug: 'druva', name: 'Druva' },
  { platform: 'greenhouse', slug: 'groww', name: 'Groww' },
  { platform: 'greenhouse', slug: 'slice', name: 'slice' },
  { platform: 'ashby', slug: 'sarvam', name: 'Sarvam AI' },
];

/** `careers` jobs carry `platform:slug:id` as their external id. */
export function parseCareerId(externalId: string): { board: CareerBoard; id: string } | null {
  const [platform, slug, ...rest] = externalId.split(':');
  const id = rest.join(':');
  const board = CAREER_BOARDS.find((b) => b.platform === platform && b.slug === slug);
  return board && id ? { board, id } : null;
}
