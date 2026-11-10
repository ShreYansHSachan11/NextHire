"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/ui";

export interface MultiSelectOption {
  /** What is stored and sent; compared case-insensitively. */
  value: string;
  /** What the option says. Defaults to `value`. */
  label?: string;
  count: number;
  /** Options with the same group are listed together under `groupLabels[group]`. */
  group?: string;
  /** Other spellings the search box should find this option by ("Bangalore"). */
  also?: string[];
}

/** Lowercased, without accents, so "zurich" finds "Zürich". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Show the search box once the list is long enough to need one. */
const SEARCH_THRESHOLD = 8;

/**
 * A filter that takes several values: a button that looks like the `<select>`
 * controls beside it and opens a checkbox list.
 *
 * Checkboxes rather than an ARIA listbox: "pick any of these" is exactly what a
 * group of checkboxes is, every screen reader already knows how to announce one,
 * and a native checkbox needs no re-implemented selection model. The button is a
 * plain disclosure (`aria-expanded` + `aria-controls`), so nothing here claims a
 * keyboard contract it does not keep.
 *
 * Keyboard: Enter/Space opens; focus moves into the panel (to the search box
 * when there is one); Up/Down move between options; Space ticks; Escape closes
 * and puts focus back on the button. Clicking outside, or tabbing out of the
 * panel, closes it too. Each tick applies at once — the list beside it updates
 * while the panel stays open, so several values are a few clicks, not several
 * open-pick-close round trips.
 */
export default function MultiSelect({
  id,
  label,
  allLabel,
  pluralNoun,
  options,
  selected,
  onChange,
  unit,
  describedBy,
  groupLabels,
  searchPlaceholder = "Search",
}: {
  id: string;
  label: string;
  /** What the closed control says with nothing picked: "All locations". */
  allLabel: string;
  /** For the closed control past two picks: "3 locations". */
  pluralNoun: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Singular noun for the counts, read out by screen readers: "job". */
  unit: string;
  describedBy?: string;
  groupLabels?: Record<string, string>;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [alignEnd, setAlignEnd] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const reactId = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const panelId = `${id}-panel`;
  const searchId = `${id}-search-${reactId}`;

  const isSelected = useMemo(() => {
    const keys = new Set(selected.map((value) => value.toLowerCase()));
    return (value: string) => keys.has(value.toLowerCase());
  }, [selected]);

  /**
   * The offered options, plus any picked value the list no longer offers — one
   * from an old link, or a place whose jobs have since closed. Without it the
   * filter would be applied with no box to untick.
   */
  const allOptions = useMemo(() => {
    const offered = new Set(options.map((option) => option.value.toLowerCase()));
    const missing = selected
      .filter((value) => !offered.has(value.toLowerCase()))
      .map((value): MultiSelectOption => ({ value, count: 0 }));
    return [...missing, ...options];
  }, [options, selected]);

  const labelOf = useCallback(
    (value: string) =>
      allOptions.find((option) => option.value.toLowerCase() === value.toLowerCase())?.label ?? value,
    [allOptions]
  );

  // One short line that fits the narrowest column of the filter bar: two
  // short names in full ("Pune, Delhi"), otherwise the first plus a count
  // ("Bengaluru +1"), and past two just the count ("3 locations"). The full
  // list is in the button's tooltip and in the chips under the bar.
  const pickedLabels = selected.map(labelOf);
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? pickedLabels[0]
        : selected.length === 2
          ? pickedLabels.join(", ").length <= 14
            ? pickedLabels.join(", ")
            : `${pickedLabels[0]} +1`
          : `${selected.length} ${pluralNoun}`;

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return allOptions;
    return allOptions.filter((option) =>
      [option.label ?? option.value, option.value, ...(option.also ?? [])].some((text) =>
        fold(text).includes(needle)
      )
    );
  }, [allOptions, query]);

  const grouped = useMemo(() => {
    const groups: Array<{ key: string; options: MultiSelectOption[] }> = [];
    for (const option of visible) {
      const key = option.group ?? "";
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.options.push(option);
      else groups.push({ key, options: [option] });
    }
    return groups;
  }, [visible]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const toggle = (value: string) => {
    onChange(
      isSelected(value)
        ? selected.filter((item) => item.toLowerCase() !== value.toLowerCase())
        : [...selected, value]
    );
  };

  // Opens towards whichever side has room: the panel is wider than a column
  // of the filter bar, and the right-hand columns would push it off-screen.
  useLayoutEffect(() => {
    if (!open || !rootRef.current || !panelRef.current) return;
    const root = rootRef.current.getBoundingClientRect();
    const width = panelRef.current.offsetWidth;
    setAlignEnd(root.left + width > window.innerWidth - 8 && root.right - width >= 8);
  }, [open]);

  // Focus into the panel on open: the search box if there is one, otherwise
  // the first option.
  useEffect(() => {
    if (!open) return;
    const target =
      searchRef.current ??
      panelRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
    target?.focus();
  }, [open]);

  // A pointer press anywhere outside closes the panel without stealing focus
  // from whatever was clicked.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const boxes = Array.from(
      panelRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)') ?? []
    );
    if (boxes.length === 0) return;
    event.preventDefault();
    const current = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (current === -1) {
      (event.key === "ArrowDown" ? boxes[0] : boxes[boxes.length - 1]).focus();
      return;
    }
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) searchRef.current?.focus();
    else boxes[Math.min(next, boxes.length - 1)].focus();
  };

  // Tabbing past the last control in the panel leaves it, and closes it.
  const onPanelBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) close(false);
  };

  const noOptions = allOptions.length === 0;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label htmlFor={id} id={labelId} className="mb-2 block">
        <span className="eyebrow">{label}</span>
      </label>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="field field-picker"
        aria-expanded={open}
        aria-controls={panelId}
        // "Location, Bengaluru, Chennai" — the field's name and then its value,
        // the way a select is announced.
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        disabled={noOptions}
        title={selected.length > 0 ? selected.map(labelOf).join(", ") : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={valueId}>{summary}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-labelledby={labelId}
          className={`picker-panel w-[min(18rem,calc(100vw-2rem))] min-w-full ${alignEnd ? "right-0" : "left-0"}`}
          onKeyDown={onPanelKeyDown}
          onBlur={onPanelBlur}
        >
          {allOptions.length > SEARCH_THRESHOLD && (
            <div className="relative p-1">
              <label htmlFor={searchId} className="sr-only">
                Search {pluralNoun}
              </label>
              <span
                className="pointer-events-none absolute inset-y-0 left-1 flex items-center pl-3 text-[var(--ink-faint)]"
                aria-hidden="true"
              >
                <Icon.search className="h-4 w-4" />
              </span>
              <input
                ref={searchRef}
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
                className="field pl-9"
              />
            </div>
          )}

          <div className="max-h-72 overflow-y-auto overscroll-contain">
            {grouped.map((group) => (
              <div key={group.key || "all"}>
                {group.key && groupLabels?.[group.key] && (
                  <p className="eyebrow picker-heading" aria-hidden="true">
                    {groupLabels[group.key]}
                  </p>
                )}
                {group.options.map((option) => {
                  const checked = isSelected(option.value);
                  // An option with nothing behind it cannot be added — it would
                  // only empty the list — but one already ticked can be unticked.
                  const disabled = option.count === 0 && !checked;
                  const text = option.label ?? option.value;
                  return (
                    <label key={option.value} className="picker-option" data-disabled={disabled}>
                      <input
                        type="checkbox"
                        className="control h-4 w-4 shrink-0"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(option.value)}
                      />
                      <span className="min-w-0 truncate" title={text.length > 28 ? text : undefined}>
                        {text}
                      </span>
                      <span className="picker-count">
                        {option.count}
                        <span className="sr-only"> {option.count === 1 ? unit : `${unit}s`}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {visible.length === 0 && (
              <p className="px-2.5 py-3 text-sm text-[var(--ink-muted)]" role="status">
                No {pluralNoun} match “{query.trim()}”.
              </p>
            )}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--line)] px-1 pt-1.5 pb-0.5">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={selected.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </button>
            <button type="button" className="btn-ink btn-sm" onClick={() => close(true)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
