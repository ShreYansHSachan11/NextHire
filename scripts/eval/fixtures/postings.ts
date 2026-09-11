/**
 * Synthetic job corpus for the evaluation harness.
 *
 * Every company here is invented and every description written for this file.
 * That is deliberate: the corpus is committed, so it must not contain a real
 * posting, a real person, or anything scraped. Any resemblance to a real
 * company is coincidence, not a data source.
 *
 * The corpus is small on purpose (~32 documents). Large enough that recall@5
 * and nDCG@10 move by a visible amount when ranking changes, small enough that
 * a full re-embed is one batched Gemini call and a human can read every
 * judgement in `queries.ts` and disagree with it.
 *
 * Composition is not random. Postings exist to create the *confusions* that
 * ROADMAP items V1-V3 claim to fix:
 *
 *   - Spelling variants of the same skill (`Postgres` vs `PostgreSQL`,
 *     `React` vs `ReactJS`, `K8s` vs `Kubernetes`) live in different postings,
 *     so a query using one spelling can only find the other if
 *     canonicalisation actually works.
 *   - Rare literal tokens (`SRE`, `dbt`, `io_uring`, company names) appear in
 *     one or two postings only. That is where pure vector retrieval is weakest
 *     and where hybrid retrieval has to prove itself.
 *   - Structured constraints (remote/on-site, seniority, salary) vary across
 *     otherwise near-identical Go backend roles, so "remote senior Go role
 *     above 120k" has real distractors to reject rather than obvious ones.
 *   - Non-engineering roles are present so a designer query has somewhere
 *     correct to land, and a backend query has something wrong to avoid.
 */

export interface EvalPosting {
  /** Stable id, referenced by judgements. Add ids; never renumber them. */
  id: string;
  title: string;
  companyName: string;
  location: string;
  type: string;
  experience: string;
  salary: string;
  skills: string[];
  description: string;
  /**
   * The structured truth behind the prose. Not embedded — it exists so a
   * query-understanding change (V3) can be checked against what the posting
   * actually is, rather than against what the description happens to say.
   */
  facts: {
    remote: boolean;
    seniority: string;
    /** Lower bound of the advertised band, converted to USD, rounded. */
    minSalaryUsd: number;
  };
}

export const POSTINGS: EvalPosting[] = [
  {
    id: 'orbital-go-backend',
    title: 'Senior Backend Engineer, Go',
    companyName: 'Orbital Freight',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$145,000 - $180,000',
    skills: ['Go', 'PostgreSQL', 'gRPC', 'Kubernetes', 'Kafka'],
    description:
      'Orbital Freight tracks half a million shipments an hour. You will own the ingestion path that turns raw telematics into live shipment positions: a Go service reading from Kafka, writing to PostgreSQL, and pushing updates to customers within two seconds of the event. Recent work included resharding the position store without downtime and cutting p99 write latency from 400ms to 60ms. We run on Kubernetes and expect you to own your services in production, pager included.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 145000 },
  },
  {
    id: 'tidalglass-realtime-staff',
    title: 'Staff Engineer, Real-Time Platform',
    companyName: 'Tidalglass Systems',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Staff, 8+ years',
    salary: '$185,000 - $220,000',
    skills: ['Go', 'WebSockets', 'Redis', 'Kafka', 'PostgreSQL', 'Distributed Systems'],
    description:
      'The Tidalglass real-time platform carries four million concurrent WebSocket connections for collaborative editing customers. We want someone who has scaled a real-time backend before and knows what breaks: connection storms after a deploy, fan-out amplification, back-pressure that arrives as memory pressure rather than as an error. You will set technical direction for the platform group, mentor five engineers, and still spend real time in the Go codebase.',
    facts: { remote: true, seniority: 'Staff', minSalaryUsd: 185000 },
  },
  {
    id: 'halcyon-node-api',
    title: 'Backend Engineer, Node.js',
    companyName: 'Halcyon Ledger',
    location: 'Berlin, Germany',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: 'EUR 72,000 - 92,000',
    skills: ['Node.js', 'TypeScript', 'Postgres', 'REST APIs', 'Docker'],
    description:
      'Halcyon Ledger builds double-entry accounting infrastructure for European fintechs. Our API is Node.js and TypeScript on top of Postgres, with strict correctness requirements: every endpoint is idempotent and every balance change is reconstructible from the ledger. You will work from our Berlin office three days a week alongside the compliance team. German is welcome but not required; the engineering team works in English.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 78000 },
  },
  {
    id: 'verdant-python-platform',
    title: 'Platform Engineer, Python',
    companyName: 'Verdant Analytics',
    location: 'Remote (EMEA)',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: '$120,000 - $145,000',
    skills: ['Python', 'Django', 'PostgreSQL', 'Celery', 'AWS'],
    description:
      'Verdant Analytics gives sustainability teams somewhere to put their emissions data. The platform is a Django monolith with a Celery worker fleet, backed by PostgreSQL on AWS. The interesting problems are ingestion problems: customers send us spreadsheets that disagree with themselves, and our job is to make the disagreement visible rather than silently averaged away.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 120000 },
  },
  {
    id: 'northgate-sre',
    title: 'Site Reliability Engineer',
    companyName: 'Northgate Payments',
    location: 'London, United Kingdom',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: 'GBP 88,000 - 112,000',
    skills: ['SRE', 'Kubernetes', 'Terraform', 'Prometheus', 'Go'],
    description:
      'Northgate Payments settles card transactions for eleven thousand merchants and the settlement window does not move. This is a classic SRE role: error budgets, toil reduction, blameless postmortems, and enough Go to fix the service rather than file a ticket about it. Infrastructure is Kubernetes described in Terraform, observed with Prometheus and Grafana. On-call is one week in six with a properly staffed rotation.',
    facts: { remote: false, seniority: 'Senior', minSalaryUsd: 112000 },
  },
  {
    id: 'brightsilo-sre-lead',
    title: 'Lead Site Reliability Engineer',
    companyName: 'Brightsilo Cloud',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Lead, 7+ years',
    salary: '$175,000 - $205,000',
    skills: ['SRE', 'K8s', 'Terraform', 'Datadog', 'Incident Response'],
    description:
      'Brightsilo runs managed object storage. You would lead a reliability group of four, set the SLO practice across seven product teams, and act as incident commander for anything customer-visible. Our stack is K8s on three cloud providers, Terraform for everything, Datadog for telemetry. We want someone who enjoys teaching the practice as much as doing it: half this job is making other teams better at operating what they build.',
    facts: { remote: true, seniority: 'Lead', minSalaryUsd: 175000 },
  },
  {
    id: 'cindermill-devops',
    title: 'DevOps Engineer',
    companyName: 'Cindermill Robotics',
    location: 'Austin, Texas',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: '$112,000 - $138,000',
    skills: ['Docker', 'Kubernetes', 'GitHub Actions', 'AWS', 'Bash'],
    description:
      'Cindermill builds warehouse robots, so our build pipeline ships firmware as well as web services. You will own continuous integration end to end: GitHub Actions workflows, Docker images, deployment into Kubernetes, and the hardware-in-the-loop test rigs that keep us honest. Hybrid from our Austin office, two days a week on site, because the robots are there.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 112000 },
  },
  {
    id: 'nimbusreef-platform-k8s',
    title: 'Platform Engineer, Kubernetes',
    companyName: 'Nimbus Reef',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$150,000 - $180,000',
    skills: ['Kubernetes', 'Helm', 'Go', 'Terraform', 'Platform Engineering'],
    description:
      'Nimbus Reef is building the internal developer platform that two hundred engineers deploy through. Concretely: Kubernetes operators written in Go, Helm charts nobody has to read, and a paved road where the default path is also the compliant path. Success is measured by how rarely a product engineer needs to know what a namespace is. Fully remote with quarterly meet-ups.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 150000 },
  },
  {
    id: 'quillfeather-react-senior',
    title: 'Senior Frontend Engineer',
    companyName: 'Quillfeather Media',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$138,000 - $165,000',
    skills: ['React', 'TypeScript', 'Next.js', 'GraphQL', 'Accessibility'],
    description:
      'Quillfeather publishes long-form journalism and the reading experience is the product. You will work in React and TypeScript on a Next.js application consuming a GraphQL content API, with a real mandate to keep the page fast on a five-year-old phone on a bad connection. Accessibility is a requirement rather than an audit finding; we test with screen readers before we ship.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 138000 },
  },
  {
    id: 'lambenthouse-reactjs',
    title: 'Frontend Developer, ReactJS',
    companyName: 'Lambent House',
    location: 'Bengaluru, India',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: 'INR 18,00,000 - 26,00,000',
    skills: ['ReactJS', 'Redux', 'JavaScript', 'CSS', 'Jest'],
    description:
      'Lambent House builds white-label storefronts for regional retailers. The frontend is a ReactJS application with Redux for cart and checkout state, styled with plain CSS modules because our clients need to re-theme it without our help. You will work from the Bengaluru office. Expect cross-browser work and an unusual amount of attention to the checkout funnel, which is where our revenue lives.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 22000 },
  },
  {
    id: 'oakenpath-vue',
    title: 'Frontend Engineer, Vue',
    companyName: 'Oakenpath Retail',
    location: 'Amsterdam, Netherlands',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: 'EUR 68,000 - 85,000',
    skills: ['Vue.js', 'TypeScript', 'Vite', 'Tailwind CSS', 'Pinia'],
    description:
      'Oakenpath runs point-of-sale software for independent grocers across the Benelux. The till application is Vue 3 with Pinia, built with Vite, and it has to keep working when the shop loses its connection halfway through a transaction. Offline-first is not a nice-to-have here. Hybrid from Amsterdam, with a strong preference for someone who has shipped a PWA people used for real work.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 74000 },
  },
  {
    id: 'marrowbrook-nextjs-fullstack',
    title: 'Full-Stack Engineer, Next.js',
    companyName: 'Marrowbrook Health',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: '$128,000 - $155,000',
    skills: ['Next.js', 'React', 'Prisma', 'PostgreSQL', 'TypeScript'],
    description:
      'Marrowbrook Health helps clinics run their scheduling. The whole product is one Next.js application on the App Router, with Prisma over PostgreSQL and server actions doing most of the work. You will move freely between the React components a receptionist uses all day and the query that makes the calendar view load in under a second for a practice with forty providers.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 128000 },
  },
  {
    id: 'sableton-django-fullstack',
    title: 'Full-Stack Engineer, Django',
    companyName: 'Sableton Labs',
    location: 'Toronto, Canada',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: 'CAD 115,000 - 140,000',
    skills: ['Django', 'Python', 'PostgreSQL', 'React', 'Redis'],
    description:
      'Sableton Labs makes laboratory information management software for materials science groups. The backend is Django with PostgreSQL; the instrument dashboards are React. Our users are chemists, not software people, and the single most useful skill for this role is patience in a requirements conversation. Hybrid from Toronto, three days a week.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 85000 },
  },
  {
    id: 'solveig-graphql-api',
    title: 'Backend Engineer, GraphQL',
    companyName: 'Solveig Commerce',
    location: 'Remote (Europe)',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: 'EUR 80,000 - 100,000',
    skills: ['GraphQL', 'Apollo', 'Node.js', 'TypeScript', 'PostgreSQL'],
    description:
      'Solveig Commerce provides the catalogue and pricing API behind two hundred merchant storefronts. We run an Apollo federated graph across six subgraphs, and the hard problems are schema-evolution problems: how do you deprecate a field that four teams and thirty clients read? You will own the graph gateway, the persisted-query pipeline, and the performance budget that keeps a product page under 150ms.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 87000 },
  },
  {
    id: 'cobaltwren-ml-engineer',
    title: 'Machine Learning Engineer',
    companyName: 'Cobalt Wren AI',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$165,000 - $200,000',
    skills: ['Python', 'PyTorch', 'MLOps', 'Kubernetes', 'Model Serving'],
    description:
      'Cobalt Wren builds defect detection for high-volume manufacturing lines. You will train vision models in PyTorch and, more importantly, keep them serving reliably on the factory floor where the network is bad and a false negative is expensive. The role is about two-thirds production engineering and one-third modelling; we would rather hire someone who has shipped a model than someone who has only trained one.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 165000 },
  },
  {
    id: 'fernhollow-data-scientist',
    title: 'Data Scientist',
    companyName: 'Fernhollow Insurance',
    location: 'Chicago, Illinois',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: '$118,000 - $142,000',
    skills: ['Python', 'SQL', 'pandas', 'scikit-learn', 'Statistics'],
    description:
      'Fernhollow prices small-commercial insurance. You will work with actuaries on claim-frequency models, mostly in Python with pandas and scikit-learn against a large SQL warehouse. Explaining a model to a regulator is part of the job, so an interpretable model that survives review beats a marginally better one that does not. Hybrid from Chicago.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 118000 },
  },
  {
    id: 'pellucid-data-engineer',
    title: 'Senior Data Engineer',
    companyName: 'Pellucid Grid',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$150,000 - $178,000',
    skills: ['Spark', 'Airflow', 'Python', 'Snowflake', 'dbt'],
    description:
      'Pellucid Grid forecasts electricity demand for regional utilities. The pipeline moves meter readings from twelve million endpoints through Spark into Snowflake, orchestrated by Airflow, with dbt models on top. Late-arriving data is the recurring theme: a reading that shows up nine hours after the interval it describes must not quietly corrupt yesterday.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 150000 },
  },
  {
    id: 'tanglewick-analytics-engineer',
    title: 'Analytics Engineer',
    companyName: 'Tanglewick Foods',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: '$115,000 - $140,000',
    skills: ['dbt', 'SQL', 'Snowflake', 'Looker', 'Data Modelling'],
    description:
      'Tanglewick Foods ships to nine thousand grocery locations and nobody agrees on what "on-time delivery" means. You would own the dbt project that settles that argument: dimensional models in Snowflake, tested and documented, surfaced in Looker. This is a modelling and definitions job much more than a pipeline job, and the deliverable is a number the supply chain team will defend in a meeting.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 115000 },
  },
  {
    id: 'wrenfield-database-reliability',
    title: 'Database Reliability Engineer',
    companyName: 'Wrenfield Data',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Senior, 6+ years',
    salary: '$155,000 - $185,000',
    skills: ['PostgreSQL', 'Replication', 'Query Tuning', 'Linux', 'Patroni'],
    description:
      'Wrenfield runs managed PostgreSQL for regulated customers. You will spend your days on the things that only show up at scale: logical replication that falls behind during a bulk load, autovacuum that never quite catches up, a query plan that flips after a statistics refresh and takes production with it. Deep PostgreSQL internals knowledge is the whole job. Fully remote.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 155000 },
  },
  {
    id: 'vellichor-android',
    title: 'Android Engineer',
    companyName: 'Vellichor Mobility',
    location: 'Remote (Europe)',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: 'EUR 75,000 - 95,000',
    skills: ['Kotlin', 'Android', 'Jetpack Compose', 'Coroutines'],
    description:
      'Vellichor operates a bike-share network in nineteen European cities. The rider app is Kotlin and Jetpack Compose, and it has to unlock a bike in under three seconds over Bluetooth in an underground car park with no signal. Offline behaviour, battery use and cold-start time are the metrics we actually track.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 82000 },
  },
  {
    id: 'driftmoor-ios',
    title: 'Senior iOS Engineer',
    companyName: 'Driftmoor Fitness',
    location: 'New York, New York',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$150,000 - $175,000',
    skills: ['Swift', 'SwiftUI', 'iOS', 'HealthKit', 'Core Data'],
    description:
      'Driftmoor is a strength-training app used mostly mid-workout, one-handed, with sweaty fingers. You will own the SwiftUI client, the HealthKit integration and the offline Core Data store that keeps a session recoverable when the phone dies mid-set. Hybrid from our New York studio, three days a week.',
    facts: { remote: false, seniority: 'Senior', minSalaryUsd: 150000 },
  },
  {
    id: 'plumeria-product-designer',
    title: 'Senior Product Designer',
    companyName: 'Plumeria Studio',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$130,000 - $158,000',
    skills: ['Figma', 'Design Systems', 'Prototyping', 'User Research', 'Interaction Design'],
    description:
      'Plumeria Studio designs clinical software, where a badly labelled button is a patient-safety problem. You will own the design system across three products, run the component library in Figma alongside the engineers who implement it, and prototype interactions properly rather than describing them in a document. We expect you to sit in on user sessions, not read summaries of them.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 130000 },
  },
  {
    id: 'glasswing-ux-researcher',
    title: 'UX Researcher',
    companyName: 'Glasswing Interactive',
    location: 'Berlin, Germany',
    type: 'Full-time',
    experience: 'Mid-level, 4+ years',
    salary: 'EUR 70,000 - 88,000',
    skills: ['User Research', 'Usability Testing', 'Interviewing', 'Survey Design'],
    description:
      'Glasswing Interactive makes museum and exhibition software, so our users are visitors who will never read a manual and staff who were trained once. You will run generative and evaluative research in the field, in German and English, and bring findings back in a form the design team can act on this sprint rather than next year. Based in Berlin with regular travel to installations.',
    facts: { remote: false, seniority: 'Mid', minSalaryUsd: 76000 },
  },
  {
    id: 'ashgrove-qa-automation',
    title: 'QA Automation Engineer',
    companyName: 'Ashgrove Travel',
    location: 'Remote (Europe)',
    type: 'Full-time',
    experience: 'Mid-level, 3+ years',
    salary: 'EUR 62,000 - 80,000',
    skills: ['Playwright', 'TypeScript', 'Test Automation', 'CI', 'API Testing'],
    description:
      'Ashgrove Travel sells multi-leg itineraries, so our test matrix is genuinely enormous and mostly other people’s systems. You will build the Playwright suite that gates every deploy, keep it under twelve minutes, and — the part that matters — keep it trustworthy, because a flaky suite everyone re-runs is worse than no suite at all.',
    facts: { remote: true, seniority: 'Mid', minSalaryUsd: 68000 },
  },
  {
    id: 'serrafax-appsec',
    title: 'Application Security Engineer',
    companyName: 'Serrafax Bank',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$155,000 - $185,000',
    skills: ['Application Security', 'Threat Modelling', 'OWASP', 'SAST', 'Go'],
    description:
      'Serrafax is a digital-only bank and the regulator reads our incident reports. You will run threat modelling on new services before they are built, tune the SAST pipeline so engineers stop ignoring it, and personally review the authentication and payments code paths. Enough Go to write the fix and open the pull request yourself, rather than filing a finding and waiting.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 155000 },
  },
  {
    id: 'orrery-product-manager',
    title: 'Product Manager, Platform',
    companyName: 'Orrery Logistics',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Senior, 6+ years',
    salary: '$150,000 - $180,000',
    skills: ['Product Management', 'API Strategy', 'Roadmapping', 'Stakeholder Management'],
    description:
      'Orrery Logistics sells an API, so the product is the developer experience. You will own the platform roadmap, decide which integrations are worth building versus documenting, and say no to large customers with reasons they accept. Technical enough to read the OpenAPI spec and argue about resource design; not expected to write the implementation.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 150000 },
  },
  {
    id: 'quintessa-engineering-manager',
    title: 'Engineering Manager, Backend',
    companyName: 'Quintessa Health',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Lead, 8+ years',
    salary: '$175,000 - $205,000',
    skills: ['Engineering Management', 'Go', 'Distributed Systems', 'Coaching', 'Hiring'],
    description:
      'Quintessa Health processes clinical claims in real time. You would manage seven backend engineers across two teams, own the growth conversations and the hiring loop, and keep roughly one day a week hands-on in the Go services so your architectural opinions stay grounded. We are explicit that this is a management job, not a tech-lead job with a different title.',
    facts: { remote: true, seniority: 'Lead', minSalaryUsd: 175000 },
  },
  {
    id: 'hollowpine-junior-go',
    title: 'Junior Backend Engineer, Go',
    companyName: 'Hollowpine Games',
    location: 'Krakow, Poland',
    type: 'Full-time',
    experience: 'Junior, 1+ years',
    salary: 'PLN 140,000 - 190,000',
    skills: ['Go', 'PostgreSQL', 'Docker', 'REST APIs'],
    description:
      'Hollowpine runs the backend for two live multiplayer titles: matchmaking, inventory, and the leaderboards players argue about. This is a genuine first or second engineering job. You will be paired with a senior for your first six months, review is a teaching exercise rather than a gate, and nobody expects you to arrive already knowing Go. On-site in Krakow.',
    facts: { remote: false, seniority: 'Junior', minSalaryUsd: 38000 },
  },
  {
    id: 'umbercove-go-onsite',
    title: 'Backend Engineer, Go',
    companyName: 'Umbercove Freight',
    location: 'Singapore (on-site)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: 'SGD 132,000 - 162,000',
    skills: ['Go', 'PostgreSQL', 'gRPC', 'Kafka'],
    description:
      'Umbercove Freight handles customs clearance across South-East Asian ports. The services are Go with gRPC between them and PostgreSQL underneath, and correctness matters more than throughput: a wrongly filed declaration holds a container for a week. This role is on-site in Singapore five days a week because you will work directly with the operations floor.',
    facts: { remote: false, seniority: 'Senior', minSalaryUsd: 98000 },
  },
  {
    id: 'thistledown-rust-systems',
    title: 'Systems Engineer, Rust',
    companyName: 'Thistledown Compute',
    location: 'Remote (Global)',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: '$160,000 - $190,000',
    skills: ['Rust', 'Systems Programming', 'Linux', 'Performance', 'io_uring'],
    description:
      'Thistledown builds a storage engine for time-series workloads. The work is Rust, close to the kernel, with io_uring on the hot path and a lot of time spent reading perf output. If you enjoy arguing about cache lines and have opinions about allocator behaviour under fragmentation, this is the unusual job where that is the day job rather than a hobby.',
    facts: { remote: true, seniority: 'Senior', minSalaryUsd: 160000 },
  },
  {
    id: 'marlinspike-java',
    title: 'Backend Engineer, Java',
    companyName: 'Marlinspike Trading',
    location: 'Hong Kong',
    type: 'Full-time',
    experience: 'Senior, 5+ years',
    salary: 'HKD 900,000 - 1,150,000',
    skills: ['Java', 'Spring Boot', 'Kafka', 'Oracle', 'Low Latency'],
    description:
      'Marlinspike Trading runs order management for Asian equity desks. The platform is Java and Spring Boot with Kafka between services and Oracle behind them, and the latency budget is measured in single-digit milliseconds from receipt to acknowledgement. On-site in Hong Kong; the trading day is not a remote-friendly schedule.',
    facts: { remote: false, seniority: 'Senior', minSalaryUsd: 115000 },
  },
  {
    id: 'cressida-support-engineer',
    title: 'Technical Support Engineer',
    companyName: 'Cressida Software',
    location: 'Remote (United States)',
    type: 'Full-time',
    experience: 'Entry-level, 1+ years',
    salary: '$62,000 - $78,000',
    skills: ['Troubleshooting', 'SQL', 'Customer Support', 'Zendesk'],
    description:
      'Cressida Software sells scheduling software to hospitals, and when it breaks someone is standing at a nurses station waiting for us. You will work tickets, read logs, write the occasional SQL query against a read replica, and escalate with enough detail that engineering does not have to ask three questions first. This is a good route into engineering for someone who likes debugging.',
    facts: { remote: true, seniority: 'Entry', minSalaryUsd: 62000 },
  },
];
