/**
 * Kafka Consumer - Message consumption with consumer groups
 *
 * Provides Kafka-compatible consumer API with in-memory backend.
 */

import {
  getTopic,
  getMessages,
  getOrCreateGroup,
  getGroup,
  commitOffset,
  getCommittedOffset,
  getPartitionState,
} from './backends/memory'
import { KafkaAdmin } from './admin'
import {
  type ConsumerConfig,
  type ConsumerSubscription,
  type ConsumerRunConfig,
  type ConsumedMessage,
  type TopicPartition,
  type TopicPartitionOffset,
  type MessageBatch,
  type EachMessagePayload,
  type EachBatchPayload,
  type ConsumerGroupMember,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Extended consumer config with admin reference
 */
export interface ExtendedConsumerConfig extends ConsumerConfig {
  /** Admin client for topic management */
  admin?: KafkaAdmin
}

/**
 * Consumer interface
 */
export interface Consumer {
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(subscription: ConsumerSubscription): Promise<void>
  subscription(): string[]
  run(config?: ConsumerRunConfig): Promise<void>
  stop(): Promise<void>
  commitOffsets(offsets: TopicPartitionOffset[]): Promise<void>
  committed(partitions: TopicPartition[]): Promise<TopicPartitionOffset[]>
  seek(target: { topic: string; partition: number; offset: string }): void
  pause(partitions: Array<{ topic: string; partitions: number[] }>): void
  resume(partitions: Array<{ topic: string; partitions: number[] }>): void
  paused(): Array<{ topic: string; partitions: number[] }>
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
 * Kafka Consumer implementation
 */
export class KafkaConsumer implements Consumer {
  private config: ExtendedConsumerConfig
  private connected = false
  private running = false
  private memberId: string | null = null
  private subscribedTopics: string[] = []
  private fromBeginning = false
  private partitionStates: Map<string, PartitionConsumerState> = new Map()
  private pausedPartitions: Set<string> = new Set()
  private lastCommittedOffsets: Map<string, string> = new Map()
  private admin: KafkaAdmin

  constructor(config: ExtendedConsumerConfig) {
    if (!config.groupId || config.groupId.trim() === '') {
      throw new KafkaError('Consumer groupId is required', KafkaErrorCode.INVALID_GROUP_ID)
    }

    this.config = {
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      ...config,
    }
    this.admin = config.admin ?? new KafkaAdmin()
  }

  /**
   * Connect the consumer
   */
  async connect(): Promise<void> {
    if (this.connected) return

    this.memberId = `consumer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
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
      const group = getGroup(this.config.groupId)
      if (group) {
        group.members.delete(this.memberId)
        if (group.members.size === 0) {
          group.state = 'Empty'
        }
      }
    }

    this.connected = false
    this.memberId = null
    this.subscribedTopics = []
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

    this.subscribedTopics = [...subscription.topics]
    this.fromBeginning = subscription.fromBeginning ?? false

    // Join consumer group
    await this.joinGroup()
  }

  /**
   * Get current subscription
   */
  subscription(): string[] {
    return [...this.subscribedTopics]
  }

  /**
   * Join the consumer group
   */
  private async joinGroup(): Promise<void> {
    const group = getOrCreateGroup(this.config.groupId)

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

    // Set leader if first member
    if (group.members.size === 1) {
      group.leaderId = this.memberId
    }

    // Compute assignments
    await this.computeAssignments()

    group.state = 'Stable'

    // Initialize partition states
    await this.initializePartitionStates()
  }

  /**
   * Compute partition assignments
   */
  private async computeAssignments(): Promise<void> {
    const group = getGroup(this.config.groupId)!
    const members = Array.from(group.members.values())
    const myIndex = members.findIndex((m) => m.memberId === this.memberId)

    const assignmentMap = new Map<string, number[]>()

    for (const topicName of this.subscribedTopics) {
      const topic = getTopic(topicName)
      if (!topic) continue

      const partitions: number[] = []
      for (let p = 0; p < topic.numPartitions; p++) {
        // Simple round-robin assignment
        if (p % members.length === myIndex) {
          partitions.push(p)
        }
      }

      if (partitions.length > 0) {
        assignmentMap.set(topicName, partitions)
      }
    }

    // Update member assignment
    const member = group.members.get(this.memberId!)
    if (member) {
      member.assignment = assignmentMap
    }
  }

  /**
   * Initialize partition states
   */
  private async initializePartitionStates(): Promise<void> {
    this.partitionStates.clear()

    const group = getGroup(this.config.groupId)
    const member = group?.members.get(this.memberId!)

    if (!member) return

    for (const [topicName, partitions] of member.assignment) {
      for (const partition of partitions) {
        const key = `${topicName}-${partition}`
        const topicState = getTopic(topicName)
        const partitionState = topicState?.partitions.get(partition)

        if (!partitionState) continue

        // Check for committed offset
        const committed = getCommittedOffset(this.config.groupId, topicName, partition)
        let startOffset: bigint

        if (committed && committed.offset !== '-1') {
          startOffset = BigInt(committed.offset) + 1n
        } else if (this.fromBeginning) {
          startOffset = partitionState.logStartOffset
        } else {
          startOffset = partitionState.highWatermark
        }

        this.partitionStates.set(key, {
          topic: topicName,
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
  private async poll(maxRecords = 100): Promise<ConsumedMessage[]> {
    const messages: ConsumedMessage[] = []

    for (const [key, state] of this.partitionStates) {
      if (state.paused) continue
      if (messages.length >= maxRecords) break

      const topicState = getTopic(state.topic)
      const partitionState = topicState?.partitions.get(state.partition)

      if (!partitionState) continue

      // Update high watermark
      state.highWatermark = partitionState.highWatermark

      // Fetch messages
      const remaining = maxRecords - messages.length
      const fetched = getMessages(state.topic, state.partition, state.currentOffset, remaining)

      for (const stored of fetched) {
        const storedOffset = BigInt(stored.offset)

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
      }
    }

    return messages
  }

  /**
   * Run the consumer with handlers
   */
  async run(config: ConsumerRunConfig = {}): Promise<void> {
    this.ensureConnected()

    if (this.running) {
      throw new KafkaError('Consumer is already running', KafkaErrorCode.INVALID_REQUEST)
    }

    this.running = true

    const autoCommit = config.autoCommit ?? true
    const autoCommitInterval = config.autoCommitInterval ?? 5000
    let lastCommit = Date.now()

    try {
      while (this.running) {
        const messages = await this.poll()

        if (messages.length === 0) {
          await new Promise((r) => setTimeout(r, 50))
          continue
        }

        if (config.eachBatch) {
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

            await config.eachBatch({
              batch,
              resolveOffset: (offset: string) => {
                state.currentOffset = BigInt(offset) + 1n
              },
              heartbeat: async () => this.sendHeartbeat(),
              commitOffsetsIfNecessary: async () => {
                if (autoCommit) {
                  await this.commitCurrentOffsets()
                }
              },
              uncommittedOffsets: () => this.getUncommittedOffsets(),
              isRunning: () => this.running,
              isStale: () => false,
              pause: () => {
                this.pause([{ topic: state.topic, partitions: [state.partition] }])
                return () => {
                  this.resume([{ topic: state.topic, partitions: [state.partition] }])
                }
              },
            })
          }
        } else if (config.eachMessage) {
          for (const message of messages) {
            if (!this.running) break

            const key = `${message.topic}-${message.partition}`
            const state = this.partitionStates.get(key)!

            await config.eachMessage({
              topic: message.topic,
              partition: message.partition,
              message,
              heartbeat: async () => this.sendHeartbeat(),
              pause: () => {
                this.pause([{ topic: message.topic, partitions: [message.partition] }])
                return () => {
                  this.resume([{ topic: message.topic, partitions: [message.partition] }])
                }
              },
            })
          }
        }

        // Auto-commit if enabled and interval has passed
        if (autoCommit && Date.now() - lastCommit >= autoCommitInterval) {
          await this.commitCurrentOffsets()
          lastCommit = Date.now()
        }
      }
    } finally {
      // Final commit on stop
      if (autoCommit) {
        await this.commitCurrentOffsets()
      }
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    this.running = false
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Commit offsets manually
   */
  async commitOffsets(offsets: TopicPartitionOffset[]): Promise<void> {
    this.ensureConnected()

    for (const o of offsets) {
      commitOffset(this.config.groupId, o.topic, o.partition, o.offset, o.metadata)
      this.lastCommittedOffsets.set(`${o.topic}-${o.partition}`, o.offset)
    }
  }

  /**
   * Commit current offsets
   */
  private async commitCurrentOffsets(): Promise<void> {
    const offsets = this.getCurrentOffsets()
    if (offsets.length > 0) {
      await this.commitOffsets(offsets)
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
  private getUncommittedOffsets(): TopicPartitionOffset[] {
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
   * Get committed offsets for partitions
   */
  async committed(partitions: TopicPartition[]): Promise<TopicPartitionOffset[]> {
    this.ensureConnected()

    const offsets: TopicPartitionOffset[] = []

    for (const { topic, partition } of partitions) {
      const committed = getCommittedOffset(this.config.groupId, topic, partition)
      offsets.push({
        topic,
        partition,
        offset: committed?.offset ?? '-1',
        metadata: committed?.metadata,
      })
    }

    return offsets
  }

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
   * Pause partitions
   */
  pause(partitions: Array<{ topic: string; partitions: number[] }>): void {
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
  resume(partitions: Array<{ topic: string; partitions: number[] }>): void {
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
  paused(): Array<{ topic: string; partitions: number[] }> {
    const byTopic = new Map<string, number[]>()

    for (const key of this.pausedPartitions) {
      const state = this.partitionStates.get(key)
      if (state) {
        const parts = byTopic.get(state.topic) || []
        parts.push(state.partition)
        byTopic.set(state.topic, parts)
      }
    }

    return Array.from(byTopic.entries()).map(([topic, partitions]) => ({ topic, partitions }))
  }

  /**
   * Send heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.memberId) return

    const group = getGroup(this.config.groupId)
    if (!group) return

    const member = group.members.get(this.memberId)
    if (member) {
      member.lastHeartbeat = Date.now()
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
      highWatermark,
      messages,
      isEmpty: () => messages.length === 0,
      firstOffset: () => firstMsg?.offset ?? null,
      lastOffset: () => lastMsg?.offset ?? null,
      offsetLag: () => {
        const last = lastMsg ? BigInt(lastMsg.offset) : 0n
        const hw = BigInt(highWatermark)
        return (hw - last - 1n).toString()
      },
      offsetLagLow: () => {
        const first = firstMsg ? BigInt(firstMsg.offset) : 0n
        const hw = BigInt(highWatermark)
        return (hw - first).toString()
      },
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
  return new KafkaConsumer(config)
}
