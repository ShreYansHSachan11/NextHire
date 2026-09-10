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
  const containerRef = useRef<HTMLDivElement>(null);
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
    void fetchNotifications().finally(() => setLoading(false));

    const interval = window.setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, user?.id, fetchNotifications]);

  // Close on outside click or Escape, and return focus to the trigger.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
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
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      >
        <Icon.bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="mono absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] font-semibold text-white dark:bg-green-500">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="panel absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div>
              <h3 className="eyebrow">Signal feed</h3>
              {unreadCount > 0 && (
                <p className="mono mt-0.5 text-xs text-green-600 dark:text-green-400">{unreadCount} unread</p>
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
              <p className="eyebrow px-4 py-8 text-center">Loading</p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Icon.bell className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
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
                      role="menuitem"
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
