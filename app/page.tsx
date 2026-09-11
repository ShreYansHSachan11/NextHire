"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import {
  Card,
  Eyebrow,
  Icon,
  NumberedItem,
  SignalPanel,
  Skeleton,
  StatCard,
  buttonLarge,
  buttonPrimary,
  buttonSecondary,
  formatCount,
} from "@/app/components/ui";
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
    : { href: "/jobs", label: "Browse roles" };

  const secondaryCta = signedIn
    ? { href: dashboardHref, label: "My dashboard" }
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
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <Navbar variant="marketing" />

      <main id="main-content">
        {/* ---------------------------------------------------------------- */}
        {/* Hero — graph-paper field, tight display type, left aligned         */}
        {/* ---------------------------------------------------------------- */}
        <section className="grid-field border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="container-responsive py-14 sm:py-20 lg:py-24">
            <Eyebrow className="mb-4">SIGNAL-BASED MATCHING</Eyebrow>

            <h1 className="max-w-4xl text-4xl font-bold leading-[1.05] text-gray-900 dark:text-white sm:text-5xl lg:text-6xl">
              Map your real experience to the roles that actually need it.
            </h1>

            <p className="mt-5 max-w-xl text-base text-gray-600 dark:text-gray-400 sm:text-lg">
              Every open role on NextHire in one searchable index — filter it down to the work
              you have actually done, apply with a stored resume, and follow each application
              through to the conversation.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
              aria-label="Search open roles"
              onSubmit={handleSearch}
              className="panel mt-10 flex max-w-3xl flex-col gap-1.5 p-1.5 sm:flex-row sm:items-center"
            >
              {/* Bare inputs rather than `.field`: the two controls read as one
                  instrument, so the container carries the single hairline. */}
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                <Icon.search className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                <label htmlFor="hero-keyword" className="sr-only">
                  Role, skill or company
                </label>
                <input
                  id="hero-keyword"
                  name="q"
                  type="search"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="Role, skill or company"
                  className="w-full min-w-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                />
              </div>

              <span
                className="h-px w-full bg-gray-200 dark:bg-gray-700 sm:h-7 sm:w-px"
                aria-hidden="true"
              />

              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                <Icon.location className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                <label htmlFor="hero-location" className="sr-only">
                  Location
                </label>
                <input
                  id="hero-location"
                  name="location"
                  type="search"
                  value={place}
                  onChange={(event) => setPlace(event.target.value)}
                  placeholder="Location or remote"
                  className="w-full min-w-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                />
              </div>

              <button type="submit" className={`${buttonPrimary} w-full sm:w-auto`}>
                Search roles
              </button>
            </form>

            {/* -------------------------------------------------------------- */}
            {/* Live signal strip — every figure comes from /api/stats          */}
            {/* -------------------------------------------------------------- */}
            {stats.status === "loading" && (
              <SignalPanel
                className="mt-4 max-w-3xl"
                live
                // An h3 here would skip a level: the nearest heading above is the
                // page h1 and the first h2 is further down the page.
                headingLevel={2}
                title="Live role graph"
                detail="Counting the roles open right now."
              />
            )}

            {ready && ready.jobs > 0 && (
              <SignalPanel
                className="mt-4 max-w-3xl"
                live
                headingLevel={2}
                title="Live role graph"
                // `formatCount` on both halves: the sentence and the readout
                // beside it are the same figure, and they used to disagree
                // above a thousand ("1,200 open roles" next to "1.2k").
                // `toLocaleString()` with no locale also follows the visitor's
                // runtime, while the readout is hard-coded English either way.
                detail={`${formatCount(ready.jobs)} open roles mapped across ${formatCount(
                  ready.companies
                )} companies.`}
                value={formatCount(ready.jobs)}
                valueLabel="OPEN ROLES"
              />
            )}

            {ready && ready.jobs === 0 && (
              <div className="panel mt-4 flex max-w-3xl flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No roles are open here yet. New postings show up in the index the moment they
                  go live.
                </p>
                <Link href={postHref} className={`${buttonSecondary} flex-shrink-0`}>
                  {isCompany ? "Post a role" : "Post the first role"}
                  <Icon.arrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Stats row — the same four live counters, as readouts              */}
        {/* ---------------------------------------------------------------- */}
        {showCounters && (
          <section
            className="border-b border-gray-200 bg-gray-50 py-10 dark:border-gray-700 dark:bg-gray-950 sm:py-14"
            aria-labelledby="stats-heading"
          >
            <div className="container-responsive">
              <h2 id="stats-heading" className="sr-only">
                NextHire in numbers
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard
                  label="Open roles"
                  value={<StatValue value={ready?.jobs} label="Open roles" />}
                  icon={
                    <StatIcon accent>
                      <Icon.briefcase className="h-4 w-4" />
                    </StatIcon>
                  }
                />
                <StatCard
                  label="Companies hiring"
                  value={<StatValue value={ready?.companies} label="Companies hiring" />}
                  icon={
                    <StatIcon>
                      <Icon.badge className="h-4 w-4" />
                    </StatIcon>
                  }
                />
                <StatCard
                  label="Job seekers"
                  value={<StatValue value={ready?.seekers} label="Job seekers" />}
                  icon={
                    <StatIcon>
                      <Icon.user className="h-4 w-4" />
                    </StatIcon>
                  }
                />
                <StatCard
                  label="Applications sent"
                  value={<StatValue value={ready?.applications} label="Applications sent" />}
                  icon={
                    <StatIcon>
                      <Icon.document className="h-4 w-4" />
                    </StatIcon>
                  }
                />
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Capabilities                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section id="features" className="bg-white py-16 dark:bg-gray-900 sm:py-20">
          <div className="container-responsive">
            <div className="max-w-2xl">
              <Eyebrow className="mb-3">WHAT THE PLATFORM DOES</Eyebrow>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                Three surfaces, one signal path.
              </h2>
              <p className="mt-4 text-base text-gray-600 dark:text-gray-400">
                A role is posted, a profile is read against it, and the two sides end up in the
                same thread. Nothing leaks into a spreadsheet along the way.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 sm:mt-12">
              <Feature
                eyebrow="ROLE INDEX"
                icon={<Icon.graph className="h-5 w-5" />}
                title="One searchable index"
                description="Every live posting in a single feed you can filter by location, type and experience. The filter options are read off the live postings, so nothing is offered that does not exist."
              />
              <Feature
                eyebrow="APPLY ONCE"
                icon={<Icon.pulse className="h-5 w-5" />}
                title="Signal, not paperwork"
                description="Store a resume once and attach an optional cover note. Each application then carries its own state — pending, shortlisted, interview, offer — legible at a glance."
              />
              <Feature
                eyebrow="DIRECT LINE"
                icon={<Icon.chat className="h-5 w-5" />}
                title="Straight to the hiring team"
                description="Messaging and notifications are built in, so a shortlist or an interview invite reaches you here rather than in a forwarded email thread."
                className="md:col-span-2 lg:col-span-1"
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Dark band — how it works                                          */}
        {/* ---------------------------------------------------------------- */}
        <section id="how-it-works" className="band-dark py-16 sm:py-24">
          <div className="container-responsive">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
              <div className="max-w-lg">
                <Eyebrow accent className="mb-4">
                  HOW IT WORKS
                </Eyebrow>
                <h2 className="text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
                  From an empty account to a real conversation, without leaving the platform.
                </h2>
                <p className="mt-5 text-base leading-relaxed text-gray-400">
                  Four steps, the same four for both sides of a hire. Everything a candidate
                  sends and everything a company decides stays attached to the role it belongs to.
                </p>
              </div>

              <ol className="space-y-8">
                <li>
                  <NumberedItem index={1} title="Create an account">
                    Sign up as a job seeker or as an employer — an employer account comes with a
                    company workspace attached.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={2} title="Complete your profile">
                    Seekers upload a resume; companies fill in the details candidates ask about
                    first. This is the signal everything else is matched against.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={3} title="Find or post">
                    Browse the index and filter it down, or publish a role and watch applications
                    arrive against it.
                  </NumberedItem>
                </li>
                <li>
                  <NumberedItem index={4} title="Connect">
                    Apply, shortlist, message and move candidates through the stages — every
                    state change is recorded on the application itself.
                  </NumberedItem>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Audience split                                                    */}
        {/* ---------------------------------------------------------------- */}
        <section className="bg-white py-16 dark:bg-gray-900 sm:py-20">
          <div className="container-responsive">
            <div className="max-w-2xl">
              <Eyebrow className="mb-3">TWO SIDES, ONE HIRE</Eyebrow>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl lg:text-4xl">
                Each side gets its own workspace.
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <AudiencePanel
                eyebrow="FOR JOB SEEKERS"
                icon={<Icon.user className="h-5 w-5" />}
                title="Find the role your work already fits"
                points={[
                  "Search and filter every open role, free and without an account",
                  "Apply with a stored resume and an optional cover note",
                  "Track each application's state — pending, shortlisted, interview, offer",
                  "Get notified the moment a company moves you forward",
                ]}
                action={
                  signedIn && !isCompany
                    ? { href: "/seeker/dashboard", label: "Go to my dashboard" }
                    : { href: "/jobs", label: "Browse open roles" }
                }
              />
              <AudiencePanel
                eyebrow="FOR EMPLOYERS"
                icon={<Icon.briefcase className="h-5 w-5" />}
                title="Read the applicants, not the inbox"
                points={[
                  "Publish a role in a couple of minutes, edit or close it any time",
                  "See every applicant, their resume and their cover note in one list",
                  "Move candidates through stages and keep the whole team in sync",
                  "Message shortlisted candidates directly from the application",
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
        <section className="bg-white pb-16 dark:bg-gray-900 sm:pb-20">
          <div className="container-responsive">
            <Card grid className="px-6 py-10 text-center sm:px-10 sm:py-12">
              <Eyebrow className="mb-3">{signedIn ? "WELCOME BACK" : "GET STARTED"}</Eyebrow>
              <h2 className="mx-auto max-w-xl text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
                {signedIn
                  ? "Pick up where you left off."
                  : "Put your experience where it can be matched."}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400 sm:text-base">
                {signedIn
                  ? "Your dashboard has your latest activity and everything waiting on you."
                  : "Create an account and start applying — or start hiring — today."}
              </p>
              <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <Link
                  href={signedIn ? dashboardHref : "/auth/register"}
                  className={`${buttonPrimary} ${buttonLarge}`}
                >
                  {signedIn ? "Open my dashboard" : "Create an account"}
                  <Icon.arrowUpRight className="h-4 w-4" />
                </Link>
                <Link href="/jobs" className={`${buttonSecondary} ${buttonLarge}`}>
                  Browse roles
                </Link>
              </div>
            </Card>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer — hairline rule, mono wordmark, real destinations only       */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-gray-200 bg-white py-12 dark:border-gray-700 dark:bg-gray-900 sm:py-14">
        <div className="container-responsive">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <span className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-green-600 dark:border-gray-700 dark:bg-gray-800 dark:text-green-400"
                  aria-hidden="true"
                >
                  <Icon.graph className="h-4 w-4" />
                </span>
                <span className="mono text-sm font-semibold uppercase tracking-[0.18em] text-gray-900 dark:text-white">
                  NextHire
                </span>
              </span>
              <p className="mt-4 max-w-sm text-sm text-gray-600 dark:text-gray-400">
                Connecting people looking for work with the teams looking for them — post a role,
                apply to one, and keep the whole conversation in one place.
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
                  <FooterLink href="/auth/register">Create a profile</FooterLink>
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
              &copy; {mounted ? `${new Date().getFullYear()} ` : ""}NEXTHIRE — ALL RIGHTS RESERVED
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

/**
 * `StatCard` tints its icon slot by `tone`, but accent discipline says emerald
 * belongs to live/match signal only. A nested colour wins over the inherited
 * one, so the row stays neutral apart from the single live metric.
 */
function StatIcon({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={accent ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}>
      {children}
    </span>
  );
}

/** A live counter, or a skeleton while `/api/stats` is still in flight. */
function StatValue({ value, label }: { value?: number; label: string }) {
  if (value === undefined) {
    return (
      <>
        <Skeleton className="h-6 w-14" />
        <span className="sr-only">Loading {label}</span>
      </>
    );
  }
  return <>{formatCount(value)}</>;
}

function Feature({
  eyebrow,
  icon,
  title,
  description,
  className = "",
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card className={`p-6 ${className}`}>
      <span
        className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
        aria-hidden="true"
      >
        {icon}
      </span>
      <Eyebrow className="mb-2">{eyebrow}</Eyebrow>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
    </Card>
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
        <span
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          aria-hidden="true"
        >
          {icon}
        </span>
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
