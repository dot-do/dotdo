/**
 * @dotdo/flink - ProcessFunction Implementation
 *
 * Standalone implementations for ProcessFunction runners and timer services
 * that can be used outside of the DataStream API execution flow.
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/process_function/
 */

import type {
  RuntimeContext,
  TimerService,
  Context,
  OnTimerContext,
  Collector,
  OutputTag,
  ProcessFunction,
  KeyedProcessFunction,
  ValueState,
  ValueStateDescriptor,
  ListState,
  ListStateDescriptor,
  MapState,
  MapStateDescriptor,
  ReducingState,
  ReducingStateDescriptor,
  AggregatingState,
  AggregatingStateDescriptor,
} from './index'

// ===========================================================================
// FlinkTimerService - Standalone timer service implementation
// ===========================================================================

/**
 * Standalone timer service that can be used for testing and running
 * ProcessFunctions outside of the DataStream execution flow.
 */
export class FlinkTimerService implements TimerService {
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
    // Watermark should only advance forward
    if (watermark > this.watermark) {
      this.watermark = watermark
    }
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

  getRegisteredEventTimeTimers(): number[] {
    return Array.from(this.eventTimeTimers)
  }

  getRegisteredProcessingTimeTimers(): number[] {
    return Array.from(this.processingTimeTimers)
  }

  /**
   * Fire all event-time timers up to and including the given watermark
   * Returns the list of fired timer timestamps
   */
  fireEventTimeTimers(currentWatermark: number): number[] {
    const fired: number[] = []
    for (const time of this.eventTimeTimers) {
      if (time <= currentWatermark) {
        fired.push(time)
      }
    }
    // Remove fired timers
    for (const time of fired) {
      this.eventTimeTimers.delete(time)
    }
    return fired.sort((a, b) => a - b)
  }

  /**
   * Fire all processing-time timers up to and including the given time
   * Returns the list of fired timer timestamps
   */
  fireProcessingTimeTimers(currentTime: number): number[] {
    const fired: number[] = []
    for (const time of this.processingTimeTimers) {
      if (time <= currentTime) {
        fired.push(time)
      }
    }
    // Remove fired timers
    for (const time of fired) {
      this.processingTimeTimers.delete(time)
    }
    return fired.sort((a, b) => a - b)
  }

  /**
   * Dispose and clear all timers
   */
  dispose(): void {
    this.eventTimeTimers.clear()
    this.processingTimeTimers.clear()
  }
}

// ===========================================================================
// State Implementations for Runners
// ===========================================================================

class ValueStateImpl<T> implements ValueState<T> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string,
    private defaultValue: T | null = null
  ) {}

  value(): T | null {
    return this.stateStore.has(this.name) ? this.stateStore.get(this.name) : this.defaultValue
  }

  update(value: T): void {
    this.stateStore.set(this.name, value)
  }

  clear(): void {
    this.stateStore.delete(this.name)
  }
}

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

class AggregatingStateImpl<IN, ACC, OUT> implements AggregatingState<IN, OUT> {
  constructor(
    private stateStore: Map<string, any>,
    private name: string,
    private aggregateFunction: {
      createAccumulator(): ACC
      add(value: IN, acc: ACC): ACC
      getResult(acc: ACC): OUT
    }
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
// Runtime Context for Runners
// ===========================================================================

class RunnerRuntimeContext implements RuntimeContext {
  constructor(
    private stateStore: Map<string, any>,
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
    return new ValueStateImpl<T>(this.stateStore, descriptor.name, descriptor.defaultValue)
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
}

// ===========================================================================
// Collector for Runners
// ===========================================================================

class RunnerCollector<T> implements Collector<T> {
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
// Context Implementations for Runners
// ===========================================================================

class RunnerContext implements Context {
  constructor(
    private timestampValue: number | null,
    private timerServiceInstance: TimerService,
    private sideOutputs: Map<string, any[]>
  ) {}

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

class RunnerOnTimerContext implements OnTimerContext {
  constructor(
    private timestampValue: number,
    private timerServiceInstance: TimerService,
    private sideOutputs: Map<string, any[]>,
    private domain: 'EVENT_TIME' | 'PROCESSING_TIME'
  ) {}

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
// FlinkProcessFunctionRunner
// ===========================================================================

/**
 * Runner for executing ProcessFunction outside of DataStream API.
 * Useful for testing and standalone execution.
 */
export class FlinkProcessFunctionRunner<I, O> {
  private sideOutputs = new Map<string, any[]>()
  private timerService = new FlinkTimerService()
  private runtimeContext = new RunnerRuntimeContext(new Map())

  constructor(private fn: ProcessFunction<I, O>) {}

  /**
   * Process all elements and return results
   */
  processAll(elements: I[], timestamps?: number[]): O[] {
    // Call open lifecycle method
    this.fn.open?.(this.runtimeContext)

    const results: O[] = []

    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i]
      const ts = timestamps?.[i] ?? null
      const ctx = new RunnerContext(ts, this.timerService, this.sideOutputs)
      const collector = new RunnerCollector<O>()

      this.fn.processElement(elem!, ctx, collector)
      results.push(...collector.getResults())
    }

    // Call close lifecycle method
    this.fn.close?.()

    return results
  }

  /**
   * Get side output results for a given tag
   */
  getSideOutput<T>(tag: OutputTag<T>): T[] {
    return (this.sideOutputs.get(tag.id) ?? []) as T[]
  }
}

// ===========================================================================
// FlinkKeyedProcessFunctionRunner
// ===========================================================================

/**
 * Keyed context with getCurrentKey() for KeyedProcessFunction
 */
interface KeyedOnTimerContext<K> extends OnTimerContext {
  getCurrentKey(): K
}

class KeyedOnTimerContextImpl<K> implements KeyedOnTimerContext<K> {
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

/**
 * Runner for executing KeyedProcessFunction outside of DataStream API.
 * Maintains separate state per key.
 */
export class FlinkKeyedProcessFunctionRunner<K, I, O> {
  private sideOutputs = new Map<string, any[]>()
  private keyedTimerServices = new Map<string, FlinkTimerService>()
  private keyedStates = new Map<string, Map<string, any>>()
  private currentWatermark = Number.MIN_SAFE_INTEGER

  constructor(
    private fn: KeyedProcessFunction<K, I, O>,
    private keySelector: (element: I) => K,
    private timestampAssigner?: (element: I) => number
  ) {}

  /**
   * Process all elements and return results, firing timers as watermarks advance
   */
  processAll(elements: I[]): O[] {
    const results: O[] = []

    for (const elem of elements) {
      const key = this.keySelector(elem)
      const keyStr = String(key)
      const ts = this.timestampAssigner?.(elem) ?? null

      // Get or create timer service for this key
      if (!this.keyedTimerServices.has(keyStr)) {
        this.keyedTimerServices.set(keyStr, new FlinkTimerService())
      }
      const timerService = this.keyedTimerServices.get(keyStr)!

      // Get or create state store for this key
      if (!this.keyedStates.has(keyStr)) {
        this.keyedStates.set(keyStr, new Map())
      }
      const stateStore = this.keyedStates.get(keyStr)!

      // Create runtime context and call open on first element for this key
      const runtimeContext = new RunnerRuntimeContext(stateStore)
      if (stateStore.size === 0) {
        this.fn.open?.(runtimeContext)
      }

      // Process element
      const ctx = new RunnerContext(ts, timerService, this.sideOutputs)
      const collector = new RunnerCollector<O>()
      this.fn.processElement(elem, ctx, collector)
      results.push(...collector.getResults())

      // Advance watermark if we have timestamps
      if (ts !== null && ts > this.currentWatermark) {
        this.currentWatermark = ts

        // Fire timers for all keys
        for (const [tKey, tService] of this.keyedTimerServices) {
          const firedTimers = tService.fireEventTimeTimers(this.currentWatermark)

          if (firedTimers.length > 0 && this.fn.onTimer) {
            const tStateStore = this.keyedStates.get(tKey) ?? new Map()
            const tRuntimeContext = new RunnerRuntimeContext(tStateStore)
            // Re-open for timer context
            this.fn.open?.(tRuntimeContext)

            for (const timerTs of firedTimers) {
              const timerCtx = new KeyedOnTimerContextImpl(
                tKey as unknown as K,
                timerTs,
                tService,
                this.sideOutputs,
                'EVENT_TIME'
              )
              const timerCollector = new RunnerCollector<O>()
              this.fn.onTimer(timerTs, timerCtx, timerCollector)
              results.push(...timerCollector.getResults())
            }
          }
        }
      }
    }

    // Fire remaining timers at end of stream (watermark to MAX)
    const endWatermark = Number.MAX_SAFE_INTEGER
    for (const [tKey, tService] of this.keyedTimerServices) {
      const firedTimers = tService.fireEventTimeTimers(endWatermark)

      if (firedTimers.length > 0 && this.fn.onTimer) {
        const tStateStore = this.keyedStates.get(tKey) ?? new Map()
        const tRuntimeContext = new RunnerRuntimeContext(tStateStore)
        this.fn.open?.(tRuntimeContext)

        for (const timerTs of firedTimers) {
          const timerCtx = new KeyedOnTimerContextImpl(
            tKey as unknown as K,
            timerTs,
            tService,
            this.sideOutputs,
            'EVENT_TIME'
          )
          const timerCollector = new RunnerCollector<O>()
          this.fn.onTimer(timerTs, timerCtx, timerCollector)
          results.push(...timerCollector.getResults())
        }
      }
    }

    return results
  }

  /**
   * Get side output results for a given tag
   */
  getSideOutput<T>(tag: OutputTag<T>): T[] {
    return (this.sideOutputs.get(tag.id) ?? []) as T[]
  }
}
