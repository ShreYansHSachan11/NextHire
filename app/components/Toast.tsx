"use client";

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from "react";
import { Icon } from "./ui";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  /** Shows a transient message. Replaces the scattered `alert()` calls. */
  showToast: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  /** Same contract as `success` / `error`, for the remaining two variants. */
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

export const useToast = () => useContext(ToastContext);

let nextId = 0;

/**
 * Reading a toast aloud takes far longer than reading it with your eyes, and a
 * screen-reader user has to finish the sentence they are already in first. The
 * old 4s / 6s pair regularly pulled the message before it had been announced.
 * Anything the user must act on gets the long window.
 */
const DURATION_MS: Record<ToastVariant, number> = {
  info: 7000,
  success: 7000,
  warning: 10_000,
  error: 12_000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  /** Live countdown per toast, so hovering or focusing one can hold it open. */
  const timers = useRef(new Map<number, { handle: number; remaining: number; startedAt: number }>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer.handle);
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer]
  );

  const start = useCallback(
    (id: number, ms: number) => {
      const handle = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, { handle, remaining: ms, startedAt: Date.now() });
    },
    [dismiss]
  );

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer.handle);
    timers.current.set(id, {
      ...timer,
      remaining: Math.max(1500, timer.remaining - (Date.now() - timer.startedAt)),
    });
  }, []);

  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer) start(id, timer.remaining);
    },
    [start]
  );

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = nextId++;
      setToasts((current) => [...current, { id, message, variant }]);
      start(id, DURATION_MS[variant]);
    },
    [start]
  );

  // Timers outlive the component otherwise, and fire setState on an unmounted tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer.handle));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (message: string) => showToast(message, "success"),
      error: (message: string) => showToast(message, "error"),
      warning: (message: string) => showToast(message, "warning"),
      info: (message: string) => showToast(message, "info"),
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        No `aria-live` on this container: each toast carries its own role, and a
        live region nested inside another live region gets announced twice on
        several screen readers. Errors are assertive because they usually mean
        the action the user just took did not happen.
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            aria-live={toast.variant === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            onMouseEnter={() => pause(toast.id)}
            onMouseLeave={() => resume(toast.id)}
            onFocusCapture={() => pause(toast.id)}
            onBlurCapture={() => resume(toast.id)}
            // Escape closes whichever toast the user has reached, matching the
            // dismiss affordance on every other layer in the app.
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                dismiss(toast.id);
              }
            }}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-overlay)] motion-safe:animate-fade-in-up ${variantClasses[toast.variant]}`}
          >
            <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
              {icons[toast.variant]}
            </span>
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="hit-24 -m-1 flex-shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
            >
              <Icon.x className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Kept in step with `<Alert>` in ui.tsx — the two used different tints for the
 * same meanings, so a failure looked like one colour inline and another in the
 * corner. The dark fills are near-opaque where Alert's are translucent: a toast
 * floats over arbitrary page content and has to stay readable on top of it.
 */
const variantClasses: Record<ToastVariant, string> = {
  success:
    "border-green-200 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950/90 dark:text-green-100",
  error:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/90 dark:text-red-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100",
  info: "border-gray-200 bg-[var(--surface-overlay)] text-gray-900 dark:border-gray-700 dark:text-gray-100",
};

const icons: Record<ToastVariant, React.ReactNode> = {
  success: <Icon.checkCircle className="h-5 w-5" />,
  error: <Icon.warning className="h-5 w-5" />,
  warning: <Icon.warning className="h-5 w-5" />,
  info: <Icon.spark className="h-5 w-5" />,
};
