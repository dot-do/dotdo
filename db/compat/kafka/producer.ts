/**
 * Kafka Producer - Message production with partitioning strategies
 *
 * Backed by unified primitives:
 * - KeyedRouter for partition routing
 * - ExactlyOnceContext for idempotent/exactly-once delivery
 */

import { createKeyedRouter, createExactlyOnceContext, type KeyedRouter } from '../../primitives'
import { KafkaAdmin } from './admin'
import {
  type ProducerConfig,
  type ProducerRecord,
  type ProducerMessage,
  type RecordMetadata,
  type StoredMessage,
  type Partitioner,
  type PartitionerType,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Extended producer config with admin reference
 */
export interface ExtendedProducerConfig extends ProducerConfig {
  /** Admin client for topic management */
  admin: KafkaAdmin
  /** Custom partitioner function */
  customPartitioner?: Partitioner
  /** Allow auto-creation of topics */
  allowAutoTopicCreation?: boolean
}

/**
 * Kafka-compatible producer
 */
export class Producer {
  private config: ExtendedProducerConfig
  private connected: boolean = false
  private producerId: string | null = null
  private sequenceNumbers: Map<string, number> = new Map()
  private router: KeyedRouter<string> | null = null
  private roundRobinCounters: Map<string, number> = new Map()
  private stickyState: Map<string, { partition: number; count: number }> = new Map()
  private exactlyOnceContext = createExactlyOnceContext({
    eventIdTtl: 60000, // 1 minute TTL for dedup
  })

  constructor(config: ExtendedProducerConfig) {
    this.config = {
      partitioner: 'key-based',
      idempotent: false,
      batchSize: 16384,
      lingerMs: 0,
      acks: -1,
      allowAutoTopicCreation: true,
      ...config,
    }
  }

  /**
   * Connect the producer
   */
  async connect(): Promise<void> {
    if (this.connected) return

    // Generate producer ID for idempotent producers
    if (this.config.idempotent) {
      this.producerId = `producer-${crypto.randomUUID()}`
    }

    this.connected = true
  }

  /**
   * Disconnect the producer
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return

    await this.exactlyOnceContext.flush()
    this.connected = false
    this.producerId = null
    this.sequenceNumbers.clear()
    this.roundRobinCounters.clear()
    this.stickyState.clear()
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Send messages to a topic
   */
  async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    this.ensureConnected()

    const { topic, messages } = record

    if (messages.length === 0) {
      return []
    }

    // Get or create topic
    let topicState = this.config.admin.getTopic(topic)

    if (!topicState) {
      if (this.config.allowAutoTopicCreation) {
        await this.config.admin.createTopics({
          topics: [{ name: topic, partitions: 1 }],
        })
        topicState = this.config.admin.getTopic(topic)
      } else {
        throw new KafkaError(
          `Topic '${topic}' does not exist`,
          KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
        )
      }
    }

    if (!topicState) {
      throw new KafkaError(
        `Failed to get topic '${topic}'`,
        KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
      )
    }

    const partitionCount = topicState.config.partitions

    // Create router if needed
    if (!this.router || this.router.getPartitionCount() !== partitionCount) {
      this.router = createKeyedRouter<string>(partitionCount)
    }

    // Group messages by partition
    const partitionBatches = new Map<number, ProducerMessage[]>()

    for (const message of messages) {
      const partition = this.getPartition(topic, message, partitionCount)
      const batch = partitionBatches.get(partition) || []
      batch.push(message)
      partitionBatches.set(partition, batch)
    }

    // Append messages to each partition
    const results: RecordMetadata[] = []

    for (const [partition, batch] of partitionBatches) {
      const partitionState = topicState.partitions.get(partition)!
      const now = Date.now()

      for (const message of batch) {
        const offset = partitionState.highWatermark.toString()
        const eventId = `${topic}-${partition}-${offset}`

        // Use ExactlyOnceContext for deduplication
        const metadata = await this.exactlyOnceContext.processOnce(eventId, async () => {
          // Get sequence number for idempotent producer
          let sequence: number | undefined
          if (this.producerId) {
            const seqKey = `${topic}-${partition}`
            sequence = this.sequenceNumbers.get(seqKey) ?? 0
            this.sequenceNumbers.set(seqKey, sequence + 1)
          }

          // Create stored message
          const storedMessage: StoredMessage = {
            offset,
            key: message.key ?? null,
            value: message.value,
            timestamp: message.timestamp ?? now,
            headers: message.headers ?? {},
            producerId: this.producerId ?? undefined,
            sequence,
          }

          // Append to partition
          partitionState.messages.push(storedMessage)
          partitionState.highWatermark++

          return {
            topic,
            partition,
            offset,
            timestamp: storedMessage.timestamp,
          } as RecordMetadata
        })

        results.push(metadata)
      }
    }

    return results
  }

  /**
   * Send batch to multiple topics
   */
  async sendBatch(batch: {
    topicMessages: Array<{ topic: string; messages: ProducerMessage[] }>
    acks?: 0 | 1 | -1
    timeout?: number
    compression?: string
  }): Promise<RecordMetadata[]> {
    this.ensureConnected()

    const allResults: RecordMetadata[] = []

    for (const { topic, messages } of batch.topicMessages) {
      const results = await this.send({ topic, messages })
      allResults.push(...results)
    }

    return allResults
  }

  /**
   * Get partition for a message
   */
  private getPartition(
    topic: string,
    message: ProducerMessage,
    partitionCount: number
  ): number {
    // Explicit partition takes precedence
    if (message.partition !== undefined) {
      if (message.partition < 0 || message.partition >= partitionCount) {
        throw new KafkaError(
          `Invalid partition ${message.partition} for topic ${topic} (has ${partitionCount} partitions)`,
          KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
        )
      }
      return message.partition
    }

    // Custom partitioner
    if (this.config.partitioner === 'custom' && this.config.customPartitioner) {
      return this.config.customPartitioner({ topic, partitionCount, message })
    }

    // Built-in partitioners
    switch (this.config.partitioner) {
      case 'round-robin':
        return this.roundRobinPartition(topic, partitionCount)

      case 'sticky':
        return this.stickyPartition(topic, message, partitionCount)

      case 'key-based':
      default:
        return this.keyBasedPartition(message, partitionCount)
    }
  }

  /**
   * Key-based partitioning using KeyedRouter
   */
  private keyBasedPartition(message: ProducerMessage, partitionCount: number): number {
    if (message.key) {
      const router = createKeyedRouter<string>(partitionCount)
      return router.route(message.key)
    }

    // No key - fall back to round robin for this topic
    // Use a special topic key for keyless messages
    return this.roundRobinPartition('__keyless__', partitionCount)
  }

  /**
   * Round-robin partitioning
   */
  private roundRobinPartition(topic: string, partitionCount: number): number {
    const current = this.roundRobinCounters.get(topic) ?? 0
    const partition = current % partitionCount
    this.roundRobinCounters.set(topic, current + 1)
    return partition
  }

  /**
   * Sticky partitioning - sticks to one partition until batch is full
   */
  private stickyPartition(
    topic: string,
    message: ProducerMessage,
    partitionCount: number
  ): number {
    // Use key-based if key is present
    if (message.key) {
      return this.keyBasedPartition(message, partitionCount)
    }

    const batchSize = this.config.batchSize ?? 16384
    const current = this.stickyState.get(topic)

    if (!current || current.count >= batchSize) {
      // Pick a random new partition
      const partition = Math.floor(Math.random() * partitionCount)
      this.stickyState.set(topic, { partition, count: 1 })
      return partition
    }

    current.count++
    return current.partition
  }

  /**
   * Ensure producer is connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new KafkaError('Producer is not connected', KafkaErrorCode.NOT_COORDINATOR)
    }
  }

  /**
   * Get producer ID
   */
  getProducerId(): string | null {
    return this.producerId
  }

  /**
   * Get configuration
   */
  getConfig(): ProducerConfig {
    const { admin, customPartitioner, allowAutoTopicCreation, ...rest } = this.config
    return rest
  }
}

/**
 * Create a new producer
 */
export function createProducer(config: ExtendedProducerConfig): Producer {
  return new Producer(config)
}
