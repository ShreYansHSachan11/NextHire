"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/validation";
import {
  Alert,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  Label,
  MatchScore,
  Meter,
  MeterRow,
  PageHeading,
  Readout,
  Spinner,
  StatCard,
  StatusBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  formatCount,
  formatDate,
  inputClass,
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

interface Application {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
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

  const companyId = user?.companyId;

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    // The endpoint defaults to the caller's own company, so the query param is
    // only a hint — never a way to read someone else's applications.
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
    try {
      const [applicationList, jobList] = await Promise.all([
        apiFetch<Application[]>(`/api/applications${query}`),
        apiFetch<JobOption[]>(`/api/jobs${query}`),
      ]);
      setApplications(Array.isArray(applicationList) ? applicationList : []);
      setJobs(Array.isArray(jobList) ? jobList.map(({ id, title }) => ({ id, title })) : []);
    } catch (error) {
      console.error("Failed to load applications:", error);
      setLoadError(error instanceof Error ? error.message : "Could not load applications");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (allowed) void loadData();
  }, [allowed, loadData]);

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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner className="h-10 w-10" label="Loading applications" />
      </div>
    );
  }

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
        </Card>

        {/* List */}
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
            <Eyebrow as="h2">
              {filteredApplications.length}{" "}
              {filteredApplications.length === 1 ? "applicant" : "applicants"}
            </Eyebrow>
            <Eyebrow as="span">
              {filtersActive ? `Filtered from ${applications.length}` : "Newest first"}
            </Eyebrow>
          </div>

          <div aria-live="polite">
            {loading ? (
              <div className="px-6 py-12 text-center">
                <Spinner className="h-10 w-10" label="Loading applications" />
              </div>
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

  return (
    <li className="px-4 py-4 sm:px-6 sm:py-5">
      {/* Stacks on phones — the old fixed `ml-6` action column overflowed. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 gap-3">
          {/* Neutral initial tile: the accent stays reserved for signal. */}
          <span
            className="mono flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            aria-hidden="true"
          >
            {application.user.name.charAt(0).toUpperCase()}
          </span>

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
                className="rounded font-medium text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
              >
                {application.job.title}
              </Link>
            </p>
            <Eyebrow className="mt-1">Applied {formatDate(application.createdAt)}</Eyebrow>

            {application.message && (
              <p className="line-clamp-3 mt-2.5 whitespace-pre-wrap border-l-2 border-gray-200 bg-gray-50 py-1.5 pl-3 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                {application.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:w-56 sm:flex-shrink-0">
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
    </li>
  );
}
