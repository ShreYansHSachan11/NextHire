"use client";

import React from "react";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/validation";

/* ==========================================================================
   NextHire UI kit — "signal"
   --------------------------------------------------------------------------
   A precise, instrument-panel language: hairline rules, a cool slate-navy
   neutral ramp, monospace for machine-generated values, and a single emerald
   accent reserved for match quality and live state. The tokens and utility
   classes these compose (`.panel`, `.chip`, `.meter`, `.eyebrow`, `.btn-ink`)
   live in `app/globals.css`.

   --------------------------------------------------------------------------
   THE FOUR THINGS A PAGE NEEDS TO KNOW

   1. ELEVATION. Four rungs, and a page picks one rather than adding a shadow
      utility. `<Card elevation="…">`, or the bare strings `surfaceSunken` /
      `surfaceFlat` / `surfaceRaised` / `surfaceOverlay`.

        sunken   a well content sits *in* — an inset list, an empty field
        flat     the default card (this is `<Card>`'s default)
        raised   a panel on a panel, or the lead card of a page
        overlay  popovers, dropdowns, toasts, dialogs

      In dark mode each rung is a *lighter* surface, not a bigger shadow. Never
      reach for `shadow-lg` to make something stand out — move it a rung.

   2. STATES. Anything interactive that is not a button gets `interactiveSurface`
      ("interactive"). It supplies rest / hover / press / selected / disabled
      from one ramp, and it reads `disabled`, `aria-disabled`, `aria-selected`,
      `aria-current` and `data-selected` straight off the element — so the state
      a screen reader hears and the state the eye sees are the same fact. Do not
      write `hover:bg-gray-100 dark:hover:bg-gray-800` again. For a list row,
      `rowInteractive` adds the shared dense-row geometry, and `rowSelected` adds
      the leading accent rule.

   3. FOCUS. Already handled, globally, by one unlayered `:focus-visible` rule.
      Do not add `focus:outline-none`, and do not add a `focus-visible:ring-*` —
      both produce a second, differently-coloured indicator on top of the real
      one.

   4. DENSITY. The rhythm is `--space-1…9` and `--control-h-sm/md/lg` in
      globals.css, documented there. Buttons take `size`, fields take
      `inputSmall`, chips take `size="sm"`. Reach for those before inventing a
      `py-[7px]`.
   ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Icons                                                                       */
/* -------------------------------------------------------------------------- */

type IconProps = { className?: string };

/**
 * Shared icon set, drawn on a 24px grid at 1.75 stroke so it sits correctly
 * next to the tight display type. The briefcase in particular was previously
 * copy-pasted into eight places with a malformed path (`a2 2 0 00-2-2v2`
 * opened a stray sub-path), which rendered a broken glyph everywhere.
 */
const stroke = { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.75 } as const;

function make(path: React.ReactNode) {
  return function IconComponent({ className = "w-5 h-5" }: IconProps) {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {path}
      </svg>
    );
  };
}

export const Icon = {
  briefcase: make(
    <>
      <path {...stroke} d="M16 6V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v1" />
      <path {...stroke} d="M4 13.3A24 24 0 0 0 12 15c2.8 0 5.5-.5 8-1.4" />
      <rect {...stroke} x="4" y="6" width="16" height="14" rx="2" />
    </>
  ),
  location: make(
    <>
      <path {...stroke} d="M17.7 16.7 13.4 20.9a2 2 0 0 1-2.8 0l-4.3-4.2a8 8 0 1 1 11.4 0Z" />
      <circle {...stroke} cx="12" cy="11" r="3" />
    </>
  ),
  clock: make(<path {...stroke} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />),
  money: make(
    <path
      {...stroke}
      d="M12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2m0-8c1.1 0 2.1.4 2.6 1M12 8V7m0 1v8m0 0v1m0-1c-1.1 0-2.1-.4-2.6-1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    />
  ),
  chat: make(
    <path
      {...stroke}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4.3-.9L3 20l1.4-3.7A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z"
    />
  ),
  document: make(
    <path
      {...stroke}
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.6a1 1 0 0 1 .7.3l5.4 5.4a1 1 0 0 1 .3.7V19a2 2 0 0 1-2 2Z"
    />
  ),
  user: make(<path {...stroke} d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" />),
  plus: make(<path {...stroke} d="M12 6v12m6-6H6" />),
  check: make(<path {...stroke} d="m5 13 4 4L19 7" />),
  checkCircle: make(<path {...stroke} d="m9 12 2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />),
  x: make(<path {...stroke} d="M6 18 18 6M6 6l12 12" />),
  warning: make(
    <path
      {...stroke}
      d="M12 9v2m0 4h.01M5.06 19h13.86c1.54 0 2.5-1.67 1.73-2.5L13.73 4c-.77-.83-1.96-.83-2.73 0L3.73 16.5c-.77.83.19 2.5 1.73 2.5Z"
    />
  ),
  badge: make(<path {...stroke} d="M8 7V3m8 4V3M7 11h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />),
  arrowLeft: make(<path {...stroke} d="M15 19l-7-7 7-7" />),
  arrowRight: make(<path {...stroke} d="M9 5l7 7-7 7" />),
  /** Diagonal "open/launch" arrow, as on the reference's Apply button. */
  arrowUpRight: make(<path {...stroke} d="M7 17 17 7m0 0H8m9 0v9" />),
  edit: make(
    <path
      {...stroke}
      d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.4-9.4a2 2 0 1 1 2.8 2.8L11.8 15H9v-2.8l8.6-8.6Z"
    />
  ),
  trash: make(
    <path
      {...stroke}
      d="M19 7l-.9 12.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
    />
  ),
  search: make(<path {...stroke} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />),
  send: make(<path {...stroke} d="M12 19l9 2-9-18-9 18 9-2Zm0 0v-8" />),
  logout: make(<path {...stroke} d="M17 16l4-4m0 0-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />),
  bell: make(
    <path
      {...stroke}
      d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
    />
  ),
  upload: make(<path {...stroke} d="M7 16a4 4 0 0 1-.9-7.9A5 5 0 0 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0-3 3m3-3v12" />),
  external: make(<path {...stroke} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />),
  /** Node-graph glyph — the product mark for AI/matching surfaces. */
  graph: make(
    <>
      <circle {...stroke} cx="6" cy="7" r="2.2" />
      <circle {...stroke} cx="18" cy="6" r="2.2" />
      <circle {...stroke} cx="12" cy="17" r="2.2" />
      <path {...stroke} d="M7.7 8.5 10.6 15m3-.3L16.6 8M8.2 7.2h7.6" />
    </>
  ),
  /** Sparkle, for AI-generated affordances. */
  spark: make(
    <path
      {...stroke}
      d="M12 3.5 13.5 8 18 9.5 13.5 11 12 15.5 10.5 11 6 9.5 10.5 8 12 3.5ZM18.5 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"
    />
  ),
  /** Activity/pulse line, used beside a match score. */
  pulse: make(<path {...stroke} d="M3 12h3.5L9 5l4 14 2.6-7H21" />),
  filter: make(<path {...stroke} d="M4 5h16M7 12h10M10 19h4" />),
  /** Saved searches and job alerts. */
  bookmark: make(<path {...stroke} d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4V5Z" />),
  /** Hamburger, so the navbar stops hand-rolling its own SVG. */
  menu: make(<path {...stroke} d="M4 7h16M4 12h16M4 17h16" />),
  /* ---- Added for the restyle. Same 24px grid, same 1.75 stroke. ---------- */
  chevronDown: make(<path {...stroke} d="m6 9 6 6 6-6" />),
  chevronRight: make(<path {...stroke} d="m9 6 6 6-6 6" />),
  /** Explanatory footnote / "how this was worked out". */
  info: make(<path {...stroke} d="M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />),
  /** Re-run, re-score, try again — the recovery action on a dead end. */
  refresh: make(<path {...stroke} d="M4 5v5h5M20 19v-5h-5M19.4 9A8 8 0 0 0 5.6 6.6L4 8m0 8a8 8 0 0 0 13.8 2.4L20 16" />),
  calendar: make(<path {...stroke} d="M8 3v3m8-3v3M4 10h16M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />),
  building: make(
    <>
      <path {...stroke} d="M4 21V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M13 10h6a1 1 0 0 1 1 1v10M3 21h18" />
      <path {...stroke} d="M7 9h2M7 13h2M7 17h2M16 14h1M16 17h1" />
    </>
  ),
  link: make(<path {...stroke} d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.2 19" />),
  /** Saved / starred, distinct from the bookmark used for alerts. */
  star: make(<path {...stroke} d="m12 3.8 2.6 5.2 5.8.8-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7L3.6 9.8l5.8-.8L12 3.8Z" />),
};

/* -------------------------------------------------------------------------- */
/* Typographic primitives                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Small uppercase monospace label. Used for section eyebrows and any
 * machine-generated caption ("GRAPH CONFIDENCE", "4 MATCHES FOR YOUR PROFILE").
 */
export function Eyebrow({
  children,
  accent,
  className = "",
  as: Tag = "p",
  ...rest
}: {
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
  as?: "p" | "span" | "div" | "h2" | "h3" | "dt";
  // Takes the rest of the HTML attributes so an eyebrow can be the target of an
  // `aria-describedby` — a caveat set as an eyebrow is exactly the kind of text
  // that should be wired to the control it qualifies rather than left floating.
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag {...rest} className={`eyebrow ${accent ? "eyebrow-accent" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

/** Numeric readout in mono with tabular figures, so digits don't jitter. */
export function Readout({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children" | "className">) {
  return (
    <span {...rest} className={`readout ${className}`}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a surface sits on the elevation ladder. The tokens and the reasoning
 * live in `globals.css`; in short:
 *
 *   sunken  — a well the content sits *in* (an inset list, an empty field)
 *   flat    — the default card. One step of separation from the canvas
 *   raised  — a panel on a panel, or the lead card of a page
 *   overlay — popovers, dropdowns, toasts: things that float over everything
 *
 * Four rungs, because four is what Carbon ships and what Material calls
 * "deliberately limited to just a handful of levels". Resist a fifth.
 */
export type Elevation = "sunken" | "flat" | "raised" | "overlay";

const ELEVATION_CLASS: Record<Elevation, string> = {
  sunken: "panel-sunken",
  flat: "panel",
  raised: "panel panel-raised",
  overlay: "panel-overlay",
};

export function Card({
  children,
  className = "",
  /** Emerald hairline + faint tint, for a selected or high-signal item. */
  signal = false,
  /** Lays graph-paper rules behind the content, for telemetry panels. */
  grid = false,
  /** Where this card sits on the elevation ladder. Defaults to the base card. */
  elevation = "flat",
  /**
   * The whole card is a target. Adds the shared hover/press treatment — lift a
   * tier on hover, settle on press — instead of each surface inventing its own
   * `hover:border-gray-300 dark:hover:border-gray-600`.
   */
  interactive = false,
  /** `article`/`li`/`section` where the surrounding markup calls for it. */
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  signal?: boolean;
  grid?: boolean;
  elevation?: Elevation;
  interactive?: boolean;
  as?: "div" | "article" | "section" | "li" | "aside";
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag
      {...rest}
      className={`${ELEVATION_CLASS[elevation]} ${interactive ? "panel-interactive" : ""} ${
        signal ? "panel-signal" : ""
      } ${grid ? "grid-field" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  eyebrow,
  action,
  /** Lets a page keep a sane h1 → h2 → h3 order without restyling the header. */
  headingLevel = 2,
  /** Drops to the dense row rhythm, for a header above a tight list. */
  compact = false,
  className = "",
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  compact?: boolean;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700 ${
        compact ? "px-4 py-2.5" : "px-4 py-4 sm:px-6"
      } ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <Heading className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
          {title}
        </Heading>
        {description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The signature telemetry strip: an icon tile with a live dot, a mono status
 * line, a sparkline and a big readout. Used for "AI match graph active" style
 * summaries at the top of a dashboard or feed.
 */
export function SignalPanel({
  title,
  detail,
  live = false,
  value,
  valueLabel,
  bars,
  className = "",
  headingLevel = 3,
}: {
  title: string;
  detail?: string;
  live?: boolean;
  value?: string;
  valueLabel?: string;
  /** 0–1 heights for the sparkline. Falls back to a fixed, calm pattern. */
  bars?: number[];
  className?: string;
  /** The panel often sits directly under an h1, where an h3 would skip a level. */
  headingLevel?: 2 | 3 | 4;
}) {
  const series = bars ?? [0.35, 0.5, 0.42, 0.68, 0.55, 0.82, 0.7, 0.95, 0.6];
  const Heading = `h${headingLevel}` as const;

  return (
    <div className={`panel grid-field flex flex-wrap items-center gap-4 p-3 sm:p-4 ${className}`}>
      {/* `.tile-accent` rather than six colour utilities: the empty-state tile
          was the same shape with a different set of them, and they had drifted. */}
      <span className="tile tile-accent relative h-10 w-10 flex-shrink-0">
        <Icon.spark className="h-5 w-5" />
        {live && <span className="dot-live absolute -right-1 -top-1" />}
      </span>

      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-sm font-semibold text-gray-900 dark:text-white">{title}</Heading>
          {live && <Eyebrow as="span" accent>LIVE</Eyebrow>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">{detail}</p>}
      </div>

      {(value || bars) && (
        <div className="flex items-end gap-4">
          <div className="flex h-8 items-end gap-[3px]" aria-hidden="true">
            {series.map((height, index) => (
              <span
                key={index}
                className="w-[3px] rounded-sm bg-green-500/70 dark:bg-green-400/70"
                style={{ height: `${Math.max(12, height * 100)}%` }}
              />
            ))}
          </div>
          {value && (
            <div className="text-right">
              <Readout className="block text-lg font-semibold leading-none sm:text-xl">{value}</Readout>
              {valueLabel && <Eyebrow className="mt-1">{valueLabel}</Eyebrow>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function Spinner({
  className = "h-8 w-8",
  label,
  /**
   * Drops the `role="status"` wrapper and the text. For a spinner inside a
   * control that already announces itself (a button with `aria-busy`), the
   * extra live region just says "Loading" over the top of the real label.
   */
  decorative = false,
}: {
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const circle = (
    <span
      className={`inline-block rounded-full border-2 border-gray-300 border-t-green-500 motion-safe:animate-spin dark:border-gray-700 dark:border-t-green-400 ${className}`}
      aria-hidden="true"
    />
  );

  if (decorative) return circle;

  return (
    <span className="inline-flex flex-col items-center gap-2" role="status">
      {circle}
      <span className={label ? "eyebrow" : "sr-only"}>{label ?? "Loading"}</span>
    </span>
  );
}

/**
 * Placeholder block for content that has not arrived yet. Sized by the caller;
 * inert to assistive tech, so pair it with an `sr-only` "Loading …" where the
 * wait is worth announcing.
 *
 * The fill and the pulse are the `.skeleton` component class rather than
 * `bg-gray-200 dark:bg-gray-700`, because three surfaces were hand-rolling that
 * pair and had drifted to three different greys.
 */
export function Skeleton({
  className = "h-4 w-full",
  /** Corner treatment, so a skeleton can stand in for an avatar or a pill. */
  rounded = "rounded",
}: {
  className?: string;
  rounded?: string;
}) {
  return <span className={`skeleton ${rounded} ${className}`} aria-hidden="true" />;
}

/*
 * The shapes below exist because `<Skeleton>` had exactly one call site against
 * 53 `<Spinner>`s, while two pages hand-rolled their own list placeholders out
 * of raw divs. NN/g's split is the rule they are built for: spinners for short
 * blocking actions (submitting, auth), skeletons wherever content is being
 * fetched and layout context matters (feeds, dashboards, panels). Rettig et
 * al. (ECCE 2018) found skeleton screens scored higher on both perceived speed
 * and perceived ease of navigation than spinners.
 *
 * Each one is sized to occupy roughly the height of the real content, which is
 * the other half of the point: a centred spinner in a `py-12` box replaced by a
 * 600px list is a large layout shift on every load.
 *
 * Refs: https://www.nngroup.com/articles/skeleton-screens/
 *       https://dl.acm.org/doi/10.1145/3232078.3232086
 */

/** n lines of text with a short last line, so it reads as a paragraph. */
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span className={`block space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-5/6" : "w-full"}`} />
      ))}
    </span>
  );
}

/**
 * Rows that occupy the same height as the real list. Use in place of a centred
 * spinner anywhere a list is being replaced.
 */
export function SkeletonRows({
  count = 5,
  /** Matches the leading avatar/logo tile most of our rows carry. */
  media = true,
  className = "",
}: {
  count?: number;
  media?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={`divide-y divide-gray-200 dark:divide-gray-700 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-4 sm:px-6">
          {media && <Skeleton className="h-10 w-10 flex-shrink-0" rounded="rounded-lg" />}
          <span className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </span>
          <Skeleton className="hidden h-5 w-16 flex-shrink-0 sm:block" rounded="rounded-md" />
        </li>
      ))}
    </ul>
  );
}

/**
 * A grid of card placeholders, for the jobs feed and the dashboard "matched to
 * you" grid. `columns` mirrors the real grid so nothing reflows on arrival.
 */
export function SkeletonCards({
  count = 4,
  columns = 2,
  className = "",
}: {
  count?: number;
  /** 1, 2 or 3 columns from `sm` up; always one column on a phone. */
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 xl:grid-cols-3" }[columns];

  return (
    <div className={`grid grid-cols-1 gap-4 ${grid} ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 flex-shrink-0" rounded="rounded-lg" />
            <span className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </span>
          </div>
          <SkeletonText lines={2} className="mt-4" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-6 w-20" rounded="rounded-md" />
            <Skeleton className="h-6 w-16" rounded="rounded-md" />
          </div>
          <Skeleton className="mt-4 h-1" rounded="rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Header + body placeholder for a whole panel (a profile card, a detail pane). */
export function SkeletonPanel({
  lines = 4,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`panel p-4 sm:p-6 ${className}`} aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-1/2" />
      <SkeletonText lines={lines} className="mt-4" />
    </div>
  );
}

/**
 * One polite announcer per page, rendered empty on mount.
 *
 * A live region that appears at the same moment as its first message frequently
 * does not announce at all — the region has to already exist in the accessibility
 * tree for the insertion to be noticed. Keeping it text-only and free of
 * controls is the other half of Sara Soueidan's guidance; several pages here
 * wrap `aria-live` around a whole list, or around a container that holds a
 * button, and re-announce everything on every keystroke.
 *
 * Pair with `aria-busy` on the container that is actually changing.
 * Ref: https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2/
 */
export function LiveStatus({
  message,
  /** `assertive` only for something the user must hear now — an error. */
  assertive = false,
}: {
  message: string;
  assertive?: boolean;
}) {
  return (
    <p
      role="status"
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </p>
  );
}

export function Alert({
  variant,
  children,
  className = "",
}: {
  variant: "error" | "success" | "info" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    // Every variant's dark rule steps one stop lighter than its light rule;
    // error was the odd one out at -500 and read as a darker, muddier bar.
    error:
      "border-l-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100 dark:border-l-red-400",
    success:
      "border-l-green-500 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100 dark:border-l-green-400",
    info: "border-l-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100 dark:border-l-blue-400",
    warning:
      "border-l-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-l-amber-400",
  }[variant];

  const icons = {
    error: <Icon.warning className="h-4 w-4" />,
    success: <Icon.checkCircle className="h-4 w-4" />,
    info: <Icon.spark className="h-4 w-4" />,
    warning: <Icon.warning className="h-4 w-4" />,
  }[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      // A left rule rather than a full box: quieter, and it lines up with the
      // hairline grammar used everywhere else.
      className={`flex items-start gap-3 rounded-r-lg border border-l-2 border-gray-200 p-3 text-sm dark:border-gray-700 sm:p-4 ${styles} ${className}`}
    >
      <span className="mt-0.5 flex-shrink-0">{icons}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * "Nothing yet" and "nothing matched" are different surfaces and want different
 * treatment — the first is a *teaching* moment, the second is a *dead end* the
 * user needs a way out of. Thirteen call sites were picking by hand and several
 * of the dead ends shipped with no recovery action at all.
 *
 * - `empty`      first run. Roomy, a document glyph, an action is optional.
 * - `no-results` a filter or search returned nothing. Tighter (it sits inside a
 *                results region that still has its controls above it), defaults
 *                to a search glyph, and `action` is where the way out goes.
 * - `error`      the fetch failed. Same shape, a warning glyph, `action` is the
 *                retry.
 *
 * NN/g's filtering guidance is the source of the split: prevent zero-result
 * dead ends, and where one happens, give a way out.
 * Ref: https://www.nngroup.com/topic/search/
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "empty",
  /** Mono kicker above the title, for surfaces that already use one. */
  eyebrow,
  className = "",
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /**
   * Required in practice for `no-results` and `error`: a dead end must have an
   * exit. It stays optional in the type so the first-run case does not have to
   * invent one.
   */
  action?: React.ReactNode;
  variant?: "empty" | "no-results" | "error";
  eyebrow?: string;
  className?: string;
}) {
  const defaultIcon = {
    empty: <Icon.document className="h-6 w-6" />,
    "no-results": <Icon.search className="h-6 w-6" />,
    error: <Icon.warning className="h-6 w-6" />,
  }[variant];

  return (
    <div
      className={`grid-field text-center ${
        variant === "empty" ? "px-6 py-14" : "px-6 py-10"
      } ${className}`}
    >
      <div
        className={`tile mx-auto mb-4 h-12 w-12 ${
          variant === "error"
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            : ""
        }`}
      >
        {icon ?? defaultIcon}
      </div>
      {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
      <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
      {description && (
        <p className="mx-auto mb-5 max-w-sm text-pretty text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meters and scores                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fit bands. The underlying signal is `similarityToScore(cosine, floor 0.60,
 * ceiling 0.80)` — a clamped linear rescale of a 0.2-wide cosine window — so one
 * displayed point is 0.002 of cosine and the last digit is model jitter.
 *
 * A band is what a person can act on; the number stays as instrument detail.
 * Microsoft's HAX guideline 2 ("match the level of precision in UI
 * communication with the system performance") and Google PAIR's explainability
 * chapter both point the same way: PAIR calls a raw numeric confidence the
 * riskiest of the four display methods and recommends a categorical band
 * instead, because it "reduces granularity confusion through clear action
 * guidance".
 */
export const FIT_BANDS = [
  { min: 80, label: "Very strong", hint: "Among the closest reads on your profile" },
  { min: 60, label: "Strong", hint: "Clear overlap with what you list" },
  { min: 40, label: "Partial", hint: "Some overlap — worth reading the posting" },
  { min: 0, label: "Exploratory", hint: "Little overlap we can see" },
] as const;

export type FitBand = (typeof FIT_BANDS)[number];

export function fitBand(value: number): FitBand {
  return FIT_BANDS.find((band) => value >= band.min) ?? FIT_BANDS[FIT_BANDS.length - 1];
}

/** Rounded to 5 on list surfaces: below that the digits are model jitter. */
export const coarseFit = (value: number) => Math.round(value / 5) * 5;

/**
 * Flat hairline bar. Above `strongAt` it fills emerald; below, it goes neutral —
 * so strength is legible from the bar length alone and colour is reinforcement
 * rather than the only signal.
 *
 * `role="meter"`, not `progressbar`. MDN is explicit that a meter is "a
 * measurement within a known range" and that "meters should not be used to
 * indicate progress" — this measures match strength, which is a quantity, not
 * progress toward completion over time. Pass `progress` for the rare genuine
 * loading bar.
 */
export function Meter({
  value,
  max = 100,
  strongAt = 60,
  label,
  className = "",
  /**
   * Marks the bar `aria-hidden`. Use it wherever the label and the value are
   * already printed as visible text right beside the bar — as in `MeterRow` —
   * because otherwise a screen reader reads "Skills overlap, 99 percent" and
   * then "Skills overlap, meter, 99%" for the same one fact.
   */
  decorative = false,
  /** Overrides the spoken value. Defaults to the number plus its band. */
  valueText,
  /** Points at the caveat that qualifies the number, e.g. a "fit is a sorting aid" note. */
  describedBy,
  /** 3px / 4px / 6px. A bar in a dense row and a bar under a headline differ. */
  size = "md",
  /** Genuine loading bar rather than a measurement: restores `role="progressbar"`. */
  progress = false,
}: {
  value: number;
  max?: number;
  strongAt?: number;
  label?: string;
  className?: string;
  decorative?: boolean;
  valueText?: string;
  describedBy?: string;
  size?: "sm" | "md" | "lg";
  progress?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const strong = pct >= strongAt;
  const rounded = Math.round(pct);
  const sizeClass = { sm: "meter-sm", md: "", lg: "meter-lg" }[size];

  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({
        role: progress ? "progressbar" : "meter",
        "aria-valuenow": rounded,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        // An unnamed meter is announced as an anonymous "meter"; callers that
        // pass no label at least get a generic one.
        "aria-label": label ?? (progress ? "Progress" : "Measurement"),
        // APG's range-widget practice: "there is value in communicating more
        // information than just a number". The old value was `${pct}%`, which
        // restated aria-valuenow and added nothing.
        "aria-valuetext":
          valueText ?? (progress ? `${rounded}%` : `${rounded} out of 100 — ${fitBand(pct).label.toLowerCase()}`),
        "aria-describedby": describedBy,
      } as const);

  return (
    <div className={`meter ${sizeClass} ${className}`} {...a11y}>
      <span
        className={`meter-fill ${strong ? "" : "meter-fill-muted"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A labelled meter row: "Technical stack alignment ————— 99%". */
export function MeterRow({
  label,
  value,
  max = 100,
  suffix = "%",
  /**
   * This facet's share of the blended score, 0–1. Four identically-sized bars
   * imply four equal inputs; where they are not equal, saying so is the
   * difference between an explanation and a misleading one. Renders as
   * "18% OF SCORE" beside the label.
   */
  weight,
  /** A short qualifier under the label, for facets that need one. */
  hint,
  describedBy,
  className = "",
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
  weight?: number;
  hint?: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
          {label}
          {weight !== undefined && (
            <Eyebrow as="span" className="ml-2 whitespace-nowrap">
              {Math.round(weight * 100)}% of score
            </Eyebrow>
          )}
        </span>
        <Readout className="flex-shrink-0 text-xs font-medium">
          {value}
          {suffix}
        </Readout>
      </div>
      {/* Decorative: the label and the value are already right above the bar. */}
      <Meter value={value} max={max} decorative describedBy={describedBy} />
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

/**
 * The headline fit readout: a band, then the number as instrument detail.
 *
 * Was "98% match". The percent sign is the problem — next to the word "match"
 * it reads to a candidate as a 98% chance of being hired, which is not a claim
 * the model can support. The band leads, the raw value follows as "85/100",
 * rounded to 5 on list surfaces. A real gauge shows a band *and* a value, so
 * this is more on-brand than the percentage, not less.
 */
export function MatchScore({
  value,
  caption = "Profile fit",
  className = "",
  /** Round to the nearest 5. On by default; turn it off on a detail panel. */
  coarse = true,
  /**
   * Ordinal position in the list this score is sorting, e.g. `rank={3}`
   * `rankOf={24}` → "3rd closest of 24". The score is monotone in cosine, so
   * *rank order* is meaningful even where the magnitude is not — which makes
   * the ordinal the more defensible framing on a list surface, and the honest
   * description of what the feature does: sort your feed.
   */
  rank,
  rankOf,
  /** Adds the bar under the readout, for a card that has room for it. */
  showBar = false,
  /** Points at the caveat that qualifies the score. */
  describedBy,
  id,
  align = "right",
  /** `lg` for a detail panel where the score is the headline of the page. */
  size = "md",
}: {
  value: number;
  caption?: string;
  className?: string;
  coarse?: boolean;
  rank?: number;
  rankOf?: number;
  showBar?: boolean;
  describedBy?: string;
  id?: string;
  align?: "left" | "right";
  size?: "md" | "lg";
}) {
  const band = fitBand(value);
  const shown = coarse ? coarseFit(value) : Math.round(value);
  const alignment = align === "right" ? "text-right" : "text-left";
  const justify = align === "right" ? "justify-end" : "justify-start";

  return (
    <div className={`${alignment} ${className}`} id={id} aria-describedby={describedBy}>
      <span className={`flex items-center gap-1.5 ${justify}`}>
        <Icon.pulse
          className={`${size === "lg" ? "h-5 w-5" : "h-4 w-4"} flex-shrink-0 text-green-600 dark:text-green-400`}
        />
        <span
          className={`font-semibold text-gray-900 dark:text-white ${
            size === "lg" ? "text-lg" : "text-sm"
          }`}
        >
          {band.label} fit
        </span>
      </span>
      <Eyebrow className="mt-1">
        <Readout>{shown}</Readout>
        <span aria-hidden="true">/100</span>
        <span className="sr-only"> out of 100</span>
        {" · "}
        {caption}
      </Eyebrow>
      {rank !== undefined && rankOf !== undefined && rankOf > 0 && (
        <Eyebrow className="mt-0.5">
          <Readout>{ordinal(rank)}</Readout> closest of <Readout>{rankOf}</Readout>
        </Eyebrow>
      )}
      {/* Decorative: the band and the readout above already say it in words. */}
      {showBar && <Meter value={value} className="mt-2" decorative />}
    </div>
  );
}

/** 1 → "1st", 2 → "2nd", 13 → "13th". Used by `MatchScore`'s rank line. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/* -------------------------------------------------------------------------- */
/* Chips and badges                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Compact metadata tag: a skill, a salary band, a location.
 *
 * Three shapes from one component, following Carbon's tag variants:
 *
 *  - read-only (default) — a `<span>`, not in the tab order
 *  - dismissible (`onRemove`) — carries its own close control
 *  - selectable (`onClick`) — a `<button>` with `aria-pressed`
 *
 * Carbon ships these separately because "tag with an X" has its own contract:
 * the close control is in the tab order, and its accessible name has to include
 * the tag's own text so a screen-reader user hears *which* filter they are
 * removing. `app/jobs/page.tsx` had hand-rolled exactly that; it belongs here,
 * because the next surface that needs a removable token would copy it.
 */
export function Chip({
  children,
  icon,
  accent,
  className = "",
  /** Renders the close control. The label defaults to "Remove {children}". */
  onRemove,
  removeLabel,
  /** Makes the whole chip a toggle. Sets `aria-pressed` from `selected`. */
  onClick,
  selected = false,
  /** `sm` for chips inside a dense row. */
  size = "md",
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
  className?: string;
  onRemove?: () => void;
  removeLabel?: string;
  onClick?: () => void;
  selected?: boolean;
  size?: "sm" | "md";
  title?: string;
}) {
  const base = `chip ${size === "sm" ? "chip-sm" : ""} ${accent || selected ? "chip-accent" : ""} ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={title}
        className={`${base} chip-interactive interactive hit-24`}
      >
        {icon}
        {children}
      </button>
    );
  }

  if (!onRemove) {
    return (
      <span className={base} title={title}>
        {icon}
        {children}
      </span>
    );
  }

  return (
    <span className={base} title={title}>
      {icon}
      {children}
      <button
        type="button"
        onClick={onRemove}
        // `.hit-24` grows the target to the 24×24 floor without growing the
        // chip, so the control clears SC 2.5.8 on its own rather than leaning
        // on the spacing exception.
        className="chip-dismiss hit-24"
      >
        <Icon.x className="h-3 w-3" />
        <span className="sr-only">
          {removeLabel ?? `Remove ${typeof children === "string" ? children : "this filter"}`}
        </span>
      </button>
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  SHORTLISTED:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  INTERVIEW:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
  ACCEPTED:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200",
  REJECTED:
    "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * Shared by both badges below. They had drifted to separate copies of the same
 * string, so a change to one silently left the other behind.
 */
const BADGE_BASE =
  "mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider";

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Icon.clock className="h-3 w-3" />,
  SHORTLISTED: <Icon.checkCircle className="h-3 w-3" />,
  INTERVIEW: <Icon.badge className="h-3 w-3" />,
  ACCEPTED: <Icon.check className="h-3 w-3" />,
  REJECTED: <Icon.x className="h-3 w-3" />,
};

/**
 * Status pill, set in mono so it reads as a state code. Colour alone used to
 * carry the meaning; the label and an icon now do too, so it survives greyscale
 * and colour-blindness.
 */
export function StatusBadge({
  status,
  className = "",
  /** Drops the glyph where the badge sits in an already-dense row. */
  showIcon = true,
}: {
  status: string;
  className?: string;
  showIcon?: boolean;
}) {
  const label = STATUS_LABELS[status as ApplicationStatus] ?? status;
  const styles =
    STATUS_STYLES[status] ??
    "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <span className={`${BADGE_BASE} ${styles} ${className}`}>
      {showIcon ? STATUS_ICONS[status] ?? null : null}
      <span>{label}</span>
    </span>
  );
}

/**
 * The ordinal stages an application moves through. `REJECTED` is deliberately
 * not in the list: it is an exit from the pipeline, not a position in it.
 */
export const PIPELINE_STAGES = ["PENDING", "SHORTLISTED", "INTERVIEW", "ACCEPTED"] as const;

/**
 * A stage badge shows *which* stage; this shows **where that stage sits in the
 * sequence**. A seeker looking at "Shortlisted" otherwise cannot tell that two
 * stages remain. Same reasoning as a task-list or progress-through-a-process
 * pattern: inside a multi-stage process, position in the sequence is the thing
 * the user actually wants to know.
 *
 * Drawn as one hairline segment per stage, the same grammar as `.meter`, so it
 * belongs beside a score rather than looking like a borrowed widget. The
 * segments are `aria-hidden` and the position is given to assistive tech as a
 * sentence, because a row of coloured bars is not a thing worth spelling out.
 */
export function PipelineTrack({
  status,
  className = "",
  /** Hides the badge, for a row that already shows one elsewhere. */
  showBadge = true,
}: {
  status: string;
  className?: string;
  showBadge?: boolean;
}) {
  const closed = status === "REJECTED";
  const at = closed ? -1 : PIPELINE_STAGES.indexOf(status as (typeof PIPELINE_STAGES)[number]);
  const label = STATUS_LABELS[status as ApplicationStatus] ?? status;
  const position = closed
    ? `Closed: ${label}`
    : at >= 0
      ? `Stage ${at + 1} of ${PIPELINE_STAGES.length}: ${label}`
      : label;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="track" aria-hidden="true">
        {PIPELINE_STAGES.map((stage, index) => (
          <span
            key={stage}
            className={`track-seg ${closed ? "track-seg-void" : index <= at ? "track-seg-done" : ""}`}
          />
        ))}
      </span>
      {showBadge && <StatusBadge status={status} />}
      <span className="sr-only">{position}</span>
    </span>
  );
}

/** Open/closed state for a job posting. */
export function JobStateBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`${BADGE_BASE} ${
        isActive
          ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200"
          : "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`}
        aria-hidden="true"
      />
      {isActive ? "Open" : "Closed"}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Metric tile. The label sits above the value in mono, so a row of these reads
 * like a readout panel rather than a set of marketing cards.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "blue",
  hint,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "purple" | "amber" | "red";
  hint?: string;
  className?: string;
}) {
  const tones = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    purple: "text-violet-600 dark:text-violet-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
  }[tone];

  return (
    // `.panel-interactive` is the shared hover treatment. This tile previously
    // had its own (`hover:border-gray-300 dark:hover:border-gray-600`), whose
    // dark value came from the wrong end of the ramp and read lighter than the
    // border it was meant to strengthen.
    <div className={`panel panel-interactive p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <Eyebrow className="min-w-0 truncate">{label}</Eyebrow>
        <span className={`flex-shrink-0 ${tones}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <Readout className="mt-3 block text-2xl font-semibold leading-none">{value}</Readout>
      {hint && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

/** Page heading block with a mono eyebrow above a tight display title. */
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="text-balance text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-pretty text-sm text-gray-600 dark:text-gray-400 sm:text-base">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex flex-shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Numbered item for a stepped explanation, as in the dark band. */
export function NumberedItem({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span className="mono flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-medium text-green-400">
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {children && <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{children}</p>}
      </div>
    </div>
  );
}

/** Shared field label so every form input actually has one. */
export function Label({
  htmlFor,
  children,
  required,
  hint,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block">
      <span className="eyebrow">
        {children}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      {hint && <span className="mt-1 block text-xs normal-case tracking-normal text-gray-600 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Class-name constants                                                        */
/* -------------------------------------------------------------------------- */

/** One consistent input style, so forms stop drifting apart page by page. */
export const inputClass = "field";

export const buttonPrimary = "btn-ink btn-touch";

export const buttonSecondary = "btn-outline btn-touch";

/**
 * Danger and ghost used to be long utility strings while primary and secondary
 * were component classes — which is how the two of them ended up with a
 * disabled state that each call site had to remember to append. They are
 * component classes now (`.btn-danger` / `.btn-ghost` in globals.css), so
 * disabled, hover and `aria-busy` behaviour is part of the primitive. The
 * exported names and their `string` type are unchanged.
 */
export const buttonDanger = "btn-danger btn-touch";

/** Quiet, borderless action for inline links inside cards. */
export const buttonGhost = "btn-ghost";

/** One size up, for hero and closing-CTA button pairs. */
export const buttonLarge = "btn-lg";

/** And one down, for toolbars, card footers and filter bars. */
export const buttonSmall = "btn-sm";

/**
 * A borderless square that holds one glyph — a theme toggle, a bell, a menu
 * trigger. Three call sites each had their own hover colours and two of them
 * disagreed in dark mode; this is the shared one.
 */
export const iconButton = "btn-icon interactive";

/** Dense input, for filter bars and inline editors. */
export const inputSmall = "field field-sm";

/**
 * The four elevation tiers as bare class strings, for anything that needs the
 * markup rather than `<Card>` — a `<details>`, a `<form>`, a positioned popover.
 */
export const surfaceSunken = "panel-sunken";
export const surfaceFlat = "panel";
export const surfaceRaised = "panel panel-raised";
export const surfaceOverlay = "panel-overlay";

/**
 * The shared rest/hover/press/selected/disabled treatment, for any interactive
 * thing that is not one of the button variants — a list row, a popover item, a
 * selectable tile. Reads `disabled`, `aria-disabled`, `aria-selected`,
 * `aria-current` and `data-selected` off the element, so the state comes from
 * the same attribute assistive tech reads rather than from a parallel class.
 */
export const interactiveSurface = "interactive";

/** A dense list row: `.row` for the geometry, `.interactive` for the states. */
export const rowInteractive = "row interactive";

/** Marks a row as the selected one: adds the leading accent rule. */
export const rowSelected = "row-selected";

/**
 * Grows a control's hit area to the 24×24 SC 2.5.8 floor without changing its
 * layout box. For close buttons inside chips and other deliberately small
 * targets; `buttonPrimary`'s `.btn-touch` is the 44px comfortable size, which
 * is too big to put inside a chip.
 */
export const hitArea = "hit-24";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: buttonPrimary,
  secondary: buttonSecondary,
  danger: buttonDanger,
  ghost: buttonGhost,
};

/**
 * The button primitive, for the common case of an action that can be pending.
 * The class constants above stay exported for `<Link>` and for anything that
 * needs the bare string; this exists so that "disabled while submitting, with a
 * spinner, without the layout jumping" is one prop rather than six lines of JSX
 * re-written on every page.
 */
export function Button({
  variant = "primary",
  loading = false,
  loadingLabel = "Working",
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  size = "md",
  /** Trailing glyph — a chevron, an external-link arrow. */
  iconEnd,
  /** Stretches to the container. Saves a `w-full` on every mobile CTA. */
  block = false,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  /** Disables the control and swaps `icon` for a spinner. */
  loading?: boolean;
  /** What a screen reader hears while `loading` is true. */
  loadingLabel?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** 32 / 40 / 48px, the kit's three control heights. */
  size?: "sm" | "md" | "lg";
  iconEnd?: React.ReactNode;
  block?: boolean;
}) {
  const sizeClass = { sm: buttonSmall, md: "", lg: buttonLarge }[size];

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_VARIANTS[variant]} ${sizeClass} ${block ? "w-full" : ""} ${className}`}
    >
      {loading ? <Spinner className="h-4 w-4" decorative /> : icon}
      {children}
      {!loading && iconEnd}
      {loading && <span className="sr-only">{loadingLabel}</span>}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatDate(value?: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // "en-US" rather than `[]`: an empty list means the runtime's own locale, so
  // the same timestamp rendered 09:05 or 9:05 AM depending on the machine,
  // beside a `formatDate` that was pinned to English all along.
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * "Today" / "Yesterday" / a written date, for the day separators in a message
 * thread.
 *
 * Lives here rather than in either conversation page because there were two of
 * these, one per side, and they disagreed: the company saw "Tue, Mar 4" where
 * the seeker saw "Mar 4, 2025" on the very same message. The year is shown only
 * when it is not the current one, so an old thread still says which year it is.
 */
export function dayLabel(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** "Just now", "5m ago", "3h ago", then a date. */
export function formatRelative(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return formatDate(date);
}

/** Compact counts for stat tiles: 1200 → "1.2k". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}
