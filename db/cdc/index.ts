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
