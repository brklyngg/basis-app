import type {
  Transaction,
  Account,
  TransactionClassification,
  ClassifiedTransaction,
} from "@/types";

// Essential expense categories (non-discretionary)
const ESSENTIAL_CATEGORIES = new Set([
  "RENT_AND_UTILITIES",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "GOVERNMENT_AND_NON_PROFIT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "INSURANCE",
  "AUTOMOTIVE",
  "GAS_STATIONS",
  "GROCERIES",
]);

// Income categories
const INCOME_CATEGORIES = new Set([
  "INCOME",
  "TRANSFER_IN",
]);

// Transfer-related categories
const TRANSFER_CATEGORIES = new Set([
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

// Keywords that indicate credit card payments
const CC_PAYMENT_KEYWORDS = [
  "payment",
  "autopay",
  "credit card",
  "card payment",
  "bill pay",
  "minimum payment",
  "statement balance",
];

/**
 * Classify a single transaction based on its properties and context
 */
export function classifyTransaction(
  transaction: Transaction,
  accounts: Account[],
  allTransactions: Transaction[]
): TransactionClassification {
  // Skip pending transactions
  if (transaction.pending) {
    return "excluded";
  }

  // Check for income (negative amount in Plaid = money coming in)
  if (transaction.amount < 0) {
    return "income";
  }

  // Check if this is an internal transfer
  if (isInternalTransfer(transaction, accounts, allTransactions)) {
    return "internal_transfer";
  }

  // Check if this is a credit card payment
  if (isCreditCardPayment(transaction, accounts)) {
    return "credit_card_payment";
  }

  // Check income categories (some income shows as positive in certain contexts)
  if (INCOME_CATEGORIES.has(transaction.category)) {
    // TRANSFER_IN with positive amount that's not matched internally could be external income
    if (transaction.category === "TRANSFER_IN" && transaction.amount > 0) {
      return "income";
    }
    return "income";
  }

  // Classify as essential or discretionary expense
  if (ESSENTIAL_CATEGORIES.has(transaction.category)) {
    return "expense_essential";
  }

  return "expense_discretionary";
}

/**
 * Detect if a transaction is an internal transfer between user's own accounts
 */
function isInternalTransfer(
  transaction: Transaction,
  accounts: Account[],
  allTransactions: Transaction[]
): boolean {
  // Check if transaction code indicates a transfer
  if (transaction.transactionCode !== "transfer") {
    // Also check category as fallback
    if (!TRANSFER_CATEGORIES.has(transaction.category)) {
      return false;
    }
  }

  // Look for a matching opposite transaction in another account
  const transactionDate = new Date(transaction.date);
  const matchWindow = 3; // days

  for (const other of allTransactions) {
    // Skip same transaction
    if (other.id === transaction.id) continue;

    // Must be from a different account
    if (other.accountId === transaction.accountId) continue;

    // Amount should be opposite (one positive, one negative) and roughly equal
    const amountsMatch = Math.abs(Math.abs(other.amount) - Math.abs(transaction.amount)) < 1;
    const oppositeSigns = (other.amount > 0) !== (transaction.amount > 0);

    if (!amountsMatch) continue;

    // Check if dates are within window
    const otherDate = new Date(other.date);
    const daysDiff = Math.abs(transactionDate.getTime() - otherDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff <= matchWindow) {
      // Also check if the other transaction is a transfer
      if (other.transactionCode === "transfer" || TRANSFER_CATEGORIES.has(other.category)) {
        return true;
      }
    }
  }

  // Check payee/payer info for internal account references
  if (transaction.paymentMeta) {
    const payee = transaction.paymentMeta.payee?.toLowerCase() || "";
    const payer = transaction.paymentMeta.payer?.toLowerCase() || "";

    // Check if payee/payer matches any of user's account names
    for (const account of accounts) {
      const accountName = account.name.toLowerCase();
      const institution = account.institution?.toLowerCase() || "";

      if (
        payee.includes(accountName) ||
        payer.includes(accountName) ||
        (institution && (payee.includes(institution) || payer.includes(institution)))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect if a transaction is a credit card payment from a depository account
 */
function isCreditCardPayment(
  transaction: Transaction,
  accounts: Account[]
): boolean {
  // Get the account this transaction is from
  const sourceAccount = accounts.find((a) => a.id === transaction.accountId);

  // If source is a credit card and transaction is a payment (negative = credit to the card)
  if (sourceAccount?.type === "credit") {
    // Payments to credit cards show as negative amounts (reducing the balance)
    if (transaction.amount < 0) {
      // Check if it looks like a payment
      const nameLower = transaction.name.toLowerCase();
      if (
        transaction.transactionCode === "bill_payment" ||
        CC_PAYMENT_KEYWORDS.some((kw) => nameLower.includes(kw))
      ) {
        return true;
      }
    }
  }

  // If source is a depository account, check if paying a credit card
  if (sourceAccount?.type === "depository") {
    const nameLower = transaction.name.toLowerCase();

    // Check transaction code
    if (transaction.transactionCode === "bill_payment") {
      // Check if payee is a credit card company or matches user's CC
      const creditCardAccounts = accounts.filter((a) => a.type === "credit");

      for (const cc of creditCardAccounts) {
        const ccName = cc.name.toLowerCase();
        const ccInstitution = cc.institution?.toLowerCase() || "";

        if (
          nameLower.includes(ccName) ||
          (ccInstitution && nameLower.includes(ccInstitution)) ||
          (transaction.paymentMeta?.payee?.toLowerCase().includes(ccName))
        ) {
          return true;
        }
      }
    }

    // Check for common credit card payment patterns
    if (CC_PAYMENT_KEYWORDS.some((kw) => nameLower.includes(kw))) {
      // Verify this isn't just any bill - should reference a credit card
      const creditCardCompanies = [
        "chase",
        "amex",
        "american express",
        "citi",
        "capital one",
        "discover",
        "wells fargo",
        "bank of america",
        "barclays",
        "synchrony",
        "apple card",
        "goldman sachs",
      ];

      if (creditCardCompanies.some((cc) => nameLower.includes(cc))) {
        return true;
      }

      // Check against user's actual credit card accounts
      const creditCardAccounts = accounts.filter((a) => a.type === "credit");
      for (const cc of creditCardAccounts) {
        const ccInstitution = cc.institution?.toLowerCase() || "";
        if (ccInstitution && nameLower.includes(ccInstitution)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Classify all transactions and return with classifications
 */
export function classifyAllTransactions(
  transactions: Transaction[],
  accounts: Account[]
): ClassifiedTransaction[] {
  return transactions.map((transaction) => ({
    ...transaction,
    classification: classifyTransaction(transaction, accounts, transactions),
  }));
}

/**
 * Get summary counts of classifications
 */
export function getClassificationSummary(
  classified: ClassifiedTransaction[]
): Record<TransactionClassification, { count: number; total: number }> {
  const summary: Record<TransactionClassification, { count: number; total: number }> = {
    income: { count: 0, total: 0 },
    expense_essential: { count: 0, total: 0 },
    expense_discretionary: { count: 0, total: 0 },
    internal_transfer: { count: 0, total: 0 },
    credit_card_payment: { count: 0, total: 0 },
    excluded: { count: 0, total: 0 },
  };

  for (const t of classified) {
    summary[t.classification].count++;
    summary[t.classification].total += Math.abs(t.amount);
  }

  return summary;
}

/**
 * Filter transactions to only include those that should be counted in cash flow
 * (excludes internal transfers and credit card payments)
 */
export function getCashFlowTransactions(
  classified: ClassifiedTransaction[]
): ClassifiedTransaction[] {
  return classified.filter(
    (t) =>
      t.classification !== "internal_transfer" &&
      t.classification !== "credit_card_payment" &&
      t.classification !== "excluded"
  );
}
