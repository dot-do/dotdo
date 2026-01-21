# ADR-007: Financial Ledger for BusinessDO

## Status

Proposed

## Date

2026-01-21

## Context

The BusinessDO financial layer requires a robust ledger system for tracking money movement, balances, and financial transactions. Two primary approaches have emerged:

1. **TigerBeetle**: A purpose-built, high-performance double-entry accounting database
2. **Stripe**: Using Stripe's payment infrastructure as the source of truth for financial data

### BusinessDO Financial Requirements

The dotdo platform needs to support:

- Multi-tenant financial tracking (per-organization ledgers)
- Real-time balance queries and updates
- Usage-based billing with spend caps
- Subscription management and invoicing
- Multi-currency support (future)
- Audit trails and compliance
- Integration with payment processors

### Current Architecture Constraints

- **Durable Objects**: All state lives in DOs with SQLite storage
- **Edge Deployment**: Cloudflare Workers run at the edge globally
- **RPC-First**: Cap'n Web RPC handles all communication
- **No External Databases**: The v3 architecture avoids external database dependencies

## Options Evaluated

### Option 1: TigerBeetle (Dedicated Financial Database)

[TigerBeetle](https://tigerbeetle.com) is a purpose-built OLTP database designed specifically for financial transactions and double-entry accounting.

**Architecture:**
- Pre-defined schema: Accounts and Transfers only
- Double-entry enforcement at the database level
- Viewstamped Replication (VR) consensus protocol
- Strong Serializable consistency
- Immutable audit trail (transfers cannot be modified or deleted)

**Performance:**
- Designed for 1 million+ transactions per second
- Batched operations: up to 8,190 transactions per query
- Zero-lock, zero-contention design
- Sub-millisecond latency for most operations

**Client Library:**
- [Node.js client](https://www.npmjs.com/package/tigerbeetle-node) available (`tigerbeetle-node`)
- Requires Node.js >= 18
- Thread-safe, singleton pattern for automatic batching
- Uses BigInt for 64-bit integer fields

**Deployment:**
- Production: Linux >= 5.6 only
- Development: macOS, Windows supported
- Requires running TigerBeetle cluster separately
- No native WASM/edge deployment support

**Code Example:**
```typescript
import { createClient, Account, Transfer } from 'tigerbeetle-node'

const client = createClient({
  cluster_id: 0n,
  replica_addresses: ['3000'],
})

// Create accounts
await client.createAccounts([{
  id: 1n,
  ledger: 1,
  code: 1,
  flags: 0,
  debits_pending: 0n,
  debits_posted: 0n,
  credits_pending: 0n,
  credits_posted: 0n,
}])

// Create transfer (double-entry enforced)
await client.createTransfers([{
  id: 1n,
  debit_account_id: 1n,
  credit_account_id: 2n,
  amount: 1000n,
  ledger: 1,
  code: 1,
  flags: 0,
}])
```

### Option 2: Stripe as Source of Truth

[Stripe](https://stripe.com) provides payment processing with an internal double-entry ledger system.

**Architecture:**
- Stripe Ledger: Internal immutable log for financial data
- Treasury API: Banking-as-a-service with FinancialAccounts
- Double-entry accounting built into Revenue Recognition
- Transaction and TransactionEntry objects for granular tracking

**Capabilities:**
- 5 billion events per day processed
- 99.99% dollar volume verified within 4 days
- FDIC-eligible accounts via Treasury
- Built-in fraud prevention
- Multi-currency support (Treasury currently USD only)

**Integration Points:**
- Payment Intents for charges
- Subscriptions for recurring billing
- Invoices for one-time and usage-based billing
- Balance Transactions for money movement
- Treasury for embedded banking

**Code Example:**
```typescript
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Create customer with balance tracking
const customer = await stripe.customers.create({
  email: 'user@example.com',
  balance: 0, // Credit balance in cents
})

// Usage-based billing
const usageRecord = await stripe.subscriptionItems.createUsageRecord(
  subscriptionItemId,
  { quantity: 100, action: 'increment' }
)

// Check balance
const balance = await stripe.balance.retrieve()
```

### Option 3: Hybrid Approach (Recommended)

Use Stripe for actual money movement while maintaining a local ledger for real-time queries and internal accounting.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                        BusinessDO                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │  Local Ledger   │     │    Stripe Integration       │   │
│  │  (SQLite in DO) │────▶│    (Source of Truth)        │   │
│  └─────────────────┘     └─────────────────────────────┘   │
│         │                           │                       │
│         ▼                           ▼                       │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │ Real-time       │     │ Actual Money Movement       │   │
│  │ Balance Queries │     │ - Charges                   │   │
│  │ Internal Txns   │     │ - Payouts                   │   │
│  │ Usage Tracking  │     │ - Subscriptions             │   │
│  └─────────────────┘     └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Local Ledger Schema (SQLite):**
```sql
-- Accounts table
CREATE TABLE ledger_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'asset', 'liability', 'revenue', 'expense'
  currency TEXT DEFAULT 'USD',
  balance INTEGER DEFAULT 0,  -- in cents
  pending_balance INTEGER DEFAULT 0,
  stripe_id TEXT,  -- linked Stripe entity
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Journal entries (immutable)
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  debit_account_id TEXT NOT NULL,
  credit_account_id TEXT NOT NULL,
  amount INTEGER NOT NULL,  -- in cents
  description TEXT,
  reference_type TEXT,  -- 'stripe_payment', 'usage', 'internal'
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (debit_account_id) REFERENCES ledger_accounts(id),
  FOREIGN KEY (credit_account_id) REFERENCES ledger_accounts(id)
);

-- Index for fast balance queries
CREATE INDEX idx_entries_debit ON ledger_entries(debit_account_id, created_at);
CREATE INDEX idx_entries_credit ON ledger_entries(credit_account_id, created_at);
```

**Implementation Pattern:**
```typescript
// do/ledger/Ledger.ts
export class Ledger {
  constructor(private db: SqlStorage) {}

  async transfer(params: {
    debitAccountId: string
    creditAccountId: string
    amount: number
    description?: string
    referenceType?: string
    referenceId?: string
    idempotencyKey?: string
  }): Promise<LedgerEntry> {
    // Double-entry enforced via transaction
    return this.db.transaction(() => {
      // Create immutable entry
      const entry = this.createEntry(params)

      // Update account balances atomically
      this.updateBalance(params.debitAccountId, -params.amount)
      this.updateBalance(params.creditAccountId, params.amount)

      return entry
    })
  }

  async getBalance(accountId: string): Promise<Balance> {
    const account = this.db.get('ledger_accounts', accountId)
    return {
      available: account.balance,
      pending: account.pending_balance,
      total: account.balance + account.pending_balance,
    }
  }
}
```

## Decision

**Adopt the Hybrid Approach (Option 3)**: Implement a local double-entry ledger in SQLite within the Durable Object while using Stripe as the source of truth for actual money movement.

### Rationale

1. **Edge Compatibility**: TigerBeetle requires a separate server cluster and doesn't run in Cloudflare Workers. The local SQLite ledger runs directly in the DO.

2. **Real-time Performance**: Local ledger queries are sub-millisecond. Stripe API calls have network latency (100-500ms).

3. **Stripe Handles Money**: Let Stripe handle the hard parts: payment processing, fraud prevention, compliance, and actual money movement.

4. **Reconciliation**: The local ledger syncs with Stripe via webhooks. Stripe is authoritative for actual balances; local is for real-time queries.

5. **Auditability**: Both systems provide immutable audit trails. The local ledger captures internal transactions (usage tracking) that don't involve Stripe.

6. **Gradual Migration**: Can later evaluate TigerBeetle for specific high-volume scenarios (e.g., dedicated billing DO) if needed.

### Implementation Plan

**Phase 1: Local Ledger (Week 1-2)**
- Implement `@dotdo/ledger` module with SQLite schema
- Double-entry transfer operations
- Balance queries and history

**Phase 2: Stripe Integration (Week 2-3)**
- Stripe webhook handlers for payment events
- Reconciliation logic to sync balances
- Usage-based billing integration

**Phase 3: BusinessDO Integration (Week 3-4)**
- Wire ledger into BusinessDO
- Add spend caps and budget tracking
- Multi-org support

## Consequences

### Positive

- **Zero External Dependencies**: Ledger runs entirely within the DO's SQLite
- **Real-time Queries**: Sub-millisecond balance lookups
- **Edge-native**: Works in Cloudflare Workers without additional infrastructure
- **Stripe Ecosystem**: Access to Stripe's payments, subscriptions, invoicing, fraud prevention
- **Separation of Concerns**: Internal accounting separate from actual money movement
- **Flexibility**: Can add TigerBeetle later for specific high-throughput scenarios

### Negative

- **Custom Implementation**: Must build and maintain double-entry logic
- **Reconciliation Complexity**: Must keep local ledger in sync with Stripe
- **Not TigerBeetle's Performance**: Local SQLite won't match TigerBeetle's 1M+ TPS
- **Stripe Lock-in**: Deep integration with Stripe for payment processing

### Neutral

- **Eventual Consistency**: Local ledger may briefly diverge from Stripe (reconciled via webhooks)
- **Two Sources of Data**: Developers must understand when to query local vs Stripe
- **Webhook Reliability**: Depends on Stripe webhook delivery (they're highly reliable)

## Alternatives Considered

### Alternative 1: TigerBeetle Only

Run TigerBeetle cluster as the financial database with Stripe only for payment processing.

**Rejected because:**
- Requires separate infrastructure (Linux servers)
- Doesn't run on Cloudflare Workers edge
- Adds operational complexity
- Overkill for current scale

### Alternative 2: Stripe Only

Use Stripe Balance and Treasury APIs exclusively.

**Rejected because:**
- API latency for every balance query
- No support for internal/non-monetary transactions
- Limited customization of ledger structure
- Treasury currently USD-only

### Alternative 3: Build Custom TigerBeetle-like System

Implement TigerBeetle's double-entry primitives from scratch.

**Rejected because:**
- Significant engineering effort
- TigerBeetle's consensus protocol is complex
- SQLite + simple double-entry sufficient for current needs

### Alternative 4: Fragment or Modern Treasury

Use third-party ledger-as-a-service APIs.

**Rejected because:**
- External API dependency adds latency
- Another vendor relationship to manage
- Local SQLite sufficient for current needs

## References

- [TigerBeetle Documentation](https://docs.tigerbeetle.com)
- [TigerBeetle GitHub](https://github.com/tigerbeetle/tigerbeetle)
- [TigerBeetle Node.js Client](https://docs.tigerbeetle.com/coding/clients/node/)
- [Stripe Treasury Documentation](https://docs.stripe.com/treasury)
- [Stripe Ledger Blog Post](https://stripe.com/blog/ledger-stripe-system-for-tracking-and-validating-money-movement)
- [Jepsen Analysis: TigerBeetle](https://jepsen.io/analyses/tigerbeetle-0.16.11)
- [Double-Entry Bookkeeping in Ledger Systems](https://medium.com/@altuntasfatih42/how-to-build-a-double-entry-ledger-f69edcea825d)
- ADR-002: Durable Objects as Core Primitive
- ADR-003: RPC-First Communication
