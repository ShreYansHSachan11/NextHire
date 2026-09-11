"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { setJobs } from "@/store/jobsSlice";
import type { RootState, AppDispatch } from "@/store/store";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
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
  Spinner,
  buttonGhost,
  buttonPrimary,
  formatCount,
  formatDate,
  inputClass,
} from "@/app/components/ui";
import { apiFetch } from "@/lib/clientAuth";

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

/**
 * Mirror of `SearchFilterChip` in `lib/ai/search.ts`, declared locally for the
 * same reason `MatchBreakdown` is: that module imports Prisma.
 *
 * `token` is the literal text from the query that produced the filter, which is
 * the whole removal mechanism — see `queryWithoutToken`.
 *
 * `location` is in the union ahead of the parser that produces it, so that a
 * chip arriving from a newer server is typed rather than cast at the one place
 * it matters (`overridden`, below).
 */
interface SearchFilterChip {
  key: "remote" | "seniority" | "type" | "minSalary" | "location";
  label: string;
  token: string;
}

/** `lexical` means the vector arm was unavailable, not that it found nothing. */
type SearchMode = "hybrid" | "lexical" | "filters";

/** One option for a select, counted over the corpus — see `facets` below. */
interface Facet {
  value: string;
  count: number;
}

/**
 * The filterable corpus, as the server describes it.
 *
 * These used to be derived from the rows on screen, which made the options
 * describe the *result set*: searching "frontend" collapsed the Location list to
 * the handful of locations among the hits, offering almost nothing to filter by
 * at exactly the moment the user wanted to narrow. Each list is now counted
 * server-side over every active posting (narrowed by the *other* two selects, so
 * a count is what picking that option would actually yield).
 */
interface FeedFacets {
  location: Facet[];
  experience: Facet[];
  type: Facet[];
  /** Active postings in total, ignoring every filter. */
  total: number;
}

const EMPTY_FACETS: FeedFacets = { location: [], experience: [], type: [], total: 0 };

/** The `?meta=1` envelope. Without it the route still returns a bare array. */
interface JobFeedResponse {
  jobs: JobListItem[];
  /** True when the server ranked these rows by semantic relevance. */
  semantic: boolean;
  /** True when the caller is a seeker whose profile has a vector. */
  matched: boolean;
  /** How the query was understood. Empty for a listing with no `?q=`. */
  chips: SearchFilterChip[];
  /** Null when no search ran. */
  mode: SearchMode | null;
  /** What the server actually filtered on, normalised. */
  filters: { location: string | null; experience: string | null; type: string | null };
  /** The text actually searched, once overruled filters were cut out of it. */
  query: string;
  /** Options for the three selects. */
  facets: FeedFacets;
  /** Filters the query implied that an explicit select overruled. */
  overridden: SearchFilterChip[];
  /** True when the listing hit the server's page cap. */
  truncated: boolean;
}

/**
 * `relevance` is a real value, not a label on top of `newest`.
 *
 * The select used to show "Best relevance" while holding `newest`, which was
 * true about the order and false about the control: there was then no way to ask
 * for date order during a search. The URL contract is untouched — this page has
 * never put `sort` in the URL, and the server's own `?sort=match` is unchanged.
 */
type SortKey = "relevance" | "newest" | "applicants" | "match";

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
  /**
   * `null` is "whatever this result set's natural order is" — relevance under a
   * search, date otherwise — rather than a fourth sort key. Once the user picks
   * one it stays picked, including across a search starting or ending.
   */
  const [sort, setSort] = useState<SortKey | null>(null);

  // Read off the `?meta=1` envelope: `semantic` says the server ranked these
  // rows, `matched` says the caller has an indexed profile.
  const [semantic, setSemantic] = useState(false);
  const [matched, setMatched] = useState<boolean | null>(null);
  const [indexHintDismissed, setIndexHintDismissed] = useState(false);

  // The filter bar's options, and the size of the corpus they describe. Held
  // across a refresh rather than cleared, so the selects do not blink empty
  // between requests.
  const [facets, setFacets] = useState<FeedFacets>(EMPTY_FACETS);
  /** Inferred filters the selects overruled; shown, never silently dropped. */
  const [overridden, setOverridden] = useState<SearchFilterChip[]>([]);
  /**
   * The text the server searched on, which is what the box says minus anything
   * a select overruled. It is the honest needle for the keyword fallback below:
   * filtering on a word the server deliberately stopped applying would undo the
   * override one layer further down.
   */
  const [searchedQuery, setSearchedQuery] = useState("");
  /** True when more rows match than the server will return in one page. */
  const [truncated, setTruncated] = useState(false);

  // How the server read the query. `chips` are the filters it inferred and
  // silently applied; showing them back is the point of the feature.
  const [chips, setChips] = useState<SearchFilterChip[]>([]);
  const [mode, setMode] = useState<SearchMode | null>(null);
  /**
   * The query the chips describe.
   *
   * Held separately from `search` because the debounce means the box can be a
   * keystroke ahead of the response; rebuilding from the newer string would cut
   * a span out of text the server never parsed.
   */
  const [chipQuery, setChipQuery] = useState("");

  // Redux rehydrates the session from the cookie inside an effect, so the first
  // client render must not assume a role. The fetch is unaffected: `apiFetch`
  // reads the cookie directly, so matches arrive on the very first call.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fetchJobs = useCallback(
    async (term: string, selects: Filters) => {
      try {
        setRefreshing(true);
        setError("");

        const params = new URLSearchParams({ meta: "1" });
        // An empty term is simply omitted, which returns the plain listing.
        if (term) params.set("q", term);
        // The selects go to the server now: they are `where` clauses applied
        // before its page cap, so a match on posting 201 is findable instead of
        // invisible. Empty means "any", and is left off the query string.
        if (selects.location) params.set("location", selects.location);
        if (selects.experience) params.set("experience", selects.experience);
        if (selects.type) params.set("type", selects.type);

        const data = await apiFetch<JobFeedResponse>(`/api/jobs?${params.toString()}`);
        dispatch(setJobs(data.jobs));
        setSemantic(data.semantic);
        setMatched(data.matched);
        // Defensive `?? []`: the bare-array shape is still what the route
        // returns without `?meta=1`, and an older deployment may not send these.
        setChips(data.chips ?? []);
        setMode(data.mode ?? null);
        setChipQuery(term);
        // `?? term` for an older server, which searched the term as typed.
        setSearchedQuery(data.query ?? term);
        setOverridden(data.overridden ?? []);
        setTruncated(data.truncated ?? false);
        // Kept from the previous response when absent, rather than blanked: an
        // older server sends no facets, and empty selects would read as "this
        // corpus has no locations" instead of "unknown".
        if (data.facets) setFacets(data.facets);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [dispatch]
  );

  // The debounced term and the selects are the fetch key — the selects are a
  // server round-trip now, but a click is the deliberate action the search box's
  // debounce exists to wait for, so they fire immediately. Deliberately not
  // keyed on the signed-in user: the cookie is already on the first request, so
  // re-running when Redux rehydrates would just double every page load.
  useEffect(() => {
    void fetchJobs(search, filters);
  }, [fetchJobs, search, filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const hasFilters = Boolean(search || filters.location || filters.experience || filters.type);

  // "Best match" only exists when there is something to sort by. Anonymous
  // visitors, company accounts and un-indexed seekers never see the option.
  const hasMatches = useMemo(() => jobList.some((job) => job.match), [jobList]);

  /**
   * The order actually in force.
   *
   * Unpicked means the natural order of this result set. The two guards cover a
   * choice that has stopped being available — a sign-out taking "Best match"
   * away, a cleared search taking "Best relevance" away — which would otherwise
   * leave the select showing a value it no longer offers.
   */
  const defaultSort: SortKey = semantic ? "relevance" : "newest";
  const activeSort: SortKey =
    sort === null || (sort === "match" && !hasMatches) || (sort === "relevance" && !semantic)
      ? defaultSort
      : sort;

  const visibleJobs = useMemo(() => {
    // The three selects are the server's job now: they are `where` clauses on
    // the corpus, not a pass over the page, so repeating them here would be a
    // second copy of the rule free to disagree with the first.
    //
    // The substring test stays, and only for a *non*-semantic response. When the
    // server ranked semantically its result set *is* the answer for this term,
    // and testing it again would discard exactly the rows semantic retrieval
    // exists to surface - the role that never says "frontend" but is one. What
    // is left is the case where no ranking happened at all (AI off, or a query
    // too short to search), where the server returns the plain listing and this
    // is the only keyword filtering there is.
    const needle = semantic ? "" : searchedQuery.toLowerCase();

    const filtered = needle
      ? jobList.filter((job) => {
          const haystack = [job.title, job.company?.name, job.description, job.location, job.type]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        })
      : jobList;

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
    // The rows arrive in the server's relevance ranking, so "relevance" is the
    // order they are already in - and re-sorting by date here would throw it
    // away. "Newest first" under a search is now a thing the user can actually
    // ask for, and it does what it says.
    if (activeSort === "relevance") return filtered;
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [jobList, searchedQuery, semantic, activeSort]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters(EMPTY_FILTERS);
  };

  /**
   * Taking a chip off is a new search, not a client-side hide.
   *
   * The token comes out of the query and the rebuilt string goes back through
   * the same parser server-side, so what the chips say and what the server
   * actually applied cannot drift apart.
   */
  const removeChip = (index: number) => {
    const next = queryWithoutToken(chipQuery, chips, index);
    setSearchInput(next);
    // Straight past the debounce: a click is already the deliberate action the
    // debounce exists to wait for.
    setSearch(next);
  };

  /**
   * What a saved search should carry alongside the query.
   *
   * `/api/saved-searches` allowlists exactly these three and the alert runner
   * applies them as `where` clauses, so the selects the user has set here are
   * worth keeping — otherwise the alert is a broader search than the one they
   * were looking at when they pressed save.
   */
  const savedSearchFilters = useMemo(() => {
    const payload: { remote?: boolean; type?: string; location?: string } = {};
    if (chips.some((chip) => chip.key === "remote" && chip.label === "Remote")) {
      payload.remote = true;
    }
    if (filters.type) payload.type = filters.type;
    if (filters.location) payload.location = filters.location;
    return payload;
  }, [chips, filters.location, filters.type]);

  // Saving a search is a seeker action against their own account, so it is
  // offered to nobody else — and there is nothing to save without a query.
  const canSaveSearch =
    mounted && isAuthenticated && user?.role === "SEEKER" && search.trim().length >= 2;

  // The strip under the filter bar: how the query was read, what a select
  // overruled, whether the ranking was keyword-only, and the save button.
  const showSearchNotes =
    !loading && !error && (chips.length > 0 || overridden.length > 0 || mode === "lexical" || canSaveSearch);

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
            <button
              type="button"
              onClick={() => void fetchJobs(search, filters)}
              className={buttonPrimary}
            >
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
              options={facets.location}
              onChange={(value) => setFilters((current) => ({ ...current, location: value }))}
            />
            <FilterSelect
              id="filter-experience"
              label="Experience"
              allLabel="All levels"
              value={filters.experience}
              options={facets.experience}
              onChange={(value) => setFilters((current) => ({ ...current, experience: value }))}
            />
            <FilterSelect
              id="filter-type"
              label="Job type"
              allLabel="All types"
              value={filters.type}
              options={facets.type}
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
                {/* One option per order, each holding the value it names. Under a
                    search, relevance is offered and is the default — but date
                    order is still there to be asked for, which it was not when
                    "Best relevance" was a label painted over `newest`. */}
                {semantic && <option value="relevance">Best relevance</option>}
                <option value="newest">Newest first</option>
                <option value="applicants">Most applicants</option>
                {hasMatches && <option value="match">Best match</option>}
              </select>
            </div>
          </div>

          {/* The counts describe the corpus, not the hits — so say so, rather
              than let "Berlin (12)" be read as a promise about a search that
              returned three. Only under a search: without one, picking an option
              does yield exactly its count. */}
          {Boolean(search) && (
            <Eyebrow as="p" className="mt-3">
              Filter counts cover every open role, not just this search.
            </Eyebrow>
          )}
        </Card>
      </section>

      {/* What the search did with the query, and what can be done about it. */}
      {showSearchNotes && (
        <section aria-label="How this search was read" className="mb-4 sm:mb-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {chips.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Eyebrow as="span">Read as</Eyebrow>
                {chips.map((chip, index) => (
                  <FilterChip
                    key={`${chip.key}-${chip.token}`}
                    label={chipDisplayLabel(chip)}
                    onRemove={() => removeChip(index)}
                  />
                ))}
              </div>
            )}

            {canSaveSearch && (
              <div className="sm:ml-auto">
                {/* Keyed on the query so a new search gets a fresh panel rather
                    than the previous one's name, error or success note. */}
                <SaveSearchPanel key={search} query={search} filters={savedSearchFilters} />
              </div>
            )}
          </div>

          {/* An inferred filter that a select overruled. The server dropped it
              before searching, so it is not quietly applied *and* not quietly
              discarded: the user is told which of the two won, and the loser is
              a word in a box they can still edit. */}
          {overridden.map((chip) => (
            <Eyebrow as="p" className="mt-2" key={`${chip.key}-${chip.token}`}>
              {overrideNote(chip, filters)}
            </Eyebrow>
          ))}

          {/* A quiet note, not an error: lexical mode means the vector arm was
              unavailable, and the results are still a real ranking. */}
          {mode === "lexical" && (
            <Eyebrow as="p" className="mt-2">
              Ranked on keywords — semantic search isn&rsquo;t available right now.
            </Eyebrow>
          )}
        </section>
      )}

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
              {/* The denominator is the corpus, from the server. It used to be
                  `jobList.length`, which was the page the filters had already
                  been applied to — so it read "12 / 12 total" and measured
                  nothing. */}
              {hasFilters && visibleJobs.length > 0 && facets.total > visibleJobs.length && (
                <span className="text-gray-400 dark:text-gray-500">
                  {" "}
                  / {facets.total} open {facets.total === 1 ? "role" : "roles"}
                </span>
              )}
            </Eyebrow>

            {/* More rows match than one page returns, so the list is the newest
                slice of the answer rather than the answer. */}
            {truncated && (
              <Eyebrow as="span">Showing the newest {visibleJobs.length} — narrow to see more</Eyebrow>
            )}

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
          /*
           * Two different empty states, told apart by the corpus size the server
           * reports rather than by whether a filter happens to be set.
           *
           * "Nothing matched your filters" is a dead end the user can get out
           * of, and the way out is the button. "There are no open roles at all"
           * is not their doing and clearing filters would not help — offering it
           * would send them round a loop that cannot succeed.
           */
          <Card>
            <EmptyState
              icon={<Icon.briefcase className="h-6 w-6" />}
              title={
                facets.total === 0
                  ? "No open roles right now"
                  : hasFilters
                    ? "No roles match these filters"
                    : "Nothing to show"
              }
              description={
                facets.total === 0
                  ? "Nothing is being advertised at the moment. Check back soon."
                  : hasFilters
                    ? `None of the ${facets.total} open ${
                        facets.total === 1 ? "role" : "roles"
                      } match every filter at once. Try widening one of them, or clear them all.`
                    : "The feed came back empty. Reloading usually sorts it out."
              }
              action={
                facets.total > 0 && hasFilters ? (
                  <button type="button" onClick={clearFilters} className={buttonPrimary}>
                    Clear filters
                  </button>
                ) : facets.total > 0 ? (
                  <button
                    type="button"
                    onClick={() => void fetchJobs(search, filters)}
                    className={buttonPrimary}
                  >
                    Reload
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


/**
 * Whitespace and dangling punctuation, the same tidy-up `tidyRemainder` applies
 * server-side — so that pulling "remote" out of "remote, senior Go" leaves
 * "senior Go" rather than ", senior Go".
 */
function tidyQuery(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/(^|\s)[-–—,;:/&+]+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drops one inferred filter from the query text.
 *
 * The parser in `lib/ai/search.ts` blanks each filter's span out of the query as
 * it consumes it, so the chips' tokens are disjoint slices of what the user
 * typed. Every token claims its span first and only the target's is then cut,
 * which is what makes the removal exact: the earliest literal occurrence of a
 * word is not always the one the parser matched ("remote team, remote-friendly"),
 * and cutting the wrong one would leave the filter applied with its chip gone.
 *
 * What comes back is the remainder plus the tokens of the chips that stayed, in
 * the order they were typed — and re-parsing that yields exactly the filters
 * that were kept, which is the contract the chips rely on.
 *
 * One span is cut, never every occurrence of the word. "senior senior engineer"
 * therefore keeps its Senior chip after a removal, which is the honest answer:
 * the query still says senior, and deleting words the parser never claimed
 * would quietly eat a company name like "Senior Systems".
 */
function queryWithoutToken(query: string, chips: SearchFilterChip[], targetIndex: number): string {
  const haystack = query.toLowerCase();
  const claimed = new Array<boolean>(query.length).fill(false);
  let targetSpan: { start: number; end: number } | null = null;

  // Claims are taken in the order the parser produced the chips, which is the
  // order it resolved overlaps in, so the two agree on who owns what.
  for (let index = 0; index < chips.length; index++) {
    const needle = chips[index].token.toLowerCase();
    if (!needle) continue;

    for (let from = 0; from + needle.length <= haystack.length; ) {
      const start = haystack.indexOf(needle, from);
      if (start === -1) break;
      const end = start + needle.length;

      // Already owned by an earlier chip; look further along rather than
      // claiming the same characters twice.
      if (claimed.slice(start, end).some(Boolean)) {
        from = start + 1;
        continue;
      }

      for (let i = start; i < end; i++) claimed[i] = true;
      if (index === targetIndex) targetSpan = { start, end };
      break;
    }
  }

  // Unclaimed only if the box was edited since this response came back. Cutting
  // the first literal occurrence is still better than ignoring a click on a chip
  // the user can see.
  const span = targetSpan ?? spanOf(haystack, chips[targetIndex].token.toLowerCase());

  if (!span) return tidyQuery(query);
  return tidyQuery(`${query.slice(0, span.start)} ${query.slice(span.end)}`);
}

function spanOf(haystack: string, needle: string): { start: number; end: number } | null {
  if (!needle) return null;
  const start = haystack.indexOf(needle);
  return start === -1 ? null : { start, end: start + needle.length };
}

/**
 * What an explicit select did to a filter the query implied.
 *
 * The rule is one line — the select the user set wins over the one inferred
 * from prose — but it has to be *said*, or the words they typed appear to have
 * been ignored for no reason.
 *
 * `remote` is a location claim here, the same way the query parser treats it,
 * so the Location select is the control that overruled it.
 */
function overrideNote(chip: SearchFilterChip, filters: Filters): string {
  const field = chip.key === "type" ? "Job type" : "Location";
  const winner = chip.key === "type" ? filters.type : filters.location;

  if (winner.toLowerCase() === chip.label.toLowerCase()) {
    return `The ${field} filter already covers “${chip.label}” from your search.`;
  }
  return `Your search read “${chip.label}”, but the ${field} filter is set to “${winner}” — the filter wins.`;
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
  options: Facet[];
  onChange: (value: string) => void;
}) {
  // A value arriving from the URL (or one whose postings have since closed) may
  // not be among the offered options. Without this the select would render
  // blank while the filter was silently still applied.
  const isUnlisted =
    Boolean(value) && !options.some((option) => option.value.toLowerCase() === value.toLowerCase());

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
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>
    </div>
  );
}

/** "120k+" on its own is cryptic; every other chip label already reads. */
function chipDisplayLabel(chip: SearchFilterChip): string {
  return chip.key === "minSalary" ? `${chip.label} salary` : chip.label;
}

/**
 * A filter the query implied, with the means to take it back.
 *
 * Local rather than a change to `Chip` in the kit: that one is a static tag,
 * and this one has to contain a control.
 */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip pr-1">
      <Icon.filter className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-white"
      >
        <Icon.x className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">Remove the {label} filter and search again</span>
      </button>
    </span>
  );
}

/** The two frequencies worth offering at the point of saving; `OFF` is an edit. */
const SAVE_FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
] as const;

/** Mirror of `NAME_MAX` in `app/api/saved-searches/route.ts`. */
const SAVED_NAME_MAX = 60;

/**
 * "Save this search" for a signed-in seeker.
 *
 * Collapsed to a single button until it is wanted, because the feed's job is
 * browsing — and expanded it asks for a name, which is the one thing the server
 * cannot infer and the one thing a 409 will be about.
 */
function SaveSearchPanel({
  query,
  filters,
}: {
  query: string;
  filters: { remote?: boolean; type?: string; location?: string };
}) {
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">("DAILY");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  if (saved) {
    return (
      <Eyebrow as="p" accent className="inline-flex items-center gap-1.5">
        <Icon.check className="h-3.5 w-3.5" aria-hidden="true" />
        Saved —{" "}
        <Link href="/seeker/alerts" className="underline underline-offset-2 hover:no-underline">
          manage your alerts
        </Link>
      </Eyebrow>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // The query is the obvious first guess at a name, and the field stays
          // editable — a name is what makes the search findable later.
          setName(query.slice(0, SAVED_NAME_MAX));
          setError("");
          setOpen(true);
        }}
        className={buttonGhost}
      >
        <Icon.bell className="h-4 w-4" aria-hidden="true" />
        Save this search
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const cleanName = name.trim();
    if (!cleanName) {
      setError("Give this search a name");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await apiFetch("/api/saved-searches", {
        method: "POST",
        body: JSON.stringify({
          name: cleanName,
          query,
          frequency,
          // Omitted entirely when empty: the route reads `{}` as no filters and
          // stores null, but sending nothing says the same thing more cheaply.
          ...(Object.keys(filters).length > 0 ? { filters } : {}),
        }),
      });
      setSaved(true);
      toast.success("Search saved");
    } catch (err) {
      /*
       * The route answers 409 for two different things — a name already in use
       * and the twenty-search ceiling — and writes a usable sentence for each.
       * `apiFetch` carries that message and drops the status, so it is shown as
       * written rather than flattened into one generic failure.
       */
      setError(err instanceof Error ? err.message : "Could not save that search");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="w-full p-3 sm:w-80">
      <form onSubmit={submit}>
        <Label htmlFor="save-search-name" required>
          Name this alert
        </Label>
        <input
          id="save-search-name"
          type="text"
          value={name}
          maxLength={SAVED_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
          autoFocus
        />

        <div className="mt-3">
          <Label htmlFor="save-search-frequency">Tell me about new matches</Label>
          <select
            id="save-search-frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as "DAILY" | "WEEKLY")}
            className={inputClass}
          >
            {SAVE_FREQUENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" className={buttonPrimary} disabled={saving}>
            {saving ? (
              <>
                <Spinner className="h-4 w-4" />
                Saving…
              </>
            ) : (
              "Save search"
            )}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={buttonGhost}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
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
