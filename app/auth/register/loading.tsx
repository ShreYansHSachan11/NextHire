"use client";

// A server `loading.tsx` cannot reach `Icon.graph`: `ui.tsx` is a client module,
// so its object export arrives as a proxy and the property resolves to
// undefined at prerender — "Element type is invalid ... got: undefined", which
// failed the build on this route only. Direct function exports like `Skeleton`
// cross that boundary fine; a property of an object export does not. Marking
// the file a client component puts it on the same side as the module it uses.
import { Icon, Skeleton } from "@/app/components/ui";

/**
 * The sign-up screen's own loading state — the sign-in one with the longer
 * form. See `app/auth/login/loading.tsx` for why the dark band paints straight
 * away while only the form column is skeletonised.
 */
export default function Loading() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900">
              <Icon.graph className="h-5 w-5" />
            </span>
            <span className="mono text-sm font-bold uppercase tracking-[0.14em] text-gray-900 dark:text-white">
              NextHire
            </span>
          </span>
          <Skeleton className="h-9 w-9" />
        </header>

        <div className="flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-6 lg:px-10">
          <div className="w-full max-w-md" aria-hidden="true">
            <div className="mb-7 space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>

            <div className="space-y-5">
              {/* Name, email, password, confirm. */}
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="mb-2 h-3 w-28" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
              {/* The two role cards, which are the tallest block on the form. */}
              <div className="space-y-3">
                <Skeleton className="h-3 w-44" />
                <Skeleton className="h-[5.5rem] w-full" />
                <Skeleton className="h-[5.5rem] w-full" />
              </div>
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </div>
      </div>

      <aside className="band-dark hidden lg:block" aria-hidden="true" />

      <span className="sr-only" role="status">
        Loading sign-up
      </span>
    </div>
  );
}
