"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Skeleton,
  Spinner,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
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
 * for date order during a search. The server's own `?sort=match` is unchanged.
 */
type SortKey = "relevance" | "newest" | "applicants" | "match";

const SORT_KEYS: readonly SortKey[] = ["relevance", "newest", "applicants", "match"];

/** `?sort=` is attacker-controllable text; only the four real orders are read. */
function parseSort(value: string | null): SortKey | null {
  const key = value?.trim() as SortKey | undefined;
  return key && SORT_KEYS.includes(key) ? key : null;
}

interface Filters {
  location: string;
  experience: string;
  type: string;
}

const EMPTY_FILTERS: Filters = { location: "", experience: "", type: "" };

/**
 * The whole of the feed's state, as it appears in the URL.
 *
 * Built in one place so the writer below and any future reader cannot disagree
 * about parameter names or about which values count as "nothing set" — an empty
 * string is omitted rather than written as `q=`, so a bare `/jobs` and a
 * cleared search produce the same link.
 */
function feedSearchParams(search: string, filters: Filters, sort: SortKey | null): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (filters.location) params.set("location", filters.location);
  if (filters.experience) params.set("experience", filters.experience);
  if (filters.type) params.set("type", filters.type);
  if (sort) params.set("sort", sort);
  return params.toString();
}

/** A posting is flagged "New" for its first week on the feed. */
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Referenced by all three selects through `aria-describedby`; see §2.3. */
const facetCaveatId = "facet-caveat";

/**
 * The one constraint responsible for an empty result set, or `null`.
 *
 * `filter` names a select to drop and how many roles come back if it goes;
 * `query` names the search text, which the facet counts cannot see at all.
 */
type Culprit =
  | { kind: "filter"; key: keyof Filters; label: string; freed: number }
  | { kind: "query"; term: string }
  | null;

function facetCount(options: Facet[], value: string): number | null {
  const hit = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
  return hit ? hit.count : null;
}

/**
 * Which control emptied the list.
 *
 * The facets are counted server-side over every active posting, narrowed by the
 * *other* two selects and never by the query (see `FeedFacets`). So:
 *
 *  - a selected option counted at zero is, together with the other selects,
 *    excluding everything — that select is the culprit, and the sum of its
 *    facet's counts is exactly what comes back when it is dropped;
 *  - if every selected option still has roles behind it and the list is empty
 *    regardless, the one constraint the counts cannot see is the search text.
 *
 * An option that is not in the list at all (`null`) is one whose postings have
 * since closed, which is the same diagnosis as a zero with no number to promise.
 *
 * Where more than one select is at fault, the one that frees the most is
 * offered: it is the single change that recovers the most of the corpus.
 */
function findCulprit(search: string, filters: Filters, facets: FeedFacets): Culprit {
  const candidates: Array<{ key: keyof Filters; label: string; count: number | null; freed: number }> = [];

  const consider = (key: keyof Filters, value: string, label: string, options: Facet[]) => {
    if (!value) return;
    candidates.push({
      key,
      label,
      count: facetCount(options, value),
      freed: options.reduce((total, option) => total + option.count, 0),
    });
  };

  consider("location", filters.location, filters.location, facets.location);
  consider("experience", filters.experience, `${filters.experience} years`, facets.experience);
  consider("type", filters.type, filters.type, facets.type);

  const blocking = candidates
    .filter((candidate) => candidate.count === null || candidate.count === 0)
    .sort((a, b) => b.freed - a.freed);

  if (blocking.length > 0) {
    const worst = blocking[0];
    return { kind: "filter", key: worst.key, label: worst.label, freed: worst.freed };
  }

  // Every select still has roles behind it, so the text is what removed them.
  // Truncated because a pasted paragraph should not become a button label.
  if (search) return { kind: "query", term: search.length > 28 ? `${search.slice(0, 27)}…` : search };

  // Filters that each have roles behind them but no overlap once combined —
  // no single one is at fault, so nothing is named and "Clear everything" is
  // the honest only door.
  return null;
}

/** The sentence above the recovery buttons, matched to what they will do. */
function emptyStateReason(culprit: Culprit, total: number): string {
  const corpus = `${total} open ${total === 1 ? "role" : "roles"}`;
  if (culprit?.kind === "filter") {
    return `Nothing in the ${corpus} matches “${culprit.label}” alongside your other filters.`;
  }
  if (culprit?.kind === "query") {
    return `Your filters still have roles behind them — it is the search for “${culprit.term}” that none of the ${corpus} answer.`;
  }
  return `None of the ${corpus} match every filter at once. Try widening one of them, or clear them all.`;
}

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

  // Every control's state is seeded from the URL and written back to it. The
  // homepage hero links here as `/jobs?q=…&location=…`, but that was only ever
  // half the contract: a filtered feed could not be bookmarked, shared or
  // reloaded, and the back button did nothing useful. Editing a field is still
  // ordinary local state — the URL is kept in step by one effect below, not
  // round-tripped through on every keystroke.
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const initialLocation = searchParams.get("location")?.trim() ?? "";
  const initialExperience = searchParams.get("experience")?.trim() ?? "";
  const initialType = searchParams.get("type")?.trim() ?? "";
  const initialSort = parseSort(searchParams.get("sort"));

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
  const [filters, setFilters] = useState<Filters>({
    location: initialLocation,
    experience: initialExperience,
    type: initialType,
  });
  /**
   * `null` is "whatever this result set's natural order is" — relevance under a
   * search, date otherwise — rather than a fourth sort key. Once the user picks
   * one it stays picked, including across a search starting or ending.
   */
  const [sort, setSort] = useState<SortKey | null>(initialSort);

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

  /**
   * The URL follows the controls, so the view on screen is the view in the
   * address bar.
   *
   * This is the plumbing under three separate things: sharing or bookmarking a
   * filtered feed, a support conversation that can start with "send me the link
   * you're looking at", and a back button that goes somewhere sensible. It is
   * also what lets `savedSearchFilters` below read one object instead of
   * reconstructing an approximation of the state from the chips.
   *
   * `replace` rather than `push`: a settled search term, a select and a sort are
   * refinements of a single view, and pushing each one would bury the page the
   * reader arrived from under a dozen history entries. `search` is already the
   * debounced value, so this fires once per settled query rather than per
   * keystroke.
   *
   * The string compare is load-bearing — `router.replace` changes
   * `searchParams`, which re-runs this effect — and it also normalises: a link
   * arriving with the parameters in another order, or with keys this page does
   * not read, is rewritten once to the canonical form and then left alone.
   */
  useEffect(() => {
    const next = feedSearchParams(search, filters, sort);
    if (next === searchParams.toString()) return;
    router.replace(next ? `/jobs?${next}` : "/jobs", { scroll: false });
  }, [search, filters, sort, router, searchParams]);

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

  const resultCount = visibleJobs.length;

  /**
   * The previous *settled* count, so the strip can say what changed rather than
   * only what is there.
   *
   * "12 roles, down from 34" is feedback that the control the reader just
   * touched did something; "12 roles" alone is a readout that happens to hold a
   * different number than it did a moment ago, and nothing connects the two. A
   * mid-flight list is the previous response rather than a result, so only
   * settled counts are recorded.
   */
  const settledCount = useRef<number | null>(null);
  const [previousCount, setPreviousCount] = useState<number | null>(null);

  useEffect(() => {
    if (loading || refreshing) return;
    const before = settledCount.current;
    settledCount.current = resultCount;
    setPreviousCount(before === null || before === resultCount ? null : before);
  }, [loading, refreshing, resultCount]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters(EMPTY_FILTERS);
  };

  /** One select back to "any", leaving the reader's other decisions alone. */
  const clearFilter = (key: keyof Filters) =>
    setFilters((current) => ({ ...current, [key]: "" }));

  /** The search box back to empty, leaving the three selects alone. */
  const clearQuery = () => {
    setSearchInput("");
    // Straight past the debounce, as chip removal does: a click is already the
    // deliberate action the debounce exists to wait for.
    setSearch("");
  };

  /**
   * What the three selects are currently set to, as removable tokens.
   *
   * Baymard's applied-filters study found 42% of sites underperform here, and
   * that showing applied values in only *one* position — either left in place
   * among the filter controls, or gathered into an overview — measurably caused
   * users to overlook filters and struggle to deselect them. The recommendation
   * is both at once, which is what this is: the select goes on showing its own
   * value, and this strip shows the full applied set in one place.
   * https://baymard.com/blog/applied-filters
   *
   * The eyebrow above it says "Filtered by" while the inferred chips say "Read
   * as", because the two are different claims: one is what the reader chose,
   * the other is what the server understood.
   */
  const appliedChips = useMemo(
    () =>
      (
        [
          { key: "location", label: filters.location, control: "Location" },
          { key: "experience", label: filters.experience && `${filters.experience} years`, control: "Experience" },
          { key: "type", label: filters.type, control: "Job type" },
        ] as const
      ).filter((chip): chip is typeof chip & { label: string } => Boolean(chip.label)),
    [filters.location, filters.experience, filters.type]
  );

  /**
   * Which control emptied the list, when it is empty.
   *
   * The facet counts are computed server-side over every active posting,
   * narrowed by the *other* two selects and never by the query text (see
   * `FeedFacets`). Two things follow, and they are the whole diagnosis:
   *
   *  - A selected option whose count is zero is, on its own and in combination
   *    with the other selects, excluding everything. That is the filter to drop,
   *    and the sum of that facet's counts is exactly how many roles come back if
   *    it goes.
   *  - If every selected option still has roles behind it and the list is empty
   *    anyway, the one constraint the facets cannot see is the search text. So
   *    the text is the culprit, and dropping a select would not help.
   *
   * NN/g's filtering guidance is to prevent zero-result dead ends and always
   * offer a way out; "Clear filters" is a way out that throws away four
   * decisions to fix one, so it stays as the fallback rather than the only door.
   */
  const culprit = useMemo(() => findCulprit(search, filters, facets), [search, filters, facets]);

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

  // The strip under the filter bar: what a select overruled, whether the
  // ranking was keyword-only, and the save button. The chips moved up into the
  // applied-filters strip, so they are no longer a reason to render this.
  const showSearchNotes =
    !loading && !error && (overridden.length > 0 || mode === "lexical" || canSaveSearch);

  /**
   * One sentence, composed in full before it is handed to the live region.
   *
   * The visible count strip used to carry `aria-live` itself — and it contains
   * the "Clear filters" button, so the control was re-announced on every filter
   * change and its own state changes fought the region. Sara Soueidan's rules:
   * the region exists in the DOM from mount, holds no interactive or rich
   * content, and receives a message that is already complete.
   */
  const liveMessage =
    loading || refreshing
      ? ""
      : error
        ? ""
        : `${resultCount === 0 ? "No" : resultCount} ${resultCount === 1 ? "role" : "roles"} matched${
            previousCount !== null ? `, ${previousCount > resultCount ? "down" : "up"} from ${previousCount}` : ""
          }${semantic ? ", ranked by semantic relevance" : ""}.`;

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

            {/* `describedBy` wires the caveat below onto each control, per the
                APG's "Providing Accessible Names and Descriptions" practice:
                a keyboard user landing on a select hears what its counts mean
                instead of the note existing as an unassociated sibling
                paragraph two elements away. Only when the note is on screen —
                an `aria-describedby` pointing at nothing is worse than none.
                https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/ */}
            <FilterSelect
              id="filter-location"
              label="Location"
              allLabel="All locations"
              value={filters.location}
              options={facets.location}
              unit="role"
              describedBy={facetCaveatId}
              onChange={(value) => setFilters((current) => ({ ...current, location: value }))}
            />
            <FilterSelect
              id="filter-experience"
              label="Experience"
              allLabel="All levels"
              value={filters.experience}
              options={facets.experience}
              unit="role"
              describedBy={facetCaveatId}
              onChange={(value) => setFilters((current) => ({ ...current, experience: value }))}
            />
            <FilterSelect
              id="filter-type"
              label="Job type"
              allLabel="All types"
              value={filters.type}
              options={facets.type}
              unit="role"
              describedBy={facetCaveatId}
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
              than let "Berlin — 12 roles" be read as a promise about a search
              that returned three. Only under a search: without one, picking an
              option does yield exactly its count. */}
          {/* The `.eyebrow` class rather than <Eyebrow>: this needs an `id` for
              the selects' aria-describedby, and the component does not take
              one. Same rendered result. */}
          {Boolean(search) && (
            <p id={facetCaveatId} className="eyebrow mt-3">
              Filter counts cover every open role, not just this search.
            </p>
          )}
        </Card>
      </section>

      {/*
        Everything currently applied, in one strip, above the results.

        Baymard: applied filter values shown in only one position — either left
        in place among the controls or gathered into an overview — measurably
        caused users to lose track of what the list was filtered by. Both
        positions is the recommendation, so the selects keep their values *and*
        this strip exists. Until now only the *inferred* chips got the overview
        treatment, which was backwards: the selects are the filters the reader
        set deliberately.
        https://baymard.com/blog/applied-filters
      */}
      {!loading && !error && (appliedChips.length > 0 || chips.length > 0) && (
        <section aria-label="Applied filters" className="mb-4 flex flex-wrap items-start gap-x-5 gap-y-2">
          {appliedChips.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Eyebrow as="span">Filtered by</Eyebrow>
              {appliedChips.map((chip) => (
                <RemovableChip
                  key={chip.key}
                  label={chip.label}
                  icon={<Icon.filter className="h-3.5 w-3.5" aria-hidden="true" />}
                  // Names the control as well as the value, so a screen-reader
                  // user hears which of three identical-sounding chips this is.
                  removeLabel={`Remove the ${chip.control} filter, ${chip.label}`}
                  onRemove={() => clearFilter(chip.key)}
                />
              ))}
            </div>
          )}

          {/* Kept visually distinct from the row above by its eyebrow: these
              describe what the *server* read out of the query, not a choice. */}
          {chips.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Eyebrow as="span">Read as</Eyebrow>
              {chips.map((chip, index) => (
                <RemovableChip
                  key={`${chip.key}-${chip.token}`}
                  label={chipDisplayLabel(chip)}
                  icon={<Icon.spark className="h-3.5 w-3.5" aria-hidden="true" />}
                  removeLabel={`Remove ${chipDisplayLabel(chip)} from the search and search again`}
                  onRemove={() => removeChip(index)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* What the search did with the query, and what can be done about it.
          The chips themselves now live in the applied-filters strip above —
          what is left here are the notes *about* the search, plus the save
          action, which is an action and does not belong among the tokens. */}
      {showSearchNotes && (
        <section aria-label="How this search was read" className="mb-4 sm:mb-5">
          {canSaveSearch && (
            /* Keyed on the query so a new search gets a fresh panel rather than
               the previous one's name, error or success note. */
            <SaveSearchPanel key={search} query={search} filters={savedSearchFilters} />
          )}

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
              // `.hit-24`: a 22×22 dismiss was under SC 2.5.8's floor and only
              // survived on the spacing exception.
              className="eyebrow hit-24 flex-shrink-0 rounded p-1 hover:text-gray-900 dark:hover:text-white"
            >
              <Icon.x className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        </Alert>
      )}

      {/*
        One polite announcer for the page, rendered from mount and empty until
        there is something to say. A live region that appears at the same moment
        as its first message often does not announce at all.
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      {/* Result count, read as instrument output: "12 ROLES MATCHED". No
          `aria-live` here — see `liveMessage` above for why. */}
      {!loading && !error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Eyebrow as="span">
              {resultCount === 0
                ? "No roles matched"
                : `${resultCount} ${resultCount === 1 ? "role" : "roles"} matched`}
              {/* The denominator is the corpus, from the server. It used to be
                  `jobList.length`, which was the page the filters had already
                  been applied to — so it read "12 / 12 total" and measured
                  nothing. */}
              {hasFilters && resultCount > 0 && facets.total > resultCount && (
                <span className="text-gray-400 dark:text-gray-500">
                  {" "}
                  / {facets.total} open {facets.total === 1 ? "role" : "roles"}
                </span>
              )}
            </Eyebrow>

            {/* The delta, not just the level. A count that changed from 34 to 12
                is the control reporting back; the same "12" with no reference
                point is a readout that happens to have moved. */}
            {previousCount !== null && (
              <Eyebrow as="span" className="text-gray-400 dark:text-gray-500">
                {previousCount > resultCount ? "down" : "up"} from {previousCount}
              </Eyebrow>
            )}

            {/* More rows match than one page returns, so the list is the newest
                slice of the answer rather than the answer. */}
            {truncated && (
              <Eyebrow as="span">Showing the newest {resultCount} — narrow to see more</Eyebrow>
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
      ) : resultCount > 0 ? (
        <div
          className={`grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-2 lg:gap-5 ${
            refreshing ? "opacity-60" : ""
          }`}
          aria-busy={refreshing}
        >
          {visibleJobs.map((job) => (
            /* `scored` is a property of the *feed*, not of the card: when any
               row carries a match every card reserves the same score slot, so a
               two-column grid does not go ragged between a scored row and an
               unscored one. When nothing is scored, nothing reserves. */
            <JobCard key={job.id} job={job} scored={hasMatches} />
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
              icon={<Icon.search className="h-6 w-6" />}
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
                    ? emptyStateReason(culprit, facets.total)
                    : "The feed came back empty. Reloading usually sorts it out."
              }
              action={
                facets.total > 0 && hasFilters ? (
                  /*
                   * A dead end needs a door, and the narrowest possible door is
                   * the best one: "Clear filters" throws away four decisions to
                   * fix one. The first button undoes exactly the constraint that
                   * emptied the list — see `findCulprit` — and "Clear everything"
                   * stays behind it as the fallback.
                   */
                  <div className="flex flex-wrap justify-center gap-2">
                    {culprit?.kind === "filter" && (
                      <button
                        type="button"
                        onClick={() => clearFilter(culprit.key)}
                        className={buttonPrimary}
                      >
                        Drop &ldquo;{culprit.label}&rdquo;
                        {culprit.freed > 0 && (
                          <span className="font-normal opacity-80">
                            {" "}
                            — {culprit.freed} {culprit.freed === 1 ? "role" : "roles"}
                          </span>
                        )}
                      </button>
                    )}
                    {culprit?.kind === "query" && (
                      <button type="button" onClick={clearQuery} className={buttonPrimary}>
                        Search without &ldquo;{culprit.term}&rdquo;
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className={culprit ? buttonSecondary : buttonPrimary}
                    >
                      Clear everything
                    </button>
                  </div>
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
  unit,
  describedBy,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: Facet[];
  /** Singular noun for the count in each option, e.g. "role". */
  unit: string;
  describedBy?: string;
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
        aria-describedby={describedBy}
        className={inputClass}
      >
        <option value="">{allLabel}</option>
        {isUnlisted && <option value={value}>{value}</option>}
        {options.map((option) => (
          /* "Berlin (12)" is announced as "Berlin left parenthesis twelve right
             parenthesis" — punctuation noise where a number was meant. A
             word-bearing form is more verbose to read, but the dropdown is the
             only place it appears and it is the difference between noise and
             information. */
          <option key={option.value} value={option.value}>
            {option.value} — {option.count} {option.count === 1 ? unit : `${unit}s`}
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
 * An applied criterion, with the means to take it back.
 *
 * Local rather than a change to `Chip` in the kit, which is a static tag and
 * cannot contain a control — this collapses into `Chip` the moment the kit
 * grows an `onRemove` prop, and should.
 *
 * The behaviour is Carbon's `DismissibleTag` contract: the close control is in
 * the tab order, and its accessible name names the *token* rather than saying
 * "remove" three times in a row, so a screen-reader user hears which of several
 * identical-looking chips they are about to drop.
 * https://carbondesignsystem.com/components/tag/accessibility/
 *
 * `.hit-24` gives the button a 24×24 target without growing the chip, which is
 * WCAG 2.2 SC 2.5.8's floor met on its own rather than on the spacing exception
 * the old 20×20 button was relying on.
 */
function RemovableChip({
  label,
  icon,
  removeLabel,
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="chip">
      {icon}
      {label}
      <button type="button" onClick={onRemove} className="chip-dismiss hit-24">
        <Icon.x className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">{removeLabel}</span>
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

/**
 * One result.
 *
 * The reading order is the deciding order, top to bottom: who and what
 * (title, company, location) → what it pays and how it is worked → what the
 * posting says → the evidence behind the score → when it was posted. NN/g's
 * information-scent work is the reason the title is the only large text and the
 * only link: the scent a reader follows is the label of the thing they are
 * about to open, and everything else on the card exists to help them *not*
 * open it. Compensation sits first among the facts because it is the fact
 * candidates rank a listing on before they read a line of it.
 * https://www.nngroup.com/articles/information-scent/
 *
 * `scored` is a feed-level fact rather than a card-level one — see the call
 * site. It reserves the score column and the meter slot on every card in a
 * scored feed so rows do not go ragged, and reserves nothing at all in a feed
 * where no row can be scored.
 */
function JobCard({ job, scored }: { job: JobListItem; scored: boolean }) {
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
            {/* `text-balance` on the one piece of display type on the card:
                a two-line title that breaks 9/2 is measurably harder to scan
                than one that breaks 6/5. Free in Tailwind v4. */}
            <h2 className="text-pretty text-base font-semibold leading-snug text-gray-900 dark:text-white sm:text-lg">
              <Link href={`/jobs/${job.id}`} className="after:absolute after:inset-0 after:rounded-xl">
                <span className="line-clamp-2 text-balance">{job.title}</span>
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

        {/* The score column, and nothing else. The applicant count used to sit
            under it, which put a competitive signal and a personal one in the
            same stack reading as one block; it has moved to the footer beside
            the posting date, where the other metadata lives. `min-h` holds the
            column open across a scored feed so rows stay level. */}
        <div
          className={`flex flex-shrink-0 flex-col items-end gap-1.5 ${scored ? "min-h-[3.25rem]" : ""}`}
        >
          {/* The feed only ever returns open roles, so the old Active/Inactive
              badge was always green. Recency is the useful signal instead, and
              a fresh posting is exactly the "live" state emerald is for. */}
          {isNew && (
            <span className="mono rounded-md border border-green-300 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
              New
            </span>
          )}
          {match && <MatchScore value={match.score} caption="Profile fit" />}
        </div>
      </div>

      {/* `text-pretty` stops the clamped snippet ending on an orphan. */}
      <p className="mt-3 line-clamp-2 text-pretty text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        {job.description}
      </p>

      {/* Salary first: it is the fact a reader sorts on before reading a word
          of the posting. Location is deliberately absent — it is already on the
          line under the title, and repeating it here spends the most valuable
          row on the card restating something two lines above it. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.salary && <Chip icon={<Icon.money className="h-3.5 w-3.5" />}>{job.salary}</Chip>}
        {job.type && <Chip icon={<Icon.clock className="h-3.5 w-3.5" />}>{job.type}</Chip>}
        {job.experience && (
          <Chip icon={<Icon.briefcase className="h-3.5 w-3.5" />}>{job.experience} years</Chip>
        )}
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

      {/* The score again as bar length, directly under the evidence for it and
          above the footer rule, so score → receipts → bar reads as one block.
          It used to sit *below* the footer, detached from everything it is
          about. The slot is reserved across a scored feed whether or not this
          particular row has a score, so cards keep the same height. */}
      {scored && (
        <div className="mt-3 min-h-[0.375rem]">
          {match && (
            <Meter value={match.score} label={`Profile fit: ${match.score} out of 100`} />
          )}
        </div>
      )}

      {/* A minimum gap that also absorbs the slack, so two cards in the same
          row line their footers up however much content each one has. */}
      <div className="mt-4 flex-1" aria-hidden="true" />

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700 sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <Eyebrow as="span">Posted {formatDate(job.createdAt)}</Eyebrow>
          <Eyebrow as="span">{formatCount(applicants)} applied</Eyebrow>
        </div>
        <span
          className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-gray-400 transition-colors group-hover:text-gray-900 dark:text-gray-500 dark:group-hover:text-white"
          aria-hidden="true"
        >
          View
          <Icon.arrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Card>
  );
}

/**
 * Card-shaped placeholders, so the layout doesn't jump when the data lands.
 *
 * Built out of the kit's `Skeleton` rather than raw `bg-gray-200` divs: the
 * primitive already carries the `motion-safe:` guard and the `aria-hidden`, and
 * three surfaces had each reimplemented both slightly differently. The shape
 * tracks `JobCard` row for row — including the reserved score slot — because a
 * skeleton that is not the height of what replaces it is a layout shift with
 * extra steps.
 */
function JobSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} grid className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-11 w-11 flex-shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-9 w-20 flex-shrink-0" />
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
            <Skeleton className="h-3 w-40" />
          </div>
        </Card>
      ))}
      <span className="sr-only">Loading jobs</span>
    </div>
  );
}
