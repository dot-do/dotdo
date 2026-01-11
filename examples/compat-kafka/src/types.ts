/**
 * Kafka-compatible types for Durable Objects event streaming
 *
 * These types follow the Apache Kafka API conventions for
 * full compatibility with existing Kafka clients.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Kafka message record
 */
export interface ProducerRecord {
  topic: string
  messages: Message[]
  acks?: -1 | 0 | 1 // -1 = all, 0 = none, 1 = leader only
  timeout?: number
  compression?: CompressionType
}

export interface Message {
  key?: string | Buffer | null
  value: string | Buffer | null
  partition?: number
  timestamp?: string
  headers?: Record<string, string | Buffer>
}

export interface RecordMetadata {
  topic: string
  partition: number
  offset: string
  timestamp: string
  errorCode?: number
  baseOffset?: string
  logAppendTime?: string
  logStartOffset?: string
}

export interface TopicMessage {
  key: string | null
  value: string | null
  partition: number
  offset: string
  timestamp: string
  headers: Record<string, string>
  topic: string
}

export type CompressionType = 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd'

// =============================================================================
// Topic Management
// =============================================================================

export interface TopicConfig {
  topic: string
  numPartitions?: number
  replicationFactor?: number
  replicaAssignment?: PartitionAssignment[]
  configEntries?: ConfigEntry[]
}

export interface PartitionAssignment {
  partition: number
  replicas: number[]
}

export interface ConfigEntry {
  name: string
  value: string
}

export interface TopicMetadata {
  name: string
  partitions: PartitionMetadata[]
  isInternal: boolean
}

export interface PartitionMetadata {
  partition: number
  leader: number
  replicas: number[]
  isr: number[] // in-sync replicas
  offlineReplicas: number[]
  errorCode?: number
}

export interface TopicPartitionOffset {
  topic: string
  partition: number
  offset: string
  metadata?: string
  leaderEpoch?: number
}

// =============================================================================
// Consumer Types
// =============================================================================

export interface ConsumerConfig {
  groupId: string
  sessionTimeout?: number
  rebalanceTimeout?: number
  heartbeatInterval?: number
  metadataMaxAge?: number
  allowAutoTopicCreation?: boolean
  maxBytesPerPartition?: number
  minBytes?: number
  maxBytes?: number
  maxWaitTimeInMs?: number
  retry?: RetryConfig
  readUncommitted?: boolean
  maxInFlightRequests?: number
  rackId?: string
}

export interface RetryConfig {
  maxRetryTime?: number
  initialRetryTime?: number
  factor?: number
  multiplier?: number
  retries?: number
}

export interface ConsumerSubscription {
  topics: string[]
  fromBeginning?: boolean
}

export interface ConsumerAssignment {
  topic: string
  partitions: number[]
}

export interface ConsumerGroupMetadata {
  groupId: string
  generationId: number
  memberId: string
  protocolType: string
  protocol: string
}

export interface MemberDescription {
  memberId: string
  clientId: string
  clientHost: string
  memberMetadata: Buffer
  memberAssignment: Buffer
}

export interface ConsumerGroupDescription {
  groupId: string
  protocolType: string
  protocol: string
  state: ConsumerGroupState
  members: MemberDescription[]
  coordinator: { id: number; host: string; port: number }
}

export type ConsumerGroupState =
  | 'Unknown'
  | 'PreparingRebalance'
  | 'CompletingRebalance'
  | 'Stable'
  | 'Dead'
  | 'Empty'

export interface OffsetAndMetadata {
  offset: string
  leaderEpoch?: number
  metadata?: string
}

export interface OffsetCommitRequest {
  groupId: string
  memberId?: string
  generationId?: number
  topics: TopicPartitionOffset[]
}

export interface OffsetFetchRequest {
  groupId: string
  topics?: { topic: string; partitions: number[] }[]
}

// =============================================================================
// Producer Types
// =============================================================================

export interface ProducerConfig {
  allowAutoTopicCreation?: boolean
  transactionTimeout?: number
  idempotent?: boolean
  transactionalId?: string
  maxInFlightRequests?: number
  retry?: RetryConfig
  metadataMaxAge?: number
}

export interface TransactionState {
  transactionalId: string
  producerId: string
  producerEpoch: number
  state: 'Empty' | 'Ongoing' | 'PrepareCommit' | 'PrepareAbort' | 'CompleteCommit' | 'CompleteAbort' | 'Dead'
  partitions: Set<string>
  lastUpdateTime: number
}

// =============================================================================
// Admin Types
// =============================================================================

export interface AdminConfig {
  retry?: RetryConfig
}

export interface CreateTopicsRequest {
  topics: TopicConfig[]
  timeout?: number
  validateOnly?: boolean
}

export interface DeleteTopicsRequest {
  topics: string[]
  timeout?: number
}

export interface ListTopicsRequest {
  listInternal?: boolean
}

export interface DescribeTopicsRequest {
  topics: string[]
  includeAuthorizedOperations?: boolean
}

export interface DescribeGroupsRequest {
  groupIds: string[]
  includeAuthorizedOperations?: boolean
}

export interface DeleteGroupsRequest {
  groupIds: string[]
}

export interface TopicPartitions {
  topic: string
  partitions: number[]
}

export interface OffsetsByTimestamp {
  topic: string
  partition: number
  timestamp: string
}

export interface ListOffsetResult {
  topic: string
  partition: number
  offset: string
  timestamp: string
  leaderEpoch?: number
}

// =============================================================================
// Partitioner Types
// =============================================================================

export type PartitionerType = 'default' | 'round-robin' | 'murmur2' | 'custom'

export interface Partitioner {
  (args: PartitionerArgs): number
}

export interface PartitionerArgs {
  topic: string
  partitionMetadata: PartitionMetadata[]
  message: Message
}

export interface DefaultPartitionerConfig {
  partitioner?: PartitionerType | Partitioner
}

// =============================================================================
// Error Types
// =============================================================================

export class KafkaError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public retriable: boolean = false
  ) {
    super(message)
    this.name = 'KafkaError'
  }
}

export enum ErrorCode {
  UNKNOWN = -1,
  NONE = 0,
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
  OUT_OF_ORDER_SEQUENCE_NUMBER = 45,
  DUPLICATE_SEQUENCE_NUMBER = 46,
  INVALID_PRODUCER_EPOCH = 47,
  INVALID_TXN_STATE = 48,
  INVALID_PRODUCER_ID_MAPPING = 49,
  INVALID_TRANSACTION_TIMEOUT = 50,
  CONCURRENT_TRANSACTIONS = 51,
  TRANSACTION_COORDINATOR_FENCED = 52,
  TRANSACTIONAL_ID_AUTHORIZATION_FAILED = 53,
  SECURITY_DISABLED = 54,
  OPERATION_NOT_ATTEMPTED = 55,
  KAFKA_STORAGE_ERROR = 56,
  LOG_DIR_NOT_FOUND = 57,
  SASL_AUTHENTICATION_FAILED = 58,
  UNKNOWN_PRODUCER_ID = 59,
  REASSIGNMENT_IN_PROGRESS = 60,
  DELEGATION_TOKEN_AUTH_DISABLED = 61,
  DELEGATION_TOKEN_NOT_FOUND = 62,
  DELEGATION_TOKEN_OWNER_MISMATCH = 63,
  DELEGATION_TOKEN_REQUEST_NOT_ALLOWED = 64,
  DELEGATION_TOKEN_AUTHORIZATION_FAILED = 65,
  DELEGATION_TOKEN_EXPIRED = 66,
  INVALID_PRINCIPAL_TYPE = 67,
  NON_EMPTY_GROUP = 68,
  GROUP_ID_NOT_FOUND = 69,
  FETCH_SESSION_ID_NOT_FOUND = 70,
  INVALID_FETCH_SESSION_EPOCH = 71,
  LISTENER_NOT_FOUND = 72,
  TOPIC_DELETION_DISABLED = 73,
  FENCED_LEADER_EPOCH = 74,
  UNKNOWN_LEADER_EPOCH = 75,
  UNSUPPORTED_COMPRESSION_TYPE = 76,
  STALE_BROKER_EPOCH = 77,
  OFFSET_NOT_AVAILABLE = 78,
  MEMBER_ID_REQUIRED = 79,
  PREFERRED_LEADER_NOT_AVAILABLE = 80,
  GROUP_MAX_SIZE_REACHED = 81,
}

// =============================================================================
// Internal Storage Types
// =============================================================================

export interface StoredMessage {
  offset: string
  key: string | null
  value: string | null
  timestamp: string
  headers: Record<string, string>
  producerId?: string
  producerEpoch?: number
  sequence?: number
}

export interface PartitionState {
  partition: number
  highWatermark: string
  logStartOffset: string
  leader: number
  replicas: number[]
  isr: number[]
}

export interface ConsumerOffset {
  topic: string
  partition: number
  offset: string
  metadata: string
  commitTimestamp: string
  leaderEpoch?: number
}

export interface ConsumerMember {
  memberId: string
  clientId: string
  clientHost: string
  sessionTimeout: number
  rebalanceTimeout: number
  subscriptions: string[]
  assignment: Map<string, number[]>
  lastHeartbeat: number
}

// =============================================================================
// Event Types
// =============================================================================

export type ConsumerEvent =
  | { type: 'consumer.heartbeat'; payload: { groupId: string; memberId: string } }
  | { type: 'consumer.commit_offsets'; payload: { groupId: string; offsets: TopicPartitionOffset[] } }
  | { type: 'consumer.group_join'; payload: { groupId: string; memberId: string; leaderId: string } }
  | { type: 'consumer.fetch'; payload: { topic: string; partition: number; offset: string } }
  | { type: 'consumer.start_batch_process'; payload: { topic: string; partition: number; messageCount: number } }
  | { type: 'consumer.end_batch_process'; payload: { topic: string; partition: number; messageCount: number } }
  | { type: 'consumer.rebalancing'; payload: { groupId: string; memberId: string } }
  | { type: 'consumer.crash'; payload: { groupId: string; error: Error } }
  | { type: 'consumer.disconnect'; payload: object }
  | { type: 'consumer.stop'; payload: object }
  | { type: 'consumer.connect'; payload: object }

export type ProducerEvent =
  | { type: 'producer.connect'; payload: object }
  | { type: 'producer.disconnect'; payload: object }
  | { type: 'producer.network.request'; payload: { topic: string; broker: string } }
  | { type: 'producer.network.request_timeout'; payload: { topic: string; broker: string } }
  | { type: 'producer.network.request_queue_size'; payload: { queueSize: number } }

export type AdminEvent =
  | { type: 'admin.connect'; payload: object }
  | { type: 'admin.disconnect'; payload: object }

// =============================================================================
// Batch Types
// =============================================================================

export interface EachBatchPayload {
  batch: Batch
  resolveOffset: (offset: string) => void
  heartbeat: () => Promise<void>
  commitOffsetsIfNecessary: (offsets?: TopicPartitionOffset[]) => Promise<void>
  uncommittedOffsets: () => TopicPartitionOffset[]
  isRunning: () => boolean
  isStale: () => boolean
}

export interface EachMessagePayload {
  topic: string
  partition: number
  message: TopicMessage
  heartbeat: () => Promise<void>
  pause: () => () => void
}

export interface Batch {
  topic: string
  partition: number
  highWatermark: string
  messages: TopicMessage[]
  isEmpty: () => boolean
  firstOffset: () => string | null
  lastOffset: () => string
  offsetLag: () => string
  offsetLagLow: () => string
}

// =============================================================================
// Compaction Types
// =============================================================================

export interface CompactionConfig {
  'cleanup.policy': 'delete' | 'compact' | 'compact,delete'
  'min.cleanable.dirty.ratio'?: number
  'min.compaction.lag.ms'?: number
  'max.compaction.lag.ms'?: number
  'segment.ms'?: number
  'segment.bytes'?: number
  'retention.ms'?: number
  'retention.bytes'?: number
}

export interface CompactionState {
  lastCleanedOffset: string
  dirtyRatio: number
  lastCompactionTime: number
  cleanableBytes: number
  totalBytes: number
}
