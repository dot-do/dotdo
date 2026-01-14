/**
 * Transaction Processor Tests - GREEN Phase
 *
 * Tests for the transaction processor that enforces double-entry rules
 * and updates account balances atomically.
 *
 * Features tested:
 * 1. Double-entry rule: debits must equal credits
 * 2. Atomic balance updates
 * 3. Transaction validation before posting
 * 4. Multi-line transaction support (journal entries with >2 lines)
 * 5. Balance calculation (running balance per account)
 * 6. Transaction reversal support
 * 7. Period locking (prevent changes to closed periods)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTransactionProcessor,
  type TransactionProcessor,
  type Transaction,
  type TransactionLine,
  type PostedTransaction,
  type Balance,
  type ValidationResult,
} from '../transaction-processor'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestProcessor(): TransactionProcessor {
  return createTransactionProcessor()
}

const simpleTransaction: Transaction = {
  id: 'txn-001',
  date: new Date('2024-01-15'),
  description: 'Cash sale',
  lines: [
    { accountId: 'acc-cash', debit: 10000, credit: 0 },
    { accountId: 'acc-revenue', debit: 0, credit: 10000 },
  ],
}

// =============================================================================
// Double-Entry Rule Enforcement Tests
// =============================================================================

describe('TransactionProcessor', () => {
  describe('double-entry rule enforcement', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should accept balanced transaction', async () => {
      const result = await processor.post(simpleTransaction)

      expect(result.id).toBe('txn-001')
      expect(result.status).toBe('posted')
      expect(result.postedAt).toBeInstanceOf(Date)
    })

    it('should reject transaction where debits exceed credits', async () => {
      const unbalanced: Transaction = {
        id: 'txn-unbal-1',
        date: new Date('2024-01-15'),
        description: 'Unbalanced - debits > credits',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 8000 },
        ],
      }

      await expect(processor.post(unbalanced)).rejects.toThrow(
        'Transaction must balance: debits (10000) != credits (8000)'
      )
    })

    it('should reject transaction where credits exceed debits', async () => {
      const unbalanced: Transaction = {
        id: 'txn-unbal-2',
        date: new Date('2024-01-15'),
        description: 'Unbalanced - credits > debits',
        lines: [
          { accountId: 'acc-cash', debit: 8000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      await expect(processor.post(unbalanced)).rejects.toThrow(
        'Transaction must balance: debits (8000) != credits (10000)'
      )
    })

    it('should reject transaction with zero amounts', async () => {
      const zeroTransaction: Transaction = {
        id: 'txn-zero',
        date: new Date('2024-01-15'),
        description: 'Zero transaction',
        lines: [
          { accountId: 'acc-cash', debit: 0, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 0 },
        ],
      }

      await expect(processor.post(zeroTransaction)).rejects.toThrow(
        'Transaction must have non-zero amount'
      )
    })

    it('should reject transaction with single line', async () => {
      const singleLine: Transaction = {
        id: 'txn-single',
        date: new Date('2024-01-15'),
        description: 'Single line',
        lines: [{ accountId: 'acc-cash', debit: 10000, credit: 0 }],
      }

      await expect(processor.post(singleLine)).rejects.toThrow(
        'Transaction must have at least two lines'
      )
    })

    it('should reject transaction with no lines', async () => {
      const noLines: Transaction = {
        id: 'txn-empty',
        date: new Date('2024-01-15'),
        description: 'Empty transaction',
        lines: [],
      }

      await expect(processor.post(noLines)).rejects.toThrow(
        'Transaction must have at least two lines'
      )
    })

    it('should reject line with both debit and credit', async () => {
      const bothDebitCredit: Transaction = {
        id: 'txn-both',
        date: new Date('2024-01-15'),
        description: 'Both debit and credit',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 5000 },
          { accountId: 'acc-revenue', debit: 5000, credit: 5000 },
        ],
      }

      await expect(processor.post(bothDebitCredit)).rejects.toThrow(
        'Line cannot have both debit and credit'
      )
    })

    it('should reject negative amounts', async () => {
      const negative: Transaction = {
        id: 'txn-negative',
        date: new Date('2024-01-15'),
        description: 'Negative amounts',
        lines: [
          { accountId: 'acc-cash', debit: -10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: -10000 },
        ],
      }

      await expect(processor.post(negative)).rejects.toThrow(
        'Line amounts must be non-negative'
      )
    })
  })

  // =============================================================================
  // Atomic Balance Updates Tests
  // =============================================================================

  describe('atomic balance updates', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should update account balances after posting', async () => {
      await processor.post(simpleTransaction)

      const cashBalance = await processor.getAccountBalance('acc-cash')
      const revenueBalance = await processor.getAccountBalance('acc-revenue')

      expect(cashBalance.debitTotal).toBe(10000)
      expect(cashBalance.creditTotal).toBe(0)
      expect(cashBalance.balance).toBe(10000)

      expect(revenueBalance.debitTotal).toBe(0)
      expect(revenueBalance.creditTotal).toBe(10000)
      expect(revenueBalance.balance).toBe(10000)
    })

    it('should accumulate balances across multiple transactions', async () => {
      await processor.post(simpleTransaction)

      const secondTransaction: Transaction = {
        id: 'txn-002',
        date: new Date('2024-01-16'),
        description: 'Second sale',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 5000 },
        ],
      }
      await processor.post(secondTransaction)

      const cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.debitTotal).toBe(15000)
      expect(cashBalance.balance).toBe(15000)
    })

    it('should handle mixed debits and credits to same account', async () => {
      // First transaction: debit cash
      await processor.post(simpleTransaction)

      // Second transaction: credit cash (payment for expense)
      const expenseTransaction: Transaction = {
        id: 'txn-exp',
        date: new Date('2024-01-17'),
        description: 'Office supplies',
        lines: [
          { accountId: 'acc-expense', debit: 3000, credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: 3000 },
        ],
      }
      await processor.post(expenseTransaction)

      const cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.debitTotal).toBe(10000)
      expect(cashBalance.creditTotal).toBe(3000)
      expect(cashBalance.balance).toBe(7000) // Net balance
    })

    it('should return zero balance for account with no transactions', async () => {
      const balance = await processor.getAccountBalance('acc-nonexistent')

      expect(balance.debitTotal).toBe(0)
      expect(balance.creditTotal).toBe(0)
      expect(balance.balance).toBe(0)
    })
  })

  // =============================================================================
  // Transaction Validation Tests
  // =============================================================================

  describe('transaction validation before posting', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should validate balanced transaction as valid', () => {
      const result = processor.validateBalance(simpleTransaction)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.totalDebits).toBe(10000)
      expect(result.totalCredits).toBe(10000)
    })

    it('should return validation errors for unbalanced transaction', () => {
      const unbalanced: Transaction = {
        id: 'txn-unbal',
        date: new Date('2024-01-15'),
        description: 'Unbalanced',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 8000 },
        ],
      }

      const result = processor.validateBalance(unbalanced)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Transaction must balance: debits (10000) != credits (8000)')
    })

    it('should return validation errors for lines with both debit and credit', () => {
      const invalid: Transaction = {
        id: 'txn-invalid',
        date: new Date('2024-01-15'),
        description: 'Invalid',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 5000 },
          { accountId: 'acc-revenue', debit: 0, credit: 0 },
        ],
      }

      const result = processor.validateBalance(invalid)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Line cannot have both debit and credit')
    })

    it('should return multiple validation errors', () => {
      const multipleErrors: Transaction = {
        id: 'txn-multi-err',
        date: new Date('2024-01-15'),
        description: 'Multiple errors',
        lines: [
          { accountId: 'acc-cash', debit: -100, credit: 0 },
        ],
      }

      const result = processor.validateBalance(multipleErrors)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(1)
    })
  })

  // =============================================================================
  // Multi-Line Transaction Support Tests
  // =============================================================================

  describe('multi-line transaction support', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should handle three-line transaction (sale with tax)', async () => {
      const saleWithTax: Transaction = {
        id: 'txn-tax',
        date: new Date('2024-01-15'),
        description: 'Cash sale with tax',
        lines: [
          { accountId: 'acc-cash', debit: 10800, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
          { accountId: 'acc-tax-payable', debit: 0, credit: 800 },
        ],
      }

      const result = await processor.post(saleWithTax)

      expect(result.status).toBe('posted')
      expect(result.lineCount).toBe(3)
    })

    it('should handle four-line transaction (sale with COGS)', async () => {
      const saleWithCOGS: Transaction = {
        id: 'txn-cogs',
        date: new Date('2024-01-15'),
        description: 'Sale with cost of goods sold',
        lines: [
          { accountId: 'acc-cash', debit: 15000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 15000 },
          { accountId: 'acc-cogs', debit: 7500, credit: 0 },
          { accountId: 'acc-inventory', debit: 0, credit: 7500 },
        ],
      }

      const result = await processor.post(saleWithCOGS)

      expect(result.status).toBe('posted')
      expect(result.lineCount).toBe(4)
    })

    it('should handle complex allocation transaction', async () => {
      // Allocate expense across multiple departments
      const allocation: Transaction = {
        id: 'txn-alloc',
        date: new Date('2024-01-15'),
        description: 'Utility expense allocation',
        lines: [
          { accountId: 'acc-dept-a-expense', debit: 2500, credit: 0 },
          { accountId: 'acc-dept-b-expense', debit: 2500, credit: 0 },
          { accountId: 'acc-dept-c-expense', debit: 2500, credit: 0 },
          { accountId: 'acc-dept-d-expense', debit: 2500, credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: 10000 },
        ],
      }

      const result = await processor.post(allocation)

      expect(result.status).toBe('posted')
      expect(result.lineCount).toBe(5)

      // Verify all department balances
      for (const dept of ['a', 'b', 'c', 'd']) {
        const balance = await processor.getAccountBalance(`acc-dept-${dept}-expense`)
        expect(balance.debitTotal).toBe(2500)
      }
    })

    it('should handle transaction with multiple debits and multiple credits', async () => {
      const complex: Transaction = {
        id: 'txn-complex',
        date: new Date('2024-01-15'),
        description: 'Complex journal entry',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 0 },
          { accountId: 'acc-ar', debit: 3000, credit: 0 },
          { accountId: 'acc-prepaid', debit: 2000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 8000 },
          { accountId: 'acc-deferred-revenue', debit: 0, credit: 2000 },
        ],
      }

      const result = await processor.post(complex)

      expect(result.status).toBe('posted')
    })
  })

  // =============================================================================
  // Balance Calculation Tests
  // =============================================================================

  describe('balance calculation (running balance per account)', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should calculate running balance after each transaction', async () => {
      // Transaction 1: +10000
      await processor.post({
        id: 'txn-1',
        date: new Date('2024-01-10'),
        description: 'Sale 1',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      })

      let balance = await processor.getAccountBalance('acc-cash')
      expect(balance.balance).toBe(10000)

      // Transaction 2: +5000
      await processor.post({
        id: 'txn-2',
        date: new Date('2024-01-15'),
        description: 'Sale 2',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 5000 },
        ],
      })

      balance = await processor.getAccountBalance('acc-cash')
      expect(balance.balance).toBe(15000)

      // Transaction 3: -3000
      await processor.post({
        id: 'txn-3',
        date: new Date('2024-01-20'),
        description: 'Payment',
        lines: [
          { accountId: 'acc-expense', debit: 3000, credit: 0 },
          { accountId: 'acc-cash', debit: 0, credit: 3000 },
        ],
      })

      balance = await processor.getAccountBalance('acc-cash')
      expect(balance.balance).toBe(12000)
    })

    it('should return balance with transaction count', async () => {
      await processor.post(simpleTransaction)

      const balance = await processor.getAccountBalance('acc-cash')

      expect(balance.transactionCount).toBe(1)
    })

    it('should track as-of date for balance', async () => {
      await processor.post(simpleTransaction)

      const balance = await processor.getAccountBalance('acc-cash')

      expect(balance.asOfDate).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Transaction Reversal Tests
  // =============================================================================

  describe('transaction reversal support', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should reverse a posted transaction', async () => {
      await processor.post(simpleTransaction)

      const reversal = await processor.reverse('txn-001', 'Customer return')

      expect(reversal.status).toBe('posted')
      expect(reversal.reversesTransactionId).toBe('txn-001')
      expect(reversal.reversalReason).toBe('Customer return')
    })

    it('should swap debits and credits in reversal', async () => {
      await processor.post(simpleTransaction)

      const reversal = await processor.reverse('txn-001', 'Correction')

      // Original: Cash debit 10000, Revenue credit 10000
      // Reversal: Cash credit 10000, Revenue debit 10000
      const cashLine = reversal.lines.find((l) => l.accountId === 'acc-cash')
      const revenueLine = reversal.lines.find((l) => l.accountId === 'acc-revenue')

      expect(cashLine?.debit).toBe(0)
      expect(cashLine?.credit).toBe(10000)
      expect(revenueLine?.debit).toBe(10000)
      expect(revenueLine?.credit).toBe(0)
    })

    it('should update account balances after reversal', async () => {
      await processor.post(simpleTransaction)

      let cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(10000)

      await processor.reverse('txn-001', 'Void')

      cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(0)
    })

    it('should reject reversal of non-existent transaction', async () => {
      await expect(
        processor.reverse('txn-nonexistent', 'Test')
      ).rejects.toThrow('Transaction not found')
    })

    it('should reject reversal of already reversed transaction', async () => {
      await processor.post(simpleTransaction)
      await processor.reverse('txn-001', 'First reversal')

      await expect(
        processor.reverse('txn-001', 'Second reversal')
      ).rejects.toThrow('Transaction already reversed')
    })

    it('should create reversal with correct date', async () => {
      await processor.post(simpleTransaction)

      const reversal = await processor.reverse('txn-001', 'Correction')

      expect(reversal.date).toBeInstanceOf(Date)
      expect(reversal.date.getTime()).toBeGreaterThanOrEqual(simpleTransaction.date.getTime())
    })

    it('should reverse multi-line transaction correctly', async () => {
      const multiLine: Transaction = {
        id: 'txn-multi',
        date: new Date('2024-01-15'),
        description: 'Multi-line',
        lines: [
          { accountId: 'acc-cash', debit: 10800, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
          { accountId: 'acc-tax-payable', debit: 0, credit: 800 },
        ],
      }
      await processor.post(multiLine)

      const reversal = await processor.reverse('txn-multi', 'Return with tax')

      expect(reversal.lines).toHaveLength(3)

      const cashLine = reversal.lines.find((l) => l.accountId === 'acc-cash')
      const revenueLine = reversal.lines.find((l) => l.accountId === 'acc-revenue')
      const taxLine = reversal.lines.find((l) => l.accountId === 'acc-tax-payable')

      expect(cashLine?.credit).toBe(10800)
      expect(revenueLine?.debit).toBe(10000)
      expect(taxLine?.debit).toBe(800)
    })
  })

  // =============================================================================
  // Period Locking Tests
  // =============================================================================

  describe('period locking (prevent changes to closed periods)', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should allow posting to unlocked period', async () => {
      const result = await processor.post(simpleTransaction)

      expect(result.status).toBe('posted')
    })

    it('should lock a period', async () => {
      await processor.lockPeriod(new Date('2024-01-31'))

      // Verify the period is locked by trying to post
      const lockedPeriodTxn: Transaction = {
        id: 'txn-locked',
        date: new Date('2024-01-15'),
        description: 'In locked period',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      await expect(processor.post(lockedPeriodTxn)).rejects.toThrow(
        'Cannot post to locked period'
      )
    })

    it('should allow posting after locked period', async () => {
      await processor.lockPeriod(new Date('2024-01-31'))

      const afterLockedPeriod: Transaction = {
        id: 'txn-after',
        date: new Date('2024-02-15'),
        description: 'After locked period',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      const result = await processor.post(afterLockedPeriod)
      expect(result.status).toBe('posted')
    })

    it('should reject posting on the lock date boundary', async () => {
      await processor.lockPeriod(new Date('2024-01-31'))

      const onBoundary: Transaction = {
        id: 'txn-boundary',
        date: new Date('2024-01-31'),
        description: 'On boundary',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      await expect(processor.post(onBoundary)).rejects.toThrow(
        'Cannot post to locked period'
      )
    })

    it('should prevent reversal in locked period', async () => {
      // Post transaction before locking
      await processor.post(simpleTransaction)

      // Lock the period
      await processor.lockPeriod(new Date('2024-01-31'))

      // Try to reverse - should fail because original is in locked period
      await expect(
        processor.reverse('txn-001', 'Attempt to reverse locked')
      ).rejects.toThrow('Cannot reverse transaction in locked period')
    })

    it('should support multiple period locks', async () => {
      await processor.lockPeriod(new Date('2024-01-31'))
      await processor.lockPeriod(new Date('2024-02-29'))

      const inFeb: Transaction = {
        id: 'txn-feb',
        date: new Date('2024-02-15'),
        description: 'February',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      await expect(processor.post(inFeb)).rejects.toThrow(
        'Cannot post to locked period'
      )
    })

    it('should allow posting to the day after lock date', async () => {
      await processor.lockPeriod(new Date('2024-01-31'))

      const dayAfter: Transaction = {
        id: 'txn-day-after',
        date: new Date('2024-02-01'),
        description: 'Day after lock',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      }

      const result = await processor.post(dayAfter)
      expect(result.status).toBe('posted')
    })
  })

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe('integration scenarios', () => {
    let processor: TransactionProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should handle typical month-end closing workflow', async () => {
      // Post several transactions
      await processor.post({
        id: 'txn-jan-1',
        date: new Date('2024-01-05'),
        description: 'Sale 1',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      })

      await processor.post({
        id: 'txn-jan-2',
        date: new Date('2024-01-20'),
        description: 'Sale 2',
        lines: [
          { accountId: 'acc-cash', debit: 15000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 15000 },
        ],
      })

      // Verify balances before close
      let cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(25000)

      // Lock the period
      await processor.lockPeriod(new Date('2024-01-31'))

      // Can still read balances
      cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(25000)

      // Can post to February
      await processor.post({
        id: 'txn-feb-1',
        date: new Date('2024-02-05'),
        description: 'February sale',
        lines: [
          { accountId: 'acc-cash', debit: 5000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 5000 },
        ],
      })

      cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(30000)
    })

    it('should handle error correction workflow', async () => {
      // Post original transaction
      await processor.post({
        id: 'txn-original',
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: [
          { accountId: 'acc-cash', debit: 10000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 10000 },
        ],
      })

      // Discover error and reverse
      await processor.reverse('txn-original', 'Incorrect amount')

      // Post corrected transaction
      await processor.post({
        id: 'txn-corrected',
        date: new Date('2024-01-15'),
        description: 'Corrected entry',
        lines: [
          { accountId: 'acc-cash', debit: 12000, credit: 0 },
          { accountId: 'acc-revenue', debit: 0, credit: 12000 },
        ],
      })

      const cashBalance = await processor.getAccountBalance('acc-cash')
      expect(cashBalance.balance).toBe(12000)
    })
  })
})
