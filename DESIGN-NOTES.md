# DESIGN-NOTES

Design research and concrete proposals for NextHire. Next.js 15 / React 19 / Tailwind v4.

This builds on the existing "signal" language — hairline rules, mono eyebrows, the gradient rail,
the cool slate ramp. Nothing here proposes replacing it. Most of the proposals are *additions to
`app/components/ui.tsx`* so the vocabulary gets richer rather than different.

I verified the current state against the running dev server and the source rather than assuming.
The AA contrast work in `app/globals.css`, the focus trap in `Navbar.tsx`, the
`prefers-reduced-motion` block and the per-toast live regions in `Toast.tsx` are all real and
correct; nothing below regresses them.

---

## Top 5, highest value first

| # | Proposal | Effort | Why it is first |
|---|---|---|---|
| 1 | **Ship the match rationale you already built.** `POST /api/ai/explain` exists, is fairness-filtered, cached and grounded — and has **zero callers in the client**. `grep -rn "ai/explain" app --include=*.tsx` returns nothing. | **S** — ~half a day | The single best trust artefact in the codebase is dark. It is the "rationale explanation" the ICO/Turing framework asks for, already implemented. |
| 2 | **Stop printing `%` on the match score; lead with a band, round to 5.** The score is `similarityToScore(cosine, floor 0.60, ceiling 0.80)` — a clamped linear rescale of a 0.2-wide cosine window. One displayed point = 0.002 cosine. `100%` means "cosine ≥ 0.80", not "perfect". | **M** — 1–2 days | Microsoft HAX G2-B: match numeric precision to actual system performance. We currently claim ~10× more resolution than the signal has, in a percentage shape that reads as a probability of being hired. |
| 3 | **Show the facet *weights* in `MatchPanel`.** Four identical `MeterRow`s imply four equal inputs; the blend is 0.70 / 0.18 / 0.07 / 0.05. | **S** — a few hours | An explanation that misrepresents how the number was produced is worse than no explanation. This is the "rationale must be faithful" line in the ICO guidance, and it is a two-line change. |
| 4 | **Give every route a title, and announce route changes.** Every page in `app/` is `"use client"`, no page exports `metadata`, and there are no nested layouts — so `/`, `/jobs` and `/auth/login` all serve `<title>NextHire — Signal-driven job matching</title>`. | **S** — ~2 hours | WCAG 2.4.2 (Page Titled) failure, and it silently neuters the App Router's route announcer, which reads `document.title`. Screen-reader users get no signal that navigation happened. Also tabs, history and bookmarks. |
| 5 | **Applied-filter chips for the three selects, and put filter state in the URL.** Today only *inferred* query chips are removable; the three selects show their state only inside the select, and none of it is shareable. | **M** — 2–3 days | Baymard: 42% of sites get applied filters wrong, and showing them in only one position measurably causes users to lose track of what is filtered. URL state also makes "save this search" and support conversations possible. |

### Free wins, under an hour each

- **`scroll-padding-top` for the sticky header.** `Navbar.tsx:152` is `sticky top-0 z-40` over an `h-16` (64px) bar, and `globals.css` has `scroll-behavior: smooth` but no scroll padding. Tab to a link below the fold and it can land behind the header — WCAG 2.2 SC 2.4.11 *Focus Not Obscured (Minimum)*, whose Understanding doc names scroll padding as the fix.
  ```css
  html { scroll-padding-top: 5rem; }  /* 64px header + 16px clearance */
  ```
  This also fixes the `scroll-mt-24` hack at `app/seeker/dashboard/page.tsx:974`, which is the same problem solved once, locally.
- **Touch targets on the two chip close buttons.** `FilterChip` (`app/jobs/page.tsx:905`) is `p-1` around an `h-3 w-3` icon = 20×20 CSS px; the index-hint dismiss at `:609` is 22×22. Both are under SC 2.5.8's 24×24 floor and survive only on the spacing exception. `.btn-touch` already exists and is the right idea; it is 44px, too big for inside a chip. Add a `.hit-24` helper that expands the hit area without changing layout:
  ```css
  .hit-24 { position: relative; }
  .hit-24::before { content: ""; position: absolute; inset: 50% 50%; width: 24px; height: 24px; transform: translate(-50%, -50%); }
  ```
- **`Meter` is `role="progressbar"` but measures a quantity, not progress over time.** MDN is explicit: "Meters should not be used to indicate progress." Swap to `role="meter"` for `MatchScore`/`MeterRow` usage; keep `progressbar` only if a genuine loading bar ever appears.

---

## What I would NOT do, and why

Being explicit, because a list that recommends everything is worthless.

- **No custom combobox for the three filter selects.** The brief asks about the APG combobox pattern. I read it, and the honest answer is that native `<select>` is the better component here. Three facets, short option lists, and a native control that already gets mobile pickers, type-ahead, voice control and screen-reader support for free. The APG select-only combobox needs `aria-activedescendant`, manual scroll-into-view for zoom users, and eight keyboard branches — all to reproduce what the platform gives you. Revisit only if the Location facet grows past roughly 15 options, at which point an autocomplete (`aria-autocomplete="list"`) earns its keep. There *is* a real bug in the current selects and it is not the widget: `Berlin (12)` is announced as "Berlin left paren twelve right paren". See §2.
- **No filter sidebar.** Baymard's caution about horizontal toolbars is about sites with many category-specific facets. We have three. A sidebar would cost a third of the feed width on desktop to display three controls.
- **No confidence percentage on the generated rationale sentence.** We have no calibration data for it. Per Google PAIR, a numeric confidence is the riskiest of the four display methods and needs substantial context; inventing one for a one-line LLM output would be exactly the false precision proposal #2 removes elsewhere.
- **No Partial Prerendering.** It is experimental, Next's own docs say not for production, and every meaningful route here is session-dependent so the static shell would be nearly empty. Ordinary `loading.tsx` + Suspense gets almost all the benefit (§5).
- **No component library (Radix / shadcn / Headless UI).** The kit in `ui.tsx` is coherent and the CSS-first `@theme` setup in `globals.css` is doing something specific and correct (colours in plain `@theme` so `text-gray-500` can resolve per theme). Dropping in a library would fight that and dilute the house language. Borrow the *patterns* from Radix and Carbon; don't take the dependency.
- **No motion/micro-interaction layer.** `globals.css` already has an honest `prefers-reduced-motion` block; adding animation now means maintaining two versions of every transition for marginal value.
- **No AI-written explanation of a *rejection* shown to the candidate.** This is the one place I would actively block a feature. Under NYC Local Law 144 and the EU AI Act's Annex III treatment of employment, an automated statement about why someone was rejected is the highest-liability surface in the product. The employer-side copy already gets this right ("Fit is a sorting aid, not an assessment"); keep the adverse-action narrative human-authored.

---

## 1. Component-level upgrades

### 1.1 `MatchScore` — band first, number second, no percent sign

**What.** `MatchScore` currently renders `98% match` + an eyebrow. Change the headline to a band
label, keep the number as instrument detail, and drop `%`.

**Why.** Two sources, one code fact.

- Microsoft's HAX Toolkit, Guideline 2 ("Make clear how well the system can do what it can do") has
  design pattern **G2-B: match the level of precision in UI communication with the system
  performance — Numbers**. The guideline exists to counter automation bias in one direction and
  algorithm aversion in the other.
- Google PAIR's *Explainability + Trust* chapter lists four ways to show confidence and calls the
  numeric percentage the riskiest: "users may misinterpret what 80% confidence means". It
  recommends **categorical** (high/medium/low) because it "reduces granularity confusion through
  clear action guidance".
- The code fact: `lib/ai/vector.ts:85` is
  `similarityToScore(cosine, floor = 0.60, ceiling = 0.80)` — clamp to [0.60, 0.80], rescale to
  0–100. So cosine 0.70 → 50, cosine 0.80 → 100, anything at or below 0.60 → 0. **One displayed
  point is 0.002 of cosine.** The last digit is noise, and `98%` next to the word "match" reads to
  a candidate as a 98% chance, which is not a claim the model can support.

**Where.** `app/components/ui.tsx` (`MatchScore`), used at `app/jobs/page.tsx:1132`,
`app/jobs/[jobId]/page.tsx`, `app/seeker/dashboard/page.tsx`.

**Roughly:**

```tsx
/** Bands, not points. The underlying signal is a 0.2-wide cosine window
    rescaled to 0–100; the last digit of that is not real. */
const FIT_BANDS = [
  { min: 80, label: "Very strong", hint: "Among the closest reads on your profile" },
  { min: 60, label: "Strong",      hint: "Clear overlap with what you list" },
  { min: 40, label: "Partial",     hint: "Some overlap — worth reading the posting" },
  { min: 0,  label: "Exploratory", hint: "Little overlap we can see" },
] as const;

export function fitBand(value: number) {
  return FIT_BANDS.find((b) => value >= b.min) ?? FIT_BANDS[FIT_BANDS.length - 1];
}

/** Rounded to 5 on list surfaces: below that the digits are model jitter. */
export const coarseFit = (v: number) => Math.round(v / 5) * 5;

export function MatchScore({ value, caption = "Profile fit", coarse = true, className = "" }) {
  const band = fitBand(value);
  const shown = coarse ? coarseFit(value) : value;
  return (
    <div className={`text-right ${className}`}>
      <span className="flex items-center justify-end gap-1.5">
        <Icon.pulse className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{band.label} fit</span>
      </span>
      <Eyebrow className="mt-0.5">
        <Readout>{shown}</Readout>
        <span aria-hidden="true">/100</span>
        <span className="sr-only"> out of 100</span> · {caption}
      </Eyebrow>
    </div>
  );
}
```

The band is the headline a human acts on; the readout keeps the instrument-panel character. A real
gauge shows a band *and* a raw value — this is more on-brand than the percentage, not less.

### 1.2 `Meter` / `MeterRow` — correct role, and stop announcing everything twice

**What.** Three changes to the pair:

1. `role="meter"` instead of `role="progressbar"` (MDN: meter = a measurement in a range;
   progressbar = progress toward completion over time).
2. `aria-valuetext` that says something, per APG's *Communicating Value and Limits for Range
   Widgets*: "there is value in communicating more information than just a number". Today it is
   `aria-valuetext={`${pct}%`}` which restates `aria-valuenow`.
3. In `MeterRow` the label and the value are **already printed as visible text right above the
   bar**. Giving the bar `aria-label={label}` makes a screen reader read "Technical stack
   alignment, 99 percent" and then "Technical stack alignment, meter, 99%". Mark the bar
   `aria-hidden` there; it is a redundant visual encoding of text that is already present.

**Where.** `app/components/ui.tsx:411–471`.

**Roughly:**

```tsx
export function Meter({ value, max = 100, strongAt = 60, label, decorative = false, className = "" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const strong = pct >= strongAt;
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "meter" as const,
        "aria-valuenow": Math.round(pct),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-label": label ?? "Measurement",
        "aria-valuetext": `${Math.round(pct)} out of 100 — ${fitBand(pct).label.toLowerCase()}`,
      };
  return (
    <div className={`meter ${className}`} {...a11y}>
      <span className={`meter-fill ${strong ? "" : "meter-fill-muted"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MeterRow({ label, value, max = 100, suffix = "", weight }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {label}
          {/* See §4.2 — four equal bars for a 0.70/0.18/0.07/0.05 blend is a false explanation. */}
          {weight !== undefined && (
            <Eyebrow as="span" className="ml-2">{Math.round(weight * 100)}% of score</Eyebrow>
          )}
        </span>
        <Readout className="text-xs font-medium">{value}{suffix}</Readout>
      </div>
      <Meter value={value} max={max} decorative />
    </div>
  );
}
```

### 1.3 `Chip` — absorb `FilterChip`, following Carbon's `DismissibleTag`

**What.** `Chip` is a static tag, so `app/jobs/page.tsx:903` hand-rolls a local `FilterChip` with a
close button. That is the right instinct and the wrong place — the moment a second surface needs a
removable token (applied-filter chips, §3.1) it gets copy-pasted. Give `Chip` an optional
`onRemove`.

**Why.** Carbon ships four tag variants (read-only, dismissible, selectable, operational) precisely
because "tag with an X" is a distinct component with its own contract: the close control is in the
tab order, Enter dismisses, focus moves to the next element in the tab order, and the accessible
name must include the tag's own text so a screen-reader user hears *which* filter they are
removing. The current `FilterChip` gets the name right (`Remove the {label} filter and search
again`) — that behaviour should live in the kit.

**Where.** `app/components/ui.tsx:499–516`; deletes `FilterChip` from `app/jobs/page.tsx`.

**Roughly:**

```tsx
export function Chip({ children, icon, accent, onRemove, removeLabel, className = "" }) {
  if (!onRemove) return <span className={`chip ${accent ? "chip-accent" : ""} ${className}`}>{icon}{children}</span>;
  return (
    <span className={`chip pr-1 ${accent ? "chip-accent" : ""} ${className}`}>
      {icon}
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="hit-24 ml-0.5 rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-white"
      >
        <Icon.x className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">{removeLabel ?? `Remove ${typeof children === "string" ? children : "filter"}`}</span>
      </button>
    </span>
  );
}
```

Note `.hit-24` from the free-wins list: this keeps the chip visually small while the target clears
SC 2.5.8 on its own rather than leaning on the spacing exception.

### 1.4 `Skeleton` — it is effectively dead code

**What.** `<Skeleton>` has **one** call site in the whole app (`app/page.tsx:555`). `<Spinner>` has
**53**. Meanwhile `app/jobs/page.tsx` hand-rolls `JobSkeletonGrid` out of raw
`bg-gray-200 dark:bg-gray-700` divs and `app/seeker/dashboard/page.tsx` hand-rolls
`MatchCardSkeleton`. The primitive exists and nobody uses it, so its animation and
`motion-safe:` guard are being reimplemented inconsistently.

**Why.** The ECCE 2018 study ("The effect of skeleton screens", Rettig et al.) found pages using
skeleton screens scored higher on both perceived speed *and* perceived ease of navigation. NN/g's
split is the useful rule: **spinners for short blocking actions** (submitting a form, auth,
payment), **skeletons where content is being fetched and layout context matters** (feeds,
dashboards). By that rule most of our 53 spinners are in the wrong category — the four biggest are
whole-list blockers at `app/applications/page.tsx:363`, `:587`, `:723` and
`app/seeker/dashboard/page.tsx:895`, each of which replaces a list with a centred spinner in a
`px-6 py-12` box that is not the height of the list it replaces. That is both the worse indicator
*and* a guaranteed layout shift.

**Where.** `app/components/ui.tsx:327`; then `app/applications/page.tsx`,
`app/seeker/dashboard/page.tsx`, `app/jobs/page.tsx`.

**Roughly** — export shapes, not just a rectangle, so a page composes a skeleton that matches its
real layout rather than inventing one:

```tsx
export function Skeleton({ className = "h-4 w-full", rounded = "rounded" }) {
  return <span className={`block ${rounded} bg-gray-200 motion-safe:animate-pulse dark:bg-gray-700 ${className}`} aria-hidden="true" />;
}

/** n lines of text with a short last line, so it reads as a paragraph. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="block space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-5/6" : "w-full"}`} />
      ))}
    </span>
  );
}

/** Rows that occupy the same height as the real list, so nothing jumps. */
export function SkeletonRows({ count = 5, height = "h-20" }) {
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`flex items-center gap-3 px-4 py-4 sm:px-6 ${height}`}>
          <Skeleton className="h-10 w-10 flex-shrink-0" rounded="rounded-lg" />
          <span className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </span>
        </li>
      ))}
    </ul>
  );
}
```

Then `app/applications/page.tsx:587` becomes `<SkeletonRows count={5} />` plus the existing
`sr-only` "Loading applications" — keeping the announcement, losing the spinner and the jump.

### 1.5 `StatusBadge` — a pipeline stage has a *position*, not just a colour

**What.** Add a `PipelineTrack` primitive beside `StatusBadge`. The five statuses are ordinal —
`PENDING → SHORTLISTED → INTERVIEW → ACCEPTED | REJECTED` — and a badge shows only the current
one. A seeker looking at "Shortlisted" cannot see that two stages remain.

**Why.** This is the GOV.UK *Task list* / progress-through-a-process idea: when a user is inside a
multi-stage process, showing where they are *within the sequence* is the information they want. It
also solves a second problem: `REJECTED` is styled grey (`STATUS_STYLES.REJECTED`, identical to the
`JobStateBadge` "Closed" grey), which reads as "inactive/disabled" rather than "closed, negative".

There is also a **palette collision worth flagging**: `globals.css` states emerald is "reserved for
match quality, live state and confirmation", but `STATUS_STYLES.ACCEPTED` and `JobStateBadge`'s open
state both use the same green. A row that is green because it is *accepted* sits next to a meter
that is green because it is a *strong match*. I would keep green for `ACCEPTED` (it is genuinely a
confirmation) and instead make the match accent distinguishable by always pairing it with
`Icon.pulse` / `Icon.spark`, which the kit mostly already does — colour alone should never be
carrying the difference anyway.

**Where.** New export in `app/components/ui.tsx`; used in `app/seeker/dashboard/page.tsx`
(`ApplicationRow`) and `app/applications/page.tsx:942`.

**Roughly:**

```tsx
const PIPELINE: ApplicationStatus[] = ["PENDING", "SHORTLISTED", "INTERVIEW", "ACCEPTED"];

export function PipelineTrack({ status }: { status: ApplicationStatus }) {
  const rejected = status === "REJECTED";
  const at = rejected ? -1 : PIPELINE.indexOf(status);
  const position = rejected ? "Closed" : `Stage ${at + 1} of ${PIPELINE.length}: ${STATUS_LABELS[status]}`;
  return (
    <div className="flex items-center gap-1.5">
      {/* One hairline segment per stage — the same grammar as .meter, so it belongs. */}
      <span className="flex gap-1" aria-hidden="true">
        {PIPELINE.map((s, i) => (
          <span key={s} className={`h-1 w-6 rounded-full ${rejected ? "bg-gray-300 dark:bg-gray-700" : i <= at ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"}`} />
        ))}
      </span>
      <StatusBadge status={status} />
      <span className="sr-only">{position}</span>
    </div>
  );
}
```

### 1.6 `EmptyState` — separate "nothing yet" from "nothing matched"

**What.** The component is good and the *jobs feed already does the right thing manually*
(`app/jobs/page.tsx:678–718` branches on `facets.total` to tell "no corpus" from "no results"). Pull
that distinction into the primitive so every other surface gets it, and make the recovery action
non-optional for the dead-end case.

**Why.** NN/g's filtering guidance: prevent zero-results dead ends, and give a way out. A first-run
empty state is a *teaching* surface; a zero-results state is a *recovery* surface. They deserve
different copy, different iconography and different required props. Thirteen `EmptyState` call
sites currently pick by hand, and several (`app/seeker/dashboard/page.tsx` "No applications yet")
get it right while others pass no action at all.

**Roughly:**

```tsx
export function EmptyState({ variant = "empty", icon, title, description, action, ...rest }: {
  variant?: "empty" | "no-results";
  /** Required when variant is "no-results" — a dead end must have an exit. */
  action?: React.ReactNode;
} & ...) { /* same markup; "no-results" tightens padding and defaults the icon to Icon.search */ }
```

The bigger win is in the *copy generator*, not the component — see §3.3.

---

## 2. Accessibility beyond compliance

Contrast is done. These are the things that decide whether the app is *usable*, not whether it
passes.

### 2.1 Route titles and route-change announcement

**The finding.** Every `page.tsx` in `app/` is `"use client"`. There is exactly one `layout.tsx`
(the root), no page exports `metadata`, and nothing sets `document.title`. Confirmed against the
running server: `/`, `/jobs` and `/auth/login` all serve
`<title>NextHire — Signal-driven job matching</title>`.

Two failures follow. WCAG 2.4.2 *Page Titled* wants a title describing each page's topic or
purpose. And Next's App Router route announcer announces `document.title` on navigation — with an
identical title everywhere, a screen-reader user tabbing from a job card to the job page hears the
same string, which is indistinguishable from nothing happening.

**Fix.** Client pages cannot export `metadata`, but a *sibling server layout* can. Add one
`layout.tsx` per segment; no client page is touched.

```tsx
// app/jobs/layout.tsx  (server component — no "use client")
export const metadata = { title: "Open roles" };   // → "Open roles · NextHire" via the root template
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
```

```tsx
// app/jobs/[jobId]/layout.tsx
export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { title: true, company: { select: { name: true } } } });
  return { title: job ? `${job.title} at ${job.company?.name ?? "a company"}` : "Role" };
}
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
```

Marcy Sutton's user testing found that **moving focus to the `h1`** was the best-received route
change behaviour. Next's announcer plus a real title gets most of the way; if you want the focus
move too, `PageHeading` is the single place to do it — the `h1` already lives there.

```tsx
// in PageHeading
const h1 = React.useRef<HTMLHeadingElement>(null);
const pathname = usePathname();
React.useEffect(() => { h1.current?.focus(); }, [pathname]);
// <h1 ref={h1} tabIndex={-1} className="... focus:outline-none">
```

### 2.2 Live-region etiquette — three real problems

Sara Soueidan's rules: the region must exist in the DOM *before* content is injected, it must not
contain interactive or rich content, keep to about two per page, and compose the message fully
before inserting it.

- **`app/jobs/page.tsx:623`** puts `aria-live="polite"` on a `div` that contains the result count,
  the truncation note, the "Semantic match" eyebrow **and the "Clear filters" `<button>`**. A live
  region wrapping a control is the classic anti-pattern: the button is re-announced on every
  filter change, and its own state changes fight the region.
- **`app/applications/page.tsx:584`** and **`app/seeker/conversations/page.tsx:482`** put
  `aria-live="polite"` around the *entire list container*. Any change re-reads the whole list. The
  dashboard already discovered this and fixed it correctly — see the comment at
  `app/seeker/dashboard/page.tsx:883`, "`aria-busy` rather than a live region around the list
  itself". Apply that same fix to the other two.
- **`app/seeker/dashboard/page.tsx:736`** puts `aria-live="polite"` on a `<p>` whose content flips
  between `"Checking…"`, `"On file"` and `"Not uploaded yet"` — that one is fine and is the right
  shape (small, text-only, present on mount).

**Fix.** One hidden polite region per page, mounted from the start, plus `aria-busy` on the
container that is actually changing. Add it to the kit so pages stop inventing it:

```tsx
/** One polite announcer per page. Rendered empty on mount — a live region that
    appears at the same moment as its first message often does not announce. */
export function LiveStatus({ message }: { message: string }) {
  return <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{message}</p>;
}
```

Then `app/jobs/page.tsx` renders the visible count normally (no `aria-live`), and separately:

```tsx
<LiveStatus message={loading ? "" : `${visibleJobs.length} of ${facets.total} roles matched${semantic ? ", ranked by semantic relevance" : ""}.`} />
```

### 2.3 The filter selects: keep them native, fix what is actually broken

As stated in "what I would not do": no custom combobox. But two genuine defects:

1. **Counts in option text.** `FilterSelect` renders `{option.value} ({option.count})`
   (`app/jobs/page.tsx:872`). A screen reader reads "Berlin left parenthesis twelve right
   parenthesis". Use an en-dash-free, word-bearing form:
   `` `${option.value} — ${option.count} ${option.count === 1 ? "role" : "roles"}` `` — verbose in
   the dropdown, but the dropdown is the only place it appears, and it is the difference between
   punctuation noise and information.
2. **The "counts cover the corpus" caveat is disconnected from the controls it qualifies.** It is a
   sibling `<p>` at `app/jobs/page.tsx:661`. Wire it up with `aria-describedby` so a keyboard user
   landing on a select hears the caveat as part of the control, per the APG *Providing Accessible
   Names and Descriptions* practice:

```tsx
<p id="facet-caveat" className="eyebrow mt-3">Filter counts cover every open role, not just this search.</p>
// and on each FilterSelect:
<select id={id} aria-describedby={describedBy} ... />
```

### 2.4 `aria-describedby` on the match widgets

`MatchPanel` (`app/jobs/[jobId]/page.tsx:479`) ends with the right sentence — "It is guidance to
help you decide where to spend your time, not a decision" — as an unassociated `<p>`. A
screen-reader user who tabs to or queries the score never hears it. Associate it:

```tsx
<div ... aria-describedby="fit-caveat">
  <Readout ...>{match.score}</Readout>
</div>
...
<p id="fit-caveat" className="mt-5 border-t ...">Scored by comparing your profile with this posting. …</p>
```

Same treatment for the `Meter` in `JobCard` (`app/jobs/page.tsx:1174`) pointing at a single
page-level caveat node.

### 2.5 Touch targets

Covered in free wins. The kit's `.btn-touch` (44px, tightening to 40px at `md`) is a good
implementation of the *comfortable* target size; what is missing is the *minimum* for controls that
must stay small. `.hit-24` above closes that, and is what the two chip/dismiss buttons need.

---

## 3. Findability and flow

The feed is already better than most job boards on the hard parts: server-side facet counts, an
honest caveat that counts describe the corpus not the result set, exact-span chip removal, two
distinct empty states, and a `truncated` flag. These are refinements, not a rebuild.

### 3.1 Applied-filter chips for the three selects

**What.** Render a removable chip for each *active select*, in the same strip as the inferred query
chips, so all applied criteria are visible in one place and removable in one click.

**Why.** Baymard's applied-filters research: 42% of sites get this wrong, and showing applied
filters in *only* one position (either in situ or in an overview) caused users to overlook filters,
struggle to deselect them, or misunderstand what the list was filtered by. The recommendation is
**both**: the select keeps showing its value, *and* an overview strip shows the full applied set.
Today only the inferred chips get the overview treatment, which is backwards — the selects are the
filters the user set deliberately.

**Where.** `app/jobs/page.tsx`, in the `showSearchNotes` section (~line 545).

**Roughly:**

```tsx
const appliedChips = [
  filters.location   && { key: "location"   as const, label: filters.location },
  filters.experience && { key: "experience" as const, label: `${filters.experience} yrs` },
  filters.type       && { key: "type"       as const, label: filters.type },
].filter(Boolean);

{appliedChips.length > 0 && (
  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    <Eyebrow as="span">Filtered by</Eyebrow>
    {appliedChips.map((c) => (
      <Chip key={c.key} icon={<Icon.filter className="h-3.5 w-3.5" aria-hidden="true" />}
            onRemove={() => setFilters((f) => ({ ...f, [c.key]: "" }))}
            removeLabel={`Remove the ${c.label} filter`}>
        {c.label}
      </Chip>
    ))}
  </div>
)}
```

Note the visual distinction that already exists and should be kept: inferred chips (`Read as`)
carry `Icon.filter` and describe *what the server understood*; applied chips describe *what the
user chose*. Two eyebrows — `Read as` / `Filtered by` — keep that honest.

### 3.2 URL-shareable state

**What.** The page reads `?q=` and `?location=` **once** as seed state
(`app/jobs/page.tsx:189–191`) and never writes back. So a filtered feed cannot be bookmarked,
shared, or reloaded; back/forward does nothing useful; and `sort` was deliberately kept out of the
URL.

**Why.** This is the plumbing under three separate features. Support ("send me the link you're
looking at"), the saved-search flow (which currently rebuilds an approximation of the state from
`chips` + `filters` at `app/jobs/page.tsx:1063`), and plain expectation — a list view whose state
is not in the URL is a broken back button.

**Where.** `app/jobs/page.tsx`.

**Roughly** — one effect, `replaceState` so it does not flood history on every keystroke:

```tsx
const router = useRouter();
useEffect(() => {
  const next = new URLSearchParams();
  if (search) next.set("q", search);
  if (filters.location) next.set("location", filters.location);
  if (filters.experience) next.set("experience", filters.experience);
  if (filters.type) next.set("type", filters.type);
  if (sort) next.set("sort", sort);
  const qs = next.toString();
  router.replace(qs ? `/jobs?${qs}` : "/jobs", { scroll: false });
}, [search, filters, sort, router]);
```

Seed `filters.experience`, `filters.type` and `sort` from `searchParams` alongside the two already
read. `savedSearchFilters` then becomes a read of the same object rather than a reconstruction.

### 3.3 "No results" recovery that names the culprit

**What.** The current dead-end copy is already good — it counts the corpus and offers "Clear
filters". Go one step further: tell the user **which single filter to relax**, because the server
already knows.

**Why.** NN/g: prevent zero-results dead ends with dynamic facets. "Clear filters" throws away four
decisions to fix one. The `facets` payload is counted "server-side over every active posting,
narrowed by the *other* two selects" (per the comment at `app/jobs/page.tsx:96`) — which means a
facet option showing a non-zero count while the result set is empty is exactly the diagnostic
needed.

**Where.** `app/jobs/page.tsx`, the `EmptyState` at ~line 683.

**Roughly:**

```tsx
/** The one filter whose removal would yield the most results. */
function widestRelaxation(filters: Filters, facets: FeedFacets) {
  const candidates = [
    filters.location   && { key: "location"   as const, label: filters.location,   n: facets.total - countFor(facets.location, filters.location) },
    filters.experience && { key: "experience" as const, label: filters.experience, n: facets.total - countFor(facets.experience, filters.experience) },
    filters.type       && { key: "type"       as const, label: filters.type,       n: facets.total - countFor(facets.type, filters.type) },
  ].filter(Boolean);
  return candidates.sort((a, b) => b.n - a.n)[0] ?? null;
}
```

```tsx
action={
  <div className="flex flex-wrap justify-center gap-2">
    {relax && (
      <button type="button" className={buttonPrimary}
        onClick={() => setFilters((f) => ({ ...f, [relax.key]: "" }))}>
        Drop “{relax.label}” — {relax.n} more {relax.n === 1 ? "role" : "roles"}
      </button>
    )}
    <button type="button" onClick={clearFilters} className={buttonSecondary}>Clear all filters</button>
  </div>
}
```

### 3.4 Result count: say what changed, not just what there is

Small but real. The count strip reads `12 ROLES MATCHED / 340 OPEN ROLES`. After a filter change,
the more useful sentence is the delta — "12 roles, down from 34". Two lines of state
(`useRef(previousCount)`), and it turns a static readout into feedback that the control did
something. Pairs naturally with the `LiveStatus` region from §2.2 so the same sentence is what a
screen-reader user hears.

---

## 4. Explaining AI output

This is the hardest part of the product and the section I would fund first. The existing copy is
notably good — "Fit is a sorting aid, not an assessment. It reads the profile against the posting
and knows nothing else about the person" (`app/applications/page.tsx:544`) is better than anything
the major job boards ship. The problem is that the *numbers* do not live up to the *words*.

### The regulatory frame, briefly

- **NYC Local Law 144** requires that candidates be given **at least 10 business days' notice** that
  an automated employment decision tool will be used, either directly or in the job posting, and
  that the notice state **the attributes the tool assesses** and **how to request an alternative
  selection process or accommodation**. Penalties are per-day and per-failure.
- **EU AI Act**: recruitment, candidate evaluation and targeted job advertising are Annex III
  high-risk. **Article 86** gives an affected person the right to request an explanation of the
  role the AI played in the decision and the main elements of the decision taken. Full Annex III
  obligations bite 2 December 2027.
- **ICO / Alan Turing Institute, "Explaining decisions made with AI"** — whose *workbook use case
  1 is literally an AI-assisted recruitment tool* — sets out six explanation types: **rationale,
  responsibility, data, fairness, safety & performance, impact**, and recommends delivering them
  **in layers** rather than as one wall of text.

Nothing below is legal advice, and NextHire is a marketplace rather than the employer — but the
design should be able to survive being pointed at by either regime, and the layered-explanation
structure is simply good UX independent of that.

### 4.1 Wire up the rationale sentence (top-5 #1)

`lib/ai/explain.ts` produces one grounded sentence per `(userId, jobId)`, cached and invalidated by
`contentHash`, with the strong property documented in its own header: *the model never sees the CV
or the posting — its whole input is the `MatchBreakdown`*, so it cannot assert an overlap the score
does not contain. `POST /api/ai/explain` guards it seeker-only and always about the caller's own
match. And **nothing calls it.**

This is the ICO's *rationale* explanation, already built and already safe. Put it at the top of
`MatchPanel`, fetched lazily so the page paints first (the same pattern `SimilarRoles` already
uses at `app/jobs/[jobId]/page.tsx:585`).

```tsx
function MatchRationale({ jobId }: { jobId: string }) {
  const [state, setState] = useState<{ text: string } | "loading" | null>("loading");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<{ text: string; score: number }>("/api/ai/explain", {
          method: "POST", body: JSON.stringify({ jobId }),
        });
        if (!cancelled) setState(data);
      } catch { if (!cancelled) setState(null); }   // degrade to silence, as SimilarRoles does
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  if (state === null) return null;
  if (state === "loading") return <SkeletonText lines={2} />;
  return (
    <p className="mb-4 border-b border-gray-200 pb-4 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:text-gray-300">
      <Eyebrow as="span" accent className="mr-2 inline-flex items-center gap-1">
        <Icon.spark className="h-3.5 w-3.5" aria-hidden="true" />Why
      </Eyebrow>
      {state.text}
    </p>
  );
}
```

Two design notes. **Label it as generated** — the `Icon.spark` glyph is already the kit's
AI affordance and the eyebrow marks it as machine output rather than editorial copy. And **the
sentence should sit above the numbers, not below**: prose is what a person reads first, and the
facets are the receipts for it.

### 4.2 Make the facet breakdown faithful (top-5 #3)

`MATCH_WEIGHTS` is `{ semantic: 0.70, skills: 0.18, location: 0.07, seniority: 0.05 }`. The panel
draws four identical-looking `MeterRow`s. A reader concludes the four things matter roughly
equally. They do not — semantic similarity is nearly four times skills overlap and fourteen times
seniority.

This matters beyond aesthetics: the breakdown's entire purpose is to be the honest answer to "where
did this number come from", and an explanation that misstates the weighting is worse than no
breakdown, because it is *convincing* and wrong. It also misdirects action: a seeker who sees
"Skills overlap 40%" and adds skills to their profile will barely move the headline.

The `MeterRow` `weight` prop from §1.2 is the whole fix:

```tsx
<MeterRow label="Semantic fit"  value={match.facets.semantic}  weight={MATCH_WEIGHTS.semantic} />
<MeterRow label="Skills overlap" value={match.facets.skills}   weight={MATCH_WEIGHTS.skills} />
<MeterRow label="Location"       value={match.facets.location} weight={MATCH_WEIGHTS.location} />
<MeterRow label="Seniority"      value={match.facets.seniority} weight={MATCH_WEIGHTS.seniority} />
```

`MATCH_WEIGHTS` lives in `lib/ai/config.ts`, which is Prisma-free — so unlike `MatchBreakdown` it
can be imported into the client directly rather than mirrored.

### 4.3 A layered "How this was worked out" disclosure (top-5 #3 companion)

**What.** A `<details>` under `MatchPanel` covering the ICO's other five explanation types in one
short, plain-language panel. Collapsed by default; the score and rationale are layer one, this is
layer two.

**Why.** ICO/Turing layered delivery; NYC LL144's requirement that the notice state *the attributes
assessed* and *how to request an alternative*; EU AI Act Art. 86's "main elements of the decision".
All of it is information we already have — none of this needs new backend work.

**Where.** `app/jobs/[jobId]/page.tsx`, inside `MatchPanel`.

**Roughly:**

```tsx
<details className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
  <summary className="eyebrow btn-touch cursor-pointer list-none">How this was worked out</summary>
  <dl className="mt-3 space-y-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
    {/* data */}
    <div><Eyebrow as="dt">What it read</Eyebrow>
      <dd>Your headline, skills, years of experience and location, and the text of this posting. Nothing else — not your name, photo, age, or anything you have not put on your profile.</dd></div>
    {/* rationale / safety & performance */}
    <div><Eyebrow as="dt">How the number is made</Eyebrow>
      <dd>A weighted blend: semantic similarity {Math.round(MATCH_WEIGHTS.semantic * 100)}%, skills overlap {Math.round(MATCH_WEIGHTS.skills * 100)}%, location {Math.round(MATCH_WEIGHTS.location * 100)}%, seniority {Math.round(MATCH_WEIGHTS.seniority * 100)}%. It is a ranking aid — use it to compare roles against each other, not as a measure of how likely you are to be hired.</dd></div>
    {/* responsibility / impact */}
    <div><Eyebrow as="dt">What it decides</Eyebrow>
      <dd>Nothing. It orders your feed. It does not filter you out of anything, is not sent to the company as a recommendation, and no application is accepted or rejected because of it. A person at the company reads every application.</dd></div>
    {/* fairness */}
    <div><Eyebrow as="dt">If it looks wrong</Eyebrow>
      <dd><Link href="/seeker/profile/edit" className="underline underline-offset-2">Update your profile</Link> and it is rescored, or <Link href="/support" className="underline underline-offset-2">tell us</Link> — we read every report.</dd></div>
  </dl>
</details>
```

Two things this deliberately does **not** claim: no accuracy percentage (we do not measure one) and
no model name or version. The existing "Signal v1" eyebrow with its comment — "Our own scoring
revision, not a model version — inventing one would be a claim we cannot stand behind" — is exactly
the right instinct and should stay.

### 4.4 Rank, not magnitude

**What.** Where the score is used to *order a list* (the feed, the dashboard "Matched to you"),
prefer ordinal framing: "3rd closest of 24 roles scored for you" rather than or alongside "74/100".

**Why.** The number is monotone in cosine, so **rank order is meaningful even though magnitude is
not**. That is the precise, defensible claim, and it is exactly what PAIR's "N-best alternatives"
method is for — showing several options and prompting the user to apply their own judgement rather
than treating one figure as a verdict. It also happens to be the truthful description of what the
product does: sort your feed.

`app/seeker/dashboard/page.tsx:788` already says "Open roles scored against your profile, strongest
fit first" — good. Extend it to the card level so the ordinal is visible per row, and the
comparison the user is invited to make is between roles rather than against 100.

### 4.5 One caveat, one place

There are currently three differently-worded honesty caveats: `app/jobs/[jobId]/page.tsx:563`
(seeker side), `app/applications/page.tsx:544` (employer side), and the `Similar roles` disclaimer
at `:620`. They agree, which is lucky rather than structural. Move the text into `lib/copy.ts` (or
constants beside `MATCH_WEIGHTS`) so a change lands everywhere at once — the same argument the
codebase already made for `BADGE_BASE` in `ui.tsx:535`.

---

## 5. Performance as UX

### 5.1 The structural finding

**Every page in `app/` is `"use client"` — 23 of 23.** There is one `layout.tsx`. There is one
`loading.tsx`, at the root, and one `error.tsx`. Fetched from the running server, `/jobs` ships a
40KB HTML document whose only meaningful content is the page shell and the word "Loading jobs"; the
entire feed, including the search bar's options, arrives after hydration and a client `fetch`.

So: **the Next.js 15 streaming story is unavailable to this app by construction.** Suspense
boundaries, `loading.tsx` per route and streamed server components all require server components to
stream. Recommending "add Suspense boundaries" without saying that first would be advice that
cannot be followed.

That does not make it unfixable, and it does not require a rewrite. The pattern is to **hoist the
first paint to the server and keep the interactive parts as client children**:

```tsx
// app/jobs/page.tsx  — becomes a server component
import { Suspense } from "react";
export default function JobsPage() {
  return (
    <FeedShell>                         {/* static: heading, chrome — streams immediately */}
      <Suspense fallback={<FilterBarSkeleton />}>
        <FilterBar />                   {/* server: facets come from Prisma, no round-trip */}
      </Suspense>
      <Suspense fallback={<JobSkeletonGrid />}>
        <JobFeed />                     {/* server: first page of results, pre-rendered */}
      </Suspense>
    </FeedShell>
  );
}
```

`JobsFeed`'s interactive state (debounced search, sort, chip removal) stays in a client child that
receives the server-rendered first page as props. The facets in particular are pure server data —
they are counted in Prisma already, and there is no reason a user waits for hydration plus a network
round-trip to see "All locations".

**Effort: L.** This is a real refactor of `app/jobs/page.tsx` (1225 lines) and I would scope it to
the feed alone first, measure, and only then decide whether the dashboard is worth the same
treatment. It is not in my top 5 for that reason — the payoff is large but so is the risk, and
proposals 1–5 are all days rather than weeks.

### 5.2 Per-route `loading.tsx` — available *today*, even with client pages

`app/loading.tsx` is a full-screen centred spinner on a `min-h-screen` field. It is shown on every
navigation to every route, and it replaces the whole page including the navbar — which is both a
layout shift and a loss of orientation.

Even before §5.1, per-segment `loading.tsx` files are worth adding, because they are what Next shows
during the server work for that segment and they can render the *real* shell:

```tsx
// app/jobs/loading.tsx
import Navbar from "@/app/components/Navbar";
import { PageHeading, SkeletonRows } from "@/app/components/ui";
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading eyebrow="Live job feed" title="Open roles" className="mb-6" />
        <JobSkeletonGrid />
      </main>
    </div>
  );
}
```

Note this is also where the `layout.tsx` files from §2.1 pay a second dividend: adding a segment
layout for the title is a prerequisite for a meaningful segment loading state.

### 5.3 Optimistic UI with React 19

React 19 is already a dependency and `useOptimistic` is unused. Three interactions are textbook
cases — the action is high-confidence, the server response carries no new information, and the
current implementation makes the user watch a spinner:

- **Application status change** (`app/applications/page.tsx:331`) — the badge should flip
  immediately and roll back on failure.
- **Withdrawing an application** (`app/seeker/dashboard/page.tsx`, `withdrawingId`).
- **Saving a search** (`app/jobs/page.tsx` `SaveSearchPanel`) — the "Saved — manage your alerts"
  state can render optimistically.

```tsx
const [optimistic, setOptimistic] = useOptimistic(
  applications,
  (state: Application[], change: { id: string; status: ApplicationStatus }) =>
    state.map((a) => (a.id === change.id ? { ...a, status: change.status } : a))
);

const changeStatus = (id: string, status: ApplicationStatus) =>
  startTransition(async () => {
    setOptimistic({ id, status });
    await apiFetch(`/api/applications/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  });
```

`useOptimistic` discards the temporary state automatically if the transition fails, which is the
part that is usually written badly by hand. Keep the existing toast on both success and failure —
an optimistic update that silently reverts is worse than a spinner.

### 5.4 Layout shift

Three specific sources, in order of severity:

1. **Spinner-for-list swaps** (§1.4). A `px-6 py-12` centred spinner replaced by a 600px list is a
   large CLS event on every load of `/applications` and `/seeker/dashboard`.
2. **`MatchScore` appearing after the rest of the card.** In `JobCard` the score sits in a
   right-hand column that is empty for anonymous visitors and non-empty for indexed seekers, and the
   `Meter` is appended at the bottom of the card. Reserve the space with `min-h` on the score slot
   so cards are the same height regardless of match availability — currently a two-column grid
   where some cards have matches and some do not produces ragged row heights.
3. **`SimilarRoles`** renders `null` until data arrives, then inserts a whole section
   (`app/jobs/[jobId]/page.tsx:598`). The comment argues it is "a decoration" and every degraded
   path should look like nothing — which is right — but the *successful* path then shoves the
   footer down after the page has settled. Reserve the height once a fetch is in flight and
   collapse it only on the empty/error result.

### 5.5 A Tailwind v4 note

Two v4 features would simplify existing code rather than add anything:

- **`@container`** for `JobCard`. The card renders in a 1-col grid on mobile, 2-col on `lg`, and in
  the 3-col `xl` grid on the dashboard — three different widths for one component, currently
  handled with viewport breakpoints that are wrong in at least one of the three. A container query
  on the card makes its internal layout depend on its own width, which is what it actually depends
  on.
- **`text-pretty`** on `JobCard`'s description and `PageHeading`'s `description`, and
  `text-balance` on the `h1`/`h2`. Free typographic quality on a design that is otherwise precise
  about type.

I would *not* touch the `@theme` structure. The non-`inline` colour block and the `.dark`
re-tuning of `--color-gray-500` are a genuinely clever solution to per-theme ramp adjustment, and
the comments explaining why are the best documentation in the repository.

---

## Sources

- [WAI-ARIA Authoring Practices — Select-Only Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)
- [WAI-ARIA APG — Communicating Value and Limits for Range Widgets](https://www.w3.org/WAI/ARIA/apg/practices/range-related-properties/)
- [WAI-ARIA APG — Providing Accessible Names and Descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
- [Understanding WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Understanding WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- [MDN — ARIA meter role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/meter_role)
- [MDN — aria-valuetext](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-valuetext)
- [Sara Soueidan — Accessible notifications with ARIA live regions, part 2](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2/)
- [Heydon Pickering, Inclusive Components — Toggle Button](https://inclusive-components.design/toggle-button/)
- [Deque — Accessibility tips in single-page applications](https://www.deque.com/blog/accessibility-tips-in-single-page-applications/) (Marcy Sutton's focus-the-`h1` finding)
- [Nielsen Norman Group — Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)
- [Nielsen Norman Group — Filters and Sorting: The Complete Design Guide](https://www.nngroup.com/contents/self-paced-courses/filters-and-sorting-the-complete-design-guide/)
- [Rettig et al., "The effect of skeleton screens", ECCE 2018](https://dl.acm.org/doi/10.1145/3232078.3232086)
- [Baymard Institute — How to Design "Applied Filters" (42% Get It Wrong)](https://baymard.com/blog/applied-filters)
- [Baymard Institute — Be Careful with Horizontal Filtering Toolbars](https://baymard.com/blog/horizontal-filtering-sorting-design)
- [Google PAIR People + AI Guidebook — Explainability + Trust](https://pair.withgoogle.com/chapter/explainability-trust/)
- [Microsoft HAX Toolkit — Guideline 2: Make clear how well the system can do what it can do](https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-how-well-the-system-can-do-what-it-can-do/)
- [Microsoft HAX Toolkit — Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/)
- [ICO — Explaining decisions made with AI](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/explaining-decisions-made-with-artificial-intelligence/)
- [ICO / Alan Turing Institute — Explaining decisions made with AI: A workbook (use case 1: AI-assisted recruitment tool)](https://arxiv.org/pdf/2104.03906)
- [NYC DCWP — Automated Employment Decision Tools (Local Law 144)](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page)
- [NYC Rules — Automated Employment Decision Tools](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/)
- [EU AI Act — Article 86: Right to Explanation of Individual Decision-Making](https://artificialintelligenceact.eu/article/86/)
- [EU AI Act — What the Act means for staffing businesses](https://artificialintelligenceact.eu/what-the-act-means-for-staffing-businesses/)
- [Carbon Design System — Tag usage](https://carbondesignsystem.com/components/tag/usage/) and [Tag accessibility](https://carbondesignsystem.com/components/tag/accessibility/)
- [Shopify Polaris — Filters](https://polaris.shopify.com/components/filters)
- [GOV.UK Design System — Components](https://design-system.service.gov.uk/components/)
- [Next.js — Partial Prerendering](https://nextjs.org/docs/15/app/getting-started/partial-prerendering)
- [React v19 release notes](https://react.dev/blog/2024/12/05/react-19) (`useOptimistic`, `useActionState`, `useFormStatus`)
- [Tailwind CSS v4.0](https://tailwindcss.com/blog/tailwindcss-v4)
