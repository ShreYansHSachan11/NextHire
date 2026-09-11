/**
 * Entry point for the retrieval evaluation harness.
 *
 *   npm run eval
 *
 * which expands to
 *
 *   node --import ./scripts/eval/loader.mjs ./scripts/eval/run.ts
 *
 * No test runner and no TypeScript runner: Node's own type-stripping executes
 * the `.ts` files, and `loader.mjs` closes the two gaps that leaves. Nothing
 * was added to `devDependencies` for this. See EVAL.md.
 *
 * The import order below is not incidental. `lib/ai/config.ts` reads
 * `GEMINI_EMBEDDING_MODEL` and `GEMINI_EMBEDDING_DIMENSIONS` at module scope,
 * so `.env` has to be in `process.env` before anything under `lib/` is
 * evaluated. ES modules are evaluated depth-first in declaration order, which
 * makes `dotenv/config` first and `./harness/run-eval` second sufficient — and
 * makes re-ordering these two lines a real bug.
 */

import 'dotenv/config';
import { MissingApiKeyError } from './harness/embed-cache';
import { run } from './harness/run-eval';

try {
  await run();
} catch (error) {
  if (error instanceof MissingApiKeyError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
