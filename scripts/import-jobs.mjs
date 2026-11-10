/**
 * Runs a job import against a running NextHire server.
 *
 *   npm run jobs:import                       all sources, 2 pages each
 *   npm run jobs:import -- remoteok           one source
 *   npm run jobs:import -- careers            Indian companies' careers boards
 *   npm run jobs:import -- arbeitnow,adzuna 3 two sources, 3 pages each
 *
 * Reads CRON_SECRET and NEXT_PUBLIC_APP_URL from .env; the server must have the
 * same CRON_SECRET.
 */
import 'dotenv/config';

const [sources = '', pages = ''] = process.argv.slice(2);
const secret = process.env.CRON_SECRET;
const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

if (!secret) {
  console.error('Set CRON_SECRET in .env first (and restart the dev server so it sees it).');
  process.exit(1);
}

const params = new URLSearchParams();
if (sources) params.set('sources', sources);
if (pages) params.set('pages', pages);

const res = await fetch(`${base}/api/jobs/import?${params}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`Import failed (${res.status}):`, body.error ?? body);
  process.exit(1);
}

for (const s of body.sources) {
  const detail = s.status === 'ok'
    ? `${s.fetched} fetched, ${s.created} new, ${s.updated} updated, ${s.closed} closed`
    : s.error;
  console.log(`${s.source.padEnd(10)} ${s.status.padEnd(8)} ${detail}`);
}
console.log(`embedded   ${body.embedded} jobs`);
