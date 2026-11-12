"use client";

import { useMemo, useRef, useState } from "react";
import { distance, fitFromDistance, fitLabel, indexKey, nearest, scatterPoints, type Cluster } from "./art-logic";
import { usePointerField } from "./usePointerField";

/**
 * "Match field": jobs as dots in a map where similar roles sit together, the
 * way the matcher sees them. Your resume follows the pointer; the three nearest
 * jobs light up, numbered, and the strip below lists them with an
 * (illustrative) fit score.
 */

// Positions are in field space (0–1 across the map area, above the strip).
const CLUSTERS: Cluster[] = [
  { name: "Frontend", x: 0.26, y: 0.3, roles: ["Frontend engineer", "React developer", "UI engineer"] },
  { name: "Data", x: 0.74, y: 0.28, roles: ["Data analyst", "Data scientist", "ML engineer"] },
  { name: "Design", x: 0.25, y: 0.74, roles: ["Product designer", "UX researcher", "UI designer"] },
  { name: "Backend", x: 0.74, y: 0.72, roles: ["Backend engineer", "Platform engineer", "API developer"] },
];
// Fixed categorical order, muted at rest; a matched dot switches to the accent.
const CLUSTER_DOT = ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-rose-400"];
/** Share of the frame's height the map takes; the strip has the rest. */
const FIELD_H = 0.7;
/** Width / height of the map area (frame is 5:4). */
const ASPECT = 1.25 / FIELD_H;
const K = 3;

export default function MatchFieldArt({ className = "" }: { className?: string }) {
  const points = useMemo(() => scatterPoints(CLUSTERS, 9, 20251111, 0.1), []);
  const [matched, setMatched] = useState<number[]>([0, 1, 2]);
  const matchedKey = useRef(indexKey(matched));
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const scores = useRef<(HTMLSpanElement | null)[]>([]);
  const meters = useRef<(HTMLSpanElement | null)[]>([]);
  const band = useRef<HTMLSpanElement | null>(null);

  const { ref } = usePointerField<HTMLDivElement>(
    (s) => {
      // The puck stays inside the map (clear of the edges and the strip), so
      // read the pointer in field space with the same limits the CSS uses.
      const at = { x: Math.min(0.84, Math.max(0.16, s.x)), y: Math.min(0.88, Math.max(0.1, s.y / FIELD_H)) };
      const ids = nearest(points, at.x, at.y, K, ASPECT);
      const key = indexKey(ids);
      if (key !== matchedKey.current) {
        matchedKey.current = key;
        setMatched(ids);
      }
      // Rows and lines are keyed by slot, so slot n always describes match n.
      ids.forEach((id, slot) => {
        const p = points[id];
        const line = lines.current[slot];
        if (line) {
          line.setAttribute("x1", String(at.x * 100));
          line.setAttribute("y1", String(at.y * 100));
          line.setAttribute("x2", String(p.x * 100));
          line.setAttribute("y2", String(p.y * 100));
        }
        const score = fitFromDistance(distance(p, at, ASPECT), 1);
        const el = scores.current[slot];
        if (el) el.textContent = String(score);
        const meter = meters.current[slot];
        if (meter) meter.style.width = `${score}%`;
        if (slot === 0 && band.current) band.current.textContent = `${fitLabel(score)} fit`;
      });
    },
    { sweep: 0.3, rest: { x: 0.45, y: 0.35 } },
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`art-frame relative aspect-[5/4] w-full select-none overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[var(--surface-raised)] shadow-[0_30px_80px_-40px_var(--accent-glow)] ${className}`}
    >
      {/* The map. */}
      <div className="art-grid absolute inset-x-0 top-0" style={{ height: `${FIELD_H * 100}%` }}>
        {CLUSTERS.map((c) => (
          <span
            key={c.name}
            className="art-parallax absolute -translate-x-1/2 font-semibold uppercase tracking-[0.2em] text-[var(--ink-faint)] opacity-50"
            style={{ left: `${c.x * 100}%`, top: `calc(${c.y * 100}% + 9cqi)`, fontSize: "max(9px, 1.9cqi)" }}
          >
            {c.name}
          </span>
        ))}

        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {Array.from({ length: K }, (_, slot) => (
            <line
              key={slot}
              ref={(el) => {
                lines.current[slot] = el;
              }}
              className="stroke-[var(--accent)]"
              strokeWidth={slot === 0 ? 2 : 1.25}
              strokeDasharray={slot === 0 ? undefined : "3 4"}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={slot === 0 ? 0.9 : 0.55}
            />
          ))}
        </svg>

        {points.map((p, i) => {
          const slot = matched.indexOf(i);
          const on = slot !== -1;
          return (
            <span
              key={i}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-semibold text-[var(--ink-on-accent)] transition-[width,height,opacity] duration-300 ${
                on ? "z-10 bg-[var(--accent-fill)] opacity-100 shadow-[0_0_0_0.7cqi_var(--accent-soft)]" : `${CLUSTER_DOT[p.cluster]} opacity-40`
              }`}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                width: on ? "3.4cqi" : "1.5cqi",
                height: on ? "3.4cqi" : "1.5cqi",
                fontSize: "max(8px, 1.8cqi)",
              }}
            >
              {on ? slot + 1 : null}
            </span>
          );
        })}

        {/* Your resume. */}
        <span
          className="art-puck absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[1cqi] whitespace-nowrap rounded-full bg-[var(--ink)] px-[2cqi] py-[1.1cqi] font-semibold text-[var(--surface)]"
          style={{ left: "clamp(16%, var(--px), 84%)", top: `calc(clamp(0.1, var(--pyn, 0.5) / ${FIELD_H}, 0.88) * 100%)`, fontSize: "max(10px, 2.3cqi)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[2.6cqi] min-h-3 w-[2.6cqi] min-w-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" />
          </svg>
          Your resume
        </span>
      </div>

      {/* The strip: the three closest jobs. */}
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col justify-center gap-[1.3cqi] border-t border-[var(--line)] bg-[var(--surface-overlay)] px-[4cqi]"
        style={{ height: `${(1 - FIELD_H) * 100}%`, fontSize: "max(10px, 2.2cqi)" }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold uppercase tracking-[0.16em] text-[var(--ink-faint)]" style={{ fontSize: "max(8px, 1.6cqi)" }}>
            Closest jobs · example
          </span>
          <span ref={band} className="rounded-full bg-[var(--accent-soft)] px-[1.4cqi] py-[0.3cqi] font-semibold text-[var(--accent-text)]" style={{ fontSize: "max(9px, 1.8cqi)" }} />
        </div>
        {matched.map((id, slot) => (
          <div key={slot} className="grid grid-cols-[3cqi_minmax(0,1fr)_20cqi_4cqi] items-center gap-[1.6cqi]">
            <span
              className={`flex h-[3cqi] min-h-4 w-[3cqi] min-w-4 items-center justify-center rounded-full font-semibold ${
                slot === 0 ? "bg-[var(--accent-fill)] text-[var(--ink-on-accent)]" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"
              }`}
              style={{ fontSize: "max(8px, 1.6cqi)" }}
            >
              {slot + 1}
            </span>
            <span key={id} className="art-pop truncate font-medium text-[var(--ink)]">
              {points[id].label}
            </span>
            <span className="h-[0.8cqi] min-h-1 overflow-hidden rounded-full bg-[var(--line)]">
              <span
                ref={(el) => {
                  meters.current[slot] = el;
                }}
                className="block h-full rounded-full bg-[var(--accent)]"
              />
            </span>
            <span
              ref={(el) => {
                scores.current[slot] = el;
              }}
              className="mono text-right font-semibold text-[var(--ink)]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
