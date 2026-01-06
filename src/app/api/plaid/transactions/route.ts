import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid";

export async function GET() {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's Plaid items
    const { data: plaidItems, error: dbError } = await supabase
      .from("plaid_items")
      .select("access_token, institution_name")
      .eq("user_id", user.id);

    if (dbError) {
      console.error("Database error:", dbError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (!plaidItems || plaidItems.length === 0) {
      return NextResponse.json({ error: "No connected accounts" }, { status: 404 });
    }

    // Fetch transactions from all connected accounts
    const allTransactions: Transaction[] = [];
    const allAccounts: Account[] = [];

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

        // Map transactions to our format
        const transactions = response.data.transactions.map((t) => ({
          id: t.transaction_id,
          date: t.date,
          name: t.merchant_name || t.name,
          amount: t.amount,
          category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
          pending: t.pending,
        }));

        // Map accounts to our format
        const accounts = response.data.accounts.map((a) => ({
          id: a.account_id,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          balance: a.balances.current,
          institution: item.institution_name,
        }));

        allTransactions.push(...transactions);
        allAccounts.push(...accounts);
      } catch (plaidError) {
        console.error("Plaid error for item:", plaidError);
        // Continue with other items
      }
    }

    // Sort transactions by date (most recent first)
    allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      transactions: allTransactions,
      accounts: allAccounts,
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  pending: boolean;
}

interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  balance: number | null;
  institution: string | null;
}
