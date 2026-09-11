"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  Button,
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
  Skeleton,
  StatCard,
  StatusBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  formatCount,
  formatDate,
  formatRelative,
} from "@/app/components/ui";

import DashboardLoading from "./loading";

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

/** One row of the "Needs attention" rail — see `attentionItems`. */
interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  action: React.ReactNode;
}

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
 * The four live stages, in order. A rejection is a *closed file* rather than a
 * partial one, so it sits outside the track entirely.
 *
 * This replaced a `Meter` reading "Pipeline · Stage 2 / 4 · Shortlisted — 50%".
 * A percentage implies the application is halfway to an offer, which is not a
 * claim anybody can make; four discrete segments say exactly what is known —
 * which stage it reached — and nothing more. The shape follows the GOV.UK
 * "progress through a process" idea referenced in DESIGN-NOTES §1.5.
 */
const PIPELINE_STAGES: readonly ApplicationStatus[] = [
  "PENDING",
  "SHORTLISTED",
  "INTERVIEW",
  "ACCEPTED",
];

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
 * How many matched roles show before the user asks for the rest.
 *
 * Progressive disclosure, in Nielsen's original sense: defer the secondary set
 * to a second step so the primary one is not competing with it. Three is one
 * full row at `xl` and the point at which the recommendation strip stops
 * pushing the application list — the actual reason for this page — below the
 * fold on a laptop.
 */
const RECOMMENDED_PREVIEW = 3;

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
  /** The upload form is disclosed rather than always-on — see `Disclosure`. */
  const [uploadOpen, setUploadOpen] = useState(false);

  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const [recommendations, setRecommendations] = useState<RecommendedJob[]>([]);
  const [recommendState, setRecommendState] = useState<RecommendState>("loading");
  const [showAllMatches, setShowAllMatches] = useState(false);

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

  const resumeSectionRef = useRef<HTMLDivElement | null>(null);
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

  const visibleMatches = showAllMatches
    ? recommendations
    : recommendations.slice(0, RECOMMENDED_PREVIEW);

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  const openUpload = useCallback(() => {
    setUploadOpen(true);
    resumeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Move focus as well as the viewport, so keyboard users follow the jump.
    // Deferred a frame: the input does not exist until the disclosure renders.
    requestAnimationFrame(() => fileInputRef.current?.focus({ preventScroll: true }));
  }, []);

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
      // The record above now says everything the open form was there to say.
      setUploadOpen(false);
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
  /* "Needs attention"                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * The top tier of the hierarchy: the handful of things the user can *do*
   * something about right now, ahead of everything that is merely status.
   *
   * Every item is derived from state already fetched — nothing is invented, and
   * an item disappears the moment its condition clears. When the list is empty
   * the whole section is absent rather than rendering a congratulatory card:
   * an empty to-do list is best expressed by there being no to-do list.
   */
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (!resumeLoading && !resumeError && !resume) {
      items.push({
        key: "resume",
        title: "No resume on file",
        detail: "Your resume is sent with every application. Employers respond far more often when one is attached.",
        action: (
          <button type="button" onClick={openUpload} className={buttonPrimary}>
            <Icon.upload className="h-4 w-4" />
            Upload resume
          </button>
        ),
      });
    }

    if (recommendState === "no-profile") {
      items.push({
        key: "profile",
        title: "Matching has not started",
        detail:
          "Matching reads your headline, skills and experience. Fill those in and we will score open roles against them.",
        action: (
          <Link href="/seeker/profile/edit" className={buttonSecondary}>
            <Icon.edit className="h-4 w-4" />
            Fill in your profile
          </Link>
        ),
      });
    }

    // Only worth raising once there is a file to read and a model to read it.
    if (resume && !resumeLoading && !resumeError && !signal && aiEnabled !== false) {
      items.push({
        key: "analyse",
        title: "Your resume has not been read yet",
        detail:
          "We can pull a headline, seniority and skills out of the file you uploaded. Everything it finds stays yours to edit.",
        action: (
          <Button
            variant="secondary"
            loading={analysing}
            loadingLabel="Reading your resume"
            icon={<Icon.spark className="h-4 w-4" />}
            onClick={() => void analyseResume()}
          >
            {analysing ? "Reading…" : "Read my resume"}
          </Button>
        ),
      });
    }

    return items;
    // `analyseResume` and `openUpload` are stable enough for this list; the
    // dependencies below are the ones that actually change what it contains.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, resumeLoading, resumeError, recommendState, signal, aiEnabled, analysing, openUpload]);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  // The same skeleton the route's `loading.tsx` shows, so the auth-rehydration
  // wait and the navigation wait look identical rather than one being a
  // centred spinner on an empty field (DESIGN-NOTES §1.4, §5.2).
  if (!ready) return <DashboardLoading />;

  if (!allowed) return null;

  const resumeFileName = resume ? resume.fileName ?? resume.url.split("/").pop() ?? "resume" : "";

  /** What the résumé panel is saying, in one sentence, for the announcer. */
  const resumeStatus = resumeLoading
    ? ""
    : resumeError
      ? "Your resume status could not be checked."
      : resume
        ? `Resume on file: ${resumeFileName}.`
        : "No resume uploaded yet.";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Seeker overview"
          title={user?.name ? `Welcome back, ${user.name}` : "Your dashboard"}
          description="What needs you, what is in flight, and what is worth a look next."
          action={
            <Link href="/jobs" className={buttonPrimary}>
              Browse jobs
              <Icon.arrowUpRight className="h-4 w-4" />
            </Link>
          }
        />

        {/* One of the page's two announcers (DESIGN-NOTES §2.2). Mounted from
            the first render, text-only, and it never wraps a control. */}
        <LiveStatus message={resumeStatus} />

        {/* ---------------------------------------------------------------- */}
        {/* 1 — Needs attention                                              */}
        {/* ---------------------------------------------------------------- */}
        {attentionItems.length > 0 && (
          <section aria-labelledby="attention-heading" className="mt-6 sm:mt-8">
            <SectionHeading
              id="attention-heading"
              eyebrow="Needs you"
              icon={<Icon.warning className="h-3.5 w-3.5" />}
              title="Before you apply to anything else"
              description="Short list, and it empties itself as you work through it."
            />
            <Card className="mt-3 divide-y divide-gray-200 dark:divide-gray-700">
              {attentionItems.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {item.title}
                    </h3>
                    <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
                      {item.detail}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 sm:justify-end">{item.action}</div>
                </div>
              ))}
            </Card>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 2 — In flight                                                    */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="pipeline-heading" className="mt-6 sm:mt-8">
          <h2 id="pipeline-heading" className="sr-only">
            Your application pipeline at a glance
          </h2>

          {/* Telemetry strip, derived entirely from the applications already in
              state — the bars are the per-status counts, normalised. */}
          <SignalPanel
            headingLevel={3}
            title="Application pipeline"
            live={stats.inFlight > 0}
            detail={
              applicationsLoading
                ? "Reading your application history…"
                : applicationsError
                  ? "Pipeline unavailable — reload below."
                  : stats.total === 0
                    ? "Nothing in flight yet. Apply to a role to start the pipeline."
                    : `${stats.inFlight} of ${stats.total} still open with an employer`
            }
            value={applicationsLoading ? "—" : formatCount(stats.total)}
            valueLabel="Applications"
            bars={pipelineBars}
          />

          {/* Three tiles, not four. "Total" is the readout in the strip above
              and "Pending" is a subset of "In flight" — both were printing the
              same numbers twice within 200px of each other, which is most of
              what made the top of this page read as a wall. */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatCard
              label="In flight"
              value={applicationsLoading ? "—" : formatCount(stats.inFlight)}
              icon={<Icon.clock className="h-5 w-5" />}
              tone="blue"
              hint="Still open with an employer"
            />
            <StatCard
              label="At interview"
              value={applicationsLoading ? "—" : formatCount(stats.interviews)}
              icon={<Icon.badge className="h-5 w-5" />}
              tone="purple"
              hint="Scheduled or in progress"
            />
            <StatCard
              label="Offers"
              value={applicationsLoading ? "—" : formatCount(stats.accepted)}
              icon={<Icon.checkCircle className="h-5 w-5" />}
              tone="green"
              hint="Accepted, on the table"
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 3 — Recommended                                                  */}
        {/* ---------------------------------------------------------------- */}
        {/* Absent when the deployment has no model, when the fetch failed, or
            when nothing cleared the score floor — there is no half-state. */}
        {recommendState !== "hidden" && recommendState !== "no-profile" && (
          <section aria-labelledby="matched-heading" className="mt-6 sm:mt-8">
            <SectionHeading
              id="matched-heading"
              eyebrow="Profile match"
              icon={<Icon.spark className="h-3.5 w-3.5" />}
              title="Matched to you"
              description="Open roles scored against your profile, strongest fit first. It orders your feed — it decides nothing."
              meta={
                recommendState === "ready" ? (
                  <Eyebrow>{recommendations.length} roles scored</Eyebrow>
                ) : undefined
              }
            />

            {/* `aria-busy` rather than a live region: this container holds every
                card, so `aria-live` had a screen reader re-read the whole grid
                on any change — and the cards contain links, which a live region
                must never wrap (DESIGN-NOTES §2.2). */}
            <div className="mt-3" aria-busy={recommendState === "loading"}>
              {recommendState === "loading" ? (
                <ul className="grid list-none gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                  {Array.from({ length: RECOMMENDED_PREVIEW }, (_, index) => (
                    <li key={index}>
                      <MatchCardSkeleton />
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <ul className="grid list-none gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                    {visibleMatches.map((job) => (
                      <li key={job.id} className="flex min-w-0">
                        <MatchedJobCard job={job} />
                      </li>
                    ))}
                  </ul>

                  {recommendations.length > RECOMMENDED_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllMatches((open) => !open)}
                      aria-expanded={showAllMatches}
                      className={`${buttonSecondary} mt-3 w-full sm:w-auto`}
                    >
                      {showAllMatches ? (
                        <>
                          <Icon.filter className="h-4 w-4" />
                          Show fewer matches
                        </>
                      ) : (
                        <>
                          <Icon.plus className="h-4 w-4" />
                          Show {recommendations.length - RECOMMENDED_PREVIEW} more matched{" "}
                          {recommendations.length - RECOMMENDED_PREVIEW === 1 ? "role" : "roles"}
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 4 — The application list, the reason for the page                */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="applications-heading" className="mt-6 sm:mt-8">
          <Card>
            <div className="flex flex-col gap-4 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <Eyebrow className="mb-1.5">Pipeline</Eyebrow>
                <h2
                  id="applications-heading"
                  className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl"
                >
                  My applications
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Every application you have sent, and exactly where each one stands.
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
                    const count = filter === "ALL" ? stats.total : stats.byStatus[filter];
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

            {/* `aria-busy` rather than a live region around the list itself:
                this container holds every application, so `aria-live` had a
                screen reader read the whole set out on any change. The count
                below is the part worth announcing. */}
            <div aria-busy={applicationsLoading}>
              <LiveStatus
                message={
                  applicationsLoading
                    ? ""
                    : applicationsError
                      ? "Your applications could not be loaded."
                      : `Showing ${visibleApplications.length} of ${stats.total} applications${
                          statusFilter === "ALL"
                            ? ""
                            : `, filtered to ${FILTER_LABELS[statusFilter]}`
                        }.`
                }
              />

              {applicationsLoading ? (
                // Rows the height of the real ones, not a centred spinner in a
                // box that is not the height of the list it replaces (§5.4).
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {Array.from({ length: 3 }, (_, index) => (
                    <li key={index}>
                      <ApplicationRowSkeleton />
                    </li>
                  ))}
                </ul>
              ) : applicationsError ? (
                <div className="p-4 sm:p-6">
                  <Alert variant="error">
                    <p>{applicationsError}</p>
                    <button
                      type="button"
                      onClick={() => void loadApplications()}
                      className={`${buttonSecondary} mt-3`}
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
                  icon={<Icon.filter className="h-7 w-7" />}
                  // `FILTER_LABELS` is total over `StatusFilter`; `STATUS_LABELS`
                  // is not, and the cast was hiding `undefined.toLowerCase()` for
                  // the "ALL" case. Unreachable today only because of the branch
                  // above it — one more filter state and it would be a crash.
                  title={`No ${FILTER_LABELS[statusFilter].toLowerCase()} applications`}
                  description="Every other status is still there — clear the filter to see the rest."
                  action={
                    <button
                      type="button"
                      onClick={() => setStatusFilter("ALL")}
                      className={buttonSecondary}
                    >
                      Show all {stats.total}
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
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 5 — The record: identity and documents                           */}
        {/* ---------------------------------------------------------------- */}
        {/* Two columns from `lg`, where these used to be two full-width cards
            stacked at the bottom of an already long page. Everything that is a
            *form* rather than a *record* is behind a disclosure, so the default
            state of this section is short. */}
        <section aria-labelledby="record-heading" className="mt-6 sm:mt-8">
          <SectionHeading
            id="record-heading"
            eyebrow="Record"
            title="Profile and documents"
            description="What employers see alongside every application you send."
            meta={
              <Link href="/seeker/profile/edit" className={buttonSecondary}>
                <Icon.edit className="h-4 w-4" />
                Edit profile
              </Link>
            }
          />

          <div className="mt-3 grid gap-3 sm:gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader
                headingLevel={3}
                eyebrow="Identity"
                title="Your details"
                description="Shown to an employer with every application."
              />
              <dl className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                <ReadOnlyField label="Full name" value={user?.name} />
                <ReadOnlyField label="Email address" value={user?.email} mono />
                <ReadOnlyField label="Account type" value="Job seeker" />
              </dl>
            </Card>

            {/* Resume — a telemetry panel: graph-paper field, mono file record. */}
            <Card grid>
              <span id="my-resume" className="block scroll-mt-24" aria-hidden="true" />

              <div ref={resumeSectionRef} className="scroll-mt-24">
                <CardHeader
                  headingLevel={3}
                  eyebrow="Attachment"
                  title="Resume"
                  description="One file on record, sent with every application."
                />

                <div className="p-4 sm:p-5">
                  {/* No `aria-live` here: this block contains a link and a
                      retry button, and a live region must not wrap controls.
                      The page announcer above carries the same sentence. */}
                  {resumeLoading ? (
                    <div className="space-y-2.5">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-9 w-28" />
                    </div>
                  ) : resumeError ? (
                    <Alert variant="error">
                      <p>{resumeError}</p>
                      <button
                        type="button"
                        onClick={() => void loadResume()}
                        className={`${buttonSecondary} mt-3`}
                      >
                        Try again
                      </button>
                    </Alert>
                  ) : resume ? (
                    // The record itself sits on a slightly opaque surface so the
                    // graph-paper rules stay visible around, but not through, it.
                    <div className="rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70 sm:p-4">
                      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
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
                        className={`${buttonSecondary} mt-3`}
                      >
                        <Icon.external className="h-4 w-4" />
                        View
                        <span className="sr-only"> resume (opens in a new tab)</span>
                      </a>
                    </div>
                  ) : (
                    <Alert variant="warning">
                      <p className="font-medium">No resume uploaded yet</p>
                      <p className="mt-0.5">
                        Employers are far more likely to respond when a resume is attached.
                      </p>
                    </Alert>
                  )}

                  {/* Layer two: the upload form. Collapsed by default because
                      the common case is "there is already a file on record and
                      I am not changing it today". */}
                  {!resumeLoading && (
                    <Disclosure
                      className="mt-4"
                      open={uploadOpen}
                      onToggle={setUploadOpen}
                      label={resume ? "Replace this resume" : "Upload a resume"}
                    >
                      <form onSubmit={handleResumeUpload} aria-busy={uploading} className="space-y-4">
                        <div>
                          {/* The constraint line stays a separate element rather
                              than moving into `<Label hint>`: `aria-describedby`
                              points at `#resume-hint`, and the hint slot renders
                              no id. */}
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
                            // A rejected file (wrong type, too large) put its
                            // reason in a banner the input never pointed at.
                            aria-invalid={Boolean(uploadError) || undefined}
                            aria-describedby={
                              uploadError ? "resume-upload-error resume-hint" : "resume-hint"
                            }
                            className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-white text-sm text-gray-600 file:mr-4 file:cursor-pointer file:rounded-l-md file:border-0 file:border-r file:border-gray-200 file:bg-gray-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-gray-900 hover:file:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:file:border-gray-700 dark:file:bg-gray-700 dark:file:text-white dark:hover:file:bg-gray-600"
                          />
                          <p
                            id="resume-hint"
                            className="mt-1.5 text-xs text-gray-600 dark:text-gray-400"
                          >
                            PDF, DOC or DOCX, up to 5 MB.
                            {resume && " Uploading a new file replaces the one on file."}
                          </p>
                          {resumeFile && (
                            <p className="mono mt-2 truncate text-xs text-gray-700 dark:text-gray-200">
                              Selected: {resumeFile.name} (
                              {Math.max(1, Math.round(resumeFile.size / 1024))} KB)
                            </p>
                          )}
                        </div>

                        {uploadError && (
                          <Alert variant="error">
                            <span id="resume-upload-error">{uploadError}</span>
                          </Alert>
                        )}

                        <Button
                          type="submit"
                          disabled={!resumeFile}
                          loading={uploading}
                          loadingLabel={resume ? "Replacing your resume" : "Uploading your resume"}
                          icon={<Icon.upload className="h-4 w-4" />}
                        >
                          {uploading
                            ? resume
                              ? "Replacing…"
                              : "Uploading…"
                            : resume
                              ? "Replace resume"
                              : "Upload resume"}
                        </Button>
                      </form>
                    </Disclosure>
                  )}

                  {/* Resume intelligence. Gated on a file being on record and on
                      the deployment actually having a model — `aiEnabled ===
                      false` is latched for the session, so the button never
                      comes back. */}
                  {resume && !resumeLoading && !resumeError && aiEnabled !== false && (
                    <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                      <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
                        <Icon.spark className="h-3.5 w-3.5" />
                        Resume intelligence
                      </Eyebrow>
                      <p className="max-w-prose text-sm text-gray-600 dark:text-gray-400">
                        We can read this file into a structured profile — headline, seniority,
                        skills — which is what job matching scores against. It is a draft of your
                        profile, never a verdict on it, and everything it finds stays yours to edit.
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-3"
                        loading={analysing}
                        loadingLabel="Reading your resume"
                        icon={<Icon.spark className="h-4 w-4" />}
                        onClick={() => void analyseResume()}
                      >
                        {analysing
                          ? "Reading your resume…"
                          : signal
                            ? "Analyse again"
                            : "Analyse resume"}
                      </Button>

                      {analyseNotice && (
                        <Alert variant="warning" className="mt-3">
                          {analyseNotice}
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Shown whether or not the model is still switched on: this is
                      the user's own profile data, not a live AI feature. Layer
                      two again — the fields are already on the profile page, so
                      this is a receipt rather than a destination. */}
                  {signal && (
                    <Disclosure
                      className="mt-4"
                      label="What we read from your resume"
                      meta={signal.updatedAt ? formatRelative(signal.updatedAt) : undefined}
                    >
                      <ExtractedProfile signal={signal} />
                    </Disclosure>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local presentational pieces                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One polite announcer per concern.
 *
 * Rendered empty on mount: a live region that appears at the same moment as its
 * first message often does not announce at all. It is text-only and never wraps
 * a control, which is the rule the two regions removed from this page broke
 * (DESIGN-NOTES §2.2).
 */
function LiveStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}

/**
 * The page-level section header: mono eyebrow, `h2`, one line of description,
 * optional right-hand meta.
 *
 * Declared once so the five sections below share a rhythm — before this, three
 * of them had hand-rolled variants that differed in margin, heading size and
 * whether the eyebrow carried an icon.
 */
function SectionHeading({
  id,
  eyebrow,
  icon,
  title,
  description,
  meta,
}: {
  id: string;
  eyebrow: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
          {icon}
          {eyebrow}
        </Eyebrow>
        <h2 id={id} className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">{description}</p>
        )}
      </div>
      {meta && <div className="flex-shrink-0">{meta}</div>}
    </div>
  );
}

/**
 * Show/hide for a secondary layer, following the APG disclosure pattern: a real
 * `<button>` carrying `aria-expanded` and `aria-controls`, and a region that is
 * genuinely removed from the DOM rather than visually hidden.
 *
 * Uncontrolled by default; pass `open`/`onToggle` where something outside the
 * component needs to open it (the "Upload resume" action in the attention rail).
 */
function Disclosure({
  label,
  meta,
  children,
  className = "",
  open: controlledOpen,
  onToggle,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
  open?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const regionId = useId();

  const toggle = () => {
    const next = !open;
    if (onToggle) onToggle(next);
    else setUncontrolledOpen(next);
  };

  return (
    <div className={`border-t border-gray-200 pt-4 dark:border-gray-700 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        className={`${buttonGhost} -ml-2.5 w-full justify-between`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon.arrowRight
            className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        </span>
        {meta && <Eyebrow as="span">{meta}</Eyebrow>}
      </button>
      {open && (
        <div id={regionId} className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Where an application reached, as four discrete segments plus a caption.
 *
 * Deliberately not a percentage: a stage is an ordinal position, and "50%"
 * against a hiring pipeline reads as a probability of an offer.
 */
function PipelineTrack({ status, title }: { status: ApplicationStatus | null; title: string }) {
  const rejected = status === "REJECTED";
  const at = status && !rejected ? PIPELINE_STAGES.indexOf(status) : -1;
  const caption = status ? STAGE_CAPTION[status] : "Unknown stage";

  return (
    <div className="w-full">
      <div className="flex gap-1" aria-hidden="true">
        {PIPELINE_STAGES.map((stage, index) => (
          <span
            key={stage}
            className={`h-1 flex-1 rounded-full ${
              rejected
                ? "bg-gray-200 dark:bg-gray-700"
                : index <= at
                  ? "bg-green-500"
                  : "bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>
      <Eyebrow className="mt-1.5">{caption}</Eyebrow>
      <span className="sr-only">
        {title}: {caption}
      </span>
    </div>
  );
}

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
  const fitAtApply = readNumber(application.matchScore);

  return (
    <li className="p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 sm:p-5">
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

          {/* One metadata line rather than a date line and a separate labelled
              readout eight rows further down. Both are facts about the day the
              application was sent, so they belong together. */}
          <p className="eyebrow mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Applied {formatRelative(application.createdAt)} · {formatDate(application.createdAt)}
            </span>
            {fitAtApply !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Fit at apply <Readout className="text-[11px]">{Math.round(fitAtApply)}%</Readout>
                </span>
              </>
            )}
          </p>

          {application.message && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
              {application.message}
            </p>
          )}
        </div>

        {/* A single right rail on desktop: state, then how far it travelled,
            then the two actions. Below `lg` it stacks under the detail. */}
        <div className="flex flex-col gap-3 lg:w-56 lg:flex-shrink-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={application.status} />
          </div>

          <PipelineTrack status={status} title={application.job.title} />

          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            {/* Every row repeats this pair, so each one names its role: read
                out of context, "Withdraw" alone says nothing about which. */}
            <Button
              variant="secondary"
              className="sm:flex-1 lg:w-full"
              loading={messaging}
              loadingLabel="Opening the conversation"
              icon={<Icon.chat className="h-4 w-4" />}
              onClick={onMessage}
            >
              Message
              <span className="sr-only"> about {application.job.title}</span>
            </Button>
            <Button
              variant="danger"
              className="sm:flex-1 lg:w-full"
              loading={withdrawing}
              loadingLabel="Withdrawing the application"
              icon={<Icon.trash className="h-4 w-4" />}
              onClick={onWithdraw}
            >
              Withdraw
              <span className="sr-only"> application for {application.job.title}</span>
            </Button>
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
          // Sentence case: `.eyebrow` already uppercases, so the shouted string
          // this used to pass was the only caption in the app typed that way.
          <MatchScore value={score} caption="Profile fit" className="flex-shrink-0" />
        )}
      </div>

      {/* The slot is reserved whether or not there is a score, so a grid with a
          mix of scored and unscored cards keeps level rows (§5.4). */}
      <div className="mt-3 min-h-[0.25rem]">
        {score !== null && (
          <Meter
            value={score}
            strongAt={STRONG_MATCH}
            label={`Profile fit for ${job.title}: ${score} out of 100`}
          />
        )}
      </div>

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
    <Card className="flex h-full w-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="w-full space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-8 w-16 flex-shrink-0" />
      </div>
      <Skeleton className="mt-3 h-1 w-full rounded-full" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-6 w-16 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-lg" />
      </div>
      <Skeleton className="mt-auto h-6 w-full pt-4" />
    </Card>
  );
}

/** Same footprint as `ApplicationRow`, so the list does not resize under you. */
function ApplicationRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:justify-between">
      <div className="min-w-0 flex-1 space-y-2.5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3.5 w-1/3" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-24 rounded-lg" />
          <Skeleton className="h-6 w-20 rounded-lg" />
        </div>
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-3 lg:w-56 lg:flex-shrink-0">
        <Skeleton className="h-6 w-28 rounded-md" />
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
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
    <div className="rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70 sm:p-4">
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
                <Icon.check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                {strength}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
    <div className="min-w-0 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <dt>
        <Eyebrow>{label}</Eyebrow>
      </dt>
      <dd
        className={`mt-1.5 break-words text-sm font-semibold text-gray-900 dark:text-white ${
          mono ? "mono font-medium" : ""
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
