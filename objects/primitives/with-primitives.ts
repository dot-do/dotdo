/**
 * withPrimitives Capability
 *
 * A capability that adds the unified primitives to any Durable Object class.
 * Provides zero-config access to:
 * - TemporalStore: Time-aware key-value storage
 * - WindowManager: Stream windowing and aggregation
 * - ExactlyOnceContext: Idempotent event processing
 * - TypedColumnStore: Columnar analytical storage
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withPrimitives } from 'dotdo/primitives'
 *
 * class MyDO extends withPrimitives(DO) {
 *   async handleRequest(req: Request) {
 *     // Access primitives via $.primitives
 *     const eventStore = this.$.primitives.temporal<Event>('events')
 *     await eventStore.put('event-1', event, Date.now())
 *
 *     // Process events exactly once
 *     await this.$.primitives.exactlyOnce().processOnce(event.id, async () => {
 *       // Process event
 *     })
 *   }
 * }
 * ```
 */

import {
  createCapability,
  type Constructor,
  type CapabilityContext,
} from '../mixins/infrastructure'

import {
  createDOPrimitiveFactory,
  type DOPrimitiveFactory,
  type DurationSpec,
  type WindowType,
  type WindowConfig,
} from './index'

import type {
  TemporalStore,
  TemporalStoreOptions,
  ExactlyOnceContextInterface,
  ExactlyOnceContextOptions,
  TypedColumnStore,
} from '../../db/primitives'

import { WindowManager } from '../../db/primitives'

// Re-export types for convenience
export type {
  DOPrimitiveFactory,
  DurationSpec,
  WindowType,
  WindowConfig,
  TemporalStore,
  TemporalStoreOptions,
  ExactlyOnceContextInterface,
  ExactlyOnceContextOptions,
  TypedColumnStore,
}

export { WindowManager }

/**
 * Primitives capability interface
 *
 * Exposed via `this.$.primitives` when using the withPrimitives capability.
 */
export interface PrimitivesCapability {
  /**
   * Create a temporal store for time-aware key-value storage
   *
   * @param name - Unique name for this store
   * @param options - Optional configuration
   * @returns TemporalStore instance
   *
   * @example
   * ```typescript
   * const store = this.$.primitives.temporal<Event>('events')
   * await store.put('key', event, Date.now())
   * const past = await store.getAsOf('key', pastTimestamp)
   * ```
   */
  temporal<T>(name: string, options?: TemporalStoreOptions): TemporalStore<T>

  /**
   * Create a window manager for stream aggregation
   *
   * @param type - Window type: 'tumbling', 'sliding', 'session', or 'global'
   * @param config - Window configuration
   * @returns WindowManager instance
   *
   * @example
   * ```typescript
   * const windowMgr = this.$.primitives.window<Metric>('tumbling', {
   *   size: { minutes: 5 },
   *   trigger: 'eventTime'
   * })
   *
   * windowMgr.onTrigger((window, elements) => {
   *   const sum = elements.reduce((acc, m) => acc + m.value, 0)
   *   console.log(`Window [${window.start}, ${window.end}]: sum = ${sum}`)
   * })
   *
   * windowMgr.process(metric, timestamp)
   * ```
   */
  window<T>(type: WindowType, config: WindowConfig): WindowManager<T>

  /**
   * Create an exactly-once context for idempotent processing
   *
   * @param options - Optional configuration
   * @returns ExactlyOnceContext instance
   *
   * @example
   * ```typescript
   * const ctx = this.$.primitives.exactlyOnce()
   *
   * // Process event exactly once (idempotent)
   * const result = await ctx.processOnce(event.id, async () => {
   *   // Process event - this will only run once per event ID
   *   return processedResult
   * })
   *
   * // Atomic transaction
   * await ctx.transaction(async (tx) => {
   *   const balance = await tx.get('balance')
   *   await tx.put('balance', balance - amount)
   *   tx.emit({ type: 'transfer', amount })
   * })
   * ```
   */
  exactlyOnce(options?: ExactlyOnceContextOptions): ExactlyOnceContextInterface

  /**
   * Create a typed column store for analytical queries
   *
   * @param name - Unique name for this store
   * @returns TypedColumnStore instance
   *
   * @example
   * ```typescript
   * const store = this.$.primitives.columns('metrics')
   * store.addColumn('timestamp', 'timestamp')
   * store.addColumn('value', 'float64')
   * store.addColumn('name', 'string')
   *
   * store.append('timestamp', timestamps)
   * store.append('value', values)
   * store.append('name', names)
   *
   * const avg = store.aggregate('value', 'avg')
   * ```
   */
  columns(name: string): TypedColumnStore

  /**
   * Handle DO alarm - call this from your alarm() method
   *
   * @example
   * ```typescript
   * async alarm() {
   *   await this.$.primitives.handleAlarm()
   *   // ... other alarm handling
   * }
   * ```
   */
  handleAlarm(): Promise<void>
}

/**
 * Extended $ context with primitives capability
 */
export interface WithPrimitivesContext {
  primitives: PrimitivesCapability
}

/**
 * Create the primitives capability
 */
function createPrimitivesCapability(ctx: CapabilityContext): PrimitivesCapability {
  // Create the factory lazily on first access
  let factory: DOPrimitiveFactory | null = null

  const getFactory = () => {
    if (!factory) {
      factory = createDOPrimitiveFactory(ctx.state, ctx.env)
    }
    return factory
  }

  return {
    temporal<T>(name: string, options?: TemporalStoreOptions): TemporalStore<T> {
      return getFactory().temporal<T>(name, options)
    },

    window<T>(type: WindowType, config: WindowConfig): WindowManager<T> {
      return getFactory().window<T>(type, config)
    },

    exactlyOnce(options?: ExactlyOnceContextOptions): ExactlyOnceContextInterface {
      return getFactory().exactlyOnce(options)
    },

    columns(name: string): TypedColumnStore {
      return getFactory().columns(name)
    },

    async handleAlarm(): Promise<void> {
      return getFactory().handleAlarm()
    },
  }
}

/**
 * withPrimitives capability
 *
 * Adds unified primitives capability to a Durable Object class.
 *
 * @param Base - Base DO class to extend
 * @returns Extended class with primitives capability
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withPrimitives } from 'dotdo/primitives'
 *
 * // Add primitives to DO
 * class MyDO extends withPrimitives(DO) {
 *   async fetch(request: Request) {
 *     // Use primitives via $.primitives
 *     const store = this.$.primitives.temporal('events')
 *     // ...
 *   }
 * }
 *
 * // Compose with other capabilities
 * import { withFs } from 'dotdo/mixins'
 * class FullDO extends withFs(withPrimitives(DO)) {
 *   // Has both $.primitives and $.fs
 * }
 * ```
 */
export const withPrimitives = createCapability('primitives', createPrimitivesCapability)

/**
 * Type helper for classes using withPrimitives
 *
 * Use this to properly type `this.$` in classes using the mixin.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withPrimitives, PrimitivesDO } from 'dotdo/primitives'
 *
 * class MyDO extends withPrimitives(DO) {
 *   async process() {
 *     // TypeScript knows about $.primitives
 *     const store = (this as PrimitivesDO).$.primitives.temporal('events')
 *   }
 * }
 * ```
 */
export interface PrimitivesDO {
  $: WithPrimitivesContext
}

/**
 * Convenience re-export of primitive utilities
 */
export {
  // Duration helpers from WindowManager
  hours,
  minutes,
  seconds,
  milliseconds,
  // Trigger types
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
} from '../../db/primitives'
