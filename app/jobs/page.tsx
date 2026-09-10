"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { setJobs } from "@/store/jobsSlice";
import type { RootState, AppDispatch } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import {
  Alert,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  Label,
  MatchScore,
  Meter,
  PageHeading,
  buttonGhost,
  buttonPrimary,
  formatCount,
  formatDate,
  inputClass,
} from "@/app/components/ui";
import { apiFetch } from "@/lib/clientAuth";
import { JOB_TYPES } from "@/lib/validation";

/**
 * Mirror of `MatchBreakdown` in `lib/ai/matching.ts`.
 *
 * The headline figure is a weighted blend of the four facets, and every facet
 * rides along so the UI can show what produced it. Declared locally rather than
 * imported because that module reaches for Prisma and must never be pulled into
 * a client bundle.
 */
interface MatchBreakdown {
  score: number;
  facets: { semantic: number; skills: number; location: number; seniority: number };
  sharedSkills: string[];
  missingSkills: string[];
}

/**
 * One row of `GET /api/jobs`. The feed is active-only, so `isActive` is always
 * true here. Nullable columns come back as `null`, matching `jobsSlice`, so the
 * list round-trips through Redux without a cast.
 *
 * `match` and `relevance` are optional on purpose: the first is present only
 * for a signed-in seeker with an indexed profile, the second only on the
 * results of a `?q=` search. Everything that renders them is gated on the
 * value actually being there.
 */
interface JobListItem {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  companyId: string;
  company?: { id?: string; name: string; profile?: string | null };
  createdAt: string;
  isActive: boolean;
  _count?: { applications: number };
  skills?: string[];
  match?: MatchBreakdown | null;
  /** 0-100 retrieval score, present only on results of a `?q=` search. */
  relevance?: number | null;
}

/** The `?meta=1` envelope. Without it the route still returns a bare array. */
interface JobFeedResponse {
  jobs: JobListItem[];
  /** True when the server ranked these rows by semantic relevance. */
  semantic: boolean;
  /** True when the caller is a seeker whose profile has a vector. */
  matched: boolean;
}

type SortKey = "newest" | "applicants" | "match";

interface Filters {
  location: string;
  experience: string;
  type: string;
}

const EMPTY_FILTERS: Filters = { location: "", experience: "", type: "" };

/** A posting is flagged "New" for its first week on the feed. */
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Evidence, not decoration - three named skills is enough to earn a score. */
const CARD_SKILL_LIMIT = 3;

/**
 * `useSearchParams` opts the subtree into client-side rendering, which Next 15
 * only allows underneath a Suspense boundary. The fallback is the same shell as
 * the loading state, so the page never flashes an empty frame.
 */
export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <FeedShell>
          <JobSkeletonGrid />
        </FeedShell>
      }
    >
      <JobsFeed />
    </Suspense>
  );
}

function JobsFeed() {
  const dispatch = useDispatch<AppDispatch>();
  const jobList: JobListItem[] = useSelector((state: RootState) => state.jobs.jobs);
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  // The homepage hero links here as `/jobs?q=…&location=…`. They seed the local
  // state once; from then on this is ordinary local state, so editing a field
  // does not need to round-trip through the URL.
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const initialLocation = searchParams.get("location")?.trim() ?? "";

  const [loading, setLoading] = useState(true);
  // A search re-request must not blank the list out from under the reader, so
  // only the first load shows skeletons; later ones dim the grid in place.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Two pieces of search state: what the user is typing, and the debounced
  // value that actually drives the request. Search is a server round-trip now,
  // so firing on every keystroke would spend an embedding call per character.
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, location: initialLocation });
  const [sort, setSort] = useState<SortKey>("newest");

  // Read off the `?meta=1` envelope: `semantic` says the server ranked these
  // rows, `matched` says the caller has an indexed profile.
  const [semantic, setSemantic] = useState(false);
  const [matched, setMatched] = useState<boolean | null>(null);
  const [indexHintDismissed, setIndexHintDismissed] = useState(false);

  // Redux rehydrates the session from the cookie inside an effect, so the first
  // client render must not assume a role. The fetch is unaffected: `apiFetch`
  // reads the cookie directly, so matches arrive on the very first call.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fetchJobs = useCallback(
    async (term: string) => {
      try {
        setRefreshing(true);
        setError("");

        const params = new URLSearchParams({ meta: "1" });
        // An empty term is simply omitted, which returns the plain listing.
        if (term) params.set("q", term);

        const data = await apiFetch<JobFeedResponse>(`/api/jobs?${params.toString()}`);
        dispatch(setJobs(data.jobs));
        setSemantic(data.semantic);
        setMatched(data.matched);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [dispatch]
  );

  // The debounced term is the only fetch key. Deliberately not keyed on the
  // signed-in user: the cookie is already on the first request, so re-running
  // when Redux rehydrates would just double every page load.
  useEffect(() => {
    void fetchJobs(search);
  }, [fetchJobs, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  /**
   * Filter options come from the postings themselves.
   *
   * They used to be a fixed list (Bangalore / Mumbai / Remote, Full Time /
   * Remote / Internship) that had nothing to do with what the post-a-job form
   * writes, so most selections matched zero jobs.
   */
  const locationOptions = useMemo(() => collect(jobList, (job) => job.location), [jobList]);
  const experienceOptions = useMemo(() => collect(jobList, (job) => job.experience), [jobList]);
  const typeOptions = useMemo(() => {
    const options = collect(jobList, (job) => job.type);
    // Known types keep the canonical order; anything free-text follows it.
    const rank = (label: string) => {
      const index = (JOB_TYPES as readonly string[]).indexOf(label);
      return index === -1 ? JOB_TYPES.length : index;
    };
    return [...options].sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  }, [jobList]);

  const hasFilters = Boolean(search || filters.location || filters.experience || filters.type);

  // "Best match" only exists when there is something to sort by. Anonymous
  // visitors, company accounts and un-indexed seekers never see the option.
  const hasMatches = useMemo(() => jobList.some((job) => job.match), [jobList]);
  // Covers the case where the option disappears (a sign-out, or a result set
  // with no scored rows) while "match" is still the selected value.
  const activeSort: SortKey = sort === "match" && !hasMatches ? "newest" : sort;

  const visibleJobs = useMemo(() => {
    // When the server ranked semantically, its result set *is* the answer for
    // this term, so no substring test is applied on top: that would discard
    // exactly the rows semantic retrieval exists to surface - the role that
    // never says "frontend" but is one. The selects still apply, because those
    // are facts about the posting rather than a guess at relevance.
    const needle = semantic ? "" : search.toLowerCase();

    const filtered = jobList.filter((job) => {
      if (needle) {
        const haystack = [job.title, job.company?.name, job.description, job.location, job.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (!equalsIgnoreCase(job.location, filters.location)) return false;
      if (!equalsIgnoreCase(job.experience, filters.experience)) return false;
      if (!equalsIgnoreCase(job.type, filters.type)) return false;
      return true;
    });

    // Sorting by match is done in memory rather than by re-requesting with
    // `&sort=match`: the scores are already on the rows, so ordering them here
    // is instant and costs no round-trip. The server's `?sort=match` stays
    // available for any client that pages instead of loading the feed whole.
    if (activeSort === "match") {
      // Unscored rows sort to the end, not the top - which is what `?? -1`
      // buys over `?? 0`, and mirrors what the route does server-side.
      return [...filtered].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
    }
    if (activeSort === "applicants") {
      return [...filtered].sort(
        (a, b) => (b._count?.applications ?? 0) - (a._count?.applications ?? 0)
      );
    }
    // Default order. Under a semantic search that order is already the server's
    // relevance ranking, so re-sorting by date here would throw it away.
    if (semantic) return filtered;
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [jobList, search, semantic, filters, activeSort]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters(EMPTY_FILTERS);
  };

  // One quiet nudge, shown only to the person it can help: a signed-in seeker
  // whose profile has no vector yet. Everyone else sees the feed unchanged.
  const showIndexHint =
    mounted &&
    isAuthenticated &&
    user?.role === "SEEKER" &&
    matched === false &&
    !indexHintDismissed &&
    !error;

  return (
    <FeedShell>
      <PageHeading
        eyebrow="Live job feed"
        title="Open roles"
        description="Every role currently accepting applications on NextHire."
        className="mb-6"
      />

      {error && (
        <Alert variant="error" className="mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => void fetchJobs(search)} className={buttonPrimary}>
              Try again
            </button>
          </div>
        </Alert>
      )}

      {/* Search + filters: one hairline bar rather than a stack of boxed rows. */}
      <section aria-label="Search and filter jobs" className="mb-5 sm:mb-6">
        <Card className="p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(11rem,1fr)_repeat(4,minmax(0,9.5rem))] lg:items-end">
            <div className="min-w-0">
              <Label htmlFor="job-search">Search</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 dark:text-gray-500"
                  aria-hidden="true"
                >
                  <Icon.search className="h-4 w-4" />
                </span>
                <input
                  id="job-search"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Title, company, keyword…"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>

            <FilterSelect
              id="filter-location"
              label="Location"
              allLabel="All locations"
              value={filters.location}
              options={locationOptions}
              onChange={(value) => setFilters((current) => ({ ...current, location: value }))}
            />
            <FilterSelect
              id="filter-experience"
              label="Experience"
              allLabel="All levels"
              value={filters.experience}
              options={experienceOptions}
              onChange={(value) => setFilters((current) => ({ ...current, experience: value }))}
            />
            <FilterSelect
              id="filter-type"
              label="Job type"
              allLabel="All types"
              value={filters.type}
              options={typeOptions}
              onChange={(value) => setFilters((current) => ({ ...current, type: value }))}
            />

            <div className="min-w-0">
              <Label htmlFor="sort-jobs">Sort</Label>
              <select
                id="sort-jobs"
                value={activeSort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className={inputClass}
              >
                {/* Same value, honest label: the default order under a semantic
                    search is the server's relevance ranking, not the date. */}
                <option value="newest">{semantic ? "Best relevance" : "Newest first"}</option>
                <option value="applicants">Most applicants</option>
                {hasMatches && <option value="match">Best match</option>}
              </select>
            </div>
          </div>
        </Card>
      </section>

      {showIndexHint && (
        <Alert variant="info" className="mb-4 sm:mb-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span>
              Your profile isn&rsquo;t indexed yet, so these roles aren&rsquo;t scored for fit.{" "}
              <Link
                href="/seeker/dashboard"
                className="font-semibold underline underline-offset-2 hover:no-underline"
              >
                Add a r&eacute;sum&eacute; or profile details
              </Link>
              .
            </span>
            <button
              type="button"
              onClick={() => setIndexHintDismissed(true)}
              className="eyebrow flex-shrink-0 rounded p-1 hover:text-gray-900 dark:hover:text-white"
            >
              <Icon.x className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        </Alert>
      )}

      {/* Result count, read as instrument output: "12 ROLES MATCHED". */}
      {!loading && !error && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-5"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Eyebrow as="span">
              {visibleJobs.length === 0
                ? "No roles matched"
                : `${visibleJobs.length} ${visibleJobs.length === 1 ? "role" : "roles"} matched`}
              {hasFilters && !semantic && visibleJobs.length > 0 && (
                <span className="text-gray-400 dark:text-gray-500"> / {jobList.length} total</span>
              )}
            </Eyebrow>

            {/* Explains why a result with no keyword overlap is on the list. */}
            {semantic && (
              <Eyebrow as="span" accent className="inline-flex items-center gap-1">
                <Icon.spark className="h-3.5 w-3.5" aria-hidden="true" />
                Semantic match
              </Eyebrow>
            )}
          </div>

          {hasFilters && (
            <button type="button" onClick={clearFilters} className={buttonGhost}>
              <Icon.x className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <JobSkeletonGrid />
      ) : visibleJobs.length > 0 ? (
        <div
          className={`grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-2 lg:gap-5 ${
            refreshing ? "opacity-60" : ""
          }`}
          aria-busy={refreshing}
        >
          {visibleJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      ) : (
        !error && (
          <Card>
            <EmptyState
              icon={<Icon.briefcase className="h-6 w-6" />}
              title={hasFilters ? "No jobs found" : "No open roles right now"}
              description={
                hasFilters
                  ? "Try a different search term, or widen the filters."
                  : "Nothing is being advertised at the moment. Check back soon."
              }
              action={
                hasFilters ? (
                  <button type="button" onClick={clearFilters} className={buttonPrimary}>
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          </Card>
        )
      )}
    </FeedShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/** Page chrome shared by the feed and its Suspense fallback. */
function FeedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

interface Option {
  label: string;
  count: number;
}

/** Unique, sorted, counted values for one field of the current job list. */
function collect(jobs: JobListItem[], pick: (job: JobListItem) => string | null | undefined): Option[] {
  // Keyed by lowercase so "remote" and "Remote" collapse into one option, but
  // the first spelling seen is what gets shown.
  const seen = new Map<string, Option>();

  for (const job of jobs) {
    const raw = pick(job)?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const existing = seen.get(key);
    if (existing) existing.count += 1;
    else seen.set(key, { label: raw, count: 1 });
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Empty filter means "any"; otherwise compare without caring about case. */
function equalsIgnoreCase(value: string | null | undefined, filter: string): boolean {
  if (!filter) return true;
  return (value ?? "").trim().toLowerCase() === filter.trim().toLowerCase();
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  // A value arriving from the URL (or from a list that has since narrowed) may
  // not be among the derived options. Without this the select would render
  // blank while the filter was silently still applied.
  const isUnlisted =
    Boolean(value) && !options.some((option) => option.label.toLowerCase() === value.toLowerCase());

  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={options.length === 0 && !isUnlisted}
        className={inputClass}
      >
        <option value="">{allLabel}</option>
        {isUnlisted && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </div>
  );
}

function JobCard({ job }: { job: JobListItem }) {
  const applicants = job._count?.applications ?? 0;
  const isNew = Date.now() - new Date(job.createdAt).getTime() < NEW_WINDOW_MS;

  // Every match affordance hangs off this one binding. When it is null - an
  // anonymous visitor, a company account, a seeker with no indexed profile, or
  // no `GEMINI_API_KEY` at all - the card renders exactly as it did before
  // matching existed. That is the whole contract.
  const match = job.match ?? null;
  const sharedSkills = match?.sharedSkills.slice(0, CARD_SKILL_LIMIT) ?? [];
  const extraSkills = (match?.sharedSkills.length ?? 0) - sharedSkills.length;

  return (
    // The card is a plain surface and the title carries the only anchor, which
    // is stretched over the card with `after:absolute`. That keeps one link per
    // card with the role title as its accessible name, while the whole tile
    // stays clickable.
    <Card className="group relative flex flex-col p-4 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mono flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 text-base font-semibold text-white dark:bg-gray-100 dark:text-gray-900"
            aria-hidden="true"
          >
            {job.company?.name?.charAt(0).toUpperCase() ?? "C"}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-gray-900 dark:text-white sm:text-lg">
              <Link href={`/jobs/${job.id}`} className="after:absolute after:inset-0 after:rounded-xl">
                <span className="line-clamp-2">{job.title}</span>
              </Link>
            </h2>
            <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
              {job.company?.name ?? "Company"}
              {job.location && (
                <>
                  <span aria-hidden="true"> · </span>
                  {job.location}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          {/* The feed only ever returns open roles, so the old Active/Inactive
              badge was always green. Recency is the useful signal instead, and
              a fresh posting is exactly the "live" state emerald is for. */}
          {isNew && (
            <span className="mono rounded-md border border-green-300 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
              New
            </span>
          )}
          {/* The score takes the prominent slot; the applicant count stays,
              one line down, because it is still the competitive signal. */}
          {match && <MatchScore value={match.score} caption="Profile fit" />}
          <Eyebrow as="span">{formatCount(applicants)} applied</Eyebrow>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        {job.description}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.location && <Chip icon={<Icon.location className="h-3.5 w-3.5" />}>{job.location}</Chip>}
        {job.type && <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>}
        {job.experience && (
          <Chip icon={<Icon.briefcase className="h-3.5 w-3.5" />}>{job.experience} years</Chip>
        )}
        {job.salary && <Chip icon={<Icon.money className="h-3.5 w-3.5" />}>{job.salary}</Chip>}
      </div>

      {/* A number on its own is an assertion. These are the receipts for it. */}
      {sharedSkills.length > 0 && (
        <div className="mt-3">
          <Eyebrow accent className="mb-1.5">
            Matched skills
          </Eyebrow>
          <div className="flex flex-wrap items-center gap-1.5">
            {sharedSkills.map((skill) => (
              <Chip key={skill} accent>
                {skill}
              </Chip>
            ))}
            {extraSkills > 0 && <Eyebrow as="span">+{extraSkills} more</Eyebrow>}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
        <Eyebrow as="span">Posted {formatDate(job.createdAt)}</Eyebrow>
        <span
          className="flex items-center gap-1 text-xs font-semibold text-gray-400 transition-colors group-hover:text-gray-900 dark:text-gray-500 dark:group-hover:text-white"
          aria-hidden="true"
        >
          View
          <Icon.arrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>

      {/* The score again, as length rather than digits: legible at a glance
          across a two-column grid, and neutral rather than red when it is low. */}
      {match && (
        <Meter
          value={match.score}
          label={`Profile fit: ${match.score} out of 100`}
          className="mt-3"
        />
      )}
    </Card>
  );
}

/** Card-shaped placeholders, so the layout doesn't jump when the data lands. */
function JobSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} grid className="p-4 sm:p-5">
          <div className="motion-safe:animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 flex-shrink-0 rounded-md bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 w-1/3 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-3 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mt-4 flex gap-1.5">
              <div className="h-6 w-20 rounded-lg bg-gray-200 dark:bg-gray-700" />
              <div className="h-6 w-24 rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mt-4 h-3 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </Card>
      ))}
      <span className="sr-only">Loading jobs</span>
    </div>
  );
}
