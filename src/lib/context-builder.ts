import type { Transaction, FinancialSnapshot } from "@/types";

export function buildFinancialContext(
  transactions: Transaction[],
  snapshot: FinancialSnapshot | null
): string {
  if (!snapshot || transactions.length === 0) {
    return "No transaction data available yet.";
  }

  const parts: string[] = [];

  // Summary section
  parts.push("=== FINANCIAL SUMMARY ===");
  parts.push(`Period: ${snapshot.dateRange.start} to ${snapshot.dateRange.end} (${snapshot.dateRange.days} days)`);
  parts.push(`Total Spending: $${snapshot.totalSpending.toFixed(2)}`);
  parts.push(`Daily Average: $${snapshot.averageDailySpend.toFixed(2)}`);
  parts.push(`Weekly Velocity: $${snapshot.weeklyVelocity.toFixed(2)}`);
  parts.push(`Discretionary Ratio: ${snapshot.discretionaryRatio.toFixed(1)}%`);
  parts.push("");

  // Category breakdown (top 8)
  parts.push("=== SPENDING BY CATEGORY ===");
  for (const cat of snapshot.categoryBreakdown.slice(0, 8)) {
    parts.push(`${cat.category}: $${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%, ${cat.transactionCount} txns)`);
  }
  parts.push("");

  // Top merchants (top 8)
  parts.push("=== TOP MERCHANTS ===");
  for (const merchant of snapshot.topMerchants.slice(0, 8)) {
    parts.push(`${merchant.name}: $${merchant.totalSpent.toFixed(2)} (${merchant.transactionCount} txns)`);
  }
  parts.push("");

  // Recurring charges
  if (snapshot.recurringCharges.length > 0) {
    parts.push("=== DETECTED RECURRING CHARGES ===");
    for (const charge of snapshot.recurringCharges.slice(0, 6)) {
      parts.push(`${charge.merchant}: $${charge.amount.toFixed(2)}/${charge.frequency} (~$${charge.annualImpact.toFixed(0)}/year)`);
    }
    parts.push("");
  }

  // Recent transactions (last 50 in compact format)
  parts.push("=== RECENT TRANSACTIONS ===");
  const recentTxns = transactions.slice(0, 50);
  for (const t of recentTxns) {
    const sign = t.amount > 0 ? "-" : "+";
    parts.push(`${t.date}: ${t.name} ${sign}$${Math.abs(t.amount).toFixed(2)} (${formatCategory(t.category)})`);
  }

  return parts.join("\n");
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
