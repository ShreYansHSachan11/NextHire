"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { useSocket } from "@/lib/socketContext";
import { apiFetch } from "@/lib/clientAuth";
import {
  Alert,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  Icon,
  PageHeading,
  Spinner,
  buttonPrimary,
  dayLabel,
  formatRelative,
  formatTime,
  inputClass,
} from "@/app/components/ui";

/* -------------------------------------------------------------------------- */
/* Types — mirror `GET /api/conversations` for a company                       */
/* -------------------------------------------------------------------------- */

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  };
}

interface Conversation {
  id: string;
  userId: string;
  companyId: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  /** The endpoint returns only the latest message here, for the list preview. */
  messages?: Message[];
  unreadCount?: number;
}

interface ApplicationSummary {
  id: string;
  userId: string;
  jobId: string;
  status: string;
  message?: string | null;
  createdAt: string;
  job: { id: string; title: string };
  user: { id: string; name: string; email: string };
}

interface ConversationItem {
  application: ApplicationSummary;
  conversation: Conversation | null;
  hasConversation: boolean;
  /** How many jobs this person applied to — the list itself is de-duplicated. */
  applicationCount: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Merge by id, keeping chronological order.
 *
 * The sender both appends its own message locally and receives it back over the
 * socket, so a naive concat showed every sent message twice — previously masked
 * with a `key={id-index}` rather than fixed.
 */
function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function dayKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toDateString();
}

function groupByDay(messages: Message[]): { key: string; label: string; messages: Message[] }[] {
  const groups: { key: string; label: string; messages: Message[] }[] = [];
  for (const message of messages) {
    const key = dayKey(message.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt), messages: [message] });
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function ConversationsPage() {
  // `useSearchParams` needs a Suspense boundary in Next 15.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <Spinner className="h-10 w-10" label="Loading messages" />
        </div>
      }
    >
      <ConversationsView />
    </Suspense>
  );
}

function ConversationsView() {
  const { ready, allowed, user } = useAuthGuard(["COMPANY"]);
  const searchParams = useSearchParams();
  const toast = useToast();
  const { socket, isConnected, joinConversation, leaveConversation } = useSocket();

  const [items, setItems] = useState<ConversationItem[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  const [startingFor, setStartingFor] = useState<string | null>(null);
  // On phones the list and the thread share the screen; this flips between them.
  const [showChat, setShowChat] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const appliedParamRef = useRef<string | null>(null);
  const conversationIdParam = searchParams.get("conversationId");

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      // No params: the endpoint resolves the company from the session and
      // returns one row per applicant rather than one per application.
      const data = await apiFetch<ConversationItem[]>("/api/conversations");
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setLoadError(error instanceof Error ? error.message : "Could not load your conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchConversations();
  }, [allowed, fetchConversations]);

  const openConversation = useCallback((conversation: Conversation) => {
    setSelected(conversation);
    setShowChat(true);
    // Fetching the messages marks them read server-side, so clear the badge.
    setItems((current) =>
      current.map((item) =>
        item.conversation && item.conversation.id === conversation.id
          ? { ...item, conversation: { ...item.conversation, unreadCount: 0 } }
          : item
      )
    );
  }, []);

  // Deep link from the dashboard / applications page. Applied once so a later
  // refresh of the list does not yank the user back to this thread.
  useEffect(() => {
    if (!conversationIdParam || items.length === 0) return;
    if (appliedParamRef.current === conversationIdParam) return;
    const match = items.find((item) => item.conversation?.id === conversationIdParam);
    if (match?.conversation) {
      appliedParamRef.current = conversationIdParam;
      openConversation(match.conversation);
    }
  }, [conversationIdParam, items, openConversation]);

  const selectedId = selected?.id;

  // Loading the history is keyed only on the selection, so a socket reconnect
  // does not blank and refetch the thread underneath the user.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    setMessages([]);
    void (async () => {
      try {
        const data = await apiFetch<Message[]>(
          `/api/messages?conversationId=${encodeURIComponent(selectedId)}`
        );
        if (!cancelled) setMessages(mergeMessages([], Array.isArray(data) ? data : []));
      } catch (error) {
        console.error("Failed to fetch messages:", error);
        if (!cancelled) toast.error("Could not load this conversation");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, toast]);

  // Room membership is a separate concern: rejoining is idempotent.
  useEffect(() => {
    if (!selectedId) return;
    joinConversation(selectedId);
    return () => leaveConversation(selectedId);
  }, [selectedId, joinConversation, leaveConversation]);

  // Real-time delivery.
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: { conversationId: string; message: Message }) => {
      if (!data?.message) return;

      if (data.conversationId === selectedId) {
        setMessages((current) => mergeMessages(current, [data.message]));
        return;
      }

      // Not the open thread: refresh that row's preview and unread badge.
      setItems((current) =>
        current.map((item) => {
          if (!item.conversation || item.conversation.id !== data.conversationId) return item;
          return {
            ...item,
            conversation: {
              ...item.conversation,
              messages: [data.message],
              unreadCount: (item.conversation.unreadCount ?? 0) + 1,
            },
          };
        })
      );
    };

    socket.on("new-message", handleNewMessage);
    return () => {
      socket.off("new-message", handleNewMessage);
    };
  }, [socket, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !selected || sending) return;

    setDraft("");
    setSending(true);
    try {
      // No `senderId`: the server derives it from the session.
      const message = await apiFetch<Message>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: selected.id, content }),
      });
      setMessages((current) => mergeMessages(current, [message]));
    } catch (error) {
      console.error("Failed to send message:", error);
      setDraft(content); // give the typed text back rather than losing it
      toast.error(error instanceof Error ? error.message : "Message not sent");
    } finally {
      setSending(false);
    }
  };

  const startConversation = async (applicantId: string) => {
    setStartingFor(applicantId);
    try {
      const conversation = await apiFetch<Conversation>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: applicantId }),
      });
      await fetchConversations();
      openConversation(conversation);
    } catch (error) {
      console.error("Failed to start conversation:", error);
      toast.error(error instanceof Error ? error.message : "Could not start the conversation");
    } finally {
      setStartingFor(null);
    }
  };

  const groups = useMemo(() => groupByDay(messages), [messages]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner className="h-10 w-10" label="Loading messages" />
      </div>
    );
  }

  if (!allowed) return null; // the guard is already redirecting

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Applicant threads"
          title="Messages"
          description="Chat with the people who applied to your postings."
          action={
            isConnected ? (
              <Eyebrow as="span" accent className="inline-flex items-center gap-2">
                <span className="dot-live" aria-hidden="true" />
                Socket live
              </Eyebrow>
            ) : undefined
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-5 lg:gap-6">
          {/* Applicant list */}
          <section
            aria-label="Applicants"
            className={`lg:col-span-2 ${showChat ? "hidden lg:block" : "block"}`}
          >
            <Card className="flex h-[calc(100vh-16rem)] min-h-[24rem] flex-col overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Applicants</h2>
                <Eyebrow as="span">
                  {items.length} {items.length === 1 ? "person" : "people"}
                </Eyebrow>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-6 py-12 text-center">
                    <Spinner className="h-8 w-8" label="Loading conversations" />
                  </div>
                ) : loadError ? (
                  <div className="p-4">
                    <Alert variant="error">
                      <p>{loadError}</p>
                      <button
                        type="button"
                        onClick={() => void fetchConversations()}
                        className="mt-3 font-semibold underline"
                      >
                        Try again
                      </button>
                    </Alert>
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState
                    icon={<Icon.chat className="h-6 w-6" />}
                    title="No applicants yet"
                    description="Once someone applies to one of your postings you can message them here."
                    action={
                      <Link href="/jobs/post" className={buttonPrimary}>
                        Post a role
                        <Icon.arrowUpRight className="h-4 w-4" />
                      </Link>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {items.map((item) => (
                      <ConversationRow
                        key={item.application.userId}
                        item={item}
                        active={item.conversation?.id === selectedId}
                        starting={startingFor === item.application.userId}
                        onOpen={openConversation}
                        onStart={startConversation}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </section>

          {/* Thread */}
          <section
            aria-label="Conversation"
            className={`lg:col-span-3 ${showChat ? "block" : "hidden lg:block"}`}
          >
            <Card className="flex h-[calc(100vh-16rem)] min-h-[24rem] flex-col overflow-hidden">
              {selected ? (
                <>
                  <ThreadHeader
                    name={selected.user.name}
                    email={selected.user.email}
                    onBack={() => setShowChat(false)}
                  />

                  <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950 sm:p-6">
                    {groups.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                        No messages yet — say hello.
                      </p>
                    ) : (
                      groups.map((group) => (
                        <div key={group.key} className="space-y-3">
                          {/* Hairline rule with the day label sitting on it. */}
                          <div className="flex items-center gap-3">
                            <span
                              className="h-px flex-1 bg-gray-200 dark:bg-gray-700"
                              aria-hidden="true"
                            />
                            <Eyebrow as="span">{group.label}</Eyebrow>
                            <span
                              className="h-px flex-1 bg-gray-200 dark:bg-gray-700"
                              aria-hidden="true"
                            />
                          </div>
                          {group.messages.map((message) => (
                            <MessageBubble
                              key={message.id}
                              message={message}
                              own={message.senderId === user?.id}
                            />
                          ))}
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <Composer
                    value={draft}
                    onChange={setDraft}
                    onSend={() => void sendMessage()}
                    sending={sending}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
                  <EmptyState
                    icon={<Icon.chat className="h-6 w-6" />}
                    title="No conversation selected"
                    description="Pick an applicant from the list to start chatting."
                  />
                </div>
              )}
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces — shared by the phone and desktop layouts                      */
/* -------------------------------------------------------------------------- */

/** Neutral initial tile — the emerald accent stays reserved for live signal. */
function InitialTile({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`mono flex flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 ${className}`}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ConversationRow({
  item,
  active,
  starting,
  onOpen,
  onStart,
}: {
  item: ConversationItem;
  active: boolean;
  starting: boolean;
  onOpen: (conversation: Conversation) => void;
  onStart: (applicantId: string) => Promise<void>;
}) {
  const { application, conversation, applicationCount } = item;
  const latest = conversation?.messages?.[conversation.messages.length - 1];
  const unread = conversation?.unreadCount ?? 0;

  // Only phrasing content below: this markup also sits inside a <button>.
  const body = (
    <>
      <InitialTile name={application.user.name} className="h-10 w-10 text-sm" />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {application.user.name}
          </span>
          {latest && (
            <span className="mono flex-shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
              {formatRelative(latest.createdAt)}
            </span>
          )}
        </span>

        <span className="mt-1 flex items-center gap-1.5">
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {application.job?.title || application.user.email}
          </span>
          {/* Only worth showing when the person applied more than once. */}
          {applicationCount > 1 && (
            <Chip className="mono flex-shrink-0">{applicationCount}&times;</Chip>
          )}
        </span>

        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {latest ? latest.content : application.user.email}
          </span>
          {unread > 0 && (
            <span className="mono inline-flex min-w-[1.25rem] flex-shrink-0 items-center justify-center rounded-full border border-green-300 bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-700 dark:border-green-700 dark:bg-green-950/50 dark:text-green-300">
              {unread}
              <span className="sr-only"> unread messages</span>
            </span>
          )}
        </span>
      </span>
    </>
  );

  return (
    <li>
      {conversation ? (
        <button
          type="button"
          onClick={() => onOpen(conversation)}
          aria-current={active ? "true" : undefined}
          // `.panel-signal` is the selected treatment: emerald hairline + tint.
          className={`interactive flex w-full items-start gap-3 p-3 text-left focus-inset sm:p-4 ${
            active ? "panel-signal" : ""
          }`}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 p-3 sm:p-4">
          {body}
          <button
            type="button"
            onClick={() => void onStart(application.userId)}
            disabled={starting}
            className="mono flex-shrink-0 self-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-gray-700 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500"
          >
            {starting ? "Opening" : "Start"}
          </button>
        </div>
      )}
    </li>
  );
}

function ThreadHeader({
  name,
  email,
  onBack,
}: {
  name: string;
  email: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-200 px-3 py-3 dark:border-gray-700 sm:px-5">
      <button
        type="button"
        onClick={onBack}
        className="interactive rounded-lg p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white lg:hidden"
        aria-label="Back to applicant list"
      >
        <Icon.arrowLeft className="h-5 w-5" />
      </button>
      <InitialTile name={name} className="h-9 w-9 text-xs" />
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{name}</h2>
        <p className="mono truncate text-xs text-gray-500 dark:text-gray-400">{email}</p>
      </div>
    </div>
  );
}

function MessageBubble({ message, own }: { message: Message; own: boolean }) {
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      {/* Tight radii with the tail corner squared off, rather than a soft pill. */}
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 sm:max-w-[75%] ${
          own
            ? "rounded-br-sm bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            : "rounded-bl-sm border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        <p className="mono mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a few lines, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `onKeyPress` was deprecated and never fired reliably; Shift+Enter now
    // inserts a newline instead of sending.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:px-4">
      <div className="flex items-end gap-2 sm:gap-3">
        <label htmlFor="message-input" className="sr-only">
          Message
        </label>
        <textarea
          id="message-input"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message — Enter to send, Shift+Enter for a new line"
          className={`${inputClass} max-h-40 flex-1 resize-none text-sm!`}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !value.trim()}
          className={`${buttonPrimary} flex-shrink-0`}
        >
          {sending ? <Spinner className="h-4 w-4" /> : <Icon.send className="h-4 w-4" />}
          <span className="hidden sm:inline">{sending ? "Sending" : "Send"}</span>
        </button>
      </div>
    </div>
  );
}
