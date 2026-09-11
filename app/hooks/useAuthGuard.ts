"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";

type Role = "SEEKER" | "COMPANY" | "ADMIN";

interface AuthGuardResult {
  /** True once Redux has been rehydrated from the cookie — render nothing before this. */
  ready: boolean;
  /** True when the user satisfies the guard and the page may render. */
  allowed: boolean;
  user: RootState["auth"]["user"];
  isAuthenticated: boolean;
}

/**
 * Client-side guard for protected pages.
 *
 * Every protected page previously did `if (!isAuthenticated) router.push(...)`
 * straight in the render body. That had two bugs: Redux is empty on the first
 * paint because rehydration happens in an effect, so signed-in users were
 * bounced to the login page on every refresh; and calling `router.push` during
 * render triggers React's "cannot update a component while rendering" warning.
 *
 * This hook waits for hydration, redirects from an effect, and preserves the
 * intended destination so the user lands back where they meant to go.
 */
export function useAuthGuard(allowedRoles?: Role[]): AuthGuardResult {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const router = useRouter();
  const pathname = usePathname();

  // `AuthRehydrator` dispatches during its own mount effect, which runs before
  // this one because it sits higher in the tree.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  /*
   * ADMIN satisfies every role gate.
   *
   * Without this an admin could not open a single page in the product. The
   * Navbar hands them the seeker link set (they are not COMPANY), `middleware`
   * waves them through to /seeker/*, and then this guard rejected them — and
   * the redirect below sent them to /seeker/dashboard, which is the page they
   * were already on. The result was a white screen on every link, with no
   * error and no redirect: the one role that operates the product, and that
   * gates /api/ai/reindex, /api/ai/duplicates and /api/alerts/run, was locked
   * out of the UI entirely.
   *
   * This matches what the server already does — `canActAs` in `lib/auth.ts`
   * and the ADMIN branch of `middleware.ts` both treat ADMIN as universal — so
   * the client guard was the odd one out rather than the authority.
   */
  const roleOk =
    !allowedRoles ||
    (!!user && (user.role === "ADMIN" || allowedRoles.includes(user.role as Role)));
  const allowed = ready && isAuthenticated && roleOk;

  useEffect(() => {
    if (!ready) return;

    if (!isAuthenticated) {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/auth/login${next}`);
      return;
    }

    if (!roleOk && user) {
      // Signed in, wrong role: send them to their own dashboard rather than to
      // a login page they don't need.
      const home = user.role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard";
      // Never replace a route with itself. That was how the ADMIN lockout
      // presented: a redirect that silently did nothing, leaving `allowed`
      // false and the page rendering `null` forever. Even with ADMIN handled
      // above, a guard that can target its own path must not loop.
      if (pathname !== home) router.replace(home);
    }
  }, [ready, isAuthenticated, roleOk, user, router, pathname]);

  return { ready, allowed, user, isAuthenticated };
}
