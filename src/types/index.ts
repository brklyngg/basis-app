export interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  pending: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  balance: number | null;
  institution: string | null;
}

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
  errors?: PlaidItemError[];
  hasReauthRequired?: boolean;
}
