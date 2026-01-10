export interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  pending: boolean;

  // Fields for transfer detection and classification
  accountId: string;
  transactionCode: string | null;  // "transfer", "bill_payment", "purchase", etc.
  paymentChannel: string | null;   // "online", "in store", "other"
  paymentMeta?: {
    payee: string | null;
    payer: string | null;
    paymentMethod: string | null;
  };
}

// Classification types for financial statement generation
export type TransactionClassification =
  | "income"
  | "expense_essential"
  | "expense_discretionary"
  | "internal_transfer"
  | "credit_card_payment"
  | "excluded";

export interface ClassifiedTransaction extends Transaction {
  classification: TransactionClassification;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  balance: number | null;
  institution: string | null;
  itemId?: string;
}

export type SyncStatus = "idle" | "syncing" | "ready" | "error";

export interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

export interface TopMerchant {
  name: string;
  totalSpent: number;
  transactionCount: number;
}

export interface RecurringCharge {
  merchant: string;
  amount: number;
  frequency: string;
  annualImpact: number;
}

export interface FinancialSnapshot {
  totalSpending: number;
  averageDailySpend: number;
  weeklyVelocity: number;
  categoryBreakdown: CategoryBreakdown[];
  topMerchants: TopMerchant[];
  recurringCharges: RecurringCharge[];
  discretionaryRatio: number;
  subscriptionLoad: number;
  dateRange: {
    start: string;
    end: string;
    days: number;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Database chat message (from Supabase)
export interface DbChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface PlaidItem {
  id: string;
  user_id: string;
  access_token: string;
  item_id: string;
  institution_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaidItemError {
  itemId?: string;
  institutionName: string | null;
  errorCode: string;
  errorMessage: string;
  requiresReauth: boolean;
  isTemporary: boolean;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  accounts: Account[];
  syncStatus: SyncStatus;
  errors?: PlaidItemError[];
  hasReauthRequired?: boolean;
}

// Financial Statement Types
export interface MonthlyFinancials {
  month: string;  // "2025-01", "2025-02", etc.

  income: {
    salary: number;
    investment: number;
    other: number;
    total: number;
  };

  expenses: {
    essential: {
      housing: number;
      utilities: number;
      transportation: number;
      groceries: number;
      insurance: number;
      medical: number;
      debtService: number;
      total: number;
    };
    discretionary: {
      diningOut: number;
      entertainment: number;
      shopping: number;
      travel: number;
      subscriptions: number;
      other: number;
      total: number;
    };
    total: number;
  };

  transfers: {
    internal: number;
    creditCardPayments: number;
  };

  netCashFlow: number;
  savingsRate: number;
}

export interface FinancialStatement {
  months: MonthlyFinancials[];
  dateRange: {
    start: string;
    end: string;
  };
  summary: {
    averageMonthlyIncome: number;
    averageMonthlyExpenses: number;
    averageSavingsRate: number;
    totalNetSavings: number;
  };
  // For detailed view - raw category totals by month
  detailedCategories: {
    category: string;
    monthlyTotals: Record<string, number>;  // month -> amount
    total: number;
    average: number;
  }[];
}

// Core financial metrics for dashboard display
export interface FinancialMetrics {
  // Totals for the period
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;

  // Derived ratios
  savingsRate: number; // percentage (0-100)

  // Averages
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;

  // Period info
  periodMonths: number;
  dateRange: {
    start: string;
    end: string;
  };
}

// Trend direction for financial metrics over time
export type TrendDirection = "improving" | "stable" | "declining";

// Monthly cash flow data for trend calculations
export interface MonthlyCashFlow {
  month: string; // YYYY-MM format
  income: number;
  expenses: number;
  netCashFlow: number;
}

// Trend metrics for analyzing financial trajectory
export interface TrendMetrics {
  // Direction of financial health
  trendDirection: TrendDirection;

  // Month-over-month change (most recent vs prior month)
  momChange: {
    amount: number; // absolute change in net cash flow
    percentageChange: number; // percentage change from prior period
  };

  // 3-month moving average of net cash flow
  threeMonthMovingAverage: number;

  // Monthly data for trend analysis
  monthlyData: MonthlyCashFlow[];
}

// Individual category breakdown item with ranking and trend data
export interface CategoryBreakdownItem {
  rank: number;
  category: string;
  totalSpend: number;
  monthlyAverage: number;
  percentOfExpenses: number; // percentage of total expenses
  percentOfIncome: number; // percentage of total income
  momChange: {
    amount: number; // change in spend vs prior month
    percentageChange: number; // percentage change from prior month
  };
}

// Result of category breakdown analysis
export interface CategoryBreakdownResult {
  // Top 5 categories by spend
  topCategories: CategoryBreakdownItem[];
  // All categories for reference
  allCategories: CategoryBreakdownItem[];
  // Summary stats
  totalExpenses: number;
  totalIncome: number;
  periodMonths: number;
}
