import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, PLAID_REAUTH_ERRORS, PLAID_TEMPORARY_ERRORS } from "@/lib/plaid";
import type { Transaction, Account, PlaidItemError, TransactionsResponse, SyncStatus } from "@/types";
import { RemovedTransaction } from "plaid";

interface PlaidApiError {
  response?: {
    data?: {
      error_code?: string;
      error_message?: string;
    };
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json({ error: "No connected accounts" }, { status: 404 });
    }

    const allTransactions: Transaction[] = [];
    const allAccounts: Account[] = [];
    const itemErrors: PlaidItemError[] = [];
    let overallSyncStatus: SyncStatus = "ready";

    for (const item of plaidItems) {
      try {
        // Always use empty cursor to fetch ALL historical transactions
        // Per Plaid docs: cursor: "" returns all transactions as "adds"
        // This ensures data persists across page refreshes without storing transactions in DB
        let cursor: string | undefined = "";
        let hasMore = true;
        let itemSyncStatus: SyncStatus = "ready";
        const itemTransactions: Transaction[] = [];
        let accountsFetched = false;

        // Paginate through all available transactions
        while (hasMore) {
          const response = await plaidClient.transactionsSync({
            access_token: item.access_token,
            cursor: cursor || undefined,
            count: 500,
          });

          const data = response.data;

          // Check sync status from Plaid's transactions_update_status field
          const updateStatus = data.transactions_update_status;
          if (updateStatus === "NOT_READY") {
            itemSyncStatus = "syncing";
            overallSyncStatus = "syncing";
          }

          // Map added transactions with enhanced fields for classification
          for (const t of data.added) {
            itemTransactions.push({
              id: t.transaction_id,
              date: t.date,
              name: t.merchant_name || t.name,
              amount: t.amount,
              category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
              pending: t.pending,
              // Enhanced fields for transfer detection
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

          // Handle modified transactions (update existing)
          for (const t of data.modified) {
            const idx = itemTransactions.findIndex((tx) => tx.id === t.transaction_id);
            if (idx >= 0) {
              itemTransactions[idx] = {
                id: t.transaction_id,
                date: t.date,
                name: t.merchant_name || t.name,
                amount: t.amount,
                category: t.personal_finance_category?.primary || t.category?.[0] || "Other",
                pending: t.pending,
                // Enhanced fields for transfer detection
                accountId: t.account_id,
                transactionCode: t.transaction_code || null,
                paymentChannel: t.payment_channel || null,
                paymentMeta: t.payment_meta ? {
                  payee: t.payment_meta.payee || null,
                  payer: t.payment_meta.payer || null,
                  paymentMethod: t.payment_meta.payment_method || null,
                } : undefined,
              };
            }
          }

          // Handle removed transactions
          for (const removed of data.removed as RemovedTransaction[]) {
            const idx = itemTransactions.findIndex((tx) => tx.id === removed.transaction_id);
            if (idx >= 0) {
              itemTransactions.splice(idx, 1);
            }
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

        // Note: We intentionally don't store the cursor since we always want
        // to fetch all historical transactions on each request. This keeps
        // the implementation simple without requiring a transactions table.

        // Add this item's transactions to the collection
        allTransactions.push(...itemTransactions);

      } catch (error) {
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
      }
    }

    // Sort by date (most recent first)
    allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const responseData: TransactionsResponse = {
      transactions: allTransactions,
      accounts: allAccounts,
      syncStatus: overallSyncStatus,
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
