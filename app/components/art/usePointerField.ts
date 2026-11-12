"use client";

import { useEffect, useRef, useState } from "react";
import { clamp01 } from "./art-logic";

export interface FieldState {
  /** Eased pointer position inside the element, 0–1. */
  x: number;
  y: number;
  /** 0 at rest, 1 while a mouse or pen is over the element (eased). */
  hover: number;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Pointer → eased position, written as CSS custom properties (`--px`, `--py`
 * as percentages, `--pxn`, `--pyn` as 0–1 numbers, and `--hover`) on the element every frame, with no React render per frame.
 *
 * - When nobody is pointing (and on touch), an autopilot traces a slow
 *   Lissajous path so the piece is never static.
 * - The loop only runs while the element is on screen.
 * - With reduced motion there is no loop, no autopilot and no easing: the
 *   piece sits at `rest` and follows the pointer directly.
 */
export function usePointerField<T extends HTMLElement>(
  onFrame?: (state: FieldState) => void,
  { sweep = 0.3, rest = { x: 0.5, y: 0.5 }, ease = 0.1 }: { sweep?: number; rest?: { x: number; y: number }; ease?: number } = {},
) {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();
  const frame = useRef(onFrame);
  useEffect(() => {
    frame.current = onFrame;
  });
  const restX = rest.x;
  const restY = rest.y;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const cur: FieldState = { x: restX, y: restY, hover: 0 };
    const target: FieldState = { x: restX, y: restY, hover: 0 };
    let pointing = false;
    let raf = 0;
    let running = false;
    const start = performance.now();

    const write = () => {
      el.style.setProperty("--px", `${(cur.x * 100).toFixed(2)}%`);
      el.style.setProperty("--py", `${(cur.y * 100).toFixed(2)}%`);
      el.style.setProperty("--hover", cur.hover.toFixed(3));
      // Unitless copies, for maths where a percentage would mean the wrong box.
      el.style.setProperty("--pxn", cur.x.toFixed(4));
      el.style.setProperty("--pyn", cur.y.toFixed(4));
      frame.current?.(cur);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      pointing = true;
      target.x = clamp01((event.clientX - r.left) / r.width);
      target.y = clamp01((event.clientY - r.top) / r.height);
      target.hover = 1;
      if (reduced) {
        Object.assign(cur, target);
        write();
      }
    };
    const onLeave = () => {
      pointing = false;
      target.hover = 0;
      if (reduced) {
        Object.assign(cur, { x: restX, y: restY, hover: 0 });
        write();
      }
    };

    const tick = (now: number) => {
      if (!pointing) {
        const t = (now - start) / 1000;
        target.x = clamp01(restX + Math.sin(t * 0.31) * sweep);
        target.y = clamp01(restY + Math.sin(t * 0.47 + 1.3) * sweep * 0.7);
      }
      cur.x += (target.x - cur.x) * ease;
      cur.y += (target.y - cur.y) * ease;
      cur.hover += (target.hover - cur.hover) * ease;
      write();
      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      setActive(visible);
      if (reduced) return;
      if (visible && !running) {
        running = true;
        raf = requestAnimationFrame(tick);
      } else if (!visible && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });

    write();
    observer.observe(el);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, sweep, restX, restY, ease]);

  return { ref, active, reduced };
}
