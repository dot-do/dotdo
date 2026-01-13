/**
 * Kafka-compatible Consumer Client
 *
 * Features:
 * - Subscribe to topics with pattern matching
 * - Poll for messages with configurable batching
 * - Manual and automatic offset commits
 * - Consumer group coordination with rebalancing
 * - Seek to specific offsets
 * - Pause and resume partitions
 */

import {
  type ConsumerConfig,
  type ConsumerSubscription,
  type ConsumerAssignment,
  type TopicPartitionOffset,
  type TopicMessage,
  type EachMessagePayload,
  type EachBatchPayload,
  type Batch,
  type OffsetAndMetadata,
  KafkaError,
  ErrorCode,
} from './types'
import type { KafkaDO } from './KafkaDO'
import type { TopicDO } from './TopicDO'
import type { ConsumerGroupDO } from './ConsumerGroupDO'

interface PartitionState {
  topic: string
  partition: number
  currentOffset: string
  paused: boolean
  highWatermark: string
}

/**
 * Consumer client for Kafka-compatible message consumption
 */
export class Consumer {
  private connected = false
  private running = false
  private memberId: string | null = null
  private generationId = 0
  private subscriptions: string[] = []
  private assignments: ConsumerAssignment[] = []
  private partitionStates = new Map<string, PartitionState>()
  private pausedPartitions = new Set<string>()

  // Configuration with defaults
  private sessionTimeout: number
  private heartbeatInterval: number
  private maxPollRecords: number
  private maxWaitMs: number
  private fromBeginning: boolean
  private autoCommit: boolean
  private autoCommitInterval: number
  private isolationLevel: 'read_uncommitted' | 'read_committed'

  // DO stubs (set by connect)
  private kafkaDO!: KafkaDO
  private getTopicDO!: (topicPartition: string) => TopicDO
  private consumerGroupDO!: ConsumerGroupDO

  // Internal state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private autoCommitTimer: ReturnType<typeof setInterval> | null = null
  private lastCommittedOffsets = new Map<string, string>()

  constructor(private config: ConsumerConfig) {
    if (!config.groupId) {
      throw new KafkaError('Consumer groupId is required', ErrorCode.INVALID_GROUP_ID)
    }

    // Apply defaults
    this.sessionTimeout = config.sessionTimeout ?? 30000
    this.heartbeatInterval = config.heartbeatInterval ?? 3000
    this.maxPollRecords = config.maxBytesPerPartition ? Math.floor(config.maxBytesPerPartition / 1000) : 100
    this.maxWaitMs = config.maxWaitTimeInMs ?? 5000
    this.fromBeginning = false
    this.autoCommit = true
    this.autoCommitInterval = 5000
    this.isolationLevel = config.readUncommitted ? 'read_uncommitted' : 'read_committed'
  }

  /**
   * Connect to the Kafka cluster
   */
  async connect(
    kafkaDO: KafkaDO,
    getTopicDO: (topicPartition: string) => TopicDO,
    consumerGroupDO: ConsumerGroupDO
  ): Promise<void> {
    if (this.connected) return

    this.kafkaDO = kafkaDO
    this.getTopicDO = getTopicDO
    this.consumerGroupDO = consumerGroupDO

    await this.consumerGroupDO.initialize(this.config.groupId)
    this.connected = true
  }

  /**
   * Disconnect from the cluster
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return

    await this.stop()

    // Leave the consumer group
    if (this.memberId) {
      try {
        await this.consumerGroupDO.leaveGroup(this.memberId)
      } catch {
        // Ignore errors during disconnect
      }
    }

    this.connected = false
    this.memberId = null
    this.generationId = 0
    this.assignments = []
    this.partitionStates.clear()
  }

  /**
   * Subscribe to topics
   */
  async subscribe(subscription: ConsumerSubscription): Promise<void> {
    this.ensureConnected()

    this.subscriptions = subscription.topics
    this.fromBeginning = subscription.fromBeginning ?? false

    // Join the consumer group
    await this.joinGroup()
  }

  /**
   * Join the consumer group and get assignments
   */
  private async joinGroup(): Promise<void> {
    const clientId = `consumer-${crypto.randomUUID().slice(0, 8)}`
    const clientHost = 'localhost'

    // Join group
    const joinResult = await this.consumerGroupDO.joinGroup(
      this.memberId,
      clientId,
      clientHost,
      this.sessionTimeout,
      this.config.rebalanceTimeout ?? 60000,
      this.subscriptions
    )

    this.memberId = joinResult.memberId
    this.generationId = joinResult.generationId

    // If we're the leader, compute assignments
    if (this.memberId === joinResult.leaderId) {
      const assignments = await this.computeAssignments(joinResult.members)

      // Sync group with assignments
      const syncResult = await this.consumerGroupDO.syncGroup(this.memberId, this.generationId, assignments)
      this.assignments = syncResult.assignment
    } else {
      // Not the leader, just sync to get our assignment
      const syncResult = await this.consumerGroupDO.syncGroup(this.memberId, this.generationId, new Map())
      this.assignments = syncResult.assignment
    }

    // Initialize partition states
    await this.initializePartitionStates()
  }

  /**
   * Compute partition assignments for all members
   */
  private async computeAssignments(
    members: Array<{ memberId: string; subscriptions: string[] }>
  ): Promise<Map<string, ConsumerAssignment[]>> {
    // Get partition counts for all subscribed topics
    const allTopics = new Set<string>()
    for (const { subscriptions } of members) {
      for (const topic of subscriptions) {
        allTopics.add(topic)
      }
    }

    const topicPartitions = new Map<string, number>()
    for (const topic of allTopics) {
      try {
        const count = await this.kafkaDO.getPartitionCount(topic)
        topicPartitions.set(topic, count)
      } catch {
        // Topic doesn't exist yet, skip
      }
    }

    // Use consumer group's assignment logic
    return this.consumerGroupDO.performAssignment(members, topicPartitions, 'range')
  }

  /**
   * Initialize partition states from assignments
   */
  private async initializePartitionStates(): Promise<void> {
    this.partitionStates.clear()

    // Fetch committed offsets
    const topics = this.assignments.map((a) => ({
      topic: a.topic,
      partitions: a.partitions,
    }))
    const committedOffsets = await this.consumerGroupDO.fetchOffsets(topics)

    for (const { topic, partitions } of this.assignments) {
      for (const partition of partitions) {
        const key = `${topic}-${partition}`
        const topicDO = this.getTopicDO(key)
        await topicDO.initialize(key)

        // Get committed offset for this partition
        const committed = committedOffsets.find((o) => o.topic === topic && o.partition === partition)

        let startOffset: string
        if (committed && committed.offset !== '-1') {
          // Start from next offset after committed
          startOffset = (BigInt(committed.offset) + 1n).toString()
        } else if (this.fromBeginning) {
          startOffset = await topicDO.getLogStartOffset()
        } else {
          startOffset = await topicDO.getHighWatermark()
        }

        const hwm = await topicDO.getHighWatermark()

        this.partitionStates.set(key, {
          topic,
          partition,
          currentOffset: startOffset,
          paused: false,
          highWatermark: hwm,
        })
      }
    }
  }

  /**
   * Poll for messages
   */
  async poll(options: { maxRecords?: number; maxWaitMs?: number } = {}): Promise<TopicMessage[]> {
    this.ensureConnected()

    const maxRecords = options.maxRecords ?? this.maxPollRecords
    const messages: TopicMessage[] = []

    for (const [key, state] of this.partitionStates) {
      if (state.paused) continue
      if (messages.length >= maxRecords) break

      const topicDO = this.getTopicDO(key)
      const remaining = maxRecords - messages.length

      try {
        const result = await topicDO.fetch(state.currentOffset, {
          maxMessages: remaining,
          isolationLevel: this.isolationLevel,
        })

        if (result.messages.length > 0) {
          messages.push(...result.messages)

          // Update current offset
          const lastOffset = result.messages[result.messages.length - 1].offset
          state.currentOffset = (BigInt(lastOffset) + 1n).toString()
        }

        // Update high watermark
        state.highWatermark = result.highWatermark
      } catch (error) {
        if (error instanceof KafkaError && error.code === ErrorCode.OFFSET_OUT_OF_RANGE) {
          // Reset to high watermark
          state.currentOffset = await topicDO.getHighWatermark()
        } else {
          throw error
        }
      }
    }

    return messages
  }

  /**
   * Run the consumer with message handler
   */
  async run(options: {
    eachMessage?: (payload: EachMessagePayload) => Promise<void>
    eachBatch?: (payload: EachBatchPayload) => Promise<void>
    autoCommit?: boolean
    autoCommitInterval?: number
  }): Promise<void> {
    this.ensureConnected()

    if (this.running) {
      throw new KafkaError('Consumer is already running', ErrorCode.INVALID_REQUEST)
    }

    this.running = true
    this.autoCommit = options.autoCommit ?? true
    this.autoCommitInterval = options.autoCommitInterval ?? 5000

    // Start heartbeat
    this.startHeartbeat()

    // Start auto-commit if enabled
    if (this.autoCommit) {
      this.startAutoCommit()
    }

    try {
      while (this.running) {
        const messages = await this.poll()

        if (messages.length === 0) {
          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }

        if (options.eachBatch) {
          // Group messages by partition for batch processing
          const partitionBatches = new Map<string, TopicMessage[]>()
          for (const msg of messages) {
            const key = `${msg.topic}-${msg.partition}`
            const batch = partitionBatches.get(key) || []
            batch.push(msg)
            partitionBatches.set(key, batch)
          }

          for (const [key, batchMessages] of partitionBatches) {
            const state = this.partitionStates.get(key)!
            const batch = this.createBatch(batchMessages, state.highWatermark)

            await options.eachBatch({
              batch,
              resolveOffset: (offset: string) => {
                state.currentOffset = (BigInt(offset) + 1n).toString()
              },
              heartbeat: () => this.sendHeartbeat(),
              commitOffsetsIfNecessary: (offsets) => this.commitOffsetsIfNecessary(offsets),
              uncommittedOffsets: () => this.getUncommittedOffsets(),
              isRunning: () => this.running,
              isStale: () => false,
            })
          }
        } else if (options.eachMessage) {
          for (const message of messages) {
            if (!this.running) break

            const key = `${message.topic}-${message.partition}`
            const state = this.partitionStates.get(key)

            await options.eachMessage({
              topic: message.topic,
              partition: message.partition,
              message,
              heartbeat: () => this.sendHeartbeat(),
              pause: () => () => this.resume([{ topic: message.topic, partitions: [message.partition] }]),
            })

            // Update state after processing
            if (state) {
              state.currentOffset = (BigInt(message.offset) + 1n).toString()
            }
          }
        }
      }
    } finally {
      this.stopHeartbeat()
      this.stopAutoCommit()
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    this.running = false
    this.stopHeartbeat()
    this.stopAutoCommit()
  }

  // ===========================================================================
  // Offset Management
  // ===========================================================================

  /**
   * Commit offsets
   */
  async commitOffsets(offsets?: TopicPartitionOffset[]): Promise<void> {
    this.ensureConnected()

    if (!this.memberId) {
      throw new KafkaError('Not a member of consumer group', ErrorCode.UNKNOWN_MEMBER_ID)
    }

    const toCommit = offsets || this.getCurrentOffsets()

    if (toCommit.length === 0) return

    const results = await this.consumerGroupDO.commitOffsets(this.memberId, this.generationId, toCommit)

    // Check for errors
    for (const [key, errorCode] of results) {
      if (errorCode !== 0) {
        throw new KafkaError(`Failed to commit offset for ${key}`, errorCode as ErrorCode)
      }
    }

    // Update last committed offsets
    for (const offset of toCommit) {
      const key = `${offset.topic}-${offset.partition}`
      this.lastCommittedOffsets.set(key, offset.offset)
    }
  }

  /**
   * Get current offsets (positions)
   */
  getCurrentOffsets(): TopicPartitionOffset[] {
    const offsets: TopicPartitionOffset[] = []

    for (const [key, state] of this.partitionStates) {
      // Commit offset is one less than current (the last processed offset)
      const commitOffset = BigInt(state.currentOffset) - 1n
      if (commitOffset >= 0n) {
        offsets.push({
          topic: state.topic,
          partition: state.partition,
          offset: commitOffset.toString(),
        })
      }
    }

    return offsets
  }

  /**
   * Get uncommitted offsets
   */
  getUncommittedOffsets(): TopicPartitionOffset[] {
    const uncommitted: TopicPartitionOffset[] = []

    for (const [key, state] of this.partitionStates) {
      const currentOffset = BigInt(state.currentOffset) - 1n
      const lastCommitted = this.lastCommittedOffsets.get(key)

      if (currentOffset >= 0n && (!lastCommitted || BigInt(lastCommitted) < currentOffset)) {
        uncommitted.push({
          topic: state.topic,
          partition: state.partition,
          offset: currentOffset.toString(),
        })
      }
    }

    return uncommitted
  }

  /**
   * Commit offsets if auto-commit is enabled
   */
  private async commitOffsetsIfNecessary(offsets?: TopicPartitionOffset[]): Promise<void> {
    if (this.autoCommit) {
      await this.commitOffsets(offsets)
    }
  }

  /**
   * Seek to specific offset
   */
  async seek(topicPartition: { topic: string; partition: number; offset: string }): Promise<void> {
    this.ensureConnected()

    const key = `${topicPartition.topic}-${topicPartition.partition}`
    const state = this.partitionStates.get(key)

    if (!state) {
      throw new KafkaError(`Not assigned to partition ${key}`, ErrorCode.UNKNOWN_TOPIC_OR_PARTITION)
    }

    state.currentOffset = topicPartition.offset
  }

  /**
   * Seek to beginning of partitions
   */
  async seekToBeginning(partitions?: { topic: string; partition: number }[]): Promise<void> {
    this.ensureConnected()

    const targets = partitions || [...this.partitionStates.values()].map((s) => ({ topic: s.topic, partition: s.partition }))

    for (const { topic, partition } of targets) {
      const key = `${topic}-${partition}`
      const state = this.partitionStates.get(key)
      if (!state) continue

      const topicDO = this.getTopicDO(key)
      state.currentOffset = await topicDO.getLogStartOffset()
    }
  }

  /**
   * Seek to end of partitions
   */
  async seekToEnd(partitions?: { topic: string; partition: number }[]): Promise<void> {
    this.ensureConnected()

    const targets = partitions || [...this.partitionStates.values()].map((s) => ({ topic: s.topic, partition: s.partition }))

    for (const { topic, partition } of targets) {
      const key = `${topic}-${partition}`
      const state = this.partitionStates.get(key)
      if (!state) continue

      const topicDO = this.getTopicDO(key)
      state.currentOffset = await topicDO.getHighWatermark()
    }
  }

  // ===========================================================================
  // Pause/Resume
  // ===========================================================================

  /**
   * Pause consumption from partitions
   */
  pause(partitions: { topic: string; partitions: number[] }[]): void {
    for (const { topic, partitions: parts } of partitions) {
      for (const partition of parts) {
        const key = `${topic}-${partition}`
        const state = this.partitionStates.get(key)
        if (state) {
          state.paused = true
          this.pausedPartitions.add(key)
        }
      }
    }
  }

  /**
   * Resume consumption from partitions
   */
  resume(partitions: { topic: string; partitions: number[] }[]): void {
    for (const { topic, partitions: parts } of partitions) {
      for (const partition of parts) {
        const key = `${topic}-${partition}`
        const state = this.partitionStates.get(key)
        if (state) {
          state.paused = false
          this.pausedPartitions.delete(key)
        }
      }
    }
  }

  /**
   * Get paused partitions
   */
  paused(): { topic: string; partitions: number[] }[] {
    const byTopic = new Map<string, number[]>()

    for (const key of this.pausedPartitions) {
      const state = this.partitionStates.get(key)
      if (state) {
        const parts = byTopic.get(state.topic) || []
        parts.push(state.partition)
        byTopic.set(state.topic, parts)
      }
    }

    return [...byTopic.entries()].map(([topic, partitions]) => ({ topic, partitions }))
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.sendHeartbeat()
      } catch (error) {
        if (error instanceof KafkaError && error.code === ErrorCode.REBALANCE_IN_PROGRESS) {
          // Rejoin group
          await this.joinGroup()
        }
      }
    }, this.heartbeatInterval)
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Send heartbeat to coordinator
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.memberId) return

    const result = await this.consumerGroupDO.heartbeat(this.memberId, this.generationId)

    if (result.errorCode === ErrorCode.REBALANCE_IN_PROGRESS) {
      throw new KafkaError('Rebalance in progress', ErrorCode.REBALANCE_IN_PROGRESS, true)
    }

    if (result.errorCode !== 0) {
      throw new KafkaError('Heartbeat failed', result.errorCode as ErrorCode)
    }
  }

  /**
   * Start auto-commit timer
   */
  private startAutoCommit(): void {
    if (this.autoCommitTimer) return

    this.autoCommitTimer = setInterval(async () => {
      try {
        const uncommitted = this.getUncommittedOffsets()
        if (uncommitted.length > 0) {
          await this.commitOffsets(uncommitted)
        }
      } catch {
        // Ignore auto-commit errors
      }
    }, this.autoCommitInterval)
  }

  /**
   * Stop auto-commit timer
   */
  private stopAutoCommit(): void {
    if (this.autoCommitTimer) {
      clearInterval(this.autoCommitTimer)
      this.autoCommitTimer = null
    }
  }

  /**
   * Create a batch object for eachBatch handler
   */
  private createBatch(messages: TopicMessage[], highWatermark: string): Batch {
    return {
      topic: messages[0]?.topic || '',
      partition: messages[0]?.partition || 0,
      highWatermark,
      messages,
      isEmpty: () => messages.length === 0,
      firstOffset: () => (messages.length > 0 ? messages[0].offset : null),
      lastOffset: () => (messages.length > 0 ? messages[messages.length - 1].offset : '0'),
      offsetLag: () => {
        if (messages.length === 0) return '0'
        const lastOffset = BigInt(messages[messages.length - 1].offset)
        const hwm = BigInt(highWatermark)
        return (hwm - lastOffset - 1n).toString()
      },
      offsetLagLow: () => {
        if (messages.length === 0) return '0'
        const firstOffset = BigInt(messages[0].offset)
        const hwm = BigInt(highWatermark)
        return (hwm - firstOffset).toString()
      },
    }
  }

  /**
   * Ensure consumer is connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new KafkaError('Consumer is not connected', ErrorCode.NETWORK_EXCEPTION)
    }
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  /**
   * Get current assignments
   */
  getAssignments(): ConsumerAssignment[] {
    return [...this.assignments]
  }

  /**
   * Get subscribed topics
   */
  getSubscriptions(): string[] {
    return [...this.subscriptions]
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get group ID
   */
  getGroupId(): string {
    return this.config.groupId
  }

  /**
   * Get member ID
   */
  getMemberId(): string | null {
    return this.memberId
  }
}

/**
 * Create a new consumer instance
 */
export function createConsumer(config: ConsumerConfig): Consumer {
  return new Consumer(config)
}
