# PRD: Enhanced Financial Statement Export

## Introduction

Transform the existing Google Sheets export into a wizard-level personal financial dashboard that tells a clear story at a glance. The export should answer the fundamental question every user has: **"Am I okay financially?"**

Based on research, 79% of Americans have concerns about their financial situation, yet most don't have clear visibility into their actual cash flow. This enhancement creates an executive-level summary that's intuitive for people who aren't used to analyzing their finances, backed by detailed transaction data.

## Goals

- Create an executive summary dashboard that tells the financial story at a glance
- Implement a 3-statement model adapted for personal finance (P&L, Balance Sheet proxy, Cash Flow)
- Generate AI-powered personalized insights that highlight what actually matters
- Make all summary metrics formula-driven from underlying transaction data
- Design for someone who has never looked at their finances systematically

## Core Insight: What People Actually Care About

Research shows the top personal finance metrics people track:
1. **Net Worth** - Total assets minus liabilities
2. **Savings Rate** - What % of income is being saved
3. **Net Worth Growth Rate** - Am I getting better or worse over time?
4. **Debt-to-Income Ratio** - Can I handle my obligations?
5. **Expense Rate** - Where is my money actually going?

The dashboard should answer these questions immediately and non-judgmentally.

---

## User Stories

### Phase 1: Data Layer Enhancements

#### US-001: Calculate Core Financial Metrics
**Description:** As a user, I need the system to calculate key financial metrics from my transaction data so they can power the dashboard.

**Acceptance Criteria:**
- Calculate total income (sum of all negative amount transactions, excluding transfers)
- Calculate total expenses (sum of all positive amount transactions, excluding transfers/CC payments)
- Calculate net cash flow (income - expenses)
- Calculate savings rate (net cash flow / income * 100)
- Calculate average monthly income and expenses
- Calculate expense-to-income ratio
- All calculations exclude internal transfers and credit card payments (already implemented)
- Typecheck passes
- Unit tests pass for metric calculations

---

#### US-002: Calculate Trend Metrics
**Description:** As a user, I want to see if my finances are improving or declining over time.

**Acceptance Criteria:**
- Calculate month-over-month change in net cash flow
- Calculate 3-month moving average of net cash flow
- Determine trend direction (improving/stable/declining) based on last 3 months
- Calculate percentage change from prior period
- Return trend data structure with direction, magnitude, and comparison values
- Typecheck passes

---

#### US-003: Generate Category Breakdown with Rankings
**Description:** As a user, I want to see my spending broken down by category with clear rankings.

**Acceptance Criteria:**
- Group expenses by Plaid category (already partially exists)
- Rank categories by total spend (descending)
- Calculate each category's percentage of total expenses
- Calculate each category's percentage of income
- Identify top 5 spending categories
- Calculate month-over-month change per category
- Typecheck passes

---

#### US-004: Build Balance Sheet Data Structure
**Description:** As a user, I need a balance sheet view showing my assets and liabilities from connected accounts.

**Acceptance Criteria:**
- Sum all depository account balances as "Liquid Assets"
- Sum all credit card balances as "Credit Card Debt"
- Calculate Net Worth (Assets - Liabilities)
- Group accounts by type (checking, savings, credit card)
- Return balance sheet data structure with totals
- Typecheck passes

---

### Phase 2: Executive Summary Sheet

#### US-005: Create Dashboard Layout Structure
**Description:** As a user, I want a visually clear executive summary sheet as the first tab.

**Acceptance Criteria:**
- Dashboard sheet is first tab, named "Dashboard"
- Clear section headers: "THE BIG PICTURE", "KEY RATIOS", "WHERE YOUR MONEY GOES", "INSIGHTS"
- Professional formatting (dark header rows, alternating section colors)
- Frozen top rows for navigation
- All metric cells reference data from other sheets (formula-driven)
- Typecheck passes
- Verify in browser that layout renders correctly

---

#### US-006: Implement Big Picture Section
**Description:** As a user, I want to see my total income, expenses, and net cash flow prominently displayed.

**Acceptance Criteria:**
- Display: Total Income (period total + monthly average)
- Display: Total Expenses (period total + monthly average)
- Display: Net Cash Flow (period total + monthly average)
- Conditional formatting: green for positive net, red for negative
- Display trend indicator with comparison to prior period
- Values are SUM formulas referencing Income Statement sheet
- Typecheck passes
- Verify in browser

---

#### US-007: Implement Key Ratios Section
**Description:** As a user, I want to see my key financial ratios with visual progress indicators.

**Acceptance Criteria:**
- Display: Savings Rate with progress bar (target: 20%)
- Display: Essential Expenses as % of Income with progress bar
- Display: Discretionary Expenses as % of Income with progress bar
- Progress bars implemented using REPT() function for ASCII visualization
- Color coding: green if meeting target, yellow if close, red if concerning
- Benchmark comparisons shown (e.g., "Target: 20%")
- Typecheck passes
- Verify in browser

---

#### US-008: Implement Spending Breakdown Section
**Description:** As a user, I want to see where my money goes with visual bar charts.

**Acceptance Criteria:**
- List top 5-7 spending categories
- Show monthly average for each category
- Visual bar chart using REPT() or SPARKLINE
- Categories sorted by spend amount (descending)
- Show percentage of total for each category
- Values reference detailed category data
- Typecheck passes
- Verify in browser

---

#### US-009: Implement Insights Section
**Description:** As a user, I want AI-generated insights that highlight what matters about my finances.

**Acceptance Criteria:**
- Section header: "INSIGHTS"
- 4-6 bullet points with mix of:
  - Positive observations (wins)
  - Neutral observations (facts)
  - Areas of attention (not warnings, just awareness)
- Use emoji indicators: ✓ (positive), ℹ️ (neutral), ⚠️ (attention)
- Insights generated by Claude based on actual transaction analysis
- Written in plain, non-judgmental language
- Include specific numbers and percentages
- Typecheck passes

---

### Phase 3: Three-Statement Model

#### US-010: Create Income Statement Sheet
**Description:** As a user, I want a proper Income Statement (P&L) format.

**Acceptance Criteria:**
- Sheet named "Income Statement"
- Sections: INCOME, ESSENTIAL EXPENSES, DISCRETIONARY EXPENSES
- Income subcategories: Payroll, Freelance/Other, Refunds
- Essential subcategories: Housing, Utilities, Insurance, Transportation, Groceries, Healthcare
- Discretionary subcategories: Dining, Entertainment, Shopping, Travel, Subscriptions, Other
- Monthly columns with row totals
- Subtotals for each section
- NET INCOME row at bottom (Income - All Expenses)
- Professional formatting matching finance industry standards
- Typecheck passes
- Verify in browser

---

#### US-011: Create Balance Sheet Sheet
**Description:** As a user, I want a Balance Sheet view of my accounts.

**Acceptance Criteria:**
- Sheet named "Balance Sheet"
- ASSETS section: List each account with current balance
- LIABILITIES section: List credit cards with balances
- NET WORTH calculation at bottom
- Account type groupings (Checking, Savings, Credit Cards)
- Note: This is a point-in-time snapshot, not monthly columns
- Typecheck passes
- Verify in browser

---

#### US-012: Create Cash Flow Statement Sheet
**Description:** As a user, I want a Cash Flow Statement showing sources and uses.

**Acceptance Criteria:**
- Sheet named "Cash Flow"
- OPERATING: Net Income from P&L
- FINANCING: Credit card payments made, net credit card balance change
- NET CHANGE IN CASH
- Beginning Cash Balance (start of period)
- Ending Cash Balance (end of period)
- Reconciliation check (should match account balance changes)
- Monthly columns
- Typecheck passes
- Verify in browser

---

### Phase 4: Transaction Details & Formulas

#### US-013: Create Detailed Transactions Sheet
**Description:** As a user, I want access to all underlying transaction data.

**Acceptance Criteria:**
- Sheet named "Transactions"
- Columns: Date, Description, Amount, Category, Account, Type (Income/Expense/Transfer)
- Sorted by date (newest first)
- Filters enabled on header row
- Transactions that are excluded (transfers, CC payments) marked in Type column
- This sheet serves as the data source for all other sheets
- Typecheck passes

---

#### US-014: Implement Named Ranges
**Description:** As a developer, I want named ranges for key metrics so users can extend the spreadsheet.

**Acceptance Criteria:**
- Named range: TotalIncome
- Named range: TotalExpenses
- Named range: NetCashFlow
- Named range: SavingsRate
- Named range: TransactionData (the full transaction range)
- Named range: CategorySummary
- Documentation comment in Dashboard explaining named ranges
- Typecheck passes

---

#### US-015: Add SPARKLINE Trend Charts
**Description:** As a user, I want to see mini trend charts for key metrics.

**Acceptance Criteria:**
- SPARKLINE for monthly net cash flow trend in Dashboard
- SPARKLINE for each major category showing monthly trend
- SPARKLINE for income trend
- Charts embedded in cells next to the metrics they represent
- Appropriate colors (green for positive trends, red for negative)
- Typecheck passes
- Verify in browser

---

### Phase 5: AI Insights Generation

#### US-016: Generate Personalized Financial Insights
**Description:** As a user, I want Claude to analyze my finances and generate personalized insights.

**Acceptance Criteria:**
- Call Claude API with financial data summary
- Generate 4-6 insights covering:
  1. Overall financial health assessment
  2. Trend observation (improving/stable/declining)
  3. Biggest spending category context
  4. Savings rate assessment with benchmark
  5. One specific actionable observation
  6. One positive "win" to highlight
- Insights written for someone new to tracking finances
- Non-judgmental, factual tone with specific numbers
- Return as array of insight strings
- Typecheck passes

---

#### US-017: Embed Insights in Spreadsheet
**Description:** As a user, I want the AI insights visible in my exported spreadsheet.

**Acceptance Criteria:**
- Insights displayed in Dashboard "INSIGHTS" section
- Each insight on its own row
- Appropriate emoji prefix based on insight type
- Insights are static text (not formulas) generated at export time
- Typecheck passes
- Verify in browser

---

## Non-Goals

- Real-time sync with bank (export is point-in-time snapshot)
- Budget setting/tracking within the sheet (future feature)
- Investment account analysis (future feature)
- Tax categorization or tax prep features
- Multi-currency support
- Shared/family finance views

## Technical Considerations

- All changes build on existing `/src/lib/google-sheets.ts` and `/src/lib/financial-statement.ts`
- Reuse existing transaction classification logic
- Google Sheets API batchUpdate for efficiency
- Maintain existing OAuth flow
- New data structures should be TypeScript interfaces in `/src/types/index.ts`

## Success Metrics

- Export completes in under 10 seconds
- Dashboard answers "Am I okay?" within 5 seconds of viewing
- All formulas reference source data (no hardcoded values in summaries)
- Sheet works correctly when user adds new data manually

---

## Open Questions

1. Should we include projected values (e.g., "At this rate, you'll save $X this year")?
2. Should insights include comparison to national averages for context?
3. How much historical data should we include in the export (all time vs. configurable)?
