"use client";

// A server `loading.tsx` cannot reach `Icon.graph`: `ui.tsx` is a client module,
// so its object export arrives as a proxy and the property resolves to
// undefined at prerender — "Element type is invalid ... got: undefined", which
// failed the build on this route only. Direct function exports like `Skeleton`
// cross that boundary fine; a property of an object export does not. Marking
// the file a client component puts it on the same side as the module it uses.
import { Icon, Skeleton } from "@/app/components/ui";

/**
 * The sign-in screen's own loading state.
 *
 * The page is a two-column split — form left, dark context band right — and the
 * band is static, so it paints immediately here rather than waiting behind a
 * full-screen spinner. What is skeletonised is exactly what is not yet known:
 * the form column, at the heights it will occupy. The root `loading.tsx` used
 * to replace both columns with a centred spinner, which meant the reader saw
 * the layout assemble itself twice.
 */
export default function Loading() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          {/* The wordmark is known, so it is drawn rather than greyed out. */}
          <span className="flex items-center gap-2.5">
            <span className="tile tile-ink h-9 w-9">
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
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-4 w-full" />
            </div>

            <div className="space-y-5">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="mb-2 h-3 w-28" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
              <Skeleton className="h-12 w-full" />
            </div>

            <Skeleton className="my-7 h-3 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>

      {/* The band carries no copy here: duplicating the page's three numbered
          points in a loading file guarantees the two drift apart. The field
          itself is the part that matters — it holds the column open. */}
      <aside className="band-dark hidden lg:block" aria-hidden="true" />

      <span className="sr-only" role="status">
        Loading sign-in
      </span>
    </div>
  );
}
