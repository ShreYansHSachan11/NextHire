"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import type { RootState } from "@/store/store";
import { apiFetch } from "@/lib/clientAuth";
import { Icon, formatRelative } from "./ui";

interface Notification {
  id: string;
  content: string;
  /** Structured destination. The old component parsed this back out of the
   *  message text with a regex, which broke on any name containing a colon. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

export default function NotificationBell() {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  /** True once the first poll has answered, so we have a baseline to compare to. */
  const [primed, setPrimed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const lastCount = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      // The endpoint scopes to the signed-in user; no id is passed from the client.
      const data = await apiFetch<Notification[]>("/api/notifications?limit=30");
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // Polling failures are not worth interrupting the user for.
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setNotifications([]);
      return;
    }
    setLoading(true);
    void fetchNotifications().finally(() => {
      setLoading(false);
      setPrimed(true);
    });

    const interval = window.setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, user?.id, fetchNotifications]);

  /**
   * Announce only the notifications that arrive *while* the user is here. The
   * first poll just records a baseline: reading the whole backlog out on every
   * page load would train people to ignore the region.
   */
  useEffect(() => {
    if (!primed) return;
    const previous = lastCount.current;
    lastCount.current = unreadCount;
    if (previous === null || unreadCount <= previous) return;
    setAnnouncement(`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`);
  }, [primed, unreadCount]);

  // Close on outside click or Escape, and return focus to the trigger.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // The panel is not modal, so tabbing past its last control should close it
    // rather than leave an orphaned dropdown floating over the page.
    const onFocusIn = (event: FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  // Opening with the keyboard has to land somewhere inside the panel, or the
  // next Tab press walks straight past everything the button just revealed.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
  }, [open]);

  const markAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ id, read: true }),
      });
    } catch {
      void fetchNotifications();
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch {
      void fetchNotifications();
    }
  };

  const handleClick = async (notification: Notification) => {
    if (!notification.read) await markAsRead(notification.id);
    setOpen(false);
    if (notification.link) router.push(notification.link);
  };

  if (!isAuthenticated) return null;

  const messagesHref = user?.role === "COMPANY" ? "/conversations" : "/seeker/conversations";

  return (
    <div className="relative" ref={containerRef}>
      {/*
        Polling means new notifications arrive with no interaction to hang an
        announcement off, so the count lives in its own live region. It is
        separate from the button's `aria-label`, which only gets read when the
        button is reached — a change to a label on an unfocused control is not
        announced at all.
      */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>

      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      >
        <Icon.bell className="h-5 w-5" />
        {unreadCount > 0 && (
          // The count is already in the button's label and in the live region
          // above, so the badge itself is decorative — and it carries a number
          // rather than relying on the emerald fill to mean "unread".
          <span
            aria-hidden="true"
            className="mono absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-green-700 px-1 text-[10px] font-semibold leading-none text-white dark:border-gray-900 dark:bg-green-500 dark:text-gray-900"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id="notification-panel"
          // Not `role="menu"`: a menu may only contain menuitems, and this panel
          // also holds "Mark all read" and a footer action, which made the
          // notification list unnavigable in menu mode on some screen readers.
          role="group"
          aria-label="Notifications"
          className="panel absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div>
              {/* Deliberately not a heading: a dropdown in the header would
                  otherwise inject an h2/h3 ahead of the page's own h1. The
                  group's `aria-label` names this region instead. */}
              <p className="eyebrow">Signal feed</p>
              {unreadCount > 0 && (
                <p className="mono mt-0.5 text-xs text-green-700 dark:text-green-400">
                  {unreadCount} unread
                </p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="eyebrow rounded px-2 py-1 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-white"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <p className="eyebrow px-4 py-8 text-center" role="status">
                Loading
              </p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Icon.bell className="mx-auto mb-2 h-8 w-8 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                <p className="eyebrow">No signal</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    {/* A real button, so it is reachable by keyboard — this was a
                        bare div with an onClick handler. */}
                    <button
                      type="button"
                      onClick={() => handleClick(notification)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 dark:hover:bg-gray-700 dark:focus-visible:bg-gray-700 ${
                        notification.read ? "" : "bg-green-50/60 dark:bg-green-900/15"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                          notification.read ? "bg-gray-300 dark:bg-gray-600" : "bg-green-500"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        {/* Weight and an explicit "(unread)" carry the state as
                            well as the dot, so it survives greyscale. */}
                        <span
                          className={`block text-sm ${
                            notification.read
                              ? "text-gray-600 dark:text-gray-300"
                              : "font-medium text-gray-900 dark:text-white"
                          }`}
                        >
                          {notification.content}
                        </span>
                        <span className="mono mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                          {formatRelative(notification.createdAt)}
                          {!notification.read && <span className="sr-only"> (unread)</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-200 p-2 dark:border-gray-700">
            <button
              type="button"
              onClick={() => {
                router.push(messagesHref);
                setOpen(false);
              }}
              className="btn-outline w-full"
            >
              View all messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
