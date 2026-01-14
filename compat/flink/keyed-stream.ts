/**
 * @dotdo/flink - KeyedStream with State Backends
 * Issue: dotdo-gwy17
 *
 * Implements Flink KeyedStream API with state backends for stateful stream processing
 * on Durable Objects. Each key maps to isolated state.
 *
 * Features:
 * - KeyedStream class extending DataStream
 * - State backends: DOStateBackend (Durable Objects), MemoryStateBackend
 * - ValueState, ListState, MapState, ReducingState, AggregatingState implementations
 * - RuntimeContext for state access
 * - Keyed aggregations (sum, min, max, reduce, fold, aggregate)
 * - KeyedProcessFunction support with timers
 * - Interval joins and broadcast state pattern
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/overview/#keyedstream-transformations
 */

import type {
  StateBackend as StatefulOperatorBackend,
  StateSnapshot,
} from '../../db/primitives/stateful-operator'
import {
  InMemoryStateBackend as StatefulInMemoryBackend,
} from '../../db/primitives/stateful-operator'
import {
  DOStateBackend as StatefulDOBackend,
  type DurableObjectStorage,
} from '../../db/primitives/stateful-operator/backends'

import type {
  RuntimeContext,
  TimerService,
  Context,
  OnTimerContext,
  Collector,
  ValueState,
  ListState,
  MapState,
  ReducingState,
  AggregatingState,
  ValueStateDescriptor,
  ListStateDescriptor,
  MapStateDescriptor,
  ReducingStateDescriptor,
  AggregatingStateDescriptor,
  AggregateFunction,
  ReduceFunction,
  TimeWindow,
  WindowAssigner,
  WatermarkGenerator,
  OutputTag,
} from './index'

// ===========================================================================
// State Backends
// ===========================================================================

/**
 * Memory-based state backend for testing and development
 */
export class MemoryStateBackend {
  private states = new Map<string, Map<string, any>>()

  constructor(public readonly name: string = 'memory') {}

  getStateStore(key: string): Map<string, any> {
    if (!this.states.has(key)) {
      this.states.set(key, new Map())
    }
    return this.states.get(key)!
  }

  clear(): void {
    this.states.clear()
  }
}

/**
 * Durable Object-based state backend for production
 */
export class DOStateBackend {
  private backends = new Map<string, StatefulDOBackend<any>>()

  constructor(
    private storage: DurableObjectStorage,
    public readonly name: string = 'do'
  ) {}

  getBackend<T>(stateName: string): StatefulDOBackend<T> {
    if (!this.backends.has(stateName)) {
      this.backends.set(
        stateName,
        new StatefulDOBackend<T>(this.storage, `${this.name}:${stateName}`)
      )
    }
    return this.backends.get(stateName)! as StatefulDOBackend<T>
  }

  async snapshot(): Promise<Map<string, StateSnapshot>> {
    const snapshots = new Map<string, StateSnapshot>()
    for (const [name, backend] of this.backends) {
      snapshots.set(name, await backend.snapshot())
    }
    return snapshots
  }

  async restore(snapshots: Map<string, StateSnapshot>): Promise<void> {
    for (const [name, snapshot] of snapshots) {
      const backend = this.getBackend(name)
      await backend.restore(snapshot)
    }
  }

  async clear(): Promise<void> {
    for (const backend of this.backends.values()) {
      await backend.clear()
    }
    this.backends.clear()
  }
}

// ===========================================================================
// Enhanced State Implementations with TTL Support
// ===========================================================================

interface TTLMetadata {
  lastAccess: number
  ttlMs?: number
  updateType?: 'OnCreateAndWrite' | 'OnReadAndWrite'
}

/**
 * Value state implementation with TTL support
 */
class ValueStateWithTTL<T> implements ValueState<T> {
  private metadata: TTLMetadata = { lastAccess: Date.now() }

  constructor(
    private stateStore: Map<string, any>,
    private name: string,
    private defaultValue: T | null,
    private ttlConfig?: { ttlMs: number; updateType: string; visibility: string }
  ) {
    if (ttlConfig) {
      this.metadata.ttlMs = ttlConfig.ttlMs
      this.metadata.updateType = ttlConfig.updateType as TTLMetadata['updateType']
    }
  }

  value(): T | null {
    if (this.isExpired()) {
      this.clear()
      return this.defaultValue
    }

    if (this.ttlConfig?.updateType === 'OnReadAndWrite') {
      this.metadata.lastAccess = Date.now()
    }

    return this.stateStore.has(this.name) ? this.stateStore.get(this.name) : this.defaultValue
  }

  update(value: T): void {
    this.stateStore.set(this.name, value)
    if (this.ttlConfig) {
      this.metadata.lastAccess = Date.now()
    }
  }

  clear(): void {
    this.stateStore.delete(this.name)
  }

  private isExpired(): boolean {
    if (!this.metadata.ttlMs) return false
    const elapsed = Date.now() - this.metadata.lastAccess
    return elapsed >= this.metadata.ttlMs
  }
}

/**
 * List state implementation
 */
class ListStateImpl<T> implements ListState<T> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, [])
    }
  }

  get(): Iterable<T> {
    return this.stateStore.get(this.name) ?? []
  }

  add(value: T): void {
    const list = this.stateStore.get(this.name) ?? []
    list.push(value)
    this.stateStore.set(this.name, list)
  }

  addAll(values: T[]): void {
    const list = this.stateStore.get(this.name) ?? []
    list.push(...values)
    this.stateStore.set(this.name, list)
  }

  update(values: T[]): void {
    this.stateStore.set(this.name, [...values])
  }

  clear(): void {
    this.stateStore.set(this.name, [])
  }
}

/**
 * Map state implementation
 */
class MapStateImpl<K, V> implements MapState<K, V> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, new Map<K, V>())
    }
  }

  private getMap(): Map<K, V> {
    return this.stateStore.get(this.name)
  }

  get(key: K): V | undefined {
    return this.getMap().get(key)
  }

  put(key: K, value: V): void {
    this.getMap().set(key, value)
  }

  putAll(map: Map<K, V>): void {
    for (const [k, v] of map) {
      this.getMap().set(k, v)
    }
  }

  remove(key: K): void {
    this.getMap().delete(key)
  }

  contains(key: K): boolean {
    return this.getMap().has(key)
  }

  keys(): Iterable<K> {
    return this.getMap().keys()
  }

  values(): Iterable<V> {
    return this.getMap().values()
  }

  entries(): Iterable<[K, V]> {
    return this.getMap().entries()
  }

  isEmpty(): boolean {
    return this.getMap().size === 0
  }

  size(): number {
    return this.getMap().size
  }

  clear(): void {
    this.getMap().clear()
  }
}

/**
 * Reducing state implementation
 */
class ReducingStateImpl<T> implements ReducingState<T> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string,
    private reduceFunction: (a: T, b: T) => T,
    private defaultValue: T | null
  ) {}

  get(): T | null {
    return this.stateStore.has(this.name) ? this.stateStore.get(this.name) : this.defaultValue
  }

  add(value: T): void {
    const current = this.get()
    if (current === null) {
      this.stateStore.set(this.name, value)
    } else {
      this.stateStore.set(this.name, this.reduceFunction(current, value))
    }
  }

  clear(): void {
    this.stateStore.delete(this.name)
  }
}

/**
 * Aggregating state implementation
 */
class AggregatingStateImpl<IN, ACC, OUT> implements AggregatingState<IN, OUT> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string,
    private aggregateFunction: AggregateFunction<IN, ACC, OUT>
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, this.aggregateFunction.createAccumulator())
    }
  }

  get(): OUT | null {
    const acc = this.stateStore.get(this.name)
    return acc !== undefined ? this.aggregateFunction.getResult(acc) : null
  }

  add(value: IN): void {
    const acc = this.stateStore.get(this.name) ?? this.aggregateFunction.createAccumulator()
    this.stateStore.set(this.name, this.aggregateFunction.add(value, acc))
  }

  clear(): void {
    this.stateStore.set(this.name, this.aggregateFunction.createAccumulator())
  }
}

// ===========================================================================
// Enhanced Runtime Context
// ===========================================================================

/**
 * Enhanced runtime context with TTL-aware state creation
 */
export class KeyedRuntimeContext implements RuntimeContext {
  constructor(
    private stateStore: Map<string, any>,
    private parallelism: number = 1,
    private subtaskIndex: number = 0,
    private currentTimestamp?: number
  ) {}

  getNumberOfParallelSubtasks(): number {
    return this.parallelism
  }

  getIndexOfThisSubtask(): number {
    return this.subtaskIndex
  }

  getState<T>(descriptor: ValueStateDescriptor<T>): ValueState<T> {
    const ttlConfig = descriptor.getTtlConfig?.()
    if (ttlConfig) {
      return new ValueStateWithTTL<T>(
        this.stateStore,
        descriptor.name,
        descriptor.defaultValue ?? null,
        {
          ttlMs: ttlConfig.getTtl().toMilliseconds(),
          updateType: ttlConfig.getUpdateType(),
          visibility: ttlConfig.getStateVisibility(),
        }
      )
    }
    return new ValueStateWithTTL<T>(this.stateStore, descriptor.name, descriptor.defaultValue ?? null)
  }

  getListState<T>(descriptor: ListStateDescriptor<T>): ListState<T> {
    return new ListStateImpl<T>(this.stateStore, descriptor.name)
  }

  getMapState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V> {
    return new MapStateImpl<K, V>(this.stateStore, descriptor.name)
  }

  getReducingState<T>(descriptor: ReducingStateDescriptor<T>): ReducingState<T> {
    return new ReducingStateImpl<T>(
      this.stateStore,
      descriptor.name,
      descriptor.reduceFunction,
      descriptor.defaultValue
    )
  }

  getAggregatingState<IN, ACC, OUT>(
    descriptor: AggregatingStateDescriptor<IN, ACC, OUT>
  ): AggregatingState<IN, OUT> {
    return new AggregatingStateImpl<IN, ACC, OUT>(
      this.stateStore,
      descriptor.name,
      descriptor.aggregateFunction
    )
  }

  setCurrentTimestamp(timestamp: number): void {
    this.currentTimestamp = timestamp
  }

  getCurrentTimestamp(): number | undefined {
    return this.currentTimestamp
  }
}

// ===========================================================================
// Enhanced Timer Service
// ===========================================================================

/**
 * Enhanced timer service with proper watermark tracking
 */
export class KeyedTimerService implements TimerService {
  private watermark = Number.MIN_SAFE_INTEGER
  private eventTimeTimers = new Set<number>()
  private processingTimeTimers = new Set<number>()

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
    this.eventTimeTimers.add(time)
  }

  registerProcessingTimeTimer(time: number): void {
    this.processingTimeTimers.add(time)
  }

  deleteEventTimeTimer(time: number): void {
    this.eventTimeTimers.delete(time)
  }

  deleteProcessingTimeTimer(time: number): void {
    this.processingTimeTimers.delete(time)
  }

  getEventTimeTimers(): Set<number> {
    return this.eventTimeTimers
  }

  getProcessingTimeTimers(): Set<number> {
    return this.processingTimeTimers
  }

  fireEventTimeTimers(currentWatermark: number): number[] {
    const fired: number[] = []
    for (const time of this.eventTimeTimers) {
      if (time <= currentWatermark) {
        fired.push(time)
      }
    }
    for (const time of fired) {
      this.eventTimeTimers.delete(time)
    }
    return fired.sort((a, b) => a - b)
  }

  fireProcessingTimeTimers(currentTime: number): number[] {
    const fired: number[] = []
    for (const time of this.processingTimeTimers) {
      if (time <= currentTime) {
        fired.push(time)
      }
    }
    for (const time of fired) {
      this.processingTimeTimers.delete(time)
    }
    return fired.sort((a, b) => a - b)
  }
}

// ===========================================================================
// Keyed Context with getCurrentKey()
// ===========================================================================

/**
 * Context interface with getCurrentKey() for KeyedProcessFunction
 */
export interface KeyedContext<K> extends Context {
  getCurrentKey(): K
}

/**
 * Implementation of keyed context
 */
export class KeyedContextImpl<K> implements KeyedContext<K> {
  constructor(
    private currentKey: K,
    private timestampValue: number | null,
    private timerServiceInstance: TimerService,
    private sideOutputs: Map<string, any[]>
  ) {}

  getCurrentKey(): K {
    return this.currentKey
  }

  timestamp(): number | null {
    return this.timestampValue
  }

  timerService(): TimerService {
    return this.timerServiceInstance
  }

  output<T>(tag: OutputTag<T>, value: T): void {
    if (!this.sideOutputs.has(tag.id)) {
      this.sideOutputs.set(tag.id, [])
    }
    this.sideOutputs.get(tag.id)!.push(value)
  }
}

/**
 * OnTimer context implementation
 */
export class KeyedOnTimerContext<K> implements OnTimerContext {
  constructor(
    private currentKey: K,
    private timestampValue: number,
    private timerServiceInstance: TimerService,
    private sideOutputs: Map<string, any[]>,
    private domain: 'EVENT_TIME' | 'PROCESSING_TIME'
  ) {}

  getCurrentKey(): K {
    return this.currentKey
  }

  timestamp(): number {
    return this.timestampValue
  }

  timerService(): TimerService {
    return this.timerServiceInstance
  }

  timeDomain(): 'EVENT_TIME' | 'PROCESSING_TIME' {
    return this.domain
  }

  output<T>(tag: OutputTag<T>, value: T): void {
    if (!this.sideOutputs.has(tag.id)) {
      this.sideOutputs.set(tag.id, [])
    }
    this.sideOutputs.get(tag.id)!.push(value)
  }
}

// ===========================================================================
// Collector Implementation
// ===========================================================================

/**
 * Collector implementation for collecting output
 */
export class CollectorImpl<T> implements Collector<T> {
  private results: T[] = []

  collect(value: T): void {
    this.results.push(value)
  }

  close(): void {}

  getResults(): T[] {
    return this.results
  }
}

// ===========================================================================
// Interval Join Types
// ===========================================================================

/**
 * Interval join builder for keyed streams
 */
export class IntervalJoin<T1, T2, K> {
  private lowerBound: number = 0
  private upperBound: number = 0

  constructor(
    private leftStream: { elements: T1[]; keySelector: (v: T1) => K; timestampAssigner?: (e: T1) => number },
    private rightStream: { elements: T2[]; keySelector: (v: T2) => K; timestampAssigner?: (e: T2) => number }
  ) {}

  between(lowerBound: { toMilliseconds(): number }, upperBound: { toMilliseconds(): number }): IntervalJoin<T1, T2, K> {
    this.lowerBound = lowerBound.toMilliseconds()
    this.upperBound = upperBound.toMilliseconds()
    return this
  }

  process<R>(
    fn: (left: T1, right: T2, out: Collector<R>) => void
  ): { elements: R[] } {
    const results: R[] = []

    // Group left elements by key
    const leftByKey = new Map<string, T1[]>()
    for (const elem of this.leftStream.elements) {
      const key = String(this.leftStream.keySelector(elem))
      if (!leftByKey.has(key)) {
        leftByKey.set(key, [])
      }
      leftByKey.get(key)!.push(elem)
    }

    // Group right elements by key
    const rightByKey = new Map<string, T2[]>()
    for (const elem of this.rightStream.elements) {
      const key = String(this.rightStream.keySelector(elem))
      if (!rightByKey.has(key)) {
        rightByKey.set(key, [])
      }
      rightByKey.get(key)!.push(elem)
    }

    // Perform interval join
    for (const [key, leftElements] of leftByKey) {
      const rightElements = rightByKey.get(key) ?? []

      for (const left of leftElements) {
        const leftTs = this.leftStream.timestampAssigner?.(left) ?? 0

        for (const right of rightElements) {
          const rightTs = this.rightStream.timestampAssigner?.(right) ?? 0
          const diff = rightTs - leftTs

          // Check if within interval bounds
          if (diff >= this.lowerBound && diff <= this.upperBound) {
            const collector = new CollectorImpl<R>()
            fn(left, right, collector)
            results.push(...collector.getResults())
          }
        }
      }
    }

    return { elements: results }
  }
}

// ===========================================================================
// Broadcast State Types
// ===========================================================================

/**
 * Broadcast state descriptor
 */
export { MapStateDescriptor } from './index'

/**
 * Broadcast connected stream for broadcast state pattern
 */
export class BroadcastConnectedStream<T, B> {
  private broadcastState = new Map<string, Map<string, any>>()

  constructor(
    private mainStream: { elements: T[]; keySelector: (v: T) => any },
    private broadcastStream: { elements: B[] },
    private stateDescriptor: MapStateDescriptor<any, any>
  ) {}

  process<R>(handler: {
    processElement(event: T, ctx: BroadcastProcessContext, out: Collector<R>): void
    processBroadcastElement(event: B, ctx: BroadcastProcessContext, out: Collector<R>): void
  }): { elements: R[] } {
    const results: R[] = []
    const globalBroadcastState = new Map<string, any>()

    // Process broadcast elements first to populate state
    for (const broadcastElem of this.broadcastStream.elements) {
      const ctx = new BroadcastProcessContextImpl(globalBroadcastState, this.stateDescriptor)
      const collector = new CollectorImpl<R>()
      handler.processBroadcastElement(broadcastElem, ctx, collector)
      results.push(...collector.getResults())
    }

    // Then process main stream elements
    for (const mainElem of this.mainStream.elements) {
      const ctx = new BroadcastProcessContextImpl(globalBroadcastState, this.stateDescriptor)
      const collector = new CollectorImpl<R>()
      handler.processElement(mainElem, ctx, collector)
      results.push(...collector.getResults())
    }

    return { elements: results }
  }
}

/**
 * Broadcast process context interface
 */
export interface BroadcastProcessContext {
  getBroadcastState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V>
}

/**
 * Broadcast process context implementation
 */
class BroadcastProcessContextImpl implements BroadcastProcessContext {
  constructor(
    private stateStore: Map<string, any>,
    private descriptor: MapStateDescriptor<any, any>
  ) {}

  getBroadcastState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V> {
    return new MapStateImpl<K, V>(this.stateStore, descriptor.name)
  }
}

// ===========================================================================
// Async I/O Types
// ===========================================================================

/**
 * Options for async operations
 */
export interface AsyncOptions {
  ordered?: boolean
  timeout?: { toMilliseconds(): number }
  capacity?: number
  retries?: number
  retryDelay?: { toMilliseconds(): number }
}

// ===========================================================================
// Count Window
// ===========================================================================

/**
 * Count window implementation for KeyedStream
 */
export class CountWindowedStream<T, K> {
  constructor(
    private elements: T[],
    private keySelector: (v: T) => K,
    private windowSize: number,
    private slide?: number
  ) {}

  reduce(reducer: ((a: T, b: T) => T) | ReduceFunction<T>): { elements: T[] } {
    const reduceFn = typeof reducer === 'function' ? reducer : (a: T, b: T) => reducer.reduce(a, b)

    // Group by key
    const groups = new Map<string, T[]>()
    for (const elem of this.elements) {
      const key = String(this.keySelector(elem))
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(elem)
    }

    const results: T[] = []
    const slideSize = this.slide ?? this.windowSize

    for (const [key, elements] of groups) {
      if (this.slide && this.slide < this.windowSize) {
        // Sliding count window
        for (let i = 0; i <= elements.length - this.windowSize; i += slideSize) {
          const windowElements = elements.slice(i, i + this.windowSize)
          if (windowElements.length === this.windowSize) {
            let acc = windowElements[0]!
            for (let j = 1; j < windowElements.length; j++) {
              acc = reduceFn(acc, windowElements[j]!)
            }
            results.push(acc)
          }
        }
      } else {
        // Tumbling count window
        for (let i = 0; i < elements.length; i += this.windowSize) {
          const windowElements = elements.slice(i, i + this.windowSize)
          if (windowElements.length === this.windowSize) {
            let acc = windowElements[0]!
            for (let j = 1; j < windowElements.length; j++) {
              acc = reduceFn(acc, windowElements[j]!)
            }
            results.push(acc)
          }
        }
      }
    }

    return { elements: results }
  }
}

// ===========================================================================
// Export all types
// ===========================================================================

export {
  ValueStateWithTTL,
  ListStateImpl,
  MapStateImpl,
  ReducingStateImpl,
  AggregatingStateImpl,
  IntervalJoin,
  CountWindowedStream,
}
