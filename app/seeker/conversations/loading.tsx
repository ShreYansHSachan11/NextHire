import Navbar from "@/app/components/Navbar";
import { Skeleton } from "@/app/components/ui";

/**
 * Route-level placeholder for the seeker's messages.
 *
 * Shaped like the real two-pane layout rather than a centred spinner: the list
 * rail on the left, the thread on the right, at the same widths the loaded page
 * uses. A placeholder that matches the layout it replaces is what stops the
 * content jumping when it arrives, and it is the reason this is a skeleton and
 * not a `<Spinner>` — the wait here is a list fetch, not a brief action.
 *
 * Also imported directly by `page.tsx`, which renders it while `useAuthGuard`
 * is still resolving. Next only applies `loading.tsx` to the server boundary,
 * and the client-side auth check happens after that, so without the direct use
 * the skeleton would vanish and reappear. That is also why the `Navbar` is
 * here: this stands in for the whole page, chrome included, and without it the
 * header would drop out and shove back in on every navigation.
 */
export default function ConversationsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
        aria-busy="true"
      >
        <span className="sr-only">Loading your messages</span>

        <Skeleton className="mb-2 h-3 w-28" />
        <Skeleton className="mb-8 h-8 w-56" />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {/* Conversation rail. The avatar placeholder is a rounded square
              because `Avatar` is one — a circle here would promise a shape the
              real content does not deliver. */}
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3 rounded-lg p-3">
                <Skeleton className="h-9 w-9 shrink-0" rounded="rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>

          {/* Thread pane. Alternating widths and sides read as a conversation
              rather than as a stack of identical bars. */}
          <div className="hidden min-h-[24rem] flex-col justify-end gap-3 rounded-lg p-4 lg:flex">
            {["w-2/3", "w-2/5", "w-3/4", "w-1/2", "w-3/5"].map((width, index) => (
              <div
                key={width}
                className={index % 2 === 0 ? "flex justify-start" : "flex justify-end"}
              >
                <Skeleton className={`h-10 ${width}`} rounded="rounded-2xl" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
