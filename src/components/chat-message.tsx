import type { ChatMessage as ChatMessageType } from "@/types";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-2 text-sm",
          isUser
            ? "bg-neutral-900 text-white"
            : "bg-neutral-100 text-neutral-900"
        )}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
