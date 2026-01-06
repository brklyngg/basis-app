"use client";

import { useState, useCallback, useEffect } from "react";
import type { ChatMessage, DbChatMessage, Transaction, FinancialSnapshot } from "@/types";

interface UseChatOptions {
  transactions: Transaction[];
  snapshot: FinancialSnapshot | null;
}

export function useChat({ transactions, snapshot }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load chat history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch("/api/chat/history");
        if (response.ok) {
          const data = await response.json();
          const loadedMessages = (data.messages as DbChatMessage[]).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at),
          }));
          setMessages(loadedMessages);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      } finally {
        setIsInitialLoading(false);
      }
    }
    loadHistory();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    setError(null);

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Create placeholder for assistant message
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Prepare conversation history (exclude the placeholder)
      const historyForApi = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content.trim(),
          conversationHistory: historyForApi,
          transactions: transactions.slice(0, 100), // Limit for context
          snapshot,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

      const decoder = new TextDecoder();
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulatedText += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: accumulatedText }
                      : m
                  )
                );
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      // Remove the empty assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, transactions, snapshot]);

  const clearMessages = useCallback(async () => {
    try {
      await fetch("/api/chat/history", { method: "DELETE" });
      setMessages([]);
      setError(null);
    } catch (err) {
      console.error("Failed to clear chat history:", err);
      setError("Failed to clear conversation");
    }
  }, []);

  return {
    messages,
    isLoading,
    isInitialLoading,
    error,
    sendMessage,
    clearMessages,
  };
}
