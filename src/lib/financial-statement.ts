import type {
  Account,
  Transaction,
  ClassifiedTransaction,
  MonthlyFinancials,
  FinancialStatement,
} from "@/types";
import { classifyAllTransactions, getCashFlowTransactions } from "./transaction-classifier";

// Map Plaid categories to financial statement categories
const CATEGORY_MAP: Record<string, { bucket: "income" | "essential" | "discretionary"; subcategory: string }> = {
  // Income
  "INCOME": { bucket: "income", subcategory: "salary" },

  // Essential expenses
  "RENT_AND_UTILITIES": { bucket: "essential", subcategory: "housing" },
  "HOME_IMPROVEMENT": { bucket: "essential", subcategory: "housing" },
  "MEDICAL": { bucket: "essential", subcategory: "medical" },
  "INSURANCE": { bucket: "essential", subcategory: "insurance" },
  "LOAN_PAYMENTS": { bucket: "essential", subcategory: "debtService" },
  "BANK_FEES": { bucket: "essential", subcategory: "debtService" },
  "GROCERIES": { bucket: "essential", subcategory: "groceries" },
  "GAS_STATIONS": { bucket: "essential", subcategory: "transportation" },
  "AUTOMOTIVE": { bucket: "essential", subcategory: "transportation" },
  "GOVERNMENT_AND_NON_PROFIT": { bucket: "essential", subcategory: "other" },

  // Discretionary expenses
  "FOOD_AND_DRINK": { bucket: "discretionary", subcategory: "diningOut" },
  "ENTERTAINMENT": { bucket: "discretionary", subcategory: "entertainment" },
  "GENERAL_MERCHANDISE": { bucket: "discretionary", subcategory: "shopping" },
  "GENERAL_SERVICES": { bucket: "discretionary", subcategory: "subscriptions" },
  "TRAVEL": { bucket: "discretionary", subcategory: "travel" },
  "TRANSPORTATION": { bucket: "discretionary", subcategory: "transportation" },
  "RECREATION": { bucket: "discretionary", subcategory: "entertainment" },
  "PERSONAL_CARE": { bucket: "discretionary", subcategory: "other" },
};

/**
 * Create an empty MonthlyFinancials object
 */
function createEmptyMonth(month: string): MonthlyFinancials {
  return {
    month,
    income: { salary: 0, investment: 0, other: 0, total: 0 },
    expenses: {
      essential: {
        housing: 0,
        utilities: 0,
        transportation: 0,
        groceries: 0,
        insurance: 0,
        medical: 0,
        debtService: 0,
        total: 0,
      },
      discretionary: {
        diningOut: 0,
        entertainment: 0,
        shopping: 0,
        travel: 0,
        subscriptions: 0,
        other: 0,
        total: 0,
      },
      total: 0,
    },
    transfers: { internal: 0, creditCardPayments: 0 },
    netCashFlow: 0,
    savingsRate: 0,
  };
}

/**
 * Get month key from date string (YYYY-MM format)
 */
function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // "2025-01-15" -> "2025-01"
}

/**
 * Generate all month keys between start and end dates
 */
function generateMonthRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const start = new Date(startDate + "-01");
  const end = new Date(endDate + "-01");

  const current = new Date(start);
  while (current <= end) {
    months.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`
    );
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

/**
 * Build a financial statement from transactions
 */
export function buildFinancialStatement(
  transactions: Transaction[],
  accounts: Account[],
  startDate?: string,
  endDate?: string
): FinancialStatement {
  // Classify all transactions
  const classified = classifyAllTransactions(transactions, accounts);

  // Determine date range
  const dates = transactions.map((t) => t.date).sort();
  const actualStart = startDate || (dates[0] ? getMonthKey(dates[0]) : getMonthKey(new Date().toISOString()));
  const actualEnd = endDate || (dates[dates.length - 1] ? getMonthKey(dates[dates.length - 1]) : getMonthKey(new Date().toISOString()));

  // Generate all months in range
  const monthKeys = generateMonthRange(actualStart, actualEnd);

  // Initialize monthly data
  const monthlyData = new Map<string, MonthlyFinancials>();
  for (const month of monthKeys) {
    monthlyData.set(month, createEmptyMonth(month));
  }

  // Track detailed categories
  const detailedCategoryTotals = new Map<string, Map<string, number>>();

  // Process each classified transaction
  for (const t of classified) {
    const monthKey = getMonthKey(t.date);
    const monthData = monthlyData.get(monthKey);

    if (!monthData) continue; // Outside date range

    // Track detailed category
    if (!detailedCategoryTotals.has(t.category)) {
      detailedCategoryTotals.set(t.category, new Map());
    }
    const categoryMonths = detailedCategoryTotals.get(t.category)!;
    categoryMonths.set(monthKey, (categoryMonths.get(monthKey) || 0) + Math.abs(t.amount));

    // Handle based on classification
    switch (t.classification) {
      case "income":
        // Determine income subcategory
        if (t.category === "INCOME") {
          monthData.income.salary += Math.abs(t.amount);
        } else if (t.name.toLowerCase().includes("interest") || t.name.toLowerCase().includes("dividend")) {
          monthData.income.investment += Math.abs(t.amount);
        } else {
          monthData.income.other += Math.abs(t.amount);
        }
        monthData.income.total += Math.abs(t.amount);
        break;

      case "expense_essential": {
        const mapping = CATEGORY_MAP[t.category];
        const subcategory = mapping?.subcategory || "other";

        // Add to the appropriate essential subcategory
        if (subcategory in monthData.expenses.essential) {
          (monthData.expenses.essential as Record<string, number>)[subcategory] += t.amount;
        }
        monthData.expenses.essential.total += t.amount;
        monthData.expenses.total += t.amount;
        break;
      }

      case "expense_discretionary": {
        const mapping = CATEGORY_MAP[t.category];
        const subcategory = mapping?.subcategory || "other";

        // Add to the appropriate discretionary subcategory
        if (subcategory in monthData.expenses.discretionary) {
          (monthData.expenses.discretionary as Record<string, number>)[subcategory] += t.amount;
        } else {
          monthData.expenses.discretionary.other += t.amount;
        }
        monthData.expenses.discretionary.total += t.amount;
        monthData.expenses.total += t.amount;
        break;
      }

      case "internal_transfer":
        monthData.transfers.internal += Math.abs(t.amount);
        break;

      case "credit_card_payment":
        monthData.transfers.creditCardPayments += Math.abs(t.amount);
        break;

      case "excluded":
        // Skip excluded transactions
        break;
    }
  }

  // Calculate net cash flow and savings rate for each month
  for (const monthData of monthlyData.values()) {
    monthData.netCashFlow = monthData.income.total - monthData.expenses.total;
    monthData.savingsRate = monthData.income.total > 0
      ? (monthData.netCashFlow / monthData.income.total) * 100
      : 0;
  }

  // Build months array sorted chronologically
  const months = Array.from(monthlyData.values()).sort(
    (a, b) => a.month.localeCompare(b.month)
  );

  // Calculate summary
  const monthCount = months.length || 1;
  const totalIncome = months.reduce((sum, m) => sum + m.income.total, 0);
  const totalExpenses = months.reduce((sum, m) => sum + m.expenses.total, 0);
  const totalNetSavings = months.reduce((sum, m) => sum + m.netCashFlow, 0);

  // Build detailed categories array
  const detailedCategories = Array.from(detailedCategoryTotals.entries())
    .map(([category, monthTotals]) => {
      const monthlyTotals: Record<string, number> = {};
      let total = 0;

      for (const [month, amount] of monthTotals) {
        monthlyTotals[month] = amount;
        total += amount;
      }

      return {
        category,
        monthlyTotals,
        total,
        average: total / monthCount,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    months,
    dateRange: {
      start: actualStart,
      end: actualEnd,
    },
    summary: {
      averageMonthlyIncome: totalIncome / monthCount,
      averageMonthlyExpenses: totalExpenses / monthCount,
      averageSavingsRate: totalIncome > 0 ? (totalNetSavings / totalIncome) * 100 : 0,
      totalNetSavings,
    },
    detailedCategories,
  };
}

/**
 * Format month key for display (e.g., "2025-01" -> "Jan 2025")
 */
export function formatMonthDisplay(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * Get date range presets
 */
export function getDateRangePresets(): { label: string; months: number }[] {
  return [
    { label: "Last 3 months", months: 3 },
    { label: "Last 6 months", months: 6 },
    { label: "Last 12 months", months: 12 },
    { label: "All time", months: 0 },
  ];
}

/**
 * Calculate date range from preset
 */
export function calculateDateRange(
  preset: number,
  transactions: Transaction[]
): { start: string; end: string } {
  const now = new Date();
  const endMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (preset === 0) {
    // All time - find earliest transaction
    const dates = transactions.map((t) => t.date).sort();
    const startMonth = dates[0] ? getMonthKey(dates[0]) : endMonth;
    return { start: startMonth, end: endMonth };
  }

  // Calculate start month
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - preset + 1);
  const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;

  return { start: startMonth, end: endMonth };
}
