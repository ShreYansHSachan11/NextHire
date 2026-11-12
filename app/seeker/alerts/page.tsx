"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  IconTile,
  Label,
  PageHeading,
  Readout,
  Spinner,
  buttonGhost,
  buttonSecondary,
  formatDate,
  formatRelative,
  inputClass,
} from "@/app/components/ui";
import { SavedSearchRowSkeleton } from "@/app/components/skeletons";

import AlertsLoading from "./loading";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type AlertFrequency = "OFF" | "DAILY" | "WEEKLY";

/** One row of `GET /api/saved-searches`, matching that route's `SEARCH_SELECT`. */
interface SavedSearch {
  id: string;
  name: string;
  query: string;
  /** Client-supplied JSON on the server side, so it is narrowed here, not trusted. */
  filters: unknown;
  frequency: AlertFrequency;
  lastNotifiedAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedSearchList {
  searches: SavedSearch[];
  /** The per-user ceiling, sent by the server so the form need not hardcode it. */
  limit: number;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors of `NAME_MAX` / `QUERY_MAX` in `app/api/saved-searches/route.ts:29-30`
 * and `app/api/saved-searches/[id]/route.ts:29-30`.
 *
 * Used as `maxLength` so the field stops at the limit in front of the user,
 * rather than the server silently truncating text they already typed.
 *
 * These are *mirrors*, which is the shape this codebase has already been bitten
 * by three times — a form that accepted more than the API stored. They cannot
 * be imported because the route declares them module-privately rather than in
 * `lib/validation.ts`, where every other shared cap lives; moving them there is
 * the real fix, and it belongs in that file rather than this one.
 */
const NAME_MAX = 60;
const QUERY_MAX = 200;

/**
 * `OFF` keeps the search but stops delivery, which is a pause rather than a
 * deletion — so it reads as "Paused" and sits last, after the two live options.
 */
const FREQUENCY_OPTIONS: ReadonlyArray<{ value: AlertFrequency; label: string }> = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "OFF", label: "Paused" },
];

function frequencyLabel(value: AlertFrequency): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * Destructive action at ghost weight.
 *
 * The exported `buttonDanger` is a filled, full-height button; sitting it beside
 * the two ghost actions in the row footer would make deleting the loudest thing
 * on a page whose job is browsing. Defined here rather than added to the kit —
 * one page's layout problem is not a new design-system primitive.
 */
const rowDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** `apiFetch` throws an Error carrying the server's sentence; anything else is a bug. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The structured half of a saved search, as labels.
 *
 * The column is JSON the server allowlists to `{ remote, type, location }`, so
 * the shape is known — but it is still read defensively, because a row written
 * before that allowlist existed would otherwise crash the list.
 */
function filterLabels(filters: unknown): string[] {
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) return [];

  const source = filters as Record<string, unknown>;
  const labels: string[] = [];

  if (source.remote === true) labels.push("Remote");
  if (typeof source.type === "string" && source.type.trim()) labels.push(source.type.trim());
  if (typeof source.location === "string" && source.location.trim()) {
    labels.push(source.location.trim());
  }

  return labels;
}

/** Where a saved search actually goes: the feed, already searched. */
function resultsHref(query: string): string {
  return `/jobs?q=${encodeURIComponent(query)}`;
}

/**
 * What the alert runner has done with this search, said plainly.
 *
 * `lastRunAt` without `lastNotifiedAt` is the common and easily-misread case:
 * the search *is* running, it simply has not found anything new. Saying so
 * beats an empty timestamp that looks like a broken feature.
 */
function activityLine(search: SavedSearch): string {
  if (search.frequency === "OFF") return "Paused";
  if (search.lastNotifiedAt) return `Last alert ${formatRelative(search.lastNotifiedAt)}`;
  if (search.lastRunAt) return `Checked ${formatRelative(search.lastRunAt)} · nothing new yet`;
  return "Not checked yet";
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function SeekerAlertsPage() {
  const { ready, allowed } = useAuthGuard(["SEEKER"]);
  const toast = useToast();

  const [searches, setSearches] = useState<SavedSearch[]>([]);
  // Null until the first successful load, so the cap notice never renders
  // against a number nobody has sent yet.
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [frequency, setFrequency] = useState<AlertFrequency>("DAILY");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      const data = await apiFetch<SavedSearchList>("/api/saved-searches");
      setSearches(data.searches);
      setLimit(data.limit);
    } catch (error) {
      setLoadError(errorMessage(error, "Couldn’t load your saved searches"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Gated on `allowed` rather than on mount: before the guard has rehydrated
  // there is no cookie-backed session to fetch with, and an unauthenticated
  // 401 would flash an error at a user who is about to be redirected anyway.
  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const atCap = limit !== null && searches.length >= limit;

  const createSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating || atCap) return;

    const cleanName = name.trim();
    const cleanQuery = query.trim();

    // Checked here as well as on the server so the common mistakes cost no
    // round trip; the server's rules remain the authority.
    if (!cleanName) {
      setCreateError("Give this search a name");
      return;
    }
    if (cleanQuery.length < 2) {
      setCreateError("Type at least two characters for this alert to search for");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const created = await apiFetch<SavedSearch>("/api/saved-searches", {
        method: "POST",
        body: JSON.stringify({ name: cleanName, query: cleanQuery, frequency }),
      });
      // Newest first, matching the server's own ordering.
      setSearches((current) => [created, ...current]);
      setName("");
      setQuery("");
      toast.success("Search saved");
    } catch (error) {
      /*
       * Both 409s this route can answer with — a duplicate name and the per-user
       * ceiling — already carry a sentence written for the person reading it
       * ("You already have a saved search with that name", "You can keep up to
       * 20…"). `apiFetch` surfaces the server's message and drops the status, so
       * substituting a generic string here would throw away the only thing that
       * tells the two apart.
       */
      setCreateError(errorMessage(error, "Couldn’t save that search"));
    } finally {
      setCreating(false);
    }
  };

  /**
   * Applies one edit and swaps the server's row in.
   *
   * Deliberately not optimistic and deliberately not catching: the row that
   * comes back is the authority (PATCH re-sanitises name, query and filters),
   * and the caller needs the rejection so it can show the 409 in place.
   */
  const updateSearch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<void> => {
      const updated = await apiFetch<SavedSearch>(`/api/saved-searches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSearches((current) => current.map((row) => (row.id === id ? updated : row)));
    },
    []
  );

  const deleteSearch = useCallback(async (id: string) => {
    await apiFetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    setSearches((current) => current.filter((row) => row.id !== id));
  }, []);

  // The same skeleton the route's `loading.tsx` shows, so the rehydration wait
  // and the navigation wait are one state rather than two.
  if (!ready) return <AlertsLoading />;

  // `useAuthGuard` is already redirecting; rendering nothing avoids a frame of
  // a page this visitor is not allowed to see.
  if (!allowed) return null;

  return (
    <div className="min-h-screen">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Job alerts"
          title="Saved searches"
          description="Save a search and we’ll notify you about new jobs that match."
          className="mb-6"
          action={
            <Link href="/jobs" className={buttonSecondary}>
              <Icon.search className="h-4 w-4" />
              Browse jobs
            </Link>
          }
        />

        {loadError && (
          <Alert variant="error" className="mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError}</span>
              {/* `buttonSecondary`, not primary: a retry inside an error banner
                  is recovery, not the loudest thing on the page. Every "Try
                  again" across the seeker surfaces now uses this weight. */}
              <button type="button" onClick={() => void load()} className={buttonSecondary}>
                Try again
              </button>
            </div>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
          <section aria-labelledby="saved-searches-heading" className="min-w-0 lg:order-1">
            {/* Was `sr-only`. The list is the reason for the page, and it was
                the only section on it with no visible heading — a sighted user
                got a column of unlabelled cards while a screen-reader user got
                the label. */}
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <Eyebrow className="mb-1.5">Active</Eyebrow>
                <h2
                  id="saved-searches-heading"
                  className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl"
                >
                  Your saved searches
                </h2>
              </div>
              {!loading && !loadError && searches.length > 0 && limit !== null && (
                <Eyebrow>
                  {searches.length} of {limit}
                </Eyebrow>
              )}
            </div>

            {/* `aria-busy` on the container plus one text-only announcer, rather
                than `aria-live` around the list — a region wrapping every row
                has a screen reader re-read the whole set on any change. */}
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {loading || loadError
                ? ""
                : searches.length === 0
                  ? "You have no saved searches."
                  : `${searches.length} saved ${searches.length === 1 ? "search" : "searches"}.`}
            </p>

            <div aria-busy={loading}>
              {loading ? (
                <ul className="flex flex-col gap-3 sm:gap-4">
                  {Array.from({ length: 3 }, (_, index) => (
                    <li key={index}>
                      <SavedSearchRowSkeleton />
                    </li>
                  ))}
                </ul>
              ) : searches.length === 0 ? (
                // Suppressed when the load itself failed: the banner above
                // already says what happened, and "you have none" would be a
                // claim we cannot make about a request that never landed.
                !loadError && (
                  <Card>
                    {/* No button: "Browse jobs" is already in the page header,
                        and the form that does the job is right beside this. */}
                    <EmptyState
                      icon={<Icon.bell className="h-6 w-6" />}
                      title="No saved searches yet"
                      description="Use the form to save your first search. We’ll let you know about new jobs that match, daily or weekly."
                    />
                  </Card>
                )
              ) : (
                <ul className="flex flex-col gap-3 sm:gap-4">
                  {searches.map((search) => (
                    <li key={search.id}>
                      <SavedSearchRow
                        search={search}
                        onUpdate={updateSearch}
                        onDelete={deleteSearch}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Second in the DOM so the list — the reason for the page — leads on a
              narrow screen, and pulled alongside it from `lg` up. */}
          {/* With nothing saved yet, the form is the only thing to do here, so on
              a phone it comes first instead of under an empty card. */}
          <section
            aria-labelledby="new-search-heading"
            className={`min-w-0 lg:order-2 ${!loading && !loadError && searches.length === 0 ? "order-first" : ""}`}
          >
            <Card>
              <CardHeader
                eyebrow="New alert"
                title="Save a search"
                description="Enter what you’d type into job search."
              />

              <form onSubmit={createSearch} className="p-4 sm:p-5">
                {createError && (
                  <Alert variant="error" className="mb-4">
                    {createError}
                  </Alert>
                )}

                <div className="mb-4">
                  <Label htmlFor="alert-name" required>
                    Name
                  </Label>
                  <input
                    id="alert-name"
                    type="text"
                    value={name}
                    maxLength={NAME_MAX}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Remote React jobs"
                    className={inputClass}
                    disabled={atCap}
                  />
                </div>

                <div className="mb-4">
                  <Label htmlFor="alert-query" required hint="For example, remote React developer.">
                    Search for
                  </Label>
                  <input
                    id="alert-query"
                    type="text"
                    value={query}
                    maxLength={QUERY_MAX}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="senior react engineer, remote"
                    className={inputClass}
                    disabled={atCap}
                  />
                </div>

                <div className="mb-5">
                  <Label htmlFor="alert-frequency">Notify me</Label>
                  <select
                    id="alert-frequency"
                    value={frequency}
                    onChange={(event) => setFrequency(event.target.value as AlertFrequency)}
                    className={inputClass}
                    disabled={atCap}
                  >
                    {FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* The ceiling is a real constraint, so it is stated before the
                    button is pressed rather than only in the 409 that follows. */}
                {atCap && limit !== null && (
                  <Alert variant="warning" className="mb-4">
                    You’ve reached the limit of {limit} saved searches. Delete one to add another.
                  </Alert>
                )}

                <Button
                  type="submit"
                  disabled={atCap}
                  loading={creating}
                  loadingLabel="Saving your search"
                  icon={<Icon.plus className="h-4 w-4" />}
                >
                  {creating ? "Saving…" : "Save search"}
                </Button>
              </form>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One saved search.
 *
 * The rename draft and the row's own busy/error state live here rather than in
 * a map on the page, so typing a new name re-renders one row instead of the
 * whole list.
 */
function SavedSearchRow({
  search,
  onUpdate,
  onDelete,
}: {
  search: SavedSearch;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const toast = useToast();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(search.name);
  /**
   * Which of this row's four writes is in flight, rather than one boolean.
   *
   * The whole row still locks while any of them runs — two PATCHes racing on
   * one record is how a rename loses to a frequency change — but only the
   * control that was actually pressed shows the spinner. A shared flag put one
   * on Delete while a rename was saving.
   */
  const [pending, setPending] = useState<"rename" | "frequency" | "filters" | "delete" | null>(
    null
  );
  const busy = pending !== null;
  const [error, setError] = useState("");

  const labels = filterLabels(search.filters);
  const frequencyId = `frequency-${search.id}`;
  const renameId = `rename-${search.id}`;

  const startRename = () => {
    setDraftName(search.name);
    setError("");
    setRenaming(true);
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = draftName.trim();

    if (!cleanName) {
      setError("Give this search a name");
      return;
    }
    // Nothing changed — close the editor rather than spend a request that can
    // only come back 409 against the row's own name.
    if (cleanName === search.name) {
      setRenaming(false);
      return;
    }

    setPending("rename");
    setError("");
    try {
      await onUpdate(search.id, { name: cleanName });
      setRenaming(false);
      toast.success("Renamed");
    } catch (renameError) {
      // The duplicate-name 409 lands here with the server's own wording.
      setError(errorMessage(renameError, "Couldn’t rename that search"));
    } finally {
      setPending(null);
    }
  };

  const changeFrequency = async (value: AlertFrequency) => {
    setPending("frequency");
    setError("");
    try {
      await onUpdate(search.id, { frequency: value });
      toast.success(
        value === "OFF" ? "Alerts paused" : `Alerts set to ${frequencyLabel(value).toLowerCase()}`
      );
    } catch (frequencyError) {
      setError(errorMessage(frequencyError, "Couldn’t change how often this alerts you"));
    } finally {
      setPending(null);
    }
  };

  const clearFilters = async () => {
    setPending("filters");
    setError("");
    try {
      await onUpdate(search.id, { filters: null });
      toast.success("Filters cleared");
    } catch (filterError) {
      setError(errorMessage(filterError, "Couldn’t clear those filters"));
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    // Deleting takes the alert with it, which is the part worth naming in the
    // prompt — the row itself is trivially re-creatable, the schedule is not.
    const confirmed = window.confirm(
      `Delete "${search.name}"?\n\nYou will stop getting alerts for this search. This cannot be undone.`
    );
    if (!confirmed) return;

    setPending("delete");
    setError("");
    try {
      await onDelete(search.id);
      toast.success("Saved search deleted");
    } catch (deleteError) {
      setError(errorMessage(deleteError, "Couldn’t delete that search"));
      setPending(null);
    }
    // No `finally`: on success the row unmounts, and setting state on it would
    // be a write to a component that no longer exists.
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* A lit bell while the alert is on, a grey one once it is off. */}
          <IconTile
            icon={<Icon.bell className="h-5 w-5" />}
            tone={search.frequency === "OFF" ? "neutral" : "accent"}
          />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form onSubmit={submitRename} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor={renameId} className="sr-only">
                  New name for {search.name}
                </label>
                <input
                  id={renameId}
                  type="text"
                  value={draftName}
                  maxLength={NAME_MAX}
                  onChange={(event) => setDraftName(event.target.value)}
                  className={`${inputClass} sm:max-w-xs`}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy}
                    loading={pending === "rename"}
                    loadingLabel="Renaming this search"
                  >
                    Save
                  </Button>
                  <button
                    type="button"
                    className={buttonSecondary}
                    onClick={() => {
                      setRenaming(false);
                      setError("");
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">
                {search.name}
              </h3>
            )}

            {/* The query in mono, because it is the literal string the alert runs. */}
            <Readout className="mt-2 block break-words text-sm">{search.query}</Readout>

            {labels.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Eyebrow as="span">Also filtered to</Eyebrow>
                {labels.map((label) => (
                  <Chip key={label} icon={<Icon.filter className="h-3.5 w-3.5" />}>
                    {label}
                  </Chip>
                ))}
                {/* Clearing the filters is a PATCH like the other three, so it
                    gets the same pending treatment rather than a button that
                    looks idle for the length of the round trip. */}
                <Button
                  variant="ghost"
                  disabled={busy}
                  loading={pending === "filters"}
                  loadingLabel="Clearing these filters"
                  onClick={() => void clearFilters()}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 sm:w-40">
          <label htmlFor={frequencyId} className="sr-only">
            How often to alert for {search.name}
          </label>
          <select
            id={frequencyId}
            value={search.frequency}
            onChange={(event) => void changeFrequency(event.target.value as AlertFrequency)}
            className={inputClass}
            disabled={busy}
            // A select has nowhere to put a spinner, so the busy state it does
            // expose is the one assistive tech reads.
            aria-busy={pending === "frequency" || undefined}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Eyebrow as="span">Saved {formatDate(search.createdAt)}</Eyebrow>
          <Eyebrow as="span" accent={search.frequency !== "OFF" && !!search.lastNotifiedAt}>
            {activityLine(search)}
          </Eyebrow>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* The point of the whole row: run this search now, in the feed. */}
          <Link href={resultsHref(search.query)} className={buttonGhost}>
            View results
            <Icon.arrowRight className="h-4 w-4" />
          </Link>
          {!renaming && (
            <button type="button" onClick={startRename} className={buttonGhost} disabled={busy}>
              <Icon.edit className="h-4 w-4" aria-hidden="true" />
              Rename
            </button>
          )}
          {/* Kept on `rowDanger` rather than moved to `<Button variant="danger">`
              — the weight is the point, see that constant — so the pending
              treatment `Button` gives for free is spelled out here instead. */}
          <button
            type="button"
            onClick={() => void remove()}
            className={rowDanger}
            disabled={busy}
            aria-busy={pending === "delete" || undefined}
          >
            {pending === "delete" ? (
              <Spinner className="h-4 w-4" decorative />
            ) : (
              <Icon.trash className="h-4 w-4" aria-hidden="true" />
            )}
            Delete
            {pending === "delete" && <span className="sr-only">Deleting this search</span>}
          </button>
        </div>
      </div>
    </Card>
  );
}
