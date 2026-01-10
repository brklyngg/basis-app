# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Talk To Your Money (package name: "basis") is a personal finance AI chat application. Users connect bank accounts via Plaid and have conversations with Claude about their spending patterns. The AI analyzes transaction data and provides data-driven financial insights.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run lint     # Run ESLint
npm run start    # Start production server
```

## Tech Stack

- **Framework:** Next.js 16, React 19, TypeScript
- **Database/Auth:** Supabase (PostgreSQL + Auth with email OTP)
- **Banking:** Plaid API (transactions, account connections)
- **AI:** Anthropic Claude (claude-sonnet-4) with prompt caching
- **UI:** shadcn/ui, Tailwind CSS v4, Lucide icons

## Architecture

### Data Flow

```
User → Plaid Link → /api/plaid/exchange → Supabase (plaid_items)
                                              ↓
Dashboard ← /api/plaid/transactions ← Plaid transactionsSync
    ↓
analyzeTransactions() → FinancialSnapshot
    ↓
ChatInterface → /api/chat → Claude (with financial context) → Streaming response
                                                                    ↓
                                                            Supabase (chat_messages)
```

### Key Files

**API Routes** (`src/app/api/`):
- `plaid/link-token/route.ts` - Generate Plaid Link tokens (create and update modes)
- `plaid/exchange/route.ts` - Exchange public token for access token
- `plaid/transactions/route.ts` - Fetch transactions with pagination (handles 500+ transactions)
- `chat/route.ts` - Streaming chat with Claude, saves to Supabase
- `chat/history/route.ts` - GET/DELETE conversation history

**Core Logic** (`src/lib/`):
- `financial-analysis.ts` - Compute FinancialSnapshot from transactions (categories, merchants, recurring charges, discretionary ratio)
- `context-builder.ts` - Build financial context string for Claude
- `prompts.ts` - "Financial Maven" system prompt
- `plaid.ts` - Plaid client config and error code constants

**Types** (`src/types/index.ts`):
- `Transaction`, `Account` - Plaid data models
- `FinancialSnapshot`, `CategoryBreakdown`, `TopMerchant`, `RecurringCharge` - Analysis results
- `PlaidItemError`, `TransactionsResponse` - Error handling types

### Database Schema (Supabase)

**plaid_items** - Stores Plaid access tokens
- `user_id`, `access_token`, `item_id`, `institution_name`, `created_at`, `updated_at`
- RLS: users can only access their own items

**chat_messages** - Persists conversation history
- `user_id`, `role` (user|assistant), `content`, `created_at`
- RLS: users can only access their own messages

### Authentication Flow

1. User enters email on `/login` page
2. Supabase sends 6-digit OTP code via email (configured in Supabase dashboard email templates)
3. User enters code on same page, `verifyOtp()` exchanges it for session
4. Redirect to `/dashboard` on success
5. Middleware (`middleware.ts`) protects `/dashboard`, redirects unauthenticated users
6. `/auth/callback` route handler exists for potential future OAuth flows

### Plaid Error Handling

The app distinguishes between:
- **Reauth errors** (`ITEM_LOGIN_REQUIRED`, `INVALID_CREDENTIALS`, etc.) - Show reconnect banner
- **Temporary errors** (`INSTITUTION_DOWN`, etc.) - Show informational banner
- Error constants defined in `src/lib/plaid.ts`

### AI Integration

- Uses Claude Sonnet 4 with streaming responses
- Implements prompt caching via `cache_control: { type: "ephemeral" }` for system prompt and financial context
- Last 4 messages of conversation history sent for context
- "Financial Maven" persona: analytical, non-judgmental, data-driven

### Financial Statement Export (Google Sheets)

**Purpose**: Export analyst-grade financial statements to Google Sheets with proper handling of:
- Internal transfers (excluded from cash flow)
- Credit card payments (avoids double-counting with CC spending)
- Monthly aggregation with income, essential expenses, discretionary expenses
- Net cash flow and savings rate calculations

**New API Routes** (`src/app/api/`):
- `auth/google/route.ts` - Initiate Google OAuth flow
- `auth/google/callback/route.ts` - Handle OAuth callback, store tokens
- `export/sheets/route.ts` - Generate and create Google Sheets spreadsheet

**New Core Logic** (`src/lib/`):
- `transaction-classifier.ts` - Classify transactions (income, essential, discretionary, transfer, CC payment)
- `financial-statement.ts` - Build monthly aggregated financial statements
- `google-sheets.ts` - Create professionally formatted Google Sheets with batchUpdate API

**New Database Table**:
- `google_tokens` - Stores Google OAuth tokens (access_token, refresh_token, expires_at)

**UI Component**:
- `src/components/export-dialog.tsx` - Export modal with date range selection and Google OAuth flow

**Google Sheets Output Structure**:
- **Summary sheet**: Income, Essential Expenses, Discretionary Expenses, Net Cash Flow, Savings Rate by month
- **Detailed Categories sheet**: All Plaid categories with monthly breakdowns

**Environment Variables Required**:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
```

**Google Cloud Setup**:
1. Create project in Google Cloud Console
2. Enable Google Sheets API
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=development|sandbox|production
ANTHROPIC_API_KEY=

# For Google Sheets export (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
```

## Git Workflow

Always push commits to remote after committing (Vercel auto-deploys from main).

## Plaid API Docs

Key references for the Plaid integration:
- [/transactions/sync](https://plaid.com/docs/api/products/transactions/#transactionssync) - Uses `transactions_update_status` field, cursor-based pagination
- [Webhooks](https://plaid.com/docs/transactions/webhooks/) - `SYNC_UPDATES_AVAILABLE` for real-time updates
- [Errors](https://plaid.com/docs/errors/transactions/) - `PRODUCT_NOT_READY`, `ITEM_LOGIN_REQUIRED`, etc.

---

## Financial Analyst Best Practices (Google Sheets Formatting)

Follow these **industry-standard color codes** for all cell formatting in exported spreadsheets:

| Color | RGB Values | Usage |
|-------|------------|-------|
| **Blue** | `(0, 0, 255)` | Hard-coded inputs, historical data, manual assumptions |
| **Black** | `(0, 0, 0)` | Calculations and formulas referencing the same sheet |
| **Green** | `(0, 128, 0)` | References or links to other worksheets within the same file |
| **Red** | `(255, 0, 0)` | External links to data outside the model or critical errors/warnings |

### Google Sheets API Color Constants

Use these in `google-sheets.ts` for batchUpdate formatting:

```typescript
const FINANCIAL_COLORS = {
  // Text colors (financial analyst standard)
  INPUT_BLUE: { red: 0, green: 0, blue: 1 },           // Hard-coded inputs
  FORMULA_BLACK: { red: 0, green: 0, blue: 0 },        // Same-sheet formulas
  CROSSREF_GREEN: { red: 0, green: 0.5, blue: 0 },     // Cross-sheet references
  ERROR_RED: { red: 1, green: 0, blue: 0 },            // Errors/external links

  // Background colors
  HEADER_DARK: { red: 0.18, green: 0.24, blue: 0.30 }, // #2F3D4C
  SECTION_LIGHT: { red: 0.95, green: 0.95, blue: 0.95 }, // #F2F2F2
  POSITIVE_GREEN_BG: { red: 0.85, green: 0.95, blue: 0.85 }, // Light green for positive values
  NEGATIVE_RED_BG: { red: 0.95, green: 0.85, blue: 0.85 },   // Light red for negative values
};
```

### Operational Rules

1. **Structure:** Maintain strict separation of Inputs → Calculations → Outputs
2. **No hard-coded numbers in formulas:** All inputs should be in dedicated input cells (blue text)
3. **Named ranges:** Use for all key metrics to enable user extensibility
4. **Verification:** After writing to a sheet, verify using `sheets_read_range` or browser screenshot
5. **Token efficiency:** Pull specific ranges rather than entire sheets

### Sheet Organization Standard

```
Tab 1: Dashboard       - Executive summary (formula-driven, references other sheets)
Tab 2: Income Statement - P&L format with monthly columns
Tab 3: Balance Sheet    - Assets, Liabilities, Net Worth
Tab 4: Cash Flow        - Sources and Uses format
Tab 5: Transactions     - Raw data source (all formulas reference this)
```

### Export Quality Checklist

Before completing any export enhancement:
- [ ] Blue text for all hard-coded inputs
- [ ] Black text for same-sheet formulas
- [ ] Green text for cross-sheet references
- [ ] Headers frozen for navigation
- [ ] Named ranges created for key metrics
- [ ] All Dashboard values are formula-driven (not hard-coded)
- [ ] Balance sheet balances (Assets = Liabilities + Equity)
- [ ] Conditional formatting for positive/negative values
- [ ] Professional number formatting (currency, percentages)

### MCP Session Management

If context becomes cluttered during long Google Sheets sessions:
- `/context` - Check context window usage
- `/clear` + read key files - Reset while maintaining CLAUDE.md instructions
- `/mcp list` - Verify Google Drive MCP tools are available

### Financial Modeling Standard Sources

- [Wall Street Prep: Financial Modeling Best Practices](https://www.wallstreetprep.com/knowledge/financial-modeling-best-practices/)
- [Breaking Into Wall Street: Excel Best Practices](https://breakingintowallstreet.com/kb/finance/financial-modeling-best-practices/)
- [Macabacus: Model Readability](https://macabacus.com/blog/improving-model-readability-with-color-formatting)
- [Corporate Finance Institute: Model Documentation](https://corporatefinanceinstitute.com/resources/excel/documenting-excel-models-best-practices/)
