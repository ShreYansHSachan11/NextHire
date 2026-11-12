import Navbar from "@/app/components/Navbar";
import { Card, Skeleton, SkeletonText } from "@/app/components/ui";

/**
 * Placeholder shaped like the loaded page: heading, the score panel (ring,
 * text, four small numbers), then the keywords row. No `Icon` here: this is a
 * server component (see app/seeker/coach/loading.tsx).
 */
export default function ResumeInsightsLoading() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8" aria-busy="true">
        <span className="sr-only">Loading your resume insights</span>

        <Skeleton className="mb-5 h-5 w-40" />
        <Skeleton className="mb-2 h-3 w-28" />
        <Skeleton className="mb-3 h-9 w-80 max-w-full" />
        <Skeleton className="mb-6 h-4 w-full max-w-xl" />

        <div className="space-y-10 sm:space-y-12">
          <Card elevation="raised">
            <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <Skeleton className="mx-auto h-[168px] w-[168px] sm:mx-0" rounded="rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="mb-3 h-7 w-56" />
                  <SkeletonText lines={2} />
                  <Skeleton className="mt-5 h-11 w-40" rounded="rounded-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-[92px] w-full" rounded="rounded-xl" />
                ))}
              </div>
            </div>
          </Card>

          <div>
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="mb-4 h-6 w-64" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <Card className="p-5">
                <SkeletonText lines={8} />
              </Card>
              <Card className="p-5">
                <SkeletonText lines={6} />
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
