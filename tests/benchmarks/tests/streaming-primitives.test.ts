/**
 * Streaming Primitives Benchmarks
 *
 * Performance benchmarks for streaming primitives supporting the Kafka compat layer.
 * Tests windowing, watermarks, transactions, stateful operators, routing, and CDC patterns.
 *
 * Key metrics:
 * - Window operations (tumbling, sliding, session)
 * - Watermark management
 * - Exactly-once transaction processing
 * - Keyed state and window state management
 * - Partition routing (hash, range)
 * - Change Data Capture patterns
 *
 * Reference: Apache Kafka Streams and Flink streaming primitives
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Window types for stream processing
 */
export type WindowType = 'tumbling' | 'sliding' | 'session'

/**
 * Window definition
 */
export interface WindowSpec {
  type: WindowType
  /** Window size in milliseconds */
  size: number
  /** Slide interval for sliding windows (ms) */
  slide?: number
  /** Gap duration for session windows (ms) */
  gap?: number
}

/**
 * Windowed key-value pair
 */
export interface WindowedKV<K, V> {
  key: K
  value: V
  windowStart: number
  windowEnd: number
}

/**
 * Watermark for event-time processing
 */
export interface Watermark {
  timestamp: number
  sourceId: string
}

/**
 * Transaction state
 */
export type TransactionState = 'pending' | 'committed' | 'aborted'

/**
 * Transaction record for exactly-once semantics
 */
export interface TransactionRecord {
  id: string
  state: TransactionState
  records: unknown[]
  startTime: number
  commitTime?: number
}

/**
 * Keyed state entry
 */
export interface KeyedState<K, V> {
  key: K
  value: V
  lastUpdated: number
}

/**
 * Checkpoint for state recovery
 */
export interface Checkpoint {
  id: string
  timestamp: number
  state: Map<string, unknown>
  offsets: Map<string, number>
}

/**
 * Routing strategy
 */
export type RoutingStrategy = 'hash' | 'range' | 'round-robin'

/**
 * Partition assignment
 */
export interface PartitionAssignment {
  partition: number
  key: string
  strategy: RoutingStrategy
}

/**
 * CDC operation type
 */
export type CDCOperation = 'insert' | 'update' | 'delete'

/**
 * CDC change event
 */
export interface CDCEvent {
  operation: CDCOperation
  table: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  timestamp: number
  transactionId?: string
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  p99: number
  count: number
}

// ============================================================================
// WINDOW PRIMITIVES
// ============================================================================

/**
 * Tumbling window - fixed-size, non-overlapping windows
 */
export class TumblingWindow<K, V> {
  private windowSize: number
  private windows: Map<string, { values: V[]; start: number; end: number }> = new Map()
  private triggerCallbacks: Array<(key: K, values: V[], windowStart: number, windowEnd: number) => void> = []

  constructor(sizeMs: number) {
    this.windowSize = sizeMs
  }

  /**
   * Add a value to the appropriate window
   */
  add(key: K, value: V, timestamp: number): void {
    const windowStart = Math.floor(timestamp / this.windowSize) * this.windowSize
    const windowEnd = windowStart + this.windowSize
    const windowKey = `${String(key)}:${windowStart}`

    let window = this.windows.get(windowKey)
    if (!window) {
      window = { values: [], start: windowStart, end: windowEnd }
      this.windows.set(windowKey, window)
    }

    window.values.push(value)
  }

  /**
   * Trigger window evaluation for windows that have closed
   */
  trigger(currentTime: number): Array<WindowedKV<K, V[]>> {
    const results: Array<WindowedKV<K, V[]>> = []

    for (const [windowKey, window] of this.windows) {
      if (currentTime >= window.end) {
        const [keyStr] = windowKey.split(':')
        results.push({
          key: keyStr as unknown as K,
          value: window.values,
          windowStart: window.start,
          windowEnd: window.end,
        })

        // Notify callbacks
        for (const cb of this.triggerCallbacks) {
          cb(keyStr as unknown as K, window.values, window.start, window.end)
        }

        this.windows.delete(windowKey)
      }
    }

    return results
  }

  /**
   * Register a callback for window triggers
   */
  onTrigger(callback: (key: K, values: V[], windowStart: number, windowEnd: number) => void): void {
    this.triggerCallbacks.push(callback)
  }

  /**
   * Get the number of active windows
   */
  get activeWindowCount(): number {
    return this.windows.size
  }
}

/**
 * Sliding window - fixed-size, overlapping windows
 */
export class SlidingWindow<K, V> {
  private windowSize: number
  private slideInterval: number
  private events: Map<string, Array<{ value: V; timestamp: number }>> = new Map()

  constructor(sizeMs: number, slideMs: number) {
    this.windowSize = sizeMs
    this.slideInterval = slideMs
  }

  /**
   * Add a value with its event time
   */
  add(key: K, value: V, timestamp: number): void {
    const keyStr = String(key)
    let keyEvents = this.events.get(keyStr)
    if (!keyEvents) {
      keyEvents = []
      this.events.set(keyStr, keyEvents)
    }
    keyEvents.push({ value, timestamp })
  }

  /**
   * Get values in the current sliding window
   */
  getWindow(key: K, currentTime: number): V[] {
    const keyStr = String(key)
    const keyEvents = this.events.get(keyStr)
    if (!keyEvents) return []

    const windowStart = currentTime - this.windowSize
    return keyEvents
      .filter(e => e.timestamp >= windowStart && e.timestamp < currentTime)
      .map(e => e.value)
  }

  /**
   * Process all windows at the current slide interval
   */
  slide(currentTime: number): Map<K, V[]> {
    const results = new Map<K, V[]>()

    for (const [keyStr, keyEvents] of this.events) {
      const windowStart = currentTime - this.windowSize
      const windowValues = keyEvents
        .filter(e => e.timestamp >= windowStart && e.timestamp < currentTime)
        .map(e => e.value)

      if (windowValues.length > 0) {
        results.set(keyStr as unknown as K, windowValues)
      }

      // Cleanup old events
      const cutoff = currentTime - this.windowSize * 2
      this.events.set(keyStr, keyEvents.filter(e => e.timestamp >= cutoff))
    }

    return results
  }
}

/**
 * Session window - dynamic windows based on activity gaps
 */
export class SessionWindow<K, V> {
  private gapDuration: number
  private sessions: Map<string, { values: V[]; lastActivity: number; start: number }> = new Map()

  constructor(gapMs: number) {
    this.gapDuration = gapMs
  }

  /**
   * Add a value, extending or creating a session
   */
  add(key: K, value: V, timestamp: number): void {
    const keyStr = String(key)
    let session = this.sessions.get(keyStr)

    if (!session || timestamp - session.lastActivity > this.gapDuration) {
      // Start new session
      session = { values: [], lastActivity: timestamp, start: timestamp }
      this.sessions.set(keyStr, session)
    }

    session.values.push(value)
    session.lastActivity = timestamp
  }

  /**
   * Close sessions that have exceeded the gap duration
   */
  closeSessions(currentTime: number): Array<WindowedKV<K, V[]>> {
    const results: Array<WindowedKV<K, V[]>> = []

    for (const [keyStr, session] of this.sessions) {
      if (currentTime - session.lastActivity > this.gapDuration) {
        results.push({
          key: keyStr as unknown as K,
          value: session.values,
          windowStart: session.start,
          windowEnd: session.lastActivity,
        })
        this.sessions.delete(keyStr)
      }
    }

    return results
  }

  /**
   * Get the number of active sessions
   */
  get activeSessionCount(): number {
    return this.sessions.size
  }
}

// ============================================================================
// WATERMARK MANAGEMENT
// ============================================================================

/**
 * Watermark tracker for event-time processing
 */
export class WatermarkTracker {
  private watermarks: Map<string, number> = new Map()
  private currentWatermark = 0
  private allowedLateness: number

  constructor(allowedLatenessMs = 0) {
    this.allowedLateness = allowedLatenessMs
  }

  /**
   * Advance watermark for a source
   */
  advance(sourceId: string, timestamp: number): void {
    const current = this.watermarks.get(sourceId) ?? 0
    if (timestamp > current) {
      this.watermarks.set(sourceId, timestamp)
      this.updateGlobalWatermark()
    }
  }

  /**
   * Update the global watermark (minimum across all sources)
   */
  private updateGlobalWatermark(): void {
    if (this.watermarks.size === 0) return

    let minWatermark = Infinity
    for (const wm of this.watermarks.values()) {
      if (wm < minWatermark) {
        minWatermark = wm
      }
    }

    this.currentWatermark = minWatermark
  }

  /**
   * Check if an event is late (arrived after its window closed)
   */
  isLate(eventTime: number): boolean {
    return eventTime < this.currentWatermark - this.allowedLateness
  }

  /**
   * Get the current global watermark
   */
  getCurrentWatermark(): number {
    return this.currentWatermark
  }

  /**
   * Get watermark for a specific source
   */
  getSourceWatermark(sourceId: string): number | undefined {
    return this.watermarks.get(sourceId)
  }
}

// ============================================================================
// TRANSACTION PROCESSING (EXACTLY-ONCE)
// ============================================================================

/**
 * Transaction manager for exactly-once semantics
 */
export class TransactionManager {
  private transactions: Map<string, TransactionRecord> = new Map()
  private processedIds: Set<string> = new Set()
  private checkpoints: Checkpoint[] = []

  /**
   * Begin a new transaction
   */
  begin(transactionId: string): TransactionRecord {
    if (this.transactions.has(transactionId)) {
      throw new Error(`Transaction ${transactionId} already exists`)
    }

    const record: TransactionRecord = {
      id: transactionId,
      state: 'pending',
      records: [],
      startTime: Date.now(),
    }

    this.transactions.set(transactionId, record)
    return record
  }

  /**
   * Add a record to a transaction
   */
  addRecord(transactionId: string, record: unknown): void {
    const tx = this.transactions.get(transactionId)
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`)
    }
    if (tx.state !== 'pending') {
      throw new Error(`Transaction ${transactionId} is not pending`)
    }
    tx.records.push(record)
  }

  /**
   * Commit a transaction
   */
  commit(transactionId: string): void {
    const tx = this.transactions.get(transactionId)
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`)
    }
    if (tx.state !== 'pending') {
      throw new Error(`Transaction ${transactionId} is not pending`)
    }

    tx.state = 'committed'
    tx.commitTime = Date.now()

    // Mark all record IDs as processed for deduplication
    for (const record of tx.records) {
      if (typeof record === 'object' && record !== null && 'id' in record) {
        this.processedIds.add(String((record as { id: unknown }).id))
      }
    }
  }

  /**
   * Abort a transaction
   */
  abort(transactionId: string): void {
    const tx = this.transactions.get(transactionId)
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    tx.state = 'aborted'
    tx.records = []
  }

  /**
   * Check if a record ID has been processed (for deduplication)
   */
  isProcessed(recordId: string): boolean {
    return this.processedIds.has(recordId)
  }

  /**
   * Process a record with deduplication
   */
  processWithDedup<T>(recordId: string, processor: () => T): T | null {
    if (this.isProcessed(recordId)) {
      return null // Already processed
    }
    const result = processor()
    this.processedIds.add(recordId)
    return result
  }

  /**
   * Create a checkpoint
   */
  createCheckpoint(state: Map<string, unknown>, offsets: Map<string, number>): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      state: new Map(state),
      offsets: new Map(offsets),
    }

    this.checkpoints.push(checkpoint)
    return checkpoint
  }

  /**
   * Restore from a checkpoint
   */
  restoreFromCheckpoint(checkpointId: string): Checkpoint | null {
    return this.checkpoints.find(c => c.id === checkpointId) ?? null
  }

  /**
   * Get the latest checkpoint
   */
  getLatestCheckpoint(): Checkpoint | null {
    return this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : null
  }

  /**
   * Get transaction state
   */
  getTransaction(transactionId: string): TransactionRecord | undefined {
    return this.transactions.get(transactionId)
  }
}

// ============================================================================
// STATEFUL OPERATORS
// ============================================================================

/**
 * Stateful operator with keyed state
 */
export class StatefulOperator<K, V, S> {
  private keyedState: Map<string, KeyedState<K, S>> = new Map()
  private windowState: Map<string, Map<string, unknown>> = new Map()

  /**
   * Get state for a key
   */
  getState(key: K): S | undefined {
    const keyStr = String(key)
    return this.keyedState.get(keyStr)?.value
  }

  /**
   * Update state for a key
   */
  updateState(key: K, value: S): void {
    const keyStr = String(key)
    this.keyedState.set(keyStr, {
      key,
      value,
      lastUpdated: Date.now(),
    })
  }

  /**
   * Get window state for aggregation
   */
  getWindowState(key: K, windowKey: string): unknown | undefined {
    const keyStr = String(key)
    const keyWindows = this.windowState.get(keyStr)
    return keyWindows?.get(windowKey)
  }

  /**
   * Update window state with aggregation
   */
  aggregateWindowState(key: K, windowKey: string, value: unknown, aggregator: (acc: unknown, val: unknown) => unknown): void {
    const keyStr = String(key)
    let keyWindows = this.windowState.get(keyStr)
    if (!keyWindows) {
      keyWindows = new Map()
      this.windowState.set(keyStr, keyWindows)
    }

    const current = keyWindows.get(windowKey)
    const aggregated = aggregator(current, value)
    keyWindows.set(windowKey, aggregated)
  }

  /**
   * Create a checkpoint of all state
   */
  createCheckpoint(): Map<string, unknown> {
    const checkpoint = new Map<string, unknown>()

    // Serialize keyed state
    const keyedStateData: Array<[string, KeyedState<K, S>]> = []
    for (const [k, v] of this.keyedState) {
      keyedStateData.push([k, v])
    }
    checkpoint.set('keyedState', keyedStateData)

    // Serialize window state
    const windowStateData: Array<[string, Array<[string, unknown]>]> = []
    for (const [k, v] of this.windowState) {
      windowStateData.push([k, Array.from(v.entries())])
    }
    checkpoint.set('windowState', windowStateData)

    return checkpoint
  }

  /**
   * Restore state from a checkpoint
   */
  restoreFromCheckpoint(checkpoint: Map<string, unknown>): void {
    // Restore keyed state
    const keyedStateData = checkpoint.get('keyedState') as Array<[string, KeyedState<K, S>]> | undefined
    if (keyedStateData) {
      this.keyedState = new Map(keyedStateData)
    }

    // Restore window state
    const windowStateData = checkpoint.get('windowState') as Array<[string, Array<[string, unknown]>]> | undefined
    if (windowStateData) {
      this.windowState = new Map()
      for (const [k, entries] of windowStateData) {
        this.windowState.set(k, new Map(entries))
      }
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.keyedState.clear()
    this.windowState.clear()
  }

  /**
   * Get the number of keyed state entries
   */
  get stateSize(): number {
    return this.keyedState.size
  }
}

// ============================================================================
// PARTITION ROUTER
// ============================================================================

/**
 * Partition router for distributing records across partitions
 */
export class PartitionRouter {
  private numPartitions: number
  private ranges: Array<{ start: string; end: string; partition: number }> = []

  constructor(numPartitions: number) {
    this.numPartitions = numPartitions
  }

  /**
   * Hash-based routing (consistent hashing)
   */
  hashRoute(key: string): number {
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash) % this.numPartitions
  }

  /**
   * Range-based routing
   */
  rangeRoute(key: string): number {
    for (const range of this.ranges) {
      if (key >= range.start && key < range.end) {
        return range.partition
      }
    }
    // Default to hash routing if no range matches
    return this.hashRoute(key)
  }

  /**
   * Configure range partitions
   */
  configureRanges(ranges: Array<{ start: string; end: string; partition: number }>): void {
    this.ranges = ranges.sort((a, b) => a.start.localeCompare(b.start))
  }

  /**
   * Get partition assignment for a key
   */
  getAssignment(key: string, strategy: RoutingStrategy): PartitionAssignment {
    let partition: number
    switch (strategy) {
      case 'hash':
        partition = this.hashRoute(key)
        break
      case 'range':
        partition = this.rangeRoute(key)
        break
      case 'round-robin':
        partition = Math.floor(Math.random() * this.numPartitions)
        break
      default:
        partition = this.hashRoute(key)
    }

    return { partition, key, strategy }
  }

  /**
   * Get all partition assignments for a batch of keys
   */
  assignBatch(keys: string[], strategy: RoutingStrategy): Map<number, string[]> {
    const assignments = new Map<number, string[]>()

    for (const key of keys) {
      const assignment = this.getAssignment(key, strategy)
      let partitionKeys = assignments.get(assignment.partition)
      if (!partitionKeys) {
        partitionKeys = []
        assignments.set(assignment.partition, partitionKeys)
      }
      partitionKeys.push(key)
    }

    return assignments
  }
}

// ============================================================================
// CHANGE DATA CAPTURE (CDC)
// ============================================================================

/**
 * CDC processor for capturing and transforming database changes
 */
export class CDCProcessor {
  private transforms: Map<string, (event: CDCEvent) => CDCEvent | null> = new Map()
  private sinks: Map<string, (event: CDCEvent) => Promise<void>> = new Map()
  private eventBuffer: CDCEvent[] = []
  private batchSize: number

  constructor(batchSize = 100) {
    this.batchSize = batchSize
  }

  /**
   * Capture a change event
   */
  capture(operation: CDCOperation, table: string, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): CDCEvent {
    const event: CDCEvent = {
      operation,
      table,
      before,
      after,
      timestamp: Date.now(),
    }

    this.eventBuffer.push(event)
    return event
  }

  /**
   * Register a transform for a table
   */
  registerTransform(table: string, transform: (event: CDCEvent) => CDCEvent | null): void {
    this.transforms.set(table, transform)
  }

  /**
   * Transform a CDC event
   */
  transform(event: CDCEvent): CDCEvent | null {
    const transform = this.transforms.get(event.table)
    if (transform) {
      return transform(event)
    }
    return event
  }

  /**
   * Register a sink for a table
   */
  registerSink(table: string, sink: (event: CDCEvent) => Promise<void>): void {
    this.sinks.set(table, sink)
  }

  /**
   * Sink an event to its destination
   */
  async sink(event: CDCEvent): Promise<void> {
    const sinkFn = this.sinks.get(event.table)
    if (sinkFn) {
      await sinkFn(event)
    }
  }

  /**
   * Process a batch of events
   */
  async processBatch(): Promise<number> {
    const batch = this.eventBuffer.splice(0, this.batchSize)
    let processed = 0

    for (const event of batch) {
      const transformed = this.transform(event)
      if (transformed) {
        await this.sink(transformed)
        processed++
      }
    }

    return processed
  }

  /**
   * Get the number of buffered events
   */
  get bufferSize(): number {
    return this.eventBuffer.length
  }
}

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

/**
 * Calculate latency statistics from a series of measurements
 */
function calculateStats(measurements: number[]): LatencyStats {
  if (measurements.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 }
  }

  const sorted = [...measurements].sort((a, b) => a - b)
  const sum = measurements.reduce((a, b) => a + b, 0)

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / measurements.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    count: measurements.length,
  }
}

// ============================================================================
// WINDOW BENCHMARKS
// ============================================================================

describe('Window Benchmarks', () => {
  const iterations = 1000

  describe('Tumbling Window', () => {
    it('should benchmark add and trigger operations', () => {
      const window = new TumblingWindow<string, number>(1000) // 1 second windows
      const addTimes: number[] = []
      const triggerTimes: number[] = []

      // Benchmark add operations
      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        window.add(`key-${i % 10}`, i, i * 10)
        addTimes.push(performance.now() - start)
      }

      // Benchmark trigger operations
      for (let i = 0; i < iterations / 10; i++) {
        const start = performance.now()
        window.trigger(i * 1000 + 1000)
        triggerTimes.push(performance.now() - start)
      }

      const addStats = calculateStats(addTimes)
      const triggerStats = calculateStats(triggerTimes)

      console.log('\n=== Tumbling Window Benchmarks ===')
      console.log(`Add - Avg: ${addStats.avg.toFixed(4)}ms, P95: ${addStats.p95.toFixed(4)}ms, P99: ${addStats.p99.toFixed(4)}ms`)
      console.log(`Trigger - Avg: ${triggerStats.avg.toFixed(4)}ms, P95: ${triggerStats.p95.toFixed(4)}ms, P99: ${triggerStats.p99.toFixed(4)}ms`)

      expect(addStats.avg).toBeLessThan(1) // Add should be sub-millisecond
      expect(triggerStats.avg).toBeLessThan(5) // Trigger can be slightly slower
    })
  })

  describe('Sliding Window', () => {
    it('should benchmark sliding window processing', () => {
      const window = new SlidingWindow<string, number>(1000, 100) // 1s window, 100ms slide
      const addTimes: number[] = []
      const slideTimes: number[] = []

      // Benchmark add operations
      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        window.add(`key-${i % 10}`, i, i * 10)
        addTimes.push(performance.now() - start)
      }

      // Benchmark slide operations
      for (let i = 0; i < iterations / 10; i++) {
        const start = performance.now()
        window.slide(i * 100 + 1000)
        slideTimes.push(performance.now() - start)
      }

      const addStats = calculateStats(addTimes)
      const slideStats = calculateStats(slideTimes)

      console.log('\n=== Sliding Window Benchmarks ===')
      console.log(`Add - Avg: ${addStats.avg.toFixed(4)}ms, P95: ${addStats.p95.toFixed(4)}ms, P99: ${addStats.p99.toFixed(4)}ms`)
      console.log(`Slide - Avg: ${slideStats.avg.toFixed(4)}ms, P95: ${slideStats.p95.toFixed(4)}ms, P99: ${slideStats.p99.toFixed(4)}ms`)

      expect(addStats.avg).toBeLessThan(1)
      expect(slideStats.avg).toBeLessThan(10)
    })
  })

  describe('Session Window', () => {
    it('should benchmark session window with gap detection', () => {
      const window = new SessionWindow<string, number>(500) // 500ms gap
      const addTimes: number[] = []
      const closeTimes: number[] = []

      // Benchmark add operations with varying gaps
      for (let i = 0; i < iterations; i++) {
        const gap = i % 5 === 0 ? 1000 : 100 // Every 5th event has a larger gap
        const start = performance.now()
        window.add(`key-${i % 10}`, i, i * gap)
        addTimes.push(performance.now() - start)
      }

      // Benchmark close session operations
      for (let i = 0; i < iterations / 10; i++) {
        const start = performance.now()
        window.closeSessions(i * 1000)
        closeTimes.push(performance.now() - start)
      }

      const addStats = calculateStats(addTimes)
      const closeStats = calculateStats(closeTimes)

      console.log('\n=== Session Window Benchmarks ===')
      console.log(`Add - Avg: ${addStats.avg.toFixed(4)}ms, P95: ${addStats.p95.toFixed(4)}ms, P99: ${addStats.p99.toFixed(4)}ms`)
      console.log(`Close - Avg: ${closeStats.avg.toFixed(4)}ms, P95: ${closeStats.p95.toFixed(4)}ms, P99: ${closeStats.p99.toFixed(4)}ms`)

      expect(addStats.avg).toBeLessThan(1)
      expect(closeStats.avg).toBeLessThan(5)
    })
  })
})

// ============================================================================
// WATERMARK BENCHMARKS
// ============================================================================

describe('Watermark Benchmarks', () => {
  const iterations = 1000

  it('should benchmark watermark advance', () => {
    const tracker = new WatermarkTracker(1000)
    const advanceTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const sourceId = `source-${i % 5}`
      const start = performance.now()
      tracker.advance(sourceId, i * 100)
      advanceTimes.push(performance.now() - start)
    }

    const stats = calculateStats(advanceTimes)

    console.log('\n=== Watermark Advance Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.1)
  })

  it('should benchmark late arrival check', () => {
    const tracker = new WatermarkTracker(1000)
    tracker.advance('source-1', 10000)

    const checkTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const eventTime = i * 10 // Some will be late, some won't
      const start = performance.now()
      tracker.isLate(eventTime)
      checkTimes.push(performance.now() - start)
    }

    const stats = calculateStats(checkTimes)

    console.log('\n=== Late Arrival Check Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.1)
  })

  it('should benchmark get current watermark', () => {
    const tracker = new WatermarkTracker()
    // Setup multiple sources
    for (let i = 0; i < 10; i++) {
      tracker.advance(`source-${i}`, i * 1000)
    }

    const getTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      tracker.getCurrentWatermark()
      getTimes.push(performance.now() - start)
    }

    const stats = calculateStats(getTimes)

    console.log('\n=== Get Watermark Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.1)
  })
})

// ============================================================================
// TRANSACTION BENCHMARKS
// ============================================================================

describe('Transaction Benchmarks (ExactlyOnce)', () => {
  const iterations = 500

  it('should benchmark begin/commit transaction', () => {
    const txManager = new TransactionManager()
    const beginTimes: number[] = []
    const commitTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const txId = `tx-${i}`

      const beginStart = performance.now()
      txManager.begin(txId)
      beginTimes.push(performance.now() - beginStart)

      // Add some records
      for (let j = 0; j < 10; j++) {
        txManager.addRecord(txId, { id: `record-${i}-${j}`, value: j })
      }

      const commitStart = performance.now()
      txManager.commit(txId)
      commitTimes.push(performance.now() - commitStart)
    }

    const beginStats = calculateStats(beginTimes)
    const commitStats = calculateStats(commitTimes)

    console.log('\n=== Transaction Begin/Commit Benchmark ===')
    console.log(`Begin - Avg: ${beginStats.avg.toFixed(4)}ms, P95: ${beginStats.p95.toFixed(4)}ms, P99: ${beginStats.p99.toFixed(4)}ms`)
    console.log(`Commit - Avg: ${commitStats.avg.toFixed(4)}ms, P95: ${commitStats.p95.toFixed(4)}ms, P99: ${commitStats.p99.toFixed(4)}ms`)

    expect(beginStats.avg).toBeLessThan(0.5)
    expect(commitStats.avg).toBeLessThan(1)
  })

  it('should benchmark process with deduplication', () => {
    const txManager = new TransactionManager()
    const dedupTimes: number[] = []
    let processed = 0

    // Pre-process half the records
    for (let i = 0; i < iterations / 2; i++) {
      const txId = `tx-${i}`
      txManager.begin(txId)
      txManager.addRecord(txId, { id: `record-${i}` })
      txManager.commit(txId)
    }

    // Benchmark dedup processing
    for (let i = 0; i < iterations; i++) {
      const recordId = `record-${i}`
      const start = performance.now()
      const result = txManager.processWithDedup(recordId, () => ({ processed: true }))
      dedupTimes.push(performance.now() - start)
      if (result) processed++
    }

    const stats = calculateStats(dedupTimes)

    console.log('\n=== Deduplication Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)
    console.log(`Processed: ${processed}/${iterations} (${((processed / iterations) * 100).toFixed(1)}% new)`)

    expect(stats.avg).toBeLessThan(0.5)
    expect(processed).toBe(iterations / 2) // Half should be new
  })

  it('should benchmark checkpoint barrier', () => {
    const txManager = new TransactionManager()
    const createTimes: number[] = []
    const restoreTimes: number[] = []

    // Create checkpoints with varying state sizes
    const checkpointIds: string[] = []
    for (let i = 0; i < iterations / 10; i++) {
      const state = new Map<string, unknown>()
      const offsets = new Map<string, number>()

      // Populate state
      for (let j = 0; j < 100; j++) {
        state.set(`key-${j}`, { value: j, data: 'x'.repeat(100) })
        offsets.set(`partition-${j}`, j * 1000)
      }

      const start = performance.now()
      const checkpoint = txManager.createCheckpoint(state, offsets)
      createTimes.push(performance.now() - start)
      checkpointIds.push(checkpoint.id)
    }

    // Benchmark restore
    for (const id of checkpointIds) {
      const start = performance.now()
      txManager.restoreFromCheckpoint(id)
      restoreTimes.push(performance.now() - start)
    }

    const createStats = calculateStats(createTimes)
    const restoreStats = calculateStats(restoreTimes)

    console.log('\n=== Checkpoint Barrier Benchmark ===')
    console.log(`Create - Avg: ${createStats.avg.toFixed(4)}ms, P95: ${createStats.p95.toFixed(4)}ms, P99: ${createStats.p99.toFixed(4)}ms`)
    console.log(`Restore - Avg: ${restoreStats.avg.toFixed(4)}ms, P95: ${restoreStats.p95.toFixed(4)}ms, P99: ${restoreStats.p99.toFixed(4)}ms`)

    expect(createStats.avg).toBeLessThan(5)
    expect(restoreStats.avg).toBeLessThan(1)
  })
})

// ============================================================================
// STATEFUL OPERATOR BENCHMARKS
// ============================================================================

describe('State Benchmarks (StatefulOperator)', () => {
  const iterations = 1000

  it('should benchmark keyed state get/update', () => {
    const operator = new StatefulOperator<string, number, number>()
    const updateTimes: number[] = []
    const getTimes: number[] = []

    // Benchmark update
    for (let i = 0; i < iterations; i++) {
      const key = `key-${i % 100}`
      const start = performance.now()
      operator.updateState(key, i)
      updateTimes.push(performance.now() - start)
    }

    // Benchmark get
    for (let i = 0; i < iterations; i++) {
      const key = `key-${i % 100}`
      const start = performance.now()
      operator.getState(key)
      getTimes.push(performance.now() - start)
    }

    const updateStats = calculateStats(updateTimes)
    const getStats = calculateStats(getTimes)

    console.log('\n=== Keyed State Benchmark ===')
    console.log(`Update - Avg: ${updateStats.avg.toFixed(4)}ms, P95: ${updateStats.p95.toFixed(4)}ms, P99: ${updateStats.p99.toFixed(4)}ms`)
    console.log(`Get - Avg: ${getStats.avg.toFixed(4)}ms, P95: ${getStats.p95.toFixed(4)}ms, P99: ${getStats.p99.toFixed(4)}ms`)

    expect(updateStats.avg).toBeLessThan(0.5)
    expect(getStats.avg).toBeLessThan(0.1)
  })

  it('should benchmark window state aggregate', () => {
    const operator = new StatefulOperator<string, number, number>()
    const aggregateTimes: number[] = []

    // Benchmark aggregation
    for (let i = 0; i < iterations; i++) {
      const key = `key-${i % 50}`
      const windowKey = `window-${Math.floor(i / 100)}`
      const start = performance.now()
      operator.aggregateWindowState(key, windowKey, i, (acc, val) => ((acc as number) ?? 0) + (val as number))
      aggregateTimes.push(performance.now() - start)
    }

    const stats = calculateStats(aggregateTimes)

    console.log('\n=== Window State Aggregate Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.5)
  })

  it('should benchmark checkpoint create/restore', () => {
    const operator = new StatefulOperator<string, number, { count: number; sum: number }>()
    const createTimes: number[] = []
    const restoreTimes: number[] = []

    // Populate state
    for (let i = 0; i < 1000; i++) {
      operator.updateState(`key-${i}`, { count: i, sum: i * 10 })
    }

    // Benchmark checkpoint creation
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      operator.createCheckpoint()
      createTimes.push(performance.now() - start)
    }

    // Create a checkpoint to restore from
    const checkpoint = operator.createCheckpoint()
    operator.clear()

    // Benchmark restore
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      operator.restoreFromCheckpoint(checkpoint)
      restoreTimes.push(performance.now() - start)
    }

    const createStats = calculateStats(createTimes)
    const restoreStats = calculateStats(restoreTimes)

    console.log('\n=== Checkpoint Create/Restore Benchmark ===')
    console.log(`Create - Avg: ${createStats.avg.toFixed(4)}ms, P95: ${createStats.p95.toFixed(4)}ms, P99: ${createStats.p99.toFixed(4)}ms`)
    console.log(`Restore - Avg: ${restoreStats.avg.toFixed(4)}ms, P95: ${restoreStats.p95.toFixed(4)}ms, P99: ${restoreStats.p99.toFixed(4)}ms`)

    expect(createStats.avg).toBeLessThan(10)
    expect(restoreStats.avg).toBeLessThan(10)
  })
})

// ============================================================================
// ROUTER BENCHMARKS
// ============================================================================

describe('Router Benchmarks', () => {
  const iterations = 10000

  it('should benchmark hash routing', () => {
    const router = new PartitionRouter(32)
    const routeTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const key = `key-${i}-${Math.random().toString(36).slice(2)}`
      const start = performance.now()
      router.hashRoute(key)
      routeTimes.push(performance.now() - start)
    }

    const stats = calculateStats(routeTimes)

    console.log('\n=== Hash Routing Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)
    console.log(`Throughput: ${(iterations / (stats.avg * iterations / 1000)).toFixed(0)} ops/sec`)

    expect(stats.avg).toBeLessThan(0.01)
  })

  it('should benchmark range routing', () => {
    const router = new PartitionRouter(32)

    // Configure ranges
    const ranges: Array<{ start: string; end: string; partition: number }> = []
    for (let i = 0; i < 32; i++) {
      const startChar = String.fromCharCode(97 + Math.floor(i * 26 / 32))
      const endChar = String.fromCharCode(97 + Math.floor((i + 1) * 26 / 32))
      ranges.push({ start: startChar, end: endChar + 'zzz', partition: i })
    }
    router.configureRanges(ranges)

    const routeTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const key = String.fromCharCode(97 + (i % 26)) + `-${i}`
      const start = performance.now()
      router.rangeRoute(key)
      routeTimes.push(performance.now() - start)
    }

    const stats = calculateStats(routeTimes)

    console.log('\n=== Range Routing Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)
    console.log(`Throughput: ${(iterations / (stats.avg * iterations / 1000)).toFixed(0)} ops/sec`)

    expect(stats.avg).toBeLessThan(0.01)
  })

  it('should benchmark partition assignment for batches', () => {
    const router = new PartitionRouter(32)
    const batchSizes = [10, 100, 1000]
    const assignTimes: Map<number, number[]> = new Map()

    for (const size of batchSizes) {
      assignTimes.set(size, [])

      for (let i = 0; i < 100; i++) {
        const keys = Array.from({ length: size }, (_, j) => `key-${i * size + j}`)
        const start = performance.now()
        router.assignBatch(keys, 'hash')
        assignTimes.get(size)!.push(performance.now() - start)
      }
    }

    console.log('\n=== Batch Assignment Benchmark ===')
    for (const [size, times] of assignTimes) {
      const stats = calculateStats(times)
      console.log(`Batch ${size} - Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms`)
    }

    expect(calculateStats(assignTimes.get(1000)!).avg).toBeLessThan(5)
  })
})

// ============================================================================
// CDC BENCHMARKS
// ============================================================================

describe('CDC Benchmarks (Change Data Capture)', () => {
  const iterations = 1000

  it('should benchmark capture change', () => {
    const cdc = new CDCProcessor()
    const captureTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const operation: CDCOperation = ['insert', 'update', 'delete'][i % 3] as CDCOperation
      const start = performance.now()
      cdc.capture(
        operation,
        'users',
        operation === 'insert' ? undefined : { id: i, name: `user-${i}` },
        operation === 'delete' ? undefined : { id: i, name: `user-${i}-updated`, email: `user${i}@example.com` }
      )
      captureTimes.push(performance.now() - start)
    }

    const stats = calculateStats(captureTimes)

    console.log('\n=== CDC Capture Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.5)
    expect(cdc.bufferSize).toBe(iterations)
  })

  it('should benchmark transform', () => {
    const cdc = new CDCProcessor()
    const transformTimes: number[] = []

    // Register transform
    cdc.registerTransform('users', (event) => {
      if (event.operation === 'delete') return null // Filter deletes
      return {
        ...event,
        after: {
          ...event.after,
          processed: true,
          processedAt: Date.now(),
        },
      }
    })

    // Create events and transform them
    for (let i = 0; i < iterations; i++) {
      const event: CDCEvent = {
        operation: ['insert', 'update', 'delete'][i % 3] as CDCOperation,
        table: 'users',
        after: { id: i, name: `user-${i}` },
        timestamp: Date.now(),
      }

      const start = performance.now()
      cdc.transform(event)
      transformTimes.push(performance.now() - start)
    }

    const stats = calculateStats(transformTimes)

    console.log('\n=== CDC Transform Benchmark ===')
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(stats.avg).toBeLessThan(0.5)
  })

  it('should benchmark sink to destination', async () => {
    const cdc = new CDCProcessor(100)
    const sinkTimes: number[] = []
    let sinkCount = 0

    // Register sink (synchronous for accurate benchmarking)
    cdc.registerSink('users', async (_event) => {
      // Simulate fast async sink (no actual delay for benchmarking)
      sinkCount++
    })

    // Capture events
    for (let i = 0; i < 500; i++) {
      cdc.capture('insert', 'users', undefined, { id: i, name: `user-${i}` })
    }

    // Benchmark batch processing
    while (cdc.bufferSize > 0) {
      const start = performance.now()
      await cdc.processBatch()
      sinkTimes.push(performance.now() - start)
    }

    const stats = calculateStats(sinkTimes)

    console.log('\n=== CDC Sink Benchmark ===')
    console.log(`Batches: ${stats.count}, Events sunk: ${sinkCount}`)
    console.log(`Avg: ${stats.avg.toFixed(4)}ms, P95: ${stats.p95.toFixed(4)}ms, P99: ${stats.p99.toFixed(4)}ms`)

    expect(sinkCount).toBe(500)
    expect(stats.avg).toBeLessThan(10) // Batch processing without simulated delay
  })
})

// ============================================================================
// SUMMARY BENCHMARK
// ============================================================================

describe('Streaming Primitives Summary', () => {
  it('should generate comprehensive benchmark report', async () => {
    console.log('\n========================================')
    console.log('STREAMING PRIMITIVES BENCHMARK SUMMARY')
    console.log('========================================\n')

    const results: Record<string, LatencyStats> = {}

    // Quick benchmark each component
    const iterations = 100

    // Window
    const window = new TumblingWindow<string, number>(1000)
    const windowTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      window.add(`key-${i}`, i, i * 10)
      windowTimes.push(performance.now() - start)
    }
    results['Window.add'] = calculateStats(windowTimes)

    // Watermark
    const tracker = new WatermarkTracker()
    const wmTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      tracker.advance('source', i * 100)
      wmTimes.push(performance.now() - start)
    }
    results['Watermark.advance'] = calculateStats(wmTimes)

    // Transaction
    const txManager = new TransactionManager()
    const txTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const txId = `tx-${i}`
      const start = performance.now()
      txManager.begin(txId)
      txManager.commit(txId)
      txTimes.push(performance.now() - start)
    }
    results['Transaction.cycle'] = calculateStats(txTimes)

    // State
    const operator = new StatefulOperator<string, number, number>()
    const stateTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      operator.updateState(`key-${i}`, i)
      operator.getState(`key-${i}`)
      stateTimes.push(performance.now() - start)
    }
    results['State.update+get'] = calculateStats(stateTimes)

    // Router
    const router = new PartitionRouter(32)
    const routeTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      router.hashRoute(`key-${i}`)
      routeTimes.push(performance.now() - start)
    }
    results['Router.hash'] = calculateStats(routeTimes)

    // CDC
    const cdc = new CDCProcessor()
    const cdcTimes: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      cdc.capture('insert', 'users', undefined, { id: i })
      cdcTimes.push(performance.now() - start)
    }
    results['CDC.capture'] = calculateStats(cdcTimes)

    // Print summary table
    console.log('Operation           | Avg (ms) | P95 (ms) | P99 (ms)')
    console.log('--------------------|----------|----------|----------')
    for (const [name, stats] of Object.entries(results)) {
      console.log(
        `${name.padEnd(19)} | ${stats.avg.toFixed(4).padStart(8)} | ${stats.p95.toFixed(4).padStart(8)} | ${stats.p99.toFixed(4).padStart(8)}`
      )
    }
    console.log('')

    // All operations should be fast
    for (const [name, stats] of Object.entries(results)) {
      expect(stats.avg, `${name} average latency`).toBeLessThan(1)
    }
  })
})
