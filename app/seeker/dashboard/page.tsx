"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { ResumeInsightsHero } from "@/app/components/ResumeInsights";
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
  Avatar,
  Button,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  Card,
  Chip,
  coarseFit,
  EmptyState,
  Eyebrow,
  formatCount,
  formatDate,
  formatRelative,
  Icon,
  IconTile,
  Label,
  MatchScore,
  Meter,
  PageHeading,
  Readout,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from "@/app/components/ui";
import { ApplicationRowSkeleton, MatchCardSkeleton } from "@/app/components/skeletons";

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
  /**
   * What this seeker told this employer when they applied, in the order asked.
   * Scoped server-side to `userId: session.id`, and deliberately WITHOUT the
   * question's `knockout`/`expected` fields — showing someone the answer key
   * afterwards would tell them which answer disqualified them.
   */
  answers?: ScreeningAnswer[];
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

/** One submitted screening answer, as the seeker's own record of it. */
interface ScreeningAnswer {
  id: string;
  value: string;
  question: { id: string; prompt: string };
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
/** `matching`: a resume is on file and is being read to build the matches. */
type RecommendState = "loading" | "matching" | "ready" | "no-profile" | "hidden";

/** One row of the "Needs attention" rail — see `attentionItems`. */
interface AttentionItem {
  key: string;
  /** The to-do's picture, shown in a tile beside it. */
  icon: React.ReactNode;
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

/**
 * The four live stages, in order. A rejection is a *closed file* rather than a
 * partial one, so it sits outside the track entirely.
 *
 * This replaced a `Meter` reading "Pipeline · Stage 2 / 4 · Shortlisted — 50%".
 * A percentage implies the application is halfway to an offer, which is not a
 * claim anybody can make; four discrete segments say exactly what is known —
 * which stage it reached — and nothing more. The shape follows the GOV.UK
 * "progress through a process" idea.
 */
const PIPELINE_STAGES: readonly ApplicationStatus[] = [
  "PENDING",
  "SHORTLISTED",
  "INTERVIEW",
  "ACCEPTED",
];

/** The badge beside the track already names the status, so the caption only
 *  says how far along it is. */
const STAGE_CAPTION: Record<ApplicationStatus, string> = {
  PENDING: "Step 1 of 4",
  SHORTLISTED: "Step 2 of 4",
  INTERVIEW: "Step 3 of 4",
  ACCEPTED: "Step 4 of 4",
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
  // Separate from `resumeLoading`, which goes true again on every refresh. The
  // first answer decides whether "Needs you" exists at all, and rendering the
  // page before it pushed everything below down by the height of that section.
  const [resumeChecked, setResumeChecked] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  /** The upload form is disclosed rather than always-on — see `Disclosure`. */
  const [uploadOpen, setUploadOpen] = useState(false);

  const [messagingId, setMessagingId] = useState<string | null>(null);

  /**
   * A withdrawn row leaves the list on the confirm, not on the response.
   *
   * The action is already behind a `window.confirm`, and the response carries
   * nothing the page does not have — so the round trip was pure waiting, and
   * every count and filter on the page waited with it. Layered rather than spliced: `loadApplications` can
   * land mid-flight, and the removal re-applies to whatever the newer list is
   * instead of being lost in it.
   */
  const [optimisticApplications, withdrawOptimistically] = useOptimistic(
    applications,
    (current: Application[], withdrawnId: string) =>
      current.filter((application) => application.id !== withdrawnId)
  );

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
  /** Bumped to reload the resume insights hero, or to reload and run the check. */
  const [insightsRefresh, setInsightsRefresh] = useState(0);
  const [insightsCheck, setInsightsCheck] = useState(0);

  const loadApplications = useCallback(async () => {
    setApplicationsLoading(true);
    setApplicationsError("");
    try {
      const data = await apiFetch<Application[]>("/api/applications");
      setApplications(Array.isArray(data) ? data : []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn’t load your applications";
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
          : "Couldn’t check whether you have a resume on file"
      );
    } finally {
      setResumeLoading(false);
      setResumeChecked(true);
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

  /**
   * Builds the matches from the resume on file, without a click.
   *
   * Recommendations are scored against the profile, and a seeker who has only
   * uploaded a resume has no profile yet — so the "Jobs for you" section never
   * appeared for them. This reads the resume in fill mode (only empty profile
   * fields are written, nothing the seeker typed is replaced) and then loads
   * the matches. Quiet on failure: the "Get your job matches" prompt and the
   * Analyze button are still there to try by hand.
   */
  const autoMatchTried = useRef(false);
  const matchFromResume = useCallback(async (options: { check?: boolean } = {}) => {
    autoMatchTried.current = true;
    setRecommendState("matching");
    try {
      const response = await fetch("/api/ai/resume?mode=fill", {
        method: "POST",
        headers: authHeaders(),
      });
      if (response.status === 503) {
        setAiEnabled(false);
        setRecommendState("hidden");
        return;
      }
      if (!response.ok) {
        console.error("Automatic resume read failed:", response.status);
        setRecommendState("no-profile");
        return;
      }
      const extracted = readAnalysis(await response.json().catch(() => null));
      if (extracted) setSignal(extracted);
      // The insights are counted over the jobs nearest the profile that was
      // just written, so they reload now; after a new upload the resume check
      // runs as well.
      if (options.check) setInsightsCheck((key) => key + 1);
      else setInsightsRefresh((key) => key + 1);
      await loadRecommended();
    } catch (error) {
      console.error("Automatic resume read failed:", error);
      setRecommendState("no-profile");
    }
  }, [loadRecommended]);

  // A resume on file but nothing to match on: read it once, automatically.
  useEffect(() => {
    if (recommendState === "no-profile" && resume && !autoMatchTried.current) {
      void matchFromResume({ check: true });
    }
  }, [recommendState, resume, matchFromResume]);

  // "Replace" on the resume insights page links here with `#my-resume`. The
  // anchor only exists once the page has rendered, so the browser's own jump
  // misses it: open the upload form and scroll to it once the resume is known.
  useEffect(() => {
    if (!resumeChecked || window.location.hash !== "#my-resume") return;
    setUploadOpen(true);
    requestAnimationFrame(() =>
      resumeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, [resumeChecked]);

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
        console.error("Couldn’t load your extracted profile:", error);
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
    // the summary figures and the filter chips.
    const byStatus: Record<ApplicationStatus, number> = {
      PENDING: 0,
      SHORTLISTED: 0,
      INTERVIEW: 0,
      REJECTED: 0,
      ACCEPTED: 0,
    };
    for (const application of optimisticApplications) {
      if (isApplicationStatus(application.status)) byStatus[application.status] += 1;
    }
    return {
      total: optimisticApplications.length,
      byStatus,
      pending: byStatus.PENDING,
      interviews: byStatus.INTERVIEW,
      accepted: byStatus.ACCEPTED,
      /** Still open with the employer: not yet accepted or rejected. */
      inFlight: byStatus.PENDING + byStatus.SHORTLISTED + byStatus.INTERVIEW,
    };
  }, [optimisticApplications]);

  // Everything downstream reads the optimistic list, so a withdrawal takes the
  // summary figures, the chip counts and the live "Showing N of M" line
  // with it in the same frame — and brings them all back together if it fails.
  const visibleApplications = useMemo(
    () =>
      statusFilter === "ALL"
        ? optimisticApplications
        : optimisticApplications.filter((application) => application.status === statusFilter),
    [optimisticApplications, statusFilter]
  );

  const visibleMatches = showAllMatches
    ? recommendations
    : recommendations.slice(0, RECOMMENDED_PREVIEW);

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Straight to the file picker, from the hero or the Replace button. */
  const pickResumeFile = useCallback(() => {
    setUploadOpen(true);
    resumeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Deferred a frame: the input only exists once the form has opened.
    requestAnimationFrame(() => fileInputRef.current?.click());
  }, []);

  const onInsightsReady = useCallback(() => {
    toast.success("Your resume insights are ready");
  }, [toast]);

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
        error instanceof Error ? error.message : "Couldn’t open a conversation";
      console.error("Failed to start conversation:", error);
      toast.error(message);
    } finally {
      setMessagingId(null);
    }
  };

  const withdrawApplication = (application: Application) => {
    const confirmed = window.confirm(
      `Withdraw your application for "${application.job.title}"? This cannot be undone.`
    );
    if (!confirmed) return;

    /*
     * Both halves belong to the one transition. `useOptimistic` holds a value
     * only while a transition that set it is still running, so an update made
     * outside one is thrown away on the next render — and committing the real
     * removal outside one would release the optimistic layer a frame early,
     * flashing the withdrawn row back into the list before the real list
     * caught up.
     *
     * There is deliberately no rollback branch: ending the transition drops the
     * optimistic layer, which is what puts the row back. The `catch` only has
     * to explain it.
     */
    startTransition(async () => {
      withdrawOptimistically(application.id);

      try {
        await apiFetch("/api/applications", {
          method: "DELETE",
          body: JSON.stringify({ id: application.id }),
        });
        setApplications((current) => current.filter((item) => item.id !== application.id));
        toast.success("Application withdrawn");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Couldn’t withdraw the application";
        console.error("Failed to withdraw application:", error);
        // The row reappears on its own. Without this the reader watches it come
        // back with no account of why, which is worse than having waited — and the error toast is `aria-live="assertive"`,
        // so a screen-reader user is told rather than left to re-read the list.
        toast.error(message);
      }
    });
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
      // A new resume means new matches: read it and rescore, in the background.
      if (aiEnabled !== false) void matchFromResume({ check: true });
      else setInsightsRefresh((key) => key + 1);
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
      setInsightsRefresh((key) => key + 1);
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

    // No "upload a resume" item: the resume insights hero at the top of the
    // page already leads with that, and two upload buttons stacked one above
    // the other read as two different things to do.

    if (recommendState === "no-profile") {
      items.push({
        key: "profile",
        icon: <Icon.idCard className="h-5 w-5" />,
        title: "Get your job matches",
        detail:
          "Add your headline, skills and experience, and we’ll score open jobs for you.",
        action: (
          <Link href="/seeker/profile/edit" className={buttonSecondary}>
            <Icon.edit className="h-4 w-4" />
            Complete your profile
          </Link>
        ),
      });
    }

    // Only worth raising once there is a file to read and a model to read it.
    if (resume && !resumeLoading && !resumeError && !signal && aiEnabled !== false) {
      items.push({
        key: "analyse",
        icon: <Icon.scan className="h-5 w-5" />,
        title: "Fill your profile from your resume",
        detail:
          "We’ll pull your headline, seniority and skills from your resume. You can edit everything.",
        action: (
          <Button
            variant="secondary"
            loading={analysing}
            loadingLabel="Reading your resume"
            icon={<Icon.spark className="h-4 w-4" />}
            onClick={() => void analyseResume()}
          >
            {analysing ? "Reading…" : "Fill my profile"}
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
  // centred spinner on an empty field.
  if (!ready) return <DashboardLoading />;

  if (!allowed) return null;

  if (!resumeChecked) return <DashboardLoading />;

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
    <div className="min-h-screen">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Dashboard"
          title={user?.name ? `Welcome back, ${user.name}` : "Your dashboard"}
          description="Your applications, matches and next steps."
          action={
            <Link href="/jobs" className={buttonPrimary}>
              Browse jobs
              <Icon.arrowUpRight className="h-4 w-4" />
            </Link>
          }
        />

        {/* One of the page's two announcers. Mounted from
            the first render, text-only, and it never wraps a control. */}
        <LiveStatus message={resumeStatus} />

        {/* The headline feature for a seeker: what their resume is worth
            against the jobs they would apply to. */}
        <ResumeInsightsHero
          resumeId={resume?.id ?? null}
          reading={recommendState === "matching"}
          refreshKey={insightsRefresh}
          checkKey={insightsCheck}
          onUpload={pickResumeFile}
          onChecked={onInsightsReady}
        />

        {/* ---------------------------------------------------------------- */}
        {/* 1 — Needs attention                                              */}
        {/* ---------------------------------------------------------------- */}
        {attentionItems.length > 0 && (
          <section aria-labelledby="attention-heading" className="mt-6 sm:mt-8">
            <SectionHeading
              id="attention-heading"
              eyebrow="To do"
              icon={<Icon.warning className="h-3.5 w-3.5" />}
              title="Finish setting up"
              description="A few quick steps for better matches."
            />
            <Card className="mt-3 divide-y divide-gray-200 dark:divide-gray-700">
              {attentionItems.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <IconTile icon={item.icon} tone="warn" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {item.title}
                      </h3>
                      <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 sm:justify-end">{item.action}</div>
                </div>
              ))}
            </Card>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 3 — Recommended                                                  */}
        {/* ---------------------------------------------------------------- */}
        {/* Absent when the deployment has no model, when the fetch failed, or
            when nothing cleared the score floor — there is no half-state. */}
        {recommendState !== "hidden" && recommendState !== "no-profile" && (
          <section aria-labelledby="matched-heading" className="mt-6 sm:mt-8">
            <SectionHeading
              id="matched-heading"
              eyebrow="Recommended"
              icon={<Icon.spark className="h-3.5 w-3.5" />}
              title="Jobs for you"
              description={
                recommendState === "matching"
                  ? "Reading your resume to find jobs that match it…"
                  : "Ranked by how well they fit your resume and profile."
              }
              meta={
                recommendState === "ready" ? (
                  <Eyebrow>{recommendations.length} jobs scored</Eyebrow>
                ) : undefined
              }
            />

            {/* `aria-busy` rather than a live region: this container holds every
                card, so `aria-live` had a screen reader re-read the whole grid
                on any change — and the cards contain links, which a live region
                must never wrap. */}
            <div
              className="mt-3"
              aria-busy={recommendState === "loading" || recommendState === "matching"}
            >
              {recommendState === "loading" || recommendState === "matching" ? (
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
                    {/* `rank` is the position in the full scored set, not in
                        the visible slice, so "3rd closest of 24" stays true when
                        the preview is collapsed. */}
                    {visibleMatches.map((job, index) => (
                      <li key={job.id} className="flex min-w-0">
                        <MatchedJobCard
                          job={job}
                          rank={index + 1}
                          rankOf={recommendations.length}
                        />
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
            {/* The counts live here, beside the list they summarise. They used
                to be a telemetry strip plus three stat tiles above this card,
                which printed the same totals as the filter chips below — three
                readouts of one number, and on a phone 400px of tiles before the
                first job. */}
            <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <Eyebrow className="mb-1.5">Applications</Eyebrow>
                  <h2
                    id="applications-heading"
                    className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl"
                  >
                    Your applications
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {stats.total > 0
                      ? `${stats.inFlight} of ${stats.total} still open with an employer.`
                      : "Track where each application stands."}
                  </p>
                </div>

                {(applicationsLoading || stats.total > 0) && (
                  <dl className="grid grid-cols-3 divide-x divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700 lg:w-[22rem] lg:flex-shrink-0">
                    <SummaryFigure
                      label="Active"
                      icon={<Icon.briefcase className="h-4 w-4" />}
                      tone="accent"
                      value={applicationsLoading ? "—" : formatCount(stats.inFlight)}
                    />
                    <SummaryFigure
                      label="Interviews"
                      icon={<Icon.chat className="h-4 w-4" />}
                      tone="accent"
                      value={applicationsLoading ? "—" : formatCount(stats.interviews)}
                    />
                    {/* Status green only once there is an offer to celebrate. */}
                    <SummaryFigure
                      label="Offers"
                      icon={<Icon.trophy className="h-4 w-4" />}
                      tone={stats.accepted > 0 ? "good" : "neutral"}
                      value={applicationsLoading ? "—" : formatCount(stats.accepted)}
                    />
                  </dl>
                )}
              </div>

              {/* A segmented control rather than a select: the counts are visible
                  without opening anything, and it wraps instead of scrolling.
                  Absent with nothing to filter — six zeros are not a control. */}
              {(applicationsLoading || stats.total > 0) && (
                <div
                  role="group"
                  aria-label="Filter applications by status"
                  className="segmented mt-4 w-fit max-w-full"
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
                        className="segment interactive hit-24"
                      >
                        {FILTER_LABELS[filter]}
                        <span className="segment-count">{applicationsLoading ? "—" : count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
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
              ) : optimisticApplications.length === 0 ? (
                // One line, not a 400px empty state with a second Browse jobs
                // button: the page header already carries that action, and
                // for a new seeker this card should not outweigh the hero.
                <div className="flex items-center gap-3 px-4 py-5 sm:px-6">
                  <IconTile icon={<Icon.briefcase className="h-5 w-5" />} />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-900 dark:text-white">No applications yet.</span>{" "}
                    When you apply to a job, you can follow it here.{" "}
                    <Link href="/jobs" className="link">
                      Find jobs
                    </Link>
                  </p>
                </div>
              ) : visibleApplications.length === 0 ? (
                <EmptyState
                  icon={<Icon.filter className="h-7 w-7" />}
                  // `FILTER_LABELS` is total over `StatusFilter`; `STATUS_LABELS`
                  // is not, and the cast was hiding `undefined.toLowerCase()` for
                  // the "ALL" case. Unreachable today only because of the branch
                  // above it — one more filter state and it would be a crash.
                  title={`No ${FILTER_LABELS[statusFilter].toLowerCase()} applications`}
                  description="Clear the filter to see all applications."
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
                      onMessage={() => void startConversation(application)}
                      onWithdraw={() => withdrawApplication(application)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 5 — The record: what employers see, and the file behind it       */}
        {/* ---------------------------------------------------------------- */}
        {/* One card in two panes rather than two cards side by side. As two
            cards, a three-field "Your details" sat beside a resume card three
            times its height, leaving a hole under it; and the resume card
            stacked four separate blocks (file, a "Replace" disclosure that
            the Replace button already opened, an import panel, and a second
            disclosure with the imported fields). Now the left pane is the
            profile itself — who you are and what we read from your resume —
            and the right pane is the file, with every action on one row. */}
        <section aria-labelledby="record-heading" className="mt-6 sm:mt-8">
          <SectionHeading
            id="record-heading"
            eyebrow="Profile"
            title="Profile and resume"
            description="What employers see when you apply."
          />

          <Card className="mt-3 grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            {/* Left pane — the profile */}
            <div className="min-w-0 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user?.name ?? ""} size="lg" />
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                      {user?.name || "Your name"}
                    </h3>
                    <p className="mono truncate text-sm text-gray-600 dark:text-gray-400">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <Link href="/seeker/profile/edit" className={`${buttonSecondary} btn-sm`}>
                  <Icon.edit className="h-4 w-4" />
                  Edit profile
                </Link>
              </div>

              {signal ? (
                <div className="mt-5 border-t border-gray-200 pt-5 dark:border-gray-700">
                  {signal.headline && (
                    <p className="text-base font-semibold text-gray-900 dark:text-white">
                      {signal.headline}
                    </p>
                  )}

                  {(signal.seniority || signal.yearsOfExp !== null) && (
                    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
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
                          <Chip key={skill} accent>{skill}</Chip>
                        ))}
                      </div>
                    </div>
                  )}

                  {(signal.summary || signal.strengths.length > 0) && (
                    <Disclosure className="mt-4" label="Summary and strengths">
                      <ExtractedDetail signal={signal} />
                    </Disclosure>
                  )}

                  {/* Labelled as read from the resume and paired with the
                      editor: the model is a fast first draft of these fields,
                      never a finding about the person. */}
                  <p className="mt-4 flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Icon.spark className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      Filled in from your resume
                      {signal.updatedAt ? ` ${formatRelative(signal.updatedAt).toLowerCase()}` : ""}.
                      Edit your profile to correct anything.
                    </span>
                  </p>
                </div>
              ) : (
                <div className="mt-5 border-t border-gray-200 pt-5 dark:border-gray-700">
                  <p className="max-w-prose text-sm text-gray-600 dark:text-gray-400">
                    Add a headline and your skills so employers can see what you do at a glance.
                  </p>
                </div>
              )}
            </div>

            {/* Right pane — the resume file. Flat accent tint rather than the
                graph-paper field: this pane carries prose, and a pattern behind
                body text costs contrast exactly where letterforms are thinnest. */}
            <div
              ref={resumeSectionRef}
              className="panel-signal min-w-0 scroll-mt-24 border-t border-gray-200 p-4 dark:border-gray-700 sm:p-6 lg:border-l lg:border-t-0"
            >
              <span id="my-resume" className="block scroll-mt-24" aria-hidden="true" />
              <Eyebrow className="mb-1">Sent with every application</Eyebrow>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Resume</h3>

              {/* No `aria-live` here: this block contains a link and a retry
                  button, and a live region must not wrap controls. The page
                  announcer above carries the same sentence. */}
              <div className="mt-3">
                {resumeLoading ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-40" />
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
                  <>
                    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70">
                      <IconTile icon={<Icon.document className="h-5 w-5" />} />
                      <div className="min-w-0">
                        <p className="mono truncate text-sm font-medium text-gray-900 dark:text-white">
                          {resumeFileName}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                          Uploaded {formatDate(resume.createdAt)}
                        </p>
                      </div>
                    </div>

                    {/* Every resume action on one row. Replace goes straight to
                        the file picker; there is no separate "Replace this
                        resume" disclosure any more, since it did the same. */}
                    {!uploadOpen && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={`/api/resumes/${resume.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${buttonSecondary} btn-sm`}
                        >
                          <Icon.external className="h-4 w-4" />
                          View
                          <span className="sr-only"> resume (opens in a new tab)</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadOpen(true);
                            // Straight to the file picker. Deferred a frame: the
                            // input only exists once the form has opened.
                            requestAnimationFrame(() => fileInputRef.current?.click());
                          }}
                          className={`${buttonSecondary} btn-sm`}
                        >
                          <Icon.upload className="h-4 w-4" />
                          Replace
                          <span className="sr-only"> resume</span>
                        </button>
                      </div>
                    )}
                  </>
                ) : null}

                {/* The upload form: open when there is no file yet, or after
                    Replace (or the hero's Upload button) opened it. */}
                {!resumeLoading && !resumeError && (uploadOpen || !resume) && (
                  <form
                    onSubmit={handleResumeUpload}
                    aria-busy={uploading}
                    className={`space-y-3 ${resume ? "mt-3 rounded-lg border border-gray-200 bg-white/75 p-3 dark:border-gray-700 dark:bg-gray-800/70" : ""}`}
                  >
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
                        className="field-file block"
                      />
                      <p
                        id="resume-hint"
                        className="mt-1.5 text-xs text-gray-600 dark:text-gray-400"
                      >
                        PDF, DOC or DOCX, up to 5 MB.
                        {resume && " The new file replaces the one on file."}
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

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        size="sm"
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
                      {resume && !uploading && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUploadOpen(false);
                            setResumeFile(null);
                            setUploadError("");
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              {/* Re-reading the file into the profile. A quiet footer action
                  rather than its own titled panel: the first read happens on
                  its own after every upload, so this is the "do it again"
                  case. Gated on a model being available — `aiEnabled ===
                  false` is latched for the session, so it never comes back. */}
              {resume && !resumeLoading && !resumeError && aiEnabled !== false && (
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Your headline, seniority and skills are filled in from this file.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 mt-1"
                    loading={analysing}
                    loadingLabel="Reading your resume"
                    icon={<Icon.refresh className="h-4 w-4" />}
                    onClick={() => void analyseResume()}
                  >
                    {analysing
                      ? "Reading your resume…"
                      : signal
                        ? "Read my resume again"
                        : "Fill my profile from it"}
                  </Button>

                  {analyseNotice && (
                    <Alert variant="warning" className="mt-3">
                      {analyseNotice}
                    </Alert>
                  )}
                </div>
              )}
            </div>
          </Card>
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
 * a control, which is the rule the two regions removed from this page broke.
 */
function LiveStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}

/** One count in the applications summary: a big number over a short label. */
function SummaryFigure({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: StatusTone;
}) {
  return (
    <div className="flex min-w-0 flex-col-reverse px-3 py-2.5 sm:px-4">
      <dt className="mt-1 truncate text-xs text-gray-600 dark:text-gray-400">{label}</dt>
      <dd className="flex items-center justify-between gap-2">
        <Readout className="block font-sans text-2xl font-semibold leading-none text-gray-900 dark:text-white">
          {value}
        </Readout>
        <IconTile icon={icon} tone={tone} size="sm" />
      </dd>
    </div>
  );
}

/**
 * The page-level section header: a quiet eyebrow, `h2`, one line of description,
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
        {/*
         * Label left, chevron right — the accordion convention, rather than the
         * tree convention this used to follow. The row is already full width
         * and `justify-between`, so a glyph pinned to the left edge left the
         * control reading as a bullet with a stray arrow beside it rather than
         * as something to press. `chevronDown` rotating to point up is also the
         * honest direction: the panel opens downward, under the header.
         *
         * `arrowRight` was the wrong glyph on top of the wrong placement — it
         * is the kit's *navigation* arrow, used on links that take you
         * somewhere else, and this goes nowhere.
         */}
        <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        <span className="flex flex-shrink-0 items-center gap-2">
          {meta && <Eyebrow as="span">{meta}</Eyebrow>}
          <Icon.chevronDown
            className={`h-4 w-4 flex-shrink-0 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
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
                  ? status === "ACCEPTED"
                    ? "bg-success-500 dark:bg-success-400"
                    : "bg-green-500"
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
  onMessage,
  onWithdraw,
}: {
  application: Application;
  messaging: boolean;
  onMessage: () => void;
  onWithdraw: () => void;
}) {
  const status = isApplicationStatus(application.status) ? application.status : null;
  const fitAtApply = readNumber(application.matchScore);

  return (
    <li className="interactive p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
            <Link
              href={`/jobs/${application.job.id}`}
              className="rounded transition-colors hover:text-blue-700 dark:hover:text-blue-400"
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
                  {/* `/100`, not `%`. Beside the word "fit" a percentage reads as a
                      probability of being hired, and one displayed point is
                      0.002 of cosine — roughly 10x the precision the signal
                      carries. Rounded to 5 like every
                      other list surface. */}
                  Fit at apply{" "}
                  <Readout className="text-[11px]">{coarseFit(fitAtApply)}</Readout>
                  <span aria-hidden="true">/100</span>
                  <span className="sr-only"> out of 100</span>
                </span>
              </>
            )}
          </p>

          {application.message && (
            <p className="panel-sunken mt-3 max-w-2xl whitespace-pre-wrap p-3 text-sm text-gray-700 dark:text-gray-300">
              {application.message}
            </p>
          )}

          {/*
            * The seeker's own screening answers. Collapsed, because this is a
            * record to check rather than something to read on every visit — and
            * because a list of applications each unrolling four answers stops
            * being a list.
            *
            * Only what they wrote. The question's expected answer and whether it
            * was a knockout are not in the payload and must not be added: this
            * is the candidate's copy of what they submitted, not a mark scheme.
            */}
          {application.answers && application.answers.length > 0 && (
            <details className="mt-3">
              <summary className="disclosure-summary eyebrow hit-24">
                Your answers ({application.answers.length})
              </summary>
              <dl className="panel-sunken mt-2 space-y-3 p-3">
                {application.answers.map((answer) => (
                  <div key={answer.id}>
                    <Eyebrow as="dt">{answer.question.prompt}</Eyebrow>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                      {answer.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>

        {/* A single right rail on desktop: state and how far it travelled on
            one line, then the actions. Below `lg` it stacks under the detail.
            Withdraw is a quiet text button rather than a red block the same
            size as Message: it is the rare, final action, and a filled danger
            button on every row made the list read as a column of warnings. */}
        <div className="flex flex-col gap-3 lg:w-60 lg:flex-shrink-0">
          <div className="flex items-start gap-3">
            <StatusBadge status={application.status} />
            <div className="min-w-0 flex-1 pt-1.5">
              <PipelineTrack status={status} title={application.job.title} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Every row repeats this pair, so each one names its role: read
                out of context, "Withdraw" alone says nothing about which. */}
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 lg:flex-none"
              loading={messaging}
              loadingLabel="Opening the conversation"
              icon={<Icon.chat className="h-4 w-4" />}
              onClick={onMessage}
            >
              Message
              <span className="sr-only"> about {application.job.title}</span>
            </Button>
            {/* No `loading` state to pass: the row it sits in is gone by the
                time a response could arrive, so a spinner here would only ever
                be seen on the way out. The confirm dialog is the deliberation;
                the disappearance is the confirmation. */}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
function MatchedJobCard({
  job,
  rank,
  rankOf,
}: {
  job: RecommendedJob;
  /**
   * Position in the scored set. The score is monotone in cosine, so *rank
   * order* is meaningful even where the magnitude is not — which makes the
   * ordinal the more defensible framing on a list the score exists to sort,
   * and the honest description of what the feature does.
   * The section heading already says "strongest fit first"; this puts the same
   * fact on the row, where the comparison being invited is between roles rather
   * than against 100.
   */
  rank?: number;
  rankOf?: number;
}) {
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
              className="rounded transition-colors hover:text-blue-700 dark:hover:text-blue-400"
            >
              {job.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400">
            {job.company?.name ?? "—"}
          </p>
        </div>
        {score !== null && (
          // Sentence case throughout now — the eyebrow stopped uppercasing, so
          // a caption typed in caps would be the only shout left on the page.
          <MatchScore
            value={score}
            caption="Profile fit"
            rank={rank}
            rankOf={rankOf}
            className="flex-shrink-0"
          />
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
              <Chip key={skill} tone="good" size="sm">
                {skill}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <Eyebrow>{formatCount(applicants)} applied</Eyebrow>
        <Link href={`/jobs/${job.id}`} className={buttonGhost}>
          View job
          <Icon.arrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
  );
}

/**
 * The longer half of what the model read out of the résumé: the summary, and
 * the strengths (present straight after a read, never stored). Behind a
 * disclosure under the profile — the fields are already on the edit page, so
 * this is a receipt rather than a destination.
 */
function ExtractedDetail({ signal }: { signal: ProfileSignal }) {
  return (
    <div className="space-y-4">
      {signal.summary && (
        <div>
          <Eyebrow className="mb-1.5">Summary</Eyebrow>
          <p className="max-w-prose whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {signal.summary}
          </p>
        </div>
      )}

      {signal.strengths.length > 0 && (
        <div>
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
