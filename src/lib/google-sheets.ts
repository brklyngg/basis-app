import { google, sheets_v4 } from "googleapis";
import type { FinancialStatement, MonthlyFinancials, ClassifiedTransaction, Account, BalanceSheet } from "@/types";
import { calculateBalanceSheet } from "./financial-metrics";
import { formatMonthDisplay } from "./financial-statement";

// Professional color palette for financial statements
const COLORS = {
  headerBg: { red: 0.15, green: 0.25, blue: 0.35 },      // Dark slate blue
  headerText: { red: 1, green: 1, blue: 1 },              // White
  sectionBg: { red: 0.95, green: 0.95, blue: 0.97 },      // Light gray
  positiveCashFlow: { red: 0.2, green: 0.5, blue: 0.2 },  // Green
  negativeCashFlow: { red: 0.7, green: 0.2, blue: 0.2 },  // Red
  totalRowBg: { red: 0.9, green: 0.92, blue: 0.95 },      // Subtle highlight
  borderColor: { red: 0.8, green: 0.8, blue: 0.8 },       // Light gray
  lightBorder: { red: 0.9, green: 0.9, blue: 0.9 },       // Very light gray
};

// Financial Analyst Standard Color Coding (per CLAUDE.md)
// - Blue text: Hard-coded inputs, historical data
// - Black text: Formulas referencing same sheet
// - Green text: Cross-sheet references
// - Red text: Errors, warnings, external links
const FINANCIAL_COLORS = {
  // Text colors (financial analyst standard)
  inputBlue: { red: 0, green: 0, blue: 1 },           // Hard-coded inputs
  formulaBlack: { red: 0, green: 0, blue: 0 },        // Same-sheet formulas
  crossRefGreen: { red: 0, green: 0.5, blue: 0 },     // Cross-sheet references
  errorRed: { red: 1, green: 0, blue: 0 },            // Errors/external links

  // Background colors for Dashboard
  dashboardHeaderBg: { red: 0.18, green: 0.24, blue: 0.30 }, // #2F3D4C
  sectionHeaderBg: { red: 0.25, green: 0.32, blue: 0.40 },   // Slightly lighter slate
  positiveGreenBg: { red: 0.85, green: 0.95, blue: 0.85 },   // Light green for positive
  negativeRedBg: { red: 0.95, green: 0.85, blue: 0.85 },     // Light red for negative
  neutralGrayBg: { red: 0.96, green: 0.96, blue: 0.96 },     // Very light gray for data rows
};

// Dashboard section row indices (for formatting reference)
interface DashboardLayout {
  titleRow: number;
  bigPictureHeaderRow: number;
  bigPictureStartRow: number;
  bigPictureEndRow: number;
  keyRatiosHeaderRow: number;
  keyRatiosStartRow: number;
  keyRatiosEndRow: number;
  spendingHeaderRow: number;
  spendingStartRow: number;
  spendingEndRow: number;
  insightsHeaderRow: number;
  insightsStartRow: number;
  insightsEndRow: number;
  totalRows: number;
}

/**
 * Find row indices in Detailed Categories sheet for spending breakdown
 * Returns top 7 categories sorted by total spend descending
 */
function findTopSpendingCategories(statement: FinancialStatement): {
  categories: {
    name: string;
    detailedSheetRow: number; // 1-indexed row in Detailed Categories sheet
    total: number;
    average: number;
  }[];
  totalColumnLetter: string;
  avgColumnLetter: string;
} {
  // Build detailed data to find row indices
  const detailedData = buildDetailedData(statement);

  // Sort categories by total spend descending (skip header row)
  const categoriesWithTotals = statement.detailedCategories
    .filter((cat) => cat.total > 0) // Only include categories with spending
    .sort((a, b) => b.total - a.total)
    .slice(0, 7); // Top 7

  // Find row indices in the detailed sheet for each category
  const categories = categoriesWithTotals.map((cat) => {
    // Find row in detailed data (1-indexed for Sheets)
    const rowIndex = detailedData.findIndex((row) => row[0] === cat.category);
    return {
      name: cat.category,
      detailedSheetRow: rowIndex >= 0 ? rowIndex + 1 : -1, // 1-indexed
      total: cat.total,
      average: cat.average,
    };
  }).filter((cat) => cat.detailedSheetRow > 0); // Only include found categories

  // Column letters for Total and Avg in Detailed Categories sheet
  // Structure: Category, [months...], Total, Avg
  const monthCount = statement.months.length;
  const totalColumnIndex = monthCount + 1; // 0-indexed: Cat=0, months, Total
  const avgColumnIndex = monthCount + 2;

  return {
    categories,
    totalColumnLetter: getColumnLetter(totalColumnIndex),
    avgColumnLetter: getColumnLetter(avgColumnIndex),
  };
}

/**
 * Find row indices in Summary sheet for key metrics
 * This allows Dashboard to reference Summary data with formulas
 */
function findSummaryRowIndices(statement: FinancialStatement): {
  totalIncomeRow: number;
  totalExpensesRow: number;
  netCashFlowRow: number;
  savingsRateRow: number;
  essentialSubtotalRow: number;
  discretionarySubtotalRow: number;
  lastDataColumn: string; // e.g., "G" for column with Total
  avgColumn: string; // e.g., "H" for column with Monthly Avg
} {
  // Build the summary data to find row positions
  const summaryData = buildSummaryData(statement);

  // Find row indices (1-indexed for Sheets formulas)
  let totalIncomeRow = -1;
  let totalExpensesRow = -1;
  let netCashFlowRow = -1;
  let savingsRateRow = -1;
  let essentialSubtotalRow = -1;
  let discretionarySubtotalRow = -1;
  let inEssentialSection = false;
  let inDiscretionarySection = false;

  for (let i = 0; i < summaryData.length; i++) {
    const row = summaryData[i];

    // Track which section we're in
    if (row[0] === "EXPENSES (Essential)") {
      inEssentialSection = true;
      inDiscretionarySection = false;
    }
    if (row[0] === "EXPENSES (Discretionary)") {
      inEssentialSection = false;
      inDiscretionarySection = true;
    }

    if (row[1] === "TOTAL INCOME") {
      totalIncomeRow = i + 1; // 1-indexed for Sheets
    }
    if (row[0] === "TOTAL EXPENSES") {
      totalExpensesRow = i + 1;
      inEssentialSection = false;
      inDiscretionarySection = false;
    }
    if (row[0] === "NET CASH FLOW") {
      netCashFlowRow = i + 1;
    }
    if (row[0] === "SAVINGS RATE") {
      savingsRateRow = i + 1;
    }
    // Find SUBTOTAL rows for essential and discretionary sections
    if (row[1] === "SUBTOTAL") {
      if (inEssentialSection) {
        essentialSubtotalRow = i + 1;
      } else if (inDiscretionarySection) {
        discretionarySubtotalRow = i + 1;
      }
    }
  }

  // Calculate the column letters for Total and Avg
  // Structure: Category, Subcategory, [months...], Total, Avg
  const monthCount = statement.months.length;
  const totalColumnIndex = monthCount + 2; // 0-indexed: Cat=0, Sub=1, months, Total
  const avgColumnIndex = monthCount + 3;

  return {
    totalIncomeRow,
    totalExpensesRow,
    netCashFlowRow,
    savingsRateRow,
    essentialSubtotalRow,
    discretionarySubtotalRow,
    lastDataColumn: getColumnLetter(totalColumnIndex),
    avgColumn: getColumnLetter(avgColumnIndex),
  };
}

/**
 * Convert column index to letter (0 = A, 1 = B, etc.)
 */
function getColumnLetter(index: number): string {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Build named range requests for key financial metrics (US-013)
 * Creates named ranges that users can reference in their own formulas
 *
 * Named ranges created:
 * - TotalIncome: Total column of TOTAL INCOME row in Summary sheet
 * - TotalExpenses: Total column of TOTAL EXPENSES row in Summary sheet
 * - NetCashFlow: Total column of NET CASH FLOW row in Summary sheet
 * - SavingsRate: Total column of SAVINGS RATE row in Summary sheet
 * - TransactionData: All transaction data rows (excluding header) in Transactions sheet
 */
function buildNamedRangeRequests(
  summarySheetId: number,
  transactionsSheetId: number | null,
  summaryRowIndices: {
    totalIncomeRow: number;
    totalExpensesRow: number;
    netCashFlowRow: number;
    savingsRateRow: number;
  },
  totalColumnIndex: number,
  transactionRowCount: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  // Convert 1-indexed row numbers to 0-indexed for API
  const totalIncomeRowIdx = summaryRowIndices.totalIncomeRow - 1;
  const totalExpensesRowIdx = summaryRowIndices.totalExpensesRow - 1;
  const netCashFlowRowIdx = summaryRowIndices.netCashFlowRow - 1;
  const savingsRateRowIdx = summaryRowIndices.savingsRateRow - 1;

  // TotalIncome named range - references Summary sheet, Total column, TOTAL INCOME row
  requests.push({
    addNamedRange: {
      namedRange: {
        name: "TotalIncome",
        range: {
          sheetId: summarySheetId,
          startRowIndex: totalIncomeRowIdx,
          endRowIndex: totalIncomeRowIdx + 1,
          startColumnIndex: totalColumnIndex,
          endColumnIndex: totalColumnIndex + 1,
        },
      },
    },
  });

  // TotalExpenses named range - references Summary sheet, Total column, TOTAL EXPENSES row
  requests.push({
    addNamedRange: {
      namedRange: {
        name: "TotalExpenses",
        range: {
          sheetId: summarySheetId,
          startRowIndex: totalExpensesRowIdx,
          endRowIndex: totalExpensesRowIdx + 1,
          startColumnIndex: totalColumnIndex,
          endColumnIndex: totalColumnIndex + 1,
        },
      },
    },
  });

  // NetCashFlow named range - references Summary sheet, Total column, NET CASH FLOW row
  requests.push({
    addNamedRange: {
      namedRange: {
        name: "NetCashFlow",
        range: {
          sheetId: summarySheetId,
          startRowIndex: netCashFlowRowIdx,
          endRowIndex: netCashFlowRowIdx + 1,
          startColumnIndex: totalColumnIndex,
          endColumnIndex: totalColumnIndex + 1,
        },
      },
    },
  });

  // SavingsRate named range - references Summary sheet, Total column, SAVINGS RATE row
  requests.push({
    addNamedRange: {
      namedRange: {
        name: "SavingsRate",
        range: {
          sheetId: summarySheetId,
          startRowIndex: savingsRateRowIdx,
          endRowIndex: savingsRateRowIdx + 1,
          startColumnIndex: totalColumnIndex,
          endColumnIndex: totalColumnIndex + 1,
        },
      },
    },
  });

  // TransactionData named range - references Transactions sheet, all data rows (excluding header)
  // Only create if Transactions sheet exists
  if (transactionsSheetId !== null && transactionRowCount > 1) {
    requests.push({
      addNamedRange: {
        namedRange: {
          name: "TransactionData",
          range: {
            sheetId: transactionsSheetId,
            startRowIndex: 1, // Skip header row (row 0)
            endRowIndex: transactionRowCount, // All data rows
            startColumnIndex: 0, // Column A (Date)
            endColumnIndex: 6, // Column F (Classification) - all 6 columns
          },
        },
      },
    });
  }

  return requests;
}

/**
 * Build trend text for income or expenses
 * Compares most recent month to prior month
 */
function buildTrendText(
  months: MonthlyFinancials[],
  metric: "income" | "expenses"
): string {
  if (months.length < 2) {
    return "—"; // Not enough data for trend
  }

  const current = months[months.length - 1];
  const prior = months[months.length - 2];

  let currentVal: number;
  let priorVal: number;

  if (metric === "income") {
    currentVal = current.income.total;
    priorVal = prior.income.total;
  } else {
    currentVal = current.expenses.total;
    priorVal = prior.expenses.total;
  }

  if (priorVal === 0) {
    return currentVal > 0 ? "↑ New" : "—";
  }

  const change = currentVal - priorVal;
  const percentChange = (change / priorVal) * 100;

  // For income, up is good. For expenses, down is good.
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
  const absPercent = Math.abs(percentChange).toFixed(0);

  if (metric === "income") {
    // Income: up = positive trend, down = negative trend
    if (change > 0) {
      return `${arrow} ${absPercent}% vs prior`;
    } else if (change < 0) {
      return `${arrow} ${absPercent}% vs prior`;
    }
  } else {
    // Expenses: down = positive trend, up = negative trend
    if (change < 0) {
      return `${arrow} ${absPercent}% vs prior`;
    } else if (change > 0) {
      return `${arrow} ${absPercent}% vs prior`;
    }
  }

  return "→ Stable";
}

/**
 * Build cash flow trend text based on MoM percentage change
 */
function buildCashFlowTrendText(momPercentage: number): string {
  if (momPercentage === 0) {
    return "→ Stable";
  }

  const arrow = momPercentage > 0 ? "↑" : "↓";
  const absPercent = Math.abs(momPercentage).toFixed(0);
  const direction = momPercentage > 5 ? "Improving" : momPercentage < -5 ? "Declining" : "Stable";

  if (direction === "Stable") {
    return "→ Stable";
  }

  return `${arrow} ${absPercent}% (${direction})`;
}

// Income Statement row indices (for formatting reference)
interface IncomeStatementLayout {
  headerRow: number;
  incomeHeaderRow: number;
  incomeStartRow: number;
  incomeEndRow: number;  // Total Income row
  essentialHeaderRow: number;
  essentialStartRow: number;
  essentialEndRow: number;  // Essential Subtotal row
  discretionaryHeaderRow: number;
  discretionaryStartRow: number;
  discretionaryEndRow: number;  // Discretionary Subtotal row
  totalExpensesRow: number;
  netIncomeRow: number;
  totalRows: number;
  columnCount: number;
}

/**
 * Build Income Statement sheet data in proper P&L format
 * Structure:
 * - INCOME section with subcategories
 * - ESSENTIAL EXPENSES section
 * - DISCRETIONARY EXPENSES section
 * - TOTAL EXPENSES
 * - NET INCOME
 */
function buildIncomeStatementData(statement: FinancialStatement): {
  data: (string | number)[][];
  layout: IncomeStatementLayout;
} {
  const months = statement.months;
  const monthHeaders = months.map((m) => formatMonthDisplay(m.month));
  const data: (string | number)[][] = [];

  // Row 0: Header row
  data.push(["INCOME STATEMENT", ...monthHeaders, "Total", "Monthly Avg"]);
  const headerRow = 0;

  // Row 1: Empty spacer
  data.push([]);

  // ========== INCOME SECTION ==========
  // Row 2: INCOME section header
  data.push(["INCOME", ...months.map(() => ""), "", ""]);
  const incomeHeaderRow = 2;

  // Row 3: Salary
  const incomeStartRow = 3;
  data.push([
    "  Salary / Wages",
    ...months.map((m) => m.income.salary),
    months.reduce((sum, m) => sum + m.income.salary, 0),
    months.reduce((sum, m) => sum + m.income.salary, 0) / months.length,
  ]);

  // Row 4: Investment Income
  data.push([
    "  Investment Income",
    ...months.map((m) => m.income.investment),
    months.reduce((sum, m) => sum + m.income.investment, 0),
    months.reduce((sum, m) => sum + m.income.investment, 0) / months.length,
  ]);

  // Row 5: Other Income
  data.push([
    "  Other Income",
    ...months.map((m) => m.income.other),
    months.reduce((sum, m) => sum + m.income.other, 0),
    months.reduce((sum, m) => sum + m.income.other, 0) / months.length,
  ]);

  // Row 6: TOTAL INCOME (formula-driven)
  const totalIncomeFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1); // +1 to skip category column
    return `=SUM(${colLetter}${incomeStartRow + 1}:${colLetter}${incomeStartRow + 3})`; // Rows 4-6 (1-indexed)
  });
  const totalColLetter = getColumnLetter(months.length + 1);
  const avgColLetter = getColumnLetter(months.length + 2);

  data.push([
    "TOTAL INCOME",
    ...totalIncomeFormulas,
    `=SUM(B${incomeStartRow + 1}:${getColumnLetter(months.length)}${incomeStartRow + 3})`,
    `=${totalColLetter}${incomeStartRow + 4}/${months.length}`,
  ]);
  const incomeEndRow = data.length - 1; // 6

  // Row 7: Empty spacer
  data.push([]);

  // ========== ESSENTIAL EXPENSES SECTION ==========
  // Row 8: ESSENTIAL EXPENSES section header
  data.push(["ESSENTIAL EXPENSES", ...months.map(() => ""), "", ""]);
  const essentialHeaderRow = data.length - 1; // 8

  // Essential expense categories
  const essentialCategories: { label: string; key: keyof MonthlyFinancials["expenses"]["essential"] }[] = [
    { label: "  Housing (Rent/Mortgage)", key: "housing" },
    { label: "  Utilities", key: "utilities" },
    { label: "  Transportation", key: "transportation" },
    { label: "  Groceries", key: "groceries" },
    { label: "  Insurance", key: "insurance" },
    { label: "  Medical / Healthcare", key: "medical" },
    { label: "  Debt Service", key: "debtService" },
  ];

  const essentialStartRow = data.length;
  for (const cat of essentialCategories) {
    if (cat.key === "total") continue;
    data.push([
      cat.label,
      ...months.map((m) => m.expenses.essential[cat.key]),
      months.reduce((sum, m) => sum + m.expenses.essential[cat.key], 0),
      months.reduce((sum, m) => sum + m.expenses.essential[cat.key], 0) / months.length,
    ]);
  }

  // Essential SUBTOTAL (formula-driven)
  const essentialSubtotalFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=SUM(${colLetter}${essentialStartRow + 1}:${colLetter}${essentialStartRow + essentialCategories.length})`;
  });

  data.push([
    "  SUBTOTAL Essential",
    ...essentialSubtotalFormulas,
    `=SUM(B${essentialStartRow + 1}:${getColumnLetter(months.length)}${essentialStartRow + essentialCategories.length})`,
    `=${totalColLetter}${essentialStartRow + essentialCategories.length + 1}/${months.length}`,
  ]);
  const essentialEndRow = data.length - 1;

  // Row: Empty spacer
  data.push([]);

  // ========== DISCRETIONARY EXPENSES SECTION ==========
  // Row: DISCRETIONARY EXPENSES section header
  data.push(["DISCRETIONARY EXPENSES", ...months.map(() => ""), "", ""]);
  const discretionaryHeaderRow = data.length - 1;

  // Discretionary expense categories
  const discretionaryCategories: { label: string; key: keyof MonthlyFinancials["expenses"]["discretionary"] }[] = [
    { label: "  Dining Out", key: "diningOut" },
    { label: "  Entertainment", key: "entertainment" },
    { label: "  Shopping", key: "shopping" },
    { label: "  Travel", key: "travel" },
    { label: "  Subscriptions", key: "subscriptions" },
    { label: "  Other Discretionary", key: "other" },
  ];

  const discretionaryStartRow = data.length;
  for (const cat of discretionaryCategories) {
    if (cat.key === "total") continue;
    data.push([
      cat.label,
      ...months.map((m) => m.expenses.discretionary[cat.key]),
      months.reduce((sum, m) => sum + m.expenses.discretionary[cat.key], 0),
      months.reduce((sum, m) => sum + m.expenses.discretionary[cat.key], 0) / months.length,
    ]);
  }

  // Discretionary SUBTOTAL (formula-driven)
  const discretionarySubtotalFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=SUM(${colLetter}${discretionaryStartRow + 1}:${colLetter}${discretionaryStartRow + discretionaryCategories.length})`;
  });

  data.push([
    "  SUBTOTAL Discretionary",
    ...discretionarySubtotalFormulas,
    `=SUM(B${discretionaryStartRow + 1}:${getColumnLetter(months.length)}${discretionaryStartRow + discretionaryCategories.length})`,
    `=${totalColLetter}${discretionaryStartRow + discretionaryCategories.length + 1}/${months.length}`,
  ]);
  const discretionaryEndRow = data.length - 1;

  // Row: Empty spacer
  data.push([]);

  // ========== TOTAL EXPENSES ==========
  // Formula: Essential Subtotal + Discretionary Subtotal
  const totalExpensesFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${essentialEndRow + 1}+${colLetter}${discretionaryEndRow + 1}`;
  });

  data.push([
    "TOTAL EXPENSES",
    ...totalExpensesFormulas,
    `=${totalColLetter}${essentialEndRow + 1}+${totalColLetter}${discretionaryEndRow + 1}`,
    `=${avgColLetter}${essentialEndRow + 1}+${avgColLetter}${discretionaryEndRow + 1}`,
  ]);
  const totalExpensesRow = data.length - 1;

  // Row: Empty spacer
  data.push([]);

  // ========== NET INCOME ==========
  // Formula: Total Income - Total Expenses
  const netIncomeFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${incomeEndRow + 1}-${colLetter}${totalExpensesRow + 1}`;
  });

  data.push([
    "NET INCOME",
    ...netIncomeFormulas,
    `=${totalColLetter}${incomeEndRow + 1}-${totalColLetter}${totalExpensesRow + 1}`,
    `=${avgColLetter}${incomeEndRow + 1}-${avgColLetter}${totalExpensesRow + 1}`,
  ]);
  const netIncomeRow = data.length - 1;

  const layout: IncomeStatementLayout = {
    headerRow,
    incomeHeaderRow,
    incomeStartRow,
    incomeEndRow,
    essentialHeaderRow,
    essentialStartRow,
    essentialEndRow,
    discretionaryHeaderRow,
    discretionaryStartRow,
    discretionaryEndRow,
    totalExpensesRow,
    netIncomeRow,
    totalRows: data.length,
    columnCount: months.length + 3, // Category + months + Total + Avg
  };

  return { data, layout };
}

/**
 * Build formatting requests for the Income Statement sheet
 * Applies financial analyst color coding per CLAUDE.md standards:
 * - Blue text: Hard-coded inputs (actual transaction data values)
 * - Black text: Same-sheet formulas (SUMs, calculations)
 * - Green text: Cross-sheet references (none in this sheet - it's the source)
 */
function buildIncomeStatementFormattingRequests(
  sheetId: number,
  layout: IncomeStatementLayout,
  monthCount: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const { columnCount } = layout;

  // 1. Freeze header row and first column for navigation
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Title row styling (Row 0) - Dark header
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 12,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Section header styling (INCOME, ESSENTIAL EXPENSES, DISCRETIONARY EXPENSES)
  const sectionHeaderRows = [
    layout.incomeHeaderRow,
    layout.essentialHeaderRow,
    layout.discretionaryHeaderRow,
  ];

  for (const row of sectionHeaderRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.sectionBg,
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack,
              fontSize: 11,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 4. TOTAL INCOME row styling - bold with subtle highlight
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.incomeEndRow, endRowIndex: layout.incomeEndRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black text for same-sheet formulas
            fontSize: 10,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 5. SUBTOTAL rows styling (Essential and Discretionary)
  const subtotalRows = [layout.essentialEndRow, layout.discretionaryEndRow];
  for (const row of subtotalRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.totalRowBg,
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
              fontSize: 10,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 6. TOTAL EXPENSES row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.totalExpensesRow, endRowIndex: layout.totalExpensesRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 7. NET INCOME row styling - prominent with dark background
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.netIncomeRow, endRowIndex: layout.netIncomeRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 12,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 8. Apply BLUE text for input data cells (actual values from transactions)
  // These are the "historical data" cells - income and expense line items
  const inputDataRanges = [
    // Income line items (Salary, Investment, Other)
    { start: layout.incomeStartRow, end: layout.incomeEndRow },
    // Essential expense line items
    { start: layout.essentialStartRow, end: layout.essentialEndRow },
    // Discretionary expense line items
    { start: layout.discretionaryStartRow, end: layout.discretionaryEndRow },
  ];

  for (const range of inputDataRanges) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: range.start,
          endRowIndex: range.end, // Excludes the subtotal/total row
          startColumnIndex: 1, // Skip category label column
          endColumnIndex: monthCount + 1, // Only monthly data columns (not Total/Avg)
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.inputBlue, // Blue for hard-coded inputs
            },
          },
        },
        fields: "userEnteredFormat.textFormat.foregroundColor",
      },
    });
  }

  // 9. Currency format for all data cells
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1, // Skip header
        startColumnIndex: 1, // Skip category column
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
          horizontalAlignment: "RIGHT",
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // 10. Conditional formatting for NET INCOME - green when positive, red when negative
  // Apply to data columns (months + Total + Avg)
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netIncomeRow,
          endRowIndex: layout.netIncomeRow + 1,
          startColumnIndex: 1,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netIncomeRow,
          endRowIndex: layout.netIncomeRow + 1,
          startColumnIndex: 1,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  // 11. Set column widths
  // First column (category labels) - wider
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 200 },
      fields: "pixelSize",
    },
  });

  // Month columns - standard width
  for (let i = 1; i <= monthCount; i++) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: 100 },
        fields: "pixelSize",
      },
    });
  }

  // Total and Avg columns - slightly wider
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: monthCount + 1,
        endIndex: columnCount,
      },
      properties: { pixelSize: 110 },
      fields: "pixelSize",
    },
  });

  // 12. Add borders around the entire statement
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: layout.totalRows,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 2, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
      left: { style: "SOLID", width: 2, color: COLORS.borderColor },
      right: { style: "SOLID", width: 2, color: COLORS.borderColor },
      innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
    },
  });

  // 13. Add thicker borders around major sections
  // Border below TOTAL INCOME
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.incomeEndRow,
        endRowIndex: layout.incomeEndRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // Border below TOTAL EXPENSES
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.totalExpensesRow,
        endRowIndex: layout.totalExpensesRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  return requests;
}

// Balance Sheet row indices (for formatting reference)
interface BalanceSheetLayout {
  headerRow: number;
  asOfDateRow: number;
  assetsHeaderRow: number;
  assetsStartRow: number;
  assetsEndRow: number;  // Total Assets row
  liabilitiesHeaderRow: number;
  liabilitiesStartRow: number;
  liabilitiesEndRow: number;  // Total Liabilities row
  netWorthRow: number;
  totalRows: number;
  columnCount: number;
}

/**
 * Build Balance Sheet data structure
 * Structure:
 * - ASSETS section with Liquid Assets (depository accounts)
 * - LIABILITIES section with Credit Card Debt
 * - NET WORTH calculation
 */
function buildBalanceSheetData(accounts: Account[]): {
  data: (string | number)[][];
  layout: BalanceSheetLayout;
} {
  const balanceSheet = calculateBalanceSheet(accounts);
  const data: (string | number)[][] = [];

  // Format the as-of date
  const asOfDate = new Date(balanceSheet.asOfDate);
  const formattedDate = asOfDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Row 0: Header row
  data.push(["BALANCE SHEET", "Balance", ""]);
  const headerRow = 0;

  // Row 1: As of date
  data.push([`As of: ${formattedDate}`, "", ""]);
  const asOfDateRow = 1;

  // Row 2: Empty spacer
  data.push([]);

  // ========== ASSETS SECTION ==========
  // Row 3: ASSETS header
  data.push(["ASSETS", "", ""]);
  const assetsHeaderRow = 3;

  // Row 4: Liquid Assets subheader
  data.push(["  Liquid Assets", "", ""]);
  const assetsStartRow = 4;

  // List each depository account
  for (const account of balanceSheet.assets.liquidAssets.accounts) {
    const displayName = account.institution
      ? `    ${account.name} (${account.institution})`
      : `    ${account.name}`;
    data.push([displayName, account.balance, ""]);
  }

  // If no accounts, add a placeholder
  if (balanceSheet.assets.liquidAssets.accounts.length === 0) {
    data.push(["    No depository accounts connected", 0, ""]);
  }

  // Total Liquid Assets row
  const liquidAssetsTotalRow = data.length;
  const liquidAssetsStartDataRow = assetsStartRow + 1; // First account row (1-indexed)
  const liquidAssetsEndDataRow = data.length; // Last account row (1-indexed)

  // Formula to sum liquid assets: =SUM(B{start}:B{end})
  const liquidAssetsSumFormula = balanceSheet.assets.liquidAssets.accounts.length > 0
    ? `=SUM(B${liquidAssetsStartDataRow + 1}:B${liquidAssetsEndDataRow})`
    : "0";
  data.push(["  Total Liquid Assets", liquidAssetsSumFormula, ""]);

  // Row: Empty spacer before Total Assets
  data.push([]);

  // TOTAL ASSETS row
  const totalAssetsRow = data.length;
  // Total Assets = Total Liquid Assets (for now, only liquid assets)
  data.push(["TOTAL ASSETS", `=B${liquidAssetsTotalRow + 1}`, ""]);
  const assetsEndRow = data.length - 1;

  // Row: Empty spacer
  data.push([]);

  // ========== LIABILITIES SECTION ==========
  // Row: LIABILITIES header
  data.push(["LIABILITIES", "", ""]);
  const liabilitiesHeaderRow = data.length - 1;

  // Row: Credit Card Debt subheader
  data.push(["  Credit Card Debt", "", ""]);
  const liabilitiesStartRow = data.length - 1;

  // List each credit card account
  const creditCardsStartRow = data.length;
  for (const account of balanceSheet.liabilities.creditCardDebt.accounts) {
    const displayName = account.institution
      ? `    ${account.name} (${account.institution})`
      : `    ${account.name}`;
    data.push([displayName, account.balance, ""]);
  }

  // If no credit cards, add a placeholder
  if (balanceSheet.liabilities.creditCardDebt.accounts.length === 0) {
    data.push(["    No credit cards connected", 0, ""]);
  }

  // Total Credit Card Debt row
  const creditCardsTotalRow = data.length;
  const creditCardsEndDataRow = data.length; // Last account row (1-indexed)

  // Formula to sum credit card debt
  const creditCardsSumFormula = balanceSheet.liabilities.creditCardDebt.accounts.length > 0
    ? `=SUM(B${creditCardsStartRow + 1}:B${creditCardsEndDataRow})`
    : "0";
  data.push(["  Total Credit Card Debt", creditCardsSumFormula, ""]);

  // Row: Empty spacer before Total Liabilities
  data.push([]);

  // TOTAL LIABILITIES row
  const totalLiabilitiesRow = data.length;
  // Total Liabilities = Total Credit Card Debt (for now)
  data.push(["TOTAL LIABILITIES", `=B${creditCardsTotalRow + 1}`, ""]);
  const liabilitiesEndRow = data.length - 1;

  // Row: Empty spacer
  data.push([]);
  data.push([]);

  // ========== NET WORTH SECTION ==========
  // NET WORTH = TOTAL ASSETS - TOTAL LIABILITIES
  const netWorthRow = data.length;
  data.push([
    "NET WORTH",
    `=B${totalAssetsRow + 1}-B${totalLiabilitiesRow + 1}`,
    "",
  ]);

  // Row: Empty spacer
  data.push([]);

  // Note about point-in-time snapshot
  data.push(["Note: This balance sheet reflects account balances at the time of export.", "", ""]);

  const layout: BalanceSheetLayout = {
    headerRow,
    asOfDateRow,
    assetsHeaderRow,
    assetsStartRow,
    assetsEndRow,
    liabilitiesHeaderRow,
    liabilitiesStartRow,
    liabilitiesEndRow,
    netWorthRow,
    totalRows: data.length,
    columnCount: 3,
  };

  return { data, layout };
}

/**
 * Build formatting requests for the Balance Sheet
 * Applies financial analyst color coding per CLAUDE.md standards:
 * - Blue text: Account balances (hard-coded inputs from Plaid)
 * - Black text: Same-sheet formulas (SUMs, calculations)
 */
function buildBalanceSheetFormattingRequests(
  sheetId: number,
  layout: BalanceSheetLayout,
  accountCount: { liquid: number; credit: number }
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const { columnCount } = layout;

  // 1. Freeze header row and first column for navigation
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Title row styling (Row 0) - Dark header
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 14,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. As-of date row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.asOfDateRow, endRowIndex: layout.asOfDateRow + 1 },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 },
            fontSize: 10,
            italic: true,
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // 4. Section header styling (ASSETS, LIABILITIES)
  const sectionHeaderRows = [layout.assetsHeaderRow, layout.liabilitiesHeaderRow];
  for (const row of sectionHeaderRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.sectionBg,
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack,
              fontSize: 11,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 5. Subsection header styling (Liquid Assets, Credit Card Debt)
  const subsectionRows = [layout.assetsStartRow, layout.liabilitiesStartRow];
  for (const row of subsectionRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack,
              fontSize: 10,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat.textFormat",
      },
    });
  }

  // 6. TOTAL ASSETS row styling - bold with highlight
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.assetsEndRow, endRowIndex: layout.assetsEndRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 7. TOTAL LIABILITIES row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.liabilitiesEndRow, endRowIndex: layout.liabilitiesEndRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 8. NET WORTH row styling - prominent with dark background
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.netWorthRow, endRowIndex: layout.netWorthRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 12,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 9. Apply BLUE text for account balance cells (hard-coded inputs from Plaid)
  // Liquid assets account rows
  if (accountCount.liquid > 0) {
    const liquidStart = layout.assetsStartRow + 1; // First account row after "Liquid Assets" header
    const liquidEnd = liquidStart + accountCount.liquid;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: liquidStart,
          endRowIndex: liquidEnd,
          startColumnIndex: 1, // Balance column
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.inputBlue, // Blue for hard-coded inputs
            },
          },
        },
        fields: "userEnteredFormat.textFormat.foregroundColor",
      },
    });
  }

  // Credit card account rows
  if (accountCount.credit > 0) {
    const creditStart = layout.liabilitiesStartRow + 1; // First account row after "Credit Card Debt" header
    const creditEnd = creditStart + accountCount.credit;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: creditStart,
          endRowIndex: creditEnd,
          startColumnIndex: 1, // Balance column
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.inputBlue, // Blue for hard-coded inputs
            },
          },
        },
        fields: "userEnteredFormat.textFormat.foregroundColor",
      },
    });
  }

  // 10. Currency format for all balance cells
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1, // Skip header
        startColumnIndex: 1, // Balance column
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
          horizontalAlignment: "RIGHT",
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // 11. Conditional formatting for NET WORTH - green when positive, red when negative
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netWorthRow,
          endRowIndex: layout.netWorthRow + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netWorthRow,
          endRowIndex: layout.netWorthRow + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  // 12. Set column widths
  // First column (account names) - wider
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 280 },
      fields: "pixelSize",
    },
  });

  // Balance column - standard width
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 1,
        endIndex: 2,
      },
      properties: { pixelSize: 130 },
      fields: "pixelSize",
    },
  });

  // 13. Add borders around the entire sheet
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: layout.totalRows,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 2, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
      left: { style: "SOLID", width: 2, color: COLORS.borderColor },
      right: { style: "SOLID", width: 2, color: COLORS.borderColor },
      innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
    },
  });

  // 14. Add thicker borders around major sections
  // Border below TOTAL ASSETS
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.assetsEndRow,
        endRowIndex: layout.assetsEndRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // Border below TOTAL LIABILITIES
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.liabilitiesEndRow,
        endRowIndex: layout.liabilitiesEndRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // 15. Style the note row at the bottom
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.totalRows - 1,
        endRowIndex: layout.totalRows,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 9,
            italic: true,
            foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 },
          },
        },
      },
      fields: "userEnteredFormat.textFormat",
    },
  });

  return requests;
}

// Cash Flow Statement row indices (for formatting reference)
interface CashFlowLayout {
  headerRow: number;
  operatingHeaderRow: number;
  operatingStartRow: number;
  operatingEndRow: number;  // Net Income From Operations row
  financingHeaderRow: number;
  financingStartRow: number;
  financingEndRow: number;  // Net Financing Activities row
  netChangeRow: number;
  beginningCashRow: number;
  endingCashRow: number;
  totalRows: number;
  columnCount: number;
}

/**
 * Build Cash Flow Statement data structure
 * Structure:
 * - OPERATING ACTIVITIES section: Net Income from P&L
 * - FINANCING ACTIVITIES section: CC payments, net CC balance change
 * - NET CHANGE IN CASH calculation
 * - Beginning and Ending Cash Balance rows
 *
 * Color coding per CLAUDE.md standards:
 * - Green text: Cross-sheet references (Net Income from Income Statement)
 * - Black text: Same-sheet formulas (calculations)
 * - Blue text: Beginning cash balance (input)
 */
function buildCashFlowData(statement: FinancialStatement, beginningCashBalance: number): {
  data: (string | number)[][];
  layout: CashFlowLayout;
} {
  const months = statement.months;
  const monthHeaders = months.map((m) => formatMonthDisplay(m.month));
  const data: (string | number)[][] = [];

  // Reference the Income Statement sheet for NET INCOME row
  // We need to find the NET INCOME row in Income Statement
  const incomeStatementData = buildIncomeStatementData(statement);
  const netIncomeRowInIS = incomeStatementData.layout.netIncomeRow + 1; // 1-indexed for Sheets

  // Row 0: Header row
  data.push(["CASH FLOW STATEMENT", ...monthHeaders, "Total", "Monthly Avg"]);
  const headerRow = 0;

  // Row 1: Empty spacer
  data.push([]);

  // ========== OPERATING ACTIVITIES SECTION ==========
  // Row 2: OPERATING ACTIVITIES header
  data.push(["OPERATING ACTIVITIES", ...months.map(() => ""), "", ""]);
  const operatingHeaderRow = 2;

  // Row 3: Net Income (reference to Income Statement)
  const operatingStartRow = 3;
  // Cross-sheet reference to Income Statement's NET INCOME row (green text)
  const netIncomeFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `='Income Statement'!${colLetter}${netIncomeRowInIS}`;
  });
  const totalColLetter = getColumnLetter(months.length + 1);
  const avgColLetter = getColumnLetter(months.length + 2);

  data.push([
    "  Net Income (from P&L)",
    ...netIncomeFormulas,
    `='Income Statement'!${totalColLetter}${netIncomeRowInIS}`,
    `='Income Statement'!${avgColLetter}${netIncomeRowInIS}`,
  ]);

  // Row 4: Net Income From Operations (same as Net Income for now - could add adjustments later)
  const netOperatingFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${operatingStartRow + 1}`; // Reference Net Income row
  });

  data.push([
    "NET INCOME FROM OPERATIONS",
    ...netOperatingFormulas,
    `=${totalColLetter}${operatingStartRow + 1}`,
    `=${avgColLetter}${operatingStartRow + 1}`,
  ]);
  const operatingEndRow = data.length - 1; // 4

  // Row 5: Empty spacer
  data.push([]);

  // ========== FINANCING ACTIVITIES SECTION ==========
  // Row 6: FINANCING ACTIVITIES header
  data.push(["FINANCING ACTIVITIES", ...months.map(() => ""), "", ""]);
  const financingHeaderRow = data.length - 1; // 6

  // Row 7: Credit Card Payments (from MonthlyFinancials transfers.creditCardPayments)
  const financingStartRow = data.length;
  const ccPaymentsValues = months.map((m) => -m.transfers.creditCardPayments); // Negative - cash outflow to CC
  data.push([
    "  Credit Card Payments",
    ...ccPaymentsValues,
    ccPaymentsValues.reduce((sum, val) => sum + val, 0),
    ccPaymentsValues.reduce((sum, val) => sum + val, 0) / months.length,
  ]);

  // Row 8: Internal Transfers (excluded from cash flow - informational only)
  const internalTransfersValues = months.map((m) => m.transfers.internal);
  data.push([
    "  Internal Transfers (excluded)",
    ...internalTransfersValues,
    internalTransfersValues.reduce((sum, val) => sum + val, 0),
    internalTransfersValues.reduce((sum, val) => sum + val, 0) / months.length,
  ]);

  // Row 9: Net Financing Activities
  // For now, just CC payments (internal transfers don't affect cash position)
  const netFinancingFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${financingStartRow + 1}`; // Just CC payments row
  });

  data.push([
    "NET FINANCING ACTIVITIES",
    ...netFinancingFormulas,
    `=${totalColLetter}${financingStartRow + 1}`,
    `=${avgColLetter}${financingStartRow + 1}`,
  ]);
  const financingEndRow = data.length - 1; // 9

  // Row 10: Empty spacer
  data.push([]);
  data.push([]);

  // ========== NET CHANGE IN CASH ==========
  // Row 12: NET CHANGE IN CASH = Net Operating + Net Financing
  const netChangeFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${operatingEndRow + 1}+${colLetter}${financingEndRow + 1}`;
  });

  data.push([
    "NET CHANGE IN CASH",
    ...netChangeFormulas,
    `=${totalColLetter}${operatingEndRow + 1}+${totalColLetter}${financingEndRow + 1}`,
    `=${avgColLetter}${operatingEndRow + 1}+${avgColLetter}${financingEndRow + 1}`,
  ]);
  const netChangeRow = data.length - 1;

  // Row 13: Empty spacer
  data.push([]);

  // ========== CASH BALANCE RECONCILIATION ==========
  // Row 14: Beginning Cash Balance (input - blue text)
  // For simplicity, we use the provided beginning balance and calculate running totals
  const beginningCashBalances: number[] = [];
  let runningBalance = beginningCashBalance;
  for (let i = 0; i < months.length; i++) {
    beginningCashBalances.push(runningBalance);
    // Calculate this month's change
    const monthNetOperating = months[i].netCashFlow; // Net income
    const monthNetFinancing = -months[i].transfers.creditCardPayments;
    runningBalance += (monthNetOperating + monthNetFinancing);
  }

  data.push([
    "Beginning Cash Balance",
    ...beginningCashBalances,
    beginningCashBalances[0], // Period start = first month's beginning
    "", // No average for beginning balance
  ]);
  const beginningCashRow = data.length - 1;

  // Row 15: Ending Cash Balance = Beginning + Net Change
  const endingCashFormulas = months.map((_, colIdx) => {
    const colLetter = getColumnLetter(colIdx + 1);
    return `=${colLetter}${beginningCashRow + 1}+${colLetter}${netChangeRow + 1}`;
  });

  data.push([
    "Ending Cash Balance",
    ...endingCashFormulas,
    `=${totalColLetter}${beginningCashRow + 1}+${totalColLetter}${netChangeRow + 1}`,
    "", // No average for ending balance
  ]);
  const endingCashRow = data.length - 1;

  // Row 16: Empty spacer
  data.push([]);

  // Row 17: Note about cash flow
  data.push(["Note: This cash flow excludes internal transfers between your own accounts.", "", "", ""]);

  const layout: CashFlowLayout = {
    headerRow,
    operatingHeaderRow,
    operatingStartRow,
    operatingEndRow,
    financingHeaderRow,
    financingStartRow,
    financingEndRow,
    netChangeRow,
    beginningCashRow,
    endingCashRow,
    totalRows: data.length,
    columnCount: months.length + 3, // Category + months + Total + Avg
  };

  return { data, layout };
}

/**
 * Build formatting requests for the Cash Flow Statement
 * Applies financial analyst color coding per CLAUDE.md standards:
 * - Green text: Cross-sheet references (Net Income from Income Statement)
 * - Black text: Same-sheet formulas (calculations)
 * - Blue text: Beginning cash balance (hard-coded input)
 */
function buildCashFlowFormattingRequests(
  sheetId: number,
  layout: CashFlowLayout,
  monthCount: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const { columnCount } = layout;

  // 1. Freeze header row and first column for navigation
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Title row styling (Row 0) - Dark header
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 12,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Section header styling (OPERATING ACTIVITIES, FINANCING ACTIVITIES)
  const sectionHeaderRows = [layout.operatingHeaderRow, layout.financingHeaderRow];
  for (const row of sectionHeaderRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.sectionBg,
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack,
              fontSize: 11,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 4. NET INCOME FROM OPERATIONS row styling - bold with highlight
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.operatingEndRow, endRowIndex: layout.operatingEndRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 10,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 5. NET FINANCING ACTIVITIES row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.financingEndRow, endRowIndex: layout.financingEndRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 10,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 6. NET CHANGE IN CASH row styling - prominent with dark background
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.netChangeRow, endRowIndex: layout.netChangeRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 12,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 7. Apply GREEN text for cross-sheet reference cells (Net Income from P&L)
  // Row: operatingStartRow (Net Income from P&L)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.operatingStartRow,
        endRowIndex: layout.operatingStartRow + 1,
        startColumnIndex: 1, // Skip category label column
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.crossRefGreen, // Green for cross-sheet references
          },
        },
      },
      fields: "userEnteredFormat.textFormat.foregroundColor",
    },
  });

  // 8. Apply BLUE text for Beginning Cash Balance (hard-coded input)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.beginningCashRow,
        endRowIndex: layout.beginningCashRow + 1,
        startColumnIndex: 1, // Skip category label column
        endColumnIndex: monthCount + 2, // Just the monthly values and period total (not avg)
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.inputBlue, // Blue for hard-coded inputs
          },
        },
      },
      fields: "userEnteredFormat.textFormat.foregroundColor",
    },
  });

  // 9. Ending Cash Balance row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: layout.endingCashRow, endRowIndex: layout.endingCashRow + 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.totalRowBg,
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.formulaBlack, // Black for same-sheet formulas
            fontSize: 10,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // 10. Currency format for all data cells
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1, // Skip header
        startColumnIndex: 1, // Skip category column
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
          horizontalAlignment: "RIGHT",
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // 11. Conditional formatting for NET CHANGE IN CASH - green when positive, red when negative
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netChangeRow,
          endRowIndex: layout.netChangeRow + 1,
          startColumnIndex: 1,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.netChangeRow,
          endRowIndex: layout.netChangeRow + 1,
          startColumnIndex: 1,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  // 12. Set column widths
  // First column (category labels) - wider
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });

  // Month columns - standard width
  for (let i = 1; i <= monthCount; i++) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: 100 },
        fields: "pixelSize",
      },
    });
  }

  // Total and Avg columns - slightly wider
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: monthCount + 1,
        endIndex: columnCount,
      },
      properties: { pixelSize: 110 },
      fields: "pixelSize",
    },
  });

  // 13. Add borders around the entire statement
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: layout.totalRows,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 2, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
      left: { style: "SOLID", width: 2, color: COLORS.borderColor },
      right: { style: "SOLID", width: 2, color: COLORS.borderColor },
      innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
    },
  });

  // 14. Add thicker borders around major sections
  // Border below NET INCOME FROM OPERATIONS
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.operatingEndRow,
        endRowIndex: layout.operatingEndRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // Border below NET FINANCING ACTIVITIES
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.financingEndRow,
        endRowIndex: layout.financingEndRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // Border above and below NET CHANGE IN CASH
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: layout.netChangeRow,
        endRowIndex: layout.netChangeRow + 1,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 2, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 2, color: COLORS.borderColor },
    },
  });

  // 15. Style the note row at the bottom
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.totalRows - 1,
        endRowIndex: layout.totalRows,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 9,
            italic: true,
            foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 },
          },
        },
      },
      fields: "userEnteredFormat.textFormat",
    },
  });

  return requests;
}

/**
 * Build dashboard sheet data with section headers and formula-driven values
 * Dashboard is the executive summary - first sheet users see
 */
function buildDashboardData(statement: FinancialStatement): {
  data: (string | number)[][];
  layout: DashboardLayout;
} {
  const data: (string | number)[][] = [];
  const dateRangeStr = `${formatMonthDisplay(statement.dateRange.start)} - ${formatMonthDisplay(statement.dateRange.end)}`;

  // Find Summary sheet row indices for formulas
  const summaryIndices = findSummaryRowIndices(statement);
  const {
    totalIncomeRow,
    totalExpensesRow,
    netCashFlowRow,
    savingsRateRow,
    essentialSubtotalRow,
    discretionarySubtotalRow,
    lastDataColumn,
    avgColumn,
  } = summaryIndices;

  // Calculate trend text based on month-over-month data
  const months = statement.months;
  const currentMonthCF = months.length > 0 ? months[months.length - 1].netCashFlow : 0;
  const priorMonthCF = months.length > 1 ? months[months.length - 2].netCashFlow : 0;
  const momChange = currentMonthCF - priorMonthCF;
  const momPercentage = priorMonthCF !== 0 ? (momChange / Math.abs(priorMonthCF)) * 100 : 0;

  // Build trend indicators
  const incomeTrendText = buildTrendText(months, "income");
  const expensesTrendText = buildTrendText(months, "expenses");
  const cashFlowTrendText = buildCashFlowTrendText(momPercentage);

  // Row 0: Title
  data.push([`Financial Dashboard`, "", "", "", dateRangeStr]);
  const titleRow = 0;

  // Row 1: Empty spacer
  data.push([]);

  // ========== THE BIG PICTURE SECTION ==========
  // Row 2: Section header
  data.push(["THE BIG PICTURE", "", "", "", ""]);
  const bigPictureHeaderRow = 2;

  // Row 3: Column headers for Big Picture
  data.push(["Metric", "Period Total", "Monthly Average", "Trend", ""]);
  const bigPictureStartRow = 3;

  // Row 4-6: Big Picture metrics with formulas referencing Summary sheet
  // Using formulas to reference Summary sheet - values update if source changes
  data.push([
    "Total Income",
    `='Summary'!${lastDataColumn}${totalIncomeRow}`,
    `='Summary'!${avgColumn}${totalIncomeRow}`,
    incomeTrendText,
    "",
  ]);
  data.push([
    "Total Expenses",
    `='Summary'!${lastDataColumn}${totalExpensesRow}`,
    `='Summary'!${avgColumn}${totalExpensesRow}`,
    expensesTrendText,
    "",
  ]);
  data.push([
    "Net Cash Flow",
    `='Summary'!${lastDataColumn}${netCashFlowRow}`,
    `='Summary'!${avgColumn}${netCashFlowRow}`,
    cashFlowTrendText,
    "",
  ]);
  const bigPictureEndRow = 6;

  // Row 7: Empty spacer
  data.push([]);

  // ========== KEY RATIOS SECTION ==========
  // Row 8: Section header
  data.push(["KEY RATIOS", "", "", "", ""]);
  const keyRatiosHeaderRow = 8;

  // Row 9: Column headers for Key Ratios
  // Columns: Ratio, Your Value, Target, Progress Bar, Status
  data.push(["Ratio", "Your Value", "Target", "Progress", "Status"]);
  const keyRatiosStartRow = 9;

  // Row 10-12: Key Ratio metrics with formulas referencing Summary sheet
  // Savings Rate formula: Reference the savings rate from Summary sheet
  // Target: 20%+ is green, 10-20% yellow, <10% red
  // Progress bar: REPT("█", MIN(10, ROUND(rate*50))) creates up to 10 blocks for 20%+
  const savingsRateFormula = `='Summary'!${lastDataColumn}${savingsRateRow}`;
  const savingsProgressFormula = `=REPT("█",MIN(10,ROUND('Summary'!${lastDataColumn}${savingsRateRow}*50)))&REPT("░",10-MIN(10,ROUND('Summary'!${lastDataColumn}${savingsRateRow}*50)))`;
  const savingsStatusFormula = `=IF('Summary'!${lastDataColumn}${savingsRateRow}>=0.2,"✓ On Track",IF('Summary'!${lastDataColumn}${savingsRateRow}>=0.1,"⚠ Close","⚡ Needs Attention"))`;

  data.push([
    "Savings Rate",
    savingsRateFormula,
    "≥20%",
    savingsProgressFormula,
    savingsStatusFormula,
  ]);

  // Essential Expenses % of Income formula
  // Target: 50% or less is good, 50-70% yellow, >70% red
  // Progress bar: REPT at max 100% scale, divided by 10 for 10 blocks
  const essentialPctFormula = `=IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${essentialSubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})`;
  const essentialProgressFormula = `=REPT("█",MIN(10,ROUND(IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${essentialSubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})*10)))&REPT("░",10-MIN(10,ROUND(IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${essentialSubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})*10)))`;
  const essentialStatusFormula = `=IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,"—",IF('Summary'!${lastDataColumn}${essentialSubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow}<=0.5,"✓ Healthy",IF('Summary'!${lastDataColumn}${essentialSubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow}<=0.7,"⚠ Elevated","⚡ High")))`;

  data.push([
    "Essential Expenses",
    essentialPctFormula,
    "≤50%",
    essentialProgressFormula,
    essentialStatusFormula,
  ]);

  // Discretionary Expenses % of Income formula
  // Target: 30% or less is good, 30-40% yellow, >40% red
  const discretionaryPctFormula = `=IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${discretionarySubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})`;
  const discretionaryProgressFormula = `=REPT("█",MIN(10,ROUND(IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${discretionarySubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})*10)))&REPT("░",10-MIN(10,ROUND(IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,0,'Summary'!${lastDataColumn}${discretionarySubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow})*10)))`;
  const discretionaryStatusFormula = `=IF('Summary'!${lastDataColumn}${totalIncomeRow}=0,"—",IF('Summary'!${lastDataColumn}${discretionarySubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow}<=0.3,"✓ In Control",IF('Summary'!${lastDataColumn}${discretionarySubtotalRow}/'Summary'!${lastDataColumn}${totalIncomeRow}<=0.4,"⚠ Watch Spending","⚡ Overspending")))`;

  data.push([
    "Discretionary Expenses",
    discretionaryPctFormula,
    "≤30%",
    discretionaryProgressFormula,
    discretionaryStatusFormula,
  ]);
  const keyRatiosEndRow = 12;

  // Row 13: Empty spacer
  data.push([]);

  // ========== WHERE YOUR MONEY GOES SECTION ==========
  // Row 14: Section header
  data.push(["WHERE YOUR MONEY GOES", "", "", "", ""]);
  const spendingHeaderRow = 14;

  // Row 15: Column headers for Spending Breakdown
  data.push(["Category", "Monthly Avg", "% of Expenses", "Visual", ""]);
  const spendingStartRow = 15;

  // Row 16-22: Top spending categories with formulas
  // Get top spending categories from detailed categories sheet
  const spendingData = findTopSpendingCategories(statement);
  const { categories: topCategories, avgColumnLetter: detailedAvgCol } = spendingData;

  // Add rows for each top category (up to 7)
  for (let i = 0; i < 7; i++) {
    if (i < topCategories.length) {
      const cat = topCategories[i];
      const rowNum = cat.detailedSheetRow;

      // Monthly Average formula - reference Detailed Categories sheet
      const avgFormula = `='Detailed Categories'!${detailedAvgCol}${rowNum}`;

      // Percentage of expenses formula
      // Calculate percentage based on the category's total vs total expenses
      // Reference the same sheet for the total, calculate percentage
      const totalCol = spendingData.totalColumnLetter;
      const pctFormula = `=IF('Summary'!${lastDataColumn}${totalExpensesRow}=0,0,'Detailed Categories'!${totalCol}${rowNum}/'Summary'!${lastDataColumn}${totalExpensesRow})`;

      // Visual bar using REPT() - shows proportional bars for relative spend
      // Scale: largest category = 10 blocks, others proportional
      // Formula: REPT("█", MAX(1, ROUND(pct*10))) for up to 10 blocks (100%)
      const visualFormula = `=REPT("█",MAX(1,MIN(10,ROUND('Detailed Categories'!${totalCol}${rowNum}/'Summary'!${lastDataColumn}${totalExpensesRow}*10))))&REPT("░",10-MAX(1,MIN(10,ROUND('Detailed Categories'!${totalCol}${rowNum}/'Summary'!${lastDataColumn}${totalExpensesRow}*10))))`;

      data.push([cat.name, avgFormula, pctFormula, visualFormula, ""]);
    } else {
      // Empty placeholder row if fewer than 7 categories
      data.push(["—", "", "", "", ""]);
    }
  }
  const spendingEndRow = data.length - 1;

  // Row 23: Empty spacer
  data.push([]);

  // ========== INSIGHTS SECTION ==========
  // Row 24: Section header
  data.push(["INSIGHTS", "", "", "", ""]);
  const insightsHeaderRow = 24;

  // Row 25: Placeholder explanation
  data.push(["AI-powered insights will appear here after analysis.", "", "", "", ""]);
  const insightsStartRow = 25;

  // Row 26-30: Insight placeholders (to be populated in US-016)
  data.push(["", "", "", "", ""]);
  data.push(["", "", "", "", ""]);
  data.push(["", "", "", "", ""]);
  data.push(["", "", "", "", ""]);
  data.push(["", "", "", "", ""]);
  const insightsEndRow = 30;

  // Row 31: Empty row for spacing
  data.push([]);

  // Row 32: Note about named ranges (per US-013)
  data.push(["Note: Use named ranges (TotalIncome, TotalExpenses, NetCashFlow, SavingsRate, TransactionData) to reference key metrics.", "", "", "", ""]);

  const layout: DashboardLayout = {
    titleRow,
    bigPictureHeaderRow,
    bigPictureStartRow,
    bigPictureEndRow,
    keyRatiosHeaderRow,
    keyRatiosStartRow,
    keyRatiosEndRow,
    spendingHeaderRow,
    spendingStartRow,
    spendingEndRow,
    insightsHeaderRow,
    insightsStartRow,
    insightsEndRow,
    totalRows: data.length,
  };

  return { data, layout };
}

/**
 * Build formatting requests for the Dashboard sheet
 */
function buildDashboardFormattingRequests(
  sheetId: number,
  layout: DashboardLayout
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const columnCount = 5; // 5 columns: A through E (expanded for Key Ratios progress bars)

  // 1. Freeze title row and first column for navigation
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Title row styling (Row 0)
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: FINANCIAL_COLORS.dashboardHeaderBg,
          horizontalAlignment: "LEFT",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 16,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Style all section headers (THE BIG PICTURE, KEY RATIOS, etc.)
  const sectionHeaderRows = [
    layout.bigPictureHeaderRow,
    layout.keyRatiosHeaderRow,
    layout.spendingHeaderRow,
    layout.insightsHeaderRow,
  ];

  for (const row of sectionHeaderRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: FINANCIAL_COLORS.sectionHeaderBg,
            horizontalAlignment: "LEFT",
            textFormat: {
              foregroundColor: COLORS.headerText,
              fontSize: 12,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });

    // Merge section header cells across all columns
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: row,
          endRowIndex: row + 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        mergeType: "MERGE_ALL",
      },
    });
  }

  // 4. Style column header rows (below each section header)
  const columnHeaderRows = [
    layout.bigPictureStartRow,
    layout.keyRatiosStartRow,
    layout.spendingStartRow,
  ];

  for (const row of columnHeaderRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.sectionBg,
            horizontalAlignment: "CENTER",
            textFormat: {
              foregroundColor: FINANCIAL_COLORS.formulaBlack,
              fontSize: 10,
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
  }

  // 5. Style data rows with alternating colors for readability
  const dataRowRanges = [
    { start: layout.bigPictureStartRow + 1, end: layout.bigPictureEndRow + 1 },
    { start: layout.keyRatiosStartRow + 1, end: layout.keyRatiosEndRow + 1 },
    { start: layout.spendingStartRow + 1, end: layout.spendingEndRow + 1 },
  ];

  for (const range of dataRowRanges) {
    // Alternating row colors
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: range.start,
            endRowIndex: range.end,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          }],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: "=MOD(ROW(),2)=0" }],
            },
            format: {
              backgroundColor: FINANCIAL_COLORS.neutralGrayBg,
            },
          },
        },
        index: 0,
      },
    });
  }

  // 6. Set column widths for better readability
  const columnWidths = [
    { column: 0, width: 180 }, // Metric/Category names
    { column: 1, width: 130 }, // Period Total / Your Value
    { column: 2, width: 100 }, // Monthly Avg / Target
    { column: 3, width: 120 }, // Trend / Progress
    { column: 4, width: 130 }, // Status
  ];

  for (const { column, width } of columnWidths) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: column,
          endIndex: column + 1,
        },
        properties: { pixelSize: width },
        fields: "pixelSize",
      },
    });
  }

  // 7. Style the Insights section rows
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.insightsStartRow,
        endRowIndex: layout.insightsEndRow + 1,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            fontSize: 10,
            foregroundColor: FINANCIAL_COLORS.formulaBlack,
          },
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat,wrapStrategy)",
    },
  });

  // 8. Add light borders around data sections
  const borderedRanges = [
    { start: layout.bigPictureHeaderRow, end: layout.bigPictureEndRow + 1 },
    { start: layout.keyRatiosHeaderRow, end: layout.keyRatiosEndRow + 1 },
    { start: layout.spendingHeaderRow, end: layout.spendingEndRow + 1 },
    { start: layout.insightsHeaderRow, end: layout.insightsEndRow + 1 },
  ];

  for (const range of borderedRanges) {
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: range.start,
          endRowIndex: range.end,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        top: { style: "SOLID", width: 1, color: COLORS.borderColor },
        bottom: { style: "SOLID", width: 1, color: COLORS.borderColor },
        left: { style: "SOLID", width: 1, color: COLORS.borderColor },
        right: { style: "SOLID", width: 1, color: COLORS.borderColor },
        innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
        innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      },
    });
  }

  // 9. Style the note row at the bottom
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.totalRows - 1,
        endRowIndex: layout.totalRows,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 9,
            italic: true,
            foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 },
          },
        },
      },
      fields: "userEnteredFormat.textFormat",
    },
  });

  // 10. Currency format for Big Picture data cells (columns B and C, rows 5-7)
  // Row indices: bigPictureStartRow + 1 = 4 (0-indexed), through bigPictureEndRow = 6
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.bigPictureStartRow + 1, // Data rows start after header
        endRowIndex: layout.bigPictureEndRow + 1,
        startColumnIndex: 1, // Column B (Period Total)
        endColumnIndex: 3,   // Column C (Monthly Average)
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
          horizontalAlignment: "RIGHT",
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // 11. Apply green text color for Big Picture formulas (cross-sheet references)
  // Per financial analyst standards, green text = cross-sheet references
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.bigPictureStartRow + 1, // Data rows
        endRowIndex: layout.bigPictureEndRow + 1,
        startColumnIndex: 1, // Period Total and Monthly Average columns
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.crossRefGreen,
          },
        },
      },
      fields: "userEnteredFormat.textFormat.foregroundColor",
    },
  });

  // 12. Conditional formatting for Net Cash Flow row - green background when positive
  // Net Cash Flow row is bigPictureEndRow (row 6, 0-indexed)
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.bigPictureEndRow, // Net Cash Flow row
          endRowIndex: layout.bigPictureEndRow + 1,
          startColumnIndex: 1, // Period Total column
          endColumnIndex: 3,   // Through Monthly Average
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  // 13. Conditional formatting for Net Cash Flow row - red background when negative
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: layout.bigPictureEndRow, // Net Cash Flow row
          endRowIndex: layout.bigPictureEndRow + 1,
          startColumnIndex: 1,
          endColumnIndex: 3,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS",
            values: [{ userEnteredValue: "0" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  // ========== KEY RATIOS SECTION FORMATTING ==========

  // 14. Percentage format for Key Ratios "Your Value" column (column B, rows 11-13)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.keyRatiosStartRow + 1, // Data rows start after header
        endRowIndex: layout.keyRatiosEndRow + 1,
        startColumnIndex: 1, // Column B (Your Value)
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "PERCENT", pattern: "0%" },
          horizontalAlignment: "RIGHT",
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.crossRefGreen, // Green for cross-sheet refs
          },
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });

  // 15. Center the Target column (column C)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.keyRatiosStartRow + 1,
        endRowIndex: layout.keyRatiosEndRow + 1,
        startColumnIndex: 2, // Column C (Target)
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 }, // Gray for static text
            italic: true,
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // 16. Style the Progress bar column (column D) - monospace font for consistent bar display
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.keyRatiosStartRow + 1,
        endRowIndex: layout.keyRatiosEndRow + 1,
        startColumnIndex: 3, // Column D (Progress)
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            fontFamily: "Roboto Mono",
            fontSize: 10,
            foregroundColor: FINANCIAL_COLORS.formulaBlack,
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // 17. Style the Status column (column E)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.keyRatiosStartRow + 1,
        endRowIndex: layout.keyRatiosEndRow + 1,
        startColumnIndex: 4, // Column E (Status)
        endColumnIndex: 5,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            fontSize: 10,
            foregroundColor: FINANCIAL_COLORS.formulaBlack,
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // 18. Conditional formatting for Savings Rate row - green when on track (>=20%)
  // Row index: keyRatiosStartRow + 1 (Savings Rate is first data row)
  const savingsRateRowIdx = layout.keyRatiosStartRow + 1;
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: savingsRateRowIdx,
          endRowIndex: savingsRateRowIdx + 1,
          startColumnIndex: 1, // Your Value column
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER_THAN_EQ",
            values: [{ userEnteredValue: "0.2" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  // 19. Conditional formatting for Savings Rate - yellow when close (10-20%)
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: savingsRateRowIdx,
          endRowIndex: savingsRateRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=AND(B${savingsRateRowIdx + 1}>=0.1,B${savingsRateRowIdx + 1}<0.2)` }],
          },
          format: {
            backgroundColor: { red: 1, green: 0.95, blue: 0.8 }, // Light yellow
            textFormat: {
              foregroundColor: { red: 0.6, green: 0.5, blue: 0 },
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  // 20. Conditional formatting for Savings Rate - red when concerning (<10%)
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: savingsRateRowIdx,
          endRowIndex: savingsRateRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS",
            values: [{ userEnteredValue: "0.1" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 2,
    },
  });

  // 21. Conditional formatting for Essential Expenses row
  // Green when <= 50%, yellow when 50-70%, red when > 70%
  const essentialRowIdx = layout.keyRatiosStartRow + 2;
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: essentialRowIdx,
          endRowIndex: essentialRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS_THAN_EQ",
            values: [{ userEnteredValue: "0.5" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: essentialRowIdx,
          endRowIndex: essentialRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=AND(B${essentialRowIdx + 1}>0.5,B${essentialRowIdx + 1}<=0.7)` }],
          },
          format: {
            backgroundColor: { red: 1, green: 0.95, blue: 0.8 },
            textFormat: {
              foregroundColor: { red: 0.6, green: 0.5, blue: 0 },
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: essentialRowIdx,
          endRowIndex: essentialRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0.7" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 2,
    },
  });

  // 22. Conditional formatting for Discretionary Expenses row
  // Green when <= 30%, yellow when 30-40%, red when > 40%
  const discretionaryRowIdx = layout.keyRatiosStartRow + 3;
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: discretionaryRowIdx,
          endRowIndex: discretionaryRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_LESS_THAN_EQ",
            values: [{ userEnteredValue: "0.3" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.positiveGreenBg,
            textFormat: {
              foregroundColor: COLORS.positiveCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: discretionaryRowIdx,
          endRowIndex: discretionaryRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=AND(B${discretionaryRowIdx + 1}>0.3,B${discretionaryRowIdx + 1}<=0.4)` }],
          },
          format: {
            backgroundColor: { red: 1, green: 0.95, blue: 0.8 },
            textFormat: {
              foregroundColor: { red: 0.6, green: 0.5, blue: 0 },
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: discretionaryRowIdx,
          endRowIndex: discretionaryRowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        }],
        booleanRule: {
          condition: {
            type: "NUMBER_GREATER",
            values: [{ userEnteredValue: "0.4" }],
          },
          format: {
            backgroundColor: FINANCIAL_COLORS.negativeRedBg,
            textFormat: {
              foregroundColor: COLORS.negativeCashFlow,
              bold: true,
            },
          },
        },
      },
      index: 2,
    },
  });

  // ========== WHERE YOUR MONEY GOES SECTION FORMATTING ==========

  // 23. Currency format for Spending Breakdown "Monthly Avg" column (column B)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.spendingStartRow + 1, // Data rows start after header
        endRowIndex: layout.spendingEndRow + 1,
        startColumnIndex: 1, // Column B (Monthly Avg)
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
          horizontalAlignment: "RIGHT",
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.crossRefGreen, // Green for cross-sheet refs
          },
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });

  // 24. Percentage format for Spending Breakdown "% of Expenses" column (column C)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.spendingStartRow + 1,
        endRowIndex: layout.spendingEndRow + 1,
        startColumnIndex: 2, // Column C (% of Expenses)
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "PERCENT", pattern: "0%" },
          horizontalAlignment: "RIGHT",
          textFormat: {
            foregroundColor: FINANCIAL_COLORS.crossRefGreen,
          },
        },
      },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });

  // 25. Style the Visual bar column (column D) - monospace font for consistent bar display
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.spendingStartRow + 1,
        endRowIndex: layout.spendingEndRow + 1,
        startColumnIndex: 3, // Column D (Visual)
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            fontFamily: "Roboto Mono",
            fontSize: 10,
            foregroundColor: { red: 0.3, green: 0.5, blue: 0.7 }, // Blue-ish for visual appeal
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // 26. Style the category name column (column A) for spending breakdown
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: layout.spendingStartRow + 1,
        endRowIndex: layout.spendingEndRow + 1,
        startColumnIndex: 0, // Column A (Category name)
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "LEFT",
          textFormat: {
            fontSize: 10,
            foregroundColor: FINANCIAL_COLORS.formulaBlack,
          },
        },
      },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  return requests;
}

/**
 * Create a Google Sheets OAuth2 client from access token
 */
export function createSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

/**
 * Refresh Google OAuth tokens if expired
 */
export async function refreshTokensIfNeeded(
  refreshToken: string,
  expiresAt: Date
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  // Check if token is still valid (with 5 min buffer)
  if (new Date(expiresAt.getTime() - 5 * 60 * 1000) > new Date()) {
    return null; // No refresh needed
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Failed to refresh access token");
  }

  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600 * 1000),
  };
}

/**
 * Build summary sheet data (2D array for Google Sheets)
 */
function buildSummaryData(statement: FinancialStatement): (string | number)[][] {
  const months = statement.months;
  const monthHeaders = months.map((m) => formatMonthDisplay(m.month));

  const data: (string | number)[][] = [];

  // Header row
  data.push(["Category", "Subcategory", ...monthHeaders, "Total", "Monthly Avg"]);

  // INCOME section
  data.push(["INCOME", "", ...months.map(() => ""), "", ""]);
  data.push([
    "",
    "Salary",
    ...months.map((m) => m.income.salary),
    months.reduce((sum, m) => sum + m.income.salary, 0),
    months.reduce((sum, m) => sum + m.income.salary, 0) / months.length,
  ]);
  data.push([
    "",
    "Investment",
    ...months.map((m) => m.income.investment),
    months.reduce((sum, m) => sum + m.income.investment, 0),
    months.reduce((sum, m) => sum + m.income.investment, 0) / months.length,
  ]);
  data.push([
    "",
    "Other",
    ...months.map((m) => m.income.other),
    months.reduce((sum, m) => sum + m.income.other, 0),
    months.reduce((sum, m) => sum + m.income.other, 0) / months.length,
  ]);
  data.push([
    "",
    "TOTAL INCOME",
    ...months.map((m) => m.income.total),
    months.reduce((sum, m) => sum + m.income.total, 0),
    months.reduce((sum, m) => sum + m.income.total, 0) / months.length,
  ]);

  // Empty row
  data.push([]);

  // EXPENSES (Essential) section
  data.push(["EXPENSES (Essential)", "", ...months.map(() => ""), "", ""]);
  const essentialCategories: (keyof MonthlyFinancials["expenses"]["essential"])[] = [
    "housing", "utilities", "transportation", "groceries", "insurance", "medical", "debtService"
  ];
  for (const cat of essentialCategories) {
    if (cat === "total") continue;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/([A-Z])/g, " $1");
    data.push([
      "",
      label,
      ...months.map((m) => m.expenses.essential[cat]),
      months.reduce((sum, m) => sum + m.expenses.essential[cat], 0),
      months.reduce((sum, m) => sum + m.expenses.essential[cat], 0) / months.length,
    ]);
  }
  data.push([
    "",
    "SUBTOTAL",
    ...months.map((m) => m.expenses.essential.total),
    months.reduce((sum, m) => sum + m.expenses.essential.total, 0),
    months.reduce((sum, m) => sum + m.expenses.essential.total, 0) / months.length,
  ]);

  // Empty row
  data.push([]);

  // EXPENSES (Discretionary) section
  data.push(["EXPENSES (Discretionary)", "", ...months.map(() => ""), "", ""]);
  const discretionaryCategories: (keyof MonthlyFinancials["expenses"]["discretionary"])[] = [
    "diningOut", "entertainment", "shopping", "travel", "subscriptions", "other"
  ];
  for (const cat of discretionaryCategories) {
    if (cat === "total") continue;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/([A-Z])/g, " $1");
    data.push([
      "",
      label,
      ...months.map((m) => m.expenses.discretionary[cat]),
      months.reduce((sum, m) => sum + m.expenses.discretionary[cat], 0),
      months.reduce((sum, m) => sum + m.expenses.discretionary[cat], 0) / months.length,
    ]);
  }
  data.push([
    "",
    "SUBTOTAL",
    ...months.map((m) => m.expenses.discretionary.total),
    months.reduce((sum, m) => sum + m.expenses.discretionary.total, 0),
    months.reduce((sum, m) => sum + m.expenses.discretionary.total, 0) / months.length,
  ]);

  // Empty row
  data.push([]);

  // Total expenses
  data.push([
    "TOTAL EXPENSES",
    "",
    ...months.map((m) => m.expenses.total),
    months.reduce((sum, m) => sum + m.expenses.total, 0),
    months.reduce((sum, m) => sum + m.expenses.total, 0) / months.length,
  ]);

  // Empty row
  data.push([]);

  // Net cash flow
  data.push([
    "NET CASH FLOW",
    "",
    ...months.map((m) => m.netCashFlow),
    months.reduce((sum, m) => sum + m.netCashFlow, 0),
    months.reduce((sum, m) => sum + m.netCashFlow, 0) / months.length,
  ]);

  // Savings rate
  data.push([
    "SAVINGS RATE",
    "",
    ...months.map((m) => m.savingsRate / 100), // Will be formatted as percentage
    statement.summary.averageSavingsRate / 100,
    statement.summary.averageSavingsRate / 100,
  ]);

  // Empty row
  data.push([]);

  // Transfers (excluded from calculations)
  data.push(["(Transfers Excluded)", "", ...months.map(() => ""), "", ""]);
  data.push([
    "",
    "Internal Transfers",
    ...months.map((m) => m.transfers.internal),
    months.reduce((sum, m) => sum + m.transfers.internal, 0),
    months.reduce((sum, m) => sum + m.transfers.internal, 0) / months.length,
  ]);
  data.push([
    "",
    "CC Payments",
    ...months.map((m) => m.transfers.creditCardPayments),
    months.reduce((sum, m) => sum + m.transfers.creditCardPayments, 0),
    months.reduce((sum, m) => sum + m.transfers.creditCardPayments, 0) / months.length,
  ]);

  return data;
}

/**
 * Build transactions sheet data (raw transaction list)
 * This is the source data for all formula references across the spreadsheet
 *
 * Columns: Date, Description, Amount, Category, Account, Classification
 * - Sorted by date (most recent first)
 * - Classification marks excluded transactions (internal_transfer, credit_card_payment)
 */
function buildTransactionsData(transactions: ClassifiedTransaction[]): (string | number)[][] {
  const data: (string | number)[][] = [];

  // Header row - Account column added per US-012 requirements
  data.push(["Date", "Description", "Amount", "Category", "Account", "Classification"]);

  // Sort transactions by date (most recent first)
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Add each transaction
  for (const t of sorted) {
    data.push([
      t.date,
      t.name,
      t.amount,
      t.category,
      t.accountId,  // Account ID for cross-referencing
      t.classification,
    ]);
  }

  return data;
}

/**
 * Build detailed categories sheet data
 */
function buildDetailedData(statement: FinancialStatement): (string | number)[][] {
  const months = statement.months;
  const monthHeaders = months.map((m) => formatMonthDisplay(m.month));
  const monthKeys = months.map((m) => m.month);

  const data: (string | number)[][] = [];

  // Header row
  data.push(["Category", ...monthHeaders, "Total", "Monthly Avg"]);

  // Each category row
  for (const cat of statement.detailedCategories) {
    data.push([
      cat.category,
      ...monthKeys.map((month) => cat.monthlyTotals[month] || 0),
      cat.total,
      cat.average,
    ]);
  }

  return data;
}

/**
 * Build formatting requests for the summary sheet
 */
function buildSummaryFormattingRequests(
  sheetId: number,
  statement: FinancialStatement
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const monthCount = statement.months.length;
  const columnCount = monthCount + 4; // Category, Subcategory, months..., Total, Avg

  // Find row indices for special formatting
  const data = buildSummaryData(statement);
  const sectionRows: number[] = [];
  const subtotalRows: number[] = [];
  const netCashFlowRow = data.findIndex((row) => row[0] === "NET CASH FLOW");
  const savingsRateRow = data.findIndex((row) => row[0] === "SAVINGS RATE");

  data.forEach((row, idx) => {
    if (typeof row[0] === "string" && (
      row[0].startsWith("INCOME") ||
      row[0].startsWith("EXPENSES") ||
      row[0].startsWith("(Transfers")
    )) {
      sectionRows.push(idx);
    }
    if (row[1] === "SUBTOTAL" || row[1] === "TOTAL INCOME") {
      subtotalRows.push(idx);
    }
  });

  // 1. Freeze header row and first column
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Header row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Currency format for data columns (skip first 2 columns)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: 2,
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // 4. Section header styling
  for (const row of sectionRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.sectionBg,
            textFormat: { bold: true, fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 5. Subtotal row styling
  for (const row of subtotalRows) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.totalRowBg,
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 6. Total expenses row styling
  const totalExpensesRow = data.findIndex((row) => row[0] === "TOTAL EXPENSES");
  if (totalExpensesRow >= 0) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: totalExpensesRow, endRowIndex: totalExpensesRow + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.totalRowBg,
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  }

  // 7. Net cash flow row styling with conditional color
  if (netCashFlowRow >= 0) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: netCashFlowRow, endRowIndex: netCashFlowRow + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.totalRowBg,
            textFormat: { bold: true, fontSize: 11 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });

    // Conditional formatting for negative cash flow
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: netCashFlowRow,
            endRowIndex: netCashFlowRow + 1,
            startColumnIndex: 2,
            endColumnIndex: columnCount,
          }],
          booleanRule: {
            condition: {
              type: "NUMBER_LESS",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              textFormat: { foregroundColor: COLORS.negativeCashFlow, bold: true },
            },
          },
        },
        index: 0,
      },
    });

    // Conditional formatting for positive cash flow
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: netCashFlowRow,
            endRowIndex: netCashFlowRow + 1,
            startColumnIndex: 2,
            endColumnIndex: columnCount,
          }],
          booleanRule: {
            condition: {
              type: "NUMBER_GREATER",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              textFormat: { foregroundColor: COLORS.positiveCashFlow, bold: true },
            },
          },
        },
        index: 1,
      },
    });
  }

  // 8. Savings rate percentage format
  if (savingsRateRow >= 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: savingsRateRow,
          endRowIndex: savingsRateRow + 1,
          startColumnIndex: 2,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "PERCENT", pattern: "0%" },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  // 9. Auto-resize columns
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: columnCount,
      },
    },
  });

  // 10. Borders
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: data.length,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 1, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 1, color: COLORS.borderColor },
      left: { style: "SOLID", width: 1, color: COLORS.borderColor },
      right: { style: "SOLID", width: 1, color: COLORS.borderColor },
      innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
    },
  });

  return requests;
}

/**
 * Build formatting requests for the detailed sheet
 */
function buildDetailedFormattingRequests(
  sheetId: number,
  statement: FinancialStatement
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const monthCount = statement.months.length;
  const columnCount = monthCount + 3; // Category, months..., Total, Avg
  const rowCount = statement.detailedCategories.length + 1;

  // 1. Freeze header row and first column
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // 2. Header row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Currency format for data columns
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: 1,
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // 4. Alternating row colors for readability
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: "=MOD(ROW(),2)=0" }],
          },
          format: {
            backgroundColor: { red: 0.98, green: 0.98, blue: 0.98 },
          },
        },
      },
      index: 0,
    },
  });

  // 5. Auto-resize columns
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: columnCount,
      },
    },
  });

  // 6. Borders
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: rowCount,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      top: { style: "SOLID", width: 1, color: COLORS.borderColor },
      bottom: { style: "SOLID", width: 1, color: COLORS.borderColor },
      left: { style: "SOLID", width: 1, color: COLORS.borderColor },
      right: { style: "SOLID", width: 1, color: COLORS.borderColor },
      innerHorizontal: { style: "SOLID", width: 1, color: COLORS.lightBorder },
      innerVertical: { style: "SOLID", width: 1, color: COLORS.lightBorder },
    },
  });

  return requests;
}

/**
 * Build formatting requests for the transactions sheet
 * Features:
 * - Frozen header row for navigation
 * - Filter views enabled on all columns
 * - Currency formatting for Amount column
 * - Alternating row colors for readability
 * - Excluded transactions (transfers, CC payments) visible in Classification column
 */
function buildTransactionsFormattingRequests(
  sheetId: number,
  rowCount: number
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const columnCount = 6; // Date, Description, Amount, Category, Account, Classification

  // 1. Freeze header row
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // 2. Header row styling
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.headerBg,
          horizontalAlignment: "CENTER",
          textFormat: {
            foregroundColor: COLORS.headerText,
            fontSize: 11,
            bold: true,
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // 3. Enable filter views on header row for easy data filtering
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
      },
    },
  });

  // 4. Currency format for Amount column (C - index 2)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: 2,
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // 5. Alternating row colors for readability
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: "=MOD(ROW(),2)=0" }],
          },
          format: {
            backgroundColor: { red: 0.98, green: 0.98, blue: 0.98 },
          },
        },
      },
      index: 0,
    },
  });

  // 6. Conditional formatting to highlight excluded transactions
  // Internal transfers - light yellow background
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=$F2="internal_transfer"' }],
          },
          format: {
            backgroundColor: { red: 1, green: 0.98, blue: 0.85 }, // Light yellow
          },
        },
      },
      index: 0,
    },
  });

  // Credit card payments - light blue background
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        }],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=$F2="credit_card_payment"' }],
          },
          format: {
            backgroundColor: { red: 0.88, green: 0.94, blue: 1 }, // Light blue
          },
        },
      },
      index: 0,
    },
  });

  // 7. Auto-resize columns
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: columnCount,
      },
    },
  });

  return requests;
}

/**
 * Format date range for spreadsheet title
 */
function formatDateRangeTitle(dateRange: { start: string; end: string }): string {
  const startDisplay = formatMonthDisplay(dateRange.start);
  const endDisplay = formatMonthDisplay(dateRange.end);
  return `${startDisplay} - ${endDisplay}`;
}

/**
 * Create a financial statement spreadsheet in Google Sheets
 * Dashboard is the first sheet (executive summary), followed by:
 * - Income Statement (P&L format)
 * - Balance Sheet
 * - Summary (legacy format for backward compatibility)
 * - Detailed Categories
 * - Transactions (if provided)
 */
export async function createFinancialSpreadsheet(
  accessToken: string,
  statement: FinancialStatement,
  transactions?: ClassifiedTransaction[],
  accounts?: Account[]
): Promise<{ url: string; id: string }> {
  const sheets = createSheetsClient(accessToken);

  // 1. Create spreadsheet with all sheets (Dashboard first)
  const sheetDefinitions = [
    { properties: { title: "Dashboard", index: 0 } },
    { properties: { title: "Income Statement", index: 1 } },
    { properties: { title: "Balance Sheet", index: 2 } },
    { properties: { title: "Cash Flow", index: 3 } },
    { properties: { title: "Summary", index: 4 } },
    { properties: { title: "Detailed Categories", index: 5 } },
  ];

  // Add Transactions sheet if transactions are provided
  if (transactions && transactions.length > 0) {
    sheetDefinitions.push({ properties: { title: "Transactions", index: 6 } });
  }

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `Financial Dashboard - ${formatDateRangeTitle(statement.dateRange)}`,
        locale: "en_US",
      },
      sheets: sheetDefinitions,
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;
  const dashboardSheetId = spreadsheet.data.sheets![0].properties!.sheetId!;
  const incomeStatementSheetId = spreadsheet.data.sheets![1].properties!.sheetId!;
  const balanceSheetId = spreadsheet.data.sheets![2].properties!.sheetId!;
  const cashFlowSheetId = spreadsheet.data.sheets![3].properties!.sheetId!;
  const summarySheetId = spreadsheet.data.sheets![4].properties!.sheetId!;
  const detailedSheetId = spreadsheet.data.sheets![5].properties!.sheetId!;
  const transactionsSheetId = transactions && transactions.length > 0
    ? spreadsheet.data.sheets![6].properties!.sheetId!
    : null;

  // 2. Build data for all sheets
  const { data: dashboardData, layout: dashboardLayout } = buildDashboardData(statement);
  const { data: incomeStatementData, layout: incomeStatementLayout } = buildIncomeStatementData(statement);

  // Build Balance Sheet data from accounts (or empty if no accounts provided)
  const accountsToUse = accounts ?? [];
  const { data: balanceSheetData, layout: balanceSheetLayout } = buildBalanceSheetData(accountsToUse);

  // Count accounts for formatting (blue text for input cells)
  const balanceSheet = calculateBalanceSheet(accountsToUse);
  const accountCount = {
    liquid: balanceSheet.assets.liquidAssets.accounts.length,
    credit: balanceSheet.liabilities.creditCardDebt.accounts.length,
  };

  // Build Cash Flow Statement data
  // Use total liquid assets as beginning cash balance (point-in-time estimate)
  const beginningCashBalance = balanceSheet.assets.totalAssets;
  const { data: cashFlowData, layout: cashFlowLayout } = buildCashFlowData(statement, beginningCashBalance);

  const dataUpdates: { range: string; values: (string | number)[][] }[] = [
    { range: "Dashboard!A1", values: dashboardData },
    { range: "'Income Statement'!A1", values: incomeStatementData },
    { range: "'Balance Sheet'!A1", values: balanceSheetData },
    { range: "'Cash Flow'!A1", values: cashFlowData },
    { range: "Summary!A1", values: buildSummaryData(statement) },
    { range: "'Detailed Categories'!A1", values: buildDetailedData(statement) },
  ];

  // Build transactions data if provided
  let transactionsData: (string | number)[][] = [];
  if (transactions && transactions.length > 0) {
    transactionsData = buildTransactionsData(transactions);
    dataUpdates.push({ range: "Transactions!A1", values: transactionsData });
  }

  // 3. Write all data using valuesBatchUpdate for efficiency
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: dataUpdates,
    },
  });

  // 4. Build formatting requests (Dashboard first for consistent ordering)
  const formattingRequests = [
    ...buildDashboardFormattingRequests(dashboardSheetId, dashboardLayout),
    ...buildIncomeStatementFormattingRequests(incomeStatementSheetId, incomeStatementLayout, statement.months.length),
    ...buildBalanceSheetFormattingRequests(balanceSheetId, balanceSheetLayout, accountCount),
    ...buildCashFlowFormattingRequests(cashFlowSheetId, cashFlowLayout, statement.months.length),
    ...buildSummaryFormattingRequests(summarySheetId, statement),
    ...buildDetailedFormattingRequests(detailedSheetId, statement),
  ];

  // Add transactions formatting if sheet exists
  if (transactionsSheetId !== null && transactionsData.length > 0) {
    formattingRequests.push(
      ...buildTransactionsFormattingRequests(transactionsSheetId, transactionsData.length)
    );
  }

  // 5. Build named range requests (US-013)
  // Get Summary sheet row indices for named ranges
  const summaryIndices = findSummaryRowIndices(statement);
  const totalColumnIndex = statement.months.length + 2; // Category, Subcategory, [months...], Total

  const namedRangeRequests = buildNamedRangeRequests(
    summarySheetId,
    transactionsSheetId,
    {
      totalIncomeRow: summaryIndices.totalIncomeRow,
      totalExpensesRow: summaryIndices.totalExpensesRow,
      netCashFlowRow: summaryIndices.netCashFlowRow,
      savingsRateRow: summaryIndices.savingsRateRow,
    },
    totalColumnIndex,
    transactionsData.length
  );

  // Combine formatting and named range requests
  const allRequests = [...formattingRequests, ...namedRangeRequests];

  // 6. Apply all formatting and named ranges in a single batchUpdate
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: allRequests,
    },
  });

  return {
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    id: spreadsheetId,
  };
}
