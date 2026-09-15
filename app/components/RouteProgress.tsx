"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin progress bar across the top of the window while a route change is in
 * flight.
 *
 * The gap it fills: pressing "Sign in" costs about 650ms of bcrypt, and then
 * the *navigation* to the dashboard costs however long that route takes to
 * load. The button keeps its own spinner through the first half and through
 * the second, but the spinner is 16px at the bottom of a form, and a reader
 * whose eyes have already moved on reads the whole wait as nothing happening.
 * Every navigation in the portal had the same hole, not just sign-in.
 *
 * Detecting the *start* of a navigation is the awkward half. `usePathname`
 * only tells you a route has already changed, and there is no App Router hook
 * for "a navigation began" that covers both `<Link>` clicks and programmatic
 * `router.push`. Both, however, go through `history.pushState`/`replaceState`,
 * so wrapping those two methods catches every navigation the router makes,
 * including the redirect after sign-in. The wrappers call the originals
 * untouched and only announce; they are installed once and restored on unmount.
 *
 * Finishing is the easy half: when `usePathname`/`useSearchParams` report a new
 * value, React has the destination and the bar completes.
 */

/** Below this, a navigation is instant enough that a flashed bar reads as a glitch. */
const SHOW_AFTER_MS = 150;

/** How long the finished bar stays at 100% before fading out. */
const SETTLE_MS = 220;

export default function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  // Timers live in refs so a re-render never loses one and leaks a stuck bar.
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (creepTimer.current) clearInterval(creepTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
    creepTimer.current = null;
  };

  /* -- start ------------------------------------------------------------- */

  useEffect(() => {
    const begin = () => {
      clearTimers();
      showTimer.current = setTimeout(() => {
        setVisible(true);
        setProgress(12);

        /*
         * The bar creeps toward 90% and stops. It cannot know how much work is
         * left — there is no progress event behind a route change — so it must
         * never claim to be finished. Easing toward an asymptote reads as
         * "still working" rather than as a stalled bar, and leaves the last
         * tenth for the moment the route actually lands.
         */
        creepTimer.current = setInterval(() => {
          setProgress((current) => (current >= 90 ? current : current + (90 - current) * 0.12));
        }, 180);
      }, SHOW_AFTER_MS);
    };

    /*
     * Two listeners, because neither alone is sufficient.
     *
     * The click handler catches `<Link>`, which is the overwhelming majority of
     * navigation and the case that must not be missed. It runs in the capture
     * phase so it sees the event before React's own handler can call
     * `preventDefault` on it.
     *
     * The `history` wrappers catch programmatic `router.push` — the redirect
     * after sign-in, which is the wait that prompted all this and which no
     * click on an anchor precedes. Next's router also wraps these methods; ours
     * goes on top and delegates, so whichever order the two are installed in,
     * the original still runs untouched.
     */
    const onClick = (event: MouseEvent) => {
      // A modified click opens a tab; the current document never navigates.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      // `#section` and `mailto:` are not navigations.
      if (!href || href.startsWith("#") || !anchor.href.startsWith("http")) return;

      const next = new URL(anchor.href);
      if (next.origin !== window.location.origin) return;
      // Same URL: React renders nothing new, so the bar would never complete.
      if (next.pathname === window.location.pathname && next.search === window.location.search) {
        return;
      }

      begin();
    };

    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    history.pushState = function pushState(...args) {
      begin();
      return originalPush.apply(this, args);
    };
    history.replaceState = function replaceState(...args) {
      begin();
      return originalReplace.apply(this, args);
    };

    // Back and forward call neither method.
    window.addEventListener("popstate", begin);
    document.addEventListener("click", onClick, true);

    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener("popstate", begin);
      document.removeEventListener("click", onClick, true);
      clearTimers();
    };
  }, []);

  /* -- finish ------------------------------------------------------------ */

  useEffect(() => {
    clearTimers();

    // Nothing was showing, so there is nothing to complete — this is the first
    // render, or a navigation that beat `SHOW_AFTER_MS`.
    if (!visible) {
      setProgress(0);
      return;
    }

    setProgress(100);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, SETTLE_MS);

    return clearTimers;
    // Deliberately keyed on the destination only. Adding `visible` would
    // re-run this the moment it is set and complete the bar instantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  if (!visible) return null;

  return (
    /*
     * Decorative. A route change already moves focus and re-announces the page,
     * and a `role="progressbar"` here would add a second, redundant
     * announcement to every navigation in the app.
     */
    <div className="route-progress" aria-hidden="true">
      <div className="route-progress-bar" style={{ width: `${progress}%` }} />
    </div>
  );
}
