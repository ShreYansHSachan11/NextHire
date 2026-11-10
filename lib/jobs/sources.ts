/**
 * Where imported jobs come from. Kept apart from the importer so client
 * components can name a source without pulling in the database client.
 */
export type JobSource = 'arbeitnow' | 'remoteok' | 'adzuna' | 'careers';

export const SOURCE_LABELS: Record<JobSource, string> = {
  arbeitnow: 'Arbeitnow',
  remoteok: 'Remote OK',
  adzuna: 'Adzuna',
  careers: 'company careers site',
};

/**
 * How to credit a job's source: "Remote OK", or "Razorpay careers" for a job
 * read from the company's own careers board. Null for a job posted on NextHire.
 */
export function sourceLabel(source: string | null | undefined, companyName?: string | null): string | null {
  if (!source) return null;
  if (source === 'careers') return companyName ? `${companyName} careers` : SOURCE_LABELS.careers;
  return SOURCE_LABELS[source as JobSource] ?? source;
}
