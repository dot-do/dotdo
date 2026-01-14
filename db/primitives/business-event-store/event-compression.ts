/**
 * EventCompression - Event deduplication, batching, and compression
 *
 * Provides storage optimization for business events:
 * - Content-based deduplication using hash signatures
 * - Batching for high-frequency events
 * - Field-level compression for repeated values (dictionary encoding)
 * - Reference compression for linked events
 * - Configurable compression policies
 *
 * @module db/primitives/business-event-store/event-compression
 */

import type { BusinessEvent, EventType, EventAction } from './index'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Hash algorithm for event deduplication
 */
export type HashAlgorithm = 'xxhash' | 'murmur3' | 'fnv1a'

/**
 * Compression level for storage
 */
export type CompressionLevel = 'none' | 'low' | 'medium' | 'high'

/**
 * Deduplication strategy
 */
export type DeduplicationStrategy = 'content' | 'idempotency-key' | 'time-window' | 'semantic'

/**
 * Batching strategy for high-frequency events
 */
export type BatchingStrategy = 'time-window' | 'count' | 'size' | 'adaptive'

/**
 * Event compression policy configuration
 */
export interface CompressionPolicy {
  /** Enable deduplication */
  deduplication: boolean
  /** Deduplication strategy */
  deduplicationStrategy: DeduplicationStrategy
  /** Time window for time-based deduplication (ms) */
  deduplicationWindow?: number
  /** Fields to include in deduplication hash (default: all) */
  deduplicationFields?: (keyof BusinessEvent)[]

  /** Enable batching */
  batching: boolean
  /** Batching strategy */
  batchingStrategy: BatchingStrategy
  /** Batch size limit */
  batchSize?: number
  /** Batch time window (ms) */
  batchWindow?: number
  /** Fields to group batches by */
  batchGroupBy?: (keyof BusinessEvent)[]

  /** Enable field-level compression */
  fieldCompression: boolean
  /** Compression level */
  compressionLevel: CompressionLevel
  /** Minimum dictionary size before enabling compression */
  dictionaryThreshold?: number

  /** Enable reference compression for linked events */
  referenceCompression: boolean
}

/**
 * Default compression policy
 */
export const DEFAULT_COMPRESSION_POLICY: CompressionPolicy = {
  deduplication: true,
  deduplicationStrategy: 'content',
  deduplicationWindow: 1000, // 1 second window
  batching: true,
  batchingStrategy: 'adaptive',
  batchSize: 100,
  batchWindow: 100, // 100ms
  fieldCompression: true,
  compressionLevel: 'medium',
  dictionaryThreshold: 10,
  referenceCompression: true,
}

/**
 * Event signature for deduplication
 */
export interface EventSignature {
  /** Hash of the event content */
  hash: string
  /** Algorithm used */
  algorithm: HashAlgorithm
  /** Fields included in hash */
  fields: string[]
  /** Timestamp when signature was created */
  createdAt: Date
}

/**
 * Batch of events for storage efficiency
 */
export interface EventBatch {
  /** Batch ID */
  id: string
  /** Events in the batch */
  events: CompressedEvent[]
  /** Batch metadata */
  metadata: BatchMetadata
  /** Compression statistics */
  stats: CompressionStats
}

/**
 * Batch metadata
 */
export interface BatchMetadata {
  /** Time range of events in batch */
  timeRange: { start: Date; end: Date }
  /** Event types in batch */
  eventTypes: EventType[]
  /** Group key (if batching by group) */
  groupKey?: string
  /** Number of original events (before deduplication) */
  originalCount: number
  /** Number of deduplicated events */
  deduplicatedCount: number
}

/**
 * Compressed event representation
 */
export interface CompressedEvent {
  /** Event ID */
  id: string
  /** Event type (dictionary-encoded index) */
  typeIndex: number
  /** Record time (delta-encoded from batch start) */
  recordTimeDelta: number
  /** Event time (delta-encoded from batch start) */
  whenDelta: number
  /** Compressed what field (dictionary-encoded indices) */
  whatIndices: number[]
  /** Compressed where field (dictionary-encoded index, -1 if null) */
  whereIndex: number
  /** Compressed why field (dictionary-encoded index, -1 if null) */
  whyIndex: number
  /** Compressed who field (dictionary-encoded index, -1 if null) */
  whoIndex: number
  /** Compressed how field (dictionary-encoded index, -1 if null) */
  howIndex: number
  /** Action (dictionary-encoded index, -1 if null) */
  actionIndex: number
  /** Channel (dictionary-encoded index, -1 if null) */
  channelIndex: number
  /** Session ID (dictionary-encoded index, -1 if null) */
  sessionIdIndex: number
  /** Device ID (dictionary-encoded index, -1 if null) */
  deviceIdIndex: number
  /** Compressed causedBy (reference index or full ID) */
  causedByRef: string | number
  /** Compressed parentEventId (reference index or full ID) */
  parentEventRef: string | number
  /** Correlation ID (dictionary-encoded index, -1 if null) */
  correlationIdIndex: number
  /** Additional fields stored as compressed JSON */
  extensionsCompressed?: Uint8Array
  /** Original event hash for verification */
  hash: string
}

/**
 * Dictionary for field-level compression
 */
export interface CompressionDictionary {
  /** Event types */
  eventTypes: EventType[]
  /** Event actions */
  actions: EventAction[]
  /** Object IDs (what field) */
  objectIds: string[]
  /** Locations (where field) */
  locations: string[]
  /** Business steps (why field) */
  businessSteps: string[]
  /** Parties (who field) */
  parties: string[]
  /** Dispositions (how field) */
  dispositions: string[]
  /** Channels */
  channels: string[]
  /** Session IDs */
  sessionIds: string[]
  /** Device IDs */
  deviceIds: string[]
  /** Correlation IDs */
  correlationIds: string[]
  /** Event IDs (for reference compression) */
  eventIds: string[]
}

/**
 * Compression statistics
 */
export interface CompressionStats {
  /** Original size in bytes */
  originalSize: number
  /** Compressed size in bytes */
  compressedSize: number
  /** Compression ratio */
  compressionRatio: number
  /** Number of duplicates removed */
  duplicatesRemoved: number
  /** Dictionary sizes by field */
  dictionarySizes: Record<string, number>
  /** Time spent compressing (ms) */
  compressionTimeMs: number
  /** Time spent decompressing (ms) */
  decompressionTimeMs: number
}

/**
 * Deduplication result
 */
export interface DeduplicationResult {
  /** Unique events after deduplication */
  events: BusinessEvent[]
  /** Number of duplicates found */
  duplicateCount: number
  /** Signatures of removed duplicates */
  removedSignatures: EventSignature[]
  /** Processing time (ms) */
  processingTimeMs: number
}

/**
 * Batching result
 */
export interface BatchingResult {
  /** Created batches */
  batches: EventBatch[]
  /** Number of events batched */
  eventCount: number
  /** Total batches created */
  batchCount: number
  /** Processing time (ms) */
  processingTimeMs: number
}

// =============================================================================
// Hash Functions
// =============================================================================

/**
 * FNV-1a hash (fast, good distribution)
 */
function fnv1a(data: string): string {
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 16777619) // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * MurmurHash3 32-bit (good for hash tables)
 */
function murmur3(data: string, seed: number = 0): string {
  let h1 = seed
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593

  // Body
  const len = data.length
  const nblocks = Math.floor(len / 4)

  for (let i = 0; i < nblocks; i++) {
    let k1 =
      (data.charCodeAt(i * 4) & 0xff) |
      ((data.charCodeAt(i * 4 + 1) & 0xff) << 8) |
      ((data.charCodeAt(i * 4 + 2) & 0xff) << 16) |
      ((data.charCodeAt(i * 4 + 3) & 0xff) << 24)

    k1 = Math.imul(k1, c1)
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 = Math.imul(k1, c2)

    h1 ^= k1
    h1 = (h1 << 13) | (h1 >>> 19)
    h1 = Math.imul(h1, 5) + 0xe6546b64
  }

  // Tail
  let k1 = 0
  const tail = nblocks * 4
  switch (len & 3) {
    case 3:
      k1 ^= (data.charCodeAt(tail + 2) & 0xff) << 16
    // falls through
    case 2:
      k1 ^= (data.charCodeAt(tail + 1) & 0xff) << 8
    // falls through
    case 1:
      k1 ^= data.charCodeAt(tail) & 0xff
      k1 = Math.imul(k1, c1)
      k1 = (k1 << 15) | (k1 >>> 17)
      k1 = Math.imul(k1, c2)
      h1 ^= k1
  }

  // Finalization
  h1 ^= len
  h1 ^= h1 >>> 16
  h1 = Math.imul(h1, 0x85ebca6b)
  h1 ^= h1 >>> 13
  h1 = Math.imul(h1, 0xc2b2ae35)
  h1 ^= h1 >>> 16

  return (h1 >>> 0).toString(16).padStart(8, '0')
}

/**
 * xxHash 32-bit (very fast)
 */
function xxhash32(data: string, seed: number = 0): string {
  const PRIME32_1 = 0x9e3779b1
  const PRIME32_2 = 0x85ebca77
  const PRIME32_3 = 0xc2b2ae3d
  const PRIME32_4 = 0x27d4eb2f
  const PRIME32_5 = 0x165667b1

  const len = data.length
  let h32: number

  if (len >= 16) {
    let v1 = (seed + PRIME32_1 + PRIME32_2) | 0
    let v2 = (seed + PRIME32_2) | 0
    let v3 = seed | 0
    let v4 = (seed - PRIME32_1) | 0

    const limit = len - 16
    let p = 0

    while (p <= limit) {
      const k1 =
        (data.charCodeAt(p) & 0xff) |
        ((data.charCodeAt(p + 1) & 0xff) << 8) |
        ((data.charCodeAt(p + 2) & 0xff) << 16) |
        ((data.charCodeAt(p + 3) & 0xff) << 24)
      v1 = Math.imul((v1 + Math.imul(k1, PRIME32_2)) | 0, PRIME32_1)
      v1 = ((v1 << 13) | (v1 >>> 19)) | 0

      const k2 =
        (data.charCodeAt(p + 4) & 0xff) |
        ((data.charCodeAt(p + 5) & 0xff) << 8) |
        ((data.charCodeAt(p + 6) & 0xff) << 16) |
        ((data.charCodeAt(p + 7) & 0xff) << 24)
      v2 = Math.imul((v2 + Math.imul(k2, PRIME32_2)) | 0, PRIME32_1)
      v2 = ((v2 << 13) | (v2 >>> 19)) | 0

      const k3 =
        (data.charCodeAt(p + 8) & 0xff) |
        ((data.charCodeAt(p + 9) & 0xff) << 8) |
        ((data.charCodeAt(p + 10) & 0xff) << 16) |
        ((data.charCodeAt(p + 11) & 0xff) << 24)
      v3 = Math.imul((v3 + Math.imul(k3, PRIME32_2)) | 0, PRIME32_1)
      v3 = ((v3 << 13) | (v3 >>> 19)) | 0

      const k4 =
        (data.charCodeAt(p + 12) & 0xff) |
        ((data.charCodeAt(p + 13) & 0xff) << 8) |
        ((data.charCodeAt(p + 14) & 0xff) << 16) |
        ((data.charCodeAt(p + 15) & 0xff) << 24)
      v4 = Math.imul((v4 + Math.imul(k4, PRIME32_2)) | 0, PRIME32_1)
      v4 = ((v4 << 13) | (v4 >>> 19)) | 0

      p += 16
    }

    h32 =
      (((v1 << 1) | (v1 >>> 31)) +
        ((v2 << 7) | (v2 >>> 25)) +
        ((v3 << 12) | (v3 >>> 20)) +
        ((v4 << 18) | (v4 >>> 14))) |
      0
  } else {
    h32 = (seed + PRIME32_5) | 0
  }

  h32 = (h32 + len) | 0

  // Process remaining bytes
  let p = len - (len % 16)
  while (p + 4 <= len) {
    const k =
      (data.charCodeAt(p) & 0xff) |
      ((data.charCodeAt(p + 1) & 0xff) << 8) |
      ((data.charCodeAt(p + 2) & 0xff) << 16) |
      ((data.charCodeAt(p + 3) & 0xff) << 24)
    h32 = (h32 + Math.imul(k, PRIME32_3)) | 0
    h32 = Math.imul((h32 << 17) | (h32 >>> 15), PRIME32_4)
    p += 4
  }

  while (p < len) {
    h32 = (h32 + Math.imul(data.charCodeAt(p) & 0xff, PRIME32_5)) | 0
    h32 = Math.imul((h32 << 11) | (h32 >>> 21), PRIME32_1)
    p++
  }

  // Avalanche
  h32 ^= h32 >>> 15
  h32 = Math.imul(h32, PRIME32_2)
  h32 ^= h32 >>> 13
  h32 = Math.imul(h32, PRIME32_3)
  h32 ^= h32 >>> 16

  return (h32 >>> 0).toString(16).padStart(8, '0')
}

/**
 * Compute hash using specified algorithm
 */
function computeHash(data: string, algorithm: HashAlgorithm): string {
  switch (algorithm) {
    case 'xxhash':
      return xxhash32(data)
    case 'murmur3':
      return murmur3(data)
    case 'fnv1a':
      return fnv1a(data)
    default:
      return fnv1a(data)
  }
}

// =============================================================================
// EventDeduplicator Class
// =============================================================================

/**
 * Event deduplicator for removing duplicate events
 */
export class EventDeduplicator {
  private policy: CompressionPolicy
  private seenHashes: Map<string, { timestamp: Date; eventId: string }> = new Map()
  private hashAlgorithm: HashAlgorithm = 'xxhash'

  constructor(policy: Partial<CompressionPolicy> = {}) {
    this.policy = { ...DEFAULT_COMPRESSION_POLICY, ...policy }
  }

  /**
   * Generate signature for an event
   */
  generateSignature(event: BusinessEvent): EventSignature {
    const fields = this.policy.deduplicationFields || this.getDefaultFields()
    const data = this.serializeFields(event, fields)
    const hash = computeHash(data, this.hashAlgorithm)

    return {
      hash,
      algorithm: this.hashAlgorithm,
      fields: fields as string[],
      createdAt: new Date(),
    }
  }

  /**
   * Check if event is a duplicate
   */
  isDuplicate(event: BusinessEvent): boolean {
    const signature = this.generateSignature(event)

    switch (this.policy.deduplicationStrategy) {
      case 'content':
        return this.isContentDuplicate(signature)

      case 'time-window':
        return this.isTimeWindowDuplicate(signature, event)

      case 'idempotency-key':
        return this.isIdempotencyDuplicate(event)

      case 'semantic':
        return this.isSemanticDuplicate(event)

      default:
        return this.isContentDuplicate(signature)
    }
  }

  /**
   * Deduplicate a batch of events
   */
  deduplicate(events: BusinessEvent[]): DeduplicationResult {
    const startTime = performance.now()
    const uniqueEvents: BusinessEvent[] = []
    const removedSignatures: EventSignature[] = []

    for (const event of events) {
      if (!this.isDuplicate(event)) {
        uniqueEvents.push(event)
        // Mark as seen
        const signature = this.generateSignature(event)
        this.seenHashes.set(signature.hash, {
          timestamp: event.when,
          eventId: event.id,
        })
      } else {
        removedSignatures.push(this.generateSignature(event))
      }
    }

    // Clean up old hashes outside time window
    this.cleanupOldHashes()

    return {
      events: uniqueEvents,
      duplicateCount: events.length - uniqueEvents.length,
      removedSignatures,
      processingTimeMs: performance.now() - startTime,
    }
  }

  /**
   * Clear deduplication state
   */
  clear(): void {
    this.seenHashes.clear()
  }

  /**
   * Get deduplication statistics
   */
  getStats(): { hashCount: number; memoryUsage: number } {
    return {
      hashCount: this.seenHashes.size,
      // Approximate memory: hash (16 chars) + timestamp (8 bytes) + eventId (~20 chars)
      memoryUsage: this.seenHashes.size * 50,
    }
  }

  private getDefaultFields(): (keyof BusinessEvent)[] {
    return ['type', 'what', 'when', 'where', 'why', 'who', 'how', 'action']
  }

  private serializeFields(event: BusinessEvent, fields: (keyof BusinessEvent)[]): string {
    const parts: string[] = []
    for (const field of fields) {
      const value = event[field]
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          parts.push(`${field}:${value.sort().join(',')}`)
        } else if (value instanceof Date) {
          parts.push(`${field}:${value.getTime()}`)
        } else if (typeof value === 'object') {
          parts.push(`${field}:${JSON.stringify(value)}`)
        } else {
          parts.push(`${field}:${String(value)}`)
        }
      }
    }
    return parts.join('|')
  }

  private isContentDuplicate(signature: EventSignature): boolean {
    return this.seenHashes.has(signature.hash)
  }

  private isTimeWindowDuplicate(signature: EventSignature, event: BusinessEvent): boolean {
    const existing = this.seenHashes.get(signature.hash)
    if (!existing) return false

    const window = this.policy.deduplicationWindow || 1000
    const timeDiff = Math.abs(event.when.getTime() - existing.timestamp.getTime())
    return timeDiff <= window
  }

  private isIdempotencyDuplicate(event: BusinessEvent): boolean {
    // Use correlationId or extensions.idempotencyKey as the key
    const key = event.correlationId || (event.extensions?.idempotencyKey as string)
    if (!key) return false

    if (this.seenHashes.has(key)) {
      return true
    }

    this.seenHashes.set(key, {
      timestamp: event.when,
      eventId: event.id,
    })
    return false
  }

  private isSemanticDuplicate(event: BusinessEvent): boolean {
    // Semantic deduplication: same object + same action within time window
    const semanticKey = `${event.what.sort().join(',')}:${event.type}:${event.action || 'none'}`
    const hash = computeHash(semanticKey, this.hashAlgorithm)

    const existing = this.seenHashes.get(hash)
    if (!existing) {
      this.seenHashes.set(hash, {
        timestamp: event.when,
        eventId: event.id,
      })
      return false
    }

    const window = this.policy.deduplicationWindow || 1000
    const timeDiff = Math.abs(event.when.getTime() - existing.timestamp.getTime())
    return timeDiff <= window
  }

  private cleanupOldHashes(): void {
    const window = this.policy.deduplicationWindow || 1000
    const cutoff = Date.now() - window * 2 // Keep hashes for 2x the window

    for (const [hash, data] of this.seenHashes) {
      if (data.timestamp.getTime() < cutoff) {
        this.seenHashes.delete(hash)
      }
    }
  }
}

// =============================================================================
// EventBatcher Class
// =============================================================================

/**
 * Event batcher for grouping events efficiently
 */
export class EventBatcher {
  private policy: CompressionPolicy
  private pendingBatches: Map<string, { events: BusinessEvent[]; startTime: Date }> = new Map()
  private batchIdCounter: number = 0

  constructor(policy: Partial<CompressionPolicy> = {}) {
    this.policy = { ...DEFAULT_COMPRESSION_POLICY, ...policy }
  }

  /**
   * Add event to a batch
   */
  addEvent(event: BusinessEvent): EventBatch | null {
    const groupKey = this.getGroupKey(event)
    let batch = this.pendingBatches.get(groupKey)

    if (!batch) {
      batch = { events: [], startTime: new Date() }
      this.pendingBatches.set(groupKey, batch)
    }

    batch.events.push(event)

    // Check if batch should be flushed
    if (this.shouldFlush(batch)) {
      return this.flushBatch(groupKey)
    }

    return null
  }

  /**
   * Add multiple events to batches
   */
  addEvents(events: BusinessEvent[]): EventBatch[] {
    const flushedBatches: EventBatch[] = []

    for (const event of events) {
      const batch = this.addEvent(event)
      if (batch) {
        flushedBatches.push(batch)
      }
    }

    return flushedBatches
  }

  /**
   * Flush all pending batches
   */
  flushAll(): EventBatch[] {
    const batches: EventBatch[] = []

    for (const groupKey of this.pendingBatches.keys()) {
      const batch = this.flushBatch(groupKey)
      if (batch) {
        batches.push(batch)
      }
    }

    return batches
  }

  /**
   * Flush a specific batch
   */
  private flushBatch(groupKey: string): EventBatch | null {
    const pending = this.pendingBatches.get(groupKey)
    if (!pending || pending.events.length === 0) {
      this.pendingBatches.delete(groupKey)
      return null
    }

    const compressor = new EventCompressor(this.policy)
    const { compressedEvents, dictionary, stats } = compressor.compressBatch(pending.events)

    const batch: EventBatch = {
      id: this.generateBatchId(),
      events: compressedEvents,
      metadata: {
        timeRange: {
          start: pending.startTime,
          end: new Date(),
        },
        eventTypes: [...new Set(pending.events.map((e) => e.type))],
        groupKey: groupKey !== 'default' ? groupKey : undefined,
        originalCount: pending.events.length,
        deduplicatedCount: compressedEvents.length,
      },
      stats,
    }

    this.pendingBatches.delete(groupKey)
    return batch
  }

  /**
   * Get the group key for batching
   */
  private getGroupKey(event: BusinessEvent): string {
    const groupBy = this.policy.batchGroupBy
    if (!groupBy || groupBy.length === 0) {
      return 'default'
    }

    const parts: string[] = []
    for (const field of groupBy) {
      const value = event[field]
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          parts.push(value.join(','))
        } else {
          parts.push(String(value))
        }
      }
    }

    return parts.join(':') || 'default'
  }

  /**
   * Check if batch should be flushed
   */
  private shouldFlush(batch: { events: BusinessEvent[]; startTime: Date }): boolean {
    switch (this.policy.batchingStrategy) {
      case 'count':
        return batch.events.length >= (this.policy.batchSize || 100)

      case 'time-window':
        const elapsed = Date.now() - batch.startTime.getTime()
        return elapsed >= (this.policy.batchWindow || 100)

      case 'size':
        // Estimate size in bytes
        const estimatedSize = JSON.stringify(batch.events).length
        return estimatedSize >= (this.policy.batchSize || 1000) * 100 // Assume ~100 bytes per event

      case 'adaptive':
        // Combine count and time-window
        const countReached = batch.events.length >= (this.policy.batchSize || 100)
        const timeReached = Date.now() - batch.startTime.getTime() >= (this.policy.batchWindow || 100)
        return countReached || timeReached

      default:
        return batch.events.length >= (this.policy.batchSize || 100)
    }
  }

  private generateBatchId(): string {
    const timestamp = Date.now().toString(36)
    const counter = (this.batchIdCounter++).toString(36)
    return `batch_${timestamp}_${counter}`
  }

  /**
   * Get pending batch count
   */
  getPendingCount(): number {
    let count = 0
    for (const batch of this.pendingBatches.values()) {
      count += batch.events.length
    }
    return count
  }
}

// =============================================================================
// EventCompressor Class
// =============================================================================

/**
 * Event compressor for field-level and reference compression
 */
export class EventCompressor {
  private policy: CompressionPolicy
  private dictionary: CompressionDictionary

  constructor(policy: Partial<CompressionPolicy> = {}) {
    this.policy = { ...DEFAULT_COMPRESSION_POLICY, ...policy }
    this.dictionary = this.createEmptyDictionary()
  }

  /**
   * Compress a batch of events
   */
  compressBatch(events: BusinessEvent[]): {
    compressedEvents: CompressedEvent[]
    dictionary: CompressionDictionary
    stats: CompressionStats
  } {
    const startTime = performance.now()
    const originalSize = JSON.stringify(events).length

    // Build dictionary from events
    this.buildDictionary(events)

    // Compress events
    const compressedEvents = events.map((event) => this.compressEvent(event))

    // Calculate compressed size
    const compressedSize =
      JSON.stringify(compressedEvents).length + JSON.stringify(this.dictionary).length

    const stats: CompressionStats = {
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize,
      duplicatesRemoved: 0,
      dictionarySizes: this.getDictionarySizes(),
      compressionTimeMs: performance.now() - startTime,
      decompressionTimeMs: 0,
    }

    return {
      compressedEvents,
      dictionary: this.dictionary,
      stats,
    }
  }

  /**
   * Decompress a batch of events
   */
  decompressBatch(
    compressedEvents: CompressedEvent[],
    dictionary: CompressionDictionary,
    batchStartTime: Date,
  ): BusinessEvent[] {
    this.dictionary = dictionary
    return compressedEvents.map((compressed) =>
      this.decompressEvent(compressed, batchStartTime),
    )
  }

  /**
   * Compress a single event
   */
  private compressEvent(event: BusinessEvent): CompressedEvent {
    const batchStart = new Date(0) // Will be set relative to batch

    return {
      id: event.id,
      typeIndex: this.getOrAddIndex(this.dictionary.eventTypes, event.type),
      recordTimeDelta: event.recordTime.getTime(),
      whenDelta: event.when.getTime(),
      whatIndices: event.what.map((w) => this.getOrAddIndex(this.dictionary.objectIds, w)),
      whereIndex: event.where
        ? this.getOrAddIndex(this.dictionary.locations, event.where)
        : -1,
      whyIndex: event.why
        ? this.getOrAddIndex(this.dictionary.businessSteps, event.why)
        : -1,
      whoIndex: event.who ? this.getOrAddIndex(this.dictionary.parties, event.who) : -1,
      howIndex: event.how
        ? this.getOrAddIndex(this.dictionary.dispositions, event.how)
        : -1,
      actionIndex: event.action
        ? this.getOrAddIndex(this.dictionary.actions, event.action as EventAction)
        : -1,
      channelIndex: event.channel
        ? this.getOrAddIndex(this.dictionary.channels, event.channel)
        : -1,
      sessionIdIndex: event.sessionId
        ? this.getOrAddIndex(this.dictionary.sessionIds, event.sessionId)
        : -1,
      deviceIdIndex: event.deviceId
        ? this.getOrAddIndex(this.dictionary.deviceIds, event.deviceId)
        : -1,
      causedByRef: this.compressReference(event.causedBy),
      parentEventRef: this.compressReference(event.parentEventId),
      correlationIdIndex: event.correlationId
        ? this.getOrAddIndex(this.dictionary.correlationIds, event.correlationId)
        : -1,
      extensionsCompressed: event.extensions
        ? this.compressExtensions(event.extensions)
        : undefined,
      hash: this.computeEventHash(event),
    }
  }

  /**
   * Decompress a single event
   */
  private decompressEvent(compressed: CompressedEvent, batchStartTime: Date): BusinessEvent {
    const event: BusinessEvent = {
      id: compressed.id,
      type: this.dictionary.eventTypes[compressed.typeIndex]!,
      recordTime: new Date(compressed.recordTimeDelta),
      what: compressed.whatIndices.map((i) => this.dictionary.objectIds[i]!),
      when: new Date(compressed.whenDelta),
    }

    // Restore optional fields
    if (compressed.whereIndex >= 0) {
      event.where = this.dictionary.locations[compressed.whereIndex]
    }
    if (compressed.whyIndex >= 0) {
      event.why = this.dictionary.businessSteps[compressed.whyIndex]
    }
    if (compressed.whoIndex >= 0) {
      event.who = this.dictionary.parties[compressed.whoIndex]
    }
    if (compressed.howIndex >= 0) {
      event.how = this.dictionary.dispositions[compressed.howIndex]
    }
    if (compressed.actionIndex >= 0) {
      event.action = this.dictionary.actions[compressed.actionIndex]
    }
    if (compressed.channelIndex >= 0) {
      event.channel = this.dictionary.channels[compressed.channelIndex]
    }
    if (compressed.sessionIdIndex >= 0) {
      event.sessionId = this.dictionary.sessionIds[compressed.sessionIdIndex]
    }
    if (compressed.deviceIdIndex >= 0) {
      event.deviceId = this.dictionary.deviceIds[compressed.deviceIdIndex]
    }
    if (compressed.causedByRef !== -1) {
      event.causedBy = this.decompressReference(compressed.causedByRef)
    }
    if (compressed.parentEventRef !== -1) {
      event.parentEventId = this.decompressReference(compressed.parentEventRef)
    }
    if (compressed.correlationIdIndex >= 0) {
      event.correlationId = this.dictionary.correlationIds[compressed.correlationIdIndex]
    }
    if (compressed.extensionsCompressed) {
      event.extensions = this.decompressExtensions(compressed.extensionsCompressed)
    }

    return event
  }

  /**
   * Build dictionary from events
   */
  private buildDictionary(events: BusinessEvent[]): void {
    for (const event of events) {
      // Event type
      this.addToDictionary(this.dictionary.eventTypes, event.type)

      // Action
      if (event.action) {
        this.addToDictionary(this.dictionary.actions, event.action)
      }

      // Object IDs (what)
      for (const objectId of event.what) {
        this.addToDictionary(this.dictionary.objectIds, objectId)
      }

      // Location (where)
      if (event.where) {
        this.addToDictionary(this.dictionary.locations, event.where)
      }

      // Business step (why)
      if (event.why) {
        this.addToDictionary(this.dictionary.businessSteps, event.why)
      }

      // Party (who)
      if (event.who) {
        this.addToDictionary(this.dictionary.parties, event.who)
      }

      // Disposition (how)
      if (event.how) {
        this.addToDictionary(this.dictionary.dispositions, event.how)
      }

      // Channel
      if (event.channel) {
        this.addToDictionary(this.dictionary.channels, event.channel)
      }

      // Session ID
      if (event.sessionId) {
        this.addToDictionary(this.dictionary.sessionIds, event.sessionId)
      }

      // Device ID
      if (event.deviceId) {
        this.addToDictionary(this.dictionary.deviceIds, event.deviceId)
      }

      // Correlation ID
      if (event.correlationId) {
        this.addToDictionary(this.dictionary.correlationIds, event.correlationId)
      }

      // Event ID (for reference compression)
      this.addToDictionary(this.dictionary.eventIds, event.id)

      // Causal references
      if (event.causedBy) {
        this.addToDictionary(this.dictionary.eventIds, event.causedBy)
      }
      if (event.parentEventId) {
        this.addToDictionary(this.dictionary.eventIds, event.parentEventId)
      }
    }
  }

  private addToDictionary<T>(dict: T[], value: T): void {
    if (!dict.includes(value)) {
      dict.push(value)
    }
  }

  private getOrAddIndex<T>(dict: T[], value: T): number {
    let index = dict.indexOf(value)
    if (index === -1) {
      index = dict.length
      dict.push(value)
    }
    return index
  }

  private compressReference(ref: string | undefined): string | number {
    if (!ref) return -1

    if (this.policy.referenceCompression) {
      const index = this.dictionary.eventIds.indexOf(ref)
      if (index >= 0) {
        return index
      }
    }

    return ref
  }

  private decompressReference(ref: string | number): string {
    if (typeof ref === 'number') {
      return this.dictionary.eventIds[ref]!
    }
    return ref
  }

  private compressExtensions(extensions: Record<string, unknown>): Uint8Array {
    const json = JSON.stringify(extensions)
    return new TextEncoder().encode(json)
  }

  private decompressExtensions(data: Uint8Array): Record<string, unknown> {
    const json = new TextDecoder().decode(data)
    return JSON.parse(json)
  }

  private computeEventHash(event: BusinessEvent): string {
    const data = `${event.type}:${event.what.join(',')}:${event.when.getTime()}`
    return computeHash(data, 'xxhash')
  }

  private createEmptyDictionary(): CompressionDictionary {
    return {
      eventTypes: [],
      actions: [],
      objectIds: [],
      locations: [],
      businessSteps: [],
      parties: [],
      dispositions: [],
      channels: [],
      sessionIds: [],
      deviceIds: [],
      correlationIds: [],
      eventIds: [],
    }
  }

  private getDictionarySizes(): Record<string, number> {
    return {
      eventTypes: this.dictionary.eventTypes.length,
      actions: this.dictionary.actions.length,
      objectIds: this.dictionary.objectIds.length,
      locations: this.dictionary.locations.length,
      businessSteps: this.dictionary.businessSteps.length,
      parties: this.dictionary.parties.length,
      dispositions: this.dictionary.dispositions.length,
      channels: this.dictionary.channels.length,
      sessionIds: this.dictionary.sessionIds.length,
      deviceIds: this.dictionary.deviceIds.length,
      correlationIds: this.dictionary.correlationIds.length,
      eventIds: this.dictionary.eventIds.length,
    }
  }

  /**
   * Get current dictionary
   */
  getDictionary(): CompressionDictionary {
    return this.dictionary
  }
}

// =============================================================================
// EventCompressionPipeline Class
// =============================================================================

/**
 * Combined pipeline for event compression operations
 */
export class EventCompressionPipeline {
  private deduplicator: EventDeduplicator
  private batcher: EventBatcher
  private compressor: EventCompressor
  private policy: CompressionPolicy

  constructor(policy: Partial<CompressionPolicy> = {}) {
    this.policy = { ...DEFAULT_COMPRESSION_POLICY, ...policy }
    this.deduplicator = new EventDeduplicator(this.policy)
    this.batcher = new EventBatcher(this.policy)
    this.compressor = new EventCompressor(this.policy)
  }

  /**
   * Process events through the full compression pipeline
   */
  process(events: BusinessEvent[]): {
    batches: EventBatch[]
    stats: {
      inputCount: number
      outputCount: number
      duplicatesRemoved: number
      batchCount: number
      compressionRatio: number
      processingTimeMs: number
    }
  } {
    const startTime = performance.now()
    let processedEvents = events

    // Step 1: Deduplication
    let duplicatesRemoved = 0
    if (this.policy.deduplication) {
      const dedupeResult = this.deduplicator.deduplicate(processedEvents)
      processedEvents = dedupeResult.events
      duplicatesRemoved = dedupeResult.duplicateCount
    }

    // Step 2: Batching
    const batches: EventBatch[] = []
    if (this.policy.batching) {
      batches.push(...this.batcher.addEvents(processedEvents))
      batches.push(...this.batcher.flushAll())
    } else {
      // Create single batch
      const { compressedEvents, dictionary, stats } = this.compressor.compressBatch(processedEvents)
      batches.push({
        id: `batch_${Date.now().toString(36)}`,
        events: compressedEvents,
        metadata: {
          timeRange: {
            start: processedEvents[0]?.when || new Date(),
            end: processedEvents[processedEvents.length - 1]?.when || new Date(),
          },
          eventTypes: [...new Set(processedEvents.map((e) => e.type))],
          originalCount: processedEvents.length,
          deduplicatedCount: compressedEvents.length,
        },
        stats,
      })
    }

    // Calculate overall stats
    const totalOriginalSize = batches.reduce((sum, b) => sum + b.stats.originalSize, 0)
    const totalCompressedSize = batches.reduce((sum, b) => sum + b.stats.compressedSize, 0)
    const outputCount = batches.reduce((sum, b) => sum + b.events.length, 0)

    return {
      batches,
      stats: {
        inputCount: events.length,
        outputCount,
        duplicatesRemoved,
        batchCount: batches.length,
        compressionRatio: totalOriginalSize / Math.max(totalCompressedSize, 1),
        processingTimeMs: performance.now() - startTime,
      },
    }
  }

  /**
   * Decompress batches back to events
   */
  decompress(batches: EventBatch[], dictionaries: Map<string, CompressionDictionary>): BusinessEvent[] {
    const events: BusinessEvent[] = []

    for (const batch of batches) {
      const dictionary = dictionaries.get(batch.id)
      if (!dictionary) {
        throw new Error(`Dictionary not found for batch ${batch.id}`)
      }

      const decompressedEvents = this.compressor.decompressBatch(
        batch.events,
        dictionary,
        batch.metadata.timeRange.start,
      )
      events.push(...decompressedEvents)
    }

    return events
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    deduplicator: { hashCount: number; memoryUsage: number }
    batcher: { pendingCount: number }
  } {
    return {
      deduplicator: this.deduplicator.getStats(),
      batcher: { pendingCount: this.batcher.getPendingCount() },
    }
  }

  /**
   * Reset pipeline state
   */
  reset(): void {
    this.deduplicator.clear()
    this.batcher.flushAll()
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an event deduplicator
 */
export function createEventDeduplicator(
  policy?: Partial<CompressionPolicy>,
): EventDeduplicator {
  return new EventDeduplicator(policy)
}

/**
 * Create an event batcher
 */
export function createEventBatcher(policy?: Partial<CompressionPolicy>): EventBatcher {
  return new EventBatcher(policy)
}

/**
 * Create an event compressor
 */
export function createEventCompressor(
  policy?: Partial<CompressionPolicy>,
): EventCompressor {
  return new EventCompressor(policy)
}

/**
 * Create a full compression pipeline
 */
export function createCompressionPipeline(
  policy?: Partial<CompressionPolicy>,
): EventCompressionPipeline {
  return new EventCompressionPipeline(policy)
}
