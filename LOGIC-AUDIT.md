# NextHire — Logic & Consistency Audit

A read-only correctness sweep of the codebase as it stands, run after the large
parallel-agent landing. Nothing in this pass was edited; this file is the only
artefact.

The brief was **seams** — individually correct pieces that disagree with each
other — so that is what this hunts. Findings already fixed and recorded in
[`AUDIT.md`](./AUDIT.md) are not repeated, and the deficiencies
[`EVAL.md`](./EVAL.md) already measures and documents (the `0.35`/`0.92` band,
the hybrid regression, `minRelevance: 25`, `SENIORITY_SQL` equality,
`parseQuery`'s missing location rule, `DUPLICATE_THRESHOLD`) are out of scope as
known.

**Severity**

| | Meaning |
| --- | --- |
| 🔴 **Broken** | A user-visible feature does not work, or data is destroyed. |
| 🟠 **Wrong** | The feature runs but produces an incorrect value or outcome. |
| 🟡 **Inconsistent** | The same concept behaves two ways in two places. |
| 🔵 **Cosmetic** | Visible drift with no functional consequence. |
| ⚪ **Informational** | Checked, understood, and deliberately not filed as a bug. |

**Counts** — 🔴 7 · 🟠 15 · 🟡 14 · 🔵 6 · ⚪ 15

Every entry states whether it was **verified** (traced end to end, executed, or
probed against the running server) or **read** (inspected but not exercised).

---

## 🔴 Broken

### B1. The company profile editor renders blank after a reload — and saving then wipes five stored columns

**`app/company/profile/edit/page.tsx:122-135`** (seeding) and **`:207-209`**
(payload), against **`app/api/users/[id]/route.ts:126-135`** (unconditional
write).

The form seeds entirely from the Redux `user` object:

```ts
profile: user.profile ?? "",
website: user.website ?? "",
industry: user.industry ?? "",
size: user.size ?? "",
location: user.location ?? "",
description: user.description ?? "",
```

Nothing ever puts those six keys into Redux on a cold load. `AuthRehydrator`
(`store/AuthRehydrator.tsx:36-48`) reads the JWT, and `signToken`
(`lib/auth.ts:21-31`) only carries `id`, `email`, `name`, `role`, `companyId`,
`companyName`. `respondWithSession` (`app/api/auth/route.ts:137-146`) returns the
same six on login. The only writer of the rest is the `dispatch(updateProfile(…))`
at `app/company/profile/edit/page.tsx:217` — i.e. they exist in the store only
*after* a save, only for the life of that SPA session. This page never fetches
`/api/users/:id`.

On submit it sends the **whole** `formData`, and the route writes those columns
unconditionally — `profile`, `website`, `industry`, `size`, `location` and
`description` are outside the `'field' in body` presence gate that protects
`headline` / `skills` / `seniority` / `yearsOfExp` a few lines below.
`cleanString("")` returns `null`, so an empty string is a delete.

**Failure scenario.** An employer fills in their whole company profile — website
`https://acme.com`, industry Technology, size 51-200, location Berlin, a long
description and a profile blurb — and saves. It stores correctly. They close the
tab. Next morning they sign in and open *Company profile → Edit*. Every field
except Name and Email is **empty**; it reads as though they had never filled it
in. They fix a typo in the company name and press **Save changes**. The request
carries `website: "", industry: "", size: "", location: "", description: "",
profile: ""`, the route nulls all six, and the page reports *"Company profile
updated"*. The job cards that showed the company blurb now show nothing.

The sibling page got this right and says why —
`app/seeker/profile/edit/page.tsx:66-75`: *"Seeding matters more than it looks:
the four fields are sent on every save, so a form that never learned the stored
values would wipe them the first time someone edited their name."* It fetches
`/api/users/:id` at `:159` and gates the block on `signalLoaded`. The fix landed
on one of the two editors.

**Fix.** Fetch `/api/users/${user.id}` on mount and seed from the response, the
way the seeker editor does; hold a `loaded` flag and refuse to submit before it
resolves. Belt and braces: presence-gate `profile`/`website`/`industry`/`size`/
`location`/`description` in `PUT /api/users/[id]` so an uninformed caller cannot
clear them either.

**Confidence: high. Verified** — every writer of those Redux keys was enumerated
by grep; there are only the two `updateProfile` dispatches and the two `login`
dispatches, and none of the four supplies them on a cold load.

---

### B2. Screening questions are write-only: applicants never see them, and no answer can ever be stored

**`app/api/applications/route.ts:169-216`** (the apply handler),
**`app/jobs/[jobId]/page.tsx:148-166`** (the apply call),
**`prisma/schema.prisma`** (`JobQuestion`, `ApplicationAnswer`).

Both authoring surfaces are complete and polished — `app/jobs/post/page.tsx`
section 03 and `app/jobs/[jobId]/edit/page.tsx` section 03, with AI suggestion,
keyboard reordering, knockout config, and confirm dialogs that warn *"Any answers
applicants have already given to it are deleted with it."* `GET /api/jobs/:id/questions`
is deliberately public, with a comment at `app/api/jobs/[jobId]/questions/route.ts:15-24`
explaining that *"the applicant has to read the questions before they can answer
them."*

Nothing on the applicant side calls it. `app/jobs/[jobId]/page.tsx` fetches
exactly three things — `/api/jobs/:id`, `/api/jobs/:id/similar`, and `POST
/api/applications` — and the apply body is `{ jobId, message }`. `POST
/api/applications` never reads `body.answers` and never touches
`prisma.applicationAnswer`. A grep for `applicationAnswer` across `app/`, `lib/`
and `scripts/` returns **zero** read paths and **zero** write paths.

**Failure scenario.** A company adds *"Do you hold a valid work permit?"*,
`required: true`, `knockout: true`, `expected: "Yes"`. The editor confirms it
saved. A seeker opens the posting: no questions are rendered anywhere on the page.
They click Apply and the application is created. The company opens
`/applications` and there is nowhere the answers appear — because none exist. The
`ApplicationAnswer` table stays empty forever, `required` is enforced nowhere,
and no knockout is ever evaluated. Both post-a-job and edit-a-job tell the
employer *"Applicants answer these when they apply, and you see the answers on the
application"* — a claim the product does not keep.

The schema's promise that knockout is *"advisory in the UI: it flags an
applicant, it does not silently discard them"* is satisfied only in the sense
that nothing discards anyone, because nothing evaluates anything. Nothing flags
anyone either.

**Fix.** Render the questions on the apply page from the public GET; post
`answers` alongside the application; write them inside a `$transaction` with
`application.create` (an application whose required answers failed to persist is
a half-written record the company cannot triage); validate `required` and
`kind`/`options` conformance server-side; surface the answers and the knockout
flags on `app/applications/page.tsx`.

**Confidence: high. Verified** — exhaustive grep plus reading the apply path end
to end. Probed the live server: `GET /api/jobs/<id>/questions` answers
`{"questions":[],"isOwner":false}`, so the endpoint is healthy and simply has no
consumer.

---

### B3. Deleting a job orphans live conversations out of the company inbox — the seeker can still write into them

**`app/api/conversations/route.ts:63-126`** (company inbox assembly) against
**`app/api/jobs/[jobId]/route.ts:238-241`** (delete).

The company inbox is built by iterating **applications** and attaching the
matching conversation, not by listing conversations:

```ts
for (const application of applications) {
  …
  const conversation = conversationsByUser.get(application.userId) ?? null;
  rows.push({ application, conversation, … });
}
```

A conversation whose applicant has no surviving application produces **no row**.
Deleting a job deletes its applications (`prisma.application.deleteMany({ where:
{ jobId } })`), but `Conversation` hangs off `companyId`, not off the job, so it
survives.

**Failure scenario.** A company has one open role and is mid-conversation with a
candidate. The role is filled, so they delete the posting from the dashboard —
the confirm correctly warns that the applications go with it. The candidate's
message thread, with its whole history, now **disappears from `/conversations`
entirely**. The candidate still sees it (their list is keyed on `userId`) and can
still send: the membership check in `POST /api/messages:145-148` is
company-scoped and passes. The company gets a bell notification *"New message
from …"* linking to `/conversations`, where the thread does not exist. They can
neither read nor reply, and those messages stay permanently unread.

**Fix.** Build the company inbox from `conversation.findMany({ where: { companyId } })`,
unioned with the application-derived rows for applicants who have no thread yet,
rather than from applications alone.

**Confidence: high. Verified** by reading both routes against the schema.

---

### B4. Real-time messaging only covers the thread you already have open; nothing else in either inbox ever updates

**`lib/socketContext.tsx:99-115`** (joins only what `joinConversation` was called
with), **`socket-server.js:95`** (`io.to(conversationId)`),
**`app/conversations/page.tsx:242-246`** and
**`app/seeker/conversations/page.tsx:243-247`** (each joins only the selected
thread).

A client is never in any room but the open one, so it never receives
`new-message` for any other thread. The "not the open thread" branches at
`app/conversations/page.tsx:260-273` and `app/seeker/conversations/page.tsx:265-277`
are therefore unreachable. Neither page polls — `setInterval` appears in neither
file — and the comment at `app/api/messages/route.ts:31-33` claiming the client
refetches anyway is not true of these two pages.

**Failure scenario.** A recruiter sits on Messages with Alice's thread open. Bob
sends a message. No badge, no preview change, no reordering — indefinitely, while
the page shows a green *"Socket live"* pill. Within 30s the `NotificationBell`
poll surfaces it; clicking it calls `router.push("/conversations")`
(`app/components/NotificationBell.tsx:141`), which, when already on that URL,
does not remount the page — so **clicking the notification appears to do
nothing**. Only a hard refresh reveals Bob's message.

A second face of the same gap: messages that arrive while the socket is down are
never backfilled. The history effect is keyed on the selection only — correct, and
the comments at `app/conversations/page.tsx:217-218` explain why a reconnect must
not blank the thread — but nothing refetches after `connect` fires. Sleep the
laptop for two minutes with a thread open and the pill returns to "Socket live"
while the three messages sent during the gap stay absent.

**Fix.** After the conversation list loads, join every room the user belongs to,
not just the selected one. Refetch the open thread on the socket's second and
subsequent `connect` events (`mergeMessages` is already idempotent). Fall back to
a 20-30s refetch of `/api/conversations` while the tab is visible, which also
covers the deployment where `NEXT_PUBLIC_SOCKET_URL` is unset and `isEnabled` is
`false` — a state neither page currently surfaces.

**Confidence: high. Verified** by tracing the join path through
`socketContext.tsx` and `socket-server.js`.

---

### B5. An over-cap alert search reports "call again" but cannot be re-picked for a day; the backlog then becomes permanent loss

**`app/api/alerts/run/route.ts:236-248`** (due gate), **`:407-417`** (write),
**`:450`** (`more`).

Every committed search gets `lastRunAt: now` unconditionally — including one that
stopped at `MAX_NOTIFICATIONS_PER_SEARCH = 5` and reported `drained: false`. The
due gate then requires `lastRunAt <= now - 23h` for DAILY. So the response's
`/** True when at least one search still has window left — call again. */` is a
no-op for exactly those searches: calling again immediately re-runs the
`findMany` and the undrained search is filtered straight back out.

**Failure scenario.** A saved search matches roughly ten new postings a day.
Day 1 notifies 5 and lands the watermark on the fifth posting. Day 2's window
holds the 5 leftovers plus 10 new; it notifies 5. The watermark falls half a day
further behind every day. After about 28 days `lastNotifiedAt` drops below
`floor` (`MAX_LOOKBACK_DAYS = 14`, line 281), `since` snaps forward to `floor`,
and **every posting between the watermark and the floor is dropped silently and
permanently**. There is no log and no counter: `outcomes` just keeps saying
`drained: false`, and the user's alert quietly stops being complete.

**Fix.** When `!drained`, do not advance `lastRunAt` — leave it at its prior
value so an immediate second call resumes the same search. The watermark has
already advanced, so there is no duplicate risk. Alternatively gate on
`lastNotifiedAt >= windowEnd` rather than on `lastRunAt`.

**Confidence: high. Verified** by reading the gate and the write together; no
comment anywhere reconciles them.

---

### B6. `SkillVector` can never be repopulated after a model or dimension change — the read filter and the write block each other

**`lib/ai/skills.ts:574-577`** (read) and **`:621-625`** (write), against
**`prisma/schema.prisma`** (`model SkillVector { tag String @id … }`).

The read is correct and says why:

```ts
// Filtering on model and dimensions matters: a vector produced by a different
// model is not comparable with a fresh one …
where: { tag: { in: misses }, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS }
```

The write is `createMany({ data: fresh, skipDuplicates: true })`, and the primary
key is `tag` **alone** — `model` and `dimensions` are ordinary columns. The two
halves deadlock: an old-model row for `tag = 'postgresql'` is invisible to the
read *and* blocks the insert, forever.

**Failure scenario.** The deployment moves to a newer `GEMINI_EMBEDDING_MODEL`.
An admin runs `POST /api/ai/reindex`, which correctly re-embeds every job and
profile because their `contentHash` includes the model. `SkillVector` is not
touched by reindex. From then on every `scoreSkills` call for a previously-seen
tag misses the DB cache, spends a live embedding call, caches it in the
in-process `memo` (`skills.ts:530`) — and then silently fails to persist. Every
new serverless instance and every dev-server restart re-pays that call, on the
request path of the job detail page and of `POST /api/applications`, permanently.
Nothing logs and nothing errors; the row count simply never grows.

**Fix.** Change the key to `@@id([tag, model, dimensions])`, which makes
`skipDuplicates` mean what the comment at `:622-623` intends (two requests racing
on the same new skill) and lets a rollback to the previous model reuse its rows.
An upsert keyed on the same three columns the read filters on is the smaller
alternative.

**Confidence: high. Verified** by reading both halves against the schema.

---

### B7. On the job **edit** page, pasting a skills list is clipped to 40 characters — the fix landed only on the **post** page

**`app/jobs/[jobId]/edit/page.tsx:1482`** against
**`app/jobs/post/page.tsx:1385-1398`**.

The post page carries the fix and documents it in full:

```ts
// This used to be `MAX_SKILL_LENGTH`, which the browser applies to the paste
// itself — so pasting "React, TypeScript, Node.js, PostgreSQL, Kubernetes" was
// silently clipped to 40 characters before `onChange` ever saw a comma to split
// on, and most of the list was lost.
maxLength={MAX_SKILL_LENGTH * MAX_SKILLS}
```

The edit page's identical input still reads `maxLength={MAX_SKILL_LENGTH}`.

**Failure scenario.** An employer opens an existing posting to add its tech
stack, copies `React, TypeScript, Node.js, PostgreSQL, Kubernetes` (50
characters) from the job description and pastes it into the Skills box. The
browser truncates the paste at 40 characters, so `onChange` receives
`React, TypeScript, Node.js, PostgreSQL, ` — four tags land, **Kubernetes is
gone**, and nothing says so. The same paste on the post-a-job page works
correctly.

**Fix.** `maxLength={MAX_SKILL_LENGTH * MAX_SKILLS}`, matching
`app/jobs/post/page.tsx`. Each tag is still cut to `MAX_SKILL_LENGTH` by
`cleanTagList` when it is committed, which is the same code the API runs.

**Confidence: high. Verified** by direct comparison of the two inputs.

---

## 🟠 Wrong

### W1. The same profile and the same posting score two different numbers under the same label

**`lib/ai/matching.ts:200-206`** (`computeMatch` → `scoreSkillsSync`) vs
**`:219-225`** (`computeMatchAsync` → `scoreSkills`).

Sync callers: `app/api/jobs/route.ts:592` (the feed, via `rankJobs`),
`app/api/jobs/recommended/route.ts:85`, `app/api/applications/route.ts:146` (via
`rankApplicantsForJob`), `lib/ai/explain.ts:198`, `app/api/ai/coach/route.ts:573`.
Async callers: `app/api/jobs/[jobId]/route.ts:90` (the detail page),
`app/api/applications/route.ts:227` (the frozen `Application.matchScore`).

Measured, not hypothesised — profile skills `['Apollo']`, job skills
`['GraphQL']`:

```
scoreSkillsSync -> { score: 0,    missing: ['GraphQL'] }
scoreSkills     -> { score: 0.75, fuzzy: 1 }
```

At `MATCH_WEIGHTS.skills = 0.18` that is a **13.5-point composite difference**.

**Failure scenario (seeker).** A seeker whose profile lists `Apollo` browses
`/jobs`. A posting listing `GraphQL` shows **62** under the caption *"Profile
fit"* (`app/jobs/page.tsx:1137`). They click it. The detail page shows **76**
(`app/jobs/[jobId]/page.tsx:509`) and the missing-skills list no longer names
GraphQL. Same profile, same posting, same second, two numbers under two
identical labels.

**Failure scenario (company).** `POST /api/applications:227` freezes
`matchScore` from the **async** path, while `GET /api/applications?rank=fit`
scores live from the **sync** path. `app/applications/page.tsx:928` shows the
live score as *"ROLE FIT"* and `:937` falls back to the stored one as *"FIT AT
APPLY"*; `app/seeker/dashboard/page.tsx:1259` shows the stored one to the
candidate. With nothing whatever having changed, the seeker's own dashboard says
76 and the reviewer's queue says 62 — and a reviewer reasonably concludes the
candidate got worse. The switch is user-triggered and immediate:
`app/applications/page.tsx:203-218` only sends `rank=fit&jobId=` while the sort
is "fit", so **changing the sort order changes the number on the card** — pick
"Best fit" with a role selected and a card reading *FIT AT APPLY 76* becomes
*ROLE FIT 62*; switch back and it returns to 76. Worse, the sort at
`app/api/applications/route.ts:159` mixes both scales in one comparator
(`b.match?.score ?? b.matchScore ?? -1`), so the pipeline ordering is partly
sync-scaled and partly async-scaled.

Note that the comment at `app/api/applications/route.ts:225-226` — *"The same
skill matcher the job detail page used, so the score frozen here is the one the
candidate was shown when they applied"* — is true of the detail page and false of
the feed the candidate browsed to reach it.

**Fix.** Choose one matcher per *user-visible number*, not per call site. The
cheap correct move: give `rankApplicantsForJob` the async path (one posting, and
`loadSkillVectors` memoises per process, so the marginal cost after the first
applicant is near zero), and either resolve the fuzzy-pair map once for the
feed's union of job skills before `rankJobs`, or label the feed figure explicitly
as an approximation distinct from the detail figure. The comment at
`matching.ts:192-198` defending a synchronous feed ranking is sound on its own
terms; what is not sound is two paths under one label.

**Confidence: high. Verified** by executing both matchers through the eval loader
and by tracing every call site.

---

### W2. Renaming a company leaves every one of its job vectors embedding the old name

**`lib/ai/documents.ts:30`** (`Company: ${job.companyName}.` is line 2 of every
job document) against **`app/api/users/[id]/route.ts:163`** and
**`app/api/companies/route.ts:112-116`**.

Both rename paths update `Company.name` and neither enqueues a re-embed for that
company's postings. The hash *does* change, so a reindex would fix it — nothing
triggers one.

**Failure scenario.** "Acme" rebrands to "Tidalglass Systems" through the company
profile editor. All forty of its postings keep vectors containing `Company:
Acme.` A seeker searches *"Tidalglass Systems"*. The lexical arm returns nothing,
because `JOB_TSVECTOR` (`lib/ai/search.ts:662-666`) covers title, location, type
and description but not `companyName` — which `EVAL.md` §2.3 already documents. So
the vector arm is the only arm carrying that query, and it is carrying the wrong
company name. The search returns nothing useful, indefinitely, with no error
anywhere.

**Fix.** On both rename paths, enqueue a re-embed for the company's active jobs —
a `reindexCompany(companyId)` helper in `embeddings.ts` that batches through
`embedTexts`, since a rename is exactly the bulk case. Alternatively drop
`companyName` from the embedded document and add it to `JOB_TSVECTOR`, which
fixes this *and* the EVAL.md finding.

**Confidence: high. Verified** by tracing both paths and confirming the two
documents hash differently.

---

### W3. Applying to a job never refreshes the profile vector, so "Roles of interest" is dead weight

**`lib/ai/documents.ts:65-70`** and **`lib/ai/embeddings.ts:127-131`** against
**`app/api/applications/route.ts:208`** (create) and **`:394`** (withdraw).

`buildProfileDocument` includes the twelve most recent applied titles, commented
as *"a strong signal of intent"*, and `AI.md` §4 lists it as part of the profile
document. Neither the create nor the delete path imports or calls
`queueProfileEmbedding` — a grep of the whole tree shows it called only from
`app/api/resumes/route.ts:206` and `app/api/users/[id]/route.ts:174`.

**Failure scenario.** A seeker signs up, writes a profile, and is embedded. They
apply to six *Platform Engineer* roles. The document would now emit `Roles of
interest: Platform Engineer, …` and the hash would differ — but nothing re-embeds,
so their vector never moves and `/api/jobs/recommended` keeps offering the same
generic set. The signal only ever lands by accident, the next time they happen to
save their profile or upload a résumé. `AI.md`'s claim that *"vectors then stay
current on their own"* is false for this field.

**Fix.** `queueProfileEmbedding(session.id)` after the create and after the
delete. It is already fire-and-forget and `contentHash` suppresses the no-op
case, so applications that do not change the top-twelve window cost one hash
comparison.

**Confidence: high. Verified** by grep and by reading `buildProfileDocument`.

---

### W4. `cosineSimilarity` truncates rather than guards, and the index-health endpoint reports a clean bill on a stale index

**`lib/ai/vector.ts:33-37`**:

```ts
// Guard against a dimension change between when two rows were embedded —
// comparing across widths would silently produce nonsense.
const length = Math.min(a.length, b.length);
```

That does not guard; it truncates to the shorter vector and then renormalises over
the prefix. Executed:

```
cosineSimilarity([1,0,0,0], [1,0,0,0,5,5,5,5]) = 1
similarityToScore(1)                            = 100
```

A width mismatch produces a **perfect 100% match** — the loudest possible wrong
answer, delivered in the quietest possible way. Every read site that could check
and does not: `lib/ai/matching.ts:154` and `:330-334`, `lib/ai/cache.ts:199-206`
(`getActiveJobVectors` selects only `jobId, vector`), `lib/ai/similar.ts:92-106`
and `:267-275`. `QueryVector` and `SkillVector` both check; the two big tables do
not, even though `model` and `dimensions` are stored on every row.

**Failure scenario.** An operator sets `GEMINI_EMBEDDING_MODEL` to a successor
model and redeploys. `GET /api/ai/reindex` counts rows unconditionally
(`app/api/ai/reindex/route.ts:36-40`) and reports `jobs: { total: 412, indexed:
412 }` — exactly the clean bill `AI.md` §8 advertises — so nobody runs the
backfill. Every feed score is then a cosine between a new-model profile vector
and an old-model job vector: at equal width, a plausible-looking number computed
across two unrelated latent spaces; at unequal width, a prefix comparison that
can read 100.

**Fix.** Make health count *current-model* rows
(`where: { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS }`) and report
`stale` alongside `indexed`, so the operator sees `indexed: 0, stale: 412`. Then
either return `0` from `cosineSimilarity` on a length mismatch and correct the
comment, or have the read paths select `dimensions` and skip mismatched rows.

**Confidence: high on the mechanism (verified by execution); medium on
frequency**, which requires an operator to change the model.

---

### W5. `POST /api/ai/resume` erases a headline and seniority the user typed by hand

**`app/api/ai/resume/route.ts:244-247`** against the deliberately opposite policy
at **`app/api/users/[id]/route.ts:138-144`**.

The résumé route writes unconditionally:

```ts
data: { headline, skills, seniority, yearsOfExp, aiSummary: summary, aiUpdatedAt }
```

where each value is `null` when the cleaner rejected the model's output. The 422
guard at `:232` only fires when headline, summary **and** skills are *all* empty.
The sibling route does the opposite, and says why: *"an absent key must not wipe
what `/api/ai/resume` extracted from the seeker's CV."*

So two paths write the same four columns with opposite policies, and the one
*protecting* the data is protecting it from the user while the one *wiping* it is
the model.

**Failure scenario.** A seeker types `Staff Backend Engineer, payments` into their
headline and sets seniority `Staff`. Later they click *"Read my résumé into my
profile"*. Their CV is a skills-and-projects format with no title line, so the
model returns `headline: null, seniority: null` alongside a good summary and skill
list. The 422 does not fire. Their hand-written headline and seniority are
silently erased, the profile document gets *thinner*, and `syncProfileEmbedding`
at `:252` immediately bakes the degraded document into their vector. `AI.md` §7's
*"the user stays in control"* is not upheld here.

**Fix.** Mirror the presence-gating: build the update object and assign
`headline` / `seniority` / `yearsOfExp` / `skills` only when the extracted value
is non-null. A model that did not find a field has said nothing about it, not that
it is absent.

**Confidence: medium-high. Verified** by reading both write paths.

---

### W6. The alert runner's location filter is a substring match where the feed's is exact — contradicting a documented decision one file away

**`app/api/alerts/run/route.ts:119-121`**:

```ts
if (filters.location) {
  clauses.push({ location: { contains: filters.location, mode: 'insensitive' } });
}
```

**`app/api/jobs/route.ts:101-111`** does the opposite, and spells out why:

> Exact rather than `contains`, because the value came out of a facet and is
> therefore a value the corpus actually holds. A substring test would quietly
> make "Berlin" also mean "Berlin, Germany" — a different option, with a
> different count, that the dropdown offered separately.

The saved search's `filters.location` comes from exactly that facet dropdown
(`app/jobs/page.tsx:993`), so both files are filtering the same value by two
different rules.

**Failure scenario.** A seeker narrows the feed to location **Berlin** — a facet
option distinct from *Berlin, Germany*, with its own count — and saves the search
with daily alerts. The feed showed them only *Berlin* roles. The next morning the
alert notifies them about a *Berlin, Germany* posting the search they saved would
never have shown. The alert is broader than the search it claims to be.

`filters.type` has the mirror-image drift: exact and **case-sensitive**
(`{ type: filters.type }`) where the feed is case-insensitive. Harmless today,
because `isJobType` validates against the canonical `JOB_TYPES` list, but it is
the same seam.

**Fix.** Use `{ equals: filters.location, mode: 'insensitive' }` in
`filterClauses`, and add `mode: 'insensitive'` to the type clause. Better still,
export one `filterWhere` helper and have both routes call it.

**Confidence: high. Verified** by reading both files.

---

### W7. A seeker with no skill tags is penalised nine points rather than scored neutrally

**`lib/ai/skills.ts:483-487`** against **`lib/ai/matching.ts:157-159`**.

`settle` returns `credit = 0` when **either** side is empty, with the comment
*"An empty side is 'no signal', not 'no overlap' — the caller decides what a
skill-less posting should score."* The caller decides for one side only:

```ts
const skills = job.skills.length > 0 ? skillMatch.score : 0.5;
```

Measured:

```
scoreSkillsSync([],     ['Go','PostgreSQL']) -> { score: 0, missing: ['Go','PostgreSQL'] }
scoreSkillsSync(['Go'], [])                  -> { score: 0 }   // rescued to 0.5 by blend
```

An empty **job** skills array is neutral; an empty **profile** skills array is a
hard zero. At `MATCH_WEIGHTS.skills = 0.18` that is a **9-point** composite
penalty, and it contradicts `AI.md` §5's stated rule — *"Missing data is neutral,
not a penalty"* — as well as `scoreLocation` and `scoreSeniority` next door, both
of which return `0.6` on absent data.

**Failure scenario.** A seeker uploads a CV. `/api/ai/resume` extracts a strong
headline and summary, but the CV has no skills section so `skills` comes back
`[]`. Their semantic facet is excellent, yet every posting that names skills docks
them nine points relative to a posting that names none — the more specific the
posting, the worse they score, which is backwards. They are also told they are
"missing" every skill each posting lists.

A related edge: `blend` tests `job.skills.length` (the raw array) rather than the
post-canonicalisation key count, so a legacy job row whose `skills` is `['']`
reads as "has skills" and scores **everyone** at zero — and
`lib/ai/skills.ts:518-520` explicitly acknowledges that job rows predate
`cleanTagList` validation.

**Fix.** `const skills = job.skills.length > 0 && profile.skills.length > 0 ?
skillMatch.score : 0.5;` — or better, have `settle` return a nullable score and
let `blend` substitute `0.5` for `null`, making the "no signal" contract explicit
instead of encoding it as a `0` indistinguishable from a genuine zero overlap.

**Confidence: medium-high.** The asymmetry is **verified by execution**; whether
it is intended is inferred from the `AI.md` rule it contradicts.

---

### W8. The alert runner's "one notification per user per posting" guarantee holds only inside a single run

**`app/api/alerts/run/route.ts:268-275`** (the stated guarantee), **`:275`** (the
`Set` is created inside the request), **`:380`**, **`:432`**.

The comment says the guarantee is *"one notification per user per posting, not one
per search."* `announced` is a per-run `Set`. Two saved searches belonging to one
user that both match job X are deduplicated only if they are processed in the
**same** run.

**Failure scenario.** A user keeps *"React roles"* (DAILY) and *"Frontend,
remote"* (WEEKLY). Monday the daily search notifies about job X and advances its
own watermark past it. The weekly search's watermark is still Monday-minus-seven-days.
Saturday it runs, X is inside its window, and the user gets a **second** bell
entry for the same posting. The same happens any time more than
`MAX_SEARCHES_PER_RUN = 25` searches are due and two of a user's searches land in
different batches.

**Fix.** Make the dedupe durable — before building `rows`, exclude jobs the user
already holds a notification for (`link: '/jobs/${id}'`), or key on a stored
per-user delivery record.

**Confidence: high. Verified.** This is a documented guarantee the code does not
deliver, so it is not a case of a comment explaining deliberate behaviour.

---

### W9. The company message composer has no length cap; the server truncates at 5000 and reports success

**`app/conversations/page.tsx:678-687`** (no `maxLength`) against
**`app/api/messages/route.ts:130`** (`cleanText(body.content, 5000)` →
`value.trim().slice(0, maxLength)`).

The seeker composer enforces `maxLength={4000}`
(`app/seeker/conversations/page.tsx:731`) — safe in direction, but also
disagreeing with the server's 5000, so a seeker simply cannot use the last 1000
characters and is told nothing about why. Neither number is derived from the
other or from `lib/validation.ts`.

**Failure scenario.** A recruiter pastes a 7000-character role brief into a
candidate thread and presses Send. The POST returns **201**, no error is shown,
and the message is stored at 5000 characters — the last 2000 are gone. (Mitigating
nuance: both pages append the *server's* returned row, so the truncated text does
appear in the bubble immediately. The loss is silent, not invisible.)

This is the fourth instance of the client/server length seam; the other live one
is W-note in §🟡 I5 (the saved-search query).

**Fix.** Export one `MESSAGE_MAX = 5000` from `lib/validation.ts`, use it in
`cleanText` and as `maxLength` on both textareas, and add a counter near the
limit. Rejecting over-length input with a 400 is better than slicing silently.

**Confidence: high. Verified.**

---

### W10. A message sent to thread A is appended to whatever thread is open when the response lands

**`app/conversations/page.tsx:286-306`** and
**`app/seeker/conversations/page.tsx:294-321`** — both pages.

`sendMessage` captures the selection at call time (correct for the POST body),
but the post-await `setMessages((current) => merge(current, created))` writes into
the **current** `messages` state, which the selection effect may have replaced
with another thread's history. Nothing ties the response back to the selection.

**Failure scenario.** Type *"Can you do Tuesday?"* to Alice, press Enter, and
immediately click Bob's thread while the request is still in flight. Bob's thread
opens, loads Bob's history, and then your message to Alice appears inside it as
your own bubble. It is not stored against Bob — it is a phantom that persists in
the pane until you switch threads again.

**Fix.** Keep a `selectedIdRef` and apply the append only when the captured
target id still matches it.

**Confidence: medium-high. Traced, not reproduced** in a browser.

---

### W11. The company unread badge clears even when opening the thread fails

**`app/conversations/page.tsx:190-201`** against
**`app/seeker/conversations/page.tsx:219-224`**.

The company page zeroes `unreadCount` inside `openConversation`, *before* the
`GET /api/messages` that actually writes `readAt`
(`app/api/messages/route.ts:94-97`). The seeker page clears only after a
successful fetch. Another one-of-two refactor.

**Failure scenario.** A recruiter clicks a thread while the connection drops. A
toast says *"Could not load this conversation"*, and the badge is now **0** even
though the messages are still unread server-side. Reload and the badge is back —
the count appears to flicker and lie.

**Fix.** Move the `setItems(… unreadCount: 0)` into the success branch of the
messages effect.

**Confidence: high. Verified.**

---

### W12. `readAt` is a single global flag, so unread counts are wrong for any company with more than one recruiter

**`prisma/schema.prisma`** (`Message.readAt` is one nullable column),
**`app/api/conversations/route.ts:23-40`** (unread = `senderId != viewerId` and
`readAt IS NULL`), **`app/api/messages/route.ts:94-97`** (marks read for
`senderId != session.id`).

Multi-staff companies are clearly supported — `app/api/messages/route.ts:170-183`
notifies *every* `role: COMPANY` user with that `companyId`.

**Failure scenario A.** Recruiter A messages a candidate. Recruiter B's inbox
shows a green "1" unread badge on that thread, even though nobody wrote to B,
because `senderId != B`.
**Failure scenario B.** The candidate replies; recruiter A opens the thread; the
message is stamped `readAt` globally, so recruiter B **never sees a badge for it
at all**.

**Fix.** A `MessageRead(messageId, userId)` join table, or a per-participant
`lastReadAt` on the conversation.

**Confidence: high. Verified** by reading both definitions against the schema.

---

### W13. Turning the Gemini key **on** makes alerts fire *less*

**`app/api/alerts/run/route.ts:77-79`** (`MIN_RELEVANCE = 45`) and **`:322-342`**,
against **`lib/ai/search.ts:1018-1022`, `:1071-1085`** and
**`lib/ai/config.ts:91`** (`RETRIEVAL_DEPTH = 100`).

The route passes `limit: 500` but **no `depth`**, so each arm contributes only its
global top 100. `relevance` is `score / bestPossible * 100` where
`bestPossible = arms.length / (RRF_K + 1)`:

- AI **off** → one arm → `bestPossible = 1/61`. A hit at lexical rank *n* scores
  `61/(60+n)×100`; it clears 45 up to rank ~75.
- AI **on** → two arms → `bestPossible = 2/61`. A job found by only *one* arm
  maxes out at 50 and clears 45 only to rank **~7**.

**Failure scenario.** A saved search *"senior react engineer"* on a few hundred
postings. A new posting is lexical rank 9 and outside the vector arm's top 100.
With no `GEMINI_API_KEY` it alerts (relevance 88). Set the key and it scores
`(1/69)/(2/61)×100 = 44` → filtered out → absent from `matched` →
`chosen.complete && scanned.complete` → the watermark advances to `windowEnd`
(`:366`) → **the posting is never reconsidered**. The user's alerts quietly go
quiet as the corpus grows, and `outcomes` reports `notified: 0, drained: true`,
which reads as *"nothing new was posted."*

**Fix.** Restrict retrieval to the alert window (pass the candidate ids or a
`createdAt` predicate into the search) rather than intersecting a global ranking.
At minimum pass a `depth` at least the size of the window and re-derive
`MIN_RELEVANCE` for the two-arm scale.

**Confidence: high on the mechanism and the arithmetic (verified from source);
medium on real-world frequency**, which depends on corpus size.

---

### W14. A caught search failure still advances the alert watermark past the whole window

**`app/api/alerts/run/route.ts:322-342`** (catch leaves `hits = null`) and
**`:360-367`** (watermark advances anyway).

When `hybridJobSearch` **throws** — a Postgres hiccup, a Gemini timeout, a cache
failure — the error is logged and `hits` stays `null`, which falls through to the
far stricter in-memory keyword pass (`KEYWORD_MATCH_RATIO = 0.6`, requiring 60% of
query tokens as literal substrings). `matched` is then computed with the wrong
matcher, and the watermark still moves to `windowEnd`.

**Failure scenario.** A thirty-second Gemini outage overlaps the nightly run. The
search *"platform reliability"* would have matched an *"SRE — Payments"* posting
semantically; the keyword pass needs both words as literal substrings and fails.
The window closes and the posting is never alerted on, ever. The comment at
`:314-321` justifies the *degradation* but not the irreversible watermark
advance.

**Fix.** Distinguish "AI unavailable" (`result === null`, expected, keyword
fallback is correct) from "the search call threw" (unexpected). On a throw, skip
the search for this run and leave both `lastNotifiedAt` and `lastRunAt` alone —
exactly what the write-failure path at `:418-430` already does.

**Confidence: medium-high. Verified by reading**; the trigger is a transient
error.

---

### W15. Fire-and-forget embedding writes have no `waitUntil`, so on a serverless target they frequently never run

**`lib/ai/embeddings.ts:98-103`** and **`:189-194`**; callers at
`app/api/jobs/route.ts:704`, `app/api/jobs/[jobId]/route.ts:172`,
`app/api/resumes/route.ts:206`, `app/api/users/[id]/route.ts:174`.

The *error* handling is correct and worth saying so: `syncJobEmbedding` and
`syncProfileEmbedding` wrap their whole body in try/catch and return `'failed'`
rather than rejecting, and the `.catch()` on each queue helper is a redundant
second net. There is no unhandled-rejection path.

The problem is lifecycle. `POST /api/jobs` returns its 201 while the embedding
promise is still pending, and `waitUntil` / Next 15's `after()` appear nowhere in
`lib` or `app`. On a serverless platform the invocation is frozen or torn down
once the response is flushed, so the promise may never resume.

**Failure scenario.** A company posts a role. The 201 comes back, the posting is
live, and the platform freezes the function. The embedding is never written and
never retried: the posting is invisible to the vector arm of search and
unscoreable by `computeMatch`, with no failure signal anywhere. `POST
/api/ai/resume:252` is the one path that got this right — it `await`s, with a
comment explaining why.

**Fix.** Wrap the queue helpers in `waitUntil` from `@vercel/functions`, or
`after()` from `next/server`. Both keep the invocation alive for the pending work
without delaying the response, preserving the fail-soft property the helpers
exist for. A periodic `POST /api/ai/reindex` is the belt-and-braces backstop and
is worth having regardless.

**Confidence: medium.** The absence of `waitUntil` is **verified**; how often a
pending promise actually survives could not be measured from here.

---

## 🟡 Inconsistent

### I1. `User.location` is scored and embedded, but no seeker can ever set it — so the Location facet is permanently neutral

**`lib/ai/matching.ts:250`** (`loadProfileContext` selects `user.location`),
**`:160`** (`scoreLocation(profile.location, job.location)`),
**`lib/ai/documents.ts:65`** (`Based in: …`), rendered at
**`app/jobs/[jobId]/page.tsx:527`** as a meter labelled *"Location"*.

`app/seeker/profile/edit/page.tsx` has exactly six inputs — name, email, profile,
headline, seniority, years — and no location field. `/api/ai/resume` does not
extract one. The only writer of `User.location` is `PUT /api/users/[id]`, and the
only form that sends it is the **company** profile editor, whose users are never
scored.

**Failure scenario.** A seeker opens any posting. The match panel shows four
facet meters. *"Location"* reads **60** on every posting ever, because
`scoreLocation` returns its neutral `0.6` whenever either side is null, and the
seeker's side is structurally always null. A seeker who lives in the posting's
city, and would score 100, cannot tell the product so. Their profile document
never carries `Based in:` either, so the semantic facet does not compensate. The
meter is a permanent constant dressed as a measurement.

**Fix.** Add a location input to the seeker profile editor (server-side support
already exists, capped at 100 characters), and either extract it in
`/api/ai/resume` or leave it manual. Until then, consider hiding the meter rather
than showing a constant.

Related and smaller: because the seeker editor sends only
`{name, email, profile, …signalFields}` while `PUT /api/users/[id]:126-135`
writes `profile`, `website`, `industry`, `size`, `location` and `description`
unconditionally, those five are nulled on every seeker save. Harmless today
precisely because nothing ever sets them for a seeker — but it is the same shape
as B1, and it becomes a live data-loss bug the moment a location field is added
without also presence-gating the route.

**Confidence: high. Verified** by enumerating every writer of `User.location`.

---

### I2. The IME guard on Enter landed on the seeker composer only

**`app/conversations/page.tsx:663-670`** checks only
`key === "Enter" && !shiftKey`. **`app/seeker/conversations/page.tsx:708-715`**
adds `&& !event.nativeEvent.isComposing`, with a comment explaining exactly why.

**Failure scenario.** A Japanese, Chinese or Korean recruiter types `にほん` and
presses Enter to *confirm the IME candidate*. The company page intercepts the
keypress and sends the partial, unconverted text; the remaining composition is
lost. The same keystroke on the seeker page behaves correctly.

**Fix.** Copy the `isComposing` guard.

**Confidence: medium-high. Read**, not reproduced — verifying it needs a real IME.

---

### I3. The company thread claims "No messages yet" while the history is still loading

**`app/conversations/page.tsx:219-239`** clears `messages` and fetches with no
loading flag; the render at **`:432-437`** keys the empty state purely on
`groups.length === 0`. The seeker page has `messagesLoading` and a spinner
(`app/seeker/conversations/page.tsx:134, 209, 620-623`).

**Failure scenario.** Click an applicant with 200 messages on a slow connection.
For one to two seconds the pane says *"No messages yet — say hello."*, then the
whole history snaps in.

**Fix.** Mirror `messagesLoading` from the seeker page.

**Confidence: high. Verified.**

---

### I4. Neither inbox is ordered by message recency, though both render a recency timestamp

Company rows come from `applications … orderBy createdAt desc`
(`app/api/conversations/route.ts:63-70`); seeker rows from
`conversation … orderBy createdAt desc` (`:133-140`). Both lists render
`formatRelative(latest.createdAt)`, which *looks* like recency ordering.

**Failure scenario.** Your oldest applicant messages you. Their row shows *"Just
now"* but stays pinned at the bottom of a forty-row list, under rows that say
*"12d ago"*. Combined with B4 (no reorder on socket events) the inbox never
surfaces activity at all.

**Fix.** Sort the assembled rows server-side by
`latest?.createdAt ?? conversation.createdAt`.

**Confidence: high. Verified.**

---

### I5. The saved-search query has no client cap while the server truncates at 200; the location cap disagrees with the feed's

**`app/jobs/page.tsx:993`** posts `query` verbatim from the feed's search box,
which carries no `maxLength`, against **`app/api/saved-searches/route.ts:30`**
(`QUERY_MAX = 200`). A longer search saves "successfully" and the alert then runs
a *different, truncated* query than the one the seeker was looking at.

Separately, `LOCATION_MAX = 80` in both saved-search routes versus
`FILTER_MAX.location = 120` in `app/api/jobs/route.ts:77`. A facet value between
81 and 120 characters is truncated into the saved filter and, combined with W6's
`contains`, matches a different set than the feed did.

**Fix.** Add `maxLength={QUERY_MAX}` to the feed search box (or reject over-length
with a 400 instead of slicing), and align `LOCATION_MAX` with `FILTER_MAX.location`.

**Confidence: high. Verified.**

---

### I6. Three copies of the seniority ladder and the tag cleaner, and one copy is missing the `Number(null)` guard the shared one exists for

`lib/validation.ts` exports `SENIORITY_LEVELS`, `cleanSeniority`, `cleanTagList`
and `cleanYearsOfExperience`. Both
**`app/api/users/[id]/route.ts:25-59`** and **`app/api/ai/resume/route.ts:36-47,
114-145`** re-declare their own. All three are currently behaviourally identical
except one:

```ts
// app/api/ai/resume/route.ts:139
function cleanYears(value: unknown): number | null {
  const years = Number(value);            // Number(null) === 0, Number('') === 0
  …
}
```

`lib/validation.ts:166-179` guards against exactly this and carries a paragraph
explaining that *"a naive coercion would record 'zero years of experience' for
anyone who simply left the field blank."*

Today the consequence is bounded: `RESUME_SCHEMA` marks `yearsOfExperience` as a
required `INTEGER` and the prompt instructs *"Use 0 when the résumé shows no
professional roles"*, so `null` is unlikely and `0` is the intended answer anyway.
`generateJsonFromDocument` does no schema validation, though, so a `null` from
the model silently becomes a stored `0` — and the copy is one refactor away from
being pointed at a form, where it reproduces the original bug exactly.

**Fix.** Delete all three local copies and import from `lib/validation.ts`, which
already exports every one of them.

**Confidence: high. Read** — the divergence is certain; the live impact is
bounded by the prompt.

---

### I7. Post-a-job is the only long form with no unsaved-changes guard

`app/jobs/[jobId]/edit/page.tsx:510-530`, `app/seeker/profile/edit/page.tsx:215-227`
and `app/company/profile/edit/page.tsx:149-162` each install a `beforeunload`
handler and a `confirmDiscard` wired to **both** Cancel and Back — that pairing is
correct on all three, so the earlier one-of-two bug is genuinely fixed.
`app/jobs/post/page.tsx` has neither.

**Failure scenario.** An employer writes a 4000-character job description, then
hits Cmd-W or the browser Back button. It is gone without a prompt. The same
action on the edit page asks first.

**Fix.** Lift the `dirty` / `beforeunload` / `confirmDiscard` trio into a shared
hook and use it on all four forms.

**Confidence: high. Verified.**

Worth noting alongside: on all four forms the guard covers only Cancel, Back and
tab-close. Navigating away via the shared `Navbar` still drops the edits
silently. The comments say as much, so this is an acknowledged limit rather than
a bug — but it is the most likely exit on every one of those pages.

---

### I8. The job delete does the database's cascade work by hand, for one table out of four

**`app/api/jobs/[jobId]/route.ts:238-241`**:

```ts
await prisma.$transaction([
  prisma.application.deleteMany({ where: { jobId } }),
  prisma.job.delete({ where: { id: jobId } }),
]);
```

`Application_jobId_fkey` is already `ON DELETE CASCADE`
(`prisma/migrations/20260910120000_harden_schema/migration.sql:61-63`). The
`deleteMany` is a redundant scan-and-delete, and it covers only `Application` —
`JobQuestion`, `JobEmbedding` and `MatchExplanation` are left to the database
cascade anyway, so the code is inconsistent as well as redundant. It is inside a
transaction, so it is not incorrect. The comment explaining it (*"Applications
used to block the delete with a raw foreign-key error"*) predates the cascade
that made it unnecessary.

**Fix.** Drop the `deleteMany` and the transaction wrapper; keep the `_count`
read that populates `deletedApplications`.

**Confidence: high. Verified** against the migration SQL.

---

### I9. `invalidateJobVectorCache` documents a wiring that does not exist

**`lib/ai/cache.ts:228-238`**, whose docstring reads *"Exported for the write
paths that index a posting (`syncJobEmbedding` and the bulk re-index)."* A grep of
`app`, `lib` and `scripts` finds its only callers in
`scripts/eval/harness/run-eval.ts:253` and `:275`. `lib/ai/embeddings.ts` does not
import from `./cache` at all.

**Effect.** A newly posted job is invisible to the vector arm of search for up to
`VECTOR_CACHE_TTL_MS` (60s) on each warm instance. The same docstring calls the
cache *"an optimisation rather than a correctness requirement"*, which is true —
so the defect is narrowly that a reader is told a wiring exists that does not, and
that lengthening the TTL would silently make it a correctness problem.

**Fix.** Call it after the `jobEmbedding.upsert` in `syncJobEmbedding` and once at
the end of `reindexAll`'s job loop — or correct the docstring to say it is
deliberately unwired.

**Confidence: high. Verified** by exhaustive grep.

---

### I10. `?next=` survives login but is dropped by the Sign-up link

`useAuthGuard` redirects to `/auth/login?next=<path>` and
`app/auth/login/page.tsx:82, 91, 149` honours it through `safeNext` — the earlier
shadowing bug is genuinely fixed. `app/auth/register/page.tsx:105, 180` always
uses `dashboardFor(role)` and the *"Don't have an account?"* link does not carry
`next` across.

**Failure scenario.** A new visitor clicks a job link, hits the apply guard,
lands on `/auth/login?next=/jobs/abc`, decides to register instead, and is dropped
on their dashboard with no memory of the role they came for.

**Fix.** Propagate `next` on the login↔register links and honour it in the
register redirect, reusing `safeNext`.

**Confidence: high. Verified.**

---

### I11. The full-text and trigram indexes cannot be expressed in `schema.prisma`, so the next `migrate dev` will generate a `DROP INDEX`

**`prisma/migrations/20260911100000_ai_phase_two/migration.sql:131-167`** creates
`Job_fulltext_idx` (a `to_tsvector` GIN index) and `Job_title_trgm_idx`. The `Job`
model in `prisma/schema.prisma` declares neither, because Prisma cannot represent
an expression index. The migration's own comment claims the opposite — *"keeping
the expression here means the schema stays fully describable by
`schema.prisma`."*

**Effect.** The next `prisma migrate dev` diffs the shadow database against the
schema, sees two indexes the schema does not declare, and emits `DROP INDEX` for
both into the generated migration. `lexicalSearch` (`lib/ai/search.ts:850-862`)
still *works* without them — it sequential-scans and recomputes the tsvector per
row — so this degrades search latency rather than correctness.

**Fix.** Note on the `Job` model (a `///` doc comment) that any generated
migration dropping those two indexes must have the drop removed by hand, and
correct the migration's comment.

**Confidence: medium-high. Read**, inferred from how Prisma's diff engine works;
`migrate dev` was not run.

---

### I12. `MAX_SAVED_SEARCHES` is a check-then-act race

**`app/api/saved-searches/route.ts:143-151`** does `count()` then `create()` with
no constraint behind it. Two concurrent POSTs at 19 rows both read 19, both pass,
both insert → 21 rows. The cap exists specifically to bound the alert runner's
per-user cost (comment at `:18-26`), so exceeding it is the exact thing it was
written to prevent, and a double-submit is enough.

**Fix.** An advisory lock, or accept the drift and enforce the cap at read time in
the runner (which already `take`s a bounded set).

**Confidence: high. Verified.**

---

### I13. `explainMatch` and the coach explain a score the portal does not show

**`lib/ai/explain.ts:198`** and **`app/api/ai/coach/route.ts:573`** call
`computeMatch` (sync). `explain.ts:182-185` states the intent: *"The score is
recomputed here rather than accepted from the caller: the sentence has to be about
the number the portal itself would show."* The number the job detail page shows is
the **async** one, which by W1 can differ by up to 13.5 points — and the
`sharedSkills` / `missingSkills` lists fed into `buildMatchFacts` differ too, so
the generated sentence can name a skill as missing that the detail page's own
panel does not list. The cache is keyed on `explanationHash(facts)`, so a
wrong-path sentence is then pinned for the life of the pair.

Nothing under `app/` currently fetches `/api/ai/explain`, so this is latent — it
becomes user-visible the moment the explanation panel is wired up. The coach page
*is* live, and injects `Computed fit score: ${match.score}/100` into its prompt
from the sync path.

**Fix.** `await computeMatchAsync(...)` at both sites. Both are already async and
already spend a generation call, so an embedding-backed skill comparison is free
by comparison.

**Confidence: high on the mismatch (verified); low on impact** for `explain`.

---

### I14. Cosmetic-but-behavioural drift between the two conversation pages

Collected here because the pattern matters more than any single line. Company
(`app/conversations/page.tsx`) vs seeker (`app/seeker/conversations/page.tsx`):

| | Company | Seeker |
| --- | --- | --- |
| Selection state | a snapshot **object** (`:155-164`) — row updates do not flow into the header | an **id** plus a `useMemo` lookup (`:132, 146-149`) |
| Dedupe helper | `mergeMessages` — Map by id **and re-sorts** (`:89-95`) | `mergeMessage` — `some(id)` then push, **no sort** (`:74-77`) |
| Unread badge | raw count (`:552-557`) | capped at `99+` (`:546-551`) |
| List preview after own send | **not updated** (`:286-306`) | updated (`:307-311`) |
| Day-separator label | `toLocaleDateString` weekday/month/day (`:102-117`) | `formatDate` → "Sep 11, 2026" (`:80-90`) |
| `aria-live` on the list | none | `polite` (`:482`) |
| Composer hint | in the placeholder | a real `aria-describedby` line |
| Button/field classes | `inputClass` / `buttonPrimary` | `field` / `btn-ink` |
| Latest-message read | `messages[messages.length - 1]` (`:519`) — wrong if the API's `take: 1` ever grows | `messages?.[0]` — correct for `orderBy desc` |

The seeker version is the better one in every row above except `mergeMessages`.

**Fix.** Extract one `<ConversationsPage role=…>` — the only genuinely
role-specific behaviour is the company's "start a conversation" action and the
two empty-state CTAs.

**Confidence: high. Verified.**

---

## 🔵 Cosmetic

- **C1. Dead deep-link branch.** `app/seeker/conversations/page.tsx:181-198`
  handles a `?company=` query parameter that **nothing in the repository
  produces** — every producer emits `?conversationId=`
  (`app/applications/page.tsx:349`, `app/company/dashboard/page.tsx:245`,
  `app/seeker/dashboard/page.tsx:465`). Verified by grep.
- **C2. Scroll behaviour differs** — `scrollIntoView({behavior:"smooth"})` on the
  company page, `+ block:"end"` on the seeker page. Max composer height 160px vs
  140px/`max-h-36`.
- **C3. One column, two labels.** The register form calls the field *"Full
  name"*; the company profile editor calls the same column *"Company name"*, and
  `PUT /api/users/[id]:163` keeps `User.name` and `Company.name` identical. This
  is deliberate and explained at `app/auth/register/page.tsx:65` (*"Creates a
  company workspace named after you … You can rename it later"*), but it does
  mean a company account can never have a personal name distinct from the company
  name, and the two labels never acknowledge each other.
- **C4. `destroyAssets` logs a guaranteed failure.**
  `app/api/resumes/route.ts:92-98` tries both `image` and `raw` resource types
  for every asset because the public id does not record which; one of the two
  always fails and is `console.error`'d. Deliberate and commented, but it means
  every resume replacement writes a spurious error to the logs.
- **C5. `DELETE /api/messages`** is a complete, correctly authorised handler with
  no caller anywhere in the client. Harmless; either wire a "delete message"
  affordance or drop it.
- **C6. The two dashboards draw the same funnel with the last two bars swapped.**
  `app/seeker/dashboard/page.tsx:211-218` declares `PIPELINE_ORDER` — PENDING,
  SHORTLISTED, INTERVIEW, **ACCEPTED, REJECTED** — with the comment *"the funnel,
  then the drop-outs."* `app/company/dashboard/page.tsx:144` builds the identical
  sparkline straight from `APPLICATION_STATUSES`, whose order is PENDING,
  SHORTLISTED, INTERVIEW, **REJECTED, ACCEPTED** — so on the employer's side the
  Rejected bar sits between Interview and Accepted in what reads left-to-right as
  a progression. The named constant and its rationale landed on one of the two
  dashboards. Cosmetic only, because `SignalPanel`'s bars are `aria-hidden` and
  carry no labels (`app/components/ui.tsx:265`); the fix is to export
  `PIPELINE_ORDER` from `lib/validation.ts` and use it in both. (Related: the
  seeker's `pipelineBars` returns `undefined` on an empty account so the panel
  falls back to its calm decorative pattern, while the company's always returns
  five zero-height stubs.)

---

## ⚪ Informational — checked and deliberately not filed

These were investigated and are either documented decisions, out of scope, or
correct as written. Listed so the decision is visible rather than silent.

1. **`EVAL.md` is stale.** Four of the six deficiencies it documents have since
   been fixed in `lib/ai/search.ts` and `lib/ai/vector.ts` — `vector.ts:51-60`
   now carries measured band constants with the derivation, not the old
   `0.35`/`0.92`. The document still reads as current. Worth a refresh pass so
   the baseline is not quoted against code that has moved.

2. **Socket egress is unauthenticated.** `socket-server.js:109-120` accepts any
   non-empty string as a room to join — no handshake auth, no JWT, no membership
   check. `AUDIT.md` 1.16 fixed only the `/emit-message` *ingress*. A leaked
   conversation id (it sits in the URL at `/conversations?conversationId=<uuid>`,
   so it reaches browser history, screenshots and pasted links) lets anyone run
   `io(url).emit('join-conversation', id)` and receive every subsequent message
   in that thread, including `sender.email`. Guessing is infeasible (UUIDv4), so
   this is leak-dependent rather than enumerable. Filed here rather than above
   because it is a security finding, not a logic seam — but it should be fixed:
   verify the same JWT on the handshake, then check membership before
   `socket.join`. The positive half is confirmed: messages **cannot** bypass REST
   validation, since the old `send-message` handler is gone and `emitToSocketServer`
   only runs after an authorised `POST`.

3. **Alerts ship inert.** `vercel.json` has no `crons` key, and no README,
   `DEPLOYMENT.md` or `deploy.sh` mentions `alerts/run`. Auth is
   `requireRole(req, 'ADMIN')` — correct, not open — but registration hard-codes
   `SEEKER`/`COMPANY` (`app/api/auth/route.ts:52`) and there is no seed script, so
   an ADMIN must be created by hand in the database first. The route's own comment
   rejects an `x-cron-secret` because it *"would be a second authentication path
   with its own rotation story"*; the token it chose instead is a **7-day JWT**,
   so the documented `curl` stops working a week after setup with a 401 visible
   only to the external pinger. That is a worse rotation story, not a better one.

4. **Notification `link` accepts protocol-relative URLs.**
   `app/api/notifications/route.ts:87` checks `startsWith('/')`, so `//evil.com/x`
   passes and `router.push` (`NotificationBell.tsx:141`) treats it as off-site.
   Only reachable through `POST /api/notifications`, which is ADMIN-only, and
   every server-raised link is a hard-coded internal path — latent hardening gap,
   not a live vulnerability. Reject `//` and `\\`.

5. **Cascades and migrations reconcile cleanly.** Every `onDelete` in
   `schema.prisma` was compared against the FK definitions in all six migration
   files: all fifteen cascading relations match. All sixteen tables, every column,
   all twenty indexes, all four enums and every default exist in some migration.
   `prisma migrate deploy` on an empty database produces a schema the code can
   use. The only reverse drift is I11.

6. **`strengths` vanishing is documented.** `/api/ai/resume` returns up to five
   strengths that no column stores;
   `app/seeker/dashboard/page.tsx:118-121` says so explicitly — *"the model
   returns it, nothing stores it, so it is present straight after an analysis and
   absent on a cold load."* A deliberate choice, correctly disclosed.

7. **Fail-soft coverage is complete.** Every `/api/ai/*` route gates on
   `isAiEnabled()` before any Gemini call, and no path with an absent key
   produces anything but `null`, an empty list, or a deliberate 503. Traced every
   throw site in the queue helpers including `prisma.*` and `embedText`: there is
   no unhandled-rejection path. (The *lifecycle* problem is W15, which is a
   different thing.)

8. **`contentHash` includes model and dimensions**, exactly as `AI.md` §3 claims
   (`lib/ai/documents.ts:88-93`, verified by execution). `QueryVector` cannot
   serve a wrong-model vector — model and dimensions are inside the hash key *and*
   re-checked on read. `SkillVector`'s *read* path is correct too; the defect is
   on the write side (B6).

9. **No swallowed errors and no raw model text reaching a client.** Every bare
   `catch {}` found is a `JSON.parse` guard returning `badRequest`, except
   `lib/ai/search.ts:893` (the documented `pg_trgm`-may-be-absent case) and
   `app/components/ThemeProvider.tsx:37` (inside the pre-paint inline script,
   which must never throw). `describeError` truncates to 300 characters and goes
   only to `console.error`. Raw vectors are stripped on every response path.

10. **Checked in the conversation pages and found correct:** `toast` is
    `useMemo`-stable so the dep arrays do not loop; both `new-message` handlers
    list `selectedId` and use functional `setState`, so there is no stale-closure
    cross-thread append; both thread fetches carry `cancelled` guards, so an A→B
    click race cannot overwrite; both send paths guard on `sending` and disable
    the button, so double-submit cannot produce two messages; the message
    double-append from `AUDIT.md` 2.9 is genuinely fixed on both sides.

11. **The per-process facet and job-vector caches not being shared across
    instances** is explicitly acknowledged as deliberate at
    `app/api/jobs/route.ts:269` and `lib/ai/cache.ts:180-185`, and the staleness
    is bounded because callers re-filter `isActive`. Not a finding.

12. **Application-status vocabulary is clean.** Every renderer and every
    comparator goes through `APPLICATION_STATUSES` / `STATUS_LABELS` from
    `lib/validation.ts` — `app/applications/page.tsx`,
    `app/company/dashboard/page.tsx`, `app/seeker/dashboard/page.tsx` and
    `app/components/ui.tsx:552`. No page hand-rolls a competing label or colour
    map, and the only raw literals found are
    `app/jobs/[jobId]/page.tsx:321`'s `?? "PENDING"` default and the deliberately
    reordered `PIPELINE_ORDER` (C6). Nothing compares against a status outside the
    canonical five. `npx eslint .` reports nothing, and every one of the 23
    components and helpers exported from the ~820-line `app/components/ui.tsx`
    kit has at least one consumer outside that file — there is no dead component
    surface.

13. **Date formatting is centralised, with one latent trap.** Every page imports
    `formatDate` / `formatTime` / `formatRelative` from `app/components/ui.tsx`;
    the only hand-rolled formatter is the company page's day separator (I14).
    `formatDate` pins `"en-US"` (`ui.tsx:793`) so it is SSR-safe, but
    `formatTime` passes `[]` (`ui.tsx:799`), which resolves to the *browser's*
    locale and would produce a hydration mismatch in any server-rendered tree.
    It is safe today only because its two call sites are both behind a `ready`
    gate that renders a spinner until after hydration. Pin the locale so the next
    call site does not have to know that.

14. **Page and feature reachability is sound.** `/seeker/alerts` and
    `/seeker/coach` are both in the seeker `Navbar` (`app/components/Navbar.tsx:143-144`),
    and `/seeker/alerts` is also linked from the feed's save-search confirmation
    (`app/jobs/page.tsx:953`). Both profile editors are linked from their
    dashboards. The two genuinely unreachable things found are the screening-question
    *answer* half (B2) and `DELETE /api/messages` (C5).

15. **`app/api/ai/screening` → `app/api/jobs/:id/questions` trust boundary.** The
    screening route runs `containsProtectedTerm` on every suggestion; the save
    route applies only `cleanString`. A client can therefore persist a question
    the outbound filter dropped. Not filed as a bug: at the point of saving, the
    text is employer-authored and employer-reviewed, which is a different trust
    category from `fairness.ts`'s stated remit ("anything the *model* writes about
    people"). Noted so the decision is explicit.

---

## What could not be verified

- **Nothing was reproduced in a browser.** The dev server on :3000 was probed
  read-only (`/api/stats` → `{"jobs":14,"companies":14,"seekers":8,"applications":6}`;
  `GET /api/jobs/<id>/questions` → `{"questions":[],"isOwner":false}`), but no
  session was established and no data was created or mutated. Every UI failure
  scenario above is traced through the code, not watched.
- **I2 (the IME guard)** needs an actual input method editor to demonstrate.
- **W15's hit rate.** The absence of `waitUntil`/`after` is certain; how often a
  pending promise survives a freeze on the deployment target is not observable
  from here.
- **W4 in the wild.** No database introspection was performed, so whether any
  deployment currently holds mixed-model embedding rows is unknown. The code-level
  gap is certain; whether it has already fired is not.
- **I11's `migrate dev` behaviour** is inferred from Prisma's diff engine, not
  executed — running it was out of bounds.
- **Whether `Job.createdAt`'s `@default(now())` is stamped by the Prisma query
  engine or by Postgres.** This decides whether `WATERMARK_LAG_MS = 60_000` is
  absorbing *commit latency* (safe) or *inter-node clock skew* (unbounded). If it
  is the engine, two app instances whose clocks differ by more than 60s can
  produce a job whose `createdAt` lands inside an already-scanned window — a
  permanent skip.
- **Whether Prisma's `upsert` at `app/api/conversations/route.ts:233` compiles to
  a native `INSERT … ON CONFLICT`.** With `include` present it may fall back to
  find-then-create, which can still throw an uncaught P2002 under concurrency and
  surface as a 500. The comment claims the 500 is prevented; the emitted SQL was
  not inspected.
- **Whether multi-recruiter companies exist in the live data.** W12's severity
  depends on it; the code clearly anticipates them.
- **`npx tsc --noEmit` passes with zero errors**, so none of the above is a type
  error — which is rather the point: every one of these is a seam that type
  checking cannot see.
