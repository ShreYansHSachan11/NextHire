/**
 * Module resolution shim for the evaluation harness.
 *
 * The harness runs on Node's built-in TypeScript type-stripping (Node >= 22.18)
 * rather than on `tsx` or `ts-node`, because neither is in `devDependencies`
 * and the harness is not worth a new dependency. Type-stripping gets us TS
 * syntax for free but nothing else, so two gaps have to be closed here:
 *
 *   1. `@/lib/...` — the `paths` alias in `tsconfig.json` is a compiler
 *      concept. Node has never heard of it, and `lib/ai/matching.ts` imports
 *      `@/lib/prisma`, so the harness cannot load the real matching code
 *      without it.
 *   2. Extensionless relative imports — the app's own style, and the style
 *      `tsconfig.json` (`moduleResolution: "bundler"`) enforces, but Node's
 *      ESM resolver requires an explicit extension.
 *
 * `module.registerHooks` is synchronous and in-process, so unlike a loader
 * thread it adds no startup cost and needs no serialisation.
 *
 * Usage:  node --import ./scripts/eval/loader.mjs ./scripts/eval/run.ts
 */
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

/** Project root — this file lives at <root>/scripts/eval/loader.mjs. */
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Extensions tried, in the order TypeScript itself would try them. */
const CANDIDATES = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

function firstExistingFile(basePath) {
  for (const suffix of CANDIDATES) {
    const candidate = basePath + suffix;
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      /* unreadable path — treat as absent and keep looking */
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const found = firstExistingFile(resolvePath(ROOT, specifier.slice(2)));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // Only relative specifiers get the extension retry. A bare specifier that
      // failed to resolve is a genuinely missing package, and silently probing
      // for it would turn a clear error into a confusing one.
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!isRelative || !context.parentURL) throw error;

      const parentDir = dirname(fileURLToPath(context.parentURL));
      const found = firstExistingFile(resolvePath(parentDir, specifier));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
      throw error;
    }
  },
});
