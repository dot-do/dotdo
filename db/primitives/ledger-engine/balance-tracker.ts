/**
 * Multi-Currency Balance Tracker
 *
 * Tracks account balances in multiple currencies with:
 * - Per-currency balance tracking
 * - Functional currency totals
 * - Balance history by date
 * - Currency-specific debit/credit tracking
 * - Revaluation support
 *
 * @module db/primitives/ledger-engine/balance-tracker
 */

import type { CurrencyCode, ExchangeRate } from '../accounting/currency'

// =============================================================================
// Types
// =============================================================================

/**
 * Balance in a single currency
 */
export interface CurrencyBalance {
  currency: CurrencyCode
  debitTotal: number
  creditTotal: number
  balance: number
  transactionCount: number
  lastExchangeRate?: number
  lastRateDate?: Date
  functionalEquivalent?: number
}

/**
 * All currency balances for an account
 */
export interface AccountCurrencyBalances {
  accountId: string
  functionalCurrency: CurrencyCode
  functionalBalance: number
  currencyBalances: Map<CurrencyCode, CurrencyBalance>
  totalUnrealizedFxGainLoss: number
  lastUpdated: Date
}

/**
 * Balance entry for tracking
 */
export interface BalanceEntry {
  accountId: string
  currency: CurrencyCode
  debit: number
  credit: number
  exchangeRate: number
  rateDate: Date
  functionalAmount: number
  transactionId: string
  timestamp: Date
}

/**
 * Balance snapshot at a point in time
 */
export interface BalanceSnapshot {
  accountId: string
  date: Date
  balances: Map<CurrencyCode, CurrencyBalance>
  functionalBalance: number
}

/**
 * Revaluation entry
 */
export interface RevaluationEntry {
  accountId: string
  currency: CurrencyCode
  originalRate: number
  newRate: number
  originalFunctionalAmount: number
  newFunctionalAmount: number
  gainLoss: number
  revaluedAt: Date
}

/**
 * Balance tracker interface
 */
export interface BalanceTracker {
  // Configuration
  setFunctionalCurrency(currency: CurrencyCode): void
  getFunctionalCurrency(): CurrencyCode

  // Balance Recording
  recordEntry(entry: BalanceEntry): void
  recordEntries(entries: BalanceEntry[]): void

  // Balance Queries
  getAccountBalances(accountId: string): AccountCurrencyBalances | null
  getAccountCurrencyBalance(accountId: string, currency: CurrencyCode): CurrencyBalance | null
  getAccountFunctionalBalance(accountId: string): number

  // Balance at Date
  getBalanceAtDate(accountId: string, date: Date): BalanceSnapshot | null
  getBalanceHistory(
    accountId: string,
    options: { startDate: Date; endDate: Date }
  ): BalanceSnapshot[]

  // Revaluation
  revalueAccount(
    accountId: string,
    currency: CurrencyCode,
    newRate: number,
    rateDate: Date
  ): RevaluationEntry | null

  revalueAllAccounts(
    rates: Map<CurrencyCode, ExchangeRate>,
    rateDate: Date
  ): RevaluationEntry[]

  // Bulk Operations
  getAllAccountIds(): string[]
  getAllBalances(): Map<string, AccountCurrencyBalances>

  // Totals
  getTotalsByType(accountType: string): {
    functionalTotal: number
    byCurrency: Map<CurrencyCode, number>
  }

  // Reset
  clearAccount(accountId: string): void
  clearAll(): void
}

// =============================================================================
// Implementation
// =============================================================================

class BalanceTrackerImpl implements BalanceTracker {
  private functionalCurrency: CurrencyCode = 'USD'
  private accountBalances: Map<string, AccountCurrencyBalances> = new Map()
  private balanceHistory: Map<string, BalanceSnapshot[]> = new Map()
  private accountTypes: Map<string, string> = new Map()

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setFunctionalCurrency(currency: CurrencyCode): void {
    this.functionalCurrency = currency
  }

  getFunctionalCurrency(): CurrencyCode {
    return this.functionalCurrency
  }

  // ===========================================================================
  // Balance Recording
  // ===========================================================================

  recordEntry(entry: BalanceEntry): void {
    let accountBalance = this.accountBalances.get(entry.accountId)

    if (!accountBalance) {
      accountBalance = {
        accountId: entry.accountId,
        functionalCurrency: this.functionalCurrency,
        functionalBalance: 0,
        currencyBalances: new Map(),
        totalUnrealizedFxGainLoss: 0,
        lastUpdated: new Date(),
      }
      this.accountBalances.set(entry.accountId, accountBalance)
    }

    // Get or create currency balance
    let currencyBalance = accountBalance.currencyBalances.get(entry.currency)

    if (!currencyBalance) {
      currencyBalance = {
        currency: entry.currency,
        debitTotal: 0,
        creditTotal: 0,
        balance: 0,
        transactionCount: 0,
      }
      accountBalance.currencyBalances.set(entry.currency, currencyBalance)
    }

    // Update currency balance
    currencyBalance.debitTotal += entry.debit
    currencyBalance.creditTotal += entry.credit
    currencyBalance.balance = currencyBalance.debitTotal - currencyBalance.creditTotal
    currencyBalance.transactionCount += 1
    currencyBalance.lastExchangeRate = entry.exchangeRate
    currencyBalance.lastRateDate = entry.rateDate

    // Update functional equivalent
    if (entry.currency === this.functionalCurrency) {
      currencyBalance.functionalEquivalent = currencyBalance.balance
    } else {
      currencyBalance.functionalEquivalent = currencyBalance.balance * entry.exchangeRate
    }

    // Update account functional balance
    accountBalance.functionalBalance += entry.functionalAmount
    accountBalance.lastUpdated = entry.timestamp

    // Record snapshot for history
    this.recordSnapshot(entry.accountId, entry.timestamp)
  }

  recordEntries(entries: BalanceEntry[]): void {
    for (const entry of entries) {
      this.recordEntry(entry)
    }
  }

  private recordSnapshot(accountId: string, date: Date): void {
    const accountBalance = this.accountBalances.get(accountId)
    if (!accountBalance) return

    const snapshot: BalanceSnapshot = {
      accountId,
      date: new Date(date),
      balances: new Map(accountBalance.currencyBalances),
      functionalBalance: accountBalance.functionalBalance,
    }

    let history = this.balanceHistory.get(accountId)
    if (!history) {
      history = []
      this.balanceHistory.set(accountId, history)
    }

    // Keep snapshots sorted by date
    history.push(snapshot)
    history.sort((a, b) => a.date.getTime() - b.date.getTime())

    // Limit history to last 1000 snapshots
    if (history.length > 1000) {
      history.shift()
    }
  }

  // ===========================================================================
  // Balance Queries
  // ===========================================================================

  getAccountBalances(accountId: string): AccountCurrencyBalances | null {
    return this.accountBalances.get(accountId) ?? null
  }

  getAccountCurrencyBalance(accountId: string, currency: CurrencyCode): CurrencyBalance | null {
    const accountBalance = this.accountBalances.get(accountId)
    if (!accountBalance) return null
    return accountBalance.currencyBalances.get(currency) ?? null
  }

  getAccountFunctionalBalance(accountId: string): number {
    const accountBalance = this.accountBalances.get(accountId)
    return accountBalance?.functionalBalance ?? 0
  }

  // ===========================================================================
  // Balance at Date
  // ===========================================================================

  getBalanceAtDate(accountId: string, date: Date): BalanceSnapshot | null {
    const history = this.balanceHistory.get(accountId)
    if (!history || history.length === 0) return null

    const targetTime = date.getTime()

    // Find the most recent snapshot on or before the date
    let result: BalanceSnapshot | null = null

    for (const snapshot of history) {
      if (snapshot.date.getTime() <= targetTime) {
        result = snapshot
      } else {
        break
      }
    }

    return result
  }

  getBalanceHistory(
    accountId: string,
    options: { startDate: Date; endDate: Date }
  ): BalanceSnapshot[] {
    const history = this.balanceHistory.get(accountId)
    if (!history) return []

    const startTime = options.startDate.getTime()
    const endTime = options.endDate.getTime()

    return history.filter((snapshot) => {
      const snapshotTime = snapshot.date.getTime()
      return snapshotTime >= startTime && snapshotTime <= endTime
    })
  }

  // ===========================================================================
  // Revaluation
  // ===========================================================================

  revalueAccount(
    accountId: string,
    currency: CurrencyCode,
    newRate: number,
    rateDate: Date
  ): RevaluationEntry | null {
    const accountBalance = this.accountBalances.get(accountId)
    if (!accountBalance) return null

    const currencyBalance = accountBalance.currencyBalances.get(currency)
    if (!currencyBalance) return null

    // Can't revalue functional currency
    if (currency === this.functionalCurrency) return null

    const originalRate = currencyBalance.lastExchangeRate ?? 1
    const originalFunctionalAmount = currencyBalance.functionalEquivalent ?? 0
    const newFunctionalAmount = currencyBalance.balance * newRate
    const gainLoss = newFunctionalAmount - originalFunctionalAmount

    // Update the balance
    currencyBalance.lastExchangeRate = newRate
    currencyBalance.lastRateDate = rateDate
    currencyBalance.functionalEquivalent = newFunctionalAmount

    // Update account unrealized FX gain/loss
    accountBalance.totalUnrealizedFxGainLoss += gainLoss

    // Recalculate functional balance from all currencies
    let totalFunctional = 0
    for (const [, balance] of accountBalance.currencyBalances) {
      totalFunctional += balance.functionalEquivalent ?? 0
    }
    accountBalance.functionalBalance = totalFunctional
    accountBalance.lastUpdated = rateDate

    const entry: RevaluationEntry = {
      accountId,
      currency,
      originalRate,
      newRate,
      originalFunctionalAmount,
      newFunctionalAmount,
      gainLoss,
      revaluedAt: rateDate,
    }

    // Record snapshot after revaluation
    this.recordSnapshot(accountId, rateDate)

    return entry
  }

  revalueAllAccounts(
    rates: Map<CurrencyCode, ExchangeRate>,
    rateDate: Date
  ): RevaluationEntry[] {
    const entries: RevaluationEntry[] = []

    for (const [accountId, accountBalance] of this.accountBalances) {
      for (const [currency] of accountBalance.currencyBalances) {
        if (currency === this.functionalCurrency) continue

        const rate = rates.get(currency)
        if (!rate) continue

        const entry = this.revalueAccount(accountId, currency, rate.rate, rateDate)
        if (entry && entry.gainLoss !== 0) {
          entries.push(entry)
        }
      }
    }

    return entries
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  getAllAccountIds(): string[] {
    return Array.from(this.accountBalances.keys())
  }

  getAllBalances(): Map<string, AccountCurrencyBalances> {
    return new Map(this.accountBalances)
  }

  // ===========================================================================
  // Totals by Type
  // ===========================================================================

  setAccountType(accountId: string, type: string): void {
    this.accountTypes.set(accountId, type)
  }

  getTotalsByType(accountType: string): {
    functionalTotal: number
    byCurrency: Map<CurrencyCode, number>
  } {
    let functionalTotal = 0
    const byCurrency = new Map<CurrencyCode, number>()

    for (const [accountId, accountBalance] of this.accountBalances) {
      const type = this.accountTypes.get(accountId)
      if (type !== accountType) continue

      functionalTotal += accountBalance.functionalBalance

      for (const [currency, currencyBalance] of accountBalance.currencyBalances) {
        const existing = byCurrency.get(currency) ?? 0
        byCurrency.set(currency, existing + currencyBalance.balance)
      }
    }

    return { functionalTotal, byCurrency }
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  clearAccount(accountId: string): void {
    this.accountBalances.delete(accountId)
    this.balanceHistory.delete(accountId)
    this.accountTypes.delete(accountId)
  }

  clearAll(): void {
    this.accountBalances.clear()
    this.balanceHistory.clear()
    this.accountTypes.clear()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new BalanceTracker instance
 */
export function createBalanceTracker(functionalCurrency: CurrencyCode = 'USD'): BalanceTracker {
  const tracker = new BalanceTrackerImpl()
  tracker.setFunctionalCurrency(functionalCurrency)
  return tracker
}
