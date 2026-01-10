import type {
  Transaction,
  Account,
  FinancialMetrics,
  TrendMetrics,
  TrendDirection,
  MonthlyCashFlow,
  CategoryBreakdownItem,
  CategoryBreakdownResult,
  BalanceSheet,
  BalanceSheetAccount,
  BalanceSheetAccountGroup,
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

/**
 * Calculate spending by category for a specific month
 *
 * Returns a map of category -> total spend for that month
 */
function calculateMonthlySpendByCategory(
  transactions: Transaction[],
  accounts: Account[],
  month: string
): Map<string, number> {
  const classified = classifyAllTransactions(transactions, accounts);
  const cashFlowTransactions = getCashFlowTransactions(classified);

  const categorySpend = new Map<string, number>();

  for (const t of cashFlowTransactions) {
    const txMonth = getMonthKey(t.date);
    if (txMonth !== month) continue;

    // Only count expenses (positive amounts, excluding income)
    if (t.classification === "expense_essential" || t.classification === "expense_discretionary") {
      const current = categorySpend.get(t.category) || 0;
      categorySpend.set(t.category, current + t.amount);
    }
  }

  return categorySpend;
}

/**
 * Calculate category breakdown with rankings
 *
 * Ranks categories by total spend descending, calculates percentages,
 * and computes month-over-month change for each category.
 */
export function calculateCategoryBreakdown(
  transactions: Transaction[],
  accounts: Account[]
): CategoryBreakdownResult {
  // Classify all transactions
  const classified = classifyAllTransactions(transactions, accounts);

  // Get only cash flow relevant transactions (excludes transfers and CC payments)
  const cashFlowTransactions = getCashFlowTransactions(classified);

  // Calculate totals for reference
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of cashFlowTransactions) {
    if (t.classification === "income") {
      totalIncome += Math.abs(t.amount);
    } else if (
      t.classification === "expense_essential" ||
      t.classification === "expense_discretionary"
    ) {
      totalExpenses += t.amount;
    }
  }

  // Get unique months
  const uniqueMonths = getUniqueMonths(transactions);
  const periodMonths = Math.max(1, uniqueMonths.size);

  // Aggregate spending by category
  const categorySpendMap = new Map<string, number>();

  for (const t of cashFlowTransactions) {
    // Only count expenses (positive amounts)
    if (t.classification === "expense_essential" || t.classification === "expense_discretionary") {
      const current = categorySpendMap.get(t.category) || 0;
      categorySpendMap.set(t.category, current + t.amount);
    }
  }

  // Get sorted months for MoM calculation
  const sortedMonths = Array.from(uniqueMonths).sort();
  const currentMonth = sortedMonths[sortedMonths.length - 1];
  // With only one month, MoM change should be 0 (no prior month to compare to)
  const priorMonth = sortedMonths.length >= 2 ? sortedMonths[sortedMonths.length - 2] : null;

  // Calculate monthly spend by category for MoM comparison
  const currentMonthSpend = currentMonth
    ? calculateMonthlySpendByCategory(transactions, accounts, currentMonth)
    : new Map<string, number>();
  // If no prior month, use an empty map (will result in current - 0, which we'll handle below)
  const priorMonthSpend = priorMonth
    ? calculateMonthlySpendByCategory(transactions, accounts, priorMonth)
    : new Map<string, number>();

  // Flag to determine if we have a valid MoM comparison
  const hasPriorMonth = priorMonth !== null;

  // Convert to array and sort by total spend descending
  const categories: CategoryBreakdownItem[] = [];

  for (const [category, totalSpend] of categorySpendMap) {
    const monthlyAverage = totalSpend / periodMonths;
    const percentOfExpenses = totalExpenses > 0 ? (totalSpend / totalExpenses) * 100 : 0;
    const percentOfIncome = totalIncome > 0 ? (totalSpend / totalIncome) * 100 : 0;

    // Calculate MoM change for this category
    // If there's no prior month (single month of data), MoM change is 0
    let momChangeAmount = 0;
    let momPercentageChange = 0;

    if (hasPriorMonth) {
      const currentSpend = currentMonthSpend.get(category) || 0;
      const priorSpend = priorMonthSpend.get(category) || 0;
      momChangeAmount = currentSpend - priorSpend;

      if (priorSpend !== 0) {
        momPercentageChange = (momChangeAmount / priorSpend) * 100;
      } else if (currentSpend > 0) {
        // No prior spend, current has spend = new category this month
        momPercentageChange = 100;
      }
      // If both are zero, percentage change stays 0
    }

    categories.push({
      rank: 0, // Will be set after sorting
      category,
      totalSpend,
      monthlyAverage,
      percentOfExpenses,
      percentOfIncome,
      momChange: {
        amount: momChangeAmount,
        percentageChange: momPercentageChange,
      },
    });
  }

  // Sort by total spend descending
  categories.sort((a, b) => b.totalSpend - a.totalSpend);

  // Assign ranks
  for (let i = 0; i < categories.length; i++) {
    categories[i].rank = i + 1;
  }

  // Get top 5
  const topCategories = categories.slice(0, 5);

  return {
    topCategories,
    allCategories: categories,
    totalExpenses,
    totalIncome,
    periodMonths,
  };
}

/**
 * Calculate balance sheet from connected accounts
 *
 * Creates a point-in-time snapshot of assets and liabilities:
 * - Liquid Assets: Sum of depository account balances (checking, savings)
 * - Credit Card Debt: Sum of credit card balances (as liabilities)
 * - Net Worth: Assets - Liabilities
 *
 * Note: Credit card balances from Plaid are typically positive numbers
 * representing what the user owes.
 */
export function calculateBalanceSheet(accounts: Account[]): BalanceSheet {
  // Separate accounts by type
  const depositoryAccounts: BalanceSheetAccount[] = [];
  const creditAccounts: BalanceSheetAccount[] = [];

  for (const account of accounts) {
    const bsAccount: BalanceSheetAccount = {
      id: account.id,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      balance: account.balance ?? 0,
      institution: account.institution,
    };

    if (account.type === "depository") {
      depositoryAccounts.push(bsAccount);
    } else if (account.type === "credit") {
      creditAccounts.push(bsAccount);
    }
    // Other account types (investment, loan, etc.) could be added later
  }

  // Calculate totals
  const totalLiquidAssets = depositoryAccounts.reduce(
    (sum, acc) => sum + acc.balance,
    0
  );
  const totalCreditCardDebt = creditAccounts.reduce(
    (sum, acc) => sum + acc.balance,
    0
  );

  // Build grouped structures
  const liquidAssets: BalanceSheetAccountGroup = {
    groupName: "Liquid Assets",
    accounts: depositoryAccounts,
    totalBalance: totalLiquidAssets,
  };

  const creditCardDebt: BalanceSheetAccountGroup = {
    groupName: "Credit Card Debt",
    accounts: creditAccounts,
    totalBalance: totalCreditCardDebt,
  };

  // Calculate net worth
  const totalAssets = totalLiquidAssets;
  const totalLiabilities = totalCreditCardDebt;
  const netWorth = totalAssets - totalLiabilities;

  return {
    assets: {
      liquidAssets,
      totalAssets,
    },
    liabilities: {
      creditCardDebt,
      totalLiabilities,
    },
    netWorth,
    asOfDate: new Date().toISOString(),
  };
}
