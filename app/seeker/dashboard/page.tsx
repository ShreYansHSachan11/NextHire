"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch, authHeaders } from "@/lib/clientAuth";
import {
  APPLICATION_STATUSES,
  RESUME_ACCEPT,
  STATUS_LABELS,
  isApplicationStatus,
  validateResumeFile,
  type ApplicationStatus,
} from "@/lib/validation";
import {
  Alert,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  Label,
  MatchScore,
  Meter,
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
  formatRelative,
} from "@/app/components/ui";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/applications` is now scoped to the signed-in seeker server-side, so
 * this page no longer filters anything itself (it used to render every
 * application in the database — audit 2.1).
 */
interface Application {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
  /**
   * The fit as it stood on the day of applying — stored, not recomputed, so it
   * stays a record of the decision rather than a number that drifts. Null on an
   * application made before the profile was indexed, or with AI switched off.
   */
  matchScore?: number | null;
  job: {
    id: string;
    title: string;
    location?: string | null;
    type?: string | null;
    /** Needed to open a conversation with the right employer — see audit 2.5. */
    companyId: string;
    company: { name: string };
  };
}

interface Resume {
  id: string;
  url: string;
  publicId?: string;
  fileName?: string | null;
  createdAt: string;
}

type StatusFilter = "ALL" | ApplicationStatus;

/* -------------------------------------------------------------------------- */
/* Presentation constants                                                      */
/* -------------------------------------------------------------------------- */

/** The order the sparkline reads left-to-right: the funnel, then the drop-outs. */
const PIPELINE_ORDER: readonly ApplicationStatus[] = [
  "PENDING",
  "SHORTLISTED",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
];

/**
 * How far through the four live stages an application has travelled. Purely a
 * projection of the `status` already in state — nothing extra is fetched.
 * A rejection is a closed file rather than a partial one, so it reads as 0.
 */
const STAGE_PROGRESS: Record<ApplicationStatus, number> = {
  PENDING: 25,
  SHORTLISTED: 50,
  INTERVIEW: 75,
  ACCEPTED: 100,
  REJECTED: 0,
};

const STAGE_CAPTION: Record<ApplicationStatus, string> = {
  PENDING: "Stage 1 / 4 · Submitted",
  SHORTLISTED: "Stage 2 / 4 · Shortlisted",
  INTERVIEW: "Stage 3 / 4 · Interview",
  ACCEPTED: "Stage 4 / 4 · Offer",
  REJECTED: "Closed",
};

const FILTERS: readonly StatusFilter[] = ["ALL", ...APPLICATION_STATUSES];

const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "All",
  ...STATUS_LABELS,
};

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function SeekerDashboardPage() {
  const { ready, allowed, user } = useAuthGuard(["SEEKER"]);
  const router = useRouter();
  const toast = useToast();

  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [applicationsError, setApplicationsError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [resume, setResume] = useState<Resume | null>(null);
  const [resumeLoading, setResumeLoading] = useState(true);
  const [resumeError, setResumeError] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const resumeSectionRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadApplications = useCallback(async () => {
    setApplicationsLoading(true);
    setApplicationsError("");
    try {
      const data = await apiFetch<Application[]>("/api/applications");
      setApplications(Array.isArray(data) ? data : []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load your applications";
      console.error("Failed to load applications:", error);
      setApplicationsError(message);
    } finally {
      setApplicationsLoading(false);
    }
  }, []);

  const loadResume = useCallback(async () => {
    setResumeLoading(true);
    setResumeError("");
    try {
      // Returns only the caller's own resumes, newest first — the old page
      // fetched everyone's and filtered client-side (audit 2.2).
      const data = await apiFetch<Resume[]>("/api/resumes");
      setResume(Array.isArray(data) && data.length > 0 ? data[0] : null);
    } catch (error) {
      console.error("Failed to load resume:", error);
      setResume(null);
      setResumeError(
        error instanceof Error
          ? error.message
          : "Could not check whether you have a resume on file"
      );
    } finally {
      setResumeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadApplications();
    void loadResume();
  }, [allowed, loadApplications, loadResume]);

  /* ---------------------------------------------------------------------- */
  /* Derived data                                                            */
  /* ---------------------------------------------------------------------- */

  const stats = useMemo(() => {
    // One pass rather than five `filter` sweeps; the per-status breakdown feeds
    // the summary panel's sparkline as well as the tiles and the filter chips.
    const byStatus: Record<ApplicationStatus, number> = {
      PENDING: 0,
      SHORTLISTED: 0,
      INTERVIEW: 0,
      REJECTED: 0,
      ACCEPTED: 0,
    };
    for (const application of applications) {
      if (isApplicationStatus(application.status)) byStatus[application.status] += 1;
    }
    return {
      total: applications.length,
      byStatus,
      pending: byStatus.PENDING,
      interviews: byStatus.INTERVIEW,
      accepted: byStatus.ACCEPTED,
      /** Still open with the employer: not yet accepted or rejected. */
      inFlight: byStatus.PENDING + byStatus.SHORTLISTED + byStatus.INTERVIEW,
    };
  }, [applications]);

  /** Sparkline heights, normalised against the tallest bucket. */
  const pipelineBars = useMemo(() => {
    if (applications.length === 0) return undefined;
    const counts = PIPELINE_ORDER.map((status) => stats.byStatus[status]);
    const peak = Math.max(...counts, 1);
    return counts.map((count) => count / peak);
  }, [applications.length, stats.byStatus]);

  const visibleApplications = useMemo(
    () =>
      statusFilter === "ALL"
        ? applications
        : applications.filter((application) => application.status === statusFilter),
    [applications, statusFilter]
  );

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  const scrollToResume = () => {
    resumeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Move focus as well as the viewport, so keyboard users follow the jump.
    fileInputRef.current?.focus({ preventScroll: true });
  };

  const startConversation = async (application: Application) => {
    setMessagingId(application.id);
    try {
      // The application carries the employer's id, so we no longer guess the
      // company from a name search that could match the wrong one (audit 2.5).
      const conversation = await apiFetch<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ companyId: application.job.companyId }),
      });
      router.push(`/seeker/conversations?conversationId=${conversation.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not open a conversation";
      console.error("Failed to start conversation:", error);
      toast.error(message);
    } finally {
      setMessagingId(null);
    }
  };

  const withdrawApplication = async (application: Application) => {
    const confirmed = window.confirm(
      `Withdraw your application for "${application.job.title}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setWithdrawingId(application.id);
    try {
      await apiFetch("/api/applications", {
        method: "DELETE",
        body: JSON.stringify({ id: application.id }),
      });
      setApplications((current) => current.filter((item) => item.id !== application.id));
      toast.success("Application withdrawn");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not withdraw the application";
      console.error("Failed to withdraw application:", error);
      toast.error(message);
    } finally {
      setWithdrawingId(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setUploadError("");
    if (!file) {
      setResumeFile(null);
      return;
    }
    // Checked before the request so a 40 MB zip is rejected instantly instead of
    // being streamed to Cloudinary first (audit 3.15).
    const problem = validateResumeFile(file);
    if (problem) {
      setUploadError(problem);
      setResumeFile(null);
      event.target.value = "";
      return;
    }
    setResumeFile(file);
  };

  const handleResumeUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    setUploadError("");
    if (!resumeFile) {
      setUploadError("Choose a file to upload first.");
      return;
    }

    const problem = validateResumeFile(resumeFile);
    if (problem) {
      setUploadError(problem);
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      // No `userId`: the server takes the owner from the session, and a POST now
      // replaces any existing resume, so there is a single code path here.
      body.append("resume", resumeFile);
      const created = await apiFetch<Resume>("/api/resumes", { method: "POST", body });
      setResume(created);
      setResumeFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(resume ? "Resume replaced" : "Resume uploaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      console.error("Resume upload failed:", error);
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner label="Loading your dashboard" />
      </div>
    );
  }

  if (!allowed) return null;

  const resumeFileName = resume ? resume.fileName ?? resume.url.split("/").pop() ?? "resume" : "";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Seeker overview"
          title={user?.name ? `Welcome back, ${user.name}` : "Your dashboard"}
          description="Every application you have sent, and exactly where each one stands."
          action={
            <Link href="/jobs" className={buttonPrimary}>
              Browse jobs
              <Icon.arrowUpRight className="h-4 w-4" />
            </Link>
          }
        />

        {/* Pipeline telemetry, derived entirely from the applications already in
            state — the bars are the per-status counts, normalised. */}
        <SignalPanel
          className="mt-6"
          title="Application pipeline"
          live={stats.inFlight > 0}
          detail={
            applicationsLoading
              ? "Reading your application history…"
              : applicationsError
                ? "Pipeline unavailable — reload below."
                : stats.total === 0
                  ? "Nothing in flight yet. Apply to a role to start the pipeline."
                  : `${stats.inFlight} of ${stats.total} roles still in flight · ${stats.interviews} at interview · ${stats.accepted} accepted`
          }
          value={applicationsLoading ? "—" : formatCount(stats.total)}
          valueLabel="Applications"
          bars={pipelineBars}
        />

        {/* Stats — counting only this seeker's own applications. */}
        <section
          aria-label="Application summary"
          className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatCard
            label="Total applications"
            value={applicationsLoading ? "—" : formatCount(stats.total)}
            icon={<Icon.briefcase className="h-5 w-5" />}
            tone="blue"
            hint="Sent all time"
          />
          <StatCard
            label="Pending"
            value={applicationsLoading ? "—" : formatCount(stats.pending)}
            icon={<Icon.clock className="h-5 w-5" />}
            tone="amber"
            hint="Awaiting a first response"
          />
          <StatCard
            label="Interviews"
            value={applicationsLoading ? "—" : formatCount(stats.interviews)}
            icon={<Icon.badge className="h-5 w-5" />}
            tone="purple"
            hint="Scheduled or in progress"
          />
          <StatCard
            label="Accepted"
            value={applicationsLoading ? "—" : formatCount(stats.accepted)}
            icon={<Icon.checkCircle className="h-5 w-5" />}
            tone="green"
            hint="Offers on the table"
          />
        </section>

        {/* Quick actions. The resume tile is a status panel, not a link, so it no
            longer masquerades as navigation next to the two real links. */}
        <section aria-label="Quick actions" className="mt-4 grid gap-3 sm:gap-4 md:grid-cols-3">
          <QuickLink
            href="/jobs"
            title="Browse jobs"
            description="Find your next opportunity"
            icon={<Icon.search className="h-5 w-5" />}
          />
          <QuickLink
            href="/seeker/conversations"
            title="Messages"
            description="Chat with employers"
            icon={<Icon.chat className="h-5 w-5" />}
          />

          <Card signal={!!resume && !resumeError} className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border ${
                  resume && !resumeError
                    ? "border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-900/25 dark:text-green-400"
                    : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                }`}
                aria-hidden="true"
              >
                <Icon.document className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <Eyebrow className="mb-1">Resume</Eyebrow>
                <p
                  className="text-sm font-semibold text-gray-900 dark:text-white"
                  aria-live="polite"
                >
                  {resumeLoading
                    ? "Checking…"
                    : resumeError
                      ? "Status unavailable"
                      : resume
                        ? "On file"
                        : "Not uploaded yet"}
                </p>
                {resume && !resumeError && !resumeLoading && (
                  <Eyebrow className="mt-1">Since {formatDate(resume.createdAt)}</Eyebrow>
                )}
              </div>
            </div>
            <button type="button" onClick={scrollToResume} className={`${buttonSecondary} self-start`}>
              {resume ? "Replace resume" : "Upload resume"}
            </button>
          </Card>
        </section>

        {/* Applications — the centrepiece. One panel, hairline-divided rows. */}
        <Card className="mt-6">
          <div className="flex flex-col gap-4 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Eyebrow className="mb-1.5">Pipeline</Eyebrow>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
                My applications
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Track how each application is progressing.
              </p>
            </div>

            {/* A segmented control rather than a select: the counts are visible
                without opening anything, and it wraps instead of scrolling. */}
            <div className="min-w-0">
              <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
                <Icon.filter className="h-3.5 w-3.5" />
                Filter by status
              </Eyebrow>
              <div
                role="group"
                aria-label="Filter applications by status"
                className="flex flex-wrap gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-700"
              >
                {FILTERS.map((filter) => {
                  const active = statusFilter === filter;
                  const count =
                    filter === "ALL" ? stats.total : stats.byStatus[filter];
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setStatusFilter(filter)}
                      aria-pressed={active}
                      className={`mono inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-wider transition-colors ${
                        active
                          ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                      }`}
                    >
                      {FILTER_LABELS[filter]}
                      <span className={active ? "opacity-70" : "opacity-60"}>
                        {applicationsLoading ? "—" : count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div aria-live="polite">
            {applicationsLoading ? (
              <div className="px-6 py-12 text-center">
                <Spinner label="Loading your applications" />
              </div>
            ) : applicationsError ? (
              <div className="p-4 sm:p-6">
                <Alert variant="error">
                  <p>{applicationsError}</p>
                  <button
                    type="button"
                    onClick={() => void loadApplications()}
                    className="mt-2 font-semibold underline underline-offset-2"
                  >
                    Try again
                  </button>
                </Alert>
              </div>
            ) : applications.length === 0 ? (
              <EmptyState
                icon={<Icon.briefcase className="h-7 w-7" />}
                title="No applications yet"
                description="Start your search by applying to roles that match your skills."
                action={
                  <Link href="/jobs" className={buttonPrimary}>
                    <Icon.search className="h-4 w-4" />
                    Browse jobs
                  </Link>
                }
              />
            ) : visibleApplications.length === 0 ? (
              <EmptyState
                title={`No ${STATUS_LABELS[statusFilter as ApplicationStatus].toLowerCase()} applications`}
                description="Try a different status filter to see the rest of your applications."
                action={
                  <button type="button" onClick={() => setStatusFilter("ALL")} className={buttonSecondary}>
                    Show all
                  </button>
                }
              />
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {visibleApplications.map((application) => (
                  <ApplicationRow
                    key={application.id}
                    application={application}
                    messaging={messagingId === application.id}
                    withdrawing={withdrawingId === application.id}
                    onMessage={() => void startConversation(application)}
                    onWithdraw={() => void withdrawApplication(application)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Identity — the read-only half of the profile. */}
        <Card className="mt-6">
          <CardHeader
            eyebrow="Record"
            title="Profile"
            description="Employers see this alongside every application you send."
            action={
              <Link href="/seeker/profile/edit" className={buttonSecondary}>
                <Icon.edit className="h-4 w-4" />
                Edit profile
              </Link>
            }
          />
          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
            <ReadOnlyField label="Full name" value={user?.name} />
            <ReadOnlyField label="Email address" value={user?.email} mono />
            <ReadOnlyField label="Account type" value="Job seeker" />
          </div>
        </Card>

        {/* Resume — a telemetry panel: graph-paper field, mono file record. */}
        <Card grid className="mt-4">
          <span id="my-resume" className="block scroll-mt-24" aria-hidden="true" />

          <section ref={resumeSectionRef} className="p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Eyebrow className="mb-1.5">Attachment</Eyebrow>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
                  Resume
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  One file on record, sent with every application.
                </p>
              </div>
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                aria-hidden="true"
              >
                <Icon.document className="h-5 w-5" />
              </span>
            </div>

            <div aria-live="polite" className="mt-5">
              {resumeLoading ? (
                <Spinner className="h-5 w-5" label="Loading your resume" />
              ) : resumeError ? (
                <Alert variant="error">
                  <p>{resumeError}</p>
                  <button
                    type="button"
                    onClick={() => void loadResume()}
                    className="mt-2 font-semibold underline underline-offset-2"
                  >
                    Try again
                  </button>
                </Alert>
              ) : resume ? (
                // The record itself sits on a slightly opaque surface so the
                // graph-paper rules stay visible around, but not through, it.
                <div className="rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70 sm:p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt>
                          <Eyebrow>File</Eyebrow>
                        </dt>
                        <dd className="mono mt-1 truncate text-sm text-gray-900 dark:text-white">
                          {resumeFileName}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt>
                          <Eyebrow>Uploaded</Eyebrow>
                        </dt>
                        <dd className="mt-1">
                          <Readout className="text-sm">{formatDate(resume.createdAt)}</Readout>
                        </dd>
                      </div>
                    </dl>
                    <a
                      href={resume.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonSecondary}
                    >
                      <Icon.external className="h-4 w-4" />
                      View
                      <span className="sr-only"> resume (opens in a new tab)</span>
                    </a>
                  </div>
                </div>
              ) : (
                <Alert variant="warning">
                  <p className="font-medium">No resume uploaded yet</p>
                  <p className="mt-0.5">
                    Employers are far more likely to respond when a resume is attached.
                  </p>
                </Alert>
              )}
            </div>

            <form
              onSubmit={handleResumeUpload}
              className="mt-6 space-y-4 border-t border-gray-200 pt-5 dark:border-gray-700"
            >
              <div>
                {/* The constraint line stays a separate element rather than
                    moving into `<Label hint>`: `aria-describedby` points at
                    `#resume-hint`, and the hint slot renders no id. */}
                <Label htmlFor="resume-file">
                  {resume ? "Replace your resume" : "Upload your resume"}
                </Label>
                <input
                  ref={fileInputRef}
                  id="resume-file"
                  name="resume"
                  type="file"
                  accept={RESUME_ACCEPT}
                  onChange={handleFileChange}
                  disabled={uploading}
                  aria-describedby="resume-hint"
                  className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-white text-sm text-gray-500 file:mr-4 file:cursor-pointer file:rounded-l-md file:border-0 file:border-r file:border-gray-200 file:bg-gray-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-gray-900 hover:file:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:file:border-gray-700 dark:file:bg-gray-700 dark:file:text-white dark:hover:file:bg-gray-600"
                />
                <p id="resume-hint" className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  PDF, DOC or DOCX, up to 5 MB.
                  {resume && " Uploading a new file replaces the one on file."}
                </p>
                {resumeFile && (
                  <p className="mono mt-2 truncate text-xs text-gray-700 dark:text-gray-200">
                    Selected: {resumeFile.name} ({Math.max(1, Math.round(resumeFile.size / 1024))} KB)
                  </p>
                )}
              </div>

              {uploadError && <Alert variant="error">{uploadError}</Alert>}

              <button type="submit" disabled={uploading || !resumeFile} className={buttonPrimary}>
                {uploading ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    {resume ? "Replacing…" : "Uploading…"}
                  </>
                ) : (
                  <>
                    <Icon.upload className="h-4 w-4" />
                    {resume ? "Replace resume" : "Upload resume"}
                  </>
                )}
              </button>
            </form>
          </section>
        </Card>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local presentational pieces                                                 */
/* -------------------------------------------------------------------------- */

function ApplicationRow({
  application,
  messaging,
  withdrawing,
  onMessage,
  onWithdraw,
}: {
  application: Application;
  messaging: boolean;
  withdrawing: boolean;
  onMessage: () => void;
  onWithdraw: () => void;
}) {
  const status = isApplicationStatus(application.status) ? application.status : null;
  const progress = status ? STAGE_PROGRESS[status] : 0;
  const caption = status ? STAGE_CAPTION[status] : "Unknown stage";
  const statusLabel = status ? STATUS_LABELS[status] : application.status;

  return (
    <li className="p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
            <Link
              href={`/jobs/${application.job.id}`}
              className="rounded transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-blue-400"
            >
              {application.job.title}
            </Link>
          </h3>

          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {application.job.company.name}
          </p>

          {/* Chips are rendered only when the field exists, so no orphan icon
              sits next to an empty string. */}
          {(application.job.location || application.job.type) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {application.job.location && (
                <Chip icon={<Icon.location className="h-3.5 w-3.5" />}>
                  {application.job.location}
                </Chip>
              )}
              {application.job.type && (
                <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{application.job.type}</Chip>
              )}
            </div>
          )}

          <p className="mono mt-2.5 text-xs text-gray-500 dark:text-gray-400">
            Applied {formatRelative(application.createdAt)} · {formatDate(application.createdAt)}
          </p>

          {application.message && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
              {application.message}
            </p>
          )}

          {/* Progress through the four live stages. `strongAt` is pinned to 100
              so only an accepted application fills emerald — the accent stays
              reserved for a genuinely good outcome. */}
          <div className="mt-4 max-w-md">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <Eyebrow>{caption}</Eyebrow>
              <Readout className="text-xs font-medium">{progress}%</Readout>
            </div>
            <Meter
              value={progress}
              strongAt={100}
              label={`Application progress for ${application.job.title}: ${statusLabel}`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:w-48 lg:flex-shrink-0 lg:items-end">
          <StatusBadge status={application.status} />
          <div className="flex flex-col gap-2 sm:flex-row lg:w-full lg:flex-col">
            <button
              type="button"
              onClick={onMessage}
              disabled={messaging}
              className={`${buttonSecondary} lg:w-full`}
            >
              {messaging ? <Spinner className="h-4 w-4" /> : <Icon.chat className="h-4 w-4" />}
              Message
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              disabled={withdrawing}
              className="btn-touch inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/40 lg:w-full"
            >
              {withdrawing ? <Spinner className="h-4 w-4" /> : <Icon.trash className="h-4 w-4" />}
              Withdraw
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function QuickLink({
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
      className="panel group flex items-center gap-3 p-4 transition-colors hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-gray-600"
    >
      {/* Solid ink tile, echoing the navbar mark — no coloured washes. */}
      <span
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="block text-sm text-gray-500 dark:text-gray-400">{description}</span>
      </span>
      <Icon.arrowUpRight className="ml-auto h-4 w-4 flex-shrink-0 text-gray-400 transition-colors group-hover:text-gray-900 dark:group-hover:text-white" />
    </Link>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <Eyebrow>{label}</Eyebrow>
      <p
        className={`mt-1.5 break-words text-sm font-semibold text-gray-900 dark:text-white ${
          mono ? "mono font-medium" : ""
        }`}
      >
        {value || "—"}
      </p>
    </div>
  );
}
