import Navbar from "@/app/components/Navbar";
import { Card, PageHeading, Skeleton } from "@/app/components/ui";

/**
 * The feed's own loading state.
 *
 * `app/loading.tsx` is a full-screen centred spinner on a `min-h-screen` field:
 * it replaces the whole page including the navbar, so every navigation loses
 * the chrome and then shoves it back. A per-segment `loading.tsx` renders the
 * *real* shell instead — same header, same two-column card grid, same heights —
 * so the only thing that changes when the data lands is the text inside the
 * cards.
 *
 * Skeletons rather than a spinner, per NN/g's split: spinners for short
 * blocking actions, skeletons where content is being fetched and the layout
 * context is itself useful information.
 * https://www.nngroup.com/articles/skeleton-screens/
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Live job feed"
          title="Open roles"
          description="Every role currently accepting applications on NextHire."
          className="mb-6"
        />

        {/* The filter bar occupies a fixed height whether or not its options
            have arrived, so the grid below never slides up the page. */}
        <Card className="mb-5 p-3 sm:mb-6 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(11rem,1fr)_repeat(4,minmax(0,9.5rem))]">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="min-w-0">
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <JobCardSkeleton key={index} />
          ))}
        </div>

        {/* The skeleton itself is `aria-hidden`; this is the announcement. */}
        <span className="sr-only" role="status">
          Loading open roles
        </span>
      </main>
    </div>
  );
}

/** Shaped to match `JobCard` in `app/jobs/page.tsx`, row for row. */
function JobCardSkeleton() {
  return (
    <Card grid className="@container p-4 @lg:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 flex-shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        {/* The score slot, reserved whether or not this reader gets a score. */}
        <Skeleton className="h-9 w-20 flex-shrink-0" />
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <Skeleton className="h-3 w-32" />
      </div>
    </Card>
  );
}
