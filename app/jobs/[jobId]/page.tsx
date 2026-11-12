"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import {
  Avatar,
  Alert,
  BackLink,
  Button,
  buttonPrimary,
  buttonSecondary,
  Card,
  CardHeader,
  Chip,
  Eyebrow,
  formatDate,
  Icon,
  IconTile,
  inputClass,
  JobStateBadge,
  Label,
  MatchScore,
  MeterRow,
  Readout,
  Skeleton,
  SkeletonText,
  StatusBadge,
  StatusIcon,
  TONE_TEXT,
  type StatusTone,
} from "@/app/components/ui";
import { companyLogoSrc } from "@/lib/companyLogo";
import { useToast } from "@/app/components/Toast";
import { compactLocation } from "@/app/components/JobCard";
import { apiFetch } from "@/lib/clientAuth";
// A bare constant object; `lib/ai/config` has no imports of its own and reads
// only non-secret model names from the environment, so the weights shown in the
// disclosure are the weights the scorer uses rather than a retyped copy.
import { MATCH_WEIGHTS } from "@/lib/ai/config";
import { MATCH_CAVEAT_SEEKER, experienceLabel } from "@/lib/copy";
import { sourceLabel } from "@/lib/jobs/sources";

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
  company?: { id: string; name: string; profile?: string | null; website?: string | null; logoUrl?: string | null };
  createdAt: string;
  isActive: boolean;
  /** Set for a job imported from a public job board; applied for at `sourceUrl`. */
  source?: string | null;
  sourceUrl?: string | null;
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
  company?: { id?: string; name: string; profile?: string | null; website?: string | null; logoUrl?: string | null };
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
      setLoadError(err instanceof Error ? err.message : "Couldn’t load this job");
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
    // Belt and braces alongside the disabled button: submitting twice creates a
    // duplicate application the seeker cannot withdraw from this page.
    if (applying) return;

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
      // The count beside the facts was read before this application existed.
      setJob((current) =>
        current
          ? { ...current, _count: { applications: (current._count?.applications ?? 0) + 1 } }
          : current
      );
      setMessage("");
      setAnswers({});
      setAnswerErrors({});
      toast.success("Application submitted");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Couldn’t submit your application");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (loadError || !job) {
    return (
      <PageShell>
        <Card className="mx-auto max-w-md p-6 text-center sm:p-8">
          <IconTile icon={<Icon.warning className="h-6 w-6" />} tone="bad" size="lg" className="mx-auto mb-4" />
          <Eyebrow className="mb-2">Request failed</Eyebrow>
          <h1 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            {loadError || "Job not found"}
          </h1>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            This job may have been removed, or the link may be wrong.
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
  const importedFrom = job.sourceUrl ? sourceLabel(job.source, job.company?.name) ?? "the original site" : null;

  // The fit headline, at the top of whichever apply card this reader gets, so
  // "how well do I fit" and "apply" are read together. The full breakdown sits
  // under the description and this links to it.
  const fitSummary = match ? <FitSummary score={match.score} /> : null;
  // Open, not ours, not applied to yet, and someone who can act on it: a
  // seeker, or a visitor who can sign in. A company account has no action.
  const showApplyShortcut =
    !isOwner &&
    job.isActive &&
    !alreadyApplied &&
    (Boolean(job.sourceUrl) || isSeeker || !mounted || !isAuthenticated);

  return (
    <PageShell>
      <BackLink href="/jobs" className="mb-5">
        All jobs
      </BackLink>

      {/* Header: company tile, tight role title, metadata chips, then one quiet
          line of status. The open/closed badge used to float alone in the top
          right corner, a long way from the title it describes. */}
      <header className="mb-6 sm:mb-8">
        <div className="flex items-start">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <Avatar name={job.company?.name ?? "Company"} size="lg" logo={companyLogoSrc(job.company)} />
            <div className="min-w-0">
              <Eyebrow className="mb-1.5">
                {job.company?.name ?? "Company"}
                {importedFrom && (
                  <>
                    {" · via "}
                    {/* A followed link with the source's name: Remote OK's API
                        terms require both, and the other boards earn the same. */}
                    <a href={job.sourceUrl ?? undefined} target="_blank" rel="noopener" className="link">
                      {importedFrom}
                    </a>
                  </>
                )}
              </Eyebrow>
              <h1 className="text-2xl font-bold leading-tight text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                {job.title}
              </h1>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {job.location && (
            <Chip icon={<Icon.location className="h-3.5 w-3.5" />} className="chip-wrap">
              {job.location}
            </Chip>
          )}
          {job.type && <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>}
          {job.experience && (
            <Chip icon={<Icon.briefcase className="h-3.5 w-3.5" />}>{experienceLabel(job.experience)}</Chip>
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

        {/* The two facts the chips do not carry. These used to sit in a
            separate "Job details" card that repeated location, salary, type and
            experience a second time, a screen away from the chips above. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <JobStateBadge isActive={job.isActive} />
          <Eyebrow as="span">Posted {formatDate(job.createdAt)}</Eyebrow>
          {/* Applications to an imported job happen at the source, so a
              NextHire count would only ever say 0. */}
          {!importedFrom && (
            <>
              <span aria-hidden="true" className="eyebrow">
                ·
              </span>
              <Eyebrow as="span">
                {applicants} {applicants === 1 ? "applicant" : "applicants"}
              </Eyebrow>
            </>
          )}
        </div>

        {/* Phones only. Below `lg` the apply card follows the description, and
            an imported posting can run to several screens of text, so the
            action is repeated here: straight out to the source for an imported
            job, and down to the form for one that applies on NextHire. */}
        {showApplyShortcut && (
          <div className="mt-5 lg:hidden">
            {job.sourceUrl ? (
              <a href={job.sourceUrl} target="_blank" rel="noopener" className={`${buttonPrimary} w-full`}>
                Apply on {importedFrom}
                <Icon.arrowUpRight className="h-4 w-4" />
              </a>
            ) : isSeeker ? (
              <a href="#apply" className={`${buttonPrimary} w-full`}>
                Apply for this job
                <Icon.chevronDown className="h-4 w-4" />
              </a>
            ) : (
              <Link
                href={`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`}
                className={`${buttonPrimary} w-full`}
              >
                Sign in to apply
              </Link>
            )}
          </div>
        )}
      </header>

      {/*
       * Two columns on a wide screen, in this order for everyone else:
       * description, the apply card, then the match breakdown.
       *
       * The breakdown used to be stacked under the apply form in the narrow
       * column, so a short posting left a tall empty hole under its description
       * while the sidebar ran on for a thousand pixels. It now sits in the wide
       * column under the description, where its meters have room to sit side by
       * side, and the sidebar holds only what has to stay in reach: the fit
       * headline and the apply action.
       *
       * `grid-rows-[auto_1fr]` gives any spare height to the second row, so a
       * sidebar taller than the description pushes space below the breakdown
       * rather than opening a gap between the two cards.
       */}
      <div className="grid gap-5 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:gap-6">
        <div className="min-w-0 lg:col-span-2">
          <Card>
            <CardHeader eyebrow="About the job" title="Job description" />
            <div className="px-4 py-5 sm:px-6">
              <DescriptionBody text={job.description} />
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Sidebar — fit headline and the apply action                   */}
        {/* ------------------------------------------------------------ */}
        {/* Sticky so the action stays in reach down a long description. Not
            when the posting carries screening questions: a sticky column
            taller than the screen hides its own Apply button. */}
        <aside
          id="apply"
          className={`scroll-mt-24 space-y-4 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start ${
            questions.length > 0 ? "" : "lg:sticky lg:top-24"
          }`}
        >
          {isOwner ? (
            /* The company that posted the role gets management, not an
               apply form it could never submit. */
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-3">Your job</Eyebrow>
              <div className="mb-4 flex items-baseline gap-2">
                <Readout className="text-2xl font-semibold leading-none">{applicants}</Readout>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {applicants === 1 ? "applicant so far" : "applicants so far"}
                </span>
              </div>
              <div className="space-y-2">
                <Link href={`/jobs/${jobId}/edit`} className={`${buttonPrimary} w-full`}>
                  <Icon.edit className="h-4 w-4" />
                  Edit job
                </Link>
                <Link href="/applications" className={`${buttonSecondary} w-full`}>
                  View applicants
                </Link>
              </div>
            </Card>
          ) : job.sourceUrl ? (
            /* Imported from a public job board: there is no hiring team on
               NextHire to receive an application, so apply where it was posted. */
            <Card className="p-4 sm:p-5">
              {fitSummary}
              <Eyebrow className="mb-2">Apply</Eyebrow>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                {job.isActive
                  ? `This job is listed on ${importedFrom}. Apply on the original posting.`
                  : `This job is no longer listed on ${importedFrom}.`}
              </p>
              {job.isActive ? (
                <a href={job.sourceUrl} target="_blank" rel="noopener" className={`${buttonPrimary} w-full`}>
                  Apply on {importedFrom}
                  <Icon.arrowUpRight className="h-4 w-4" />
                </a>
              ) : (
                <Link href="/jobs" className={`${buttonPrimary} w-full`}>
                  Find similar jobs
                </Link>
              )}
            </Card>
          ) : alreadyApplied ? (
            /* Emerald hairline: an accepted application is the page's one
               "signal" state. */
            <Card signal className="p-4 sm:p-5">
              {fitSummary}
              <div className="mb-4 flex items-center gap-3">
                <StatusIcon tone="good" size="lg" />
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900 dark:text-white">
                    {submitted ? "Application sent" : "You’ve applied"}
                  </p>
                  {existingApplication?.createdAt && (
                    <Eyebrow as="span">Applied {formatDate(existingApplication.createdAt)}</Eyebrow>
                  )}
                </div>
              </div>
              {submitted && (
                <Alert variant="success" className="mb-4">
                  Your application was sent to {job.company?.name ?? "the company"}.
                </Alert>
              )}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Eyebrow as="span">Status</Eyebrow>
                <StatusBadge status={existingApplication?.status ?? "PENDING"} />
              </div>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                {job.company?.name ?? "The company"} will reply through NextHire. Track it from your dashboard.
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
              {fitSummary}
              <Eyebrow className="mb-3">Applications closed</Eyebrow>
              <Alert variant="warning" className="mb-4">
                This job is no longer accepting applications.
              </Alert>
              <Link href="/jobs" className={`${buttonPrimary} w-full`}>
                Find similar jobs
              </Link>
            </Card>
          ) : !mounted || !isAuthenticated ? (
            <Card className="p-4 sm:p-5">
              <Eyebrow className="mb-2">Apply</Eyebrow>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                Sign in to apply for this job.
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
                Only job seeker accounts can apply.
              </p>
              <Link href="/company/dashboard" className={`${buttonSecondary} w-full`}>
                Go to dashboard
              </Link>
            </Card>
          ) : (
            <Card className="p-4 sm:p-5">
              {fitSummary}
              <Eyebrow className="mb-3">Apply for this job</Eyebrow>

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
                  <Eyebrow as="span">Loading questions…</Eyebrow>
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
                  <p>Couldn&rsquo;t load the screening questions.</p>
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
                  rows={4}
                  aria-describedby="cover-letter-count"
                  placeholder="Tell them why you're a good fit…"
                  className={`${inputClass} resize-y text-sm`}
                />
                <p id="cover-letter-count" className="eyebrow mt-1.5 text-right">
                  {message.length} / {MESSAGE_LIMIT}
                </p>
              </div>

              <Button
                block
                onClick={() => void handleApply()}
                loading={applying}
                loadingLabel="Sending your application"
                iconEnd={<Icon.arrowUpRight className="h-4 w-4" />}
              >
                {applying ? "Submitting…" : "Apply"}
              </Button>
            </Card>
          )}

          {/* No score and nothing to score against. One line, no panel — an
              empty breakdown frame would be worse than none at all. */}
          {!match && isSeeker && (
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {" "}
              <Link
                href="/seeker/dashboard"
                className="font-medium text-gray-900 underline underline-offset-2 hover:no-underline dark:text-white"
              >
                Add a resume or profile details
              </Link>{" "}
              to see how well you match.
            </p>
          )}

        </aside>

        {/* The breakdown, in the wide column under the description. The score
            is about *this reader* and the description about the role; the
            headline is already in the sidebar beside Apply, so this is the
            detail behind it rather than a second headline. */}
        {match && (
          <div className="min-w-0 lg:col-span-2 lg:self-start">
            <MatchPanel jobId={jobId} match={match} />
          </div>
        )}
      </div>

      {/* Below the fold and outside the grid: neighbours are the exit route from
          this page, so they sit after everything that might keep the reader on
          it. Renders nothing at all when there are none. Not for the company
          that posted this job: "you may also like" other companies' jobs is
          a seeker's prompt, not an employer's. */}
      {!isOwner && <SimilarRoles jobId={jobId} />}
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
  const caveatId = "fit-caveat";

  return (
    // `scroll-mt-24` so the sidebar's "See breakdown" link lands below the
    // floating navbar rather than under it. Not `grid`: this panel now carries
    // a sentence of prose, and graph paper behind body text costs contrast.
    <Card as="section" id="match" aria-labelledby="match-heading" className="scroll-mt-24">
      <div className="flex items-center gap-3 border-b border-[var(--line-subtle)] px-4 py-4 sm:px-6 sm:py-5">
        <IconTile icon={<Icon.target className="h-5 w-5" />} />
        <div className="min-w-0">
          <Eyebrow className="mb-1">Your fit</Eyebrow>
          <h2
            id="match-heading"
            className="text-base font-semibold leading-snug tracking-tight text-gray-900 dark:text-white sm:text-[1.0625rem]"
          >
            How you match this job
          </h2>
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6">
        {/*
         * Two halves on a wide card: the verdict on the left — the band, then
         * the sentence that explains it — and its receipts on the right.
         *
         * Headline. `MatchScore` rather than hand-set digits: this was the one
         * surface still printing `76%`, which is the shape the kit was changed to
         * stop producing — beside the word "fit" a percentage reads as a
         * probability of being hired, and one displayed point is 0.002 of cosine,
         * so the precision is roughly 10x what the signal carries. `coarse={false}` because this is the detail panel: the exact
         * value belongs here even though the band leads, and the list surfaces
         * round to 5.
         *
         * `describedBy` ties it to the caveat at the foot of the panel, which was
         * an unassociated `<p>` a screen-reader user querying the score never
         * heard (§2.4).
         */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-8">
          <div className="min-w-0">
            <MatchScore
              value={match.score}
              caption="Profile fit"
              coarse={false}
              size="lg"
              align="left"
              showBar
              describedBy={caveatId}
            />
            {/* The sentence, then the meters as its receipts. Renders nothing
                at all when there is no sentence to show — see `MatchRationale`. */}
            <MatchRationale jobId={jobId} score={match.score} />
          </div>

          {/*
           * The four facets that produced the number, each labelled with its
           * share of the blend. Four identically-sized bars imply four equal inputs
           * and the blend is 70/18/7/5 — an explanation that misrepresents how the
           * number was produced is worse than no explanation. The weights come from `MATCH_WEIGHTS`, so the label cannot drift
           * from the scorer.
           */}
          <div className="min-w-0 space-y-3">
            <MeterRow
              icon={<Icon.briefcase className="h-4 w-4" />}
              label="Experience fit"
              value={match.facets.semantic}
              weight={MATCH_WEIGHTS.semantic}
            />
            <MeterRow
              icon={<Icon.layers className="h-4 w-4" />}
              label="Skills match"
              value={match.facets.skills}
              weight={MATCH_WEIGHTS.skills}
            />
            <MeterRow
              icon={<Icon.location className="h-4 w-4" />}
              label="Location"
              value={match.facets.location}
              weight={MATCH_WEIGHTS.location}
            />
            <MeterRow
              icon={<Icon.trendingUp className="h-4 w-4" />}
              label="Seniority"
              value={match.facets.seniority}
              weight={MATCH_WEIGHTS.seniority}
            />
          </div>
        </div>

        {(match.sharedSkills.length > 0 || match.missingSkills.length > 0) && (
          <div className="mt-6 grid gap-5 border-t border-[var(--line-subtle)] pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-8">
            {match.sharedSkills.length > 0 && (
              <div className="min-w-0">
                <SkillGroupHeading tone="good" count={match.sharedSkills.length}>
                  Skills you have
                </SkillGroupHeading>
                <div className="flex flex-wrap gap-1.5">
                  {match.sharedSkills.map((skill) => (
                    <Chip key={skill} tone="good">
                      {skill}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {match.missingSkills.length > 0 && (
              <div className="min-w-0">
                <SkillGroupHeading tone="warn" count={match.missingSkills.length}>
                  Missing from your profile
                </SkillGroupHeading>
                <div className="flex flex-wrap gap-1.5">
                  {match.missingSkills.map((skill) => (
                    <Chip key={skill} tone="warn">
                      {skill}
                    </Chip>
                  ))}
                </div>
                {/* Deliberately not "missing": the posting asks for these and your
                    profile does not mention them, which is a prompt to update the
                    profile at least as often as it is a reason not to apply. */}
                <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  This job lists these, but your profile doesn’t. Add them if you have them.
                </p>
              </div>
            )}
          </div>
        )}

        <p
          id={caveatId}
          className="mt-6 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          {MATCH_CAVEAT_SEEKER}
        </p>

        <MatchDisclosure />
      </div>
    </Card>
  );
}

/**
 * The fit headline at the top of the apply card: the band and the number, and
 * a link down to the breakdown. Exact rather than rounded, so it agrees with the
 * panel it links to.
 */
/** "Skills you have · 3" in the group's status colour, led by its status dot. */
function SkillGroupHeading({
  tone,
  count,
  children,
}: {
  tone: StatusTone;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <p className={`mb-2.5 flex items-center gap-2 text-sm font-semibold ${TONE_TEXT[tone]}`}>
      <StatusIcon tone={tone} />
      {children}
      <Readout className="text-xs font-medium text-gray-500 dark:text-gray-400">{count}</Readout>
    </p>
  );
}

function FitSummary({ score }: { score: number }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--line-subtle)] pb-4">
      <MatchScore value={score} caption="Profile fit" coarse={false} size="lg" align="left" />
      <a href="#match" className="link hit-24 mt-1 flex-shrink-0 text-xs font-medium">
        See breakdown
      </a>
    </div>
  );
}

/**
 * Layer two of the explanation: what the score read, how it is made, what it
 * decides, and what to do if it looks wrong.
 *
 * Collapsed by default and deliberately so. The ICO/Turing guidance on
 * explaining AI decisions is built around *layered* delivery — the result and a
 * one-line rationale first, the mechanism underneath for anyone who wants it —
 * because a wall of methodology at the top of a panel is read by nobody and
 * serves as cover rather than as an explanation.
 *
 * The four headings are the ICO's explanation types that the score and the
 * rationale above do not already cover: data, rationale, responsibility and
 * fairness. They also happen to be what NYC Local Law 144 requires a notice to
 * state — the attributes assessed, and how to ask for an alternative — and what
 * EU AI Act Art. 86 calls the "main elements of the decision". Employment is an
 * Annex III high-risk use, so this is not decoration.
 *
 * Every claim here is one the code can stand behind. The percentages are read
 * from `MATCH_WEIGHTS` rather than retyped, so they cannot drift from the
 * scoring; "a person reads every application" is true because nothing in the
 * portal filters on this number; and there is no "contact support" link because
 * there is no support route to link to.
 */
function MatchDisclosure() {
  const pct = (weight: number) => Math.round(weight * 100);

  return (
    <details className="mt-3">
      {/* `list-none` plus the marker rule in globals.css: the default triangle
          sits on the text baseline and cannot be aligned with the eyebrow. */}
      <summary className="disclosure-summary eyebrow hit-24">How your fit is calculated</summary>

      <dl className="mt-3 space-y-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        <div>
          <Eyebrow as="dt">What we use</Eyebrow>
          <dd className="mt-1">
            Your headline, skills, experience and location, plus this job’s details. Never your name, photo or age.
          </dd>
        </div>

        <div>
          <Eyebrow as="dt">How it’s scored</Eyebrow>
          <dd className="mt-1">
            A weighted mix: experience fit {pct(MATCH_WEIGHTS.semantic)}%, skills match {pct(MATCH_WEIGHTS.skills)}%, location {pct(MATCH_WEIGHTS.location)}%,
            seniority {pct(MATCH_WEIGHTS.seniority)}%. Use it to compare jobs, not to predict a hire.
          </dd>
        </div>

        <div>
          <Eyebrow as="dt">What it affects</Eyebrow>
          <dd className="mt-1">
            Only the order of your job feed. Nothing is filtered out, it isn’t sent to the company as a recommendation, and no application is accepted or rejected because of it.
          </dd>
        </div>

        <div>
          <Eyebrow as="dt">If it looks wrong</Eyebrow>
          <dd className="mt-1">
            Scores follow your profile, so{" "}
            <Link href="/seeker/profile/edit" className="link">
              updating it
            </Link>{" "}
            updates them all. You can apply whatever your score.
          </dd>
        </div>
      </dl>
    </details>
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
      <div className="mt-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2.5 h-3.5 w-full" />
        <Skeleton className="mt-1.5 h-3.5 w-4/5" />
        <span className="sr-only">Writing a summary of this match</span>
      </div>
    );
  }

  if (!text) return null;

  return (
    <div className="mt-5">
      {/* `Icon.spark` is the kit's AI affordance everywhere else in the app, so
          the glyph is what marks this as machine-written rather than copy. */}
      <Eyebrow accent className="mb-2 flex items-center gap-1.5">
        <Icon.spark className="h-3.5 w-3.5" aria-hidden="true" />
        Why this job matches
      </Eyebrow>
      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{text}</p>
      {/* Says exactly what the sentence was written from, because that is the
          property that makes it trustworthy: the model is handed the breakdown
          below and nothing else, so it cannot claim an overlap the meters do
          not show. The second half is the framing used product-wide. */}
      <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Based on this breakdown, not your resume. A guide, not an assessment of you.
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
      <Eyebrow className="mb-1.5">You may also like</Eyebrow>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">
        Similar jobs
      </h2>
      {/* Says where the list comes from without printing a second percentage:
          a number next to the fit panel above would be read as another fit
          score, and this one measures posting against posting. */}
      <p className="mt-1 max-w-[60ch] text-sm text-gray-500 dark:text-gray-400">
        Open jobs most like this one.
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
  const location = compactLocation(job.location);
  return (
    <Card interactive className="group relative flex flex-col p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={job.company?.name ?? "Company"} logo={companyLogoSrc(job.company)} />
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
        {location && (
          <Chip
            icon={<Icon.location className="h-3.5 w-3.5" />}
            title={location.full !== location.label ? location.full : undefined}
          >
            {location.label}
          </Chip>
        )}
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

/** A bullet as posters type them: "•", "-", "*", "·", "–", or "1." / "1)". */
const BULLET = /^\s*(?:[•\-*·–▪●]|\d{1,2}[.)])\s+/;

/**
 * A line that reads as a section title: short, a handful of words, not a list
 * item and not a sentence. "The role", "What you'll do", "Requirements:".
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60 || BULLET.test(trimmed)) return false;
  if (/[.,;!?]$/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 8;
}

type DescriptionBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/**
 * Free text into headings, paragraphs and lists.
 *
 * Postings, imported ones especially, arrive as plain text with their structure
 * carried by line breaks: a short title line, then a paragraph, then "•" lines.
 * Printed as one pre-wrapped block, "The Role" and "What You'll Do" were body
 * text like everything around them and a long posting read as a wall. Nothing
 * is rewritten or dropped — every line lands in exactly one block, in order.
 */
function parseDescription(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      return;
    }
    if (BULLET.test(line)) {
      flushParagraph();
      list.push(line.replace(BULLET, ""));
      return;
    }
    // A title only when something follows it and it starts a block: a short
    // last line, or a short line in the middle of a paragraph, stays text.
    const next = lines.slice(index + 1).find((candidate) => candidate.trim());
    const startsBlock = paragraph.length === 0;
    if (startsBlock && next !== undefined && isHeadingLine(line)) {
      flushList();
      blocks.push({ kind: "heading", text: line.trim().replace(/:$/, "") });
      return;
    }
    flushList();
    paragraph.push(line);
  });
  flushParagraph();
  flushList();
  return blocks;
}

/**
 * The posting body. Capped at a comfortable reading measure; the body is free
 * text from the poster, so newlines inside a paragraph still survive.
 */
function DescriptionBody({ text }: { text: string }) {
  const blocks = parseDescription(text);
  return (
    <div className="max-w-[68ch] space-y-3 [overflow-wrap:anywhere] text-sm leading-relaxed text-gray-600 dark:text-gray-300 sm:text-base">
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h3
            key={index}
            className={`text-sm font-semibold text-gray-900 dark:text-white sm:text-base ${
              index === 0 ? "" : "pt-3"
            }`}
          >
            {block.text}
          </h3>
        ) : block.kind === "list" ? (
          <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-gray-400 dark:marker:text-gray-500">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="whitespace-pre-wrap pl-1">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-wrap">
            {block.text}
          </p>
        )
      )}
    </div>
  );
}

/** Page chrome shared by the job, the error state and the skeleton. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        {children}
      </main>
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
            <Card className="p-4 sm:p-6">
              <Skeleton className="mb-3 h-3 w-28" />
              <SkeletonText lines={4} />
            </Card>
          </div>
          <Card className="self-start p-4 sm:p-5">
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
