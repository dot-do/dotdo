/**
 * Double-Entry Accounting Ledger - Stub Implementation
 *
 * This file contains type definitions and stub exports for the
 * double-entry accounting ledger. The actual implementation is
 * pending - all tests should FAIL.
 */

// =============================================================================
// Type Definitions
// =============================================================================

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type NormalBalance = 'debit' | 'credit'
export type TransactionStatus = 'draft' | 'posted' | 'voided'
export type Currency = string

export interface Account {
  id: string
  name: string
  type: AccountType
  code: string
  currency: Currency
  balance: number
  normalBalance: NormalBalance
  createdAt: Date
  updatedAt?: Date
}

export interface JournalEntry {
  id: string
  accountId: string
  debit: number
  credit: number
  currency?: Currency
  exchangeRate?: number
  functionalAmount?: number
  reference?: string
  memo?: string
}

export interface Transaction {
  id: string
  transactionNumber?: string
  date: Date
  description: string
  entries: JournalEntry[]
  status: TransactionStatus
  baseCurrency?: Currency
  postedAt?: Date
  voidedAt?: Date
  voidReason?: string
  isReversed?: boolean
  reversedByTransactionId?: string
  reversesTransactionId?: string
  reversalReason?: string
  createdAt: Date
  updatedAt?: Date
}

export interface AuditEntry {
  id: string
  transactionId: string
  action: 'created' | 'updated' | 'posted' | 'voided' | 'reversed'
  timestamp: Date
  userId?: string
  metadata?: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export interface TrialBalance {
  asOfDate: Date
  accounts: Array<{
    accountId: string
    accountName: string
    accountCode: string
    debitBalance: number
    creditBalance: number
  }>
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
}

export interface AccountingEquationVerification {
  assets: number
  liabilities: number
  equity: number
  isBalanced: boolean
}

export interface BalanceHealthCheck {
  hasDiscrepancies: boolean
  calculatedBalances: Map<string, number>
  storedBalances: Map<string, number>
  discrepancies: Array<{
    accountId: string
    calculated: number
    stored: number
    difference: number
  }>
}

export interface ReconciliationResult {
  isReconciled: boolean
  difference: number
  statementBalance: number
  bookBalance: number
  clearedItems: number
  unclearedItems: number
}

export interface LedgerConfiguration {
  functionalCurrency: Currency
}

export interface AuditReport {
  totalTransactions: number
  totalPosted: number
  totalVoided: number
  entries: AuditEntry[]
}

// =============================================================================
// Ledger Interface
// =============================================================================

export interface Ledger {
  // Account Management
  createAccount(params: {
    name: string
    type: AccountType
    code: string
    currency: Currency
  }): Promise<Account>

  getAccount(id: string): Promise<Account | null>
  getAccountByCode(code: string): Promise<Account | null>
  listAccounts(filter?: { type?: AccountType }): Promise<Account[]>

  // Configuration
  setFunctionalCurrency(currency: Currency): Promise<void>
  getConfiguration(): Promise<LedgerConfiguration>

  // Transaction Management
  createTransaction(params: {
    date: Date
    description: string
    entries: Array<{
      accountId: string
      debit: number
      credit: number
      currency?: Currency
      exchangeRate?: number
      functionalAmount?: number
      reference?: string
      memo?: string
    }>
    baseCurrency?: Currency
    userId?: string
    metadata?: Record<string, unknown>
  }): Promise<Transaction>

  getTransaction(id: string): Promise<Transaction | null>
  updateTransaction(
    id: string,
    updates: {
      description?: string
      entries?: Array<{
        accountId: string
        debit: number
        credit: number
      }>
    }
  ): Promise<Transaction>

  // Transaction Lifecycle
  postTransaction(id: string): Promise<Transaction>
  postTransactions(ids: string[]): Promise<Transaction[]>
  voidTransaction(id: string, params: { reason: string }): Promise<Transaction>
  reverseTransaction(
    id: string,
    params?: {
      date?: Date
      reason?: string
      autoPost?: boolean
    }
  ): Promise<Transaction>

  // Balance & Verification
  getTrialBalance(asOfDate?: Date): Promise<TrialBalance>
  getAccountBalanceAtDate(accountId: string, date: Date): Promise<number>
  verifyAccountingEquation(): Promise<AccountingEquationVerification>
  runBalanceHealthCheck(): Promise<BalanceHealthCheck>
  reconcileAccount(
    accountId: string,
    params: {
      statementDate: Date
      statementBalance: number
      items: Array<{
        date: Date
        amount: number
        cleared: boolean
      }>
    }
  ): Promise<ReconciliationResult>

  // Audit Trail
  getAuditLog(
    filter: {
      transactionId?: string
      accountId?: string
      action?: string
      startDate?: Date
      endDate?: Date
    },
    pagination?: { limit?: number; offset?: number }
  ): Promise<AuditEntry[]>

  updateAuditEntry(id: string, updates: Record<string, unknown>): Promise<void>

  generateAuditReport(params: {
    startDate: Date
    endDate: Date
  }): Promise<AuditReport>
}

// =============================================================================
// Factory Function - NOT IMPLEMENTED
// =============================================================================

export function createLedger(): Ledger {
  // This is intentionally not implemented - tests should FAIL
  throw new Error('Ledger not implemented - TDD RED phase')
}
