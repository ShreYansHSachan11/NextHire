import Navbar from "@/app/components/Navbar";
import { Card, Skeleton } from "@/app/components/ui";

/**
 * Route placeholder for saved searches.
 *
 * Reproduces the two-column arrangement the page settles into — list on the
 * left from `lg`, the create form on the right — so the layout does not
 * reorganise itself under the reader when the data lands (DESIGN-NOTES §5.4).
 * The page renders this for its auth-rehydration wait too.
 */
export default function AlertsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <p role="status" className="sr-only">
          Loading your saved searches
        </p>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-56 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-11 w-36 rounded-lg" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
          <div className="min-w-0 lg:order-1">
            <div className="mb-3 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-6 w-48" />
            </div>
            <ul className="flex flex-col gap-3 sm:gap-4">
              {Array.from({ length: 3 }, (_, index) => (
                <li key={index}>
                  <Card className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <Skeleton className="h-5 w-2/5" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                      <Skeleton className="h-11 w-full rounded-lg sm:w-40" />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-8 w-32 rounded-md" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 lg:order-2">
            <Card>
              <div className="space-y-2 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-36" />
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                  </div>
                ))}
                <Skeleton className="h-11 w-36 rounded-lg" />
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
