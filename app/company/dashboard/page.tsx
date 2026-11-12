"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import DashboardLoading from "./loading";
import { apiFetch } from "@/lib/clientAuth";
import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/validation";
import {
  Alert,
  Avatar,
  Button,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  StatusIcon,
  StatusPill,
  Eyebrow,
  formatCount,
  formatDate,
  Icon,
  inputClass,
  JobStateBadge,
  PageHeading,
  Readout,
  SkeletonRows,
  Spinner,
  StatCard,
  StatusBadge,
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

/** The public-facing company fields, read fresh: the session only carries name and email. */
interface CompanyProfile {
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  description?: string | null;
  profile?: string | null;
}

/**
 * `buttonGhost` in red. Written out rather than appended to `buttonGhost`
 * because two colour utilities for the same property land in the same Tailwind
 * layer, so class order in the string would not decide the winner.
 */
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
  /**
   * Which posting is mid-write, and which of its two actions is doing it.
   *
   * The id alone is what locks the row — a close and a delete must not race
   * each other — but it cannot say where the spinner goes, and one id put a
   * spinner on Delete while Close was the button that was pressed.
   */
  const [busyJob, setBusyJob] = useState<{ id: string; action: "state" | "delete" } | null>(null);
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
      setLoadError(error instanceof Error ? error.message : "Couldn’t load your jobs");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (allowed) void fetchJobs();
  }, [allowed, fetchJobs]);

  // The session token only carries name and email, so the profile card used to
  // show those two and an "Account type" — never the website, industry or
  // description it claimed applicants see. Read the real record instead.
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!allowed || !userId) return;
    let cancelled = false;
    apiFetch<CompanyProfile>(`/api/users/${userId}`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((error) => console.error("Failed to load company profile:", error));
    return () => {
      cancelled = true;
    };
  }, [allowed, userId]);

  const stats = useMemo(() => {
    const applications = jobs.flatMap((job) => job.applications ?? []);
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
      inProgress: (byStatus.SHORTLISTED ?? 0) + (byStatus.INTERVIEW ?? 0),
    };
  }, [jobs]);

  /**
   * Everyone still waiting on a decision, newest first, across every job.
   * This is the one list an employer opens the dashboard for, so it leads the
   * page instead of hiding inside each job's collapsed applicant list.
   */
  const pendingQueue = useMemo(
    () =>
      jobs
        .flatMap((job) =>
          (job.applications ?? [])
            .filter((application) => application.status === "PENDING")
            .map((application) => ({ application, job }))
        )
        .sort((a, b) => b.application.createdAt.localeCompare(a.application.createdAt)),
    [jobs]
  );

  // Open jobs first; within each group the server's newest-first order stands.
  const orderedJobs = useMemo(
    () => [...jobs].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [jobs]
  );

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
      toast.error(error instanceof Error ? error.message : "Couldn’t update the application");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const toggleJobActive = async (job: Job) => {
    setBusyJob({ id: job.id, action: "state" });
    try {
      const updated = await apiFetch<Job>(`/api/jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !job.isActive }),
      });
      setJobs((current) =>
        current.map((item) => (item.id === job.id ? { ...item, isActive: updated.isActive } : item))
      );
      toast.success(updated.isActive ? "Job reopened" : "Job closed to new applicants");
    } catch (error) {
      console.error("Failed to update job state:", error);
      toast.error(error instanceof Error ? error.message : "Couldn’t update the job");
    } finally {
      setBusyJob(null);
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

    setBusyJob({ id: job.id, action: "delete" });
    try {
      const result = await apiFetch<{ message: string; deletedApplications: number }>(
        `/api/jobs/${job.id}`,
        { method: "DELETE" }
      );
      setJobs((current) => current.filter((item) => item.id !== job.id));
      toast.success(
        result.deletedApplications > 0
          ? `Job deleted, along with ${result.deletedApplications} application${
              result.deletedApplications === 1 ? "" : "s"
            }`
          : "Job deleted"
      );
    } catch (error) {
      console.error("Failed to delete job:", error);
      toast.error(error instanceof Error ? error.message : "Couldn’t delete the job");
    } finally {
      setBusyJob(null);
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
      toast.error(error instanceof Error ? error.message : "Couldn’t open the conversation");
    } finally {
      setMessagingUserId(null);
    }
  };

  /* -------------------------------- render -------------------------------- */

  // The same skeleton the route’s `loading.tsx` shows, so the rehydration
  // wait and the navigation wait are one state rather than two, and neither is
  // a centred spinner that a full page of content then shoves aside.
  if (!ready) return <DashboardLoading />;

  if (!allowed) return null; // the guard is already redirecting

  return (
    <div className="min-h-screen">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow={user?.company?.name ?? "Hiring"}
          title="Company dashboard"
          // The eyebrow already names the company; greeting it again by the same
          // name read as a stutter.
          description="Welcome back. Here’s who is waiting on you and how your jobs are doing."
          // Dropped while the account has no jobs: the empty job list below
          // carries the same call to action, and two identical primaries
          // compete for the same click.
          action={
            loading || loadError || jobs.length > 0 ? (
              <Link href="/jobs/post" className={buttonPrimary}>
                Post a job
                <Icon.arrowUpRight className="h-4 w-4" />
              </Link>
            ) : undefined
          }
        />

        {/* Stats — the decision queue first and highlighted; job counts last,
            because "how many jobs do I have" is the least urgent question. The
            old "Hiring overview" strip above these repeated the same numbers.
            A company with no jobs yet gets no tiles at all: four zeros only push
            the one thing to do — post a job — further down the page. */}
        {(loading || jobs.length > 0) && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              highlight
              label="Pending review"
              value={formatCount(stats.pending)}
              tone="amber"
              icon={<Icon.clock className="h-5 w-5" />}
              hint="Waiting for your decision"
            />
            <StatCard
              label="In progress"
              value={formatCount(stats.inProgress)}
              tone="blue"
              icon={<Icon.trendingUp className="h-5 w-5" />}
              hint="Shortlisted or interviewing"
            />
            <StatCard
              label="Applications"
              value={formatCount(stats.totalApplications)}
              tone="purple"
              icon={<Icon.user className="h-5 w-5" />}
              hint="Across all jobs"
            />
            <StatCard
              label="Open jobs"
              value={formatCount(stats.activeJobs)}
              tone="green"
              icon={<Icon.briefcase className="h-5 w-5" />}
              hint={
                stats.totalJobs === 0
                  ? "None posted yet"
                  : `${stats.totalJobs} posted in total`
              }
            />
          </div>
        )}

        {/* Work on the left, the company card on the right. The left column is
            the long one, so the shorter sidebar sticks rather than leaving a
            tall empty well beside the job list. */}
        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            {!loading && !loadError && jobs.length > 0 && (
              <ReviewQueue queue={pendingQueue} />
            )}

            <Card>
              <CardHeader
                eyebrow="Jobs"
                title="Your jobs"
                description={
                  jobs.length > 0
                    ? `${stats.activeJobs} open, ${stats.totalJobs - stats.activeJobs} closed`
                    : "Manage your job listings"
                }
              />

              {loading ? (
                // Same shape as the list it stands in for, rather than a spinner in a
                // short box followed by a tall list.
                <SkeletonRows count={3} />
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
                  title="No jobs posted yet"
                  description="Post your first job to start receiving applications."
                  action={
                    <Link href="/jobs/post" className={buttonPrimary}>
                      Post your first job
                      <Icon.arrowUpRight className="h-4 w-4" />
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {orderedJobs.map((job) => {
                    const applications = job.applications ?? [];
                    const pendingHere = applications.filter(
                      (application) => application.status === "PENDING"
                    ).length;
                    const expanded = Boolean(expandedJobs[job.id]);
                    // Both controls lock together; only the pressed one spins.
                    const busy = busyJob?.id === job.id;
                    const closing = busy && busyJob?.action === "state";
                    const deleting = busy && busyJob?.action === "delete";

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
                              {/* Which job the waiting applicants are on, at a glance. */}
                              {pendingHere > 0 && (
                                <StatusPill tone="warn">{pendingHere} to review</StatusPill>
                              )}
                            </div>
                          </div>

                          {/* One row under the details on phones, flush with the
                              text (the negative margin cancels the ghost padding);
                              beside the title from lg up. Stacked full-width,
                              these three quiet actions outweighed the job itself. */}
                          <div className="-ml-2.5 flex flex-wrap items-center gap-1 lg:ml-0 lg:flex-shrink-0 lg:justify-end">
                            {/* One posting's row of actions is identical to the
                                next's, so each carries the title for anyone reading
                                the control out of its visual context. */}
                            <Link href={`/jobs/${job.id}/edit`} className={buttonGhost}>
                              <Icon.edit className="h-4 w-4" />
                              Edit<span className="sr-only"> {job.title}</span>
                            </Link>
                            <Button
                              variant="ghost"
                              onClick={() => void toggleJobActive(job)}
                              disabled={busy}
                              loading={closing}
                              loadingLabel={
                                job.isActive ? "Closing this job" : "Reopening this job"
                              }
                              icon={
                                job.isActive ? (
                                  <Icon.x className="h-4 w-4" />
                                ) : (
                                  <Icon.checkCircle className="h-4 w-4" />
                                )
                              }
                            >
                              {job.isActive ? "Close" : "Reopen"}
                              <span className="sr-only"> {job.title}</span>
                            </Button>
                            {/* Stays a hand-rolled red ghost rather than `variant="danger"`,
                                which is the filled treatment and would make Delete the
                                loudest thing in a row of quiet actions. */}
                            <button
                              type="button"
                              onClick={() => void deleteJob(job)}
                              disabled={busy}
                              aria-busy={deleting}
                              className={ghostDanger}
                            >
                              {deleting ? (
                                <Spinner className="h-4 w-4" decorative />
                              ) : (
                                <Icon.trash className="h-4 w-4" />
                              )}
                              Delete<span className="sr-only"> {job.title}</span>
                              {deleting && <span className="sr-only">Deleting this job</span>}
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
                              className="link interactive inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium"
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
                                className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
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
                                          <p className="quote mt-2 whitespace-pre-wrap text-xs leading-relaxed">
                                            {application.message}
                                          </p>
                                        )}

                                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                                          {resume ? (
                                            <a
                                              href={`/api/resumes/${resume.id}/file`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="link hit-24 inline-flex items-center gap-1.5 text-xs font-medium"
                                            >
                                              <Icon.document className="h-4 w-4" />
                                              View resume
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
                                            <Eyebrow as="span">No resume</Eyebrow>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() => void messageApplicant(application.userId)}
                                            disabled={busyMessaging}
                                            aria-busy={busyMessaging}
                                            // `.hit-24` because the row keeps this
                                            // control at `text-xs`, which leaves it
                                            // under the 24px SC 2.5.8 floor.
                                            className="hit-24 inline-flex items-center gap-1.5 rounded text-xs font-medium text-gray-600 underline-offset-2 transition-colors hover:text-gray-900 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
                                          >
                                            {busyMessaging ? (
                                              <Spinner className="h-4 w-4" decorative />
                                            ) : (
                                              <Icon.chat className="h-4 w-4" />
                                            )}
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

          </div>

          <CompanyProfileCard
            name={profile?.name || user?.company?.name || user?.name || ""}
            profile={profile}
          />
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                                */
/* -------------------------------------------------------------------------- */

type QueueEntry = { application: Application; job: Job };

/** How many waiting applicants the dashboard lists before handing off to the full queue. */
const QUEUE_PREVIEW = 5;

/**
 * The applicants waiting on a decision. When nobody is, it collapses to a
 * single line rather than an empty card competing with the job list.
 */
function ReviewQueue({ queue }: { queue: QueueEntry[] }) {
  if (queue.length === 0) {
    return (
      <Card className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <StatusIcon tone="good" size="lg" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You’re all caught up. No applicants are waiting for a decision.
        </p>
      </Card>
    );
  }

  const shown = queue.slice(0, QUEUE_PREVIEW);
  const reviewHref = "/applications?status=PENDING";

  return (
    <Card signal>
      <CardHeader
        eyebrow="Needs review"
        title={`${queue.length} ${queue.length === 1 ? "applicant is" : "applicants are"} waiting`}
        description="Newest first. Open a resume here, or review them all in one place."
        action={
          <Link href={reviewHref} className={buttonPrimary}>
            Review applicants
            <Icon.arrowRight className="h-4 w-4" />
          </Link>
        }
      />
      <ul className="divide-y divide-[var(--line-subtle)]">
        {shown.map(({ application, job }) => {
          const name = application.user?.name || "Unknown applicant";
          const resume = application.user?.resumes?.[0];
          return (
            <li key={application.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <Avatar name={name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{name}</p>
                <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                  {job.title} · Applied {formatDate(application.createdAt)}
                </p>
              </div>
              {resume ? (
                <a
                  href={`/api/resumes/${resume.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buttonGhost} flex-shrink-0`}
                >
                  <Icon.document className="h-4 w-4" />
                  Resume
                  <span className="sr-only"> for {name} (opens in a new tab)</span>
                </a>
              ) : (
                // Padded like the ghost button beside it, so the column edge lines up.
                <Eyebrow as="span" className="flex-shrink-0 px-2.5">
                  No resume
                </Eyebrow>
              )}
            </li>
          );
        })}
      </ul>
      {queue.length > QUEUE_PREVIEW && (
        <div className="border-t border-[var(--line-subtle)] px-4 py-3 sm:px-6">
          <Link href={reviewHref} className="link text-sm font-medium">
            See all {queue.length} waiting applicants
          </Link>
        </div>
      )}
    </Card>
  );
}

/**
 * What applicants see of the company, plus what is still missing from it. A
 * brand-new account gets a short to-do list here instead of a row of dashes.
 */
function CompanyProfileCard({
  name,
  profile,
}: {
  name: string;
  profile: CompanyProfile | null;
}) {
  const facts = [
    profile?.industry,
    profile?.size ? `${profile.size} employees` : null,
    profile?.location,
  ].filter(Boolean) as string[];

  const missing = profile
    ? [
        !profile.description && "a short description",
        !profile.industry && "your industry",
        !profile.location && "a location",
        !profile.website && "your website",
      ].filter(Boolean)
    : [];

  return (
    <Card as="aside" aria-labelledby="company-profile-heading" className="lg:sticky lg:top-24">
      <div className="flex items-start gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <Avatar name={name || "?"} />
        <div className="min-w-0 flex-1">
          <Eyebrow className="mb-1">Company profile</Eyebrow>
          <h2
            id="company-profile-heading"
            className="truncate text-base font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            {name}
          </h2>
          {facts.length > 0 && (
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{facts.join(" · ")}</p>
          )}
        </div>
      </div>

      <div className="space-y-4 border-t border-[var(--line-subtle)] px-4 py-4 sm:px-6">
        {profile === null ? (
          <SkeletonRows count={1} />
        ) : (
          <>
            {profile.description && (
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {profile.description}
              </p>
            )}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="link inline-flex max-w-full items-center gap-1.5 text-sm font-medium"
              >
                <span className="truncate">{profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                <Icon.external className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
            {missing.length > 0 && (
              <div className="rounded-md border border-dashed border-gray-300 px-3 py-2.5 dark:border-gray-600">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {missing.length === 4 ? "Tell applicants who you are" : "Finish your profile"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  Add {missing.length > 1
                    ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
                    : missing[0]}
                  . Applicants see this when they look at your jobs.
                </p>
              </div>
            )}
          </>
        )}
        <Link href="/company/profile/edit" className={`${buttonSecondary} w-full`}>
          <Icon.edit className="h-4 w-4" />
          Edit profile
        </Link>
      </div>
    </Card>
  );
}
