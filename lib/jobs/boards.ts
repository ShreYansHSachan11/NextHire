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
  /** The company's own site; its domain is what the logo is looked up by. */
  website: string;
}

export const CAREER_BOARDS: CareerBoard[] = [
  { platform: 'lever', slug: 'paytm', name: 'Paytm', website: 'paytm.com' },
  { platform: 'lever', slug: 'meesho', name: 'Meesho', website: 'meesho.com' },
  { platform: 'lever', slug: 'zeta', name: 'Zeta', website: 'zeta.tech' },
  { platform: 'lever', slug: 'cred', name: 'CRED', website: 'cred.club' },
  { platform: 'lever', slug: 'fampay', name: 'FamPay', website: 'famapp.in' },
  { platform: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', name: 'Razorpay', website: 'razorpay.com' },
  { platform: 'greenhouse', slug: 'inmobi', name: 'InMobi', website: 'inmobi.com' },
  { platform: 'greenhouse', slug: 'druva', name: 'Druva', website: 'druva.com' },
  { platform: 'greenhouse', slug: 'groww', name: 'Groww', website: 'groww.in' },
  { platform: 'greenhouse', slug: 'slice', name: 'slice', website: 'sliceit.com' },
  { platform: 'ashby', slug: 'sarvam', name: 'Sarvam AI', website: 'sarvam.ai' },
];

/** `careers` jobs carry `platform:slug:id` as their external id. */
export function parseCareerId(externalId: string): { board: CareerBoard; id: string } | null {
  const [platform, slug, ...rest] = externalId.split(':');
  const id = rest.join(':');
  const board = CAREER_BOARDS.find((b) => b.platform === platform && b.slug === slug);
  return board && id ? { board, id } : null;
}
