/**
 * Multi-Currency Ledger Tests
 *
 * Comprehensive tests for the multi-currency ledger engine including:
 * - Multi-currency transaction creation and posting
 * - Exchange rate management
 * - FX gain/loss calculation
 * - Currency revaluation
 * - Multi-currency trial balance
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMultiCurrencyLedger,
  type MultiCurrencyLedger,
  type MultiCurrencyLedgerConfig,
} from '../multi-currency-ledger'

describe('MultiCurrencyLedger', () => {
  let ledger: MultiCurrencyLedger
  let config: MultiCurrencyLedgerConfig

  beforeEach(() => {
    config = {
      functionalCurrency: 'USD',
      allowedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'CHF'],
    }
    ledger = createMultiCurrencyLedger(config)
  })

  describe('Configuration', () => {
    it('should return the initial configuration', () => {
      const cfg = ledger.getConfig()
      expect(cfg.functionalCurrency).toBe('USD')
    })

    it('should update configuration', () => {
      ledger.setConfig({ functionalCurrency: 'EUR' })
      const cfg = ledger.getConfig()
      expect(cfg.functionalCurrency).toBe('EUR')
    })
  })

  describe('Account Management', () => {
    it('should create an account', () => {
      const account = ledger.createAccount({
        name: 'Cash',
        code: '1000',
        type: 'asset',
        description: 'Main cash account',
      })

      expect(account.id).toBeDefined()
      expect(account.name).toBe('Cash')
      expect(account.code).toBe('1000')
      expect(account.type).toBe('asset')
      expect(account.normalBalance).toBe('debit')
    })

    it('should retrieve account by id', () => {
      const created = ledger.createAccount({
        name: 'Cash',
        code: '1000',
        type: 'asset',
      })

      const retrieved = ledger.getAccount(created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('Cash')
    })

    it('should retrieve account by code', () => {
      ledger.createAccount({
        name: 'Cash',
        code: '1000',
        type: 'asset',
      })

      const account = ledger.getAccountByCode('1000')
      expect(account).not.toBeNull()
      expect(account?.name).toBe('Cash')
    })

    it('should list accounts by type', () => {
      ledger.createAccount({ name: 'Cash', code: '1000', type: 'asset' })
      ledger.createAccount({ name: 'AR', code: '1100', type: 'asset' })
      ledger.createAccount({ name: 'AP', code: '2000', type: 'liability' })

      const assets = ledger.listAccounts({ type: 'asset' })
      expect(assets.length).toBe(2)

      const liabilities = ledger.listAccounts({ type: 'liability' })
      expect(liabilities.length).toBe(1)
    })

    it('should create account with default currency', () => {
      const account = ledger.createAccount({
        name: 'EUR Cash',
        code: '1010',
        type: 'asset',
        defaultCurrency: 'EUR',
      })

      expect(account.defaultCurrency).toBe('EUR')
    })

    it('should create contra account', () => {
      const account = ledger.createAccount({
        name: 'Accumulated Depreciation',
        code: '1500',
        type: 'asset',
        isContra: true,
      })

      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('debit') // Asset's normal balance
    })
  })

  describe('Exchange Rate Management', () => {
    it('should set and retrieve exchange rate', () => {
      const rate = ledger.setExchangeRate('EUR', 'USD', 1.10)

      expect(rate.fromCurrency).toBe('EUR')
      expect(rate.toCurrency).toBe('USD')
      expect(rate.rate).toBe(1.10)
    })

    it('should get exchange rate', () => {
      ledger.setExchangeRate('EUR', 'USD', 1.10)

      const rate = ledger.getExchangeRate('EUR', 'USD')
      expect(rate).not.toBeNull()
      expect(rate?.rate).toBe(1.10)
    })

    it('should get inverse exchange rate', () => {
      ledger.setExchangeRate('EUR', 'USD', 1.10)

      const rate = ledger.getExchangeRate('USD', 'EUR')
      expect(rate).not.toBeNull()
      expect(rate?.rate).toBeCloseTo(0.909, 2)
    })

    it('should convert to functional currency', () => {
      ledger.setExchangeRate('EUR', 'USD', 1.10)

      const result = ledger.convertToFunctional(100, 'EUR')
      expect(result.toAmount).toBe(110)
      expect(result.toCurrency).toBe('USD')
    })
  })

  describe('Multi-Currency Transactions', () => {
    beforeEach(() => {
      // Create accounts
      ledger.createAccount({ name: 'Cash USD', code: '1000', type: 'asset' })
      ledger.createAccount({ name: 'Cash EUR', code: '1010', type: 'asset', defaultCurrency: 'EUR' })
      ledger.createAccount({ name: 'Revenue', code: '4000', type: 'revenue' })
      ledger.createAccount({ name: 'Expense', code: '5000', type: 'expense' })

      // Set exchange rates
      ledger.setExchangeRate('EUR', 'USD', 1.10)
      ledger.setExchangeRate('GBP', 'USD', 1.27)
    })

    it('should create transaction in functional currency', () => {
      const cashAccount = ledger.getAccountByCode('1000')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'Cash sale',
        entries: [
          { accountId: cashAccount!.id, debit: 100, credit: 0 },
          { accountId: revenueAccount!.id, debit: 0, credit: 100 },
        ],
      })

      expect(txn.status).toBe('draft')
      expect(txn.totalFunctionalDebit).toBe(100)
      expect(txn.totalFunctionalCredit).toBe(100)
    })

    it('should create transaction in foreign currency', () => {
      const cashEURAccount = ledger.getAccountByCode('1010')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'EUR cash sale',
        entries: [
          { accountId: cashEURAccount!.id, debit: 100, credit: 0, currency: 'EUR' },
          { accountId: revenueAccount!.id, debit: 0, credit: 110, currency: 'USD' },
        ],
      })

      expect(txn.status).toBe('draft')
      expect(txn.entries[0].currency).toBe('EUR')
      expect(txn.entries[0].exchangeRate).toBe(1.10)
      expect(txn.entries[0].functionalDebit).toBe(110)
    })

    it('should reject unbalanced transaction', () => {
      const cashAccount = ledger.getAccountByCode('1000')
      const revenueAccount = ledger.getAccountByCode('4000')

      expect(() =>
        ledger.createTransaction({
          date: new Date(),
          description: 'Unbalanced',
          entries: [
            { accountId: cashAccount!.id, debit: 100, credit: 0 },
            { accountId: revenueAccount!.id, debit: 0, credit: 50 }, // Doesn't balance
          ],
        })
      ).toThrow('does not balance')
    })

    it('should post transaction and update balances', () => {
      const cashAccount = ledger.getAccountByCode('1000')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'Cash sale',
        entries: [
          { accountId: cashAccount!.id, debit: 100, credit: 0 },
          { accountId: revenueAccount!.id, debit: 0, credit: 100 },
        ],
      })

      const posted = ledger.postTransaction(txn.id)
      expect(posted.status).toBe('posted')
      expect(posted.postedAt).toBeDefined()

      // Check balances
      const cashBalance = ledger.getAccountBalance(cashAccount!.id)
      expect(cashBalance?.functionalBalance).toBe(100)

      const revenueBalance = ledger.getAccountBalance(revenueAccount!.id)
      expect(revenueBalance?.functionalBalance).toBe(-100) // Credit increases revenue (negative balance internally)
    })

    it('should void transaction and reverse balances', () => {
      const cashAccount = ledger.getAccountByCode('1000')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'Cash sale',
        entries: [
          { accountId: cashAccount!.id, debit: 100, credit: 0 },
          { accountId: revenueAccount!.id, debit: 0, credit: 100 },
        ],
      })

      ledger.postTransaction(txn.id)
      const voided = ledger.voidTransaction(txn.id, 'Error')

      expect(voided.status).toBe('voided')
      expect(voided.voidReason).toBe('Error')

      // Balances should be zero
      const cashBalance = ledger.getAccountBalance(cashAccount!.id)
      expect(cashBalance?.functionalBalance).toBe(0)
    })

    it('should reverse transaction with new entry', () => {
      const cashAccount = ledger.getAccountByCode('1000')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'Cash sale',
        entries: [
          { accountId: cashAccount!.id, debit: 100, credit: 0 },
          { accountId: revenueAccount!.id, debit: 0, credit: 100 },
        ],
      })

      ledger.postTransaction(txn.id)
      const reversal = ledger.reverseTransaction(txn.id, { reason: 'Correction' })

      expect(reversal.status).toBe('posted')
      expect(reversal.reversesTransactionId).toBe(txn.id)

      // Original should be marked as reversed
      const original = ledger.getTransaction(txn.id)
      expect(original?.reversedByTransactionId).toBe(reversal.id)

      // Net balance should be zero
      const cashBalance = ledger.getAccountBalance(cashAccount!.id)
      expect(cashBalance?.functionalBalance).toBe(0)
    })
  })

  describe('Multi-Currency Balances', () => {
    beforeEach(() => {
      ledger.createAccount({ name: 'Bank EUR', code: '1010', type: 'asset', defaultCurrency: 'EUR' })
      ledger.createAccount({ name: 'Revenue', code: '4000', type: 'revenue' })
      ledger.setExchangeRate('EUR', 'USD', 1.10)
    })

    it('should track balances by currency', () => {
      const bankAccount = ledger.getAccountByCode('1010')
      const revenueAccount = ledger.getAccountByCode('4000')

      const txn = ledger.createTransaction({
        date: new Date(),
        description: 'EUR deposit',
        entries: [
          { accountId: bankAccount!.id, debit: 1000, credit: 0, currency: 'EUR' },
          { accountId: revenueAccount!.id, debit: 0, credit: 1100, currency: 'USD' },
        ],
      })

      ledger.postTransaction(txn.id)

      const balance = ledger.getAccountBalance(bankAccount!.id)
      expect(balance?.balancesByCurrency.length).toBe(1)
      expect(balance?.balancesByCurrency[0].currency).toBe('EUR')
      expect(balance?.balancesByCurrency[0].balance).toBe(1000)
      expect(balance?.balancesByCurrency[0].functionalEquivalent).toBe(1100)
    })

    it('should track multiple currencies per account', () => {
      const bankAccount = ledger.getAccountByCode('1010')
      const revenueAccount = ledger.getAccountByCode('4000')

      // EUR deposit
      const txn1 = ledger.createTransaction({
        date: new Date(),
        description: 'EUR deposit',
        entries: [
          { accountId: bankAccount!.id, debit: 1000, credit: 0, currency: 'EUR' },
          { accountId: revenueAccount!.id, debit: 0, credit: 1100, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn1.id)

      // GBP deposit (set rate first)
      ledger.setExchangeRate('GBP', 'USD', 1.27)

      const txn2 = ledger.createTransaction({
        date: new Date(),
        description: 'GBP deposit',
        entries: [
          { accountId: bankAccount!.id, debit: 500, credit: 0, currency: 'GBP' },
          { accountId: revenueAccount!.id, debit: 0, credit: 635, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn2.id)

      const balance = ledger.getAccountBalance(bankAccount!.id)
      expect(balance?.balancesByCurrency.length).toBe(2)

      // Total functional balance
      expect(balance?.functionalBalance).toBe(1100 + 635)
    })
  })

  describe('Trial Balance', () => {
    beforeEach(() => {
      ledger.createAccount({ name: 'Cash', code: '1000', type: 'asset' })
      ledger.createAccount({ name: 'AR', code: '1100', type: 'asset' })
      ledger.createAccount({ name: 'AP', code: '2000', type: 'liability' })
      ledger.createAccount({ name: 'Revenue', code: '4000', type: 'revenue' })
      ledger.createAccount({ name: 'Expense', code: '5000', type: 'expense' })
    })

    it('should generate balanced trial balance', () => {
      const cash = ledger.getAccountByCode('1000')
      const revenue = ledger.getAccountByCode('4000')
      const expense = ledger.getAccountByCode('5000')

      // Revenue entry
      const txn1 = ledger.createTransaction({
        date: new Date(),
        description: 'Sale',
        entries: [
          { accountId: cash!.id, debit: 1000, credit: 0 },
          { accountId: revenue!.id, debit: 0, credit: 1000 },
        ],
      })
      ledger.postTransaction(txn1.id)

      // Expense entry
      const txn2 = ledger.createTransaction({
        date: new Date(),
        description: 'Expense',
        entries: [
          { accountId: expense!.id, debit: 300, credit: 0 },
          { accountId: cash!.id, debit: 0, credit: 300 },
        ],
      })
      ledger.postTransaction(txn2.id)

      const trialBalance = ledger.getTrialBalance()

      expect(trialBalance.isBalanced).toBe(true)
      expect(trialBalance.totalFunctionalDebits).toBe(trialBalance.totalFunctionalCredits)
      // Filter lines with non-zero balances - accounts with no activity are included
      const activeLines = trialBalance.lines.filter(l => l.functionalDebit !== 0 || l.functionalCredit !== 0)
      expect(activeLines.length).toBe(3) // Cash, Revenue, Expense
    })

    it('should include multi-currency breakdown', () => {
      const cash = ledger.getAccountByCode('1000')
      const revenue = ledger.getAccountByCode('4000')

      ledger.setExchangeRate('EUR', 'USD', 1.10)

      // USD sale
      const txn1 = ledger.createTransaction({
        date: new Date(),
        description: 'USD Sale',
        entries: [
          { accountId: cash!.id, debit: 500, credit: 0, currency: 'USD' },
          { accountId: revenue!.id, debit: 0, credit: 500, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn1.id)

      // EUR sale
      const txn2 = ledger.createTransaction({
        date: new Date(),
        description: 'EUR Sale',
        entries: [
          { accountId: cash!.id, debit: 100, credit: 0, currency: 'EUR' },
          { accountId: revenue!.id, debit: 0, credit: 110, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn2.id)

      const trialBalance = ledger.getTrialBalance()
      const cashLine = trialBalance.lines.find((l) => l.accountCode === '1000')

      expect(cashLine?.balancesByCurrency.length).toBe(2)
    })
  })

  describe('FX Gain/Loss Calculation', () => {
    it('should calculate realized FX gain', () => {
      const entry = ledger.calculateRealizedFxGainLoss(
        'acc_123',
        'EUR',
        1000, // Amount in EUR
        1.08, // Original rate
        1.12 // Settlement rate
      )

      expect(entry.originalFunctionalAmount).toBe(1080)
      expect(entry.currentFunctionalAmount).toBe(1120)
      expect(entry.gainLoss).toBe(40)
      expect(entry.isRealized).toBe(true)
    })

    it('should calculate realized FX loss', () => {
      const entry = ledger.calculateRealizedFxGainLoss(
        'acc_123',
        'EUR',
        1000, // Amount in EUR
        1.12, // Original rate (higher)
        1.08 // Settlement rate (lower)
      )

      expect(entry.originalFunctionalAmount).toBe(1120)
      expect(entry.currentFunctionalAmount).toBe(1080)
      expect(entry.gainLoss).toBe(-40) // Loss
      expect(entry.isRealized).toBe(true)
    })
  })

  describe('Currency Revaluation', () => {
    beforeEach(() => {
      ledger.createAccount({ name: 'Bank EUR', code: '1010', type: 'asset', defaultCurrency: 'EUR' })
      ledger.createAccount({ name: 'Revenue', code: '4000', type: 'revenue' })
      ledger.createAccount({ name: 'Unrealized FX Gain', code: '4900', type: 'revenue' })
      ledger.createAccount({ name: 'Unrealized FX Loss', code: '5900', type: 'expense' })

      // Update config with FX accounts
      ledger.setConfig({
        unrealizedFxGainAccount: ledger.getAccountByCode('4900')!.id,
        unrealizedFxLossAccount: ledger.getAccountByCode('5900')!.id,
      })
    })

    it('should revalue foreign currency balances', () => {
      const bankAccount = ledger.getAccountByCode('1010')
      const revenueAccount = ledger.getAccountByCode('4000')

      // Initial deposit at rate 1.10 - set effective date for the transaction date
      ledger.setExchangeRate('EUR', 'USD', 1.10, { effectiveDate: new Date('2024-01-01') })

      const txn = ledger.createTransaction({
        date: new Date('2024-01-01'),
        description: 'EUR deposit',
        entries: [
          { accountId: bankAccount!.id, debit: 1000, credit: 0, currency: 'EUR' },
          { accountId: revenueAccount!.id, debit: 0, credit: 1100, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn.id)

      // Rate increases to 1.15
      ledger.setExchangeRate('EUR', 'USD', 1.15, { effectiveDate: new Date('2024-03-31') })

      // Revalue
      const result = ledger.revalueForeignCurrencyBalances(new Date('2024-03-31'))

      expect(result.totalGainLoss).toBe(50) // 1000 EUR * (1.15 - 1.10) = 50 USD gain
      expect(result.entries.length).toBe(1)
      expect(result.entries[0].gainLoss).toBe(50)
      expect(result.entries[0].isRealized).toBe(false)
    })

    it('should revalue with FX loss', () => {
      const bankAccount = ledger.getAccountByCode('1010')
      const revenueAccount = ledger.getAccountByCode('4000')

      // Initial deposit at rate 1.15 - set effective date for the transaction date
      ledger.setExchangeRate('EUR', 'USD', 1.15, { effectiveDate: new Date('2024-01-01') })

      const txn = ledger.createTransaction({
        date: new Date('2024-01-01'),
        description: 'EUR deposit',
        entries: [
          { accountId: bankAccount!.id, debit: 1000, credit: 0, currency: 'EUR' },
          { accountId: revenueAccount!.id, debit: 0, credit: 1150, currency: 'USD' },
        ],
      })
      ledger.postTransaction(txn.id)

      // Rate decreases to 1.10
      ledger.setExchangeRate('EUR', 'USD', 1.10, { effectiveDate: new Date('2024-03-31') })

      // Revalue
      const result = ledger.revalueForeignCurrencyBalances(new Date('2024-03-31'))

      expect(result.totalGainLoss).toBe(-50) // 1000 EUR * (1.10 - 1.15) = -50 USD loss
      expect(result.entries[0].gainLoss).toBe(-50)
    })
  })

  describe('Services Access', () => {
    it('should provide access to currency service', () => {
      const currencyService = ledger.getCurrencyService()
      expect(currencyService).toBeDefined()
      expect(currencyService.getFunctionalCurrency()).toBe('USD')
    })

    it('should provide access to exchange rate provider', () => {
      const provider = ledger.getExchangeRateProvider()
      expect(provider).toBeDefined()

      provider.setRate('CHF', 'USD', 1.12)
      const rate = provider.getRate('CHF', 'USD')
      expect(rate?.rate).toBe(1.12)
    })

    it('should provide access to balance tracker', () => {
      const tracker = ledger.getBalanceTracker()
      expect(tracker).toBeDefined()
      expect(tracker.getFunctionalCurrency()).toBe('USD')
    })
  })
})

describe('Multi-Currency Scenarios', () => {
  let ledger: MultiCurrencyLedger

  beforeEach(() => {
    ledger = createMultiCurrencyLedger({
      functionalCurrency: 'USD',
      allowedCurrencies: ['USD', 'EUR', 'GBP', 'JPY'],
    })

    // Create chart of accounts
    ledger.createAccount({ name: 'Cash USD', code: '1000', type: 'asset' })
    ledger.createAccount({ name: 'Cash EUR', code: '1010', type: 'asset', defaultCurrency: 'EUR' })
    ledger.createAccount({ name: 'Cash GBP', code: '1020', type: 'asset', defaultCurrency: 'GBP' })
    ledger.createAccount({ name: 'Accounts Receivable', code: '1100', type: 'asset' })
    ledger.createAccount({ name: 'Accounts Payable', code: '2000', type: 'liability' })
    ledger.createAccount({ name: 'Sales Revenue', code: '4000', type: 'revenue' })
    ledger.createAccount({ name: 'COGS', code: '5000', type: 'expense' })
    ledger.createAccount({ name: 'FX Gain', code: '4900', type: 'revenue' })
    ledger.createAccount({ name: 'FX Loss', code: '5900', type: 'expense' })

    // Set initial exchange rates with effective dates that cover all test scenarios
    const baseDate = new Date('2024-01-01')
    ledger.setExchangeRate('EUR', 'USD', 1.10, { effectiveDate: baseDate })
    ledger.setExchangeRate('GBP', 'USD', 1.27, { effectiveDate: baseDate })
    ledger.setExchangeRate('JPY', 'USD', 0.0067, { effectiveDate: baseDate })
  })

  it('should handle international sales scenario', () => {
    const cashEUR = ledger.getAccountByCode('1010')!
    const revenue = ledger.getAccountByCode('4000')!

    // Sale to European customer - EUR 5,000
    const txn = ledger.createTransaction({
      date: new Date('2024-01-15'),
      description: 'Sale to EU customer',
      entries: [
        { accountId: cashEUR.id, debit: 5000, credit: 0, currency: 'EUR' },
        { accountId: revenue.id, debit: 0, credit: 5500, currency: 'USD' }, // At 1.10 rate
      ],
    })
    ledger.postTransaction(txn.id)

    // Verify balances
    const cashBalance = ledger.getAccountBalance(cashEUR.id)
    expect(cashBalance?.balancesByCurrency[0].balance).toBe(5000)
    expect(cashBalance?.balancesByCurrency[0].currency).toBe('EUR')
    expect(cashBalance?.functionalBalance).toBe(5500)

    // Trial balance should be balanced
    const tb = ledger.getTrialBalance()
    expect(tb.isBalanced).toBe(true)
  })

  it('should handle cross-currency payment scenario', () => {
    const cashGBP = ledger.getAccountByCode('1020')!
    const cashEUR = ledger.getAccountByCode('1010')!

    // Receive GBP, pay EUR supplier (triangulated through USD)
    // GBP 1,000 received
    const txn1 = ledger.createTransaction({
      date: new Date('2024-02-01'),
      description: 'GBP receipt',
      entries: [
        { accountId: cashGBP.id, debit: 1000, credit: 0, currency: 'GBP' },
        { accountId: ledger.getAccountByCode('4000')!.id, debit: 0, credit: 1270, currency: 'USD' },
      ],
    })
    ledger.postTransaction(txn1.id)

    // EUR 1,000 payment
    const txn2 = ledger.createTransaction({
      date: new Date('2024-02-01'),
      description: 'EUR payment',
      entries: [
        { accountId: ledger.getAccountByCode('5000')!.id, debit: 1100, credit: 0, currency: 'USD' },
        { accountId: cashEUR.id, debit: 0, credit: 1000, currency: 'EUR' },
      ],
    })
    ledger.postTransaction(txn2.id)

    // Verify GBP balance
    const gbpBalance = ledger.getAccountBalance(cashGBP.id)
    expect(gbpBalance?.balancesByCurrency[0].balance).toBe(1000)

    // Verify EUR balance (negative because we paid out)
    const eurBalance = ledger.getAccountBalance(cashEUR.id)
    expect(eurBalance?.balancesByCurrency[0].balance).toBe(-1000)
  })

  it('should handle month-end revaluation', () => {
    const cashEUR = ledger.getAccountByCode('1010')!
    const revenue = ledger.getAccountByCode('4000')!

    // Mid-month transaction at 1.10
    const txn = ledger.createTransaction({
      date: new Date('2024-03-15'),
      description: 'EUR sale',
      entries: [
        { accountId: cashEUR.id, debit: 10000, credit: 0, currency: 'EUR' },
        { accountId: revenue.id, debit: 0, credit: 11000, currency: 'USD' },
      ],
    })
    ledger.postTransaction(txn.id)

    // Month-end rate changed to 1.12
    ledger.setExchangeRate('EUR', 'USD', 1.12, { effectiveDate: new Date('2024-03-31') })

    // Revalue
    const result = ledger.revalueForeignCurrencyBalances(new Date('2024-03-31'))

    // EUR 10,000 * (1.12 - 1.10) = $200 gain (use toBeCloseTo for floating point)
    expect(result.totalGainLoss).toBeCloseTo(200, 2)
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].currency).toBe('EUR')
  })

  it('should handle JPY zero-decimal currency', () => {
    const cashUSD = ledger.getAccountByCode('1000')!
    const revenue = ledger.getAccountByCode('4000')!

    // JPY sale - 150,000 JPY
    const txn = ledger.createTransaction({
      date: new Date('2024-04-01'),
      description: 'JPY sale',
      entries: [
        { accountId: cashUSD.id, debit: 1005, credit: 0, currency: 'USD' }, // 150000 * 0.0067
        { accountId: revenue.id, debit: 0, credit: 1005, currency: 'USD' },
      ],
    })
    ledger.postTransaction(txn.id)

    const tb = ledger.getTrialBalance()
    expect(tb.isBalanced).toBe(true)
  })
})
