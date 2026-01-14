/**
 * CDC (Change Data Capture) - Unified event streaming from all stores
 *
 * @example
 * ```typescript
 * import { CDCEmitter, type UnifiedEvent } from 'dotdo/db/cdc'
 *
 * const cdc = new CDCEmitter(env.EVENTS_PIPELINE, {
 *   ns: 'startups.studio',
 *   source: 'DO/customers',
 * })
 *
 * // CDC event (from store mutation)
 * await cdc.emit({
 *   op: 'c',
 *   store: 'document',
 *   table: 'Customer',
 *   key: 'cust_123',
 *   after: { name: 'Alice', email: 'alice@example.com' },
 * })
 *
 * // Domain event (business logic)
 * await cdc.emit({
 *   type: 'Customer.created',
 *   actor: 'User/nathan',
 *   data: { customerId: 'cust_123', source: 'signup' },
 * })
 * ```
 *
 * @example Event Filtering
 * ```typescript
 * import { EventFilter } from 'dotdo/db/cdc'
 *
 * const filter = new EventFilter({
 *   types: ['Thing.*'],  // Match all Thing events
 *   excludeTypes: ['Thing.deleted'],  // Except deletes
 * })
 *
 * const filtered = filter.apply(events)
 * ```
 *
 * @example Event Replay
 * ```typescript
 * import { EventLog } from 'dotdo/db/cdc'
 *
 * const log = new EventLog(storage)
 * const events = await log.replay({ fromLsn: 100 })
 * await log.saveCheckpoint('consumer-1', { lsn: 150 })
 * ```
 *
 * @example Dead Letter Queue
 * ```typescript
 * import { CDCEmitterWithDLQ, DeadLetterQueue } from 'dotdo/db/cdc'
 *
 * const emitter = new CDCEmitterWithDLQ(pipeline, {
 *   ns: 'tenant',
 *   source: 'DO/things',
 *   dlq: dlqPipeline,
 *   maxRetries: 3,
 *   retryPolicy: 'exponential',
 * })
 *
 * const dlq = new DeadLetterQueue(dlqStorage)
 * const stats = await dlq.getStats()
 * ```
 */

// Types
export type {
  UnifiedEvent,
  StoreType,
  CDCOperation,
  EventMeta,
  EventVisibility,
  PartialEvent,
  CDCEmitterOptions,
  EmitOptions,
  PipelineEvent,
} from './types'

// CDCEmitter
export { CDCEmitter, type Pipeline } from './emitter'

// Transform helpers
export { createCDCEvent, transformForPipeline } from './transform'

// Event Filtering
export { EventFilter, type EventFilterOptions } from './filter'

// Event Replay and Checkpoints
export {
  EventLog,
  type EventStorage,
  type Checkpoint,
  type ReplayOptions,
  type ReplayResult,
} from './event-log'

// DLQ Emitter with Retry
export {
  CDCEmitterWithDLQ,
  type CDCEmitterWithDLQOptions,
  type DLQMetadata,
  type DLQEvent,
  type RetryPolicy,
} from './emitter-dlq'

// Dead Letter Queue Management
export {
  DeadLetterQueue,
  type DLQStorage,
  type DLQStats,
  type PurgeOptions,
} from './dlq'
