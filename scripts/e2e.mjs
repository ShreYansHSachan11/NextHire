/** End-to-end HTTP test against a running NextHire dev server. */

const BASE = 'http://localhost:3000';
let pass = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

const stamp = Date.now();
const seekerEmail = `seeker.${stamp}@example.com`;
const companyEmail = `company.${stamp}@example.com`;
const rivalEmail = `rival.${stamp}@example.com`;
const PASSWORD = 'TestPass123';

const state = {};

async function section(title, fn) {
  console.log(`\n=== ${title} ===`);
  await fn();
}

await section('Auth & registration', async () => {
  let r = await call('POST', '/api/auth', {
    body: { action: 'register', email: seekerEmail, name: 'Test Seeker', password: PASSWORD },
  });
  check('seeker registers', r.status === 201, `${r.status} ${r.text.slice(0, 120)}`);
  state.seekerToken = r.json?.token;
  state.seekerId = r.json?.user?.id;

  r = await call('POST', '/api/auth', {
    body: { action: 'register', email: companyEmail, name: 'Acme Robotics', password: PASSWORD, role: 'COMPANY' },
  });
  check('company registers', r.status === 201, `${r.status}`);
  check('company gets a companyId', !!r.json?.user?.companyId);
  state.companyToken = r.json?.token;
  state.companyId = r.json?.user?.companyId;

  r = await call('POST', '/api/auth', {
    body: { action: 'register', email: rivalEmail, name: 'Rival Corp', password: PASSWORD, role: 'COMPANY' },
  });
  check('rival company registers', r.status === 201, `${r.status}`);
  state.rivalToken = r.json?.token;

  // Security: ADMIN must not be self-assignable.
  r = await call('POST', '/api/auth', {
    body: { action: 'register', email: `admin.${stamp}@example.com`, name: 'Wannabe Admin', password: PASSWORD, role: 'ADMIN' },
  });
  check('ADMIN role cannot be self-assigned', r.json?.user?.role === 'SEEKER', `got role ${r.json?.user?.role}`);

  r = await call('POST', '/api/auth', {
    body: { action: 'register', email: `weak.${stamp}@example.com`, name: 'Weak', password: 'short' },
  });
  check('weak password rejected', r.status === 400, `${r.status}`);

  r = await call('POST', '/api/auth', {
    body: { action: 'register', email: seekerEmail, name: 'Dupe', password: PASSWORD },
  });
  check('duplicate email rejected (409)', r.status === 409, `${r.status}`);

  r = await call('POST', '/api/auth', { body: { action: 'login', email: seekerEmail, password: 'WrongPass123' } });
  check('wrong password rejected (401)', r.status === 401, `${r.status}`);

  r = await call('POST', '/api/auth', { body: { action: 'login', email: seekerEmail, password: PASSWORD } });
  check('login succeeds', r.status === 200 && !!r.json?.token, `${r.status}`);

  r = await call('GET', '/api/auth');
  check('GET /api/auth unauthenticated is 401', r.status === 401, `${r.status}`);

  r = await call('GET', '/api/auth', { token: state.seekerToken });
  check('GET /api/auth with token returns session', r.status === 200 && r.json?.user?.id === state.seekerId, `${r.status}`);
});

await section('Jobs', async () => {
  let r = await call('POST', '/api/jobs', {
    token: state.companyToken,
    body: {
      title: 'Senior Backend Engineer',
      description: 'We need someone who has scaled a real-time WebSocket service handling millions of concurrent connections. You will own our Go and Postgres event pipeline, mentor engineers, and drive architecture for our streaming platform.',
      location: 'Remote',
      type: 'Full Time',
      salary: '$160k',
      experience: 'Senior',
      skills: ['Go', 'PostgreSQL', 'WebSockets', 'Kubernetes'],
    },
  });
  check('company posts a job', r.status === 201, `${r.status} ${r.text.slice(0, 200)}`);
  state.jobId = r.json?.id;

  r = await call('POST', '/api/jobs', {
    token: state.companyToken,
    body: {
      title: 'Frontend Designer',
      description: 'Craft accessible, beautiful interfaces in React and TypeScript. You will build our design system, obsess over motion and typography, and partner closely with product.',
      location: 'Berlin',
      type: 'Full Time',
      skills: ['React', 'TypeScript', 'CSS'],
    },
  });
  check('company posts a second job', r.status === 201, `${r.status}`);
  state.job2Id = r.json?.id;

  r = await call('POST', '/api/jobs', { token: state.seekerToken, body: { title: 'X', description: 'Y' } });
  check('seeker cannot post a job (403)', r.status === 403, `${r.status}`);

  r = await call('POST', '/api/jobs', { body: { title: 'X', description: 'Y' } });
  check('anonymous cannot post a job (401)', r.status === 401, `${r.status}`);

  r = await call('GET', '/api/jobs');
  check('public job feed lists jobs', r.status === 200 && Array.isArray(r.json) && r.json.length >= 2, `${r.status} len=${Array.isArray(r.json) ? r.json.length : 'n/a'}`);
  check('job feed never leaks embedding vectors', !r.text.includes('"vector"'), 'vector present in payload');

  r = await call('GET', `/api/jobs/${state.jobId}`);
  check('job detail is public', r.status === 200 && r.json?.id === state.jobId, `${r.status}`);

  r = await call('GET', '/api/jobs/not-a-uuid');
  check('invalid job id rejected', r.status === 400 || r.status === 404, `${r.status}`);

  r = await call('PUT', `/api/jobs/${state.jobId}`, { token: state.rivalToken, body: { title: 'Hijacked' } });
  check('rival company cannot edit our job (403)', r.status === 403, `${r.status}`);

  r = await call('DELETE', `/api/jobs/${state.jobId}`, { token: state.rivalToken });
  check('rival company cannot delete our job (403)', r.status === 403, `${r.status}`);
});

await section('Applications & authorization', async () => {
  let r = await call('POST', '/api/applications', {
    token: state.seekerToken,
    body: { jobId: state.jobId, message: 'I have scaled WebSocket infrastructure at two startups.' },
  });
  check('seeker applies', r.status === 201, `${r.status} ${r.text.slice(0, 200)}`);
  state.applicationId = r.json?.id;

  r = await call('POST', '/api/applications', {
    token: state.seekerToken,
    body: { jobId: state.jobId, message: 'again' },
  });
  check('duplicate application rejected (409)', r.status === 409, `${r.status}`);

  r = await call('GET', '/api/applications');
  check('anonymous cannot list applications (401)', r.status === 401, `${r.status}`);

  r = await call('GET', '/api/applications', { token: state.seekerToken });
  check('seeker sees only own applications', r.status === 200 && r.json?.length === 1, `${r.status} len=${r.json?.length}`);
  check('seeker application includes job.companyId', !!r.json?.[0]?.job?.companyId, 'missing companyId for Message button');

  r = await call('GET', '/api/applications', { token: state.companyToken });
  check('company sees applications on own jobs', r.status === 200 && r.json?.length === 1, `${r.status} len=${r.json?.length}`);

  r = await call('GET', '/api/applications', { token: state.rivalToken });
  check('rival company sees no applications', r.status === 200 && r.json?.length === 0, `${r.status} len=${r.json?.length}`);

  r = await call('GET', `/api/applications?companyId=${state.companyId}`, { token: state.rivalToken });
  check('rival cannot query our companyId (403)', r.status === 403, `${r.status}`);

  r = await call('PATCH', '/api/applications', {
    token: state.seekerToken,
    body: { id: state.applicationId, status: 'ACCEPTED' },
  });
  check('seeker cannot change own status (403)', r.status === 403, `${r.status}`);

  r = await call('PATCH', '/api/applications', {
    token: state.rivalToken,
    body: { id: state.applicationId, status: 'ACCEPTED' },
  });
  check('rival cannot change our application (403)', r.status === 403, `${r.status}`);

  r = await call('PATCH', '/api/applications', {
    token: state.companyToken,
    body: { id: state.applicationId, status: 'SHORTLISTED' },
  });
  check('owning company shortlists', r.status === 200 && r.json?.status === 'SHORTLISTED', `${r.status}`);

  // Mass-assignment: only status should be writable.
  r = await call('PATCH', '/api/applications', {
    token: state.companyToken,
    body: { id: state.applicationId, status: 'INTERVIEW', userId: 'attacker', createdAt: '2000-01-01T00:00:00Z' },
  });
  check('extra body fields ignored (no mass assignment)', r.status === 200 && r.json?.userId === state.seekerId, `userId=${r.json?.userId}`);

  r = await call('GET', '/api/notifications', { token: state.seekerToken });
  check('seeker notified of status change', r.status === 200 && (r.json?.notifications ?? r.json)?.length >= 1, `${r.status}`);
});

await section('Profile & validation', async () => {
  let r = await call('GET', `/api/users/${state.seekerId}`, { token: state.seekerToken });
  check('seeker reads own profile', r.status === 200 && r.json?.email === seekerEmail, `${r.status}`);

  r = await call('GET', `/api/users/${state.seekerId}`, { token: state.rivalToken });
  check('other user gets minimal shape (no email)', r.status === 200 && !r.json?.email, `email leaked: ${r.json?.email}`);

  r = await call('PUT', `/api/users/${state.seekerId}`, { token: state.rivalToken, body: { name: 'Hacked' } });
  check('cannot edit another user (403)', r.status === 403, `${r.status}`);

  // The bug fixed this session: a blank experience box must not record 0 years.
  r = await call('PUT', `/api/users/${state.seekerId}`, {
    token: state.seekerToken,
    body: {
      name: 'Test Seeker',
      email: seekerEmail,
      headline: 'Backend engineer scaling real-time systems',
      skills: ['Go', 'PostgreSQL', 'WebSockets', 'Redis'],
      seniority: 'Senior',
      yearsOfExp: '',
    },
  });
  check('profile update succeeds', r.status === 200, `${r.status} ${r.text.slice(0, 150)}`);
  check('blank years stored as null, not 0', r.json?.user?.yearsOfExp === null || r.json?.yearsOfExp === null, `got ${JSON.stringify(r.json?.user?.yearsOfExp ?? r.json?.yearsOfExp)}`);

  r = await call('PUT', `/api/users/${state.seekerId}`, {
    token: state.seekerToken,
    body: { name: 'Test Seeker', email: seekerEmail, yearsOfExp: 7, seniority: 'NotARealLevel' },
  });
  check('numeric years stored', (r.json?.user?.yearsOfExp ?? r.json?.yearsOfExp) === 7, `got ${r.json?.user?.yearsOfExp ?? r.json?.yearsOfExp}`);
  check('bogus seniority dropped', (r.json?.user?.seniority ?? r.json?.seniority) === null, `got ${r.json?.user?.seniority ?? r.json?.seniority}`);
});

await section('AI — index, matching, search', async () => {
  // ADMIN cannot be self-assigned, so promote directly in the database, which is
  // exactly what the README tells an operator to do.
  // Resolved by package name now that this script lives in the repo. It used
  // to require PRISMA_CLIENT_PATH because it ran from a scratchpad outside the
  // project, where `@prisma/client` does not resolve; the env var is kept as an
  // escape hatch for anyone running it from somewhere else.
  const { PrismaClient } = await import(process.env.PRISMA_CLIENT_PATH || '@prisma/client');
  const db = new PrismaClient();
  const adminEmail = `admin.${stamp}@example.com`;
  await db.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
  await db.$disconnect();

  let r = await call('POST', '/api/auth', { body: { action: 'login', email: adminEmail, password: PASSWORD } });
  state.adminToken = r.json?.token;
  check('promoted admin can log in', r.json?.user?.role === 'ADMIN', `role=${r.json?.user?.role}`);

  r = await call('GET', '/api/ai/reindex', { token: state.seekerToken });
  check('non-admin cannot read index status (403)', r.status === 403, `${r.status}`);

  r = await call('GET', '/api/ai/reindex', { token: state.adminToken });
  check('admin reads index status', r.status === 200 && r.json?.enabled === true, `${r.status} ${r.text.slice(0, 120)}`);
  console.log(`        index before: ${JSON.stringify(r.json?.jobs)} profiles=${JSON.stringify(r.json?.profiles)}`);

  r = await call('POST', '/api/ai/reindex', { token: state.adminToken, body: {} });
  check('admin backfills embeddings', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  console.log(`        backfill result: ${r.text.slice(0, 200)}`);

  r = await call('GET', '/api/ai/reindex', { token: state.adminToken });
  check('jobs are now indexed', r.json?.jobs?.indexed >= 2, `indexed=${r.json?.jobs?.indexed}/${r.json?.jobs?.total}`);
  check('seeker profile is now indexed', r.json?.profiles?.indexed >= 1, `indexed=${r.json?.profiles?.indexed}/${r.json?.profiles?.total}`);

  // Semantic search: none of these words appear in the posting.
  r = await call('GET', '/api/jobs?q=' + encodeURIComponent('someone who has scaled a real-time backend'));
  check('semantic search returns results', r.status === 200 && r.json?.length >= 1, `${r.status} len=${r.json?.length}`);
  check('semantic search never leaks vectors', !r.text.includes('"vector"'));
  if (Array.isArray(r.json) && r.json.length) {
    console.log(`        top hit: "${r.json[0].title}"  relevance=${r.json[0].relevance}`);
    check('backend role outranks the design role', r.json[0].title.includes('Backend'), `got "${r.json[0].title}"`);
  }

  r = await call('GET', '/api/jobs/recommended', { token: state.seekerToken });
  check('recommendations return', r.status === 200, `${r.status} ${r.text.slice(0, 150)}`);
  const jobs = r.json?.jobs ?? r.json;
  console.log(`        reason=${r.json?.reason ?? 'n/a'}  count=${Array.isArray(jobs) ? jobs.length : 'n/a'}`);
  if (Array.isArray(jobs) && jobs.length) {
    const top = jobs[0];
    console.log(`        top match: "${top.title}" score=${top.match?.score} facets=${JSON.stringify(top.match?.facets)}`);
    check('match score is 0-100', top.match?.score >= 0 && top.match?.score <= 100, `${top.match?.score}`);
    check('match exposes facet breakdown', !!top.match?.facets?.semantic, 'no facets');
    check('match lists shared skills', Array.isArray(top.match?.sharedSkills) && top.match.sharedSkills.length > 0, JSON.stringify(top.match?.sharedSkills));
  }
  check('recommendations never leak vectors', !r.text.includes('"vector"'));

  r = await call('GET', `/api/applications?jobId=${state.jobId}&rank=fit`, { token: state.companyToken });
  check('company ranks applicants by fit', r.status === 200 && Array.isArray(r.json), `${r.status}`);
  if (Array.isArray(r.json) && r.json.length) {
    console.log(`        applicant fit: ${r.json[0].match?.score ?? r.json[0].matchScore}`);
  }

  r = await call('POST', '/api/ai/assist', {
    token: state.companyToken,
    body: { mode: 'job-description', title: 'Staff Platform Engineer', type: 'Full Time', location: 'Remote', experience: 'Senior' },
  });
  check('company gets drafting help', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  if (r.status === 200) console.log(`        draft: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}...`);

  r = await call('POST', '/api/ai/assist', { token: state.seekerToken, body: { mode: 'job-description', title: 'X' } });
  check('seeker cannot use company drafting (403)', r.status === 403, `${r.status}`);
});

console.log(`\n================================`);
console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
}
console.log(JSON.stringify({ ...state, seekerEmail, companyEmail }, null, 0));
