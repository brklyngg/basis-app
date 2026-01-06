"use client";

import { useRef, useEffect } from "react";
import { useChat } from "@/hooks/use-chat";
import { ChatMessage } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Transaction, FinancialSnapshot } from "@/types";

interface ChatInterfaceProps {
  transactions: Transaction[];
  snapshot: FinancialSnapshot | null;
}

export function ChatInterface({ transactions, snapshot }: ChatInterfaceProps) {
  const { messages, isLoading, isInitialLoading, error, sendMessage } = useChat({
    transactions,
    snapshot,
  });
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages update (including during streaming)
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="h-[calc(100vh-12rem)] flex flex-col">
      <CardHeader className="border-b py-4">
        <CardTitle className="text-lg">Talk to Your Money</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          {isInitialLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-neutral-500 animate-pulse">Loading conversation...</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="max-w-md space-y-4">
                <p className="text-neutral-500">
                  Ask me anything about your spending patterns.
                </p>
                <div className="space-y-2 text-sm text-neutral-400">
                  <p>Try asking:</p>
                  <ul className="space-y-1">
                    <li>&quot;Where is most of my money going?&quot;</li>
                    <li>&quot;How much do I spend on subscriptions?&quot;</li>
                    <li>&quot;What are my biggest spending categories?&quot;</li>
                    <li>&quot;How does my food spending compare to entertainment?&quot;</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && messages[messages.length - 1]?.content === "" && (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <div className="animate-pulse">Thinking...</div>
                </div>
              )}
              <div ref={scrollAnchorRef} />
            </div>
          )}
        </ScrollArea>

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 bg-red-50">
            {error}
          </div>
        )}

        <div className="border-t p-4">
          <ChatInput onSend={sendMessage} isLoading={isLoading} />
        </div>
      </CardContent>
    </Card>
  );
}
