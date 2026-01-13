/**
 * Kafka-compatible Producer Client
 *
 * Features:
 * - Send messages with configurable partitioning
 * - Batch sending for high throughput
 * - Idempotent producers for exactly-once semantics
 * - Transaction support
 * - Multiple partitioning strategies
 */

import {
  type ProducerConfig,
  type ProducerRecord,
  type Message,
  type RecordMetadata,
  type Partitioner,
  type PartitionerArgs,
  type PartitionMetadata,
  type TopicMetadata,
  type TransactionState,
  KafkaError,
  ErrorCode,
} from './types'
import type { KafkaDO } from './KafkaDO'
import type { TopicDO } from './TopicDO'

/**
 * MurmurHash2 implementation for key partitioning
 */
function murmur2(key: string): number {
  const data = new TextEncoder().encode(key)
  const length = data.length
  const seed = 0x9747b28c

  const m = 0x5bd1e995
  const r = 24

  let h = seed ^ length
  let i = 0

  while (i + 4 <= length) {
    let k =
      (data[i] & 0xff) |
      ((data[i + 1] & 0xff) << 8) |
      ((data[i + 2] & 0xff) << 16) |
      ((data[i + 3] & 0xff) << 24)

    k = Math.imul(k, m)
    k ^= k >>> r
    k = Math.imul(k, m)

    h = Math.imul(h, m)
    h ^= k

    i += 4
  }

  switch (length - i) {
    case 3:
      h ^= (data[i + 2] & 0xff) << 16
    // falls through
    case 2:
      h ^= (data[i + 1] & 0xff) << 8
    // falls through
    case 1:
      h ^= data[i] & 0xff
      h = Math.imul(h, m)
  }

  h ^= h >>> 13
  h = Math.imul(h, m)
  h ^= h >>> 15

  return h >>> 0
}

/**
 * Built-in partitioners
 */
export const partitioners = {
  /**
   * Default partitioner - uses key hash if present, else round-robin
   */
  default: (roundRobinState: Map<string, number>): Partitioner => {
    return ({ topic, partitionMetadata, message }: PartitionerArgs): number => {
      const numPartitions = partitionMetadata.length

      if (message.key) {
        const keyStr = typeof message.key === 'string' ? message.key : message.key.toString('utf-8')
        const hash = murmur2(keyStr)
        return Math.abs(hash) % numPartitions
      }

      // Round-robin for keyless messages
      const current = roundRobinState.get(topic) ?? 0
      const partition = current % numPartitions
      roundRobinState.set(topic, current + 1)
      return partition
    }
  },

  /**
   * Round-robin partitioner - distributes evenly regardless of key
   */
  roundRobin: (state: Map<string, number>): Partitioner => {
    return ({ topic, partitionMetadata }: PartitionerArgs): number => {
      const numPartitions = partitionMetadata.length
      const current = state.get(topic) ?? 0
      const partition = current % numPartitions
      state.set(topic, current + 1)
      return partition
    }
  },

  /**
   * Murmur2 partitioner - always uses key hash (throws if no key)
   */
  murmur2: (): Partitioner => {
    return ({ partitionMetadata, message }: PartitionerArgs): number => {
      if (!message.key) {
        throw new KafkaError('Murmur2 partitioner requires a message key', ErrorCode.INVALID_REQUEST)
      }
      const keyStr = typeof message.key === 'string' ? message.key : message.key.toString('utf-8')
      const hash = murmur2(keyStr)
      return Math.abs(hash) % partitionMetadata.length
    }
  },

  /**
   * Sticky partitioner - sticks to one partition until batch is full
   */
  sticky: (batchSize: number, state: Map<string, { partition: number; count: number }>): Partitioner => {
    return ({ topic, partitionMetadata, message }: PartitionerArgs): number => {
      // Use key-based partitioning if key present
      if (message.key) {
        const keyStr = typeof message.key === 'string' ? message.key : message.key.toString('utf-8')
        const hash = murmur2(keyStr)
        return Math.abs(hash) % partitionMetadata.length
      }

      // Sticky for keyless messages
      const current = state.get(topic)
      if (!current || current.count >= batchSize) {
        const partition = Math.floor(Math.random() * partitionMetadata.length)
        state.set(topic, { partition, count: 1 })
        return partition
      }

      current.count++
      return current.partition
    }
  },
}

/**
 * Producer client for Kafka-compatible message production
 */
export class Producer {
  private connected = false
  private producerId: string | null = null
  private producerEpoch = 0
  private transactionState: TransactionState | null = null
  private roundRobinState = new Map<string, number>()
  private partitioner: Partitioner
  private sequenceNumbers = new Map<string, number>() // topic-partition -> sequence

  // DO stubs (set by connect)
  private kafkaDO!: KafkaDO
  private getTopicDO!: (topicPartition: string) => TopicDO

  constructor(private config: ProducerConfig = {}) {
    // Initialize default partitioner
    this.partitioner = partitioners.default(this.roundRobinState)
  }

  /**
   * Set custom partitioner
   */
  setPartitioner(partitioner: Partitioner): void {
    this.partitioner = partitioner
  }

  /**
   * Connect to the Kafka cluster
   */
  async connect(kafkaDO: KafkaDO, getTopicDO: (topicPartition: string) => TopicDO): Promise<void> {
    if (this.connected) return

    this.kafkaDO = kafkaDO
    this.getTopicDO = getTopicDO

    // Initialize producer ID for idempotent producers
    if (this.config.idempotent || this.config.transactionalId) {
      const { producerId, producerEpoch } = await this.kafkaDO.initProducerId(this.config)
      this.producerId = producerId
      this.producerEpoch = producerEpoch
    }

    this.connected = true
  }

  /**
   * Disconnect from the cluster
   */
  async disconnect(): Promise<void> {
    if (this.transactionState?.state === 'Ongoing') {
      await this.abortTransaction()
    }
    this.connected = false
    this.producerId = null
    this.producerEpoch = 0
    this.sequenceNumbers.clear()
  }

  /**
   * Send messages to a topic
   */
  async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    this.ensureConnected()

    const { topic, messages, acks = -1 } = record

    if (messages.length === 0) {
      return []
    }

    // Get topic metadata
    const topicMetadataMap = await this.kafkaDO.describeTopics([topic])
    const topicMetadata = topicMetadataMap.get(topic)

    if (!topicMetadata || topicMetadata instanceof KafkaError) {
      // Auto-create topic if allowed
      if (this.config.allowAutoTopicCreation !== false) {
        await this.kafkaDO.createTopic({ topic })
        const newMetadata = await this.kafkaDO.describeTopics([topic])
        const created = newMetadata.get(topic)
        if (!created || created instanceof KafkaError) {
          throw new KafkaError(`Failed to create topic: ${topic}`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
        }
        return this.sendToPartitions(topic, messages, created)
      }
      throw new KafkaError(`Topic '${topic}' does not exist`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    return this.sendToPartitions(topic, messages, topicMetadata)
  }

  /**
   * Send messages to their target partitions
   */
  private async sendToPartitions(
    topic: string,
    messages: Message[],
    metadata: TopicMetadata
  ): Promise<RecordMetadata[]> {
    // Group messages by partition
    const partitionBatches = new Map<number, Message[]>()

    for (const message of messages) {
      let partition: number

      if (message.partition !== undefined) {
        // Explicit partition specified
        partition = message.partition
        if (partition < 0 || partition >= metadata.partitions.length) {
          throw new KafkaError(
            `Invalid partition ${partition} for topic ${topic}`,
            ErrorCode.UNKNOWN_TOPIC_OR_PARTITION
          )
        }
      } else {
        // Use partitioner
        partition = this.partitioner({
          topic,
          partitionMetadata: metadata.partitions,
          message,
        })
      }

      const batch = partitionBatches.get(partition) || []
      batch.push(message)
      partitionBatches.set(partition, batch)
    }

    // Send to each partition
    const allResults: RecordMetadata[] = []

    for (const [partition, batch] of partitionBatches) {
      const topicPartition = `${topic}-${partition}`
      const topicDO = this.getTopicDO(topicPartition)
      await topicDO.initialize(topicPartition)

      // Get sequence for idempotent producer
      let baseSequence: number | undefined
      if (this.producerId) {
        const key = `${topic}-${partition}`
        baseSequence = this.sequenceNumbers.get(key) ?? 0
        this.sequenceNumbers.set(key, baseSequence + batch.length)
      }

      const results = await topicDO.append(batch, {
        producerId: this.producerId ?? undefined,
        producerEpoch: this.producerEpoch,
        transactionId: this.transactionState?.transactionalId,
        baseSequence,
      })

      // Add transaction partition if in transaction
      if (this.transactionState?.transactionalId) {
        await this.kafkaDO.addPartitionToTransaction(this.transactionState.transactionalId, topic, partition)
      }

      allResults.push(...results)
    }

    return allResults
  }

  /**
   * Send batch of records to multiple topics
   */
  async sendBatch(batch: {
    topicMessages: Array<{ topic: string; messages: Message[] }>
    acks?: -1 | 0 | 1
    timeout?: number
    compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd'
  }): Promise<RecordMetadata[]> {
    this.ensureConnected()

    const allResults: RecordMetadata[] = []

    for (const { topic, messages } of batch.topicMessages) {
      const results = await this.send({
        topic,
        messages,
        acks: batch.acks,
        timeout: batch.timeout,
        compression: batch.compression,
      })
      allResults.push(...results)
    }

    return allResults
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Initialize transactions (must be called before any transactional operations)
   */
  async initTransactions(): Promise<void> {
    this.ensureConnected()

    if (!this.config.transactionalId) {
      throw new KafkaError('Transactional ID not configured', ErrorCode.INVALID_TXN_STATE)
    }

    this.transactionState = await this.kafkaDO.initTransaction(
      this.config.transactionalId,
      this.config.transactionTimeout
    )
  }

  /**
   * Begin a new transaction
   */
  async beginTransaction(): Promise<void> {
    this.ensureConnected()

    if (!this.config.transactionalId) {
      throw new KafkaError('Transactional ID not configured', ErrorCode.INVALID_TXN_STATE)
    }

    await this.kafkaDO.beginTransaction(this.config.transactionalId)

    if (this.transactionState) {
      this.transactionState.state = 'Ongoing'
      this.transactionState.partitions.clear()
    }
  }

  /**
   * Commit the current transaction
   */
  async commitTransaction(): Promise<void> {
    this.ensureConnected()

    if (!this.config.transactionalId) {
      throw new KafkaError('Transactional ID not configured', ErrorCode.INVALID_TXN_STATE)
    }

    // Prepare phase
    await this.kafkaDO.prepareCommitTransaction(this.config.transactionalId)

    // Commit phase - commit on all partition DOs
    const partitions = await this.kafkaDO.commitTransaction(this.config.transactionalId)

    for (const partitionKey of partitions) {
      const topicDO = this.getTopicDO(partitionKey)
      await topicDO.commitTransaction(this.config.transactionalId)
    }

    if (this.transactionState) {
      this.transactionState.state = 'CompleteCommit'
      this.transactionState.partitions.clear()
    }
  }

  /**
   * Abort the current transaction
   */
  async abortTransaction(): Promise<void> {
    this.ensureConnected()

    if (!this.config.transactionalId) {
      throw new KafkaError('Transactional ID not configured', ErrorCode.INVALID_TXN_STATE)
    }

    const partitions = await this.kafkaDO.abortTransaction(this.config.transactionalId)

    for (const partitionKey of partitions) {
      const topicDO = this.getTopicDO(partitionKey)
      await topicDO.abortTransaction(this.config.transactionalId)
    }

    if (this.transactionState) {
      this.transactionState.state = 'CompleteAbort'
      this.transactionState.partitions.clear()
    }
  }

  /**
   * Check if in active transaction
   */
  isInTransaction(): boolean {
    return this.transactionState?.state === 'Ongoing'
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Ensure producer is connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new KafkaError('Producer is not connected', ErrorCode.NETWORK_EXCEPTION)
    }
  }

  /**
   * Get producer ID (for idempotent producers)
   */
  getProducerId(): string | null {
    return this.producerId
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Get configuration
   */
  getConfig(): ProducerConfig {
    return { ...this.config }
  }
}

/**
 * Create a new producer instance
 */
export function createProducer(config?: ProducerConfig): Producer {
  return new Producer(config)
}
