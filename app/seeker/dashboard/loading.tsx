import Navbar from "@/app/components/Navbar";
import { Card, Skeleton } from "@/app/components/ui";
import { ApplicationRowSkeleton, MatchCardSkeleton } from "@/app/components/skeletons";

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
 * speed and perceived ease of navigation.
 *
 * The page itself renders this component for its auth-rehydration wait too, so
 * the two waits a user can actually hit look identical.
 */
export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
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

        {/* Resume insights hero — the first thing on the page */}
        <Card className="mt-6 flex items-center gap-8 p-5 sm:mt-8 sm:p-7">
          <Skeleton className="hidden h-[120px] w-[120px] flex-shrink-0 sm:block" rounded="rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <Skeleton className="hidden h-11 w-40 rounded-lg lg:block" />
        </Card>

        {/* Matched roles */}
        <div className="mt-6 space-y-3 sm:mt-8">
          <Skeleton className="h-3 w-32" />
          <ul className="grid list-none gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index}>
                <MatchCardSkeleton />
              </li>
            ))}
          </ul>
        </div>

        {/* Application list */}
        <Card className="mt-6 sm:mt-8">
          {/* Heading, the three counts and the status filter, as on the page */}
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-16 w-full lg:w-[22rem]" />
            </div>
            <Skeleton className="mt-4 h-11 w-full max-w-xl" />
          </div>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index}>
                <ApplicationRowSkeleton />
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </div>
  );
}
