import type { Transaction, FinancialSnapshot, CategoryBreakdown, TopMerchant, RecurringCharge } from "@/types";

// Essential categories (non-discretionary)
const ESSENTIAL_CATEGORIES = new Set([
  "RENT_AND_UTILITIES",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "INCOME",
]);

// Subscription-like categories
const SUBSCRIPTION_CATEGORIES = new Set([
  "ENTERTAINMENT",
  "GENERAL_SERVICES",
]);

export function analyzeTransactions(transactions: Transaction[]): FinancialSnapshot {
  if (transactions.length === 0) {
    return getEmptySnapshot();
  }

  // Filter to only spending (positive amounts in Plaid = money out)
  const spending = transactions.filter((t) => t.amount > 0 && !t.pending);

  // Calculate date range
  const dates = spending.map((t) => new Date(t.date).getTime());
  const startDate = new Date(Math.min(...dates));
  const endDate = new Date(Math.max(...dates));
  const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  // Total spending
  const totalSpending = spending.reduce((sum, t) => sum + t.amount, 0);
  const averageDailySpend = totalSpending / daysDiff;
  const weeklyVelocity = averageDailySpend * 7;

  // Category breakdown
  const categoryMap = new Map<string, { amount: number; count: number }>();
  for (const t of spending) {
    const existing = categoryMap.get(t.category) || { amount: 0, count: 0 };
    categoryMap.set(t.category, {
      amount: existing.amount + t.amount,
      count: existing.count + 1,
    });
  }

  const categoryBreakdown: CategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category: formatCategory(category),
      amount: data.amount,
      percentage: (data.amount / totalSpending) * 100,
      transactionCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Top merchants
  const merchantMap = new Map<string, { amount: number; count: number }>();
  for (const t of spending) {
    const name = t.name.toLowerCase();
    const existing = merchantMap.get(name) || { amount: 0, count: 0 };
    merchantMap.set(name, {
      amount: existing.amount + t.amount,
      count: existing.count + 1,
    });
  }

  const topMerchants: TopMerchant[] = Array.from(merchantMap.entries())
    .map(([name, data]) => ({
      name: capitalizeWords(name),
      totalSpent: data.amount,
      transactionCount: data.count,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // Detect recurring charges (same merchant, similar amount, multiple occurrences)
  const recurringCharges = detectRecurringCharges(spending);

  // Calculate discretionary ratio
  const essentialSpending = spending
    .filter((t) => ESSENTIAL_CATEGORIES.has(t.category))
    .reduce((sum, t) => sum + t.amount, 0);
  const discretionaryRatio = totalSpending > 0
    ? ((totalSpending - essentialSpending) / totalSpending) * 100
    : 0;

  // Calculate subscription load
  const subscriptionSpending = spending
    .filter((t) => SUBSCRIPTION_CATEGORIES.has(t.category))
    .reduce((sum, t) => sum + t.amount, 0);
  const subscriptionLoad = subscriptionSpending;

  return {
    totalSpending,
    averageDailySpend,
    weeklyVelocity,
    categoryBreakdown,
    topMerchants,
    recurringCharges,
    discretionaryRatio,
    subscriptionLoad,
    dateRange: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
      days: daysDiff,
    },
  };
}

function detectRecurringCharges(transactions: Transaction[]): RecurringCharge[] {
  // Group by merchant and approximate amount
  const groups = new Map<string, Transaction[]>();

  for (const t of transactions) {
    const key = `${t.name.toLowerCase()}_${Math.round(t.amount)}`;
    const existing = groups.get(key) || [];
    groups.set(key, [...existing, t]);
  }

  const recurring: RecurringCharge[] = [];

  for (const [, group] of groups) {
    if (group.length >= 2) {
      // Check if transactions are roughly evenly spaced
      const dates = group.map((t) => new Date(t.date).getTime()).sort();
      const gaps = dates.slice(1).map((d, i) => d - dates[i]);
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const avgGapDays = avgGap / (1000 * 60 * 60 * 24);

      // Determine frequency
      let frequency = "unknown";
      let annualMultiplier = 1;

      if (avgGapDays >= 25 && avgGapDays <= 35) {
        frequency = "monthly";
        annualMultiplier = 12;
      } else if (avgGapDays >= 6 && avgGapDays <= 8) {
        frequency = "weekly";
        annualMultiplier = 52;
      } else if (avgGapDays >= 13 && avgGapDays <= 16) {
        frequency = "bi-weekly";
        annualMultiplier = 26;
      } else if (avgGapDays >= 355 && avgGapDays <= 375) {
        frequency = "yearly";
        annualMultiplier = 1;
      }

      if (frequency !== "unknown") {
        const avgAmount = group.reduce((sum, t) => sum + t.amount, 0) / group.length;
        recurring.push({
          merchant: capitalizeWords(group[0].name.toLowerCase()),
          amount: avgAmount,
          frequency,
          annualImpact: avgAmount * annualMultiplier,
        });
      }
    }
  }

  return recurring.sort((a, b) => b.annualImpact - a.annualImpact);
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function capitalizeWords(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getEmptySnapshot(): FinancialSnapshot {
  return {
    totalSpending: 0,
    averageDailySpend: 0,
    weeklyVelocity: 0,
    categoryBreakdown: [],
    topMerchants: [],
    recurringCharges: [],
    discretionaryRatio: 0,
    subscriptionLoad: 0,
    dateRange: {
      start: new Date().toISOString().split("T")[0],
      end: new Date().toISOString().split("T")[0],
      days: 0,
    },
  };
}
