"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { apiFetch } from "@/lib/clientAuth";
import type { MarketInsights, ResumeReview } from "@/lib/resumeInsights";
import { Eyebrow, Icon, Readout, Skeleton, buttonPrimary, buttonSecondary } from "@/app/components/ui";

/**
 * Resume insights, shared by the dashboard hero and the full page at
 * /seeker/resume.
 *
 * The employer-demand numbers come from GET /api/resume-insights and are cheap.
 * The resume check is one model call (POST), so its result is kept in this
 * browser against the resume it was made for: both surfaces show the same
 * check without paying for it twice, and a new upload makes it stale.
 */

/* -------------------------------------------------------------------------- */
/* The stored check                                                            */
/* -------------------------------------------------------------------------- */

const REVIEW_STORAGE_KEY = "nexthire:resume-review";
/** Fired on `window` when a check is saved, so another mounted surface picks it up. */
const REVIEW_EVENT = "nexthire:resume-review";

export function readStoredReview(resumeId: string): ResumeReview | null {
  try {
    const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY);
    if (!raw) return null;
    const review = JSON.parse(raw) as ResumeReview;
    return review?.resumeId === resumeId ? review : null;
  } catch {
    return null;
  }
}

function storeReview(review: ResumeReview) {
  try {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(review));
  } catch {
    // Private mode or a full quota: the check still shows for this visit.
  }
  window.dispatchEvent(new CustomEvent(REVIEW_EVENT));
}

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

export type MarketState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty"; reason: "no-profile" | "too-few-jobs" }
  | { status: "ready"; insights: MarketInsights };

export function useResumeInsights(resumeId: string | null | undefined, enabled = true) {
  const [market, setMarket] = useState<MarketState>({ status: "loading" });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  const reload = useCallback(async (): Promise<MarketState> => {
    let next: MarketState;
    try {
      const data = await apiFetch<{
        insights: MarketInsights | null;
        reason?: "no-profile" | "too-few-jobs";
        aiEnabled?: boolean;
      }>("/api/resume-insights");
      if (data.aiEnabled === false) setAiEnabled(false);
      next = data.insights
        ? { status: "ready", insights: data.insights }
        : { status: "empty", reason: data.reason ?? "no-profile" };
    } catch (error) {
      next = {
        status: "error",
        message: error instanceof Error ? error.message : "We could not load your resume insights.",
      };
    }
    setMarket(next);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, resumeId, reload]);

  useEffect(() => {
    if (!resumeId) {
      setReview(null);
      return;
    }
    setReview(readStoredReview(resumeId));
    const sync = () => setReview(readStoredReview(resumeId));
    window.addEventListener(REVIEW_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REVIEW_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [resumeId]);

  const runCheck = useCallback(async (): Promise<ResumeReview | null> => {
    setChecking(true);
    setCheckError("");
    try {
      const data = await apiFetch<{ review: ResumeReview }>("/api/resume-insights", { method: "POST" });
      setReview(data.review);
      storeReview(data.review);
      return data.review;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "We could not check your resume. Please try again.";
      if (/not available/i.test(message)) setAiEnabled(false);
      setCheckError(message);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  return { market, aiEnabled, review, checking, checkError, reload, runCheck };
}

/* -------------------------------------------------------------------------- */
/* Derived numbers                                                             */
/* -------------------------------------------------------------------------- */

export type KeywordState = "resume" | "profile" | "missing" | "have";

/**
 * Each top keyword, marked against the resume when it has been checked and
 * against the profile until then.
 */
export function keywordStates(insights: MarketInsights, review: ResumeReview | null) {
  const found = new Set((review?.keywordsFound ?? []).map((label) => label.toLowerCase()));
  return insights.keywords.map((row) => {
    const state: KeywordState = review
      ? found.has(row.label.toLowerCase())
        ? "resume"
        : row.onProfile
          ? "profile"
          : "missing"
      : row.onProfile
        ? "have"
        : "missing";
    return { ...row, state };
  });
}

export function keywordCoverage(insights: MarketInsights, review: ResumeReview | null) {
  const rows = keywordStates(insights, review);
  const covered = rows.filter((row) => row.state === "resume" || row.state === "have").length;
  return { covered, total: rows.length };
}

/** The score as a short sentence-case heading: "A strong resume". */
export function scoreHeadline(score: number): string {
  if (score >= 85) return "An excellent resume";
  if (score >= 70) return "A strong resume";
  if (score >= 55) return "A good start";
  return "Needs some work";
}

/**
 * The ring takes the status colour of its band — green from 70, amber from
 * 55, red below — and the band's word is always printed beside it.
 */
export function scoreColor(score: number): string {
  if (score >= 70) return "var(--color-success-500, #12b76a)";
  if (score >= 55) return "var(--color-amber-500, #f59e0b)";
  return "var(--color-red-500, #ef4444)";
}

export function scoreBand(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good start";
  return "Needs work";
}

/* -------------------------------------------------------------------------- */
/* Score gauge                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The resume score as a ring: one value against a fixed limit of 100, so a
 * single-hue meter bent into a circle, with the number set in ink in the
 * middle. `null` draws the empty track; `busy` turns a short arc for a check
 * that is running.
 */
export function ScoreRing({
  value,
  size = 136,
  busy = false,
  className = "",
}: {
  value: number | null;
  size?: number;
  busy?: boolean;
  className?: string;
}) {
  const stroke = Math.max(6, Math.round(size / 16));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = value == null ? 0 : Math.max(0, Math.min(100, value));
  const big = size >= 150;

  const a11y =
    value != null && !busy
      ? ({
          role: "meter",
          "aria-valuenow": shown,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-label": "Resume score",
          "aria-valuetext": `${shown} out of 100, ${scoreBand(shown).toLowerCase()}`,
        } as const)
      : ({ "aria-hidden": true } as const);

  return (
    <div className={`relative flex-shrink-0 ${className}`} style={{ width: size, height: size }} {...a11y}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={stroke}
          strokeDasharray={value == null && !busy ? "2 6" : undefined}
        />
        {busy ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.22} ${circumference}`}
            className="origin-center motion-safe:animate-spin"
            style={{ animationDuration: "1.4s" }}
          />
        ) : (
          value != null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={scoreColor(shown)}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(circumference * shown) / 100} ${circumference}`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
          )
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {value != null && !busy ? (
          <>
            <Readout
              className={`font-sans font-semibold leading-none text-gray-900 dark:text-white ${
                big ? "text-5xl" : "text-4xl"
              }`}
            >
              {shown}
            </Readout>
            <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">of 100</span>
          </>
        ) : busy ? (
          <span className="px-4 text-xs text-gray-600 dark:text-gray-400">Checking…</span>
        ) : (
          <Icon.document className={`text-gray-400 ${big ? "h-8 w-8" : "h-7 w-7"}`} />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard hero                                                              */
/* -------------------------------------------------------------------------- */

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <Readout className="block font-sans text-2xl font-semibold leading-none text-gray-900 dark:text-white">
        {value}
      </Readout>
      <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{label}</p>
      {hint && <p className="sr-only">{hint}</p>}
    </div>
  );
}

const PROMISES = [
  "A score out of 100 and what is holding it back",
  "The keywords employers ask for that your resume is missing",
  "Stronger versions of your weakest bullet points",
];

/**
 * The first thing on the seeker dashboard: what their resume is worth against
 * the jobs they would apply to, with the full page one click away.
 *
 * `refreshKey` reloads the numbers (the profile behind them changed);
 * `checkKey` reloads and then runs the resume check, which the dashboard does
 * once a new resume has been read.
 */
export function ResumeInsightsHero({
  resumeId,
  reading = false,
  refreshKey = 0,
  checkKey = 0,
  onUpload,
  onChecked,
}: {
  resumeId: string | null;
  /** The dashboard is reading a just-uploaded resume into the profile. */
  reading?: boolean;
  refreshKey?: number;
  checkKey?: number;
  onUpload: () => void;
  onChecked?: () => void;
}) {
  const { market, aiEnabled, review, checking, checkError, reload, runCheck } = useResumeInsights(
    resumeId,
    !!resumeId
  );

  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefresh.current) return;
    lastRefresh.current = refreshKey;
    void reload();
  }, [refreshKey, reload]);

  const lastCheck = useRef(checkKey);
  useEffect(() => {
    if (checkKey === lastCheck.current) return;
    lastCheck.current = checkKey;
    void (async () => {
      const next = await reload();
      if (next.status !== "ready") return;
      const done = await runCheck();
      if (done) onChecked?.();
    })();
  }, [checkKey, reload, runCheck, onChecked]);

  const shell = (children: React.ReactNode, aside?: React.ReactNode) => (
    <section aria-labelledby="insights-heading" className="panel panel-raised panel-lit relative mt-6 overflow-hidden sm:mt-8">
      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:gap-8">
        {children}
        {aside && <div className="flex flex-shrink-0 flex-wrap gap-2 lg:flex-col lg:items-stretch">{aside}</div>}
      </div>
    </section>
  );

  const heading = (title: string) => (
    <>
      <Eyebrow accent className="mb-2 flex items-center gap-1.5">
        <Icon.spark className="h-3.5 w-3.5" /> Resume insights
      </Eyebrow>
      <h2 id="insights-heading" className="text-balance text-xl font-semibold text-gray-900 dark:text-white sm:text-2xl">
        {title}
      </h2>
    </>
  );

  // No resume yet: what uploading one gets you.
  if (!resumeId) {
    return shell(
      <>
        <ScoreRing value={null} size={120} className="hidden sm:block" />
        <div className="min-w-0 flex-1">
          {heading("See how your resume stacks up")}
          <p className="mt-1.5 max-w-xl text-sm text-gray-600 dark:text-gray-400">
            Upload your resume and we compare it with the open jobs closest to it. You get:
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3 sm:gap-4">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <Icon.checkCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--accent)]" />
                {promise}
              </li>
            ))}
          </ul>
        </div>
      </>,
      <button type="button" onClick={onUpload} className={buttonPrimary}>
        <Icon.upload className="h-4 w-4" /> Upload resume
      </button>
    );
  }

  if (reading || (market.status === "empty" && market.reason === "no-profile")) {
    return shell(
      <>
        <ScoreRing value={null} size={120} busy className="hidden sm:block" />
        <div className="min-w-0 flex-1" role="status">
          {heading("Reading your resume…")}
          <p className="mt-1.5 max-w-xl text-sm text-gray-600 dark:text-gray-400">
            We are finding the jobs closest to it and what those employers ask for. This takes a few seconds.
          </p>
        </div>
      </>
    );
  }

  if (market.status === "loading") {
    return shell(
      <>
        <Skeleton className="hidden h-[120px] w-[120px] sm:block" rounded="rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-3 h-3 w-28" />
          <Skeleton className="mb-3 h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </>
    );
  }

  if (market.status !== "ready") {
    return shell(
      <div className="min-w-0 flex-1">
        {heading(
          market.status === "empty" ? "Not enough jobs like yours yet" : "We could not load your resume insights"
        )}
        <p className="mt-1.5 max-w-xl text-sm text-gray-600 dark:text-gray-400">
          {market.status === "empty"
            ? "There are too few open jobs close to your resume to compare it with. Check back after new jobs come in."
            : market.message}
        </p>
      </div>,
      market.status === "error" ? (
        <button type="button" onClick={() => void reload()} className={buttonSecondary}>
          <Icon.refresh className="h-4 w-4" /> Try again
        </button>
      ) : undefined
    );
  }

  const { insights } = market;
  const coverage = keywordCoverage(insights, review);
  const sectionsGood = review ? review.checks.filter((check) => check.status === "good").length : null;
  const toAdd = insights.missing.slice(0, 4);

  return shell(
    <>
      <ScoreRing value={review?.score ?? null} busy={checking} size={128} className="hidden sm:block" />
      <div className="min-w-0 flex-1">
        {heading(
          checking
            ? `Checking your resume against ${insights.jobsAnalysed} jobs like yours…`
            : review
              ? `${scoreBand(review.score)} · ${review.score}/100 against ${insights.jobsAnalysed} jobs like yours`
              : `Your resume vs ${insights.jobsAnalysed} jobs like yours`
        )}
        <p className="mt-1.5 max-w-2xl text-sm text-gray-600 dark:text-gray-400" role={checking ? "status" : undefined}>
          {checking
            ? "Reading it section by section against what these employers ask for. About 20 seconds."
            : review
              ? review.verdict
              : checkError || "Check your resume to get a score, the fixes that help most and stronger bullet points."}
        </p>

        {/* Only figures that exist. Before a check, "Sections in good shape"
            printed a lone dash — a stat with nothing in it, beside the button
            that would fill it. */}
        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t border-gray-200 pt-4 dark:border-gray-700 sm:max-w-lg">
          <Metric label={review ? "Keywords in resume" : "Keywords covered"} value={`${coverage.covered}/${coverage.total}`} />
          {sectionsGood != null && (
            <Metric label="Sections in good shape" value={`${sectionsGood}/${review?.checks.length ?? 9}`} />
          )}
          <Metric label="Remote jobs" value={`${Math.round(insights.remoteShare * 100)}%`} />
        </div>

        {toAdd.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">Often asked for:</span>
            {toAdd.map((row) => (
              <span key={row.label} className="chip chip-sm">
                <Icon.plus className="h-3 w-3" />
                <span className="chip-label">{row.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </>,
    // One primary action. Before a check, the check is the thing to do (it is
    // what produces the score), so it leads and the full page is secondary;
    // once there is a score, reading the full page is the next step.
    <>
      {!review && aiEnabled && !checking && (
        <button type="button" onClick={() => void runCheck().then((done) => done && onChecked?.())} className={buttonPrimary}>
          <Icon.spark className="h-4 w-4" /> Check my resume
        </button>
      )}
      <Link
        href="/seeker/resume"
        className={!review && aiEnabled && !checking ? buttonSecondary : buttonPrimary}
      >
        See full insights <Icon.arrowRight className="h-4 w-4" />
      </Link>
    </>
  );
}
