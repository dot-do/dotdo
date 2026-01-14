/**
 * Kafka-compatible types for message queue compat layer
 *
 * Provides Kafka-compatible API types backed by unified primitives:
 * - ExactlyOnceContext for deduplication and exactly-once delivery
 * - KeyedRouter for partition routing
 * - WindowManager for batch windowing
 * - TemporalStore for durable message storage
 */

// =============================================================================
// Core Message Types
// =============================================================================

/**
 * A message to be produced to a topic
 */
export interface ProducerMessage {
  /** Message key (used for partitioning) */
  key?: string | null
  /** Message value/payload */
  value: string | null
  /** Optional explicit partition (overrides partitioner) */
  partition?: number
  /** Optional timestamp (defaults to current time) */
  timestamp?: number
  /** Optional headers */
  headers?: Record<string, string>
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
  key: string | null
  /** Message value */
  value: string | null
  /** Timestamp when the message was produced */
  timestamp: number
  /** Message headers */
  headers: Record<string, string>
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

// =============================================================================
// Topic & Partition Types
// =============================================================================

/**
 * Topic configuration
 */
export interface TopicConfig {
  /** Topic name */
  name: string
  /** Number of partitions */
  partitions: number
  /** Retention period in milliseconds (optional, -1 for infinite) */
  retentionMs?: number
  /** Cleanup policy: delete or compact */
  cleanupPolicy?: 'delete' | 'compact'
}

/**
 * Internal stored message format
 */
export interface StoredMessage {
  /** Unique offset within partition */
  offset: string
  /** Message key */
  key: string | null
  /** Message value */
  value: string | null
  /** Timestamp */
  timestamp: number
  /** Headers */
  headers: Record<string, string>
  /** Producer ID for idempotent producers */
  producerId?: string
  /** Sequence number for deduplication */
  sequence?: number
}

/**
 * Partition state
 */
export interface PartitionState {
  /** Topic name */
  topic: string
  /** Partition number */
  partition: number
  /** Highest committed offset + 1 (next offset to be written) */
  highWatermark: string
  /** Lowest available offset */
  logStartOffset: string
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

// =============================================================================
// Producer Types
// =============================================================================

/**
 * Partitioner type
 */
export type PartitionerType = 'round-robin' | 'key-based' | 'sticky' | 'custom'

/**
 * Producer configuration
 */
export interface ProducerConfig {
  /** Partitioner type (default: key-based) */
  partitioner?: PartitionerType
  /** Enable idempotent producer (exactly-once semantics) */
  idempotent?: boolean
  /** Transaction ID for transactional producer */
  transactionalId?: string
  /** Batch size for batching messages */
  batchSize?: number
  /** Linger time in ms to wait for batch to fill */
  lingerMs?: number
  /** Acknowledgement level: 0 (none), 1 (leader), -1 (all) */
  acks?: 0 | 1 | -1
}

/**
 * Producer record (message batch to send)
 */
export interface ProducerRecord {
  /** Topic to produce to */
  topic: string
  /** Messages to produce */
  messages: ProducerMessage[]
}

/**
 * Custom partitioner function
 */
export type Partitioner = (args: {
  topic: string
  partitionCount: number
  message: ProducerMessage
}) => number

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
  sessionTimeoutMs?: number
  /** Heartbeat interval in ms */
  heartbeatIntervalMs?: number
  /** Auto commit offsets */
  autoCommit?: boolean
  /** Auto commit interval in ms */
  autoCommitIntervalMs?: number
  /** Where to start consuming: 'earliest' or 'latest' */
  autoOffsetReset?: 'earliest' | 'latest'
  /** Max messages to fetch per poll */
  maxPollRecords?: number
  /** Read uncommitted messages (for transactions) */
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
 * Consumer assignment (topic-partitions assigned to this consumer)
 */
export interface ConsumerAssignment {
  topic: string
  partitions: number[]
}

/**
 * Consumer group member
 */
export interface ConsumerGroupMember {
  /** Member ID */
  memberId: string
  /** Client ID */
  clientId: string
  /** Subscribed topics */
  subscriptions: string[]
  /** Assigned partitions */
  assignment: Map<string, number[]>
  /** Last heartbeat timestamp */
  lastHeartbeat: number
}

/**
 * Consumer group state
 */
export type ConsumerGroupState = 'Empty' | 'Stable' | 'PreparingRebalance' | 'CompletingRebalance' | 'Dead'

/**
 * Offset commit metadata
 */
export interface OffsetCommit {
  topic: string
  partition: number
  offset: string
  metadata?: string
  timestamp: number
}

// =============================================================================
// Admin Types
// =============================================================================

/**
 * Admin configuration
 */
export interface AdminConfig {
  /** Request timeout in ms */
  requestTimeoutMs?: number
}

/**
 * Create topics request
 */
export interface CreateTopicsRequest {
  topics: TopicConfig[]
  /** Validate only, don't actually create */
  validateOnly?: boolean
}

/**
 * Delete topics request
 */
export interface DeleteTopicsRequest {
  topics: string[]
}

/**
 * Describe topics result
 */
export interface TopicDescription {
  name: string
  partitions: PartitionDescription[]
  config: Record<string, string>
}

/**
 * Partition description
 */
export interface PartitionDescription {
  partition: number
  highWatermark: string
  logStartOffset: string
}

/**
 * Consumer group description
 */
export interface ConsumerGroupDescription {
  groupId: string
  state: ConsumerGroupState
  members: ConsumerGroupMemberDescription[]
}

/**
 * Consumer group member description
 */
export interface ConsumerGroupMemberDescription {
  memberId: string
  clientId: string
  assignment: TopicPartition[]
}

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch of messages for processing
 */
export interface MessageBatch {
  topic: string
  partition: number
  messages: ConsumedMessage[]
  highWatermark: string
  /** Check if batch is empty */
  isEmpty(): boolean
  /** Get first offset in batch */
  firstOffset(): string | null
  /** Get last offset in batch */
  lastOffset(): string | null
}

/**
 * Payload for eachMessage handler
 */
export interface EachMessagePayload {
  topic: string
  partition: number
  message: ConsumedMessage
  /** Send heartbeat to prevent session timeout */
  heartbeat(): Promise<void>
}

/**
 * Payload for eachBatch handler
 */
export interface EachBatchPayload {
  batch: MessageBatch
  /** Resolve/mark offset as processed */
  resolveOffset(offset: string): void
  /** Send heartbeat */
  heartbeat(): Promise<void>
  /** Commit offsets if auto-commit is disabled */
  commitOffsetsIfNecessary(): Promise<void>
  /** Get uncommitted offsets */
  uncommittedOffsets(): TopicPartitionOffset[]
  /** Check if consumer is still running */
  isRunning(): boolean
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
  UNKNOWN_TOPIC_OR_PARTITION = 3,
  LEADER_NOT_AVAILABLE = 5,
  NOT_LEADER_FOR_PARTITION = 6,
  REQUEST_TIMED_OUT = 7,
  MESSAGE_TOO_LARGE = 10,
  COORDINATOR_NOT_AVAILABLE = 15,
  NOT_COORDINATOR = 16,
  INVALID_TOPIC = 17,
  ILLEGAL_GENERATION = 22,
  UNKNOWN_MEMBER_ID = 25,
  REBALANCE_IN_PROGRESS = 27,
  TOPIC_ALREADY_EXISTS = 36,
  INVALID_PARTITIONS = 37,
  DUPLICATE_SEQUENCE_NUMBER = 46,
  INVALID_PRODUCER_EPOCH = 47,
  INVALID_TXN_STATE = 48,
}

/**
 * Kafka error
 */
export class KafkaError extends Error {
  constructor(
    message: string,
    public code: KafkaErrorCode = KafkaErrorCode.UNKNOWN,
    public retriable: boolean = false
  ) {
    super(message)
    this.name = 'KafkaError'
  }
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Producer events
 */
export type ProducerEvent =
  | { type: 'producer.connect'; payload: {} }
  | { type: 'producer.disconnect'; payload: {} }
  | { type: 'producer.send'; payload: { topic: string; partition: number; offset: string } }

/**
 * Consumer events
 */
export type ConsumerEvent =
  | { type: 'consumer.connect'; payload: {} }
  | { type: 'consumer.disconnect'; payload: {} }
  | { type: 'consumer.heartbeat'; payload: { groupId: string; memberId: string } }
  | { type: 'consumer.rebalancing'; payload: { groupId: string } }
  | { type: 'consumer.group_join'; payload: { groupId: string; memberId: string } }
  | { type: 'consumer.fetch'; payload: { topic: string; partition: number; messageCount: number } }
  | { type: 'consumer.commit_offsets'; payload: { offsets: TopicPartitionOffset[] } }

// =============================================================================
// Internal Types for Primitives Integration
// =============================================================================

/**
 * Internal topic storage state (used with TemporalStore)
 */
export interface TopicStorageState {
  config: TopicConfig
  partitions: Map<number, PartitionStorageState>
}

/**
 * Internal partition storage state
 */
export interface PartitionStorageState {
  highWatermark: bigint
  logStartOffset: bigint
  messages: StoredMessage[]
}

/**
 * Consumer group coordinator state
 */
export interface ConsumerGroupCoordinatorState {
  groupId: string
  state: ConsumerGroupState
  generationId: number
  leaderId: string | null
  members: Map<string, ConsumerGroupMember>
  offsets: Map<string, OffsetCommit> // key: topic-partition
}

/**
 * Seek target
 */
export type SeekTarget =
  | { type: 'offset'; offset: string }
  | { type: 'timestamp'; timestamp: number }
  | { type: 'beginning' }
  | { type: 'end' }
