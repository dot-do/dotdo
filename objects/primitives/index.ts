/**
 * DO Primitives Integration
 *
 * Integrates the unified primitives (TemporalStore, WindowManager,
 * ExactlyOnceContext, TypedColumnStore) into the Durable Object architecture.
 *
 * Provides a factory that creates DO-backed primitives with:
 * - Automatic persistence to DO storage
 * - Alarm integration for time-based triggers
 * - Proper initialization and cleanup
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   async handleRequest(req: Request) {
 *     // Get primitives via factory
 *     const primitives = createDOPrimitiveFactory(this.ctx, this.env)
 *
 *     // Create a temporal store for events
 *     const eventStore = primitives.temporal<Event>('events')
 *     await eventStore.put('event-1', event, Date.now())
 *
 *     // Create a window manager for aggregation
 *     const windowMgr = primitives.window('tumbling', { size: { minutes: 5 } })
 *     windowMgr.process(metric, Date.now())
 *   }
 * }
 * ```
 */

import {
  createTemporalStore,
  type TemporalStore,
  type TemporalStoreOptions,
  WindowManager,
  type WindowAssigner,
  hours,
  minutes,
  seconds,
  milliseconds,
  createExactlyOnceContext,
  type ExactlyOnceContextInterface,
  type ExactlyOnceContextOptions,
  createColumnStore,
  type TypedColumnStore,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
} from '../../db/primitives'

import {
  createDOStorageAdapter,
  createTemporalStorageAdapter,
  createExactlyOnceStorageAdapter,
  type PrimitiveStorage,
} from './storage-adapter'

import {
  createDOAlarmAdapter,
  createWindowAlarmIntegration,
  type DOAlarmAdapter,
  type WindowAlarmIntegration,
} from './alarm-adapter'

// Re-export adapters for direct usage
export * from './storage-adapter'
export * from './alarm-adapter'

// ============================================================================
// Types
// ============================================================================

/**
 * Duration specification for window sizes
 */
export interface DurationSpec {
  hours?: number
  minutes?: number
  seconds?: number
  milliseconds?: number
}

/**
 * Window type options
 */
export type WindowType = 'tumbling' | 'sliding' | 'session' | 'global'

/**
 * Window configuration
 */
export interface WindowConfig {
  /** Window size (for tumbling, sliding) */
  size?: DurationSpec
  /** Slide interval (for sliding windows) */
  slide?: DurationSpec
  /** Gap timeout (for session windows) */
  gap?: DurationSpec
  /** Trigger configuration */
  trigger?: 'eventTime' | 'count' | 'processingTime' | { count: number } | { interval: DurationSpec }
  /** Key extractor function */
  keyBy?: (element: unknown) => string
}

/**
 * Primitive factory interface
 */
export interface DOPrimitiveFactory {
  /** Create a temporal store for time-aware key-value storage */
  temporal<T>(name: string, options?: TemporalStoreOptions): TemporalStore<T>

  /** Create a window manager for stream aggregation */
  window<T>(type: WindowType, config: WindowConfig): WindowManager<T>

  /** Create an exactly-once context for idempotent processing */
  exactlyOnce(options?: ExactlyOnceContextOptions): ExactlyOnceContextInterface

  /** Create a typed column store for analytical queries */
  columns(name: string): TypedColumnStore

  /** Get the alarm adapter for direct alarm control */
  alarms(): DOAlarmAdapter

  /** Get the storage adapter for direct storage access */
  storage(): PrimitiveStorage

  /** Handle DO alarm - call this from DO.alarm() */
  handleAlarm(): Promise<void>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Convert DurationSpec to duration object
 */
function toDuration(spec: DurationSpec): ReturnType<typeof hours> {
  if (spec.hours) return hours(spec.hours)
  if (spec.minutes) return minutes(spec.minutes)
  if (spec.seconds) return seconds(spec.seconds)
  if (spec.milliseconds) return milliseconds(spec.milliseconds)
  throw new Error('Invalid duration spec: must specify hours, minutes, seconds, or milliseconds')
}

/**
 * DO Primitive Factory implementation
 */
class DOPrimitiveFactoryImpl implements DOPrimitiveFactory {
  private readonly ctx: DurableObjectState
  private readonly env: unknown
  private readonly storageAdapter: PrimitiveStorage
  private readonly alarmAdapter: DOAlarmAdapter
  private readonly windowIntegration: WindowAlarmIntegration

  // Instance caches for lazy initialization and reuse
  private readonly temporalStores = new Map<string, TemporalStore<unknown>>()
  private readonly columnStores = new Map<string, TypedColumnStore>()
  private exactlyOnceCtx: ExactlyOnceContextInterface | null = null

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx
    this.env = env
    this.storageAdapter = createDOStorageAdapter(ctx.storage)
    this.alarmAdapter = createDOAlarmAdapter(ctx)
    this.windowIntegration = createWindowAlarmIntegration(this.alarmAdapter, ctx.storage)
  }

  temporal<T>(name: string, options?: TemporalStoreOptions): TemporalStore<T> {
    const cached = this.temporalStores.get(name)
    if (cached) return cached as TemporalStore<T>

    // Create DO-backed temporal store
    const storageAdapter = createTemporalStorageAdapter<T>(this.ctx.storage, name)
    const store = createDOBackedTemporalStore<T>(storageAdapter, options)

    this.temporalStores.set(name, store as TemporalStore<unknown>)
    return store
  }

  window<T>(type: WindowType, config: WindowConfig): WindowManager<T> {
    // Create window assigner based on type
    let assigner: WindowAssigner<T>

    switch (type) {
      case 'tumbling':
        if (!config.size) throw new Error('Tumbling windows require a size')
        assigner = WindowManager.tumbling<T>(toDuration(config.size))
        break

      case 'sliding':
        if (!config.size || !config.slide)
          throw new Error('Sliding windows require both size and slide')
        assigner = WindowManager.sliding<T>(toDuration(config.size), toDuration(config.slide))
        break

      case 'session':
        if (!config.gap) throw new Error('Session windows require a gap')
        assigner = WindowManager.session<T>(toDuration(config.gap))
        break

      case 'global':
        assigner = WindowManager.global<T>()
        break

      default:
        throw new Error(`Unknown window type: ${type}`)
    }

    const windowManager = new WindowManager<T>(assigner)

    // Configure trigger
    if (config.trigger) {
      let trigger: Trigger<T>

      if (config.trigger === 'eventTime') {
        trigger = new EventTimeTrigger<T>()
      } else if (config.trigger === 'count') {
        trigger = new CountTrigger<T>(1)
      } else if (config.trigger === 'processingTime') {
        trigger = new ProcessingTimeTrigger<T>(minutes(1))
      } else if ('count' in config.trigger) {
        trigger = new CountTrigger<T>(config.trigger.count)
      } else if ('interval' in config.trigger) {
        trigger = new ProcessingTimeTrigger<T>(toDuration(config.trigger.interval))
      } else {
        trigger = new EventTimeTrigger<T>()
      }

      windowManager.withTrigger(trigger)
    } else {
      // Default to event time trigger
      windowManager.withTrigger(new EventTimeTrigger<T>())
    }

    // Configure key extractor
    if (config.keyBy) {
      windowManager.withKeyExtractor(config.keyBy as (element: T) => string)
    }

    // Integrate with DO alarms for automatic watermark advancement
    const originalProcess = windowManager.process.bind(windowManager)
    windowManager.process = (element: T, timestamp: number) => {
      originalProcess(element, timestamp)

      // Schedule alarm for any new windows that will need to trigger
      const windows = windowManager.assign(element, timestamp)
      for (const window of windows) {
        // Schedule alarm slightly after window end
        this.windowIntegration.scheduleWindowTrigger(window.end + 1)
      }
    }

    // Register alarm handler for window triggers
    this.alarmAdapter.onAlarm('window-trigger', async () => {
      await this.windowIntegration.handleWindowAlarm((timestamp) => {
        windowManager.advanceWatermark(timestamp)
      })
    })

    return windowManager
  }

  exactlyOnce(options?: ExactlyOnceContextOptions): ExactlyOnceContextInterface {
    if (this.exactlyOnceCtx) return this.exactlyOnceCtx

    // Create DO-backed exactly-once context
    const storageAdapter = createExactlyOnceStorageAdapter(this.ctx.storage, 'default')
    this.exactlyOnceCtx = createDOBackedExactlyOnceContext(storageAdapter, options)

    return this.exactlyOnceCtx
  }

  columns(name: string): TypedColumnStore {
    const cached = this.columnStores.get(name)
    if (cached) return cached

    // Create column store (currently in-memory, persistence can be added later)
    const store = createColumnStore()

    this.columnStores.set(name, store)
    return store
  }

  alarms(): DOAlarmAdapter {
    return this.alarmAdapter
  }

  storage(): PrimitiveStorage {
    return this.storageAdapter
  }

  async handleAlarm(): Promise<void> {
    await this.alarmAdapter.handleAlarm()
  }
}

/**
 * Create a DO-backed temporal store
 */
function createDOBackedTemporalStore<T>(
  storageAdapter: ReturnType<typeof createTemporalStorageAdapter<T>>,
  options?: TemporalStoreOptions
): TemporalStore<T> {
  // Create the base in-memory temporal store
  const memStore = createTemporalStore<T>(options)

  // Wrap with persistence layer
  const store: TemporalStore<T> = {
    async put(key: string, value: T, timestamp: number, opts?: { ttl?: number }) {
      // Store in memory first
      await memStore.put(key, value, timestamp, opts)

      // Persist to DO storage
      const versions = await storageAdapter.loadVersions(key)
      const version = versions.length + 1
      await storageAdapter.saveVersion(
        key,
        value,
        timestamp,
        version,
        opts?.ttl ? timestamp + opts.ttl : undefined
      )
    },

    async get(key: string) {
      // Try memory first
      const memResult = await memStore.get(key)
      if (memResult !== null) return memResult

      // Fall back to storage
      const versions = await storageAdapter.loadVersions(key)
      if (versions.length === 0) return null
      const lastVersion = versions[versions.length - 1]
      return lastVersion ? lastVersion.value : null
    },

    async getAsOf(key: string, timestamp: number) {
      // Try memory first
      const memResult = await memStore.getAsOf(key, timestamp)
      if (memResult !== null) return memResult

      // Fall back to storage
      const versions = await storageAdapter.loadVersions(key)
      for (let i = versions.length - 1; i >= 0; i--) {
        const version = versions[i]
        if (version && version.timestamp <= timestamp) {
          return version.value
        }
      }
      return null
    },

    range(prefix: string, timeRange: { start?: number; end?: number }) {
      // Delegate to memory store for now
      return memStore.range(prefix, timeRange)
    },

    async snapshot() {
      return memStore.snapshot()
    },

    async restoreSnapshot(id: string) {
      return memStore.restoreSnapshot(id)
    },

    async listSnapshots() {
      return memStore.listSnapshots()
    },

    async prune(policy) {
      return memStore.prune(policy)
    },

    async compact(policy) {
      return memStore.compact(policy)
    },

    getRetentionPolicy() {
      return memStore.getRetentionPolicy()
    },

    setRetentionPolicy(policy) {
      memStore.setRetentionPolicy(policy)
    },
  }

  return store
}

/**
 * Create a DO-backed exactly-once context
 */
function createDOBackedExactlyOnceContext(
  storageAdapter: ReturnType<typeof createExactlyOnceStorageAdapter>,
  options?: ExactlyOnceContextOptions
): ExactlyOnceContextInterface {
  // Create the base in-memory context
  const memCtx = createExactlyOnceContext(options)

  // Wrap with persistence layer
  const ctx: ExactlyOnceContextInterface = {
    async processOnce<T>(eventId: string, fn: () => Promise<T>) {
      // Check storage for already processed
      const processed = await storageAdapter.loadProcessedIds()
      if (processed.has(eventId)) {
        return processed.get(eventId)!.result as T
      }

      // Process using memory context
      const result = await memCtx.processOnce(eventId, fn)

      // Persist to storage
      await storageAdapter.markProcessed(eventId, Date.now(), result)

      return result
    },

    async isProcessed(eventId: string) {
      // Check memory first
      const memResult = await memCtx.isProcessed(eventId)
      if (memResult) return true

      // Check storage
      const processed = await storageAdapter.loadProcessedIds()
      return processed.has(eventId)
    },

    async transaction<T>(fn: (tx: any) => Promise<T>) {
      // Use memory context for transactions
      const result = await memCtx.transaction(fn)

      // Persist state changes
      const state = (await memCtx.getCheckpointState()).state
      await storageAdapter.saveState(state)

      return result
    },

    emit(event: unknown) {
      memCtx.emit(event)
    },

    async flush() {
      return memCtx.flush()
    },

    async onBarrier(barrier) {
      return memCtx.onBarrier(barrier)
    },

    async getCheckpointState() {
      return memCtx.getCheckpointState()
    },

    async restoreFromCheckpoint(state) {
      return memCtx.restoreFromCheckpoint(state)
    },

    getEpoch() {
      return memCtx.getEpoch()
    },

    getBufferedEventCount() {
      return memCtx.getBufferedEventCount()
    },

    async clear() {
      return memCtx.clear()
    },
  }

  return ctx
}

/**
 * Create a DO primitive factory
 *
 * @param ctx - Durable Object state
 * @param env - Environment bindings
 * @returns Primitive factory instance
 *
 * @example
 * ```typescript
 * const primitives = createDOPrimitiveFactory(this.ctx, this.env)
 * const eventStore = primitives.temporal<Event>('events')
 * ```
 */
export function createDOPrimitiveFactory(ctx: DurableObjectState, env: unknown): DOPrimitiveFactory {
  return new DOPrimitiveFactoryImpl(ctx, env)
}
