import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/** Segment loading state — see `app/company/dashboard/loading.tsx` for the why. */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <p className="sr-only" role="status">
          Loading your company profile
        </p>

        <Skeleton className="h-5 w-40" />

        <div className="mt-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2.5 h-8 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        </div>

        <div className="panel mt-6">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-5 w-48" />
          </div>

          <div className="space-y-6 p-4 sm:p-6">
            {/* Six paired fields, then two textareas — the real form's shape. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-2 h-11 w-full rounded-lg" />
                </div>
              ))}
            </div>
            <div>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-24 w-full rounded-lg" />
            </div>
            <div>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-36 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
