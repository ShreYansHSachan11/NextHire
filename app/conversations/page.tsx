"use client";

import React, { useEffect, useState, useRef } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSocket } from "../../lib/socketContext";
import type { RootState } from "../../store/store";

interface Application {
  id: string;
  userId: string;
  jobId: string;
  status: string;
  message: string;
  createdAt: string;
  job: {
    id: string;
    title: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
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
  messages: Message[];
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    email: string;
  };
}

interface ConversationItem {
  application: Application;
  conversation: Conversation | null;
  hasConversation: boolean;
}

export default function ConversationsPage() {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const { socket, isConnected, joinConversation, leaveConversation } = useSocket();
  const [conversationItems, setConversationItems] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "COMPANY") {
      router.push("/auth/login");
      return;
    }

    if (user?.companyId) {
      fetchConversations();
    }
  }, [isAuthenticated, user?.companyId, router]);

  // Auto-select conversation from URL parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const conversationId = urlParams.get('conversationId');
    
    if (conversationId && conversationItems.length > 0) {
      const item = conversationItems.find(item => item.conversation?.id === conversationId);
      if (item && item.conversation) {
        setSelectedConversation(item.conversation);
        setShowChat(true);
      }
    }
  }, [conversationItems]);

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation.id);
      joinConversation(selectedConversation.id);
    }

    return () => {
      if (selectedConversation) {
        leaveConversation(selectedConversation.id);
      }
    };
  }, [selectedConversation, joinConversation, leaveConversation]);

  // Socket.IO real-time message handling
  useEffect(() => {
    if (!socket) {
      console.log('Socket not available for real-time messages');
      return;
    }

    const handleNewMessage = (data: { conversationId: string; message: Message }) => {
      console.log('Received new message via Socket.IO:', data);
      console.log('Current selected conversation:', selectedConversation?.id);
      if (selectedConversation && data.conversationId === selectedConversation.id) {
        console.log('Adding message to current conversation');
        setMessages(prev => [...prev, data.message]);
      } else {
        console.log('Message not for current conversation or no conversation selected');
      }
    };

    console.log('Setting up Socket.IO message listener');
    socket.on('new-message', handleNewMessage);

    return () => {
      console.log('Cleaning up Socket.IO message listener');
      socket.off('new-message', handleNewMessage);
    };
  }, [socket, selectedConversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/conversations?companyId=${user?.companyId}`);
      
      if (response.ok) {
        const data = await response.json();
        setConversationItems(data);
      } else {
        console.error("Failed to fetch conversations:", response.status);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/messages?conversationId=${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    try {
      setSendingMessage(true);
      console.log('Sending message via API:', {
        conversationId: selectedConversation.id,
        senderId: user?.id,
        content: newMessage.trim(),
      });
      
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          senderId: user?.id,
          content: newMessage.trim(),
        }),
      });

      if (response.ok) {
        const message = await response.json();
        console.log('Message sent successfully via API:', message);
        setMessages(prev => [...prev, message]);
        setNewMessage("");
      } else {
        console.error("Failed to send message");
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setSendingMessage(false);
    }
  };

  const startConversation = async (application: Application) => {
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: application.userId,
          companyId: user?.companyId,
        }),
      });

      if (response.ok) {
        const conversation = await response.json();
        setSelectedConversation(conversation);
        setShowChat(true);
        fetchConversations(); // Refresh to update the conversation list
      }
    } catch (error) {
      console.error("Failed to start conversation:", error);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isAuthenticated || user?.role !== "COMPANY") {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur shadow-lg border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4 sm:py-6">
            <div className="flex items-center space-x-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Messages</h1>
                <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base">Chat with job applicants</p>
              </div>
              {isConnected && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                  Connected
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/company/dashboard"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Mobile Layout */}
        <div className="lg:hidden">
          {!showChat ? (
            /* Applications/Conversations List - Mobile */
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 min-h-[calc(100vh-300px)] flex flex-col">
              <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Applications & Conversations</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{conversationItems.length} total applications</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm">Loading conversations...</p>
                  </div>
                ) : conversationItems.length === 0 ? (
                  <div className="p-6 text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm">No applications yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {conversationItems.map((item, index) => (
                      <div
                        key={`${item.application.id}-${item.application.userId}-${index}`}
                        className="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        onClick={() => {
                          if (item.conversation) {
                            setSelectedConversation(item.conversation);
                            setShowChat(true);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white font-semibold text-lg">
                                {item.application.user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                                {item.application.user.name}
                              </h3>
                              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate">{item.application.job.title}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.application.user.email}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {formatDate(item.application.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-2">
                            {item.hasConversation ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700">
                                <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                                Chatting
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startConversation(item.application);
                                }}
                                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                              >
                                Start Chat
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Chat Area - Mobile */
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 min-h-[calc(100vh-300px)] flex flex-col">
              {selectedConversation ? (
                <>
                  {/* Chat Header - Mobile */}
                  <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <button
                          onClick={() => setShowChat(false)}
                          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-sm">
                            {selectedConversation.user.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                            {selectedConversation.user.name}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{selectedConversation.user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {isConnected && (
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Online</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Messages - Mobile */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gray-50 dark:bg-gray-900">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.id}-${index}`}
                        className={`flex ${
                          message.senderId === user?.id ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-3 rounded-2xl shadow-sm ${
                            message.senderId === user?.id
                              ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-br-md"
                              : "bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md"
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          <p className={`text-xs mt-2 ${
                            message.senderId === user?.id 
                              ? "text-blue-100" 
                              : "text-gray-500 dark:text-gray-400"
                          }`}>
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Input - Mobile */}
                  <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex space-x-3">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                        placeholder="Type your message..."
                        className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
                      />
                      <button
                        onClick={sendMessage}
                        disabled={sendingMessage || !newMessage.trim()}
                        className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium flex items-center space-x-2 btn-touch"
                      >
                        {sendingMessage ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">No conversation selected</h3>
                    <p className="text-gray-600 dark:text-gray-300 text-sm">
                      Select an application to start chatting.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop Layout */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-6">
          {/* Applications/Conversations List */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 h-[calc(100vh-200px)] flex flex-col">
              <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Applications & Conversations</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{conversationItems.length} total applications</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm">Loading conversations...</p>
                  </div>
                ) : conversationItems.length === 0 ? (
                  <div className="p-6 text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm">No applications yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {conversationItems.map((item, index) => (
                      <div
                        key={`${item.application.id}-${item.application.userId}-${index}`}
                        className={`p-4 sm:p-6 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          selectedConversation?.id === item.conversation?.id ? "bg-blue-50 dark:bg-blue-900/20 border-r-4 border-blue-500" : ""
                        }`}
                        onClick={() => {
                          if (item.conversation) {
                            setSelectedConversation(item.conversation);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white font-semibold text-lg">
                                {item.application.user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                                {item.application.user.name}
                              </h3>
                              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate">{item.application.job.title}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.application.user.email}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {formatDate(item.application.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end space-y-2">
                            {item.hasConversation ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700">
                                <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                                Chatting
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startConversation(item.application);
                                }}
                                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                              >
                                Start Chat
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 h-[calc(100vh-200px)] flex flex-col">
              {selectedConversation ? (
                <>
                  {/* Chat Header */}
                  <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-lg">
                            {selectedConversation.user.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {selectedConversation.user.name}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{selectedConversation.user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {isConnected && (
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Online</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gray-50 dark:bg-gray-900">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.id}-${index}`}
                        className={`flex ${
                          message.senderId === user?.id ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-xs sm:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl shadow-sm ${
                            message.senderId === user?.id
                              ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-br-md"
                              : "bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-bl-md"
                          }`}
                        >
                          <p className="text-sm sm:text-base leading-relaxed">{message.content}</p>
                          <p className={`text-xs mt-2 ${
                            message.senderId === user?.id 
                              ? "text-blue-100" 
                              : "text-gray-500 dark:text-gray-400"
                          }`}>
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Input */}
                  <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex space-x-3">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                        placeholder="Type your message..."
                        className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
                      />
                      <button
                        onClick={sendMessage}
                        disabled={sendingMessage || !newMessage.trim()}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium flex items-center space-x-2 btn-touch"
                      >
                        {sendingMessage ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            <span>Sending...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            <span>Send</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                      <svg className="w-10 h-10 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No conversation selected</h3>
                    <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base max-w-md mx-auto">
                      Select an application from the list to start chatting with the applicant.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
} 