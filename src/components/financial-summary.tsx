"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Account, FinancialSnapshot } from "@/types";

interface FinancialSummaryProps {
  snapshot: FinancialSnapshot | null;
  accounts: Account[];
  onDisconnect: () => void;
}

export function FinancialSummary({ snapshot, accounts, onDisconnect }: FinancialSummaryProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  // Calculate total balance
  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

  return (
    <div className="space-y-4">
      {/* Accounts Card */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-neutral-500">
            Connected Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.length > 0 ? (
            <>
              {accounts.map((account) => (
                <div key={account.id} className="flex justify-between items-center text-sm">
                  <div>
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-neutral-500 capitalize">
                      {account.type} {account.subtype && `· ${account.subtype}`}
                    </div>
                  </div>
                  <div className="font-mono">
                    {account.balance !== null ? formatCurrency(account.balance) : "—"}
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t flex justify-between items-center">
                <span className="text-sm font-medium">Total</span>
                <span className="font-mono font-medium">
                  {formatCurrency(totalBalance)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500">No accounts connected</p>
          )}
        </CardContent>
      </Card>

      {/* Spending Summary Card */}
      {snapshot && snapshot.totalSpending > 0 && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-neutral-500">
              {snapshot.dateRange.days} Day Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-neutral-500">Total Spent</div>
                <div className="font-mono font-medium">
                  {formatCurrency(snapshot.totalSpending)}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Daily Avg</div>
                <div className="font-mono font-medium">
                  {formatCurrency(snapshot.averageDailySpend)}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Weekly Pace</div>
                <div className="font-mono font-medium">
                  {formatCurrency(snapshot.weeklyVelocity)}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Discretionary</div>
                <div className="font-mono font-medium">
                  {snapshot.discretionaryRatio.toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Top Categories */}
            {snapshot.categoryBreakdown.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs text-neutral-500 mb-2">Top Categories</div>
                <div className="space-y-1">
                  {snapshot.categoryBreakdown.slice(0, 4).map((cat) => (
                    <div key={cat.category} className="flex justify-between text-xs">
                      <span className="text-neutral-600">{cat.category}</span>
                      <span className="font-mono">{formatCurrency(cat.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recurring Charges */}
            {snapshot.recurringCharges.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs text-neutral-500 mb-2">
                  Recurring ({snapshot.recurringCharges.length} detected)
                </div>
                <div className="space-y-1">
                  {snapshot.recurringCharges.slice(0, 3).map((charge) => (
                    <div key={charge.merchant} className="flex justify-between text-xs">
                      <span className="text-neutral-600">{charge.merchant}</span>
                      <span className="font-mono">
                        {formatCurrency(charge.amount)}/{charge.frequency.slice(0, 2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Disconnect Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onDisconnect}
        className="w-full text-neutral-500"
      >
        Disconnect Bank
      </Button>
    </div>
  );
}
