/**
 * Kafka Admin - Topic and consumer group management
 *
 * Backed by unified primitives:
 * - TemporalStore for topic metadata and partition state
 * - ExactlyOnceContext for transactional operations
 */

import { createTemporalStore, type TemporalStore } from '../../primitives'
import {
  type TopicConfig,
  type TopicDescription,
  type PartitionDescription,
  type AdminConfig,
  type CreateTopicsRequest,
  type DeleteTopicsRequest,
  type TopicPartitionOffset,
  type ConsumerGroupDescription,
  type ConsumerGroupState,
  type ConsumerGroupMemberDescription,
  type TopicStorageState,
  type PartitionStorageState,
  type ConsumerGroupCoordinatorState,
  type OffsetCommit,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Internal topic registry for tracking all topics and their state
 */
interface TopicRegistry {
  topics: Map<string, TopicStorageState>
  consumerGroups: Map<string, ConsumerGroupCoordinatorState>
}

// Singleton registry for in-memory operation
let globalRegistry: TopicRegistry | null = null

function getRegistry(): TopicRegistry {
  if (!globalRegistry) {
    globalRegistry = {
      topics: new Map(),
      consumerGroups: new Map(),
    }
  }
  return globalRegistry
}

/**
 * Reset the global registry (for testing)
 */
export function resetRegistry(): void {
  globalRegistry = null
}

/**
 * Kafka Admin client for topic and consumer group management
 */
export class KafkaAdmin {
  private config: AdminConfig
  private metadataStore: TemporalStore<TopicStorageState>
  private groupStore: TemporalStore<ConsumerGroupCoordinatorState>

  constructor(config: AdminConfig = {}) {
    this.config = config
    this.metadataStore = createTemporalStore<TopicStorageState>()
    this.groupStore = createTemporalStore<ConsumerGroupCoordinatorState>()
  }

  // ===========================================================================
  // Topic Management
  // ===========================================================================

  /**
   * Create topics
   */
  async createTopics(request: CreateTopicsRequest): Promise<void> {
    const registry = getRegistry()

    for (const topicConfig of request.topics) {
      // Validate
      if (!topicConfig.name || topicConfig.name.trim() === '') {
        throw new KafkaError('Topic name is required', KafkaErrorCode.INVALID_TOPIC)
      }

      if (topicConfig.partitions < 1) {
        throw new KafkaError(
          `Invalid partition count: ${topicConfig.partitions}`,
          KafkaErrorCode.INVALID_PARTITIONS
        )
      }

      // Check if exists
      if (registry.topics.has(topicConfig.name)) {
        throw new KafkaError(
          `Topic '${topicConfig.name}' already exists`,
          KafkaErrorCode.TOPIC_ALREADY_EXISTS
        )
      }

      // Validation only mode
      if (request.validateOnly) {
        continue
      }

      // Create topic state
      const partitions = new Map<number, PartitionStorageState>()
      for (let i = 0; i < topicConfig.partitions; i++) {
        partitions.set(i, {
          highWatermark: 0n,
          logStartOffset: 0n,
          messages: [],
        })
      }

      const topicState: TopicStorageState = {
        config: {
          name: topicConfig.name,
          partitions: topicConfig.partitions,
          retentionMs: topicConfig.retentionMs,
          cleanupPolicy: topicConfig.cleanupPolicy,
        },
        partitions,
      }

      registry.topics.set(topicConfig.name, topicState)

      // Also store in temporal store for durability/history
      await this.metadataStore.put(topicConfig.name, topicState, Date.now())
    }
  }

  /**
   * Delete topics
   */
  async deleteTopics(request: DeleteTopicsRequest): Promise<void> {
    const registry = getRegistry()

    for (const topicName of request.topics) {
      registry.topics.delete(topicName)
    }
  }

  /**
   * List all topics
   */
  async listTopics(): Promise<string[]> {
    const registry = getRegistry()
    return Array.from(registry.topics.keys())
  }

  /**
   * Describe topics
   */
  async describeTopics(topicNames: string[]): Promise<TopicDescription[]> {
    const registry = getRegistry()
    const descriptions: TopicDescription[] = []

    for (const name of topicNames) {
      const topicState = registry.topics.get(name)

      if (!topicState) {
        throw new KafkaError(
          `Topic '${name}' does not exist`,
          KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
        )
      }

      const partitions: PartitionDescription[] = []
      for (const [partitionId, partitionState] of topicState.partitions) {
        partitions.push({
          partition: partitionId,
          highWatermark: partitionState.highWatermark.toString(),
          logStartOffset: partitionState.logStartOffset.toString(),
        })
      }

      descriptions.push({
        name,
        partitions,
        config: {
          'retention.ms': String(topicState.config.retentionMs ?? -1),
          'cleanup.policy': topicState.config.cleanupPolicy ?? 'delete',
        },
      })
    }

    return descriptions
  }

  /**
   * Get topic if exists
   */
  getTopic(topicName: string): TopicStorageState | undefined {
    return getRegistry().topics.get(topicName)
  }

  /**
   * Get partition count for a topic
   */
  getPartitionCount(topicName: string): number {
    const topic = this.getTopic(topicName)
    if (!topic) {
      throw new KafkaError(
        `Topic '${topicName}' does not exist`,
        KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
      )
    }
    return topic.config.partitions
  }

  /**
   * Get partition state
   */
  getPartitionState(topicName: string, partition: number): PartitionStorageState | undefined {
    const topic = this.getTopic(topicName)
    return topic?.partitions.get(partition)
  }

  // ===========================================================================
  // Consumer Group Management
  // ===========================================================================

  /**
   * Get or create consumer group
   */
  getOrCreateGroup(groupId: string): ConsumerGroupCoordinatorState {
    const registry = getRegistry()
    let group = registry.consumerGroups.get(groupId)

    if (!group) {
      group = {
        groupId,
        state: 'Empty',
        generationId: 0,
        leaderId: null,
        members: new Map(),
        offsets: new Map(),
      }
      registry.consumerGroups.set(groupId, group)
    }

    return group
  }

  /**
   * Get consumer group
   */
  getGroup(groupId: string): ConsumerGroupCoordinatorState | undefined {
    return getRegistry().consumerGroups.get(groupId)
  }

  /**
   * Describe consumer groups
   */
  async describeGroups(groupIds: string[]): Promise<ConsumerGroupDescription[]> {
    const descriptions: ConsumerGroupDescription[] = []

    for (const groupId of groupIds) {
      const group = this.getGroup(groupId)

      if (!group) {
        descriptions.push({
          groupId,
          state: 'Dead',
          members: [],
        })
        continue
      }

      const members: ConsumerGroupMemberDescription[] = []
      for (const [memberId, member] of group.members) {
        const assignment: { topic: string; partition: number }[] = []
        for (const [topic, partitions] of member.assignment) {
          for (const partition of partitions) {
            assignment.push({ topic, partition })
          }
        }

        members.push({
          memberId,
          clientId: member.clientId,
          assignment,
        })
      }

      descriptions.push({
        groupId,
        state: group.state,
        members,
      })
    }

    return descriptions
  }

  /**
   * List consumer groups
   */
  async listGroups(): Promise<{ groupId: string; protocolType: string }[]> {
    const registry = getRegistry()
    const groups: { groupId: string; protocolType: string }[] = []

    for (const [groupId] of registry.consumerGroups) {
      groups.push({ groupId, protocolType: 'consumer' })
    }

    return groups
  }

  /**
   * Delete consumer groups
   */
  async deleteGroups(groupIds: string[]): Promise<void> {
    const registry = getRegistry()

    for (const groupId of groupIds) {
      const group = registry.consumerGroups.get(groupId)
      if (group && group.members.size > 0) {
        throw new KafkaError(
          `Cannot delete non-empty consumer group: ${groupId}`,
          KafkaErrorCode.NOT_COORDINATOR
        )
      }
      registry.consumerGroups.delete(groupId)
    }
  }

  // ===========================================================================
  // Offset Management
  // ===========================================================================

  /**
   * Fetch committed offsets for a consumer group
   */
  async fetchOffsets(request: {
    groupId: string
    topics: string[]
  }): Promise<TopicPartitionOffset[]> {
    const group = this.getGroup(request.groupId)
    const offsets: TopicPartitionOffset[] = []

    for (const topicName of request.topics) {
      const topic = this.getTopic(topicName)
      if (!topic) continue

      for (let partition = 0; partition < topic.config.partitions; partition++) {
        const key = `${topicName}-${partition}`
        const committed = group?.offsets.get(key)

        offsets.push({
          topic: topicName,
          partition,
          offset: committed?.offset ?? '-1',
          metadata: committed?.metadata,
        })
      }
    }

    return offsets
  }

  /**
   * Commit offsets for a consumer group
   */
  async commitOffsets(groupId: string, offsets: TopicPartitionOffset[]): Promise<void> {
    const group = this.getOrCreateGroup(groupId)
    const now = Date.now()

    for (const offset of offsets) {
      const key = `${offset.topic}-${offset.partition}`
      group.offsets.set(key, {
        topic: offset.topic,
        partition: offset.partition,
        offset: offset.offset,
        metadata: offset.metadata,
        timestamp: now,
      })
    }
  }

  /**
   * Reset offsets for a consumer group
   */
  async resetOffsets(request: {
    groupId: string
    topic: string
    earliest?: boolean
  }): Promise<void> {
    const group = this.getOrCreateGroup(request.groupId)
    const topic = this.getTopic(request.topic)

    if (!topic) {
      throw new KafkaError(
        `Topic '${request.topic}' does not exist`,
        KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
      )
    }

    const now = Date.now()

    for (let partition = 0; partition < topic.config.partitions; partition++) {
      const key = `${request.topic}-${partition}`
      const partitionState = topic.partitions.get(partition)!
      const offset = request.earliest
        ? partitionState.logStartOffset.toString()
        : partitionState.highWatermark.toString()

      group.offsets.set(key, {
        topic: request.topic,
        partition,
        offset,
        timestamp: now,
      })
    }
  }

  /**
   * Delete consumer group offsets for a topic
   */
  async deleteConsumerGroupOffsets(request: {
    groupId: string
    topic: string
  }): Promise<void> {
    const group = this.getGroup(request.groupId)
    if (!group) return

    const topic = this.getTopic(request.topic)
    if (!topic) return

    for (let partition = 0; partition < topic.config.partitions; partition++) {
      const key = `${request.topic}-${partition}`
      group.offsets.delete(key)
    }
  }
}

/**
 * Create a new Kafka admin client
 */
export function createKafkaAdmin(config?: AdminConfig): KafkaAdmin {
  return new KafkaAdmin(config)
}
