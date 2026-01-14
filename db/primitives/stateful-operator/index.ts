/**
 * StatefulOperator - Flink-style stream state management primitive
 *
 * Provides state management capabilities for stream processing:
 * - StateBackend: Pluggable state storage interface
 * - KeyedState: State partitioned by key with hash/range partitioning
 * - WindowState: Time-based aggregation windows (tumbling, sliding, session)
 * - CheckpointBarrier: Distributed snapshot coordination
 * - StateTTL: Time-to-live state cleanup strategies
 * - StateRecovery: Checkpoint restoration
 * - StateMetrics: Observability for state operations
 *
 * @module db/primitives/stateful-operator
 */

import { murmurHash3, murmurHash3_32 } from '../utils/murmur3'

// =============================================================================
// Core Types
// =============================================================================

/**
 * Metadata for a state entry including TTL information
 */
export interface StateEntry<T> {
  value: T
  createdAt: number
  expiresAt?: number
}

/**
 * State snapshot for checkpointing
 */
export interface StateSnapshot {
  id: string
  timestamp: number
  data: Uint8Array
  metadata: {
    stateCount: number
    totalBytes: number
    checksum: string
  }
}

/**
 * Descriptor for state configuration
 */
export interface StateDescriptor<T> {
  name: string
  defaultValue?: T
  ttl?: StateTTLConfig
  serializer?: StateSerializer<T>
}

/**
 * TTL configuration for state
 */
export interface StateTTLConfig {
  ttlMs: number
  updateOnRead?: boolean
  updateOnWrite?: boolean
  cleanupStrategy: 'lazy' | 'eager' | 'rocksdb-compaction'
}

/**
 * State access mode
 */
export type StateAccess = 'read' | 'write' | 'readwrite'

/**
 * State serializer interface
 */
export interface StateSerializer<T> {
  serialize(value: T): Uint8Array
  deserialize(data: Uint8Array): T
}

/**
 * Abstract interface for state storage backends
 */
export interface StateBackend<T = unknown> {
  readonly name: string
  get(key: string): Promise<T | undefined>
  put(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): AsyncIterable<[string, T]>
  size(): Promise<number>
  snapshot(): Promise<StateSnapshot>
  restore(snapshot: StateSnapshot): Promise<void>
  clear(): Promise<void>
}

// =============================================================================
// InMemoryStateBackend
// =============================================================================

/**
 * In-memory implementation of StateBackend
 */
export class InMemoryStateBackend<T> implements StateBackend<T> {
  private entries = new Map<string, StateEntry<T>>()
  private snapshotCounter = 0

  constructor(readonly name: string) {}

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    // Check TTL expiration
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }

    return entry.value
  }

  async put(key: string, value: T, ttl?: number): Promise<void> {
    const entry: StateEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: ttl !== undefined ? Date.now() + ttl : undefined,
    }
    this.entries.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async *list(prefix?: string): AsyncIterable<[string, T]> {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      // Filter by prefix
      if (prefix !== undefined && !key.startsWith(prefix)) {
        continue
      }

      // Check TTL
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.entries.delete(key)
        continue
      }

      yield [key, entry.value]
    }
  }

  async size(): Promise<number> {
    // Clean up expired entries first
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.entries.delete(key)
      }
    }
    return this.entries.size
  }

  async snapshot(): Promise<StateSnapshot> {
    const id = `${this.name}-snap-${++this.snapshotCounter}-${Date.now()}`
    const timestamp = Date.now()

    // Serialize entries
    const serializedEntries: Array<[string, StateEntry<T>]> = []
    for (const [key, entry] of this.entries) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && timestamp >= entry.expiresAt) {
        continue
      }
      serializedEntries.push([key, entry])
    }

    const jsonData = JSON.stringify(serializedEntries)
    const data = new TextEncoder().encode(jsonData)
    const checksum = this.computeChecksum(data)

    return {
      id,
      timestamp,
      data,
      metadata: {
        stateCount: serializedEntries.length,
        totalBytes: data.length,
        checksum,
      },
    }
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    // Validate checksum
    const actualChecksum = this.computeChecksum(snapshot.data)
    if (actualChecksum !== snapshot.metadata.checksum) {
      throw new Error(`Checksum mismatch: expected ${snapshot.metadata.checksum}, got ${actualChecksum}`)
    }

    // Deserialize and restore
    const jsonData = new TextDecoder().decode(snapshot.data)
    const entries: Array<[string, StateEntry<T>]> = JSON.parse(jsonData)

    this.entries.clear()
    for (const [key, entry] of entries) {
      this.entries.set(key, entry)
    }
  }

  async clear(): Promise<void> {
    this.entries.clear()
  }

  private computeChecksum(data: Uint8Array): string {
    // Simple checksum using murmur hash
    const hash = murmurHash3_32(data, 0)
    return hash.toString(16)
  }
}

// =============================================================================
// KeyedState
// =============================================================================

/**
 * State partitioned by key
 */
export interface KeyedState<K, V> {
  get(key: K): Promise<V | undefined>
  put(key: K, value: V): Promise<void>
  update(key: K, fn: (v: V | undefined) => V): Promise<V>
  delete(key: K): Promise<void>
  keys(): AsyncIterableIterator<K>
  clear(): Promise<void>
}

/**
 * Partitioner interface for key distribution
 */
export interface Partitioner<K> {
  partition(key: K): number
  readonly numPartitions: number
}

/**
 * Hash-based partitioner for even key distribution
 */
export class HashPartitioner<K> implements Partitioner<K> {
  constructor(readonly numPartitions: number = 256) {}

  partition(key: K): number {
    const hash = murmurHash3(String(key), 0)
    return Math.abs(hash) % this.numPartitions
  }
}

/**
 * Range-based partitioner for ordered key access
 */
export class RangePartitioner<K extends string | number> implements Partitioner<K> {
  readonly numPartitions: number

  constructor(private readonly boundaries: K[]) {
    this.numPartitions = boundaries.length + 1
  }

  partition(key: K): number {
    for (let i = 0; i < this.boundaries.length; i++) {
      const boundary = this.boundaries[i]
      if (boundary !== undefined && key < boundary) {
        return i
      }
    }
    return this.boundaries.length
  }
}

/**
 * Implementation of KeyedState
 */
class KeyedStateImpl<K, V> implements KeyedState<K, V> {
  constructor(
    private backend: StateBackend<V>,
    private keySerializer: (key: K) => string = String,
  ) {}

  async get(key: K): Promise<V | undefined> {
    return this.backend.get(this.keySerializer(key))
  }

  async put(key: K, value: V): Promise<void> {
    await this.backend.put(this.keySerializer(key), value)
  }

  async update(key: K, fn: (v: V | undefined) => V): Promise<V> {
    const current = await this.get(key)
    const updated = fn(current)
    await this.put(key, updated)
    return updated
  }

  async delete(key: K): Promise<void> {
    await this.backend.delete(this.keySerializer(key))
  }

  async *keys(): AsyncIterableIterator<K> {
    for await (const [keyStr] of this.backend.list()) {
      // Note: This assumes K can be reconstructed from string
      // For complex keys, a deserializer would be needed
      yield keyStr as unknown as K
    }
  }

  async clear(): Promise<void> {
    await this.backend.clear()
  }
}

/**
 * Factory function to create a KeyedState
 */
export function createKeyedState<K, V>(
  backend: StateBackend<V>,
  keySerializer?: (key: K) => string,
): KeyedState<K, V> {
  return new KeyedStateImpl<K, V>(backend, keySerializer)
}

// =============================================================================
// WindowState
// =============================================================================

/**
 * Window key identifying a specific window instance
 */
export interface WindowKey {
  key: string
  windowStart: number
  windowEnd: number
}

/**
 * Window assigner interface
 */
export interface WindowAssigner {
  readonly windowSizeMs: number
  assignWindows(timestamp: number, existingWindows?: Map<string, { start: number; end: number }>): Array<{ start: number; end: number }>
}

/**
 * Tumbling window assigner (non-overlapping fixed-size windows)
 */
export class TumblingWindowAssigner implements WindowAssigner {
  constructor(readonly windowSizeMs: number) {}

  assignWindows(timestamp: number): Array<{ start: number; end: number }> {
    const windowStart = Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs
    return [{ start: windowStart, end: windowStart + this.windowSizeMs }]
  }
}

/**
 * Sliding window assigner (overlapping fixed-size windows)
 */
export class SlidingWindowAssigner implements WindowAssigner {
  constructor(
    readonly windowSizeMs: number,
    readonly slideMs: number,
  ) {
    if (slideMs <= 0) {
      throw new Error('Slide must be positive')
    }
    if (slideMs > windowSizeMs) {
      throw new Error('Slide cannot be larger than window size')
    }
  }

  assignWindows(timestamp: number): Array<{ start: number; end: number }> {
    const windows: Array<{ start: number; end: number }> = []

    // Find the last window start that contains this timestamp
    const lastWindowStart = Math.floor(timestamp / this.slideMs) * this.slideMs

    // Count backwards to find all windows
    const numWindows = Math.ceil(this.windowSizeMs / this.slideMs)

    for (let i = 0; i < numWindows; i++) {
      const windowStart = lastWindowStart - i * this.slideMs
      const windowEnd = windowStart + this.windowSizeMs

      // Check if this window actually contains the timestamp
      if (windowStart <= timestamp && timestamp < windowEnd) {
        windows.push({ start: windowStart, end: windowEnd })
      }
    }

    return windows.sort((a, b) => a.start - b.start)
  }
}

/**
 * Session window assigner (gap-based dynamic windows)
 */
export class SessionWindowAssigner implements WindowAssigner {
  constructor(readonly gapMs: number) {}

  get windowSizeMs(): number {
    return this.gapMs // Minimum size
  }

  assignWindows(
    timestamp: number,
    existingWindows?: Map<string, { start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    const newWindow = { start: timestamp, end: timestamp + this.gapMs }

    if (!existingWindows || existingWindows.size === 0) {
      return [newWindow]
    }

    // Find overlapping or adjacent sessions to merge
    const windowsToMerge: Array<{ start: number; end: number }> = [newWindow]

    for (const w of existingWindows.values()) {
      // Check if windows should merge (overlap or within gap)
      const overlapOrAdjacent =
        (newWindow.start <= w.end && newWindow.end >= w.start) ||
        Math.abs(newWindow.start - w.end) <= this.gapMs ||
        Math.abs(w.start - newWindow.end) <= this.gapMs

      if (overlapOrAdjacent) {
        windowsToMerge.push(w)
      }
    }

    if (windowsToMerge.length === 1) {
      return [newWindow]
    }

    // Merge all overlapping windows
    const mergedStart = Math.min(...windowsToMerge.map((w) => w.start))
    const maxTimestamp = Math.max(timestamp, ...windowsToMerge.map((w) => w.end - this.gapMs))
    const mergedEnd = maxTimestamp + this.gapMs

    return [{ start: mergedStart, end: mergedEnd }]
  }
}

/**
 * Window-aware state management
 */
export interface WindowState<T> {
  getWindow(key: string, start: number, end: number): Promise<T | undefined>
  updateWindow(key: string, start: number, end: number, fn: (v: T | undefined) => T): Promise<T>
  expireWindows(before: number): Promise<number>
  activeWindows(key: string): AsyncIterableIterator<WindowKey>
}

/**
 * Implementation of WindowState
 */
class WindowStateImpl<T> implements WindowState<T> {
  constructor(
    private backend: StateBackend<T>,
    private assigner: WindowAssigner,
  ) {}

  private encodeWindowKey(key: string, start: number, end: number): string {
    return `${key}:${start}:${end}`
  }

  private decodeWindowKey(encoded: string): WindowKey {
    const parts = encoded.split(':')
    const end = parseInt(parts.pop()!, 10)
    const start = parseInt(parts.pop()!, 10)
    const key = parts.join(':')
    return { key, windowStart: start, windowEnd: end }
  }

  async getWindow(key: string, start: number, end: number): Promise<T | undefined> {
    const windowKey = this.encodeWindowKey(key, start, end)
    return this.backend.get(windowKey)
  }

  async updateWindow(key: string, start: number, end: number, fn: (v: T | undefined) => T): Promise<T> {
    const windowKey = this.encodeWindowKey(key, start, end)
    const current = await this.backend.get(windowKey)
    const updated = fn(current)
    await this.backend.put(windowKey, updated)
    return updated
  }

  async expireWindows(before: number): Promise<number> {
    let expired = 0
    const keysToDelete: string[] = []

    for await (const [encodedKey] of this.backend.list()) {
      const windowKey = this.decodeWindowKey(encodedKey)
      if (windowKey.windowEnd < before) {
        keysToDelete.push(encodedKey)
        expired++
      }
    }

    for (const key of keysToDelete) {
      await this.backend.delete(key)
    }

    return expired
  }

  async *activeWindows(key: string): AsyncIterableIterator<WindowKey> {
    const prefix = `${key}:`
    for await (const [encodedKey] of this.backend.list(prefix)) {
      yield this.decodeWindowKey(encodedKey)
    }
  }
}

/**
 * Factory function to create a WindowState
 */
export function createWindowState<T>(backend: StateBackend<T>, assigner: WindowAssigner): WindowState<T> {
  return new WindowStateImpl<T>(backend, assigner)
}

// =============================================================================
// CheckpointBarrier
// =============================================================================

/**
 * Checkpoint options
 */
export interface CheckpointOptions {
  mode?: 'aligned' | 'unaligned'
  timeout?: number
  savepoint?: boolean
}

/**
 * Checkpoint barrier flowing through dataflow
 */
export interface CheckpointBarrier {
  checkpointId: bigint
  timestamp: number
  options: CheckpointOptions
}

/**
 * Result of a checkpoint operation
 */
export interface CheckpointResult {
  checkpointId: bigint
  status: 'completed' | 'failed'
  failureReason?: string
  isSavepoint?: boolean
  duration?: number
}

/**
 * Source interface for checkpoint injection
 */
export interface CheckpointSource {
  injectBarrier(barrier: CheckpointBarrier): Promise<void>
}

/**
 * Sink interface for checkpoint acknowledgement
 */
export interface CheckpointSink {
  acknowledge(checkpointId: bigint): Promise<void>
}

/**
 * Aligns checkpoint barriers from multiple input channels
 */
export class BarrierAligner {
  private pendingBarriers = new Map<string, CheckpointBarrier>()
  private blockedChannels = new Set<string>()

  constructor(
    private inputChannels: string[],
    private onAligned: (barrier: CheckpointBarrier) => Promise<void>,
  ) {}

  async processBarrier(channel: string, barrier: CheckpointBarrier): Promise<void> {
    this.pendingBarriers.set(channel, barrier)
    this.blockedChannels.add(channel)

    if (this.allBarriersReceived(barrier.checkpointId)) {
      await this.onAligned(barrier)
      this.releaseBlocked()
    }
  }

  isBlocked(channel: string): boolean {
    return this.blockedChannels.has(channel)
  }

  private allBarriersReceived(checkpointId: bigint): boolean {
    return this.inputChannels.every(
      (ch) => this.pendingBarriers.get(ch)?.checkpointId === checkpointId,
    )
  }

  private releaseBlocked(): void {
    this.pendingBarriers.clear()
    this.blockedChannels.clear()
  }
}

/**
 * Coordinator configuration
 */
export interface CheckpointCoordinatorConfig {
  sources: CheckpointSource[]
  sinks: CheckpointSink[]
  defaultTimeout?: number
}

/**
 * Coordinates checkpoint barriers across operators
 */
export class CheckpointCoordinator {
  private nextCheckpointId = 1n
  private pendingCheckpoints = new Map<bigint, {
    startTime: number
    acknowledgedSinks: Set<number>
    options: CheckpointOptions
  }>()

  constructor(private config: CheckpointCoordinatorConfig) {}

  async triggerCheckpoint(options?: CheckpointOptions): Promise<CheckpointResult> {
    const checkpointId = this.nextCheckpointId++
    const startTime = Date.now()
    const timeout = options?.timeout ?? this.config.defaultTimeout ?? 60000

    const barrier: CheckpointBarrier = {
      checkpointId,
      timestamp: startTime,
      options: {
        mode: options?.mode ?? 'aligned',
        timeout,
        savepoint: options?.savepoint,
      },
    }

    // Track pending checkpoint
    this.pendingCheckpoints.set(checkpointId, {
      startTime,
      acknowledgedSinks: new Set(),
      options: barrier.options,
    })

    try {
      // Inject barrier at all sources
      await Promise.all(this.config.sources.map((s) => s.injectBarrier(barrier)))

      // Wait for all sinks to acknowledge with timeout
      const result = await this.waitForCompletion(checkpointId, timeout)

      return {
        checkpointId,
        status: result ? 'completed' : 'failed',
        failureReason: result ? undefined : 'Timeout waiting for sink acknowledgements',
        isSavepoint: options?.savepoint,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        checkpointId,
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        isSavepoint: options?.savepoint,
        duration: Date.now() - startTime,
      }
    } finally {
      this.pendingCheckpoints.delete(checkpointId)
    }
  }

  acknowledgeSink(checkpointId: bigint, sinkIndex: number): void {
    const pending = this.pendingCheckpoints.get(checkpointId)
    if (pending) {
      pending.acknowledgedSinks.add(sinkIndex)
    }
  }

  private async waitForCompletion(checkpointId: bigint, timeout: number): Promise<boolean> {
    const pending = this.pendingCheckpoints.get(checkpointId)
    if (!pending) return false

    const numSinks = this.config.sinks.length

    // Create a timeout promise
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout)
    })

    // Create acknowledgement promises with individual timeouts
    const ackPromises = this.config.sinks.map((sink, index) =>
      Promise.race([
        sink.acknowledge(checkpointId).then(() => {
          this.acknowledgeSink(checkpointId, index)
          return 'ack' as const
        }),
        timeoutPromise,
      ]).catch(() => 'error' as const),
    )

    // Wait for all with overall timeout
    const results = await Promise.race([
      Promise.all(ackPromises),
      timeoutPromise.then(() => 'timeout' as const),
    ])

    if (results === 'timeout') {
      return false
    }

    // Check if all sinks acknowledged
    return pending.acknowledgedSinks.size >= numSinks
  }
}

// =============================================================================
// TTL State
// =============================================================================

/**
 * Cleanup strategy configuration
 */
export type CleanupStrategy =
  | { type: 'lazy' }
  | { type: 'eager'; intervalMs: number }
  | { type: 'watermark'; allowedLateness: number }

/**
 * TTL policy configuration
 */
export interface TTLPolicy {
  ttlMs: number
  updateOnRead: boolean
  updateOnWrite: boolean
  cleanupStrategy: CleanupStrategy
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  cleanedCount: number
  timestamp: number
}

/**
 * Alarm scheduler interface for eager cleanup
 */
export interface AlarmScheduler {
  schedule(callback: () => void, intervalMs: number): void
  cancel(): void
}

/**
 * Internal entry with TTL metadata
 */
interface TTLEntry<T> {
  value: T
  createdAt: number
  lastAccessedAt: number
  expiresAt: number
}

/**
 * TTL wrapper for StateBackend
 */
export class TTLStateWrapper<T> implements StateBackend<T> {
  private ttlEntries = new Map<string, TTLEntry<T>>()

  constructor(
    private inner: StateBackend<T>,
    private policy: TTLPolicy,
    private scheduler?: AlarmScheduler,
  ) {
    if (policy.cleanupStrategy.type === 'eager' && scheduler) {
      scheduler.schedule(() => this.runCleanup(), policy.cleanupStrategy.intervalMs)
    }
  }

  get name(): string {
    return this.inner.name
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.ttlEntries.get(key)
    const now = Date.now()

    if (!entry) {
      return undefined
    }

    // Check expiration
    if (this.isExpired(entry, now)) {
      this.ttlEntries.delete(key)
      await this.inner.delete(key)
      return undefined
    }

    // Update TTL on read if configured
    if (this.policy.updateOnRead) {
      entry.lastAccessedAt = now
      entry.expiresAt = now + this.policy.ttlMs
    }

    return entry.value
  }

  async put(key: string, value: T, ttl?: number): Promise<void> {
    const now = Date.now()
    const effectiveTtl = ttl ?? this.policy.ttlMs

    const entry: TTLEntry<T> = {
      value,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + effectiveTtl,
    }

    this.ttlEntries.set(key, entry)
    await this.inner.put(key, value, effectiveTtl)
  }

  async delete(key: string): Promise<void> {
    this.ttlEntries.delete(key)
    await this.inner.delete(key)
  }

  async *list(prefix?: string): AsyncIterable<[string, T]> {
    const now = Date.now()
    for (const [key, entry] of this.ttlEntries) {
      if (prefix !== undefined && !key.startsWith(prefix)) {
        continue
      }
      if (!this.isExpired(entry, now)) {
        yield [key, entry.value]
      }
    }
  }

  async size(): Promise<number> {
    const now = Date.now()
    let count = 0
    for (const entry of this.ttlEntries.values()) {
      if (!this.isExpired(entry, now)) {
        count++
      }
    }
    return count
  }

  async snapshot(): Promise<StateSnapshot> {
    return this.inner.snapshot()
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    await this.inner.restore(snapshot)
    // Clear TTL entries and rebuild from inner state
    this.ttlEntries.clear()
    const now = Date.now()
    for await (const [key, value] of this.inner.list()) {
      this.ttlEntries.set(key, {
        value,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + this.policy.ttlMs,
      })
    }
  }

  async clear(): Promise<void> {
    this.ttlEntries.clear()
    await this.inner.clear()
  }

  async runCleanup(): Promise<CleanupResult> {
    const now = Date.now()
    let cleaned = 0
    const keysToDelete: string[] = []

    for (const [key, entry] of this.ttlEntries) {
      if (this.isExpired(entry, now)) {
        keysToDelete.push(key)
        cleaned++
      }
    }

    for (const key of keysToDelete) {
      this.ttlEntries.delete(key)
      await this.inner.delete(key)
    }

    return { cleanedCount: cleaned, timestamp: now }
  }

  async onWatermark(watermark: number): Promise<void> {
    if (this.policy.cleanupStrategy.type === 'watermark') {
      const allowedLateness = this.policy.cleanupStrategy.allowedLateness
      const cutoff = watermark - allowedLateness

      const keysToDelete: string[] = []
      for (const [key, entry] of this.ttlEntries) {
        if (entry.createdAt < cutoff) {
          keysToDelete.push(key)
        }
      }

      for (const key of keysToDelete) {
        this.ttlEntries.delete(key)
        await this.inner.delete(key)
      }
    }
  }

  private isExpired(entry: TTLEntry<T>, now: number): boolean {
    return now >= entry.expiresAt
  }
}

// =============================================================================
// State Recovery
// =============================================================================

/**
 * Checkpoint metadata stored in checkpoint store
 */
export interface CheckpointMetadata {
  checkpointId: bigint
  timestamp: number
  operatorStates: Map<string, string> // operatorId -> snapshotId
  sourceOffsets: Map<string, unknown>
  status: 'in_progress' | 'completed' | 'failed'
}

/**
 * Checkpoint store interface
 */
export interface CheckpointStore {
  listCompleted(): Promise<CheckpointMetadata[]>
  get(checkpointId: bigint): Promise<CheckpointMetadata | undefined>
  getSnapshot(snapshotId: string): Promise<StateSnapshot>
}

/**
 * Stateful operator interface for recovery
 */
export interface StatefulOperator {
  restoreState(snapshot: StateSnapshot): Promise<void>
}

/**
 * Manages state recovery from checkpoints
 */
export class StateRecoveryManager {
  constructor(
    private checkpointStore: CheckpointStore,
    private operators: Map<string, StatefulOperator>,
  ) {}

  async findLatestCheckpoint(): Promise<CheckpointMetadata | undefined> {
    const checkpoints = await this.checkpointStore.listCompleted()
    if (checkpoints.length === 0) {
      return undefined
    }
    return checkpoints.sort((a, b) => Number(b.checkpointId - a.checkpointId))[0]
  }

  async recover(checkpointId?: bigint): Promise<void> {
    const checkpoint = checkpointId
      ? await this.checkpointStore.get(checkpointId)
      : await this.findLatestCheckpoint()

    if (!checkpoint) {
      throw new Error('No checkpoint available for recovery')
    }

    // Restore each operator's state
    for (const [opId, snapshotId] of checkpoint.operatorStates) {
      const operator = this.operators.get(opId)
      if (operator) {
        const snapshot = await this.checkpointStore.getSnapshot(snapshotId)
        await operator.restoreState(snapshot)
      }
    }
  }
}

// =============================================================================
// State Metrics
// =============================================================================

/**
 * Counter metric
 */
export interface Counter {
  inc(amount?: number): void
  value(): number
}

/**
 * Gauge metric
 */
export interface Gauge {
  set(value: number): void
  value(): number
}

/**
 * Histogram metric
 */
export interface Histogram {
  observe(value: number): void
  values(): number[]
}

/**
 * State metrics
 */
export interface StateMetrics {
  keyCount: number
  totalBytes: number
  largestKey: { key: string; bytes: number }
  reads: Counter
  writes: Counter
  deletes: Counter
  cacheHits: Counter
  cacheMisses: Counter
  lastCheckpointDuration: Gauge
  lastCheckpointSize: Gauge
  checkpointFailures: Counter
  expiredKeys: Counter
  cleanupDuration: Histogram
}

/**
 * Metrics registry interface
 */
export interface MetricsRegistry {
  createCounter(name: string): Counter
  createGauge(name: string): Gauge
  createHistogram(name: string): Histogram
}

/**
 * Simple counter implementation
 */
class SimpleCounter implements Counter {
  private count = 0

  inc(amount = 1): void {
    this.count += amount
  }

  value(): number {
    return this.count
  }
}

/**
 * Simple gauge implementation
 */
class SimpleGauge implements Gauge {
  private val = 0

  set(value: number): void {
    this.val = value
  }

  value(): number {
    return this.val
  }
}

/**
 * Simple histogram implementation
 */
class SimpleHistogram implements Histogram {
  private observations: number[] = []

  observe(value: number): void {
    this.observations.push(value)
  }

  values(): number[] {
    return [...this.observations]
  }
}

/**
 * Create a metrics registry
 */
export function createStateMetrics(): MetricsRegistry {
  return {
    createCounter: () => new SimpleCounter(),
    createGauge: () => new SimpleGauge(),
    createHistogram: () => new SimpleHistogram(),
  }
}

/**
 * Metrics wrapper for StateBackend
 */
export class MetricsStateWrapper<T> implements StateBackend<T> {
  private metrics: StateMetrics

  constructor(
    private inner: StateBackend<T>,
    private registry: MetricsRegistry,
    private operatorName: string,
  ) {
    this.metrics = {
      keyCount: 0,
      totalBytes: 0,
      largestKey: { key: '', bytes: 0 },
      reads: registry.createCounter(`${operatorName}_reads`),
      writes: registry.createCounter(`${operatorName}_writes`),
      deletes: registry.createCounter(`${operatorName}_deletes`),
      cacheHits: registry.createCounter(`${operatorName}_cache_hits`),
      cacheMisses: registry.createCounter(`${operatorName}_cache_misses`),
      lastCheckpointDuration: registry.createGauge(`${operatorName}_checkpoint_duration`),
      lastCheckpointSize: registry.createGauge(`${operatorName}_checkpoint_size`),
      checkpointFailures: registry.createCounter(`${operatorName}_checkpoint_failures`),
      expiredKeys: registry.createCounter(`${operatorName}_expired_keys`),
      cleanupDuration: registry.createHistogram(`${operatorName}_cleanup_duration`),
    }
  }

  get name(): string {
    return this.inner.name
  }

  async get(key: string): Promise<T | undefined> {
    this.metrics.reads.inc()
    return this.inner.get(key)
  }

  async put(key: string, value: T, ttl?: number): Promise<void> {
    this.metrics.writes.inc()
    await this.inner.put(key, value, ttl)
    await this.updateSizeMetrics()
  }

  async delete(key: string): Promise<void> {
    this.metrics.deletes.inc()
    await this.inner.delete(key)
    await this.updateSizeMetrics()
  }

  async *list(prefix?: string): AsyncIterable<[string, T]> {
    for await (const entry of this.inner.list(prefix)) {
      yield entry
    }
  }

  async size(): Promise<number> {
    return this.inner.size()
  }

  async snapshot(): Promise<StateSnapshot> {
    const start = performance.now()
    try {
      const snapshot = await this.inner.snapshot()
      this.metrics.lastCheckpointDuration.set(performance.now() - start)
      this.metrics.lastCheckpointSize.set(snapshot.metadata.totalBytes)
      return snapshot
    } catch (error) {
      this.metrics.checkpointFailures.inc()
      throw error
    }
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    await this.inner.restore(snapshot)
    await this.updateSizeMetrics()
  }

  async clear(): Promise<void> {
    await this.inner.clear()
    this.metrics.keyCount = 0
    this.metrics.totalBytes = 0
  }

  getMetrics(): StateMetrics {
    return this.metrics
  }

  private async updateSizeMetrics(): Promise<void> {
    const size = await this.inner.size()
    this.metrics.keyCount = size

    // Estimate total bytes (simplified)
    let totalBytes = 0
    let largestKey = { key: '', bytes: 0 }

    for await (const [key, value] of this.inner.list()) {
      const bytes = JSON.stringify(value).length + key.length
      totalBytes += bytes
      if (bytes > largestKey.bytes) {
        largestKey = { key, bytes }
      }
    }

    this.metrics.totalBytes = totalBytes
    this.metrics.largestKey = largestKey
  }
}
