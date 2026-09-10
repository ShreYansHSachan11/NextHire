# NextHire — AI Roadmap

Where the intelligence in this portal is thin, and what would make it genuinely
useful. Written against the code as it stands, not as a generic wishlist: every
item below names the function or route it changes.

Read [`AI.md`](./AI.md) first — it describes what exists today. This document is
about what comes next.

---

## 0. Honest assessment of what we have

The foundation is sound: real embeddings, asymmetric task types, a `contentHash`
cost control, an explainable four-facet score, and a fail-soft rule that means
none of it can take the product down. Verified end-to-end against a live key.

But "it returns a number" and "the number is right" are different claims, and
today only the first is proven. The specific weaknesses:

| # | Weakness | Where | Consequence |
| --- | --- | --- | --- |
| 1 | Skills compared as exact strings | `tagOverlap`, `vector.ts` | `React` ≠ `ReactJS`, `Postgres` ≠ `PostgreSQL`, `JS` ≠ `JavaScript`. The skills facet is silently under-counting on nearly every real profile. |
| 2 | Retrieval is pure vector | `semanticJobSearch` | Embeddings are weak on rare literal tokens. Searching a company name, `K8s`, `SRE` or a specific framework version retrieves poorly — exactly the queries where the user knows what they want. |
| 3 | Every search embeds | `semanticJobSearch` | One Gemini call and ~300ms on the request path per keystroke-driven search. No cache, repeated queries pay twice. |
| 4 | Every search loads 2000 vectors | `semanticJobSearch` | 2000 × 768 floats out of Postgres per query — megabytes of transfer to do a millisecond of arithmetic. |
| 5 | Queries are treated as prose only | `semanticJobSearch` | "remote senior Go role above 120k" embeds the words `remote` and `120k` instead of *filtering* on them. |
| 6 | The 0.35/0.92 band is hard-coded | `similarityToScore` | Guessed constants, never checked against the actual score distribution of this corpus. |
| 7 | Long descriptions are truncated | `MAX_DOCUMENT_CHARS` | A 12k-character cut mid-document; everything after it is invisible to matching. |
| 8 | No measurement at all | — | Weights are `0.7 / 0.18 / 0.07 / 0.05` because they seemed sensible. Nobody can tell whether changing them helps or hurts. |
| 9 | Match scores freeze | `Application.matchScore` | Correct for the application record, but a seeker's feed score is recomputed from a vector that may be stale relative to their profile. |
| 10 | The score is never explained in words | `computeMatch` | Facets are shown as bars. "Why" is left to the user to infer. |

---

## Part I — Vertical: make what exists accurate

### V1. Skill intelligence *(highest impact per line of code)*

`tagOverlap` canonicalises case and punctuation, then requires an exact match.
Real skill data never lines up that cleanly.

Three layers, cheapest first:

1. **Alias table** — a curated map (`postgres|postgresql|psql` → `PostgreSQL`,
   `js|javascript` → `JavaScript`, `k8s|kubernetes` → `Kubernetes`). Static,
   free, catches the majority of misses.
2. **Normalised storage** — resolve to a canonical form on write, in
   `cleanTagList`, so both sides of every comparison are already canonical.
3. **Embedding fallback** — for tags that survive both layers unmatched, compare
   skill embeddings. `GraphQL` vs `Apollo` is a real partial match that no alias
   table will ever contain. Cache skill vectors; the vocabulary is small and
   almost static.

Also fixes the **missing skills** list, which currently over-reports: it tells a
candidate they lack `PostgreSQL` while their profile says `Postgres`.

### V2. Hybrid retrieval

Fuse lexical and vector rankings with Reciprocal Rank Fusion:

```
score(doc) = Σ 1 / (k + rank_i(doc))        k ≈ 60
```

Lexical side uses Postgres full-text (`tsvector`) — already available, no new
infrastructure. RRF needs no score calibration between the two systems, which is
what makes it the right choice over a weighted sum of incomparable numbers.

This is the single biggest retrieval-quality win available, because it fixes the
failure mode users notice most: typing something exact and not finding it.

### V3. Query understanding

Parse the query into structured filters plus a semantic remainder before
embedding. "remote senior go role above 120k" becomes
`{ remote: true, seniority: 'Senior', minSalary: 120000 }` + `"go"`.

Filters are applied as SQL predicates; only the remainder is embedded. Cheap
(one small structured-output call, cacheable by query string) and it turns a
fuzzy search into a precise one.

### V4. Rerank the top N

Retrieval optimises recall, ranking optimises precision. Take the top ~20 hits
and rerank them with a single structured-output call scoring each against the
query. Bounded cost, applied only to what the user will actually see.

### V5 + V6. Caching

- **Query vectors** — persist `queryHash → vector`. Popular searches stop
  costing anything.
- **Job vectors** — hold the active corpus in a process-level cache invalidated
  on write, instead of re-reading every row per search. Straightforward while
  the corpus is small; it is the same data the pgvector upgrade path eventually
  replaces.

### V7. Chunked embeddings

Embed long descriptions in overlapping sections and keep the max similarity
across chunks. A candidate whose match lies in the responsibilities section
buried at character 14,000 is currently invisible.

### V8. Calibrate the score band

Replace the guessed `0.35`/`0.92` with percentiles measured from the real score
distribution, recomputed periodically. The band should describe this corpus, not
a remembered rule of thumb.

### V9. Explain the match in words

One grounded sentence per match — "Strong overlap on Go and event-driven
systems; the role wants Kubernetes depth you have not listed." Generated only
from facts already in the breakdown, cached per `(user, job)` so it costs one
call per pair, ever.

### V10. Feedback loop

Record impressions, clicks and applications. Two uses: a mild ranking prior, and
— more importantly — the ground truth that makes V11 possible.

### V11. Evaluation harness *(unglamorous, and the reason the rest is trustworthy)*

A fixed set of query → expected-result pairs and a script reporting recall@k and
nDCG@k. Without it every weight change is a guess, and "we improved matching" is
an unfalsifiable claim. **This should land before the weights are ever tuned.**

### V12. Keep scores fresh

Recompute a stored `matchScore` when the profile or posting materially changes,
rather than letting the number drift away from what it claims to measure.

---

## Part II — Horizontal: new capability

Ordered by value-to-effort, best first.

### H1. Similar jobs — "more like this"
A vector neighbour lookup on the job page. Nearly free: the vectors exist, no
model call at all, pure arithmetic against the cache from V6.

### H2. Semantic talent search *(company side)*
The profile vectors already exist and are only ever read seeker-side. Let a
company describe who they want in prose and search candidates.
**Requires an explicit opt-in visibility flag on the profile** — indexing
someone for matching is not consent to appear in a recruiter's search results.

### H3. Résumé gap analysis
Against a target role: what is missing, what to emphasise, what to learn next.
Turns the match score from a verdict into advice, which is the difference
between a metric and a product.

### H4. Application tailoring
Draft a cover letter grounded strictly in the candidate's real profile.
**Must not invent experience** — the single largest misuse risk in this product,
and the reason the prompt has to be grounded and the output always editable.

### H5. Interview preparation
Likely questions from the JD plus the candidate's background, with notes on what
each is really probing.

### H6. Screening questions *(company side)*
Generate role-appropriate questions, optionally knockout. Structured answers,
scored consistently. Must never ask about protected characteristics — enforced
in the prompt *and* checked on the way out.

### H7. Inclusivity check on job descriptions
Flag exclusionary phrasing, unnecessary requirements, and jargon that narrows the
applicant pool, with concrete rewrites. Advisory, never blocking.

### H8. Pipeline summary
Summarise an applicant pool for a role: shape of the candidate set, common
strengths, notable gaps. Explicitly a **sorting aid, not a verdict** — the same
framing already used for applicant fit.

### H9. Job alerts on a saved semantic search
Save a query, match new postings against its vector as they arrive, notify.
Reuses the whole matching stack; the only new work is scheduling and delivery.

### H10. Duplicate and spam detection
Near-identical postings are a cosine comparison away. Protects feed quality and
costs nothing extra.

### H11. Salary intelligence
Infer a band from similar postings, with an honest sample size. Only worth
shipping once the corpus is large enough to not mislead — **do not ship this on
eight jobs.**

### H12. Conversation assist
Suggested replies in chat, drafted from the thread and the application context.

---

## Part III — What Phase 1 builds

Accuracy first, then the features that ride on it. Everything here respects the
existing rules: fail soft, never serialise a vector, treat model output as
untrusted, keep the user in control.

| Stream | Items | Why now |
| --- | --- | --- |
| A | V1 skill intelligence | Biggest accuracy win, self-contained |
| B | V2 hybrid + V3 query understanding + V5/V6 caching | Fixes the retrieval users judge us on |
| C | H1 similar jobs + H10 duplicates | Nearly free once the vector cache exists |
| D | H3 gap analysis + H4 tailoring + H5 interview prep | The seeker-side product |
| E | H6 screening + H7 inclusivity + H8 pipeline summary | The company-side product |
| F | H9 alerts + V9 explanations | Retention, and the score made legible |
| G | V11 evaluation harness | So we can prove any of the above worked |

Deferred deliberately: **H11 salary intelligence** (needs corpus size to be
honest), **H2 talent search** (needs the consent model designed first, not
bolted on), **V4 reranking** and **V7 chunking** (measure with G before adding
cost), **V10 feedback loop** (needs traffic to mean anything).

### Non-negotiables for every item

1. `isAiEnabled()` gates every entry point; absent key = today's behaviour.
2. No route serialises `embedding.vector`.
3. Model output is sanitised and length-capped before storage.
4. Nothing generated about a person is presented as fact or as a verdict.
5. No feature blocks posting, applying, messaging or uploading.
