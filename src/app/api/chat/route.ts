import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid";
import { analyzeTransactions } from "@/lib/financial-analysis";
import { buildFinancialContext } from "@/lib/context-builder";
import { FINANCIAL_MAVEN_SYSTEM_PROMPT } from "@/lib/prompts";
import type { Transaction } from "@/types";

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

    const { message, conversationHistory } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Get user's Plaid items
    const { data: plaidItems } = await supabase
      .from("plaid_items")
      .select("access_token")
      .eq("user_id", user.id);

    // Fetch transactions if user has connected accounts
    let financialContext = "No bank account connected yet.";

    if (plaidItems && plaidItems.length > 0) {
      const allTransactions: Transaction[] = [];

      // Calculate date range (last 90 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      const formatDate = (date: Date) => date.toISOString().split("T")[0];

      for (const item of plaidItems) {
        try {
          const response = await plaidClient.transactionsGet({
            access_token: item.access_token,
            start_date: formatDate(startDate),
            end_date: formatDate(endDate),
          });

          const transactions = response.data.transactions.map((t) => ({
            id: t.transaction_id,
            date: t.date,
            name: t.merchant_name || t.name,
            amount: t.amount,
            category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
            pending: t.pending,
          }));

          allTransactions.push(...transactions);
        } catch (plaidError) {
          console.error("Plaid error:", plaidError);
        }
      }

      // Sort by date
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Analyze and build context
      const snapshot = analyzeTransactions(allTransactions);
      financialContext = buildFinancialContext(allTransactions, snapshot);
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
            system: `${FINANCIAL_MAVEN_SYSTEM_PROMPT}\n\n=== USER'S FINANCIAL DATA ===\n${financialContext}`,
            messages,
            stream: true,
          });

          for await (const event of response) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              const chunk = `data: ${JSON.stringify({ text: event.delta.text })}\n\n`;
              controller.enqueue(encoder.encode(chunk));
            }
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
