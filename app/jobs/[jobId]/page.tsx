"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import {
  Alert,
  Card,
  CardHeader,
  Chip,
  Eyebrow,
  Icon,
  JobStateBadge,
  Label,
  Meter,
  MeterRow,
  Readout,
  Skeleton,
  SkeletonText,
  Spinner,
  StatusBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  formatDate,
  inputClass,
} from "@/app/components/ui";
import { useToast } from "@/app/components/Toast";
import { apiFetch } from "@/lib/clientAuth";

/**
 * Both caps mirror `POST /api/applications`, which is the authority: it length-
 * caps every value it stores through `lib/validation`. Mirrored here so the box
 * stops accepting characters the API would silently drop — the form promising
 * more than the API keeps is a bug this codebase has shipped before.
 */
const MESSAGE_LIMIT = 2000;
const ANSWER_LIMIT = 1000;

/** The four answer types a posting can ask for; mirrors the `QuestionKind` enum. */
type QuestionKind = "TEXT" | "BOOLEAN" | "SINGLE_CHOICE" | "NUMBER";

/** Stored as these two literals, so the employer's knockout check can compare. */
const BOOLEAN_ANSWERS = ["Yes", "No"] as const;

/**
 * One row of `GET /api/jobs/:jobId/questions`.
 *
 * The public projection deliberately carries no `knockout` or `expected`: the
 * route strips the answer key for anyone who does not own the posting, and a
 * published expected answer is a hint rather than a screen. Nothing here should
 * ever start expecting those fields.
 */
interface ScreeningQuestion {
  id: string;
  prompt: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
  position: number;
}

/**
 * Mirror of `MatchBreakdown` in `lib/ai/matching.ts`.
 *
 * A bare cosine value is accurate but not explainable, so the headline score is
 * a weighted blend of four facets and every facet comes back with it. Declared
 * locally rather than imported: that module reaches for Prisma and must never
 * end up in a client bundle.
 */
interface MatchBreakdown {
  /** 0-100 composite, the headline figure. */
  score: number;
  facets: {
    semantic: number;
    skills: number;
    location: number;
    seniority: number;
  };
  /** Skills present on both sides - the evidence behind the score. */
  sharedSkills: string[];
  /** Skills the posting names that the profile does not evidence. */
  missingSkills: string[];
}

/**
 * `POST /api/ai/explain` — one grounded sentence about the caller's own match.
 *
 * `score` is the score the sentence was written about, and is returned so the
 * page can refuse to print prose about one number beside a different one; see
 * `MatchRationale`.
 */
interface MatchExplanation {
  text: string;
  score: number;
}

interface JobApplication {
  id: string;
  status: string;
  createdAt: string;
}

/** `GET /api/jobs/:jobId`. The last four fields only appear for a signed-in caller. */
interface JobDetail {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  companyId: string;
  company?: { id: string; name: string; profile?: string | null };
  createdAt: string;
  isActive: boolean;
  /** Skill tags on the posting itself; public, and empty until it is indexed. */
  skills?: string[];
  _count?: { applications: number };
  hasApplied?: boolean;
  application?: JobApplication | null;
  isOwner?: boolean;
  /** Present only for a seeker whose profile and this job both have vectors. */
  match?: MatchBreakdown | null;
}

/**
 * One row of `GET /api/jobs/:jobId/similar`, which answers in the feed's shape
 * so the same fields render either list. `similarity` is a cosine between two
 * postings, not a fit score, and is used for ordering only — see `SimilarRoles`.
 */
interface SimilarJob {
  id: string;
  title: string;
  location?: string | null;
  type?: string | null;
  salary?: string | null;
  company?: { id?: string; name: string; profile?: string | null };
  createdAt: string;
  similarity?: number;
}

/** Three neighbours fills the row exactly at every breakpoint. */
const SIMILAR_LIMIT = 3;

export default function JobDetailsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = React.use(params);
  const router = useRouter();
  const toast = useToast();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Two separate errors. They used to share one `error` string, so a failed
  // apply replaced the whole page with an error card and the job vanished.
  const [loadError, setLoadError] = useState("");
  const [applyError, setApplyError] = useState("");

  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState<JobApplication | null>(null);

  /* -------------------------- screening questions ------------------------- */

  const [questions, setQuestions] = useState<ScreeningQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  // Separate from `loadError`: the posting still reads perfectly without its
  // questions, so a failure here must not replace the page with an error card.
  const [questionsFailed, setQuestionsFailed] = useState(false);
  /** Keyed by question id. A missing key and an empty string both mean unanswered. */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  /**
   * The focusable control for each question, so a failed submit lands the
   * caret on the first thing that needs fixing rather than leaving the reader
   * to hunt for the red text — the pattern the auth forms already use, held in
   * a map because the field list is only known at runtime.
   */
  const answerFields = useRef<Record<string, HTMLElement | null>>({});

  // This page is public, so the first client render must match the signed-out
  // markup the server produced; Redux only rehydrates in an effect.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fetchJob = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await apiFetch<JobDetail>(`/api/jobs/${jobId}`);
      setJob(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load this job");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Refetched when the signed-in user changes, because `hasApplied`, `application`,
  // `isOwner` and `match` are all derived from the caller's session.
  useEffect(() => {
    void fetchJob();
  }, [fetchJob, user?.id]);

  /**
   * The screening set, from the public half of `GET /api/jobs/:jobId/questions`.
   *
   * Its own request rather than a field on the job: the endpoint is public and
   * returns the same rows to everyone who is not the owner, so it neither needs
   * the session nor has to be refetched when one appears. The employer authored
   * these expecting the applicant to answer them — until now nothing ever read
   * them back, and a `required` question was invisible to the person it was
   * written for.
   */
  const fetchQuestions = useCallback(async () => {
    try {
      setQuestionsLoading(true);
      setQuestionsFailed(false);
      const data = await apiFetch<{ questions?: ScreeningQuestion[] }>(
        `/api/jobs/${jobId}/questions`
      );
      const list = Array.isArray(data?.questions) ? data.questions : [];
      // The route already orders by position; sorting again is free and keeps
      // the numbering printed beside each prompt honest regardless.
      setQuestions([...list].sort((a, b) => a.position - b.position));
    } catch (err) {
      console.error("Failed to load screening questions:", err);
      setQuestions([]);
      setQuestionsFailed(true);
    } finally {
      setQuestionsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    // Clear the field's error as soon as it is touched; leaving "needs an
    // answer" under a box that now has one is just noise.
    setAnswerErrors((current) => {
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  };

  /**
   * The client-side half of the server's rules, and only the half a person can
   * fix in the form. Choice and boolean values can only come from controls that
   * offer the stored options, so the two checks worth making here are the two a
   * free-text box can get wrong: a required question left blank, and a number
   * field holding something that is not one.
   */
  const findAnswerProblems = (): Record<string, string> => {
    const problems: Record<string, string> = {};
    for (const question of questions) {
      const value = (answers[question.id] ?? "").trim();
      if (!value) {
        if (question.required) problems[question.id] = "This question needs an answer.";
        continue;
      }
      if (question.kind === "NUMBER" && !Number.isFinite(Number(value))) {
        problems[question.id] = "Enter this as a number.";
      }
    }
    return problems;
  };

  const handleApply = async () => {
    if (!isAuthenticated) {
      router.push(`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
      return;
    }

    // Checked before the request, not instead of it: the API re-runs every one
    // of these against the questions it loads itself, because a form is a
    // courtesy and not a boundary.
    const problems = findAnswerProblems();
    setAnswerErrors(problems);
    const firstProblem = questions.find((question) => problems[question.id]);
    if (firstProblem) {
      setApplyError(
        questions.length === 1
          ? "Answer the screening question before you apply."
          : "Answer the screening questions before you apply."
      );
      answerFields.current[firstProblem.id]?.focus();
      return;
    }

    try {
      setApplying(true);
      setApplyError("");

      const trimmed = message.trim();
      // Built from the question list rather than from the answer map, so nothing
      // can be posted for a question this posting does not ask — and so blanks
      // left in optional questions become absent answers rather than empty rows.
      const answered = questions
        .map((question) => ({
          questionId: question.id,
          value: (answers[question.id] ?? "").trim(),
        }))
        .filter((answer) => answer.value.length > 0);

      const application = await apiFetch<JobApplication>("/api/applications", {
        method: "POST",
        // No `userId`: the server takes the applicant from the session. The
        // blank field is genuinely optional now — it used to be silently
        // replaced with "I'm interested in this position".
        //
        // `answers` is presence-gated the same way: a posting with nothing to
        // ask sends no key at all, and that request is byte-for-byte the one
        // this page has always sent.
        body: JSON.stringify({
          jobId,
          message: trimmed || undefined,
          answers: answered.length > 0 ? answered : undefined,
        }),
      });

      setSubmitted(application);
      setMessage("");
      setAnswers({});
      setAnswerErrors({});
      toast.success("Application submitted");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to submit your application");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (loadError || !job) {
    return (
      <PageShell>
        <Card className="mx-auto max-w-md p-6 text-center sm:p-8">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <Icon.warning className="h-6 w-6" />
          </span>
          <Eyebrow className="mb-2">Request failed</Eyebrow>
          <h1 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            {loadError || "Job not found"}
          </h1>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            This role may have been removed, or the link may be wrong.
          </p>
          <Link href="/jobs" className={buttonPrimary}>
            <Icon.arrowLeft className="h-4 w-4" />
            Browse all jobs
          </Link>
        </Card>
      </PageShell>
    );
  }

  const applicants = job._count?.applications ?? 0;
  const isOwner = mounted && job.isOwner === true;
  const isSeeker = mounted && isAuthenticated && user?.role === "SEEKER";
  const existingApplication = submitted ?? job.application ?? null;
  const alreadyApplied = mounted && (Boolean(submitted) || job.hasApplied === true);

  // The one gate for the whole breakdown. `null` covers every degraded path:
  // signed out, a company account, a profile with no vector, a job that has not
  // been indexed, and Gemini switched off entirely.
  const match = job.match ?? null;
  const skills = job.skills ?? [];

  return (
    <PageShell>
      <Link href="/jobs" className={`${buttonGhost} -ml-2.5 mb-5`}>
        <Icon.arrowLeft className="h-4 w-4" />
        All roles
      </Link>

      {/* Header: company tile, tight role title, state code, metadata chips. */}
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <span
              className="mono tile tile-ink h-12 w-12 flex-shrink-0 text-lg font-semibold sm:h-14 sm:w-14 sm:text-xl"
              aria-hidden="true"
            >
              {job.company?.name?.charAt(0).toUpperCase() ?? "C"}
            </span>
            <div className="min-w-0">
              <Eyebrow className="mb-1.5">{job.company?.name ?? "Company"}</Eyebrow>
              <h1 className="text-2xl font-bold leading-tight text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                {job.title}
              </h1>
            </div>
          </div>
          <JobStateBadge isActive={job.isActive} />
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {job.location && <Chip icon={<Icon.location className="h-3.5 w-3.5" />}>{job.location}</Chip>}
          {job.type && <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>}
          {job.experience && (
            <Chip icon={<Icon.briefcase className="h-3.5 w-3.5" />}>{job.experience} years</Chip>
          )}
          {job.salary && <Chip icon={<Icon.money className="h-3.5 w-3.5" />}>{job.salary}</Chip>}
        </div>

        {/* The posting's own skill tags, on their own line so they do not read
            as more location/salary metadata. Empty until the job is indexed. */}
        {skills.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Eyebrow as="span" className="mr-1">
              Skills
            </Eyebrow>
            {skills.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        {/* ------------------------------------------------------------ */}
        {/* Main column                                                   */}
        {/* ------------------------------------------------------------ */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader eyebrow="Role context" title="Job description" />
            <div className="px-4 py-5 sm:px-6">
              {/* Capped at a comfortable reading measure; the body is free text
                  from the poster, so newlines have to survive. */}
              <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300 sm:text-base">
                {job.description}
              </p>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Sidebar — the instrument panel                                */}
        {/* ------------------------------------------------------------ */}
        {/* Sticky as a whole column (grid children stretch by default, hence
            `self-start`), so the apply card and the readout travel together. */}
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          {isOwner ? (
            /* The company that posted the role gets management, not an
               apply form it could never submit. */
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Your posting</Eyebrow>
              <div className="mb-4 flex items-baseline gap-2">
                <Readout className="text-2xl font-semibold leading-none">{applicants}</Readout>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {applicants === 1 ? "applicant so far" : "applicants so far"}
                </span>
              </div>
              <div className="space-y-2">
                <Link href={`/jobs/${jobId}/edit`} className={`${buttonPrimary} w-full`}>
                  <Icon.edit className="h-4 w-4" />
                  Edit this posting
                </Link>
                <Link href="/applications" className={`${buttonSecondary} w-full`}>
                  View applicants
                </Link>
              </div>
            </Card>
          ) : alreadyApplied ? (
            /* Emerald hairline: an accepted application is the page's one
               "signal" state. */
            <Card signal className="p-4 sm:p-5">
              <Eyebrow accent className="mb-3">
                {submitted ? "Application sent" : "Application on file"}
              </Eyebrow>
              {submitted && (
                <Alert variant="success" className="mb-4">
                  Your application is on its way to {job.company?.name ?? "the company"}.
                </Alert>
              )}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={existingApplication?.status ?? "PENDING"} />
                {existingApplication?.createdAt && (
                  <Eyebrow as="span">Applied {formatDate(existingApplication.createdAt)}</Eyebrow>
                )}
              </div>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                {job.company?.name ?? "The company"} will be in touch through NextHire. You can follow
                the status from your dashboard.
              </p>
              <Link href="/seeker/dashboard" className={`${buttonPrimary} w-full`}>
                View my applications
                <Icon.arrowUpRight className="h-4 w-4" />
              </Link>
            </Card>
          ) : !job.isActive ? (
            /* A closed job used to keep an enabled Apply button, and the
               failure only appeared after the round-trip. */
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Applications closed</Eyebrow>
              <Alert variant="warning" className="mb-4">
                This role is no longer accepting applications.
              </Alert>
              <Link href="/jobs" className={`${buttonPrimary} w-full`}>
                Find similar roles
              </Link>
            </Card>
          ) : !mounted || !isAuthenticated ? (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-2">Apply</Eyebrow>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                Sign in to your job seeker account to apply for this role.
              </p>
              <div className="space-y-2">
                <Link
                  href={`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`}
                  className={`${buttonPrimary} w-full`}
                >
                  Sign in to apply
                  <Icon.arrowUpRight className="h-4 w-4" />
                </Link>
                <Link href="/auth/register" className={`${buttonSecondary} w-full`}>
                  Create an account
                </Link>
              </div>
            </Card>
          ) : !isSeeker ? (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-2">Apply</Eyebrow>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                Only job seeker accounts can apply for a role.
              </p>
              <Link href="/company/dashboard" className={`${buttonSecondary} w-full`}>
                Go to my dashboard
              </Link>
            </Card>
          ) : (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Apply for this role</Eyebrow>

              {applyError && (
                <Alert variant="error" className="mb-4">
                  {applyError}
                </Alert>
              )}

              {/* The employer's questions come before the cover letter: they are
                  the part of this form that is actually asked of the applicant,
                  and some of them have to be answered. */}
              {questionsLoading ? (
                <p className="mb-4">
                  <Eyebrow as="span">Checking for screening questions…</Eyebrow>
                </p>
              ) : questions.length > 0 ? (
                <ScreeningFields
                  questions={questions}
                  answers={answers}
                  errors={answerErrors}
                  disabled={applying}
                  companyName={job.company?.name ?? "This company"}
                  onChange={setAnswer}
                  registerField={(questionId, element) => {
                    answerFields.current[questionId] = element;
                  }}
                />
              ) : questionsFailed ? (
                /* Apply stays enabled. Almost no posting carries questions, and
                   blocking every applicant on a request that failed would be a
                   far larger regression than the one this warns about — if the
                   posting does screen, the API rejects the application and says
                   which question needs an answer. */
                <Alert variant="warning" className="mb-4">
                  <p>Couldn&rsquo;t load this role&rsquo;s screening questions.</p>
                  <button
                    type="button"
                    onClick={() => void fetchQuestions()}
                    className="mt-2 font-semibold underline"
                  >
                    Try again
                  </button>
                </Alert>
              ) : null}

              <div className="mb-4">
                <Label htmlFor="cover-letter">Cover letter (optional)</Label>
                <textarea
                  id="cover-letter"
                  value={message}
                  maxLength={MESSAGE_LIMIT}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  aria-describedby="cover-letter-count"
                  placeholder="Tell them why you're a good fit…"
                  className={`${inputClass} resize-y text-sm`}
                />
                <p id="cover-letter-count" className="eyebrow mt-1.5 text-right">
                  {message.length} / {MESSAGE_LIMIT}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={applying}
                className={`${buttonPrimary} w-full`}
              >
                {applying ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Submitting…
                  </>
                ) : (
                  <>
                    Apply
                    <Icon.arrowUpRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </Card>
          )}

          {/* Sits above the fact readout: the score is about *this reader*, the
              facts below are about the role, and the personal thing goes first. */}
          {match && <MatchPanel jobId={jobId} match={match} />}

          {/* No score and nothing to score against. One line, no panel — an
              empty breakdown frame would be worse than none at all. */}
          {!match && isSeeker && (
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Fit scoring is off for you until your profile is indexed.{" "}
              <Link
                href="/seeker/dashboard"
                className="font-medium text-gray-900 underline underline-offset-2 hover:no-underline dark:text-white"
              >
                Add a r&eacute;sum&eacute; or profile details
              </Link>{" "}
              to see how this role lines up.
            </p>
          )}

          {/* The fact readout: mono values under mono captions, on the
              graph-paper field used for telemetry elsewhere in the app. */}
          <Card grid className="p-4 sm:p-5">
            <Eyebrow className="mb-4">Role parameters</Eyebrow>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
              <Fact label="Location" value={job.location ?? "—"} />
              <Fact label="Salary" value={job.salary ?? "—"} />
              <Fact label="Type" value={job.type ?? "—"} />
              <Fact label="Experience" value={job.experience ? `${job.experience} yrs` : "—"} />
              <Fact label="Posted" value={formatDate(job.createdAt)} />
              <Fact label="Applicants" value={String(applicants)} />
            </dl>
          </Card>
        </aside>
      </div>

      {/* Below the fold and outside the grid: neighbours are the exit route from
          this page, so they sit after everything that might keep the reader on
          it. Renders nothing at all when there are none. */}
      <SimilarRoles jobId={jobId} />
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The prompt, styled as a field label.
 *
 * Deliberately not `Label` from the kit: that renders the micro-caps eyebrow
 * treatment, which is right for "Cover letter" and unreadable at three hundred
 * characters of question. Sentence case, normal weight contrast, same margin.
 */
const promptClass = "mb-2 block text-sm font-medium leading-snug text-gray-900 dark:text-white";

/** The required marker used by `Label`, reused so the two forms mark the same way. */
function RequiredMark({ required }: { required: boolean }) {
  if (!required) return null;
  return (
    <>
      <span className="ml-1 text-red-500" aria-hidden="true">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/**
 * The employer's screening questions, as the applicant's half of the form.
 *
 * An ordered list because the order is the employer's and is meaningful — they
 * arranged these by `position` in the editor, and the numbering printed beside
 * each prompt is what lets an error message ("question 2 needs an answer") mean
 * anything on either side of the request.
 */
function ScreeningFields({
  questions,
  answers,
  errors,
  disabled,
  companyName,
  onChange,
  registerField,
}: {
  questions: ScreeningQuestion[];
  answers: Record<string, string>;
  errors: Record<string, string>;
  disabled: boolean;
  companyName: string;
  onChange: (questionId: string, value: string) => void;
  registerField: (questionId: string, element: HTMLElement | null) => void;
}) {
  const total = questions.length;

  return (
    <section
      aria-labelledby="screening-heading"
      className="mb-5 border-b border-gray-200 pb-5 dark:border-gray-700"
    >
      <h3 id="screening-heading" className="eyebrow mb-1.5">
        Screening questions
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {companyName} asks everyone who applies{" "}
        {total === 1 ? "this question" : `these ${total} questions`}. Your answers go to them with
        your application.
      </p>

      <ol className="space-y-5">
        {questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            index={index}
            total={total}
            value={answers[question.id] ?? ""}
            error={errors[question.id] ?? ""}
            disabled={disabled}
            onChange={onChange}
            registerField={registerField}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * One question, rendered as whatever its `kind` actually is.
 *
 * The two closed kinds are radio groups over the stored values rather than free
 * text, which is what makes a knockout comparison meaningful: the employer
 * chose the expected answer from the same list, so a mismatch is a real
 * disagreement and never a difference of spelling.
 */
function QuestionField({
  question,
  index,
  total,
  value,
  error,
  disabled,
  onChange,
  registerField,
}: {
  question: ScreeningQuestion;
  index: number;
  total: number;
  value: string;
  error: string;
  disabled: boolean;
  onChange: (questionId: string, value: string) => void;
  registerField: (questionId: string, element: HTMLElement | null) => void;
}) {
  const fieldId = `screening-${question.id}`;
  const errorId = `${fieldId}-error`;
  const countId = `${fieldId}-count`;
  const legendId = `${fieldId}-legend`;

  // The counter is only described when there is one to describe; an empty
  // `aria-describedby` is still an `aria-describedby`.
  const describedBy =
    [error ? errorId : null, question.kind === "TEXT" ? countId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  // `undefined` rather than `false`: an explicit aria-invalid="false" on every
  // untouched field is noise in the accessibility tree.
  const invalid = error ? true : undefined;

  const choices =
    question.kind === "BOOLEAN"
      ? [...BOOLEAN_ANSWERS]
      : question.kind === "SINGLE_CHOICE"
        ? question.options
        : [];

  const marker = (
    <Eyebrow as="span" className="mb-1.5 block">
      Question {index + 1} of {total}
      {question.required ? "" : " · optional"}
    </Eyebrow>
  );

  return (
    <li className="min-w-0">
      {marker}

      {choices.length > 0 ? (
        /* `aria-invalid` belongs on the group, not on each radio: a single
           option is not individually invalid, and the role does not support the
           attribute anyway. `aria-labelledby` is explicit rather than relying
           on the legend, because the overridden role can cost a fieldset its
           native naming. */
        <fieldset
          className="min-w-0"
          role="radiogroup"
          aria-labelledby={legendId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        >
          <legend id={legendId} className={promptClass}>
            {question.prompt}
            <RequiredMark required={question.required} />
          </legend>
          <div className="space-y-2">
            {choices.map((choice, choiceIndex) => {
              const optionId = `${fieldId}-${choiceIndex}`;
              return (
                <label
                  key={choice}
                  htmlFor={optionId}
                  className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-200"
                >
                  <input
                    type="radio"
                    id={optionId}
                    // One `name` per question, so arrow keys move within the
                    // group and never across into the next question's.
                    name={fieldId}
                    value={choice}
                    checked={value === choice}
                    disabled={disabled}
                    onChange={() => onChange(question.id, choice)}
                    // Only the first option is registered: focus belongs on the
                    // group, and that is where the browser puts it.
                    ref={
                      choiceIndex === 0
                        ? (element) => {
                            registerField(question.id, element);
                          }
                        : undefined
                    }
                    className="control mt-0.5 h-4 w-4 flex-shrink-0"
                  />
                  <span className="min-w-0 break-words">{choice}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : question.kind === "NUMBER" ? (
        <>
          <label htmlFor={fieldId} className={promptClass}>
            {question.prompt}
            <RequiredMark required={question.required} />
          </label>
          <input
            id={fieldId}
            type="number"
            // `decimal` rather than `numeric`: "2.5 years" is a plausible answer
            // and a keypad without a decimal point cannot type it.
            inputMode="decimal"
            value={value}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => onChange(question.id, event.target.value)}
            ref={(element) => {
              registerField(question.id, element);
            }}
            className={`${inputClass} text-sm`}
          />
        </>
      ) : (
        <>
          <label htmlFor={fieldId} className={promptClass}>
            {question.prompt}
            <RequiredMark required={question.required} />
          </label>
          <textarea
            id={fieldId}
            value={value}
            rows={3}
            maxLength={ANSWER_LIMIT}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => onChange(question.id, event.target.value)}
            ref={(element) => {
              registerField(question.id, element);
            }}
            className={`${inputClass} resize-y text-sm`}
          />
          <p id={countId} className="eyebrow mt-1.5 text-right">
            {value.length} / {ANSWER_LIMIT}
          </p>
        </>
      )}

      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The match breakdown.
 *
 * The point of showing all four facets rather than one number is that "78%"
 * with nothing behind it invites distrust — and a seeker can act on "skills
 * overlap is thin" in a way they cannot act on a composite. Rendered only when
 * a breakdown actually exists; there is no zero state here by design.
 */
function MatchPanel({ jobId, match }: { jobId: string; match: MatchBreakdown }) {
  return (
    <Card grid className="p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-900/25 dark:text-green-400"
            aria-hidden="true"
          >
            <Icon.graph className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            Match breakdown
          </h2>
        </div>
        {/* Our own scoring revision, not a model version — inventing one would
            be a claim we cannot stand behind. */}
        <Eyebrow as="span" className="flex-shrink-0 pt-1.5">
          Signal v1
        </Eyebrow>
      </div>

      {/* Prose first: a sentence is what a person reads, and the meters below
          are the receipts for it. Renders nothing at all when there is no
          sentence to show — see `MatchRationale`. */}
      <MatchRationale jobId={jobId} score={match.score} />

      {/* Headline: the composite, as digits and as bar length. */}
      <div className="mb-5 border-b border-gray-200 pb-4 dark:border-gray-700">
        <span className="flex items-baseline gap-1.5">
          <Icon.pulse
            className="h-4 w-4 flex-shrink-0 self-center text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
          <Readout className="text-3xl font-semibold leading-none text-gray-900 dark:text-white sm:text-4xl">
            {match.score}
          </Readout>
          <Readout className="text-lg font-semibold leading-none text-gray-400 dark:text-gray-500">
            %
          </Readout>
        </span>
        <Eyebrow className="mt-2">Profile fit</Eyebrow>
        <Meter
          value={match.score}
          label={`Overall profile fit: ${match.score} out of 100`}
          className="mt-3"
        />
      </div>

      {/* The four facets that produced the number above. */}
      <div className="space-y-3">
        <MeterRow label="Semantic fit" value={match.facets.semantic} />
        <MeterRow label="Skills overlap" value={match.facets.skills} />
        <MeterRow label="Location" value={match.facets.location} />
        <MeterRow label="Seniority" value={match.facets.seniority} />
      </div>

      {match.sharedSkills.length > 0 && (
        <div className="mt-5">
          <Eyebrow accent className="mb-2">
            Matched
          </Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {match.sharedSkills.map((skill) => (
              <Chip key={skill} accent>
                {skill}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {match.missingSkills.length > 0 && (
        <div className="mt-4">
          <Eyebrow className="mb-2">Not evidenced</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {match.missingSkills.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
          </div>
          {/* Deliberately not "missing": the posting asks for these and your
              profile does not mention them, which is a prompt to update the
              profile at least as often as it is a reason not to apply. */}
          <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            The posting names these and your profile doesn&rsquo;t mention them yet. Worth adding if
            you have them.
          </p>
        </div>
      )}

      <p className="mt-5 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Scored by comparing your profile with this posting. It is guidance to help you decide where
        to spend your time, not a decision — the company reads every application it receives.
      </p>
    </Card>
  );
}

/**
 * The one-sentence rationale behind the number, from `POST /api/ai/explain`.
 *
 * Fetched from inside the panel rather than with the job, for two reasons. A
 * cache miss spends a generation call, so it must only happen where a reader
 * has actually opened a role — never once per card in the feed. And the page
 * has to paint without waiting on it, the same way `SimilarRoles` does.
 *
 * Every unhappy path is silence: 503 when Gemini is unconfigured, 502 when the
 * model returned nothing usable, 404 when there is no match to explain. None of
 * those is the reader's problem, and an error card next to their match score
 * would read as a problem with *them*. The meters below stand on their own.
 *
 * `score` is the number this panel is printing. The route recomputes the match
 * server-side, so if the two disagree the profile moved between the two
 * requests and the sentence is about a score that is no longer on screen —
 * which is the one thing this feature exists to make impossible. Drop it.
 */
function MatchRationale({ jobId, score }: { jobId: string; score: number }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Navigating between two roles reuses this component; the previous role's
    // sentence must never be left sitting above the new role's number.
    setText(null);
    setPending(true);

    void (async () => {
      try {
        const data = await apiFetch<MatchExplanation>("/api/ai/explain", {
          method: "POST",
          body: JSON.stringify({ jobId }),
        });
        if (cancelled) return;
        if (typeof data?.text === "string" && data.score === score) setText(data.text);
      } catch {
        // Swallowed on purpose — see the note above the component.
      } finally {
        if (!cancelled) setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, score]);

  if (pending) {
    return (
      <div className="mb-5 border-b border-gray-200 pb-4 dark:border-gray-700">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2.5 h-3.5 w-full" />
        <Skeleton className="mt-1.5 h-3.5 w-4/5" />
        <span className="sr-only">Writing a summary of this match</span>
      </div>
    );
  }

  if (!text) return null;

  return (
    <div className="mb-5 border-b border-gray-200 pb-4 dark:border-gray-700">
      {/* `Icon.spark` is the kit's AI affordance everywhere else in the app, so
          the glyph is what marks this as machine-written rather than copy. */}
      <Eyebrow accent className="mb-2 flex items-center gap-1.5">
        <Icon.spark className="h-3.5 w-3.5" aria-hidden="true" />
        Why this matched
      </Eyebrow>
      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{text}</p>
      {/* Says exactly what the sentence was written from, because that is the
          property that makes it trustworthy: the model is handed the breakdown
          below and nothing else, so it cannot claim an overlap the meters do
          not show. The second half is the framing used product-wide. */}
      <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Written from the breakdown below &mdash; it has not read your r&eacute;sum&eacute;. A sorting
        aid, not an assessment of you.
      </p>
    </div>
  );
}

/**
 * "More like this", from the stored job vectors.
 *
 * Fetched separately from the job itself so the page paints without waiting on
 * it, and rendered only once there is something to render: no skeleton, no
 * empty frame, no error message. Every degraded path — a corpus that has not
 * been indexed, no `GEMINI_API_KEY`, a request that failed — looks identical
 * from here, which is to say it looks like nothing. This is a decoration on a
 * page whose actual job is the posting above it.
 */
function SimilarRoles({ jobId }: { jobId: string }) {
  const [jobs, setJobs] = useState<SimilarJob[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Clear first: navigating between two job pages reuses this component, and
    // the previous role's neighbours must not linger under the new title.
    setJobs([]);

    void (async () => {
      try {
        const data = await apiFetch<SimilarJob[]>(
          `/api/jobs/${jobId}/similar?limit=${SIMILAR_LIMIT}`
        );
        if (!cancelled && Array.isArray(data)) setJobs(data);
      } catch {
        // Swallowed on purpose — see the note above the component.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (jobs.length === 0) return null;

  return (
    <section className="mt-10 border-t border-gray-200 pt-6 dark:border-gray-700">
      <Eyebrow className="mb-1.5">Vector neighbours</Eyebrow>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
        Similar roles
      </h2>
      {/* Says where the list comes from without printing a second percentage:
          a number next to the fit panel above would be read as another fit
          score, and this one measures posting against posting. */}
      <p className="mt-1 max-w-[60ch] text-sm text-gray-500 dark:text-gray-400">
        Open postings that read closest to this one, ordered by how near they
        sit in the match graph.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <SimilarJobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

/**
 * A neighbour, as a compact version of the feed card — same company tile, same
 * metadata chips, same stretched title anchor so the whole tile is clickable
 * while the card still exposes exactly one link named by the role.
 */
function SimilarJobCard({ job }: { job: SimilarJob }) {
  return (
    <Card interactive className="group relative flex flex-col p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mono tile tile-ink h-10 w-10 flex-shrink-0 text-sm font-semibold"
          aria-hidden="true"
        >
          {job.company?.name?.charAt(0).toUpperCase() ?? "C"}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-white">
            <Link href={`/jobs/${job.id}`} className="after:absolute after:inset-0 after:rounded-xl">
              <span className="line-clamp-2">{job.title}</span>
            </Link>
          </h3>
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
            {job.company?.name ?? "Company"}
          </p>
        </div>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-1.5">
        {job.location && <Chip icon={<Icon.location className="h-3.5 w-3.5" />}>{job.location}</Chip>}
        {job.type && <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>}
        {job.salary && <Chip icon={<Icon.money className="h-3.5 w-3.5" />}>{job.salary}</Chip>}
      </div>

      {/* `mt-auto` keeps the footers aligned across a row of uneven titles. */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
        <Eyebrow as="span">Posted {formatDate(job.createdAt)}</Eyebrow>
        <span
          className="flex items-center gap-1 text-xs font-semibold text-gray-400 transition-colors group-hover:text-gray-900 dark:text-gray-500 dark:group-hover:text-white"
          aria-hidden="true"
        >
          View
          <Icon.arrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Card>
  );
}

/** Page chrome shared by the job, the error state and the skeleton. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

/** One cell of the fact grid: mono caption above a mono value. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt>
        <Eyebrow as="span">{label}</Eyebrow>
      </dt>
      <dd className="mt-1">
        <Readout className="block break-words text-sm font-medium">{value}</Readout>
      </dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <PageShell>
      <div aria-hidden="true">
        <div className="mb-6 flex items-start gap-4">
          <Skeleton className="h-12 w-12 flex-shrink-0 sm:h-14 sm:w-14" rounded="rounded-md" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-3/4" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
          <div className="lg:col-span-2">
            <Card grid className="p-4 sm:p-6">
              <Skeleton className="mb-3 h-3 w-28" />
              <SkeletonText lines={4} />
            </Card>
          </div>
          <Card grid className="p-4 sm:p-5">
            <div className="space-y-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-24 w-full" rounded="rounded-lg" />
              <Skeleton className="h-10 w-full" rounded="rounded-lg" />
            </div>
          </Card>
        </div>
      </div>
      <span className="sr-only">Loading job</span>
    </PageShell>
  );
}
