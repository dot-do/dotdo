/**
 * @dotdo/kafka types
 *
 * kafkajs-compatible type definitions
 * for the Kafka SDK backed by Durable Objects
 *
 * @see https://kafka.js.org/docs/getting-started
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Kafka message value (can be string, Buffer, or null)
 */
export type MessageValue = string | Buffer | null

/**
 * Kafka message key
 */
export type MessageKey = string | Buffer | null

/**
 * Kafka message header
 */
export interface MessageHeader {
  [key: string]: string | Buffer | undefined
}

/**
 * Kafka message for producing
 */
export interface Message {
  /** Message key for partitioning */
  key?: MessageKey
  /** Message value/payload */
  value: MessageValue
  /** Partition to send to (optional) */
  partition?: number
  /** Message headers */
  headers?: MessageHeader
  /** Message timestamp (ms since epoch) */
  timestamp?: string
}

/**
 * Kafka message received from consumer
 */
export interface KafkaMessage {
  /** Message key */
  key: Buffer | null
  /** Message value */
  value: Buffer | null
  /** Message timestamp */
  timestamp: string
  /** Message size in bytes */
  size: number
  /** Message attributes */
  attributes: number
  /** Message offset in partition */
  offset: string
  /** Message headers */
  headers?: MessageHeader
}

/**
 * Topic messages for batch sending
 */
export interface TopicMessages {
  /** Topic name */
  topic: string
  /** Messages to send */
  messages: Message[]
}

// ============================================================================
// PARTITION TYPES
// ============================================================================

/**
 * Partition metadata
 */
export interface PartitionMetadata {
  /** Partition ID */
  partitionId: number
  /** Partition leader broker */
  leader: number
  /** Replica broker IDs */
  replicas: number[]
  /** In-sync replica broker IDs */
  isr: number[]
  /** Partition error code */
  partitionErrorCode?: number
}

/**
 * Topic partition assignment
 */
export interface TopicPartition {
  /** Topic name */
  topic: string
  /** Partition number */
  partition: number
}

/**
 * Topic partition with offset
 */
export interface TopicPartitionOffset extends TopicPartition {
  /** Offset position */
  offset: string
}

/**
 * Topic partition with offset and metadata
 */
export interface TopicPartitionOffsetAndMetadata extends TopicPartitionOffset {
  /** Consumer metadata */
  metadata?: string | null
}

// ============================================================================
// TOPIC TYPES
// ============================================================================

/**
 * Topic metadata
 */
export interface TopicMetadata {
  /** Topic name */
  name: string
  /** Partition metadata */
  partitions: PartitionMetadata[]
}

/**
 * Topic configuration for creation
 */
export interface ITopicConfig {
  /** Topic name */
  topic: string
  /** Number of partitions */
  numPartitions?: number
  /** Replication factor */
  replicationFactor?: number
  /** Topic configuration entries */
  configEntries?: { name: string; value: string }[]
}

/**
 * Topic configuration for admin operations
 */
export interface TopicConfig {
  /** Topic name */
  name: string
  /** Configuration entries */
  configEntries: { configName: string; configValue: string; isDefault: boolean }[]
}

// ============================================================================
// CONSUMER TYPES
// ============================================================================

/**
 * Consumer group metadata
 */
export interface GroupDescription {
  /** Group ID */
  groupId: string
  /** Protocol type */
  protocolType: string
  /** Protocol name */
  protocol: string
  /** Group state */
  state: string
  /** Group members */
  members: MemberDescription[]
}

/**
 * Consumer group member metadata
 */
export interface MemberDescription {
  /** Member ID */
  memberId: string
  /** Client ID */
  clientId: string
  /** Client host */
  clientHost: string
  /** Member metadata */
  memberMetadata: Buffer
  /** Member assignment */
  memberAssignment: Buffer
}

/**
 * Consumer group member assignment
 */
export interface MemberAssignment {
  /** Assigned topic partitions */
  assignment: { [topic: string]: number[] }
}

/**
 * Batch of consumed messages
 */
export interface EachBatchPayload {
  /** Batch of messages */
  batch: Batch
  /** Resolve offset function */
  resolveOffset(offset: string): void
  /** Heartbeat function */
  heartbeat(): Promise<void>
  /** Commit offsets if autoCommit disabled */
  commitOffsetsIfNecessary(offsets?: TopicPartitionOffsetAndMetadata[]): Promise<void>
  /** Uncommitted offsets */
  uncommittedOffsets(): TopicPartitionOffsetAndMetadata[]
  /** Check if batch is running */
  isRunning(): boolean
  /** Check if batch is stale */
  isStale(): boolean
  /** Pause consuming */
  pause(): void
}

/**
 * Single message payload
 */
export interface EachMessagePayload {
  /** Topic name */
  topic: string
  /** Partition number */
  partition: number
  /** Message */
  message: KafkaMessage
  /** Heartbeat function */
  heartbeat(): Promise<void>
  /** Pause consuming */
  pause(): () => void
}

/**
 * Batch of messages from a single partition
 */
export interface Batch {
  /** Topic name */
  topic: string
  /** Partition number */
  partition: number
  /** High watermark offset */
  highWatermark: string
  /** Messages in batch */
  messages: KafkaMessage[]
  /** Check if batch is empty */
  isEmpty(): boolean
  /** First offset in batch */
  firstOffset(): string | null
  /** Last offset in batch */
  lastOffset(): string
  /** Offset lag */
  offsetLag(): string
  /** Offset lag (low) */
  offsetLagLow(): string
}

/**
 * Consumer run configuration
 */
export interface ConsumerRunConfig {
  /** Auto commit enabled */
  autoCommit?: boolean
  /** Auto commit interval in ms */
  autoCommitInterval?: number
  /** Auto commit threshold */
  autoCommitThreshold?: number
  /** Process each batch handler */
  eachBatch?: (payload: EachBatchPayload) => Promise<void>
  /** Process each message handler */
  eachMessage?: (payload: EachMessagePayload) => Promise<void>
  /** Enable batch auto resolve */
  eachBatchAutoResolve?: boolean
  /** Partitions consumed concurrently */
  partitionsConsumedConcurrently?: number
}

/**
 * Consumer subscription
 */
export interface ConsumerSubscribeTopic {
  /** Topic name or regex */
  topic: string | RegExp
  /** Read from beginning */
  fromBeginning?: boolean
}

/**
 * Consumer subscription topics
 */
export interface ConsumerSubscribeTopics {
  /** Topics to subscribe to */
  topics: (string | RegExp)[]
  /** Read from beginning */
  fromBeginning?: boolean
}

/**
 * Seek configuration
 */
export interface SeekEntry {
  /** Topic name */
  topic: string
  /** Partition number */
  partition: number
  /** Offset to seek to */
  offset: string
}

// ============================================================================
// PRODUCER TYPES
// ============================================================================

/**
 * Producer record for sending
 */
export interface ProducerRecord {
  /** Topic name */
  topic: string
  /** Messages to send */
  messages: Message[]
  /** Acknowledgment level */
  acks?: number
  /** Request timeout in ms */
  timeout?: number
  /** Compression type */
  compression?: CompressionTypes
}

/**
 * Producer batch
 */
export interface ProducerBatch {
  /** Topic messages */
  topicMessages?: TopicMessages[]
  /** Acknowledgment level */
  acks?: number
  /** Request timeout in ms */
  timeout?: number
  /** Compression type */
  compression?: CompressionTypes
}

/**
 * Record metadata returned after send
 */
export interface RecordMetadata {
  /** Topic name */
  topicName: string
  /** Partition */
  partition: number
  /** Error code */
  errorCode: number
  /** Base offset */
  baseOffset?: string
  /** Log append time */
  logAppendTime?: string
  /** Log start offset */
  logStartOffset?: string
}

/**
 * Compression types
 */
export enum CompressionTypes {
  None = 0,
  GZIP = 1,
  Snappy = 2,
  LZ4 = 3,
  ZSTD = 4,
}

/**
 * Custom partitioner
 */
export interface Partitioner {
  (args: {
    topic: string
    partitionMetadata: PartitionMetadata[]
    message: Message
  }): number
}

/**
 * Default partitioner creators
 */
export interface PartitionerCreators {
  /** Default partitioner (murmur2) */
  DefaultPartitioner: () => Partitioner
  /** Java compatible partitioner */
  JavaCompatiblePartitioner: () => Partitioner
  /** Legacy partitioner */
  LegacyPartitioner: () => Partitioner
}

// ============================================================================
// ADMIN TYPES
// ============================================================================

/**
 * Create topics options
 */
export interface CreateTopicsOptions {
  /** Topics to create */
  topics: ITopicConfig[]
  /** Validate only without creating */
  validateOnly?: boolean
  /** Wait for leaders */
  waitForLeaders?: boolean
  /** Timeout in ms */
  timeout?: number
}

/**
 * Delete topics options
 */
export interface DeleteTopicsOptions {
  /** Topics to delete */
  topics: string[]
  /** Timeout in ms */
  timeout?: number
}

/**
 * Create partitions options
 */
export interface CreatePartitionsOptions {
  /** Validate only without creating */
  validateOnly?: boolean
  /** Timeout in ms */
  timeout?: number
  /** Topic partitions */
  topicPartitions: { topic: string; count: number; assignments?: number[][] }[]
}

/**
 * Describe configs resource types
 */
export enum ResourceTypes {
  UNKNOWN = 0,
  ANY = 1,
  TOPIC = 2,
  GROUP = 3,
  CLUSTER = 4,
  TRANSACTIONAL_ID = 5,
  DELEGATION_TOKEN = 6,
}

/**
 * Config resource
 */
export interface ConfigResource {
  /** Resource type */
  type: ResourceTypes
  /** Resource name */
  name: string
  /** Config names to describe */
  configNames?: string[]
}

/**
 * Config entry
 */
export interface ConfigEntry {
  /** Config name */
  configName: string
  /** Config value */
  configValue: string
}

/**
 * Alter config resource
 */
export interface AlterConfigResource extends ConfigResource {
  /** Config entries to alter */
  configEntries: ConfigEntry[]
}

/**
 * Fetch offsets options
 */
export interface FetchOffsetsOptions {
  /** Group ID */
  groupId: string
  /** Topics (optional, all if not specified) */
  topics?: string[]
  /** Resolve unstable offsets */
  resolveOffsets?: boolean
}

/**
 * Reset offsets options
 */
export interface ResetOffsetsOptions {
  /** Group ID */
  groupId: string
  /** Topic */
  topic: string
  /** Earliest offset */
  earliest?: boolean
}

/**
 * Set offsets options
 */
export interface SetOffsetsOptions {
  /** Group ID */
  groupId: string
  /** Topic */
  topic: string
  /** Partitions with offsets */
  partitions: { partition: number; offset: string }[]
}

/**
 * Delete groups options
 */
export interface DeleteGroupsOptions {
  /** Group IDs to delete */
  groupIds: string[]
}

/**
 * Cluster information
 */
export interface Cluster {
  /** Brokers */
  brokers: { nodeId: number; host: string; port: number }[]
  /** Controller broker ID */
  controller: number | null
  /** Cluster ID */
  clusterId: string
}

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Kafka client configuration
 */
export interface KafkaConfig {
  /** Client ID */
  clientId?: string
  /** Broker list */
  brokers: string[]
  /** SSL configuration */
  ssl?: boolean | object
  /** SASL authentication */
  sasl?: SASLOptions
  /** Connection timeout in ms */
  connectionTimeout?: number
  /** Authentication timeout in ms */
  authenticationTimeout?: number
  /** Request timeout in ms */
  requestTimeout?: number
  /** Enforce request timeout */
  enforceRequestTimeout?: boolean
  /** Retry configuration */
  retry?: RetryOptions
  /** Socket factory */
  socketFactory?: unknown
  /** Logger */
  logLevel?: LogLevel
  /** Custom logger creator */
  logCreator?: LogCreator
}

/**
 * Extended Kafka config for DO backing
 */
export interface ExtendedKafkaConfig extends KafkaConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
  }
  /** Cloudflare Queue binding (for real persistence) */
  queueBinding?: Queue
  /** Cloudflare Pipeline binding (for streaming) */
  pipelineBinding?: unknown
}

/**
 * SASL authentication options
 */
export interface SASLOptions {
  /** SASL mechanism */
  mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512' | 'aws' | 'oauthbearer'
  /** Username */
  username?: string
  /** Password */
  password?: string
  /** OAuth bearer token */
  oauthBearerToken?: string
  /** AWS credentials */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

/**
 * Retry options
 */
export interface RetryOptions {
  /** Max retries */
  maxRetryTime?: number
  /** Initial retry time */
  initialRetryTime?: number
  /** Retry factor */
  factor?: number
  /** Retry multiplier */
  multiplier?: number
  /** Retries */
  retries?: number
}

/**
 * Log levels
 */
export enum LogLevel {
  NOTHING = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 4,
  DEBUG = 5,
}

/**
 * Log entry
 */
export interface LogEntry {
  /** Namespace */
  namespace: string
  /** Log level */
  level: LogLevel
  /** Label */
  label: string
  /** Log message */
  log: {
    /** Message */
    message: string
    /** Additional data */
    [key: string]: unknown
  }
}

/**
 * Logger interface
 */
export interface Logger {
  info(message: string, extra?: object): void
  error(message: string, extra?: object): void
  warn(message: string, extra?: object): void
  debug(message: string, extra?: object): void
  namespace(namespace: string): Logger
  setLogLevel(level: LogLevel): void
}

/**
 * Log creator function
 */
export type LogCreator = (level: LogLevel) => (entry: LogEntry) => void

/**
 * Producer configuration
 */
export interface ProducerConfig {
  /** Create partitioner */
  createPartitioner?: () => Partitioner
  /** Retry options */
  retry?: RetryOptions
  /** Metadata max age in ms */
  metadataMaxAge?: number
  /** Allow auto topic creation */
  allowAutoTopicCreation?: boolean
  /** Idempotent producer */
  idempotent?: boolean
  /** Transactional ID */
  transactionalId?: string
  /** Transaction timeout in ms */
  transactionTimeout?: number
  /** Max in-flight requests */
  maxInFlightRequests?: number
}

/**
 * Consumer configuration
 */
export interface ConsumerConfig {
  /** Consumer group ID */
  groupId: string
  /** Partition assigner */
  partitionAssigners?: unknown[]
  /** Metadata max age in ms */
  metadataMaxAge?: number
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
  /** Retry options */
  retry?: RetryOptions
  /** Allow auto topic creation */
  allowAutoTopicCreation?: boolean
  /** Max in-flight requests */
  maxInFlightRequests?: number
  /** Read uncommitted */
  readUncommitted?: boolean
  /** Rack ID */
  rackId?: string
}

/**
 * Admin configuration
 */
export interface AdminConfig {
  /** Retry options */
  retry?: RetryOptions
}

// ============================================================================
// PRODUCER INTERFACE
// ============================================================================

/**
 * Kafka Producer interface
 */
export interface Producer {
  /** Connect to Kafka */
  connect(): Promise<void>
  /** Disconnect from Kafka */
  disconnect(): Promise<void>
  /** Check if connected */
  isIdempotent(): boolean
  /** Send messages to a topic */
  send(record: ProducerRecord): Promise<RecordMetadata[]>
  /** Send batch of messages to multiple topics */
  sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]>
  /** Begin a transaction */
  transaction(): Promise<Transaction>
  /** Register event listener */
  on(event: ProducerEvents, listener: (...args: unknown[]) => void): this
  /** Get logger */
  logger(): Logger
}

/**
 * Producer events
 */
export type ProducerEvents =
  | 'producer.connect'
  | 'producer.disconnect'
  | 'producer.network.request'
  | 'producer.network.request_timeout'
  | 'producer.network.request_queue_size'

/**
 * Transaction interface
 */
export interface Transaction {
  /** Send messages in transaction */
  send(record: ProducerRecord): Promise<RecordMetadata[]>
  /** Send batch in transaction */
  sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]>
  /** Send offsets to transaction */
  sendOffsets(offsets: {
    consumerGroupId: string
    topics: { topic: string; partitions: { partition: number; offset: string }[] }[]
  }): Promise<void>
  /** Commit transaction */
  commit(): Promise<void>
  /** Abort transaction */
  abort(): Promise<void>
  /** Check if active */
  isActive(): boolean
}

// ============================================================================
// CONSUMER INTERFACE
// ============================================================================

/**
 * Kafka Consumer interface
 */
export interface Consumer {
  /** Connect to Kafka */
  connect(): Promise<void>
  /** Disconnect from Kafka */
  disconnect(): Promise<void>
  /** Subscribe to topics */
  subscribe(subscription: ConsumerSubscribeTopic | ConsumerSubscribeTopics): Promise<void>
  /** Stop consuming */
  stop(): Promise<void>
  /** Run consumer */
  run(config?: ConsumerRunConfig): Promise<void>
  /** Commit offsets */
  commitOffsets(topicPartitions: TopicPartitionOffsetAndMetadata[]): Promise<void>
  /** Seek to offset */
  seek(topicPartitionOffset: SeekEntry): void
  /** Describe group */
  describeGroup(): Promise<GroupDescription>
  /** Pause consuming topics */
  pause(topics: { topic: string; partitions?: number[] }[]): void
  /** Paused topics */
  paused(): TopicPartition[]
  /** Resume consuming topics */
  resume(topics: { topic: string; partitions?: number[] }[]): void
  /** Register event listener */
  on(event: ConsumerEvents, listener: (...args: unknown[]) => void): this
  /** Get logger */
  logger(): Logger
}

/**
 * Consumer events
 */
export type ConsumerEvents =
  | 'consumer.connect'
  | 'consumer.disconnect'
  | 'consumer.stop'
  | 'consumer.crash'
  | 'consumer.rebalancing'
  | 'consumer.received_unsubscribed_topics'
  | 'consumer.group_join'
  | 'consumer.fetch_start'
  | 'consumer.fetch'
  | 'consumer.start_batch_process'
  | 'consumer.end_batch_process'
  | 'consumer.commit_offsets'
  | 'consumer.network.request'
  | 'consumer.network.request_timeout'
  | 'consumer.network.request_queue_size'
  | 'consumer.heartbeat'

// ============================================================================
// ADMIN INTERFACE
// ============================================================================

/**
 * Kafka Admin interface
 */
export interface Admin {
  /** Connect to Kafka */
  connect(): Promise<void>
  /** Disconnect from Kafka */
  disconnect(): Promise<void>
  /** List topics */
  listTopics(): Promise<string[]>
  /** Create topics */
  createTopics(options: CreateTopicsOptions): Promise<boolean>
  /** Delete topics */
  deleteTopics(options: DeleteTopicsOptions): Promise<void>
  /** Create partitions */
  createPartitions(options: CreatePartitionsOptions): Promise<boolean>
  /** Fetch topic metadata */
  fetchTopicMetadata(options?: { topics?: string[] }): Promise<{ topics: TopicMetadata[] }>
  /** Fetch topic offsets */
  fetchTopicOffsets(topic: string): Promise<{ partition: number; offset: string; high: string; low: string }[]>
  /** Fetch topic offsets by timestamp */
  fetchTopicOffsetsByTimestamp(
    topic: string,
    timestamp?: number
  ): Promise<{ partition: number; offset: string }[]>
  /** Describe configs */
  describeConfigs(resources: ConfigResource[]): Promise<{ resources: { configEntries: ConfigEntry[] }[] }>
  /** Alter configs */
  alterConfigs(resources: AlterConfigResource[]): Promise<void>
  /** List groups */
  listGroups(): Promise<{ groups: { groupId: string; protocolType: string }[] }>
  /** Describe groups */
  describeGroups(groupIds: string[]): Promise<{ groups: GroupDescription[] }>
  /** Delete groups */
  deleteGroups(groupIds: string[]): Promise<void>
  /** Reset offsets */
  resetOffsets(options: ResetOffsetsOptions): Promise<void>
  /** Set offsets */
  setOffsets(options: SetOffsetsOptions): Promise<void>
  /** Fetch offsets */
  fetchOffsets(options: FetchOffsetsOptions): Promise<{ topic: string; partitions: { partition: number; offset: string; metadata: string | null }[] }[]>
  /** Describe cluster */
  describeCluster(): Promise<Cluster>
  /** Register event listener */
  on(event: AdminEvents, listener: (...args: unknown[]) => void): this
  /** Get logger */
  logger(): Logger
}

/**
 * Admin events
 */
export type AdminEvents =
  | 'admin.connect'
  | 'admin.disconnect'
  | 'admin.network.request'
  | 'admin.network.request_timeout'
  | 'admin.network.request_queue_size'

// ============================================================================
// KAFKA CLIENT INTERFACE
// ============================================================================

/**
 * Kafka client interface
 */
export interface Kafka {
  /** Create a producer */
  producer(config?: ProducerConfig): Producer
  /** Create a consumer */
  consumer(config: ConsumerConfig): Consumer
  /** Create an admin client */
  admin(config?: AdminConfig): Admin
  /** Get logger */
  logger(): Logger
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base Kafka error
 */
export class KafkaJSError extends Error {
  readonly retriable: boolean
  readonly type: string

  constructor(message: string, options?: { retriable?: boolean; type?: string }) {
    super(message)
    this.name = 'KafkaJSError'
    this.retriable = options?.retriable ?? true
    this.type = options?.type ?? 'KAFKAJS_ERROR'
  }
}

/**
 * Connection error
 */
export class KafkaJSConnectionError extends KafkaJSError {
  readonly broker?: string

  constructor(message: string, options?: { broker?: string }) {
    super(message, { retriable: true, type: 'KAFKAJS_CONNECTION_ERROR' })
    this.name = 'KafkaJSConnectionError'
    this.broker = options?.broker
  }
}

/**
 * Protocol error
 */
export class KafkaJSProtocolError extends KafkaJSError {
  readonly code: number

  constructor(message: string, options?: { code?: number }) {
    super(message, { retriable: false, type: 'KAFKAJS_PROTOCOL_ERROR' })
    this.name = 'KafkaJSProtocolError'
    this.code = options?.code ?? -1
  }
}

/**
 * Number of retries exceeded
 */
export class KafkaJSNumberOfRetriesExceeded extends KafkaJSError {
  readonly retryCount: number
  readonly retryTime: number

  constructor(message: string, options?: { retryCount?: number; retryTime?: number }) {
    super(message, { retriable: false, type: 'KAFKAJS_NUMBER_OF_RETRIES_EXCEEDED' })
    this.name = 'KafkaJSNumberOfRetriesExceeded'
    this.retryCount = options?.retryCount ?? 0
    this.retryTime = options?.retryTime ?? 0
  }
}

/**
 * Non-retriable error
 */
export class KafkaJSNonRetriableError extends KafkaJSError {
  constructor(message: string) {
    super(message, { retriable: false, type: 'KAFKAJS_NON_RETRIABLE_ERROR' })
    this.name = 'KafkaJSNonRetriableError'
  }
}

/**
 * Offset out of range error
 */
export class KafkaJSOffsetOutOfRange extends KafkaJSError {
  readonly topic: string
  readonly partition: number

  constructor(message: string, options?: { topic?: string; partition?: number }) {
    super(message, { retriable: false, type: 'KAFKAJS_OFFSET_OUT_OF_RANGE' })
    this.name = 'KafkaJSOffsetOutOfRange'
    this.topic = options?.topic ?? ''
    this.partition = options?.partition ?? 0
  }
}

/**
 * Topic not found error
 */
export class KafkaJSTopicNotFound extends KafkaJSError {
  readonly topic: string

  constructor(message: string, options?: { topic?: string }) {
    super(message, { retriable: false, type: 'KAFKAJS_TOPIC_NOT_FOUND' })
    this.name = 'KafkaJSTopicNotFound'
    this.topic = options?.topic ?? ''
  }
}

/**
 * Timeout error
 */
export class KafkaJSTimeout extends KafkaJSError {
  constructor(message: string) {
    super(message, { retriable: true, type: 'KAFKAJS_TIMEOUT' })
    this.name = 'KafkaJSTimeout'
  }
}

/**
 * Lock timeout error
 */
export class KafkaJSLockTimeout extends KafkaJSError {
  constructor(message: string) {
    super(message, { retriable: true, type: 'KAFKAJS_LOCK_TIMEOUT' })
    this.name = 'KafkaJSLockTimeout'
  }
}

/**
 * Server unavailable error
 */
export class KafkaJSServerDoesNotSupportApiKey extends KafkaJSError {
  readonly apiKey: number
  readonly apiName: string

  constructor(message: string, options?: { apiKey?: number; apiName?: string }) {
    super(message, { retriable: false, type: 'KAFKAJS_SERVER_DOES_NOT_SUPPORT_API_KEY' })
    this.name = 'KafkaJSServerDoesNotSupportApiKey'
    this.apiKey = options?.apiKey ?? 0
    this.apiName = options?.apiName ?? ''
  }
}
