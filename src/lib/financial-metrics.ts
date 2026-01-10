import type {
  Transaction,
  Account,
  FinancialMetrics,
} from "@/types";
import { classifyAllTransactions, getCashFlowTransactions } from "./transaction-classifier";

/**
 * Get month key from date string (YYYY-MM format)
 */
function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // "2025-01-15" -> "2025-01"
}

/**
 * Get unique months from transactions
 */
function getUniqueMonths(transactions: Transaction[]): Set<string> {
  const months = new Set<string>();
  for (const t of transactions) {
    months.add(getMonthKey(t.date));
  }
  return months;
}

/**
 * Calculate core financial metrics from transactions
 *
 * This excludes internal transfers and credit card payments from calculations
 * to provide an accurate picture of actual income and expenses.
 */
export function calculateCoreMetrics(
  transactions: Transaction[],
  accounts: Account[]
): FinancialMetrics {
  // Classify all transactions
  const classified = classifyAllTransactions(transactions, accounts);

  // Get only cash flow relevant transactions (excludes transfers and CC payments)
  const cashFlowTransactions = getCashFlowTransactions(classified);

  // Calculate totals
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of cashFlowTransactions) {
    if (t.classification === "income") {
      // Income is stored as negative in Plaid (money coming in)
      totalIncome += Math.abs(t.amount);
    } else if (
      t.classification === "expense_essential" ||
      t.classification === "expense_discretionary"
    ) {
      // Expenses are stored as positive in Plaid
      totalExpenses += t.amount;
    }
  }

  // Calculate net cash flow
  const netCashFlow = totalIncome - totalExpenses;

  // Calculate savings rate
  const savingsRate = totalIncome > 0 ? (netCashFlow / totalIncome) * 100 : 0;

  // Calculate period months
  const uniqueMonths = getUniqueMonths(transactions);
  const periodMonths = Math.max(1, uniqueMonths.size);

  // Calculate averages
  const avgMonthlyIncome = totalIncome / periodMonths;
  const avgMonthlyExpenses = totalExpenses / periodMonths;

  // Determine date range
  const dates = transactions.map((t) => t.date).sort();
  const startDate = dates[0] ? getMonthKey(dates[0]) : getMonthKey(new Date().toISOString());
  const endDate = dates[dates.length - 1]
    ? getMonthKey(dates[dates.length - 1])
    : getMonthKey(new Date().toISOString());

  return {
    totalIncome,
    totalExpenses,
    netCashFlow,
    savingsRate,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    periodMonths,
    dateRange: {
      start: startDate,
      end: endDate,
    },
  };
}
