"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import type { CheckArea, MarketInsights, ResumeReview } from "@/lib/resumeInsights";
import {
  ScoreRing,
  keywordCoverage,
  keywordStates,
  scoreHeadline,
  useResumeInsights,
  type KeywordState,
} from "@/app/components/ResumeInsights";
import ResumeInsightsLoading from "./loading";
import {
  Alert,
  BackLink,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
  IconTile,
  Readout,
  StatusIcon,
  StatusPill,
  TONE_TEXT,
  buttonPrimary,
  buttonSecondary,
  formatDate,
  type StatusTone,
} from "@/app/components/ui";

/**
 * Resume insights: how the seeker's resume compares with the jobs they would
 * apply to, and what to change. Data and the stored check come from
 * `useResumeInsights`, which the dashboard hero shares.
 */

interface Resume {
  id: string;
  fileName?: string | null;
}

const CHECK_LABELS: Record<CheckArea, string> = {
  contact: "Contact details",
  summary: "Summary at the top",
  experience: "Work experience",
  skills: "Skills section",
  education: "Education",
  results: "Numbers that show results",
  verbs: "Strong action verbs",
  length: "Length",
  readable: "Easy for hiring software to read",
};

/** Each check is known by its picture as well as its name. */
const CHECK_ICONS: Record<CheckArea, React.ReactNode> = {
  contact: <Icon.idCard className="h-5 w-5" />,
  summary: <Icon.alignLeft className="h-5 w-5" />,
  experience: <Icon.briefcase className="h-5 w-5" />,
  skills: <Icon.layers className="h-5 w-5" />,
  education: <Icon.graduationCap className="h-5 w-5" />,
  results: <Icon.trendingUp className="h-5 w-5" />,
  verbs: <Icon.bolt className="h-5 w-5" />,
  length: <Icon.pages className="h-5 w-5" />,
  readable: <Icon.scan className="h-5 w-5" />,
};

const CHECK_STATUS: Record<"good" | "improve" | "missing", { tone: StatusTone; label: string }> = {
  good: { tone: "good", label: "Good" },
  improve: { tone: "warn", label: "Could be better" },
  missing: { tone: "bad", label: "Missing" },
};

const PRIORITY: Record<"high" | "medium" | "low", { label: string; tone: StatusTone; icon: React.ReactNode }> = {
  high: { label: "Do this first", tone: "bad", icon: <Icon.flame className="h-5 w-5" /> },
  medium: { label: "Worth doing", tone: "warn", icon: <Icon.bolt className="h-5 w-5" /> },
  low: { label: "Nice to have", tone: "neutral", icon: <Icon.lightbulb className="h-5 w-5" /> },
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const jobsLink = (params: Record<string, string>) => `/jobs?${new URLSearchParams(params).toString()}`;

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

/** A section of the page: a quiet heading block above its content. */
function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-4 min-w-0">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <h2 id={id} className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
          {title}
        </h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A thin single-hue bar: one share against the largest in its list. */
function Bar({ share, max }: { share: number; max: number }) {
  const width = max > 0 ? Math.max(2, (share / max) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-sunken)]" aria-hidden="true">
      <span className="block h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${width}%` }} />
    </span>
  );
}

const STATE_STYLE: Record<KeywordState, { label: string; tone: StatusTone }> = {
  resume: { label: "In your resume", tone: "good" },
  have: { label: "On your profile", tone: "good" },
  profile: { label: "Add to resume", tone: "warn" },
  missing: { label: "Missing", tone: "bad" },
};

function KeywordStatus({ state }: { state: KeywordState }) {
  const style = STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${TONE_TEXT[style.tone]}`}>
      <StatusIcon tone={style.tone} size="sm" />
      {style.label}
    </span>
  );
}

function MiniStat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="panel-sunken rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
        {icon && <IconTile icon={icon} size="sm" />}
      </div>
      <Readout className="mt-2 block font-sans text-2xl font-semibold leading-none text-gray-900 dark:text-white">
        {value}
      </Readout>
      {sub && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function ResumeInsightsPage() {
  const { ready, allowed } = useAuthGuard(["SEEKER"]);
  const [resume, setResume] = useState<Resume | null | undefined>(undefined);

  useEffect(() => {
    if (!ready || !allowed) return;
    apiFetch<Resume[]>("/api/resumes")
      .then((rows) => setResume(Array.isArray(rows) && rows.length > 0 ? rows[0] : null))
      .catch(() => setResume(null));
  }, [ready, allowed]);

  const { market, aiEnabled, review, checking, checkError, reload, runCheck } = useResumeInsights(
    resume?.id,
    !!resume
  );

  if (!ready || !allowed || resume === undefined) return <ResumeInsightsLoading />;
  if (resume && market.status === "loading") return <ResumeInsightsLoading />;

  const insights = market.status === "ready" ? market.insights : null;

  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <BackLink href="/seeker/dashboard" className="mb-5">
          Back to dashboard
        </BackLink>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Eyebrow accent className="mb-2 flex items-center gap-1.5">
              <Icon.spark className="h-3.5 w-3.5" /> Resume insights
            </Eyebrow>
            <h1 className="text-balance text-3xl font-semibold text-gray-900 dark:text-white sm:text-4xl">
              Make your resume work harder
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-gray-600 dark:text-gray-400 sm:text-base">
              {insights
                ? `Compared with the ${insights.jobsAnalysed} open jobs closest to your resume: what employers ask for, what you are missing and what to change first.`
                : "Compared with the jobs closest to your resume: what employers ask for, what you are missing and what to change first."}
            </p>
          </div>
          {resume && (
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              <a
                href={`/api/resumes/${resume.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonSecondary}
              >
                <Icon.external className="h-4 w-4" /> View resume
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <Link href="/seeker/dashboard#my-resume" className={buttonSecondary}>
                <Icon.upload className="h-4 w-4" /> Replace
                <span className="sr-only"> resume on your dashboard</span>
              </Link>
            </div>
          )}
        </div>

        {!resume && (
          <Card>
            <EmptyState
              title="Upload your resume to see insights"
              description="Once your resume is on file we compare it with open jobs and show you what employers ask for, which keywords you are missing and how to make it stronger."
              action={
                <Link href="/seeker/dashboard" className={buttonPrimary}>
                  <Icon.upload className="h-4 w-4" /> Upload resume
                </Link>
              }
            />
          </Card>
        )}

        {resume && market.status === "error" && (
          <Card>
            <EmptyState
              variant="error"
              title="We could not load your resume insights"
              description={market.message}
              action={
                <button type="button" onClick={() => void reload()} className={buttonPrimary}>
                  <Icon.refresh className="h-4 w-4" /> Try again
                </button>
              }
            />
          </Card>
        )}

        {resume && market.status === "empty" && (
          <Card>
            <EmptyState
              title={market.reason === "too-few-jobs" ? "Not enough jobs like yours yet" : "We have not read your resume yet"}
              description={
                market.reason === "too-few-jobs"
                  ? "There are too few open jobs close to your resume to say what employers want. Check back after new jobs come in."
                  : "Open your dashboard and we will read your resume, then come back here."
              }
              action={
                market.reason !== "too-few-jobs" ? (
                  <Link href="/seeker/dashboard" className={buttonPrimary}>
                    Go to dashboard
                  </Link>
                ) : undefined
              }
            />
          </Card>
        )}

        {insights && (
          <div className="space-y-10 sm:space-y-12">
            <ScoreHero
              insights={insights}
              review={review}
              checking={checking}
              checkError={checkError}
              aiEnabled={aiEnabled}
              fileName={resume?.fileName ?? null}
              onCheck={() => void runCheck()}
            />

            {review && review.improvements.length > 0 && (
              <Section
                id="fixes-heading"
                eyebrow="Start here"
                title="What to change first"
                description="The changes that would help your resume most, in order."
              >
                <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {review.improvements.map((item, index) => (
                    <li key={item.title} className="panel flex flex-col p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <IconTile icon={PRIORITY[item.priority].icon} tone={PRIORITY[item.priority].tone} />
                          <Readout className="text-sm font-semibold text-gray-400 dark:text-gray-500">
                            {String(index + 1).padStart(2, "0")}
                          </Readout>
                        </div>
                        <StatusPill tone={PRIORITY[item.priority].tone} icon={false}>
                          {PRIORITY[item.priority].label}
                        </StatusPill>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{item.detail}</p>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <KeywordsSection insights={insights} review={review} />

            {review && (review.checks.length > 0 || review.rewrites.length > 0) && (
              <ResumeCheckSection review={review} />
            )}

            <SearchSection insights={insights} review={review} />
          </div>
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Score                                                                       */
/* -------------------------------------------------------------------------- */

function ScoreHero({
  insights,
  review,
  checking,
  checkError,
  aiEnabled,
  fileName,
  onCheck,
}: {
  insights: MarketInsights;
  review: ResumeReview | null;
  checking: boolean;
  checkError: string;
  aiEnabled: boolean;
  fileName: string | null;
  onCheck: () => void;
}) {
  const coverage = keywordCoverage(insights, review);
  const sectionsGood = review?.checks.filter((check) => check.status === "good").length ?? null;

  return (
    <section aria-labelledby="score-heading" className="panel panel-raised panel-lit overflow-hidden">
      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {/* Before a check the ring is an empty placeholder; on a phone that
              was 170px of nothing above the button that fills it. */}
          <ScoreRing
            value={review?.score ?? null}
            busy={checking}
            size={168}
            className={`mx-auto sm:mx-0 ${review || checking ? "" : "hidden sm:block"}`}
          />
          <div className="min-w-0">
            <h2 id="score-heading" className="text-xl font-semibold text-gray-900 dark:text-white sm:text-2xl">
              {checking ? "Checking your resume…" : review ? scoreHeadline(review.score) : "Get your resume score"}
            </h2>
            <p
              className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base"
              role={checking ? "status" : undefined}
            >
              {checking
                ? `Reading it section by section against what ${insights.jobsAnalysed} employers ask for. About 20 seconds.`
                : review
                  ? review.verdict
                  : aiEnabled
                    ? "We read your resume against what these employers ask for, score it out of 100, and tell you exactly what to change."
                    : "The resume check is not available right now. Everything below still applies."}
            </p>

            {review && review.strengths.length > 0 && !checking && (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="What works">
                {review.strengths.map((strength) => (
                  <li key={strength}>
                    <StatusPill tone="good">{strength}</StatusPill>
                  </li>
                ))}
              </ul>
            )}

            {checkError && (
              <Alert variant="error" className="mt-4">
                {checkError}
              </Alert>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {aiEnabled && (
                <button
                  type="button"
                  onClick={onCheck}
                  disabled={checking}
                  aria-busy={checking}
                  className={review ? buttonSecondary : buttonPrimary}
                >
                  <Icon.spark className="h-4 w-4" />
                  {checking ? "Checking…" : review ? "Check again" : "Check my resume"}
                </button>
              )}
              {review && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Checked {formatDate(review.reviewedAt)}
                  {fileName ? ` · ${fileName}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MiniStat
            label={review ? "Keywords in resume" : "Keywords covered"}
            value={`${coverage.covered}/${coverage.total}`}
            sub="Of the most asked for"
            icon={<Icon.target className="h-4 w-4" />}
          />
          <MiniStat
            label="Sections in good shape"
            value={sectionsGood == null ? "–" : `${sectionsGood}/${review?.checks.length ?? 9}`}
            sub={review ? "From the check" : "Run the check"}
            icon={<Icon.checkCircle className="h-4 w-4" />}
          />
          <MiniStat
            label="Jobs like yours"
            value={insights.jobsAnalysed}
            sub={`Of ${insights.openJobs} open jobs`}
            icon={<Icon.briefcase className="h-4 w-4" />}
          />
          <MiniStat
            label="Remote"
            value={pct(insights.remoteShare)}
            sub="Of jobs like yours"
            icon={<Icon.location className="h-4 w-4" />}
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Keywords                                                                    */
/* -------------------------------------------------------------------------- */

type KeywordFilter = "all" | "have" | "missing";
const KEYWORD_PREVIEW = 10;

function KeywordsSection({ insights, review }: { insights: MarketInsights; review: ResumeReview | null }) {
  const [filter, setFilter] = useState<KeywordFilter>("all");
  const [showAllRare, setShowAllRare] = useState(false);

  const rows = useMemo(() => keywordStates(insights, review), [insights, review]);
  const have = rows.filter((row) => row.state === "resume" || row.state === "have");
  const lacking = rows.filter((row) => row.state === "profile" || row.state === "missing");
  const [expanded, setExpanded] = useState(false);
  const filtered = filter === "all" ? rows : filter === "have" ? have : lacking;
  // Ten rows say most of it; the rest is a click away rather than a long scroll.
  const shown = expanded ? filtered : filtered.slice(0, KEYWORD_PREVIEW);
  const max = Math.max(0, ...rows.map((row) => row.share));

  const filters: Array<{ id: KeywordFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: rows.length },
    { id: "have", label: review ? "In your resume" : "You have", count: have.length },
    { id: "missing", label: "Missing", count: lacking.length },
  ];

  const rare = showAllRare ? insights.rareSkills : insights.rareSkills.slice(0, 6);

  return (
    <Section
      id="keywords-heading"
      eyebrow="Keywords"
      title="What employers ask for"
      description={`The skills named most often in the ${insights.jobsAnalysed} jobs closest to your resume. Recruiters and hiring software look for these words.`}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="panel self-start overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5">
            <div role="group" aria-label="Show keywords" className="segmented">
              {filters.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={filter === option.id}
                  className="segment interactive hit-24"
                >
                  {option.label}
                  <span className="segment-count">{option.count}</span>
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Share of jobs asking</span>
          </div>

          {shown.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-600 dark:text-gray-400">
              {filter === "missing" ? "You cover every keyword on this list." : "None yet."}
            </p>
          ) : (
            <ol className="divide-y divide-gray-100 dark:divide-gray-800">
              {shown.map((row) => (
                <li
                  key={row.label}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3rem_8.5rem] sm:px-5"
                >
                  <span className="min-w-0 text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
                  <span className="order-last col-span-2 sm:order-none sm:col-span-1">
                    <Bar share={row.share} max={max} />
                  </span>
                  <Readout className="text-right text-xs font-medium text-gray-700 dark:text-gray-300">
                    {pct(row.share)}
                  </Readout>
                  <span className="col-span-2 sm:col-span-1">
                    <KeywordStatus state={row.state} />
                  </span>
                  <span className="sr-only">
                    Asked for in {row.count} of {insights.jobsAnalysed} jobs.
                  </span>
                </li>
              ))}
            </ol>
          )}
          {filtered.length > KEYWORD_PREVIEW && (
            <div className="border-t border-gray-200 px-4 py-2.5 dark:border-gray-700 sm:px-5">
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="link hit-24 inline-flex items-center gap-1 text-sm"
              >
                {expanded ? "Show fewer" : `Show all ${filtered.length}`}
                <Icon.chevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="panel p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Skills worth adding</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Often asked for but not on your profile. Add one only if you really have it, and show where you used it.
            </p>
            {insights.missing.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                Your profile already covers what these employers ask for most.
              </p>
            ) : (
              // A plain list with job links, no bars: the table beside this
              // already draws every one of these skills as a bar, and drawing
              // them twice made the two panels read as the same chart.
              <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {insights.missing.map((row) => (
                  <li key={row.label} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
                      {row.label}
                    </span>
                    <Link
                      href={jobsLink({ q: row.label })}
                      className="link hit-24 flex-shrink-0 text-xs"
                      aria-label={`See the ${row.count} jobs asking for ${row.label}`}
                    >
                      {row.count} jobs
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {insights.rareSkills.length > 0 && (
            <div className="panel-sunken rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Less in demand here</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                On your profile, but few jobs like yours mention them. Keep them; just lead with the skills above.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {rare.map((skill) => (
                  <span key={skill} className="chip chip-sm">
                    <span className="chip-label">{skill}</span>
                  </span>
                ))}
                {insights.rareSkills.length > rare.length && (
                  <button type="button" onClick={() => setShowAllRare(true)} className="link hit-24 text-xs">
                    +{insights.rareSkills.length - rare.length} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section check and rewrites                                                  */
/* -------------------------------------------------------------------------- */

function ResumeCheckSection({ review }: { review: ResumeReview }) {
  const order = { missing: 0, improve: 1, good: 2 } as const;
  const checks = [...review.checks].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <Section
      id="sections-heading"
      eyebrow="Resume check"
      title="Section by section"
      description="What each part of your resume does well, and what it is missing. The ones to fix come first."
    >
      {checks.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Summary of the check">
            {(["missing", "improve", "good"] as const).map((status) => {
              const count = checks.filter((check) => check.status === status).length;
              if (count === 0) return null;
              return (
                <StatusPill key={status} tone={CHECK_STATUS[status].tone}>
                  {count} {status === "good" ? "in good shape" : status === "improve" ? "could be better" : "missing"}
                </StatusPill>
              );
            })}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {checks.map((check) => {
              const status = CHECK_STATUS[check.status];
              return (
                <li key={check.area} className="panel flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconTile icon={CHECK_ICONS[check.area]} tone={status.tone} />
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{CHECK_LABELS[check.area]}</p>
                    </div>
                    <StatusPill tone={status.tone} className="mt-1.5">
                      {status.label}
                    </StatusPill>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{check.note}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {review.rewrites.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Stronger bullet points</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Lead with what you did and what changed. Replace anything in [brackets] with your real numbers.
          </p>
          <ul className="mt-4 space-y-3">
            {review.rewrites.map((rewrite) => (
              <li
                key={rewrite.before}
                className="panel grid overflow-hidden md:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]"
              >
                <div className="p-4 sm:p-5">
                  <StatusPill tone="bad" className="mb-2.5">
                    Now
                  </StatusPill>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{rewrite.before}</p>
                </div>
                <div className="hidden items-center justify-center md:flex" aria-hidden="true">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--surface-raised)] text-gray-500 shadow-sm ring-1 ring-gray-200 dark:text-gray-400 dark:ring-gray-700">
                    <Icon.arrowRight className="h-4 w-4" />
                  </span>
                </div>
                <div className="border-t border-gray-200 bg-success-50/60 p-4 dark:border-gray-700 dark:bg-success-400/5 sm:p-5 md:border-t-0">
                  <StatusPill tone="good" className="mb-2.5">
                    Try
                  </StatusPill>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{rewrite.after}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Job search                                                                  */
/* -------------------------------------------------------------------------- */

function experienceAdvice(insights: MarketInsights): string | null {
  const stated = insights.experience.filter((row) => row.id !== "not-stated" && row.count > 0);
  if (stated.length === 0) return null;
  const top = [...stated].sort((a, b) => b.count - a.count)[0];
  const yours = insights.experience.find((row) => row.yours);
  const years = insights.profile.yearsOfExp;
  const yearsText = years === 1 ? "1 year" : `${years} years`;

  if (!yours || years == null) {
    return `Most of these jobs that state experience ask for ${top.label.toLowerCase()}.`;
  }
  if (yours.id === top.id) {
    return `Most ask for ${top.label.toLowerCase()}, right where your ${yearsText} sit. You are aiming at the right level.`;
  }
  if (yours.count === 0) {
    return `Most ask for ${top.label.toLowerCase()} and none ask for ${yours.label.toLowerCase()}, where your ${yearsText} sit. Search for junior and graduate roles too, and apply where the rest of your resume is a close fit.`;
  }
  return `Most ask for ${top.label.toLowerCase()}; with ${yearsText} you fit ${pct(yours.share)} of them. Filter by your range so you apply where you fit best.`;
}

function SearchSection({ insights, review }: { insights: MarketInsights; review: ResumeReview | null }) {
  const advice = experienceAdvice(insights);
  const maxLocation = Math.max(0, ...insights.locations.map((row) => row.share));
  const experienceRows = insights.experience.filter((row) => row.count > 0 || row.yours);
  const maxExperience = Math.max(0, ...experienceRows.map((row) => row.share));

  return (
    <Section
      id="search-heading"
      eyebrow="Job search"
      title="Search smarter"
      description="What jobs like yours are called, where they are and what level they hire at."
    >
      {review && review.searchTips.length > 0 && (
        <ul className="mb-4 grid gap-3 md:grid-cols-2">
          {review.searchTips.map((tip) => (
            <li
              key={tip}
              className="panel panel-signal flex gap-3 p-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300"
            >
              <IconTile icon={<Icon.lightbulb className="h-4 w-4" />} tone="warn" size="sm" />
              <span className="pt-1">{tip}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Job titles to search for</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Employers use different names for the same job.</p>
          {insights.titles.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Jobs like yours go by many different titles.</p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {insights.titles.map((row) => (
                <li key={row.label}>
                  <Link href={jobsLink({ q: row.label })} className="chip chip-interactive interactive">
                    <Icon.search className="h-3.5 w-3.5" />
                    <span className="chip-label">{row.label}</span>
                    <Readout className="text-xs text-gray-500 dark:text-gray-400">{row.count}</Readout>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Where the jobs are</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {pct(insights.remoteShare)} are remote. A job can list more than one place.
          </p>
          {insights.locations.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">These jobs do not list a place.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {insights.locations.map((row) => (
                <li key={row.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <Link href={jobsLink({ location: row.label })} className="link min-w-0 truncate text-sm">
                      {row.label}
                    </Link>
                    <Readout className="text-xs text-gray-600 dark:text-gray-400">{row.count} jobs</Readout>
                  </div>
                  <Bar share={row.share} max={maxLocation} />
                </li>
              ))}
            </ol>
          )}
          {insights.types.length > 0 && (
            <p className="mt-4 border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {insights.types.map((row) => `${row.label} ${pct(row.share)}`).join(" · ")}
            </p>
          )}
        </div>

        <div className="panel p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Experience asked for</h3>
          {advice && <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{advice}</p>}
          <ol className="mt-4 space-y-3">
            {experienceRows.map((row) => (
              <li key={row.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {row.id !== "not-stated" ? (
                      <Link href={jobsLink({ experience: row.id })} className="link truncate">
                        {row.label}
                      </Link>
                    ) : (
                      <span className="truncate text-gray-700 dark:text-gray-300">{row.label}</span>
                    )}
                    {row.yours && (
                      <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent-text)]">
                        You
                      </span>
                    )}
                  </span>
                  <Readout className="text-xs text-gray-600 dark:text-gray-400">{row.count} jobs</Readout>
                </div>
                <Bar share={row.share} max={maxExperience} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
