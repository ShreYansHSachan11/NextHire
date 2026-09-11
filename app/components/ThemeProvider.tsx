"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { iconButton } from "./ui";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const THEME_STORAGE_KEY = "nexthire-theme";

/**
 * Runs before first paint so the page never flashes the wrong theme.
 * Kept in sync with `ThemeProvider` below and with the `dark` variant defined
 * in globals.css, which is class-based rather than OS-based.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from what the inline script already applied, so the first client
  // render matches the server-rendered markup.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setThemeState(isDark ? "dark" : "light");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable in private browsing; the theme still applies
      // for this page view.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  /**
   * Follow the OS while the user has not made a choice of their own — someone
   * on a scheduled dark mode expects the app to turn over with everything else
   * at sunset, not at their next reload.
   */
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const onChange = (event: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // Treated as "no preference stored".
      }
      if (stored === "light" || stored === "dark") return;

      const next: Theme = event.matches ? "dark" : "light";
      setThemeState(next);
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.style.colorScheme = next;
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

const iconClass = "h-5 w-5";

const SunGlyph = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.75}
    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
  />
);

const MoonGlyph = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.75}
    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
  />
);

/** Sun/moon toggle used in the shared navbar. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const interacted = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // Only speak after the user has actually pressed the button; announcing on
    // load would read the theme out to everyone on every page.
    if (interacted.current) {
      setAnnouncement(theme === "dark" ? "Dark theme on" : "Light theme on");
    }
  }, [theme]);

  // The provider still reports "light" on the very first client render, while
  // the pre-paint script may already have applied dark — so before hydration
  // the label stays neutral and the glyph is chosen by the `dark:` variant
  // rather than by React. That is what keeps the icon correct on first paint.
  const label = !mounted
    ? "Switch colour theme"
    : theme === "dark"
      ? "Switch to light theme"
      : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={() => {
        interacted.current = true;
        toggleTheme();
      }}
      aria-label={label}
      title={label}
      className={`${iconButton} ${className}`}
    >
      <svg className={`${iconClass} hidden dark:block`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {SunGlyph}
      </svg>
      <svg className={`${iconClass} dark:hidden`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {MoonGlyph}
      </svg>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </button>
  );
}
