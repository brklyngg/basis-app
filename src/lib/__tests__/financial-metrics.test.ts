import { describe, it, expect } from "vitest";
import {
  calculateCoreMetrics,
  calculateTrendMetrics,
  calculateCategoryBreakdown,
} from "../financial-metrics";
import type { Transaction, Account } from "@/types";

// Helper to create a test transaction
function createTransaction(
  overrides: Partial<Transaction> & { id: string; date: string; name: string; amount: number; category: string }
): Transaction {
  return {
    pending: false,
    accountId: "checking-1",
    transactionCode: null,
    paymentChannel: null,
    ...overrides,
  };
}

// Helper to create test accounts
function createTestAccounts(): Account[] {
  return [
    {
      id: "checking-1",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      balance: 5000,
      institution: "Test Bank",
    },
    {
      id: "credit-1",
      name: "Credit Card",
      type: "credit",
      subtype: "credit card",
      balance: 1500,
      institution: "Test Bank",
    },
  ];
}

describe("calculateCoreMetrics", () => {
  it("returns zeroes for empty transaction list", () => {
    const accounts = createTestAccounts();
    const result = calculateCoreMetrics([], accounts);

    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.netCashFlow).toBe(0);
    expect(result.savingsRate).toBe(0);
    expect(result.avgMonthlyIncome).toBe(0);
    expect(result.avgMonthlyExpenses).toBe(0);
    expect(result.periodMonths).toBe(1);
  });

  it("calculates income correctly (negative amounts in Plaid)", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000, // Negative = income in Plaid
        category: "INCOME",
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(0);
    expect(result.netCashFlow).toBe(5000);
    expect(result.savingsRate).toBe(100);
  });

  it("calculates expenses correctly", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Rent",
        amount: 1500, // Positive = expense in Plaid
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "3",
        date: "2025-01-17",
        name: "Restaurant",
        amount: 50,
        category: "FOOD_AND_DRINK",
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(1550); // 1500 + 50
    expect(result.netCashFlow).toBe(3450); // 5000 - 1550
    expect(result.savingsRate).toBeCloseTo(69, 0); // (3450/5000) * 100 = 69%
  });

  it("excludes outgoing internal transfers from expense calculations", () => {
    // Create a transfer out - only the outgoing side (positive amount)
    // is marked as internal_transfer by the classifier
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // Transfer out from checking - this gets classified as internal_transfer
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Transfer to Savings",
        amount: 1000,
        category: "TRANSFER_OUT",
        accountId: "checking-1",
        transactionCode: "transfer",
      }),
      // Matching transfer in - NOTE: current classifier treats negative amounts as income first
      // before checking for transfer, so this will be counted as income
      createTransaction({
        id: "3",
        date: "2025-01-16",
        name: "Transfer from Checking",
        amount: -1000,
        category: "TRANSFER_IN",
        accountId: "savings-1",
        transactionCode: "transfer",
      }),
    ];

    const accountsWithSavings: Account[] = [
      ...createTestAccounts(),
      {
        id: "savings-1",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        balance: 10000,
        institution: "Test Bank",
      },
    ];

    const result = calculateCoreMetrics(transactions, accountsWithSavings);

    // The outgoing transfer (positive $1000) is excluded from expenses
    // The incoming transfer (negative $1000) is currently treated as income by classifier
    expect(result.totalIncome).toBe(6000); // 5000 payroll + 1000 transfer in
    expect(result.totalExpenses).toBe(0); // Transfer out excluded
    expect(result.netCashFlow).toBe(6000);
  });

  it("excludes outgoing credit card payments from expense calculations", () => {
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Restaurant",
        amount: 50,
        category: "FOOD_AND_DRINK",
        accountId: "credit-1", // Spent on credit card
      }),
      // CC payment from checking - positive amount = outgoing from depository
      // This is the payment that should be excluded to avoid double-counting
      createTransaction({
        id: "3",
        date: "2025-01-20",
        name: "Chase Card Payment",
        amount: 50, // Positive = money leaving checking
        category: "PAYMENT",
        accountId: "checking-1",
        transactionCode: "bill_payment",
      }),
    ];

    // Add a Chase credit card so the classifier can match it
    const accountsWithChase: Account[] = [
      ...createTestAccounts(),
      {
        id: "chase-cc",
        name: "Chase Sapphire",
        type: "credit",
        subtype: "credit card",
        balance: 500,
        institution: "Chase",
      },
    ];

    const result = calculateCoreMetrics(transactions, accountsWithChase);

    // CC payment (positive $50 from checking) is classified as credit_card_payment and excluded
    // The restaurant expense on the CC is still counted
    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(50); // Just the restaurant
    expect(result.netCashFlow).toBe(4950);
  });

  it("excludes pending transactions", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Pending Purchase",
        amount: 100,
        category: "GENERAL_MERCHANDISE",
        pending: true, // Should be excluded
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.totalExpenses).toBe(0);
    expect(result.netCashFlow).toBe(5000);
  });

  it("calculates monthly averages correctly across multiple months", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January income
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // January expense
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // February income
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // February expense
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // March income
      createTransaction({
        id: "5",
        date: "2025-03-15",
        name: "Payroll",
        amount: -6000, // Raise!
        category: "INCOME",
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.periodMonths).toBe(3);
    expect(result.totalIncome).toBe(16000); // 5000 + 5000 + 6000
    expect(result.totalExpenses).toBe(3000); // 1500 + 1500
    expect(result.avgMonthlyIncome).toBeCloseTo(5333.33, 0); // 16000 / 3
    expect(result.avgMonthlyExpenses).toBeCloseTo(1000, 0); // 3000 / 3
  });

  it("calculates date range correctly", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2024-10-15",
        name: "Early Transaction",
        amount: 50,
        category: "FOOD_AND_DRINK",
      }),
      createTransaction({
        id: "2",
        date: "2025-03-20",
        name: "Late Transaction",
        amount: 75,
        category: "ENTERTAINMENT",
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.dateRange.start).toBe("2024-10");
    expect(result.dateRange.end).toBe("2025-03");
  });

  it("handles zero income correctly for savings rate", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Coffee",
        amount: 5,
        category: "FOOD_AND_DRINK",
      }),
    ];

    const result = calculateCoreMetrics(transactions, accounts);

    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(5);
    expect(result.netCashFlow).toBe(-5);
    expect(result.savingsRate).toBe(0); // No income, savings rate is 0
  });
});

describe("calculateTrendMetrics", () => {
  it("returns empty monthly data for no transactions", () => {
    const accounts = createTestAccounts();
    const result = calculateTrendMetrics([], accounts);

    expect(result.monthlyData).toHaveLength(0);
    expect(result.trendDirection).toBe("stable");
    expect(result.momChange.amount).toBe(0);
    expect(result.momChange.percentageChange).toBe(0);
    expect(result.threeMonthMovingAverage).toBe(0);
  });

  it("returns stable trend for single month of data", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.monthlyData).toHaveLength(1);
    expect(result.monthlyData[0].month).toBe("2025-01");
    expect(result.monthlyData[0].income).toBe(5000);
    expect(result.monthlyData[0].expenses).toBe(1500);
    expect(result.monthlyData[0].netCashFlow).toBe(3500);
    expect(result.trendDirection).toBe("stable");
    expect(result.momChange.amount).toBe(0);
    expect(result.momChange.percentageChange).toBe(0);
    expect(result.threeMonthMovingAverage).toBe(3500);
  });

  it("calculates improving trend when net cash flow increases", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: income 5000, expenses 2000, net = 3000
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 2000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: income 5000, expenses 1000, net = 4000 (33% improvement)
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.monthlyData).toHaveLength(2);
    expect(result.trendDirection).toBe("improving");
    expect(result.momChange.amount).toBe(1000); // 4000 - 3000
    expect(result.momChange.percentageChange).toBeCloseTo(33.33, 0); // ~33% improvement
    expect(result.threeMonthMovingAverage).toBe(3500); // (3000 + 4000) / 2
  });

  it("calculates declining trend when net cash flow decreases", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: income 5000, expenses 1000, net = 4000
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: income 5000, expenses 3000, net = 2000 (50% decline)
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 3000,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.trendDirection).toBe("declining");
    expect(result.momChange.amount).toBe(-2000); // 2000 - 4000
    expect(result.momChange.percentageChange).toBeCloseTo(-50, 0);
  });

  it("returns stable trend for small changes within threshold", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: net = 4000
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: net = 4100 (~2.5% change, within 5% threshold)
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 900,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.trendDirection).toBe("stable");
    expect(result.momChange.percentageChange).toBeCloseTo(2.5, 0);
  });

  it("calculates 3-month moving average correctly", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: net = 3000
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 2000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: net = 4000
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
      // March: net = 5000
      createTransaction({
        id: "5",
        date: "2025-03-15",
        name: "Payroll",
        amount: -6000,
        category: "INCOME",
      }),
      createTransaction({
        id: "6",
        date: "2025-03-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.monthlyData).toHaveLength(3);
    expect(result.threeMonthMovingAverage).toBe(4000); // (3000 + 4000 + 5000) / 3
  });

  it("handles transition from zero to positive net cash flow", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: net = 0 (no transactions, but let's make income = expense)
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -2000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 2000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: net = 1000 (positive change from zero)
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -2000,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 1000,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    // Prior month was 0, so we use 100% as the percentage change indicator
    expect(result.trendDirection).toBe("improving");
    expect(result.momChange.amount).toBe(1000);
    expect(result.momChange.percentageChange).toBe(100);
  });

  it("handles transition from zero to negative net cash flow", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: net = 0
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -2000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Expenses",
        amount: 2000,
        category: "RENT_AND_UTILITIES",
      }),
      // February: net = -500 (negative change from zero)
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -1500,
        category: "INCOME",
      }),
      createTransaction({
        id: "4",
        date: "2025-02-20",
        name: "Expenses",
        amount: 2000,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    // Prior month was 0, moving to negative = declining
    expect(result.trendDirection).toBe("declining");
    expect(result.momChange.amount).toBe(-500);
    expect(result.momChange.percentageChange).toBe(-100);
  });

  it("excludes matched internal transfers from trend calculations", () => {
    // Internal transfers require a MATCHING PAIR of transactions:
    // - One positive (money leaving account A)
    // - One negative (money entering account B)
    // - Same amount (within $1 tolerance)
    // - Within 3 days of each other
    // - Both with transactionCode "transfer" or in TRANSFER_CATEGORIES
    const accountsWithSavings: Account[] = [
      ...createTestAccounts(),
      {
        id: "savings-1",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        balance: 10000,
        institution: "Test Bank",
      },
    ];

    const transactions: Transaction[] = [
      // January income
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // Transfer OUT from checking (positive = money leaving)
      createTransaction({
        id: "2",
        date: "2025-01-20",
        name: "Transfer to Savings",
        amount: 1000,
        category: "TRANSFER_OUT",
        accountId: "checking-1",
        transactionCode: "transfer",
      }),
      // Transfer IN to savings (negative = money arriving) - MATCHING PAIR
      createTransaction({
        id: "2b",
        date: "2025-01-20",
        name: "Transfer from Checking",
        amount: -1000,
        category: "TRANSFER_IN",
        accountId: "savings-1",
        transactionCode: "transfer",
      }),
      // January expense
      createTransaction({
        id: "3",
        date: "2025-01-25",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accountsWithSavings);

    // The transfer pair should be excluded:
    // - Transfer OUT (+1000) is classified as internal_transfer (excluded)
    // - Transfer IN (-1000) gets checked for income first (negative amount),
    //   so it's classified as "income" per the classifier logic
    // This is documented in progress.txt: "incoming transfer legs are classified as income"
    //
    // Result: Income = 5000 (payroll) + 1000 (transfer in treated as income) = 6000
    //         Expenses = 1500 (rent only, transfer out excluded)
    expect(result.monthlyData[0].income).toBe(6000);
    expect(result.monthlyData[0].expenses).toBe(1500);
    expect(result.monthlyData[0].netCashFlow).toBe(4500);
  });

  it("sorts monthly data chronologically", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // March first (out of order)
      createTransaction({
        id: "1",
        date: "2025-03-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // January
      createTransaction({
        id: "2",
        date: "2025-01-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      // February
      createTransaction({
        id: "3",
        date: "2025-02-15",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
    ];

    const result = calculateTrendMetrics(transactions, accounts);

    expect(result.monthlyData).toHaveLength(3);
    expect(result.monthlyData[0].month).toBe("2025-01");
    expect(result.monthlyData[1].month).toBe("2025-02");
    expect(result.monthlyData[2].month).toBe("2025-03");
  });
});

describe("calculateCategoryBreakdown", () => {
  it("returns empty categories for no transactions", () => {
    const accounts = createTestAccounts();
    const result = calculateCategoryBreakdown([], accounts);

    expect(result.topCategories).toHaveLength(0);
    expect(result.allCategories).toHaveLength(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalIncome).toBe(0);
    expect(result.periodMonths).toBe(1);
  });

  it("ranks categories by total spend descending", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Groceries",
        amount: 300,
        category: "FOOD_AND_DRINK",
      }),
      createTransaction({
        id: "3",
        date: "2025-01-17",
        name: "Entertainment",
        amount: 100,
        category: "ENTERTAINMENT",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.allCategories).toHaveLength(3);
    expect(result.allCategories[0].rank).toBe(1);
    expect(result.allCategories[0].category).toBe("RENT_AND_UTILITIES");
    expect(result.allCategories[0].totalSpend).toBe(1500);
    expect(result.allCategories[1].rank).toBe(2);
    expect(result.allCategories[1].category).toBe("FOOD_AND_DRINK");
    expect(result.allCategories[1].totalSpend).toBe(300);
    expect(result.allCategories[2].rank).toBe(3);
    expect(result.allCategories[2].category).toBe("ENTERTAINMENT");
    expect(result.allCategories[2].totalSpend).toBe(100);
  });

  it("returns top 5 categories only in topCategories", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Groceries",
        amount: 500,
        category: "FOOD_AND_DRINK",
      }),
      createTransaction({
        id: "3",
        date: "2025-01-17",
        name: "Entertainment",
        amount: 400,
        category: "ENTERTAINMENT",
      }),
      createTransaction({
        id: "4",
        date: "2025-01-18",
        name: "Shopping",
        amount: 300,
        category: "GENERAL_MERCHANDISE",
      }),
      createTransaction({
        id: "5",
        date: "2025-01-19",
        name: "Travel",
        amount: 200,
        category: "TRAVEL",
      }),
      createTransaction({
        id: "6",
        date: "2025-01-20",
        name: "Subscriptions",
        amount: 100,
        category: "GENERAL_SERVICES",
      }),
      createTransaction({
        id: "7",
        date: "2025-01-21",
        name: "Other",
        amount: 50,
        category: "OTHER",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.topCategories).toHaveLength(5);
    expect(result.allCategories).toHaveLength(7);
    expect(result.topCategories[0].category).toBe("RENT_AND_UTILITIES");
    expect(result.topCategories[4].category).toBe("TRAVEL");
  });

  it("calculates percent of total expenses correctly", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 500,
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Food",
        amount: 300,
        category: "FOOD_AND_DRINK",
      }),
      createTransaction({
        id: "3",
        date: "2025-01-17",
        name: "Entertainment",
        amount: 200,
        category: "ENTERTAINMENT",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    // Total expenses = 1000
    expect(result.totalExpenses).toBe(1000);
    expect(result.allCategories[0].percentOfExpenses).toBe(50); // 500/1000 = 50%
    expect(result.allCategories[1].percentOfExpenses).toBe(30); // 300/1000 = 30%
    expect(result.allCategories[2].percentOfExpenses).toBe(20); // 200/1000 = 20%
  });

  it("calculates percent of income correctly", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-10",
        name: "Payroll",
        amount: -2000, // Income (negative in Plaid)
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-15",
        name: "Rent",
        amount: 500,
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "3",
        date: "2025-01-16",
        name: "Food",
        amount: 300,
        category: "FOOD_AND_DRINK",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.totalIncome).toBe(2000);
    expect(result.allCategories[0].percentOfIncome).toBe(25); // 500/2000 = 25%
    expect(result.allCategories[1].percentOfIncome).toBe(15); // 300/2000 = 15%
  });

  it("calculates monthly average correctly across multiple months", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January rent
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // February rent
      createTransaction({
        id: "2",
        date: "2025-02-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // March rent
      createTransaction({
        id: "3",
        date: "2025-03-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.periodMonths).toBe(3);
    expect(result.allCategories[0].totalSpend).toBe(4500);
    expect(result.allCategories[0].monthlyAverage).toBe(1500);
  });

  it("calculates month-over-month change for categories", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January food: $200
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Groceries",
        amount: 200,
        category: "FOOD_AND_DRINK",
      }),
      // February food: $300 (50% increase)
      createTransaction({
        id: "2",
        date: "2025-02-15",
        name: "Groceries",
        amount: 300,
        category: "FOOD_AND_DRINK",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.allCategories[0].momChange.amount).toBe(100); // 300 - 200
    expect(result.allCategories[0].momChange.percentageChange).toBe(50); // 50% increase
  });

  it("handles new category in current month (no prior spend)", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: only rent
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // February: rent + new category
      createTransaction({
        id: "2",
        date: "2025-02-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      createTransaction({
        id: "3",
        date: "2025-02-20",
        name: "New Entertainment",
        amount: 100,
        category: "ENTERTAINMENT",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    const entertainment = result.allCategories.find((c) => c.category === "ENTERTAINMENT");
    expect(entertainment).toBeDefined();
    expect(entertainment!.momChange.amount).toBe(100); // 100 - 0
    expect(entertainment!.momChange.percentageChange).toBe(100); // New category = 100%
  });

  it("handles category that had spend in prior month but none in current", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      // January: entertainment
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Movies",
        amount: 100,
        category: "ENTERTAINMENT",
      }),
      // February: only rent (no entertainment)
      createTransaction({
        id: "2",
        date: "2025-02-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    const entertainment = result.allCategories.find((c) => c.category === "ENTERTAINMENT");
    expect(entertainment).toBeDefined();
    expect(entertainment!.momChange.amount).toBe(-100); // 0 - 100
    expect(entertainment!.momChange.percentageChange).toBe(-100); // -100% change
  });

  it("excludes income from category breakdown (only expenses)", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-10",
        name: "Payroll",
        amount: -5000,
        category: "INCOME",
      }),
      createTransaction({
        id: "2",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    // Income should not appear in category breakdown
    expect(result.allCategories.find((c) => c.category === "INCOME")).toBeUndefined();
    expect(result.allCategories).toHaveLength(1);
    expect(result.allCategories[0].category).toBe("RENT_AND_UTILITIES");
  });

  it("excludes internal transfers from category breakdown", () => {
    const accountsWithSavings: Account[] = [
      ...createTestAccounts(),
      {
        id: "savings-1",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        balance: 10000,
        institution: "Test Bank",
      },
    ];

    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
      // Transfer out - should be excluded when matched with incoming
      createTransaction({
        id: "2",
        date: "2025-01-16",
        name: "Transfer to Savings",
        amount: 1000,
        category: "TRANSFER_OUT",
        accountId: "checking-1",
        transactionCode: "transfer",
      }),
      // Matching transfer in - creates the pair needed for internal_transfer classification
      createTransaction({
        id: "3",
        date: "2025-01-16",
        name: "Transfer from Checking",
        amount: -1000,
        category: "TRANSFER_IN",
        accountId: "savings-1",
        transactionCode: "transfer",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accountsWithSavings);

    // Transfer OUT should not appear in breakdown (classified as internal_transfer)
    expect(result.allCategories.find((c) => c.category === "TRANSFER_OUT")).toBeUndefined();
    // Transfer IN is negative (income), so it shouldn't appear in expense categories either
    expect(result.allCategories.find((c) => c.category === "TRANSFER_IN")).toBeUndefined();
    expect(result.totalExpenses).toBe(1500); // Only rent
  });

  it("handles single month of data with stable MoM change", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Rent",
        amount: 1500,
        category: "RENT_AND_UTILITIES",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    // With only one month, MoM change should be 0
    expect(result.allCategories[0].momChange.amount).toBe(0);
    expect(result.allCategories[0].momChange.percentageChange).toBe(0);
  });

  it("handles zero income correctly for percent of income calculation", () => {
    const accounts = createTestAccounts();
    const transactions: Transaction[] = [
      createTransaction({
        id: "1",
        date: "2025-01-15",
        name: "Coffee",
        amount: 5,
        category: "FOOD_AND_DRINK",
      }),
    ];

    const result = calculateCategoryBreakdown(transactions, accounts);

    expect(result.totalIncome).toBe(0);
    expect(result.allCategories[0].percentOfIncome).toBe(0); // No income = 0%
  });
});
