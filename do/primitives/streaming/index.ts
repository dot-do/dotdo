/**
 * Streaming Primitives - Flink-style StatefulOperator for Stream Processing
 *
 * Provides keyed state management for stream processing with exactly-once semantics
 * using Durable Objects as the state backend.
 *
 * State Types:
 * - `ValueState<T>` - Single value per key
 * - `ListState<T>` - Append-only list per key
 * - `MapState<K, V>` - Nested map per key
 * - `ReducingState<T>` - Auto-reducing with ReduceFunction
 * - `AggregatingState<IN, ACC, OUT>` - General aggregation
 *
 * Components:
 * - `KeyedState<K, V>` - Base interface for partitioned state
 * - `Operator<IN, OUT>` - Stateful transformation with lifecycle
 * - `Checkpoint` - Consistent snapshots for fault tolerance
 * - `Timer` - Scheduled callbacks (event-time & processing-time)
 *
 * @example Basic Usage
 * ```typescript
 * import { StatefulOperator, ValueState } from 'dotdo/db/primitives/streaming'
 *
 * class CountingOperator extends StatefulOperator<Event, Count> {
 *   private count!: ValueState<number>
 *
 *   async open() {
 *     this.count = this.getRuntimeContext().getState({
 *       name: 'count',
 *       defaultValue: 0
 *     })
 *   }
 *
 *   async processElement(event: Event, ctx: Context, out: Collector<Count>) {
 *     const current = await this.count.value() ?? 0
 *     await this.count.update(current + 1)
 *     out.collect({ key: ctx.getCurrentKey(), count: current + 1 })
 *   }
 * }
 * ```
 *
 * @module db/primitives/streaming
 */

import type { StateBackend, StateSnapshot } from '../stateful-operator'
import { InMemoryStateBackend } from '../stateful-operator'
import type { WatermarkServiceInterface } from '../watermark-service'
import { WatermarkService } from '../watermark-service'
import type { Window, WindowManager } from '../window-manager'

// =============================================================================
// Core State Types (Flink-compatible)
// =============================================================================

/**
 * State descriptor with configuration
 */
export interface StateDescriptor<T> {
  name: string
  defaultValue?: T
  ttl?: StateTTLConfig
}

/**
 * TTL configuration for state
 */
export interface StateTTLConfig {
  ttlMs: number
  updateType: 'OnCreateAndWrite' | 'OnReadAndWrite'
  visibility: 'NeverReturnExpired' | 'ReturnExpiredIfNotCleanedUp'
}

/**
 * Value state descriptor
 */
export interface ValueStateDescriptor<T> extends StateDescriptor<T> {
  getTtlConfig?(): StateTTLConfig | undefined
}

/**
 * List state descriptor
 */
export interface ListStateDescriptor<T> extends StateDescriptor<T[]> {}

/**
 * Map state descriptor
 */
export interface MapStateDescriptor<K, V> extends StateDescriptor<Map<K, V>> {
  keyType?: string
  valueType?: string
}

/**
 * Reducing state descriptor
 */
export interface ReducingStateDescriptor<T> extends StateDescriptor<T> {
  reduceFunction: ReduceFunction<T>
}

/**
 * Aggregating state descriptor
 */
export interface AggregatingStateDescriptor<IN, ACC, OUT> extends StateDescriptor<ACC> {
  aggregateFunction: AggregateFunction<IN, ACC, OUT>
}

// =============================================================================
// State Interfaces
// =============================================================================

/**
 * Single value state for a key
 */
export interface ValueState<T> {
  value(): Promise<T | null>
  update(value: T): Promise<void>
  clear(): Promise<void>
}

/**
 * Append-only list state for a key
 */
export interface ListState<T> {
  get(): Promise<Iterable<T>>
  add(value: T): Promise<void>
  addAll(values: T[]): Promise<void>
  update(values: T[]): Promise<void>
  clear(): Promise<void>
}

/**
 * Nested map state for a key
 */
export interface MapState<K, V> {
  get(key: K): Promise<V | undefined>
  put(key: K, value: V): Promise<void>
  putAll(map: Map<K, V>): Promise<void>
  remove(key: K): Promise<void>
  contains(key: K): Promise<boolean>
  keys(): Promise<Iterable<K>>
  values(): Promise<Iterable<V>>
  entries(): Promise<Iterable<[K, V]>>
  isEmpty(): Promise<boolean>
  size(): Promise<number>
  clear(): Promise<void>
}

/**
 * Reducing state that auto-applies a reduce function
 */
export interface ReducingState<T> {
  get(): Promise<T | null>
  add(value: T): Promise<void>
  clear(): Promise<void>
}

/**
 * Aggregating state with input, accumulator, and output types
 */
export interface AggregatingState<IN, OUT> {
  get(): Promise<OUT | null>
  add(value: IN): Promise<void>
  clear(): Promise<void>
}

// =============================================================================
// Function Interfaces
// =============================================================================

/**
 * Reduce function interface
 */
export interface ReduceFunction<T> {
  reduce(value1: T, value2: T): T
}

/**
 * Aggregate function interface
 */
export interface AggregateFunction<IN, ACC, OUT> {
  createAccumulator(): ACC
  add(value: IN, accumulator: ACC): ACC
  getResult(accumulator: ACC): OUT
  merge?(a: ACC, b: ACC): ACC
}

// =============================================================================
// Runtime Context
// =============================================================================

/**
 * Runtime context providing access to state and metadata
 */
export interface RuntimeContext {
  getNumberOfParallelSubtasks(): number
  getIndexOfThisSubtask(): number
  getState<T>(descriptor: ValueStateDescriptor<T>): ValueState<T>
  getListState<T>(descriptor: ListStateDescriptor<T>): ListState<T>
  getMapState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V>
  getReducingState<T>(descriptor: ReducingStateDescriptor<T>): ReducingState<T>
  getAggregatingState<IN, ACC, OUT>(
    descriptor: AggregatingStateDescriptor<IN, ACC, OUT>
  ): AggregatingState<IN, OUT>
}

// =============================================================================
// Timer Service
// =============================================================================

/**
 * Timer domain
 */
export type TimeDomain = 'EVENT_TIME' | 'PROCESSING_TIME'

/**
 * Timer callback
 */
export interface TimerCallback<K> {
  (timestamp: number, key: K, domain: TimeDomain): Promise<void>
}

/**
 * Timer service for scheduled callbacks
 */
export interface TimerService {
  currentProcessingTime(): number
  currentWatermark(): number
  registerEventTimeTimer(time: number): void
  registerProcessingTimeTimer(time: number): void
  deleteEventTimeTimer(time: number): void
  deleteProcessingTimeTimer(time: number): void
}

/**
 * Internal timer representation
 */
export interface InternalTimer<K> {
  key: K
  timestamp: number
  domain: TimeDomain
}

/**
 * Timer implementation with event-time and processing-time support
 */
export class TimerServiceImpl<K> implements TimerService {
  private eventTimeTimers = new Map<string, InternalTimer<K>>()
  private processingTimeTimers = new Map<string, InternalTimer<K>>()
  private watermark = Number.MIN_SAFE_INTEGER
  private processingTimeInterval: ReturnType<typeof setInterval> | null = null
  private currentKey: K | null = null

  constructor(
    private onTimerCallback?: TimerCallback<K>,
    private processingTimeCheckInterval = 100
  ) {}

  setCurrentKey(key: K): void {
    this.currentKey = key
  }

  getCurrentKey(): K | null {
    return this.currentKey
  }

  currentProcessingTime(): number {
    return Date.now()
  }

  currentWatermark(): number {
    return this.watermark
  }

  setWatermark(watermark: number): void {
    this.watermark = watermark
  }

  registerEventTimeTimer(time: number): void {
    if (this.currentKey === null) {
      throw new Error('No current key set')
    }
    const key = this.timerKey(this.currentKey, time, 'EVENT_TIME')
    this.eventTimeTimers.set(key, {
      key: this.currentKey,
      timestamp: time,
      domain: 'EVENT_TIME',
    })
  }

  registerProcessingTimeTimer(time: number): void {
    if (this.currentKey === null) {
      throw new Error('No current key set')
    }
    const key = this.timerKey(this.currentKey, time, 'PROCESSING_TIME')
    this.processingTimeTimers.set(key, {
      key: this.currentKey,
      timestamp: time,
      domain: 'PROCESSING_TIME',
    })
  }

  deleteEventTimeTimer(time: number): void {
    if (this.currentKey === null) {
      throw new Error('No current key set')
    }
    const key = this.timerKey(this.currentKey, time, 'EVENT_TIME')
    this.eventTimeTimers.delete(key)
  }

  deleteProcessingTimeTimer(time: number): void {
    if (this.currentKey === null) {
      throw new Error('No current key set')
    }
    const key = this.timerKey(this.currentKey, time, 'PROCESSING_TIME')
    this.processingTimeTimers.delete(key)
  }

  /**
   * Advance event time and fire any due timers
   */
  async advanceWatermark(watermark: number): Promise<InternalTimer<K>[]> {
    this.watermark = watermark
    const firedTimers: InternalTimer<K>[] = []

    for (const [key, timer] of this.eventTimeTimers) {
      if (timer.timestamp <= watermark) {
        firedTimers.push(timer)
        this.eventTimeTimers.delete(key)
      }
    }

    // Sort by timestamp for deterministic ordering
    firedTimers.sort((a, b) => a.timestamp - b.timestamp)

    // Fire callbacks
    for (const timer of firedTimers) {
      if (this.onTimerCallback) {
        await this.onTimerCallback(timer.timestamp, timer.key, timer.domain)
      }
    }

    return firedTimers
  }

  /**
   * Check and fire processing time timers
   */
  async checkProcessingTimeTimers(): Promise<InternalTimer<K>[]> {
    const now = Date.now()
    const firedTimers: InternalTimer<K>[] = []

    for (const [key, timer] of this.processingTimeTimers) {
      if (timer.timestamp <= now) {
        firedTimers.push(timer)
        this.processingTimeTimers.delete(key)
      }
    }

    // Sort by timestamp
    firedTimers.sort((a, b) => a.timestamp - b.timestamp)

    // Fire callbacks
    for (const timer of firedTimers) {
      if (this.onTimerCallback) {
        await this.onTimerCallback(timer.timestamp, timer.key, timer.domain)
      }
    }

    return firedTimers
  }

  /**
   * Start periodic processing time timer checks
   */
  startProcessingTimeChecks(): void {
    if (this.processingTimeInterval === null) {
      this.processingTimeInterval = setInterval(() => {
        this.checkProcessingTimeTimers()
      }, this.processingTimeCheckInterval)
    }
  }

  /**
   * Stop periodic processing time timer checks
   */
  stopProcessingTimeChecks(): void {
    if (this.processingTimeInterval !== null) {
      clearInterval(this.processingTimeInterval)
      this.processingTimeInterval = null
    }
  }

  /**
   * Get all pending event time timers
   */
  getEventTimeTimers(): InternalTimer<K>[] {
    return Array.from(this.eventTimeTimers.values())
  }

  /**
   * Get all pending processing time timers
   */
  getProcessingTimeTimers(): InternalTimer<K>[] {
    return Array.from(this.processingTimeTimers.values())
  }

  /**
   * Clear all timers
   */
  clear(): void {
    this.stopProcessingTimeChecks()
    this.eventTimeTimers.clear()
    this.processingTimeTimers.clear()
  }

  private timerKey(key: K, timestamp: number, domain: TimeDomain): string {
    return `${String(key)}:${timestamp}:${domain}`
  }
}

// =============================================================================
// Context and Collector
// =============================================================================

/**
 * Processing context with timestamp and timer access
 */
export interface Context<K = unknown> {
  timestamp(): number | null
  timerService(): TimerService
  getCurrentKey(): K
}

/**
 * Timer callback context
 */
export interface OnTimerContext<K = unknown> extends Context<K> {
  timeDomain(): TimeDomain
}

/**
 * Collector for outputting elements
 */
export interface Collector<T> {
  collect(element: T): void
  close(): void
}

/**
 * Simple array-based collector implementation
 */
export class ArrayCollector<T> implements Collector<T> {
  private elements: T[] = []

  collect(element: T): void {
    this.elements.push(element)
  }

  close(): void {
    // No-op for array collector
  }

  getElements(): T[] {
    return this.elements
  }

  clear(): void {
    this.elements = []
  }
}

// =============================================================================
// State Implementations
// =============================================================================

/**
 * Value state implementation using StateBackend
 */
export class ValueStateImpl<T> implements ValueState<T> {
  private _value: T | null = null
  private _initialized = false

  constructor(
    private backend: StateBackend<T>,
    private keyPrefix: string,
    private stateName: string,
    private defaultValue: T | null = null,
    private ttlConfig?: StateTTLConfig
  ) {}

  private get stateKey(): string {
    return `${this.keyPrefix}:${this.stateName}`
  }

  async value(): Promise<T | null> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._value = stored !== undefined ? stored : this.defaultValue
      this._initialized = true
    }
    return this._value
  }

  async update(value: T): Promise<void> {
    this._value = value
    this._initialized = true
    const ttl = this.ttlConfig?.ttlMs
    await this.backend.put(this.stateKey, value, ttl)
  }

  async clear(): Promise<void> {
    this._value = null
    this._initialized = false
    await this.backend.delete(this.stateKey)
  }
}

/**
 * List state implementation using StateBackend
 */
export class ListStateImpl<T> implements ListState<T> {
  private _list: T[] | null = null
  private _initialized = false

  constructor(
    private backend: StateBackend<T[]>,
    private keyPrefix: string,
    private stateName: string
  ) {}

  private get stateKey(): string {
    return `${this.keyPrefix}:${this.stateName}`
  }

  async get(): Promise<Iterable<T>> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._list = stored ?? []
      this._initialized = true
    }
    return this._list ?? []
  }

  async add(value: T): Promise<void> {
    await this.get() // Ensure initialized
    this._list!.push(value)
    await this.backend.put(this.stateKey, this._list!)
  }

  async addAll(values: T[]): Promise<void> {
    await this.get() // Ensure initialized
    this._list!.push(...values)
    await this.backend.put(this.stateKey, this._list!)
  }

  async update(values: T[]): Promise<void> {
    this._list = [...values]
    this._initialized = true
    await this.backend.put(this.stateKey, this._list)
  }

  async clear(): Promise<void> {
    this._list = []
    this._initialized = true
    await this.backend.put(this.stateKey, this._list)
  }
}

/**
 * Map state implementation using StateBackend
 */
export class MapStateImpl<K, V> implements MapState<K, V> {
  private _map: Map<K, V> | null = null
  private _initialized = false

  constructor(
    private backend: StateBackend<Array<[K, V]>>,
    private keyPrefix: string,
    private stateName: string
  ) {}

  private get stateKey(): string {
    return `${this.keyPrefix}:${this.stateName}`
  }

  private async ensureInitialized(): Promise<Map<K, V>> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._map = stored ? new Map(stored) : new Map()
      this._initialized = true
    }
    return this._map!
  }

  private async persist(): Promise<void> {
    if (this._map) {
      await this.backend.put(this.stateKey, Array.from(this._map.entries()))
    }
  }

  async get(key: K): Promise<V | undefined> {
    const map = await this.ensureInitialized()
    return map.get(key)
  }

  async put(key: K, value: V): Promise<void> {
    const map = await this.ensureInitialized()
    map.set(key, value)
    await this.persist()
  }

  async putAll(entries: Map<K, V>): Promise<void> {
    const map = await this.ensureInitialized()
    for (const [k, v] of entries) {
      map.set(k, v)
    }
    await this.persist()
  }

  async remove(key: K): Promise<void> {
    const map = await this.ensureInitialized()
    map.delete(key)
    await this.persist()
  }

  async contains(key: K): Promise<boolean> {
    const map = await this.ensureInitialized()
    return map.has(key)
  }

  async keys(): Promise<Iterable<K>> {
    const map = await this.ensureInitialized()
    return map.keys()
  }

  async values(): Promise<Iterable<V>> {
    const map = await this.ensureInitialized()
    return map.values()
  }

  async entries(): Promise<Iterable<[K, V]>> {
    const map = await this.ensureInitialized()
    return map.entries()
  }

  async isEmpty(): Promise<boolean> {
    const map = await this.ensureInitialized()
    return map.size === 0
  }

  async size(): Promise<number> {
    const map = await this.ensureInitialized()
    return map.size
  }

  async clear(): Promise<void> {
    this._map = new Map()
    this._initialized = true
    await this.backend.put(this.stateKey, [])
  }
}

/**
 * Reducing state implementation
 */
export class ReducingStateImpl<T> implements ReducingState<T> {
  private _value: T | null = null
  private _initialized = false

  constructor(
    private backend: StateBackend<T>,
    private keyPrefix: string,
    private stateName: string,
    private reduceFunction: ReduceFunction<T>
  ) {}

  private get stateKey(): string {
    return `${this.keyPrefix}:${this.stateName}`
  }

  async get(): Promise<T | null> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._value = stored !== undefined ? stored : null
      this._initialized = true
    }
    return this._value
  }

  async add(value: T): Promise<void> {
    const current = await this.get()
    if (current === null) {
      this._value = value
    } else {
      this._value = this.reduceFunction.reduce(current, value)
    }
    await this.backend.put(this.stateKey, this._value!)
  }

  async clear(): Promise<void> {
    this._value = null
    this._initialized = false
    await this.backend.delete(this.stateKey)
  }
}

/**
 * Aggregating state implementation
 */
export class AggregatingStateImpl<IN, ACC, OUT> implements AggregatingState<IN, OUT> {
  private _accumulator: ACC | null = null
  private _initialized = false

  constructor(
    private backend: StateBackend<ACC>,
    private keyPrefix: string,
    private stateName: string,
    private aggregateFunction: AggregateFunction<IN, ACC, OUT>
  ) {}

  private get stateKey(): string {
    return `${this.keyPrefix}:${this.stateName}`
  }

  async get(): Promise<OUT | null> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._accumulator = stored !== undefined ? stored : null
      this._initialized = true
    }
    if (this._accumulator === null) {
      return null
    }
    return this.aggregateFunction.getResult(this._accumulator)
  }

  async add(value: IN): Promise<void> {
    if (!this._initialized) {
      const stored = await this.backend.get(this.stateKey)
      this._accumulator = stored !== undefined ? stored : this.aggregateFunction.createAccumulator()
      this._initialized = true
    }
    if (this._accumulator === null) {
      this._accumulator = this.aggregateFunction.createAccumulator()
    }
    this._accumulator = this.aggregateFunction.add(value, this._accumulator)
    await this.backend.put(this.stateKey, this._accumulator)
  }

  async clear(): Promise<void> {
    this._accumulator = null
    this._initialized = false
    await this.backend.delete(this.stateKey)
  }
}

// =============================================================================
// Runtime Context Implementation
// =============================================================================

/**
 * Runtime context implementation with state backend
 */
export class RuntimeContextImpl implements RuntimeContext {
  private states = new Map<string, unknown>()

  constructor(
    private backend: StateBackend<unknown>,
    private keyPrefix: string,
    private parallelism: number = 1,
    private subtaskIndex: number = 0
  ) {}

  getNumberOfParallelSubtasks(): number {
    return this.parallelism
  }

  getIndexOfThisSubtask(): number {
    return this.subtaskIndex
  }

  getState<T>(descriptor: ValueStateDescriptor<T>): ValueState<T> {
    const key = `value:${descriptor.name}`
    if (!this.states.has(key)) {
      const state = new ValueStateImpl<T>(
        this.backend as StateBackend<T>,
        this.keyPrefix,
        descriptor.name,
        descriptor.defaultValue ?? null,
        descriptor.getTtlConfig?.()
      )
      this.states.set(key, state)
    }
    return this.states.get(key) as ValueState<T>
  }

  getListState<T>(descriptor: ListStateDescriptor<T>): ListState<T> {
    const key = `list:${descriptor.name}`
    if (!this.states.has(key)) {
      const state = new ListStateImpl<T>(
        this.backend as StateBackend<T[]>,
        this.keyPrefix,
        descriptor.name
      )
      this.states.set(key, state)
    }
    return this.states.get(key) as ListState<T>
  }

  getMapState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V> {
    const key = `map:${descriptor.name}`
    if (!this.states.has(key)) {
      const state = new MapStateImpl<K, V>(
        this.backend as StateBackend<Array<[K, V]>>,
        this.keyPrefix,
        descriptor.name
      )
      this.states.set(key, state)
    }
    return this.states.get(key) as MapState<K, V>
  }

  getReducingState<T>(descriptor: ReducingStateDescriptor<T>): ReducingState<T> {
    const key = `reducing:${descriptor.name}`
    if (!this.states.has(key)) {
      const state = new ReducingStateImpl<T>(
        this.backend as StateBackend<T>,
        this.keyPrefix,
        descriptor.name,
        descriptor.reduceFunction
      )
      this.states.set(key, state)
    }
    return this.states.get(key) as ReducingState<T>
  }

  getAggregatingState<IN, ACC, OUT>(
    descriptor: AggregatingStateDescriptor<IN, ACC, OUT>
  ): AggregatingState<IN, OUT> {
    const key = `aggregating:${descriptor.name}`
    if (!this.states.has(key)) {
      const state = new AggregatingStateImpl<IN, ACC, OUT>(
        this.backend as StateBackend<ACC>,
        this.keyPrefix,
        descriptor.name,
        descriptor.aggregateFunction
      )
      this.states.set(key, state)
    }
    return this.states.get(key) as AggregatingState<IN, OUT>
  }

  /**
   * Update the key prefix (called when processing key changes)
   */
  setKeyPrefix(keyPrefix: string): void {
    this.keyPrefix = keyPrefix
    this.states.clear() // Clear cached states for new key
  }
}

// =============================================================================
// Checkpoint Types
// =============================================================================

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
  checkpointId: bigint
  timestamp: number
  operatorStates: Map<string, string>
  timerStates: Map<string, InternalTimer<unknown>[]>
}

/**
 * Checkpoint snapshot
 */
export interface Checkpoint {
  id: bigint
  timestamp: number
  stateSnapshots: Map<string, StateSnapshot>
  eventTimeTimers: InternalTimer<unknown>[]
  processingTimeTimers: InternalTimer<unknown>[]
  watermark: number
}

/**
 * Checkpoint configuration
 */
export interface CheckpointConfig {
  mode: 'exactly-once' | 'at-least-once'
  intervalMs: number
  timeout: number
  minPauseBetweenCheckpoints: number
  maxConcurrentCheckpoints: number
}

// =============================================================================
// Stateful Operator
// =============================================================================

/**
 * Operator lifecycle state
 */
export type OperatorState = 'CREATED' | 'OPEN' | 'RUNNING' | 'CLOSED'

/**
 * Configuration for StatefulOperator
 */
export interface StatefulOperatorConfig<K> {
  operatorName: string
  backend?: StateBackend<unknown>
  timerService?: TimerServiceImpl<K>
  watermarkService?: WatermarkServiceInterface
  checkpointConfig?: CheckpointConfig
}

/**
 * Base class for stateful stream operators
 *
 * Provides:
 * - Lifecycle management (open, close)
 * - Runtime context for state access
 * - Timer service for scheduled callbacks
 * - Checkpoint/restore for fault tolerance
 */
export abstract class StatefulOperator<IN, OUT, K = string> {
  protected runtimeContext!: RuntimeContextImpl
  protected timerService: TimerServiceImpl<K>
  protected watermarkService: WatermarkServiceInterface
  protected operatorState: OperatorState = 'CREATED'
  protected checkpointConfig?: CheckpointConfig

  private backend: StateBackend<unknown>
  private operatorName: string
  private checkpointIdCounter = 0n
  private stateSnapshots = new Map<string, StateSnapshot>()

  constructor(config: StatefulOperatorConfig<K>) {
    this.operatorName = config.operatorName
    this.backend = config.backend ?? new InMemoryStateBackend('operator-state')
    this.timerService = config.timerService ?? new TimerServiceImpl<K>(
      this.onTimerInternal.bind(this)
    )
    this.watermarkService = config.watermarkService ?? new WatermarkService()
    this.checkpointConfig = config.checkpointConfig
  }

  /**
   * Get the runtime context for state access
   */
  getRuntimeContext(): RuntimeContext {
    return this.runtimeContext
  }

  /**
   * Get the timer service
   */
  getTimerService(): TimerService {
    return this.timerService
  }

  /**
   * Initialize the operator (called before processing)
   */
  async open(): Promise<void> {
    if (this.operatorState !== 'CREATED') {
      throw new Error(`Cannot open operator in state: ${this.operatorState}`)
    }

    this.runtimeContext = new RuntimeContextImpl(
      this.backend,
      `${this.operatorName}:default`
    )

    this.timerService.startProcessingTimeChecks()
    this.operatorState = 'OPEN'

    // Call user initialization hook
    await this.initializeState()
  }

  /**
   * User hook for initializing state
   */
  protected async initializeState(): Promise<void> {
    // Override in subclass
  }

  /**
   * Process an input element
   */
  async process(
    element: IN,
    key: K,
    timestamp: number | null,
    collector: Collector<OUT>
  ): Promise<void> {
    if (this.operatorState !== 'OPEN' && this.operatorState !== 'RUNNING') {
      throw new Error(`Cannot process in state: ${this.operatorState}`)
    }

    this.operatorState = 'RUNNING'

    // Set current key context
    this.timerService.setCurrentKey(key)
    this.runtimeContext.setKeyPrefix(`${this.operatorName}:${String(key)}`)

    // Create context
    const ctx: Context<K> = {
      timestamp: () => timestamp,
      timerService: () => this.timerService,
      getCurrentKey: () => key,
    }

    // Process element
    await this.processElement(element, ctx, collector)
  }

  /**
   * User implementation of element processing
   */
  protected abstract processElement(
    element: IN,
    ctx: Context<K>,
    out: Collector<OUT>
  ): Promise<void>

  /**
   * Advance watermark and fire event-time timers
   */
  async advanceWatermark(watermark: number): Promise<void> {
    this.watermarkService.advance(watermark)
    await this.timerService.advanceWatermark(watermark)
  }

  /**
   * Handle timer callback
   */
  protected async onTimer(
    timestamp: number,
    key: K,
    domain: TimeDomain,
    collector: Collector<OUT>
  ): Promise<void> {
    // Override in subclass to handle timers
  }

  /**
   * Internal timer callback that sets up context and calls user handler
   */
  private async onTimerInternal(
    timestamp: number,
    key: K,
    domain: TimeDomain
  ): Promise<void> {
    this.timerService.setCurrentKey(key)
    this.runtimeContext.setKeyPrefix(`${this.operatorName}:${String(key)}`)

    const collector = new ArrayCollector<OUT>()
    await this.onTimer(timestamp, key, domain, collector)

    // Note: In a real implementation, collected elements would be forwarded
    // to downstream operators
  }

  /**
   * Create a checkpoint
   */
  async checkpoint(): Promise<Checkpoint> {
    const checkpointId = ++this.checkpointIdCounter
    const timestamp = Date.now()

    // Snapshot state
    const stateSnapshot = await this.backend.snapshot()

    return {
      id: checkpointId,
      timestamp,
      stateSnapshots: new Map([['main', stateSnapshot]]),
      eventTimeTimers: this.timerService.getEventTimeTimers() as InternalTimer<unknown>[],
      processingTimeTimers: this.timerService.getProcessingTimeTimers() as InternalTimer<unknown>[],
      watermark: this.watermarkService.current(),
    }
  }

  /**
   * Restore from a checkpoint
   */
  async restore(checkpoint: Checkpoint): Promise<void> {
    // Restore state
    const stateSnapshot = checkpoint.stateSnapshots.get('main')
    if (stateSnapshot) {
      await this.backend.restore(stateSnapshot)
    }

    // Restore timers
    this.timerService.clear()
    for (const timer of checkpoint.eventTimeTimers as InternalTimer<K>[]) {
      this.timerService.setCurrentKey(timer.key)
      this.timerService.registerEventTimeTimer(timer.timestamp)
    }
    for (const timer of checkpoint.processingTimeTimers as InternalTimer<K>[]) {
      this.timerService.setCurrentKey(timer.key)
      this.timerService.registerProcessingTimeTimer(timer.timestamp)
    }

    // Restore watermark
    this.timerService.setWatermark(checkpoint.watermark)
  }

  /**
   * Close the operator and release resources
   */
  async close(): Promise<void> {
    if (this.operatorState === 'CLOSED') {
      return
    }

    this.timerService.stopProcessingTimeChecks()
    this.timerService.clear()
    this.operatorState = 'CLOSED'
  }

  /**
   * Get current operator state
   */
  getOperatorState(): OperatorState {
    return this.operatorState
  }
}

// =============================================================================
// Keyed Process Function
// =============================================================================

/**
 * Keyed process function with state and timer access
 */
export abstract class KeyedProcessFunction<K, IN, OUT> extends StatefulOperator<IN, OUT, K> {
  constructor(operatorName: string, backend?: StateBackend<unknown>) {
    super({ operatorName, backend })
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a value state descriptor
 */
export function valueStateDescriptor<T>(
  name: string,
  defaultValue?: T,
  ttl?: StateTTLConfig
): ValueStateDescriptor<T> {
  return {
    name,
    defaultValue,
    getTtlConfig: () => ttl,
  }
}

/**
 * Create a list state descriptor
 */
export function listStateDescriptor<T>(name: string): ListStateDescriptor<T> {
  return { name }
}

/**
 * Create a map state descriptor
 */
export function mapStateDescriptor<K, V>(name: string): MapStateDescriptor<K, V> {
  return { name }
}

/**
 * Create a reducing state descriptor
 */
export function reducingStateDescriptor<T>(
  name: string,
  reduceFunction: ReduceFunction<T>
): ReducingStateDescriptor<T> {
  return { name, reduceFunction }
}

/**
 * Create an aggregating state descriptor
 */
export function aggregatingStateDescriptor<IN, ACC, OUT>(
  name: string,
  aggregateFunction: AggregateFunction<IN, ACC, OUT>
): AggregatingStateDescriptor<IN, ACC, OUT> {
  return { name, aggregateFunction }
}

// =============================================================================
// Re-exports
// =============================================================================

export { InMemoryStateBackend } from '../stateful-operator'
export type { StateBackend, StateSnapshot } from '../stateful-operator'
export { WatermarkService } from '../watermark-service'
export type { WatermarkServiceInterface } from '../watermark-service'
