import { describe, it, expect } from "vitest";
import { calculateCoreMetrics } from "../financial-metrics";
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
