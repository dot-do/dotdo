/**
 * In-memory backend for Kafka-compatible storage
 *
 * Provides a simple in-memory implementation using arrays for topics.
 * Suitable for testing and development.
 */

import type {
  TopicStorageState,
  PartitionStorageState,
  ConsumerGroupCoordinatorState,
  StoredMessage,
} from '../types'

/**
 * Global registry for in-memory storage
 */
interface MemoryRegistry {
  topics: Map<string, TopicStorageState>
  consumerGroups: Map<string, ConsumerGroupCoordinatorState>
}

// Global singleton registry
let globalRegistry: MemoryRegistry | null = null

/**
 * Get or create the global registry
 */
export function getRegistry(): MemoryRegistry {
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
 * Create a new topic
 */
export function createTopic(name: string, numPartitions: number): TopicStorageState {
  const partitions = new Map<number, PartitionStorageState>()

  for (let i = 0; i < numPartitions; i++) {
    partitions.set(i, {
      highWatermark: 0n,
      logStartOffset: 0n,
      messages: [],
    })
  }

  return {
    name,
    numPartitions,
    partitions,
  }
}

/**
 * Get a topic by name
 */
export function getTopic(name: string): TopicStorageState | undefined {
  return getRegistry().topics.get(name)
}

/**
 * Set a topic
 */
export function setTopic(name: string, topic: TopicStorageState): void {
  getRegistry().topics.set(name, topic)
}

/**
 * Delete a topic
 */
export function deleteTopic(name: string): boolean {
  return getRegistry().topics.delete(name)
}

/**
 * List all topic names
 */
export function listTopics(): string[] {
  return Array.from(getRegistry().topics.keys())
}

/**
 * Check if topic exists
 */
export function topicExists(name: string): boolean {
  return getRegistry().topics.has(name)
}

/**
 * Append a message to a partition
 */
export function appendMessage(
  topicName: string,
  partition: number,
  message: Omit<StoredMessage, 'offset'>
): StoredMessage {
  const topic = getTopic(topicName)
  if (!topic) {
    throw new Error(`Topic '${topicName}' does not exist`)
  }

  const partitionState = topic.partitions.get(partition)
  if (!partitionState) {
    throw new Error(`Partition ${partition} does not exist in topic '${topicName}'`)
  }

  const offset = partitionState.highWatermark.toString()
  const storedMessage: StoredMessage = {
    ...message,
    offset,
  }

  partitionState.messages.push(storedMessage)
  partitionState.highWatermark++

  return storedMessage
}

/**
 * Get messages from a partition starting at an offset
 */
export function getMessages(
  topicName: string,
  partition: number,
  startOffset: bigint,
  maxMessages: number
): StoredMessage[] {
  const topic = getTopic(topicName)
  if (!topic) {
    return []
  }

  const partitionState = topic.partitions.get(partition)
  if (!partitionState) {
    return []
  }

  const messages: StoredMessage[] = []

  for (const message of partitionState.messages) {
    if (messages.length >= maxMessages) break

    const messageOffset = BigInt(message.offset)
    if (messageOffset >= startOffset && messageOffset < partitionState.highWatermark) {
      messages.push(message)
    }
  }

  return messages
}

/**
 * Get or create a consumer group
 */
export function getOrCreateGroup(groupId: string): ConsumerGroupCoordinatorState {
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
 * Get a consumer group
 */
export function getGroup(groupId: string): ConsumerGroupCoordinatorState | undefined {
  return getRegistry().consumerGroups.get(groupId)
}

/**
 * Delete a consumer group
 */
export function deleteGroup(groupId: string): boolean {
  return getRegistry().consumerGroups.delete(groupId)
}

/**
 * Commit offset for a consumer group
 */
export function commitOffset(
  groupId: string,
  topic: string,
  partition: number,
  offset: string,
  metadata?: string
): void {
  const group = getOrCreateGroup(groupId)
  const key = `${topic}-${partition}`
  group.offsets.set(key, {
    offset,
    metadata,
    timestamp: Date.now(),
  })
}

/**
 * Get committed offset for a consumer group
 */
export function getCommittedOffset(
  groupId: string,
  topic: string,
  partition: number
): { offset: string; metadata?: string } | undefined {
  const group = getGroup(groupId)
  if (!group) return undefined

  const key = `${topic}-${partition}`
  return group.offsets.get(key)
}

/**
 * Get partition state
 */
export function getPartitionState(
  topicName: string,
  partition: number
): PartitionStorageState | undefined {
  const topic = getTopic(topicName)
  return topic?.partitions.get(partition)
}
