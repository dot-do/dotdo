/**
 * Journal Tests - Audit Trail Implementation
 *
 * Tests for journal entry system with full audit trail:
 * - Journal entry posting with timestamp
 * - Entry reversal with linked reversal entries
 * - Immutable history - entries cannot be modified after posting
 * - Entry numbering with fiscal year prefix
 * - Multi-currency journal entries
 * - Attachments support (receipt references)
 * - Entry search by date, account, amount
 * - Audit fields: created_by, created_at, approved_by, approved_at
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createJournal,
  type Journal,
  type JournalEntry,
  type PostedEntry,
  type JournalEntryLine,
  type Attachment,
} from '../journal'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestJournal(options?: { fiscalYear?: number; prefix?: string }): Journal {
  return createJournal(options)
}

const sampleLines: JournalEntryLine[] = [
  {
    accountId: 'acc-1000',
    accountName: 'Cash',
    debit: 10000, // $100.00 in cents
    credit: 0,
    currency: 'USD',
    memo: 'Cash received',
  },
  {
    accountId: 'acc-4000',
    accountName: 'Sales Revenue',
    debit: 0,
    credit: 10000,
    currency: 'USD',
    memo: 'Service revenue',
  },
]

const multiCurrencyLines: JournalEntryLine[] = [
  {
    accountId: 'acc-1000',
    accountName: 'Cash (EUR)',
    debit: 8500,
    credit: 0,
    currency: 'EUR',
    exchangeRate: 1.10,
    memo: 'Euro payment received',
  },
  {
    accountId: 'acc-4000',
    accountName: 'Sales Revenue',
    debit: 0,
    credit: 9350, // 8500 * 1.10
    currency: 'USD',
    memo: 'Service revenue (converted)',
  },
]

// =============================================================================
// Journal Entry Posting Tests
// =============================================================================

describe('Journal', () => {
  describe('entry posting', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should post a journal entry with timestamp', async () => {
      const entry: JournalEntry = {
        date: new Date('2024-01-15'),
        description: 'Payment received for services',
        lines: sampleLines,
        createdBy: 'accountant@example.com',
      }

      const posted = await journal.post(entry)

      expect(posted.entryNumber).toBeDefined()
      expect(posted.entryNumber).toMatch(/^JE-2024-/)
      expect(posted.postedAt).toBeInstanceOf(Date)
      expect(posted.status).toBe('posted')
      expect(posted.createdBy).toBe('accountant@example.com')
      expect(posted.createdAt).toBeInstanceOf(Date)
    })

    it('should assign unique entry numbers sequentially', async () => {
      const entry1 = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry 1',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const entry2 = await journal.post({
        date: new Date('2024-01-16'),
        description: 'Entry 2',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(entry1.entryNumber).not.toBe(entry2.entryNumber)
      // Extract sequence numbers and verify sequential
      const seq1 = parseInt(entry1.entryNumber.split('-').pop() || '0')
      const seq2 = parseInt(entry2.entryNumber.split('-').pop() || '0')
      expect(seq2).toBe(seq1 + 1)
    })

    it('should require balanced debits and credits', async () => {
      const unbalancedEntry: JournalEntry = {
        date: new Date('2024-01-15'),
        description: 'Unbalanced entry',
        lines: [
          { accountId: 'acc-1000', accountName: 'Cash', debit: 10000, credit: 0, currency: 'USD' },
          { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: 5000, currency: 'USD' },
        ],
        createdBy: 'user1',
      }

      await expect(journal.post(unbalancedEntry)).rejects.toThrow('Debits and credits must balance')
    })

    it('should require at least two lines', async () => {
      const singleLineEntry: JournalEntry = {
        date: new Date('2024-01-15'),
        description: 'Single line entry',
        lines: [
          { accountId: 'acc-1000', accountName: 'Cash', debit: 10000, credit: 0, currency: 'USD' },
        ],
        createdBy: 'user1',
      }

      await expect(journal.post(singleLineEntry)).rejects.toThrow(
        'Journal entry must have at least two lines'
      )
    })

    it('should reject lines with both debit and credit', async () => {
      const invalidEntry: JournalEntry = {
        date: new Date('2024-01-15'),
        description: 'Invalid entry',
        lines: [
          { accountId: 'acc-1000', accountName: 'Cash', debit: 10000, credit: 5000, currency: 'USD' },
          { accountId: 'acc-4000', accountName: 'Revenue', debit: 5000, credit: 10000, currency: 'USD' },
        ],
        createdBy: 'user1',
      }

      await expect(journal.post(invalidEntry)).rejects.toThrow(
        'Line cannot have both debit and credit'
      )
    })

    it('should record posting timestamp', async () => {
      const before = new Date()
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })
      const after = new Date()

      expect(posted.postedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(posted.postedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should calculate total debit and credit', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.totalDebit).toBe(10000)
      expect(posted.totalCredit).toBe(10000)
    })
  })

  // =============================================================================
  // Entry Reversal Tests
  // =============================================================================

  describe('entry reversal', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should create a reversal entry with linked reference', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const reversal = await journal.reverse(
        original.entryNumber,
        'Entry was made in error'
      )

      expect(reversal.entryNumber).toBeDefined()
      expect(reversal.entryNumber).not.toBe(original.entryNumber)
      expect(reversal.reversesEntryNumber).toBe(original.entryNumber)
      expect(reversal.reversalReason).toBe('Entry was made in error')
      expect(reversal.status).toBe('posted')
    })

    it('should swap debits and credits in reversal', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const reversal = await journal.reverse(original.entryNumber, 'Error correction')

      // Original: Cash debit 10000, Revenue credit 10000
      // Reversal: Cash credit 10000, Revenue debit 10000
      const cashLine = reversal.lines.find((l) => l.accountId === 'acc-1000')
      const revenueLine = reversal.lines.find((l) => l.accountId === 'acc-4000')

      expect(cashLine?.debit).toBe(0)
      expect(cashLine?.credit).toBe(10000)
      expect(revenueLine?.debit).toBe(10000)
      expect(revenueLine?.credit).toBe(0)
    })

    it('should mark original entry as reversed', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const reversal = await journal.reverse(original.entryNumber, 'Error correction')

      const updatedOriginal = await journal.getEntry(original.entryNumber)
      expect(updatedOriginal?.reversedByEntryNumber).toBe(reversal.entryNumber)
      expect(updatedOriginal?.isReversed).toBe(true)
    })

    it('should not allow reversing a non-existent entry', async () => {
      await expect(journal.reverse('JE-2024-99999', 'Test')).rejects.toThrow(
        'Entry not found'
      )
    })

    it('should not allow reversing an already reversed entry', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      await journal.reverse(original.entryNumber, 'First reversal')

      await expect(
        journal.reverse(original.entryNumber, 'Second reversal')
      ).rejects.toThrow('Entry has already been reversed')
    })

    it('should require a reason for reversal', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      await expect(journal.reverse(original.entryNumber, '')).rejects.toThrow(
        'Reversal reason is required'
      )
    })

    it('should use current date for reversal entry', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const before = new Date()
      const reversal = await journal.reverse(original.entryNumber, 'Error correction')
      const after = new Date()

      expect(reversal.date.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(reversal.date.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  // =============================================================================
  // Immutable History Tests
  // =============================================================================

  describe('immutable history', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should not allow modification of posted entries', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      // Entries returned should be read-only copies
      const retrieved = await journal.getEntry(posted.entryNumber)
      expect(retrieved).toBeDefined()
      expect(Object.isFrozen(retrieved)).toBe(true)
    })

    it('should maintain complete audit trail', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'accountant@example.com',
      })

      expect(posted.createdBy).toBe('accountant@example.com')
      expect(posted.createdAt).toBeInstanceOf(Date)
      expect(posted.postedAt).toBeInstanceOf(Date)
    })

    it('should track approval when provided', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Approved entry',
        lines: sampleLines,
        createdBy: 'accountant@example.com',
        approvedBy: 'supervisor@example.com',
        approvedAt: new Date('2024-01-15T10:00:00Z'),
      })

      expect(posted.approvedBy).toBe('supervisor@example.com')
      expect(posted.approvedAt).toEqual(new Date('2024-01-15T10:00:00Z'))
    })

    it('should preserve original data in reversal references', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      await journal.reverse(original.entryNumber, 'Error correction')

      // Original should still have all its original data
      const retrievedOriginal = await journal.getEntry(original.entryNumber)
      expect(retrievedOriginal?.description).toBe('Original entry')
      expect(retrievedOriginal?.totalDebit).toBe(10000)
    })
  })

  // =============================================================================
  // Fiscal Year Entry Numbering Tests
  // =============================================================================

  describe('entry numbering with fiscal year prefix', () => {
    it('should include fiscal year in entry number', async () => {
      const journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })

      const posted = await journal.post({
        date: new Date('2024-06-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.entryNumber).toMatch(/^JE-2024-\d+$/)
    })

    it('should reset sequence for new fiscal year', async () => {
      const journal2024 = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })

      await journal2024.post({
        date: new Date('2024-12-15'),
        description: 'Entry 1',
        lines: sampleLines,
        createdBy: 'user1',
      })

      // New journal for 2025
      const journal2025 = createTestJournal({ fiscalYear: 2025, prefix: 'JE' })

      const posted2025 = await journal2025.post({
        date: new Date('2025-01-15'),
        description: 'First entry of 2025',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted2025.entryNumber).toMatch(/^JE-2025-0*1$/)
    })

    it('should use configurable prefix', async () => {
      const journal = createTestJournal({ fiscalYear: 2024, prefix: 'GJ' })

      const posted = await journal.post({
        date: new Date('2024-06-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.entryNumber).toMatch(/^GJ-2024-/)
    })

    it('should pad entry numbers with zeros', async () => {
      const journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })

      const posted = await journal.post({
        date: new Date('2024-06-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      // Should be zero-padded to at least 4 digits
      expect(posted.entryNumber).toMatch(/^JE-2024-\d{4,}$/)
    })

    it('should track fiscal year in posted entry', async () => {
      const journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })

      const posted = await journal.post({
        date: new Date('2024-06-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.fiscalYear).toBe(2024)
    })
  })

  // =============================================================================
  // Multi-Currency Journal Entries Tests
  // =============================================================================

  describe('multi-currency entries', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should support different currencies per line', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Multi-currency entry',
        lines: multiCurrencyLines,
        createdBy: 'user1',
      })

      const eurLine = posted.lines.find((l) => l.currency === 'EUR')
      const usdLine = posted.lines.find((l) => l.currency === 'USD')

      expect(eurLine).toBeDefined()
      expect(usdLine).toBeDefined()
      expect(eurLine?.exchangeRate).toBe(1.10)
    })

    it('should store exchange rate with foreign currency lines', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Foreign currency entry',
        lines: [
          {
            accountId: 'acc-1000',
            accountName: 'Cash (GBP)',
            debit: 7500,
            credit: 0,
            currency: 'GBP',
            exchangeRate: 1.25,
          },
          {
            accountId: 'acc-4000',
            accountName: 'Sales Revenue',
            debit: 0,
            credit: 9375, // 7500 * 1.25
            currency: 'USD',
          },
        ],
        createdBy: 'user1',
      })

      const gbpLine = posted.lines.find((l) => l.currency === 'GBP')
      expect(gbpLine?.exchangeRate).toBe(1.25)
    })

    it('should track base currency for entry', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with base currency',
        lines: sampleLines,
        baseCurrency: 'USD',
        createdBy: 'user1',
      })

      expect(posted.baseCurrency).toBe('USD')
    })

    it('should allow missing exchange rate for base currency', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Base currency entry',
        lines: sampleLines,
        baseCurrency: 'USD',
        createdBy: 'user1',
      })

      // USD lines should not require exchange rate when USD is base currency
      expect(posted.lines[0].exchangeRate).toBeUndefined()
    })
  })

  // =============================================================================
  // Attachments Support Tests
  // =============================================================================

  describe('attachments support', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should support receipt references', async () => {
      const attachments: Attachment[] = [
        {
          id: 'att-001',
          type: 'receipt',
          filename: 'receipt-123.pdf',
          url: 'https://storage.example.com/receipts/receipt-123.pdf',
          mimeType: 'application/pdf',
          uploadedAt: new Date('2024-01-15'),
        },
      ]

      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with receipt',
        lines: sampleLines,
        attachments,
        createdBy: 'user1',
      })

      expect(posted.attachments).toHaveLength(1)
      expect(posted.attachments?.[0].type).toBe('receipt')
      expect(posted.attachments?.[0].filename).toBe('receipt-123.pdf')
    })

    it('should support multiple attachments', async () => {
      const attachments: Attachment[] = [
        {
          id: 'att-001',
          type: 'receipt',
          filename: 'receipt.pdf',
          url: 'https://storage.example.com/receipt.pdf',
          mimeType: 'application/pdf',
          uploadedAt: new Date('2024-01-15'),
        },
        {
          id: 'att-002',
          type: 'invoice',
          filename: 'invoice.pdf',
          url: 'https://storage.example.com/invoice.pdf',
          mimeType: 'application/pdf',
          uploadedAt: new Date('2024-01-15'),
        },
      ]

      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with multiple attachments',
        lines: sampleLines,
        attachments,
        createdBy: 'user1',
      })

      expect(posted.attachments).toHaveLength(2)
    })

    it('should support various attachment types', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with image attachment',
        lines: sampleLines,
        attachments: [
          {
            id: 'att-003',
            type: 'image',
            filename: 'receipt-photo.jpg',
            url: 'https://storage.example.com/receipt-photo.jpg',
            mimeType: 'image/jpeg',
            uploadedAt: new Date('2024-01-15'),
          },
        ],
        createdBy: 'user1',
      })

      expect(posted.attachments?.[0].type).toBe('image')
      expect(posted.attachments?.[0].mimeType).toBe('image/jpeg')
    })
  })

  // =============================================================================
  // Entry Search Tests
  // =============================================================================

  describe('entry search', () => {
    let journal: Journal

    beforeEach(async () => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })

      // Create test entries
      await journal.post({
        date: new Date('2024-01-10'),
        description: 'January entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      await journal.post({
        date: new Date('2024-01-20'),
        description: 'Another January entry',
        lines: [
          { accountId: 'acc-1000', accountName: 'Cash', debit: 25000, credit: 0, currency: 'USD' },
          { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: 25000, currency: 'USD' },
        ],
        createdBy: 'user2',
      })

      await journal.post({
        date: new Date('2024-02-15'),
        description: 'February entry',
        lines: [
          { accountId: 'acc-5000', accountName: 'Expense', debit: 5000, credit: 0, currency: 'USD' },
          { accountId: 'acc-1000', accountName: 'Cash', debit: 0, credit: 5000, currency: 'USD' },
        ],
        createdBy: 'user1',
      })
    })

    it('should find entries by date range', async () => {
      const entries = await journal.findByDateRange(
        new Date('2024-01-01'),
        new Date('2024-01-31')
      )

      expect(entries).toHaveLength(2)
      entries.forEach((entry) => {
        expect(entry.date.getMonth()).toBe(0) // January
      })
    })

    it('should find entries by account', async () => {
      const entries = await journal.findByAccount('acc-1000')

      expect(entries).toHaveLength(3) // Cash appears in all entries
    })

    it('should find entries by specific account', async () => {
      const entries = await journal.findByAccount('acc-5000')

      expect(entries).toHaveLength(1) // Expense only in one entry
    })

    it('should return empty array when no entries match', async () => {
      const entries = await journal.findByAccount('acc-nonexistent')

      expect(entries).toHaveLength(0)
    })

    it('should find entries with amount filter', async () => {
      const entries = await journal.findByDateRange(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      )

      const largeEntries = entries.filter((e) => e.totalDebit >= 20000)
      expect(largeEntries).toHaveLength(1)
      expect(largeEntries[0].totalDebit).toBe(25000)
    })

    it('should return entries sorted by date', async () => {
      const entries = await journal.findByDateRange(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      )

      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].date.getTime()).toBeGreaterThanOrEqual(
          entries[i - 1].date.getTime()
        )
      }
    })
  })

  // =============================================================================
  // Get Entry Tests
  // =============================================================================

  describe('get entry', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should retrieve entry by entry number', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const retrieved = await journal.getEntry(posted.entryNumber)

      expect(retrieved).toBeDefined()
      expect(retrieved?.entryNumber).toBe(posted.entryNumber)
      expect(retrieved?.description).toBe('Test entry')
    })

    it('should return null for non-existent entry', async () => {
      const retrieved = await journal.getEntry('JE-2024-99999')

      expect(retrieved).toBeNull()
    })

    it('should return complete entry with all audit fields', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Complete entry',
        lines: sampleLines,
        createdBy: 'accountant@example.com',
        approvedBy: 'supervisor@example.com',
        approvedAt: new Date('2024-01-15T12:00:00Z'),
      })

      const retrieved = await journal.getEntry(posted.entryNumber)

      expect(retrieved?.createdBy).toBe('accountant@example.com')
      expect(retrieved?.createdAt).toBeInstanceOf(Date)
      expect(retrieved?.approvedBy).toBe('supervisor@example.com')
      expect(retrieved?.approvedAt).toEqual(new Date('2024-01-15T12:00:00Z'))
      expect(retrieved?.postedAt).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Audit Fields Tests
  // =============================================================================

  describe('audit fields', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should require created_by field', async () => {
      const entryWithoutCreator = {
        date: new Date('2024-01-15'),
        description: 'Entry without creator',
        lines: sampleLines,
      } as JournalEntry

      await expect(journal.post(entryWithoutCreator)).rejects.toThrow(
        'createdBy is required'
      )
    })

    it('should auto-populate created_at timestamp', async () => {
      const before = new Date()
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Test entry',
        lines: sampleLines,
        createdBy: 'user1',
      })
      const after = new Date()

      expect(posted.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(posted.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should support optional approval fields', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Approved entry',
        lines: sampleLines,
        createdBy: 'staff@example.com',
        approvedBy: 'manager@example.com',
        approvedAt: new Date('2024-01-15T14:30:00Z'),
      })

      expect(posted.approvedBy).toBe('manager@example.com')
      expect(posted.approvedAt).toEqual(new Date('2024-01-15T14:30:00Z'))
    })

    it('should allow entries without approval', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Unapproved entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.approvedBy).toBeUndefined()
      expect(posted.approvedAt).toBeUndefined()
    })

    it('should track modification metadata in reversal', async () => {
      const original = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Original entry',
        lines: sampleLines,
        createdBy: 'user1',
      })

      const reversal = await journal.reverse(original.entryNumber, 'Correction')

      expect(reversal.createdAt).toBeInstanceOf(Date)
      expect(reversal.postedAt).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Edge Cases and Error Handling Tests
  // =============================================================================

  describe('edge cases and error handling', () => {
    let journal: Journal

    beforeEach(() => {
      journal = createTestJournal({ fiscalYear: 2024, prefix: 'JE' })
    })

    it('should handle large amounts correctly', async () => {
      const largeLines: JournalEntryLine[] = [
        { accountId: 'acc-1000', accountName: 'Cash', debit: 999999999999, credit: 0, currency: 'USD' },
        { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: 999999999999, currency: 'USD' },
      ]

      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Large transaction',
        lines: largeLines,
        createdBy: 'user1',
      })

      expect(posted.totalDebit).toBe(999999999999)
      expect(posted.totalCredit).toBe(999999999999)
    })

    it('should handle zero amount lines correctly', async () => {
      const zeroLines: JournalEntryLine[] = [
        { accountId: 'acc-1000', accountName: 'Cash', debit: 0, credit: 0, currency: 'USD' },
        { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: 0, currency: 'USD' },
      ]

      await expect(
        journal.post({
          date: new Date('2024-01-15'),
          description: 'Zero amount entry',
          lines: zeroLines,
          createdBy: 'user1',
        })
      ).rejects.toThrow('Line must have either debit or credit amount')
    })

    it('should reject negative amounts', async () => {
      const negativeLines: JournalEntryLine[] = [
        { accountId: 'acc-1000', accountName: 'Cash', debit: -10000, credit: 0, currency: 'USD' },
        { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: -10000, currency: 'USD' },
      ]

      await expect(
        journal.post({
          date: new Date('2024-01-15'),
          description: 'Negative amount entry',
          lines: negativeLines,
          createdBy: 'user1',
        })
      ).rejects.toThrow('Amounts cannot be negative')
    })

    it('should preserve precision for decimal amounts', async () => {
      // Using cents, so decimals represent fractional cents
      const precisionLines: JournalEntryLine[] = [
        { accountId: 'acc-1000', accountName: 'Cash', debit: 10033, credit: 0, currency: 'USD' },
        { accountId: 'acc-4000', accountName: 'Revenue', debit: 0, credit: 10033, currency: 'USD' },
      ]

      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Precision test',
        lines: precisionLines,
        createdBy: 'user1',
      })

      expect(posted.totalDebit).toBe(10033)
      expect(posted.totalCredit).toBe(10033)
    })

    it('should handle entries with many lines', async () => {
      const manyLines: JournalEntryLine[] = []
      for (let i = 0; i < 50; i++) {
        manyLines.push({
          accountId: `acc-${5000 + i}`,
          accountName: `Expense ${i}`,
          debit: 100,
          credit: 0,
          currency: 'USD',
        })
      }
      // Add offsetting credit
      manyLines.push({
        accountId: 'acc-1000',
        accountName: 'Cash',
        debit: 0,
        credit: 5000,
        currency: 'USD',
      })

      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with many lines',
        lines: manyLines,
        createdBy: 'user1',
      })

      expect(posted.lines).toHaveLength(51)
      expect(posted.totalDebit).toBe(5000)
      expect(posted.totalCredit).toBe(5000)
    })

    it('should handle special characters in description', async () => {
      const posted = await journal.post({
        date: new Date('2024-01-15'),
        description: 'Entry with special chars: @#$%^&*()!<>?"\' and unicode: \u00e9\u00e8\u00ea',
        lines: sampleLines,
        createdBy: 'user1',
      })

      expect(posted.description).toContain('@#$%^&*()')
      expect(posted.description).toContain('\u00e9\u00e8\u00ea')
    })
  })
})
