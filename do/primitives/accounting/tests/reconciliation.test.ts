/**
 * Bank Reconciliation Tests - TDD RED Phase
 *
 * Tests for bank reconciliation functionality:
 * - Statement matching - match bank transactions to ledger entries
 * - Discrepancy detection - identify mismatches, missing entries
 * - Reconciliation workflow - approve/reject matches, handle exceptions
 * - Date range reconciliation
 * - Multi-account reconciliation
 * - Tolerance matching (within $0.01)
 * - Duplicate detection
 * - Unreconciled item tracking
 *
 * All tests should FAIL because implementation doesn't exist yet.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createReconciliationEngine,
  type ReconciliationEngine,
  type BankStatement,
  type BankTransaction,
  type LedgerEntry,
  type ReconciliationSession,
  type ReconciliationMatch,
  type ReconciliationDiscrepancy,
  type MatchStatus,
  type ReconciliationSummary,
  type MatchingRule,
  type ExtendedReconciliationException,
} from '../reconciliation'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEngine(): ReconciliationEngine {
  return createReconciliationEngine()
}

function createBankTransaction(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: `bank-txn-${Math.random().toString(36).slice(2)}`,
    date: new Date('2024-01-15'),
    amount: 10000, // $100.00 in cents
    description: 'Wire transfer',
    reference: 'REF-001',
    type: 'credit',
    ...overrides,
  }
}

function createLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `ledger-entry-${Math.random().toString(36).slice(2)}`,
    date: new Date('2024-01-15'),
    amount: 10000, // $100.00 in cents
    description: 'Payment received',
    reference: 'REF-001',
    accountId: 'acc-checking',
    journalEntryId: 'je-001',
    ...overrides,
  }
}

const sampleBankStatement: BankStatement = {
  id: 'stmt-001',
  accountId: 'acc-checking',
  bankAccountNumber: '****1234',
  statementDate: new Date('2024-01-31'),
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31'),
  openingBalance: 500000, // $5,000.00
  closingBalance: 750000, // $7,500.00
  transactions: [],
}

// =============================================================================
// Statement Matching Tests
// =============================================================================

describe('ReconciliationEngine', () => {
  describe('statement matching', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match bank transaction to ledger entry by exact amount and date', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'PAY-001',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'PAY-001',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].bankTransactionId).toBe(bankTxn.id)
      expect(matches[0].ledgerEntryId).toBe(ledgerEntry.id)
      expect(matches[0].confidence).toBe(1.0)
    })

    it('should match by reference number when amounts match', async () => {
      const bankTxn = createBankTransaction({
        amount: 25000,
        reference: 'INV-2024-001',
        description: 'Customer payment',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 25000,
        reference: 'INV-2024-001',
        description: 'Invoice payment received',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].matchType).toBe('reference')
    })

    it('should suggest multiple possible matches when ambiguous', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
      })
      const ledgerEntry1 = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        description: 'Payment A',
      })
      const ledgerEntry2 = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        description: 'Payment B',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry1, ledgerEntry2],
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(2)
      expect(matches.every((m) => m.status === 'suggested')).toBe(true)
    })

    it('should match one-to-many when single bank txn matches multiple ledger entries', async () => {
      const bankTxn = createBankTransaction({
        amount: 30000, // $300
        date: new Date('2024-01-15'),
        description: 'Batch deposit',
      })
      const ledgerEntries = [
        createLedgerEntry({ amount: 10000, date: new Date('2024-01-15') }),
        createLedgerEntry({ amount: 10000, date: new Date('2024-01-15') }),
        createLedgerEntry({ amount: 10000, date: new Date('2024-01-15') }),
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries,
      })

      const groupedMatches = await engine.findGroupedMatches(session.id)

      expect(groupedMatches).toHaveLength(1)
      expect(groupedMatches[0].bankTransactionIds).toEqual([bankTxn.id])
      expect(groupedMatches[0].ledgerEntryIds).toHaveLength(3)
      expect(groupedMatches[0].totalAmount).toBe(30000)
    })

    it('should match many-to-one when multiple bank txns match single ledger entry', async () => {
      const bankTxns = [
        createBankTransaction({ amount: 5000, date: new Date('2024-01-14') }),
        createBankTransaction({ amount: 5000, date: new Date('2024-01-15') }),
      ]
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        description: 'Combined payment',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: bankTxns },
        ledgerEntries: [ledgerEntry],
      })

      const groupedMatches = await engine.findGroupedMatches(session.id)

      expect(groupedMatches).toHaveLength(1)
      expect(groupedMatches[0].bankTransactionIds).toHaveLength(2)
      expect(groupedMatches[0].ledgerEntryIds).toEqual([ledgerEntry.id])
    })

    it('should respect date proximity when matching', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
      })
      const closeEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-14'), // 1 day difference
      })
      const farEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-05'), // 10 days difference
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [closeEntry, farEntry],
      })

      const matches = await engine.findMatches(session.id)

      // Should prefer closer date
      expect(matches[0].ledgerEntryId).toBe(closeEntry.id)
      expect(matches[0].confidence).toBeGreaterThan(matches[1]?.confidence || 0)
    })

    it('should not match entries outside configurable date window', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-31'),
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-01'), // 30 days apart
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
        options: { maxDateDifferenceInDays: 7 },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(0)
    })
  })

  // =============================================================================
  // Discrepancy Detection Tests
  // =============================================================================

  describe('discrepancy detection', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should identify unmatched bank transactions', async () => {
      const bankTxn = createBankTransaction({
        amount: 15000,
        description: 'Unknown deposit',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [], // No ledger entries
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.unmatchedBankTransactions).toHaveLength(1)
      expect(discrepancies.unmatchedBankTransactions[0].id).toBe(bankTxn.id)
    })

    it('should identify unmatched ledger entries', async () => {
      const ledgerEntry = createLedgerEntry({
        amount: 20000,
        description: 'Recorded payment',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [] }, // No bank transactions
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.unmatchedLedgerEntries).toHaveLength(1)
      expect(discrepancies.unmatchedLedgerEntries[0].id).toBe(ledgerEntry.id)
    })

    it('should identify amount mismatches', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        reference: 'PAY-001',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10050, // $0.50 difference
        reference: 'PAY-001',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.amountMismatches).toHaveLength(1)
      expect(discrepancies.amountMismatches[0].bankAmount).toBe(10000)
      expect(discrepancies.amountMismatches[0].ledgerAmount).toBe(10050)
      expect(discrepancies.amountMismatches[0].difference).toBe(-50)
    })

    it('should identify date mismatches', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-20'),
        reference: 'PAY-001',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'), // 5 days earlier
        reference: 'PAY-001',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.dateMismatches).toHaveLength(1)
      expect(discrepancies.dateMismatches[0].daysDifference).toBe(5)
    })

    it('should calculate reconciliation difference', async () => {
      const bankTxns = [
        createBankTransaction({ amount: 10000, type: 'credit' }),
        createBankTransaction({ amount: 5000, type: 'debit' }),
      ]
      const ledgerEntries = [
        createLedgerEntry({ amount: 10000 }),
        createLedgerEntry({ amount: 3000 }), // Missing $20.00
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: bankTxns },
        ledgerEntries,
      })

      const summary = await engine.getReconciliationSummary(session.id)

      expect(summary.bankTotal).toBe(5000) // 10000 - 5000
      expect(summary.ledgerTotal).toBe(13000) // 10000 + 3000
      expect(summary.difference).toBe(-8000)
      expect(summary.isReconciled).toBe(false)
    })

    it('should flag suspicious transactions', async () => {
      const bankTxn = createBankTransaction({
        amount: 1000000, // Large amount
        description: 'Unusual wire transfer',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { flagThreshold: 500000 },
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.flaggedItems).toHaveLength(1)
      expect(discrepancies.flaggedItems[0].reason).toBe('amount_exceeds_threshold')
    })

    it('should identify timing differences (outstanding checks/deposits)', async () => {
      // Outstanding check - recorded but not cleared
      const ledgerEntry = createLedgerEntry({
        amount: -5000, // Debit
        date: new Date('2024-01-28'),
        description: 'Check #1234',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [],
          endDate: new Date('2024-01-31'),
        },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.outstandingItems).toHaveLength(1)
      expect(discrepancies.outstandingItems[0].type).toBe('outstanding_check')
    })

    it('should identify deposits in transit', async () => {
      const ledgerEntry = createLedgerEntry({
        amount: 15000,
        date: new Date('2024-01-30'),
        description: 'Deposit',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [],
          endDate: new Date('2024-01-31'),
        },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.outstandingItems.some((i) => i.type === 'deposit_in_transit')).toBe(true)
    })
  })

  // =============================================================================
  // Reconciliation Workflow Tests
  // =============================================================================

  describe('reconciliation workflow', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should create a reconciliation session', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      expect(session.id).toBeDefined()
      expect(session.status).toBe('in_progress')
      expect(session.accountId).toBe('acc-checking')
      expect(session.createdAt).toBeInstanceOf(Date)
    })

    it('should approve a suggested match', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })
      const ledgerEntry = createLedgerEntry({ amount: 10000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)
      const approvedMatch = await engine.approveMatch(session.id, matches[0].id)

      expect(approvedMatch.status).toBe('approved')
      expect(approvedMatch.approvedAt).toBeInstanceOf(Date)
    })

    it('should reject a suggested match', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })
      const ledgerEntry = createLedgerEntry({ amount: 10000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)
      const rejectedMatch = await engine.rejectMatch(session.id, matches[0].id, {
        reason: 'Incorrect match',
      })

      expect(rejectedMatch.status).toBe('rejected')
      expect(rejectedMatch.rejectionReason).toBe('Incorrect match')
    })

    it('should allow manual match creation', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        description: 'Bank description',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        description: 'Different description',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const manualMatch = await engine.createManualMatch(session.id, {
        bankTransactionId: bankTxn.id,
        ledgerEntryId: ledgerEntry.id,
        note: 'Manual match - confirmed with bank',
      })

      expect(manualMatch.status).toBe('approved')
      expect(manualMatch.matchType).toBe('manual')
      expect(manualMatch.note).toBe('Manual match - confirmed with bank')
    })

    it('should handle exception items', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        description: 'Unknown charge',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: bankTxn.id,
        type: 'missing_ledger_entry',
        note: 'Need to create journal entry for bank fee',
      })

      expect(exception.id).toBeDefined()
      expect(exception.type).toBe('missing_ledger_entry')
      expect(exception.status).toBe('open')
    })

    it('should resolve exception items', async () => {
      const bankTxn = createBankTransaction({ amount: 5000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: bankTxn.id,
        type: 'missing_ledger_entry',
      })

      const resolved = await engine.resolveException(session.id, exception.id, {
        resolution: 'created_entry',
        journalEntryId: 'je-new-001',
        note: 'Created adjustment entry',
      })

      expect(resolved.status).toBe('resolved')
      expect(resolved.resolution).toBe('created_entry')
    })

    it('should finalize reconciliation session', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })
      const ledgerEntry = createLedgerEntry({ amount: 10000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)
      await engine.approveMatch(session.id, matches[0].id)

      const finalized = await engine.finalizeSession(session.id)

      expect(finalized.status).toBe('completed')
      expect(finalized.completedAt).toBeInstanceOf(Date)
    })

    it('should not finalize with unresolved exceptions', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
      })

      await engine.createException(session.id, {
        bankTransactionId: bankTxn.id,
        type: 'missing_ledger_entry',
      })

      await expect(engine.finalizeSession(session.id)).rejects.toThrow(
        'Cannot finalize with unresolved exceptions'
      )
    })

    it('should require all items to be matched or excepted before finalizing', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [], // No matching entry, no exception
      })

      await expect(engine.finalizeSession(session.id)).rejects.toThrow(
        'All items must be matched or have exceptions'
      )
    })

    it('should track reconciliation history', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const history = await engine.getSessionHistory(session.id)

      expect(history).toHaveLength(1)
      expect(history[0].event).toBe('session_created')
    })

    it('should support session notes and comments', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const updated = await engine.addSessionNote(session.id, {
        note: 'Waiting for bank statement correction',
        author: 'accountant@example.com',
      })

      expect(updated.notes).toHaveLength(1)
      expect(updated.notes[0].text).toBe('Waiting for bank statement correction')
    })
  })

  // =============================================================================
  // Date Range Reconciliation Tests
  // =============================================================================

  describe('date range reconciliation', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should reconcile within specific date range', async () => {
      const transactions = [
        createBankTransaction({ date: new Date('2024-01-05'), amount: 1000 }),
        createBankTransaction({ date: new Date('2024-01-15'), amount: 2000 }),
        createBankTransaction({ date: new Date('2024-01-25'), amount: 3000 }),
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions },
        ledgerEntries: [],
        options: {
          startDate: new Date('2024-01-10'),
          endDate: new Date('2024-01-20'),
        },
      })

      const summary = await engine.getReconciliationSummary(session.id)

      // Only the Jan 15 transaction should be in scope
      expect(summary.transactionsInScope).toBe(1)
      expect(summary.bankTotal).toBe(2000)
    })

    it('should carry forward outstanding items from previous period', async () => {
      // First, create previous month's session with outstanding item
      const prevSession = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          startDate: new Date('2023-12-01'),
          endDate: new Date('2023-12-31'),
        },
        ledgerEntries: [
          createLedgerEntry({
            amount: -5000,
            date: new Date('2023-12-28'),
            description: 'Check #999',
          }),
        ],
      })

      // Mark as outstanding
      await engine.markAsOutstanding(prevSession.id, {
        ledgerEntryId: 'ledger-entry-check999',
        type: 'outstanding_check',
      })

      // Create current month's session
      const currentSession = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
        },
        ledgerEntries: [],
        options: { carryForwardFrom: prevSession.id },
      })

      const summary = await engine.getReconciliationSummary(currentSession.id)

      expect(summary.carriedForwardItems).toBe(1)
      expect(summary.outstandingChecksTotal).toBe(5000)
    })

    it('should handle month-end cutoff correctly', async () => {
      const bankTxn = createBankTransaction({
        date: new Date('2024-02-01'), // Next month
        amount: 10000,
      })
      const ledgerEntry = createLedgerEntry({
        date: new Date('2024-01-31'), // Last day of month
        amount: 10000,
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          endDate: new Date('2024-01-31'),
          transactions: [bankTxn],
        },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      // Should identify as timing difference
      expect(discrepancies.timingDifferences).toHaveLength(1)
    })

    it('should support rolling reconciliation', async () => {
      const session = await engine.createRollingSession({
        accountId: 'acc-checking',
        rollingDays: 30,
      })

      expect(session.startDate).toBeDefined()
      expect(session.endDate).toBeDefined()

      const daysDiff = Math.round(
        (session.endDate.getTime() - session.startDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      expect(daysDiff).toBe(30)
    })

    it('should generate period comparison report', async () => {
      const jan = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          transactions: [createBankTransaction({ amount: 50000 })],
        },
        ledgerEntries: [createLedgerEntry({ amount: 50000 })],
      })

      const feb = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          startDate: new Date('2024-02-01'),
          endDate: new Date('2024-02-29'),
          transactions: [createBankTransaction({ amount: 75000 })],
        },
        ledgerEntries: [createLedgerEntry({ amount: 75000 })],
      })

      const comparison = await engine.comparePeriods([jan.id, feb.id])

      expect(comparison.periods).toHaveLength(2)
      expect(comparison.trends.volumeChange).toBe(50) // 50% increase
    })
  })

  // =============================================================================
  // Multi-Account Reconciliation Tests
  // =============================================================================

  describe('multi-account reconciliation', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should reconcile multiple accounts simultaneously', async () => {
      const checkingStatement: BankStatement = {
        ...sampleBankStatement,
        id: 'stmt-checking',
        accountId: 'acc-checking',
        transactions: [createBankTransaction({ amount: 10000 })],
      }

      const savingsStatement: BankStatement = {
        ...sampleBankStatement,
        id: 'stmt-savings',
        accountId: 'acc-savings',
        transactions: [createBankTransaction({ amount: 20000 })],
      }

      const multiSession = await engine.createMultiAccountSession({
        statements: [checkingStatement, savingsStatement],
        ledgerEntries: [
          createLedgerEntry({ amount: 10000, accountId: 'acc-checking' }),
          createLedgerEntry({ amount: 20000, accountId: 'acc-savings' }),
        ],
      })

      expect(multiSession.accounts).toHaveLength(2)
      expect(multiSession.sessions).toHaveLength(2)
    })

    it('should track inter-account transfers', async () => {
      const checkingDebit = createBankTransaction({
        amount: -5000,
        type: 'debit',
        description: 'Transfer to Savings',
      })
      const savingsCredit = createBankTransaction({
        amount: 5000,
        type: 'credit',
        description: 'Transfer from Checking',
      })

      const multiSession = await engine.createMultiAccountSession({
        statements: [
          { ...sampleBankStatement, accountId: 'acc-checking', transactions: [checkingDebit] },
          { ...sampleBankStatement, accountId: 'acc-savings', transactions: [savingsCredit] },
        ],
        ledgerEntries: [],
      })

      const transfers = await engine.detectInterAccountTransfers(multiSession.id)

      expect(transfers).toHaveLength(1)
      expect(transfers[0].fromAccount).toBe('acc-checking')
      expect(transfers[0].toAccount).toBe('acc-savings')
      expect(transfers[0].amount).toBe(5000)
    })

    it('should consolidate multi-account summary', async () => {
      const multiSession = await engine.createMultiAccountSession({
        statements: [
          {
            ...sampleBankStatement,
            accountId: 'acc-checking',
            closingBalance: 100000,
            transactions: [],
          },
          {
            ...sampleBankStatement,
            accountId: 'acc-savings',
            closingBalance: 200000,
            transactions: [],
          },
        ],
        ledgerEntries: [],
      })

      const consolidated = await engine.getConsolidatedSummary(multiSession.id)

      expect(consolidated.totalBankBalance).toBe(300000)
      expect(consolidated.accountCount).toBe(2)
    })

    it('should handle currency conversion for multi-currency accounts', async () => {
      const usdStatement: BankStatement = {
        ...sampleBankStatement,
        accountId: 'acc-usd',
        currency: 'USD',
        transactions: [createBankTransaction({ amount: 10000 })],
      }

      const eurStatement: BankStatement = {
        ...sampleBankStatement,
        accountId: 'acc-eur',
        currency: 'EUR',
        transactions: [createBankTransaction({ amount: 9000 })],
      }

      const multiSession = await engine.createMultiAccountSession({
        statements: [usdStatement, eurStatement],
        ledgerEntries: [],
        options: {
          baseCurrency: 'USD',
          exchangeRates: { EUR: 1.1 }, // 1 EUR = 1.1 USD
        },
      })

      const consolidated = await engine.getConsolidatedSummary(multiSession.id)

      // 10000 USD + 9000 EUR * 1.1 = 10000 + 9900 = 19900
      expect(consolidated.totalInBaseCurrency).toBe(19900)
    })

    it('should validate account assignments', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000,
        accountId: 'acc-checking',
      })
      const ledgerEntry = createLedgerEntry({
        amount: 10000,
        accountId: 'acc-savings', // Wrong account
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.accountMismatches).toHaveLength(1)
    })
  })

  // =============================================================================
  // Tolerance Matching Tests
  // =============================================================================

  describe('tolerance matching', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match within $0.01 tolerance by default', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 }) // $100.00
      const ledgerEntry = createLedgerEntry({ amount: 10001 }) // $100.01

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].withinTolerance).toBe(true)
      expect(matches[0].toleranceUsed).toBe(1)
    })

    it('should not match outside tolerance', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 }) // $100.00
      const ledgerEntry = createLedgerEntry({ amount: 10010 }) // $100.10

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
        options: { toleranceAmount: 1 }, // $0.01 tolerance
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(0)
    })

    it('should support configurable tolerance amount', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 }) // $100.00
      const ledgerEntry = createLedgerEntry({ amount: 10050 }) // $100.50

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
        options: { toleranceAmount: 100 }, // $1.00 tolerance
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].withinTolerance).toBe(true)
    })

    it('should support percentage-based tolerance', async () => {
      const bankTxn = createBankTransaction({ amount: 100000 }) // $1,000.00
      const ledgerEntry = createLedgerEntry({ amount: 100100 }) // $1,001.00

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
        options: { tolerancePercent: 0.1 }, // 0.1% tolerance
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].toleranceType).toBe('percentage')
    })

    it('should track accumulated tolerance amounts', async () => {
      const transactions = [
        createBankTransaction({ amount: 10000 }),
        createBankTransaction({ amount: 20000 }),
        createBankTransaction({ amount: 30000 }),
      ]
      const entries = [
        createLedgerEntry({ amount: 10001 }), // +$0.01
        createLedgerEntry({ amount: 20001 }), // +$0.01
        createLedgerEntry({ amount: 30001 }), // +$0.01
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions },
        ledgerEntries: entries,
        options: { toleranceAmount: 1 },
      })

      await engine.findMatches(session.id)
      const summary = await engine.getReconciliationSummary(session.id)

      expect(summary.totalToleranceUsed).toBe(3) // $0.03 total
    })

    it('should flag when total tolerance exceeds threshold', async () => {
      const transactions = Array.from({ length: 100 }, () =>
        createBankTransaction({ amount: 10000 })
      )
      const entries = Array.from({ length: 100 }, () => createLedgerEntry({ amount: 10001 }))

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions },
        ledgerEntries: entries,
        options: {
          toleranceAmount: 1,
          maxTotalTolerance: 50, // Max $0.50 total tolerance
        },
      })

      await engine.findMatches(session.id)
      const discrepancies = await engine.detectDiscrepancies(session.id)

      expect(discrepancies.toleranceExceeded).toBe(true)
      expect(discrepancies.toleranceExceededAmount).toBe(100) // $1.00 used, limit was $0.50
    })

    it('should create adjustment entries for tolerance differences', async () => {
      const bankTxn = createBankTransaction({ amount: 10000 })
      const ledgerEntry = createLedgerEntry({ amount: 10001 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [ledgerEntry],
      })

      const matches = await engine.findMatches(session.id)
      await engine.approveMatch(session.id, matches[0].id)

      const adjustments = await engine.generateToleranceAdjustments(session.id)

      expect(adjustments).toHaveLength(1)
      expect(adjustments[0].amount).toBe(-1) // $0.01 adjustment
      expect(adjustments[0].accountId).toBe('acc-rounding-diff')
    })
  })

  // =============================================================================
  // Duplicate Detection Tests
  // =============================================================================

  describe('duplicate detection', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should detect duplicate bank transactions', async () => {
      const txn1 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'REF-001',
      })
      const txn2 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'REF-001', // Same reference
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [txn1, txn2] },
        ledgerEntries: [],
      })

      const duplicates = await engine.detectDuplicates(session.id)

      expect(duplicates.bankDuplicates).toHaveLength(1)
      expect(duplicates.bankDuplicates[0].transactions).toHaveLength(2)
    })

    it('should detect duplicate ledger entries', async () => {
      const entry1 = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'PAY-001',
      })
      const entry2 = createLedgerEntry({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'PAY-001', // Same reference
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [entry1, entry2],
      })

      const duplicates = await engine.detectDuplicates(session.id)

      expect(duplicates.ledgerDuplicates).toHaveLength(1)
      expect(duplicates.ledgerDuplicates[0].entries).toHaveLength(2)
    })

    it('should detect potential duplicates by amount and date', async () => {
      const txn1 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'REF-001',
      })
      const txn2 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        reference: 'REF-002', // Different reference but same amount/date
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [txn1, txn2] },
        ledgerEntries: [],
      })

      const duplicates = await engine.detectDuplicates(session.id)

      expect(duplicates.potentialDuplicates).toHaveLength(1)
      expect(duplicates.potentialDuplicates[0].confidence).toBeLessThan(1.0)
    })

    it('should allow marking duplicates as intentional', async () => {
      const txn1 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        description: 'Monthly fee',
      })
      const txn2 = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-15'),
        description: 'Monthly fee', // Legitimate recurring charge
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [txn1, txn2] },
        ledgerEntries: [],
      })

      const duplicates = await engine.detectDuplicates(session.id)
      await engine.markDuplicatesAsIntentional(session.id, duplicates.potentialDuplicates[0].id, {
        reason: 'Legitimate separate transactions',
      })

      const updatedDuplicates = await engine.detectDuplicates(session.id)
      expect(updatedDuplicates.potentialDuplicates).toHaveLength(0)
    })

    it('should detect cross-period duplicates', async () => {
      // Previous month transaction
      const prevSession = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          startDate: new Date('2023-12-01'),
          endDate: new Date('2023-12-31'),
          transactions: [
            createBankTransaction({
              amount: 10000,
              date: new Date('2023-12-31'),
              reference: 'REF-001',
            }),
          ],
        },
        ledgerEntries: [],
      })

      // Same transaction appearing again
      const currentSession = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [
            createBankTransaction({
              amount: 10000,
              date: new Date('2024-01-01'),
              reference: 'REF-001', // Same reference
            }),
          ],
        },
        ledgerEntries: [],
      })

      const crossPeriodDuplicates = await engine.detectCrossPeriodDuplicates(currentSession.id, {
        lookbackSessions: [prevSession.id],
      })

      expect(crossPeriodDuplicates).toHaveLength(1)
    })

    it('should suggest duplicate resolution actions', async () => {
      const txn1 = createBankTransaction({ amount: 10000, reference: 'REF-001' })
      const txn2 = createBankTransaction({ amount: 10000, reference: 'REF-001' })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [txn1, txn2] },
        ledgerEntries: [],
      })

      const duplicates = await engine.detectDuplicates(session.id)
      const suggestions = await engine.suggestDuplicateResolution(
        session.id,
        duplicates.bankDuplicates[0].id
      )

      expect(suggestions).toContain('merge')
      expect(suggestions).toContain('mark_intentional')
      expect(suggestions).toContain('exclude_one')
    })
  })

  // =============================================================================
  // Unreconciled Item Tracking Tests
  // =============================================================================

  describe('unreconciled item tracking', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should list all unreconciled bank transactions', async () => {
      const matched = createBankTransaction({ amount: 10000 })
      const unmatched = createBankTransaction({ amount: 20000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [matched, unmatched] },
        ledgerEntries: [createLedgerEntry({ amount: 10000 })],
      })

      const matches = await engine.findMatches(session.id)
      await engine.approveMatch(session.id, matches[0].id)

      const unreconciled = await engine.getUnreconciledItems(session.id)

      expect(unreconciled.bankTransactions).toHaveLength(1)
      expect(unreconciled.bankTransactions[0].id).toBe(unmatched.id)
    })

    it('should list all unreconciled ledger entries', async () => {
      const matched = createLedgerEntry({ amount: 10000 })
      const unmatched = createLedgerEntry({ amount: 30000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [createBankTransaction({ amount: 10000 })],
        },
        ledgerEntries: [matched, unmatched],
      })

      const matches = await engine.findMatches(session.id)
      await engine.approveMatch(session.id, matches[0].id)

      const unreconciled = await engine.getUnreconciledItems(session.id)

      expect(unreconciled.ledgerEntries).toHaveLength(1)
      expect(unreconciled.ledgerEntries[0].id).toBe(unmatched.id)
    })

    it('should calculate unreconciled totals', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [
            createBankTransaction({ amount: 10000, type: 'credit' }),
            createBankTransaction({ amount: 5000, type: 'debit' }),
          ],
        },
        ledgerEntries: [createLedgerEntry({ amount: 20000 })],
      })

      const unreconciled = await engine.getUnreconciledItems(session.id)

      expect(unreconciled.totalUnreconciledBank).toBe(5000) // 10000 - 5000
      expect(unreconciled.totalUnreconciledLedger).toBe(20000)
    })

    it('should age unreconciled items', async () => {
      const oldTxn = createBankTransaction({
        amount: 10000,
        date: new Date('2024-01-01'),
      })
      const recentTxn = createBankTransaction({
        amount: 20000,
        date: new Date('2024-01-25'),
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [oldTxn, recentTxn],
          endDate: new Date('2024-01-31'),
        },
        ledgerEntries: [],
      })

      const aging = await engine.getUnreconciledAging(session.id)

      expect(aging['0-7 days']).toBe(1)
      expect(aging['30+ days']).toBe(1)
    })

    it('should track unreconciled items across periods', async () => {
      // First period - item not reconciled
      const session1 = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          id: 'stmt-jan',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          transactions: [createBankTransaction({ id: 'txn-001', amount: 10000 })],
        },
        ledgerEntries: [],
      })
      await engine.finalizeSession(session1.id, { allowUnreconciled: true })

      // Second period - same item still not reconciled
      const session2 = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          id: 'stmt-feb',
          startDate: new Date('2024-02-01'),
          endDate: new Date('2024-02-29'),
          transactions: [],
        },
        ledgerEntries: [],
        options: { carryForwardFrom: session1.id },
      })

      const unreconciled = await engine.getUnreconciledItems(session2.id)

      expect(unreconciled.carriedForward).toHaveLength(1)
      expect(unreconciled.carriedForward[0].originalPeriod).toBe('2024-01')
    })

    it('should generate unreconciled items report', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [
            createBankTransaction({ amount: 10000, description: 'Unknown deposit' }),
          ],
        },
        ledgerEntries: [createLedgerEntry({ amount: 5000, description: 'Missing bank entry' })],
      })

      const report = await engine.generateUnreconciledReport(session.id)

      expect(report.bankItems).toHaveLength(1)
      expect(report.ledgerItems).toHaveLength(1)
      expect(report.totalBankAmount).toBe(10000)
      expect(report.totalLedgerAmount).toBe(5000)
      expect(report.generatedAt).toBeInstanceOf(Date)
    })

    it('should support bulk actions on unreconciled items', async () => {
      const txns = [
        createBankTransaction({ amount: 100, description: 'Fee' }),
        createBankTransaction({ amount: 100, description: 'Fee' }),
        createBankTransaction({ amount: 100, description: 'Fee' }),
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: txns },
        ledgerEntries: [],
      })

      await engine.bulkCreateExceptions(
        session.id,
        txns.map((t) => t.id),
        {
          type: 'bank_fee',
          note: 'Monthly service fees',
        }
      )

      const exceptions = await engine.getExceptions(session.id)
      expect(exceptions).toHaveLength(3)
    })

    it('should notify when items remain unreconciled past threshold', async () => {
      const oldTxn = createBankTransaction({
        date: new Date('2023-11-01'), // Very old
        amount: 50000,
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [oldTxn],
        },
        ledgerEntries: [],
        options: { staleItemThresholdDays: 30 },
      })

      const alerts = await engine.getReconciliationAlerts(session.id)

      expect(alerts.some((a) => a.type === 'stale_unreconciled_item')).toBe(true)
    })

    it('should export unreconciled items for review', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [createBankTransaction({ amount: 10000 })],
        },
        ledgerEntries: [createLedgerEntry({ amount: 20000 })],
      })

      const csv = await engine.exportUnreconciledItems(session.id, { format: 'csv' })

      expect(csv).toContain('Bank Transaction')
      expect(csv).toContain('Ledger Entry')
      expect(csv).toContain('10000')
      expect(csv).toContain('20000')
    })
  })

  // =============================================================================
  // Auto-Matching Rules Tests
  // =============================================================================

  describe('auto-matching rules', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should create an auto-matching rule by description pattern', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Bank Fees Rule',
        type: 'description',
        pattern: /^(Monthly Service|Bank Fee|ATM Fee)/i,
        targetAccount: 'acc-bank-fees',
        autoApprove: true,
      })

      expect(rule.id).toBeDefined()
      expect(rule.type).toBe('description')
      expect(rule.enabled).toBe(true)
    })

    it('should create an auto-matching rule by amount range', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Small Expense Auto-Match',
        type: 'amount_range',
        minAmount: 0,
        maxAmount: 1000, // Up to $10.00
        targetAccount: 'acc-petty-cash',
        autoApprove: false,
      })

      expect(rule.id).toBeDefined()
      expect(rule.type).toBe('amount_range')
    })

    it('should create an auto-matching rule by reference pattern', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Invoice Payment Rule',
        type: 'reference',
        pattern: /^INV-\d{4}-\d{3,}$/,
        autoApprove: true,
      })

      expect(rule.type).toBe('reference')
    })

    it('should apply auto-matching rules during reconciliation', async () => {
      // Create a rule for bank fees
      await engine.createMatchingRule({
        name: 'Monthly Fee Rule',
        type: 'description',
        pattern: /Monthly Service Fee/i,
        targetAccount: 'acc-bank-fees',
        autoApprove: true,
        createLedgerEntry: true,
      })

      const bankTxn = createBankTransaction({
        amount: -1500,
        description: 'Monthly Service Fee',
        type: 'debit',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].status).toBe('approved') // Auto-approved
      expect(matches[0].matchedByRule).toBe(true)
    })

    it('should suggest matches for rules without autoApprove', async () => {
      await engine.createMatchingRule({
        name: 'Large Payment Rule',
        type: 'amount_range',
        minAmount: 100000, // $1,000+
        maxAmount: Infinity,
        autoApprove: false, // Needs manual review
      })

      const bankTxn = createBankTransaction({
        amount: 500000, // $5,000
        description: 'Large wire transfer',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches).toHaveLength(1)
      expect(matches[0].status).toBe('suggested')
      expect(matches[0].matchedByRule).toBe(true)
    })

    it('should match by vendor/payee rule', async () => {
      await engine.createMatchingRule({
        name: 'AWS Charges',
        type: 'vendor',
        vendorPatterns: ['Amazon Web Services', 'AWS', 'AMZN'],
        targetAccount: 'acc-cloud-hosting',
        autoApprove: true,
      })

      const bankTxn = createBankTransaction({
        amount: -25000,
        description: 'AMZN Web Services EC2 Usage',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches[0].matchedByRule).toBe(true)
      expect(matches[0].suggestedAccount).toBe('acc-cloud-hosting')
    })

    it('should support compound rules with multiple conditions', async () => {
      await engine.createMatchingRule({
        name: 'Payroll Rule',
        type: 'compound',
        conditions: [
          { type: 'description', pattern: /^(ADP|Gusto|Payroll)/i },
          { type: 'amount_range', minAmount: 10000 }, // At least $100
          { type: 'day_of_month', days: [1, 15, 30, 31] }, // Common payroll dates
        ],
        operator: 'AND',
        targetAccount: 'acc-payroll',
        autoApprove: true,
      })

      const bankTxn = createBankTransaction({
        amount: -500000,
        description: 'ADP Payroll',
        date: new Date('2024-01-15'), // 15th of month
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches[0].matchedByRule).toBe(true)
    })

    it('should support OR compound rules', async () => {
      await engine.createMatchingRule({
        name: 'Subscription Rule',
        type: 'compound',
        conditions: [
          { type: 'description', pattern: /Netflix/i },
          { type: 'description', pattern: /Spotify/i },
          { type: 'description', pattern: /Disney\+/i },
        ],
        operator: 'OR',
        targetAccount: 'acc-subscriptions',
        autoApprove: true,
      })

      const bankTxn = createBankTransaction({
        amount: -1599,
        description: 'NETFLIX.COM',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches[0].suggestedAccount).toBe('acc-subscriptions')
    })

    it('should prioritize rules by order', async () => {
      // More specific rule (higher priority)
      await engine.createMatchingRule({
        name: 'Specific AWS Rule',
        type: 'description',
        pattern: /AWS.*EC2/i,
        targetAccount: 'acc-compute',
        priority: 100,
        autoApprove: true,
      })

      // General rule (lower priority)
      await engine.createMatchingRule({
        name: 'General AWS Rule',
        type: 'description',
        pattern: /AWS/i,
        targetAccount: 'acc-cloud-general',
        priority: 50,
        autoApprove: true,
      })

      const bankTxn = createBankTransaction({
        amount: -5000,
        description: 'AWS EC2 Instance',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      // Higher priority rule should match
      expect(matches[0].suggestedAccount).toBe('acc-compute')
    })

    it('should list all matching rules', async () => {
      await engine.createMatchingRule({ name: 'Rule 1', type: 'description', pattern: /test/ })
      await engine.createMatchingRule({ name: 'Rule 2', type: 'amount_range', minAmount: 100 })

      const rules = await engine.listMatchingRules()

      expect(rules).toHaveLength(2)
    })

    it('should update a matching rule', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Old Name',
        type: 'description',
        pattern: /test/,
      })

      const updated = await engine.updateMatchingRule(rule.id, {
        name: 'New Name',
        autoApprove: true,
      })

      expect(updated.name).toBe('New Name')
      expect(updated.autoApprove).toBe(true)
    })

    it('should delete a matching rule', async () => {
      const rule = await engine.createMatchingRule({
        name: 'To Delete',
        type: 'description',
        pattern: /test/,
      })

      await engine.deleteMatchingRule(rule.id)

      const rules = await engine.listMatchingRules()
      expect(rules.find((r) => r.id === rule.id)).toBeUndefined()
    })

    it('should enable/disable a matching rule', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Toggle Rule',
        type: 'description',
        pattern: /test/,
        enabled: true,
      })

      await engine.disableMatchingRule(rule.id)
      let rules = await engine.listMatchingRules()
      expect(rules.find((r) => r.id === rule.id)?.enabled).toBe(false)

      await engine.enableMatchingRule(rule.id)
      rules = await engine.listMatchingRules()
      expect(rules.find((r) => r.id === rule.id)?.enabled).toBe(true)
    })

    it('should skip disabled rules during matching', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Disabled Rule',
        type: 'description',
        pattern: /Bank Fee/i,
        targetAccount: 'acc-bank-fees',
        enabled: false,
      })

      const bankTxn = createBankTransaction({
        amount: -1000,
        description: 'Bank Fee',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches.every((m) => !m.matchedByRule)).toBe(true)
    })

    it('should track rule match statistics', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Fee Rule',
        type: 'description',
        pattern: /fee/i,
        autoApprove: true,
      })

      const bankTxns = [
        createBankTransaction({ amount: -500, description: 'Service Fee' }),
        createBankTransaction({ amount: -250, description: 'Processing Fee' }),
        createBankTransaction({ amount: -100, description: 'ATM Fee' }),
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: bankTxns },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      await engine.findMatches(session.id)

      const stats = await engine.getMatchingRuleStats(rule.id)

      expect(stats.totalMatches).toBe(3)
      expect(stats.lastMatchedAt).toBeInstanceOf(Date)
      expect(stats.totalAmount).toBe(850)
    })

    it('should support recurring transaction rules', async () => {
      await engine.createMatchingRule({
        name: 'Monthly Rent',
        type: 'recurring',
        pattern: /Property Management|Rent Payment/i,
        expectedAmount: 200000, // $2,000
        expectedDayOfMonth: 1,
        toleranceAmount: 0, // Exact match
        toleranceDays: 3, // Within 3 days of the 1st
        targetAccount: 'acc-rent-expense',
        autoApprove: true,
      })

      const bankTxn = createBankTransaction({
        amount: -200000,
        description: 'ABC Property Management',
        date: new Date('2024-01-02'), // 2nd of month (within tolerance)
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches[0].matchedByRule).toBe(true)
      expect(matches[0].ruleType).toBe('recurring')
    })

    it('should flag when recurring transaction is missing', async () => {
      await engine.createMatchingRule({
        name: 'Monthly Rent',
        type: 'recurring',
        pattern: /Rent/i,
        expectedAmount: 200000,
        expectedDayOfMonth: 1,
        targetAccount: 'acc-rent',
        alertOnMissing: true,
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [], // No rent payment
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
        },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const alerts = await engine.getReconciliationAlerts(session.id)

      expect(alerts.some((a) => a.type === 'missing_recurring_transaction')).toBe(true)
    })

    it('should support categorization rules for expense tracking', async () => {
      await engine.createMatchingRule({
        name: 'Office Supplies',
        type: 'category',
        patterns: ['Staples', 'Office Depot', 'Amazon.*office', 'Uline'],
        category: 'office_supplies',
        targetAccount: 'acc-office-supplies',
        taxDeductible: true,
      })

      const bankTxn = createBankTransaction({
        amount: -15000,
        description: 'STAPLES STORE #123',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const matches = await engine.findMatches(session.id)

      expect(matches[0].suggestedCategory).toBe('office_supplies')
      expect(matches[0].taxDeductible).toBe(true)
    })

    it('should import rules from another account', async () => {
      // Create rules in source account
      await engine.createMatchingRule({
        name: 'Source Rule',
        type: 'description',
        pattern: /test/,
        accountScope: 'acc-source',
      })

      await engine.importMatchingRules('acc-target', { fromAccount: 'acc-source' })

      const targetRules = await engine.listMatchingRules({ accountId: 'acc-target' })

      expect(targetRules).toHaveLength(1)
    })

    it('should export rules to JSON', async () => {
      await engine.createMatchingRule({
        name: 'Export Test',
        type: 'description',
        pattern: /test/,
      })

      const exported = await engine.exportMatchingRules({ format: 'json' })
      const parsed = JSON.parse(exported)

      expect(parsed.rules).toHaveLength(1)
      expect(parsed.rules[0].name).toBe('Export Test')
    })

    it('should support ML-suggested rules based on history', async () => {
      // Simulate historical approved matches
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const suggestions = await engine.suggestMatchingRules(session.id, {
        minConfidence: 0.8,
        minOccurrences: 3,
      })

      expect(Array.isArray(suggestions)).toBe(true)
      // Each suggestion should have a proposed rule
      suggestions.forEach((s) => {
        expect(s.proposedRule).toBeDefined()
        expect(s.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    it('should test a rule against historical data before enabling', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Test Rule',
        type: 'description',
        pattern: /fee/i,
        enabled: false, // Start disabled
      })

      const testResult = await engine.testMatchingRule(rule.id, {
        lookbackDays: 90,
      })

      expect(testResult.wouldMatch).toBeDefined()
      expect(testResult.sampleMatches).toBeDefined()
      expect(typeof testResult.estimatedMatches).toBe('number')
    })

    it('should handle rule conflicts gracefully', async () => {
      await engine.createMatchingRule({
        name: 'Rule A',
        type: 'description',
        pattern: /Amazon/i,
        targetAccount: 'acc-a',
        priority: 50,
      })

      await engine.createMatchingRule({
        name: 'Rule B',
        type: 'description',
        pattern: /Amazon.*AWS/i,
        targetAccount: 'acc-b',
        priority: 50, // Same priority
      })

      const conflicts = await engine.detectRuleConflicts()

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].rules).toHaveLength(2)
    })

    it('should support rule versioning', async () => {
      const rule = await engine.createMatchingRule({
        name: 'Versioned Rule',
        type: 'description',
        pattern: /original/,
      })

      await engine.updateMatchingRule(rule.id, { pattern: /updated/ })
      await engine.updateMatchingRule(rule.id, { pattern: /final/ })

      const history = await engine.getMatchingRuleHistory(rule.id)

      expect(history).toHaveLength(3) // Original + 2 updates
      expect(history[0].pattern.toString()).toContain('original')
      expect(history[2].pattern.toString()).toContain('final')
    })
  })

  // =============================================================================
  // Advanced Exception Handling Tests
  // =============================================================================

  describe('advanced exception handling', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should automatically create exceptions for threshold violations', async () => {
      const bankTxn = createBankTransaction({
        amount: 10000000, // $100,000 - very large
        description: 'Large wire transfer',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
        options: {
          autoExceptionThreshold: 5000000, // Auto-exception for >$50k
        },
      })

      const exceptions = await engine.getExceptions(session.id)

      expect(exceptions).toHaveLength(1)
      expect(exceptions[0].type).toBe('threshold_violation')
      expect(exceptions[0].autoCreated).toBe(true)
    })

    it('should support exception workflows with approval chains', async () => {
      const bankTxn = createBankTransaction({ amount: 50000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: bankTxn.id,
        type: 'missing_ledger_entry',
        requiresApproval: true,
        approvalChain: ['accountant', 'controller', 'cfo'],
      })

      expect(exception.approvalStatus).toBe('pending')
      expect(exception.currentApprover).toBe('accountant')

      // Simulate approval flow
      await engine.approveException(session.id, exception.id, {
        approver: 'accountant',
        comment: 'Verified with bank',
      })

      const updated = await engine.getException(session.id, exception.id)
      expect(updated.currentApprover).toBe('controller')
    })

    it('should escalate aged exceptions', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: 'test-txn',
        type: 'other',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days old
      })

      await engine.processExceptionEscalations(session.id, {
        escalationThresholdDays: 5,
      })

      const updated = await engine.getException(session.id, exception.id)
      expect(updated.escalated).toBe(true)
      expect(updated.escalationLevel).toBe(1)
    })

    it('should categorize exceptions by type', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      await engine.createException(session.id, { type: 'missing_ledger_entry' })
      await engine.createException(session.id, { type: 'missing_ledger_entry' })
      await engine.createException(session.id, { type: 'amount_mismatch' })
      await engine.createException(session.id, { type: 'bank_fee' })

      const summary = await engine.getExceptionSummary(session.id)

      expect(summary.byType['missing_ledger_entry']).toBe(2)
      expect(summary.byType['amount_mismatch']).toBe(1)
      expect(summary.byType['bank_fee']).toBe(1)
      expect(summary.total).toBe(4)
    })

    it('should support exception templates', async () => {
      const template = await engine.createExceptionTemplate({
        name: 'Bank Fee Template',
        type: 'bank_fee',
        defaultNote: 'Standard bank service charge',
        defaultResolution: 'create_adjustment',
        targetAccount: 'acc-bank-fees',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exception = await engine.createExceptionFromTemplate(session.id, template.id, {
        bankTransactionId: 'test-txn',
      })

      expect(exception.type).toBe('bank_fee')
      expect(exception.note).toBe('Standard bank service charge')
    })

    it('should batch resolve similar exceptions', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exceptions = await Promise.all([
        engine.createException(session.id, { type: 'bank_fee' }),
        engine.createException(session.id, { type: 'bank_fee' }),
        engine.createException(session.id, { type: 'bank_fee' }),
      ])

      const resolved = await engine.batchResolveExceptions(
        session.id,
        exceptions.map((e) => e.id),
        {
          resolution: 'create_adjustment',
          targetAccount: 'acc-bank-fees',
          note: 'Monthly service charges',
        }
      )

      expect(resolved.every((r) => r.status === 'resolved')).toBe(true)
    })

    it('should link exceptions to journal entries', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: 'test-txn',
        type: 'missing_ledger_entry',
      })

      const resolved = await engine.resolveException(session.id, exception.id, {
        resolution: 'created_entry',
        journalEntryId: 'je-new-001',
        note: 'Created adjustment entry',
      })

      expect(resolved.linkedJournalEntries).toContain('je-new-001')
    })

    it('should generate exception report', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      await engine.createException(session.id, { type: 'missing_ledger_entry' })
      await engine.createException(session.id, { type: 'amount_mismatch' })

      const report = await engine.generateExceptionReport(session.id, {
        includeResolved: false,
        format: 'detailed',
      })

      expect(report.openExceptions).toBe(2)
      expect(report.exceptions).toHaveLength(2)
      expect(report.generatedAt).toBeInstanceOf(Date)
    })

    it('should support exception comments and audit trail', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        type: 'other',
      })

      await engine.addExceptionComment(session.id, exception.id, {
        text: 'Investigating with bank',
        author: 'accountant@company.com',
      })

      await engine.addExceptionComment(session.id, exception.id, {
        text: 'Bank confirmed this is a duplicate charge',
        author: 'bank-support',
      })

      const updated = await engine.getException(session.id, exception.id)

      expect(updated.comments).toHaveLength(2)
      expect(updated.auditTrail).toHaveLength(3) // Created + 2 comments
    })

    it('should auto-resolve exceptions matching patterns', async () => {
      await engine.createExceptionAutoResolveRule({
        name: 'Auto-resolve small fees',
        conditions: {
          type: 'bank_fee',
          maxAmount: 500, // Up to $5.00
        },
        resolution: 'create_adjustment',
        targetAccount: 'acc-bank-fees',
      })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          transactions: [
            createBankTransaction({ amount: -250, description: 'ATM Fee' }),
          ],
        },
        ledgerEntries: [],
        options: { applyAutoRules: true },
      })

      const exception = await engine.createException(session.id, {
        bankTransactionId: 'atm-fee-txn',
        type: 'bank_fee',
        amount: 250,
      })

      // Should auto-resolve
      expect(exception.status).toBe('resolved')
      expect(exception.autoResolved).toBe(true)
    })

    it('should track exception resolution time', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: sampleBankStatement,
        ledgerEntries: [],
      })

      const exception = await engine.createException(session.id, {
        type: 'missing_ledger_entry',
      })

      // Simulate some time passing (in real scenario)
      await engine.resolveException(session.id, exception.id, {
        resolution: 'created_entry',
      })

      const metrics = await engine.getExceptionMetrics(session.id)

      expect(metrics.averageResolutionTimeMs).toBeDefined()
      expect(metrics.resolvedCount).toBe(1)
    })

    it('should prevent duplicate exceptions for same transaction', async () => {
      const bankTxn = createBankTransaction({ id: 'unique-txn', amount: 1000 })

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: { ...sampleBankStatement, transactions: [bankTxn] },
        ledgerEntries: [],
      })

      await engine.createException(session.id, {
        bankTransactionId: 'unique-txn',
        type: 'missing_ledger_entry',
      })

      // Attempting to create duplicate should fail or return existing
      await expect(
        engine.createException(session.id, {
          bankTransactionId: 'unique-txn',
          type: 'missing_ledger_entry',
        })
      ).rejects.toThrow('Exception already exists for this transaction')
    })
  })

  // =============================================================================
  // Reconciliation Summary Tests
  // =============================================================================

  describe('reconciliation summary', () => {
    let engine: ReconciliationEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should produce accurate reconciliation summary', async () => {
      const bankTxns = [
        createBankTransaction({ amount: 50000, type: 'credit' }),
        createBankTransaction({ amount: 20000, type: 'debit' }),
      ]
      const ledgerEntries = [
        createLedgerEntry({ amount: 50000 }),
        createLedgerEntry({ amount: -20000 }),
      ]

      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          openingBalance: 100000,
          closingBalance: 130000,
          transactions: bankTxns,
        },
        ledgerEntries,
      })

      // Approve all matches
      const matches = await engine.findMatches(session.id)
      for (const match of matches) {
        await engine.approveMatch(session.id, match.id)
      }

      const summary = await engine.getReconciliationSummary(session.id)

      expect(summary.bankOpeningBalance).toBe(100000)
      expect(summary.bankClosingBalance).toBe(130000)
      expect(summary.matchedItemsCount).toBe(2)
      expect(summary.unmatchedItemsCount).toBe(0)
      expect(summary.isFullyReconciled).toBe(true)
    })

    it('should calculate book balance vs bank balance', async () => {
      const session = await engine.createSession({
        accountId: 'acc-checking',
        statement: {
          ...sampleBankStatement,
          closingBalance: 100000,
          transactions: [],
        },
        ledgerEntries: [createLedgerEntry({ amount: 5000 })], // Outstanding deposit
      })

      const summary = await engine.getReconciliationSummary(session.id)

      expect(summary.bankBalance).toBe(100000)
      expect(summary.adjustedBookBalance).toBe(105000)
      expect(summary.difference).toBe(-5000)
    })
  })
})
