"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import {
  Alert,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  Label,
  PageHeading,
  Readout,
  Spinner,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  formatDate,
  formatRelative,
  inputClass,
} from "@/app/components/ui";

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
 * Mirrors of the route's `NAME_MAX` / `QUERY_MAX`.
 *
 * Used as `maxLength` so the field stops at the limit in front of the user,
 * rather than the server silently truncating text they already typed.
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
  if (search.frequency === "OFF") return "Paused — not being checked";
  if (search.lastNotifiedAt) return `Last alert ${formatRelative(search.lastNotifiedAt)}`;
  if (search.lastRunAt) return `Checked ${formatRelative(search.lastRunAt)} — nothing new yet`;
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
      setLoadError(errorMessage(error, "Could not load your saved searches"));
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
      setCreateError(errorMessage(error, "Could not save that search"));
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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner label="Loading your alerts" />
      </div>
    );
  }

  // `useAuthGuard` is already redirecting; rendering nothing avoids a frame of
  // a page this visitor is not allowed to see.
  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Job alerts"
          title="Saved searches"
          description="Save a search once and NextHire keeps running it for you. New roles that fit turn up in your notifications."
          className="mb-6"
          action={
            <Link href="/jobs" className={buttonSecondary}>
              <Icon.search className="h-4 w-4" />
              Browse roles
            </Link>
          }
        />

        {loadError && (
          <Alert variant="error" className="mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError}</span>
              <button type="button" onClick={() => void load()} className={buttonPrimary}>
                Try again
              </button>
            </div>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
          <section aria-labelledby="saved-searches-heading" className="min-w-0 lg:order-1">
            <h2 id="saved-searches-heading" className="sr-only">
              Your saved searches
            </h2>

            {loading ? (
              <Card className="p-10">
                <div className="flex justify-center">
                  <Spinner label="Loading your saved searches" />
                </div>
              </Card>
            ) : searches.length === 0 ? (
              !loadError && (
                <Card>
                  <EmptyState
                    icon={<Icon.bell className="h-6 w-6" />}
                    title="No saved searches yet"
                    description="A saved search is a job search you don’t have to repeat. Name one, and every new posting that fits it turns up in your notifications — daily or weekly, your choice."
                    action={
                      <Link href="/jobs" className={buttonPrimary}>
                        <Icon.search className="h-4 w-4" />
                        Find a search to save
                      </Link>
                    }
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
          </section>

          {/* Second in the DOM so the list — the reason for the page — leads on a
              narrow screen, and pulled alongside it from `lg` up. */}
          <section aria-labelledby="new-search-heading" className="min-w-0 lg:order-2">
            <Card>
              <CardHeader
                eyebrow="New alert"
                title="Save a search"
                description="Describe the role the way you would type it into the search box."
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
                    placeholder="Remote React roles"
                    className={inputClass}
                    disabled={atCap}
                  />
                </div>

                <div className="mb-4">
                  <Label htmlFor="alert-query" required hint="The same words you would search the feed with.">
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
                  <Label htmlFor="alert-frequency">Tell me</Label>
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
                    You are keeping the maximum of {limit} saved searches. Delete one to add another.
                  </Alert>
                )}

                <button type="submit" className={buttonPrimary} disabled={creating || atCap}>
                  {creating ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Icon.plus className="h-4 w-4" />
                      Save search
                    </>
                  )}
                </button>

                {!atCap && limit !== null && searches.length > 0 && (
                  <Eyebrow className="mt-3">
                    {searches.length} of {limit} saved
                  </Eyebrow>
                )}
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
  const [busy, setBusy] = useState(false);
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

    setBusy(true);
    setError("");
    try {
      await onUpdate(search.id, { name: cleanName });
      setRenaming(false);
      toast.success("Renamed");
    } catch (renameError) {
      // The duplicate-name 409 lands here with the server's own wording.
      setError(errorMessage(renameError, "Could not rename that search"));
    } finally {
      setBusy(false);
    }
  };

  const changeFrequency = async (value: AlertFrequency) => {
    setBusy(true);
    setError("");
    try {
      await onUpdate(search.id, { frequency: value });
      toast.success(
        value === "OFF" ? "Alerts paused" : `Alerts set to ${frequencyLabel(value).toLowerCase()}`
      );
    } catch (frequencyError) {
      setError(errorMessage(frequencyError, "Could not change how often this alerts you"));
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = async () => {
    setBusy(true);
    setError("");
    try {
      await onUpdate(search.id, { filters: null });
      toast.success("Filters cleared");
    } catch (filterError) {
      setError(errorMessage(filterError, "Could not clear those filters"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // Deleting takes the alert with it, which is the part worth naming in the
    // prompt — the row itself is trivially re-creatable, the schedule is not.
    const confirmed = window.confirm(
      `Delete "${search.name}"?\n\nYou will stop getting alerts for this search. This cannot be undone.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await onDelete(search.id);
      toast.success("Saved search deleted");
    } catch (deleteError) {
      setError(errorMessage(deleteError, "Could not delete that search"));
      setBusy(false);
    }
    // No `finally`: on success the row unmounts, and setting state on it would
    // be a write to a component that no longer exists.
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                <button type="submit" className={buttonPrimary} disabled={busy}>
                  Save
                </button>
                <button
                  type="button"
                  className={buttonGhost}
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
              <button
                type="button"
                onClick={() => void clearFilters()}
                className={buttonGhost}
                disabled={busy}
              >
                Clear
              </button>
            </div>
          )}
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
          <button
            type="button"
            onClick={() => void remove()}
            className={rowDanger}
            disabled={busy}
          >
            <Icon.trash className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
    </Card>
  );
}
