"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Without one, a thrown render error showed the raw
 * Next.js overlay in development and a blank page in production.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main
      id="main-content"
      className="grid-field flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900"
    >
      <div className="panel w-full max-w-md p-8 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 9v2m0 4h.01M5.06 19h13.86c1.54 0 2.5-1.67 1.73-2.5L13.73 4c-.77-.83-1.96-.83-2.73 0L3.73 16.5c-.77.83.19 2.5 1.73 2.5Z"
            />
          </svg>
        </div>
        <p className="eyebrow mt-4">Unhandled exception</p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The page hit an unexpected error. Trying again often clears it.
        </p>
        {/* The digest is the only safe identifier to show — never the message. */}
        {error.digest && <p className="mono mt-3 text-xs text-gray-400 dark:text-gray-500">REF {error.digest}</p>}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="btn-ink">
            Try again
          </button>
          <Link href="/" className="btn-outline">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
