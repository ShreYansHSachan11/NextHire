import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/**
 * Segment loading state for the candidate queue.
 *
 * The rows are the height of real applicant rows for a reason: the queue is the
 * page most likely to be opened cold, and the old whole-list spinner sat in a
 * short `py-12` box that a 600px list then shoved off the screen. Reserving the
 * height is the cheapest fix for that layout shift.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <p className="sr-only" role="status">
          Loading applications
        </p>

        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2.5 h-8 w-60 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        </div>

        {/* Five status tiles. */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="panel p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-10" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>

        {/* Filter strip. */}
        <div className="panel mt-4 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <Skeleton className="h-11 w-full rounded-lg lg:flex-1" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-11 w-full rounded-lg lg:w-40" />
              ))}
            </div>
          </div>
        </div>

        {/* Applicant rows, at the height of the real thing. */}
        <div className="panel mt-4">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-28" />
          </div>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Skeleton className="h-10 w-10 flex-shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-5 w-40 max-w-full" />
                      <Skeleton className="mt-2 h-3 w-56 max-w-full" />
                      <Skeleton className="mt-2.5 h-4 w-48 max-w-full" />
                      <Skeleton className="mt-2 h-3 w-32" />
                    </div>
                  </div>
                  <div className="space-y-2.5 sm:w-60 sm:flex-shrink-0">
                    <Skeleton className="h-4 w-24 sm:ml-auto" />
                    <Skeleton className="h-6 w-28 rounded-md" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
