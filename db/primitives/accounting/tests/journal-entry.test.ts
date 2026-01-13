/**
 * Journal Entry Tests - TDD RED Phase
 *
 * Tests for journal entries in double-entry accounting:
 * - Journal entry creation with debit/credit lines
 * - Entry date vs posting date
 * - Entry status lifecycle (draft, posted, void)
 * - Entry reversal
 * - Auto-numbering
 * - Memo/description support
 *
 * All tests should FAIL because implementation doesn't exist yet.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createJournalEntryManager,
  type JournalEntryManager,
  type JournalEntry,
  type JournalEntryLine,
  type JournalEntryStatus,
  type CreateJournalEntryInput,
} from '../journal-entry'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestManager(): JournalEntryManager {
  return createJournalEntryManager()
}

const sampleLines: Omit<JournalEntryLine, 'id'>[] = [
  {
    accountId: 'acc-cash',
    accountName: 'Cash',
    debit: 10000, // $100.00
    credit: 0,
    description: 'Cash received',
  },
  {
    accountId: 'acc-revenue',
    accountName: 'Sales Revenue',
    debit: 0,
    credit: 10000,
    description: 'Service revenue',
  },
]

// =============================================================================
// Journal Entry Creation Tests
// =============================================================================

describe('JournalEntryManager', () => {
  describe('journal entry creation', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should create a journal entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Payment received for services',
      })

      expect(entry.id).toBeDefined()
      expect(entry.entryNumber).toBeDefined()
      expect(entry.status).toBe('draft')
      expect(entry.entryDate).toEqual(new Date('2024-01-15'))
      expect(entry.lines).toHaveLength(2)
      expect(entry.createdAt).toBeInstanceOf(Date)
    })

    it('should create entry with multiple debit/credit lines', async () => {
      const multiLines: Omit<JournalEntryLine, 'id'>[] = [
        { accountId: 'acc-cash', accountName: 'Cash', debit: 5000, credit: 0 },
        { accountId: 'acc-ar', accountName: 'Accounts Receivable', debit: 5000, credit: 0 },
        { accountId: 'acc-revenue', accountName: 'Sales Revenue', debit: 0, credit: 10000 },
      ]

      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: multiLines,
      })

      expect(entry.lines).toHaveLength(3)
      expect(entry.totalDebit).toBe(10000)
      expect(entry.totalCredit).toBe(10000)
    })

    it('should require balanced debits and credits', async () => {
      const unbalancedLines: Omit<JournalEntryLine, 'id'>[] = [
        { accountId: 'acc-cash', accountName: 'Cash', debit: 10000, credit: 0 },
        { accountId: 'acc-revenue', accountName: 'Sales Revenue', debit: 0, credit: 5000 },
      ]

      await expect(
        manager.createEntry({
          entryDate: new Date('2024-01-15'),
          lines: unbalancedLines,
        })
      ).rejects.toThrow('Debits and credits must balance')
    })

    it('should require at least two lines', async () => {
      const singleLine: Omit<JournalEntryLine, 'id'>[] = [
        { accountId: 'acc-cash', accountName: 'Cash', debit: 10000, credit: 0 },
      ]

      await expect(
        manager.createEntry({
          entryDate: new Date('2024-01-15'),
          lines: singleLine,
        })
      ).rejects.toThrow('Journal entry must have at least two lines')
    })

    it('should reject line with both debit and credit', async () => {
      const invalidLines: Omit<JournalEntryLine, 'id'>[] = [
        { accountId: 'acc-cash', accountName: 'Cash', debit: 10000, credit: 5000 },
        { accountId: 'acc-revenue', accountName: 'Sales Revenue', debit: 5000, credit: 10000 },
      ]

      await expect(
        manager.createEntry({
          entryDate: new Date('2024-01-15'),
          lines: invalidLines,
        })
      ).rejects.toThrow('Line cannot have both debit and credit')
    })

    it('should reject line with zero amounts', async () => {
      const zeroLines: Omit<JournalEntryLine, 'id'>[] = [
        { accountId: 'acc-cash', accountName: 'Cash', debit: 0, credit: 0 },
        { accountId: 'acc-revenue', accountName: 'Sales Revenue', debit: 0, credit: 0 },
      ]

      await expect(
        manager.createEntry({
          entryDate: new Date('2024-01-15'),
          lines: zeroLines,
        })
      ).rejects.toThrow('Line must have either debit or credit amount')
    })

    it('should get entry by id', async () => {
      const created = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const retrieved = await manager.getEntry(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should get entry by entry number', async () => {
      const created = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const retrieved = await manager.getEntryByNumber(created.entryNumber)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.entryNumber).toBe(created.entryNumber)
    })

    it('should list entries by date range', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-10'),
        lines: sampleLines,
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-20'),
        lines: sampleLines,
      })

      const entries = await manager.listEntries({
        startDate: new Date('2024-01-12'),
        endDate: new Date('2024-01-18'),
      })

      expect(entries).toHaveLength(1)
    })

    it('should list entries by account', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: [
          { accountId: 'acc-expense', accountName: 'Expense', debit: 5000, credit: 0 },
          { accountId: 'acc-cash', accountName: 'Cash', debit: 0, credit: 5000 },
        ],
      })

      const entries = await manager.listEntriesByAccount('acc-cash')

      expect(entries).toHaveLength(2)
    })
  })

  // =============================================================================
  // Entry Date and Posting Date Tests
  // =============================================================================

  describe('entry date and posting date', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should have separate entry date and posting date', async () => {
      const entryDate = new Date('2024-01-15')
      const entry = await manager.createEntry({
        entryDate,
        lines: sampleLines,
      })

      expect(entry.entryDate).toEqual(entryDate)
      expect(entry.postingDate).toBeNull() // Not posted yet
    })

    it('should set posting date when entry is posted', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const posted = await manager.postEntry(entry.id)

      expect(posted.postingDate).toBeInstanceOf(Date)
      expect(posted.status).toBe('posted')
    })

    it('should allow backdated entry dates', async () => {
      const pastDate = new Date('2023-12-01')
      const entry = await manager.createEntry({
        entryDate: pastDate,
        lines: sampleLines,
      })

      expect(entry.entryDate).toEqual(pastDate)
    })

    it('should reject future entry dates', async () => {
      const futureDate = new Date()
      futureDate.setFullYear(futureDate.getFullYear() + 1)

      await expect(
        manager.createEntry({
          entryDate: futureDate,
          lines: sampleLines,
        })
      ).rejects.toThrow('Entry date cannot be in the future')
    })

    it('should use entry date as posting date by default when posting', async () => {
      const entryDate = new Date('2024-01-15')
      const entry = await manager.createEntry({
        entryDate,
        lines: sampleLines,
      })

      const posted = await manager.postEntry(entry.id, { useEntryDateAsPostingDate: true })

      expect(posted.postingDate).toEqual(entryDate)
    })

    it('should allow custom posting date when posting', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const customPostingDate = new Date('2024-01-20')
      const posted = await manager.postEntry(entry.id, { postingDate: customPostingDate })

      expect(posted.postingDate).toEqual(customPostingDate)
    })

    it('should not allow posting date before entry date', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-20'),
        lines: sampleLines,
      })

      await expect(
        manager.postEntry(entry.id, { postingDate: new Date('2024-01-15') })
      ).rejects.toThrow('Posting date cannot be before entry date')
    })

    it('should record period (month/year) based on posting date', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const posted = await manager.postEntry(entry.id, {
        postingDate: new Date('2024-02-01'),
      })

      expect(posted.fiscalYear).toBe(2024)
      expect(posted.fiscalPeriod).toBe(2) // February
    })
  })

  // =============================================================================
  // Entry Status Tests
  // =============================================================================

  describe('entry status lifecycle', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should create entry with draft status', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      expect(entry.status).toBe('draft')
    })

    it('should transition draft to posted', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const posted = await manager.postEntry(entry.id)

      expect(posted.status).toBe('posted')
      expect(posted.postedAt).toBeInstanceOf(Date)
    })

    it('should transition posted to void', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      const voided = await manager.voidEntry(entry.id, { reason: 'Error correction' })

      expect(voided.status).toBe('void')
      expect(voided.voidedAt).toBeInstanceOf(Date)
      expect(voided.voidReason).toBe('Error correction')
    })

    it('should require reason when voiding entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      await expect(manager.voidEntry(entry.id, { reason: '' })).rejects.toThrow(
        'Void reason is required'
      )
    })

    it('should not allow editing posted entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      await expect(
        manager.updateEntry(entry.id, { memo: 'Updated memo' })
      ).rejects.toThrow('Cannot modify posted entry')
    })

    it('should not allow voiding draft entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      await expect(
        manager.voidEntry(entry.id, { reason: 'Test void' })
      ).rejects.toThrow('Can only void posted entries')
    })

    it('should not allow re-posting voided entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)
      await manager.voidEntry(entry.id, { reason: 'Error' })

      await expect(manager.postEntry(entry.id)).rejects.toThrow(
        'Cannot post voided entry'
      )
    })

    it('should allow deleting draft entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      await manager.deleteEntry(entry.id)

      const retrieved = await manager.getEntry(entry.id)
      expect(retrieved).toBeNull()
    })

    it('should not allow deleting posted entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      await expect(manager.deleteEntry(entry.id)).rejects.toThrow(
        'Cannot delete posted entry'
      )
    })

    it('should filter entries by status', async () => {
      const draft = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      const posted = await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
      })
      await manager.postEntry(posted.id)

      const draftEntries = await manager.listEntries({ status: 'draft' })
      const postedEntries = await manager.listEntries({ status: 'posted' })

      expect(draftEntries).toHaveLength(1)
      expect(postedEntries).toHaveLength(1)
    })

    it('should track who posted the entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const posted = await manager.postEntry(entry.id, { postedBy: 'user-123' })

      expect(posted.postedBy).toBe('user-123')
    })

    it('should track who voided the entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      const voided = await manager.voidEntry(entry.id, {
        reason: 'Error',
        voidedBy: 'supervisor-456',
      })

      expect(voided.voidedBy).toBe('supervisor-456')
    })
  })

  // =============================================================================
  // Entry Reversal Tests
  // =============================================================================

  describe('entry reversal', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should create reversal entry for posted entry', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Original entry',
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
        memo: 'Reversal of original entry',
      })

      expect(reversal.id).toBeDefined()
      expect(reversal.id).not.toBe(original.id)
      expect(reversal.reversesEntryId).toBe(original.id)
    })

    it('should swap debits and credits in reversal', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
      })

      // Original: Cash debit 10000, Revenue credit 10000
      // Reversal: Cash credit 10000, Revenue debit 10000
      const cashLine = reversal.lines.find((l) => l.accountId === 'acc-cash')
      const revenueLine = reversal.lines.find((l) => l.accountId === 'acc-revenue')

      expect(cashLine?.credit).toBe(10000)
      expect(cashLine?.debit).toBe(0)
      expect(revenueLine?.debit).toBe(10000)
      expect(revenueLine?.credit).toBe(0)
    })

    it('should link reversal to original entry', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
      })

      const updatedOriginal = await manager.getEntry(original.id)
      expect(updatedOriginal?.reversedByEntryId).toBe(reversal.id)
    })

    it('should not allow reversing draft entry', async () => {
      const draft = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      await expect(
        manager.reverseEntry(draft.id, { reversalDate: new Date('2024-01-20') })
      ).rejects.toThrow('Can only reverse posted entries')
    })

    it('should not allow reversing voided entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)
      await manager.voidEntry(entry.id, { reason: 'Error' })

      await expect(
        manager.reverseEntry(entry.id, { reversalDate: new Date('2024-01-20') })
      ).rejects.toThrow('Cannot reverse voided entry')
    })

    it('should not allow reversing already reversed entry', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id)
      await manager.reverseEntry(original.id, { reversalDate: new Date('2024-01-20') })

      await expect(
        manager.reverseEntry(original.id, { reversalDate: new Date('2024-01-25') })
      ).rejects.toThrow('Entry has already been reversed')
    })

    it('should auto-post reversal entry', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
        autoPost: true,
      })

      expect(reversal.status).toBe('posted')
    })

    it('should create reversal as draft by default', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
      })

      expect(reversal.status).toBe('draft')
    })

    it('should require reversal date on or after original posting date', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(original.id, { postingDate: new Date('2024-01-20') })

      await expect(
        manager.reverseEntry(original.id, { reversalDate: new Date('2024-01-18') })
      ).rejects.toThrow('Reversal date cannot be before original posting date')
    })

    it('should include reference to original in reversal memo', async () => {
      const original = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Original entry',
      })
      await manager.postEntry(original.id)

      const reversal = await manager.reverseEntry(original.id, {
        reversalDate: new Date('2024-01-20'),
      })

      expect(reversal.memo).toContain(original.entryNumber)
    })
  })

  // =============================================================================
  // Auto-numbering Tests
  // =============================================================================

  describe('auto-numbering', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should generate unique entry numbers', async () => {
      const entry1 = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      const entry2 = await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
      })

      expect(entry1.entryNumber).not.toBe(entry2.entryNumber)
    })

    it('should generate sequential entry numbers', async () => {
      const entry1 = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      const entry2 = await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
      })
      const entry3 = await manager.createEntry({
        entryDate: new Date('2024-01-17'),
        lines: sampleLines,
      })

      // Parse numbers and verify sequence
      const num1 = parseInt(entry1.entryNumber.replace(/\D/g, ''))
      const num2 = parseInt(entry2.entryNumber.replace(/\D/g, ''))
      const num3 = parseInt(entry3.entryNumber.replace(/\D/g, ''))

      expect(num2).toBe(num1 + 1)
      expect(num3).toBe(num2 + 1)
    })

    it('should support configurable entry number prefix', async () => {
      const customManager = createJournalEntryManager({ prefix: 'JE' })

      const entry = await customManager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      expect(entry.entryNumber).toMatch(/^JE/)
    })

    it('should support year-based numbering', async () => {
      const yearManager = createJournalEntryManager({
        prefix: 'JE',
        includeYear: true,
      })

      const entry = await yearManager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      expect(entry.entryNumber).toMatch(/^JE-2024-/)
    })

    it('should reset sequence at year boundary when configured', async () => {
      const resetManager = createJournalEntryManager({
        prefix: 'JE',
        includeYear: true,
        resetSequenceYearly: true,
      })

      const entry2024 = await resetManager.createEntry({
        entryDate: new Date('2024-12-15'),
        lines: sampleLines,
      })

      // Simulate next year entry
      const entry2025 = await resetManager.createEntry({
        entryDate: new Date('2025-01-15'),
        lines: sampleLines,
      })

      // Both should start with 1 in their respective years
      expect(entry2024.entryNumber).toMatch(/^JE-2024-0*1$/)
      expect(entry2025.entryNumber).toMatch(/^JE-2025-0*1$/)
    })

    it('should pad entry numbers with zeros', async () => {
      const paddedManager = createJournalEntryManager({
        prefix: 'JE',
        padding: 6,
      })

      const entry = await paddedManager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      expect(entry.entryNumber).toMatch(/^JE-\d{6}$/)
    })

    it('should not reuse entry numbers of deleted drafts', async () => {
      const entry1 = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      const originalNumber = entry1.entryNumber

      await manager.deleteEntry(entry1.id)

      const entry2 = await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
      })

      expect(entry2.entryNumber).not.toBe(originalNumber)
    })

    it('should allow custom entry number when provided', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        entryNumber: 'CUSTOM-001',
      })

      expect(entry.entryNumber).toBe('CUSTOM-001')
    })

    it('should reject duplicate custom entry numbers', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        entryNumber: 'CUSTOM-001',
      })

      await expect(
        manager.createEntry({
          entryDate: new Date('2024-01-16'),
          lines: sampleLines,
          entryNumber: 'CUSTOM-001',
        })
      ).rejects.toThrow('Entry number already exists')
    })
  })

  // =============================================================================
  // Memo/Description Support Tests
  // =============================================================================

  describe('memo and description support', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should store entry-level memo', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Payment received from customer ABC Corp',
      })

      expect(entry.memo).toBe('Payment received from customer ABC Corp')
    })

    it('should store line-level descriptions', async () => {
      const linesWithDescriptions: Omit<JournalEntryLine, 'id'>[] = [
        {
          accountId: 'acc-cash',
          accountName: 'Cash',
          debit: 10000,
          credit: 0,
          description: 'Cash received from Customer #12345',
        },
        {
          accountId: 'acc-revenue',
          accountName: 'Sales Revenue',
          debit: 0,
          credit: 10000,
          description: 'Service revenue for Invoice #INV-001',
        },
      ]

      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: linesWithDescriptions,
      })

      expect(entry.lines[0].description).toBe('Cash received from Customer #12345')
      expect(entry.lines[1].description).toBe('Service revenue for Invoice #INV-001')
    })

    it('should allow empty memo', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      expect(entry.memo).toBeUndefined()
    })

    it('should update memo on draft entry', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Original memo',
      })

      const updated = await manager.updateEntry(entry.id, {
        memo: 'Updated memo',
      })

      expect(updated.memo).toBe('Updated memo')
    })

    it('should support reference fields', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Invoice payment',
        reference: 'INV-2024-001',
      })

      expect(entry.reference).toBe('INV-2024-001')
    })

    it('should support source document reference', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        sourceDocument: {
          type: 'invoice',
          id: 'inv-123',
          number: 'INV-2024-001',
        },
      })

      expect(entry.sourceDocument?.type).toBe('invoice')
      expect(entry.sourceDocument?.id).toBe('inv-123')
    })

    it('should search entries by memo text', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Payment from ABC Corporation',
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
        memo: 'Payment from XYZ Inc',
      })

      const results = await manager.searchEntries({ memoContains: 'ABC' })

      expect(results).toHaveLength(1)
      expect(results[0].memo).toContain('ABC')
    })

    it('should search entries by reference', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        reference: 'PO-2024-100',
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
        reference: 'PO-2024-101',
      })

      const results = await manager.searchEntries({ reference: 'PO-2024-100' })

      expect(results).toHaveLength(1)
      expect(results[0].reference).toBe('PO-2024-100')
    })

    it('should store entry metadata', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        metadata: {
          importedFrom: 'legacy-system',
          batchId: 'batch-001',
          processorId: 'auto-import',
        },
      })

      expect(entry.metadata?.importedFrom).toBe('legacy-system')
      expect(entry.metadata?.batchId).toBe('batch-001')
    })

    it('should support tags on entries', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        tags: ['recurring', 'auto-generated', 'monthly'],
      })

      expect(entry.tags).toContain('recurring')
      expect(entry.tags).toContain('monthly')
    })

    it('should filter entries by tag', async () => {
      await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        tags: ['recurring'],
      })
      await manager.createEntry({
        entryDate: new Date('2024-01-16'),
        lines: sampleLines,
        tags: ['manual'],
      })

      const results = await manager.listEntries({ tag: 'recurring' })

      expect(results).toHaveLength(1)
    })
  })

  // =============================================================================
  // Audit Trail Tests
  // =============================================================================

  describe('audit trail', () => {
    let manager: JournalEntryManager

    beforeEach(() => {
      manager = createTestManager()
    })

    it('should track creation timestamp and user', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        createdBy: 'accountant@example.com',
      })

      expect(entry.createdAt).toBeInstanceOf(Date)
      expect(entry.createdBy).toBe('accountant@example.com')
    })

    it('should track last modification', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      const updated = await manager.updateEntry(entry.id, {
        memo: 'Updated',
        updatedBy: 'supervisor@example.com',
      })

      expect(updated.updatedAt).toBeInstanceOf(Date)
      expect(updated.updatedBy).toBe('supervisor@example.com')
    })

    it('should maintain version history', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
        memo: 'Version 1',
      })

      await manager.updateEntry(entry.id, { memo: 'Version 2' })
      await manager.updateEntry(entry.id, { memo: 'Version 3' })

      const history = await manager.getEntryHistory(entry.id)

      expect(history).toHaveLength(3)
      expect(history[0].memo).toBe('Version 1')
      expect(history[1].memo).toBe('Version 2')
      expect(history[2].memo).toBe('Version 3')
    })

    it('should record posting event in history', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })

      await manager.postEntry(entry.id, { postedBy: 'manager@example.com' })

      const history = await manager.getEntryHistory(entry.id)
      const postEvent = history.find((h) => h.event === 'posted')

      expect(postEvent).toBeDefined()
      expect(postEvent?.user).toBe('manager@example.com')
    })

    it('should record void event in history', async () => {
      const entry = await manager.createEntry({
        entryDate: new Date('2024-01-15'),
        lines: sampleLines,
      })
      await manager.postEntry(entry.id)

      await manager.voidEntry(entry.id, {
        reason: 'Data entry error',
        voidedBy: 'controller@example.com',
      })

      const history = await manager.getEntryHistory(entry.id)
      const voidEvent = history.find((h) => h.event === 'voided')

      expect(voidEvent).toBeDefined()
      expect(voidEvent?.reason).toBe('Data entry error')
      expect(voidEvent?.user).toBe('controller@example.com')
    })
  })
})
