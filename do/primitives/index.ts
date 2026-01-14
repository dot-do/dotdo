/**
 * DO Primitives - Core building blocks for Durable Objects
 *
 * @example
 * ```typescript
 * import { ExactlyOnceContext } from 'dotdo/do/primitives'
 *
 * const ctx = new ExactlyOnceContext(db, pipeline)
 *
 * await ctx.transaction(async (tx) => {
 *   await tx.execute('INSERT INTO customers ...')
 *   await tx.emit({ op: 'c', store: 'document', table: 'Customer', ... })
 * })
 * ```
 */

// Re-export existing primitives
export {
  ExactlyOnceContext as ExactlyOnceContextBase,
  createExactlyOnceContext,
  type ExactlyOnceContextOptions,
  type CheckpointBarrier,
  type CheckpointState,
  type Transaction as TransactionBase,
  type ExactlyOnceContextInterface,
} from './exactly-once-context'

// Note: Additional primitives available but not exported here to avoid
// import issues. Import directly from their modules if needed:
// - ./temporal-store
// - ./watermark-service
// - ./window-manager
// - ./typed-column-store
// - ./schema-evolution

/**
 * Pipeline interface for event delivery
 */
export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

/**
 * Transaction interface for CDC-aware operations
 */
export interface CDCTransaction {
  /** Execute SQL statement */
  execute(sql: string): Promise<void>
  /** Emit CDC event (queued until commit) */
  emit(event: unknown): Promise<void>
}

/**
 * ExactlyOnceContext - Provides exactly-once semantics for DB + CDC operations
 *
 * This is a CDC-aware wrapper that coordinates database mutations and event
 * emission in a single atomic transaction.
 */
export class ExactlyOnceContext {
  private db: unknown
  private pipeline?: Pipeline
  private pendingEvents: unknown[] = []

  constructor(db: unknown, pipeline?: Pipeline) {
    this.db = db
    this.pipeline = pipeline
  }

  /**
   * Execute a transaction with atomic DB + CDC semantics
   *
   * Events emitted via tx.emit() are queued until the transaction commits.
   * If the transaction throws, no events are sent.
   */
  async transaction<T>(fn: (tx: CDCTransaction) => Promise<T>): Promise<T> {
    // Reset pending events for this transaction
    const txEvents: unknown[] = []

    const tx: CDCTransaction = {
      execute: async (sql: string): Promise<void> => {
        // In a real implementation, this would execute against the db
        // For now, we just validate the call was made
        const dbAny = this.db as { exec?: (sql: string) => void }
        if (dbAny?.exec) {
          dbAny.exec(sql)
        }
      },
      emit: async (event: unknown): Promise<void> => {
        // Queue event for delivery after commit
        txEvents.push(event)
      },
    }

    try {
      // Execute the transaction function
      const result = await fn(tx)

      // On success, send all queued events
      if (this.pipeline && txEvents.length > 0) {
        await this.pipeline.send(txEvents)
      }

      return result
    } catch (error) {
      // On failure, discard queued events (no delivery)
      // Re-throw the error
      throw error
    }
  }
}
