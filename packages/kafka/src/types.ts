/**
 * Kafka-compatible types for @dotdo/kafka package
 *
 * Provides Kafka-compatible API types with in-memory backend.
 */

// =============================================================================
// Core Message Types
// =============================================================================

/**
 * A message to be produced to a topic
 */
export interface ProducerMessage {
  /** Message key (used for partitioning) */
  key?: string | Buffer | null
  /** Message value/payload */
  value: string | Buffer | null
  /** Optional explicit partition (overrides partitioner) */
  partition?: number
  /** Optional timestamp (defaults to current time) */
  timestamp?: number
  /** Optional headers */
  headers?: Record<string, string | Buffer>
}

/**
 * A consumed message from a topic
 */
export interface ConsumedMessage {
  /** Topic the message was consumed from */
  topic: string
  /** Partition the message came from */
  partition: number
  /** Offset within the partition */
  offset: string
  /** Message key */
  key: Buffer | null
  /** Message value */
  value: Buffer | null
  /** Timestamp when the message was produced */
  timestamp: number
  /** Message headers */
  headers: Record<string, Buffer | string>
}

/**
 * Metadata returned after producing a message
 */
export interface RecordMetadata {
  /** Topic the message was produced to */
  topic: string
  /** Partition the message was written to */
  partition: number
  /** Offset assigned to the message */
  offset: string
  /** Timestamp of the message */
  timestamp: number
}

/**
 * Internal stored message format
 */
export interface StoredMessage {
  /** Unique offset within partition */
  offset: string
  /** Message key */
  key: Buffer | null
  /** Message value */
  value: Buffer | null
  /** Timestamp */
  timestamp: number
  /** Headers */
  headers: Record<string, Buffer | string>
}

// =============================================================================
// Topic & Partition Types
// =============================================================================

/**
 * Topic configuration for creation
 */
export interface TopicConfig {
  /** Topic name */
  topic: string
  /** Number of partitions */
  numPartitions?: number
  /** Replication factor (ignored for in-memory) */
  replicationFactor?: number
  /** Topic-level configs */
  configEntries?: Array<{ name: string; value: string }>
}

/**
 * Topic-partition identifier
 */
export interface TopicPartition {
  topic: string
  partition: number
}

/**
 * Topic-partition with offset
 */
export interface TopicPartitionOffset extends TopicPartition {
  offset: string
  /** Optional metadata stored with the offset */
  metadata?: string
}

/**
 * Partition metadata
 */
export interface PartitionMetadata {
  partition: number
  leader: number
  replicas: number[]
  isr: number[]
  offlineReplicas: number[]
}

// =============================================================================
// Producer Types
// =============================================================================

/**
 * Producer configuration
 */
export interface ProducerConfig {
  /** Allow auto-creation of topics */
  allowAutoTopicCreation?: boolean
  /** Transaction ID for transactional producer */
  transactionalId?: string
  /** Idempotent producer */
  idempotent?: boolean
  /** Max in-flight requests */
  maxInFlightRequests?: number
}

/**
 * Producer record (message batch to send)
 */
export interface ProducerRecord {
  /** Topic to produce to */
  topic: string
  /** Messages to produce */
  messages: ProducerMessage[]
  /** Acknowledgement level */
  acks?: -1 | 0 | 1
  /** Timeout in ms */
  timeout?: number
}

/**
 * Batch of messages to multiple topics
 */
export interface ProducerBatch {
  /** Messages grouped by topic */
  topicMessages: Array<{
    topic: string
    messages: ProducerMessage[]
  }>
  /** Acknowledgement level */
  acks?: -1 | 0 | 1
  /** Timeout in ms */
  timeout?: number
}

// =============================================================================
// Consumer Types
// =============================================================================

/**
 * Consumer configuration
 */
export interface ConsumerConfig {
  /** Consumer group ID */
  groupId: string
  /** Session timeout in ms */
  sessionTimeout?: number
  /** Rebalance timeout in ms */
  rebalanceTimeout?: number
  /** Heartbeat interval in ms */
  heartbeatInterval?: number
  /** Max bytes per partition */
  maxBytesPerPartition?: number
  /** Min bytes */
  minBytes?: number
  /** Max bytes */
  maxBytes?: number
  /** Max wait time in ms */
  maxWaitTimeInMs?: number
  /** Read uncommitted messages */
  readUncommitted?: boolean
}

/**
 * Consumer subscription
 */
export interface ConsumerSubscription {
  /** Topics to subscribe to */
  topics: string[]
  /** Start from beginning (earliest) or end (latest) */
  fromBeginning?: boolean
}

/**
 * Consumer run configuration
 */
export interface ConsumerRunConfig {
  /** Auto commit offsets */
  autoCommit?: boolean
  /** Auto commit interval in ms */
  autoCommitInterval?: number
  /** Auto commit threshold */
  autoCommitThreshold?: number
  /** Handler for each message */
  eachMessage?: EachMessageHandler
  /** Handler for each batch */
  eachBatch?: EachBatchHandler
  /** Partitions consumed concurrently */
  partitionsConsumedConcurrently?: number
}

/**
 * Payload for eachMessage handler
 */
export interface EachMessagePayload {
  topic: string
  partition: number
  message: ConsumedMessage
  heartbeat: () => Promise<void>
  pause: () => () => void
}

/**
 * Payload for eachBatch handler
 */
export interface EachBatchPayload {
  batch: MessageBatch
  resolveOffset: (offset: string) => void
  heartbeat: () => Promise<void>
  commitOffsetsIfNecessary: () => Promise<void>
  uncommittedOffsets: () => TopicPartitionOffset[]
  isRunning: () => boolean
  isStale: () => boolean
  pause: () => () => void
}

/**
 * Batch of messages
 */
export interface MessageBatch {
  topic: string
  partition: number
  highWatermark: string
  messages: ConsumedMessage[]
  isEmpty: () => boolean
  firstOffset: () => string | null
  lastOffset: () => string | null
  offsetLag: () => string
  offsetLagLow: () => string
}

/**
 * Message handler type
 */
export type EachMessageHandler = (payload: EachMessagePayload) => Promise<void>

/**
 * Batch handler type
 */
export type EachBatchHandler = (payload: EachBatchPayload) => Promise<void>

// =============================================================================
// Admin Types
// =============================================================================

/**
 * Create topics request
 */
export interface CreateTopicsRequest {
  topics: TopicConfig[]
  /** Validate only, don't actually create */
  validateOnly?: boolean
  /** Wait for leaders */
  waitForLeaders?: boolean
  /** Timeout in ms */
  timeout?: number
}

/**
 * Delete topics request
 */
export interface DeleteTopicsRequest {
  topics: string[]
  /** Timeout in ms */
  timeout?: number
}

/**
 * Topic metadata
 */
export interface TopicMetadata {
  name: string
  partitions: PartitionMetadata[]
}

/**
 * Fetch topic metadata options
 */
export interface FetchTopicMetadataOptions {
  topics?: string[]
}

// =============================================================================
// Kafka Client Types
// =============================================================================

/**
 * Kafka client configuration
 */
export interface KafkaConfig {
  /** Broker addresses */
  brokers: string[]
  /** Client ID */
  clientId?: string
  /** Connection timeout */
  connectionTimeout?: number
  /** Authentication timeout */
  authenticationTimeout?: number
  /** Request timeout */
  requestTimeout?: number
  /** Retry configuration */
  retry?: RetryConfig
  /** SSL configuration */
  ssl?: boolean
  /** SASL configuration */
  sasl?: SASLConfig
  /** Log level */
  logLevel?: number
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetryTime?: number
  initialRetryTime?: number
  factor?: number
  multiplier?: number
  retries?: number
}

/**
 * SASL configuration
 */
export interface SASLConfig {
  mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'
  username: string
  password: string
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Kafka error codes
 */
export enum KafkaErrorCode {
  NONE = 0,
  UNKNOWN = -1,
  OFFSET_OUT_OF_RANGE = 1,
  CORRUPT_MESSAGE = 2,
  UNKNOWN_TOPIC_OR_PARTITION = 3,
  INVALID_FETCH_SIZE = 4,
  LEADER_NOT_AVAILABLE = 5,
  NOT_LEADER_FOR_PARTITION = 6,
  REQUEST_TIMED_OUT = 7,
  BROKER_NOT_AVAILABLE = 8,
  REPLICA_NOT_AVAILABLE = 9,
  MESSAGE_TOO_LARGE = 10,
  STALE_CONTROLLER_EPOCH = 11,
  OFFSET_METADATA_TOO_LARGE = 12,
  NETWORK_EXCEPTION = 13,
  COORDINATOR_LOAD_IN_PROGRESS = 14,
  COORDINATOR_NOT_AVAILABLE = 15,
  NOT_COORDINATOR = 16,
  INVALID_TOPIC_EXCEPTION = 17,
  RECORD_LIST_TOO_LARGE = 18,
  NOT_ENOUGH_REPLICAS = 19,
  NOT_ENOUGH_REPLICAS_AFTER_APPEND = 20,
  INVALID_REQUIRED_ACKS = 21,
  ILLEGAL_GENERATION = 22,
  INCONSISTENT_GROUP_PROTOCOL = 23,
  INVALID_GROUP_ID = 24,
  UNKNOWN_MEMBER_ID = 25,
  INVALID_SESSION_TIMEOUT = 26,
  REBALANCE_IN_PROGRESS = 27,
  INVALID_COMMIT_OFFSET_SIZE = 28,
  TOPIC_AUTHORIZATION_FAILED = 29,
  GROUP_AUTHORIZATION_FAILED = 30,
  CLUSTER_AUTHORIZATION_FAILED = 31,
  INVALID_TIMESTAMP = 32,
  UNSUPPORTED_SASL_MECHANISM = 33,
  ILLEGAL_SASL_STATE = 34,
  UNSUPPORTED_VERSION = 35,
  TOPIC_ALREADY_EXISTS = 36,
  INVALID_PARTITIONS = 37,
  INVALID_REPLICATION_FACTOR = 38,
  INVALID_REPLICA_ASSIGNMENT = 39,
  INVALID_CONFIG = 40,
  NOT_CONTROLLER = 41,
  INVALID_REQUEST = 42,
  UNSUPPORTED_FOR_MESSAGE_FORMAT = 43,
  POLICY_VIOLATION = 44,
}

/**
 * Kafka error class
 */
export class KafkaError extends Error {
  public readonly code: KafkaErrorCode
  public readonly retriable: boolean

  constructor(message: string, code: KafkaErrorCode = KafkaErrorCode.UNKNOWN, retriable = false) {
    super(message)
    this.name = 'KafkaError'
    this.code = code
    this.retriable = retriable
  }
}

// =============================================================================
// Internal Storage Types
// =============================================================================

/**
 * Internal partition storage state
 */
export interface PartitionStorageState {
  highWatermark: bigint
  logStartOffset: bigint
  messages: StoredMessage[]
}

/**
 * Internal topic storage state
 */
export interface TopicStorageState {
  name: string
  numPartitions: number
  partitions: Map<number, PartitionStorageState>
}

/**
 * Consumer group member
 */
export interface ConsumerGroupMember {
  memberId: string
  clientId: string
  subscriptions: string[]
  assignment: Map<string, number[]>
  lastHeartbeat: number
}

/**
 * Consumer group state
 */
export type ConsumerGroupState = 'Empty' | 'Stable' | 'PreparingRebalance' | 'CompletingRebalance' | 'Dead'

/**
 * Consumer group coordinator state
 */
export interface ConsumerGroupCoordinatorState {
  groupId: string
  state: ConsumerGroupState
  generationId: number
  leaderId: string | null
  members: Map<string, ConsumerGroupMember>
  offsets: Map<string, { offset: string; metadata?: string; timestamp: number }>
}
