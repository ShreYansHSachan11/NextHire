"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinConversation: (conversationId: string) => void;
  leaveConversation: (conversationId: string) => void;
  sendMessage: (data: any) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  joinConversation: () => {},
  leaveConversation: () => {},
  sendMessage: () => {},
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize socket connection with retry logic
    let socketInstance: Socket | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    const connectSocket = () => {
      try {
        // Use environment variable for production, fallback to localhost for development
        const socketUrl = process.env.NODE_ENV === 'production' 
          ? process.env.NEXT_PUBLIC_SOCKET_URL || 'https://your-socket-server.vercel.app'
          : 'http://localhost:3002';
          
        socketInstance = io(socketUrl, {
          transports: ['websocket', 'polling'],
          timeout: 10000,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          forceNew: true,
        });

        socketInstance.on('connect', () => {
          console.log('Connected to Socket.IO server');
          setIsConnected(true);
          retryCount = 0; // Reset retry count on successful connection
        });

        socketInstance.on('disconnect', (reason) => {
          console.log('Disconnected from Socket.IO server. Reason:', reason);
          setIsConnected(false);
        });

        socketInstance.on('connect_error', (error) => {
          console.error('Socket.IO connection error:', error);
          console.error('Error details:', {
            message: error.message,
            name: error.name,
            stack: error.stack
          });
          setIsConnected(false);
          
          // Retry connection if we haven't exceeded max retries
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
            setTimeout(() => {
              if (socketInstance) {
                socketInstance.connect();
              }
            }, 2000);
          } else {
            console.log('Max retry attempts reached. Socket.IO will not be available.');
          }
        });

        socketInstance.on('reconnect', (attemptNumber) => {
          console.log(`Reconnected to Socket.IO server after ${attemptNumber} attempts`);
          setIsConnected(true);
          retryCount = 0;
        });

        socketInstance.on('reconnect_error', (error) => {
          console.error('Socket.IO reconnection error:', error);
        });

        socketInstance.on('reconnect_failed', () => {
          console.error('Socket.IO reconnection failed after all attempts');
          setIsConnected(false);
        });

        setSocket(socketInstance);
      } catch (error) {
        console.error('Failed to initialize Socket.IO:', error);
      }
    };

    connectSocket();

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, []);

  const joinConversation = (conversationId: string) => {
    if (socket) {
      socket.emit('join-conversation', conversationId);
    }
  };

  const leaveConversation = (conversationId: string) => {
    if (socket) {
      socket.emit('leave-conversation', conversationId);
    }
  };

  const sendMessage = (data: any) => {
    if (socket && isConnected) {
      socket.emit('send-message', data);
    } else {
      console.log('Socket.IO not connected, message will be sent via API only');
    }
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        joinConversation,
        leaveConversation,
        sendMessage,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}; 