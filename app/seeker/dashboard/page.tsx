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

/** Mirrors `MatchBreakdown` in `lib/ai/matching.ts`; only the score and the
 *  shared skills are surfaced here — the facet breakdown belongs on the job
 *  page, where there is room to explain it. */
interface MatchBreakdown {
  score: number;
  facets: { semantic: number; skills: number; location: number; seniority: number };
  sharedSkills: string[];
  missingSkills: string[];
}

interface RecommendedJob {
  id: string;
  title: string;
  location?: string | null;
  type?: string | null;
  skills?: string[];
  company?: { id: string; name: string } | null;
  _count?: { applications: number };
  /** Null when there was no semantic signal on either side — see `computeMatch`. */
  match: MatchBreakdown | null;
}

/**
 * `GET /api/jobs/recommended` answers 200 in every ordinary case. `reason` says
 * which of the three empty states applies, so an absent list is never confused
 * with a failure.
 */
interface RecommendedResponse {
  jobs: RecommendedJob[];
  reason: "no-profile" | "disabled" | null;
}

/**
 * What the résumé parser extracted, and what the user row keeps of it.
 * `strengths` is the exception: the model returns it, nothing stores it, so it
 * is present straight after an analysis and absent on a cold load.
 */
interface ProfileSignal {
  headline: string | null;
  seniority: string | null;
  yearsOfExp: number | null;
  skills: string[];
  summary: string | null;
  strengths: string[];
  updatedAt: string | null;
}

/**
 * "loading" and "hidden" are both silent: a recommendation strip is a bonus,
 * and a bonus that failed has nothing to say to the person reading the page.
 */
type RecommendState = "loading" | "ready" | "no-profile" | "hidden";

/* -------------------------------------------------------------------------- */
/* Untrusted JSON readers                                                      */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<string[]>((tags, entry) => {
    const tag = readString(entry);
    if (tag) tags.push(tag);
    return tags;
  }, []);
}

/** An empty extraction is worth nothing on screen, so it reads as absent. */
function orNull(signal: ProfileSignal): ProfileSignal | null {
  return signal.headline || signal.summary || signal.skills.length > 0 ? signal : null;
}

/**
 * Reads the AI-derived half of a user row off whatever object is to hand — the
 * rehydrated Redux user, or the `/api/users/:id` record. Both are read through
 * the same reader because the JWT carries only session fields, so the store
 * frequently has none of these and the record is the fallback.
 */
function readStoredSignal(source: unknown): ProfileSignal | null {
  if (!isRecord(source)) return null;
  return orNull({
    headline: readString(source.headline),
    seniority: readString(source.seniority),
    yearsOfExp: readNumber(source.yearsOfExp),
    skills: readStringList(source.skills),
    summary: readString(source.aiSummary),
    strengths: [],
    updatedAt: readString(source.aiUpdatedAt),
  });
}

/** The `POST /api/ai/resume` body, which names `summary`/`updatedAt` directly. */
function readAnalysis(source: unknown): ProfileSignal | null {
  if (!isRecord(source)) return null;
  return orNull({
    headline: readString(source.headline),
    seniority: readString(source.seniority),
    yearsOfExp: readNumber(source.yearsOfExp),
    skills: readStringList(source.skills),
    summary: readString(source.summary),
    strengths: readStringList(source.strengths),
    updatedAt: readString(source.updatedAt),
  });
}

function readErrorMessage(payload: unknown): string | null {
  return isRecord(payload) ? readString(payload.error) : null;
}

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

/** Six fills two rows of three on a wide screen and still reads on a phone. */
const RECOMMENDED_LIMIT = 6;

/**
 * Where a match stops being "worth a look" and starts being "this is you". The
 * route already floors recommendations at 40, so every card here has cleared a
 * bar — the emerald fill is reserved for the top of that range.
 */
const STRONG_MATCH = 70;

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

  const [recommendations, setRecommendations] = useState<RecommendedJob[]>([]);
  const [recommendState, setRecommendState] = useState<RecommendState>("loading");

  /**
   * Null until something has told us either way. The recommendations probe and
   * the résumé parser both key off the same `isAiEnabled()`, so one 'disabled'
   * or one 503 settles it for the session and every AI affordance retires
   * quietly — no toast, no dead button, no panel that never resolves.
   */
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  const [signal, setSignal] = useState<ProfileSignal | null>(null);
  const [analysing, setAnalysing] = useState(false);
  /** The one thing worth saying in-panel: "there is no file to read". */
  const [analyseNotice, setAnalyseNotice] = useState("");

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

  const loadRecommended = useCallback(async () => {
    setRecommendState("loading");
    try {
      const data = await apiFetch<RecommendedResponse>(
        `/api/jobs/recommended?limit=${RECOMMENDED_LIMIT}`
      );
      const reason = data?.reason ?? null;

      if (reason === "disabled") {
        setAiEnabled(false);
        setRecommendations([]);
        setRecommendState("hidden");
        return;
      }

      setAiEnabled(true);
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      setRecommendations(jobs);
      // An empty list with no reason means nothing cleared the score floor.
      // There is no useful prompt for that, so the strip stands down.
      setRecommendState(reason === "no-profile" ? "no-profile" : jobs.length > 0 ? "ready" : "hidden");
    } catch (error) {
      // Never an error state: the dashboard's job is the application list, and
      // a failed bonus panel must not look like a broken page.
      console.error("Failed to load recommendations:", error);
      setRecommendations([]);
      setRecommendState("hidden");
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadApplications();
    void loadResume();
    void loadRecommended();
  }, [allowed, loadApplications, loadResume, loadRecommended]);

  // Whatever a previous analysis left on the row, so the panel is not empty on
  // a cold load. The JWT carries only session fields, so the store usually has
  // none of this and the user record is the fallback — and failing to read it
  // is not worth telling anybody about, since the panel simply stays quiet.
  useEffect(() => {
    if (!allowed || !user?.id) return;

    const fromStore = readStoredSignal(user);
    if (fromStore) {
      setSignal(fromStore);
      return;
    }

    let cancelled = false;
    apiFetch<unknown>(`/api/users/${user.id}`)
      .then((record) => {
        if (!cancelled) setSignal(readStoredSignal(record));
      })
      .catch((error: unknown) => {
        console.error("Could not load your extracted profile:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [allowed, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Reads the resume on file into a structured profile.
   *
   * Raw `fetch` rather than `apiFetch`, because the status code is the whole
   * decision here: 503 means this deployment has no model and the button should
   * disappear, 404 means there is nothing to read and the answer is an upload
   * prompt, and only what is left is a genuine failure worth a toast.
   */
  const analyseResume = async () => {
    setAnalyseNotice("");
    setAnalysing(true);
    try {
      const response = await fetch("/api/ai/resume", { method: "POST", headers: authHeaders() });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (response.status === 503) {
        setAiEnabled(false);
        return;
      }

      if (response.status === 404) {
        setAnalyseNotice(
          readErrorMessage(payload) ??
            "Upload a resume first and we will read it into your profile."
        );
        return;
      }

      if (!response.ok) {
        throw new Error(
          readErrorMessage(payload) ?? "We could not read your resume. Please try again."
        );
      }

      const extracted = readAnalysis(payload);
      if (!extracted) {
        throw new Error("We could not find a professional profile in that file.");
      }

      setSignal(extracted);
      setAiEnabled(true);
      toast.success("Resume read into your profile");

      // The profile vector was just rewritten, so anything already on screen is
      // scored against a profile that no longer exists.
      void loadRecommended();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "We could not read your resume";
      console.error("Resume analysis failed:", error);
      toast.error(message);
    } finally {
      setAnalysing(false);
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

        {/* Roles scored against the profile vector. The whole section is absent
            when the deployment has no model, when the fetch failed, or when
            nothing cleared the score floor — there is no half-state. */}
        {recommendState !== "hidden" && (
          <section aria-labelledby="matched-heading" className="mt-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
                  <Icon.spark className="h-3.5 w-3.5" />
                  Profile match
                </Eyebrow>
                <h2
                  id="matched-heading"
                  className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl"
                >
                  Matched to you
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Open roles scored against your profile, strongest fit first.
                </p>
              </div>
              {recommendState === "ready" && (
                <Eyebrow>{recommendations.length} roles scored</Eyebrow>
              )}
            </div>

            <div aria-live="polite" aria-busy={recommendState === "loading"}>
              {recommendState === "loading" ? (
                <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                  {Array.from({ length: 3 }, (_, index) => (
                    <MatchCardSkeleton key={index} />
                  ))}
                  <span className="sr-only">Scoring roles against your profile</span>
                </div>
              ) : recommendState === "no-profile" ? (
                // The state that teaches the feature. Two doors, both short:
                // the file we can read, or the fields they can type.
                <Card grid className="p-4 sm:p-6">
                  <Eyebrow accent className="mb-1.5 flex items-center gap-1.5" as="div">
                    <Icon.graph className="h-3.5 w-3.5" />
                    Matching not started
                  </Eyebrow>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    Tell us what you do and we will score roles for you
                  </h3>
                  <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
                    Matching reads your headline, skills and experience. Upload a resume and we
                    will pull them out for you, or fill them in yourself.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={scrollToResume} className={buttonPrimary}>
                      <Icon.upload className="h-4 w-4" />
                      Add your resume
                    </button>
                    <Link href="/seeker/profile/edit" className={buttonSecondary}>
                      <Icon.edit className="h-4 w-4" />
                      Fill in your profile
                    </Link>
                  </div>
                </Card>
              ) : (
                <ul className="grid list-none gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                  {recommendations.map((job) => (
                    <li key={job.id} className="flex min-w-0">
                      <MatchedJobCard job={job} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Applications — the centrepiece. One panel, hairline-divided rows. */}
        <Card className="mt-6">
          <div className="flex flex-col gap-4 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Eyebrow className="mb-1.5">Pipeline</Eyebrow>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
                My applications
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
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
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
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

          {/* `aria-busy` rather than a live region around the list itself: this
              container holds every application, so `aria-live` had a screen
              reader read the whole set out on any change. The count below is
              the part worth announcing. */}
          <div aria-busy={applicationsLoading}>
            <p aria-live="polite" className="sr-only">
              {applicationsLoading
                ? ""
                : applicationsError
                  ? "Your applications could not be loaded."
                  : `Showing ${visibleApplications.length} of ${stats.total} applications${
                      statusFilter === "ALL" ? "" : `, filtered to ${FILTER_LABELS[statusFilter]}`
                    }.`}
            </p>
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
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
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

            {/* Resume intelligence. Gated on a file being on record and on the
                deployment actually having a model — `aiEnabled === false` is
                latched for the session, so the button never comes back. */}
            {resume && !resumeLoading && !resumeError && aiEnabled !== false && (
              <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-prose">
                    <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
                      <Icon.spark className="h-3.5 w-3.5" />
                      Resume intelligence
                    </Eyebrow>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      We can read this file into a structured profile — headline, seniority,
                      skills — which is what job matching scores against. Everything it finds
                      stays yours to edit.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void analyseResume()}
                    disabled={analysing}
                    aria-busy={analysing}
                    className={buttonSecondary}
                  >
                    {analysing ? (
                      <>
                        <Spinner className="h-4 w-4" />
                        Reading your resume…
                      </>
                    ) : (
                      <>
                        <Icon.spark className="h-4 w-4" />
                        {signal ? "Analyse again" : "Analyse resume"}
                      </>
                    )}
                  </button>
                </div>

                {analyseNotice && (
                  <Alert variant="warning" className="mt-3">
                    {analyseNotice}
                  </Alert>
                )}
              </div>
            )}

            {/* Shown whether or not the model is still switched on: this is the
                user's own profile data, not a live AI feature. */}
            {signal && <ExtractedProfile signal={signal} />}

            <form
              onSubmit={handleResumeUpload}
              aria-busy={uploading}
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
                  // A rejected file (wrong type, too large) put its reason in a
                  // banner the input never pointed at.
                  aria-invalid={Boolean(uploadError) || undefined}
                  aria-describedby={uploadError ? "resume-upload-error resume-hint" : "resume-hint"}
                  className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-white text-sm text-gray-500 file:mr-4 file:cursor-pointer file:rounded-l-md file:border-0 file:border-r file:border-gray-200 file:bg-gray-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-gray-900 hover:file:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:file:border-gray-700 dark:file:bg-gray-700 dark:file:text-white dark:hover:file:bg-gray-600"
                />
                <p id="resume-hint" className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                  PDF, DOC or DOCX, up to 5 MB.
                  {resume && " Uploading a new file replaces the one on file."}
                </p>
                {resumeFile && (
                  <p className="mono mt-2 truncate text-xs text-gray-700 dark:text-gray-200">
                    Selected: {resumeFile.name} ({Math.max(1, Math.round(resumeFile.size / 1024))} KB)
                  </p>
                )}
              </div>

              {uploadError && (
                <Alert variant="error">
                  <span id="resume-upload-error">{uploadError}</span>
                </Alert>
              )}

              <button
                type="submit"
                disabled={uploading || !resumeFile}
                aria-busy={uploading}
                className={buttonPrimary}
              >
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
  const fitAtApply = readNumber(application.matchScore);

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

          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
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

          <p className="mono mt-2.5 text-xs text-gray-600 dark:text-gray-400">
            Applied {formatRelative(application.createdAt)} · {formatDate(application.createdAt)}
          </p>

          {application.message && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
              {application.message}
            </p>
          )}

          {/* Two different numbers sit side by side here, so both are labelled
              in full: the meter is how far the application has travelled, the
              readout is how well the profile fitted on the day it was sent.
              The fit is a stored historical figure and never a progress bar. */}
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
            {/* `strongAt` is pinned to 100 so only an accepted application fills
                emerald — the accent stays reserved for a good outcome. */}
            <div className="min-w-[14rem] max-w-md flex-1">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <Eyebrow>Pipeline · {caption}</Eyebrow>
                <Readout className="text-xs font-medium">{progress}%</Readout>
              </div>
              <Meter
                value={progress}
                strongAt={100}
                label={`Application progress for ${application.job.title}: ${statusLabel}`}
              />
            </div>

            {fitAtApply !== null && (
              <div>
                <Eyebrow className="mb-1">Fit at apply</Eyebrow>
                <Readout className="text-sm font-semibold">{Math.round(fitAtApply)}%</Readout>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:w-48 lg:flex-shrink-0 lg:items-end">
          <StatusBadge status={application.status} />
          <div className="flex flex-col gap-2 sm:flex-row lg:w-full lg:flex-col">
            {/* Every row repeats this pair, so each one names its role: read
                out of context, "Withdraw" alone says nothing about which. */}
            <button
              type="button"
              onClick={onMessage}
              disabled={messaging}
              aria-busy={messaging}
              className={`${buttonSecondary} lg:w-full`}
            >
              {messaging ? <Spinner className="h-4 w-4" /> : <Icon.chat className="h-4 w-4" />}
              Message
              <span className="sr-only"> about {application.job.title}</span>
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              disabled={withdrawing}
              aria-busy={withdrawing}
              className="btn-touch inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/40 lg:w-full"
            >
              {withdrawing ? <Spinner className="h-4 w-4" /> : <Icon.trash className="h-4 w-4" />}
              Withdraw
              <span className="sr-only"> application for {application.job.title}</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * A compact scored role. The score is the reason the card is here at all, so it
 * sits at the top right in mono and is repeated as a bar — the length carries
 * the meaning on its own, and emerald only arrives at the top of the range.
 */
function MatchedJobCard({ job }: { job: RecommendedJob }) {
  const match = job.match;
  const score = match ? Math.round(match.score) : null;
  const shared = match?.sharedSkills.slice(0, 3) ?? [];
  const applicants = job._count?.applications ?? 0;

  return (
    <Card
      signal={score !== null && score >= STRONG_MATCH}
      className="flex w-full min-w-0 flex-col p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            <Link
              href={`/jobs/${job.id}`}
              className="rounded transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-blue-400"
            >
              {job.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400">
            {job.company?.name ?? "—"}
          </p>
        </div>
        {score !== null && (
          <MatchScore value={score} caption="PROFILE FIT" className="flex-shrink-0" />
        )}
      </div>

      {score !== null && (
        <Meter
          className="mt-3"
          value={score}
          strongAt={STRONG_MATCH}
          label={`Profile fit for ${job.title}: ${score} out of 100`}
        />
      )}

      {shared.length > 0 && (
        <div className="mt-3">
          <Eyebrow className="mb-1.5">Skills in common</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {shared.map((skill) => (
              <Chip key={skill} accent>
                {skill}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <Eyebrow>{formatCount(applicants)} applied</Eyebrow>
        <Link href={`/jobs/${job.id}`} className={buttonGhost}>
          View role
          <Icon.arrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
  );
}

/** Placeholder in the shape of the card it becomes, so the grid doesn't jump. */
function MatchCardSkeleton() {
  return (
    <Card className="p-4" aria-hidden="true">
      <div className="animate-pulse space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="w-full space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="h-8 w-16 flex-shrink-0 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="flex gap-1.5">
          <div className="h-6 w-16 rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="h-6 w-20 rounded-lg bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-6 w-full rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </Card>
  );
}

/**
 * The profile the model read out of the résumé.
 *
 * Labelled as extracted and paired with the editor on every render: the model
 * is a fast first draft of the fields, never a finding about the person, and
 * the page should never imply otherwise.
 */
function ExtractedProfile({ signal }: { signal: ProfileSignal }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-prose">
          <Eyebrow accent className="mb-1.5 flex items-center gap-1.5" as="div">
            <Icon.spark className="h-3.5 w-3.5" />
            Extracted by AI
            {/* No colour override: the accent eyebrow's own colour already
                reads, whereas gray-400 on this surface sat at 2.6:1. */}
            {signal.updatedAt && <span>· {formatRelative(signal.updatedAt)}</span>}
          </Eyebrow>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Read out of your resume by our matching model. It is a draft of your profile, not a
            verdict on it — correct anything that is wrong.
          </p>
        </div>
        <Link href="/seeker/profile/edit" className={buttonSecondary}>
          <Icon.edit className="h-4 w-4" />
          Edit these fields
        </Link>
      </div>

      {signal.headline && (
        <p className="mt-4 text-base font-semibold text-gray-900 dark:text-white">
          {signal.headline}
        </p>
      )}

      {(signal.seniority || signal.yearsOfExp !== null) && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {signal.seniority && (
            <div>
              <dt>
                <Eyebrow>Seniority</Eyebrow>
              </dt>
              <dd className="mt-1">
                <Readout className="text-sm font-semibold">{signal.seniority}</Readout>
              </dd>
            </div>
          )}
          {signal.yearsOfExp !== null && (
            <div>
              <dt>
                <Eyebrow>Years of experience</Eyebrow>
              </dt>
              <dd className="mt-1">
                <Readout className="text-sm font-semibold">{signal.yearsOfExp}</Readout>
              </dd>
            </div>
          )}
        </dl>
      )}

      {signal.skills.length > 0 && (
        <div className="mt-4">
          <Eyebrow className="mb-1.5">Skills · {signal.skills.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {signal.skills.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
          </div>
        </div>
      )}

      {signal.summary && (
        <div className="mt-4">
          <Eyebrow className="mb-1.5">Summary</Eyebrow>
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {signal.summary}
          </p>
        </div>
      )}

      {signal.strengths.length > 0 && (
        <div className="mt-4">
          <Eyebrow className="mb-1.5">Strengths</Eyebrow>
          <ul className="space-y-1.5">
            {signal.strengths.map((strength) => (
              <li
                key={strength}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <Icon.check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                {strength}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
        <span className="block text-sm text-gray-600 dark:text-gray-400">{description}</span>
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
