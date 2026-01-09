import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

export async function POST(request: Request) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if this is an update mode request
    let mode: "create" | "update" = "create";
    let accessToken: string | undefined;

    try {
      const body = await request.json();
      if (body.mode === "update") {
        mode = "update";
        // Get existing access token for update mode
        const { data: plaidItems } = await supabase
          .from("plaid_items")
          .select("access_token")
          .eq("user_id", user.id)
          .limit(1)
          .single();

        if (plaidItems?.access_token) {
          accessToken = plaidItems.access_token;
        }
      }
    } catch {
      // No body or invalid JSON - default to create mode
    }

    // Create link token
    const linkTokenConfig = {
      user: {
        client_user_id: user.id,
      },
      client_name: "Basis",
      country_codes: PLAID_COUNTRY_CODES,
      language: "en" as const,
      ...(mode === "update" && accessToken
        ? { access_token: accessToken }
        : { products: PLAID_PRODUCTS }),
      // Request 1 year of transaction history
      transactions: {
        days_requested: 365,
      },
    };

    const response = await plaidClient.linkTokenCreate(linkTokenConfig);

    return NextResponse.json({
      link_token: response.data.link_token,
      mode,
    });
  } catch (error) {
    console.error("Error creating link token:", error);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 }
    );
  }
}
