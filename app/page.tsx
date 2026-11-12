"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import MatchFieldArt from "@/app/components/art/MatchFieldArt";
import ResumeLensArt from "@/app/components/art/ResumeLensArt";
import HiringTrackArt from "@/app/components/art/HiringTrackArt";
import { compactLocation } from "@/app/components/JobCard";
import {
  Avatar,
  Card,
  FIT_BANDS,
  coarseFit,
  Eyebrow,
  Icon,
  IconTile,
  NumberedItem,
  Skeleton,
  StatCard,
  buttonLarge,
  buttonPrimary,
  buttonSecondary,
  formatCount,
} from "@/app/components/ui";
import { companyLogoSrc } from "@/lib/companyLogo";
import { apiFetch } from "@/lib/clientAuth";

/** Shape of `GET /api/stats` — four live counters, no invented numbers. */
interface SiteStats {
  jobs: number;
  companies: number;
  seekers: number;
  applications: number;
}

type StatsState =
  | { status: "loading" }
  | { status: "ready"; data: SiteStats }
  | { status: "failed" };

export default function Home() {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const router = useRouter();

  // Redux rehydrates from the cookie in an effect, so the first client render
  // has to match the signed-out server markup or React reports a mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [stats, setStats] = useState<StatsState>({ status: "loading" });

  // Arriving from another page via a navbar link like "/#how-it-works": the
  // router lands before the sections have their final height, so the browser's
  // own jump falls short. Scroll once the page has laid out.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    apiFetch<SiteStats>("/api/stats")
      .then((data) => {
        if (!cancelled) setStats({ status: "ready", data });
      })
      .catch(() => {
        // Marketing numbers are not worth an error banner — the section simply
        // disappears rather than showing placeholders that look like real data.
        if (!cancelled) setStats({ status: "failed" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Search is navigation only — no new data layer. The jobs feed owns the query.
  const [keyword, setKeyword] = useState("");
  const [place, setPlace] = useState("");

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const q = keyword.trim();
    const location = place.trim();
    if (q) params.set("q", q);
    if (location) params.set("location", location);
    const query = params.toString();
    router.push(query ? `/jobs?${query}` : "/jobs");
  };

  const signedIn = mounted && isAuthenticated;
  const isCompany = signedIn && user?.role === "COMPANY";
  const dashboardHref = isCompany ? "/company/dashboard" : "/seeker/dashboard";

  // The old hero always pointed "Post a Job" at /auth/register, even for a
  // company that was already signed in and one click away from posting.
  const primaryCta = isCompany
    ? { href: "/jobs/post", label: "Post a job" }
    : { href: "/jobs", label: "Find jobs" };

  const secondaryCta = signedIn
    ? { href: dashboardHref, label: "Dashboard" }
    : { href: "/auth/register", label: "Post a job" };

  const ready = stats.status === "ready" ? stats.data : null;

  /**
   * A brand-new deployment answers `/api/stats` with four zeros. "0 open roles"
   * presented as a headline figure reads as a broken page rather than a new
   * one, so the counters only appear once there is something real to count —
   * and the hero says plainly that the index is empty instead of showing a dash
   * where a number should be.
   */
  const hasCounts = ready
    ? ready.jobs + ready.companies + ready.seekers + ready.applications > 0
    : false;
  const showCounters = stats.status === "loading" || hasCounts;
  const postHref = isCompany ? "/jobs/post" : "/auth/register";

  return (
    <div className="min-h-screen">
      <Navbar />

      <main id="main-content">
        {/* ---------------------------------------------------------------- */}
        {/* Hero — graph-paper field, tight display type, left aligned         */}
        {/* ---------------------------------------------------------------- */}
        <section className="grid-field grid-field-trailing border-b border-gray-200 dark:border-gray-700">
          <div className="container-responsive grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:py-24">
            <div className="min-w-0">
            <span className="badge-pill mb-6 animate-fade-in-up">
              <span className="live-dot" aria-hidden="true" />
              AI resume matching
            </span>

            <h1 className="max-w-4xl text-4xl font-bold leading-[1.04] text-gray-900 dark:text-white sm:text-5xl lg:text-[4rem]">
              Your resume, understood.{" "}
              <span className="text-gradient sm:block">Your next job, found.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base text-gray-600 dark:text-gray-400 sm:text-lg">
              Upload your resume once. AI reads your experience and ranks every open job by how well it fits.
            </p>

            {/* Side by side even on phones: stacked full-width, these and the
                search button below made three full-width buttons in one screen,
                two of them the same filled primary. */}
            <div className="mt-8 flex flex-wrap items-center gap-3 [&>*]:flex-1 sm:[&>*]:flex-none">
              <Link href={primaryCta.href} className={`${buttonPrimary} ${buttonLarge}`}>
                {primaryCta.label}
                <Icon.arrowUpRight className="h-4 w-4" />
              </Link>
              <Link href={secondaryCta.href} className={`${buttonSecondary} ${buttonLarge}`}>
                {secondaryCta.label}
              </Link>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Search — one bordered row, keyword + location + ink button      */}
            {/* -------------------------------------------------------------- */}
            <form
              role="search"
              aria-label="Search open jobs"
              onSubmit={handleSearch}
              className="panel panel-raised mt-10 flex max-w-3xl flex-col gap-1.5 p-1.5 sm:flex-row sm:items-center"
            >
              {/* Bare inputs rather than `.field`: the two controls read as one
                  instrument, so the container carries the single hairline. */}
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                <Icon.search className="h-4 w-4 flex-shrink-0 text-gray-500" />
                <label htmlFor="hero-keyword" className="sr-only">
                  Job title, skill or company
                </label>
                <input
                  id="hero-keyword"
                  name="q"
                  type="search"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="Job title, skill or company"
                  className="field-bare w-full min-w-0 text-sm"
                />
              </div>

              <span
                className="h-px w-full bg-[var(--line)] sm:h-7 sm:w-px"
                aria-hidden="true"
              />

              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                <Icon.location className="h-4 w-4 flex-shrink-0 text-gray-500" />
                <label htmlFor="hero-location" className="sr-only">
                  Location
                </label>
                <input
                  id="hero-location"
                  name="location"
                  type="search"
                  value={place}
                  onChange={(event) => setPlace(event.target.value)}
                  placeholder="City or remote"
                  className="field-bare w-full min-w-0 text-sm"
                />
              </div>

              <button type="submit" className={`${buttonPrimary} w-full sm:w-auto`}>
                Search jobs
              </button>
            </form>

            {/* The live "Hiring now" strip that sat here repeated the open-job
                and company counts the stats band shows directly below, so the
                same figure appeared twice within one screen. Only the zero-jobs
                case keeps a note here, because then the band is hidden. */}
            {ready && ready.jobs === 0 && (
              <div className="panel mt-4 flex max-w-3xl flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No open jobs yet. New jobs appear here as soon as they’re posted.
                </p>
                <Link href={postHref} className={`${buttonSecondary} flex-shrink-0`}>
                  {isCompany ? "Post a job" : "Post the first job"}
                  <Icon.arrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
            </div>

            <MatchFieldArt className="animate-fade-in-up" />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Stats row — the same four live counters, as readouts              */}
        {/* ---------------------------------------------------------------- */}
        {showCounters && (
          <section
            className="band-sunken border-b border-gray-200 py-10 dark:border-gray-700 sm:py-14"
            aria-labelledby="stats-heading"
          >
            <div className="container-responsive">
              <h2 id="stats-heading" className="sr-only">
                NextHire in numbers
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard
                  highlight
                  label="Open jobs"
                  value={<StatValue value={ready?.jobs} label="Open jobs" />}
                  icon={<Icon.briefcase className="h-4 w-4" />}
                />
                {/* Short visible labels: the two-up phone grid truncated
                    "Companies hiring" and "Applications sent" mid-word. */}
                <StatCard
                  tone="purple"
                  label="Companies"
                  value={<StatValue value={ready?.companies} label="Companies hiring" />}
                  icon={<Icon.building className="h-4 w-4" />}
                />
                <StatCard
                  tone="purple"
                  label="Job seekers"
                  value={<StatValue value={ready?.seekers} label="Job seekers" />}
                  icon={<Icon.user className="h-4 w-4" />}
                />
                <StatCard
                  tone="purple"
                  label="Applications"
                  value={<StatValue value={ready?.applications} label="Applications sent" />}
                  icon={<Icon.document className="h-4 w-4" />}
                />
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Capabilities                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section id="features" className="py-16 sm:py-20">
          <div className="container-responsive">
            <div className="max-w-2xl">
              <Eyebrow className="mb-3">Why NextHire</Eyebrow>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                AI that does the busywork.
              </h2>
              <p className="mt-4 text-base text-gray-600 dark:text-gray-400">
                From the first upload to the interview, NextHire reads, ranks and explains.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:mt-12 md:grid-cols-2 lg:grid-cols-4">
              <Feature
                index={1}
                icon={<Icon.scan className="h-6 w-6" />}
                title="Reads your resume"
                description="Upload a PDF and your skills, seniority and experience fill in automatically."
              />
              <Feature
                index={2}
                icon={<Icon.search className="h-6 w-6" />}
                title="Search in plain words"
                description="Try “remote React jobs”. Results match on meaning, not just keywords."
              />
              <Feature
                index={3}
                icon={<Icon.target className="h-6 w-6" />}
                title="Fit you can see"
                description="Every job shows how well it fits you, which skills match and what’s missing."
              />
              <Feature
                index={4}
                icon={<Icon.lightbulb className="h-6 w-6" />}
                title="A career coach on call"
                description="Find skill gaps, draft a cover letter and practice for interviews for any job."
              />
            </div>
          </div>
        </section>

        <JobsShowcase signedIn={signedIn} isSeeker={signedIn && !isCompany} />

        {/* ---------------------------------------------------------------- */}
        {/* Dark band — how it works                                          */}
        {/* ---------------------------------------------------------------- */}
        <section id="how-it-works" className="band-dark aurora py-16 sm:py-24">
          <div className="container-responsive">
            {/* Heading on its own row, then the picture and the steps side by
                side at the same height, so neither column leaves a hole. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
              <div className="max-w-lg">
                <Eyebrow accent className="mb-4">
                  How it works
                </Eyebrow>
                <h2 className="text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
                  From sign-up to offer in four steps.
                </h2>
              </div>
              <p className="max-w-md text-base leading-relaxed text-gray-400 lg:justify-self-end lg:pb-1">
                The same simple steps for job seekers and employers. Your resume is read once, then every job is
                measured against it.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-10 sm:mt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-stretch lg:gap-16">
              <ResumeLensArt />

              <ol className="space-y-8 lg:flex lg:flex-col lg:justify-between lg:space-y-0 lg:py-6">
                <li>
                  <NumberedItem index={1} title="Create an account">
                    Join as a job seeker or an employer.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={2} title="Build your profile">
                    Upload your resume, or add your company details.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={3} title="Apply or post">
                    Find jobs that fit, or post a job and start receiving applications.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={4} title="Connect">
                    Message each other and follow every application through to the outcome.
                  </NumberedItem>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Audience split                                                    */}
        {/* ---------------------------------------------------------------- */}
        <section id="for-employers" className="py-16 sm:py-20">
          <div className="container-responsive">
            <div className="max-w-2xl">
              <Eyebrow className="mb-3">Who it’s for</Eyebrow>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                Built for both sides of hiring.
              </h2>
            </div>

            <HiringTrackArt className="mt-10" />

            <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <AudiencePanel
                eyebrow="For job seekers"
                icon={<Icon.rocket className="h-6 w-6" />}
                title="Find your next job"
                points={[
                  "Browse every open job, no account needed",
                  "Apply with your saved resume and a cover letter",
                  "Track each application from submitted to offer",
                  "Get notified when a company moves you forward",
                ]}
                action={
                  signedIn && !isCompany
                    ? { href: "/seeker/dashboard", label: "Go to dashboard" }
                    : { href: "/jobs", label: "Find jobs" }
                }
              />
              <AudiencePanel
                eyebrow="For employers"
                icon={<Icon.building className="h-6 w-6" />}
                title="Review applicants in one place"
                points={[
                  "Post a job in minutes, and edit or close it any time",
                  "See each applicant’s resume and cover letter in one list",
                  "Move applicants through each hiring stage",
                  "Message applicants directly",
                ]}
                action={
                  isCompany
                    ? { href: "/jobs/post", label: "Post a job" }
                    : { href: "/auth/register", label: "Create an employer account" }
                }
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Closing CTA — the old blue band, restated in the neutral language  */}
        {/* ---------------------------------------------------------------- */}
        <section className="pb-16 sm:pb-20">
          <div className="container-responsive">
            <Card className="surface-accent px-6 py-12 text-center sm:px-10 sm:py-16">
              <Eyebrow className="mb-3">{signedIn ? "Welcome back" : "Get started"}</Eyebrow>
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-tight text-gray-900 dark:text-white sm:text-4xl">
                {signedIn
                  ? "Pick up where you left off."
                  : "Your next job starts here."}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400 sm:text-base">
                {signedIn
                  ? "See your latest activity and what needs your attention."
                  : "Create a free account to start applying or hiring."}
              </p>
              <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <Link
                  href={signedIn ? dashboardHref : "/auth/register"}
                  className={`${buttonPrimary} ${buttonLarge}`}
                >
                  {signedIn ? "Go to dashboard" : "Create an account"}
                  <Icon.arrowUpRight className="h-4 w-4" />
                </Link>
                <Link href="/jobs" className={`${buttonSecondary} ${buttonLarge}`}>
                  Find jobs
                </Link>
              </div>
            </Card>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer — hairline rule, mono wordmark, real destinations only       */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-gray-200 bg-[var(--surface)] py-12 dark:border-gray-700 sm:py-14">
        <div className="container-responsive">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <span className="flex items-center gap-2.5">
                <span
                  className="tile tile-accent h-8 w-8"
                  aria-hidden="true"
                >
                  <Icon.graph className="h-4 w-4" />
                </span>
                <span className="wordmark text-gray-900 dark:text-white">
                  NextHire
                </span>
              </span>
              <p className="mt-4 max-w-sm text-sm text-gray-600 dark:text-gray-400">
                Connecting people with the teams hiring them.
              </p>
            </div>

            <nav aria-labelledby="footer-seekers">
              <Eyebrow as="h2" className="mb-4">
                <span id="footer-seekers">For job seekers</span>
              </Eyebrow>
              <ul className="space-y-2.5">
                <li>
                  <FooterLink href="/jobs">Browse jobs</FooterLink>
                </li>
                <li>
                  <FooterLink href="/auth/register">Create an account</FooterLink>
                </li>
                <li>
                  <FooterLink href="/auth/login">Sign in</FooterLink>
                </li>
              </ul>
            </nav>

            <nav aria-labelledby="footer-employers">
              <Eyebrow as="h2" className="mb-4">
                <span id="footer-employers">For employers</span>
              </Eyebrow>
              <ul className="space-y-2.5">
                <li>
                  <FooterLink href="/jobs/post">Post a job</FooterLink>
                </li>
                <li>
                  <FooterLink href="/auth/register">Create an employer account</FooterLink>
                </li>
                <li>
                  <FooterLink href="/auth/login">Sign in</FooterLink>
                </li>
              </ul>
            </nav>
          </div>

          <div className="mt-10 border-t border-gray-200 pt-6 dark:border-gray-700">
            {/* The year is read from the clock, and the server's clock and the
                browser's disagree either side of midnight on 31 December —
                React then throws away the server HTML for this subtree. Behind
                the same `mounted` gate the rest of the page already uses for
                client-only values; the server renders the name alone. */}
            <p className="mono text-xs text-gray-600 dark:text-gray-400">
              &copy; {mounted ? `${new Date().getFullYear()} ` : ""}NextHire. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page-local building blocks                                                  */
/* -------------------------------------------------------------------------- */

/** A live counter, or a skeleton while `/api/stats` is still in flight. */
function StatValue({ value, label }: { value?: number; label: string }) {
  if (value === undefined) {
    return (
      <>
        {/* The row keeps the height of a loaded number, so nothing moves when one
            arrives; the bar itself stays about the height of a digit. */}
        <span className="flex h-9 items-center">
          <Skeleton className="h-5 w-16" rounded="rounded-full" />
        </span>
        <span className="sr-only">Loading {label}</span>
      </>
    );
  }
  return <>{formatCount(value)}</>;
}

function Feature({
  index,
  icon,
  title,
  description,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="panel-interactive flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <span className="mono text-sm font-medium text-blue-600 dark:text-blue-400">
          {String(index).padStart(2, "0")}
        </span>
        <IconTile icon={icon} size="lg" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
    </Card>
  );
}

interface ShowcaseJob {
  id: string;
  title: string;
  location?: string | null;
  salary?: string | null;
  type?: string | null;
  skills?: string[];
  company?: { name: string; website?: string | null; logoUrl?: string | null } | null;
  match?: { score: number } | null;
}

type ShowcaseState =
  | { status: "loading" }
  | { status: "ready"; jobs: ShowcaseJob[]; recommended: boolean }
  | { status: "hidden" };

/**
 * Real jobs on the homepage: a seeker's best matches when they have a profile,
 * otherwise the newest openings. Never placeholder data — if nothing loads, the
 * section is left out.
 */
function JobsShowcase({ signedIn, isSeeker }: { signedIn: boolean; isSeeker: boolean }) {
  const [state, setState] = useState<ShowcaseState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (isSeeker) {
        try {
          const data = await apiFetch<{ jobs: ShowcaseJob[] }>("/api/jobs/recommended?limit=4");
          if (data.jobs?.length) return { jobs: data.jobs.slice(0, 4), recommended: true };
        } catch {
          // Fall through to the newest jobs.
        }
      }
      const jobs = await apiFetch<ShowcaseJob[]>("/api/jobs");
      return { jobs: Array.isArray(jobs) ? jobs.slice(0, 4) : [], recommended: false };
    };

    load()
      .then(({ jobs, recommended }) => {
        if (cancelled) return;
        setState(jobs.length ? { status: "ready", jobs, recommended } : { status: "hidden" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "hidden" });
      });

    return () => {
      cancelled = true;
    };
  }, [isSeeker, signedIn]);

  if (state.status === "hidden") return null;

  const recommended = state.status === "ready" && state.recommended;

  return (
    <section className="pb-16 sm:pb-20" aria-labelledby="jobs-showcase-heading">
      <div className="container-responsive">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="jobs-showcase-heading"
              className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl lg:text-4xl"
            >
              {recommended ? "Recommended for you" : "Latest jobs"}
            </h2>
            <p className="mt-2 text-base text-gray-600 dark:text-gray-400">
              {recommended ? "Ranked by fit with your resume." : "New openings from companies hiring now."}
            </p>
          </div>
          <Link href="/jobs" className={`${buttonSecondary} self-start sm:self-auto`}>
            View all jobs
            <Icon.arrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {state.status === "loading"
            ? Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="panel p-5" aria-hidden="true">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10" rounded="rounded-[var(--radius-control)]" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                  <Skeleton className="mt-6 h-6 w-2/5" rounded="rounded-full" />
                </div>
              ))
            : state.jobs.map((job, index) => (
                <ShowcaseJobCard key={job.id} job={job} lead={recommended && index === 0} />
              ))}
        </div>
        {state.status === "loading" && <span className="sr-only">Loading jobs</span>}
      </div>
    </section>
  );
}

function ShowcaseJobCard({ job, lead }: { job: ShowcaseJob; lead: boolean }) {
  const company = job.company?.name ?? "Company";
  const score = job.match?.score;
  const band = score !== undefined ? FIT_BANDS.find((b) => score >= b.min) : undefined;
  const meta = [company, compactLocation(job.location)?.label].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={`panel panel-interactive flex flex-col p-5 ${lead ? "panel-glow" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={company} logo={companyLogoSrc(job.company)} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{job.title}</h3>
            <p className="truncate text-sm text-gray-600 dark:text-gray-400">{meta}</p>
          </div>
        </div>
        {score !== undefined && band && (
          <p className="flex-shrink-0 text-right">
            <span className="text-gradient block text-2xl font-semibold leading-none tracking-tight">
              {coarseFit(score)}
            </span>
            <span className="eyebrow mt-1 block">{band.label} fit</span>
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(job.skills ?? []).slice(0, 3).map((skill) => (
            <span key={skill} className="chip">
              {skill}
            </span>
          ))}
          {!job.skills?.length && job.type && <span className="chip">{job.type}</span>}
        </div>
        {job.salary && (
          <span className="flex-shrink-0 text-sm font-semibold text-gray-900 dark:text-white">{job.salary}</span>
        )}
      </div>
    </Link>
  );
}

function AudiencePanel({
  eyebrow,
  icon,
  title,
  points,
  action,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  points: string[];
  action: { href: string; label: string };
}) {
  return (
    <Card className="flex h-full flex-col p-6 sm:p-8">
      <div className="mb-5 flex items-start gap-3">
        <IconTile icon={icon} size="lg" />
        <div className="min-w-0">
          <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">{title}</h3>
        </div>
      </div>

      <ul className="mb-7 flex-1 space-y-3">
        {points.map((point) => (
          <li
            key={point}
            className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400"
          >
            <Icon.check
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400"
            />
            <span>{point}</span>
          </li>
        ))}
      </ul>

      <Link href={action.href} className={`${buttonSecondary} self-start`}>
        {action.label}
        <Icon.arrowRight className="h-4 w-4" />
      </Link>
    </Card>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
    >
      {children}
    </Link>
  );
}
