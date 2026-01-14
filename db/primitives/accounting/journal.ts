/**
 * Journal - Double-entry accounting journal with full audit trail
 *
 * Implements:
 * - Journal entry posting with timestamp
 * - Entry reversal with linked reversal entries
 * - Immutable history - entries cannot be modified after posting
 * - Entry numbering with fiscal year prefix
 * - Multi-currency journal entries
 * - Attachments support (receipt references)
 * - Entry search by date, account, amount
 * - Audit fields: created_by, created_at, approved_by, approved_at
 */

// =============================================================================
// Types
// =============================================================================

export interface JournalEntryLine {
  accountId: string
  accountName: string
  debit: number
  credit: number
  currency: string
  exchangeRate?: number
  memo?: string
}

export interface Attachment {
  id: string
  type: string
  filename: string
  url: string
  mimeType: string
  uploadedAt: Date
}

export interface JournalEntry {
  date: Date
  description: string
  lines: JournalEntryLine[]
  createdBy: string
  approvedBy?: string
  approvedAt?: Date
  baseCurrency?: string
  attachments?: Attachment[]
}

export interface PostedEntry extends Omit<JournalEntry, 'lines'> {
  entryNumber: string
  lines: JournalEntryLine[]
  status: 'posted'
  fiscalYear: number
  totalDebit: number
  totalCredit: number
  createdAt: Date
  postedAt: Date
  reversesEntryNumber?: string
  reversedByEntryNumber?: string
  isReversed?: boolean
  reversalReason?: string
}

export interface JournalOptions {
  fiscalYear?: number
  prefix?: string
}

export interface Journal {
  post(entry: JournalEntry): Promise<PostedEntry>
  reverse(entryNumber: string, reason: string): Promise<PostedEntry>
  getEntry(entryNumber: string): Promise<PostedEntry | null>
  findByDateRange(startDate: Date, endDate: Date): Promise<PostedEntry[]>
  findByAccount(accountId: string): Promise<PostedEntry[]>
}

// =============================================================================
// Implementation
// =============================================================================

class JournalImpl implements Journal {
  private entries: Map<string, PostedEntry> = new Map()
  private sequenceNumber: number = 0
  private fiscalYear: number
  private prefix: string

  constructor(options?: JournalOptions) {
    this.fiscalYear = options?.fiscalYear ?? new Date().getFullYear()
    this.prefix = options?.prefix ?? 'JE'
  }

  private generateEntryNumber(): string {
    this.sequenceNumber++
    const paddedSeq = this.sequenceNumber.toString().padStart(4, '0')
    return `${this.prefix}-${this.fiscalYear}-${paddedSeq}`
  }

  private validateEntry(entry: JournalEntry): void {
    // Require createdBy
    if (!entry.createdBy) {
      throw new Error('createdBy is required')
    }

    // Require at least two lines
    if (entry.lines.length < 2) {
      throw new Error('Journal entry must have at least two lines')
    }

    let totalDebit = 0
    let totalCredit = 0

    for (const line of entry.lines) {
      // Check for negative amounts
      if (line.debit < 0 || line.credit < 0) {
        throw new Error('Amounts cannot be negative')
      }

      // Check for both debit and credit
      if (line.debit > 0 && line.credit > 0) {
        throw new Error('Line cannot have both debit and credit')
      }

      // Check for zero amounts
      if (line.debit === 0 && line.credit === 0) {
        throw new Error('Line must have either debit or credit amount')
      }

      // Apply exchange rate if present for balance calculation
      const rate = line.exchangeRate ?? 1
      totalDebit += line.debit * rate
      totalCredit += line.credit * rate
    }

    // Check balance (with small tolerance for floating point)
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new Error('Debits and credits must balance')
    }
  }

  private freezeEntry(entry: PostedEntry): PostedEntry {
    // Deep freeze the entry to make it immutable
    const frozen = { ...entry }
    frozen.lines = entry.lines.map(line => Object.freeze({ ...line }))
    if (frozen.attachments) {
      frozen.attachments = frozen.attachments.map(att => Object.freeze({ ...att }))
    }
    return Object.freeze(frozen) as PostedEntry
  }

  async post(entry: JournalEntry): Promise<PostedEntry> {
    this.validateEntry(entry)

    const now = new Date()
    const entryNumber = this.generateEntryNumber()

    let totalDebit = 0
    let totalCredit = 0
    for (const line of entry.lines) {
      totalDebit += line.debit
      totalCredit += line.credit
    }

    const posted: PostedEntry = {
      ...entry,
      entryNumber,
      status: 'posted',
      fiscalYear: this.fiscalYear,
      totalDebit,
      totalCredit,
      createdAt: now,
      postedAt: now,
      lines: entry.lines.map(line => ({ ...line })),
      attachments: entry.attachments ? entry.attachments.map(att => ({ ...att })) : undefined,
    }

    const frozenEntry = this.freezeEntry(posted)
    this.entries.set(entryNumber, frozenEntry)

    return frozenEntry
  }

  async reverse(entryNumber: string, reason: string): Promise<PostedEntry> {
    if (!reason || reason.trim() === '') {
      throw new Error('Reversal reason is required')
    }

    const original = this.entries.get(entryNumber)
    if (!original) {
      throw new Error('Entry not found')
    }

    if (original.isReversed) {
      throw new Error('Entry has already been reversed')
    }

    const now = new Date()
    const reversalEntryNumber = this.generateEntryNumber()

    // Swap debits and credits
    const reversedLines = original.lines.map(line => ({
      ...line,
      debit: line.credit,
      credit: line.debit,
    }))

    const reversalEntry: PostedEntry = {
      date: now,
      description: `Reversal of ${original.entryNumber}: ${original.description}`,
      lines: reversedLines,
      createdBy: original.createdBy,
      entryNumber: reversalEntryNumber,
      status: 'posted',
      fiscalYear: this.fiscalYear,
      totalDebit: original.totalCredit,
      totalCredit: original.totalDebit,
      createdAt: now,
      postedAt: now,
      reversesEntryNumber: entryNumber,
      reversalReason: reason,
      baseCurrency: original.baseCurrency,
    }

    // Mark original as reversed (we need to unfreeze, update, and re-freeze)
    const updatedOriginal: PostedEntry = {
      ...original,
      reversedByEntryNumber: reversalEntryNumber,
      isReversed: true,
    }

    const frozenUpdatedOriginal = this.freezeEntry(updatedOriginal)
    const frozenReversalEntry = this.freezeEntry(reversalEntry)

    this.entries.set(entryNumber, frozenUpdatedOriginal)
    this.entries.set(reversalEntryNumber, frozenReversalEntry)

    return frozenReversalEntry
  }

  async getEntry(entryNumber: string): Promise<PostedEntry | null> {
    const entry = this.entries.get(entryNumber)
    return entry ?? null
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<PostedEntry[]> {
    const results: PostedEntry[] = []
    for (const entry of this.entries.values()) {
      const entryTime = entry.date.getTime()
      if (entryTime >= startDate.getTime() && entryTime <= endDate.getTime()) {
        results.push(entry)
      }
    }
    // Sort by date
    return results.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  async findByAccount(accountId: string): Promise<PostedEntry[]> {
    const results: PostedEntry[] = []
    for (const entry of this.entries.values()) {
      const hasAccount = entry.lines.some(line => line.accountId === accountId)
      if (hasAccount) {
        results.push(entry)
      }
    }
    // Sort by date
    return results.sort((a, b) => a.date.getTime() - b.date.getTime())
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createJournal(options?: JournalOptions): Journal {
  return new JournalImpl(options)
}
