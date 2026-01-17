/**
 * Durable Execution Module - Retry logic, action logging, and workflow execution
 *
 * This module contains:
 * - do() - Durable execution with retries and replay
 * - try() - Single attempt execution with optional timeout
 * - ActionLog - Persistent action log for replay semantics
 */

import { generateEventId } from './event-system'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_RETRIES = 3
const MAX_BACKOFF_MS = 10000
const EXPONENTIAL_BACKOFF_BASE = 2

// ============================================================================
// Types
// ============================================================================

/**
 * Entry in the action log for replay semantics
 */
export interface ActionLogEntry {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: { message: string }
  /** Timestamp when the entry was created (milliseconds since epoch) */
  created_at?: number
}

/**
 * Options for durable execution
 */
export interface DurableExecutionOptions {
  stepId?: string
  maxRetries?: number
}

/**
 * Options for try execution
 */
export interface TryExecutionOptions {
  timeout?: number
}

// ============================================================================
// Durable Execution Class
// ============================================================================

/**
 * DurableExecution handles workflow execution with retries and replay semantics
 * This is a helper class that DOCore uses to manage durable actions
 */
export class DurableExecution {
  private actionLog: ActionLogEntry[] = []

  constructor(private ctx: DurableObjectState) {}

  /**
   * Initialize the action_log table in SQLite
   */
  initTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        step_id TEXT PRIMARY KEY,
        status TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER
      )
    `)
  }

  /**
   * Load existing action log from SQLite
   */
  loadActionLog(): void {
    const rows = this.ctx.storage.sql.exec('SELECT * FROM action_log').toArray()
    for (const row of rows) {
      this.actionLog.push({
        stepId: row.step_id as string,
        status: row.status as 'pending' | 'completed' | 'failed',
        result: row.result ? JSON.parse(row.result as string) : undefined,
        error: row.error ? { message: row.error as string } : undefined,
      })
    }
  }

  /**
   * Execute action with durable semantics
   * - Retries with exponential backoff on failure
   * - Replays from log on restart (idempotent by stepId)
   *
   * @param action The action to execute
   * @param options Optional execution options (stepId, maxRetries)
   * @returns The result of the action
   * @throws Error if all retries are exhausted
   */
  async do<T>(action: () => T | Promise<T>, options?: DurableExecutionOptions): Promise<T> {
    const stepId = options?.stepId ?? generateEventId()
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES

    // Check for existing completed entry (replay semantics)
    const existingEntry = this.actionLog.find((e) => e.stepId === stepId && e.status === 'completed')
    if (existingEntry) {
      return existingEntry.result as T
    }

    let lastError: Error | undefined
    let attempts = 0

    while (attempts < maxRetries) {
      attempts++
      try {
        const result = await action()
        this.recordSuccess(stepId, result)
        return result
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // If not last attempt, wait with exponential backoff
        if (attempts < maxRetries) {
          const backoffMs = this.calculateBackoff(attempts)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    // Record failure and throw
    this.recordFailure(stepId, lastError!)
    throw lastError
  }

  /**
   * Single-attempt action execution (no retry)
   *
   * @param action The action to execute
   * @param options Optional execution options (timeout)
   * @returns The result of the action
   * @throws Error if timeout exceeded or action fails
   */
  async try<T>(action: () => T | Promise<T>, options?: TryExecutionOptions): Promise<T> {
    if (options?.timeout) {
      return Promise.race([
        Promise.resolve(action()),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), options.timeout)
        ),
      ])
    }
    return action()
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attemptNumber: number): number {
    const baseBackoff = 1000 * Math.pow(EXPONENTIAL_BACKOFF_BASE, attemptNumber - 1)
    return Math.min(baseBackoff, MAX_BACKOFF_MS)
  }

  /**
   * Record successful action execution
   */
  private recordSuccess<T>(stepId: string, result: T): void {
    const logEntry: ActionLogEntry = {
      stepId,
      status: 'completed',
      result,
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = logEntry
    } else {
      this.actionLog.push(logEntry)
    }

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO action_log (step_id, status, result, created_at) VALUES (?, ?, ?, ?)`,
      stepId,
      'completed',
      JSON.stringify(result),
      Date.now()
    )
  }

  /**
   * Record failed action execution
   */
  private recordFailure(stepId: string, error: Error): void {
    const failureEntry: ActionLogEntry = {
      stepId,
      status: 'failed',
      error: { message: error.message },
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = failureEntry
    } else {
      this.actionLog.push(failureEntry)
    }

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO action_log (step_id, status, error, created_at) VALUES (?, ?, ?, ?)`,
      stepId,
      'failed',
      error.message,
      Date.now()
    )
  }

  /**
   * Get the action log for debugging/testing
   */
  getActionLog(): ActionLogEntry[] {
    return [...this.actionLog]
  }

  /**
   * Clear the action log (for testing)
   */
  clearActionLog(): void {
    this.actionLog = []
  }
}
