# NextHire — Access Control Policy

What is public, what requires an account, and the rules for deciding which is which.

`SECURITY-AUDIT.md` records *findings* — specific defects, with fixes. This file records *policy*:
the rules a new route is measured against before it ships. When the two disagree, this file is the
intent and the audit is the evidence.

---

## Why the job feed is public

It is deliberate, not an oversight. `middleware.ts` says so in as many words — "`/jobs/[jobId]/edit`
is company-only, but `/jobs` and `/jobs/[jobId]` are public" — and the API agrees: `GET /api/jobs`
answers an anonymous caller, while `GET /api/jobs?companyId=…` returns 401.

Three reasons, in the order they matter:

1. **A job board that requires a login to see jobs has no traffic.** Postings are the product's
   marketing. Every major portal — Indeed, LinkedIn, Greenhouse, Lever, Workday — serves posting
   pages to signed-out visitors and to crawlers, because Google Jobs, shared links and SEO are how
   candidates arrive. Gating the catalogue means the only people who see a posting are the people
   who already have an account, which is the wrong side of the funnel.
2. **A sign-up wall in front of unknown value is the worst possible ask.** The visitor has no
   evidence the site is worth an account yet. Let them read the postings, then ask for an account at
   the moment it buys them something — applying, saving, being matched.
3. **The content is not confidential.** A job posting is an advertisement. The employer wrote it to
   be read as widely as possible. There is nothing to protect.

**What is *not* public is everything about a person.** The distinction the codebase actually draws
is not "job board vs app" but *catalogue vs capability*: reading what employers published is open;
anything personal, mutating, costly or competitive requires an account. That is Rule 2 below, and
the measured surface at the end of this file shows it holding.

---

## The four tiers

Every route lands in exactly one. The tier is a property of the *route*, declared in code, not an
emergent result of which checks someone remembered to write.

| Tier | Who | Enforced by | Example |
|---|---|---|---|
| **Public** | Anyone, no credentials | Nothing — but see Rules 4–8 | `GET /api/jobs` |
| **Authenticated** | Any signed-in account | `requireAuth` | `GET /api/notifications` |
| **Role** | SEEKER / COMPANY / ADMIN | `requireRole`, `requireCompany` | `POST /api/jobs` |
| **Owner** | The specific user or company that owns the row | Role check **plus** an ownership predicate on the row | `PUT /api/jobs/:id` |

Owner is a separate tier from Role on purpose. "Is a COMPANY" and "is *this posting's* company" are
different questions, and conflating them is the single most common authorization bug in a
multi-tenant product: every employer passes the role check.

---

## The rules

### R1 — Default deny. Public is an allowlist, and the list is short.

A new route is Authenticated until someone argues it onto the public list and writes the argument
down. There is no route that is public because nobody got round to adding a guard.

The entire public allowlist, today:

```
GET  /api/jobs                      the catalogue
GET  /api/jobs/:id                  one posting
GET  /api/jobs/:id/similar          related postings
GET  /api/jobs/:id/questions        what the posting asks (never the answer key — see R5)
GET  /api/stats                     aggregate counts for the marketing page
```

Adding to this list is a deliberate act. Removing from it is always safe.

### R2 — Gate the capability, not the catalogue.

Public: **reading what an employer chose to publish.**

Gated, without exception:

- **Personal data** — profiles, résumés, applications, messages, notifications, saved searches.
- **Writes** — anything that creates, mutates or deletes a row.
- **Spend** — anything that calls a model or writes a cache row. Tokens cost money; an anonymous
  caller in a loop is an invoice.
- **Competitive intelligence** — who applied, how many, how they scored, another company's pipeline.
- **Personalisation** — a match score is *about the viewer*, so it needs a viewer. `GET /api/jobs`
  returns `match: null` to an anonymous caller for exactly this reason.

### R3 — Authorization lives on the server, per request. Everything else is decoration.

There are three layers here and only one of them is a security control:

- `middleware.ts` — **routing convenience.** It stops a protected page flashing before the client
  redirects. It decodes the JWT *without verifying the signature*, because `jsonwebtoken` cannot run
  on the edge runtime. A forged token passes it. It must never be the only thing between a request
  and data, and its own header comment says so.
- `useAuthGuard` — **UX.** It runs in the browser, where the user is in charge. It prevents a
  confusing screen, not an attacker.
- **The route handler** — the real control. `getSession` verifies the signature; `requireAuth` /
  `requireRole` / `requireCompany` decide. Every route does this independently.

The practical consequence: **never remove a check from a handler because the page is already
guarded.** The page guard protects a screen; the handler protects the data. The API is reachable
with `curl`.

### R4 — A public response is a separate projection, not a filtered private one.

Write an explicit `select` for the public shape. Never take the authenticated query and delete a
field, and never `include` a relation and prune it in JavaScript afterwards — the next person to add
a column to that model silently publishes it.

The screening questions route is the pattern to copy: `PUBLIC_SELECT` lists the six fields a
candidate may see, and `OWNER_SELECT` spreads it and adds `knockout` and `expected`. The answer key
cannot leak by omission, because publishing it requires adding it.

### R5 — Public means crawled, cached and permanent. Treat it as unrecallable.

Anything served to an anonymous caller should be assumed indexed by Google, archived, and scraped
within the hour. Unpublishing does not unpublish it.

Therefore, on a public route, **never**:

- personal data of any kind, including a name attached to a behaviour;
- anything derived from a person's private data — including embeddings, which are not anonymous and
  must never be serialised (`embedding.vector` is excluded from every route's select);
- an answer key, a threshold, a knockout rule, or anything else that tells a candidate what to say;
- an internal identifier that is also a capability (a signed URL, a token, a reset id).

### R6 — Withdrawn content must stop being served.

When an employer closes a posting, the posting stops being public. Closed means closed on the direct
link too, not merely absent from the feed — the link is what got shared.

The three parties who keep access: the owning company, an admin, and **a candidate who already
applied**. That last one is not a courtesy; a person who applied needs to be able to read what they
applied to while the application is live.

Refuse with **404, not 403** — a 403 confirms that the id names a real posting, which is the one
bit a withdrawn job should stop giving away.

> Enforced in `app/api/jobs/[jobId]/route.ts`. This rule was violated until 2026-09-15; see L2 in
> `SECURITY-AUDIT.md`.

### R7 — Every public endpoint is metered, bounded, and cheap.

A public endpoint is a resource anyone on the internet may spend on your behalf. Each one needs:

- a **rate limit** keyed on IP for anonymous callers (`lib/rateLimit.ts`, `SEARCH_ANON`);
- a **row cap** on every query, with no unbounded `findMany`;
- a **cost ceiling** — any path that can reach a model or write a cache row must be metered
  *before* it spends, not after.

### R8 — On a public read path, degrade — never reject.

A browsing visitor must not be shown an error for reading a public job board. Over budget, the
search silently falls back to a plain listing; the model being down does the same. No 429 on a read
that a human is waiting on.

This is a genuine trade: a throttled caller loses the lexical arm too, because both arms run
together. A broader list is worse than a ranked one and infinitely better than a broken one.

### R9 — Ownership comes from the session. The request body is attacker-controlled.

Take the actor's identity from the verified token, never from a field in the payload. A body that
carries `userId`, `companyId` or `role` is a mass-assignment vector: read the session, ignore the
body, and allowlist the fields a caller may set.

### R10 — Role checks are allowlists, and cross-role access is a redirect, not an error.

`requireRole(req, 'COMPANY')` names who may pass. ADMIN passes everything, in one place, so
"admin can do it" is never reimplemented per route.

A signed-in user on the wrong side of the app is not an error — send a seeker who opens
`/company/dashboard` to their own dashboard, not to a login page they do not need.

### R11 — Progressive disclosure has a floor: never tease.

Asking for an account at the point of value is right. Showing a result and blurring it is not — it
converts worse and it reads as a dark pattern. Either the capability is public or the gate is
visible *before* the work: say what signing in gets them, then ask.

### R12 — Aggregates are disclosure. Decide them, don't inherit them.

A count is data about the people counted. `_count.applications` on a public posting is a deliberate
choice — it tells candidates how contested a role is, and it tells the employer's competitors the
same thing. That trade is defensible; making it by accident is not. Any new aggregate on a public
route needs the same one-line argument.

---

## Checklist for a new route

1. Which of the four tiers? If Public, write the sentence justifying it and add it to R1's list.
2. Guard is the **first** thing in the handler, before parsing the body.
3. Owner tier: is there an ownership predicate *on the row*, not just a role check?
4. Public tier: explicit `select`, rate limit, row cap, no PII, no vectors.
5. Does it spend money? Metered before the spend.
6. Does it accept `userId` / `companyId` / `role` from the body? Remove them.
7. Add an anonymous probe for it (`scripts/e2e.mjs` covers the authenticated paths).

---

## Measured surface

All 32 API entry points, called with no credentials, on 2026-09-15:

```
anonymous 200s:        5 of 32   (all read-only catalogue)
leaking PII/secrets:   0
writes reachable:      0         (every POST/PUT/DELETE returns 401)
```

The five: `GET /api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/questions`, `/api/jobs/:id/similar`,
`/api/stats`. That is the allowlist in R1, and nothing else answered.

## Known gaps

- **R7 is partial.** `lib/rateLimit.ts` counts per instance, so the limits multiply by the number of
  serverless instances. A shared store is the real fix.
- **`NODE_ENV=development` in `.env`** means the auth cookie ships without `Secure`. This must not
  reach production; see `DEPLOYMENT.md`.
