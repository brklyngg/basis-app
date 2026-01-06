import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

export async function POST() {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create link token
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: user.id,
      },
      client_name: "Basis",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error("Error creating link token:", error);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 }
    );
  }
}
