/**
 * @dotdo/kafka - Kafka-compatible message queue with in-memory backend
 *
 * Provides a KafkaJS-compatible API backed by in-memory storage.
 * Suitable for testing, development, and edge environments.
 *
 * @example
 * ```typescript
 * import { createKafka } from '@dotdo/kafka'
 *
 * // Create Kafka client
 * const kafka = createKafka({ brokers: ['localhost:9092'] })
 *
 * // Create admin and topics
 * const admin = kafka.admin()
 * await admin.connect()
 * await admin.createTopics({
 *   topics: [{ topic: 'orders', numPartitions: 3 }]
 * })
 *
 * // Create producer
 * const producer = kafka.producer()
 * await producer.connect()
 * await producer.send({
 *   topic: 'orders',
 *   messages: [
 *     { key: 'order-123', value: JSON.stringify({ product: 'Widget' }) }
 *   ]
 * })
 *
 * // Create consumer
 * const consumer = kafka.consumer({ groupId: 'order-processor' })
 * await consumer.connect()
 * await consumer.subscribe({ topics: ['orders'], fromBeginning: true })
 *
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     console.log(`Received: ${message.value?.toString()}`)
 *   }
 * })
 * ```
 */

// Main client
export { createKafka, KafkaClient, resetRegistry } from './client'
export type { Kafka } from './client'

// Admin
export { createAdmin, KafkaAdmin } from './admin'
export type { Admin } from './admin'

// Producer
export { createProducer, KafkaProducer } from './producer'
export type { Producer, ExtendedProducerConfig } from './producer'

// Consumer
export { createConsumer, KafkaConsumer } from './consumer'
export type { Consumer, ExtendedConsumerConfig } from './consumer'

// Types
export {
  // Core message types
  type ProducerMessage,
  type ConsumedMessage,
  type RecordMetadata,
  type StoredMessage,
  // Topic & partition types
  type TopicConfig,
  type TopicPartition,
  type TopicPartitionOffset,
  type PartitionMetadata,
  // Producer types
  type ProducerConfig,
  type ProducerRecord,
  type ProducerBatch,
  // Consumer types
  type ConsumerConfig,
  type ConsumerSubscription,
  type ConsumerRunConfig,
  type EachMessagePayload,
  type EachBatchPayload,
  type MessageBatch,
  type EachMessageHandler,
  type EachBatchHandler,
  // Admin types
  type CreateTopicsRequest,
  type DeleteTopicsRequest,
  type TopicMetadata,
  type FetchTopicMetadataOptions,
  // Client types
  type KafkaConfig,
  type RetryConfig,
  type SASLConfig,
  // Error types
  KafkaError,
  KafkaErrorCode,
} from './types'
