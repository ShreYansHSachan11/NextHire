import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/*
 * Segment loading state for the employer dashboard.
 *
 * Deliberately not the root `app/loading.tsx`, which replaces the whole
 * viewport — navbar included — with one centred spinner. Losing the chrome is
 * both a loss of orientation and a guaranteed layout shift when the real page
 * lands. NN/g's split is the rule being followed: spinners for short blocking
 * actions, skeletons where content is being fetched and layout context matters.
 * Every block below is the size of the block it stands in for, so nothing jumps.
 *   https://www.nngroup.com/articles/skeleton-screens/
 *
 * `aria-hidden` is on the `Skeleton` primitive itself; the single `sr-only`
 * status line below is the whole announcement, rather than forty placeholder
 * shapes being read out one at a time.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <p className="sr-only" role="status">
          Loading your dashboard
        </p>

        {/* PageHeading: eyebrow, h1, description, action button. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2.5 h-8 w-64 max-w-full" />
            <Skeleton className="mt-3 h-4 w-full max-w-md" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg sm:w-36" />
        </div>

        {/* SignalPanel. */}
        <div className="panel grid-field mt-6 flex items-center gap-4 p-3 sm:p-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-8 w-24 sm:block" />
        </div>

        {/* Four stat tiles. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="panel p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-12" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>

        {/* Three quick actions. */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="panel flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-20" />
              </div>
            </div>
          ))}
        </div>

        {/* Postings list. */}
        <div className="panel mt-6">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-44" />
          </div>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="px-4 py-5 sm:px-6">
                <Skeleton className="h-5 w-2/3 max-w-sm" />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Skeleton className="h-6 w-24 rounded-lg" />
                  <Skeleton className="h-6 w-20 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-3 w-40" />
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
