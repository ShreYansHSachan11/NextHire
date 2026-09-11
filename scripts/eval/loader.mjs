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

/**
 * Modules the harness substitutes wholesale, by specifier.
 *
 * The harness has to run with no Postgres, and `lib/ai/search.ts`,
 * `lib/ai/cache.ts`, `lib/ai/matching.ts` and `lib/ai/skills.ts` all import
 * `@/lib/prisma` at module scope — where `new PrismaClient()` would want a
 * `DATABASE_URL` and then a server to connect to. Redirecting the *specifier*
 * is what lets those four files be loaded and measured completely unmodified:
 * dependency injection imposed from outside, rather than a flag threaded
 * through product code for the benefit of a test.
 *
 * This is the only substitution, and it is not a general mocking facility. Any
 * addition here is a claim that the harness is no longer exercising the real
 * thing, and should be argued for in EVAL.md before it is made.
 */
const SUBSTITUTIONS = new Map([
  ['@/lib/prisma', resolvePath(ROOT, 'scripts', 'eval', 'harness', 'prisma-double.ts')],
]);

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
    const substitute = SUBSTITUTIONS.get(specifier);
    if (substitute) return { url: pathToFileURL(substitute).href, shortCircuit: true };

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
