# WIP — paused 11 Sep 2026

Where the UI/UX pass got to, and what to pick up. Everything described here is
**committed or in the working tree and building** — `tsc` 0 errors, `eslint`
clean, `next build` 39/39.

Read `DESIGN-NOTES.md` first: it is the research output that drives this work,
with its sources in §Sources. Nothing below needs re-researching.

---

## State of the tree

Green: typecheck, lint, production build (39 routes), `npm run eval`
unchanged, 58/58 end-to-end (the one red line in an e2e run is an upstream
Gemini **429 quota**, not a code fault — see "Blocked on you" below).

**Uncommitted work is in the tree.** It is coherent and builds, but it is
half of a larger pass — see "Where it stopped" before committing it as done.

---

## Done

### Design system — landed, verified
`app/globals.css` and `app/components/ui.tsx` were rebuilt around four
vocabularies, all token-driven and per-theme:

- **Elevation ladder** — `--canvas → --surface → --surface-raised →
  --surface-overlay` (+ `--surface-sunken`). Light climbs with shadow and
  border strength; **dark climbs with lightness** (`#0b111c → #131b2a →
  #1a2433 → #1e2839`), which is the part that matters — dark mode is not
  inverted light mode.
- **State layers** — `--wash-hover / --wash-active / --wash-selected` applied
  as translucent films, so one `.interactive` class composites correctly over
  canvas, panel, tinted row and popover. States deliberately **do not stack**;
  selection carries a second non-additive cue (`.row-selected`).
- **Density scale** — `--space-1…9`, `--control-h-sm/md/lg`, `--pad-*`,
  `--radius-*`, documented in a table in the file.
- **Focus** — tokenised, dark ring moved blue-400 → blue-300 (blue-400 was
  2.9:1 on the overlay tier), plus a `forced-colors` fallback.

Also `scroll-padding-top: 5rem` (WCAG 2.4.11) and `.hit-24` (2.5.8).

`ui.tsx` §1 upgrades: `MatchScore` leads with a band, no `%`, rounds to 5;
`Meter` is `role="meter"`; `MeterRow` takes `weight`; `Chip` absorbed
dismissible/selectable; `Skeleton` gained `SkeletonText/Rows/Cards/Panel`;
`StatusBadge` gained `PipelineTrack`; `EmptyState` splits
`empty`/`no-results`/`error`; new `LiveStatus`.

**Contrast: 166 pairs across both themes, 0 failing.** Worst text pair 4.61:1
light / 4.59:1 dark. The script alpha-composites translucent layers over the
surface they land on, so it measures real composites, not flat pairs. It lives
in the session scratchpad — **worth moving to `scripts/contrast-audit.mjs`** so
the guarantee survives further restyling.

**No `ui.tsx` export was renamed, removed or narrowed** — 0 removals, 24
additions, every new prop optional with a rendering-preserving default.

One visible copy change to know about: `MatchScore`'s default caption is now
`"Profile fit"`, was `"SIGNAL FIT"`.

### Pages — partial
Three page agents were stopped mid-pass. What landed is coherent and builds:
per-route `layout.tsx` (titles — fixes a WCAG 2.4.2 failure) and `loading.tsx`
skeletons across most routes, a restructured post/edit form with section rails,
feed facet chips, and partial seeker restyling.

---

## Where it stopped

The page-level restyle is **roughly a third done**. The design system is
finished; the pages have not all been brought onto it. Not yet touched or only
partly done:

- `app/page.tsx`, `app/jobs/[jobId]/page.tsx`, `app/auth/*` — discovery agent
  stopped early.
- `app/company/dashboard`, `app/company/profile/edit`, `app/applications`,
  `app/conversations` — company agent stopped after post/edit.
- `app/seeker/coach`, and finishing passes on `dashboard` / `profile/edit` /
  `alerts` / `conversations`.

**Next session: work page by page against the new vocabulary** (elevation,
state layers, focus, density). The four-rule summary is in a header comment at
the top of `ui.tsx`. No new research needed.

### Two traps already hit — do not repeat
1. **`loading.tsx` is a server component.** `ui.tsx` is `"use client"`, so a
   direct export (`Skeleton`) crosses the boundary but a *property of an object
   export* (`Icon.graph`) resolves to `undefined` and fails the build at
   prerender with "Element type is invalid". Add `"use client"` to any
   `loading.tsx` that needs `Icon`.
2. **`Eyebrow`/`Readout` now pass through HTML attributes**, so `id` works for
   `aria-describedby` targets. Before that existed, `app/jobs/page.tsx` used a
   raw `<p className="eyebrow">`; either form is fine, just don't pass `id` to a
   component that doesn't accept it.

---

## Outstanding, by priority

### Blocked on you — I cannot fix these in code
1. **Gemini key is free-tier: 20 generate calls/day.** Verification probing
   exhausts it, after which every cache miss 502s. The UI degrades to silence
   correctly, but on a real deployment the match rationale would be absent more
   often than present. Needs a paid tier.
2. **Job alerts never run.** `vercel.json` has no `crons` key, and nothing
   calls `POST /api/alerts/run`. A seeker sets "Daily" and sees "nothing new
   yet" forever, silently. Needs a scheduler entry plus a long-lived ADMIN
   token — an infrastructure decision.
3. **Rotate the leaked credentials** — Cloudinary key/secret and the DB
   password were committed in `env-template.txt` and remain in git history.
   The Prisma Postgres URL was also echoed to a terminal during this work.
4. **`NODE_ENV="development"` in `.env`** — the auth cookie ships without
   `Secure` and the socket server's production guards are inactive. Correct
   locally; must not carry over.

### Security — from `SECURITY-AUDIT.md` (0 Critical, 3 High, 6 Med, 6 Low)
- **H1 is fixed** (Socket.IO read path now authenticates; verified).
- **H2 — `GET /api/jobs?q=` spends Gemini tokens unauthenticated.** Every
  distinct query string is a guaranteed cache miss: one billed embedding call
  plus a permanent ~6 KB `QueryVector` row, from anyone, signed out.
- **H3 — every authenticated AI endpoint is an unmetered LLM proxy.**
  Registration is open; `POST /api/ai/review` takes 10 000 characters to a
  generation call with no ownership check.
- **There is no rate limiting anywhere in the project.** H2 and H3 are both
  really this.

### Correctness — from `LOGIC-AUDIT.md`
- **Two match scales under one label.** `computeMatch` (sync) drives the feed;
  `computeMatchAsync` (embedding skills) drives the detail page and the frozen
  `Application.matchScore`. Measured gap 13.5 composite points — a seeker sees
  62 on the card and 76 on the detail page, and the employer sort comparator
  mixes both scales in one expression. `lib/ai/explain.ts` was moved to the
  async path; **the feed/detail split remains**.
- A seeker cannot see their own submitted screening answers.
- `PUT`/`DELETE` on job questions cascade-deletes answers already collected —
  documented as deliberate, but it was theoretical before and is now live.
- Fourth client/server cap mismatch: the company message composer has no cap
  against the server's 5000.
- `cosineSimilarity` claims to guard against a dimension mismatch but actually
  truncates — mismatched widths return a perfect 100%.
- `/api/companies` is entirely orphaned (160 lines, including a second
  divergent writer for `Company.name`). ~15 exported HTTP methods have no
  caller.

### Design work not yet started — `DESIGN-NOTES.md`
§3.2 URL-shareable filter state · §4.3 the layered "How this was worked out"
disclosure · §5.3 optimistic UI with React 19 · §5.4 remaining layout-shift
work.

---

## Standing rules for this codebase

1. `isAiEnabled()` gates every AI entry point; with no key the portal behaves
   exactly as it did before AI existed. **No AI feature may be load-bearing.**
2. No route serialises `embedding.vector`.
3. Model output is untrusted: sanitise and length-cap before storage.
4. Nothing generated about a person is presented as fact or as a verdict. The
   match score is a **sorting aid**; knockout answers **flag**, never filter.
5. `lib/validation.ts` is the authority on input caps — import them, never
   re-declare. Four mismatches have been found from ignoring this.
6. Ownership is always checked server-side, never taken from the request body.
7. Never invent content — no fabricated testimonials, statistics or names.
8. In `globals.css`: colours in plain `@theme`, fonts in `@theme inline`;
   component classes inside `@layer components`; base rules (`:focus-visible`,
   `:root`, `.dark`) **unlayered** — demoting them strips focus rings from
   every input.
9. `DESIGN-NOTES.md` recommends **never** showing an AI-written explanation of
   a *rejection* to a candidate (NYC Local Law 144, EU AI Act Annex III). Keep
   adverse-action narratives human-authored.

## Verifying a change

```bash
npx tsc --noEmit          # must be 0
npx eslint .              # must be clean
npx next build            # 39 routes; use this, not `npm run build`, if the
                          # Prisma engine DLL is locked by a running server
npm run eval              # retrieval metrics; see EVAL.md for what they mean
```

End-to-end: start `npm run dev`, **make sure nothing stale holds port 3000**
(a stale server once silently invalidated a whole test run), warm it with one
request, then run the e2e script. It lives in the session scratchpad, not the
repo — worth moving to `scripts/` if it is to survive.
