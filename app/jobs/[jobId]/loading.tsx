import Navbar from "@/app/components/Navbar";
import { Card, Skeleton } from "@/app/components/ui";

/**
 * The posting's own loading state, shaped like the posting.
 *
 * Same reasoning as `app/jobs/loading.tsx`: the root `loading.tsx` blanks the
 * navbar and the page frame on every navigation, which is a layout shift and a
 * loss of orientation at the same moment the reader is trying to work out where
 * they have arrived. This keeps the chrome, the back link, the two-column grid
 * and the sidebar heights, so the frame is already correct when the data lands.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <div aria-hidden="true">
          <Skeleton className="mb-5 h-5 w-24" />

          <div className="mb-6 flex items-start gap-3 sm:gap-4">
            <Skeleton className="h-12 w-12 flex-shrink-0 sm:h-14 sm:w-14" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-3/4" />
              <div className="flex gap-1.5 pt-1">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-28" />
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
            <div className="lg:col-span-2">
              <Card grid className="p-4 sm:p-6">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              {/* The apply card and the match panel, at roughly their real
                  heights — the sidebar is the tallest thing on the page and
                  the one most worth holding still. */}
              <Card className="p-4 sm:p-5">
                <Skeleton className="mb-4 h-3 w-24" />
                <Skeleton className="mb-3 h-24 w-full" />
                <Skeleton className="h-11 w-full" />
              </Card>
              <Card grid className="p-4 sm:p-5">
                <Skeleton className="mb-4 h-3 w-32" />
                <Skeleton className="mb-2 h-8 w-20" />
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </Card>
            </div>
          </div>
        </div>

        <span className="sr-only" role="status">
          Loading this role
        </span>
      </main>
    </div>
  );
}
