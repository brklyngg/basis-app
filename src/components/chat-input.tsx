"use client";

import { useState, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      onSend(input);
      setInput("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your spending..."
        disabled={isLoading}
        className="flex-1"
      />
      <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
        {isLoading ? "..." : "Send"}
      </Button>
    </div>
  );
}
