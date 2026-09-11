import { prisma } from '@/lib/prisma';
import { MAX_SKILL_LENGTH, cleanString } from '@/lib/validation';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  FUZZY_SKILL_CREDIT,
  SKILL_MATCH_THRESHOLD,
  isAiEnabled,
} from './config';
import { embedTexts } from './gemini';
import { cosineSimilarity } from './vector';

/**
 * Skill vocabulary — canonicalisation and comparison.
 *
 * Comparing skill tags by exact string is the largest source of wrong numbers
 * in the matcher: nobody writes `PostgreSQL` and `Postgres` the same way twice,
 * so the skills facet under-counts and the "missing skills" list tells a
 * candidate they lack something their profile already names.
 *
 * Three layers, cheapest first:
 *
 *   1. An alias table — static, free, synchronous, catches the large majority.
 *   2. Canonical form on the way in, so both sides of a comparison already
 *      agree before anything is compared (`canonicalSkillList`).
 *   3. Embedding similarity for whatever survives 1 and 2 — `GraphQL` vs
 *      `Apollo` is a real partial match no alias table will ever hold.
 *
 * Layer 3 is the only one that can fail, and it fails soft: every path here
 * degrades to layers 1–2, which need neither the network nor the database.
 */

/* -------------------------------------------------------------------------- */
/* Layer 1 — alias table                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Variant → canonical label.
 *
 * Breadth beats depth: a hundred common tags cover almost every real profile,
 * and the embedding layer exists precisely so this table does not have to be
 * exhaustive. Entries are written in their natural casing and normalised at
 * module load, so adding one never requires knowing the normalisation rules.
 *
 * Two deliberate omissions: `cv` (a résumé far more often than Computer Vision
 * on a job portal) and `es` (ambiguous between ECMAScript and Elasticsearch).
 * A wrong alias is worse than a missing one — it is silent and it inflates.
 */
const SKILL_ALIASES: Record<string, string> = {
  /* Languages */
  js: 'JavaScript',
  javascript: 'JavaScript',
  ecmascript: 'JavaScript',
  es6: 'JavaScript',
  'vanilla js': 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  python3: 'Python',
  go: 'Go',
  golang: 'Go',
  'go lang': 'Go',
  'c#': 'C#',
  csharp: 'C#',
  'c sharp': 'C#',
  '.net': '.NET',
  dotnet: '.NET',
  'dot net': '.NET',
  '.net core': '.NET',
  'asp.net': '.NET',
  aspnet: '.NET',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  objc: 'Objective-C',
  'objective c': 'Objective-C',
  'c++': 'C++',
  cpp: 'C++',
  cplusplus: 'C++',
  c: 'C',
  ruby: 'Ruby',
  php: 'PHP',
  rust: 'Rust',
  rustlang: 'Rust',
  scala: 'Scala',
  r: 'R',
  matlab: 'MATLAB',
  perl: 'Perl',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  'shell scripting': 'Shell',
  powershell: 'PowerShell',
  sql: 'SQL',
  html: 'HTML',
  html5: 'HTML',
  css: 'CSS',
  css3: 'CSS',
  sass: 'Sass',
  scss: 'Sass',
  dart: 'Dart',
  elixir: 'Elixir',
  haskell: 'Haskell',
  solidity: 'Solidity',

  /* Datastores and data platforms */
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  'postgres sql': 'PostgreSQL',
  psql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongo: 'MongoDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  elastic: 'Elasticsearch',
  elasticsearch: 'Elasticsearch',
  'elastic search': 'Elasticsearch',
  opensearch: 'Elasticsearch',
  sqlite: 'SQLite',
  dynamo: 'DynamoDB',
  dynamodb: 'DynamoDB',
  cassandra: 'Cassandra',
  neo4j: 'Neo4j',
  oracle: 'Oracle Database',
  'oracle db': 'Oracle Database',
  mssql: 'SQL Server',
  'sql server': 'SQL Server',
  'microsoft sql server': 'SQL Server',
  tsql: 'SQL Server',
  't sql': 'SQL Server',
  snowflake: 'Snowflake',
  bigquery: 'BigQuery',
  firebase: 'Firebase',
  firestore: 'Firebase',
  supabase: 'Supabase',

  /* Infrastructure and delivery */
  k8s: 'Kubernetes',
  kube: 'Kubernetes',
  kubernetes: 'Kubernetes',
  docker: 'Docker',
  containerisation: 'Docker',
  containerization: 'Docker',
  tf: 'Terraform',
  terraform: 'Terraform',
  aws: 'AWS',
  'amazon web services': 'AWS',
  gcp: 'GCP',
  'google cloud': 'GCP',
  'google cloud platform': 'GCP',
  azure: 'Azure',
  'microsoft azure': 'Azure',
  'ci/cd': 'CI/CD',
  cicd: 'CI/CD',
  'continuous integration': 'CI/CD',
  'continuous delivery': 'CI/CD',
  'continuous deployment': 'CI/CD',
  jenkins: 'Jenkins',
  'github actions': 'GitHub Actions',
  'gh actions': 'GitHub Actions',
  'gitlab ci': 'GitLab CI',
  ansible: 'Ansible',
  helm: 'Helm',
  nginx: 'Nginx',
  linux: 'Linux',
  unix: 'Linux',
  git: 'Git',
  'version control': 'Git',
  prometheus: 'Prometheus',
  grafana: 'Grafana',
  kafka: 'Kafka',
  'apache kafka': 'Kafka',
  rabbitmq: 'RabbitMQ',
  'rabbit mq': 'RabbitMQ',
  lambda: 'AWS Lambda',
  'aws lambda': 'AWS Lambda',
  serverless: 'Serverless',
  devops: 'DevOps',
  sre: 'Site Reliability Engineering',
  'site reliability': 'Site Reliability Engineering',

  /* Frontend */
  react: 'React',
  reactjs: 'React',
  'react.js': 'React',
  'react native': 'React Native',
  vue: 'Vue.js',
  vuejs: 'Vue.js',
  'vue.js': 'Vue.js',
  angular: 'Angular',
  angularjs: 'Angular',
  'angular.js': 'Angular',
  next: 'Next.js',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  nuxt: 'Nuxt',
  nuxtjs: 'Nuxt',
  svelte: 'Svelte',
  sveltekit: 'Svelte',
  tailwind: 'Tailwind CSS',
  tailwindcss: 'Tailwind CSS',
  'tailwind css': 'Tailwind CSS',
  bootstrap: 'Bootstrap',
  mui: 'Material UI',
  'material ui': 'Material UI',
  redux: 'Redux',
  jquery: 'jQuery',
  webpack: 'Webpack',
  vite: 'Vite',
  storybook: 'Storybook',
  figma: 'Figma',
  'responsive design': 'Responsive Design',
  a11y: 'Accessibility',
  accessibility: 'Accessibility',
  wcag: 'Accessibility',

  /* Backend and APIs */
  node: 'Node.js',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  express: 'Express',
  expressjs: 'Express',
  'express.js': 'Express',
  nest: 'NestJS',
  nestjs: 'NestJS',
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  'fast api': 'FastAPI',
  rails: 'Ruby on Rails',
  ror: 'Ruby on Rails',
  'ruby on rails': 'Ruby on Rails',
  spring: 'Spring Boot',
  springboot: 'Spring Boot',
  'spring boot': 'Spring Boot',
  laravel: 'Laravel',
  graphql: 'GraphQL',
  'graph ql': 'GraphQL',
  apollo: 'Apollo',
  rest: 'REST APIs',
  'rest api': 'REST APIs',
  restful: 'REST APIs',
  'restful api': 'REST APIs',
  grpc: 'gRPC',
  microservices: 'Microservices',
  websocket: 'WebSockets',
  websockets: 'WebSockets',
  'socket.io': 'WebSockets',
  prisma: 'Prisma',
  orm: 'ORM',
  oauth: 'OAuth',
  oauth2: 'OAuth',
  jwt: 'JWT',

  /* Data, ML and AI */
  ml: 'Machine Learning',
  'machine learning': 'Machine Learning',
  dl: 'Deep Learning',
  'deep learning': 'Deep Learning',
  ai: 'Artificial Intelligence',
  'artificial intelligence': 'Artificial Intelligence',
  nlp: 'NLP',
  'natural language processing': 'NLP',
  'computer vision': 'Computer Vision',
  tensorflow: 'TensorFlow',
  pytorch: 'PyTorch',
  torch: 'PyTorch',
  sklearn: 'scikit-learn',
  'scikit learn': 'scikit-learn',
  pandas: 'pandas',
  numpy: 'NumPy',
  keras: 'Keras',
  llm: 'LLMs',
  llms: 'LLMs',
  'large language models': 'LLMs',
  genai: 'Generative AI',
  'gen ai': 'Generative AI',
  'generative ai': 'Generative AI',
  rag: 'RAG',
  'retrieval augmented generation': 'RAG',
  'data science': 'Data Science',
  'data analysis': 'Data Analysis',
  'data analytics': 'Data Analysis',
  etl: 'ETL',
  spark: 'Apache Spark',
  'apache spark': 'Apache Spark',
  pyspark: 'Apache Spark',
  hadoop: 'Hadoop',
  airflow: 'Airflow',
  'apache airflow': 'Airflow',
  tableau: 'Tableau',
  powerbi: 'Power BI',
  'power bi': 'Power BI',
  excel: 'Excel',
  'ms excel': 'Excel',
  statistics: 'Statistics',
  stats: 'Statistics',
  mlops: 'MLOps',

  /* Testing and ways of working */
  jest: 'Jest',
  cypress: 'Cypress',
  playwright: 'Playwright',
  selenium: 'Selenium',
  pytest: 'pytest',
  tdd: 'TDD',
  'test driven development': 'TDD',
  'unit testing': 'Unit Testing',
  'unit tests': 'Unit Testing',
  qa: 'QA',
  'quality assurance': 'QA',
  agile: 'Agile',
  scrum: 'Agile',
  jira: 'Jira',
};

/**
 * Case- and punctuation-insensitive form of a tag.
 *
 * `+`, `#` and `.` survive on purpose: without them `C++`, `C#` and `Node.js`
 * collapse into bare letters. This is byte-identical to the rule the private
 * `canonicalTag` in `vector.ts` applied, so a tag the alias table does not know
 * still compares exactly as it did before this file existed.
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

/** `react.js`, `react js` and `reactjs` are one skill written three ways. */
function compactTag(normalized: string): string {
  return normalized.replace(/[\s._-]/g, '');
}

const KEY_BY_VARIANT = new Map<string, string>();
const LABEL_BY_KEY = new Map<string, string>();

for (const [variant, label] of Object.entries(SKILL_ALIASES)) {
  const key = normalizeTag(label);
  LABEL_BY_KEY.set(key, label);
  KEY_BY_VARIANT.set(normalizeTag(variant), key);
  // A canonical label is always a variant of itself, so `PostgreSQL` resolves
  // even though only `postgres` and `psql` are spelled out above.
  KEY_BY_VARIANT.set(key, key);
}

// Compacted forms are registered in a second pass and never overwrite an exact
// entry: a spelled-out alias is curated, a compacted one is inferred, and where
// the two disagree the curated one has to win.
for (const [variant, key] of Array.from(KEY_BY_VARIANT.entries())) {
  const compact = compactTag(variant);
  if (!KEY_BY_VARIANT.has(compact)) KEY_BY_VARIANT.set(compact, key);
}

/**
 * The comparison key for a skill tag: normalised, then resolved through the
 * alias table. Not a display string — see `skillLabel` for that. Returns `''`
 * for a tag with no usable characters, which every caller drops.
 */
export function canonicalSkill(tag: string): string {
  const normalized = normalizeTag(tag ?? '');
  if (!normalized) return '';
  return KEY_BY_VARIANT.get(normalized) ?? KEY_BY_VARIANT.get(compactTag(normalized)) ?? normalized;
}

/** How a canonical skill is written for a human. Falls back to the input. */
export function skillLabel(tag: string): string {
  const key = canonicalSkill(tag);
  if (!key) return '';
  return LABEL_BY_KEY.get(key) ?? cleanString(tag, MAX_SKILL_LENGTH) ?? key;
}

/* -------------------------------------------------------------------------- */
/* Layer 2 — canonical storage                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Canonicalises a list of tags for storage, de-duplicating on the canonical key
 * so `React` and `ReactJS` on one profile collapse to a single entry.
 *
 * This is layer 2: run it on the way in — after `cleanTagList`, which does the
 * untrusted-input work — and both sides of every later comparison already agree
 * without anything having to be computed at read time.
 */
export function canonicalSkillList(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags ?? []) {
    const key = canonicalSkill(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(skillLabel(tag));
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

export interface SkillMatch {
  /** 0–1 overlap, on the same scale as the old `tagOverlap` figure. */
  score: number;
  /** Skills present on both sides by name or alias. */
  shared: string[];
  /** Skills the posting asks for that the profile does not evidence at all. */
  missing: string[];
  /** Pairs matched only by embedding similarity, so a caller can say so. */
  fuzzy: Array<{ profile: string; job: string }>;
}

interface SkillIndex {
  /** Canonical keys, de-duplicated, input order preserved. */
  keys: string[];
  /** Canonical key → the wording this side actually used. */
  labels: Map<string, string>;
}

function indexSkills(tags: string[]): SkillIndex {
  const keys: string[] = [];
  const labels = new Map<string, string>();

  for (const tag of tags ?? []) {
    const clean = cleanString(tag, MAX_SKILL_LENGTH);
    if (!clean) continue;
    const key = canonicalSkill(clean);
    if (!key || labels.has(key)) continue;
    labels.set(key, clean);
    keys.push(key);
  }

  return { keys, labels };
}

/** Canonical wording where we know it, otherwise whichever side wrote it. */
function displayLabel(key: string, ...sides: SkillIndex[]): string {
  const canonical = LABEL_BY_KEY.get(key);
  if (canonical) return canonical;
  for (const side of sides) {
    const label = side.labels.get(key);
    if (label) return label;
  }
  return key;
}

/**
 * Turns an exact-key intersection plus a set of fuzzy pairs into a result.
 *
 * The denominator stays the Jaccard union `tagOverlap` used, so a score from
 * this file is still comparable with one computed before it existed and the
 * facet weight in `MATCH_WEIGHTS` does not silently change meaning. What
 * changes is the numerator: aliases now count, and a fuzzy pair counts only
 * partially — an inflated score against a role someone cannot do is a worse
 * failure than a missed match.
 */
function settle(profile: SkillIndex, job: SkillIndex, fuzzy: Array<[string, string]>): SkillMatch {
  const profileKeys = new Set(profile.keys);
  const fuzzyJobKeys = new Set(fuzzy.map(([, jobKey]) => jobKey));

  const shared: string[] = [];
  const missing: string[] = [];
  let exact = 0;

  for (const key of job.keys) {
    if (profileKeys.has(key)) {
      exact++;
      shared.push(displayLabel(key, job, profile));
    } else if (!fuzzyJobKeys.has(key)) {
      missing.push(displayLabel(key, job, profile));
    }
  }

  const matched = exact + fuzzy.length;
  const union = profile.keys.length + job.keys.length - matched;

  // An empty side is "no signal", not "no overlap" — the caller decides what a
  // skill-less posting should score, exactly as it did with `tagOverlap`.
  const credit =
    profile.keys.length === 0 || job.keys.length === 0
      ? 0
      : exact + fuzzy.length * FUZZY_SKILL_CREDIT;

  return {
    score: union <= 0 ? 0 : Math.max(0, Math.min(1, credit / union)),
    shared,
    missing,
    fuzzy: fuzzy.map(([profileKey, jobKey]) => ({
      profile: displayLabel(profileKey, profile, job),
      job: displayLabel(jobKey, job, profile),
    })),
  };
}

/**
 * Layers 1–2 only: free, synchronous, no database and no model call.
 *
 * This is what the list-ranking paths use. It is also the fallback every async
 * path returns when the embedding layer is unavailable, which is why it has to
 * produce a complete, sensible result on its own rather than a placeholder.
 */
export function scoreSkillsSync(profileSkills: string[], jobSkills: string[]): SkillMatch {
  return settle(indexSkills(profileSkills), indexSkills(jobSkills), []);
}

/* -------------------------------------------------------------------------- */
/* Layer 3 — embedding fallback                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ceiling on how many unmatched tags per side reach the model.
 *
 * `MAX_SKILLS` already caps what a profile can store, but job rows predate that
 * validation, and an unbounded list would turn one page view into an unbounded
 * number of embedding calls.
 */
const MAX_FUZZY_CANDIDATES = 30;

/** How long a failed embedding is remembered before it is worth retrying. */
const EMBED_RETRY_AFTER_MS = 5 * 60 * 1000;

/** Bound on the in-process cache; the real vocabulary is far smaller. */
const MEMO_LIMIT = 5000;

const memo = new Map<string, number[]>();
const retryAfter = new Map<string, number>();

function remember(key: string, vector: number[]): void {
  // Cheap eviction: the vocabulary is nearly static, so reaching this at all
  // means something is generating junk tags and the cache is worth dropping.
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, vector);
}

/**
 * Skill tags are embedded with a short frame rather than bare.
 *
 * A one-token tag carries almost no context — `Go`, `R` and `C` are a verb and
 * two letters to an embedding model. Naming the domain puts them in the right
 * neighbourhood, and it costs nothing because each tag is embedded once ever.
 */
function embedPrompt(label: string): string {
  return `Technical skill: ${label}`;
}

/**
 * Vectors for a set of canonical skill keys: in-process cache, then
 * `SkillVector`, then the model — so a given skill is embedded at most once for
 * the lifetime of the database rather than once per comparison.
 */
async function loadSkillVectors(
  keys: string[],
  labels: Map<string, string>
): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  const misses: string[] = [];

  for (const key of new Set(keys)) {
    const cached = memo.get(key);
    if (cached) found.set(key, cached);
    else misses.push(key);
  }

  if (misses.length === 0) return found;

  // Filtering on model and dimensions matters: a vector produced by a different
  // model is not comparable with a fresh one, and mixing the two silently
  // produces similarities that look plausible and mean nothing.
  const rows = await prisma.skillVector.findMany({
    where: { tag: { in: misses }, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS },
    select: { tag: true, vector: true },
  });

  for (const row of rows) {
    if (!row.vector?.length) continue;
    remember(row.tag, row.vector);
    found.set(row.tag, row.vector);
  }

  const now = Date.now();
  const uncached = misses.filter((key) => !found.has(key) && (retryAfter.get(key) ?? 0) <= now);
  if (uncached.length === 0) return found;

  const vectors = await embedTexts(
    uncached.map((key) => embedPrompt(labels.get(key) ?? key)),
    'similarity'
  );

  const fresh: Array<{
    tag: string;
    label: string;
    vector: number[];
    model: string;
    dimensions: number;
  }> = [];

  uncached.forEach((key, index) => {
    const vector = vectors[index];
    if (!vector?.length) {
      retryAfter.set(key, now + EMBED_RETRY_AFTER_MS);
      return;
    }
    remember(key, vector);
    found.set(key, vector);
    fresh.push({
      tag: key,
      // The label is whatever a person or the résumé parser typed, so it is
      // capped before storage even though it is only ever shown back to them.
      label: cleanString(labels.get(key) ?? key, MAX_SKILL_LENGTH) ?? key,
      vector,
      model: EMBEDDING_MODEL,
      dimensions: vector.length,
    });
  });

  if (fresh.length > 0) {
    // `skipDuplicates` rather than an upsert per row: two requests racing on the
    // same new skill is normal, and the loser has nothing to correct.
    await prisma.skillVector.createMany({ data: fresh, skipDuplicates: true });
  }

  return found;
}

/**
 * Greedy one-to-one pairing of unmatched tags above `SKILL_MATCH_THRESHOLD`.
 *
 * One-to-one is the point: without it a profile listing five ORMs would match a
 * single `Prisma` requirement five times over, and the union arithmetic would
 * then report more matched skills than the posting even asked for.
 */
function pairByVector(
  profileKeys: string[],
  jobKeys: string[],
  vectors: Map<string, number[]>
): Array<[string, string]> {
  const candidates: Array<{ profile: string; job: string; similarity: number }> = [];

  for (const jobKey of jobKeys) {
    const jobVector = vectors.get(jobKey);
    if (!jobVector) continue;

    for (const profileKey of profileKeys) {
      const profileVector = vectors.get(profileKey);
      if (!profileVector) continue;

      const similarity = cosineSimilarity(profileVector, jobVector);
      if (similarity >= SKILL_MATCH_THRESHOLD) {
        candidates.push({ profile: profileKey, job: jobKey, similarity });
      }
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  const usedProfile = new Set<string>();
  const usedJob = new Set<string>();
  const pairs: Array<[string, string]> = [];

  for (const candidate of candidates) {
    if (usedProfile.has(candidate.profile) || usedJob.has(candidate.job)) continue;
    usedProfile.add(candidate.profile);
    usedJob.add(candidate.job);
    pairs.push([candidate.profile, candidate.job]);
  }

  return pairs;
}

/**
 * All three layers. Never throws, and never leaves a caller without a result:
 * anything that goes wrong past layer 2 returns the layer 1–2 answer, which is
 * the same answer the portal gives today with no API key set at all.
 */
export async function scoreSkills(
  profileSkills: string[],
  jobSkills: string[]
): Promise<SkillMatch> {
  const profile = indexSkills(profileSkills);
  const job = indexSkills(jobSkills);
  const exactOnly = settle(profile, job, []);

  if (!isAiEnabled() || profile.keys.length === 0 || job.keys.length === 0) return exactOnly;

  const profileKeys = new Set(profile.keys);
  const jobKeys = new Set(job.keys);
  const unmatchedJob = job.keys
    .filter((key) => !profileKeys.has(key))
    .slice(0, MAX_FUZZY_CANDIDATES);
  const unmatchedProfile = profile.keys
    .filter((key) => !jobKeys.has(key))
    .slice(0, MAX_FUZZY_CANDIDATES);

  // Nothing left to disagree about — the alias table already settled it.
  if (unmatchedJob.length === 0 || unmatchedProfile.length === 0) return exactOnly;

  try {
    const labels = new Map([...profile.labels, ...job.labels]);
    const vectors = await loadSkillVectors([...unmatchedJob, ...unmatchedProfile], labels);
    const pairs = pairByVector(unmatchedProfile, unmatchedJob, vectors);
    if (pairs.length === 0) return exactOnly;

    return settle(profile, job, pairs);
  } catch (error) {
    console.error('Fuzzy skill matching failed:', error);
    return exactOnly;
  }
}
