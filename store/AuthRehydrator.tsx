"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { login, logout } from "./authSlice";
import { getToken, clearToken, decodeToken } from "@/lib/clientAuth";

/**
 * Restores the Redux auth slice from the token cookie on a hard navigation.
 *
 * The cookie is the source of truth across page loads, so this must run before
 * any protected page decides whether to redirect — `useAuthGuard` waits a tick
 * for exactly that reason.
 *
 * Previously this logged the decoded JWT (and the whole user object) to the
 * console on every page load, and it never checked expiry, so an expired token
 * left the UI looking signed in until the first API call failed.
 */
export default function AuthRehydrator() {
  const dispatch = useDispatch();

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const payload = decodeToken(token);
    const expired =
      typeof payload?.exp === "number" ? (payload.exp as number) * 1000 < Date.now() : false;

    if (!payload || expired || typeof payload.id !== "string" || typeof payload.role !== "string") {
      clearToken();
      dispatch(logout());
      return;
    }

    dispatch(
      login({
        user: {
          id: payload.id as string,
          name: typeof payload.name === "string" ? payload.name : "",
          email: typeof payload.email === "string" ? payload.email : "",
          role: payload.role as "SEEKER" | "COMPANY" | "ADMIN",
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          company:
            typeof payload.companyName === "string" ? { name: payload.companyName } : undefined,
        },
        token,
      })
    );
  }, [dispatch]);

  return null;
}
