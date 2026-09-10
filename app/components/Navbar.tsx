"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { signOut } from "next-auth/react";
import type { RootState } from "@/store/store";
import { logout } from "@/store/authSlice";
import { clearToken } from "@/lib/clientAuth";
import NotificationBell from "./NotificationBell";
import { ThemeToggle } from "./ThemeProvider";
import { Icon } from "./ui";

interface NavLink {
  href: string;
  label: string;
}

/**
 * One navigation bar for the whole app.
 *
 * Every page previously hand-rolled its own header, so the jobs feed had no way
 * to sign out, the company side never showed the notification bell, and the
 * "Profile" link meant something different depending on where you were.
 */
export default function Navbar({ variant = "app" }: { variant?: "app" | "marketing" }) {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Rendering auth-dependent links before rehydration would mismatch the server
  // markup, so hold the signed-out shape until we've mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const signedIn = mounted && isAuthenticated;

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  const handleSignOut = async () => {
    dispatch(logout());
    clearToken();
    try {
      // Clears the NextAuth session too, for accounts that signed in via Google.
      await signOut({ redirect: false });
    } catch {
      // NextAuth is optional; a failure here must not block signing out.
    }
    router.push("/");
    router.refresh();
  };

  const links: NavLink[] = signedIn
    ? user?.role === "COMPANY"
      ? [
          { href: "/company/dashboard", label: "Overview" },
          { href: "/jobs/post", label: "Post a role" },
          { href: "/applications", label: "Candidates" },
          { href: "/conversations", label: "Messages" },
        ]
      : [
          { href: "/seeker/dashboard", label: "Overview" },
          { href: "/jobs", label: "Explore" },
          { href: "/seeker/conversations", label: "Messages" },
        ]
    : [{ href: "/jobs", label: "Explore" }];

  const isCurrent = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-md dark:bg-gray-900/85">
      {/* Thin gradient rail — the app's signature edge. */}
      <div className="signal-rail" aria-hidden="true" />

      <nav
        className={
          variant === "marketing"
            ? "border-b border-transparent"
            : "border-b border-gray-200 dark:border-gray-700"
        }
        aria-label="Main"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-7">
            <Link
              href="/"
              className="flex flex-shrink-0 items-center gap-2.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {/* Node-graph mark in a solid ink tile, as on the reference. */}
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900">
                <Icon.graph className="h-5 w-5" />
              </span>
              <span className="mono text-sm font-bold uppercase tracking-[0.14em] text-gray-900 dark:text-white">
                NextHire
              </span>
            </Link>

            <ul className="hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    className={`relative rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isCurrent(link.href)
                        ? "text-gray-900 dark:text-white"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {link.label}
                    {/* Underline marker rather than a filled pill: quieter, and
                        it echoes the hairline grammar used elsewhere. */}
                    {isCurrent(link.href) && (
                      <span
                        className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-green-500"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {signedIn && <NotificationBell />}

            {signedIn ? (
              <div className="hidden items-center gap-3 md:flex">
                <span className="hidden max-w-[10rem] truncate text-sm text-gray-500 dark:text-gray-400 lg:inline">
                  {user?.name}
                </span>
                <button type="button" onClick={handleSignOut} className="btn-outline">
                  <Icon.logout className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            ) : (
              mounted && (
                <div className="hidden items-center gap-2 md:flex">
                  <Link
                    href="/auth/login"
                    className="rounded-md px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-white"
                  >
                    Sign in
                  </Link>
                  <Link href="/auth/register" className="btn-ink">
                    Create profile
                  </Link>
                </div>
              )
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
            >
              {menuOpen ? (
                <Icon.x className="h-5 w-5" />
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div
            id="mobile-nav"
            className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900 md:hidden"
          >
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    className={`flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                      isCurrent(link.href)
                        ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    }`}
                  >
                    {link.label}
                    {isCurrent(link.href) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
              {signedIn ? (
                <>
                  <p className="eyebrow px-3 pb-1">Signed in as {user?.name}</p>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Icon.logout className="h-5 w-5" />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/login"
                    className="block rounded-lg px-3 py-3 text-base font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    Sign in
                  </Link>
                  <Link href="/auth/register" className="btn-ink w-full">
                    Create profile
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
