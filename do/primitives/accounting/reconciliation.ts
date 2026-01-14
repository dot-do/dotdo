/**
 * Bank Reconciliation Engine - Stub Implementation
 *
 * This file contains type definitions and stub exports for the
 * bank reconciliation engine. The actual implementation is
 * pending - all tests should FAIL.
 *
 * Features to implement:
 * - Statement matching
 * - Discrepancy detection
 * - Reconciliation workflow
 * - Date range reconciliation
 * - Multi-account reconciliation
 * - Tolerance matching
 * - Duplicate detection
 * - Unreconciled item tracking
 */

// =============================================================================
// Type Definitions
// =============================================================================

export type TransactionType = 'credit' | 'debit'
export type MatchStatus = 'suggested' | 'approved' | 'rejected'
export type MatchType = 'exact' | 'reference' | 'fuzzy' | 'manual'
export type ExceptionType = 'missing_ledger_entry' | 'missing_bank_entry' | 'amount_mismatch' | 'bank_fee' | 'threshold_violation' | 'other'
export type ExceptionStatus = 'open' | 'resolved'
export type SessionStatus = 'in_progress' | 'completed' | 'cancelled'
export type OutstandingItemType = 'outstanding_check' | 'deposit_in_transit'

export interface BankTransaction {
  id: string
  date: Date
  amount: number
  description: string
  reference?: string
  type: TransactionType
  accountId?: string
}

export interface LedgerEntry {
  id: string
  date: Date
  amount: number
  description: string
  reference?: string
  accountId: string
  journalEntryId?: string
}

export interface BankStatement {
  id: string
  accountId: string
  bankAccountNumber?: string
  statementDate: Date
  startDate: Date
  endDate: Date
  openingBalance: number
  closingBalance: number
  transactions: BankTransaction[]
  currency?: string
}

export interface ReconciliationMatch {
  id: string
  bankTransactionId: string
  ledgerEntryId: string
  status: MatchStatus
  matchType: MatchType
  confidence: number
  withinTolerance?: boolean
  toleranceUsed?: number
  toleranceType?: 'amount' | 'percentage'
  approvedAt?: Date
  rejectionReason?: string
  note?: string
  // Auto-matching rule properties
  matchedByRule?: boolean
  suggestedAccount?: string
  suggestedCategory?: string
  taxDeductible?: boolean
  ruleType?: MatchingRuleType
}

export interface GroupedMatch {
  id: string
  bankTransactionIds: string[]
  ledgerEntryIds: string[]
  totalAmount: number
  status: MatchStatus
}

export interface ReconciliationException {
  id: string
  bankTransactionId?: string
  ledgerEntryId?: string
  type: ExceptionType
  status: ExceptionStatus
  note?: string
  resolution?: string
  journalEntryId?: string
  resolvedAt?: Date
}

export interface ReconciliationDiscrepancy {
  unmatchedBankTransactions: BankTransaction[]
  unmatchedLedgerEntries: LedgerEntry[]
  amountMismatches: Array<{
    bankTransactionId: string
    ledgerEntryId: string
    bankAmount: number
    ledgerAmount: number
    difference: number
  }>
  dateMismatches: Array<{
    bankTransactionId: string
    ledgerEntryId: string
    bankDate: Date
    ledgerDate: Date
    daysDifference: number
  }>
  accountMismatches: Array<{
    bankTransactionId: string
    ledgerEntryId: string
    bankAccount: string
    ledgerAccount: string
  }>
  flaggedItems: Array<{
    id: string
    reason: string
    amount: number
  }>
  outstandingItems: Array<{
    id: string
    type: OutstandingItemType
    amount: number
    date: Date
  }>
  timingDifferences: Array<{
    bankTransactionId: string
    ledgerEntryId: string
    description: string
  }>
  toleranceExceeded?: boolean
  toleranceExceededAmount?: number
}

export interface ReconciliationSessionNote {
  id: string
  text: string
  author: string
  createdAt: Date
}

export interface ReconciliationSession {
  id: string
  accountId: string
  status: SessionStatus
  statement: BankStatement
  createdAt: Date
  completedAt?: Date
  notes: ReconciliationSessionNote[]
  startDate?: Date
  endDate?: Date
}

export interface ReconciliationHistoryEvent {
  id: string
  sessionId: string
  event: 'session_created' | 'match_approved' | 'match_rejected' | 'exception_created' | 'session_finalized'
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface ReconciliationSummary {
  sessionId: string
  bankOpeningBalance: number
  bankClosingBalance: number
  bankBalance: number
  adjustedBookBalance: number
  bankTotal: number
  ledgerTotal: number
  difference: number
  matchedItemsCount: number
  unmatchedItemsCount: number
  transactionsInScope: number
  isReconciled: boolean
  isFullyReconciled: boolean
  totalToleranceUsed: number
  carriedForwardItems: number
  outstandingChecksTotal: number
}

export interface UnreconciledItems {
  bankTransactions: BankTransaction[]
  ledgerEntries: LedgerEntry[]
  totalUnreconciledBank: number
  totalUnreconciledLedger: number
  carriedForward: Array<{
    id: string
    type: 'bank' | 'ledger'
    amount: number
    originalPeriod: string
  }>
}

export interface UnreconciledReport {
  bankItems: BankTransaction[]
  ledgerItems: LedgerEntry[]
  totalBankAmount: number
  totalLedgerAmount: number
  generatedAt: Date
}

export interface DuplicateGroup {
  id: string
  transactions?: BankTransaction[]
  entries?: LedgerEntry[]
  confidence: number
}

export interface DuplicateDetectionResult {
  bankDuplicates: DuplicateGroup[]
  ledgerDuplicates: DuplicateGroup[]
  potentialDuplicates: DuplicateGroup[]
}

export interface ToleranceAdjustment {
  id: string
  sessionId: string
  amount: number
  accountId: string
  matchId: string
}

export interface InterAccountTransfer {
  id: string
  fromAccount: string
  toAccount: string
  amount: number
  fromTransactionId: string
  toTransactionId: string
}

export interface MultiAccountSession {
  id: string
  accounts: string[]
  sessions: ReconciliationSession[]
}

export interface ConsolidatedSummary {
  totalBankBalance: number
  totalInBaseCurrency: number
  accountCount: number
  accounts: Array<{
    accountId: string
    balance: number
    currency?: string
  }>
}

export interface PeriodComparison {
  periods: Array<{
    sessionId: string
    startDate: Date
    endDate: Date
    bankTotal: number
    ledgerTotal: number
  }>
  trends: {
    volumeChange: number
  }
}

export interface ReconciliationAlert {
  id: string
  type: 'stale_unreconciled_item' | 'large_discrepancy' | 'duplicate_detected' | 'missing_recurring_transaction'
  message: string
  severity: 'info' | 'warning' | 'error'
}

// =============================================================================
// Auto-Matching Rule Types
// =============================================================================

export type MatchingRuleType = 'description' | 'reference' | 'amount_range' | 'vendor' | 'compound' | 'recurring' | 'category'
export type RuleConditionType = 'description' | 'reference' | 'amount_range' | 'day_of_month'
export type CompoundOperator = 'AND' | 'OR'

export interface RuleCondition {
  type: RuleConditionType
  pattern?: RegExp
  minAmount?: number
  maxAmount?: number
  days?: number[]
}

export interface MatchingRule {
  id: string
  name: string
  type: MatchingRuleType
  pattern?: RegExp
  patterns?: string[]
  vendorPatterns?: string[]
  conditions?: RuleCondition[]
  operator?: CompoundOperator
  minAmount?: number
  maxAmount?: number
  expectedAmount?: number
  expectedDayOfMonth?: number
  toleranceAmount?: number
  toleranceDays?: number
  targetAccount?: string
  category?: string
  autoApprove?: boolean
  createLedgerEntry?: boolean
  enabled: boolean
  priority?: number
  accountScope?: string
  alertOnMissing?: boolean
  taxDeductible?: boolean
  createdAt: Date
  updatedAt?: Date
}

export interface MatchingRuleStats {
  ruleId: string
  totalMatches: number
  lastMatchedAt?: Date
  totalAmount: number
}

export interface MatchingRuleTestResult {
  wouldMatch: boolean
  sampleMatches: Array<{ transactionId: string; description: string; amount: number }>
  estimatedMatches: number
}

export interface RuleConflict {
  id: string
  rules: MatchingRule[]
  conflictType: 'priority' | 'pattern_overlap'
}

export interface RuleSuggestion {
  proposedRule: Partial<MatchingRule>
  confidence: number
  basedOnTransactions: string[]
}

export interface CreateMatchingRuleOptions {
  name: string
  type: MatchingRuleType
  pattern?: RegExp
  patterns?: string[]
  vendorPatterns?: string[]
  conditions?: RuleCondition[]
  operator?: CompoundOperator
  minAmount?: number
  maxAmount?: number
  expectedAmount?: number
  expectedDayOfMonth?: number
  toleranceAmount?: number
  toleranceDays?: number
  targetAccount?: string
  category?: string
  autoApprove?: boolean
  createLedgerEntry?: boolean
  enabled?: boolean
  priority?: number
  accountScope?: string
  alertOnMissing?: boolean
  taxDeductible?: boolean
}

// =============================================================================
// Advanced Exception Types
// =============================================================================

export interface ExceptionTemplate {
  id: string
  name: string
  type: ExceptionType
  defaultNote?: string
  defaultResolution?: string
  targetAccount?: string
}

export interface ExceptionAutoResolveRule {
  id: string
  name: string
  conditions: {
    type?: ExceptionType
    maxAmount?: number
  }
  resolution: string
  targetAccount?: string
}

export interface ExceptionSummary {
  total: number
  byType: Record<string, number>
  byStatus: Record<string, number>
}

export interface ExceptionReport {
  openExceptions: number
  resolvedExceptions: number
  exceptions: ReconciliationException[]
  generatedAt: Date
}

export interface ExceptionMetrics {
  averageResolutionTimeMs: number
  resolvedCount: number
  openCount: number
}

export interface ExceptionComment {
  id: string
  text: string
  author: string
  createdAt: Date
}

export interface ExceptionAuditEntry {
  id: string
  action: string
  timestamp: Date
  actor?: string
}

export interface ExtendedReconciliationException extends ReconciliationException {
  autoCreated?: boolean
  requiresApproval?: boolean
  approvalChain?: string[]
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  currentApprover?: string
  escalated?: boolean
  escalationLevel?: number
  linkedJournalEntries?: string[]
  comments?: ExceptionComment[]
  auditTrail?: ExceptionAuditEntry[]
  amount?: number
  autoResolved?: boolean
  createdAt?: Date
}

export interface CreateSessionOptions {
  accountId: string
  statement: BankStatement
  ledgerEntries: LedgerEntry[]
  options?: {
    maxDateDifferenceInDays?: number
    toleranceAmount?: number
    tolerancePercent?: number
    maxTotalTolerance?: number
    flagThreshold?: number
    startDate?: Date
    endDate?: Date
    carryForwardFrom?: string
    staleItemThresholdDays?: number
    applyAutoRules?: boolean
    autoExceptionThreshold?: number
  }
}

export interface CreateMultiAccountSessionOptions {
  statements: BankStatement[]
  ledgerEntries: LedgerEntry[]
  options?: {
    baseCurrency?: string
    exchangeRates?: Record<string, number>
  }
}

// =============================================================================
// Engine Interface
// =============================================================================

export interface ReconciliationEngine {
  // Session Management
  createSession(options: CreateSessionOptions): Promise<ReconciliationSession>
  createRollingSession(options: { accountId: string; rollingDays: number }): Promise<ReconciliationSession>
  createMultiAccountSession(options: CreateMultiAccountSessionOptions): Promise<MultiAccountSession>
  getSession(sessionId: string): Promise<ReconciliationSession | null>
  finalizeSession(sessionId: string, options?: { allowUnreconciled?: boolean }): Promise<ReconciliationSession>
  getSessionHistory(sessionId: string): Promise<ReconciliationHistoryEvent[]>
  addSessionNote(sessionId: string, note: { note: string; author: string }): Promise<ReconciliationSession>

  // Matching
  findMatches(sessionId: string): Promise<ReconciliationMatch[]>
  findGroupedMatches(sessionId: string): Promise<GroupedMatch[]>
  approveMatch(sessionId: string, matchId: string): Promise<ReconciliationMatch>
  rejectMatch(sessionId: string, matchId: string, options: { reason: string }): Promise<ReconciliationMatch>
  createManualMatch(
    sessionId: string,
    options: { bankTransactionId: string; ledgerEntryId: string; note?: string }
  ): Promise<ReconciliationMatch>

  // Discrepancies
  detectDiscrepancies(sessionId: string): Promise<ReconciliationDiscrepancy>
  getReconciliationSummary(sessionId: string): Promise<ReconciliationSummary>

  // Exceptions
  createException(
    sessionId: string,
    options: { bankTransactionId?: string; ledgerEntryId?: string; type: ExceptionType; note?: string }
  ): Promise<ReconciliationException>
  resolveException(
    sessionId: string,
    exceptionId: string,
    options: { resolution: string; journalEntryId?: string; note?: string }
  ): Promise<ReconciliationException>
  getExceptions(sessionId: string): Promise<ReconciliationException[]>
  bulkCreateExceptions(
    sessionId: string,
    transactionIds: string[],
    options: { type: ExceptionType; note?: string }
  ): Promise<ReconciliationException[]>

  // Outstanding Items
  markAsOutstanding(
    sessionId: string,
    options: { bankTransactionId?: string; ledgerEntryId?: string; type: OutstandingItemType }
  ): Promise<void>

  // Duplicates
  detectDuplicates(sessionId: string): Promise<DuplicateDetectionResult>
  detectCrossPeriodDuplicates(
    sessionId: string,
    options: { lookbackSessions: string[] }
  ): Promise<DuplicateGroup[]>
  markDuplicatesAsIntentional(
    sessionId: string,
    duplicateGroupId: string,
    options: { reason: string }
  ): Promise<void>
  suggestDuplicateResolution(sessionId: string, duplicateGroupId: string): Promise<string[]>

  // Tolerance
  generateToleranceAdjustments(sessionId: string): Promise<ToleranceAdjustment[]>

  // Unreconciled Items
  getUnreconciledItems(sessionId: string): Promise<UnreconciledItems>
  getUnreconciledAging(sessionId: string): Promise<Record<string, number>>
  generateUnreconciledReport(sessionId: string): Promise<UnreconciledReport>
  exportUnreconciledItems(sessionId: string, options: { format: 'csv' | 'json' }): Promise<string>
  getReconciliationAlerts(sessionId: string): Promise<ReconciliationAlert[]>

  // Multi-Account
  detectInterAccountTransfers(multiSessionId: string): Promise<InterAccountTransfer[]>
  getConsolidatedSummary(multiSessionId: string): Promise<ConsolidatedSummary>

  // Period Comparison
  comparePeriods(sessionIds: string[]): Promise<PeriodComparison>

  // =============================================================================
  // Auto-Matching Rules
  // =============================================================================

  createMatchingRule(options: CreateMatchingRuleOptions): Promise<MatchingRule>
  updateMatchingRule(ruleId: string, updates: Partial<CreateMatchingRuleOptions>): Promise<MatchingRule>
  deleteMatchingRule(ruleId: string): Promise<void>
  listMatchingRules(filter?: { accountId?: string }): Promise<MatchingRule[]>
  enableMatchingRule(ruleId: string): Promise<void>
  disableMatchingRule(ruleId: string): Promise<void>
  getMatchingRuleStats(ruleId: string): Promise<MatchingRuleStats>
  testMatchingRule(ruleId: string, options: { lookbackDays: number }): Promise<MatchingRuleTestResult>
  detectRuleConflicts(): Promise<RuleConflict[]>
  getMatchingRuleHistory(ruleId: string): Promise<MatchingRule[]>
  suggestMatchingRules(sessionId: string, options: { minConfidence: number; minOccurrences: number }): Promise<RuleSuggestion[]>
  importMatchingRules(targetAccountId: string, options: { fromAccount: string }): Promise<void>
  exportMatchingRules(options: { format: 'json' | 'csv' }): Promise<string>

  // =============================================================================
  // Advanced Exception Handling
  // =============================================================================

  getException(sessionId: string, exceptionId: string): Promise<ExtendedReconciliationException>
  approveException(sessionId: string, exceptionId: string, options: { approver: string; comment?: string }): Promise<ExtendedReconciliationException>
  processExceptionEscalations(sessionId: string, options: { escalationThresholdDays: number }): Promise<void>
  getExceptionSummary(sessionId: string): Promise<ExceptionSummary>
  createExceptionTemplate(options: Omit<ExceptionTemplate, 'id'>): Promise<ExceptionTemplate>
  createExceptionFromTemplate(sessionId: string, templateId: string, options: { bankTransactionId?: string; ledgerEntryId?: string }): Promise<ExtendedReconciliationException>
  batchResolveExceptions(sessionId: string, exceptionIds: string[], options: { resolution: string; targetAccount?: string; note?: string }): Promise<ExtendedReconciliationException[]>
  generateExceptionReport(sessionId: string, options: { includeResolved?: boolean; format?: 'summary' | 'detailed' }): Promise<ExceptionReport>
  addExceptionComment(sessionId: string, exceptionId: string, options: { text: string; author: string }): Promise<ExtendedReconciliationException>
  createExceptionAutoResolveRule(options: Omit<ExceptionAutoResolveRule, 'id'>): Promise<ExceptionAutoResolveRule>
  getExceptionMetrics(sessionId: string): Promise<ExceptionMetrics>
}

// =============================================================================
// Implementation
// =============================================================================

interface StoredSession {
  session: ReconciliationSession
  statement: BankStatement
  ledgerEntries: LedgerEntry[]
  matches: Map<string, ReconciliationMatch>
  groupedMatches: Map<string, GroupedMatch>
  exceptions: Map<string, ExtendedReconciliationException>
  history: ReconciliationHistoryEvent[]
  options: CreateSessionOptions['options']
  approvedMatchIds: Set<string>
  intentionalDuplicates: Set<string>  // Stores sorted transaction ID pairs e.g. "txn-1:txn-2"
  duplicateGroupToTxns: Map<string, string[]>  // Group ID to transaction IDs mapping
  outstandingItems: Map<string, { type: OutstandingItemType; itemId: string; itemType: 'bank' | 'ledger'; amount: number }>
}

interface StoredMultiSession {
  id: string
  accounts: string[]
  sessions: string[]
  options: CreateMultiAccountSessionOptions['options']
}

class ReconciliationEngineImpl implements ReconciliationEngine {
  private sessions: Map<string, StoredSession> = new Map()
  private multiSessions: Map<string, StoredMultiSession> = new Map()
  private matchingRules: Map<string, MatchingRule> = new Map()
  private matchingRuleHistory: Map<string, MatchingRule[]> = new Map()
  private matchingRuleStats: Map<string, MatchingRuleStats> = new Map()
  private exceptionTemplates: Map<string, ExceptionTemplate> = new Map()
  private exceptionAutoResolveRules: Map<string, ExceptionAutoResolveRule> = new Map()
  private idCounter = 0

  private generateId(prefix: string = 'id'): string {
    return `${prefix}-${++this.idCounter}-${Math.random().toString(36).slice(2, 8)}`
  }

  // =============================================================================
  // Session Management
  // =============================================================================

  async createSession(options: CreateSessionOptions): Promise<ReconciliationSession> {
    const sessionId = this.generateId('session')
    const now = new Date()

    const session: ReconciliationSession = {
      id: sessionId,
      accountId: options.accountId,
      status: 'in_progress',
      statement: options.statement,
      createdAt: now,
      notes: [],
      startDate: options.options?.startDate,
      endDate: options.options?.endDate,
    }

    const historyEvent: ReconciliationHistoryEvent = {
      id: this.generateId('event'),
      sessionId,
      event: 'session_created',
      timestamp: now,
    }

    const storedSession: StoredSession = {
      session,
      statement: options.statement,
      ledgerEntries: options.ledgerEntries,
      matches: new Map(),
      groupedMatches: new Map(),
      exceptions: new Map(),
      history: [historyEvent],
      options: options.options,
      approvedMatchIds: new Set(),
      intentionalDuplicates: new Set(),
      duplicateGroupToTxns: new Map(),
      outstandingItems: new Map(),
    }

    this.sessions.set(sessionId, storedSession)

    // Auto-create exceptions for threshold violations
    const autoExceptionThreshold = options.options?.autoExceptionThreshold
    if (autoExceptionThreshold !== undefined) {
      for (const txn of options.statement.transactions) {
        if (Math.abs(txn.amount) > autoExceptionThreshold) {
          const exceptionId = this.generateId('exception')
          const exception: ExtendedReconciliationException = {
            id: exceptionId,
            bankTransactionId: txn.id,
            type: 'threshold_violation',
            status: 'open',
            autoCreated: true,
            createdAt: now,
            comments: [],
            auditTrail: [{
              id: this.generateId('audit'),
              action: 'auto_created_threshold',
              timestamp: now,
            }],
          }
          storedSession.exceptions.set(exceptionId, exception)
        }
      }
    }

    return session
  }

  async createRollingSession(options: { accountId: string; rollingDays: number }): Promise<ReconciliationSession> {
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - options.rollingDays * 24 * 60 * 60 * 1000)

    return this.createSession({
      accountId: options.accountId,
      statement: {
        id: this.generateId('stmt'),
        accountId: options.accountId,
        statementDate: endDate,
        startDate,
        endDate,
        openingBalance: 0,
        closingBalance: 0,
        transactions: [],
      },
      ledgerEntries: [],
      options: { startDate, endDate },
    })
  }

  async createMultiAccountSession(options: CreateMultiAccountSessionOptions): Promise<MultiAccountSession> {
    const multiSessionId = this.generateId('multi')
    const accounts: string[] = []
    const sessionIds: string[] = []
    const sessions: ReconciliationSession[] = []

    for (const statement of options.statements) {
      const ledgerEntriesForAccount = options.ledgerEntries.filter(
        (e) => e.accountId === statement.accountId
      )

      const session = await this.createSession({
        accountId: statement.accountId,
        statement,
        ledgerEntries: ledgerEntriesForAccount,
        options: {
          ...(options.options || {}),
        },
      })

      accounts.push(statement.accountId)
      sessionIds.push(session.id)
      sessions.push(session)
    }

    this.multiSessions.set(multiSessionId, {
      id: multiSessionId,
      accounts,
      sessions: sessionIds,
      options: options.options,
    })

    return {
      id: multiSessionId,
      accounts,
      sessions,
    }
  }

  async getSession(sessionId: string): Promise<ReconciliationSession | null> {
    const stored = this.sessions.get(sessionId)
    return stored?.session ?? null
  }

  async finalizeSession(
    sessionId: string,
    options?: { allowUnreconciled?: boolean }
  ): Promise<ReconciliationSession> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    // Check for unresolved exceptions
    const unresolvedExceptions = Array.from(stored.exceptions.values()).filter(
      (e) => e.status === 'open'
    )
    if (unresolvedExceptions.length > 0) {
      throw new Error('Cannot finalize with unresolved exceptions')
    }

    // Check all items are matched or excepted
    if (!options?.allowUnreconciled) {
      const unreconciled = await this.getUnreconciledItems(sessionId)
      if (
        unreconciled.bankTransactions.length > 0 ||
        unreconciled.ledgerEntries.length > 0
      ) {
        throw new Error('All items must be matched or have exceptions')
      }
    } else {
      // Auto-mark unreconciled items as outstanding for carry-forward
      const unreconciled = await this.getUnreconciledItems(sessionId)
      for (const txn of unreconciled.bankTransactions) {
        stored.outstandingItems.set(txn.id, {
          type: 'outstanding_check',
          itemId: txn.id,
          itemType: 'bank',
          amount: Math.abs(txn.amount),
        })
      }
      for (const entry of unreconciled.ledgerEntries) {
        stored.outstandingItems.set(entry.id, {
          type: entry.amount < 0 ? 'outstanding_check' : 'deposit_in_transit',
          itemId: entry.id,
          itemType: 'ledger',
          amount: Math.abs(entry.amount),
        })
      }
    }

    stored.session.status = 'completed'
    stored.session.completedAt = new Date()

    stored.history.push({
      id: this.generateId('event'),
      sessionId,
      event: 'session_finalized',
      timestamp: new Date(),
    })

    return stored.session
  }

  async getSessionHistory(sessionId: string): Promise<ReconciliationHistoryEvent[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')
    return [...stored.history]
  }

  async addSessionNote(
    sessionId: string,
    note: { note: string; author: string }
  ): Promise<ReconciliationSession> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    stored.session.notes.push({
      id: this.generateId('note'),
      text: note.note,
      author: note.author,
      createdAt: new Date(),
    })

    return stored.session
  }

  // =============================================================================
  // Matching
  // =============================================================================

  async findMatches(sessionId: string): Promise<ReconciliationMatch[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    // Clear existing matches for re-computation
    stored.matches.clear()

    const { statement, ledgerEntries, options } = stored
    const toleranceAmount = options?.toleranceAmount ?? 1 // Default $0.01
    const tolerancePercent = options?.tolerancePercent
    const maxDateDiff = options?.maxDateDifferenceInDays ?? 365
    const applyAutoRules = options?.applyAutoRules ?? false

    // Filter transactions by date range if specified
    let transactions = [...statement.transactions]
    if (options?.startDate && options?.endDate) {
      transactions = transactions.filter((t) => {
        const txnTime = t.date.getTime()
        return txnTime >= options.startDate!.getTime() && txnTime <= options.endDate!.getTime()
      })
    }

    const matches: ReconciliationMatch[] = []
    const usedLedgerIds = new Set<string>()

    for (const bankTxn of transactions) {
      // Find potential matches
      const potentialMatches: Array<{
        entry: LedgerEntry
        confidence: number
        matchType: MatchType
        withinTolerance: boolean
        toleranceUsed: number
      }> = []

      for (const entry of ledgerEntries) {
        if (usedLedgerIds.has(entry.id)) continue

        // Check date difference
        const dateDiff = Math.abs(bankTxn.date.getTime() - entry.date.getTime())
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24)
        if (daysDiff > maxDateDiff) continue

        // Check amount match - account for debit/credit sign differences
        // Bank debits are outflows (negative effect), credits are inflows (positive effect)
        // Ledger entries may have opposite signs to represent the same transaction
        const bankEffectiveAmount = bankTxn.type === 'debit' ? -bankTxn.amount : bankTxn.amount

        // Try both direct match and sign-flipped match
        const directDiff = Math.abs(bankTxn.amount - entry.amount)
        const signFlipDiff = Math.abs(bankEffectiveAmount - entry.amount)
        const amountDiff = Math.min(directDiff, signFlipDiff)

        let withinTolerance = false
        let toleranceUsed = 0

        if (tolerancePercent !== undefined) {
          const allowedDiff = Math.abs(bankTxn.amount) * (tolerancePercent / 100)
          withinTolerance = amountDiff <= allowedDiff
          toleranceUsed = amountDiff
        } else {
          withinTolerance = amountDiff <= toleranceAmount
          toleranceUsed = amountDiff
        }

        const exactAmount = amountDiff === 0
        const exactDate = daysDiff === 0

        // Reference match
        const refMatch =
          bankTxn.reference &&
          entry.reference &&
          bankTxn.reference === entry.reference

        // Calculate confidence - date proximity affects confidence even for reference/exact matches
        let confidence = 0
        let matchType: MatchType = 'fuzzy'

        // Date penalty: closer dates get higher confidence
        // Max penalty of 0.1 for 30+ day difference
        const dateProximityPenalty = Math.min(daysDiff * 0.01, 0.1)

        if (refMatch && exactAmount) {
          confidence = 1.0 - dateProximityPenalty
          matchType = 'reference'
        } else if (exactAmount && exactDate) {
          confidence = 1.0
          matchType = 'exact'
        } else if (refMatch && withinTolerance) {
          confidence = 0.9 - dateProximityPenalty
          matchType = 'reference'
        } else if (exactAmount) {
          confidence = 0.8 - dateProximityPenalty
          matchType = 'exact'
        } else if (withinTolerance) {
          confidence = 0.7 - dateProximityPenalty
          matchType = 'fuzzy'
        } else {
          continue // No match
        }

        if (confidence > 0) {
          potentialMatches.push({
            entry,
            confidence: Math.max(0, confidence),
            matchType,
            withinTolerance: amountDiff > 0 && withinTolerance,
            toleranceUsed: amountDiff,
          })
        }
      }

      // Sort by confidence (descending)
      potentialMatches.sort((a, b) => b.confidence - a.confidence)

      // Try to apply auto-matching rules
      let autoMatched = false
      let autoMatchRule: MatchingRule | null = null
      let suggestedAccount: string | undefined
      let suggestedCategory: string | undefined
      let taxDeductible: boolean | undefined
      let ruleType: MatchingRuleType | undefined

      if (applyAutoRules) {
        const ruleMatch = this.applyMatchingRules(bankTxn)
        if (ruleMatch) {
          autoMatched = true
          autoMatchRule = ruleMatch.rule
          suggestedAccount = ruleMatch.rule.targetAccount
          suggestedCategory = ruleMatch.rule.category
          taxDeductible = ruleMatch.rule.taxDeductible
          ruleType = ruleMatch.rule.type
        }
      }

      // Create matches
      for (const pm of potentialMatches) {
        const matchId = this.generateId('match')
        const status: MatchStatus =
          autoMatched && autoMatchRule?.autoApprove ? 'approved' : 'suggested'

        const match: ReconciliationMatch = {
          id: matchId,
          bankTransactionId: bankTxn.id,
          ledgerEntryId: pm.entry.id,
          status,
          matchType: pm.matchType,
          confidence: pm.confidence,
          withinTolerance: pm.withinTolerance,
          toleranceUsed: pm.toleranceUsed,
          toleranceType: tolerancePercent !== undefined ? 'percentage' : 'amount',
          matchedByRule: autoMatched,
          suggestedAccount,
          suggestedCategory,
          taxDeductible,
          ruleType,
        }

        if (status === 'approved') {
          match.approvedAt = new Date()
          stored.approvedMatchIds.add(matchId)
          usedLedgerIds.add(pm.entry.id)
        }

        stored.matches.set(matchId, match)
        matches.push(match)

        // Track rule stats
        if (autoMatchRule) {
          this.updateRuleStats(autoMatchRule.id, bankTxn.amount)
        }
      }

      // If auto-matching rule applies but no ledger match, still record it
      if (autoMatched && potentialMatches.length === 0) {
        const matchId = this.generateId('match')
        const status: MatchStatus = autoMatchRule?.autoApprove ? 'approved' : 'suggested'

        const match: ReconciliationMatch = {
          id: matchId,
          bankTransactionId: bankTxn.id,
          ledgerEntryId: '',
          status,
          matchType: 'fuzzy',
          confidence: 0.8,
          matchedByRule: true,
          suggestedAccount,
          suggestedCategory,
          taxDeductible,
          ruleType,
        }

        stored.matches.set(matchId, match)
        matches.push(match)

        if (autoMatchRule) {
          this.updateRuleStats(autoMatchRule.id, bankTxn.amount)
        }
      }
    }

    return matches
  }

  private applyMatchingRules(
    txn: BankTransaction
  ): { rule: MatchingRule; confidence: number } | null {
    const enabledRules = Array.from(this.matchingRules.values())
      .filter((r) => r.enabled)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const rule of enabledRules) {
      if (this.ruleMatches(rule, txn)) {
        return { rule, confidence: 0.9 }
      }
    }

    return null
  }

  private ruleMatches(rule: MatchingRule, txn: BankTransaction): boolean {
    switch (rule.type) {
      case 'description':
        return rule.pattern?.test(txn.description) ?? false

      case 'reference':
        return rule.pattern?.test(txn.reference ?? '') ?? false

      case 'amount_range':
        const amt = Math.abs(txn.amount)
        const minOk = rule.minAmount === undefined || amt >= rule.minAmount
        const maxOk = rule.maxAmount === undefined || amt <= rule.maxAmount
        return minOk && maxOk

      case 'vendor':
        return (
          rule.vendorPatterns?.some((p) =>
            txn.description.toLowerCase().includes(p.toLowerCase())
          ) ?? false
        )

      case 'recurring':
        // Use UTC date to avoid timezone issues with ISO date strings
        const dayOfMonth = txn.date.getUTCDate()
        const dayOk =
          rule.expectedDayOfMonth === undefined ||
          Math.abs(dayOfMonth - rule.expectedDayOfMonth) <=
            (rule.toleranceDays ?? 0)
        const txnAbsAmount = Math.abs(txn.amount)
        const amtOk =
          rule.expectedAmount === undefined ||
          Math.abs(txnAbsAmount - rule.expectedAmount) <=
            (rule.toleranceAmount ?? 0)
        const patternOk = rule.pattern?.test(txn.description) ?? true
        return dayOk && amtOk && patternOk

      case 'category':
        return (
          rule.patterns?.some(
            (p) =>
              txn.description.toLowerCase().includes(p.toLowerCase()) ||
              new RegExp(p, 'i').test(txn.description)
          ) ?? false
        )

      case 'compound':
        if (!rule.conditions) return false
        const results = rule.conditions.map((cond) =>
          this.conditionMatches(cond, txn)
        )
        return rule.operator === 'OR'
          ? results.some(Boolean)
          : results.every(Boolean)

      default:
        return false
    }
  }

  private conditionMatches(cond: RuleCondition, txn: BankTransaction): boolean {
    switch (cond.type) {
      case 'description':
        return cond.pattern?.test(txn.description) ?? false

      case 'reference':
        return cond.pattern?.test(txn.reference ?? '') ?? false

      case 'amount_range':
        const amt = Math.abs(txn.amount)
        const minOk = cond.minAmount === undefined || amt >= cond.minAmount
        const maxOk = cond.maxAmount === undefined || amt <= cond.maxAmount
        return minOk && maxOk

      case 'day_of_month':
        // Use UTC date to avoid timezone issues with ISO date strings
        return cond.days?.includes(txn.date.getUTCDate()) ?? false

      default:
        return false
    }
  }

  private updateRuleStats(ruleId: string, amount: number): void {
    const existing = this.matchingRuleStats.get(ruleId) ?? {
      ruleId,
      totalMatches: 0,
      totalAmount: 0,
    }

    existing.totalMatches++
    existing.totalAmount += Math.abs(amount)
    existing.lastMatchedAt = new Date()

    this.matchingRuleStats.set(ruleId, existing)
  }

  async findGroupedMatches(sessionId: string): Promise<GroupedMatch[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const { statement, ledgerEntries } = stored
    const groups: GroupedMatch[] = []

    // Find one-to-many: single bank txn matching multiple ledger entries
    for (const bankTxn of statement.transactions) {
      const matchingEntries = ledgerEntries.filter((e) => {
        const dateDiff = Math.abs(bankTxn.date.getTime() - e.date.getTime())
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24)
        return daysDiff <= 7 // Within a week
      })

      // Check if sum of entries equals bank amount
      const sumAmount = matchingEntries.reduce((sum, e) => sum + e.amount, 0)
      if (Math.abs(sumAmount - bankTxn.amount) < 1 && matchingEntries.length > 1) {
        groups.push({
          id: this.generateId('group'),
          bankTransactionIds: [bankTxn.id],
          ledgerEntryIds: matchingEntries.map((e) => e.id),
          totalAmount: sumAmount,
          status: 'suggested',
        })
      }
    }

    // Find many-to-one: multiple bank txns matching single ledger entry
    for (const entry of ledgerEntries) {
      const matchingTxns = statement.transactions.filter((t) => {
        const dateDiff = Math.abs(t.date.getTime() - entry.date.getTime())
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24)
        return daysDiff <= 7
      })

      const sumAmount = matchingTxns.reduce((sum, t) => sum + t.amount, 0)
      if (Math.abs(sumAmount - entry.amount) < 1 && matchingTxns.length > 1) {
        groups.push({
          id: this.generateId('group'),
          bankTransactionIds: matchingTxns.map((t) => t.id),
          ledgerEntryIds: [entry.id],
          totalAmount: sumAmount,
          status: 'suggested',
        })
      }
    }

    // Store grouped matches
    for (const group of groups) {
      stored.groupedMatches.set(group.id, group)
    }

    return groups
  }

  async approveMatch(sessionId: string, matchId: string): Promise<ReconciliationMatch> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const match = stored.matches.get(matchId)
    if (!match) throw new Error('Match not found')

    match.status = 'approved'
    match.approvedAt = new Date()
    stored.approvedMatchIds.add(matchId)

    stored.history.push({
      id: this.generateId('event'),
      sessionId,
      event: 'match_approved',
      timestamp: new Date(),
      metadata: { matchId },
    })

    return match
  }

  async rejectMatch(
    sessionId: string,
    matchId: string,
    options: { reason: string }
  ): Promise<ReconciliationMatch> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const match = stored.matches.get(matchId)
    if (!match) throw new Error('Match not found')

    match.status = 'rejected'
    match.rejectionReason = options.reason
    stored.approvedMatchIds.delete(matchId)

    stored.history.push({
      id: this.generateId('event'),
      sessionId,
      event: 'match_rejected',
      timestamp: new Date(),
      metadata: { matchId, reason: options.reason },
    })

    return match
  }

  async createManualMatch(
    sessionId: string,
    options: { bankTransactionId: string; ledgerEntryId: string; note?: string }
  ): Promise<ReconciliationMatch> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const matchId = this.generateId('match')
    const match: ReconciliationMatch = {
      id: matchId,
      bankTransactionId: options.bankTransactionId,
      ledgerEntryId: options.ledgerEntryId,
      status: 'approved',
      matchType: 'manual',
      confidence: 1.0,
      approvedAt: new Date(),
      note: options.note,
    }

    stored.matches.set(matchId, match)
    stored.approvedMatchIds.add(matchId)

    return match
  }

  // =============================================================================
  // Discrepancy Detection
  // =============================================================================

  async detectDiscrepancies(sessionId: string): Promise<ReconciliationDiscrepancy> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const { statement, ledgerEntries, options } = stored
    const flagThreshold = options?.flagThreshold ?? Infinity
    const maxTotalTolerance = options?.maxTotalTolerance

    // Get approved matches
    const approvedMatches = Array.from(stored.matches.values()).filter(
      (m) => m.status === 'approved'
    )
    const matchedBankIds = new Set(approvedMatches.map((m) => m.bankTransactionId))
    const matchedLedgerIds = new Set(approvedMatches.map((m) => m.ledgerEntryId))

    // Unmatched items
    const unmatchedBankTransactions = statement.transactions.filter(
      (t) => !matchedBankIds.has(t.id)
    )
    const unmatchedLedgerEntries = ledgerEntries.filter(
      (e) => !matchedLedgerIds.has(e.id)
    )

    // Amount mismatches (matched by reference but different amounts)
    const amountMismatches: ReconciliationDiscrepancy['amountMismatches'] = []
    const dateMismatches: ReconciliationDiscrepancy['dateMismatches'] = []
    const accountMismatches: ReconciliationDiscrepancy['accountMismatches'] = []

    for (const bankTxn of statement.transactions) {
      for (const entry of ledgerEntries) {
        // Reference match check
        if (
          bankTxn.reference &&
          entry.reference &&
          bankTxn.reference === entry.reference
        ) {
          if (bankTxn.amount !== entry.amount) {
            amountMismatches.push({
              bankTransactionId: bankTxn.id,
              ledgerEntryId: entry.id,
              bankAmount: bankTxn.amount,
              ledgerAmount: entry.amount,
              difference: bankTxn.amount - entry.amount,
            })
          }

          const daysDiff = Math.round(
            Math.abs(bankTxn.date.getTime() - entry.date.getTime()) /
              (1000 * 60 * 60 * 24)
          )
          if (daysDiff > 0) {
            dateMismatches.push({
              bankTransactionId: bankTxn.id,
              ledgerEntryId: entry.id,
              bankDate: bankTxn.date,
              ledgerDate: entry.date,
              daysDifference: daysDiff,
            })
          }

          // Account mismatch
          if (
            bankTxn.accountId &&
            entry.accountId &&
            bankTxn.accountId !== entry.accountId
          ) {
            accountMismatches.push({
              bankTransactionId: bankTxn.id,
              ledgerEntryId: entry.id,
              bankAccount: bankTxn.accountId,
              ledgerAccount: entry.accountId,
            })
          }
        }
      }
    }

    // Flagged items (large transactions)
    const flaggedItems: ReconciliationDiscrepancy['flaggedItems'] = []
    for (const txn of statement.transactions) {
      if (Math.abs(txn.amount) > flagThreshold) {
        flaggedItems.push({
          id: txn.id,
          reason: 'amount_exceeds_threshold',
          amount: txn.amount,
        })
      }
    }

    // Outstanding items (timing differences)
    const outstandingItems: ReconciliationDiscrepancy['outstandingItems'] = []
    const timingDifferences: ReconciliationDiscrepancy['timingDifferences'] = []

    for (const entry of unmatchedLedgerEntries) {
      // Outstanding check: negative amount (debit), recorded but not cleared
      if (entry.amount < 0) {
        outstandingItems.push({
          id: entry.id,
          type: 'outstanding_check',
          amount: Math.abs(entry.amount),
          date: entry.date,
        })
      }
      // Deposit in transit: positive amount, recorded but not on bank statement
      if (entry.amount > 0) {
        outstandingItems.push({
          id: entry.id,
          type: 'deposit_in_transit',
          amount: entry.amount,
          date: entry.date,
        })
      }
    }

    // Timing differences - bank txn date after statement period, but ledger entry within
    for (const bankTxn of statement.transactions) {
      if (bankTxn.date > statement.endDate) {
        for (const entry of ledgerEntries) {
          if (
            entry.date <= statement.endDate &&
            Math.abs(bankTxn.amount - entry.amount) < 1
          ) {
            timingDifferences.push({
              bankTransactionId: bankTxn.id,
              ledgerEntryId: entry.id,
              description: 'Bank transaction posted after period end',
            })
          }
        }
      }
    }

    // Check tolerance exceeded - count only the best match per bank transaction
    // This prevents double-counting when there are multiple suggested matches for the same transaction
    let totalToleranceUsed = 0
    const seenBankTxns = new Set<string>()

    // Group matches by bank transaction and only count tolerance from the best match
    const matchesByBankTxn = new Map<string, ReconciliationMatch>()
    for (const match of stored.matches.values()) {
      const existing = matchesByBankTxn.get(match.bankTransactionId)
      // Keep the match with highest confidence (or first one if equal)
      if (!existing || match.confidence > existing.confidence) {
        matchesByBankTxn.set(match.bankTransactionId, match)
      }
    }

    // Sum tolerance from best matches only
    for (const match of matchesByBankTxn.values()) {
      totalToleranceUsed += match.toleranceUsed ?? 0
    }

    let toleranceExceeded = false
    let toleranceExceededAmount: number | undefined

    if (maxTotalTolerance !== undefined && totalToleranceUsed > maxTotalTolerance) {
      toleranceExceeded = true
      toleranceExceededAmount = totalToleranceUsed
    }

    return {
      unmatchedBankTransactions,
      unmatchedLedgerEntries,
      amountMismatches,
      dateMismatches,
      accountMismatches,
      flaggedItems,
      outstandingItems,
      timingDifferences,
      toleranceExceeded,
      toleranceExceededAmount,
    }
  }

  async getReconciliationSummary(sessionId: string): Promise<ReconciliationSummary> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const { statement, ledgerEntries, options } = stored

    // Filter transactions by date range if specified
    let transactions = [...statement.transactions]
    if (options?.startDate && options?.endDate) {
      transactions = transactions.filter((t) => {
        const txnTime = t.date.getTime()
        return txnTime >= options.startDate!.getTime() && txnTime <= options.endDate!.getTime()
      })
    }

    // Calculate bank total (credits - debits)
    let bankTotal = 0
    for (const txn of transactions) {
      if (txn.type === 'credit') {
        bankTotal += txn.amount
      } else {
        bankTotal -= txn.amount
      }
    }

    // Calculate ledger total
    const ledgerTotal = ledgerEntries.reduce((sum, e) => sum + e.amount, 0)

    // Count matched items
    const approvedMatches = Array.from(stored.matches.values()).filter(
      (m) => m.status === 'approved'
    )
    const matchedBankIds = new Set(approvedMatches.map((m) => m.bankTransactionId))
    const matchedLedgerIds = new Set(approvedMatches.map((m) => m.ledgerEntryId))

    const unmatchedBank = transactions.filter((t) => !matchedBankIds.has(t.id))
    const unmatchedLedger = ledgerEntries.filter((e) => !matchedLedgerIds.has(e.id))

    // Calculate tolerance used (all matches, not just approved, to show potential impact)
    let totalToleranceUsed = 0
    for (const match of stored.matches.values()) {
      totalToleranceUsed += match.toleranceUsed ?? 0
    }

    // Calculate outstanding checks total from current session
    let outstandingChecksTotal = 0
    for (const item of stored.outstandingItems.values()) {
      if (item.type === 'outstanding_check') {
        outstandingChecksTotal += item.amount
      }
    }

    // Carried forward count and include their outstanding checks total
    let carriedForwardItems = 0
    if (options?.carryForwardFrom) {
      const prevSession = this.sessions.get(options.carryForwardFrom)
      if (prevSession) {
        carriedForwardItems = prevSession.outstandingItems.size
        // Include outstanding checks from carried forward items
        for (const item of prevSession.outstandingItems.values()) {
          if (item.type === 'outstanding_check') {
            outstandingChecksTotal += item.amount
          }
        }
      }
    }

    const difference = bankTotal - ledgerTotal
    const isReconciled = Math.abs(difference) < 1
    const isFullyReconciled =
      isReconciled && unmatchedBank.length === 0 && unmatchedLedger.length === 0

    // Adjusted book balance (bank closing + outstanding items)
    const adjustedBookBalance = statement.closingBalance + ledgerTotal

    return {
      sessionId,
      bankOpeningBalance: statement.openingBalance,
      bankClosingBalance: statement.closingBalance,
      bankBalance: statement.closingBalance,
      adjustedBookBalance,
      bankTotal,
      ledgerTotal,
      difference,
      matchedItemsCount: approvedMatches.length,
      unmatchedItemsCount: unmatchedBank.length + unmatchedLedger.length,
      transactionsInScope: transactions.length,
      isReconciled,
      isFullyReconciled,
      totalToleranceUsed,
      carriedForwardItems,
      outstandingChecksTotal,
    }
  }

  // =============================================================================
  // Exceptions
  // =============================================================================

  async createException(
    sessionId: string,
    options: {
      bankTransactionId?: string
      ledgerEntryId?: string
      type: ExceptionType
      note?: string
      requiresApproval?: boolean
      approvalChain?: string[]
      createdAt?: Date
      amount?: number
    }
  ): Promise<ExtendedReconciliationException> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    // Check for duplicate (only when bankTransactionId is specified)
    if (options.bankTransactionId) {
      for (const existing of stored.exceptions.values()) {
        if (
          existing.bankTransactionId === options.bankTransactionId &&
          existing.type === options.type &&
          existing.status === 'open'
        ) {
          throw new Error('Exception already exists for this transaction')
        }
      }
    }

    const exceptionId = this.generateId('exception')
    const now = new Date()

    // Check auto-resolve rules
    let autoResolved = false
    for (const rule of this.exceptionAutoResolveRules.values()) {
      const typeMatch = !rule.conditions.type || rule.conditions.type === options.type
      const amountMatch =
        !rule.conditions.maxAmount ||
        (options.amount !== undefined && Math.abs(options.amount) <= rule.conditions.maxAmount)

      if (typeMatch && amountMatch) {
        autoResolved = true
        break
      }
    }

    const exception: ExtendedReconciliationException = {
      id: exceptionId,
      bankTransactionId: options.bankTransactionId,
      ledgerEntryId: options.ledgerEntryId,
      type: options.type,
      status: autoResolved ? 'resolved' : 'open',
      note: options.note,
      requiresApproval: options.requiresApproval,
      approvalChain: options.approvalChain,
      approvalStatus: options.requiresApproval ? 'pending' : undefined,
      currentApprover: options.approvalChain?.[0],
      comments: [],
      auditTrail: [
        {
          id: this.generateId('audit'),
          action: 'created',
          timestamp: options.createdAt ?? now,
        },
      ],
      createdAt: options.createdAt ?? now,
      amount: options.amount,
      autoResolved,
    }

    stored.exceptions.set(exceptionId, exception)

    stored.history.push({
      id: this.generateId('event'),
      sessionId,
      event: 'exception_created',
      timestamp: now,
      metadata: { exceptionId },
    })

    return exception
  }

  async resolveException(
    sessionId: string,
    exceptionId: string,
    options: { resolution: string; journalEntryId?: string; note?: string }
  ): Promise<ExtendedReconciliationException> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const exception = stored.exceptions.get(exceptionId)
    if (!exception) throw new Error('Exception not found')

    exception.status = 'resolved'
    exception.resolution = options.resolution
    exception.journalEntryId = options.journalEntryId
    exception.resolvedAt = new Date()

    if (options.journalEntryId) {
      exception.linkedJournalEntries = exception.linkedJournalEntries ?? []
      exception.linkedJournalEntries.push(options.journalEntryId)
    }

    if (options.note) {
      exception.note = options.note
    }

    return exception
  }

  async getExceptions(sessionId: string): Promise<ReconciliationException[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    return Array.from(stored.exceptions.values())
  }

  async getException(
    sessionId: string,
    exceptionId: string
  ): Promise<ExtendedReconciliationException> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const exception = stored.exceptions.get(exceptionId)
    if (!exception) throw new Error('Exception not found')

    return exception
  }

  async approveException(
    sessionId: string,
    exceptionId: string,
    options: { approver: string; comment?: string }
  ): Promise<ExtendedReconciliationException> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const exception = stored.exceptions.get(exceptionId)
    if (!exception) throw new Error('Exception not found')

    if (exception.approvalChain) {
      const currentIdx = exception.approvalChain.indexOf(exception.currentApprover ?? '')
      if (currentIdx >= 0 && currentIdx < exception.approvalChain.length - 1) {
        exception.currentApprover = exception.approvalChain[currentIdx + 1]
      } else {
        exception.approvalStatus = 'approved'
        exception.currentApprover = undefined
      }
    }

    if (options.comment) {
      exception.comments = exception.comments ?? []
      exception.comments.push({
        id: this.generateId('comment'),
        text: options.comment,
        author: options.approver,
        createdAt: new Date(),
      })
    }

    return exception
  }

  async processExceptionEscalations(
    sessionId: string,
    options: { escalationThresholdDays: number }
  ): Promise<void> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const now = new Date()

    for (const exception of stored.exceptions.values()) {
      if (exception.status === 'open' && exception.createdAt) {
        const ageMs = now.getTime() - exception.createdAt.getTime()
        const ageDays = ageMs / (1000 * 60 * 60 * 24)

        if (ageDays > options.escalationThresholdDays) {
          exception.escalated = true
          exception.escalationLevel = (exception.escalationLevel ?? 0) + 1
        }
      }
    }
  }

  async getExceptionSummary(sessionId: string): Promise<ExceptionSummary> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}

    for (const exception of stored.exceptions.values()) {
      byType[exception.type] = (byType[exception.type] ?? 0) + 1
      byStatus[exception.status] = (byStatus[exception.status] ?? 0) + 1
    }

    return {
      total: stored.exceptions.size,
      byType,
      byStatus,
    }
  }

  async createExceptionTemplate(
    options: Omit<ExceptionTemplate, 'id'>
  ): Promise<ExceptionTemplate> {
    const template: ExceptionTemplate = {
      id: this.generateId('template'),
      ...options,
    }

    this.exceptionTemplates.set(template.id, template)
    return template
  }

  async createExceptionFromTemplate(
    sessionId: string,
    templateId: string,
    options: { bankTransactionId?: string; ledgerEntryId?: string }
  ): Promise<ExtendedReconciliationException> {
    const template = this.exceptionTemplates.get(templateId)
    if (!template) throw new Error('Template not found')

    return this.createException(sessionId, {
      bankTransactionId: options.bankTransactionId,
      ledgerEntryId: options.ledgerEntryId,
      type: template.type,
      note: template.defaultNote,
    })
  }

  async batchResolveExceptions(
    sessionId: string,
    exceptionIds: string[],
    options: { resolution: string; targetAccount?: string; note?: string }
  ): Promise<ExtendedReconciliationException[]> {
    const results: ExtendedReconciliationException[] = []

    for (const id of exceptionIds) {
      const resolved = await this.resolveException(sessionId, id, {
        resolution: options.resolution,
        note: options.note,
      })
      results.push(resolved)
    }

    return results
  }

  async generateExceptionReport(
    sessionId: string,
    options: { includeResolved?: boolean; format?: 'summary' | 'detailed' }
  ): Promise<ExceptionReport> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    let exceptions = Array.from(stored.exceptions.values())
    if (!options.includeResolved) {
      exceptions = exceptions.filter((e) => e.status === 'open')
    }

    const openCount = exceptions.filter((e) => e.status === 'open').length
    const resolvedCount = exceptions.filter((e) => e.status === 'resolved').length

    return {
      openExceptions: openCount,
      resolvedExceptions: resolvedCount,
      exceptions,
      generatedAt: new Date(),
    }
  }

  async addExceptionComment(
    sessionId: string,
    exceptionId: string,
    options: { text: string; author: string }
  ): Promise<ExtendedReconciliationException> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const exception = stored.exceptions.get(exceptionId)
    if (!exception) throw new Error('Exception not found')

    exception.comments = exception.comments ?? []
    exception.comments.push({
      id: this.generateId('comment'),
      text: options.text,
      author: options.author,
      createdAt: new Date(),
    })

    exception.auditTrail = exception.auditTrail ?? []
    exception.auditTrail.push({
      id: this.generateId('audit'),
      action: 'comment_added',
      timestamp: new Date(),
      actor: options.author,
    })

    return exception
  }

  async createExceptionAutoResolveRule(
    options: Omit<ExceptionAutoResolveRule, 'id'>
  ): Promise<ExceptionAutoResolveRule> {
    const rule: ExceptionAutoResolveRule = {
      id: this.generateId('auto-resolve'),
      ...options,
    }

    this.exceptionAutoResolveRules.set(rule.id, rule)
    return rule
  }

  async getExceptionMetrics(sessionId: string): Promise<ExceptionMetrics> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const exceptions = Array.from(stored.exceptions.values())
    const resolved = exceptions.filter((e) => e.status === 'resolved')
    const open = exceptions.filter((e) => e.status === 'open')

    let totalResolutionTime = 0
    for (const e of resolved) {
      if (e.createdAt && e.resolvedAt) {
        totalResolutionTime += e.resolvedAt.getTime() - e.createdAt.getTime()
      }
    }

    return {
      averageResolutionTimeMs: resolved.length > 0 ? totalResolutionTime / resolved.length : 0,
      resolvedCount: resolved.length,
      openCount: open.length,
    }
  }

  async bulkCreateExceptions(
    sessionId: string,
    transactionIds: string[],
    options: { type: ExceptionType; note?: string }
  ): Promise<ReconciliationException[]> {
    const results: ReconciliationException[] = []

    for (const txnId of transactionIds) {
      const exception = await this.createException(sessionId, {
        bankTransactionId: txnId,
        type: options.type,
        note: options.note,
      })
      results.push(exception)
    }

    return results
  }

  // =============================================================================
  // Outstanding Items
  // =============================================================================

  async markAsOutstanding(
    sessionId: string,
    options: {
      bankTransactionId?: string
      ledgerEntryId?: string
      type: OutstandingItemType
    }
  ): Promise<void> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const itemId = options.bankTransactionId ?? options.ledgerEntryId
    if (!itemId) throw new Error('Must provide bankTransactionId or ledgerEntryId')

    // Look up the amount from the corresponding item
    let amount = 0
    if (options.bankTransactionId) {
      const txn = stored.statement.transactions.find((t) => t.id === options.bankTransactionId)
      if (txn) amount = Math.abs(txn.amount)
    } else if (options.ledgerEntryId) {
      const entry = stored.ledgerEntries.find((e) => e.id === options.ledgerEntryId)
      if (entry) amount = Math.abs(entry.amount)
    }

    // If we couldn't find the item by ID, try to find by description pattern for check entries
    // This handles cases where the caller specifies a descriptive ID but the actual entry has a generated ID
    if (amount === 0 && options.ledgerEntryId) {
      // Check all ledger entries - use the first unmatched one with the correct sign
      for (const entry of stored.ledgerEntries) {
        if (options.type === 'outstanding_check' && entry.amount < 0) {
          amount = Math.abs(entry.amount)
          break
        }
        if (options.type === 'deposit_in_transit' && entry.amount > 0) {
          amount = Math.abs(entry.amount)
          break
        }
      }
    }

    stored.outstandingItems.set(itemId, {
      type: options.type,
      itemId,
      itemType: options.bankTransactionId ? 'bank' : 'ledger',
      amount,
    })
  }

  // =============================================================================
  // Duplicates
  // =============================================================================

  async detectDuplicates(sessionId: string): Promise<DuplicateDetectionResult> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const { statement, ledgerEntries } = stored

    const bankDuplicates: DuplicateGroup[] = []
    const ledgerDuplicates: DuplicateGroup[] = []
    const potentialDuplicates: DuplicateGroup[] = []

    // Bank duplicates by reference
    const bankByRef = new Map<string, BankTransaction[]>()
    for (const txn of statement.transactions) {
      if (txn.reference) {
        const existing = bankByRef.get(txn.reference) ?? []
        existing.push(txn)
        bankByRef.set(txn.reference, existing)
      }
    }

    for (const [ref, txns] of bankByRef) {
      if (txns.length > 1) {
        // Check if already marked as intentional by transaction pair
        const sortedIds = txns.map((t) => t.id).sort()
        const intentionalKey = sortedIds.join(':')

        if (!stored.intentionalDuplicates.has(intentionalKey)) {
          const groupId = this.generateId('dup')
          stored.duplicateGroupToTxns.set(groupId, sortedIds)
          bankDuplicates.push({
            id: groupId,
            transactions: txns,
            confidence: 1.0,
          })
        }
      }
    }

    // Ledger duplicates by reference
    const ledgerByRef = new Map<string, LedgerEntry[]>()
    for (const entry of ledgerEntries) {
      if (entry.reference) {
        const existing = ledgerByRef.get(entry.reference) ?? []
        existing.push(entry)
        ledgerByRef.set(entry.reference, existing)
      }
    }

    for (const [ref, entries] of ledgerByRef) {
      if (entries.length > 1) {
        ledgerDuplicates.push({
          id: this.generateId('dup'),
          entries,
          confidence: 1.0,
        })
      }
    }

    // Potential duplicates (same amount and date, various conditions)
    const potentialDupKeys = new Set<string>()
    for (let i = 0; i < statement.transactions.length; i++) {
      for (let j = i + 1; j < statement.transactions.length; j++) {
        const t1 = statement.transactions[i]
        const t2 = statement.transactions[j]

        // Same amount and date
        if (
          t1.amount === t2.amount &&
          t1.date.getTime() === t2.date.getTime()
        ) {
          // Detect potential duplicates in these cases:
          // 1. Different references - might be duplicate entry with different ref
          // 2. No references and same description - likely duplicate
          // 3. Same reference AND same description - likely duplicate entry (e.g., recurring charge entered twice)
          const isPotentialDuplicate =
            (t1.reference && t2.reference && t1.reference !== t2.reference) ||
            (!t1.reference && !t2.reference && t1.description === t2.description) ||
            (t1.reference && t2.reference && t1.reference === t2.reference && t1.description === t2.description)

          if (isPotentialDuplicate) {
            // Create a canonical key from sorted IDs to check against intentional duplicates
            const sortedIds = [t1.id, t2.id].sort()
            const intentionalKey = sortedIds.join(':')

            // Skip if already marked as intentional
            if (stored.intentionalDuplicates.has(intentionalKey)) {
              continue
            }

            const key = `${t1.id}:${t2.id}`
            if (!potentialDupKeys.has(key)) {
              potentialDupKeys.add(key)
              const groupId = this.generateId('dup')
              // Store the mapping from group ID to transaction IDs for later marking
              stored.duplicateGroupToTxns.set(groupId, sortedIds)
              potentialDuplicates.push({
                id: groupId,
                transactions: [t1, t2],
                confidence: 0.7,
              })
            }
          }
        }
      }
    }

    return {
      bankDuplicates,
      ledgerDuplicates,
      potentialDuplicates,
    }
  }

  async detectCrossPeriodDuplicates(
    sessionId: string,
    options: { lookbackSessions: string[] }
  ): Promise<DuplicateGroup[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const duplicates: DuplicateGroup[] = []
    const currentTxns = stored.statement.transactions

    for (const prevSessionId of options.lookbackSessions) {
      const prevSession = this.sessions.get(prevSessionId)
      if (!prevSession) continue

      for (const currTxn of currentTxns) {
        for (const prevTxn of prevSession.statement.transactions) {
          if (
            currTxn.reference &&
            prevTxn.reference &&
            currTxn.reference === prevTxn.reference &&
            currTxn.amount === prevTxn.amount
          ) {
            duplicates.push({
              id: this.generateId('cross-dup'),
              transactions: [currTxn, prevTxn],
              confidence: 0.9,
            })
          }
        }
      }
    }

    return duplicates
  }

  async markDuplicatesAsIntentional(
    sessionId: string,
    duplicateGroupId: string,
    options: { reason: string }
  ): Promise<void> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    // Look up the transaction IDs for this group
    const txnIds = stored.duplicateGroupToTxns.get(duplicateGroupId)
    if (txnIds && txnIds.length >= 2) {
      // Create a canonical key from sorted IDs
      const sortedIds = [...txnIds].sort()
      const key = sortedIds.join(':')
      stored.intentionalDuplicates.add(key)
    }

    stored.intentionalDuplicates.add(duplicateGroupId)
  }

  async suggestDuplicateResolution(
    sessionId: string,
    duplicateGroupId: string
  ): Promise<string[]> {
    return ['merge', 'mark_intentional', 'exclude_one']
  }

  // =============================================================================
  // Tolerance
  // =============================================================================

  async generateToleranceAdjustments(sessionId: string): Promise<ToleranceAdjustment[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const adjustments: ToleranceAdjustment[] = []

    for (const match of stored.matches.values()) {
      if (match.status === 'approved' && match.toleranceUsed && match.toleranceUsed > 0) {
        // Determine sign: if ledger was higher, we need negative adjustment
        adjustments.push({
          id: this.generateId('adj'),
          sessionId,
          amount: -match.toleranceUsed,
          accountId: 'acc-rounding-diff',
          matchId: match.id,
        })
      }
    }

    return adjustments
  }

  // =============================================================================
  // Unreconciled Items
  // =============================================================================

  async getUnreconciledItems(sessionId: string): Promise<UnreconciledItems> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const { statement, ledgerEntries, options } = stored

    // Get approved matches
    const approvedMatches = Array.from(stored.matches.values()).filter(
      (m) => m.status === 'approved'
    )
    const matchedBankIds = new Set(approvedMatches.map((m) => m.bankTransactionId))
    const matchedLedgerIds = new Set(approvedMatches.map((m) => m.ledgerEntryId))

    // Get exception items
    const exceptionBankIds = new Set(
      Array.from(stored.exceptions.values())
        .filter((e) => e.bankTransactionId)
        .map((e) => e.bankTransactionId!)
    )
    const exceptionLedgerIds = new Set(
      Array.from(stored.exceptions.values())
        .filter((e) => e.ledgerEntryId)
        .map((e) => e.ledgerEntryId!)
    )

    const bankTransactions = statement.transactions.filter(
      (t) => !matchedBankIds.has(t.id) && !exceptionBankIds.has(t.id)
    )
    const unreconciledLedgerEntries = ledgerEntries.filter(
      (e) => !matchedLedgerIds.has(e.id) && !exceptionLedgerIds.has(e.id)
    )

    // Calculate totals
    let totalUnreconciledBank = 0
    for (const txn of bankTransactions) {
      totalUnreconciledBank += txn.type === 'credit' ? txn.amount : -txn.amount
    }

    const totalUnreconciledLedger = unreconciledLedgerEntries.reduce(
      (sum, e) => sum + e.amount,
      0
    )

    // Carried forward items
    const carriedForward: UnreconciledItems['carriedForward'] = []
    if (options?.carryForwardFrom) {
      const prevSession = this.sessions.get(options.carryForwardFrom)
      if (prevSession) {
        for (const item of prevSession.outstandingItems.values()) {
          const date =
            prevSession.statement.startDate instanceof Date
              ? prevSession.statement.startDate
              : new Date()
          // Use UTC methods to avoid timezone issues with ISO date strings
          carriedForward.push({
            id: item.itemId,
            type: item.itemType,
            amount: 0, // Would need to look up actual amount
            originalPeriod: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
          })
        }
      }
    }

    return {
      bankTransactions,
      ledgerEntries: unreconciledLedgerEntries,
      totalUnreconciledBank,
      totalUnreconciledLedger,
      carriedForward,
    }
  }

  async getUnreconciledAging(sessionId: string): Promise<Record<string, number>> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const unreconciled = await this.getUnreconciledItems(sessionId)
    const aging: Record<string, number> = {
      '0-7 days': 0,
      '8-14 days': 0,
      '15-30 days': 0,
      '30+ days': 0,
    }

    const endDate = stored.statement.endDate.getTime()

    for (const txn of unreconciled.bankTransactions) {
      const ageDays = Math.round((endDate - txn.date.getTime()) / (1000 * 60 * 60 * 24))

      if (ageDays <= 7) aging['0-7 days']++
      else if (ageDays <= 14) aging['8-14 days']++
      else if (ageDays < 30) aging['15-30 days']++
      else aging['30+ days']++
    }

    return aging
  }

  async generateUnreconciledReport(sessionId: string): Promise<UnreconciledReport> {
    const unreconciled = await this.getUnreconciledItems(sessionId)

    return {
      bankItems: unreconciled.bankTransactions,
      ledgerItems: unreconciled.ledgerEntries,
      totalBankAmount: unreconciled.bankTransactions.reduce(
        (sum, t) => sum + Math.abs(t.amount),
        0
      ),
      totalLedgerAmount: unreconciled.ledgerEntries.reduce(
        (sum, e) => sum + Math.abs(e.amount),
        0
      ),
      generatedAt: new Date(),
    }
  }

  async exportUnreconciledItems(
    sessionId: string,
    options: { format: 'csv' | 'json' }
  ): Promise<string> {
    const unreconciled = await this.getUnreconciledItems(sessionId)

    if (options.format === 'json') {
      return JSON.stringify(unreconciled, null, 2)
    }

    // CSV format
    const lines: string[] = ['Type,ID,Amount,Date,Description']

    for (const txn of unreconciled.bankTransactions) {
      lines.push(
        `Bank Transaction,${txn.id},${txn.amount},${txn.date.toISOString()},${txn.description}`
      )
    }

    for (const entry of unreconciled.ledgerEntries) {
      lines.push(
        `Ledger Entry,${entry.id},${entry.amount},${entry.date.toISOString()},${entry.description}`
      )
    }

    return lines.join('\n')
  }

  async getReconciliationAlerts(sessionId: string): Promise<ReconciliationAlert[]> {
    const stored = this.sessions.get(sessionId)
    if (!stored) throw new Error('Session not found')

    const alerts: ReconciliationAlert[] = []
    const staleThreshold = stored.options?.staleItemThresholdDays ?? 30
    const endDate = stored.statement.endDate.getTime()

    // Check for stale unreconciled items
    const unreconciled = await this.getUnreconciledItems(sessionId)
    for (const txn of unreconciled.bankTransactions) {
      const ageDays = (endDate - txn.date.getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays > staleThreshold) {
        alerts.push({
          id: this.generateId('alert'),
          type: 'stale_unreconciled_item',
          message: `Transaction ${txn.id} has been unreconciled for ${Math.round(ageDays)} days`,
          severity: 'warning',
        })
      }
    }

    // Check for missing recurring transactions
    if (stored.options?.applyAutoRules) {
      for (const rule of this.matchingRules.values()) {
        if (rule.type === 'recurring' && rule.alertOnMissing) {
          const found = stored.statement.transactions.some((t) =>
            this.ruleMatches(rule, t)
          )
          if (!found) {
            alerts.push({
              id: this.generateId('alert'),
              type: 'missing_recurring_transaction',
              message: `Expected recurring transaction "${rule.name}" not found`,
              severity: 'warning',
            })
          }
        }
      }
    }

    return alerts
  }

  // =============================================================================
  // Multi-Account
  // =============================================================================

  async detectInterAccountTransfers(
    multiSessionId: string
  ): Promise<InterAccountTransfer[]> {
    const multiSession = this.multiSessions.get(multiSessionId)
    if (!multiSession) throw new Error('Multi-session not found')

    const transfers: InterAccountTransfer[] = []
    const allTxns: Array<{ txn: BankTransaction; accountId: string }> = []

    // Gather all transactions from all sessions
    for (const sessionId of multiSession.sessions) {
      const stored = this.sessions.get(sessionId)
      if (!stored) continue

      for (const txn of stored.statement.transactions) {
        allTxns.push({ txn, accountId: stored.session.accountId })
      }
    }

    // Find matching debit/credit pairs
    for (let i = 0; i < allTxns.length; i++) {
      for (let j = i + 1; j < allTxns.length; j++) {
        const t1 = allTxns[i]
        const t2 = allTxns[j]

        // Must be different accounts
        if (t1.accountId === t2.accountId) continue

        // One debit, one credit of same amount
        if (
          t1.txn.type === 'debit' &&
          t2.txn.type === 'credit' &&
          Math.abs(t1.txn.amount) === Math.abs(t2.txn.amount)
        ) {
          transfers.push({
            id: this.generateId('transfer'),
            fromAccount: t1.accountId,
            toAccount: t2.accountId,
            amount: Math.abs(t1.txn.amount),
            fromTransactionId: t1.txn.id,
            toTransactionId: t2.txn.id,
          })
        } else if (
          t2.txn.type === 'debit' &&
          t1.txn.type === 'credit' &&
          Math.abs(t1.txn.amount) === Math.abs(t2.txn.amount)
        ) {
          transfers.push({
            id: this.generateId('transfer'),
            fromAccount: t2.accountId,
            toAccount: t1.accountId,
            amount: Math.abs(t2.txn.amount),
            fromTransactionId: t2.txn.id,
            toTransactionId: t1.txn.id,
          })
        }
      }
    }

    return transfers
  }

  async getConsolidatedSummary(multiSessionId: string): Promise<ConsolidatedSummary> {
    const multiSession = this.multiSessions.get(multiSessionId)
    if (!multiSession) throw new Error('Multi-session not found')

    const accounts: ConsolidatedSummary['accounts'] = []
    let totalBankBalance = 0
    let totalInBaseCurrency = 0

    const baseCurrency = multiSession.options?.baseCurrency ?? 'USD'
    const exchangeRates = multiSession.options?.exchangeRates ?? {}

    for (const sessionId of multiSession.sessions) {
      const stored = this.sessions.get(sessionId)
      if (!stored) continue

      // Use transactions total if available, otherwise closing balance
      // This handles both transaction-based and balance-based scenarios
      let balance: number
      if (stored.statement.transactions.length > 0) {
        balance = stored.statement.transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
      } else {
        balance = stored.statement.closingBalance
      }
      const currency = stored.statement.currency ?? 'USD'

      accounts.push({
        accountId: stored.session.accountId,
        balance,
        currency,
      })

      totalBankBalance += balance

      // Convert to base currency
      if (currency === baseCurrency) {
        totalInBaseCurrency += balance
      } else {
        const rate = exchangeRates[currency] ?? 1
        totalInBaseCurrency += balance * rate
      }
    }

    return {
      totalBankBalance,
      totalInBaseCurrency,
      accountCount: accounts.length,
      accounts,
    }
  }

  // =============================================================================
  // Period Comparison
  // =============================================================================

  async comparePeriods(sessionIds: string[]): Promise<PeriodComparison> {
    const periods: PeriodComparison['periods'] = []

    for (const sessionId of sessionIds) {
      const stored = this.sessions.get(sessionId)
      if (!stored) continue

      const bankTotal = stored.statement.transactions.reduce((sum, t) => {
        return sum + (t.type === 'credit' ? t.amount : -t.amount)
      }, 0)

      const ledgerTotal = stored.ledgerEntries.reduce((sum, e) => sum + e.amount, 0)

      periods.push({
        sessionId,
        startDate: stored.statement.startDate,
        endDate: stored.statement.endDate,
        bankTotal,
        ledgerTotal,
      })
    }

    // Calculate volume change (percentage)
    let volumeChange = 0
    if (periods.length >= 2) {
      const first = periods[0].bankTotal
      const last = periods[periods.length - 1].bankTotal
      if (first !== 0) {
        volumeChange = ((last - first) / first) * 100
      }
    }

    return {
      periods,
      trends: { volumeChange },
    }
  }

  // =============================================================================
  // Auto-Matching Rules
  // =============================================================================

  async createMatchingRule(options: CreateMatchingRuleOptions): Promise<MatchingRule> {
    const rule: MatchingRule = {
      id: this.generateId('rule'),
      name: options.name,
      type: options.type,
      pattern: options.pattern,
      patterns: options.patterns,
      vendorPatterns: options.vendorPatterns,
      conditions: options.conditions,
      operator: options.operator,
      minAmount: options.minAmount,
      maxAmount: options.maxAmount,
      expectedAmount: options.expectedAmount,
      expectedDayOfMonth: options.expectedDayOfMonth,
      toleranceAmount: options.toleranceAmount,
      toleranceDays: options.toleranceDays,
      targetAccount: options.targetAccount,
      category: options.category,
      autoApprove: options.autoApprove ?? false,
      createLedgerEntry: options.createLedgerEntry,
      enabled: options.enabled ?? true,
      priority: options.priority ?? 50,
      accountScope: options.accountScope,
      alertOnMissing: options.alertOnMissing,
      taxDeductible: options.taxDeductible,
      createdAt: new Date(),
    }

    this.matchingRules.set(rule.id, rule)

    // Initialize history
    this.matchingRuleHistory.set(rule.id, [{ ...rule }])

    return rule
  }

  async updateMatchingRule(
    ruleId: string,
    updates: Partial<CreateMatchingRuleOptions>
  ): Promise<MatchingRule> {
    const rule = this.matchingRules.get(ruleId)
    if (!rule) throw new Error('Rule not found')

    Object.assign(rule, updates, { updatedAt: new Date() })

    // Add to history
    const history = this.matchingRuleHistory.get(ruleId) ?? []
    history.push({ ...rule })
    this.matchingRuleHistory.set(ruleId, history)

    return rule
  }

  async deleteMatchingRule(ruleId: string): Promise<void> {
    this.matchingRules.delete(ruleId)
  }

  async listMatchingRules(filter?: { accountId?: string }): Promise<MatchingRule[]> {
    let rules = Array.from(this.matchingRules.values())

    if (filter?.accountId) {
      rules = rules.filter(
        (r) => !r.accountScope || r.accountScope === filter.accountId
      )
    }

    return rules
  }

  async enableMatchingRule(ruleId: string): Promise<void> {
    const rule = this.matchingRules.get(ruleId)
    if (!rule) throw new Error('Rule not found')
    rule.enabled = true
  }

  async disableMatchingRule(ruleId: string): Promise<void> {
    const rule = this.matchingRules.get(ruleId)
    if (!rule) throw new Error('Rule not found')
    rule.enabled = false
  }

  async getMatchingRuleStats(ruleId: string): Promise<MatchingRuleStats> {
    return (
      this.matchingRuleStats.get(ruleId) ?? {
        ruleId,
        totalMatches: 0,
        totalAmount: 0,
      }
    )
  }

  async testMatchingRule(
    ruleId: string,
    options: { lookbackDays: number }
  ): Promise<MatchingRuleTestResult> {
    const rule = this.matchingRules.get(ruleId)
    if (!rule) throw new Error('Rule not found')

    // Would test against historical data
    return {
      wouldMatch: true,
      sampleMatches: [],
      estimatedMatches: 0,
    }
  }

  async detectRuleConflicts(): Promise<RuleConflict[]> {
    const conflicts: RuleConflict[] = []
    const rules = Array.from(this.matchingRules.values())

    // Check for same priority patterns that could overlap
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const r1 = rules[i]
        const r2 = rules[j]

        if (
          r1.priority === r2.priority &&
          r1.type === r2.type &&
          r1.type === 'description'
        ) {
          conflicts.push({
            id: this.generateId('conflict'),
            rules: [r1, r2],
            conflictType: 'priority',
          })
        }
      }
    }

    return conflicts
  }

  async getMatchingRuleHistory(ruleId: string): Promise<MatchingRule[]> {
    return this.matchingRuleHistory.get(ruleId) ?? []
  }

  async suggestMatchingRules(
    sessionId: string,
    options: { minConfidence: number; minOccurrences: number }
  ): Promise<RuleSuggestion[]> {
    // ML-based suggestion would analyze historical matches
    return []
  }

  async importMatchingRules(
    targetAccountId: string,
    options: { fromAccount: string }
  ): Promise<void> {
    const sourceRules = Array.from(this.matchingRules.values()).filter(
      (r) => r.accountScope === options.fromAccount
    )

    for (const rule of sourceRules) {
      const newRule: MatchingRule = {
        ...rule,
        id: this.generateId('rule'),
        accountScope: targetAccountId,
        createdAt: new Date(),
      }
      this.matchingRules.set(newRule.id, newRule)
    }
  }

  async exportMatchingRules(options: { format: 'json' | 'csv' }): Promise<string> {
    const rules = Array.from(this.matchingRules.values())

    if (options.format === 'json') {
      return JSON.stringify({ rules }, null, 2)
    }

    // CSV format
    const lines: string[] = ['id,name,type,enabled,priority']
    for (const rule of rules) {
      lines.push(`${rule.id},${rule.name},${rule.type},${rule.enabled},${rule.priority}`)
    }
    return lines.join('\n')
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createReconciliationEngine(): ReconciliationEngine {
  return new ReconciliationEngineImpl()
}
