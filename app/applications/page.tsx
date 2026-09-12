"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
// A bare constant object; `lib/ai/config` has no imports of its own, so the
// weights shown beside each bar are the weights the scorer actually uses.
import { MATCH_WEIGHTS } from "@/lib/ai/config";
import { MATCH_CAVEAT_EMPLOYER } from "@/lib/copy";

/**
 * One page-level caveat node that every per-row fit readout points at, so a
 * screen-reader user querying a score hears the qualifier as part of it rather
 * than never (DESIGN-NOTES 2.4). The sentence itself lives in `lib/copy.ts`.
 */
const fitCaveatId = "fit-caveat";
import ApplicationsLoading from "./loading";
import { apiFetch, authHeaders } from "@/lib/clientAuth";
import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/validation";
import {
  Alert,
  Avatar,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  formatCount,
  formatDate,
  Icon,
  inputClass,
  Label,
  MatchScore,
  Meter,
  MeterRow,
  PageHeading,
  Readout,
  SkeletonRows,
  Spinner,
  StatCard,
  StatusBadge,
} from "@/app/components/ui";

/* -------------------------------------------------------------------------- */
/* Types — mirror `GET /api/applications?companyId=…`                          */
/* -------------------------------------------------------------------------- */

interface Resume {
  id: string;
  url: string;
  fileName?: string | null;
  createdAt: string;
}

/**
 * Mirrors `MatchBreakdown` in `lib/ai/matching.ts`. Declared here rather than
 * imported because that module reaches for Prisma and the Gemini client, and
 * none of that belongs in a browser bundle. Facets are already 0–100 integers.
 */
interface MatchBreakdown {
  score: number;
  facets: {
    semantic: number;
    skills: number;
    location: number;
    seniority: number;
  };
  sharedSkills: string[];
  missingSkills: string[];
}

/**
 * One screening answer, joined to the question it answers.
 *
 * `knockout` and `expected` are the answer key, and `GET /api/applications`
 * only attaches them on the employer branch — the same rule
 * `GET /api/jobs/:jobId/questions` applies. They are here so the employer can
 * see *why* an answer is flagged; they are never sent to the applicant.
 */
interface ScreeningAnswer {
  id: string;
  value: string;
  question: {
    id: string;
    prompt: string;
    kind: string;
    options: string[];
    required: boolean;
    knockout: boolean;
    expected: string | null;
    position: number;
  };
}

/**
 * Whether an answer disagrees with the one the employer said they wanted.
 *
 * Compared case-insensitively, and only when the question is actually a
 * knockout with something to compare against — the questions route already
 * refuses to store the flag without an expected answer, and this is the reading
 * half of that same rule.
 *
 * The result decorates a row. It never removes one: nothing in this file
 * filters, sorts or hides on it, because the authoring UI promises the employer
 * that a knockout "marks an application, it does not reject or hide one", and
 * that promise is only kept here.
 */
function isKnockoutMiss(answer: ScreeningAnswer): boolean {
  const { knockout, expected } = answer.question;
  if (!knockout || !expected) return false;
  return answer.value.trim().toLowerCase() !== expected.trim().toLowerCase();
}

interface Application {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
  /** Ordered by the question's position. Absent on a posting that asks nothing. */
  answers?: ScreeningAnswer[];
  /** The fit frozen when this person applied. Always present on the row. */
  matchScore?: number | null;
  /** Only ever populated by `?rank=fit&jobId=…` — a live score against one posting. */
  match?: MatchBreakdown | null;
  user: {
    id: string;
    name: string;
    email: string;
    resumes?: Resume[];
  };
  job: {
    id: string;
    title: string;
    company: { name: string };
  };
}

interface JobOption {
  id: string;
  title: string;
}

interface Filters {
  search: string;
  status: string;
  jobId: string;
  hasResume: string;
}

const EMPTY_FILTERS: Filters = { search: "", status: "", jobId: "", hasResume: "" };

/** "recent" is the historical behaviour and stays the default. */
type SortMode = "recent" | "fit";

/* -------------------------------------------------------------------------- */
/* Pool summary — POST /api/ai/review { mode: 'pipeline' }                     */
/* -------------------------------------------------------------------------- */

/** Deterministic counts the route computes itself rather than asking the model. */
interface PipelineStats {
  total: number;
  withProfile: number;
  byStatus: Record<string, number>;
  topSkills: { skill: string; count: number }[];
  seniorityMix: { level: string; count: number }[];
}

interface PipelineSummary {
  overview: string;
  commonStrengths: string[];
  notableGaps: string[];
  whatToProbe: string[];
  /** The pool may be larger than what the model was shown. */
  sampled: number;
}

interface PipelineResult {
  jobId: string;
  jobTitle: string;
  stats: PipelineStats;
  /** Null when the pool is too small to characterise — a real answer, not a failure. */
  summary: PipelineSummary | null;
  reason: "empty" | "too-small" | null;
}

type PipelineOutcome =
  | { ok: true; data: PipelineResult }
  /** `unavailable` is the 503: no model on this deployment, so stop offering it. */
  | { ok: false; unavailable: boolean; message: string };

const PIPELINE_FAILED = "The pool summary is unavailable right now. Please try again in a moment.";

/**
 * Deliberately not `apiFetch`: that helper turns every failure into one Error
 * message, and this caller has to tell "this deployment has no model" (503,
 * hide the feature silently) apart from "the call failed" (502 or a network
 * blip, worth showing).
 */
async function requestPipeline(jobId: string): Promise<PipelineOutcome> {
  try {
    const res = await fetch("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ mode: "pipeline", jobId }),
    });

    if (res.status === 503) return { ok: false, unavailable: true, message: "" };

    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : PIPELINE_FAILED;
      return { ok: false, unavailable: false, message };
    }

    return { ok: true, data: data as PipelineResult };
  } catch (error) {
    console.error("Pipeline summary request failed:", error);
    return { ok: false, unavailable: false, message: PIPELINE_FAILED };
  }
}

export default function ApplicationsPage() {
  const { ready, allowed, user } = useAuthGuard(["COMPANY"]);
  const router = useRouter();
  const toast = useToast();

  const [applications, setApplications] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [messagingUserId, setMessagingUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortMode>("recent");
  // Latched: once a scored row has been seen the sort control stays available,
  // so it cannot flicker away mid-session when a filter empties the list.
  const [scoresSeen, setScoresSeen] = useState(false);

  // Optimistic, like every other AI affordance in the product: offered until
  // the endpoint answers 503 once, then gone for the session.
  const [pipelineAvailable, setPipelineAvailable] = useState(true);
  /** Keyed by job so switching roles back and forth does not re-bill a model call. */
  const [pipelines, setPipelines] = useState<Record<string, PipelineResult>>({});
  const [pipelineLoading, setPipelineLoading] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState("");

  const companyId = user?.companyId;

  // Live scoring only happens when the server is given one posting to score
  // against, so the job id is only worth sending while ranking by fit.
  const rankJobId = sort === "fit" ? filters.jobId : "";

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    // The endpoint defaults to the caller's own company, so the query param is
    // only a hint — never a way to read someone else's applications.
    const companyQuery = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";

    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    if (sort === "fit") {
      params.set("rank", "fit");
      if (rankJobId) params.set("jobId", rankJobId);
    }
    const applicationQuery = params.toString() ? `?${params.toString()}` : "";

    try {
      const [applicationList, jobList] = await Promise.all([
        apiFetch<Application[]>(`/api/applications${applicationQuery}`),
        apiFetch<JobOption[]>(`/api/jobs${companyQuery}`),
      ]);
      setApplications(Array.isArray(applicationList) ? applicationList : []);
      setJobs(Array.isArray(jobList) ? jobList.map(({ id, title }) => ({ id, title })) : []);
    } catch (error) {
      console.error("Failed to load applications:", error);
      setLoadError(error instanceof Error ? error.message : "Could not load applications");
    } finally {
      setLoading(false);
    }
  }, [companyId, sort, rankJobId]);

  useEffect(() => {
    if (allowed) void loadData();
  }, [allowed, loadData]);

  // A deployment with no Gemini key returns `match: null` and a null
  // `matchScore` on every row. That is not an error state — it just means there
  // is nothing to sort by, so the affordance never appears at all.
  useEffect(() => {
    if (scoresSeen) return;
    const scored = applications.some(
      (application) => application.match != null || typeof application.matchScore === "number"
    );
    if (scored) setScoresSeen(true);
  }, [applications, scoresSeen]);

  // A failure belongs to the run that produced it, not to whatever role the
  // employer selects next.
  useEffect(() => {
    setPipelineError("");
  }, [filters.jobId]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const status of APPLICATION_STATUSES) counts[status] = 0;
    for (const application of applications) {
      if (application.status in counts) counts[application.status] += 1;
    }
    return counts;
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return applications.filter((application) => {
      const matchesSearch =
        !term ||
        application.user.name.toLowerCase().includes(term) ||
        application.user.email.toLowerCase().includes(term);
      const matchesStatus = !filters.status || application.status === filters.status;
      const matchesJob = !filters.jobId || application.job.id === filters.jobId;
      const resumeCount = application.user.resumes?.length ?? 0;
      const matchesResume =
        !filters.hasResume ||
        (filters.hasResume === "yes" && resumeCount > 0) ||
        (filters.hasResume === "no" && resumeCount === 0);
      return matchesSearch && matchesStatus && matchesJob && matchesResume;
    });
  }, [applications, filters]);

  const filtersActive =
    Boolean(filters.search) || Boolean(filters.status) || Boolean(filters.jobId) || Boolean(filters.hasResume);

  /* ----------------------------- pool summary ----------------------------- */

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === filters.jobId) ?? null,
    [jobs, filters.jobId]
  );

  const loadPipeline = async (jobId: string) => {
    if (!jobId || pipelineLoading) return;

    setPipelineLoading(jobId);
    setPipelineError("");
    const outcome = await requestPipeline(jobId);
    setPipelineLoading(null);

    if (outcome.ok) {
      setPipelines((current) => ({ ...current, [jobId]: outcome.data }));
      return;
    }
    if (outcome.unavailable) {
      setPipelineAvailable(false);
      return; // Nothing the employer can act on — say nothing.
    }
    setPipelineError(outcome.message);
  };

  /* ------------------------------- mutations ------------------------------ */

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    const previous = applications;
    setUpdatingStatus(applicationId);
    // Update the single row in place rather than refetching the whole list, and
    // roll it back if the request fails.
    setApplications((current) =>
      current.map((application) =>
        application.id === applicationId ? { ...application, status } : application
      )
    );

    try {
      await apiFetch("/api/applications", {
        method: "PATCH",
        body: JSON.stringify({ id: applicationId, status }),
      });
      toast.success(
        `Marked as ${STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status} — the applicant has been notified`
      );
    } catch (error) {
      console.error("Failed to update application status:", error);
      setApplications(previous);
      toast.error(error instanceof Error ? error.message : "Could not update the application");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const startConversation = async (applicantId: string) => {
    setMessagingUserId(applicantId);
    try {
      const conversation = await apiFetch<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: applicantId }),
      });
      router.push(`/conversations?conversationId=${conversation.id}`);
    } catch (error) {
      console.error("Failed to start conversation:", error);
      toast.error(error instanceof Error ? error.message : "Could not start the conversation");
    } finally {
      setMessagingUserId(null);
    }
  };

  /* -------------------------------- render -------------------------------- */

  // The same skeleton the route’s `loading.tsx` shows, so the rehydration
  // wait and the navigation wait are one state rather than two, and neither is
  // a centred spinner that a full page of content then shoves aside
  // (DESIGN-NOTES 1.4, 5.4).
  if (!ready) return <ApplicationsLoading />;

  if (!allowed) return null; // the guard is already redirecting

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Candidate queue"
          title="Job applications"
          description="Review and respond to everyone who applied to your postings."
        />

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          <StatCard
            label="Pending"
            value={formatCount(statusCounts.PENDING ?? 0)}
            tone="amber"
            icon={<Icon.clock className="h-5 w-5" />}
            hint="Not yet triaged"
          />
          <StatCard
            label="Shortlisted"
            value={formatCount(statusCounts.SHORTLISTED ?? 0)}
            tone="blue"
            icon={<Icon.checkCircle className="h-5 w-5" />}
            hint="Moved forward"
          />
          <StatCard
            label="Interview"
            value={formatCount(statusCounts.INTERVIEW ?? 0)}
            tone="purple"
            icon={<Icon.badge className="h-5 w-5" />}
            hint="Scheduled or in progress"
          />
          <StatCard
            label="Accepted"
            value={formatCount(statusCounts.ACCEPTED ?? 0)}
            tone="green"
            icon={<Icon.check className="h-5 w-5" />}
            hint="Offer extended"
          />
          <StatCard
            label="Rejected"
            value={formatCount(statusCounts.REJECTED ?? 0)}
            tone="red"
            icon={<Icon.x className="h-5 w-5" />}
            hint="Closed out"
          />
        </div>

        {/* Filter bar — one hairline strip, stacking to a column on phones. */}
        <Card className="mt-4">
          <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-end lg:gap-4">
            <div className="min-w-0 lg:flex-1">
              <Label htmlFor="filter-search">Search</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400"
                  aria-hidden="true"
                >
                  <Icon.search className="h-4 w-4" />
                </span>
                {/* `.field` is unlayered CSS and sets `padding` as a shorthand, so
                    the room for the leading icon has to be marked important. */}
                <input
                  type="search"
                  id="filter-search"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, search: event.target.value }))
                  }
                  placeholder="Name or email"
                  className={`${inputClass} pl-10!`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:items-end lg:gap-3">
              <div className="min-w-0 lg:w-40">
                <Label htmlFor="filter-status">Status</Label>
                <select
                  id="filter-status"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">All statuses</option>
                  {APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-0 lg:w-44">
                <Label htmlFor="filter-job">Role</Label>
                <select
                  id="filter-job"
                  value={filters.jobId}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, jobId: event.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">All roles</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-0 lg:w-40">
                <Label htmlFor="filter-resume">R&eacute;sum&eacute;</Label>
                <select
                  id="filter-resume"
                  value={filters.hasResume}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, hasResume: event.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">All applications</option>
                  <option value="yes">With r&eacute;sum&eacute;</option>
                  <option value="no">Without r&eacute;sum&eacute;</option>
                </select>
              </div>

              {/* Only rendered once a scored row has actually arrived: on a
                  deployment without a model there is nothing to sort by, and an
                  option that cannot change the order is just noise. */}
              {scoresSeen && (
                <div className="min-w-0 lg:w-40">
                  <Label htmlFor="filter-sort">Sort by</Label>
                  <select
                    id="filter-sort"
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value === "fit" ? "fit" : "recent")
                    }
                    className={inputClass}
                  >
                    <option value="recent">Most recent</option>
                    <option value="fit">Best fit</option>
                  </select>
                </div>
              )}
            </div>

            {filtersActive && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className={`${buttonGhost} self-start lg:mb-0.5 lg:self-end`}
              >
                <Icon.x className="h-4 w-4" />
                Clear filters
              </button>
            )}
          </div>

          {/* The two fit figures are not the same measurement, and blurring them
              would let a stale number look like a fresh one. Say which is on
              screen, and say plainly what the number is for. */}
          {scoresSeen && (
            <div className="border-t border-gray-200 px-3 pb-3 pt-2.5 dark:border-gray-700 sm:px-4">
              {sort === "fit" && (
                <Eyebrow>
                  {rankJobId
                    ? "Scored live against the selected role"
                    : "Fit captured at apply time · choose a role to score live"}
                </Eyebrow>
              )}
              <p
                id={fitCaveatId}
                className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
              >
                {MATCH_CAVEAT_EMPLOYER}
              </p>
            </div>
          )}
        </Card>

        {/* Pool summary — one role at a time, because "the shape of the pool"
            only means anything against a single posting's requirements. */}
        {pipelineAvailable && filters.jobId && (
          <PipelinePanel
            jobTitle={selectedJob?.title ?? "this role"}
            result={pipelines[filters.jobId] ?? null}
            loading={pipelineLoading === filters.jobId}
            error={pipelineError}
            onRun={() => void loadPipeline(filters.jobId)}
          />
        )}

        {/* List */}
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
            <Eyebrow as="h2">
              {filteredApplications.length}{" "}
              {filteredApplications.length === 1 ? "applicant" : "applicants"}
            </Eyebrow>
            <Eyebrow as="span">
              {filtersActive
                ? `Filtered from ${applications.length}`
                : sort === "fit"
                  ? "Best fit first"
                  : "Newest first"}
            </Eyebrow>
          </div>

          <div aria-live="polite">
            {loading ? (
              /*
               * Rows rather than a centred spinner. A `px-6 py-12` spinner box
               * replaced by a list several hundred pixels tall is the largest
               * layout shift on this route (DESIGN-NOTES 5.4), and the spinner
               * was telling the reader nothing the skeleton does not.
               * `SkeletonRows` carries the same divider, padding and leading
               * avatar as `ApplicationRow`, so the only thing that changes when
               * the data lands is the text.
               */
              <SkeletonRows count={4} />
            ) : loadError ? (
              <div className="p-4 sm:p-6">
                <Alert variant="error">
                  <p>{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadData()}
                    className="mt-3 font-semibold underline"
                  >
                    Try again
                  </button>
                </Alert>
              </div>
            ) : filteredApplications.length === 0 ? (
              <EmptyState
                icon={<Icon.document className="h-6 w-6" />}
                title={
                  applications.length === 0
                    ? "No applications yet"
                    : "No applications match your filters"
                }
                description={
                  applications.length === 0
                    ? "Once candidates apply to your postings they will show up here."
                    : "Try widening the search or clearing the filters."
                }
                action={
                  applications.length === 0 ? (
                    <Link href="/jobs/post" className={buttonPrimary}>
                      Post a role
                      <Icon.arrowUpRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      className={buttonSecondary}
                    >
                      <Icon.x className="h-4 w-4" />
                      Clear filters
                    </button>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredApplications.map((application) => (
                  <ApplicationRow
                    key={application.id}
                    application={application}
                    updating={updatingStatus === application.id}
                    messaging={messagingUserId === application.user.id}
                    onStatusChange={updateApplicationStatus}
                    onMessage={startConversation}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The shape of one posting's applicant pool.
 *
 * Framed as a sorting aid throughout, the same way `match` is framed on the
 * rows below: it describes the pool in aggregate and is never a statement about
 * a person. The route enforces that too — it is fed an anonymised view and its
 * output is filtered — but the framing has to be visible here, because a panel
 * that reads like a verdict will be used as one however the prompt was written.
 */
function PipelinePanel({
  jobTitle,
  result,
  loading,
  error,
  onRun,
}: {
  jobTitle: string;
  result: PipelineResult | null;
  loading: boolean;
  error: string;
  onRun: () => void;
}) {
  const summary = result?.summary ?? null;

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
        <div className="min-w-0">
          <Eyebrow className="mb-1.5">Sorting aid · not a verdict</Eyebrow>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
            Shape of the pool for {jobTitle}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Describes everyone who applied, in aggregate: what recurs, what the posting asks for
            that the pool shows little of, and what that suggests asking in a first screen. It does
            not rank, grade or recommend anybody — that call is yours, and it has none of the
            evidence you do.
          </p>
        </div>

        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className={`${buttonSecondary} flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {loading ? (
            <>
              <Spinner className="h-4 w-4" />
              Reading the pool…
            </>
          ) : (
            <>
              <Icon.spark className="h-4 w-4" />
              {result ? "Run again" : "Summarise the pool"}
            </>
          )}
        </button>
      </div>

      <div className="px-4 py-4 sm:px-6" aria-live="polite">
        {error ? (
          <Alert variant="error">{error}</Alert>
        ) : loading ? (
          <div className="py-6 text-center">
            <Spinner className="h-8 w-8" label="Reading the pool" />
          </div>
        ) : !result ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing has been generated for this role yet.
          </p>
        ) : !summary ? (
          /* The route answers this without a model call: too few people to
             describe a shape without it becoming a remark about individuals. */
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {result.reason === "empty"
              ? "Nobody has applied to this posting yet, so there is no pool to describe."
              : `Only ${result.stats.total} ${
                  result.stats.total === 1 ? "person has" : "people have"
                } applied so far. That is too few to describe as a pool without the summary turning into a comment on individuals — read the applications directly instead.`}
          </p>
        ) : (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              {summary.overview}
            </p>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-8">
              <PoolList
                title="What recurs across the pool"
                items={summary.commonStrengths}
                empty="Nothing recurs often enough to call out."
              />
              <PoolList
                title="Asked for, but thin in the pool"
                items={summary.notableGaps}
                empty="Nothing the posting asks for is missing across the board."
                note="A gap is a question to ask, not a fault to hold against anyone."
              />
            </div>

            <PoolList
              title="Worth probing in a first screen"
              items={summary.whatToProbe}
              empty="Nothing specific to add beyond the posting itself."
            />

            {result.stats.topSkills.length > 0 && (
              <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                {/* Counted, not generated — this part is arithmetic over the
                    profiles and does not depend on the model at all. */}
                <Eyebrow>Most common skills in the pool · counted</Eyebrow>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {result.stats.topSkills.map(({ skill, count }) => (
                    <li key={skill}>
                      <Chip>
                        {skill}
                        <Readout className="text-[11px] text-gray-500 dark:text-gray-400">
                          ×{count}
                        </Readout>
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400 dark:border-gray-700">
              {summary.sampled < result.stats.total
                ? `Written from the ${summary.sampled} most recent of ${result.stats.total} applicants, and from ${result.stats.withProfile} profiles with details on file. `
                : `Written from ${result.stats.total} ${
                    result.stats.total === 1 ? "applicant" : "applicants"
                  }, ${result.stats.withProfile} of whom have profile details on file. `}
              Names, contact details and résumés were not part of what it read. Counts are from when
              it ran.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

/** One titled bullet list in the pool summary, with an honest empty state. */
function PoolList({
  title,
  items,
  empty,
  note,
}: {
  title: string;
  items: string[];
  empty: string;
  note?: string;
}) {
  return (
    <div>
      <Eyebrow>{title}</Eyebrow>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li
              key={item}
              className="border-l-2 border-gray-200 pl-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:text-gray-200"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
      {note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{note}</p>}
    </div>
  );
}

function ApplicationRow({
  application,
  updating,
  messaging,
  onStatusChange,
  onMessage,
}: {
  application: Application;
  updating: boolean;
  messaging: boolean;
  onStatusChange: (applicationId: string, status: string) => Promise<void>;
  onMessage: (applicantId: string) => Promise<void>;
}) {
  const resume = application.user.resumes?.[0];
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

  const match = application.match ?? null;
  const storedScore = typeof application.matchScore === "number" ? application.matchScore : null;
  const sharedSkills = match?.sharedSkills ?? [];
  const breakdownId = `fit-breakdown-${application.id}`;

  const answers = application.answers ?? [];
  const flaggedAnswers = answers.filter(isKnockoutMiss);
  const answersId = `screening-answers-${application.id}`;

  return (
    <li className="px-4 py-4 sm:px-6 sm:py-5">
      {/* Stacks on phones — the old fixed `ml-6` action column overflowed. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 gap-3">
          <Avatar name={application.user.name} />

          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {application.user.name}
            </h3>
            <p className="mono mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">
              {application.user.email}
            </p>

            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              Applied for{" "}
              <Link
                href={`/jobs/${application.job.id}`}
                className="link font-medium"
              >
                {application.job.title}
              </Link>
            </p>
            <Eyebrow className="mt-1">Applied {formatDate(application.createdAt)}</Eyebrow>

            {application.message && (
              <p className="quote line-clamp-3 mt-2.5 whitespace-pre-wrap text-xs leading-relaxed">
                {application.message}
              </p>
            )}

            {/* Evidence, not verdict: the skills the posting and the profile
                actually share, with the arithmetic one click away. */}
            {match && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {sharedSkills.slice(0, 3).map((skill) => (
                  <Chip key={skill} accent>
                    {skill}
                  </Chip>
                ))}
                {sharedSkills.length > 3 && (
                  <Eyebrow as="span">+{sharedSkills.length - 3} more</Eyebrow>
                )}
                <button
                  type="button"
                  onClick={() => setShowBreakdown((open) => !open)}
                  aria-expanded={showBreakdown}
                  aria-controls={breakdownId}
                  className={buttonGhost}
                >
                  <Icon.graph className="h-4 w-4" />
                  {showBreakdown ? "Hide breakdown" : "How this was scored"}
                </button>
              </div>
            )}

            {/* The flag sits on the row, not behind the toggle: an employer
                scanning the queue has to be able to see that something wants
                their attention without opening every application. */}
            {answers.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {flaggedAnswers.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <Icon.warning className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    {flaggedAnswers.length === 1
                      ? "1 screening answer to look at"
                      : `${flaggedAnswers.length} screening answers to look at`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowAnswers((open) => !open)}
                  aria-expanded={showAnswers}
                  aria-controls={answersId}
                  className={buttonGhost}
                >
                  <Icon.document className="h-4 w-4" />
                  {showAnswers
                    ? "Hide screening answers"
                    : `Screening answers · ${answers.length}`}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:w-56 sm:flex-shrink-0">
          {/* A live breakdown when the server scored against one posting;
              otherwise the figure frozen at apply time, labelled as such. A low
              number stays neutral here — it orders the queue, it does not
              condemn anybody. */}
          {match ? (
            <div>
              <MatchScore value={match.score} caption="Role fit" describedBy={fitCaveatId} />
              <Meter
                value={match.score}
                label={`Role fit, ${match.score} out of 100`}
                className="mt-1.5"
              />
            </div>
          ) : storedScore !== null ? (
            // The figure frozen at apply time, in the same shape as the live one
            // above rather than as a bare percentage.
            <MatchScore value={storedScore} caption="Fit at apply" describedBy={fitCaveatId} />
          ) : null}

          <StatusBadge status={application.status} className="self-start" />

          <div>
            <Label htmlFor={`status-${application.id}`}>Update status</Label>
            <select
              id={`status-${application.id}`}
              value={application.status}
              onChange={(event) => void onStatusChange(application.id, event.target.value)}
              disabled={updating}
              className={inputClass}
            >
              {APPLICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            {updating && <Eyebrow className="mt-1.5">Saving…</Eyebrow>}
          </div>

          {/* One link, opened in a new tab. The old pair hard-coded a `.pdf`
              filename and used a script-driven download that Cloudinary's
              cross-origin responses ignore anyway. */}
          {resume ? (
            <a href={resume.url} target="_blank" rel="noopener noreferrer" className={buttonSecondary}>
              <Icon.document className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">
                {resume.fileName ? `Open ${resume.fileName}` : "Open résumé"}
              </span>
              <Icon.external className="h-3.5 w-3.5 flex-shrink-0" />
            </a>
          ) : (
            <Eyebrow>No r&eacute;sum&eacute; uploaded</Eyebrow>
          )}

          <button
            type="button"
            onClick={() => void onMessage(application.user.id)}
            disabled={messaging}
            className={`${buttonGhost} justify-start disabled:cursor-not-allowed disabled:opacity-50 sm:justify-center`}
          >
            <Icon.chat className="h-4 w-4" />
            {messaging ? "Opening…" : "Message"}
          </button>
        </div>
      </div>

      {/* Kept in the tree while collapsed so `aria-controls` always points at a
          real element, and so the panel is findable by in-page search. */}
      {match && (
        <div id={breakdownId} hidden={!showBreakdown} className="mt-4">
          <Card grid className="p-4">
            <Eyebrow>Fit breakdown</Eyebrow>

            {/* Weighted, for the same reason as the seeker-side panel: four
                equal bars would misstate a 70/18/7/5 blend. */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-6">
              <MeterRow
                label="Semantic fit"
                value={match.facets.semantic}
                weight={MATCH_WEIGHTS.semantic}
              />
              <MeterRow
                label="Skills overlap"
                value={match.facets.skills}
                weight={MATCH_WEIGHTS.skills}
              />
              <MeterRow
                label="Location"
                value={match.facets.location}
                weight={MATCH_WEIGHTS.location}
              />
              <MeterRow
                label="Seniority"
                value={match.facets.seniority}
                weight={MATCH_WEIGHTS.seniority}
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6">
              <div>
                <Eyebrow>Shared skills</Eyebrow>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {match.sharedSkills.length > 0 ? (
                    match.sharedSkills.map((skill) => (
                      <Chip key={skill} accent>
                        {skill}
                      </Chip>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No overlapping tags recorded.
                    </p>
                  )}
                </div>
              </div>

              <div>
                {/* "Not evidenced" rather than "missing": the profile may simply
                    be thin. Neutral chips — a gap is a question, not a fault. */}
                <Eyebrow>Not evidenced in the profile</Eyebrow>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {match.missingSkills.length > 0 ? (
                    match.missingSkills.map((skill) => <Chip key={skill}>{skill}</Chip>)
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Nothing on the posting is unaccounted for.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Computed from this posting and the candidate&rsquo;s profile. A gap here is
              something to ask about in a screen, not a reason to pass.
            </p>
          </Card>
        </div>
      )}

      {/* Kept in the tree while collapsed, like the breakdown above: so
          `aria-controls` always points at a real element, and so an answer is
          findable with the browser's own in-page search. */}
      {answers.length > 0 && (
        <div id={answersId} hidden={!showAnswers} className="mt-4">
          <Card className="p-4">
            <Eyebrow>Screening answers</Eyebrow>

            {/* A description list, because that is what this is: the employer's
                question and this person's answer to it, in the order they were
                asked. */}
            <dl className="mt-3 space-y-3.5">
              {answers.map((answer) => {
                const flagged = isKnockoutMiss(answer);
                return (
                  <div
                    key={answer.id}
                    className={`border-l-2 pl-3 ${
                      flagged
                        ? "border-amber-400 dark:border-amber-500"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <dt className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {answer.question.prompt}
                    </dt>
                    {/* Free-text answers keep their line breaks, and a long one
                        wraps rather than pushing the row sideways. */}
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                      {answer.value}
                    </dd>
                    {flagged && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        You asked for &ldquo;{answer.question.expected}&rdquo;.
                      </p>
                    )}
                  </div>
                );
              })}
            </dl>

            {/* Said plainly, and in the same words the authoring form used when
                the employer ticked the box. A flag is a prompt to read, and the
                queue on this page is everyone who applied. */}
            <p className="mt-4 border-t border-gray-200 pt-3 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {flaggedAnswers.length > 0
                ? "An answer you did not ask for marks this application for your attention. Nobody has been rejected, filtered or hidden — this queue is everyone who applied, and the decision is still yours."
                : "Answered when they applied. Questions you marked as knockouts are checked here; nothing is filtered on your behalf either way."}
            </p>
          </Card>
        </div>
      )}
    </li>
  );
}
