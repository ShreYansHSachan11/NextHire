"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { circleHitsRect } from "./art-logic";
import { usePointerField } from "./usePointerField";

/**
 * "Resume lens": a resume page read through a lens. Under the lens, the words
 * employers ask for light up; each one found is ticked off in the list beside
 * the page. Once every keyword on the page is found, the ones the page never
 * mentions show as missing, then the piece starts over.
 *
 * Built for the always-dark storytelling band. The resume is a sketch (bars),
 * not a real person's document.
 */

type Seg = { w: number; kw?: string };
// x and widths in % of the frame width; y in % of its height.
const PAGE = { x: 5, y: 7, w: 56, h: 86 };
const LINES: { y: number; segs: Seg[]; heading?: boolean }[] = [
  { y: 27, segs: [{ w: 12 }], heading: true },
  { y: 34, segs: [{ w: 13 }, { w: 9, kw: "React" }, { w: 19 }] },
  { y: 41, segs: [{ w: 7 }, { w: 11 }, { w: 16.5, kw: "TypeScript" }, { w: 9 }] },
  { y: 48, segs: [{ w: 22 }, { w: 17 }] },
  { y: 55, segs: [{ w: 9 }, { w: 7, kw: "AWS" }, { w: 23 }] },
  { y: 66, segs: [{ w: 9 }], heading: true },
  { y: 73, segs: [{ w: 11 }, { w: 7, kw: "SQL" }, { w: 17 }] },
  { y: 80, segs: [{ w: 11, kw: "Node.js" }, { w: 19 }, { w: 9 }] },
];
const ASKED = ["React", "TypeScript", "AWS", "SQL", "Node.js", "Docker", "GraphQL"];
const GAP = 1.4;
const LINE_H = 4; // % of height
const ASPECT = 4 / 3;
const LENS_R = 0.13; // of the width
const LENS_X = [0.14, 0.5] as const;
const LENS_Y = [0.2, 0.84] as const;

interface Placed {
  x: number;
  y: number;
  w: number;
  kw?: string;
  heading?: boolean;
}

function layout(): Placed[] {
  const out: Placed[] = [];
  for (const line of LINES) {
    let x = PAGE.x + 4;
    for (const seg of line.segs) {
      out.push({ x, y: line.y, w: seg.w, kw: seg.kw, heading: line.heading });
      x += seg.w + GAP;
    }
  }
  return out;
}

export default function ResumeLensArt({ className = "" }: { className?: string }) {
  const placed = useMemo(layout, []);
  const onPage = useMemo(() => placed.filter((p) => p.kw).map((p) => p.kw as string), [placed]);
  const [found, setFound] = useState<string[]>([]);
  const foundRef = useRef<Set<string>>(new Set());
  const complete = found.length === onPage.length;

  const { ref, active } = usePointerField<HTMLDivElement>(
    (pointer) => {
      const s = {
        x: Math.min(LENS_X[1], Math.max(LENS_X[0], pointer.x)),
        y: Math.min(LENS_Y[1], Math.max(LENS_Y[0], pointer.y)),
      };
      let changed = false;
      for (const p of placed) {
        if (!p.kw || foundRef.current.has(p.kw)) continue;
        // Distances in height units: x scaled by the aspect ratio.
        const rect = { x: p.x / 100, y: (p.y - LINE_H / 2) / 100, w: p.w / 100, h: LINE_H / 100 };
        if (circleHitsRect(s.x, s.y, LENS_R * ASPECT * 0.75, rect, ASPECT)) {
          foundRef.current.add(p.kw);
          changed = true;
        }
      }
      if (changed) setFound([...foundRef.current]);
    },
    { sweep: 0.3, rest: { x: 0.32, y: 0.52 } },
  );

  // Hold the finished state for a moment, then read the page again.
  useEffect(() => {
    if (!complete || !active) return;
    const id = window.setTimeout(() => {
      foundRef.current = new Set();
      setFound([]);
    }, 3200);
    return () => window.clearTimeout(id);
  }, [complete, active]);

  const bar = (p: Placed, secret: boolean) => {
    const style = { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${LINE_H * 0.62}%` };
    if (secret && p.kw) {
      return (
        <span
          key={`${p.x}-${p.y}`}
          className="absolute flex -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-full bg-success-400/20 font-semibold text-success-200 ring-1 ring-inset ring-success-400/50"
          style={{ ...style, height: `${LINE_H}%`, fontSize: "max(9px, 2.1cqi)" }}
        >
          {p.kw}
        </span>
      );
    }
    return (
      <span
        key={`${p.x}-${p.y}`}
        className={`absolute -translate-y-1/2 rounded-full ${
          p.heading
            ? secret
              ? "bg-teal-300/80"
              : "bg-teal-300/40"
            : secret
              ? "bg-white/30"
              : p.kw
                ? "bg-white/25"
                : "bg-white/14"
        }`}
        style={style}
      />
    );
  };

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`art-frame relative aspect-[4/3] w-full select-none overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] ${className}`}
      style={{
        ["--lens-r" as string]: `${LENS_R * 100}cqi`,
        // The lens stays over the page, never over the list beside it.
        ["--lx" as string]: `clamp(${LENS_X[0] * 100}%, var(--px), ${LENS_X[1] * 100}%)`,
        ["--ly" as string]: `clamp(${LENS_Y[0] * 100}%, var(--py), ${LENS_Y[1] * 100}%)`,
      }}
    >
      {/* The page. */}
      <div
        className="absolute rounded-[2cqi] border border-white/10 bg-white/[0.05]"
        style={{ left: `${PAGE.x}%`, top: `${PAGE.y}%`, width: `${PAGE.w}%`, height: `${PAGE.h}%` }}
      />
      <span className="absolute rounded-full bg-white/70" style={{ left: `${PAGE.x + 4}%`, top: "13%", width: "20%", height: "3.2%" }} />
      <span className="absolute rounded-full bg-white/25" style={{ left: `${PAGE.x + 4}%`, top: "18.5%", width: "30%", height: "2.2%" }} />

      {/* Public layer, then the same layout revealed under the lens. */}
      <div className="absolute inset-0">{placed.map((p) => bar(p, false))}</div>
      <div
        className="art-reveal absolute inset-0"
        style={{ background: "radial-gradient(circle at var(--lx) var(--ly), rgb(45 212 191 / 0.12), transparent 30%)" }}
      >
        {placed.map((p) => bar(p, true))}
      </div>

      {/* The lens. */}
      <span className="art-lens pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.5cqi] border-white/80 shadow-[0_0_0_0.4cqi_rgb(45_212_191/0.35),0_20px_50px_-10px_rgb(0_0_0/0.6)]">
        <span className="absolute -bottom-[5cqi] -right-[4.5cqi] h-[1.4cqi] w-[7cqi] origin-left rotate-45 rounded-full bg-white/80" />
      </span>

      {/* What employers ask for, ticked off as the lens finds them. */}
      <div className="absolute right-[4%] top-[9%] flex w-[31%] flex-col gap-[1.6cqi]" style={{ fontSize: "max(9px, 2.2cqi)" }}>
        <span className="font-semibold uppercase tracking-[0.16em] text-white/50" style={{ fontSize: "max(8px, 1.7cqi)" }}>
          Employers ask for
        </span>
        {ASKED.map((kw) => {
          const hit = found.includes(kw);
          const missing = complete && !onPage.includes(kw);
          return (
            <span key={kw} className="flex items-center gap-[1.2cqi] text-white/80">
              <span
                className={`flex h-[3cqi] w-[3cqi] min-h-3 min-w-3 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                  hit ? "bg-success-400 text-success-950" : missing ? "bg-red-400 text-red-950" : "border border-white/25"
                }`}
              >
                {(hit || missing) && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="h-[65%] w-[65%]">
                    <path strokeLinecap="round" strokeLinejoin="round" d={hit ? "m5 12 5 5 9-10" : "M7 7l10 10M17 7 7 17"} />
                  </svg>
                )}
              </span>
              <span className={hit ? "text-white" : missing ? "text-red-200" : ""}>{kw}</span>
            </span>
          );
        })}
        <span className="mono mt-[0.6cqi] text-white/60" style={{ fontSize: "max(9px, 1.9cqi)" }}>
          {found.length} of {ASKED.length} found
        </span>
      </div>
    </div>
  );
}
