/**
 * Transactions - Exactly-once processing with deduplication
 *
 * Provides exactly-once processing semantics for event-driven systems:
 * - Idempotent processing with event ID deduplication
 * - Atomic transactions with commit/rollback
 * - Outbox pattern for reliable event delivery
 * - Checkpoint coordination for distributed recovery
 *
 * @module db/primitives/transactions
 */

// Re-export everything from exactly-once-context for backwards compatibility
// "Transactions" is clearer than "ExactlyOnceContext" for most use cases
export {
  createExactlyOnceContext,
  createExactlyOnceContext as createTransactions,
  ExactlyOnceContext,
  ExactlyOnceContext as Transactions,
  type ExactlyOnceContextInterface,
  type ExactlyOnceContextInterface as TransactionsInterface,
  type ExactlyOnceContextOptions,
  type ExactlyOnceContextOptions as TransactionsOptions,
  type CheckpointBarrier,
  type CheckpointState,
  type Transaction,
} from './exactly-once-context'
