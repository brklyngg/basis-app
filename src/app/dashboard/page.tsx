"use client";

import { useEffect, useState, useCallback } from "react";
import { usePlaidLink, PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatInterface } from "@/components/chat-interface";
import { FinancialSummary } from "@/components/financial-summary";
import type { Transaction, Account, FinancialSnapshot } from "@/types";
import { analyzeTransactions } from "@/lib/financial-analysis";

export default function DashboardPage() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [hasConnectedBank, setHasConnectedBank] = useState<boolean | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if user has connected bank
  const checkBankConnection = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return;

    const { data: plaidItems } = await supabase
      .from("plaid_items")
      .select("institution_name")
      .eq("user_id", user.id);

    if (plaidItems && plaidItems.length > 0) {
      setHasConnectedBank(true);
      setInstitutionName(plaidItems[0].institution_name);
      await fetchTransactions();
    } else {
      setHasConnectedBank(false);
      await fetchLinkToken();
    }
    setLoading(false);
  }, []);

  // Fetch link token for Plaid Link
  const fetchLinkToken = async () => {
    try {
      const response = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await response.json();
      if (data.link_token) {
        setLinkToken(data.link_token);
      } else {
        setError("Failed to initialize bank connection");
      }
    } catch {
      setError("Failed to initialize bank connection");
    }
  };

  // Fetch transactions from connected accounts
  const fetchTransactions = async () => {
    try {
      const response = await fetch("/api/plaid/transactions");
      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }
      const data = await response.json();
      setTransactions(data.transactions);
      setAccounts(data.accounts);

      // Analyze transactions
      if (data.transactions.length > 0) {
        const analysis = analyzeTransactions(data.transactions);
        setSnapshot(analysis);
      }
    } catch {
      setError("Failed to load transactions");
    }
  };

  // Handle successful Plaid Link
  const onSuccess = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    try {
      const response = await fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_token: publicToken,
          institution: metadata.institution,
        }),
      });

      if (response.ok) {
        setHasConnectedBank(true);
        setInstitutionName(metadata.institution?.name || null);
        await fetchTransactions();
      } else {
        setError("Failed to connect bank");
      }
    } catch {
      setError("Failed to connect bank");
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  // Handle logout
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  // Handle disconnect bank
  const handleDisconnect = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from("plaid_items")
        .delete()
        .eq("user_id", user.id);

      setHasConnectedBank(false);
      setTransactions([]);
      setAccounts([]);
      setSnapshot(null);
      await fetchLinkToken();
    }
  };

  useEffect(() => {
    checkBankConnection();
  }, [checkBankConnection]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-neutral-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Basis</h1>
          <div className="flex items-center gap-4">
            {hasConnectedBank && institutionName && (
              <span className="text-sm text-neutral-500">
                Connected: {institutionName}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        {!hasConnectedBank ? (
          // Connect Bank State
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <CardTitle>Connect Your Bank</CardTitle>
                <CardDescription>
                  Link your bank account to start analyzing your spending patterns.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <Button
                  onClick={() => open()}
                  disabled={!ready}
                  className="w-full"
                >
                  {ready ? "Connect Bank" : "Loading..."}
                </Button>
                <p className="text-xs text-neutral-500 text-center">
                  Your data is encrypted and never stored on our servers.
                  We use Plaid for secure bank connections.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          // Main Dashboard
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Financial Summary */}
            <div className="lg:col-span-1">
              <FinancialSummary
                snapshot={snapshot}
                accounts={accounts}
                onDisconnect={handleDisconnect}
              />
            </div>

            {/* Chat Interface */}
            <div className="lg:col-span-2">
              <ChatInterface
                transactions={transactions}
                snapshot={snapshot}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
