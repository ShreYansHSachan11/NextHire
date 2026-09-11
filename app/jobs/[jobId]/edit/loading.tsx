import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/**
 * Segment loading state for the posting editor.
 *
 * Matches the post form's rail and step cards, because the two pages are meant
 * to feel like one editor. See `app/company/dashboard/loading.tsx` for why this
 * is a skeleton rather than the root spinner.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="sr-only" role="status">
          Loading this posting
        </p>

        <Skeleton className="h-5 w-40" />

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="mt-2.5 h-8 w-40" />
            <Skeleton className="mt-3 h-4 w-full max-w-sm" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg sm:w-32" />
        </div>

        {/* Record telemetry strip. */}
        <div className="mt-5 flex gap-10 border-t border-gray-200 pt-4 dark:border-gray-700">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-16" />
            </div>
          ))}
        </div>

        {/* Step rail. */}
        <div className="panel mt-6 p-3 sm:p-4">
          <Skeleton className="h-3 w-40" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>

        <div className="panel mt-4">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-5 w-40" />
          </div>
          <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-11 w-full rounded-lg" />
            </div>
            <div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-44 w-full rounded-lg" />
            </div>
          </div>
        </div>

        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="panel mt-3 px-4 py-4 sm:px-6">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-5 w-48" />
          </div>
        ))}
      </main>
    </div>
  );
}
