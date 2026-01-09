# Apple Wallet Integration Plan

## Executive Summary

This document outlines a strategy for integrating Apple Card, Apple Cash, and Apple Savings accounts into the Basis personal finance application. The primary path forward is through **Apple's FinanceKit API**, with fallback options for broader compatibility.

## Current Landscape

### Apple FinanceKit API (Primary Approach)

Apple introduced FinanceKit in iOS 17.4 (March 2024), providing official API access to:
- **Apple Card** transactions and balances
- **Apple Cash** transactions and balances
- **Apple Savings** (high-yield savings) transactions and balances

**Key characteristics:**
- On-device data only (no server-side access)
- User must explicitly authorize access per account
- Real-time transaction data (not just monthly statements)
- Requires iOS 17.4+ (US) or iOS 18.4+ (UK with Open Banking support)
- Launch partners: YNAB, Monarch, Copilot

**Limitations:**
- Excludes Apple Card Family participants
- Excludes Apple Cash Family (children's accounts)
- Native iOS only - no web API available

### Apple Card Issuer Transition
As of January 2026, Apple Card is transitioning from Goldman Sachs to JPMorgan Chase. This may affect API behavior during transition but FinanceKit should remain stable as it accesses on-device data.

---

## Technical Architecture

### Challenge: Web App vs Native API

Basis is currently a **Next.js web application**. FinanceKit is an **iOS-only native framework**. This fundamental mismatch requires an architectural decision.

### Recommended Architecture: Hybrid Approach

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S DEVICES                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────┐         ┌─────────────────────────────────┐  │
│   │   iOS App       │         │     Web Browser                  │  │
│   │  (Companion)    │         │   (basis-app.vercel.app)        │  │
│   │                 │         │                                  │  │
│   │ ┌─────────────┐ │         │  ┌────────────────────────────┐ │  │
│   │ │ FinanceKit  │ │         │  │  Dashboard                 │ │  │
│   │ │   Module    │ │         │  │  - Plaid Accounts          │ │  │
│   │ └──────┬──────┘ │         │  │  - Apple Accounts          │ │  │
│   │        │        │         │  │  - AI Chat                 │ │  │
│   │        ▼        │         │  └────────────────────────────┘ │  │
│   │  Sync to Cloud  │────────▶│                                  │  │
│   └─────────────────┘         └─────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SUPABASE BACKEND                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐  │
│   │   plaid_items   │   │  apple_accounts │   │ apple_txns      │  │
│   │                 │   │                 │   │                 │  │
│   │ - access_token  │   │ - account_id    │   │ - txn_id        │  │
│   │ - item_id       │   │ - account_type  │   │ - account_id    │  │
│   │ - institution   │   │ - display_name  │   │ - amount        │  │
│   └─────────────────┘   │ - last_synced   │   │ - merchant      │  │
│                         └─────────────────┘   │ - category_code │  │
│                                               │ - date          │  │
│                                               └─────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Options

### Option A: Native iOS Companion App (Recommended)

Build a lightweight iOS app solely for FinanceKit data sync.

**Pros:**
- Full access to FinanceKit API
- Best user experience for Apple ecosystem users
- Can leverage SwiftUI's `TransactionPicker` for account selection
- App Store distribution

**Cons:**
- Requires Apple Developer Program ($99/year)
- Requires FinanceKit entitlement approval from Apple
- Separate codebase to maintain
- Users must install additional app

**Development effort:** 4-6 weeks

### Option B: React Native / Expo Wrapper

Wrap the entire app in React Native with a native module for FinanceKit.

**Pros:**
- Single codebase (mostly)
- Can use existing React components via React Native Web
- expo-finance-kit package may provide bridge

**Cons:**
- Significant refactoring of existing Next.js app
- React Native Web has limitations
- Native module development required
- More complex build/deploy pipeline

**Development effort:** 8-12 weeks

### Option C: Capacitor PWA-to-Native

Use Capacitor to wrap the Next.js app as a native iOS app with a custom FinanceKit plugin.

**Pros:**
- Minimal changes to existing web codebase
- Single deploy target
- Capacitor has good plugin ecosystem

**Cons:**
- Custom Capacitor plugin needed for FinanceKit
- App Store deployment required
- Web-in-native can feel less native

**Development effort:** 6-8 weeks

### Option D: Manual CSV Import (Fallback)

Add file upload capability for Apple Card CSV/OFX exports.

**Pros:**
- Works today, no Apple approval needed
- Works for all users regardless of iOS version
- Simple implementation

**Cons:**
- Poor user experience (manual monthly exports)
- Data is stale (monthly statements only)
- No real-time balance information
- Users must remember to upload

**Development effort:** 1-2 weeks

---

## Recommended Phased Approach

### Phase 1: CSV Import (Immediate)
Ship manual import as a bridge solution while native integration is developed.

```
Timeline: 1-2 weeks
Deliverables:
- File upload UI component
- CSV/OFX parser for Apple Card format
- Data normalization to existing Transaction type
- Storage in new apple_transactions table
```

### Phase 2: Native iOS Companion App (Medium-term)
Build minimal iOS app focused solely on FinanceKit sync.

```
Timeline: 4-6 weeks (parallel with Phase 1)
Deliverables:
- Apply for FinanceKit entitlement
- SwiftUI app with FinanceKit integration
- Supabase Swift SDK for data sync
- Deep link to open web dashboard
- App Store submission
```

### Phase 3: Full Integration (Long-term)
Unify data from all sources in the AI analysis.

```
Timeline: 2-3 weeks after Phase 2
Deliverables:
- Unified transaction API serving both Plaid and Apple data
- Updated FinancialSnapshot analysis including Apple accounts
- Enhanced AI context with Apple-specific insights
- Account management UI for both connection types
```

---

## Technical Implementation Details

### Phase 1: CSV Import

#### New Database Table
```sql
-- Apple account connections (manual import tracking)
CREATE TABLE apple_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL, -- 'apple_card' | 'apple_cash' | 'apple_savings'
  display_name TEXT,
  last_import_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apple transactions from CSV import
CREATE TABLE apple_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES apple_accounts(id) ON DELETE CASCADE,
  external_id TEXT, -- From CSV if available
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT,
  category TEXT,
  amount DECIMAL(12,2) NOT NULL,
  transaction_type TEXT, -- 'debit' | 'credit'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, external_id)
);

-- RLS policies
ALTER TABLE apple_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE apple_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own apple_accounts"
  ON apple_accounts FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own apple_transactions"
  ON apple_transactions FOR ALL USING (auth.uid() = user_id);
```

#### CSV Parser (Apple Card Format)
```typescript
// src/lib/apple-card-parser.ts

interface AppleCardCSVRow {
  'Transaction Date': string;
  'Clearing Date': string;
  'Description': string;
  'Merchant': string;
  'Category': string;
  'Type': string;
  'Amount (USD)': string;
}

export function parseAppleCardCSV(csvContent: string): Transaction[] {
  // Apple Card CSV format:
  // Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)

  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');

  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = parseCSVLine(line);
      const row = Object.fromEntries(
        headers.map((h, i) => [h.trim(), values[i]?.trim()])
      ) as AppleCardCSVRow;

      return {
        id: generateId(row),
        date: row['Transaction Date'],
        name: row['Merchant'] || row['Description'],
        amount: parseFloat(row['Amount (USD)']) * (row['Type'] === 'Purchase' ? -1 : 1),
        category: mapAppleCategory(row['Category']),
        pending: false,
      };
    });
}

function mapAppleCategory(appleCategory: string): string {
  // Map Apple's categories to Plaid-compatible categories
  const mapping: Record<string, string> = {
    'Food & Drink': 'Food and Drink',
    'Shopping': 'Shops',
    'Transportation': 'Travel',
    'Entertainment': 'Recreation',
    'Health': 'Healthcare',
    'Services': 'Service',
    // ... etc
  };
  return mapping[appleCategory] || appleCategory;
}
```

#### API Route
```typescript
// src/app/api/apple/import/route.ts

import { createClient } from '@/lib/supabase/server';
import { parseAppleCardCSV } from '@/lib/apple-card-parser';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;
  const accountType = formData.get('accountType') as string;

  const csvContent = await file.text();
  const transactions = parseAppleCardCSV(csvContent);

  // Upsert account
  const { data: account } = await supabase
    .from('apple_accounts')
    .upsert({
      user_id: user.id,
      account_type: accountType,
      display_name: 'Apple Card',
      last_import_at: new Date().toISOString(),
    })
    .select()
    .single();

  // Insert transactions (skip duplicates)
  const { error } = await supabase
    .from('apple_transactions')
    .upsert(
      transactions.map(t => ({
        user_id: user.id,
        account_id: account.id,
        external_id: t.id,
        transaction_date: t.date,
        description: t.name,
        amount: t.amount,
        category: t.category,
      })),
      { onConflict: 'user_id,external_id' }
    );

  return Response.json({
    imported: transactions.length,
    accountId: account.id
  });
}
```

### Phase 2: iOS Companion App

#### FinanceKit Entitlement Request

1. Go to https://developer.apple.com/contact/request/financekit
2. Submit request with:
   - App name: "Basis - Talk To Your Money"
   - Bundle ID: `com.basis.financekit-sync`
   - Use case: "Personal finance management app allowing users to analyze spending across all accounts including Apple Card"
   - Expected approval time: 2-4 weeks

#### Swift Implementation

```swift
// BasisFinanceSync/ContentView.swift

import SwiftUI
import FinanceKit
import FinanceKitUI

struct ContentView: View {
    @State private var authStatus: FinanceAuthorizationStatus = .notDetermined
    @State private var accounts: [FinanceKit.Account] = []
    @State private var isSyncing = false
    @State private var lastSyncDate: Date?

    private let store = FinanceStore.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if !FinanceStore.isDataAvailable(.financialData) {
                    UnavailableView()
                } else {
                    switch authStatus {
                    case .authorized:
                        AuthorizedView(
                            accounts: accounts,
                            isSyncing: isSyncing,
                            lastSyncDate: lastSyncDate,
                            onSync: syncData
                        )
                    case .denied:
                        DeniedView()
                    default:
                        RequestAccessView(onRequest: requestAccess)
                    }
                }
            }
            .navigationTitle("Basis Sync")
            .task {
                await checkAuthStatus()
            }
        }
    }

    private func checkAuthStatus() async {
        authStatus = await store.authorizationStatus()
        if authStatus == .authorized {
            await loadAccounts()
        }
    }

    private func requestAccess() async {
        authStatus = await store.requestAuthorization()
        if authStatus == .authorized {
            await loadAccounts()
            await syncData()
        }
    }

    private func loadAccounts() async {
        do {
            let query = AccountQuery()
            accounts = try await store.accounts(query: query)
        } catch {
            print("Failed to load accounts: \(error)")
        }
    }

    private func syncData() async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            // Fetch all transactions from last 90 days
            let calendar = Calendar.current
            let endDate = Date()
            let startDate = calendar.date(byAdding: .day, value: -90, to: endDate)!

            let query = TransactionQuery(
                transactionDateInterval: DateInterval(start: startDate, end: endDate)
            )

            let transactions = try await store.transactions(query: query)

            // Sync to Supabase
            await SupabaseSync.shared.syncTransactions(
                transactions: transactions,
                accounts: accounts
            )

            lastSyncDate = Date()
        } catch {
            print("Sync failed: \(error)")
        }
    }
}
```

```swift
// BasisFinanceSync/SupabaseSync.swift

import Foundation
import FinanceKit
import Supabase

class SupabaseSync {
    static let shared = SupabaseSync()

    private let client: SupabaseClient

    init() {
        client = SupabaseClient(
            supabaseURL: URL(string: Config.supabaseURL)!,
            supabaseKey: Config.supabaseAnonKey
        )
    }

    func syncTransactions(
        transactions: [FinanceKit.Transaction],
        accounts: [FinanceKit.Account]
    ) async {
        guard let userId = try? await client.auth.session.user.id else {
            return
        }

        // Sync accounts first
        for account in accounts {
            let accountData = AppleAccountRecord(
                userId: userId,
                accountId: account.id.uuidString,
                accountType: mapAccountType(account),
                displayName: account.displayName,
                currentBalance: account.currentBalance?.amount.description,
                lastSynced: Date()
            )

            try? await client
                .from("apple_accounts")
                .upsert(accountData)
                .execute()
        }

        // Sync transactions in batches
        let batchSize = 100
        for batch in transactions.chunked(into: batchSize) {
            let records = batch.map { txn in
                AppleTransactionRecord(
                    userId: userId,
                    accountId: txn.accountID.uuidString,
                    externalId: txn.id.uuidString,
                    transactionDate: txn.transactionDate,
                    description: txn.originalTransactionDescription,
                    merchant: txn.merchantName,
                    category: txn.merchantCategoryCode?.description,
                    amount: txn.transactionAmount.amount,
                    transactionType: txn.creditDebitIndicator == .credit ? "credit" : "debit"
                )
            }

            try? await client
                .from("apple_transactions")
                .upsert(records, onConflict: "user_id,external_id")
                .execute()
        }
    }

    private func mapAccountType(_ account: FinanceKit.Account) -> String {
        switch account.accountType {
        case .credit: return "apple_card"
        case .asset:
            if account.displayName?.contains("Cash") == true {
                return "apple_cash"
            }
            return "apple_savings"
        default: return "unknown"
        }
    }
}
```

#### Info.plist Requirements
```xml
<key>NSFinancialDataUsageDescription</key>
<string>Basis uses your Apple Card and Apple Cash data to provide personalized financial insights and help you understand your spending patterns.</string>
```

### Phase 3: Unified Data Layer

#### Updated Transactions API
```typescript
// src/app/api/transactions/route.ts

import { createClient } from '@/lib/supabase/server';
import { plaidClient } from '@/lib/plaid';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch Plaid transactions
  const plaidTransactions = await fetchPlaidTransactions(supabase, user.id);

  // Fetch Apple transactions
  const { data: appleTransactions } = await supabase
    .from('apple_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('transaction_date', { ascending: false });

  // Normalize Apple transactions to common format
  const normalizedApple = (appleTransactions || []).map(t => ({
    id: `apple_${t.id}`,
    date: t.transaction_date,
    name: t.merchant || t.description,
    amount: t.amount,
    category: t.category || 'Uncategorized',
    pending: false,
    source: 'apple' as const,
  }));

  // Merge and sort by date
  const allTransactions = [
    ...plaidTransactions.map(t => ({ ...t, source: 'plaid' as const })),
    ...normalizedApple,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Fetch accounts from both sources
  const plaidAccounts = await fetchPlaidAccounts(supabase, user.id);

  const { data: appleAccounts } = await supabase
    .from('apple_accounts')
    .select('*')
    .eq('user_id', user.id);

  const normalizedAppleAccounts = (appleAccounts || []).map(a => ({
    id: `apple_${a.id}`,
    name: a.display_name || 'Apple Account',
    type: mapAppleAccountType(a.account_type),
    subtype: a.account_type,
    balance: a.current_balance,
    institution: 'Apple',
    source: 'apple' as const,
  }));

  return Response.json({
    transactions: allTransactions,
    accounts: [...plaidAccounts, ...normalizedAppleAccounts],
    syncStatus: 'ready',
  });
}
```

#### Enhanced Financial Analysis
```typescript
// src/lib/financial-analysis.ts (additions)

export function analyzeTransactions(
  transactions: Transaction[],
  options?: { includeAppleInsights?: boolean }
): FinancialSnapshot {
  // Existing analysis...
  const snapshot = calculateBaseSnapshot(transactions);

  if (options?.includeAppleInsights) {
    // Add Apple-specific insights
    const appleTransactions = transactions.filter(
      t => (t as any).source === 'apple'
    );

    if (appleTransactions.length > 0) {
      snapshot.appleInsights = {
        dailyCashbackEstimate: estimateDailyCash(appleTransactions),
        appleCardSpending: sumAmount(appleTransactions),
        topApplePayMerchants: getTopMerchants(appleTransactions, 5),
      };
    }
  }

  return snapshot;
}
```

---

## Data Model Mapping

### FinanceKit → Basis Type Mapping

| FinanceKit Property | Basis Property | Notes |
|---------------------|----------------|-------|
| `transaction.id` | `id` | UUID, unique per device |
| `transaction.transactionDate` | `date` | ISO date string |
| `transaction.merchantName` | `name` | Falls back to `originalTransactionDescription` |
| `transaction.transactionAmount.amount` | `amount` | Apply sign based on `creditDebitIndicator` |
| `transaction.merchantCategoryCode` | `category` | ISO 18245 MCC, needs mapping |
| `transaction.status` | `pending` | `.pending` vs `.posted`/`.booked` |

### Category Mapping (MCC to Plaid-style)

```typescript
// ISO 18245 MCC to Plaid category mapping
const MCC_CATEGORY_MAP: Record<string, string> = {
  // Airlines (3000-3350)
  '3000-3350': 'Travel',

  // Restaurants (5811-5814)
  '5811': 'Food and Drink',
  '5812': 'Food and Drink',
  '5813': 'Food and Drink', // Bars
  '5814': 'Food and Drink', // Fast food

  // Grocery (5411, 5422, 5441, 5451, 5462)
  '5411': 'Food and Drink',
  '5422': 'Food and Drink', // Meat markets
  '5441': 'Food and Drink', // Candy stores
  '5451': 'Food and Drink', // Dairy stores
  '5462': 'Food and Drink', // Bakeries

  // Gas stations (5541, 5542)
  '5541': 'Travel',
  '5542': 'Travel',

  // Streaming/Digital (5815-5818)
  '5815': 'Service', // Digital goods
  '5816': 'Recreation', // Games
  '5817': 'Service', // Software
  '5818': 'Recreation', // Streaming

  // ... etc
};
```

---

## Security Considerations

### Data Privacy

1. **On-device processing**: FinanceKit data never leaves the device except through explicit user-initiated sync
2. **Encrypted at rest**: Supabase encrypts all data at rest
3. **Row-Level Security**: All tables use RLS ensuring users only access their own data
4. **No access tokens**: Unlike Plaid, FinanceKit doesn't use persistent tokens - authorization is session-based

### Authentication Flow

```
iOS App                          Supabase                         Web App
   │                                │                                │
   ├─── Login with Apple ──────────►│                                │
   │◄── Session token ──────────────┤                                │
   │                                │                                │
   ├─── Sync transactions ─────────►│                                │
   │    (with session token)        │                                │
   │                                │                                │
   │                                │◄─── Fetch transactions ────────┤
   │                                │     (same user session)        │
   │                                ├─── Return unified data ───────►│
```

### Entitlement Security

- FinanceKit entitlement is bound to a specific bundle ID
- Apple reviews apps before granting entitlements
- Runtime checks prevent unauthorized access attempts

---

## Timeline & Milestones

| Phase | Duration | Milestone |
|-------|----------|-----------|
| **Phase 1** | Week 1-2 | CSV import live in production |
| **Entitlement** | Week 2-6 | FinanceKit entitlement approved |
| **Phase 2** | Week 3-8 | iOS companion app in TestFlight |
| **Phase 2** | Week 9 | iOS app submitted to App Store |
| **Phase 3** | Week 10-12 | Unified dashboard with all sources |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| FinanceKit entitlement denied | Low | High | Prepare detailed use case; fallback to CSV-only |
| Apple API changes | Low | Medium | Abstract FinanceKit behind interface |
| JPMorgan transition issues | Medium | Low | FinanceKit is device-local, not bank-dependent |
| iOS version adoption | Medium | Medium | Maintain CSV import as fallback for older devices |
| App Store rejection | Low | High | Follow Human Interface Guidelines; clear privacy policy |

---

## Open Questions

1. **Single app vs separate?**
   - Should the iOS app be standalone or should we convert the whole web app to React Native?
   - Recommendation: Standalone sync app is simpler to maintain

2. **Sync frequency?**
   - On-demand only, or background refresh?
   - Recommendation: Start with on-demand; add background refresh in v2

3. **Account linking?**
   - How to associate iOS app user with web app user?
   - Recommendation: Sign in with Apple on both platforms

4. **UK Open Banking?**
   - iOS 18.4 adds UK bank support via FinanceKit
   - Should we expand scope to include UK banks?
   - Recommendation: Focus on US Apple accounts first

---

## References

- [Apple FinanceKit Documentation](https://developer.apple.com/documentation/financekit)
- [Meet FinanceKit - WWDC24](https://developer.apple.com/videos/play/wwdc2024/2023/)
- [FinanceKit Entitlement Request](https://developer.apple.com/contact/request/financekit)
- [Apple Card Export Guide](https://support.apple.com/en-us/102284)
- [TechCrunch: Apple FinanceKit Launch](https://techcrunch.com/2024/03/06/apple-releases-a-new-api-to-fetch-transactions-from-apple-card-and-apple-cash/)
- [MacStories: FinanceKit Coverage](https://www.macstories.net/linked/financekit-opens-real-time-apple-card-apple-cash-and-apple-savings-transaction-data-to-third-party-apps/)

---

## Appendix: Alternative Approaches Considered

### Screen Scraping (Not Recommended)
- Violates Apple ToS
- Fragile to UI changes
- Security/privacy concerns

### Goldman Sachs API (Not Available)
- Goldman Sachs does not provide a public API for Apple Card
- Transitioning to JPMorgan Chase anyway

### Plaid Apple Card Support (Not Available)
- Plaid does not support Apple Card connections
- Apple's walled garden approach prevents third-party aggregators
