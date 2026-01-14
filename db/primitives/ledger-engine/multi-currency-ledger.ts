/**
 * Multi-Currency Ledger - Core implementation
 *
 * A comprehensive double-entry accounting ledger with full multi-currency support.
 *
 * Features:
 * 1. Multi-currency transactions with automatic functional currency conversion
 * 2. Automatic FX gain/loss recognition (realized on settlement, unrealized on revaluation)
 * 3. Period-end currency revaluation
 * 4. Multi-currency trial balance and reporting
 * 5. Audit trail for all transactions and rate changes
 * 6. GAAP-compliant accounting treatment of foreign currency
 *
 * @module db/primitives/ledger-engine/multi-currency-ledger
 */

import type { CurrencyCode, CurrencyService, ExchangeRate, ConversionResult } from '../accounting/currency'
import { createCurrencyService } from '../accounting/currency'
import type { ExchangeRateProvider, RateUpdate } from './exchange-rate-provider'
import { createExchangeRateProvider } from './exchange-rate-provider'
import type { BalanceTracker, RevaluationEntry, BalanceEntry, AccountCurrencyBalances } from './balance-tracker'
import { createBalanceTracker } from './balance-tracker'

// =============================================================================
// Types
// =============================================================================

/**
 * Account types following GAAP
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/**
 * Normal balance side
 */
export type NormalBalance = 'debit' | 'credit'

/**
 * Transaction status
 */
export type TransactionStatus = 'draft' | 'posted' | 'voided' | 'reversed'

/**
 * Multi-currency account definition
 */
export interface MultiCurrencyAccount {
  id: string
  name: string
  code: string
  type: AccountType
  normalBalance: NormalBalance
  defaultCurrency?: CurrencyCode
  allowedCurrencies?: CurrencyCode[]
  isContra?: boolean
  parentId?: string
  description?: string
  createdAt: Date
  updatedAt?: Date
}

/**
 * Journal entry line with multi-currency support
 */
export interface MultiCurrencyJournalEntry {
  id: string
  accountId: string
  debit: number
  credit: number
  currency: CurrencyCode
  exchangeRate: number
  functionalDebit: number
  functionalCredit: number
  memo?: string
  reference?: string
}

/**
 * Multi-currency transaction
 */
export interface MultiCurrencyTransaction {
  id: string
  transactionNumber: string
  date: Date
  description: string
  entries: MultiCurrencyJournalEntry[]
  status: TransactionStatus
  baseCurrency?: CurrencyCode
  totalFunctionalDebit: number
  totalFunctionalCredit: number
  fxGainLossEntries?: FxGainLossEntry[]
  postedAt?: Date
  voidedAt?: Date
  voidReason?: string
  reversedByTransactionId?: string
  reversesTransactionId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt?: Date
}

/**
 * Multi-currency balance
 */
export interface MultiCurrencyBalance {
  accountId: string
  accountName: string
  accountType: AccountType
  functionalCurrency: CurrencyCode
  functionalBalance: number
  balancesByCurrency: Array<{
    currency: CurrencyCode
    balance: number
    exchangeRate: number
    functionalEquivalent: number
  }>
  unrealizedFxGainLoss: number
}

/**
 * FX gain/loss journal entry
 */
export interface FxGainLossEntry {
  id: string
  accountId: string
  currency: CurrencyCode
  originalRate: number
  currentRate: number
  originalAmount: number
  originalFunctionalAmount: number
  currentFunctionalAmount: number
  gainLoss: number
  isRealized: boolean
  transactionId?: string
  revaluationDate?: Date
  createdAt: Date
}

/**
 * Revaluation result
 */
export interface RevaluationResult {
  date: Date
  totalGainLoss: number
  entries: FxGainLossEntry[]
  journalTransactionId?: string
}

/**
 * Trial balance line
 */
export interface TrialBalanceLine {
  accountId: string
  accountName: string
  accountCode: string
  accountType: AccountType
  functionalDebit: number
  functionalCredit: number
  balancesByCurrency: Array<{
    currency: CurrencyCode
    debit: number
    credit: number
  }>
}

/**
 * Multi-currency trial balance
 */
export interface MultiCurrencyTrialBalance {
  asOfDate: Date
  functionalCurrency: CurrencyCode
  lines: TrialBalanceLine[]
  totalFunctionalDebits: number
  totalFunctionalCredits: number
  isBalanced: boolean
  difference: number
}

/**
 * Ledger configuration
 */
export interface MultiCurrencyLedgerConfig {
  functionalCurrency: CurrencyCode
  allowedCurrencies?: CurrencyCode[]
  autoPostFxGainLoss?: boolean
  fxGainAccount?: string
  fxLossAccount?: string
  unrealizedFxGainAccount?: string
  unrealizedFxLossAccount?: string
}

/**
 * Create transaction input
 */
export interface CreateTransactionInput {
  date: Date
  description: string
  entries: Array<{
    accountId: string
    debit: number
    credit: number
    currency?: CurrencyCode
    exchangeRate?: number
    memo?: string
    reference?: string
  }>
  baseCurrency?: CurrencyCode
  metadata?: Record<string, unknown>
}

/**
 * Multi-currency ledger interface
 */
export interface MultiCurrencyLedger {
  // Configuration
  getConfig(): MultiCurrencyLedgerConfig
  setConfig(config: Partial<MultiCurrencyLedgerConfig>): void

  // Account Management
  createAccount(params: {
    name: string
    code: string
    type: AccountType
    defaultCurrency?: CurrencyCode
    allowedCurrencies?: CurrencyCode[]
    isContra?: boolean
    parentId?: string
    description?: string
  }): MultiCurrencyAccount

  getAccount(id: string): MultiCurrencyAccount | null
  getAccountByCode(code: string): MultiCurrencyAccount | null
  listAccounts(filter?: { type?: AccountType }): MultiCurrencyAccount[]
  updateAccount(id: string, updates: Partial<MultiCurrencyAccount>): MultiCurrencyAccount

  // Transaction Management
  createTransaction(input: CreateTransactionInput): MultiCurrencyTransaction
  getTransaction(id: string): MultiCurrencyTransaction | null
  postTransaction(id: string): MultiCurrencyTransaction
  voidTransaction(id: string, reason: string): MultiCurrencyTransaction
  reverseTransaction(id: string, options?: { date?: Date; reason?: string }): MultiCurrencyTransaction

  // Balance Queries
  getAccountBalance(accountId: string): MultiCurrencyBalance | null
  getAccountBalanceAtDate(accountId: string, date: Date): MultiCurrencyBalance | null
  getTrialBalance(asOfDate?: Date): MultiCurrencyTrialBalance

  // Currency Operations
  setExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: { effectiveDate?: Date }
  ): ExchangeRate

  getExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: { date?: Date }
  ): ExchangeRate | null

  convertToFunctional(
    amount: number,
    currency: CurrencyCode,
    options?: { date?: Date }
  ): ConversionResult

  // Revaluation
  revalueForeignCurrencyBalances(
    asOfDate: Date,
    options?: { postJournalEntry?: boolean }
  ): RevaluationResult

  // FX Gain/Loss
  calculateRealizedFxGainLoss(
    accountId: string,
    currency: CurrencyCode,
    amount: number,
    originalRate: number,
    settlementRate: number
  ): FxGainLossEntry

  // Services
  getCurrencyService(): CurrencyService
  getExchangeRateProvider(): ExchangeRateProvider
  getBalanceTracker(): BalanceTracker
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function generateTransactionNumber(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `TXN-${year}${month}-${seq}`
}

function getNormalBalance(type: AccountType): NormalBalance {
  switch (type) {
    case 'asset':
    case 'expense':
      return 'debit'
    case 'liability':
    case 'equity':
    case 'revenue':
      return 'credit'
  }
}

// =============================================================================
// Implementation
// =============================================================================

class MultiCurrencyLedgerImpl implements MultiCurrencyLedger {
  private config: MultiCurrencyLedgerConfig
  private accounts: Map<string, MultiCurrencyAccount> = new Map()
  private accountsByCode: Map<string, string> = new Map()
  private transactions: Map<string, MultiCurrencyTransaction> = new Map()
  private currencyService: CurrencyService
  private exchangeRateProvider: ExchangeRateProvider
  private balanceTracker: BalanceTracker

  constructor(config: MultiCurrencyLedgerConfig) {
    this.config = {
      ...config,
      autoPostFxGainLoss: config.autoPostFxGainLoss ?? true,
      fxGainAccount: config.fxGainAccount ?? 'fx-gain',
      fxLossAccount: config.fxLossAccount ?? 'fx-loss',
      unrealizedFxGainAccount: config.unrealizedFxGainAccount ?? 'unrealized-fx-gain',
      unrealizedFxLossAccount: config.unrealizedFxLossAccount ?? 'unrealized-fx-loss',
    }

    this.currencyService = createCurrencyService({
      functionalCurrency: config.functionalCurrency,
      allowedCurrencies: config.allowedCurrencies,
    })

    this.exchangeRateProvider = createExchangeRateProvider({
      triangulationCurrency: config.functionalCurrency,
    })

    this.balanceTracker = createBalanceTracker(config.functionalCurrency)

    // Subscribe to rate updates
    this.exchangeRateProvider.subscribe((update: RateUpdate) => {
      // Sync rates with currency service
      this.currencyService.setExchangeRate(
        update.fromCurrency,
        update.toCurrency,
        update.newRate,
        { source: update.source }
      )
    })
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  getConfig(): MultiCurrencyLedgerConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<MultiCurrencyLedgerConfig>): void {
    this.config = { ...this.config, ...config }

    if (config.functionalCurrency) {
      this.currencyService.setFunctionalCurrency(config.functionalCurrency)
      this.balanceTracker.setFunctionalCurrency(config.functionalCurrency)
    }
  }

  // ===========================================================================
  // Account Management
  // ===========================================================================

  createAccount(params: {
    name: string
    code: string
    type: AccountType
    defaultCurrency?: CurrencyCode
    allowedCurrencies?: CurrencyCode[]
    isContra?: boolean
    parentId?: string
    description?: string
  }): MultiCurrencyAccount {
    const id = generateId('acc')
    const now = new Date()

    const account: MultiCurrencyAccount = {
      id,
      name: params.name,
      code: params.code,
      type: params.type,
      normalBalance: getNormalBalance(params.type),
      defaultCurrency: params.defaultCurrency ?? this.config.functionalCurrency,
      allowedCurrencies: params.allowedCurrencies,
      isContra: params.isContra,
      parentId: params.parentId,
      description: params.description,
      createdAt: now,
    }

    this.accounts.set(id, account)
    this.accountsByCode.set(params.code, id)

    return account
  }

  getAccount(id: string): MultiCurrencyAccount | null {
    return this.accounts.get(id) ?? null
  }

  getAccountByCode(code: string): MultiCurrencyAccount | null {
    const id = this.accountsByCode.get(code)
    if (!id) return null
    return this.accounts.get(id) ?? null
  }

  listAccounts(filter?: { type?: AccountType }): MultiCurrencyAccount[] {
    let accounts = Array.from(this.accounts.values())

    if (filter?.type) {
      accounts = accounts.filter((a) => a.type === filter.type)
    }

    return accounts.sort((a, b) => a.code.localeCompare(b.code))
  }

  updateAccount(id: string, updates: Partial<MultiCurrencyAccount>): MultiCurrencyAccount {
    const account = this.accounts.get(id)
    if (!account) {
      throw new Error('Account not found')
    }

    const updated: MultiCurrencyAccount = {
      ...account,
      ...updates,
      id: account.id, // Prevent ID change
      createdAt: account.createdAt, // Prevent createdAt change
      updatedAt: new Date(),
    }

    // Update code index if code changed
    if (updates.code && updates.code !== account.code) {
      this.accountsByCode.delete(account.code)
      this.accountsByCode.set(updates.code, id)
    }

    this.accounts.set(id, updated)
    return updated
  }

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  createTransaction(input: CreateTransactionInput): MultiCurrencyTransaction {
    const id = generateId('txn')
    const transactionNumber = generateTransactionNumber()
    const now = new Date()

    // Process entries with currency conversion
    const entries: MultiCurrencyJournalEntry[] = []
    let totalFunctionalDebit = 0
    let totalFunctionalCredit = 0

    for (const entry of input.entries) {
      const account = this.accounts.get(entry.accountId)
      if (!account) {
        throw new Error(`Account not found: ${entry.accountId}`)
      }

      const currency = entry.currency ?? account.defaultCurrency ?? this.config.functionalCurrency
      let exchangeRate = entry.exchangeRate ?? 1

      // Get exchange rate if not provided and not functional currency
      if (currency !== this.config.functionalCurrency && !entry.exchangeRate) {
        const rate = this.exchangeRateProvider.getRate(currency, this.config.functionalCurrency, {
          date: input.date,
        })
        if (!rate) {
          throw new Error(`No exchange rate found for ${currency} to ${this.config.functionalCurrency}`)
        }
        exchangeRate = rate.rate
      } else if (currency === this.config.functionalCurrency) {
        exchangeRate = 1
      }

      const functionalDebit = this.round(entry.debit * exchangeRate)
      const functionalCredit = this.round(entry.credit * exchangeRate)

      const journalEntry: MultiCurrencyJournalEntry = {
        id: generateId('je'),
        accountId: entry.accountId,
        debit: entry.debit,
        credit: entry.credit,
        currency,
        exchangeRate,
        functionalDebit,
        functionalCredit,
        memo: entry.memo,
        reference: entry.reference,
      }

      entries.push(journalEntry)
      totalFunctionalDebit += functionalDebit
      totalFunctionalCredit += functionalCredit
    }

    // Validate balance
    if (Math.abs(totalFunctionalDebit - totalFunctionalCredit) > 0.01) {
      throw new Error(
        `Transaction does not balance in functional currency: ` +
        `debits (${totalFunctionalDebit}) != credits (${totalFunctionalCredit})`
      )
    }

    const transaction: MultiCurrencyTransaction = {
      id,
      transactionNumber,
      date: input.date,
      description: input.description,
      entries,
      status: 'draft',
      baseCurrency: input.baseCurrency,
      totalFunctionalDebit,
      totalFunctionalCredit,
      metadata: input.metadata,
      createdAt: now,
    }

    this.transactions.set(id, transaction)
    return transaction
  }

  getTransaction(id: string): MultiCurrencyTransaction | null {
    return this.transactions.get(id) ?? null
  }

  postTransaction(id: string): MultiCurrencyTransaction {
    const transaction = this.transactions.get(id)
    if (!transaction) {
      throw new Error('Transaction not found')
    }

    if (transaction.status !== 'draft') {
      throw new Error('Only draft transactions can be posted')
    }

    const now = new Date()

    // Update account balances
    for (const entry of transaction.entries) {
      const balanceEntry: BalanceEntry = {
        accountId: entry.accountId,
        currency: entry.currency,
        debit: entry.debit,
        credit: entry.credit,
        exchangeRate: entry.exchangeRate,
        rateDate: transaction.date,
        functionalAmount: entry.functionalDebit - entry.functionalCredit,
        transactionId: transaction.id,
        timestamp: now,
      }
      this.balanceTracker.recordEntry(balanceEntry)
    }

    // Update transaction status
    transaction.status = 'posted'
    transaction.postedAt = now
    transaction.updatedAt = now

    return transaction
  }

  voidTransaction(id: string, reason: string): MultiCurrencyTransaction {
    const transaction = this.transactions.get(id)
    if (!transaction) {
      throw new Error('Transaction not found')
    }

    if (transaction.status === 'voided') {
      throw new Error('Transaction already voided')
    }

    if (transaction.status !== 'posted') {
      throw new Error('Only posted transactions can be voided')
    }

    const now = new Date()

    // Reverse the balance entries
    for (const entry of transaction.entries) {
      const reverseEntry: BalanceEntry = {
        accountId: entry.accountId,
        currency: entry.currency,
        debit: entry.credit, // Swap
        credit: entry.debit, // Swap
        exchangeRate: entry.exchangeRate,
        rateDate: now,
        functionalAmount: entry.functionalCredit - entry.functionalDebit, // Reversed
        transactionId: transaction.id,
        timestamp: now,
      }
      this.balanceTracker.recordEntry(reverseEntry)
    }

    transaction.status = 'voided'
    transaction.voidedAt = now
    transaction.voidReason = reason
    transaction.updatedAt = now

    return transaction
  }

  reverseTransaction(
    id: string,
    options?: { date?: Date; reason?: string }
  ): MultiCurrencyTransaction {
    const original = this.transactions.get(id)
    if (!original) {
      throw new Error('Transaction not found')
    }

    if (original.status !== 'posted') {
      throw new Error('Only posted transactions can be reversed')
    }

    if (original.reversedByTransactionId) {
      throw new Error('Transaction already reversed')
    }

    const reverseDate = options?.date ?? new Date()

    // Create reversal entries (swap debits and credits)
    const reversalInput: CreateTransactionInput = {
      date: reverseDate,
      description: `Reversal of ${original.transactionNumber}: ${original.description}`,
      entries: original.entries.map((entry) => ({
        accountId: entry.accountId,
        debit: entry.credit, // Swap
        credit: entry.debit, // Swap
        currency: entry.currency,
        exchangeRate: entry.exchangeRate, // Keep same rate
        memo: `Reversal: ${entry.memo ?? ''}`,
        reference: entry.reference,
      })),
      metadata: {
        reversesTransactionId: id,
        reversalReason: options?.reason,
      },
    }

    const reversalTransaction = this.createTransaction(reversalInput)
    reversalTransaction.reversesTransactionId = id

    // Post the reversal
    this.postTransaction(reversalTransaction.id)

    // Mark original as reversed
    original.reversedByTransactionId = reversalTransaction.id
    original.updatedAt = new Date()

    return reversalTransaction
  }

  // ===========================================================================
  // Balance Queries
  // ===========================================================================

  getAccountBalance(accountId: string): MultiCurrencyBalance | null {
    const account = this.accounts.get(accountId)
    if (!account) return null

    const balances = this.balanceTracker.getAccountBalances(accountId)
    if (!balances) {
      return {
        accountId,
        accountName: account.name,
        accountType: account.type,
        functionalCurrency: this.config.functionalCurrency,
        functionalBalance: 0,
        balancesByCurrency: [],
        unrealizedFxGainLoss: 0,
      }
    }

    const balancesByCurrency: Array<{
      currency: CurrencyCode
      balance: number
      exchangeRate: number
      functionalEquivalent: number
    }> = []

    for (const [currency, currencyBalance] of balances.currencyBalances) {
      balancesByCurrency.push({
        currency,
        balance: currencyBalance.balance,
        exchangeRate: currencyBalance.lastExchangeRate ?? 1,
        functionalEquivalent: currencyBalance.functionalEquivalent ?? 0,
      })
    }

    return {
      accountId,
      accountName: account.name,
      accountType: account.type,
      functionalCurrency: this.config.functionalCurrency,
      functionalBalance: balances.functionalBalance,
      balancesByCurrency,
      unrealizedFxGainLoss: balances.totalUnrealizedFxGainLoss,
    }
  }

  getAccountBalanceAtDate(accountId: string, date: Date): MultiCurrencyBalance | null {
    const account = this.accounts.get(accountId)
    if (!account) return null

    const snapshot = this.balanceTracker.getBalanceAtDate(accountId, date)
    if (!snapshot) {
      return {
        accountId,
        accountName: account.name,
        accountType: account.type,
        functionalCurrency: this.config.functionalCurrency,
        functionalBalance: 0,
        balancesByCurrency: [],
        unrealizedFxGainLoss: 0,
      }
    }

    const balancesByCurrency: Array<{
      currency: CurrencyCode
      balance: number
      exchangeRate: number
      functionalEquivalent: number
    }> = []

    for (const [currency, currencyBalance] of snapshot.balances) {
      balancesByCurrency.push({
        currency,
        balance: currencyBalance.balance,
        exchangeRate: currencyBalance.lastExchangeRate ?? 1,
        functionalEquivalent: currencyBalance.functionalEquivalent ?? 0,
      })
    }

    return {
      accountId,
      accountName: account.name,
      accountType: account.type,
      functionalCurrency: this.config.functionalCurrency,
      functionalBalance: snapshot.functionalBalance,
      balancesByCurrency,
      unrealizedFxGainLoss: 0, // Historical snapshots don't have this
    }
  }

  getTrialBalance(asOfDate?: Date): MultiCurrencyTrialBalance {
    const date = asOfDate ?? new Date()
    const lines: TrialBalanceLine[] = []
    let totalFunctionalDebits = 0
    let totalFunctionalCredits = 0

    for (const account of this.accounts.values()) {
      const balance = asOfDate
        ? this.getAccountBalanceAtDate(account.id, date)
        : this.getAccountBalance(account.id)

      if (!balance) continue

      // Determine if balance is debit or credit based on account type
      const isDebitNormal = account.normalBalance === 'debit'
      const isContra = account.isContra ?? false
      const effectiveDebitNormal = isContra ? !isDebitNormal : isDebitNormal

      let functionalDebit = 0
      let functionalCredit = 0

      // For trial balance, we need to show the balance in the correct column.
      // The functionalBalance is calculated as (debits - credits).
      // For debit-normal accounts (assets, expenses): positive balance = debit, negative = credit
      // For credit-normal accounts (liabilities, equity, revenue): positive balance = credit side deficit, negative = credit
      if (balance.functionalBalance >= 0) {
        // Positive balance means more debits than credits
        functionalDebit = balance.functionalBalance
      } else {
        // Negative balance means more credits than debits
        functionalCredit = Math.abs(balance.functionalBalance)
      }

      const balancesByCurrency: Array<{
        currency: CurrencyCode
        debit: number
        credit: number
      }> = []

      for (const cb of balance.balancesByCurrency) {
        let debit = 0
        let credit = 0

        // Same logic as functional balance - positive = debit side, negative = credit side
        if (cb.balance >= 0) {
          debit = cb.balance
        } else {
          credit = Math.abs(cb.balance)
        }

        balancesByCurrency.push({
          currency: cb.currency,
          debit,
          credit,
        })
      }

      lines.push({
        accountId: account.id,
        accountName: account.name,
        accountCode: account.code,
        accountType: account.type,
        functionalDebit,
        functionalCredit,
        balancesByCurrency,
      })

      totalFunctionalDebits += functionalDebit
      totalFunctionalCredits += functionalCredit
    }

    // Sort by account code
    lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode))

    const difference = Math.abs(totalFunctionalDebits - totalFunctionalCredits)
    const isBalanced = difference < 0.01

    return {
      asOfDate: date,
      functionalCurrency: this.config.functionalCurrency,
      lines,
      totalFunctionalDebits,
      totalFunctionalCredits,
      isBalanced,
      difference,
    }
  }

  // ===========================================================================
  // Currency Operations
  // ===========================================================================

  setExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: { effectiveDate?: Date }
  ): ExchangeRate {
    return this.exchangeRateProvider.setRate(fromCurrency, toCurrency, rate, {
      effectiveDate: options?.effectiveDate,
    })
  }

  getExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: { date?: Date }
  ): ExchangeRate | null {
    return this.exchangeRateProvider.getRate(fromCurrency, toCurrency, {
      date: options?.date,
    })
  }

  convertToFunctional(
    amount: number,
    currency: CurrencyCode,
    options?: { date?: Date }
  ): ConversionResult {
    return this.currencyService.convertToFunctional(amount, currency, {
      date: options?.date,
    })
  }

  // ===========================================================================
  // Revaluation
  // ===========================================================================

  revalueForeignCurrencyBalances(
    asOfDate: Date,
    options?: { postJournalEntry?: boolean }
  ): RevaluationResult {
    const entries: FxGainLossEntry[] = []
    let totalGainLoss = 0

    // Get current rates for all non-functional currencies
    const rates = new Map<CurrencyCode, ExchangeRate>()
    const allBalances = this.balanceTracker.getAllBalances()

    // Collect all currencies in use
    const currencies = new Set<CurrencyCode>()
    for (const [, accountBalance] of allBalances) {
      for (const [currency] of accountBalance.currencyBalances) {
        if (currency !== this.config.functionalCurrency) {
          currencies.add(currency)
        }
      }
    }

    // Get rates for each currency
    for (const currency of currencies) {
      const rate = this.exchangeRateProvider.getRate(
        currency,
        this.config.functionalCurrency,
        { date: asOfDate }
      )
      if (rate) {
        rates.set(currency, rate)
      }
    }

    // Revalue balances
    const revaluationEntries = this.balanceTracker.revalueAllAccounts(rates, asOfDate)

    // Create FX gain/loss entries
    for (const reval of revaluationEntries) {
      const fxEntry: FxGainLossEntry = {
        id: generateId('fx'),
        accountId: reval.accountId,
        currency: reval.currency,
        originalRate: reval.originalRate,
        currentRate: reval.newRate,
        originalAmount: reval.originalFunctionalAmount / reval.originalRate,
        originalFunctionalAmount: reval.originalFunctionalAmount,
        currentFunctionalAmount: reval.newFunctionalAmount,
        gainLoss: reval.gainLoss,
        isRealized: false,
        revaluationDate: asOfDate,
        createdAt: new Date(),
      }
      entries.push(fxEntry)
      totalGainLoss += reval.gainLoss
    }

    const result: RevaluationResult = {
      date: asOfDate,
      totalGainLoss,
      entries,
    }

    // Post journal entry if requested
    if (options?.postJournalEntry && this.config.autoPostFxGainLoss && totalGainLoss !== 0) {
      const journalEntries: CreateTransactionInput['entries'] = []

      // Group by gain/loss direction
      for (const entry of entries) {
        const accountId = entry.accountId

        if (entry.gainLoss > 0) {
          // Unrealized gain
          journalEntries.push({
            accountId,
            debit: entry.gainLoss,
            credit: 0,
            currency: this.config.functionalCurrency,
            memo: `FX revaluation gain: ${entry.currency}`,
          })
          journalEntries.push({
            accountId: this.config.unrealizedFxGainAccount!,
            debit: 0,
            credit: entry.gainLoss,
            currency: this.config.functionalCurrency,
            memo: `FX revaluation gain: ${entry.currency} on ${accountId}`,
          })
        } else if (entry.gainLoss < 0) {
          // Unrealized loss
          journalEntries.push({
            accountId,
            debit: 0,
            credit: Math.abs(entry.gainLoss),
            currency: this.config.functionalCurrency,
            memo: `FX revaluation loss: ${entry.currency}`,
          })
          journalEntries.push({
            accountId: this.config.unrealizedFxLossAccount!,
            debit: Math.abs(entry.gainLoss),
            credit: 0,
            currency: this.config.functionalCurrency,
            memo: `FX revaluation loss: ${entry.currency} on ${accountId}`,
          })
        }
      }

      if (journalEntries.length > 0) {
        const txn = this.createTransaction({
          date: asOfDate,
          description: `Foreign currency revaluation as of ${asOfDate.toISOString().split('T')[0]}`,
          entries: journalEntries,
          metadata: { revaluation: true },
        })
        this.postTransaction(txn.id)
        result.journalTransactionId = txn.id
      }
    }

    return result
  }

  // ===========================================================================
  // FX Gain/Loss
  // ===========================================================================

  calculateRealizedFxGainLoss(
    accountId: string,
    currency: CurrencyCode,
    amount: number,
    originalRate: number,
    settlementRate: number
  ): FxGainLossEntry {
    const originalFunctionalAmount = amount * originalRate
    const currentFunctionalAmount = amount * settlementRate
    const gainLoss = currentFunctionalAmount - originalFunctionalAmount

    return {
      id: generateId('fx'),
      accountId,
      currency,
      originalRate,
      currentRate: settlementRate,
      originalAmount: amount,
      originalFunctionalAmount,
      currentFunctionalAmount,
      gainLoss,
      isRealized: true,
      createdAt: new Date(),
    }
  }

  // ===========================================================================
  // Services
  // ===========================================================================

  getCurrencyService(): CurrencyService {
    return this.currencyService
  }

  getExchangeRateProvider(): ExchangeRateProvider {
    return this.exchangeRateProvider
  }

  getBalanceTracker(): BalanceTracker {
    return this.balanceTracker
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private round(amount: number): number {
    return Math.round(amount * 100) / 100
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new MultiCurrencyLedger instance
 */
export function createMultiCurrencyLedger(
  config: MultiCurrencyLedgerConfig
): MultiCurrencyLedger {
  return new MultiCurrencyLedgerImpl(config)
}
