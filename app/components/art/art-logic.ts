/**
 * Pure helpers for the live artwork: no React, no DOM. Everything the pieces
 * show is illustrative. The positions are seeded so the layout is the same on
 * every visit, and no figure here is a real job, person or score.
 */

/** Small seeded PRNG (mulberry32): same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface FieldPoint {
  x: number; // 0–1
  y: number; // 0–1
  cluster: number;
  label: string;
}

export interface Cluster {
  name: string;
  x: number;
  y: number;
  roles: string[];
}

/**
 * Scatter `perCluster` points around each cluster centre (a rough Gaussian from
 * summed uniforms), kept inside a margin so dots never touch the frame.
 */
export function scatterPoints(clusters: Cluster[], perCluster: number, seed: number, spread = 0.11): FieldPoint[] {
  const rand = mulberry32(seed);
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const points: FieldPoint[] = [];
  clusters.forEach((c, ci) => {
    for (let i = 0; i < perCluster; i++) {
      points.push({
        x: Math.min(0.94, Math.max(0.06, c.x + gauss() * spread)),
        y: Math.min(0.9, Math.max(0.1, c.y + gauss() * spread)),
        cluster: ci,
        label: c.roles[i % c.roles.length],
      });
    }
  });
  return points;
}

/**
 * Indices of the `k` points nearest (x, y), nearest first. `aspect` is
 * width / height, so distance is measured in the frame's real proportions.
 */
export function nearest(points: { x: number; y: number }[], x: number, y: number, k: number, aspect = 1): number[] {
  return points
    .map((p, i) => ({ i, d: Math.hypot((p.x - x) * aspect, p.y - y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, k)
    .map((e) => e.i);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }, aspect = 1): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Illustrative fit from a distance: 0 → 96, `far` → 40, clamped. */
export function fitFromDistance(d: number, far = 0.6): number {
  return Math.round(96 - (Math.min(d, far) / far) * 56);
}

/** The same bands the product uses for fit. */
export function fitLabel(score: number): "Excellent" | "Strong" | "Good" | "Fair" {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good";
  return "Fair";
}

/** Which of `n` equal bands a 0–1 value falls in. */
export function bandOf(v: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(clamp01(v) * n)));
}

/** True when (px, py) is within radius `r` of the rectangle [x, x+w] × [y, y+h]. */
export function circleHitsRect(
  px: number,
  py: number,
  r: number,
  rect: { x: number; y: number; w: number; h: number },
  aspect = 1,
): boolean {
  const cx = Math.max(rect.x, Math.min(px, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(py, rect.y + rect.h));
  return Math.hypot((px - cx) * aspect, py - cy) <= r;
}

/** Stable key for a set of indices, so React state only changes when the set does. */
export const indexKey = (ids: number[]) => ids.join(",");
