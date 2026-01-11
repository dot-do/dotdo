/**
 * KafkaDO - Broker Coordinator for Kafka-compatible event streaming
 *
 * Manages:
 * - Topic metadata and configuration
 * - Partition assignment and leadership
 * - Transaction coordination
 * - Producer ID assignment for idempotent producers
 */

import { DO } from 'dotdo'
import {
  type TopicConfig,
  type TopicMetadata,
  type PartitionMetadata,
  type TransactionState,
  type ProducerConfig,
  type ConfigEntry,
  KafkaError,
  ErrorCode,
} from './types'

interface TopicRecord {
  name: string
  numPartitions: number
  replicationFactor: number
  config: Record<string, string>
  isInternal: boolean
  createdAt: string
  updatedAt: string
}

interface ProducerIdRecord {
  producerId: string
  transactionalId: string | null
  epoch: number
  createdAt: string
  lastUpdateAt: string
}

interface TransactionRecord {
  transactionalId: string
  producerId: string
  producerEpoch: number
  state: TransactionState['state']
  partitions: string // JSON serialized Set<string>
  timeout: number
  startTime: string
  lastUpdateTime: string
}

/**
 * KafkaDO - Central broker coordinator
 */
export class KafkaDO extends DO {
  static readonly $type = 'KafkaDO'

  private initialized = false

  /**
   * Initialize the broker state tables
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Topics metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topics (
        name TEXT PRIMARY KEY,
        num_partitions INTEGER NOT NULL DEFAULT 3,
        replication_factor INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        is_internal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    // Producer IDs for idempotent producers
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS producer_ids (
        producer_id TEXT PRIMARY KEY,
        transactional_id TEXT,
        epoch INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_update_at TEXT NOT NULL
      )
    `)

    // Create index for transactional ID lookup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_producer_ids_transactional
      ON producer_ids(transactional_id) WHERE transactional_id IS NOT NULL
    `)

    // Transaction state table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        transactional_id TEXT PRIMARY KEY,
        producer_id TEXT NOT NULL,
        producer_epoch INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'Empty',
        partitions TEXT NOT NULL DEFAULT '[]',
        timeout INTEGER NOT NULL DEFAULT 60000,
        start_time TEXT,
        last_update_time TEXT NOT NULL,
        FOREIGN KEY (producer_id) REFERENCES producer_ids(producer_id)
      )
    `)

    this.initialized = true
  }

  // ===========================================================================
  // Topic Management
  // ===========================================================================

  /**
   * Create a new topic
   */
  async createTopic(config: TopicConfig): Promise<TopicMetadata> {
    await this.initialize()

    const { topic, numPartitions = 3, replicationFactor = 1, configEntries = [] } = config

    // Validate topic name
    if (!topic || topic.length === 0) {
      throw new KafkaError('Topic name cannot be empty', ErrorCode.INVALID_TOPIC_EXCEPTION)
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(topic)) {
      throw new KafkaError(
        'Topic name can only contain alphanumeric characters, dots, underscores, and hyphens',
        ErrorCode.INVALID_TOPIC_EXCEPTION
      )
    }

    // Check if topic already exists
    const existing = this.db.exec(`SELECT name FROM topics WHERE name = ?`, topic).one()
    if (existing) {
      throw new KafkaError(`Topic '${topic}' already exists`, ErrorCode.TOPIC_ALREADY_EXISTS)
    }

    // Validate partitions
    if (numPartitions < 1) {
      throw new KafkaError('Number of partitions must be at least 1', ErrorCode.INVALID_PARTITIONS)
    }

    // Validate replication factor
    if (replicationFactor < 1) {
      throw new KafkaError('Replication factor must be at least 1', ErrorCode.INVALID_REPLICATION_FACTOR)
    }

    const now = new Date().toISOString()
    const configMap: Record<string, string> = {}
    for (const entry of configEntries) {
      configMap[entry.name] = entry.value
    }

    // Set defaults for retention and compaction
    if (!configMap['retention.ms']) {
      configMap['retention.ms'] = '604800000' // 7 days
    }
    if (!configMap['cleanup.policy']) {
      configMap['cleanup.policy'] = 'delete'
    }

    this.db.exec(
      `INSERT INTO topics (name, num_partitions, replication_factor, config, is_internal, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      topic,
      numPartitions,
      replicationFactor,
      JSON.stringify(configMap),
      now,
      now
    )

    // Generate partition metadata
    const partitions: PartitionMetadata[] = []
    for (let i = 0; i < numPartitions; i++) {
      partitions.push({
        partition: i,
        leader: 0, // Single broker simulation
        replicas: [0],
        isr: [0],
        offlineReplicas: [],
      })
    }

    return {
      name: topic,
      partitions,
      isInternal: false,
    }
  }

  /**
   * Create multiple topics at once
   */
  async createTopics(configs: TopicConfig[]): Promise<Map<string, TopicMetadata | KafkaError>> {
    const results = new Map<string, TopicMetadata | KafkaError>()

    for (const config of configs) {
      try {
        const metadata = await this.createTopic(config)
        results.set(config.topic, metadata)
      } catch (error) {
        results.set(
          config.topic,
          error instanceof KafkaError ? error : new KafkaError(String(error), ErrorCode.UNKNOWN)
        )
      }
    }

    return results
  }

  /**
   * Delete a topic
   */
  async deleteTopic(topic: string): Promise<void> {
    await this.initialize()

    const existing = this.db.exec(`SELECT name FROM topics WHERE name = ?`, topic).one()
    if (!existing) {
      throw new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    this.db.exec(`DELETE FROM topics WHERE name = ?`, topic)
  }

  /**
   * Delete multiple topics at once
   */
  async deleteTopics(topics: string[]): Promise<Map<string, void | KafkaError>> {
    const results = new Map<string, void | KafkaError>()

    for (const topic of topics) {
      try {
        await this.deleteTopic(topic)
        results.set(topic, undefined)
      } catch (error) {
        results.set(
          topic,
          error instanceof KafkaError ? error : new KafkaError(String(error), ErrorCode.UNKNOWN)
        )
      }
    }

    return results
  }

  /**
   * List all topics
   */
  async listTopics(includeInternal = false): Promise<string[]> {
    await this.initialize()

    const query = includeInternal
      ? `SELECT name FROM topics ORDER BY name`
      : `SELECT name FROM topics WHERE is_internal = 0 ORDER BY name`

    const rows = this.db.exec(query).toArray() as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  /**
   * Describe topics
   */
  async describeTopics(topics: string[]): Promise<Map<string, TopicMetadata | KafkaError>> {
    await this.initialize()

    const results = new Map<string, TopicMetadata | KafkaError>()

    for (const topic of topics) {
      const row = this.db
        .exec(
          `SELECT name, num_partitions, replication_factor, config, is_internal FROM topics WHERE name = ?`,
          topic
        )
        .one() as {
        name: string
        num_partitions: number
        replication_factor: number
        config: string
        is_internal: number
      } | null

      if (!row) {
        results.set(topic, new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION))
        continue
      }

      const partitions: PartitionMetadata[] = []
      for (let i = 0; i < row.num_partitions; i++) {
        partitions.push({
          partition: i,
          leader: 0,
          replicas: Array.from({ length: row.replication_factor }, (_, j) => j),
          isr: Array.from({ length: row.replication_factor }, (_, j) => j),
          offlineReplicas: [],
        })
      }

      results.set(topic, {
        name: row.name,
        partitions,
        isInternal: row.is_internal === 1,
      })
    }

    return results
  }

  /**
   * Get topic configuration
   */
  async getTopicConfig(topic: string): Promise<ConfigEntry[]> {
    await this.initialize()

    const row = this.db.exec(`SELECT config FROM topics WHERE name = ?`, topic).one() as { config: string } | null

    if (!row) {
      throw new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    const config = JSON.parse(row.config) as Record<string, string>
    return Object.entries(config).map(([name, value]) => ({ name, value }))
  }

  /**
   * Update topic configuration
   */
  async alterTopicConfig(topic: string, configEntries: ConfigEntry[]): Promise<void> {
    await this.initialize()

    const row = this.db.exec(`SELECT config FROM topics WHERE name = ?`, topic).one() as { config: string } | null

    if (!row) {
      throw new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    const config = JSON.parse(row.config) as Record<string, string>
    for (const entry of configEntries) {
      if (entry.value === null || entry.value === undefined) {
        delete config[entry.name]
      } else {
        config[entry.name] = entry.value
      }
    }

    this.db.exec(`UPDATE topics SET config = ?, updated_at = ? WHERE name = ?`, JSON.stringify(config), new Date().toISOString(), topic)
  }

  /**
   * Get partition count for a topic
   */
  async getPartitionCount(topic: string): Promise<number> {
    await this.initialize()

    const row = this.db.exec(`SELECT num_partitions FROM topics WHERE name = ?`, topic).one() as {
      num_partitions: number
    } | null

    if (!row) {
      throw new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    return row.num_partitions
  }

  /**
   * Check if topic exists
   */
  async topicExists(topic: string): Promise<boolean> {
    await this.initialize()
    const row = this.db.exec(`SELECT 1 FROM topics WHERE name = ?`, topic).one()
    return row !== null
  }

  // ===========================================================================
  // Producer ID Management (Idempotent Producers)
  // ===========================================================================

  /**
   * Initialize a producer and get/create producer ID
   */
  async initProducerId(config?: ProducerConfig): Promise<{ producerId: string; producerEpoch: number }> {
    await this.initialize()

    const transactionalId = config?.transactionalId ?? null
    const now = new Date().toISOString()

    // Check for existing transactional producer
    if (transactionalId) {
      const existing = this.db
        .exec(`SELECT producer_id, epoch FROM producer_ids WHERE transactional_id = ?`, transactionalId)
        .one() as { producer_id: string; epoch: number } | null

      if (existing) {
        // Bump epoch for fencing
        const newEpoch = existing.epoch + 1
        this.db.exec(
          `UPDATE producer_ids SET epoch = ?, last_update_at = ? WHERE producer_id = ?`,
          newEpoch,
          now,
          existing.producer_id
        )
        return { producerId: existing.producer_id, producerEpoch: newEpoch }
      }
    }

    // Create new producer ID
    const producerId = crypto.randomUUID()
    this.db.exec(
      `INSERT INTO producer_ids (producer_id, transactional_id, epoch, created_at, last_update_at)
       VALUES (?, ?, 0, ?, ?)`,
      producerId,
      transactionalId,
      now,
      now
    )

    return { producerId, producerEpoch: 0 }
  }

  /**
   * Validate producer epoch for idempotent operations
   */
  async validateProducerEpoch(producerId: string, epoch: number): Promise<boolean> {
    await this.initialize()

    const row = this.db.exec(`SELECT epoch FROM producer_ids WHERE producer_id = ?`, producerId).one() as {
      epoch: number
    } | null

    if (!row) {
      throw new KafkaError(`Unknown producer ID: ${producerId}`, ErrorCode.UNKNOWN_PRODUCER_ID)
    }

    if (row.epoch !== epoch) {
      throw new KafkaError(
        `Invalid producer epoch: expected ${row.epoch}, got ${epoch}`,
        ErrorCode.INVALID_PRODUCER_EPOCH
      )
    }

    return true
  }

  // ===========================================================================
  // Transaction Coordination
  // ===========================================================================

  /**
   * Initialize a transaction
   */
  async initTransaction(transactionalId: string, timeout = 60000): Promise<TransactionState> {
    await this.initialize()

    const now = new Date().toISOString()

    // Get or create producer ID for this transactional producer
    const { producerId, producerEpoch } = await this.initProducerId({ transactionalId })

    // Check for existing transaction
    const existing = this.db.exec(`SELECT * FROM transactions WHERE transactional_id = ?`, transactionalId).one() as {
      state: TransactionState['state']
    } | null

    if (existing && existing.state !== 'Empty' && existing.state !== 'CompleteCommit' && existing.state !== 'CompleteAbort') {
      throw new KafkaError(
        `Transaction ${transactionalId} is in invalid state: ${existing.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    // Create or update transaction record
    this.db.exec(
      `INSERT OR REPLACE INTO transactions
       (transactional_id, producer_id, producer_epoch, state, partitions, timeout, start_time, last_update_time)
       VALUES (?, ?, ?, 'Empty', '[]', ?, NULL, ?)`,
      transactionalId,
      producerId,
      producerEpoch,
      timeout,
      now
    )

    return {
      transactionalId,
      producerId,
      producerEpoch,
      state: 'Empty',
      partitions: new Set(),
      lastUpdateTime: Date.now(),
    }
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(transactionalId: string): Promise<void> {
    await this.initialize()

    const txn = this.db.exec(`SELECT state FROM transactions WHERE transactional_id = ?`, transactionalId).one() as {
      state: TransactionState['state']
    } | null

    if (!txn) {
      throw new KafkaError(`Transaction ${transactionalId} not found`, ErrorCode.INVALID_TXN_STATE)
    }

    if (txn.state !== 'Empty' && txn.state !== 'CompleteCommit' && txn.state !== 'CompleteAbort') {
      throw new KafkaError(
        `Cannot begin transaction in state ${txn.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    const now = new Date().toISOString()
    this.db.exec(
      `UPDATE transactions SET state = 'Ongoing', partitions = '[]', start_time = ?, last_update_time = ?
       WHERE transactional_id = ?`,
      now,
      now,
      transactionalId
    )
  }

  /**
   * Add partition to transaction
   */
  async addPartitionToTransaction(transactionalId: string, topic: string, partition: number): Promise<void> {
    await this.initialize()

    const txn = this.db
      .exec(`SELECT state, partitions FROM transactions WHERE transactional_id = ?`, transactionalId)
      .one() as { state: TransactionState['state']; partitions: string } | null

    if (!txn) {
      throw new KafkaError(`Transaction ${transactionalId} not found`, ErrorCode.INVALID_TXN_STATE)
    }

    if (txn.state !== 'Ongoing') {
      throw new KafkaError(
        `Cannot add partition to transaction in state ${txn.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    const partitions = new Set<string>(JSON.parse(txn.partitions))
    partitions.add(`${topic}-${partition}`)

    this.db.exec(
      `UPDATE transactions SET partitions = ?, last_update_time = ? WHERE transactional_id = ?`,
      JSON.stringify([...partitions]),
      new Date().toISOString(),
      transactionalId
    )
  }

  /**
   * Prepare to commit transaction (2PC prepare phase)
   */
  async prepareCommitTransaction(transactionalId: string): Promise<void> {
    await this.initialize()

    const txn = this.db.exec(`SELECT state FROM transactions WHERE transactional_id = ?`, transactionalId).one() as {
      state: TransactionState['state']
    } | null

    if (!txn) {
      throw new KafkaError(`Transaction ${transactionalId} not found`, ErrorCode.INVALID_TXN_STATE)
    }

    if (txn.state !== 'Ongoing') {
      throw new KafkaError(
        `Cannot prepare commit for transaction in state ${txn.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    this.db.exec(
      `UPDATE transactions SET state = 'PrepareCommit', last_update_time = ? WHERE transactional_id = ?`,
      new Date().toISOString(),
      transactionalId
    )
  }

  /**
   * Commit transaction
   */
  async commitTransaction(transactionalId: string): Promise<string[]> {
    await this.initialize()

    const txn = this.db
      .exec(`SELECT state, partitions FROM transactions WHERE transactional_id = ?`, transactionalId)
      .one() as { state: TransactionState['state']; partitions: string } | null

    if (!txn) {
      throw new KafkaError(`Transaction ${transactionalId} not found`, ErrorCode.INVALID_TXN_STATE)
    }

    if (txn.state !== 'Ongoing' && txn.state !== 'PrepareCommit') {
      throw new KafkaError(
        `Cannot commit transaction in state ${txn.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    const partitions = JSON.parse(txn.partitions) as string[]

    this.db.exec(
      `UPDATE transactions SET state = 'CompleteCommit', last_update_time = ? WHERE transactional_id = ?`,
      new Date().toISOString(),
      transactionalId
    )

    return partitions
  }

  /**
   * Abort transaction
   */
  async abortTransaction(transactionalId: string): Promise<string[]> {
    await this.initialize()

    const txn = this.db
      .exec(`SELECT state, partitions FROM transactions WHERE transactional_id = ?`, transactionalId)
      .one() as { state: TransactionState['state']; partitions: string } | null

    if (!txn) {
      throw new KafkaError(`Transaction ${transactionalId} not found`, ErrorCode.INVALID_TXN_STATE)
    }

    if (txn.state === 'CompleteCommit' || txn.state === 'CompleteAbort' || txn.state === 'Dead') {
      throw new KafkaError(
        `Cannot abort transaction in state ${txn.state}`,
        ErrorCode.INVALID_TXN_STATE
      )
    }

    const partitions = JSON.parse(txn.partitions) as string[]

    this.db.exec(
      `UPDATE transactions SET state = 'CompleteAbort', last_update_time = ? WHERE transactional_id = ?`,
      new Date().toISOString(),
      transactionalId
    )

    return partitions
  }

  /**
   * Get transaction state
   */
  async getTransactionState(transactionalId: string): Promise<TransactionState | null> {
    await this.initialize()

    const row = this.db.exec(`SELECT * FROM transactions WHERE transactional_id = ?`, transactionalId).one() as {
      transactional_id: string
      producer_id: string
      producer_epoch: number
      state: TransactionState['state']
      partitions: string
      last_update_time: string
    } | null

    if (!row) return null

    return {
      transactionalId: row.transactional_id,
      producerId: row.producer_id,
      producerEpoch: row.producer_epoch,
      state: row.state,
      partitions: new Set(JSON.parse(row.partitions)),
      lastUpdateTime: new Date(row.last_update_time).getTime(),
    }
  }

  // ===========================================================================
  // Cluster Metadata
  // ===========================================================================

  /**
   * Get cluster metadata
   */
  async getClusterMetadata(): Promise<{
    clusterId: string
    controller: { id: number; host: string; port: number }
    brokers: Array<{ id: number; host: string; port: number }>
  }> {
    return {
      clusterId: this.id,
      controller: { id: 0, host: 'localhost', port: 9092 },
      brokers: [{ id: 0, host: 'localhost', port: 9092 }],
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; topics: number; producers: number }> {
    await this.initialize()

    const topicCount = this.db.exec(`SELECT COUNT(*) as count FROM topics`).one() as { count: number }
    const producerCount = this.db.exec(`SELECT COUNT(*) as count FROM producer_ids`).one() as { count: number }

    return {
      status: 'healthy',
      topics: topicCount.count,
      producers: producerCount.count,
    }
  }
}
