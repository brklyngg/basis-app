import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load chat history:", error);
      return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
    }

    return NextResponse.json({ messages: messages || [] });
  } catch (error) {
    console.error("Chat history error:", error);
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("user_id", user.id);

    if (error) {
      console.error("Failed to clear chat history:", error);
      return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Chat history delete error:", error);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
