import Navbar from "@/app/components/Navbar";
import { Card, Skeleton } from "@/app/components/ui";

/**
 * Route-level placeholder for the seeker dashboard.
 *
 * Two jobs, and they are the reason this is not the root `app/loading.tsx`
 * spinner. First, it keeps the chrome: the root fallback replaces the whole
 * document including the navigation, so a user mid-navigation loses their
 * orientation as well as the content. Second, the blocks below occupy roughly
 * the heights of the real sections, so the content that arrives does not shove
 * the page around — NN/g's rule is spinners for short blocking actions,
 * skeletons where content is being fetched and layout context matters, and the
 * ECCE 2018 skeleton-screen study found the same split improves both perceived
 * speed and perceived ease of navigation (DESIGN-NOTES §1.4, §5.2, §5.4).
 *
 * The page itself renders this component for its auth-rehydration wait too, so
 * the two waits a user can actually hit look identical.
 */
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        {/* One announcement for the whole shell. The blocks themselves are
            `aria-hidden`, so without this the wait is silent. */}
        <p role="status" className="sr-only">
          Loading your dashboard
        </p>

        {/* Page heading */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-11 w-36 rounded-lg" />
        </div>

        {/* Telemetry strip */}
        <Card grid className="mt-6 flex flex-wrap items-center gap-4 p-3 sm:mt-8 sm:p-4">
          <Skeleton className="h-10 w-10 flex-shrink-0 rounded-lg" />
          <div className="min-w-[12rem] flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24" />
        </Card>

        {/* Three stat tiles */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="space-y-3 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-32" />
            </Card>
          ))}
        </div>

        {/* Matched roles */}
        <div className="mt-6 space-y-3 sm:mt-8">
          <Skeleton className="h-3 w-32" />
          <ul className="grid list-none gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index}>
                <Card className="flex h-full flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-full space-y-2">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-8 w-16 flex-shrink-0" />
                  </div>
                  <Skeleton className="mt-3 h-1 w-full rounded-full" />
                  <div className="mt-3 flex gap-1.5">
                    <Skeleton className="h-6 w-16 rounded-lg" />
                    <Skeleton className="h-6 w-20 rounded-lg" />
                  </div>
                  <Skeleton className="mt-6 h-6 w-full" />
                </Card>
              </li>
            ))}
          </ul>
        </div>

        {/* Application list */}
        <Card className="mt-6 sm:mt-8">
          <div className="space-y-2 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-48" />
          </div>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 3 }, (_, index) => (
              <li
                key={index}
                className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-2.5">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3.5 w-1/3" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-6 w-24 rounded-lg" />
                    <Skeleton className="h-6 w-20 rounded-lg" />
                  </div>
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <div className="space-y-3 lg:w-56 lg:flex-shrink-0">
                  <Skeleton className="h-6 w-28 rounded-md" />
                  <Skeleton className="h-1 w-full rounded-full" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </div>
  );
}
