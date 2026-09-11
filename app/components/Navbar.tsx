"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { signOut } from "next-auth/react";
import type { RootState } from "@/store/store";
import { logout } from "@/store/authSlice";
import { clearToken } from "@/lib/clientAuth";
import NotificationBell from "./NotificationBell";
import { ThemeToggle } from "./ThemeProvider";
import { Button, Icon } from "./ui";

interface NavLink {
  href: string;
  label: string;
  /** Shown in the mobile sheet only; the desktop bar stays text-only. */
  icon: React.ReactNode;
}

/** Everything a Tab press can land on inside the mobile sheet. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const [signingOut, setSigningOut] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Rendering auth-dependent links before rehydration would mismatch the server
  // markup, so hold the signed-out shape until we've mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const signedIn = mounted && isAuthenticated;

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  const closeMenu = (returnFocus = true) => {
    setMenuOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  };

  /**
   * While the sheet is open it behaves like a dialog: the page underneath does
   * not scroll, Escape closes it, and Tab cycles between the sheet's own
   * controls and the trigger rather than wandering into the hidden page behind.
   */
  useEffect(() => {
    if (!menuOpen) return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    // Compensating for the scrollbar stops the header sliding sideways as the
    // page's scrollbar disappears.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const inPanel = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    // The trigger is part of the loop — it is the way back out of the sheet —
    // and it sits *before* the sheet in the DOM, so it is the loop's first stop.
    const loop = () => (toggleRef.current ? [toggleRef.current, ...inPanel()] : inPanel());

    // Focus goes into the sheet, not back onto the button that opened it.
    inPanel()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;

      const items = loop();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setSigningOut(true);
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
    setSigningOut(false);
  };

  const links: NavLink[] = signedIn
    ? user?.role === "COMPANY"
      ? [
          { href: "/company/dashboard", label: "Overview", icon: <Icon.graph className="h-5 w-5" /> },
          { href: "/jobs/post", label: "Post a role", icon: <Icon.plus className="h-5 w-5" /> },
          { href: "/applications", label: "Candidates", icon: <Icon.user className="h-5 w-5" /> },
          { href: "/conversations", label: "Messages", icon: <Icon.chat className="h-5 w-5" /> },
        ]
      : [
          { href: "/seeker/dashboard", label: "Overview", icon: <Icon.graph className="h-5 w-5" /> },
          { href: "/jobs", label: "Explore", icon: <Icon.search className="h-5 w-5" /> },
          // Saved searches and job alerts.
          { href: "/seeker/alerts", label: "Alerts", icon: <Icon.bookmark className="h-5 w-5" /> },
          { href: "/seeker/coach", label: "Coach", icon: <Icon.spark className="h-5 w-5" /> },
          { href: "/seeker/conversations", label: "Messages", icon: <Icon.chat className="h-5 w-5" /> },
        ]
    : [{ href: "/jobs", label: "Explore", icon: <Icon.search className="h-5 w-5" /> }];

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
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-5 lg:gap-7">
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
                <Button
                  variant="secondary"
                  onClick={handleSignOut}
                  loading={signingOut}
                  loadingLabel="Signing out"
                  icon={<Icon.logout className="h-4 w-4" />}
                >
                  Sign out
                </Button>
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
              ref={toggleRef}
              type="button"
              onClick={() => (menuOpen ? closeMenu(false) : setMenuOpen(true))}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
            >
              {menuOpen ? <Icon.x className="h-5 w-5" /> : <Icon.menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Always in the DOM so `aria-controls` above always resolves; `hidden`
            keeps it out of the layout, the tab order and the a11y tree. */}
        <div
          ref={panelRef}
          id="mobile-nav"
          hidden={!menuOpen}
          className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900 md:hidden"
        >
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isCurrent(link.href) ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                    isCurrent(link.href)
                      ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className="flex-shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true">
                    {link.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{link.label}</span>
                  {isCurrent(link.href) && (
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" aria-hidden="true" />
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
                  disabled={signingOut}
                  aria-busy={signingOut || undefined}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  <Icon.logout className="h-5 w-5" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="block rounded-lg px-3 py-3 text-base font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
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
      </nav>
    </header>
  );
}
