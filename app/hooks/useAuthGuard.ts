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

  const roleOk = !allowedRoles || (!!user && allowedRoles.includes(user.role as Role));
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
      router.replace(user.role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard");
    }
  }, [ready, isAuthenticated, roleOk, user, router, pathname]);

  return { ready, allowed, user, isAuthenticated };
}
