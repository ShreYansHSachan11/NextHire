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
import { Button, Icon, iconButton } from "./ui";

interface NavLink {
  href: string;
  label: string;
  /** Shown in the mobile sheet only; the desktop bar stays text-only. */
  icon: React.ReactNode;
  /** Desktop bar shows it only from `lg` up, where there is room; the mobile sheet always does. */
  wide?: boolean;
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
/**
 * Every page renders its own `Navbar`, so it remounts on each navigation. This
 * survives those remounts: only the first render after a full load has to match
 * the server's markup, and every later one can show the session straight away.
 */
let hasHydrated = false;

export default function Navbar() {
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
  const [mounted, setMounted] = useState(hasHydrated);
  useEffect(() => {
    hasHydrated = true;
    setMounted(true);
  }, []);
  const signedIn = mounted && isAuthenticated;

  // Everything that depends on the session stays hidden until it is known, so
  // the bar appears once in its final shape instead of rearranging itself.
  const reveal = `transition-opacity duration-200 ${mounted ? "opacity-100" : "invisible opacity-0"}`;

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
          { href: "/company/dashboard", label: "Dashboard", icon: <Icon.graph className="h-5 w-5" /> },
          { href: "/jobs/post", label: "Post a job", icon: <Icon.plus className="h-5 w-5" /> },
          { href: "/applications", label: "Applicants", icon: <Icon.user className="h-5 w-5" /> },
          { href: "/conversations", label: "Messages", icon: <Icon.chat className="h-5 w-5" /> },
        ]
      : [
          { href: "/seeker/dashboard", label: "Dashboard", icon: <Icon.graph className="h-5 w-5" /> },
          { href: "/jobs", label: "Find jobs", icon: <Icon.search className="h-5 w-5" /> },
          // Saved searches and job alerts.
          { href: "/seeker/alerts", label: "Job alerts", icon: <Icon.bookmark className="h-5 w-5" /> },
          { href: "/seeker/coach", label: "Career coach", icon: <Icon.spark className="h-5 w-5" /> },
          { href: "/seeker/conversations", label: "Messages", icon: <Icon.chat className="h-5 w-5" /> },
        ]
    : [
        { href: "/jobs", label: "Find jobs", icon: <Icon.search className="h-5 w-5" /> },
        // Sections of the homepage, reachable from any page.
        { href: "/#features", label: "Features", icon: <Icon.spark className="h-5 w-5" />, wide: true },
        { href: "/#how-it-works", label: "How it works", icon: <Icon.pulse className="h-5 w-5" />, wide: true },
        { href: "/#for-employers", label: "For employers", icon: <Icon.briefcase className="h-5 w-5" />, wide: true },
      ];

  // Signed in, the bar carries up to five links, a bell and Sign out, which
  // do not fit at tablet width: the links ran over the wordmark and Sign out
  // broke onto two lines. So the full bar waits for `lg` there, and the menu
  // button covers tablets. Whole class names, so Tailwind can see them.
  const desk = signedIn
    ? { bar: "lg:grid lg:grid-cols-[1fr_auto_1fr]", show: "lg:flex", hide: "lg:hidden" }
    : { bar: "md:grid md:grid-cols-[1fr_auto_1fr]", show: "md:flex", hide: "md:hidden" };

  const isCurrent = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    // A floating glass bar: the `header` only holds the sticky offset and the
    // page gutter, and `.header-surface` on the `nav` is the bar itself.
    <header className="sticky top-0 z-40 px-3 pb-2 pt-3 sm:px-4">
      <nav className="header-surface mx-auto max-w-7xl" aria-label="Main">
        {/* Three columns on desktop, so the links sit in the true centre of the
            bar whatever the widths of the mark and the actions either side. */}
        <div className={`flex h-16 items-center justify-between gap-2 pl-4 pr-3 sm:gap-4 sm:pl-6 ${desk.bar}`}>
          <div className="flex min-w-0 items-center">
            <Link
              href="/"
              className="flex flex-shrink-0 items-center gap-2.5 rounded-md"
            >
              {/* Node-graph mark in a solid ink tile, as on the reference. */}
              <span className="tile tile-ink h-9 w-9">
                <Icon.graph className="h-5 w-5" />
              </span>
              <span className="wordmark text-gray-900 dark:text-white">
                NextHire
              </span>
            </Link>
          </div>

          <ul className={`hidden items-center gap-1 ${desk.show} ${reveal}`}>
              {links.map((link) => (
                <li key={link.href} className={link.wide ? "hidden lg:block" : undefined}>
                  <Link
                    href={link.href}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    className={`interactive whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${
                      isCurrent(link.href)
                        ? "text-gray-900 dark:text-white"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
          </ul>

          <div className={`flex items-center justify-end gap-1 sm:gap-2 ${reveal}`}>
            <ThemeToggle />
            {signedIn && <NotificationBell />}

            {signedIn ? (
              <div className={`hidden items-center gap-3 ${desk.show}`}>
                <span className="hidden max-w-[10rem] truncate text-sm text-gray-500 dark:text-gray-400 xl:inline">
                  {user?.name}
                </span>
                <Button
                  variant="secondary"
                  onClick={handleSignOut}
                  loading={signingOut}
                  loadingLabel="Signing out"
                  className="whitespace-nowrap"
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
                    className="interactive whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Sign in
                  </Link>
                  <Link href="/auth/register" className="btn-ink whitespace-nowrap">
                    Sign up
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
              className={`${iconButton} ${desk.hide}`}
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
          className={`max-h-[calc(100vh-4rem)] overflow-y-auto rounded-b-[1.75rem] border-t border-gray-200 px-4 py-3 dark:border-gray-700 ${desk.hide}`}
        >
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isCurrent(link.href) ? "page" : undefined}
                  // The selected/hover/press treatment comes from `.interactive`,
                  // which reads `aria-current` off the element — so the state the
                  // screen reader hears and the state the eye sees are the same fact.
                  className={`interactive flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium ${
                    isCurrent(link.href) ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"
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
                  // Deliberately *not* `.interactive`: a destructive action earns
                  // a red state layer rather than the neutral one, and stacking
                  // both would just muddy the tint. The disabled treatment uses
                  // the same 0.5 the `--disabled-opacity` token carries.
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  <Icon.logout className="h-5 w-5" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="interactive block rounded-lg px-3 py-3 text-base font-medium text-gray-600 dark:text-gray-300"
                >
                  Sign in
                </Link>
                <Link href="/auth/register" className="btn-ink w-full">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
