/**
 * Kafka Consumer - Message consumption with consumer groups
 *
 * Backed by unified primitives:
 * - ExactlyOnceContext for exactly-once processing
 * - WindowManager for batch windowing
 */

import { createExactlyOnceContext } from '../../primitives'
import { KafkaAdmin } from './admin'
import {
  type ConsumerConfig,
  type ConsumerSubscription,
  type ConsumerAssignment,
  type ConsumedMessage,
  type TopicPartition,
  type TopicPartitionOffset,
  type EachMessagePayload,
  type EachBatchPayload,
  type MessageBatch,
  type ConsumerGroupMember,
  type SeekTarget,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Extended consumer config with admin reference
 */
export interface ExtendedConsumerConfig extends ConsumerConfig {
  /** Admin client for topic management */
  admin: KafkaAdmin
}

/**
 * Internal partition state for tracking consumption
 */
interface PartitionConsumerState {
  topic: string
  partition: number
  currentOffset: bigint
  paused: boolean
  highWatermark: bigint
}

/**
 * Kafka-compatible consumer
 */
export class Consumer {
  private config: ExtendedConsumerConfig
  private connected: boolean = false
  private running: boolean = false
  private memberId: string | null = null
  private generationId: number = 0
  private subscribedTopics: string[] = []
  private assignments: ConsumerAssignment[] = []
  private partitionStates: Map<string, PartitionConsumerState> = new Map()
  private pausedPartitions: Set<string> = new Set()
  private lastCommittedOffsets: Map<string, string> = new Map()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private autoCommitTimer: ReturnType<typeof setInterval> | null = null
  private exactlyOnceContext = createExactlyOnceContext()
  private fromBeginning: boolean = false

  constructor(config: ExtendedConsumerConfig) {
    if (!config.groupId || config.groupId.trim() === '') {
      throw new KafkaError('Consumer groupId is required', KafkaErrorCode.INVALID_TOPIC)
    }

    this.config = {
      sessionTimeoutMs: 30000,
      heartbeatIntervalMs: 3000,
      autoCommit: true,
      autoCommitIntervalMs: 5000,
      autoOffsetReset: 'latest',
      maxPollRecords: 100,
      readUncommitted: false,
      ...config,
    }
  }

  /**
   * Connect the consumer
   */
  async connect(): Promise<void> {
    if (this.connected) return

    // Register with consumer group
    const group = this.config.admin.getOrCreateGroup(this.config.groupId)
    this.memberId = `consumer-${crypto.randomUUID()}`

    this.connected = true
  }

  /**
   * Disconnect the consumer
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return

    await this.stop()

    // Leave consumer group
    if (this.memberId) {
      const group = this.config.admin.getGroup(this.config.groupId)
      if (group) {
        group.members.delete(this.memberId)
        if (group.members.size === 0) {
          group.state = 'Empty'
        }
      }
    }

    this.connected = false
    this.memberId = null
    this.generationId = 0
    this.assignments = []
    this.partitionStates.clear()
    this.pausedPartitions.clear()
    this.lastCommittedOffsets.clear()
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Subscribe to topics
   */
  async subscribe(subscription: ConsumerSubscription): Promise<void> {
    this.ensureConnected()

    this.subscribedTopics = subscription.topics
    this.fromBeginning = subscription.fromBeginning ?? false

    // Join consumer group and get assignments
    await this.joinGroup()
  }

  /**
   * Get current subscription
   */
  subscription(): string[] {
    return [...this.subscribedTopics]
  }

  /**
   * Get current assignment
   */
  assignment(): ConsumerAssignment[] {
    return [...this.assignments]
  }

  /**
   * Join the consumer group
   */
  private async joinGroup(): Promise<void> {
    const group = this.config.admin.getOrCreateGroup(this.config.groupId)

    // Register as member
    const member: ConsumerGroupMember = {
      memberId: this.memberId!,
      clientId: `client-${this.memberId}`,
      subscriptions: this.subscribedTopics,
      assignment: new Map(),
      lastHeartbeat: Date.now(),
    }

    group.members.set(this.memberId!, member)
    group.generationId++
    this.generationId = group.generationId

    // Set leader if first member
    if (group.members.size === 1) {
      group.leaderId = this.memberId
    }

    // Compute assignments (simple range assignment)
    await this.computeAssignments()

    group.state = 'Stable'

    // Initialize partition states
    await this.initializePartitionStates()
  }

  /**
   * Compute partition assignments
   */
  private async computeAssignments(): Promise<void> {
    const group = this.config.admin.getGroup(this.config.groupId)!
    const members = Array.from(group.members.values())

    // Collect all partitions for subscribed topics
    const allPartitions: TopicPartition[] = []

    for (const topic of this.subscribedTopics) {
      const topicState = this.config.admin.getTopic(topic)
      if (!topicState) continue

      for (let p = 0; p < topicState.config.partitions; p++) {
        allPartitions.push({ topic, partition: p })
      }
    }

    // Find my index in members array
    const myIndex = members.findIndex((m) => m.memberId === this.memberId)
    const memberCount = members.length

    // Simple range assignment
    this.assignments = []
    const assignmentMap = new Map<string, number[]>()

    for (let i = 0; i < allPartitions.length; i++) {
      const assignedMemberIndex = i % memberCount

      if (assignedMemberIndex === myIndex) {
        const tp = allPartitions[i]
        if (tp) {
          const partitions = assignmentMap.get(tp.topic) || []
          partitions.push(tp.partition)
          assignmentMap.set(tp.topic, partitions)
        }
      }
    }

    for (const [topic, partitions] of assignmentMap) {
      this.assignments.push({ topic, partitions })
    }

    // Update member assignment
    const member = group.members.get(this.memberId!)
    if (member) {
      member.assignment = assignmentMap
    }
  }

  /**
   * Initialize partition states from assignments
   */
  private async initializePartitionStates(): Promise<void> {
    this.partitionStates.clear()

    // Fetch committed offsets
    const offsets = await this.config.admin.fetchOffsets({
      groupId: this.config.groupId,
      topics: this.subscribedTopics,
    })

    const committedMap = new Map<string, string>()
    for (const o of offsets) {
      committedMap.set(`${o.topic}-${o.partition}`, o.offset)
    }

    for (const { topic, partitions } of this.assignments) {
      for (const partition of partitions) {
        const key = `${topic}-${partition}`
        const topicState = this.config.admin.getTopic(topic)
        const partitionState = topicState?.partitions.get(partition)

        if (!partitionState) continue

        const committed = committedMap.get(key)
        let startOffset: bigint

        if (committed && committed !== '-1') {
          // Start from next offset after committed
          startOffset = BigInt(committed) + 1n
        } else if (this.fromBeginning || this.config.autoOffsetReset === 'earliest') {
          startOffset = partitionState.logStartOffset
        } else {
          startOffset = partitionState.highWatermark
        }

        this.partitionStates.set(key, {
          topic,
          partition,
          currentOffset: startOffset,
          paused: false,
          highWatermark: partitionState.highWatermark,
        })
      }
    }
  }

  /**
   * Poll for messages
   */
  async poll(options: { maxRecords?: number; timeoutMs?: number } = {}): Promise<ConsumedMessage[]> {
    this.ensureConnected()

    const maxRecords = options.maxRecords ?? this.config.maxPollRecords ?? 100
    const messages: ConsumedMessage[] = []

    for (const [key, state] of this.partitionStates) {
      if (state.paused) continue
      if (messages.length >= maxRecords) break

      const topicState = this.config.admin.getTopic(state.topic)
      const partitionState = topicState?.partitions.get(state.partition)

      if (!partitionState) continue

      // Update high watermark
      state.highWatermark = partitionState.highWatermark

      // Fetch messages
      const remaining = maxRecords - messages.length
      let fetched = 0

      for (const stored of partitionState.messages) {
        if (fetched >= remaining) break

        const storedOffset = BigInt(stored.offset)
        if (storedOffset < state.currentOffset) continue
        if (storedOffset >= state.highWatermark) break

        messages.push({
          topic: state.topic,
          partition: state.partition,
          offset: stored.offset,
          key: stored.key,
          value: stored.value,
          timestamp: stored.timestamp,
          headers: stored.headers,
        })

        state.currentOffset = storedOffset + 1n
        fetched++
      }
    }

    return messages
  }

  /**
   * Run the consumer with handlers
   */
  async run(options: {
    eachMessage?: (payload: EachMessagePayload) => Promise<void>
    eachBatch?: (payload: EachBatchPayload) => Promise<void>
    autoCommit?: boolean
    autoCommitIntervalMs?: number
  }): Promise<void> {
    this.ensureConnected()

    if (this.running) {
      throw new KafkaError('Consumer is already running', KafkaErrorCode.INVALID_TOPIC)
    }

    this.running = true

    const autoCommit = options.autoCommit ?? this.config.autoCommit ?? true
    const autoCommitIntervalMs = options.autoCommitIntervalMs ?? this.config.autoCommitIntervalMs ?? 5000

    // Start heartbeat
    this.startHeartbeat()

    // Start auto-commit if enabled
    if (autoCommit) {
      this.startAutoCommit(autoCommitIntervalMs)
    }

    try {
      while (this.running) {
        const messages = await this.poll()

        if (messages.length === 0) {
          await new Promise((r) => setTimeout(r, 50))
          continue
        }

        if (options.eachBatch) {
          // Group by partition
          const partitionBatches = new Map<string, ConsumedMessage[]>()
          for (const msg of messages) {
            const key = `${msg.topic}-${msg.partition}`
            const batch = partitionBatches.get(key) || []
            batch.push(msg)
            partitionBatches.set(key, batch)
          }

          for (const [key, batchMessages] of partitionBatches) {
            const state = this.partitionStates.get(key)!
            const batch = this.createBatch(batchMessages, state.highWatermark.toString())

            await options.eachBatch({
              batch,
              resolveOffset: (offset: string) => {
                state.currentOffset = BigInt(offset) + 1n
              },
              heartbeat: () => this.sendHeartbeat(),
              commitOffsetsIfNecessary: () => this.commitOffsetsIfNecessary(),
              uncommittedOffsets: () => this.getUncommittedOffsets(),
              isRunning: () => this.running,
            })
          }
        } else if (options.eachMessage) {
          for (const message of messages) {
            if (!this.running) break

            await options.eachMessage({
              topic: message.topic,
              partition: message.partition,
              message,
              heartbeat: () => this.sendHeartbeat(),
            })
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

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running
  }

  // ===========================================================================
  // Offset Management
  // ===========================================================================

  /**
   * Commit offsets
   */
  async commitOffsets(offsets?: TopicPartitionOffset[]): Promise<void> {
    this.ensureConnected()

    const toCommit = offsets || this.getCurrentOffsets()

    if (toCommit.length === 0) return

    await this.config.admin.commitOffsets(this.config.groupId, toCommit)

    // Update last committed
    for (const o of toCommit) {
      this.lastCommittedOffsets.set(`${o.topic}-${o.partition}`, o.offset)
    }
  }

  /**
   * Get current offsets
   */
  private getCurrentOffsets(): TopicPartitionOffset[] {
    const offsets: TopicPartitionOffset[] = []

    for (const [key, state] of this.partitionStates) {
      const commitOffset = state.currentOffset - 1n
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
      const currentOffset = state.currentOffset - 1n
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
   * Commit offsets if auto-commit enabled
   */
  private async commitOffsetsIfNecessary(): Promise<void> {
    if (this.config.autoCommit) {
      await this.commitOffsets()
    }
  }

  /**
   * Get committed offsets for partitions
   */
  async committed(partitions: TopicPartition[]): Promise<TopicPartitionOffset[]> {
    this.ensureConnected()

    const topics = [...new Set(partitions.map((p) => p.topic))]
    const allOffsets = await this.config.admin.fetchOffsets({
      groupId: this.config.groupId,
      topics,
    })

    return allOffsets.filter((o) =>
      partitions.some((p) => p.topic === o.topic && p.partition === o.partition)
    )
  }

  // ===========================================================================
  // Seek
  // ===========================================================================

  /**
   * Seek to specific offset
   */
  seek(target: { topic: string; partition: number; offset: string }): void {
    this.ensureConnected()

    const key = `${target.topic}-${target.partition}`
    const state = this.partitionStates.get(key)

    if (!state) {
      throw new KafkaError(
        `Not assigned to partition ${key}`,
        KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
      )
    }

    state.currentOffset = BigInt(target.offset)
  }

  /**
   * Seek to beginning
   */
  async seekToBeginning(partitions?: TopicPartition[]): Promise<void> {
    this.ensureConnected()

    const targets = partitions || this.getAssignedPartitions()

    for (const { topic, partition } of targets) {
      const key = `${topic}-${partition}`
      const state = this.partitionStates.get(key)
      if (!state) continue

      const topicState = this.config.admin.getTopic(topic)
      const partitionState = topicState?.partitions.get(partition)
      if (partitionState) {
        state.currentOffset = partitionState.logStartOffset
      }
    }
  }

  /**
   * Seek to end
   */
  async seekToEnd(partitions?: TopicPartition[]): Promise<void> {
    this.ensureConnected()

    const targets = partitions || this.getAssignedPartitions()

    for (const { topic, partition } of targets) {
      const key = `${topic}-${partition}`
      const state = this.partitionStates.get(key)
      if (!state) continue

      const topicState = this.config.admin.getTopic(topic)
      const partitionState = topicState?.partitions.get(partition)
      if (partitionState) {
        state.currentOffset = partitionState.highWatermark
      }
    }
  }

  /**
   * Get assigned partitions
   */
  private getAssignedPartitions(): TopicPartition[] {
    const partitions: TopicPartition[] = []
    for (const state of this.partitionStates.values()) {
      partitions.push({ topic: state.topic, partition: state.partition })
    }
    return partitions
  }

  // ===========================================================================
  // Pause/Resume
  // ===========================================================================

  /**
   * Pause partitions
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
   * Resume partitions
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
        // Handle rebalance
        if (error instanceof KafkaError && error.code === KafkaErrorCode.REBALANCE_IN_PROGRESS) {
          await this.joinGroup()
        }
      }
    }, this.config.heartbeatIntervalMs ?? 3000)
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
   * Send heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.memberId) return

    const group = this.config.admin.getGroup(this.config.groupId)
    if (!group) return

    const member = group.members.get(this.memberId)
    if (member) {
      member.lastHeartbeat = Date.now()
    }
  }

  /**
   * Start auto-commit timer
   */
  private startAutoCommit(intervalMs: number): void {
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
    }, intervalMs)
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
   * Create a batch object
   */
  private createBatch(messages: ConsumedMessage[], highWatermark: string): MessageBatch {
    const firstMsg = messages[0]
    const lastMsg = messages[messages.length - 1]
    return {
      topic: firstMsg?.topic ?? '',
      partition: firstMsg?.partition ?? 0,
      messages,
      highWatermark,
      isEmpty: () => messages.length === 0,
      firstOffset: () => (firstMsg ? firstMsg.offset : null),
      lastOffset: () => (lastMsg ? lastMsg.offset : null),
    }
  }

  /**
   * Ensure connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new KafkaError('Consumer is not connected', KafkaErrorCode.NOT_COORDINATOR)
    }
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
 * Create a new consumer
 */
export function createConsumer(config: ExtendedConsumerConfig): Consumer {
  return new Consumer(config)
}
