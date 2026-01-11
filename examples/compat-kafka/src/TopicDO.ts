/**
 * TopicDO - Partition storage for Kafka-compatible event streaming
 *
 * Each instance manages a single partition of a topic.
 * Handles:
 * - Message storage with offset management
 * - Message retention and compaction
 * - Idempotent producer deduplication
 * - Transaction markers
 */

import { DO } from 'dotdo'
import {
  type StoredMessage,
  type PartitionState,
  type Message,
  type RecordMetadata,
  type TopicMessage,
  type CompactionConfig,
  type CompactionState,
  KafkaError,
  ErrorCode,
} from './types'

interface MessageRow {
  offset: string
  key: string | null
  value: string | null
  timestamp: string
  headers: string
  producer_id: string | null
  producer_epoch: number | null
  sequence: number | null
  transaction_id: string | null
  is_committed: number
  is_aborted: number
}

interface SequenceRow {
  producer_id: string
  last_sequence: number
  last_offset: string
}

/**
 * TopicDO - Manages a single partition of a topic
 *
 * Naming convention: `{topic}-{partition}` (e.g., "orders-0", "orders-1")
 */
export class TopicDO extends DO {
  static readonly $type = 'TopicDO'

  private initialized = false
  private topic: string = ''
  private partition: number = 0
  private highWatermark: bigint = 0n
  private logStartOffset: bigint = 0n

  // Configuration
  private retentionMs = 604800000 // 7 days
  private retentionBytes = -1 // Unlimited by default
  private cleanupPolicy: 'delete' | 'compact' | 'compact,delete' = 'delete'
  private maxMessageBytes = 1048576 // 1MB

  /**
   * Initialize partition state
   */
  async initialize(topicPartition?: string): Promise<void> {
    if (this.initialized && !topicPartition) return

    // Parse topic and partition from ID if provided
    if (topicPartition) {
      const lastDash = topicPartition.lastIndexOf('-')
      this.topic = topicPartition.substring(0, lastDash)
      this.partition = parseInt(topicPartition.substring(lastDash + 1))
    } else {
      // Try to parse from DO id
      const lastDash = this.id.lastIndexOf('-')
      if (lastDash > 0) {
        this.topic = this.id.substring(0, lastDash)
        this.partition = parseInt(this.id.substring(lastDash + 1))
      }
    }

    // Messages table - main storage
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        offset TEXT PRIMARY KEY,
        key TEXT,
        value TEXT,
        timestamp TEXT NOT NULL,
        headers TEXT NOT NULL DEFAULT '{}',
        producer_id TEXT,
        producer_epoch INTEGER,
        sequence INTEGER,
        transaction_id TEXT,
        is_committed INTEGER NOT NULL DEFAULT 1,
        is_aborted INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Create indexes for efficient queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_key ON messages(key) WHERE key IS NOT NULL`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_transaction ON messages(transaction_id) WHERE transaction_id IS NOT NULL`)

    // Producer sequences for idempotent deduplication
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS producer_sequences (
        producer_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL,
        last_offset TEXT NOT NULL
      )
    `)

    // Partition metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS partition_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    // Load state
    await this.loadState()
    this.initialized = true
  }

  /**
   * Load partition state from storage
   */
  private async loadState(): Promise<void> {
    // Get high watermark
    const hwmRow = this.db.exec(`SELECT MAX(CAST(offset AS INTEGER)) as hwm FROM messages WHERE is_committed = 1`).one() as { hwm: number | null }
    this.highWatermark = hwmRow?.hwm !== null ? BigInt(hwmRow.hwm) + 1n : 0n

    // Get log start offset (oldest message)
    const lsoRow = this.db.exec(`SELECT MIN(CAST(offset AS INTEGER)) as lso FROM messages`).one() as { lso: number | null }
    this.logStartOffset = lsoRow?.lso !== null ? BigInt(lsoRow.lso) : 0n

    // Load config
    const config = this.db.exec(`SELECT key, value FROM partition_state`).toArray() as Array<{ key: string; value: string }>
    for (const { key, value } of config) {
      switch (key) {
        case 'retention.ms':
          this.retentionMs = parseInt(value)
          break
        case 'retention.bytes':
          this.retentionBytes = parseInt(value)
          break
        case 'cleanup.policy':
          this.cleanupPolicy = value as 'delete' | 'compact' | 'compact,delete'
          break
        case 'max.message.bytes':
          this.maxMessageBytes = parseInt(value)
          break
      }
    }
  }

  /**
   * Configure partition settings
   */
  async configure(config: Partial<CompactionConfig>): Promise<void> {
    await this.initialize()

    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        this.db.exec(
          `INSERT OR REPLACE INTO partition_state (key, value) VALUES (?, ?)`,
          key,
          String(value)
        )
      }
    }

    // Reload state
    await this.loadState()
  }

  // ===========================================================================
  // Message Production
  // ===========================================================================

  /**
   * Append messages to the partition
   */
  async append(
    messages: Message[],
    options: {
      producerId?: string
      producerEpoch?: number
      transactionId?: string
      baseSequence?: number
    } = {}
  ): Promise<RecordMetadata[]> {
    await this.initialize()

    const { producerId, producerEpoch, transactionId, baseSequence } = options
    const results: RecordMetadata[] = []
    const now = Date.now()

    // Validate and deduplicate for idempotent producers
    if (producerId && baseSequence !== undefined) {
      const seqRow = this.db
        .exec(`SELECT last_sequence, last_offset FROM producer_sequences WHERE producer_id = ?`, producerId)
        .one() as SequenceRow | null

      if (seqRow) {
        // Check for duplicate
        if (baseSequence <= seqRow.last_sequence) {
          // Return existing offsets for duplicates
          const startOffset = BigInt(seqRow.last_offset) - BigInt(seqRow.last_sequence - baseSequence)
          for (let i = 0; i < messages.length; i++) {
            results.push({
              topic: this.topic,
              partition: this.partition,
              offset: (startOffset + BigInt(i)).toString(),
              timestamp: new Date(now).toISOString(),
            })
          }
          return results
        }

        // Check for out-of-order
        if (baseSequence !== seqRow.last_sequence + 1) {
          throw new KafkaError(
            `Out of order sequence: expected ${seqRow.last_sequence + 1}, got ${baseSequence}`,
            ErrorCode.OUT_OF_ORDER_SEQUENCE_NUMBER
          )
        }
      } else if (baseSequence !== 0) {
        throw new KafkaError(
          `First sequence for producer must be 0, got ${baseSequence}`,
          ErrorCode.OUT_OF_ORDER_SEQUENCE_NUMBER
        )
      }
    }

    // Append messages
    let currentOffset = this.highWatermark
    let sequence = baseSequence ?? 0

    for (const msg of messages) {
      // Validate message size
      const valueSize = msg.value ? (typeof msg.value === 'string' ? msg.value.length : msg.value.length) : 0
      if (valueSize > this.maxMessageBytes) {
        throw new KafkaError(
          `Message size ${valueSize} exceeds max ${this.maxMessageBytes}`,
          ErrorCode.MESSAGE_TOO_LARGE
        )
      }

      const offset = currentOffset.toString()
      const timestamp = msg.timestamp || new Date(now).toISOString()
      const key = msg.key ? (typeof msg.key === 'string' ? msg.key : msg.key.toString('utf-8')) : null
      const value = msg.value ? (typeof msg.value === 'string' ? msg.value : msg.value.toString('utf-8')) : null
      const headers = msg.headers
        ? Object.fromEntries(
            Object.entries(msg.headers).map(([k, v]) => [k, typeof v === 'string' ? v : v.toString('utf-8')])
          )
        : {}

      // For transactions, mark as uncommitted initially
      const isCommitted = transactionId ? 0 : 1

      this.db.exec(
        `INSERT INTO messages (offset, key, value, timestamp, headers, producer_id, producer_epoch, sequence, transaction_id, is_committed, is_aborted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        offset,
        key,
        value,
        timestamp,
        JSON.stringify(headers),
        producerId ?? null,
        producerEpoch ?? null,
        producerId ? sequence : null,
        transactionId ?? null,
        isCommitted
      )

      results.push({
        topic: this.topic,
        partition: this.partition,
        offset,
        timestamp,
      })

      currentOffset++
      sequence++
    }

    // Update high watermark
    this.highWatermark = currentOffset

    // Update producer sequence
    if (producerId && baseSequence !== undefined) {
      this.db.exec(
        `INSERT OR REPLACE INTO producer_sequences (producer_id, last_sequence, last_offset)
         VALUES (?, ?, ?)`,
        producerId,
        sequence - 1,
        (currentOffset - 1n).toString()
      )
    }

    return results
  }

  /**
   * Commit transaction messages
   */
  async commitTransaction(transactionId: string): Promise<number> {
    await this.initialize()

    const result = this.db.exec(
      `UPDATE messages SET is_committed = 1 WHERE transaction_id = ? AND is_committed = 0`,
      transactionId
    )

    return result.changes ?? 0
  }

  /**
   * Abort transaction messages
   */
  async abortTransaction(transactionId: string): Promise<number> {
    await this.initialize()

    const result = this.db.exec(
      `UPDATE messages SET is_aborted = 1 WHERE transaction_id = ? AND is_committed = 0`,
      transactionId
    )

    return result.changes ?? 0
  }

  // ===========================================================================
  // Message Consumption
  // ===========================================================================

  /**
   * Fetch messages from the partition
   */
  async fetch(
    offset: string | 'earliest' | 'latest',
    options: {
      maxBytes?: number
      maxMessages?: number
      minBytes?: number
      maxWaitMs?: number
      isolationLevel?: 'read_uncommitted' | 'read_committed'
    } = {}
  ): Promise<{ messages: TopicMessage[]; highWatermark: string }> {
    await this.initialize()

    const { maxMessages = 100, isolationLevel = 'read_committed' } = options

    // Resolve special offsets
    let startOffset: bigint
    if (offset === 'earliest') {
      startOffset = this.logStartOffset
    } else if (offset === 'latest') {
      startOffset = this.highWatermark
    } else {
      startOffset = BigInt(offset)
    }

    // Validate offset
    if (startOffset < this.logStartOffset) {
      throw new KafkaError(
        `Offset ${startOffset} is before log start offset ${this.logStartOffset}`,
        ErrorCode.OFFSET_OUT_OF_RANGE
      )
    }

    // Build query based on isolation level
    let query = `SELECT * FROM messages WHERE CAST(offset AS INTEGER) >= ? AND is_aborted = 0`
    if (isolationLevel === 'read_committed') {
      query += ` AND is_committed = 1`
    }
    query += ` ORDER BY CAST(offset AS INTEGER) LIMIT ?`

    const rows = this.db.exec(query, startOffset.toString(), maxMessages).toArray() as MessageRow[]

    const messages: TopicMessage[] = rows.map((row) => ({
      topic: this.topic,
      partition: this.partition,
      offset: row.offset,
      key: row.key,
      value: row.value,
      timestamp: row.timestamp,
      headers: JSON.parse(row.headers || '{}'),
    }))

    return {
      messages,
      highWatermark: this.highWatermark.toString(),
    }
  }

  /**
   * Get messages by timestamp
   */
  async fetchByTimestamp(
    timestamp: string,
    options: { maxMessages?: number } = {}
  ): Promise<{ messages: TopicMessage[]; highWatermark: string }> {
    await this.initialize()

    const { maxMessages = 100 } = options

    const rows = this.db
      .exec(
        `SELECT * FROM messages WHERE timestamp >= ? AND is_committed = 1 AND is_aborted = 0
         ORDER BY CAST(offset AS INTEGER) LIMIT ?`,
        timestamp,
        maxMessages
      )
      .toArray() as MessageRow[]

    const messages: TopicMessage[] = rows.map((row) => ({
      topic: this.topic,
      partition: this.partition,
      offset: row.offset,
      key: row.key,
      value: row.value,
      timestamp: row.timestamp,
      headers: JSON.parse(row.headers || '{}'),
    }))

    return {
      messages,
      highWatermark: this.highWatermark.toString(),
    }
  }

  /**
   * Get offset for timestamp
   */
  async offsetForTimestamp(timestamp: string): Promise<string | null> {
    await this.initialize()

    const row = this.db
      .exec(
        `SELECT offset FROM messages WHERE timestamp >= ? AND is_committed = 1
         ORDER BY CAST(offset AS INTEGER) LIMIT 1`,
        timestamp
      )
      .one() as { offset: string } | null

    return row?.offset ?? null
  }

  // ===========================================================================
  // Partition State
  // ===========================================================================

  /**
   * Get partition state
   */
  async getState(): Promise<PartitionState> {
    await this.initialize()

    return {
      partition: this.partition,
      highWatermark: this.highWatermark.toString(),
      logStartOffset: this.logStartOffset.toString(),
      leader: 0,
      replicas: [0],
      isr: [0],
    }
  }

  /**
   * Get high watermark
   */
  async getHighWatermark(): Promise<string> {
    await this.initialize()
    return this.highWatermark.toString()
  }

  /**
   * Get log start offset
   */
  async getLogStartOffset(): Promise<string> {
    await this.initialize()
    return this.logStartOffset.toString()
  }

  /**
   * Get log end offset (same as high watermark for single replica)
   */
  async getLogEndOffset(): Promise<string> {
    await this.initialize()
    return this.highWatermark.toString()
  }

  /**
   * Get message count
   */
  async getMessageCount(): Promise<number> {
    await this.initialize()

    const row = this.db.exec(`SELECT COUNT(*) as count FROM messages WHERE is_committed = 1 AND is_aborted = 0`).one() as { count: number }
    return row.count
  }

  /**
   * Get storage size (approximate)
   */
  async getStorageSize(): Promise<number> {
    await this.initialize()

    const row = this.db
      .exec(`SELECT SUM(LENGTH(key) + LENGTH(value) + LENGTH(headers)) as size FROM messages`)
      .one() as { size: number | null }

    return row?.size ?? 0
  }

  // ===========================================================================
  // Retention and Compaction
  // ===========================================================================

  /**
   * Run retention cleanup
   */
  async runRetention(): Promise<{ deletedCount: number; freedBytes: number }> {
    await this.initialize()

    let deletedCount = 0
    let freedBytes = 0

    // Time-based retention
    if (this.retentionMs > 0) {
      const cutoffTime = new Date(Date.now() - this.retentionMs).toISOString()

      // Calculate freed bytes before deletion
      const sizeRow = this.db
        .exec(
          `SELECT SUM(LENGTH(COALESCE(key, '')) + LENGTH(COALESCE(value, '')) + LENGTH(headers)) as size
           FROM messages WHERE timestamp < ?`,
          cutoffTime
        )
        .one() as { size: number | null }
      freedBytes += sizeRow?.size ?? 0

      // Delete old messages
      const result = this.db.exec(`DELETE FROM messages WHERE timestamp < ?`, cutoffTime)
      deletedCount += result.changes ?? 0
    }

    // Size-based retention
    if (this.retentionBytes > 0) {
      const currentSize = await this.getStorageSize()
      if (currentSize > this.retentionBytes) {
        const toDelete = currentSize - this.retentionBytes

        // Delete oldest messages until under limit
        const oldestRows = this.db
          .exec(
            `SELECT offset, LENGTH(COALESCE(key, '')) + LENGTH(COALESCE(value, '')) + LENGTH(headers) as size
             FROM messages ORDER BY CAST(offset AS INTEGER)`
          )
          .toArray() as Array<{ offset: string; size: number }>

        let deletedSize = 0
        const offsetsToDelete: string[] = []

        for (const row of oldestRows) {
          if (deletedSize >= toDelete) break
          offsetsToDelete.push(row.offset)
          deletedSize += row.size
        }

        if (offsetsToDelete.length > 0) {
          const placeholders = offsetsToDelete.map(() => '?').join(',')
          const result = this.db.exec(`DELETE FROM messages WHERE offset IN (${placeholders})`, ...offsetsToDelete)
          deletedCount += result.changes ?? 0
          freedBytes += deletedSize
        }
      }
    }

    // Update log start offset
    await this.loadState()

    return { deletedCount, freedBytes }
  }

  /**
   * Run log compaction (keep only latest value per key)
   */
  async runCompaction(): Promise<CompactionState> {
    await this.initialize()

    if (!this.cleanupPolicy.includes('compact')) {
      return {
        lastCleanedOffset: this.highWatermark.toString(),
        dirtyRatio: 0,
        lastCompactionTime: Date.now(),
        cleanableBytes: 0,
        totalBytes: await this.getStorageSize(),
      }
    }

    const startTime = Date.now()

    // Find duplicate keys (keep highest offset per key)
    const duplicates = this.db
      .exec(
        `SELECT m1.offset
         FROM messages m1
         WHERE m1.key IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM messages m2
             WHERE m2.key = m1.key
               AND CAST(m2.offset AS INTEGER) > CAST(m1.offset AS INTEGER)
           )
           AND m1.is_committed = 1
           AND m1.is_aborted = 0`
      )
      .toArray() as Array<{ offset: string }>

    const cleanableBytes = this.db
      .exec(
        `SELECT SUM(LENGTH(COALESCE(key, '')) + LENGTH(COALESCE(value, '')) + LENGTH(headers)) as size
         FROM messages WHERE offset IN (${duplicates.map(() => '?').join(',')})`,
        ...duplicates.map((d) => d.offset)
      )
      .one() as { size: number | null }

    // Delete duplicate entries (keeping latest)
    if (duplicates.length > 0) {
      const placeholders = duplicates.map(() => '?').join(',')
      this.db.exec(`DELETE FROM messages WHERE offset IN (${placeholders})`, ...duplicates.map((d) => d.offset))
    }

    // Also delete tombstones (null values) that are old enough
    this.db.exec(
      `DELETE FROM messages WHERE value IS NULL AND timestamp < ?`,
      new Date(Date.now() - 86400000).toISOString() // 24 hours
    )

    await this.loadState()

    return {
      lastCleanedOffset: this.highWatermark.toString(),
      dirtyRatio: 0,
      lastCompactionTime: startTime,
      cleanableBytes: cleanableBytes?.size ?? 0,
      totalBytes: await this.getStorageSize(),
    }
  }

  /**
   * Get compaction state
   */
  async getCompactionState(): Promise<CompactionState> {
    await this.initialize()

    // Calculate dirty ratio (messages with duplicate keys)
    const totalMessages = await this.getMessageCount()
    const uniqueKeys = this.db
      .exec(`SELECT COUNT(DISTINCT key) as count FROM messages WHERE key IS NOT NULL`)
      .one() as { count: number }
    const keyedMessages = this.db
      .exec(`SELECT COUNT(*) as count FROM messages WHERE key IS NOT NULL`)
      .one() as { count: number }

    const duplicates = keyedMessages.count - uniqueKeys.count
    const dirtyRatio = totalMessages > 0 ? duplicates / totalMessages : 0

    return {
      lastCleanedOffset: this.highWatermark.toString(),
      dirtyRatio,
      lastCompactionTime: 0,
      cleanableBytes: 0,
      totalBytes: await this.getStorageSize(),
    }
  }

  // ===========================================================================
  // Administrative Operations
  // ===========================================================================

  /**
   * Truncate partition to offset
   */
  async truncateTo(offset: string): Promise<void> {
    await this.initialize()

    this.db.exec(`DELETE FROM messages WHERE CAST(offset AS INTEGER) >= ?`, offset)
    await this.loadState()
  }

  /**
   * Delete all messages (purge)
   */
  async purge(): Promise<void> {
    await this.initialize()

    this.db.exec(`DELETE FROM messages`)
    this.db.exec(`DELETE FROM producer_sequences`)
    this.highWatermark = 0n
    this.logStartOffset = 0n
  }

  /**
   * Get partition info
   */
  async getInfo(): Promise<{
    topic: string
    partition: number
    highWatermark: string
    logStartOffset: string
    messageCount: number
    storageSize: number
    config: Record<string, string | number>
  }> {
    await this.initialize()

    return {
      topic: this.topic,
      partition: this.partition,
      highWatermark: this.highWatermark.toString(),
      logStartOffset: this.logStartOffset.toString(),
      messageCount: await this.getMessageCount(),
      storageSize: await this.getStorageSize(),
      config: {
        'retention.ms': this.retentionMs,
        'retention.bytes': this.retentionBytes,
        'cleanup.policy': this.cleanupPolicy,
        'max.message.bytes': this.maxMessageBytes,
      },
    }
  }
}
