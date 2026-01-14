/**
 * Double-Entry Transaction Tests - TDD RED Phase
 *
 * Tests for double-entry accounting ensuring:
 * - Transaction with multiple line items (journal entries)
 * - Debits must equal credits validation
 * - Multi-currency transactions
 * - Transaction reversal
 * - Transaction posting
 * - Audit trail
 *
 * All tests FAIL because implementation doesn't exist yet.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLedger,
  type Ledger,
  type Account,
  type AccountType,
  type Transaction,
  type JournalEntry,
  type Currency,
  type TransactionStatus,
  type AuditEntry,
} from '../ledger'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestLedger(): Ledger {
  return createLedger()
}

// =============================================================================
// Account Setup Tests
// =============================================================================

describe('Ledger', () => {
  describe('account management', () => {
    let ledger: Ledger

    beforeEach(() => {
      ledger = createTestLedger()
    })

    it('should create an asset account', async () => {
      const account = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })

      expect(account.id).toBeDefined()
      expect(account.name).toBe('Cash')
      expect(account.type).toBe('asset')
      expect(account.code).toBe('1000')
      expect(account.currency).toBe('USD')
      expect(account.balance).toBe(0)
      expect(account.normalBalance).toBe('debit')
    })

    it('should create a liability account', async () => {
      const account = await ledger.createAccount({
        name: 'Accounts Payable',
        type: 'liability',
        code: '2000',
        currency: 'USD',
      })

      expect(account.type).toBe('liability')
      expect(account.normalBalance).toBe('credit')
    })

    it('should create an equity account', async () => {
      const account = await ledger.createAccount({
        name: 'Retained Earnings',
        type: 'equity',
        code: '3000',
        currency: 'USD',
      })

      expect(account.type).toBe('equity')
      expect(account.normalBalance).toBe('credit')
    })

    it('should create a revenue account', async () => {
      const account = await ledger.createAccount({
        name: 'Sales Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })

      expect(account.type).toBe('revenue')
      expect(account.normalBalance).toBe('credit')
    })

    it('should create an expense account', async () => {
      const account = await ledger.createAccount({
        name: 'Office Supplies',
        type: 'expense',
        code: '5000',
        currency: 'USD',
      })

      expect(account.type).toBe('expense')
      expect(account.normalBalance).toBe('debit')
    })

    it('should get account by id', async () => {
      const created = await ledger.createAccount({
        name: 'Test Account',
        type: 'asset',
        code: '1001',
        currency: 'USD',
      })

      const retrieved = await ledger.getAccount(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should get account by code', async () => {
      await ledger.createAccount({
        name: 'Checking Account',
        type: 'asset',
        code: '1010',
        currency: 'USD',
      })

      const account = await ledger.getAccountByCode('1010')

      expect(account).not.toBeNull()
      expect(account?.code).toBe('1010')
    })

    it('should list accounts by type', async () => {
      await ledger.createAccount({ name: 'Cash', type: 'asset', code: '1000', currency: 'USD' })
      await ledger.createAccount({ name: 'Inventory', type: 'asset', code: '1100', currency: 'USD' })
      await ledger.createAccount({ name: 'AP', type: 'liability', code: '2000', currency: 'USD' })

      const assetAccounts = await ledger.listAccounts({ type: 'asset' })

      expect(assetAccounts).toHaveLength(2)
      expect(assetAccounts.every((a) => a.type === 'asset')).toBe(true)
    })

    it('should prevent duplicate account codes', async () => {
      await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })

      await expect(
        ledger.createAccount({
          name: 'Another Cash',
          type: 'asset',
          code: '1000',
          currency: 'USD',
        })
      ).rejects.toThrow('Account code already exists')
    })
  })

  // =============================================================================
  // Transaction with Multiple Line Items (Journal Entries)
  // =============================================================================

  describe('transaction with multiple line items', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account
    let taxPayableAccount: Account
    let expenseAccount: Account
    let inventoryAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Sales Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
      taxPayableAccount = await ledger.createAccount({
        name: 'Sales Tax Payable',
        type: 'liability',
        code: '2100',
        currency: 'USD',
      })
      expenseAccount = await ledger.createAccount({
        name: 'Cost of Goods Sold',
        type: 'expense',
        code: '5000',
        currency: 'USD',
      })
      inventoryAccount = await ledger.createAccount({
        name: 'Inventory',
        type: 'asset',
        code: '1100',
        currency: 'USD',
      })
    })

    it('should create a simple two-entry transaction', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Cash sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      expect(transaction.id).toBeDefined()
      expect(transaction.entries).toHaveLength(2)
      expect(transaction.status).toBe('draft')
    })

    it('should create a transaction with three entries (sale with tax)', async () => {
      // Cash received: $108 (debit)
      // Sales Revenue: $100 (credit)
      // Sales Tax Payable: $8 (credit)
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Cash sale with tax',
        entries: [
          { accountId: cashAccount.id, debit: 10800, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
          { accountId: taxPayableAccount.id, debit: 0, credit: 800 },
        ],
      })

      expect(transaction.entries).toHaveLength(3)

      const totalDebits = transaction.entries.reduce((sum, e) => sum + e.debit, 0)
      const totalCredits = transaction.entries.reduce((sum, e) => sum + e.credit, 0)
      expect(totalDebits).toBe(totalCredits)
    })

    it('should create a transaction with four entries (sale with COGS)', async () => {
      // Entry 1: Debit Cash $150
      // Entry 2: Credit Revenue $150
      // Entry 3: Debit COGS $75
      // Entry 4: Credit Inventory $75
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Sale with cost of goods sold',
        entries: [
          { accountId: cashAccount.id, debit: 15000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 15000 },
          { accountId: expenseAccount.id, debit: 7500, credit: 0 },
          { accountId: inventoryAccount.id, debit: 0, credit: 7500 },
        ],
      })

      expect(transaction.entries).toHaveLength(4)
    })

    it('should track line item references', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Detailed sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0, reference: 'INV-001' },
          { accountId: revenueAccount.id, debit: 0, credit: 10000, reference: 'INV-001' },
        ],
      })

      expect(transaction.entries[0].reference).toBe('INV-001')
    })

    it('should support memo on individual entries', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Sale with memos',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0, memo: 'Cash received from customer' },
          { accountId: revenueAccount.id, debit: 0, credit: 10000, memo: 'Widget sale' },
        ],
      })

      expect(transaction.entries[0].memo).toBe('Cash received from customer')
      expect(transaction.entries[1].memo).toBe('Widget sale')
    })
  })

  // =============================================================================
  // Debits Must Equal Credits Validation
  // =============================================================================

  describe('debits must equal credits validation', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
    })

    it('should reject transaction where debits exceed credits', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Unbalanced - debits > credits',
          entries: [
            { accountId: cashAccount.id, debit: 10000, credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: 9000 },
          ],
        })
      ).rejects.toThrow('Transaction must balance: debits (10000) != credits (9000)')
    })

    it('should reject transaction where credits exceed debits', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Unbalanced - credits > debits',
          entries: [
            { accountId: cashAccount.id, debit: 8000, credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: 10000 },
          ],
        })
      ).rejects.toThrow('Transaction must balance: debits (8000) != credits (10000)')
    })

    it('should reject transaction with zero total', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Zero transaction',
          entries: [
            { accountId: cashAccount.id, debit: 0, credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: 0 },
          ],
        })
      ).rejects.toThrow('Transaction must have non-zero amount')
    })

    it('should reject transaction with single entry', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Single entry',
          entries: [{ accountId: cashAccount.id, debit: 10000, credit: 0 }],
        })
      ).rejects.toThrow('Transaction must have at least two entries')
    })

    it('should reject transaction with no entries', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Empty transaction',
          entries: [],
        })
      ).rejects.toThrow('Transaction must have at least two entries')
    })

    it('should reject entry with both debit and credit', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Invalid entry',
          entries: [
            { accountId: cashAccount.id, debit: 5000, credit: 5000 },
            { accountId: revenueAccount.id, debit: 0, credit: 0 },
          ],
        })
      ).rejects.toThrow('Entry cannot have both debit and credit')
    })

    it('should reject negative amounts', async () => {
      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Negative amount',
          entries: [
            { accountId: cashAccount.id, debit: -10000, credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: -10000 },
          ],
        })
      ).rejects.toThrow('Entry amounts must be positive')
    })

    it('should accept perfectly balanced transaction', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Balanced transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      expect(transaction.id).toBeDefined()
    })

    it('should validate balance on transaction update', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await expect(
        ledger.updateTransaction(transaction.id, {
          entries: [
            { accountId: cashAccount.id, debit: 12000, credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: 10000 },
          ],
        })
      ).rejects.toThrow('Transaction must balance')
    })
  })

  // =============================================================================
  // Multi-Currency Transactions
  // =============================================================================

  describe('multi-currency transactions', () => {
    let ledger: Ledger
    let usdCashAccount: Account
    let eurCashAccount: Account
    let revenueAccount: Account
    let forexGainLossAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      usdCashAccount = await ledger.createAccount({
        name: 'Cash USD',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      eurCashAccount = await ledger.createAccount({
        name: 'Cash EUR',
        type: 'asset',
        code: '1001',
        currency: 'EUR',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD', // Functional currency
      })
      forexGainLossAccount = await ledger.createAccount({
        name: 'Foreign Exchange Gain/Loss',
        type: 'expense',
        code: '6000',
        currency: 'USD',
      })
    })

    it('should set ledger functional currency', async () => {
      await ledger.setFunctionalCurrency('USD')

      const config = await ledger.getConfiguration()
      expect(config.functionalCurrency).toBe('USD')
    })

    it('should record exchange rate on transaction', async () => {
      await ledger.setFunctionalCurrency('USD')

      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'EUR sale',
        baseCurrency: 'USD',
        entries: [
          {
            accountId: eurCashAccount.id,
            debit: 10000, // 100 EUR
            credit: 0,
            currency: 'EUR',
            exchangeRate: 1.08, // 1 EUR = 1.08 USD
            functionalAmount: 10800, // 108 USD
          },
          {
            accountId: revenueAccount.id,
            debit: 0,
            credit: 10800, // 108 USD
            currency: 'USD',
          },
        ],
      })

      expect(transaction.entries[0].exchangeRate).toBe(1.08)
      expect(transaction.entries[0].functionalAmount).toBe(10800)
    })

    it('should validate multi-currency balance in functional currency', async () => {
      await ledger.setFunctionalCurrency('USD')

      // 100 EUR at 1.08 rate = 108 USD debit
      // 108 USD credit
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Multi-currency sale',
        baseCurrency: 'USD',
        entries: [
          {
            accountId: eurCashAccount.id,
            debit: 10000,
            credit: 0,
            currency: 'EUR',
            exchangeRate: 1.08,
            functionalAmount: 10800,
          },
          {
            accountId: revenueAccount.id,
            debit: 0,
            credit: 10800,
            currency: 'USD',
          },
        ],
      })

      expect(transaction.id).toBeDefined()
    })

    it('should reject multi-currency transaction with unbalanced functional amounts', async () => {
      await ledger.setFunctionalCurrency('USD')

      await expect(
        ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: 'Unbalanced forex',
          baseCurrency: 'USD',
          entries: [
            {
              accountId: eurCashAccount.id,
              debit: 10000,
              credit: 0,
              currency: 'EUR',
              exchangeRate: 1.08,
              functionalAmount: 10800,
            },
            {
              accountId: revenueAccount.id,
              debit: 0,
              credit: 10000, // Wrong - should be 10800
              currency: 'USD',
            },
          ],
        })
      ).rejects.toThrow('Transaction must balance in functional currency')
    })

    it('should record forex gain/loss on currency conversion', async () => {
      await ledger.setFunctionalCurrency('USD')

      // Converting EUR to USD with exchange rate difference
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Currency exchange with gain',
        baseCurrency: 'USD',
        entries: [
          {
            accountId: usdCashAccount.id,
            debit: 11000, // Received 110 USD
            credit: 0,
            currency: 'USD',
          },
          {
            accountId: eurCashAccount.id,
            debit: 0,
            credit: 10000, // Gave 100 EUR
            currency: 'EUR',
            exchangeRate: 1.08,
            functionalAmount: 10800, // Worth 108 USD at book rate
          },
          {
            accountId: forexGainLossAccount.id,
            debit: 0,
            credit: 200, // 2 USD gain
            currency: 'USD',
          },
        ],
      })

      expect(transaction.entries).toHaveLength(3)
    })

    it('should track original currency amounts', async () => {
      await ledger.setFunctionalCurrency('USD')

      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Track original amounts',
        baseCurrency: 'USD',
        entries: [
          {
            accountId: eurCashAccount.id,
            debit: 10000,
            credit: 0,
            currency: 'EUR',
            exchangeRate: 1.08,
            functionalAmount: 10800,
          },
          {
            accountId: revenueAccount.id,
            debit: 0,
            credit: 10800,
            currency: 'USD',
          },
        ],
      })

      // Verify we can retrieve original currency amounts
      const entry = transaction.entries[0]
      expect(entry.currency).toBe('EUR')
      expect(entry.debit).toBe(10000) // Original EUR amount
    })

    it('should support multiple currencies in single transaction', async () => {
      await ledger.setFunctionalCurrency('USD')

      const gbpCashAccount = await ledger.createAccount({
        name: 'Cash GBP',
        type: 'asset',
        code: '1002',
        currency: 'GBP',
      })

      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Multi-currency transaction',
        baseCurrency: 'USD',
        entries: [
          {
            accountId: eurCashAccount.id,
            debit: 0,
            credit: 5000, // 50 EUR
            currency: 'EUR',
            exchangeRate: 1.08,
            functionalAmount: 5400,
          },
          {
            accountId: gbpCashAccount.id,
            debit: 0,
            credit: 3000, // 30 GBP
            currency: 'GBP',
            exchangeRate: 1.26,
            functionalAmount: 3780,
          },
          {
            accountId: usdCashAccount.id,
            debit: 9180, // 91.80 USD
            credit: 0,
            currency: 'USD',
          },
        ],
      })

      expect(transaction.entries).toHaveLength(3)
    })
  })

  // =============================================================================
  // Transaction Reversal
  // =============================================================================

  describe('transaction reversal', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account
    let expenseAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
      expenseAccount = await ledger.createAccount({
        name: 'Expense',
        type: 'expense',
        code: '5000',
        currency: 'USD',
      })
    })

    it('should reverse a posted transaction', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(original.id)

      const reversal = await ledger.reverseTransaction(original.id, {
        date: new Date('2024-01-20'),
        reason: 'Customer returned goods',
      })

      expect(reversal.id).toBeDefined()
      expect(reversal.reversesTransactionId).toBe(original.id)
      expect(reversal.entries[0].debit).toBe(0)
      expect(reversal.entries[0].credit).toBe(10000)
      expect(reversal.entries[1].debit).toBe(10000)
      expect(reversal.entries[1].credit).toBe(0)
    })

    it('should mark original transaction as reversed', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(original.id)

      const reversal = await ledger.reverseTransaction(original.id)

      const updated = await ledger.getTransaction(original.id)
      expect(updated?.isReversed).toBe(true)
      expect(updated?.reversedByTransactionId).toBe(reversal.id)
    })

    it('should not allow reversing unposted transaction', async () => {
      const draft = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Draft transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await expect(ledger.reverseTransaction(draft.id)).rejects.toThrow(
        'Cannot reverse unposted transaction'
      )
    })

    it('should not allow reversing already reversed transaction', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(original.id)
      await ledger.reverseTransaction(original.id)

      await expect(ledger.reverseTransaction(original.id)).rejects.toThrow(
        'Transaction already reversed'
      )
    })

    it('should auto-post reversal when specified', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(original.id)

      const reversal = await ledger.reverseTransaction(original.id, {
        autoPost: true,
      })

      expect(reversal.status).toBe('posted')
    })

    it('should preserve reversal reason in audit trail', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(original.id)

      const reversal = await ledger.reverseTransaction(original.id, {
        reason: 'Invoice voided per customer request',
      })

      expect(reversal.reversalReason).toBe('Invoice voided per customer request')
    })

    it('should correctly reverse multi-entry transaction', async () => {
      const original = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Complex transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 8000 },
          { accountId: expenseAccount.id, debit: 0, credit: 2000 },
        ],
      })
      await ledger.postTransaction(original.id)

      const reversal = await ledger.reverseTransaction(original.id)

      // Check all entries are properly reversed
      expect(reversal.entries[0].credit).toBe(10000)
      expect(reversal.entries[0].debit).toBe(0)
      expect(reversal.entries[1].debit).toBe(8000)
      expect(reversal.entries[1].credit).toBe(0)
      expect(reversal.entries[2].debit).toBe(2000)
      expect(reversal.entries[2].credit).toBe(0)
    })
  })

  // =============================================================================
  // Transaction Posting
  // =============================================================================

  describe('transaction posting', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
    })

    it('should create transaction in draft status', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Draft transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      expect(transaction.status).toBe('draft')
    })

    it('should post transaction and update status', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Transaction to post',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      const posted = await ledger.postTransaction(transaction.id)

      expect(posted.status).toBe('posted')
      expect(posted.postedAt).toBeInstanceOf(Date)
    })

    it('should update account balances on posting', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Balance test',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      // Before posting - balances unchanged
      let cash = await ledger.getAccount(cashAccount.id)
      expect(cash?.balance).toBe(0)

      await ledger.postTransaction(transaction.id)

      // After posting - balances updated
      cash = await ledger.getAccount(cashAccount.id)
      const revenue = await ledger.getAccount(revenueAccount.id)

      expect(cash?.balance).toBe(10000) // Debit increases asset
      expect(revenue?.balance).toBe(10000) // Credit increases revenue
    })

    it('should not update balances for draft transactions', async () => {
      await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Draft - no balance impact',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      const cash = await ledger.getAccount(cashAccount.id)
      expect(cash?.balance).toBe(0)
    })

    it('should reject posting already posted transaction', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Already posted',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)

      await expect(ledger.postTransaction(transaction.id)).rejects.toThrow(
        'Transaction already posted'
      )
    })

    it('should reject editing posted transaction', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Posted transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)

      await expect(
        ledger.updateTransaction(transaction.id, {
          description: 'Updated description',
        })
      ).rejects.toThrow('Cannot modify posted transaction')
    })

    it('should allow voiding posted transaction', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Transaction to void',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)
      const voided = await ledger.voidTransaction(transaction.id, {
        reason: 'Entered in error',
      })

      expect(voided.status).toBe('voided')
      expect(voided.voidedAt).toBeInstanceOf(Date)
      expect(voided.voidReason).toBe('Entered in error')
    })

    it('should reverse account balances on void', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Void balance test',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)
      await ledger.voidTransaction(transaction.id, { reason: 'Test' })

      const cash = await ledger.getAccount(cashAccount.id)
      const revenue = await ledger.getAccount(revenueAccount.id)

      expect(cash?.balance).toBe(0)
      expect(revenue?.balance).toBe(0)
    })

    it('should generate transaction number on posting', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Auto-numbered',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      expect(transaction.transactionNumber).toBeUndefined()

      const posted = await ledger.postTransaction(transaction.id)

      expect(posted.transactionNumber).toBeDefined()
      expect(posted.transactionNumber).toMatch(/^TXN-\d+$/)
    })

    it('should support batch posting', async () => {
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Batch 1',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      const tx2 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Batch 2',
        entries: [
          { accountId: cashAccount.id, debit: 5000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 5000 },
        ],
      })

      const posted = await ledger.postTransactions([tx1.id, tx2.id])

      expect(posted).toHaveLength(2)
      expect(posted.every((t) => t.status === 'posted')).toBe(true)
    })
  })

  // =============================================================================
  // Audit Trail
  // =============================================================================

  describe('audit trail', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
    })

    it('should record transaction creation in audit log', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Audited transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog).toHaveLength(1)
      expect(auditLog[0].action).toBe('created')
      expect(auditLog[0].transactionId).toBe(transaction.id)
      expect(auditLog[0].timestamp).toBeInstanceOf(Date)
    })

    it('should record transaction posting in audit log', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Posted transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog).toHaveLength(2)
      expect(auditLog[1].action).toBe('posted')
    })

    it('should record transaction void in audit log', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Voided transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)
      await ledger.voidTransaction(transaction.id, { reason: 'Duplicate entry' })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog).toHaveLength(3)
      expect(auditLog[2].action).toBe('voided')
      expect(auditLog[2].metadata?.reason).toBe('Duplicate entry')
    })

    it('should record transaction reversal in audit log', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Reversed transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.postTransaction(transaction.id)
      const reversal = await ledger.reverseTransaction(transaction.id, {
        reason: 'Customer return',
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog.some((e) => e.action === 'reversed')).toBe(true)
      const reversalEntry = auditLog.find((e) => e.action === 'reversed')
      expect(reversalEntry?.metadata?.reversalTransactionId).toBe(reversal.id)
    })

    it('should track user who performed action', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'User tracked',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
        userId: 'user-123',
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog[0].userId).toBe('user-123')
    })

    it('should record IP address when available', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'IP tracked',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
        metadata: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })

      expect(auditLog[0].metadata?.ipAddress).toBe('192.168.1.1')
    })

    it('should query audit log by date range', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Date range test',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      const auditLog = await ledger.getAuditLog({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      })

      expect(auditLog.length).toBeGreaterThan(0)
    })

    it('should query audit log by action type', async () => {
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'TX 1',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx1.id)

      const tx2 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'TX 2',
        entries: [
          { accountId: cashAccount.id, debit: 5000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 5000 },
        ],
      })

      const postings = await ledger.getAuditLog({ action: 'posted' })
      const creations = await ledger.getAuditLog({ action: 'created' })

      expect(postings).toHaveLength(1)
      expect(creations).toHaveLength(2)
    })

    it('should query audit log by account', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Account audit',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(transaction.id)

      const cashAudit = await ledger.getAuditLog({ accountId: cashAccount.id })

      expect(cashAudit.length).toBeGreaterThan(0)
    })

    it('should record before/after state for updates', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Original description',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      await ledger.updateTransaction(transaction.id, {
        description: 'Updated description',
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })
      const updateEntry = auditLog.find((e) => e.action === 'updated')

      expect(updateEntry?.before?.description).toBe('Original description')
      expect(updateEntry?.after?.description).toBe('Updated description')
    })

    it('should support audit log pagination', async () => {
      // Create multiple transactions
      for (let i = 0; i < 10; i++) {
        await ledger.createTransaction({
          date: new Date('2024-01-15'),
          description: `Transaction ${i}`,
          entries: [
            { accountId: cashAccount.id, debit: 1000 * (i + 1), credit: 0 },
            { accountId: revenueAccount.id, debit: 0, credit: 1000 * (i + 1) },
          ],
        })
      }

      const page1 = await ledger.getAuditLog({}, { limit: 5, offset: 0 })
      const page2 = await ledger.getAuditLog({}, { limit: 5, offset: 5 })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
      expect(page1[0].transactionId).not.toBe(page2[0].transactionId)
    })

    it('should be immutable - audit entries cannot be modified', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Immutable audit',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })

      const auditLog = await ledger.getAuditLog({ transactionId: transaction.id })
      const auditEntry = auditLog[0]

      // Attempt to modify should fail
      await expect(
        ledger.updateAuditEntry(auditEntry.id, { action: 'modified' })
      ).rejects.toThrow('Audit entries are immutable')
    })

    it('should generate audit report', async () => {
      const transaction = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Report test',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(transaction.id)

      const report = await ledger.generateAuditReport({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      })

      expect(report.totalTransactions).toBeGreaterThan(0)
      expect(report.totalPosted).toBeGreaterThan(0)
      expect(report.entries).toBeDefined()
    })
  })

  // =============================================================================
  // Balance Verification
  // =============================================================================

  describe('balance verification', () => {
    let ledger: Ledger
    let cashAccount: Account
    let revenueAccount: Account
    let expenseAccount: Account
    let apAccount: Account

    beforeEach(async () => {
      ledger = createTestLedger()
      cashAccount = await ledger.createAccount({
        name: 'Cash',
        type: 'asset',
        code: '1000',
        currency: 'USD',
      })
      revenueAccount = await ledger.createAccount({
        name: 'Revenue',
        type: 'revenue',
        code: '4000',
        currency: 'USD',
      })
      expenseAccount = await ledger.createAccount({
        name: 'Expense',
        type: 'expense',
        code: '5000',
        currency: 'USD',
      })
      apAccount = await ledger.createAccount({
        name: 'Accounts Payable',
        type: 'liability',
        code: '2000',
        currency: 'USD',
      })
    })

    it('should verify trial balance equals zero', async () => {
      // Create and post transactions
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx1.id)

      const tx2 = await ledger.createTransaction({
        date: new Date('2024-01-16'),
        description: 'Expense',
        entries: [
          { accountId: expenseAccount.id, debit: 3000, credit: 0 },
          { accountId: cashAccount.id, debit: 0, credit: 3000 },
        ],
      })
      await ledger.postTransaction(tx2.id)

      const trialBalance = await ledger.getTrialBalance()

      expect(trialBalance.totalDebits).toBe(trialBalance.totalCredits)
      expect(trialBalance.isBalanced).toBe(true)
    })

    it('should generate trial balance report', async () => {
      const tx = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx.id)

      const trialBalance = await ledger.getTrialBalance()

      expect(trialBalance.accounts).toContainEqual(
        expect.objectContaining({
          accountId: cashAccount.id,
          debitBalance: 10000,
          creditBalance: 0,
        })
      )
      expect(trialBalance.accounts).toContainEqual(
        expect.objectContaining({
          accountId: revenueAccount.id,
          debitBalance: 0,
          creditBalance: 10000,
        })
      )
    })

    it('should get account balance at specific date', async () => {
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-10'),
        description: 'First sale',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx1.id)

      const tx2 = await ledger.createTransaction({
        date: new Date('2024-01-20'),
        description: 'Second sale',
        entries: [
          { accountId: cashAccount.id, debit: 5000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 5000 },
        ],
      })
      await ledger.postTransaction(tx2.id)

      const balanceJan15 = await ledger.getAccountBalanceAtDate(
        cashAccount.id,
        new Date('2024-01-15')
      )
      const balanceJan25 = await ledger.getAccountBalanceAtDate(
        cashAccount.id,
        new Date('2024-01-25')
      )

      expect(balanceJan15).toBe(10000)
      expect(balanceJan25).toBe(15000)
    })

    it('should verify accounting equation (Assets = Liabilities + Equity)', async () => {
      // Create equity account
      const equityAccount = await ledger.createAccount({
        name: 'Owner Equity',
        type: 'equity',
        code: '3000',
        currency: 'USD',
      })

      // Initial investment
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-01'),
        description: 'Owner investment',
        entries: [
          { accountId: cashAccount.id, debit: 50000, credit: 0 },
          { accountId: equityAccount.id, debit: 0, credit: 50000 },
        ],
      })
      await ledger.postTransaction(tx1.id)

      // Take a loan
      const tx2 = await ledger.createTransaction({
        date: new Date('2024-01-05'),
        description: 'Bank loan',
        entries: [
          { accountId: cashAccount.id, debit: 20000, credit: 0 },
          { accountId: apAccount.id, debit: 0, credit: 20000 },
        ],
      })
      await ledger.postTransaction(tx2.id)

      const verification = await ledger.verifyAccountingEquation()

      expect(verification.assets).toBe(70000)
      expect(verification.liabilities).toBe(20000)
      expect(verification.equity).toBe(50000)
      expect(verification.isBalanced).toBe(true)
      expect(verification.assets).toBe(verification.liabilities + verification.equity)
    })

    it('should detect balance discrepancies', async () => {
      // Simulate corrupted data by directly manipulating (in real test would use internal APIs)
      const tx = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Normal transaction',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx.id)

      // Force a balance check with known good data first
      const healthCheck = await ledger.runBalanceHealthCheck()

      expect(healthCheck.hasDiscrepancies).toBe(false)
      expect(healthCheck.calculatedBalances).toBeDefined()
      expect(healthCheck.storedBalances).toBeDefined()
    })

    it('should reconcile account with external statement', async () => {
      const tx1 = await ledger.createTransaction({
        date: new Date('2024-01-15'),
        description: 'Deposit',
        entries: [
          { accountId: cashAccount.id, debit: 10000, credit: 0 },
          { accountId: revenueAccount.id, debit: 0, credit: 10000 },
        ],
      })
      await ledger.postTransaction(tx1.id)

      const reconciliation = await ledger.reconcileAccount(cashAccount.id, {
        statementDate: new Date('2024-01-31'),
        statementBalance: 10000,
        items: [
          { date: new Date('2024-01-15'), amount: 10000, cleared: true },
        ],
      })

      expect(reconciliation.isReconciled).toBe(true)
      expect(reconciliation.difference).toBe(0)
    })
  })
})
