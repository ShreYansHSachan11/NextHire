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
}: {
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
  as?: "p" | "span" | "div" | "h2" | "h3" | "dt";
}) {
  return (
    <Tag className={`eyebrow ${accent ? "eyebrow-accent" : ""} ${className}`}>{children}</Tag>
  );
}

/** Numeric readout in mono with tabular figures, so digits don't jitter. */
export function Readout({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`readout ${className}`}>{children}</span>;
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = "",
  /** Emerald hairline + faint tint, for a selected or high-signal item. */
  signal = false,
  /** Lays graph-paper rules behind the content, for telemetry panels. */
  grid = false,
}: {
  children: React.ReactNode;
  className?: string;
  signal?: boolean;
  grid?: boolean;
}) {
  return (
    <div className={`panel ${signal ? "panel-signal" : ""} ${grid ? "grid-field" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  eyebrow,
  action,
  /** Lets a page keep a sane h1 → h2 → h3 order without restyling the header. */
  headingLevel = 2,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
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
      <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-900/25 dark:text-green-400">
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
 */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <span
      className={`block rounded bg-gray-200 motion-safe:animate-pulse dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
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

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid-field px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {icon ?? <Icon.document className="h-6 w-6" />}
      </div>
      <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
      {description && (
        <p className="mx-auto mb-5 max-w-sm text-sm text-gray-600 dark:text-gray-400">{description}</p>
      )}
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Meters and scores                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Flat hairline progress bar. Above `strongAt` it fills emerald; below, it goes
 * neutral — so strength is legible from the bar length alone and colour is
 * reinforcement rather than the only signal.
 */
export function Meter({
  value,
  max = 100,
  strongAt = 60,
  label,
  className = "",
}: {
  value: number;
  max?: number;
  strongAt?: number;
  label?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const strong = pct >= strongAt;

  return (
    <div
      className={`meter ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      // A progressbar with no accessible name is announced as an anonymous
      // "progress bar"; callers that pass no label at least get a generic one.
      aria-label={label ?? "Progress"}
      aria-valuetext={`${Math.round(pct)}%`}
    >
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
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
        <Readout className="text-xs font-medium">
          {value}
          {suffix}
        </Readout>
      </div>
      <Meter value={value} max={max} label={label} />
    </div>
  );
}

/** Pulse glyph + mono percentage, the reference's "98% Match / VECTOR FIT". */
export function MatchScore({
  value,
  caption = "SIGNAL FIT",
  className = "",
}: {
  value: number;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={`text-right ${className}`}>
      <span className="flex items-center justify-end gap-1.5 text-green-600 dark:text-green-400">
        <Icon.pulse className="h-4 w-4" />
        <Readout className="text-sm font-semibold text-gray-900 dark:text-white">{value}% match</Readout>
      </span>
      <Eyebrow className="mt-0.5">{caption}</Eyebrow>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips and badges                                                            */
/* -------------------------------------------------------------------------- */

/** Compact metadata tag: a skill, a salary band, a location. */
export function Chip({
  children,
  icon,
  accent,
  className = "",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span className={`chip ${accent ? "chip-accent" : ""} ${className}`}>
      {icon}
      {children}
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
export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const label = STATUS_LABELS[status as ApplicationStatus] ?? status;
  const styles =
    STATUS_STYLES[status] ??
    "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <span className={`${BADGE_BASE} ${styles} ${className}`}>
      {STATUS_ICONS[status] ?? null}
      <span>{label}</span>
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
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "purple" | "amber" | "red";
  hint?: string;
}) {
  const tones = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    purple: "text-violet-600 dark:text-violet-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
  }[tone];

  return (
    <div className="panel p-4 transition-colors hover:border-gray-300 dark:hover:border-gray-600">
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400 sm:text-base">
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
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  /** Disables the control and swaps `icon` for a spinner. */
  loading?: boolean;
  /** What a screen reader hears while `loading` is true. */
  loadingLabel?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner className="h-4 w-4" decorative /> : icon}
      {children}
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
