import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { analyzeTransactions } from "@/lib/financial-analysis";
import { buildFinancialContext } from "@/lib/context-builder";
import { FINANCIAL_MAVEN_SYSTEM_PROMPT } from "@/lib/prompts";
import type { Transaction, FinancialSnapshot } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, conversationHistory, transactions, snapshot } = await request.json() as {
      message: string;
      conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
      transactions?: Transaction[];
      snapshot?: FinancialSnapshot;
    };

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Build financial context from request data (already fetched by dashboard)
    let financialContext = "No bank account connected yet.";

    if (transactions && Array.isArray(transactions) && transactions.length > 0 && snapshot) {
      financialContext = buildFinancialContext(transactions, snapshot);
    } else if (transactions && Array.isArray(transactions) && transactions.length > 0) {
      // Fallback: compute snapshot if not provided
      const computedSnapshot = analyzeTransactions(transactions);
      financialContext = buildFinancialContext(transactions, computedSnapshot);
    }

    // Build messages for Claude
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history (last 4 messages to stay within token budget)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-4);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add current message
    messages.push({
      role: "user",
      content: message,
    });

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: [
              {
                type: "text",
                text: FINANCIAL_MAVEN_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
              {
                type: "text",
                text: `=== USER'S FINANCIAL DATA ===\n${financialContext}`,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages,
            stream: true,
          });

          let fullAssistantResponse = "";

          for await (const event of response) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullAssistantResponse += event.delta.text;
              const chunk = `data: ${JSON.stringify({ text: event.delta.text })}\n\n`;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          // Save messages to database after streaming completes
          try {
            await supabase.from("chat_messages").insert([
              { user_id: user.id, role: "user", content: message },
              { user_id: user.id, role: "assistant", content: fullAssistantResponse },
            ]);
          } catch (saveError) {
            console.error("Failed to save messages:", saveError);
            // Don't fail the response if save fails - messages are already streamed
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("Claude error:", error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to process chat" },
      { status: 500 }
    );
  }
}
