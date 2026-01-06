import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid";

export async function POST(request: Request) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { public_token, institution } = await request.json();

    if (!public_token) {
      return NextResponse.json({ error: "Missing public_token" }, { status: 400 });
    }

    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Store in database using service role (bypasses RLS for insert)
    const serviceClient = await createServiceClient();
    const { error: dbError } = await serviceClient
      .from("plaid_items")
      .upsert({
        user_id: user.id,
        access_token,
        item_id,
        institution_name: institution?.name || null,
      }, {
        onConflict: "user_id,item_id",
      });

    if (dbError) {
      console.error("Database error:", dbError);
      return NextResponse.json(
        { error: "Failed to store access token" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      institution_name: institution?.name,
    });
  } catch (error) {
    console.error("Error exchanging token:", error);
    return NextResponse.json(
      { error: "Failed to exchange token" },
      { status: 500 }
    );
  }
}
