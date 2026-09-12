"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import {
  Alert,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  Meter,
  PageHeading,
  Readout,
  Spinner,
  StatusBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/app/components/ui";

/**
 * Career coach — gap analysis, a cover letter draft and interview prep against
 * one posting.
 *
 * The page holds every result it has fetched, keyed by role and tool. Each of
 * these is a generation call, so flipping between the three tabs, or back to a
 * role looked at earlier, must never spend a second one — only the explicit
 * Run buttons do.
 */

/* -------------------------------------------------------------------------- */
/* API shapes                                                                  */
/* -------------------------------------------------------------------------- */

const MODES = ["gap", "letter", "interview"] as const;
type Mode = (typeof MODES)[number];

/**
 * The exact sentence `/api/ai/coach` returns with a 503 when `GEMINI_API_KEY`
 * is unset. `apiFetch` throws an Error carrying only the server's message, so
 * matching on it is how this page tells "AI is switched off on this
 * deployment" — an explanation — from "the call failed" — an error.
 */
const AI_DISABLED_MESSAGE = "AI features are not configured on this deployment.";

interface JobRef {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  type: string | null;
  isActive: boolean;
}

/** Mirror of `MatchBreakdown` in `lib/ai/matching.ts`; that module imports Prisma. */
interface MatchBreakdown {
  score: number;
  facets: { semantic: number; skills: number; location: number; seniority: number };
  sharedSkills: string[];
  missingSkills: string[];
}

interface GapPayload {
  summary: string;
  strengths: { point: string; evidence: string }[];
  gaps: { requirement: string; why: string; severity: string }[];
  nextSteps: { action: string; effort: string }[];
  emphasise: string[];
}

interface LetterPayload {
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** The profile facts the model says it drew on — an audit trail, not decoration. */
  groundedOn: string[];
  /** What the posting asks for that the letter deliberately does not claim. */
  omitted: string[];
}

interface InterviewPayload {
  questions: { question: string; probes: string; prepare: string; kind: string }[];
  askThem: string[];
}

/**
 * One response shape with optional branches rather than a discriminated union:
 * the server answers "your profile is too thin for this" with a 200 and a
 * `blocked` block, because that is an answer rather than a failure.
 */
interface CoachResponse {
  mode: Mode;
  job: JobRef;
  blocked?: { reason: string; message: string; missing: string[] };
  match?: MatchBreakdown | null;
  gap?: GapPayload;
  letter?: LetterPayload;
  interview?: InterviewPayload;
}

/** `GET /api/applications` for a seeker. */
interface ApplicationRow {
  id: string;
  status: string;
  matchScore?: number | null;
  job: {
    id: string;
    title: string;
    location?: string | null;
    type?: string | null;
    company?: { id: string; name: string } | null;
  };
}

/** `GET /api/jobs`, trimmed to what the picker shows. */
interface FeedJob {
  id: string;
  title: string;
  location?: string | null;
  type?: string | null;
  isActive?: boolean;
  company?: { id: string; name: string } | null;
  match?: MatchBreakdown | null;
}

/** A role in the picker, from either source. */
interface RoleOption {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  type: string | null;
  /** Set only for roles the seeker has applied to. */
  status: string | null;
  score: number | null;
}

/* -------------------------------------------------------------------------- */
/* Tool copy                                                                   */
/* -------------------------------------------------------------------------- */

const TOOLS: Record<Mode, { tab: string; title: string; blurb: string; cta: string }> = {
  gap: {
    tab: "Gap",
    title: "Gap analysis",
    blurb:
      "What this posting asks for, what your profile already evidences, and what to do about the difference.",
    cta: "Analyse the gap",
  },
  letter: {
    tab: "Letter",
    title: "Cover letter draft",
    blurb:
      "A first draft grounded strictly in your profile. It is yours to edit — nothing goes anywhere until you send it.",
    cta: "Draft a letter",
  },
  interview: {
    tab: "Interview",
    title: "Interview preparation",
    blurb: "Questions this role is likely to ask, and what each one is really probing for.",
    cta: "Prepare questions",
  },
};

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function SeekerCoachPage() {
  const { ready, allowed } = useAuthGuard(["SEEKER"]);
  const toast = useToast();

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [rolesError, setRolesError] = useState("");
  const [filter, setFilter] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("gap");

  /** Every result fetched this session, keyed `${jobId}:${mode}`. */
  const [results, setResults] = useState<Record<string, CoachResponse>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});

  /** The editable letter, per role. Seeded from a result, then owned by the user. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /**
   * Set once any call comes back 503. It is a property of the deployment, not
   * of the request, so it survives switching role or tool.
   */
  const [aiOff, setAiOff] = useState(false);

  /* ---------------------------------------------------------------------- */
  /* Roles                                                                   */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;

    // Two independent lists, settled independently: an empty application list
    // is normal for a new seeker and must not cost them the job feed.
    void Promise.allSettled([
      apiFetch<ApplicationRow[]>("/api/applications"),
      apiFetch<FeedJob[]>("/api/jobs"),
    ]).then(([applied, open]) => {
      if (cancelled) return;

      const options: RoleOption[] = [];
      const seen = new Set<string>();

      if (applied.status === "fulfilled" && Array.isArray(applied.value)) {
        for (const row of applied.value) {
          if (!row.job?.id || seen.has(row.job.id)) continue;
          seen.add(row.job.id);
          options.push({
            id: row.job.id,
            title: row.job.title,
            company: row.job.company?.name ?? null,
            location: row.job.location ?? null,
            type: row.job.type ?? null,
            status: row.status,
            score: typeof row.matchScore === "number" ? row.matchScore : null,
          });
        }
      }

      if (open.status === "fulfilled" && Array.isArray(open.value)) {
        for (const job of open.value) {
          if (!job?.id || seen.has(job.id)) continue;
          seen.add(job.id);
          options.push({
            id: job.id,
            title: job.title,
            company: job.company?.name ?? null,
            location: job.location ?? null,
            type: job.type ?? null,
            status: null,
            score: typeof job.match?.score === "number" ? job.match.score : null,
          });
        }
      }

      if (applied.status === "rejected" && open.status === "rejected") {
        const reason = open.reason;
        setRolesError(reason instanceof Error ? reason.message : "Could not load your roles");
      }

      setRoles(options);
      setLoadingRoles(false);
    });

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const visibleRoles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return roles;
    return roles.filter(
      (role) =>
        role.title.toLowerCase().includes(needle) ||
        (role.company ?? "").toLowerCase().includes(needle)
    );
  }, [roles, filter]);

  const selected = useMemo(
    () => roles.find((role) => role.id === selectedId) ?? null,
    [roles, selectedId]
  );

  /* ---------------------------------------------------------------------- */
  /* Running a tool                                                          */
  /* ---------------------------------------------------------------------- */

  const key = selectedId ? `${selectedId}:${mode}` : "";
  const result = key ? results[key] : undefined;
  const runError = key ? runErrors[key] : undefined;

  const run = useCallback(
    async (jobId: string, tool: Mode) => {
      const cacheKey = `${jobId}:${tool}`;
      setRunning(cacheKey);
      setRunErrors((current) => ({ ...current, [cacheKey]: "" }));

      try {
        const response = await apiFetch<CoachResponse>("/api/ai/coach", {
          method: "POST",
          body: JSON.stringify({ mode: tool, jobId }),
        });
        setResults((current) => ({ ...current, [cacheKey]: response }));

        // A re-run replaces the draft: the user asked for a new one.
        if (tool === "letter" && response.letter) {
          setDrafts((current) => ({ ...current, [jobId]: composeLetter(response.letter!) }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        if (message === AI_DISABLED_MESSAGE) {
          setAiOff(true);
          return;
        }
        setRunErrors((current) => ({ ...current, [cacheKey]: message }));
      } finally {
        setRunning(null);
      }
    },
    []
  );

  const copyLetter = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied");
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded browsers; the text is in a textarea either way.
      toast.error("Copy was blocked — select the text and copy it manually");
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner label="Loading your coach" />
      </div>
    );
  }

  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <Link href="/seeker/dashboard" className={`${buttonGhost} -ml-2.5 mb-5`}>
          <Icon.arrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <PageHeading
          eyebrow="Seeker tools"
          title="Career coach"
          description="Pick a role, then work on it: where you stand against it, a letter to send, and the questions to expect."
          className="mb-6"
        />

        {aiOff ? (
          <Card grid>
            <EmptyState
              icon={<Icon.spark className="h-6 w-6" />}
              title="Coaching is switched off here"
              description="This deployment has no model key configured, so gap analysis, letter drafting and interview prep are unavailable. Everything else — browsing, applying, messaging — works exactly as normal."
              action={
                <Link href="/jobs" className={buttonSecondary}>
                  Browse roles
                  <Icon.arrowRight className="h-4 w-4" />
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
            {/* ------------------------------------------------------ */}
            {/* Role picker                                             */}
            {/* ------------------------------------------------------ */}
            <div className="lg:col-span-1">
              <Card className="lg:sticky lg:top-24">
                <CardHeader
                  eyebrow="Step one"
                  title="Choose a role"
                  description="Your applications first, then everything else open."
                />

                <div className="border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4">
                  <label htmlFor="role-filter" className="sr-only">
                    Filter roles
                  </label>
                  <input
                    id="role-filter"
                    type="search"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter by title or company"
                    className={`${inputClass} text-sm`}
                  />
                </div>

                {loadingRoles ? (
                  <div className="flex justify-center py-10">
                    <Spinner className="h-6 w-6" label="Loading roles" />
                  </div>
                ) : rolesError ? (
                  <div className="p-3 sm:p-4">
                    <Alert variant="error">{rolesError}</Alert>
                  </div>
                ) : visibleRoles.length === 0 ? (
                  <EmptyState
                    icon={<Icon.briefcase className="h-6 w-6" />}
                    title={roles.length === 0 ? "No roles yet" : "Nothing matches that"}
                    description={
                      roles.length === 0
                        ? "Once there are open postings, or you have applied to one, they show up here."
                        : "Try a shorter filter."
                    }
                    action={
                      roles.length === 0 ? (
                        <Link href="/jobs" className={buttonSecondary}>
                          Browse roles
                        </Link>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="max-h-[24rem] list-none overflow-y-auto lg:max-h-[30rem]">
                    {visibleRoles.map((role) => (
                      <li key={role.id}>
                        <RoleRow
                          role={role}
                          selected={role.id === selectedId}
                          onSelect={() => setSelectedId(role.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* ------------------------------------------------------ */}
            {/* Tools                                                   */}
            {/* ------------------------------------------------------ */}
            <div className="lg:col-span-2">
              {!selected ? (
                <Card grid>
                  <EmptyState
                    icon={<Icon.graph className="h-6 w-6" />}
                    title="Pick a role to start"
                    description="Everything here is written against one specific posting, so there is nothing useful to say until you choose one."
                  />
                </Card>
              ) : (
                <Card>
                  <CardHeader
                    eyebrow="Working on"
                    title={selected.title}
                    description={
                      [selected.company, selected.location].filter(Boolean).join(" · ") || undefined
                    }
                    action={
                      <Link href={`/jobs/${selected.id}`} className={buttonGhost}>
                        View posting
                        <Icon.arrowUpRight className="h-4 w-4" />
                      </Link>
                    }
                  />

                  {/* Three equal columns: the labels are short enough to hold
                      at 360px without scrolling or truncation. */}
                  <div
                    role="tablist"
                    aria-label="Coaching tools"
                    className="grid grid-cols-3 border-b border-gray-200 dark:border-gray-700"
                  >
                    {MODES.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        role="tab"
                        id={`coach-tab-${tool}`}
                        aria-selected={mode === tool}
                        aria-controls={`coach-panel-${tool}`}
                        onClick={() => setMode(tool)}
                        className={`px-2 py-3 text-sm font-medium transition-colors focus-inset ${
                          mode === tool
                            ? "border-b-2 border-green-500 text-gray-900 dark:text-white"
                            : "border-b-2 border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                        }`}
                      >
                        {TOOLS[tool].tab}
                      </button>
                    ))}
                  </div>

                  <div
                    role="tabpanel"
                    id={`coach-panel-${mode}`}
                    aria-labelledby={`coach-tab-${mode}`}
                    className="p-4 sm:p-6"
                  >
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                          {TOOLS[mode].title}
                        </h3>
                        <p className="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
                          {TOOLS[mode].blurb}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void run(selected.id, mode)}
                        disabled={running === key}
                        className={`${buttonSecondary} flex-shrink-0`}
                      >
                        {running === key ? (
                          <>
                            <Spinner className="h-4 w-4" />
                            Working&hellip;
                          </>
                        ) : (
                          <>
                            <Icon.spark className="h-4 w-4" />
                            {result ? "Run again" : TOOLS[mode].cta}
                          </>
                        )}
                      </button>
                    </div>

                    {runError && (
                      <Alert variant="error" className="mb-5">
                        {runError}
                      </Alert>
                    )}

                    {running === key && !result ? (
                      <div className="flex justify-center py-10">
                        <Spinner label="Reading the posting against your profile" />
                      </div>
                    ) : !result ? (
                      <IdlePanel mode={mode} />
                    ) : result.blocked ? (
                      <ThinProfilePanel blocked={result.blocked} />
                    ) : mode === "gap" && result.gap ? (
                      <GapPanel gap={result.gap} match={result.match ?? null} />
                    ) : mode === "letter" && result.letter ? (
                      <LetterPanel
                        letter={result.letter}
                        draft={drafts[selected.id] ?? composeLetter(result.letter)}
                        onDraftChange={(value) =>
                          setDrafts((current) => ({ ...current, [selected.id]: value }))
                        }
                        onRestore={() =>
                          setDrafts((current) => ({
                            ...current,
                            [selected.id]: composeLetter(result.letter!),
                          }))
                        }
                        onCopy={copyLetter}
                      />
                    ) : mode === "interview" && result.interview ? (
                      <InterviewPanel interview={result.interview} />
                    ) : (
                      <IdlePanel mode={mode} />
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local primitives                                                            */
/* -------------------------------------------------------------------------- */

/** Flattens the structured letter into the plain text a user actually sends. */
function composeLetter(letter: LetterPayload): string {
  return [letter.greeting, ...letter.paragraphs, letter.closing]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** One selectable role. A button rather than a link — it changes state here. */
function RoleRow({
  role,
  selected,
  onSelect,
}: {
  role: RoleOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`interactive w-full border-b border-gray-200 px-4 py-3 text-left last:border-b-0 focus-inset dark:border-gray-700 ${
        selected ? "bg-green-50 dark:bg-green-950/25" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
            {role.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
            {role.company ?? "Company"}
            {role.location ? ` · ${role.location}` : ""}
          </span>
        </span>
        {typeof role.score === "number" && (
          <Readout className="flex-shrink-0 pt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {role.score}%
          </Readout>
        )}
      </div>
      {role.status && (
        <span className="mt-2 flex">
          <StatusBadge status={role.status} />
        </span>
      )}
    </button>
  );
}

/** Nothing run yet. Says what the button will do rather than showing a blank. */
function IdlePanel({ mode }: { mode: Mode }) {
  return (
    <div className="panel-sunken border-dashed px-4 py-8 text-center">
      <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {mode === "letter"
          ? "Nothing is written until you ask for it. The draft comes from your profile only — the fuller that is, the better the letter."
          : "Run this when you are ready. Your profile is read against this posting; nothing is shared with the employer."}
      </p>
    </div>
  );
}

/**
 * The "there is not enough here yet" answer.
 *
 * Rendered as guidance with a route to the fix, not as a failure — the whole
 * point of the server refusing is that a thin profile should send the user to
 * their profile, not hand them an invented career.
 */
function ThinProfilePanel({
  blocked,
}: {
  blocked: { reason: string; message: string; missing: string[] };
}) {
  return (
    <div>
      <Alert variant="info">{blocked.message}</Alert>

      {blocked.missing.length > 0 && (
        <div className="mt-4">
          <Eyebrow className="mb-2">Add these</Eyebrow>
          <ul className="list-none space-y-2">
            {blocked.missing.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <Icon.plus className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Link href="/seeker/profile/edit" className={buttonPrimary}>
          <Icon.edit className="h-4 w-4" />
          Edit my profile
        </Link>
        <Link href="/seeker/dashboard" className={buttonSecondary}>
          <Icon.upload className="h-4 w-4" />
          Upload a r&eacute;sum&eacute;
        </Link>
      </div>
    </div>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  Critical: "text-red-600 dark:text-red-400",
  Important: "text-amber-600 dark:text-amber-400",
  "Nice to have": "text-gray-500 dark:text-gray-400",
};

function GapPanel({ gap, match }: { gap: GapPayload; match: MatchBreakdown | null }) {
  return (
    <div className="space-y-6">
      {match && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-baseline gap-1.5">
            <Icon.pulse
              className="h-4 w-4 flex-shrink-0 self-center text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
            <Readout className="text-2xl font-semibold leading-none text-gray-900 dark:text-white">
              {match.score}
            </Readout>
            <Readout className="text-base font-semibold leading-none text-gray-400 dark:text-gray-500">
              %
            </Readout>
          </div>
          <Eyebrow className="mt-2">Profile fit</Eyebrow>
          <Meter
            value={match.score}
            label={`Overall profile fit: ${match.score} out of 100`}
            className="mt-3"
          />
        </div>
      )}

      {gap.summary && (
        <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {gap.summary}
        </p>
      )}

      {gap.strengths.length > 0 && (
        <section>
          <Eyebrow accent className="mb-3">
            What you already show
          </Eyebrow>
          <ul className="list-none space-y-3">
            {gap.strengths.map((item) => (
              <li key={item.point} className="flex items-start gap-2.5">
                <Icon.check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">
                    {item.point}
                  </span>
                  {item.evidence && (
                    <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
                      {item.evidence}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gap.gaps.length > 0 && (
        <section>
          <Eyebrow className="mb-3">Not evidenced yet</Eyebrow>
          <ul className="list-none space-y-3">
            {gap.gaps.map((item) => (
              <li
                key={item.requirement}
                className="border-l-2 border-gray-200 pl-3 dark:border-gray-700"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {item.requirement}
                  </span>
                  <Eyebrow
                    as="span"
                    className={SEVERITY_TONE[item.severity] ?? "text-gray-500 dark:text-gray-400"}
                  >
                    {item.severity}
                  </Eyebrow>
                </span>
                {item.why && (
                  <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
                    {item.why}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Same framing as the job page's breakdown: unevidenced is not the
              same as absent, and the fix is often the profile, not a course. */}
          <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            These are things the posting asks for that your profile does not mention. If you have
            them, the fastest fix is to say so on your profile.
          </p>
        </section>
      )}

      {gap.nextSteps.length > 0 && (
        <section>
          <Eyebrow className="mb-3">Next steps</Eyebrow>
          <ol className="list-none space-y-3">
            {gap.nextSteps.map((step, index) => (
              <li key={step.action} className="flex items-start gap-3">
                <span
                  className="mono mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-700 dark:text-gray-300">
                    {step.action}
                  </span>
                  <Eyebrow as="span" className="mt-0.5 block">
                    {step.effort}
                  </Eyebrow>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {gap.emphasise.length > 0 && (
        <section>
          <Eyebrow className="mb-2">Lead with</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {gap.emphasise.map((tag) => (
              <Chip key={tag} accent>
                {tag}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <p className="border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Advice, not a verdict. It is written from your profile and this posting alone, and it has no
        bearing on how the employer reads your application.
      </p>
    </div>
  );
}

function LetterPanel({
  letter,
  draft,
  onDraftChange,
  onRestore,
  onCopy,
}: {
  letter: LetterPayload;
  draft: string;
  onDraftChange: (value: string) => void;
  onRestore: () => void;
  onCopy: (text: string) => void;
}) {
  const original = composeLetter(letter);
  const edited = draft !== original;

  return (
    <div className="space-y-5">
      {/* First thing in the panel, before the text itself: a draft that reads
          as finished is a draft that gets sent unread. */}
      <Alert variant="warning">
        <span className="font-medium">This is a draft, and it is yours.</span> It was written from
        your profile only, so it will not claim anything you have not told us — which also means it
        will be missing things you know about yourself. Read it, change it, and make it sound like
        you before you send it.
      </Alert>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="letter-draft"
            className="eyebrow"
          >
            Editable draft
          </label>
          <div className="flex flex-wrap gap-2">
            {edited && (
              <button type="button" onClick={onRestore} className={buttonGhost}>
                Restore generated text
              </button>
            )}
            <button type="button" onClick={() => onCopy(draft)} className={buttonGhost}>
              <Icon.document className="h-4 w-4" />
              Copy
            </button>
          </div>
        </div>
        <textarea
          id="letter-draft"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          rows={16}
          spellCheck
          className={`${inputClass} resize-y text-sm leading-relaxed`}
        />
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Nothing here is saved. Copy it into the cover letter box when you apply.
        </p>
      </div>

      {letter.groundedOn.length > 0 && (
        <section>
          <Eyebrow accent className="mb-2">
            Written from
          </Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {letter.groundedOn.map((fact) => (
              <Chip key={fact}>{fact}</Chip>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            The only facts about you the draft was allowed to use. If something here is wrong, fix
            your profile rather than the letter.
          </p>
        </section>
      )}

      {letter.omitted.length > 0 && (
        <section>
          <Eyebrow className="mb-2">Deliberately left out</Eyebrow>
          <ul className="list-none space-y-1.5">
            {letter.omitted.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400"
              >
                <Icon.x className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            This posting asks for these and your profile does not evidence them, so the draft does
            not claim them. If any of it is true of you, add it yourself.
          </p>
        </section>
      )}
    </div>
  );
}

function InterviewPanel({ interview }: { interview: InterviewPayload }) {
  return (
    <div className="space-y-6">
      <ol className="list-none space-y-4">
        {interview.questions.map((item, index) => (
          <li
            key={item.question}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Eyebrow as="span">
                Q{String(index + 1).padStart(2, "0")}
              </Eyebrow>
              <Eyebrow as="span">{item.kind}</Eyebrow>
            </div>
            <p className="text-sm font-medium leading-relaxed text-gray-900 dark:text-white">
              {item.question}
            </p>
            {item.probes && (
              <p className="mt-2.5 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  Really asking:{" "}
                </span>
                {item.probes}
              </p>
            )}
            {item.prepare && (
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">Have ready: </span>
                {item.prepare}
              </p>
            )}
          </li>
        ))}
      </ol>

      {interview.askThem.length > 0 && (
        <section>
          <Eyebrow accent className="mb-3">
            Worth asking them
          </Eyebrow>
          <ul className="list-none space-y-2">
            {interview.askThem.map((question) => (
              <li
                key={question}
                className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300"
              >
                <Icon.chat className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                <span>{question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Predicted from the posting and your profile. Treat it as practice, not as a leaked question
        list.
      </p>
    </div>
  );
}
