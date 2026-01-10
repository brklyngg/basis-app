import type {
  Transaction,
  Account,
  FinancialMetrics,
  TrendMetrics,
  TrendDirection,
  MonthlyCashFlow,
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

/**
 * Calculate monthly cash flows from transactions
 *
 * Groups transactions by month and calculates income, expenses, and net cash flow
 * for each month. Returns sorted by month ascending.
 */
function calculateMonthlyCashFlows(
  transactions: Transaction[],
  accounts: Account[]
): MonthlyCashFlow[] {
  // Classify all transactions
  const classified = classifyAllTransactions(transactions, accounts);

  // Get only cash flow relevant transactions (excludes transfers and CC payments)
  const cashFlowTransactions = getCashFlowTransactions(classified);

  // Group by month
  const monthlyMap = new Map<string, { income: number; expenses: number }>();

  for (const t of cashFlowTransactions) {
    const month = getMonthKey(t.date);
    const current = monthlyMap.get(month) || { income: 0, expenses: 0 };

    if (t.classification === "income") {
      current.income += Math.abs(t.amount);
    } else if (
      t.classification === "expense_essential" ||
      t.classification === "expense_discretionary"
    ) {
      current.expenses += t.amount;
    }

    monthlyMap.set(month, current);
  }

  // Convert to array and sort by month ascending
  const monthlyData: MonthlyCashFlow[] = [];
  for (const [month, data] of monthlyMap) {
    monthlyData.push({
      month,
      income: data.income,
      expenses: data.expenses,
      netCashFlow: data.income - data.expenses,
    });
  }

  monthlyData.sort((a, b) => a.month.localeCompare(b.month));

  return monthlyData;
}

/**
 * Determine trend direction based on percentage change
 *
 * - improving: >5% increase in net cash flow
 * - declining: >5% decrease in net cash flow
 * - stable: within +/- 5%
 */
function determineTrendDirection(percentageChange: number): TrendDirection {
  const STABILITY_THRESHOLD = 5; // 5% threshold

  if (percentageChange > STABILITY_THRESHOLD) {
    return "improving";
  } else if (percentageChange < -STABILITY_THRESHOLD) {
    return "declining";
  }
  return "stable";
}

/**
 * Calculate 3-month moving average of net cash flow
 *
 * Takes the most recent 3 months of data and calculates the average.
 * If fewer than 3 months, averages what's available.
 */
function calculateThreeMonthMovingAverage(monthlyData: MonthlyCashFlow[]): number {
  if (monthlyData.length === 0) {
    return 0;
  }

  // Take up to the last 3 months
  const recentMonths = monthlyData.slice(-3);
  const sum = recentMonths.reduce((acc, m) => acc + m.netCashFlow, 0);
  return sum / recentMonths.length;
}

/**
 * Calculate trend metrics from transactions
 *
 * Analyzes month-over-month changes in net cash flow and determines
 * if finances are improving, stable, or declining.
 */
export function calculateTrendMetrics(
  transactions: Transaction[],
  accounts: Account[]
): TrendMetrics {
  const monthlyData = calculateMonthlyCashFlows(transactions, accounts);

  // Default values if insufficient data
  let momChangeAmount = 0;
  let momPercentageChange = 0;

  // Calculate month-over-month change if we have at least 2 months
  if (monthlyData.length >= 2) {
    const currentMonth = monthlyData[monthlyData.length - 1];
    const priorMonth = monthlyData[monthlyData.length - 2];

    momChangeAmount = currentMonth.netCashFlow - priorMonth.netCashFlow;

    // Calculate percentage change (avoid division by zero)
    if (priorMonth.netCashFlow !== 0) {
      momPercentageChange = (momChangeAmount / Math.abs(priorMonth.netCashFlow)) * 100;
    } else if (currentMonth.netCashFlow > 0) {
      // Prior was zero, current is positive = infinite improvement
      momPercentageChange = 100;
    } else if (currentMonth.netCashFlow < 0) {
      // Prior was zero, current is negative = infinite decline
      momPercentageChange = -100;
    }
    // If both are zero, percentage change stays 0
  }

  const threeMonthMovingAverage = calculateThreeMonthMovingAverage(monthlyData);
  const trendDirection = determineTrendDirection(momPercentageChange);

  return {
    trendDirection,
    momChange: {
      amount: momChangeAmount,
      percentageChange: momPercentageChange,
    },
    threeMonthMovingAverage,
    monthlyData,
  };
}
