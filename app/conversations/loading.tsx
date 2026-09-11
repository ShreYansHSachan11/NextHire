import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/** Segment loading state — see `app/company/dashboard/loading.tsx` for the why. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <p className="sr-only" role="status">
          Loading messages
        </p>

        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2.5 h-8 w-44" />
          <Skeleton className="mt-3 h-4 w-full max-w-md" />
        </div>

        {/* The same two-pane split the real page uses, at the same height, so
            the thread does not jump into place once it arrives. */}
        <div className="mt-6 grid gap-4 lg:grid-cols-5 lg:gap-6">
          <div className="lg:col-span-2">
            <div className="panel flex h-[60vh] min-h-[24rem] flex-col overflow-hidden lg:h-[calc(100vh-15rem)]">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5">
                <Skeleton className="h-4 w-24" />
              </div>
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {Array.from({ length: 6 }, (_, index) => (
                  <li key={index} className="flex items-start gap-3 p-3 sm:p-4">
                    <Skeleton className="h-10 w-10 flex-shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-4 w-32 max-w-full" />
                      <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                      <Skeleton className="mt-2 h-3 w-full" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="hidden lg:col-span-3 lg:block">
            <div className="panel h-[calc(100vh-15rem)] min-h-[24rem] overflow-hidden">
              <div className="flex items-center gap-3 border-b border-gray-200 px-3 py-3 dark:border-gray-700 sm:px-5">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="min-w-0">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="mt-1.5 h-3 w-48" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
