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
  CardHeader,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  JobStateBadge,
  PageHeading,
  Readout,
  SignalPanel,
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
/* Types — these mirror what `GET /api/jobs?companyId=…` returns to the owner  */
/* -------------------------------------------------------------------------- */

interface Resume {
  id: string;
  url: string;
  fileName?: string | null;
  createdAt: string;
}

interface Application {
  id: string;
  userId: string;
  status: string;
  message?: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    resumes?: Resume[];
  };
}

interface Job {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  isActive: boolean;
  createdAt: string;
  applications: Application[];
}

/**
 * `buttonGhost` in red. Written out rather than appended to `buttonGhost`
 * because two colour utilities for the same property land in the same Tailwind
 * layer, so class order in the string would not decide the winner.
 */
/** Role codes are a storage detail; the profile panel shows people a word. */
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  COMPANY: "Employer",
  ADMIN: "Administrator",
  SEEKER: "Job seeker",
};

const ghostDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300";

export default function CompanyDashboard() {
  const { ready, allowed, user } = useAuthGuard(["COMPANY"]);
  const router = useRouter();
  const toast = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [messagingUserId, setMessagingUserId] = useState<string | null>(null);
  // Applicant lists start collapsed: a company with a dozen postings would
  // otherwise have to scroll past every applicant to reach the next job.
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});

  const companyId = user?.companyId;

  const fetchJobs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiFetch<Job[]>(`/api/jobs?companyId=${encodeURIComponent(companyId)}`);
      setJobs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
      setLoadError(error instanceof Error ? error.message : "Could not load your job postings");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (allowed) void fetchJobs();
  }, [allowed, fetchJobs]);

  const stats = useMemo(() => {
    const applications = jobs.flatMap((job) => job.applications ?? []);
    // Per-status tallies feed the pipeline sparkline as well as the tiles; both
    // are derived from the postings already in hand, not a second request.
    const byStatus: Record<string, number> = {};
    for (const status of APPLICATION_STATUSES) byStatus[status] = 0;
    for (const application of applications) {
      if (application.status in byStatus) byStatus[application.status] += 1;
    }
    return {
      totalJobs: jobs.length,
      activeJobs: jobs.filter((job) => job.isActive).length,
      totalApplications: applications.length,
      pending: byStatus.PENDING ?? 0,
      byStatus,
    };
  }, [jobs]);

  // Normalised against the busiest stage so the strip reads as a shape rather
  // than as absolute numbers — the big readout carries the magnitude.
  const pipelineBars = useMemo(() => {
    const counts = APPLICATION_STATUSES.map((status) => stats.byStatus[status] ?? 0);
    const peak = Math.max(1, ...counts);
    return counts.map((count) => count / peak);
  }, [stats]);

  const toggleExpanded = (jobId: string) =>
    setExpandedJobs((current) => ({ ...current, [jobId]: !current[jobId] }));

  /* ------------------------------- mutations ------------------------------ */

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    const previous = jobs;
    setUpdatingStatus(applicationId);
    // Optimistic: the select reflects the choice immediately and the whole list
    // rolls back if the server refuses.
    setJobs((current) =>
      current.map((job) => ({
        ...job,
        applications: job.applications.map((application) =>
          application.id === applicationId ? { ...application, status } : application
        ),
      }))
    );

    try {
      await apiFetch("/api/applications", {
        method: "PATCH",
        body: JSON.stringify({ id: applicationId, status }),
      });
      toast.success(
        `Application marked as ${STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}`
      );
    } catch (error) {
      console.error("Failed to update application status:", error);
      setJobs(previous);
      toast.error(error instanceof Error ? error.message : "Could not update the application");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const toggleJobActive = async (job: Job) => {
    setBusyJobId(job.id);
    try {
      const updated = await apiFetch<Job>(`/api/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !job.isActive }),
      });
      setJobs((current) =>
        current.map((item) => (item.id === job.id ? { ...item, isActive: updated.isActive } : item))
      );
      toast.success(updated.isActive ? "Posting reopened" : "Posting closed to new applicants");
    } catch (error) {
      console.error("Failed to update job state:", error);
      toast.error(error instanceof Error ? error.message : "Could not update the posting");
    } finally {
      setBusyJobId(null);
    }
  };

  const deleteJob = async (job: Job) => {
    const count = job.applications?.length ?? 0;
    // Spell out the cascade: deleting a job with applicants used to fail with a
    // raw foreign-key 500, and now it silently removes their applications.
    const consequence =
      count > 0
        ? `This also permanently deletes ${count} application${count === 1 ? "" : "s"} and their history.`
        : "This cannot be undone.";
    if (!window.confirm(`Delete "${job.title}"?\n\n${consequence}`)) return;

    setBusyJobId(job.id);
    try {
      const result = await apiFetch<{ message: string; deletedApplications: number }>(
        `/api/jobs/${job.id}`,
        { method: "DELETE" }
      );
      setJobs((current) => current.filter((item) => item.id !== job.id));
      toast.success(
        result.deletedApplications > 0
          ? `Posting deleted, along with ${result.deletedApplications} application${
              result.deletedApplications === 1 ? "" : "s"
            }`
          : "Posting deleted"
      );
    } catch (error) {
      console.error("Failed to delete job:", error);
      toast.error(error instanceof Error ? error.message : "Could not delete the posting");
    } finally {
      setBusyJobId(null);
    }
  };

  const messageApplicant = async (applicantId: string) => {
    setMessagingUserId(applicantId);
    try {
      // Only the seeker id is sent: the server derives the company from the
      // session and returns the existing thread when there already is one.
      const conversation = await apiFetch<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: applicantId }),
      });
      router.push(`/conversations?conversationId=${conversation.id}`);
    } catch (error) {
      console.error("Failed to open conversation:", error);
      toast.error(error instanceof Error ? error.message : "Could not open the conversation");
    } finally {
      setMessagingUserId(null);
    }
  };

  /* -------------------------------- render -------------------------------- */

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner className="h-10 w-10" label="Loading dashboard" />
      </div>
    );
  }

  if (!allowed) return null; // the guard is already redirecting

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow={user?.company?.name ?? "Hiring console"}
          title="Company dashboard"
          description={`Welcome back, ${user?.name ?? "there"}. Every posting, applicant and thread in one panel.`}
          action={
            <Link href="/jobs/post" className={buttonPrimary}>
              Post a role
              <Icon.arrowUpRight className="h-4 w-4" />
            </Link>
          }
        />

        {/* Pipeline telemetry, summarised from the postings already loaded. */}
        <SignalPanel
          className="mt-6"
          title="Hiring pipeline"
          live={stats.activeJobs > 0}
          detail={
            loading
              ? "Reading your postings…"
              : `${stats.activeJobs} open role${stats.activeJobs === 1 ? "" : "s"} of ${stats.totalJobs} · ${stats.pending} pending review`
          }
          value={formatCount(stats.totalApplications)}
          valueLabel="Applications"
          bars={pipelineBars}
        />

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Total roles"
            value={formatCount(stats.totalJobs)}
            icon={<Icon.briefcase className="h-5 w-5" />}
            hint="Open and closed postings"
          />
          <StatCard
            label="Open roles"
            value={formatCount(stats.activeJobs)}
            tone="green"
            icon={<Icon.checkCircle className="h-5 w-5" />}
            hint="Accepting applications"
          />
          <StatCard
            label="Applications"
            value={formatCount(stats.totalApplications)}
            tone="purple"
            icon={<Icon.user className="h-5 w-5" />}
            hint="Across every posting"
          />
          <StatCard
            label="Pending review"
            value={formatCount(stats.pending)}
            tone="amber"
            icon={<Icon.clock className="h-5 w-5" />}
            hint="Awaiting your decision"
          />
        </div>

        {/* Quick actions */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <QuickAction
            href="/jobs/post"
            title="Post a new role"
            description="Create a listing"
            icon={<Icon.plus className="h-5 w-5" />}
          />
          <QuickAction
            href="/applications"
            title="Candidates"
            description="Review every applicant"
            icon={<Icon.document className="h-5 w-5" />}
          />
          <QuickAction
            href="/conversations"
            title="Messages"
            description="Chat with candidates"
            icon={<Icon.chat className="h-5 w-5" />}
          />
        </div>

        {/* Jobs */}
        <Card className="mt-6">
          <CardHeader
            eyebrow="Postings"
            title="My job postings"
            description="Open, close, edit or remove your listings"
          />

          {loading ? (
            <div className="px-6 py-12 text-center">
              <Spinner className="h-10 w-10" label="Loading your job postings" />
            </div>
          ) : loadError ? (
            <div className="p-4 sm:p-6">
              <Alert variant="error">
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => void fetchJobs()}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              </Alert>
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={<Icon.briefcase className="h-6 w-6" />}
              title="No roles posted yet"
              description="Start attracting talent by creating your first job listing."
              action={
                <Link href="/jobs/post" className={buttonPrimary}>
                  Post your first role
                  <Icon.arrowUpRight className="h-4 w-4" />
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {jobs.map((job) => {
                const applications = job.applications ?? [];
                const expanded = Boolean(expandedJobs[job.id]);
                const busy = busyJobId === job.id;

                return (
                  <li key={job.id} className="px-4 py-4 sm:px-6 sm:py-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
                            {job.title}
                          </h3>
                          <JobStateBadge isActive={job.isActive} />
                        </div>

                        {/* Each chip renders only when its field has a value — these
                            used to show a lone icon with blank text beside it. */}
                        {(job.location || job.type || job.salary) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {job.location && (
                              <Chip icon={<Icon.location className="h-3.5 w-3.5" />}>
                                {job.location}
                              </Chip>
                            )}
                            {job.type && (
                              <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>
                            )}
                            {job.salary && (
                              <Chip icon={<Icon.money className="h-3.5 w-3.5" />}>{job.salary}</Chip>
                            )}
                          </div>
                        )}

                        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <Eyebrow as="span">Posted {formatDate(job.createdAt)}</Eyebrow>
                          <span className="flex items-baseline gap-1.5">
                            <Readout className="text-sm font-semibold">
                              {applications.length}
                            </Readout>
                            <Eyebrow as="span">
                              {applications.length === 1 ? "applicant" : "applicants"}
                            </Eyebrow>
                          </span>
                        </div>
                      </div>

                      {/* Stacks under the title on phones, right-aligned from sm up. */}
                      <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:flex-shrink-0">
                        {/* One posting's row of actions is identical to the
                            next's, so each carries the title for anyone reading
                            the control out of its visual context. */}
                        <Link href={`/jobs/${job.id}/edit`} className={buttonGhost}>
                          <Icon.edit className="h-4 w-4" />
                          Edit<span className="sr-only"> {job.title}</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => void toggleJobActive(job)}
                          disabled={busy}
                          aria-busy={busy}
                          className={`${buttonGhost} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {job.isActive ? (
                            <Icon.x className="h-4 w-4" />
                          ) : (
                            <Icon.checkCircle className="h-4 w-4" />
                          )}
                          {job.isActive ? "Close" : "Reopen"}
                          <span className="sr-only"> {job.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteJob(job)}
                          disabled={busy}
                          aria-busy={busy}
                          className={ghostDanger}
                        >
                          <Icon.trash className="h-4 w-4" />
                          Delete<span className="sr-only"> {job.title}</span>
                        </button>
                      </div>
                    </div>

                    {applications.length > 0 && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(job.id)}
                          aria-expanded={expanded}
                          aria-controls={`applications-${job.id}`}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/30"
                        >
                          <Icon.arrowRight
                            className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                          {expanded ? "Hide" : "Show"} {applications.length} applicant
                          {applications.length === 1 ? "" : "s"}
                        </button>

                        {expanded && (
                          <ul
                            id={`applications-${job.id}`}
                            className="grid-field mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
                          >
                            {applications.map((application) => {
                              const resume = application.user?.resumes?.[0];
                              const busyMessaging = messagingUserId === application.userId;

                              return (
                                <li
                                  key={application.id}
                                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-4"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                      {application.user?.name || "Unknown applicant"}
                                    </p>
                                    <p className="mono mt-0.5 break-all text-xs text-gray-600 dark:text-gray-400">
                                      {application.user?.email || "No email"}
                                    </p>
                                    <Eyebrow className="mt-1.5">
                                      Applied {formatDate(application.createdAt)}
                                    </Eyebrow>

                                    {application.message && (
                                      <p className="mt-2 whitespace-pre-wrap border-l-2 border-gray-200 bg-white/70 py-1.5 pl-3 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                                        {application.message}
                                      </p>
                                    )}

                                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                                      {resume ? (
                                        <a
                                          href={resume.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                                        >
                                          <Icon.document className="h-4 w-4" />
                                          View r&eacute;sum&eacute;
                                          {/* Every applicant row repeats these
                                              controls, so out of context the
                                              name is what tells them apart. */}
                                          <span className="sr-only">
                                            {" "}
                                            for {application.user?.name || "this applicant"} (opens
                                            in a new tab)
                                          </span>
                                          <Icon.external className="h-3.5 w-3.5" />
                                        </a>
                                      ) : (
                                        <Eyebrow as="span">No r&eacute;sum&eacute;</Eyebrow>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => void messageApplicant(application.userId)}
                                        disabled={busyMessaging}
                                        aria-busy={busyMessaging}
                                        className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-gray-600 underline-offset-2 transition-colors hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
                                      >
                                        <Icon.chat className="h-4 w-4" />
                                        {busyMessaging ? "Opening…" : "Message"}
                                        <span className="sr-only">
                                          {" "}
                                          {application.user?.name || "this applicant"}
                                        </span>
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-start gap-2 sm:w-44 sm:flex-shrink-0 sm:items-end">
                                    <StatusBadge status={application.status} />
                                    <label className="sr-only" htmlFor={`status-${application.id}`}>
                                      Application status for{" "}
                                      {application.user?.name || "this applicant"}
                                    </label>
                                    {/* `.field` is unlayered CSS, so its padding and
                                        font-size beat plain utilities — the small
                                        variant has to be marked important. */}
                                    <select
                                      id={`status-${application.id}`}
                                      value={application.status}
                                      onChange={(event) =>
                                        void updateApplicationStatus(
                                          application.id,
                                          event.target.value
                                        )
                                      }
                                      disabled={updatingStatus === application.id}
                                      aria-busy={updatingStatus === application.id}
                                      className={`${inputClass} py-1.5! text-xs!`}
                                    >
                                      {APPLICATION_STATUSES.map((status) => (
                                        <option key={status} value={status}>
                                          {STATUS_LABELS[status]}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Company profile */}
        <Card className="mt-6">
          <CardHeader
            eyebrow="Public record"
            title="Company profile"
            description="How candidates see you across the site"
            action={
              <Link href="/company/profile/edit" className={buttonSecondary}>
                <Icon.edit className="h-4 w-4" />
                Edit profile
              </Link>
            }
          />
          <div className="p-4 sm:p-6">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <ProfileField label="Company name" value={user?.name} />
              <ProfileField label="Email address" value={user?.email} mono />
              {/* The raw enum ("COMPANY") used to reach the page unchanged;
                  the seeker dashboard already prints a human word here. */}
              <ProfileField label="Account type" value={ACCOUNT_TYPE_LABELS[user?.role ?? ""] ?? "Employer"} />
              {user?.website && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  <dt>
                    <Eyebrow as="span" className="block">
                      Website
                    </Eyebrow>
                  </dt>
                  <dd className="mt-1.5">
                    <a
                      href={user.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono break-all text-sm font-medium text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                    >
                      {user.website}
                    </a>
                  </dd>
                </div>
              )}
              {user?.industry && <ProfileField label="Industry" value={user.industry} />}
              {user?.size && <ProfileField label="Company size" value={user.size} mono />}
              {user?.location && <ProfileField label="Location" value={user.location} />}
            </dl>

            {user?.description && (
              <div className="mt-6 border-t border-gray-200 pt-3 dark:border-gray-700">
                <Eyebrow>Company description</Eyebrow>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {user.description}
                </p>
              </div>
            )}

            {user?.profile && (
              <div className="mt-5 border-t border-gray-200 pt-3 dark:border-gray-700">
                <Eyebrow>Company profile</Eyebrow>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {user.profile}
                </p>
              </div>
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

function QuickAction({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      // Hairline panel, no shadow and no coloured tile: the accent stays
      // reserved for signal, so navigation reads as neutral instrumentation.
      className="panel group flex items-center gap-3 p-4 transition-colors hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-gray-600"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 transition-colors group-hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </span>
        <span className="block truncate text-xs text-gray-600 dark:text-gray-400">
          {description}
        </span>
      </span>
      <Icon.arrowUpRight className="h-4 w-4 flex-shrink-0 text-gray-400 transition-colors group-hover:text-gray-900 dark:group-hover:text-white" />
    </Link>
  );
}

function ProfileField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  /** Machine-shaped values (emails, roles, size bands) are set in mono. */
  mono?: boolean;
}) {
  return (
    <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
      <dt>
        <Eyebrow as="span" className="block">
          {label}
        </Eyebrow>
      </dt>
      <dd
        className={`mt-1.5 break-words text-sm font-medium text-gray-900 dark:text-white ${
          mono ? "mono" : ""
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
