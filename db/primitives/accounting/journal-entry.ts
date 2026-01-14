/**
 * Journal Entry - Stub Implementation
 *
 * This file contains only type definitions and stub exports.
 * The actual implementation does not exist yet - this is the RED phase of TDD.
 *
 * All functions will throw "Not implemented" errors.
 */

// =============================================================================
// Types
// =============================================================================

export type JournalEntryStatus = 'draft' | 'posted' | 'void'

export interface JournalEntryLine {
  id: string
  accountId: string
  accountName: string
  debit: number
  credit: number
  description?: string
}

export interface SourceDocument {
  type: string
  id: string
  number?: string
}

export interface JournalEntryHistoryEvent {
  event: 'created' | 'updated' | 'posted' | 'voided' | 'reversed'
  timestamp: Date
  user?: string
  reason?: string
  memo?: string
  changes?: Record<string, unknown>
}

export interface JournalEntry {
  id: string
  entryNumber: string
  entryDate: Date
  postingDate: Date | null
  status: JournalEntryStatus
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  memo?: string
  reference?: string
  sourceDocument?: SourceDocument
  metadata?: Record<string, unknown>
  tags?: string[]
  fiscalYear?: number
  fiscalPeriod?: number
  reversesEntryId?: string
  reversedByEntryId?: string
  createdAt: Date
  createdBy?: string
  updatedAt?: Date
  updatedBy?: string
  postedAt?: Date
  postedBy?: string
  voidedAt?: Date
  voidedBy?: string
  voidReason?: string
}

export interface CreateJournalEntryInput {
  entryDate: Date
  lines: Omit<JournalEntryLine, 'id'>[]
  memo?: string
  reference?: string
  sourceDocument?: SourceDocument
  metadata?: Record<string, unknown>
  tags?: string[]
  entryNumber?: string
  createdBy?: string
}

export interface UpdateJournalEntryInput {
  memo?: string
  reference?: string
  lines?: Omit<JournalEntryLine, 'id'>[]
  tags?: string[]
  metadata?: Record<string, unknown>
  updatedBy?: string
}

export interface PostEntryOptions {
  postingDate?: Date
  useEntryDateAsPostingDate?: boolean
  postedBy?: string
}

export interface VoidEntryOptions {
  reason: string
  voidedBy?: string
}

export interface ReverseEntryOptions {
  reversalDate: Date
  memo?: string
  autoPost?: boolean
}

export interface ListEntriesOptions {
  startDate?: Date
  endDate?: Date
  status?: JournalEntryStatus
  tag?: string
}

export interface SearchEntriesOptions {
  memoContains?: string
  reference?: string
}

export interface JournalEntryManagerOptions {
  prefix?: string
  includeYear?: boolean
  resetSequenceYearly?: boolean
  padding?: number
}

export interface JournalEntryManager {
  // Entry CRUD
  createEntry(input: CreateJournalEntryInput): Promise<JournalEntry>
  getEntry(id: string): Promise<JournalEntry | null>
  getEntryByNumber(entryNumber: string): Promise<JournalEntry | null>
  updateEntry(id: string, input: UpdateJournalEntryInput): Promise<JournalEntry>
  deleteEntry(id: string): Promise<void>

  // Status transitions
  postEntry(id: string, options?: PostEntryOptions): Promise<JournalEntry>
  voidEntry(id: string, options: VoidEntryOptions): Promise<JournalEntry>

  // Reversal
  reverseEntry(id: string, options: ReverseEntryOptions): Promise<JournalEntry>

  // Query
  listEntries(options?: ListEntriesOptions): Promise<JournalEntry[]>
  listEntriesByAccount(accountId: string): Promise<JournalEntry[]>
  searchEntries(options: SearchEntriesOptions): Promise<JournalEntry[]>

  // Audit
  getEntryHistory(id: string): Promise<JournalEntryHistoryEvent[]>
}

// =============================================================================
// Factory Function (Stub)
// =============================================================================

export function createJournalEntryManager(
  _options?: JournalEntryManagerOptions
): JournalEntryManager {
  throw new Error('Not implemented: createJournalEntryManager')
}
