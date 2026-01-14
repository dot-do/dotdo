/**
 * Kafka compat layer - Message queue compatible with Kafka clients
 *
 * Backed by unified primitives:
 * - ExactlyOnceContext for deduplication and exactly-once delivery
 * - KeyedRouter for partition routing
 * - WindowManager for batch windowing
 * - TemporalStore for durable message storage
 *
 * @example
 * ```typescript
 * import { createKafkaAdmin, createProducer, createConsumer } from '@dotdo/kafka'
 *
 * // Create admin and topics
 * const admin = createKafkaAdmin()
 * await admin.createTopics({
 *   topics: [{ name: 'orders', partitions: 3 }]
 * })
 *
 * // Produce messages
 * const producer = createProducer({ admin })
 * await producer.connect()
 * await producer.send({
 *   topic: 'orders',
 *   messages: [
 *     { key: 'order-123', value: JSON.stringify({ product: 'Widget' }) }
 *   ]
 * })
 *
 * // Consume messages
 * const consumer = createConsumer({ admin, groupId: 'order-processor' })
 * await consumer.connect()
 * await consumer.subscribe({ topics: ['orders'], fromBeginning: true })
 *
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     console.log(`Received: ${message.value}`)
 *   }
 * })
 * ```
 */

// Types
export type {
  // Core message types
  ProducerMessage,
  ConsumedMessage,
  RecordMetadata,
  StoredMessage,
  // Topic & partition types
  TopicConfig,
  TopicPartition,
  TopicPartitionOffset,
  PartitionDescription,
  // Producer types
  ProducerConfig,
  ProducerRecord,
  Partitioner,
  PartitionerType,
  // Consumer types
  ConsumerConfig,
  ConsumerSubscription,
  ConsumerAssignment,
  ConsumerGroupMember,
  ConsumerGroupState,
  OffsetCommit,
  // Batch types
  MessageBatch,
  EachMessagePayload,
  EachBatchPayload,
  // Admin types
  AdminConfig,
  CreateTopicsRequest,
  DeleteTopicsRequest,
  TopicDescription,
  ConsumerGroupDescription,
  ConsumerGroupMemberDescription,
  // Seek types
  SeekTarget,
} from './types'

// Error types
export { KafkaError, KafkaErrorCode } from './types'

// Admin
export { KafkaAdmin, createKafkaAdmin, resetRegistry } from './admin'

// Producer
export { Producer, createProducer, type ExtendedProducerConfig } from './producer'

// Consumer
export { Consumer, createConsumer, type ExtendedConsumerConfig } from './consumer'
