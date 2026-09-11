/**
 * Hand-labelled relevance judgements for the retrieval half of the harness.
 *
 * Grades are the standard graded-relevance scale, chosen so nDCG has something
 * to reward beyond "in the set":
 *
 *   3 — this is the answer. If it is not near the top, retrieval is broken.
 *   2 — clearly relevant; a user would be pleased to see it.
 *   1 — defensible. Adjacent role, or the right domain at the wrong level.
 *   0 — everything not listed. Absence is a judgement, not an oversight.
 *
 * `mustNotRank` is the other half of the measurement and the part a recall
 * metric cannot express. Recall rewards finding things; it says nothing about
 * a designer role surfacing for an SRE query. Those ids are checked for
 * presence in the top k and reported as a false-positive rate, because "the
 * near-misses stay out" is a claim this phase has to keep as well.
 *
 * Judgements are written against the *intent* of the query, not against what
 * any current implementation happens to return. When a change makes the
 * numbers worse, the first question is whether the change is wrong; the second
 * is whether a judgement here is wrong. Both are legitimate answers — but
 * editing a judgement to make a run look better is how a harness stops meaning
 * anything, so a judgement change should be its own commit with its own reason.
 */

/** 3 = must be top, 2 = clearly relevant, 1 = defensible, 0 = unlisted. */
export type Grade = 1 | 2 | 3;

export interface EvalQuery {
  id: string;
  /** What the user types. Kept verbatim — this is what gets embedded. */
  text: string;
  /**
   * Which weakness this query exists to measure. Grouped in the report so a
   * change can be attributed: "hybrid retrieval lifted `literal` by 18 points
   * and left `intent` flat" is a finding; a single averaged number is not.
   */
  category: 'synonym' | 'literal' | 'intent' | 'structured' | 'domain' | 'nearMiss';
  /** Posting id -> grade. */
  relevant: Record<string, Grade>;
  /** Posting ids that appearing in the top k counts against the run. */
  mustNotRank?: string[];
  /**
   * For `structured` queries only: the filter a query-understanding pass (V3)
   * ought to extract. Recorded so the claim can be checked directly rather
   * than inferred from whether the ranking happened to improve.
   */
  expectedFilters?: {
    remote?: boolean;
    minSeniority?: string;
    minSalaryUsd?: number;
    location?: string;
  };
  /** Why these judgements, where it is not self-evident. */
  note?: string;
}

export const QUERIES: EvalQuery[] = [
  /* ---- Skill synonyms: the same skill, spelled the other way ------------- */
  {
    id: 'synonym-postgres',
    text: 'Postgres database expert',
    category: 'synonym',
    note:
      'Only Halcyon writes "Postgres"; every other Postgres role writes "PostgreSQL". Wrenfield is the answer on substance, Halcyon on the literal token — a run that finds one but not the other has a specific, nameable problem.',
    relevant: {
      'wrenfield-database-reliability': 3,
      'halcyon-node-api': 2,
      'orbital-go-backend': 1,
      'verdant-python-platform': 1,
      'marrowbrook-nextjs-fullstack': 1,
      'umbercove-go-onsite': 1,
      'sableton-django-fullstack': 1,
    },
  },
  {
    id: 'synonym-react',
    text: 'ReactJS developer',
    category: 'synonym',
    relevant: {
      'lambenthouse-reactjs': 3,
      'quillfeather-react-senior': 3,
      'marrowbrook-nextjs-fullstack': 2,
      'sableton-django-fullstack': 1,
    },
    mustNotRank: ['northgate-sre', 'wrenfield-database-reliability'],
  },
  {
    id: 'synonym-k8s',
    text: 'K8s cluster and container orchestration work',
    category: 'synonym',
    relevant: {
      'nimbusreef-platform-k8s': 3,
      'brightsilo-sre-lead': 3,
      'cindermill-devops': 2,
      'northgate-sre': 2,
      'orbital-go-backend': 1,
      'cobaltwren-ml-engineer': 1,
    },
  },
  {
    id: 'synonym-javascript',
    text: 'JavaScript engineer',
    category: 'synonym',
    note:
      'Only Lambent House lists "JavaScript" as a skill; the rest say TypeScript, Node.js or React. A JS query that returns only the one literal match is under-retrieving.',
    relevant: {
      'lambenthouse-reactjs': 3,
      'quillfeather-react-senior': 2,
      'halcyon-node-api': 2,
      'marrowbrook-nextjs-fullstack': 2,
      'solveig-graphql-api': 2,
      'oakenpath-vue': 1,
      'ashgrove-qa-automation': 1,
    },
  },

  /* ---- Rare literal tokens: where a pure vector search is weakest -------- */
  {
    id: 'literal-sre',
    text: 'SRE',
    category: 'literal',
    note:
      'A three-letter acronym with almost no surrounding context to embed. This is the canonical case for ROADMAP weakness 2.',
    relevant: {
      'northgate-sre': 3,
      'brightsilo-sre-lead': 3,
      'cindermill-devops': 1,
      'nimbusreef-platform-k8s': 1,
    },
    mustNotRank: ['plumeria-product-designer', 'glasswing-ux-researcher', 'orrery-product-manager'],
  },
  {
    id: 'literal-company-tidalglass',
    text: 'Tidalglass Systems',
    category: 'literal',
    note: 'Exactly one posting can be correct. Anything else in position one is a failure.',
    relevant: { 'tidalglass-realtime-staff': 3 },
  },
  {
    id: 'literal-company-orbital',
    text: 'Orbital Freight',
    category: 'literal',
    note:
      'Deliberately adversarial: "Umbercove Freight" shares the second word and the industry, "Orrery Logistics" shares the first syllable and the domain. Neither is the answer.',
    relevant: { 'orbital-go-backend': 3 },
    mustNotRank: [],
  },
  {
    id: 'literal-dbt',
    text: 'dbt',
    category: 'literal',
    note: 'A two-letter tool name that is also an ordinary letter sequence. Lexical retrieval should find this trivially; a vector alone usually does not.',
    relevant: {
      'tanglewick-analytics-engineer': 3,
      'pellucid-data-engineer': 2,
    },
  },
  {
    id: 'literal-io-uring',
    text: 'io_uring performance work',
    category: 'literal',
    relevant: { 'thistledown-rust-systems': 3 },
  },
  {
    id: 'literal-nextjs',
    text: 'Next.js App Router',
    category: 'literal',
    relevant: {
      'marrowbrook-nextjs-fullstack': 3,
      'quillfeather-react-senior': 2,
    },
  },

  /* ---- Natural-language intent: where lexical retrieval is weakest ------- */
  {
    id: 'intent-realtime-scale',
    text: 'someone who has scaled a real-time backend',
    category: 'intent',
    note:
      'No shared keyword carries this. Tidalglass says it almost verbatim, Orbital describes it without the phrase, and Marlinspike is the low-latency near-neighbour that is not really the same thing.',
    relevant: {
      'tidalglass-realtime-staff': 3,
      'orbital-go-backend': 2,
      'quintessa-engineering-manager': 1,
      'marlinspike-java': 1,
    },
  },
  {
    id: 'intent-mentor-and-code',
    text: 'a role where I can mentor engineers and still write code myself',
    category: 'intent',
    relevant: {
      'quintessa-engineering-manager': 3,
      'tidalglass-realtime-staff': 3,
      'brightsilo-sre-lead': 2,
    },
  },
  {
    id: 'intent-first-job',
    text: 'my first engineering job out of university, backend work, happy to be taught',
    category: 'intent',
    relevant: {
      'hollowpine-junior-go': 3,
      'cressida-support-engineer': 1,
    },
    mustNotRank: [
      'tidalglass-realtime-staff',
      'brightsilo-sre-lead',
      'quintessa-engineering-manager',
    ],
  },
  {
    id: 'intent-boring-reliability',
    text: 'I want to spend my time on database internals rather than shipping features',
    category: 'intent',
    relevant: {
      'wrenfield-database-reliability': 3,
      'thistledown-rust-systems': 2,
      'northgate-sre': 1,
    },
  },

  /* ---- Structured intent: constraints stated in prose (V3) --------------- */
  {
    id: 'structured-remote-senior-go-120k',
    text: 'remote senior Go role above 120k',
    category: 'structured',
    note:
      'Three of the four Go postings satisfy the words and fail a constraint: Hollowpine is junior and on-site, Umbercove is on-site, Northgate is on-site. Embedding the words "remote" and "120k" cannot tell them apart — this is ROADMAP weakness 5 stated as a test.',
    expectedFilters: { remote: true, minSeniority: 'Senior', minSalaryUsd: 120000 },
    relevant: {
      'orbital-go-backend': 3,
      'tidalglass-realtime-staff': 3,
      'nimbusreef-platform-k8s': 2,
      'quintessa-engineering-manager': 1,
    },
    mustNotRank: ['hollowpine-junior-go', 'umbercove-go-onsite', 'northgate-sre'],
  },
  {
    id: 'structured-berlin',
    text: 'jobs in Berlin',
    category: 'structured',
    expectedFilters: { location: 'Berlin, Germany' },
    relevant: {
      'halcyon-node-api': 3,
      'glasswing-ux-researcher': 3,
    },
  },

  /* ---- Domain queries: ordinary retrieval, the control group ------------- */
  {
    id: 'domain-ml-pytorch',
    text: 'machine learning engineer working with PyTorch',
    category: 'domain',
    relevant: {
      'cobaltwren-ml-engineer': 3,
      'fernhollow-data-scientist': 2,
      'pellucid-data-engineer': 1,
    },
  },
  {
    id: 'domain-android-kotlin',
    text: 'Kotlin Android app developer',
    category: 'domain',
    relevant: {
      'vellichor-android': 3,
      'driftmoor-ios': 1,
    },
  },
  {
    id: 'domain-appsec',
    text: 'OWASP threat modelling and secure code review',
    category: 'domain',
    relevant: { 'serrafax-appsec': 3 },
  },
  {
    id: 'domain-graphql-apollo',
    text: 'Apollo federated graph and schema evolution',
    category: 'domain',
    note:
      'Apollo and GraphQL are the alias-table miss that only an embedding fallback catches (ROADMAP V1 layer 3).',
    relevant: {
      'solveig-graphql-api': 3,
      'quillfeather-react-senior': 1,
    },
  },

  /* ---- Near miss: the queries that must NOT drag engineering roles in ---- */
  {
    id: 'nearmiss-product-designer',
    text: 'product designer who owns a design system',
    category: 'nearMiss',
    note:
      'Everything in this corpus is a software job, so the vector space is crowded with plausible-but-wrong neighbours. If a backend posting appears in the top five here, the score band is doing no discriminating.',
    relevant: {
      'plumeria-product-designer': 3,
      'glasswing-ux-researcher': 1,
    },
    mustNotRank: [
      'orbital-go-backend',
      'tidalglass-realtime-staff',
      'northgate-sre',
      'marrowbrook-nextjs-fullstack',
      'quillfeather-react-senior',
    ],
  },
];
