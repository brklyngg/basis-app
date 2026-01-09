"use client";

import { Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account, FinancialSnapshot, SyncStatus } from "@/types";

interface FinancialSummaryProps {
  snapshot: FinancialSnapshot | null;
  accounts: Account[];
  syncStatus: SyncStatus;
  dateRange: number;
  onDateRangeChange: (days: number) => void;
  onDisconnect: (itemId?: string) => void;
  onAddBank: () => void;
}

export function FinancialSummary({
  snapshot,
  accounts,
  syncStatus,
  dateRange,
  onDateRangeChange,
  onDisconnect,
  onAddBank,
}: FinancialSummaryProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  // Group accounts by institution
  const accountsByInstitution = accounts.reduce((acc, account) => {
    const inst = account.institution || "Unknown";
    if (!acc[inst]) {
      acc[inst] = { accounts: [], itemId: account.itemId };
    }
    acc[inst].accounts.push(account);
    return acc;
  }, {} as Record<string, { accounts: Account[]; itemId?: string }>);

  // Calculate total balance
  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

  const dateRangeLabel = (days: number) => {
    switch (days) {
      case 30: return "30 days";
      case 90: return "90 days";
      case 180: return "6 months";
      case 365: return "1 year";
      default: return `${days} days`;
    }
  };

  return (
    <div className="space-y-4">
      {/* Accounts Card */}
      <Card>
        <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium text-neutral-500">
            Connected Accounts
          </CardTitle>
          <Select
            value={String(dateRange)}
            onValueChange={(v) => onDateRangeChange(Number(v))}
          >
            <SelectTrigger className="w-24 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="180">6 months</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Syncing State */}
          {syncStatus === "syncing" && (
            <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Syncing your accounts...</span>
            </div>
          )}

          {/* Grouped Accounts */}
          {syncStatus !== "syncing" && Object.keys(accountsByInstitution).length > 0 ? (
            <>
              {Object.entries(accountsByInstitution).map(([institution, data]) => (
                <div key={institution} className="space-y-2">
                  {/* Institution Header */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{institution}</span>
                    <button
                      onClick={() => onDisconnect(data.itemId)}
                      className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  {/* Accounts under this institution */}
                  <div className="pl-3 space-y-1 border-l-2 border-neutral-100">
                    {data.accounts.map((account) => (
                      <div key={account.id} className="flex justify-between items-center text-sm">
                        <div>
                          <div className="text-neutral-700">{account.name}</div>
                          <div className="text-xs text-neutral-400 capitalize">
                            {account.type} {account.subtype && `· ${account.subtype}`}
                          </div>
                        </div>
                        <div className="font-mono text-sm">
                          {account.balance !== null ? formatCurrency(account.balance) : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Total */}
              <div className="pt-3 border-t flex justify-between items-center">
                <span className="text-sm font-medium">Total</span>
                <span className="font-mono font-medium">
                  {formatCurrency(totalBalance)}
                </span>
              </div>
            </>
          ) : syncStatus !== "syncing" ? (
            <p className="text-sm text-neutral-500">No accounts connected</p>
          ) : null}

          {/* Add Another Bank Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onAddBank}
            className="w-full mt-2"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Another Bank
          </Button>
        </CardContent>
      </Card>

      {/* Spending Summary Card */}
      {snapshot && snapshot.totalSpending > 0 && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-neutral-500">
              {dateRangeLabel(dateRange)} Summary
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
    </div>
  );
}
