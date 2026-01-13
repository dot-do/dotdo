/**
 * Kafka Producer - Message production with partitioning
 *
 * Provides Kafka-compatible producer API with in-memory backend.
 */

import {
  getTopic,
  appendMessage,
  setTopic,
  createTopic,
} from './backends/memory'
import { KafkaAdmin } from './admin'
import {
  type ProducerConfig,
  type ProducerRecord,
  type ProducerBatch,
  type ProducerMessage,
  type RecordMetadata,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Extended producer config with admin reference
 */
export interface ExtendedProducerConfig extends ProducerConfig {
  /** Admin client for topic management */
  admin?: KafkaAdmin
}

/**
 * Producer interface
 */
export interface Producer {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(record: ProducerRecord): Promise<RecordMetadata[]>
  sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]>
}

/**
 * Kafka Producer implementation
 */
export class KafkaProducer implements Producer {
  private config: ExtendedProducerConfig
  private connected = false
  private admin: KafkaAdmin

  constructor(config: ExtendedProducerConfig = {}) {
    this.config = {
      allowAutoTopicCreation: true,
      ...config,
    }
    this.admin = config.admin ?? new KafkaAdmin()
  }

  /**
   * Connect the producer
   */
  async connect(): Promise<void> {
    if (this.connected) return
    this.connected = true
  }

  /**
   * Disconnect the producer
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return
    this.connected = false
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
    let topicState = getTopic(topic)

    if (!topicState) {
      if (this.config.allowAutoTopicCreation) {
        topicState = createTopic(topic, 1)
        setTopic(topic, topicState)
      } else {
        throw new KafkaError(
          `Topic '${topic}' does not exist`,
          KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
        )
      }
    }

    const numPartitions = topicState.numPartitions
    const results: RecordMetadata[] = []

    for (const message of messages) {
      const partition = this.getPartition(message, numPartitions)
      const now = Date.now()

      // Convert message to stored format
      const key = message.key ? toBuffer(message.key) : null
      const value = message.value === null ? null : toBuffer(message.value)
      const headers = normalizeHeaders(message.headers)

      const stored = appendMessage(topic, partition, {
        key,
        value,
        timestamp: message.timestamp ?? now,
        headers,
      })

      results.push({
        topic,
        partition,
        offset: stored.offset,
        timestamp: stored.timestamp,
      })
    }

    return results
  }

  /**
   * Send batch to multiple topics
   */
  async sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]> {
    this.ensureConnected()

    const allResults: RecordMetadata[] = []

    for (const { topic, messages } of batch.topicMessages) {
      const results = await this.send({ topic, messages })
      allResults.push(...results)
    }

    return allResults
  }

  /**
   * Get partition for a message using consistent hashing
   */
  private getPartition(message: ProducerMessage, numPartitions: number): number {
    // Explicit partition takes precedence
    if (message.partition !== undefined) {
      if (message.partition < 0 || message.partition >= numPartitions) {
        throw new KafkaError(
          `Invalid partition ${message.partition} (has ${numPartitions} partitions)`,
          KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
        )
      }
      return message.partition
    }

    // Key-based partitioning
    if (message.key !== null && message.key !== undefined) {
      const keyStr = typeof message.key === 'string' ? message.key : message.key.toString()
      return hashKey(keyStr) % numPartitions
    }

    // Round-robin for keyless messages
    return Math.floor(Math.random() * numPartitions)
  }

  /**
   * Ensure producer is connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new KafkaError('Producer is not connected', KafkaErrorCode.NOT_COORDINATOR)
    }
  }
}

/**
 * Simple hash function for key-based partitioning
 */
function hashKey(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Convert string or Buffer to Buffer
 */
function toBuffer(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value
  }
  return Buffer.from(value)
}

/**
 * Normalize headers to Buffer format
 */
function normalizeHeaders(
  headers?: Record<string, string | Buffer>
): Record<string, Buffer | string> {
  if (!headers) return {}

  const normalized: Record<string, Buffer | string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = value
  }
  return normalized
}

/**
 * Create a new producer
 */
export function createProducer(config: ExtendedProducerConfig = {}): Producer {
  return new KafkaProducer(config)
}
