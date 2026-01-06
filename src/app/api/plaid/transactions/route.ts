import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, PLAID_REAUTH_ERRORS, PLAID_TEMPORARY_ERRORS } from "@/lib/plaid";
import type { Transaction, Account, PlaidItemError, TransactionsResponse } from "@/types";

// Type for Plaid API error responses
interface PlaidApiError {
  response?: {
    data?: {
      error_code?: string;
      error_message?: string;
    };
  };
}

// Plaid returns max 500 transactions per request
const PLAID_MAX_TRANSACTIONS_PER_PAGE = 500;

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
      .select("access_token, institution_name, item_id")
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
    const itemErrors: PlaidItemError[] = [];

    // Calculate date range (last 90 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const formatDate = (date: Date) => date.toISOString().split("T")[0];

    for (const item of plaidItems) {
      try {
        // Fetch first page to get total count
        let offset = 0;
        let totalTransactions = 0;
        let accountsFetched = false;

        do {
          const response = await plaidClient.transactionsGet({
            access_token: item.access_token,
            start_date: formatDate(startDate),
            end_date: formatDate(endDate),
            options: {
              count: PLAID_MAX_TRANSACTIONS_PER_PAGE,
              offset,
            },
          });

          totalTransactions = response.data.total_transactions;

          // Map transactions to our format
          const transactions = response.data.transactions.map((t) => ({
            id: t.transaction_id,
            date: t.date,
            name: t.merchant_name || t.name,
            amount: t.amount,
            category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
            pending: t.pending,
          }));

          allTransactions.push(...transactions);

          // Only fetch accounts once per item
          if (!accountsFetched) {
            const accounts = response.data.accounts.map((a) => ({
              id: a.account_id,
              name: a.name,
              type: a.type,
              subtype: a.subtype,
              balance: a.balances.current,
              institution: item.institution_name,
            }));
            allAccounts.push(...accounts);
            accountsFetched = true;
          }

          offset += response.data.transactions.length;
        } while (offset < totalTransactions);

      } catch (error) {
        // Handle Plaid-specific errors with actionable messages
        const plaidError = error as PlaidApiError;
        const errorCode = plaidError.response?.data?.error_code || "UNKNOWN_ERROR";
        const errorMessage = plaidError.response?.data?.error_message || "An error occurred";

        console.error(`Plaid error for item ${item.item_id}:`, errorCode, errorMessage);

        itemErrors.push({
          itemId: item.item_id,
          institutionName: item.institution_name,
          errorCode,
          errorMessage,
          requiresReauth: PLAID_REAUTH_ERRORS.includes(errorCode),
          isTemporary: PLAID_TEMPORARY_ERRORS.includes(errorCode),
        });

        // Continue with other items even if one fails
      }
    }

    // Sort transactions by date (most recent first)
    allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Build response with error information if any
    const responseData: TransactionsResponse = {
      transactions: allTransactions,
      accounts: allAccounts,
    };

    if (itemErrors.length > 0) {
      responseData.errors = itemErrors;
      responseData.hasReauthRequired = itemErrors.some((e) => e.requiresReauth);
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
