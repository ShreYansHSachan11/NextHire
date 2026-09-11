"use client";

import React, { useCallback, useEffect, useState } from "react";
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

/** The cover letter the API stores; anything past this is truncated server-side. */
const MESSAGE_LIMIT = 2000;

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

  const handleApply = async () => {
    if (!isAuthenticated) {
      router.push(`/auth/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
      return;
    }

    try {
      setApplying(true);
      setApplyError("");

      const trimmed = message.trim();
      const application = await apiFetch<JobApplication>("/api/applications", {
        method: "POST",
        // No `userId`: the server takes the applicant from the session. The
        // blank field is genuinely optional now — it used to be silently
        // replaced with "I'm interested in this position".
        body: JSON.stringify({ jobId, message: trimmed || undefined }),
      });

      setSubmitted(application);
      setMessage("");
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
              className="mono flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 text-lg font-semibold text-white dark:bg-gray-100 dark:text-gray-900 sm:h-14 sm:w-14 sm:text-xl"
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
          {match && <MatchPanel match={match} />}

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
 * The match breakdown.
 *
 * The point of showing all four facets rather than one number is that "78%"
 * with nothing behind it invites distrust — and a seeker can act on "skills
 * overlap is thin" in a way they cannot act on a composite. Rendered only when
 * a breakdown actually exists; there is no zero state here by design.
 */
function MatchPanel({ match }: { match: MatchBreakdown }) {
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
    <Card className="group relative flex flex-col p-4 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mono flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 text-sm font-semibold text-white dark:bg-gray-100 dark:text-gray-900"
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
        <div className="motion-safe:animate-pulse">
          <div className="mb-6 flex items-start gap-4">
            <div className="h-12 w-12 flex-shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 sm:h-14 sm:w-14" />
            <div className="flex-1 space-y-3">
              <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-7 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
          <div className="lg:col-span-2">
            <Card grid className="p-4 sm:p-6">
              <div className="motion-safe:animate-pulse space-y-3">
                <div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-4/6 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </Card>
          </div>
          <Card grid className="p-4 sm:p-5">
            <div className="motion-safe:animate-pulse space-y-4">
              <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-24 rounded-lg bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
          </Card>
        </div>
      </div>
      <span className="sr-only">Loading job</span>
    </PageShell>
  );
}
