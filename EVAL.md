# Retrieval evaluation harness

`npm run eval`

This is ROADMAP item **V11**. It exists so that "we improved matching" stops
being an unfalsifiable claim. It runs the real retrieval and matching code in
`lib/ai/**` against a fixed, hand-judged corpus and reports recall@k, nDCG@k,
the observed cosine distribution, and a per-query breakdown.

It needs no database. It needs `GEMINI_API_KEY` once; after that every run is
free.

**The first thing it did was contradict a claim in a commit message.** See
[What the baseline contradicts](#what-the-baseline-contradicts).

---

## Running it

```
npm run eval
```

which expands to

```
node --import ./scripts/eval/loader.mjs ./scripts/eval/run.ts
```

- **No new dependencies.** `devDependencies` has no `tsx`, no `ts-node`, no test
  runner, and the harness is not worth adding one for. Node ≥ 22.18 strips
  TypeScript types natively, so the `.ts` files execute directly.
  `scripts/eval/loader.mjs` closes the two gaps type-stripping leaves — the
  `@/*` path alias and extensionless relative imports — using
  `module.registerHooks`, which is synchronous and in-process.
- **No database.** `scripts/eval/loader.mjs` redirects the `@/lib/prisma`
  specifier to `scripts/eval/harness/prisma-double.ts`, an in-memory stand-in.
  The four AI modules load and run byte-for-byte unmodified; only what is
  underneath them changes.
- **`GEMINI_API_KEY`** is read from `.env` (or the environment). Every vector
  the run produces is written to `scripts/eval/.cache/`, which carries its own
  `.gitignore` containing `*` — nothing from it reaches the repository. A
  second run makes zero API calls, and the report says so under **RUN COST**.
  With no key and nothing cached the run exits with a one-paragraph explanation
  and status 1, not a stack trace.

Output goes to stdout and is also written to `scripts/eval/.cache/last-run.txt`
and `last-run.json` (both gitignored).

---

## What is measured

### The fixtures

- `scripts/eval/fixtures/postings.ts` — 32 invented postings. Nothing is
  scraped and no company is real. The composition is adversarial on purpose:
  the same skill spelled two ways in two different postings, rare literal tokens
  (`SRE`, `dbt`, `io_uring`) confined to one posting each, near-identical Go
  roles that differ only in remote/seniority/salary, and non-engineering roles
  for a designer query to land on.
- `scripts/eval/fixtures/queries.ts` — 21 queries with graded judgements
  (3 = this is the answer, 2 = clearly relevant, 1 = defensible, 0 = unlisted)
  plus `mustNotRank` lists, grouped into six categories so a change can be
  attributed rather than averaged away.

### The four rankers

All four are the product's own code. Two of them are `hybridJobSearch` running
in a degraded state it is designed to survive, produced by making one arm's data
source look empty — not by a re-implementation.

| ranker | what it is |
| --- | --- |
| `legacy` | `semanticJobSearch` — the pre-hybrid path, kept because the "hybrid improved relevance" claim is a claim *about* it |
| `vector` | `hybridJobSearch` with the lexical arm returning nothing |
| `lexical` | `hybridJobSearch` with no job vectors indexed |
| `hybrid` | `hybridJobSearch` with both arms |
| `match` | `rankJobs`/`computeMatch` — a different thing, see below |

The report's **RUN COST AND MODE** section prints the `mode` each call
reported, so a `hybrid` row that silently degraded to lexical cannot masquerade
as a measurement of hybrid retrieval.

### Also measured

- **Cosine distribution** — profile↔job, job↔job and query↔job, with
  percentiles, feeding the verdict on `similarityToScore`'s band (V8).
- **Match weight sensitivity** — nDCG@10 of the match ranking under five
  alternative `MATCH_WEIGHTS` vectors. This blends the facets `computeMatch`
  already reported; it is arithmetic on the product's output, not a second
  scorer. Facets are rounded to integers on the way out, so treat differences
  under about a point as noise.
- **Skill layers** — what `scoreSkillsSync` (alias table) and `scoreSkills`
  (embedding fallback) each contribute.
- **Query understanding** — `parseQuery`'s filters against the ones the fixtures
  say a structured query ought to produce.

---

## How to read the numbers

- **R@k** — share of the judged-relevant set inside the top k. Ungraded: a
  grade-1 counts the same as the answer. Recall alone can stay flat while every
  good result slides from position 1 to position 9.
- **nDCG@k** — ranking quality with exponential gain (`2^g − 1`), so burying a
  grade-3 under two grade-1s is visibly punished. **This is the number to watch.**
- **MRR** — 1/rank of the first grade-3 posting.
- **intr** — total `mustNotRank` postings that appeared in a top 5. Recall
  cannot express this, and a designer query surfacing a Go role is a real
  failure.
- **match** — a different question from the other rows. It ranks by
  `computeMatch` score, and the profile it scores against is derived from the
  query (see limits). Compare it with itself across runs, not with `hybrid`.

A per-query table follows the headline so a regression is diagnosable rather
than merely visible: it prints nDCG@10 per ranker and the rank each grade-3
posting actually landed at, `MISS` if it never appeared.

---

## Baseline — 11 September 2026

`gemini-embedding-001` @ 768d, 32 postings, 21 queries. Percentages.

```
ranker         R@1     R@3     R@5    R@10   nDCG@1   nDCG@3   nDCG@5  nDCG@10     MRR  intr
legacy        47.4    70.5    86.0    95.4     95.9     90.2     93.1     95.3    96.0     1
vector        47.4    72.4    81.7    89.1     95.9     90.5     91.5     93.2    96.2     0
lexical       19.4    21.8    21.8    21.8     40.1     33.7     33.4     33.4    40.5     0
hybrid        46.7    70.4    79.0    88.4     92.5     87.7     88.0     91.0    93.4     0
match         45.0    73.2    84.4    95.0     95.2     88.2     91.4     93.5    96.4     3
```

By category, nDCG@10:

```
category      n    legacy    vector   lexical    hybrid
synonym       4      87.9      85.0      13.1      78.0
literal       6      98.7      98.7      53.1      96.0
intent        4      93.2      93.4      17.8      93.4
structured    2      99.0      81.8       0.0      81.8
domain        4      97.7      98.7      41.6      98.7
nearMiss      1      95.5      91.7      91.7      91.7
```

Cosine distribution:

```
pairs                      n    min     p1     p5    p25    p50    p75    p95    p99    max
profile x job (doc)      672  0.612  0.621  0.633  0.652  0.667  0.689  0.736  0.775  0.804
job x job (doc)          496  0.651  0.677  0.696  0.724  0.745  0.765  0.799  0.820  0.878
query x job (query)      672  0.439  0.470  0.492  0.538  0.567  0.600  0.649  0.696  0.760
```

---

## What the baseline contradicts

### 1. Hybrid retrieval did not improve relevance on this corpus. It cost 4.3 nDCG points.

The commit-message claim — hybrid took a reference query from 71 to 100 — is a
single observed number. Measured across 21 judged queries, `hybrid` scores
**91.0 nDCG@10 against `legacy`'s 95.3**, and is behind on every k. One query
improving from 71 to 100 is consistent with this; it is simply not evidence
about the other twenty.

Three mechanisms account for the gap, and the report names each:

- **The trigram fallback injects noise at full weight.** `synonym-javascript`
  drops from 70.5 (`vector`) to 42.4 (`hybrid`). The full-text arm finds nothing
  for "JavaScript engineer" — `websearch_to_tsquery` ANDs the terms — so
  `trigramSearch` runs, and `similarity(title, 'JavaScript engineer')` returns
  *DevOps Engineer* (0.333), *Analytics Engineer* (0.300), *Android Engineer*
  (0.321) and, worst, *Backend Engineer, Java* (0.448). Four titles whose only
  connection to the query is the word "Engineer", entering RRF with exactly the
  weight the vector arm gets. A fallback that fires when the good arm is silent
  is a fallback that fires precisely when its own output is least checked.
- **The seniority filter is equality, not a floor.** See §2.
- **`companyName` and `skills` are not in the full-text index.**
  `JOB_TSVECTOR` covers title, location, type and description only.
  `"Tidalglass Systems"` matches zero postings lexically: the company name is
  not indexed, and "Systems" never appears in the prose. The vector arm carries
  that query alone.

`lexical` alone scores 33.4 nDCG@10, and scores a flat zero on **12 of 21
queries** — for most of those it returns no rows at all. On a 32-document corpus, requiring every query lexeme to be present is
extremely restrictive. That number will improve on a real corpus — see limits —
but the *shape* of the finding (multi-word natural-language queries get nothing
from the lexical arm) is a property of `websearch_to_tsquery`, not of corpus
size.

None of this says hybrid retrieval is a bad idea. It says the version that
shipped is a net regression on this corpus, that the trigram fallback needs a
lower RRF weight or a much higher threshold, and that the claim as written was
not supported by a measurement.

### 2. "Remote senior Go role above 120k" cannot return a Staff engineer.

`parseQuery` correctly extracts `{remote: true, seniority: 'Senior',
minSalary: 120000}`. `SENIORITY_SQL` then requires the title or experience to
match `%senior%`, `sr %` or `% sr%`. `tidalglass-realtime-staff` — remote,
$185k, "Staff, 8+ years", and a grade-3 answer to that query — matches none of
them and is filtered out before ranking. The fixture calls the field
`minSeniority` because a seniority filter is a floor in every user's head;
the implementation is an equality test. This is the whole of the
`structured` regression (99.0 → 81.8) and it is independent of anything the
harness approximates.

### 3. `parseQuery` has no location rule.

`structured-berlin` is reported as a MISMATCH: "jobs in Berlin" parses to no
filters and the whole string is handed to the embedding. Retrieval still gets
the right answer, so nothing looks broken — but the chip the UI would show, and
the corpus narrowing a user asking for Berlin expects, do not exist.

### 4. `semanticJobSearch`'s `minRelevance: 25` filters nothing.

Its band is 0.30/0.85, so relevance 25 is a cosine of **0.438**. The lowest
query↔job cosine in the entire corpus is 0.439. The default threshold excludes
zero postings out of 672 pairs.

---

## Verdict on the `0.35` / `0.92` band

**It is wrong, in a specific and measurable way: it is far too wide, and the
score it produces is nearly constant.**

`similarityToScore(cosine)` is applied in `blend()` to a profile↔job cosine —
both sides embedded as `RETRIEVAL_DOCUMENT`, so the relevant distribution is
document-to-document. Measured over 672 pairs:

- observed range **0.612 – 0.804**
- **0.0%** of pairs clamp at the floor; **0.0%** clamp at the ceiling
- the resulting 0–100 score spans **46 to 80**, median 56, **standard deviation
  5.6**

Two thirds of the scale is unreachable. A posting with nothing in common with
the profile — a UX researcher role against a Go backend profile — still scores
about 46, and the difference between an excellent match and an irrelevant one is
a couple of dozen points at the top of the range. The comment in `vector.ts`
worries that a raw `cosine * 100` "would compress every job into the 60–80
range"; the measurement says the current rescaling compresses it into 46–80
instead. The premise that loosely-related documents "rarely fall below about
0.35" is simply not true of `gemini-embedding-001` at 768 dimensions, where
unrelated prose documents sit around 0.6.

**Measured replacement for this corpus: floor `0.62`, ceiling `0.78`** (p1/p99).
Under that band the same 672 pairs spread across 0–100 with a median of 30 and a
standard deviation of **20.5** — a score that actually discriminates.

Two caveats before anyone edits `vector.ts`:

1. A 32-document synthetic corpus is not the production distribution. Treat
   0.62/0.78 as the right *method* and roughly the right *magnitude*, not as a
   constant to paste in. V8 asks for percentiles recomputed periodically from
   real data, and that is still the correct design.
2. Moving the floor up makes low scores much lower. Anything in the UI that
   assumes a match score is usually a comfortable-looking number will need to
   change with it.

Related, and out of scope: `DUPLICATE_THRESHOLD = 0.94`. The highest job↔job
cosine observed is **0.878**, between two genuinely different postings. Nothing
in this corpus could ever trip the near-duplicate detector, which suggests the
threshold has never fired in production either.

---

## Verdict on `MATCH_WEIGHTS`

`semantic 0.7 / skills 0.18 / location 0.07 / seniority 0.05` is **defensible
and slightly conservative**, but the measurement is weak evidence — read the
limits.

```
weights                      nDCG@10    nDCG@5       MRR
shipped 70/18/7/5               93.5      91.8      96.4
semantic only                   92.2      89.4      92.5
skills-heavy 50/40/5/5          93.4      90.9      96.4
60/30/5/5                       93.4      91.7      96.4
80/15/3/2                       92.9      91.1      94.0
no location/seniority           93.7      91.9      96.4
```

The blend beats pure semantic similarity by 1.3 points, which is the one clear
result: the skills facet earns its weight. Everything between 18% and 40% skills
is within noise of everything else, so there is no evidence that 0.18 is
*better* than 0.30 — only that it is not worse. The `location` and `seniority`
facets contribute nothing measurable here and dropping them is, if anything,
marginally better; that is expected, because the synthetic profiles carry a
location only for one query and the facets fall back to their neutral 0.6
everywhere else. **Do not read this table as permission to delete them.**

---

## Limits — read this before quoting any number above

- **This is a smoke test for ranking quality, not proof of production
  performance.** Thirty-two documents and twenty-one queries. Absolute values
  are high because the corpus is small: with 32 candidates, a mediocre ranker
  still puts a relevant posting near the top by luck. **Differences between
  rankers on the same fixtures are the signal. The absolute numbers are not.**
- **The judgements are one person's opinion**, written against the *intent* of
  each query. When a change makes the numbers worse, the first question is
  whether the change is wrong and the second is whether a judgement is wrong —
  both are legitimate, but editing a judgement to make a run look better is how
  a harness stops meaning anything. A judgement change belongs in its own commit
  with its own reason.
- **The Postgres text primitives are approximated.**
  `scripts/eval/harness/pg-text.ts` re-creates `to_tsvector`,
  `websearch_to_tsquery` and `ts_rank` in TypeScript because the harness must
  run without a database. The stemmer is a reduced Porter rather than Snowball,
  and `tsRank` is a monotone relevance proxy rather than Postgres's density
  formula. RRF fuses *positions*, so the proxy only has to get the order roughly
  right — but it does not always. One baseline number is visibly affected:
  `literal-dbt` (83.4 vs 100) is a rank *tie* between the two `dbt` postings
  that the proxy cannot break and real `ts_rank` probably would. Treat
  small lexical-arm differences as approximate; treat "the lexical arm returned
  nothing at all" as real, because that is AND semantics, not ranking.
  `pg_trgm`'s `similarity()` is the exception — it is reproduced exactly, so the
  trigram-noise finding stands on its own.
- **The `match` row scores query-derived profiles.** The judgements are
  retrieval judgements; `computeMatch` scores a profile against a posting.
  Rather than invent a second judgement set, each query is turned into the
  minimal profile consistent with it, using the product's own `parseQuery` and
  `canonicalSkill` to read seniority and skills out of the words. A real profile
  is a résumé; this is one sentence. It is enough to compare weight vectors
  against each other and not enough to claim a match-score accuracy.
- **Consequence of the above: the embedding layer of the skill matcher is never
  exercised.** The report shows 0 pairs lifted by layer 3, and the reason is a
  property of the fixtures, not of the matcher: a query-derived profile's skills
  are a subset of the posting's, `scoreSkills` finds nothing unmatched on the
  profile side, and returns early. Measuring layer 3 honestly needs profile
  fixtures with skills the postings do *not* name.
- **The Prisma double interprets the SQL the product generates**, by masking
  quoted strings and parenthesised groups and then recognising each top-level
  conjunct. Anything it does not recognise **throws**, with the offending
  fragment. That is deliberate: if `filterPredicates` in `lib/ai/search.ts`
  changes shape, the harness must fail loudly rather than quietly measure a
  query it mis-executed. If you change search SQL and the harness stops, teach
  `prisma-double.ts` the new predicate — do not relax the check.
- **One embedding call per query per run is unavoidable for the `legacy`
  ranker.** `semanticJobSearch` calls `embedText` directly and predates the
  query-vector cache, so it cannot be served from disk. That is a property of
  the product. Every other embedding in the run is cached.

---

## Layout

```
scripts/eval/
  run.ts                    entry point; loads .env, then the harness
  loader.mjs                @/* alias, extensionless imports, @/lib/prisma redirect
  fixtures/postings.ts      32 synthetic postings
  fixtures/queries.ts       21 queries with graded judgements
  harness/run-eval.ts       the run and the report
  harness/prisma-double.ts  in-memory Prisma stand-in; interprets the real SQL
  harness/pg-text.ts        to_tsvector / websearch_to_tsquery / ts_rank / pg_trgm
  harness/embed-cache.ts    file-backed vector cache; clear failure with no key
  harness/metrics.ts        recall, nDCG, MRR, intrusions, percentiles
  .cache/                   gitignored: vectors, last-run.txt, last-run.json
```

Adding a query means adding it to `fixtures/queries.ts` with its judgements and
its category. Adding a posting means appending to `fixtures/postings.ts` — add
ids, never renumber them, because judgements reference them by name.
