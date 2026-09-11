import Navbar from "@/app/components/Navbar";
import { Card, Skeleton } from "@/app/components/ui";

/** One field: the eyebrow label, the control, and the helper line under it. */
function FieldSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className={tall ? "h-28 w-full rounded-lg" : "h-11 w-full rounded-lg"} />
      <Skeleton className="h-3 w-48 max-w-full" />
    </div>
  );
}

/**
 * Route placeholder for the profile editor.
 *
 * Matched to the real form rather than centred: the controls are the layout, so
 * a skeleton that reproduces their stack keeps the page from jumping when the
 * seeded values arrive (DESIGN-NOTES §1.4, §5.4). The page renders this for its
 * own auth-rehydration wait too.
 */
export default function ProfileEditLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive max-w-3xl py-6 sm:py-8">
        <p role="status" className="sr-only">
          Loading your profile
        </p>

        <Skeleton className="mb-5 h-8 w-44 rounded-md" />

        <div className="mb-6 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <Card>
          <div className="space-y-2 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-40" />
          </div>

          <div className="space-y-6 p-4 sm:p-6">
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton tall />

            <div className="space-y-5 border-t border-gray-200 pt-6 dark:border-gray-700">
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-5 w-52" />
                <Skeleton className="h-4 w-full max-w-prose" />
              </div>
              <FieldSkeleton />
              <div className="grid gap-6 sm:grid-cols-2">
                <FieldSkeleton />
                <FieldSkeleton />
              </div>
              <FieldSkeleton tall />
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row">
              <Skeleton className="h-11 w-40 rounded-lg" />
              <Skeleton className="h-11 w-28 rounded-lg" />
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
