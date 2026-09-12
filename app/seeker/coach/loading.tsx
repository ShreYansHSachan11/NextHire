import Navbar from "@/app/components/Navbar";
import { Card, Skeleton, SkeletonRows, SkeletonText } from "@/app/components/ui";

/**
 * Route-level placeholder for the career coach.
 *
 * Shaped like the loaded page — the role picker in the left third, the working
 * panel in the right two — at the widths the real layout uses, so the content
 * does not jump when it arrives. This was the one route under `app/` with no
 * `loading.tsx`, so it fell back to `page.tsx`'s centred spinner and then
 * shifted a full viewport when the panels rendered.
 *
 * The `Navbar` is here for the same reason it is in the other route
 * placeholders: without it the navigation drops the chrome and shoves it back
 * when the data lands, which is a larger shift than the one the skeleton exists
 * to prevent.
 *
 * No `Icon` here, deliberately: `loading.tsx` is a server component, and while
 * a direct export like `Skeleton` crosses the `"use client"` boundary fine, a
 * property of an object export (`Icon.spark`) resolves to `undefined` and fails
 * the build at prerender. See the note in WIP.md.
 */
export default function CoachLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main id="main-content" className="container-responsive py-6 sm:py-8" aria-busy="true">
        <span className="sr-only">Loading your coach</span>

        {/* "Back to dashboard" */}
        <Skeleton className="mb-5 h-5 w-40" />

        {/* PageHeading: eyebrow, title, description */}
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="mb-3 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-full max-w-xl" />

        <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
          {/* Role picker. The card carries no padding of its own — the header,
              the filter row and the list each bring theirs, exactly as on the
              loaded page. */}
          <div className="lg:col-span-1">
            <Card>
              <div className="border-b border-gray-200 p-4 dark:border-gray-700 sm:p-5">
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4">
                <Skeleton className="h-10 w-full" rounded="rounded-md" />
              </div>
              <SkeletonRows count={4} media={false} />
            </Card>
          </div>

          {/* Working panel: three tabs across the top, then the body. */}
          <div className="lg:col-span-2">
            <Card>
              <div className="grid grid-cols-3 gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-5 w-full" />
                ))}
              </div>
              <div className="p-4 sm:p-6">
                <SkeletonText lines={5} />
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
