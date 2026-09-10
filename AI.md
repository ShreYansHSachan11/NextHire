# AI in NextHire

NextHire uses Google Gemini for semantic matching between candidates and roles.
This document explains what the model does, where the data lives, and what
happens when it is switched off.

---

## 1. The rule that shapes everything

**Every AI feature is optional and fails soft.**

If `GEMINI_API_KEY` is unset — or the API is unreachable, slow, or returns
something unusable — the portal behaves exactly as it does without AI:

| Feature | With Gemini | Without |
| --- | --- | --- |
| Job feed | Ranked by match, `match` on each job | Ranked by date, `match: null` |
| Search | Semantic retrieval over embeddings | Keyword filtering on the client |
| Job detail | Match score + facet breakdown | No match panel |
| Recommendations | Top-scoring unapplied roles | Empty list with `reason: 'disabled'` |
| Applicant review | Ranked by fit | Ranked by date |
| Résumé parsing | Structured profile extracted | Manual profile entry |

Posting a job, applying, messaging and uploading a résumé **never block on and
never fail because of** a model call. Embedding writes go through the
fire-and-forget `queueJobEmbedding` / `queueProfileEmbedding` helpers precisely
so that a Gemini outage cannot take the product down.

---

## 2. Architecture

```
lib/ai/
├── config.ts       Model ids, dimensions, weights, isAiEnabled()
├── gemini.ts       SDK wrapper — embedTexts, generateJson, generateJsonFromDocument
├── vector.ts       normalize, cosineSimilarity, similarityToScore, tagOverlap
├── documents.ts    Text that gets embedded, plus contentHash for cache-skipping
├── embeddings.ts   Sync/queue/reindex — keeps vectors in step with the database
└── matching.ts     computeMatch, rankJobs, semanticJobSearch, rankApplicantsForJob
```

### Models

| Purpose | Model | Notes |
| --- | --- | --- |
| Embeddings | `gemini-embedding-001` | Supports asymmetric task types |
| Generation | `gemini-2.5-flash` | Résumé parsing, drafting help |

Both are overridable via `GEMINI_EMBEDDING_MODEL` / `GEMINI_TEXT_MODEL`.

### Why 768 dimensions

The model emits 3072 by default. We request 768, which cuts row size and the
cosine loop roughly fourfold for very little retrieval loss. Truncated vectors
come back un-normalised on the `-001` family, so `lib/ai/gemini.ts` normalises
every vector before storing it — without that, cosine similarity would be wrong.

### Why task types matter

Embedding a search query the same way you embed a document measurably hurts
retrieval. Documents are embedded with `RETRIEVAL_DOCUMENT` and live queries
with `RETRIEVAL_QUERY`. Newer models take that instruction inline instead, so
`SUPPORTS_TASK_TYPE` omits the parameter when the configured model is not in the
`-001` family rather than sending something the API will reject.

---

## 3. Storage

Vectors live in two tables, `JobEmbedding` and `ProfileEmbedding`:

```prisma
vector      Float[]   // Postgres double precision[]
model       String    // which model produced it
dimensions  Int
contentHash String    // fingerprint of the source text
```

**Why `Float[]` and not `pgvector`.** Similarity is computed in Node. For a
corpus in the low thousands that is a sub-millisecond loop, and it means the app
runs on any managed Postgres rather than only on tiers that offer the extension.

**Upgrade path.** Past roughly 50,000 active jobs, an exhaustive scan stops being
the right answer. At that point: enable `pgvector`, change the column to
`Unsupported("vector(768)")`, add an HNSW index, and replace the body of
`semanticJobSearch` with a raw `ORDER BY vector <=> $1 LIMIT n`. Nothing above
that function needs to change — that is why the scan is isolated there.

**`contentHash` is the cost control.** It fingerprints the exact document text
plus the model and dimensions. A re-index skips any row whose hash is unchanged,
so editing a job's salary band does not spend an embedding call unless the
salary is actually part of the embedded document.

---

## 4. What gets embedded

Documents are short labelled prose, not JSON. Embedding models are trained on
natural language, and `Role: Senior Backend Engineer. Key skills: Go, Postgres.`
retrieves noticeably better than `{"title":"...","skills":[...]}`.

**Jobs** (`buildJobDocument`): title, company, employment type, location,
experience, compensation, skills, then the full description.

**Profiles** (`buildProfileDocument`): headline, seniority, years of experience,
industry, location, skills, de-duplicated titles of roles applied to, then the
AI summary and any self-written profile text.

A profile with almost nothing in it embeds to noise and then matches everything
equally, which is worse than showing no match at all — `isDocumentUseful` blocks
that at 40 characters.

---

## 5. The match score

A bare cosine value is accurate but not explainable, and an unexplained "84%"
invites distrust. The headline figure is a weighted blend of four facets, and
every facet is returned alongside it so the UI can show the breakdown:

| Facet | Weight | What it measures |
| --- | --- | --- |
| Semantic | 0.70 | Whole profile against whole posting |
| Skills | 0.18 | Jaccard overlap of skill tags |
| Location | 0.07 | Compatibility; remote on either side matches |
| Seniority | 0.05 | Level asked for vs level held |

Two deliberate choices:

- **Missing data is neutral, not a penalty.** Most postings do not state a
  location precisely enough to punish anyone over, so an absent value scores 0.6
  rather than 0.
- **Over-qualification costs less than under-qualification**, which is how
  hiring actually works.

**Score rescaling.** Real-world embeddings of two loosely-related documents rarely
fall below ~0.35 cosine, and near-identical ones rarely exceed ~0.92. A straight
`cosine × 100` would compress every job into the 60–80 band and be useless for
ranking by eye, so `similarityToScore` rescales that working band onto 0–100.

`computeMatch` returns `null` — never a number — when there is no semantic
signal on either side. Better to show no match than one computed purely from a
location string.

---

## 6. Endpoints

| Route | Access | What it does |
| --- | --- | --- |
| `GET /api/jobs?q=` | Public | Semantic retrieval; falls back to keyword |
| `GET /api/jobs` | Seeker | Attaches `match` to each job; `?sort=match` |
| `GET /api/jobs/:id` | Seeker | Adds the facet breakdown for this role |
| `GET /api/jobs/recommended` | Seeker | Top unapplied roles by score |
| `GET /api/applications?rank=fit` | Company | Applicants ranked by fit |
| `POST /api/ai/resume` | Seeker | Résumé → structured profile |
| `POST /api/ai/assist` | Company | Draft a description / extract skills |
| `GET`/`POST` `/api/ai/reindex` | Admin | Index health / backfill |

Raw vectors are **never** serialised to a client. Every response path strips
them, and `embedding.vector` is only selected when it is about to be used.

---

## 7. Safety

- **Model output is untrusted input.** Everything generated is sanitised before
  it is stored: skills are capped in count and length, years clamped to 0–60,
  seniority accepted only from a fixed allowlist, free text run through
  `cleanText`.
- **Résumé parsing is grounded.** The system instruction tells the model to
  extract only what the document evidences and never to invent employers, titles
  or credentials.
- **Drafting help is constrained.** It may not invent salary, benefits, company
  names or legal claims, and may not ask for protected characteristics.
- **The user stays in control.** Every AI-extracted profile field is editable on
  the profile page; nothing the model produces is presented as unchallengeable.
- API keys, raw model errors and stack traces never reach the client.

---

## 8. Operating it

**First run**, after setting `GEMINI_API_KEY`:

```bash
npm run db:migrate       # adds the vector tables and profile fields
# then, signed in as an ADMIN user:
curl -X POST /api/ai/reindex -d '{"limit":500}'
```

`GET /api/ai/reindex` reports index health without spending any tokens:

```json
{ "enabled": true, "model": "gemini-embedding-001", "dimensions": 768,
  "jobs": { "total": 412, "indexed": 412 },
  "profiles": { "total": 1180, "indexed": 903 } }
```

Vectors then stay current on their own: posting or editing a job, updating a
profile, uploading a résumé and parsing a résumé each refresh the relevant row.

**Cost.** Embeddings are charged per input token and `contentHash` suppresses
no-op re-embeds, so steady-state cost tracks genuine edits rather than traffic.
Reads cost nothing — similarity runs locally against stored vectors. Only
semantic *search* embeds on the request path, one short query at a time.
