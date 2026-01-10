import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, PLAID_REAUTH_ERRORS, PLAID_TEMPORARY_ERRORS } from "@/lib/plaid";
import { buildFinancialStatement, calculateDateRange } from "@/lib/financial-statement";
import { createFinancialSpreadsheet, refreshTokensIfNeeded } from "@/lib/google-sheets";
import { classifyAllTransactions } from "@/lib/transaction-classifier";
import type { Transaction, Account } from "@/types";

interface ExportRequest {
  startDate?: string;
  endDate?: string;
  preset?: number; // 3, 6, 12, or 0 for all time
}

interface PlaidApiError {
  response?: {
    data?: {
      error_code?: string;
      error_message?: string;
    };
  };
}

export async function POST(request: Request) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body: ExportRequest = await request.json();

    // Get Google tokens
    const { data: googleTokens, error: tokensError } = await supabase
      .from("google_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", user.id)
      .single();

    if (tokensError || !googleTokens) {
      return NextResponse.json(
        { error: "Google account not connected. Please connect your Google account first." },
        { status: 400 }
      );
    }

    // Check if tokens need refresh
    let accessToken = googleTokens.access_token;
    const refreshed = await refreshTokensIfNeeded(
      googleTokens.refresh_token,
      new Date(googleTokens.expires_at)
    );

    if (refreshed) {
      // Update tokens in database
      await supabase
        .from("google_tokens")
        .update({
          access_token: refreshed.accessToken,
          expires_at: refreshed.expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      accessToken = refreshed.accessToken;
    }

    // Get user's Plaid items
    const { data: plaidItems, error: dbError } = await supabase
      .from("plaid_items")
      .select("id, access_token, institution_name, item_id, sync_cursor")
      .eq("user_id", user.id);

    if (dbError) {
      console.error("Database error:", dbError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (!plaidItems || plaidItems.length === 0) {
      return NextResponse.json(
        { error: "No connected bank accounts. Please connect a bank account first." },
        { status: 400 }
      );
    }

    // Fetch all transactions from Plaid
    const allTransactions: Transaction[] = [];
    const allAccounts: Account[] = [];

    for (const item of plaidItems) {
      try {
        // Always use empty cursor to fetch ALL historical transactions
        // Per Plaid docs: cursor: "" returns all transactions as "adds"
        let cursor: string | undefined = "";
        let hasMore = true;
        let accountsFetched = false;

        while (hasMore) {
          const response = await plaidClient.transactionsSync({
            access_token: item.access_token,
            cursor: cursor,
            count: 500,
          });

          const data = response.data;

          // Map transactions with enhanced fields
          for (const t of data.added) {
            allTransactions.push({
              id: t.transaction_id,
              date: t.date,
              name: t.merchant_name || t.name,
              amount: t.amount,
              category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
              pending: t.pending,
              accountId: t.account_id,
              transactionCode: t.transaction_code || null,
              paymentChannel: t.payment_channel || null,
              paymentMeta: t.payment_meta ? {
                payee: t.payment_meta.payee || null,
                payer: t.payment_meta.payer || null,
                paymentMethod: t.payment_meta.payment_method || null,
              } : undefined,
            });
          }

          // Fetch accounts (only once per item)
          if (!accountsFetched && data.accounts.length > 0) {
            for (const a of data.accounts) {
              allAccounts.push({
                id: a.account_id,
                name: a.name,
                type: a.type,
                subtype: a.subtype,
                balance: a.balances.current,
                institution: item.institution_name,
                itemId: item.item_id,
              });
            }
            accountsFetched = true;
          }

          cursor = data.next_cursor;
          hasMore = data.has_more;
        }

        // Note: We intentionally don't update the sync_cursor here since we always
        // want to fetch all historical transactions for export purposes.
      } catch (error) {
        const plaidError = error as PlaidApiError;
        const errorCode = plaidError.response?.data?.error_code || "UNKNOWN_ERROR";
        console.error(`Plaid error for item ${item.item_id}:`, errorCode);
        // Continue with other items even if one fails
      }
    }

    if (allTransactions.length === 0) {
      return NextResponse.json(
        { error: "No transactions found. Please wait for your bank data to sync." },
        { status: 400 }
      );
    }

    // Calculate date range
    let startDate = body.startDate;
    let endDate = body.endDate;

    if (!startDate || !endDate) {
      const preset = body.preset ?? 12; // Default to 12 months
      const range = calculateDateRange(preset, allTransactions);
      startDate = startDate || range.start;
      endDate = endDate || range.end;
    }

    // Classify all transactions
    const classifiedTransactions = classifyAllTransactions(allTransactions, allAccounts);

    // Build financial statement
    const statement = buildFinancialStatement(
      allTransactions,
      allAccounts,
      startDate,
      endDate
    );

    // Create Google Sheets spreadsheet with raw transaction data and balance sheet
    const result = await createFinancialSpreadsheet(accessToken, statement, classifiedTransactions, allAccounts);

    return NextResponse.json({
      success: true,
      spreadsheetUrl: result.url,
      spreadsheetId: result.id,
      dateRange: statement.dateRange,
      monthsIncluded: statement.months.length,
    });
  } catch (error) {
    console.error("Export error:", error);

    // Check for specific Google API errors
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("invalid_grant") || errorMessage.includes("Token has been revoked")) {
      return NextResponse.json(
        { error: "Google authorization expired. Please reconnect your Google account." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to export financial statement" },
      { status: 500 }
    );
  }
}

// GET endpoint to check export status
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log("[Export Status] Checking auth status for user:", user?.id);

    if (authError || !user) {
      console.log("[Export Status] Unauthorized - authError:", authError?.message);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has Google connected
    const { data: googleTokens, error: tokensError } = await supabase
      .from("google_tokens")
      .select("expires_at, created_at")
      .eq("user_id", user.id)
      .single();

    console.log("[Export Status] Token query result - tokens:", !!googleTokens, "error:", tokensError?.message);

    const hasGoogleAuth = !tokensError && googleTokens !== null;
    const needsRefresh = hasGoogleAuth && new Date(googleTokens.expires_at) < new Date();

    console.log("[Export Status] Returning hasGoogleAuth:", hasGoogleAuth, "needsRefresh:", needsRefresh);

    return NextResponse.json({
      hasGoogleAuth,
      needsRefresh,
      connectedAt: googleTokens?.created_at || null,
    });
  } catch (error) {
    console.error("[Export Status] Error:", error);
    return NextResponse.json(
      { error: "Failed to check export status" },
      { status: 500 }
    );
  }
}
