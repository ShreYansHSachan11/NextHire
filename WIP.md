# WIP — 12 Sep 2026

Where the UI/UX pass got to, and what to pick up.

Read `DESIGN-NOTES.md` first: it is the research output that drives this work,
with its sources in §Sources. Nothing below needs re-researching.

---

## State of the tree

Green: `tsc` 0, `eslint` clean, `next build` 39/39, `npm run audit:contrast`
200 pairs 0 failing, `npm run eval` unchanged. Everything is committed and
pushed.

---

## Done

### Design system
`app/globals.css` and `app/components/ui.tsx` are built around four
vocabularies, all token-driven and per-theme:

- **Elevation ladder** — `--canvas → --surface → --surface-raised →
  --surface-overlay` (+ `--surface-sunken`). Light climbs with shadow and
  border strength; **dark climbs with lightness** (`#0b111c → #131b2a →
  #1a2433 → #1e2839`). Dark mode is not inverted light mode.
- **State layers** — `--wash-hover / --wash-active / --wash-selected` as
  translucent films, so one `.interactive` class composites correctly over
  canvas, panel, tinted row and popover. States deliberately **do not stack**;
  selection carries a second non-additive cue (`.row-selected`).
- **Density scale** — `--space-1…9`, `--control-h-sm/md/lg`, `--pad-*`,
  `--radius-*`, documented in a table in the file.
- **Focus** — one unlayered `:focus-visible` rule, tokenised, plus a
  `forced-colors` fallback and `.focus-inset` for targets that meet a
  container edge.

The four-rule summary is in a header comment at the top of `ui.tsx`.

### The systematic fixes — these were the bulk of the work
Each one was the same mistake repeated across the portal, not a local blemish.
All are verified clean by a grep sweep; re-run those greps before assuming a
new page is fine.

1. **32 call sites threw away the focus indicator.** Each wrote
   `focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500` —
   killing the global outline and repainting it in a colour that is not the
   focus token, bypassing the fix that moved the dark ring off a 2.9:1 value.
2. **Every checkbox and radio drew in Chrome blue.** They were styled with
   `text-green-600`, which only tints a control when `@tailwindcss/forms` is
   installed, and it is not. `.control` uses `accent-color`.
3. **Hover was hand-rolled 12 times with 9 different values.** All go through
   `interactive` now.
4. **Message timestamps failed AA in 3 of 4 bubble/theme combinations**
   (2.6:1). The seeker page had already fixed it; the company page was a
   diverged copy that never got it.
5. **Four surfaces changed direction with the theme** — `bg-gray-50
   dark:bg-gray-950` is the canvas in light and a step *below* it in dark.
6. **Five spinner-for-list swaps** replaced with skeletons at the real row
   height, and three full-screen auth-guard spinners now render the route's
   own `loading.tsx`.
7. **Duplicated components merged**: three avatars (two disagreeing) into
   `Avatar`; four quoted-excerpt treatments into `.quote`; the brand mark from
   five files into `.tile-ink`; the badge palette from eight places into
   `BADGE_TONES`.

### Contrast
**200 pairs across both themes, 0 failing** — `npm run audit:contrast`. The
script alpha-composites translucent layers over the surface they land on, so it
measures real composites, not flat pairs. It has a `["fade", token, alpha,
base]` spec form for text drawn at partial opacity.

**It has caught three real failures, including one of mine.** Add the pair
*before* you trust a new rule: extracting `.segment` exposed a count badge at
2.8:1, and the `.quote` rail failed at both `--line-strong` (1.35:1) and
`--line-control` (2.99:1) before landing on a token that clears it.

### Also landed
Per-route `layout.tsx` titles on all 16 routes (fixes a WCAG 2.4.2 failure) and
`loading.tsx` on all 15 that take one. DESIGN-NOTES §3.2 (URL-shareable filter
state), §3.3 (the empty state names which filter to drop), §4.3 (the layered
"How this was worked out" disclosure on the match panel) and §5.4 item 1
(layout shift) are all done.

`ui.tsx` has had **no export renamed, removed or narrowed** throughout. Every
addition is additive with a rendering-preserving default.

---

## What is left

### UI/UX — every DESIGN-NOTES item is done except one
All of §1–§4 and §5.1/5.2/5.4/5.5 are implemented and verified against the
document section by section. What is left:

- **§5.3 optimistic UI with React 19.** `useOptimistic` is still unused. Three
  textbook cases named in DESIGN-NOTES: application status change, withdrawing
  an application, saving a search. Keep the toast on both paths — an optimistic
  update that silently reverts is worse than a spinner.
- **`border-gray-200 dark:border-gray-700` appears ~100 times.** It is
  *correct* (it resolves to `--line` in both themes) but it is a pair you have
  to get right by hand, and `border-gray-300` has already crept in nearby. A
  `.hairline` class would close it; weigh that against ~100 lines of churn.
- Every match surface now leads with a band and a `/100`, never a `%`. But the
  feed and the detail page still compute the underlying number on two different
  scales — see the correctness item below. Consistent *presentation* of two
  inconsistent *quantities* is the state this is currently in.

**A failure mode to watch for.** Four research items were found *built into the
kit and never called* — `MeterRow` took a `weight` prop no call site passed,
`MatchScore` took `rank`/`rankOf` nothing passed, and three surfaces hand-set
their own `%` readout rather than using the component that had been fixed to
stop printing one. Upgrading a component is only half of landing a change; grep
for the call sites. The same shape as the earlier "features built but switched
off" problem.

### Blocked on you — I cannot fix these in code
1. **Gemini key is free-tier: 20 generate calls/day.** Verification probing
   exhausts it, after which every cache miss 502s. The UI degrades to silence
   correctly, but on a real deployment the match rationale would be absent more
   often than present.
2. **Job alerts never run.** `vercel.json` has no `crons` key and nothing calls
   `POST /api/alerts/run`. A seeker sets "Daily" and sees "nothing new yet"
   forever, silently. Needs a scheduler entry plus a long-lived ADMIN token.
3. **Rotate the leaked credentials** — Cloudinary key/secret and the DB
   password were committed in `env-template.txt` and remain in git history.
   The Prisma Postgres URL was also echoed to a terminal during this work.
4. **`NODE_ENV="development"` in `.env`** — the auth cookie ships without
   `Secure` and the socket server's production guards are inactive. Correct
   locally; must not carry over.

### Security — from `SECURITY-AUDIT.md` (0 Critical, 3 High, 6 Med, 6 Low)
- **H1 is fixed** (Socket.IO read path authenticates; verified).
- **H2 — `GET /api/jobs?q=` spends Gemini tokens unauthenticated.** Every
  distinct query string is a guaranteed cache miss: one billed embedding call
  plus a permanent ~6 KB `QueryVector` row, from anyone, signed out.
- **H3 — every authenticated AI endpoint is an unmetered LLM proxy.**
  Registration is open; `POST /api/ai/review` takes 10 000 characters to a
  generation call with no ownership check.
- **There is no rate limiting anywhere in the project.** H2 and H3 are both
  really this, and it is the single highest-value thing left in the repo.

### Correctness — from `LOGIC-AUDIT.md`
- **Two match scales under one label.** `computeMatch` (sync) drives the feed;
  `computeMatchAsync` (embedding skills) drives the detail page and the frozen
  `Application.matchScore`. Measured gap 13.5 composite points — a seeker sees
  62 on the card and 76 on the detail page, and the employer sort comparator
  mixes both scales in one expression.
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
7. **Never invent content.** This bites in ordinary places: DESIGN-NOTES §4.3
   suggested linking the disclosure to `/support`, and there is no `/support`
   route, so the link was dropped rather than the route stubbed.
8. In `globals.css`: colours in plain `@theme`, fonts in `@theme inline`;
   component classes inside `@layer components`; base rules (`:focus-visible`,
   `:root`, `.dark`) **unlayered** — demoting them strips focus rings from
   every input.
9. `DESIGN-NOTES.md` recommends **never** showing an AI-written explanation of
   a *rejection* to a candidate (NYC Local Law 144, EU AI Act Annex III). Keep
   adverse-action narratives human-authored.

### Two traps already hit — do not repeat
1. **`loading.tsx` is a server component.** `ui.tsx` is `"use client"`, so a
   direct export (`Skeleton`) crosses the boundary but a *property of an object
   export* (`Icon.graph`) resolves to `undefined` and fails the build at
   prerender with "Element type is invalid". Add `"use client"` to any
   `loading.tsx` that needs `Icon` — or just do not use `Icon` there.
2. **Files in the working tree are CRLF after a `git checkout`.** A script that
   matches on `\n` will silently find nothing. Normalise with
   `.replace(/\r\n/g, "\n")` before string-matching a file you did not just
   write.

Two further notes on tooling: **there is no Prettier config in this repo**, so
running `npx prettier --write` reformats at 80 columns while everything else
sits near 100 — do not run it. And `next build` prints `prisma:error` lines
while prerendering `/` because `/api/stats` cannot reach the database at build
time; the build still succeeds 39/39 and that is not a regression.

---

## Verifying a change

```bash
npx tsc --noEmit          # must be 0
npx eslint .              # must be clean
npx next build            # 39 routes; use this, not `npm run build`, if the
                          # Prisma engine DLL is locked by a running server
npm run audit:contrast    # 200 pairs, 0 failing
npm run eval              # retrieval metrics; see EVAL.md for what they mean
```

End-to-end: start `npm run dev`, **make sure nothing stale holds port 3000**
(a stale server once silently invalidated a whole test run), warm it with one
request, then `npm run test:e2e`.

The greps that hold the design system together — all of these should return
nothing outside comments:

```bash
grep -rn "focus:outline-none\|focus-visible:ring" app --include=*.tsx
grep -rn "hover:bg-gray-\|hover:border-gray-"     app --include=*.tsx
grep -rn "text-green-600 focus:ring"              app --include=*.tsx
grep -rn "animate-pulse"                          app --include=*.tsx
grep -rn "bg-gray-50 dark:bg-gray-950"            app --include=*.tsx
```
