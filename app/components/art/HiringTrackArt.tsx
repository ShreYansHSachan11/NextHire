"use client";

import { useRef, useState } from "react";
import { StatusBadge } from "@/app/components/ui";
import { bandOf } from "./art-logic";
import { usePointerField } from "./usePointerField";

/**
 * "Hiring track": one applicant moving through the four stages as the pointer
 * moves across. A single piece of state (the stage) drives the card's place,
 * its status, the progress line and which history lines are filled in, so the
 * parts can never disagree. The applicant and times are made up.
 */

const STAGES = [
  { status: "PENDING", stop: "Applied", log: "Applied with resume · fit 82" },
  { status: "SHORTLISTED", stop: "Shortlisted", log: "Shortlisted by the hiring team" },
  { status: "INTERVIEW", stop: "Interview", log: "Interview booked for Tuesday, 10:00" },
  { status: "ACCEPTED", stop: "Offer", log: "Offer sent" },
] as const;
const STOP_X = [10, 36.67, 63.33, 90];
const DOT = ["bg-amber-500", "bg-[var(--accent-fill)]", "bg-cyan-600", "bg-success-500"];

export default function HiringTrackArt({ className = "" }: { className?: string }) {
  const [stage, setStage] = useState(0);
  const stageRef = useRef(0);

  const { ref } = usePointerField<HTMLDivElement>(
    (s) => {
      const next = bandOf(s.x, STAGES.length);
      if (next !== stageRef.current) {
        stageRef.current = next;
        setStage(next);
      }
    },
    { sweep: 0.45, rest: { x: 0.5, y: 0.5 }, ease: 0.06 },
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`art-frame art-grid relative aspect-[4/3] w-full select-none overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[var(--surface-raised)] sm:aspect-[16/7] ${className}`}
    >
      {/* Track and progress. */}
      <span className="absolute h-[0.6cqi] min-h-[3px] -translate-y-1/2 rounded-full bg-[var(--line)]" style={{ left: "10%", width: "80%", top: "44%" }} />
      <span
        className="absolute h-[0.6cqi] min-h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-400 via-[var(--accent-fill)] to-success-500 transition-[width] duration-500 ease-out"
        style={{ left: "10%", width: `${STOP_X[stage] - 10}%`, top: "44%" }}
      />

      {STAGES.map((s, i) => (
        <span key={s.stop} className="absolute flex -translate-x-1/2 flex-col items-center gap-[1cqi]" style={{ left: `${STOP_X[i]}%`, top: "calc(44% - 1.6cqi)" }}>
          <span
            className={`h-[3.2cqi] w-[3.2cqi] min-h-3 min-w-3 rounded-full border-[0.6cqi] border-[var(--surface-raised)] transition-all duration-300 ${
              i <= stage ? `${DOT[i]} shadow-[0_0_0_0.5cqi_var(--accent-soft)]` : "bg-[var(--line-strong)]"
            } ${i === stage ? "scale-125" : ""}`}
          />
          <span
            className={`whitespace-nowrap font-medium transition-colors ${i <= stage ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}
            style={{ fontSize: "max(10px, 1.9cqi)" }}
          >
            {s.stop}
          </span>
        </span>
      ))}

      {/* The applicant, riding the track. */}
      <div
        className="absolute flex -translate-x-1/2 items-center gap-[1.4cqi] whitespace-nowrap rounded-[2cqi] border border-[var(--line)] bg-[var(--surface-overlay)] py-[1.2cqi] pl-[1.2cqi] pr-[1.8cqi] shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] transition-[left] duration-500 ease-out"
        style={{ left: `clamp(17%, ${STOP_X[stage]}%, 83%)`, bottom: "calc(56% + 3.6cqi)" }}
      >
        <span className="flex h-[5cqi] w-[5cqi] min-h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 font-semibold text-white" style={{ fontSize: "max(10px, 2cqi)" }}>
          J
        </span>
        <span className="flex flex-col" style={{ fontSize: "max(10px, 1.9cqi)" }}>
          <span className="font-semibold text-[var(--ink)]">Frontend engineer</span>
          <span className="text-[var(--ink-muted)]">Applicant</span>
        </span>
        <span key={stage} className="art-pop">
          <StatusBadge status={STAGES[stage].status} />
        </span>
      </div>

      {/* History, filled in stage by stage. */}
      <ol className="absolute left-[10%] right-[10%] top-[60%] grid gap-[1.2cqi] sm:grid-cols-2 sm:gap-x-[4cqi]" style={{ fontSize: "max(10px, 1.85cqi)" }}>
        {STAGES.map((s, i) => (
          <li key={s.stop} className="flex items-center gap-[1.2cqi]">
            <span className={`h-[1.4cqi] w-[1.4cqi] min-h-2 min-w-2 flex-shrink-0 rounded-full transition-colors ${i <= stage ? DOT[i] : "bg-[var(--line)]"}`} />
            {i <= stage ? (
              <span key={`${s.stop}-on`} className="art-pop truncate text-[var(--ink-muted)]">
                {s.log}
              </span>
            ) : (
              <span className="h-[1.2cqi] min-h-2 flex-1 rounded-full bg-[var(--line-subtle)]" />
            )}
          </li>
        ))}
      </ol>

      <span
        className="absolute bottom-[3cqi] right-[3.5cqi] rounded-full border border-[var(--line)] bg-[var(--surface-overlay)] px-[1.6cqi] py-[0.5cqi] text-[var(--ink-muted)]"
        style={{ fontSize: "max(9px, 1.6cqi)" }}
      >
        Example
      </span>
    </div>
  );
}
