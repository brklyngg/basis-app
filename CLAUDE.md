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

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=development|sandbox|production
ANTHROPIC_API_KEY=
```

## Git Workflow

Always push commits to remote after committing (Vercel auto-deploys from main).

## Plaid API Docs

Key references for the Plaid integration:
- [/transactions/sync](https://plaid.com/docs/api/products/transactions/#transactionssync) - Uses `transactions_update_status` field, cursor-based pagination
- [Webhooks](https://plaid.com/docs/transactions/webhooks/) - `SYNC_UPDATES_AVAILABLE` for real-time updates
- [Errors](https://plaid.com/docs/errors/transactions/) - `PRODUCT_NOT_READY`, `ITEM_LOGIN_REQUIRED`, etc.
