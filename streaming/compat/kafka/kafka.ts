/**
 * @dotdo/kafka - Kafka SDK compat
 *
 * Drop-in replacement for kafkajs backed by DO SQLite with in-memory storage.
 * This implementation matches the kafkajs API.
 * Production version routes to Cloudflare Queues/Pipelines based on config.
 *
 * @see https://kafka.js.org/docs/getting-started
 */
import type {
  Kafka as IKafka,
  Producer as IProducer,
  Consumer as IConsumer,
  Admin as IAdmin,
  KafkaConfig,
  ExtendedKafkaConfig,
  ProducerConfig,
  ConsumerConfig,
  AdminConfig,
  ProducerRecord,
  ProducerBatch,
  RecordMetadata,
  TopicMessages,
  Message,
  KafkaMessage,
  TopicPartition,
  TopicPartitionOffset,
  TopicPartitionOffsetAndMetadata,
  ConsumerSubscribeTopic,
  ConsumerSubscribeTopics,
  ConsumerRunConfig,
  EachMessagePayload,
  EachBatchPayload,
  Batch,
  SeekEntry,
  GroupDescription,
  MemberDescription,
  CreateTopicsOptions,
  DeleteTopicsOptions,
  CreatePartitionsOptions,
  ITopicConfig,
  TopicMetadata,
  PartitionMetadata,
  ConfigResource,
  ConfigEntry,
  AlterConfigResource,
  FetchOffsetsOptions,
  ResetOffsetsOptions,
  SetOffsetsOptions,
  Cluster,
  Transaction as ITransaction,
  Logger,
  LogEntry,
  ProducerEvents,
  ConsumerEvents,
  AdminEvents,
  Partitioner,
} from './types'
import {
  LogLevel,
  CompressionTypes,
  ResourceTypes,
  KafkaJSError,
  KafkaJSTopicNotFound,
  KafkaJSOffsetOutOfRange,
  KafkaJSNonRetriableError,
} from './types'

// Re-export types and classes from types.ts
export {
  CompressionTypes,
  LogLevel,
  ResourceTypes,
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

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Topic partition data structure
 */
interface PartitionData {
  messages: KafkaMessage[]
  highWatermark: number
}

/**
 * Topic data structure
 */
interface TopicData {
  name: string
  partitions: Map<number, PartitionData>
  config: Map<string, string>
  numPartitions: number
  replicationFactor: number
}

/**
 * Consumer group data structure
 */
interface ConsumerGroupData {
  groupId: string
  members: Map<string, MemberData>
  offsets: Map<string, Map<number, number>> // topic -> partition -> offset
  state: 'Empty' | 'Dead' | 'PreparingRebalance' | 'CompletingRebalance' | 'Stable'
}

/**
 * Consumer group member data
 */
interface MemberData {
  memberId: string
  clientId: string
  clientHost: string
  assignment: Map<string, number[]> // topic -> partitions
}

/**
 * Global in-memory storage for all Kafka data
 */
const globalTopics = new Map<string, TopicData>()
const globalConsumerGroups = new Map<string, ConsumerGroupData>()

/**
 * Get or create a topic
 */
function getTopic(name: string): TopicData | undefined {
  return globalTopics.get(name)
}

/**
 * Create a topic
 */
function createTopic(config: ITopicConfig): boolean {
  if (globalTopics.has(config.topic)) {
    return false
  }

  const numPartitions = config.numPartitions ?? 1
  const partitions = new Map<number, PartitionData>()

  for (let i = 0; i < numPartitions; i++) {
    partitions.set(i, { messages: [], highWatermark: 0 })
  }

  const topicConfig = new Map<string, string>()
  if (config.configEntries) {
    for (const entry of config.configEntries) {
      topicConfig.set(entry.name, entry.value)
    }
  }

  globalTopics.set(config.topic, {
    name: config.topic,
    partitions,
    config: topicConfig,
    numPartitions,
    replicationFactor: config.replicationFactor ?? 1,
  })

  return true
}

/**
 * Get or create a consumer group
 */
function getOrCreateConsumerGroup(groupId: string): ConsumerGroupData {
  let group = globalConsumerGroups.get(groupId)
  if (!group) {
    group = {
      groupId,
      members: new Map(),
      offsets: new Map(),
      state: 'Empty',
    }
    globalConsumerGroups.set(groupId, group)
  }
  return group
}

// ============================================================================
// LOGGER IMPLEMENTATION
// ============================================================================

class LoggerImpl implements Logger {
  private _namespace: string
  private _level: LogLevel

  constructor(namespace = 'kafkajs', level = LogLevel.INFO) {
    this._namespace = namespace
    this._level = level
  }

  info(message: string, extra?: object): void {
    if (this._level >= LogLevel.INFO) {
      console.log(`[${this._namespace}] INFO: ${message}`, extra ?? '')
    }
  }

  error(message: string, extra?: object): void {
    if (this._level >= LogLevel.ERROR) {
      console.error(`[${this._namespace}] ERROR: ${message}`, extra ?? '')
    }
  }

  warn(message: string, extra?: object): void {
    if (this._level >= LogLevel.WARN) {
      console.warn(`[${this._namespace}] WARN: ${message}`, extra ?? '')
    }
  }

  debug(message: string, extra?: object): void {
    if (this._level >= LogLevel.DEBUG) {
      console.debug(`[${this._namespace}] DEBUG: ${message}`, extra ?? '')
    }
  }

  namespace(namespace: string): Logger {
    return new LoggerImpl(`${this._namespace}.${namespace}`, this._level)
  }

  setLogLevel(level: LogLevel): void {
    this._level = level
  }
}

// ============================================================================
// DEFAULT PARTITIONER
// ============================================================================

/**
 * Simple hash function (murmur2-like)
 */
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

/**
 * Default partitioner - uses message key for partitioning
 */
function defaultPartitioner(): Partitioner {
  return ({ topic, partitionMetadata, message }) => {
    const numPartitions = partitionMetadata.length

    // If partition is explicitly set, use it
    if (message.partition !== undefined) {
      return message.partition
    }

    // If key is provided, hash it
    if (message.key !== null && message.key !== undefined) {
      const keyStr = typeof message.key === 'string' ? message.key : message.key.toString()
      return hashCode(keyStr) % numPartitions
    }

    // Round-robin for messages without keys
    return Math.floor(Math.random() * numPartitions)
  }
}

// ============================================================================
// TRANSACTION IMPLEMENTATION
// ============================================================================

class TransactionImpl implements ITransaction {
  private _producer: ProducerImpl
  private _active = true
  private _pendingMessages: { topic: string; partition: number; messages: KafkaMessage[] }[] = []

  constructor(producer: ProducerImpl) {
    this._producer = producer
  }

  async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    if (!this._active) {
      throw new KafkaJSNonRetriableError('Transaction is not active')
    }

    const results = await this._producer._sendInternal(record, true)
    return results
  }

  async sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]> {
    if (!this._active) {
      throw new KafkaJSNonRetriableError('Transaction is not active')
    }

    const results = await this._producer._sendBatchInternal(batch, true)
    return results
  }

  async sendOffsets(_offsets: {
    consumerGroupId: string
    topics: { topic: string; partitions: { partition: number; offset: string }[] }[]
  }): Promise<void> {
    if (!this._active) {
      throw new KafkaJSNonRetriableError('Transaction is not active')
    }
    // In-memory implementation - no-op for offset commits in transaction
  }

  async commit(): Promise<void> {
    if (!this._active) {
      throw new KafkaJSNonRetriableError('Transaction is not active')
    }
    this._active = false
    // Messages are already committed in in-memory implementation
  }

  async abort(): Promise<void> {
    if (!this._active) {
      throw new KafkaJSNonRetriableError('Transaction is not active')
    }
    this._active = false
    // In production, would rollback messages
  }

  isActive(): boolean {
    return this._active
  }
}

// ============================================================================
// PRODUCER IMPLEMENTATION
// ============================================================================

class ProducerImpl implements IProducer {
  private _config: ExtendedKafkaConfig
  private _producerConfig: ProducerConfig
  private _connected = false
  private _partitioner: Partitioner
  private _logger: Logger
  private _eventListeners: Map<ProducerEvents, Set<(...args: unknown[]) => void>> = new Map()
  private _idempotent: boolean

  constructor(config: ExtendedKafkaConfig, producerConfig: ProducerConfig = {}) {
    this._config = config
    this._producerConfig = producerConfig
    this._partitioner = producerConfig.createPartitioner?.() ?? defaultPartitioner()
    this._logger = new LoggerImpl('kafkajs.producer', config.logLevel)
    this._idempotent = producerConfig.idempotent ?? false
  }

  async connect(): Promise<void> {
    this._connected = true
    this._emit('producer.connect', {})
  }

  async disconnect(): Promise<void> {
    this._connected = false
    this._emit('producer.disconnect', {})
  }

  isIdempotent(): boolean {
    return this._idempotent
  }

  async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    return this._sendInternal(record, false)
  }

  async _sendInternal(record: ProducerRecord, _inTransaction: boolean): Promise<RecordMetadata[]> {
    if (!this._connected) {
      throw new KafkaJSError('Producer is not connected')
    }

    let topic = getTopic(record.topic)

    // Auto-create topic if allowed
    if (!topic && this._producerConfig.allowAutoTopicCreation !== false) {
      createTopic({ topic: record.topic, numPartitions: 1 })
      topic = getTopic(record.topic)
    }

    if (!topic) {
      throw new KafkaJSTopicNotFound(`Topic ${record.topic} not found`, { topic: record.topic })
    }

    const results: RecordMetadata[] = []
    const partitionMetadata: PartitionMetadata[] = Array.from(topic.partitions.keys()).map(p => ({
      partitionId: p,
      leader: 0,
      replicas: [0],
      isr: [0],
    }))

    for (const message of record.messages) {
      const partition = this._partitioner({
        topic: record.topic,
        partitionMetadata,
        message,
      })

      const partitionData = topic.partitions.get(partition)
      if (!partitionData) {
        throw new KafkaJSError(`Partition ${partition} not found for topic ${record.topic}`)
      }

      const kafkaMessage: KafkaMessage = {
        key: message.key ? (typeof message.key === 'string' ? Buffer.from(message.key) : message.key) : null,
        value: message.value ? (typeof message.value === 'string' ? Buffer.from(message.value) : message.value) : null,
        timestamp: message.timestamp ?? Date.now().toString(),
        size: message.value ? (typeof message.value === 'string' ? message.value.length : message.value.length) : 0,
        attributes: 0,
        offset: partitionData.highWatermark.toString(),
        headers: message.headers,
      }

      partitionData.messages.push(kafkaMessage)
      partitionData.highWatermark++

      results.push({
        topicName: record.topic,
        partition,
        errorCode: 0,
        baseOffset: kafkaMessage.offset,
        logAppendTime: kafkaMessage.timestamp,
        logStartOffset: '0',
      })
    }

    return results
  }

  async sendBatch(batch: ProducerBatch): Promise<RecordMetadata[]> {
    return this._sendBatchInternal(batch, false)
  }

  async _sendBatchInternal(batch: ProducerBatch, inTransaction: boolean): Promise<RecordMetadata[]> {
    const results: RecordMetadata[] = []

    if (batch.topicMessages) {
      for (const topicMessages of batch.topicMessages) {
        const recordResults = await this._sendInternal(
          {
            topic: topicMessages.topic,
            messages: topicMessages.messages,
            acks: batch.acks,
            timeout: batch.timeout,
            compression: batch.compression,
          },
          inTransaction
        )
        results.push(...recordResults)
      }
    }

    return results
  }

  async transaction(): Promise<ITransaction> {
    if (!this._producerConfig.transactionalId) {
      throw new KafkaJSNonRetriableError('Transactional ID is required for transactions')
    }
    return new TransactionImpl(this)
  }

  on(event: ProducerEvents, listener: (...args: unknown[]) => void): this {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(listener)
    return this
  }

  private _emit(event: ProducerEvents, payload: unknown): void {
    const listeners = this._eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        listener(payload)
      }
    }
  }

  logger(): Logger {
    return this._logger
  }
}

// ============================================================================
// BATCH IMPLEMENTATION
// ============================================================================

class BatchImpl implements Batch {
  topic: string
  partition: number
  highWatermark: string
  messages: KafkaMessage[]

  constructor(topic: string, partition: number, messages: KafkaMessage[], highWatermark: string) {
    this.topic = topic
    this.partition = partition
    this.messages = messages
    this.highWatermark = highWatermark
  }

  isEmpty(): boolean {
    return this.messages.length === 0
  }

  firstOffset(): string | null {
    return this.messages.length > 0 ? this.messages[0].offset : null
  }

  lastOffset(): string {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1].offset : '-1'
  }

  offsetLag(): string {
    const lastOffset = parseInt(this.lastOffset())
    const hwm = parseInt(this.highWatermark)
    return (hwm - lastOffset - 1).toString()
  }

  offsetLagLow(): string {
    const firstOffset = this.firstOffset()
    if (firstOffset === null) return '0'
    const hwm = parseInt(this.highWatermark)
    return (hwm - parseInt(firstOffset)).toString()
  }
}

// ============================================================================
// CONSUMER IMPLEMENTATION
// ============================================================================

class ConsumerImpl implements IConsumer {
  private _config: ExtendedKafkaConfig
  private _consumerConfig: ConsumerConfig
  private _connected = false
  private _running = false
  private _subscriptions: Set<string> = new Set()
  private _subscriptionPatterns: Set<RegExp> = new Set()
  private _fromBeginning = false
  private _paused: Map<string, Set<number>> = new Map() // topic -> partitions
  private _seekPositions: Map<string, Map<number, string>> = new Map() // topic -> partition -> offset
  private _logger: Logger
  private _eventListeners: Map<ConsumerEvents, Set<(...args: unknown[]) => void>> = new Map()
  private _memberId: string
  private _runConfig?: ConsumerRunConfig

  constructor(config: ExtendedKafkaConfig, consumerConfig: ConsumerConfig) {
    this._config = config
    this._consumerConfig = consumerConfig
    this._logger = new LoggerImpl('kafkajs.consumer', config.logLevel)
    this._memberId = `${consumerConfig.groupId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  async connect(): Promise<void> {
    this._connected = true

    // Register with consumer group
    const group = getOrCreateConsumerGroup(this._consumerConfig.groupId)
    group.members.set(this._memberId, {
      memberId: this._memberId,
      clientId: this._config.clientId ?? 'kafkajs',
      clientHost: 'localhost',
      assignment: new Map(),
    })
    group.state = 'Stable'

    this._emit('consumer.connect', {})
  }

  async disconnect(): Promise<void> {
    this._connected = false
    this._running = false

    // Unregister from consumer group
    const group = globalConsumerGroups.get(this._consumerConfig.groupId)
    if (group) {
      group.members.delete(this._memberId)
      if (group.members.size === 0) {
        group.state = 'Empty'
      }
    }

    this._emit('consumer.disconnect', {})
  }

  async subscribe(subscription: ConsumerSubscribeTopic | ConsumerSubscribeTopics): Promise<void> {
    if (!this._connected) {
      throw new KafkaJSError('Consumer is not connected')
    }

    if ('topics' in subscription) {
      this._fromBeginning = subscription.fromBeginning ?? false
      for (const topic of subscription.topics) {
        if (typeof topic === 'string') {
          this._subscriptions.add(topic)
        } else {
          this._subscriptionPatterns.add(topic)
        }
      }
    } else {
      this._fromBeginning = subscription.fromBeginning ?? false
      if (typeof subscription.topic === 'string') {
        this._subscriptions.add(subscription.topic)
      } else {
        this._subscriptionPatterns.add(subscription.topic)
      }
    }
  }

  async stop(): Promise<void> {
    this._running = false
    this._emit('consumer.stop', {})
  }

  async run(config?: ConsumerRunConfig): Promise<void> {
    if (!this._connected) {
      throw new KafkaJSError('Consumer is not connected')
    }

    this._running = true
    this._runConfig = config

    const group = getOrCreateConsumerGroup(this._consumerConfig.groupId)

    // Get all topics matching subscriptions
    const topics = this._getMatchingTopics()

    // Initialize offsets for subscribed topics
    for (const topicName of topics) {
      const topic = getTopic(topicName)
      if (!topic) continue

      if (!group.offsets.has(topicName)) {
        group.offsets.set(topicName, new Map())
      }

      const topicOffsets = group.offsets.get(topicName)!
      for (const [partition] of topic.partitions) {
        if (!topicOffsets.has(partition)) {
          topicOffsets.set(partition, this._fromBeginning ? 0 : topic.partitions.get(partition)!.highWatermark)
        }
      }
    }

    // Start consuming loop
    await this._consumeLoop(config)
  }

  private _getMatchingTopics(): string[] {
    const topics: string[] = []

    // Direct subscriptions
    for (const topic of this._subscriptions) {
      if (globalTopics.has(topic)) {
        topics.push(topic)
      }
    }

    // Pattern subscriptions
    for (const pattern of this._subscriptionPatterns) {
      for (const [topicName] of globalTopics) {
        if (pattern.test(topicName) && !topics.includes(topicName)) {
          topics.push(topicName)
        }
      }
    }

    return topics
  }

  private async _consumeLoop(config?: ConsumerRunConfig): Promise<void> {
    const group = getOrCreateConsumerGroup(this._consumerConfig.groupId)

    while (this._running) {
      const topics = this._getMatchingTopics()

      for (const topicName of topics) {
        const topic = getTopic(topicName)
        if (!topic) continue

        const topicOffsets = group.offsets.get(topicName)
        if (!topicOffsets) continue

        for (const [partition, partitionData] of topic.partitions) {
          // Check if paused
          if (this._paused.has(topicName) && this._paused.get(topicName)!.has(partition)) {
            continue
          }

          // Check for seek position
          let currentOffset = topicOffsets.get(partition) ?? 0
          const seekMap = this._seekPositions.get(topicName)
          if (seekMap && seekMap.has(partition)) {
            currentOffset = parseInt(seekMap.get(partition)!)
            seekMap.delete(partition)
            topicOffsets.set(partition, currentOffset)
          }

          const messages = partitionData.messages.slice(currentOffset)

          if (messages.length === 0) continue

          this._emit('consumer.fetch', { topic: topicName, partition, messages: messages.length })

          if (config?.eachMessage) {
            for (const message of messages) {
              const payload: EachMessagePayload = {
                topic: topicName,
                partition,
                message,
                heartbeat: async () => {
                  this._emit('consumer.heartbeat', { groupId: this._consumerConfig.groupId })
                },
                pause: () => () => this.pause([{ topic: topicName, partitions: [partition] }]),
              }

              await config.eachMessage(payload)

              // Update offset after processing
              const newOffset = parseInt(message.offset) + 1
              topicOffsets.set(partition, newOffset)
            }
          } else if (config?.eachBatch) {
            const batch = new BatchImpl(
              topicName,
              partition,
              messages,
              partitionData.highWatermark.toString()
            )

            let resolvedOffset = currentOffset

            const payload: EachBatchPayload = {
              batch,
              resolveOffset: (offset: string) => {
                resolvedOffset = parseInt(offset) + 1
              },
              heartbeat: async () => {
                this._emit('consumer.heartbeat', { groupId: this._consumerConfig.groupId })
              },
              commitOffsetsIfNecessary: async (offsets?: TopicPartitionOffsetAndMetadata[]) => {
                if (offsets) {
                  for (const { topic, partition, offset } of offsets) {
                    const topicOff = group.offsets.get(topic)
                    if (topicOff) {
                      topicOff.set(partition, parseInt(offset))
                    }
                  }
                }
              },
              uncommittedOffsets: () => {
                return [{
                  topic: topicName,
                  partition,
                  offset: resolvedOffset.toString(),
                }]
              },
              isRunning: () => this._running,
              isStale: () => false,
              pause: () => this.pause([{ topic: topicName, partitions: [partition] }]),
            }

            this._emit('consumer.start_batch_process', { topic: topicName, partition })
            await config.eachBatch(payload)
            this._emit('consumer.end_batch_process', { topic: topicName, partition })

            // Update offset after batch processing
            if (config.eachBatchAutoResolve !== false) {
              topicOffsets.set(partition, parseInt(batch.lastOffset()) + 1)
            } else {
              topicOffsets.set(partition, resolvedOffset)
            }
          }
        }
      }

      // Small delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  async commitOffsets(topicPartitions: TopicPartitionOffsetAndMetadata[]): Promise<void> {
    const group = getOrCreateConsumerGroup(this._consumerConfig.groupId)

    for (const { topic, partition, offset } of topicPartitions) {
      if (!group.offsets.has(topic)) {
        group.offsets.set(topic, new Map())
      }
      group.offsets.get(topic)!.set(partition, parseInt(offset))
    }

    this._emit('consumer.commit_offsets', { groupId: this._consumerConfig.groupId, offsets: topicPartitions })
  }

  seek(topicPartitionOffset: SeekEntry): void {
    const { topic, partition, offset } = topicPartitionOffset

    if (!this._seekPositions.has(topic)) {
      this._seekPositions.set(topic, new Map())
    }
    this._seekPositions.get(topic)!.set(partition, offset)
  }

  async describeGroup(): Promise<GroupDescription> {
    const group = globalConsumerGroups.get(this._consumerConfig.groupId)
    if (!group) {
      return {
        groupId: this._consumerConfig.groupId,
        protocolType: 'consumer',
        protocol: 'RoundRobinAssigner',
        state: 'Empty',
        members: [],
      }
    }

    const members: MemberDescription[] = []
    for (const [, member] of group.members) {
      members.push({
        memberId: member.memberId,
        clientId: member.clientId,
        clientHost: member.clientHost,
        memberMetadata: Buffer.from(''),
        memberAssignment: Buffer.from(''),
      })
    }

    return {
      groupId: group.groupId,
      protocolType: 'consumer',
      protocol: 'RoundRobinAssigner',
      state: group.state,
      members,
    }
  }

  pause(topics: { topic: string; partitions?: number[] }[]): void {
    for (const { topic, partitions } of topics) {
      const topicData = getTopic(topic)
      if (!topicData) continue

      if (!this._paused.has(topic)) {
        this._paused.set(topic, new Set())
      }

      const pausedPartitions = this._paused.get(topic)!
      if (partitions) {
        for (const p of partitions) {
          pausedPartitions.add(p)
        }
      } else {
        // Pause all partitions
        for (const [p] of topicData.partitions) {
          pausedPartitions.add(p)
        }
      }
    }
  }

  paused(): TopicPartition[] {
    const result: TopicPartition[] = []
    for (const [topic, partitions] of this._paused) {
      for (const partition of partitions) {
        result.push({ topic, partition })
      }
    }
    return result
  }

  resume(topics: { topic: string; partitions?: number[] }[]): void {
    for (const { topic, partitions } of topics) {
      const pausedPartitions = this._paused.get(topic)
      if (!pausedPartitions) continue

      if (partitions) {
        for (const p of partitions) {
          pausedPartitions.delete(p)
        }
      } else {
        this._paused.delete(topic)
      }
    }
  }

  on(event: ConsumerEvents, listener: (...args: unknown[]) => void): this {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(listener)
    return this
  }

  private _emit(event: ConsumerEvents, payload: unknown): void {
    const listeners = this._eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        listener(payload)
      }
    }
  }

  logger(): Logger {
    return this._logger
  }
}

// ============================================================================
// ADMIN IMPLEMENTATION
// ============================================================================

class AdminImpl implements IAdmin {
  private _config: ExtendedKafkaConfig
  private _connected = false
  private _logger: Logger
  private _eventListeners: Map<AdminEvents, Set<(...args: unknown[]) => void>> = new Map()

  constructor(config: ExtendedKafkaConfig, _adminConfig: AdminConfig = {}) {
    this._config = config
    this._logger = new LoggerImpl('kafkajs.admin', config.logLevel)
  }

  async connect(): Promise<void> {
    this._connected = true
    this._emit('admin.connect', {})
  }

  async disconnect(): Promise<void> {
    this._connected = false
    this._emit('admin.disconnect', {})
  }

  async listTopics(): Promise<string[]> {
    return Array.from(globalTopics.keys())
  }

  async createTopics(options: CreateTopicsOptions): Promise<boolean> {
    if (options.validateOnly) {
      // Just validate without creating
      return true
    }

    let created = false
    for (const topicConfig of options.topics) {
      if (createTopic(topicConfig)) {
        created = true
      }
    }

    return created
  }

  async deleteTopics(options: DeleteTopicsOptions): Promise<void> {
    for (const topic of options.topics) {
      globalTopics.delete(topic)

      // Clean up consumer group offsets for deleted topics
      for (const [, group] of globalConsumerGroups) {
        group.offsets.delete(topic)
      }
    }
  }

  async createPartitions(options: CreatePartitionsOptions): Promise<boolean> {
    if (options.validateOnly) {
      return true
    }

    for (const { topic, count } of options.topicPartitions) {
      const topicData = getTopic(topic)
      if (!topicData) continue

      const currentCount = topicData.partitions.size
      if (count > currentCount) {
        for (let i = currentCount; i < count; i++) {
          topicData.partitions.set(i, { messages: [], highWatermark: 0 })
        }
        topicData.numPartitions = count
      }
    }

    return true
  }

  async fetchTopicMetadata(options?: { topics?: string[] }): Promise<{ topics: TopicMetadata[] }> {
    const topics: TopicMetadata[] = []
    const topicNames = options?.topics ?? Array.from(globalTopics.keys())

    for (const name of topicNames) {
      const topic = getTopic(name)
      if (!topic) continue

      const partitions: PartitionMetadata[] = []
      for (const [partitionId] of topic.partitions) {
        partitions.push({
          partitionId,
          leader: 0,
          replicas: [0],
          isr: [0],
        })
      }

      topics.push({ name, partitions })
    }

    return { topics }
  }

  async fetchTopicOffsets(topic: string): Promise<{ partition: number; offset: string; high: string; low: string }[]> {
    const topicData = getTopic(topic)
    if (!topicData) {
      throw new KafkaJSTopicNotFound(`Topic ${topic} not found`, { topic })
    }

    const result: { partition: number; offset: string; high: string; low: string }[] = []
    for (const [partition, data] of topicData.partitions) {
      result.push({
        partition,
        offset: data.highWatermark.toString(),
        high: data.highWatermark.toString(),
        low: '0',
      })
    }

    return result
  }

  async fetchTopicOffsetsByTimestamp(
    topic: string,
    timestamp?: number
  ): Promise<{ partition: number; offset: string }[]> {
    const topicData = getTopic(topic)
    if (!topicData) {
      throw new KafkaJSTopicNotFound(`Topic ${topic} not found`, { topic })
    }

    const ts = timestamp ?? Date.now()
    const result: { partition: number; offset: string }[] = []

    for (const [partition, data] of topicData.partitions) {
      // Find first message with timestamp >= requested timestamp
      let offset = data.highWatermark.toString()
      for (let i = 0; i < data.messages.length; i++) {
        if (parseInt(data.messages[i].timestamp) >= ts) {
          offset = i.toString()
          break
        }
      }
      result.push({ partition, offset })
    }

    return result
  }

  async describeConfigs(resources: ConfigResource[]): Promise<{ resources: { configEntries: ConfigEntry[] }[] }> {
    const results: { configEntries: ConfigEntry[] }[] = []

    for (const resource of resources) {
      const configEntries: ConfigEntry[] = []

      if (resource.type === 2) { // TOPIC
        const topic = getTopic(resource.name)
        if (topic) {
          for (const [name, value] of topic.config) {
            if (!resource.configNames || resource.configNames.includes(name)) {
              configEntries.push({ configName: name, configValue: value })
            }
          }
        }
      }

      results.push({ configEntries })
    }

    return { resources: results }
  }

  async alterConfigs(resources: AlterConfigResource[]): Promise<void> {
    for (const resource of resources) {
      if (resource.type === 2) { // TOPIC
        const topic = getTopic(resource.name)
        if (topic) {
          for (const { configName, configValue } of resource.configEntries) {
            topic.config.set(configName, configValue)
          }
        }
      }
    }
  }

  async listGroups(): Promise<{ groups: { groupId: string; protocolType: string }[] }> {
    const groups: { groupId: string; protocolType: string }[] = []
    for (const [groupId] of globalConsumerGroups) {
      groups.push({ groupId, protocolType: 'consumer' })
    }
    return { groups }
  }

  async describeGroups(groupIds: string[]): Promise<{ groups: GroupDescription[] }> {
    const groups: GroupDescription[] = []

    for (const groupId of groupIds) {
      const group = globalConsumerGroups.get(groupId)
      if (!group) {
        groups.push({
          groupId,
          protocolType: 'consumer',
          protocol: '',
          state: 'Dead',
          members: [],
        })
        continue
      }

      const members: MemberDescription[] = []
      for (const [, member] of group.members) {
        members.push({
          memberId: member.memberId,
          clientId: member.clientId,
          clientHost: member.clientHost,
          memberMetadata: Buffer.from(''),
          memberAssignment: Buffer.from(''),
        })
      }

      groups.push({
        groupId: group.groupId,
        protocolType: 'consumer',
        protocol: 'RoundRobinAssigner',
        state: group.state,
        members,
      })
    }

    return { groups }
  }

  async deleteGroups(groupIds: string[]): Promise<void> {
    for (const groupId of groupIds) {
      globalConsumerGroups.delete(groupId)
    }
  }

  async resetOffsets(options: ResetOffsetsOptions): Promise<void> {
    const group = globalConsumerGroups.get(options.groupId)
    if (!group) return

    const topic = getTopic(options.topic)
    if (!topic) return

    const topicOffsets = group.offsets.get(options.topic)
    if (!topicOffsets) {
      group.offsets.set(options.topic, new Map())
    }

    const offsets = group.offsets.get(options.topic)!
    for (const [partition, data] of topic.partitions) {
      offsets.set(partition, options.earliest ? 0 : data.highWatermark)
    }
  }

  async setOffsets(options: SetOffsetsOptions): Promise<void> {
    const group = getOrCreateConsumerGroup(options.groupId)

    if (!group.offsets.has(options.topic)) {
      group.offsets.set(options.topic, new Map())
    }

    const topicOffsets = group.offsets.get(options.topic)!
    for (const { partition, offset } of options.partitions) {
      topicOffsets.set(partition, parseInt(offset))
    }
  }

  async fetchOffsets(options: FetchOffsetsOptions): Promise<{ topic: string; partitions: { partition: number; offset: string; metadata: string | null }[] }[]> {
    const group = globalConsumerGroups.get(options.groupId)
    if (!group) return []

    const result: { topic: string; partitions: { partition: number; offset: string; metadata: string | null }[] }[] = []

    const topics = options.topics ?? Array.from(group.offsets.keys())

    for (const topic of topics) {
      const topicOffsets = group.offsets.get(topic)
      if (!topicOffsets) continue

      const partitions: { partition: number; offset: string; metadata: string | null }[] = []
      for (const [partition, offset] of topicOffsets) {
        partitions.push({
          partition,
          offset: offset.toString(),
          metadata: null,
        })
      }

      result.push({ topic, partitions })
    }

    return result
  }

  async describeCluster(): Promise<Cluster> {
    return {
      brokers: [{ nodeId: 0, host: 'localhost', port: 9092 }],
      controller: 0,
      clusterId: 'dotdo-kafka-cluster',
    }
  }

  on(event: AdminEvents, listener: (...args: unknown[]) => void): this {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(listener)
    return this
  }

  private _emit(event: AdminEvents, payload: unknown): void {
    const listeners = this._eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        listener(payload)
      }
    }
  }

  logger(): Logger {
    return this._logger
  }
}

// ============================================================================
// KAFKA CLIENT IMPLEMENTATION
// ============================================================================

class KafkaImpl implements IKafka {
  private _config: ExtendedKafkaConfig
  private _logger: Logger

  constructor(config: KafkaConfig | ExtendedKafkaConfig) {
    this._config = config as ExtendedKafkaConfig
    this._logger = new LoggerImpl('kafkajs', config.logLevel)
  }

  producer(config?: ProducerConfig): IProducer {
    return new ProducerImpl(this._config, config)
  }

  consumer(config: ConsumerConfig): IConsumer {
    return new ConsumerImpl(this._config, config)
  }

  admin(config?: AdminConfig): IAdmin {
    return new AdminImpl(this._config, config)
  }

  logger(): Logger {
    return this._logger
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a new Kafka client
 */
export function createKafka(config: KafkaConfig | ExtendedKafkaConfig): IKafka {
  return new KafkaImpl(config)
}

/**
 * Kafka class (for new Kafka() syntax)
 */
export class Kafka implements IKafka {
  private _impl: KafkaImpl

  constructor(config: KafkaConfig | ExtendedKafkaConfig) {
    this._impl = new KafkaImpl(config)
  }

  producer(config?: ProducerConfig): IProducer {
    return this._impl.producer(config)
  }

  consumer(config: ConsumerConfig): IConsumer {
    return this._impl.consumer(config)
  }

  admin(config?: AdminConfig): IAdmin {
    return this._impl.admin(config)
  }

  logger(): Logger {
    return this._impl.logger()
  }
}

/**
 * Partitioners export
 */
export const Partitioners = {
  DefaultPartitioner: defaultPartitioner,
  JavaCompatiblePartitioner: defaultPartitioner,
  LegacyPartitioner: defaultPartitioner,
}

/**
 * Clear all in-memory data (for testing)
 */
export function _clearAll(): void {
  globalTopics.clear()
  globalConsumerGroups.clear()
}
