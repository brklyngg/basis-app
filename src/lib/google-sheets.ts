import { google, sheets_v4 } from "googleapis";
import type { FinancialStatement, MonthlyFinancials } from "@/types";
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
 * Format date range for spreadsheet title
 */
function formatDateRangeTitle(dateRange: { start: string; end: string }): string {
  const startDisplay = formatMonthDisplay(dateRange.start);
  const endDisplay = formatMonthDisplay(dateRange.end);
  return `${startDisplay} - ${endDisplay}`;
}

/**
 * Create a financial statement spreadsheet in Google Sheets
 */
export async function createFinancialSpreadsheet(
  accessToken: string,
  statement: FinancialStatement
): Promise<{ url: string; id: string }> {
  const sheets = createSheetsClient(accessToken);

  // 1. Create spreadsheet with both sheets
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `Financial Statement - ${formatDateRangeTitle(statement.dateRange)}`,
        locale: "en_US",
      },
      sheets: [
        { properties: { title: "Summary", index: 0 } },
        { properties: { title: "Detailed Categories", index: 1 } },
      ],
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;
  const summarySheetId = spreadsheet.data.sheets![0].properties!.sheetId!;
  const detailedSheetId = spreadsheet.data.sheets![1].properties!.sheetId!;

  // 2. Write data using valuesBatchUpdate for efficiency
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "Summary!A1", values: buildSummaryData(statement) },
        { range: "Detailed Categories!A1", values: buildDetailedData(statement) },
      ],
    },
  });

  // 3. Apply all formatting in a single batchUpdate
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        ...buildSummaryFormattingRequests(summarySheetId, statement),
        ...buildDetailedFormattingRequests(detailedSheetId, statement),
      ],
    },
  });

  return {
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    id: spreadsheetId,
  };
}
