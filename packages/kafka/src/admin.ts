/**
 * Kafka Admin - Topic and consumer group management
 *
 * Provides Kafka-compatible admin API with in-memory backend.
 */

import {
  createTopic,
  getTopic,
  setTopic,
  deleteTopic,
  listTopics,
  topicExists,
  getOrCreateGroup,
  getGroup,
  deleteGroup,
  commitOffset,
  getCommittedOffset,
  resetRegistry,
} from './backends/memory'
import {
  type CreateTopicsRequest,
  type DeleteTopicsRequest,
  type TopicPartitionOffset,
  type TopicMetadata,
  type PartitionMetadata,
  KafkaError,
  KafkaErrorCode,
} from './types'

/**
 * Admin client interface
 */
export interface Admin {
  connect(): Promise<void>
  disconnect(): Promise<void>
  createTopics(request: CreateTopicsRequest): Promise<boolean>
  deleteTopics(request: DeleteTopicsRequest): Promise<void>
  listTopics(): Promise<string[]>
  fetchTopicMetadata(options?: { topics?: string[] }): Promise<{ topics: TopicMetadata[] }>
  fetchOffsets(options: { groupId: string; topics: string[] }): Promise<TopicPartitionOffset[]>
  resetOffsets(options: { groupId: string; topic: string; earliest?: boolean }): Promise<void>
}

/**
 * Kafka Admin implementation
 */
export class KafkaAdmin implements Admin {
  private connected = false

  /**
   * Connect to the cluster
   */
  async connect(): Promise<void> {
    this.connected = true
  }

  /**
   * Disconnect from the cluster
   */
  async disconnect(): Promise<void> {
    this.connected = false
  }

  /**
   * Create topics
   */
  async createTopics(request: CreateTopicsRequest): Promise<boolean> {
    let created = false

    for (const topicConfig of request.topics) {
      const name = topicConfig.topic
      const numPartitions = topicConfig.numPartitions ?? 1

      // Validate
      if (!name || name.trim() === '') {
        throw new KafkaError('Topic name is required', KafkaErrorCode.INVALID_TOPIC_EXCEPTION)
      }

      if (numPartitions < 1) {
        throw new KafkaError(
          `Invalid partition count: ${numPartitions}`,
          KafkaErrorCode.INVALID_PARTITIONS
        )
      }

      // Check if exists
      if (topicExists(name)) {
        throw new KafkaError(
          `Topic '${name}' already exists`,
          KafkaErrorCode.TOPIC_ALREADY_EXISTS
        )
      }

      // Validation only mode
      if (request.validateOnly) {
        continue
      }

      // Create topic
      const topic = createTopic(name, numPartitions)
      setTopic(name, topic)
      created = true
    }

    return created
  }

  /**
   * Delete topics
   */
  async deleteTopics(request: DeleteTopicsRequest): Promise<void> {
    for (const topicName of request.topics) {
      deleteTopic(topicName)
    }
  }

  /**
   * List all topic names
   */
  async listTopics(): Promise<string[]> {
    return listTopics()
  }

  /**
   * Fetch topic metadata
   */
  async fetchTopicMetadata(options?: { topics?: string[] }): Promise<{ topics: TopicMetadata[] }> {
    const topicNames = options?.topics ?? listTopics()
    const topics: TopicMetadata[] = []

    for (const name of topicNames) {
      const topic = getTopic(name)
      if (!topic) continue

      const partitions: PartitionMetadata[] = []
      for (const [partitionId] of topic.partitions) {
        partitions.push({
          partition: partitionId,
          leader: 0,
          replicas: [0],
          isr: [0],
          offlineReplicas: [],
        })
      }

      topics.push({ name, partitions })
    }

    return { topics }
  }

  /**
   * Fetch committed offsets for a consumer group
   */
  async fetchOffsets(options: {
    groupId: string
    topics: string[]
  }): Promise<TopicPartitionOffset[]> {
    const offsets: TopicPartitionOffset[] = []

    for (const topicName of options.topics) {
      const topic = getTopic(topicName)
      if (!topic) continue

      for (let partition = 0; partition < topic.numPartitions; partition++) {
        const committed = getCommittedOffset(options.groupId, topicName, partition)
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
   * Reset offsets for a consumer group
   */
  async resetOffsets(options: {
    groupId: string
    topic: string
    earliest?: boolean
  }): Promise<void> {
    const topic = getTopic(options.topic)
    if (!topic) {
      throw new KafkaError(
        `Topic '${options.topic}' does not exist`,
        KafkaErrorCode.UNKNOWN_TOPIC_OR_PARTITION
      )
    }

    for (let partition = 0; partition < topic.numPartitions; partition++) {
      const partitionState = topic.partitions.get(partition)!
      const offset = options.earliest
        ? partitionState.logStartOffset.toString()
        : partitionState.highWatermark.toString()

      commitOffset(options.groupId, options.topic, partition, offset)
    }
  }

  /**
   * Commit offsets for a consumer group (internal use)
   */
  commitOffsets(groupId: string, offsets: TopicPartitionOffset[]): void {
    for (const o of offsets) {
      commitOffset(groupId, o.topic, o.partition, o.offset, o.metadata)
    }
  }

  /**
   * Get topic state (internal use)
   */
  getTopic(name: string) {
    return getTopic(name)
  }

  /**
   * Get consumer group (internal use)
   */
  getGroup(groupId: string) {
    return getGroup(groupId)
  }

  /**
   * Get or create consumer group (internal use)
   */
  getOrCreateGroup(groupId: string) {
    return getOrCreateGroup(groupId)
  }
}

/**
 * Create a new admin client
 */
export function createAdmin(): Admin {
  return new KafkaAdmin()
}

// Re-export resetRegistry for testing
export { resetRegistry }
