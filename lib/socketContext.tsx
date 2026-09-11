"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '@/lib/clientAuth';

/** Payload broadcast by the socket server when a message is persisted. */
export interface SocketMessageEvent {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: string;
    sender?: { id: string; name: string; email: string; role?: string };
  };
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  /** True when real-time is configured at all — used to hide the status pill. */
  isEnabled: boolean;
  joinConversation: (conversationId: string) => void;
  leaveConversation: (conversationId: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isEnabled: false,
  joinConversation: () => {},
  leaveConversation: () => {},
});

export const useSocket = () => useContext(SocketContext);

/**
 * Resolves the socket server URL.
 *
 * The previous version fell back to the placeholder
 * `https://your-socket-server.vercel.app` in production, which meant every
 * deployed install spent ten seconds failing to connect to a domain that does
 * not exist. If the URL isn't configured we now simply disable real-time and
 * let the REST round-trip carry the messages.
 */
function resolveSocketUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return null;
  return 'http://localhost:3002';
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const url = useMemo(resolveSocketUrl, []);

  // Rooms we should be in. Kept in a ref so a reconnect can restore them
  // without re-running the connection effect.
  const roomsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!url) return;

    // `forceNew: true` plus a hand-rolled retry loop used to fight Socket.IO's
    // own reconnection logic and could leave several live sockets behind.
    const instance = io(url, {
      transports: ['websocket', 'polling'],
      timeout: 10_000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
      // The relay rejects an unauthenticated handshake, and checks membership
      // against the conversation row before honouring a join. Read lazily on
      // every (re)connection attempt rather than captured once, so a socket
      // that reconnects after a token refresh presents the current one.
      auth: (cb) => cb({ token: getToken() ?? '' }),
    });

    const handleConnect = () => {
      setIsConnected(true);
      // Re-join every room after a reconnect, otherwise the user silently stops
      // receiving messages for the thread they're looking at.
      roomsRef.current.forEach((room) => instance.emit('join-conversation', room));
    };

    instance.on('connect', handleConnect);
    instance.on('disconnect', () => setIsConnected(false));
    instance.on('connect_error', () => setIsConnected(false));

    setSocket(instance);

    return () => {
      instance.off('connect', handleConnect);
      instance.removeAllListeners();
      instance.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [url]);

  const joinConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) return;
      roomsRef.current.add(conversationId);
      socket?.emit('join-conversation', conversationId);
    },
    [socket]
  );

  const leaveConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) return;
      roomsRef.current.delete(conversationId);
      socket?.emit('leave-conversation', conversationId);
    },
    [socket]
  );

  const value = useMemo<SocketContextType>(
    () => ({
      socket,
      isConnected,
      isEnabled: !!url,
      joinConversation,
      leaveConversation,
    }),
    [socket, isConnected, url, joinConversation, leaveConversation]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};
