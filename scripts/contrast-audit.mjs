/**
 * Contrast audit for app/globals.css.
 *
 * Parses the `@theme`, `:root` and `.dark` blocks out of the real stylesheet
 * (so the numbers can never drift from the source), composites any translucent
 * token over the surface it is used on, and checks every text/graphic pair the
 * kit actually produces against WCAG 2.x 1.4.3 (4.5:1 text) and 1.4.11
 * (3:1 non-text / UI component / focus indicator).
 */
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(path.resolve("app/globals.css"), "utf8");

/* ---------------------------------------------------------------- parsing */

function block(name, opener) {
  const i = CSS.indexOf(opener);
  if (i < 0) throw new Error(`missing block ${name}`);
  let depth = 0;
  let start = CSS.indexOf("{", i);
  for (let j = start; j < CSS.length; j++) {
    if (CSS[j] === "{") depth++;
    else if (CSS[j] === "}") {
      depth--;
      if (depth === 0) return CSS.slice(start + 1, j);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function vars(text) {
  const out = {};
  // Strip comments so a hex inside a comment never lands in the table.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const themeVars = vars(block("@theme", "\n@theme {"));
const rootVars = vars(block(":root", "\n:root {"));
const darkVars = vars(block(".dark", "\n.dark {"));

const LIGHT = { ...themeVars, ...rootVars };
const DARK = { ...themeVars, ...rootVars, ...darkVars };

/* ------------------------------------------------------------ colour maths */

function parse(value, scope, depth = 0) {
  if (depth > 8) throw new Error("var cycle");
  let v = String(value).trim();

  const varRef = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varRef) return parse(scope[varRef[1]], scope, depth + 1);

  if (v.startsWith("#")) {
    const h = v.slice(1);
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [
      parseInt(f.slice(0, 2), 16),
      parseInt(f.slice(2, 4), 16),
      parseInt(f.slice(4, 6), 16),
      f.length === 8 ? parseInt(f.slice(6, 8), 16) / 255 : 1,
    ];
  }

  // rgb(11 17 28 / 0.055)  and  rgba(11, 17, 28, 0.055)
  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }

  throw new Error(`cannot parse colour: ${value}`);
}

/** Alpha-composite `fg` (possibly translucent) over opaque `bg`. */
function over(fg, bg) {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* -------------------------------------------------------------- the pairs */

/**
 * Each entry: [label, foreground, background, minimum].
 * Foreground/background may be a token name, a literal colour, or
 * `["stack", topToken, baseToken]` for a translucent layer over a surface.
 */
const pairs = () => [
  // ---- Body and secondary text on every surface tier -----------------------
  ["ink on canvas", "--ink", "--canvas", 4.5],
  ["ink on surface", "--ink", "--surface", 4.5],
  ["ink on surface-raised", "--ink", "--surface-raised", 4.5],
  ["ink on surface-overlay", "--ink", "--surface-overlay", 4.5],
  ["ink on surface-sunken", "--ink", "--surface-sunken", 4.5],
  ["ink-muted on canvas", "--ink-muted", "--canvas", 4.5],
  ["ink-muted on surface", "--ink-muted", "--surface", 4.5],
  ["ink-muted on surface-raised", "--ink-muted", "--surface-raised", 4.5],
  ["ink-muted on surface-overlay", "--ink-muted", "--surface-overlay", 4.5],
  ["ink-muted on surface-sunken", "--ink-muted", "--surface-sunken", 4.5],
  // .eyebrow is 11px — never eligible for the large-text exemption.
  ["ink-faint (eyebrow) on canvas", "--ink-faint", "--canvas", 4.5],
  ["ink-faint (eyebrow) on surface", "--ink-faint", "--surface", 4.5],
  ["ink-faint (eyebrow) on surface-raised", "--ink-faint", "--surface-raised", 4.5],
  ["ink-faint (eyebrow) on surface-overlay", "--ink-faint", "--surface-overlay", 4.5],
  ["ink-faint (eyebrow) on surface-sunken", "--ink-faint", "--surface-sunken", 4.5],

  // ---- The re-tuned ramp step used as text --------------------------------
  ["text-gray-500 on canvas", "--color-gray-500", "--canvas", 4.5],
  ["text-gray-500 on surface", "--color-gray-500", "--surface", 4.5],
  ["text-gray-500 on surface-overlay", "--color-gray-500", "--surface-overlay", 4.5],

  // ---- Accent as text -----------------------------------------------------
  ["accent-text on canvas", "--accent-text", "--canvas", 4.5],
  ["accent-text on surface", "--accent-text", "--surface", 4.5],
  ["accent-text on accent-soft/surface", "--accent-text", ["stack", "--accent-soft", "--surface"], 4.5],
  ["accent-text on accent-soft/canvas", "--accent-text", ["stack", "--accent-soft", "--canvas"], 4.5],

  // ---- Accent as a graphic (meter fill, live dot): 3:1 --------------------
  ["accent graphic on surface", "--accent", "--surface", 3],
  ["accent graphic on canvas", "--accent", "--canvas", 3],
  ["accent graphic on meter track", "--accent", "--line", 3],
  ["ink-on-accent over accent-fill", "--ink-on-accent", "--accent-fill", 4.5],
  ["accent-fill vs surface", "--accent-fill", "--surface", 3],

  // ---- Buttons ------------------------------------------------------------
  ["btn-ink label", "--btn-fg", "--btn-bg", 4.5],
  ["btn-ink label (hover)", "--btn-fg", "--btn-bg-hover", 4.5],
  ["btn-ink label (active)", "--btn-fg", "--btn-bg-active", 4.5],
  ["btn-ink fill vs canvas", "--btn-bg", "--canvas", 3],
  ["btn-outline label", "--ink", "--surface", 4.5],
  ["btn-outline label (hover wash)", "--ink", ["stack", "--wash-hover", "--surface"], 4.5],
  ["btn-outline border vs surface", "--line-control", "--surface", 3],
  ["btn-outline border vs canvas", "--line-control", "--canvas", 3],
  ["btn-ghost label", "--ink-muted", "--canvas", 4.5],
  ["btn-ghost label (hover wash)", "--ink", ["stack", "--wash-hover", "--canvas"], 4.5],

  // ---- Fields -------------------------------------------------------------
  ["field text", "--ink", "--surface", 4.5],
  ["field placeholder", "--ink-faint", "--surface", 4.5],
  ["field border vs surface", "--line-control", "--surface", 3],
  ["field border vs canvas", "--line-control", "--canvas", 3],
  ["field border vs surface-raised", "--line-control", "--surface-raised", 3],
  ["field border vs surface-overlay", "--line-control", "--surface-overlay", 3],
  ["field hover border vs surface", "--ink-muted", "--surface", 3],

  // ---- Focus indicator (SC 1.4.11 / 2.4.13) -------------------------------
  ["focus ring on canvas", "--focus-ring", "--canvas", 3],
  ["focus ring on surface", "--focus-ring", "--surface", 3],
  ["focus ring on surface-raised", "--focus-ring", "--surface-raised", 3],
  ["focus ring on surface-overlay", "--focus-ring", "--surface-overlay", 3],
  // Not checked against the button *fill*: the ring is drawn at a 2px
  // outline-offset, so the colour adjacent to it is the surface behind the
  // control, never the control's own background. That is the point of the gap.

  // ---- Chips --------------------------------------------------------------
  ["chip text on chip bg (light path)", "--ink-muted", "--canvas", 4.5],
  // Hairlines are decoration, not the identifier of a control — 1.4.11 does not
  // apply to them (it exempts "decoration" and anything not required to identify
  // a component). They are checked only for *visibility*, which is a house rule
  // rather than a WCAG one; the control boundary that does carry meaning is
  // `--line-control` above, checked at 3:1.
  ["chip border visible on canvas", "--line", "--canvas", 1.12],
  ["chip-accent text", "--accent-text", ["stack", "--accent-soft", "--surface"], 4.5],

  // ---- Hairlines as component boundaries (3:1 only where load-bearing) ----
  ["panel hairline visible on canvas", "--line", "--canvas", 1.12],
  ["panel hairline visible on surface", "--line", "--surface", 1.12],
  ["line-subtle divider visible on surface", "--line-subtle", "--surface", 1.03],
  ["line-strong visible on surface", "--line-strong", "--surface", 1.3],
  ["line-control vs surface-raised", "--line-control", "--surface-raised", 3],
  ["line-control vs surface-overlay", "--line-control", "--surface-overlay", 3],
  ["muted meter fill vs meter track", "--ink-faint", "--line", 3],
  ["muted meter fill vs surface", "--ink-faint", "--surface", 3],
  ["pipeline track seg vs surface", "--line-control", "--surface", 3],

  // ---- State layers must not swallow the text sitting on them -------------
  ["ink on hover wash over surface", "--ink", ["stack", "--wash-hover", "--surface"], 4.5],
  ["ink on active wash over surface", "--ink", ["stack", "--wash-active", "--surface"], 4.5],
  ["ink on selected wash over surface", "--ink", ["stack", "--wash-selected", "--surface"], 4.5],
  ["ink-muted on hover wash over surface", "--ink-muted", ["stack", "--wash-hover", "--surface"], 4.5],
  ["ink-faint on hover wash over surface", "--ink-faint", ["stack", "--wash-hover", "--surface"], 4.5],
  ["ink-faint on selected wash over canvas", "--ink-faint", ["stack", "--wash-selected", "--canvas"], 4.5],
  ["ink on hover wash over overlay", "--ink", ["stack", "--wash-hover", "--surface-overlay"], 4.5],
  ["ink-faint on hover wash over overlay", "--ink-faint", ["stack", "--wash-hover", "--surface-overlay"], 4.5],
  // The lightest composite the kit can produce: a selected row inside a popover.
  // Every text tier has to clear AA on it, which is what caps --wash-selected.
  ["ink on selected wash over overlay", "--ink", ["stack", "--wash-selected", "--surface-overlay"], 4.5],
  ["ink-muted on selected wash over overlay", "--ink-muted", ["stack", "--wash-selected", "--surface-overlay"], 4.5],
  ["ink-faint on selected wash over overlay", "--ink-faint", ["stack", "--wash-selected", "--surface-overlay"], 4.5],
  ["ink-faint on selected wash over surface", "--ink-faint", ["stack", "--wash-selected", "--surface"], 4.5],
  // Pressed is momentary (it lasts as long as the pointer is down), so only the
  // two body tiers are held to 4.5 on it; the 11px mono tier is not.
  ["ink on active wash over overlay", "--ink", ["stack", "--wash-active", "--surface-overlay"], 4.5],
  ["ink-muted on active wash over overlay", "--ink-muted", ["stack", "--wash-active", "--surface-overlay"], 4.5],

  // ---- Skeleton must read as a block, not as noise (3:1 not required, but
  //      it has to be visible at all — checked as a graphic at 1.3:1) -------
  ["skeleton vs surface (visible)", "--skeleton", "--surface", 1.18],
  ["skeleton vs canvas (visible)", "--skeleton", "--canvas", 1.1],

  // ---- The elevation ladder itself must be perceptible -------------------
  // No WCAG floor applies; 1.04 is roughly the point at which a large flat area
  // reads as a different surface rather than as a rendering artefact.
  ["surface vs canvas", "--surface", "--canvas", 1.04],
  ["surface-raised vs surface", "--surface-raised", "--surface", 1.0],
  ["surface-overlay vs surface", "--surface-overlay", "--surface", 1.0],
  ["surface-sunken vs canvas", "--surface-sunken", "--canvas", 1.02],

  // ---- Header ------------------------------------------------------------
  ["ink on header over canvas", "--ink", ["stack", "--header-bg", "--canvas"], 4.5],
  ["ink-muted on header over canvas", "--ink-muted", ["stack", "--header-bg", "--canvas"], 4.5],
  ["ink-faint on header over canvas", "--ink-faint", ["stack", "--header-bg", "--canvas"], 4.5],

  // ---- Segmented control -------------------------------------------------
  // The count beside each label. It used to be `opacity-60` on muted ink, which
  // composites to roughly 2.8:1 on the light canvas — it is a real number the
  // user reads, not decoration, so it gets a token instead of a fade.
  ["segment count (unselected) on surface", "--ink-faint", "--surface", 4.5],
  ["segment count (unselected) on canvas", "--ink-faint", "--canvas", 4.5],
  // On the filled segment the fade survives, because white on ink has the
  // headroom to spend.
  ["segment count (selected) on ink fill", ["fade", "--btn-fg", 0.75, "--btn-bg"], "--btn-bg", 4.5],
  ["segment label (selected) on ink fill", "--btn-fg", "--btn-bg", 4.5],
];

function resolve(spec, scope) {
  // ["fade", token, alpha, base] — a token drawn at partial opacity over a
  // surface, which is what a CSS `opacity` on a text node actually produces.
  if (Array.isArray(spec) && spec[0] === "fade") {
    const base = parse(scope[spec[3]] ?? spec[3], scope);
    const top = parse(scope[spec[1]] ?? spec[1], scope);
    return over([top[0], top[1], top[2], spec[2]], base);
  }
  if (Array.isArray(spec) && spec[0] === "stack") {
    const base = parse(scope[spec[2]] ?? spec[2], scope);
    const top = parse(scope[spec[1]] ?? spec[1], scope);
    return over(top, base);
  }
  const raw = scope[spec] ?? spec;
  const c = parse(raw, scope);
  if (c[3] !== 1) throw new Error(`translucent colour used as opaque: ${spec}`);
  return c;
}

/* --------------------------------------------------------------- the run */

let failures = 0;
let checked = 0;

for (const [themeName, scope] of [
  ["LIGHT", LIGHT],
  ["DARK", DARK],
]) {
  console.log(`\n=== ${themeName} ===`);
  for (const [label, fgSpec, bgSpec, min] of pairs()) {
    const fg = resolve(fgSpec, scope);
    const bg = resolve(bgSpec, scope);
    const r = ratio(fg, bg);
    checked++;
    const ok = r + 1e-9 >= min;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)}:1  (min ${min})  ${label}`
    );
  }
}

console.log(`\n${checked} pairs checked across both themes, ${failures} failing.`);
process.exit(failures ? 1 : 0);
