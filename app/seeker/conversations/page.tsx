"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import { MESSAGE_MAX_LENGTH } from "@/lib/validation";
import { useSocket } from "@/lib/socketContext";
import {
  Alert,
  Avatar,
  Button,
  buttonPrimary,
  buttonSecondary,
  Card,
  dayLabel,
  EmptyState,
  Eyebrow,
  formatRelative,
  formatTime,
  Icon,
  PageHeading,
  Readout,
  Skeleton,
} from "@/app/components/ui";

import ConversationsLoading from "./loading";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface MessageSender {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender?: MessageSender;
}

interface Conversation {
  id: string;
  companyId: string;
  createdAt: string;
  company: { id: string; name: string };
  /** The API sends only the latest message for the list preview. */
  messages: Message[];
  unreadCount: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The sender both appends its own message locally and receives it back over the
 * socket, so every sent message used to appear twice — masked with a
 * `${id}-${index}` key rather than fixed (audit 2.9). Merging by id makes the
 * duplicate a no-op and lets us key on the id alone.
 */
function mergeMessage(existing: Message[], incoming: Message): Message[] {
  if (existing.some((message) => message.id === incoming.id)) return existing;
  return [...existing, incoming];
}

interface DayGroup {
  key: string;
  label: string;
  messages: Message[];
}

function groupByDay(messages: Message[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const key = new Date(message.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt), messages: [message] });
  }
  return groups;
}

/**
 * The thread's scroll area is a slightly recessed surface, and the day-separator
 * label has to sit *on* the hairline — so both need the identical background.
 * Declaring it once keeps the two in step.
 */
const THREAD_SURFACE = "bg-gray-50 dark:bg-gray-900";

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function SeekerConversations() {
  // Without this guard the page bounced signed-in users to /auth/login on every
  // refresh, because Redux is still empty on the first paint (audit 2.4).
  const { ready, allowed, user } = useAuthGuard(["SEEKER"]);
  const searchParams = useSearchParams();
  const toast = useToast();
  const { socket, isConnected, joinConversation, leaveConversation } = useSocket();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** Mobile only: the two panes share one column, so one is visible at a time. */
  const [showChat, setShowChat] = useState(false);
  /**
   * One short sentence when a message arrives in the thread that is open.
   *
   * The thread itself is deliberately *not* a live region: it is replaced
   * wholesale whenever the selection changes, so `aria-live` on it would read
   * an entire conversation out on every switch, and it contains the day
   * separators and timestamps too. A small, text-only region carrying "New
   * message from X" is the announcement that is actually wanted
   * (DESIGN-NOTES §2.2).
   */
  const [threadNotice, setThreadNotice] = useState("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const appliedParamsRef = useRef(false);

  const paramConversationId = searchParams.get("conversationId");
  const paramCompany = searchParams.get("company");

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  /* ---------------------------------------------------------------------- */
  /* Data loading                                                            */
  /* ---------------------------------------------------------------------- */

  const loadConversations = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      // Takes no params: the server derives the seeker from the session.
      const data = await apiFetch<Conversation[]>("/api/conversations");
      setConversations(Array.isArray(data) ? data : []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load your conversations";
      console.error("Failed to load conversations:", error);
      setListError(message);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadConversations();
  }, [allowed, loadConversations]);

  // Apply the deep-link parameters once the list has arrived. Applying them only
  // once keeps a later manual selection from being yanked back.
  useEffect(() => {
    if (appliedParamsRef.current || conversations.length === 0) return;
    if (!paramConversationId && !paramCompany) {
      appliedParamsRef.current = true;
      return;
    }

    const match = paramConversationId
      ? conversations.find((conversation) => conversation.id === paramConversationId)
      : conversations.find(
          (conversation) =>
            conversation.company.name.toLowerCase() === paramCompany?.toLowerCase()
        );

    if (match) {
      setSelectedId(match.id);
      setShowChat(true);
    }
    appliedParamsRef.current = true;
  }, [conversations, paramConversationId, paramCompany]);

  // Load the thread whenever the selection changes. Joining the socket room is
  // a separate effect so a reconnect doesn't re-fetch and blank the thread.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setMessages([]);
    // A notice about the previous thread must not survive into this one.
    setThreadNotice("");

    (async () => {
      try {
        const data = await apiFetch<Message[]>(
          `/api/messages?conversationId=${encodeURIComponent(selectedId)}`
        );
        if (cancelled) return;
        setMessages(Array.isArray(data) ? data : []);
        // The GET marks incoming messages read server-side, so clear the badge.
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === selectedId ? { ...conversation, unreadCount: 0 } : conversation
          )
        );
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Could not load this conversation";
        console.error("Failed to load messages:", error);
        toast.error(message);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `toast` is stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !socket) return;
    joinConversation(selectedId);
    return () => leaveConversation(selectedId);
  }, [selectedId, socket, joinConversation, leaveConversation]);

  /* ---------------------------------------------------------------------- */
  /* Realtime                                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: { conversationId: string; message: Message }) => {
      const { conversationId, message } = data;
      if (!message?.id) return;

      if (conversationId === selectedId) {
        setMessages((current) => mergeMessage(current, message));
        // Only the other side's messages: the sender already knows they sent it,
        // and their own composer cleared in front of them.
        if (message.senderId !== user?.id) {
          setThreadNotice(
            `New message from ${message.sender?.name ?? "the employer"} at ${formatTime(
              message.createdAt
            )}`
          );
        }
      }

      // Keep the list preview and the unread badge in step with the thread.
      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          const isOwn = message.senderId === user?.id;
          const isOpen = conversationId === selectedId;
          return {
            ...conversation,
            messages: [message],
            unreadCount:
              isOwn || isOpen ? conversation.unreadCount : conversation.unreadCount + 1,
          };
        })
      );
    };

    socket.on("new-message", handleNewMessage);
    return () => {
      socket.off("new-message", handleNewMessage);
    };
  }, [socket, selectedId, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /* ---------------------------------------------------------------------- */
  /* Sending                                                                 */
  /* ---------------------------------------------------------------------- */

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !selectedId || sending) return;

    setSending(true);
    setDraft("");
    try {
      // No `senderId`: the server takes it from the session.
      const created = await apiFetch<Message>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: selectedId, content }),
      });
      setMessages((current) => mergeMessage(current, created));
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selectedId ? { ...conversation, messages: [created] } : conversation
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message could not be sent";
      console.error("Failed to send message:", error);
      // Give the text back rather than losing what was typed.
      setDraft(content);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const selectConversation = (conversationId: string) => {
    setSelectedId(conversationId);
    setShowChat(true);
  };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  // The same skeleton the route's `loading.tsx` shows, so the rehydration wait
  // and the navigation wait are one state rather than two (DESIGN-NOTES §1.4).
  if (!ready) return <ConversationsLoading />;

  if (!allowed) return null;

  const list = (
    <ConversationList
      conversations={conversations}
      loading={listLoading}
      error={listError}
      selectedId={selectedId}
      onRetry={() => void loadConversations()}
      onSelect={selectConversation}
    />
  );

  const chat = selectedConversation ? (
    <ChatPanel
      conversation={selectedConversation}
      messages={messages}
      loading={messagesLoading}
      currentUserId={user?.id}
      isConnected={isConnected}
      draft={draft}
      sending={sending}
      onDraftChange={setDraft}
      onSend={() => void sendMessage()}
      onBack={() => setShowChat(false)}
      endRef={messagesEndRef}
    />
  ) : (
    <Card className="flex h-full items-center justify-center overflow-hidden">
      <EmptyState
        icon={<Icon.chat className="h-7 w-7" />}
        title="No conversation selected"
        description="Pick a conversation on the left to start chatting with the employer."
      />
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="container-responsive py-6 sm:py-8">
        <PageHeading
          eyebrow="Seeker inbox"
          title="Messages"
          description="Chat with the employers you have applied to."
          action={
            isConnected ? (
              // Emerald and the pulse are reserved for genuinely live state, so
              // this only appears once the socket is actually connected.
              <Eyebrow accent className="inline-flex items-center gap-2">
                <span className="dot-live" aria-hidden="true" />
                Socket live
              </Eyebrow>
            ) : undefined
          }
        />

        {/* The thread announcer. Mounted from the first render and never
            wrapping the thread itself — see `threadNotice`. */}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {threadNotice}
        </p>

        {/* One markup tree for both breakpoints: two panes side by side on
            desktop, and on mobile whichever pane is in front. Rendering each
            pane once keeps the composer's ids and refs unique.

            `dvh` rather than `vh`: on mobile Safari and Chrome the address bar
            is inside `100vh`, so the composer sat under it until the user
            scrolled. The `min-h` floor keeps the thread usable at 360×640. */}
        <div className="mt-6 grid gap-4 sm:gap-6 lg:h-[calc(100dvh-16rem)] lg:min-h-[30rem] lg:grid-cols-5">
          <div
            className={`h-[calc(100dvh-14rem)] min-h-[22rem] lg:col-span-2 lg:h-full ${
              showChat && selectedConversation ? "hidden lg:block" : "block"
            }`}
          >
            {list}
          </div>
          <div
            className={`h-[calc(100dvh-14rem)] min-h-[22rem] lg:col-span-3 lg:h-full ${
              showChat && selectedConversation ? "block" : "hidden lg:block"
            }`}
          >
            {chat}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SeekerConversationsPage() {
  // `useSearchParams` needs a Suspense boundary in Next 15, same as the login page.
  return (
    // One fallback shared with `loading.tsx` and with the guard's `!ready`
    // branch, so all three waits on this route look identical.
    <Suspense fallback={<ConversationsLoading />}>
      <SeekerConversations />
    </Suspense>
  );
}

/* -------------------------------------------------------------------------- */
/* Local components — the mobile and desktop panes used to be two near-identical */
/* copies of this markup.                                                       */
/* -------------------------------------------------------------------------- */

function ConversationList({
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: {
  conversations: Conversation[];
  loading: boolean;
  error: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
        <div className="min-w-0">
          <Eyebrow className="mb-1.5">Threads</Eyebrow>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
            Conversations
          </h2>
        </div>
        <Readout className="text-sm font-medium">{loading ? "—" : conversations.length}</Readout>
      </div>

      {/* `aria-busy`, not `aria-live`. This container holds every thread, so a
          live region on it had a screen reader re-read the whole inbox on any
          change — and the rows are buttons, which a live region must never
          wrap. The count is the part worth announcing (DESIGN-NOTES §2.2). */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? ""
          : error
            ? "Your conversations could not be loaded."
            : `${conversations.length} ${
                conversations.length === 1 ? "conversation" : "conversations"
              }.`}
      </p>

      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {loading ? (
          <ul className="space-y-1 p-2">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="flex items-start gap-3 px-3 py-3">
                <Skeleton className="h-10 w-10 flex-shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </span>
              </li>
            ))}
          </ul>
        ) : error ? (
          <div className="p-4">
            <Alert variant="error">
              <p>{error}</p>
              <button type="button" onClick={onRetry} className={`${buttonSecondary} mt-3`}>
                Try again
              </button>
            </Alert>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<Icon.chat className="h-7 w-7" />}
            title="No conversations yet"
            description="Once you apply to a job you can message the employer straight from your dashboard."
            action={
              <Link href="/jobs" className={buttonPrimary}>
                <Icon.search className="h-4 w-4" />
                Browse jobs
              </Link>
            }
          />
        ) : (
          // Inset blocks rather than a divided list: the selected row can then
          // carry the full `.panel-signal` treatment — emerald hairline plus a
          // faint tint — instead of a coloured left border.
          <ul className="space-y-1 p-2">
            {conversations.map((conversation) => {
              const latest = conversation.messages?.[0];
              const isSelected = conversation.id === selectedId;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={`interactive flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left focus-inset ${
                      isSelected ? "panel-signal" : "border-transparent"
                    }`}
                  >
                    <Avatar name={conversation.company.name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {conversation.company.name}
                        </span>
                        {/* `text-gray-400` measured 2.6:1 on white here.
                            `gray-500` is the one ramp step `globals.css`
                            re-tunes per theme, so a single class clears 4.5:1
                            in both — no `dark:` variant needed. */}
                        <span className="mono flex-shrink-0 text-[11px] text-gray-500">
                          {formatRelative(latest?.createdAt ?? conversation.createdAt)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-gray-600 dark:text-gray-400">
                          {latest ? latest.content : "No messages yet"}
                        </span>
                        {conversation.unreadCount > 0 && (
                          <span className="mono inline-flex min-w-[1.375rem] flex-shrink-0 items-center justify-center rounded-md border border-green-200 bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                            <span className="sr-only"> unread messages</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ChatPanel({
  conversation,
  messages,
  loading,
  currentUserId,
  isConnected,
  draft,
  sending,
  onDraftChange,
  onSend,
  onBack,
  endRef,
}: {
  conversation: Conversation;
  messages: Message[];
  loading: boolean;
  currentUserId?: string;
  isConnected: boolean;
  draft: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  const groups = useMemo(() => groupByDay(messages), [messages]);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-3 py-3 dark:border-gray-700 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="interactive -ml-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white lg:hidden"
          aria-label="Back to conversations"
        >
          <Icon.arrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={conversation.company.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white sm:text-base">
            {conversation.company.name}
          </h2>
          {isConnected ? (
            <Eyebrow accent className="mt-0.5 inline-flex items-center gap-1.5">
              <span className="dot-live" aria-hidden="true" />
              Connected
            </Eyebrow>
          ) : (
            <Eyebrow className="mt-0.5">Reconnecting…</Eyebrow>
          )}
        </div>
      </div>

      <div
        className={`flex-1 space-y-5 overflow-y-auto p-3 sm:p-6 ${THREAD_SURFACE}`}
        aria-busy={loading}
      >
        {loading ? (
          // Alternating bubbles rather than a centred spinner: the thread has a
          // shape, and reproducing it is what keeps the composer still (§5.4).
          <div className="space-y-3">
            <p role="status" className="sr-only">
              Loading messages
            </p>
            {[false, true, false, true].map((mine, index) => (
              <div key={index} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <Skeleton
                  className={`h-14 rounded-xl ${index % 3 === 0 ? "w-3/5" : "w-4/5"} sm:max-w-md`}
                />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-600 dark:text-gray-400">
            No messages yet — say hello to {conversation.company.name}.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-3">
              {/* A single hairline with the mono label sitting on it. */}
              <div
                className="relative flex items-center justify-center py-1"
                role="separator"
                aria-label={group.label}
              >
                <span
                  className="absolute inset-x-0 top-1/2 h-px bg-gray-200 dark:bg-gray-700"
                  aria-hidden="true"
                />
                <Eyebrow as="span" className={`relative px-2.5 ${THREAD_SURFACE}`}>
                  {group.label}
                </Eyebrow>
              </div>

              {group.messages.map((message) => {
                const mine = (message.senderId ?? message.sender?.id) === currentUserId;
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`bubble ${mine ? "bubble-own" : "bubble-peer"} sm:max-w-md`}>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.content}
                      </p>
                      <p className="mono bubble-time text-right">
                        <span className="sr-only">Sent at </span>
                        {formatTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <Composer draft={draft} sending={sending} onChange={onDraftChange} onSend={onSend} />
    </Card>
  );
}

/**
 * The cap is no longer re-declared here.
 *
 * It was 4000, which is the safer of the two directions — the client refused
 * what the server would have stored — but it was still a second number for one
 * rule, and the company-side composer had no number at all. Both now read the
 * same constant; `app/components/limits.tsx` carries the note about where that
 * constant should ultimately live.
 */

/** Where the counter appears. Below this it is noise; above it, it is a warning. */
const MESSAGE_COUNTER_AT = MESSAGE_MAX_LENGTH - 500;

function Composer({
  draft,
  sending,
  onChange,
  onSend,
}: {
  draft: string;
  sending: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const remaining = MESSAGE_MAX_LENGTH - draft.length;

  // Grow with the text up to a few lines, then scroll inside the box.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [draft]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `onKeyPress` is deprecated and never fired for every input; Enter sends,
    // Shift+Enter (and IME composition) still inserts a newline (audit 3.11).
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4">
      <div className="flex items-end gap-2 sm:gap-3">
        <label htmlFor="message-input" className="sr-only">
          Write a message
        </label>
        <textarea
          ref={textareaRef}
          id="message-input"
          rows={1}
          value={draft}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message…"
          maxLength={MESSAGE_MAX_LENGTH}
          aria-describedby="message-hint"
          className="field max-h-36 min-h-[2.75rem] flex-1 resize-none"
        />
        <Button
          className="h-11 flex-shrink-0"
          disabled={!draft.trim()}
          loading={sending}
          loadingLabel="Sending your message"
          icon={<Icon.send className="h-4 w-4" />}
          onClick={onSend}
        >
          <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
          <span className="sr-only sm:hidden">Send message</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p id="message-hint" className="eyebrow">
          Enter sends · Shift + Enter adds a new line
        </p>
        {/* Silent until it matters, so the composer stays quiet for the 99% of
            messages nowhere near the cap. */}
        {draft.length >= MESSAGE_COUNTER_AT && (
          <Eyebrow as="span">
            <Readout className="text-[11px] font-medium">{remaining}</Readout> characters left
          </Eyebrow>
        )}
      </div>
    </div>
  );
}
