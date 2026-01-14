/**
 * Transaction Processor - Double-Entry Accounting Engine
 *
 * Implements a transaction processor that enforces double-entry accounting rules
 * and updates account balances atomically.
 *
 * Features:
 * 1. Double-entry rule: debits must equal credits
 * 2. Atomic balance updates
 * 3. Transaction validation before posting
 * 4. Multi-line transaction support (journal entries with >2 lines)
 * 5. Balance calculation (running balance per account)
 * 6. Transaction reversal support
 * 7. Period locking (prevent changes to closed periods)
 *
 * @module db/primitives/accounting/transaction-processor
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A single line in a transaction (journal entry line)
 */
export interface TransactionLine {
  accountId: string
  debit: number
  credit: number
  memo?: string
  reference?: string
}

/**
 * A transaction to be posted
 */
export interface Transaction {
  id: string
  date: Date
  description: string
  lines: TransactionLine[]
  metadata?: Record<string, unknown>
}

/**
 * A posted transaction with additional metadata
 */
export interface PostedTransaction {
  id: string
  date: Date
  description: string
  lines: TransactionLine[]
  status: 'posted' | 'reversed'
  postedAt: Date
  lineCount: number
  totalDebits: number
  totalCredits: number
  reversesTransactionId?: string
  reversalReason?: string
  reversedByTransactionId?: string
  metadata?: Record<string, unknown>
}

/**
 * Account balance information
 */
export interface Balance {
  accountId: string
  debitTotal: number
  creditTotal: number
  balance: number
  transactionCount: number
  asOfDate: Date
}

/**
 * Validation result for a transaction
 */
export interface ValidationResult {
  isValid: boolean
  errors: string[]
  totalDebits: number
  totalCredits: number
}

/**
 * Transaction processor interface
 */
export interface TransactionProcessor {
  /**
   * Post a transaction to the ledger
   * @param transaction - The transaction to post
   * @returns The posted transaction with metadata
   */
  post(transaction: Transaction): Promise<PostedTransaction>

  /**
   * Reverse a previously posted transaction
   * @param transactionId - ID of the transaction to reverse
   * @param reason - Reason for the reversal
   * @returns The reversal transaction
   */
  reverse(transactionId: string, reason: string): Promise<PostedTransaction>

  /**
   * Validate a transaction before posting
   * @param transaction - The transaction to validate
   * @returns Validation result with errors if any
   */
  validateBalance(transaction: Transaction): ValidationResult

  /**
   * Get the current balance for an account
   * @param accountId - The account ID
   * @returns The account balance
   */
  getAccountBalance(accountId: string): Promise<Balance>

  /**
   * Lock a period to prevent changes
   * @param periodEnd - The end date of the period to lock
   */
  lockPeriod(periodEnd: Date): Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

/**
 * Normalize a date to midnight UTC for comparison
 */
function normalizeDate(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Account balance tracking
 */
interface AccountBalanceRecord {
  debitTotal: number
  creditTotal: number
  transactionCount: number
}

class TransactionProcessorImpl implements TransactionProcessor {
  private postedTransactions: Map<string, PostedTransaction> = new Map()
  private accountBalances: Map<string, AccountBalanceRecord> = new Map()
  private lockedPeriods: Date[] = []

  // =============================================================================
  // Validation
  // =============================================================================

  validateBalance(transaction: Transaction): ValidationResult {
    const errors: string[] = []
    let totalDebits = 0
    let totalCredits = 0

    // Check for minimum lines
    if (transaction.lines.length < 2) {
      errors.push('Transaction must have at least two lines')
    }

    // Validate each line
    for (const line of transaction.lines) {
      // Check for negative amounts
      if (line.debit < 0 || line.credit < 0) {
        errors.push('Line amounts must be non-negative')
      }

      // Check for both debit and credit on same line
      if (line.debit > 0 && line.credit > 0) {
        errors.push('Line cannot have both debit and credit')
      }

      totalDebits += line.debit
      totalCredits += line.credit
    }

    // Check for zero transaction
    if (totalDebits === 0 && totalCredits === 0) {
      errors.push('Transaction must have non-zero amount')
    }

    // Check balance
    if (totalDebits !== totalCredits) {
      errors.push(`Transaction must balance: debits (${totalDebits}) != credits (${totalCredits})`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      totalDebits,
      totalCredits,
    }
  }

  // =============================================================================
  // Period Locking
  // =============================================================================

  private isDateInLockedPeriod(date: Date): boolean {
    const normalizedDate = normalizeDate(date)

    for (const lockDate of this.lockedPeriods) {
      const normalizedLockDate = normalizeDate(lockDate)
      if (normalizedDate.getTime() <= normalizedLockDate.getTime()) {
        return true
      }
    }

    return false
  }

  async lockPeriod(periodEnd: Date): Promise<void> {
    this.lockedPeriods.push(periodEnd)
    // Sort in ascending order for efficient checking
    this.lockedPeriods.sort((a, b) => a.getTime() - b.getTime())
  }

  // =============================================================================
  // Post Transaction
  // =============================================================================

  async post(transaction: Transaction): Promise<PostedTransaction> {
    // Check if period is locked
    if (this.isDateInLockedPeriod(transaction.date)) {
      throw new Error('Cannot post to locked period')
    }

    // Validate the transaction
    const validation = this.validateBalance(transaction)
    if (!validation.isValid) {
      throw new Error(validation.errors[0])
    }

    // Check for duplicate transaction ID
    if (this.postedTransactions.has(transaction.id)) {
      throw new Error('Transaction ID already exists')
    }

    // Create posted transaction
    const postedTransaction: PostedTransaction = {
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      lines: [...transaction.lines],
      status: 'posted',
      postedAt: new Date(),
      lineCount: transaction.lines.length,
      totalDebits: validation.totalDebits,
      totalCredits: validation.totalCredits,
      metadata: transaction.metadata,
    }

    // Update account balances atomically
    this.updateBalances(transaction.lines)

    // Store the transaction
    this.postedTransactions.set(transaction.id, postedTransaction)

    return postedTransaction
  }

  // =============================================================================
  // Balance Updates
  // =============================================================================

  private updateBalances(lines: TransactionLine[]): void {
    for (const line of lines) {
      let balance = this.accountBalances.get(line.accountId)
      if (!balance) {
        balance = {
          debitTotal: 0,
          creditTotal: 0,
          transactionCount: 0,
        }
        this.accountBalances.set(line.accountId, balance)
      }

      balance.debitTotal += line.debit
      balance.creditTotal += line.credit
      balance.transactionCount += 1
    }
  }

  // =============================================================================
  // Get Account Balance
  // =============================================================================

  async getAccountBalance(accountId: string): Promise<Balance> {
    const balance = this.accountBalances.get(accountId)

    if (!balance) {
      return {
        accountId,
        debitTotal: 0,
        creditTotal: 0,
        balance: 0,
        transactionCount: 0,
        asOfDate: new Date(),
      }
    }

    return {
      accountId,
      debitTotal: balance.debitTotal,
      creditTotal: balance.creditTotal,
      balance: Math.abs(balance.debitTotal - balance.creditTotal),
      transactionCount: balance.transactionCount,
      asOfDate: new Date(),
    }
  }

  // =============================================================================
  // Reverse Transaction
  // =============================================================================

  async reverse(transactionId: string, reason: string): Promise<PostedTransaction> {
    const originalTransaction = this.postedTransactions.get(transactionId)

    if (!originalTransaction) {
      throw new Error('Transaction not found')
    }

    if (originalTransaction.status === 'reversed') {
      throw new Error('Transaction already reversed')
    }

    if (originalTransaction.reversedByTransactionId) {
      throw new Error('Transaction already reversed')
    }

    // Check if original transaction is in a locked period
    if (this.isDateInLockedPeriod(originalTransaction.date)) {
      throw new Error('Cannot reverse transaction in locked period')
    }

    // Create reversed lines (swap debits and credits)
    const reversedLines: TransactionLine[] = originalTransaction.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      memo: line.memo,
      reference: line.reference,
    }))

    // Generate reversal transaction ID
    const reversalId = generateId('rev')

    // Create reversal transaction
    const reversalTransaction: PostedTransaction = {
      id: reversalId,
      date: new Date(),
      description: `Reversal of ${originalTransaction.description}`,
      lines: reversedLines,
      status: 'posted',
      postedAt: new Date(),
      lineCount: reversedLines.length,
      totalDebits: originalTransaction.totalCredits, // Swapped
      totalCredits: originalTransaction.totalDebits, // Swapped
      reversesTransactionId: transactionId,
      reversalReason: reason,
    }

    // Update account balances with reversal
    this.updateBalances(reversedLines)

    // Mark original as reversed
    originalTransaction.status = 'reversed'
    originalTransaction.reversedByTransactionId = reversalId

    // Store the reversal transaction
    this.postedTransactions.set(reversalId, reversalTransaction)

    return reversalTransaction
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new TransactionProcessor instance
 */
export function createTransactionProcessor(): TransactionProcessor {
  return new TransactionProcessorImpl()
}
