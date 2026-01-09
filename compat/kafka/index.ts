/**
 * @dotdo/kafka
 *
 * kafkajs-compatible Kafka SDK backed by Durable Objects.
 * Drop-in replacement for kafkajs with edge-native implementation.
 *
 * Usage:
 * ```typescript
 * import { Kafka } from '@dotdo/kafka'
 *
 * const kafka = new Kafka({
 *   clientId: 'my-app',
 *   brokers: ['localhost:9092'],
 * })
 *
 * // Producer
 * const producer = kafka.producer()
 * await producer.connect()
 * await producer.send({
 *   topic: 'my-topic',
 *   messages: [{ value: 'Hello World' }],
 * })
 *
 * // Consumer
 * const consumer = kafka.consumer({ groupId: 'my-group' })
 * await consumer.connect()
 * await consumer.subscribe({ topic: 'my-topic' })
 * await consumer.run({
 *   eachMessage: async ({ topic, partition, message }) => {
 *     console.log({ topic, partition, value: message.value?.toString() })
 *   },
 * })
 *
 * // Admin
 * const admin = kafka.admin()
 * await admin.connect()
 * await admin.createTopics({
 *   topics: [{ topic: 'my-topic', numPartitions: 3 }],
 * })
 * ```
 *
 * @see https://kafka.js.org/docs/getting-started
 */

// Export main classes and functions
export { Kafka, createKafka, Partitioners, _clearAll } from './kafka'

// Export all errors
export {
  KafkaJSError,
  KafkaJSConnectionError,
  KafkaJSProtocolError,
  KafkaJSNumberOfRetriesExceeded,
  KafkaJSNonRetriableError,
  KafkaJSOffsetOutOfRange,
  KafkaJSTopicNotFound,
  KafkaJSTimeout,
  KafkaJSLockTimeout,
  KafkaJSServerDoesNotSupportApiKey,
} from './types'

// Export enums
export { CompressionTypes, LogLevel, ResourceTypes } from './kafka'

// Export all types
export type {
  // Main interfaces
  Kafka as IKafka,
  Producer,
  Consumer,
  Admin,
  Transaction,
  Logger,

  // Config types
  KafkaConfig,
  ExtendedKafkaConfig,
  ProducerConfig,
  ConsumerConfig,
  AdminConfig,
  SASLOptions,
  RetryOptions,

  // Message types
  Message,
  KafkaMessage,
  MessageValue,
  MessageKey,
  MessageHeader,
  TopicMessages,

  // Producer types
  ProducerRecord,
  ProducerBatch,
  RecordMetadata,
  Partitioner,
  PartitionerCreators,
  ProducerEvents,

  // Consumer types
  ConsumerRunConfig,
  ConsumerSubscribeTopic,
  ConsumerSubscribeTopics,
  EachMessagePayload,
  EachBatchPayload,
  Batch,
  SeekEntry,
  GroupDescription,
  MemberDescription,
  MemberAssignment,
  ConsumerEvents,

  // Partition types
  PartitionMetadata,
  TopicPartition,
  TopicPartitionOffset,
  TopicPartitionOffsetAndMetadata,

  // Topic types
  TopicMetadata,
  ITopicConfig,
  TopicConfig,

  // Admin types
  CreateTopicsOptions,
  DeleteTopicsOptions,
  CreatePartitionsOptions,
  ConfigResource,
  ConfigEntry,
  AlterConfigResource,
  FetchOffsetsOptions,
  ResetOffsetsOptions,
  SetOffsetsOptions,
  Cluster,
  AdminEvents,

  // Logger types
  LogEntry,
  LogCreator,
} from './types'
