/**
 * Stream Primitives
 *
 * Kafka-inspired streaming with topics, partitions, and consumer groups.
 * Built on DO SQLite and Cloudflare Pipelines.
 *
 * @see README.md for API specification
 */

// =============================================================================
// STORAGE - In-memory storage for tests (will use SQLite in production)
// =============================================================================

interface StoredMessage {
  topic: string
  partition: number
  offset: number
  key: string | null
  value: unknown
  headers?: Record<string, string>
  timestamp: number
}

interface StoredTopic {
  name: string
  partitions: number
  config: Record<string, unknown>
  partitionOffsets: Map<number, { earliest: number; latest: number }>
}

interface StoredOffset {
  groupId: string
  topic: string
  partition: number
  offset: number
}

interface StoredGroup {
  groupId: string
  generation: number
  leader: string | null
  members: Map<string, { id: string; assignment: number[] }>
  sessionTimeout: number
  heartbeatInterval: number
  topics: string[]
  rebalanceStrategy: 'range' | 'roundRobin'
  rebalanceHandlers: Array<(event: { type: string; partitions: number[] }) => void>
}

// Global storage (simulates DO SQLite)
let topics = new Map<string, StoredTopic>()
let messages = new Map<string, StoredMessage[]>() // key: topic-partition
let offsets = new Map<string, StoredOffset>() // key: groupId-topic-partition
let groups = new Map<string, StoredGroup>()
let processedIdempotencyKeys = new Set<string>()
let lastPolledConsumer: Consumer | null = null

/**
 * Reset all storage - for testing purposes only
 * @internal
 */
export function _resetStorage(): void {
  topics = new Map()
  messages = new Map()
  offsets = new Map()
  groups = new Map()
  processedIdempotencyKeys = new Set()
  lastPolledConsumer = null
}

// Valid config keys
const VALID_CONFIG_KEYS = new Set([
  'retention.ms',
  'cleanup.policy',
  'max.message.bytes',
])

// =============================================================================
// MURMUR2 HASH - Kafka-compatible partitioner
// =============================================================================

function murmur2(key: string): number {
  const seed = 0x9747b28c
  const m = 0x5bd1e995
  const r = 24

  let h = seed ^ key.length
  let i = 0

  while (i + 4 <= key.length) {
    let k =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24)

    k = Math.imul(k, m)
    k ^= k >>> r
    k = Math.imul(k, m)

    h = Math.imul(h, m)
    h ^= k

    i += 4
  }

  switch (key.length - i) {
    case 3:
      h ^= (key.charCodeAt(i + 2) & 0xff) << 16
    // falls through
    case 2:
      h ^= (key.charCodeAt(i + 1) & 0xff) << 8
    // falls through
    case 1:
      h ^= key.charCodeAt(i) & 0xff
      h = Math.imul(h, m)
  }

  h ^= h >>> 13
  h = Math.imul(h, m)
  h ^= h >>> 15

  return h >>> 0
}

function toPositive(hash: number): number {
  return hash & 0x7fffffff
}

// =============================================================================
// TYPES
// =============================================================================

export interface Message<T = unknown> {
  topic: string
  partition: number
  offset: number
  key: string
  value: T
  headers?: Record<string, string>
  timestamp: number
}

export interface TopicInfo {
  name: string
  partitions: number
  config: Record<string, unknown>
  partitionOffsets: Array<{
    partition: number
    earliestOffset: number
    latestOffset: number
  }>
}

export interface GroupMember {
  id: string
  assignment: number[]
  consumer: Consumer
  commitWithGeneration(offset: number, generation: number): Promise<void>
}

export interface Transaction {
  produce(topic: string, message: { key: string | null; value: unknown }): Promise<void>
  commit(offset: number): Promise<void>
}

// =============================================================================
// ADMIN CLIENT
// =============================================================================

export class AdminClient {
  async createTopic(
    name: string,
    options?: {
      partitions?: number
      replicationFactor?: number
      config?: Record<string, unknown>
    }
  ): Promise<void> {
    // Validate partition count
    if (options?.partitions !== undefined) {
      if (
        options.partitions <= 0 ||
        !Number.isInteger(options.partitions)
      ) {
        throw new Error('Partition count must be a positive integer')
      }
    }

    // Validate config keys
    if (options?.config) {
      for (const key of Object.keys(options.config)) {
        if (!VALID_CONFIG_KEYS.has(key)) {
          throw new Error(`Unknown config setting: ${key}`)
        }
      }
    }

    if (topics.has(name)) {
      throw new Error(`Topic '${name}' already exists`)
    }

    const partitionCount = options?.partitions ?? 1
    const partitionOffsets = new Map<number, { earliest: number; latest: number }>()

    for (let i = 0; i < partitionCount; i++) {
      partitionOffsets.set(i, { earliest: 0, latest: 0 })
      messages.set(`${name}-${i}`, [])
    }

    topics.set(name, {
      name,
      partitions: partitionCount,
      config: options?.config ?? {},
      partitionOffsets,
    })
  }

  async listTopics(): Promise<Array<{ name: string; partitions?: number }>> {
    return Array.from(topics.values()).map((t) => ({
      name: t.name,
      partitions: t.partitions,
    }))
  }

  async describeTopic(name: string): Promise<TopicInfo> {
    const topic = topics.get(name)
    if (!topic) {
      throw new Error(`Topic '${name}' not found`)
    }

    return {
      name: topic.name,
      partitions: topic.partitions,
      config: topic.config,
      partitionOffsets: Array.from(topic.partitionOffsets.entries()).map(([partition, offsets]) => ({
        partition,
        earliestOffset: offsets.earliest,
        latestOffset: offsets.latest,
      })),
    }
  }

  async deleteTopic(name: string): Promise<void> {
    const topic = topics.get(name)
    if (!topic) {
      throw new Error(`Topic '${name}' not found`)
    }

    // Delete all messages for this topic
    for (let i = 0; i < topic.partitions; i++) {
      messages.delete(`${name}-${i}`)
    }

    topics.delete(name)
  }

  async compactTopic(name: string): Promise<void> {
    const topic = topics.get(name)
    if (!topic) {
      throw new Error(`Topic '${name}' not found`)
    }

    // Compact each partition
    for (let partition = 0; partition < topic.partitions; partition++) {
      const key = `${name}-${partition}`
      const partitionMessages = messages.get(key) ?? []

      // Keep only latest value per key, remove tombstones
      const latestByKey = new Map<string, StoredMessage>()

      for (const msg of partitionMessages) {
        if (msg.key !== null) {
          if (msg.value === null) {
            // Tombstone - mark for deletion
            latestByKey.delete(msg.key)
          } else {
            latestByKey.set(msg.key, msg)
          }
        }
      }

      // Rebuild messages array with compacted data
      const compacted = Array.from(latestByKey.values()).sort((a, b) => a.offset - b.offset)
      messages.set(key, compacted)

      // Update offsets
      const offsetInfo = topic.partitionOffsets.get(partition)
      if (offsetInfo && compacted.length > 0) {
        offsetInfo.earliest = compacted[0].offset
      }
    }
  }
}

// =============================================================================
// PRODUCER
// =============================================================================

export class Producer {
  private roundRobinCounter = 0

  constructor(
    public readonly options?: {
      partitioner?: 'murmur2' | 'default'
      compression?: 'none' | 'gzip' | 'snappy'
      batchSize?: number
      lingerMs?: number
      idempotent?: boolean
    }
  ) {}

  private getPartition(key: string | null, partitionCount: number): number {
    if (key === null) {
      // Round-robin for null keys
      const partition = this.roundRobinCounter % partitionCount
      this.roundRobinCounter++
      return partition
    }

    // Murmur2 hash for keyed messages
    const hash = toPositive(murmur2(key))
    return hash % partitionCount
  }

  async send(
    topicName: string,
    message: { key: string | null; value: unknown; headers?: Record<string, string> }
  ): Promise<{ topic: string; partition: number; offset: number }> {
    const topic = topics.get(topicName)
    if (!topic) {
      throw new Error(`Topic '${topicName}' does not exist`)
    }

    // Check max message size
    const maxSize = topic.config['max.message.bytes'] as number | undefined
    if (maxSize !== undefined) {
      const msgSize = JSON.stringify(message.value).length
      if (msgSize > maxSize) {
        throw new Error(`Message size ${msgSize} exceeds max size ${maxSize}`)
      }
    }

    const partition = this.getPartition(message.key, topic.partitions)
    const key = `${topicName}-${partition}`

    const partitionMessages = messages.get(key) ?? []
    const offset = topic.partitionOffsets.get(partition)?.latest ?? 0

    const storedMessage: StoredMessage = {
      topic: topicName,
      partition,
      offset,
      key: message.key,
      value: message.value,
      headers: message.headers,
      timestamp: Date.now(),
    }

    partitionMessages.push(storedMessage)
    messages.set(key, partitionMessages)

    // Update partition offset
    const offsetInfo = topic.partitionOffsets.get(partition)
    if (offsetInfo) {
      offsetInfo.latest = offset + 1
    }

    return { topic: topicName, partition, offset }
  }

  async sendBatch(
    topicName: string,
    messageBatch: Array<{ key: string | null; value: unknown; headers?: Record<string, string> }>
  ): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    const results: Array<{ topic: string; partition: number; offset: number }> = []

    for (const message of messageBatch) {
      const result = await this.send(topicName, message)
      results.push(result)
    }

    return results
  }
}

// =============================================================================
// CONSUMER
// =============================================================================

export class Consumer<T = unknown> {
  public readonly subscriptions: string[] = []
  public closed = false
  private paused = false
  private currentPositions = new Map<string, number>() // key: topic-partition, value: offset
  private autoCommitTimer?: ReturnType<typeof setInterval>
  private pendingOffsets = new Map<string, number>() // Offsets to auto-commit
  private assignedPartitions: number[] = []
  private groupGeneration = 0

  constructor(
    public readonly topic: string,
    public readonly options?: {
      groupId: string
      autoCommit?: boolean
      autoCommitInterval?: number
      maxPollRecords?: number
      retryAttempts?: number
      retryDelay?: number
    }
  ) {}

  async subscribe(topicOrTopics: string | string[]): Promise<void> {
    const topicList = Array.isArray(topicOrTopics) ? topicOrTopics : [topicOrTopics]

    for (const t of topicList) {
      if (!this.subscriptions.includes(t)) {
        this.subscriptions.push(t)
      }
    }

    // Initialize positions from committed offsets or beginning
    for (const topicName of this.subscriptions) {
      const topic = topics.get(topicName)
      if (topic) {
        for (let partition = 0; partition < topic.partitions; partition++) {
          const key = `${topicName}-${partition}`
          const offsetKey = `${this.options?.groupId}-${topicName}-${partition}`
          const committedOffset = offsets.get(offsetKey)

          if (committedOffset) {
            // Resume from after committed offset
            this.currentPositions.set(key, committedOffset.offset + 1)
          } else {
            this.currentPositions.set(key, 0)
          }
        }
      }
    }

    // Setup auto-commit if enabled
    if (this.options?.autoCommit && this.options.autoCommitInterval) {
      this.autoCommitTimer = setInterval(() => {
        this.flushAutoCommit()
      }, this.options.autoCommitInterval)
    }
  }

  async unsubscribe(topicName: string): Promise<void> {
    const idx = this.subscriptions.indexOf(topicName)
    if (idx >= 0) {
      this.subscriptions.splice(idx, 1)
    }
  }

  private async flushAutoCommit(): Promise<void> {
    for (const [key, offset] of this.pendingOffsets) {
      // Split from the end to handle topic names with hyphens
      const lastDash = key.lastIndexOf('-')
      const topicName = key.substring(0, lastDash)
      const partition = parseInt(key.substring(lastDash + 1), 10)

      const offsetKey = `${this.options?.groupId}-${topicName}-${partition}`
      offsets.set(offsetKey, {
        groupId: this.options?.groupId ?? '',
        topic: topicName,
        partition,
        offset,
      })
    }
  }

  async poll(options?: { timeout?: number }): Promise<Message<T> | null> {
    if (this.closed) {
      throw new Error('Consumer is closed')
    }

    if (this.paused) {
      return null
    }

    const timeout = options?.timeout ?? 1000
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      // Check assigned partitions if in a group, otherwise check all
      const partitionsToCheck = this.assignedPartitions.length > 0
        ? this.assignedPartitions
        : null

      for (const topicName of this.subscriptions) {
        const topic = topics.get(topicName)
        if (!topic) continue

        for (let partition = 0; partition < topic.partitions; partition++) {
          // Skip if we have assigned partitions and this isn't one of them
          if (partitionsToCheck && !partitionsToCheck.includes(partition)) {
            continue
          }

          const key = `${topicName}-${partition}`
          const partitionMessages = messages.get(key) ?? []
          const currentPosition = this.currentPositions.get(key) ?? 0

          const message = partitionMessages.find((m) => m.offset === currentPosition)
          if (message) {
            // Move position forward
            this.currentPositions.set(key, currentPosition + 1)

            // Track for auto-commit (commit next offset to fetch, not the processed offset)
            if (this.options?.autoCommit) {
              this.pendingOffsets.set(`${topicName}-${partition}`, message.offset + 1)
            }

            // Track last polled consumer for ExactlyOnceContext
            lastPolledConsumer = this as unknown as Consumer

            return {
              topic: message.topic,
              partition: message.partition,
              offset: message.offset,
              key: message.key ?? '',
              value: message.value as T,
              headers: message.headers,
              timestamp: message.timestamp,
            }
          }
        }
      }

      // Small delay before retry
      await new Promise((r) => setTimeout(r, 10))
    }

    return null
  }

  async pollBatch(options?: { timeout?: number }): Promise<Array<Message<T>>> {
    const maxRecords = this.options?.maxPollRecords ?? 100
    const results: Array<Message<T>> = []

    for (let i = 0; i < maxRecords; i++) {
      const msg = await this.poll({ timeout: options?.timeout ?? 100 })
      if (msg) {
        results.push(msg)
      } else {
        break
      }
    }

    return results
  }

  async commit(offsetOrPosition: number | { topic: string; partition: number; offset: number }): Promise<void> {
    if (typeof offsetOrPosition === 'number') {
      // Simple offset - commit for all subscribed topics/partitions
      for (const topicName of this.subscriptions) {
        const topic = topics.get(topicName)
        if (topic) {
          for (let partition = 0; partition < topic.partitions; partition++) {
            const offsetKey = `${this.options?.groupId}-${topicName}-${partition}`
            offsets.set(offsetKey, {
              groupId: this.options?.groupId ?? '',
              topic: topicName,
              partition,
              offset: offsetOrPosition,
            })
          }
        }
      }
    } else {
      // Specific partition offset
      const offsetKey = `${this.options?.groupId}-${offsetOrPosition.topic}-${offsetOrPosition.partition}`
      offsets.set(offsetKey, {
        groupId: this.options?.groupId ?? '',
        topic: offsetOrPosition.topic,
        partition: offsetOrPosition.partition,
        offset: offsetOrPosition.offset,
      })
    }
  }

  async commitWithGeneration(offset: number, generation: number): Promise<void> {
    // Check if generation is current
    const group = groups.get(this.options?.groupId ?? '')
    if (group && generation < group.generation) {
      throw new Error(`Stale generation ${generation}, current is ${group.generation}`)
    }

    await this.commit(offset)
  }

  async committed(): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    const result: Array<{ topic: string; partition: number; offset: number }> = []

    for (const topicName of this.subscriptions) {
      const topic = topics.get(topicName)
      if (topic) {
        for (let partition = 0; partition < topic.partitions; partition++) {
          const offsetKey = `${this.options?.groupId}-${topicName}-${partition}`
          const committed = offsets.get(offsetKey)
          if (committed) {
            result.push({
              topic: topicName,
              partition,
              offset: committed.offset,
            })
          }
        }
      }
    }

    return result
  }

  async seekToBeginning(): Promise<void> {
    for (const topicName of this.subscriptions) {
      const topic = topics.get(topicName)
      if (topic) {
        for (let partition = 0; partition < topic.partitions; partition++) {
          const key = `${topicName}-${partition}`
          const offsetInfo = topic.partitionOffsets.get(partition)
          this.currentPositions.set(key, offsetInfo?.earliest ?? 0)
        }
      }
    }
  }

  async seekToEnd(): Promise<void> {
    for (const topicName of this.subscriptions) {
      const topic = topics.get(topicName)
      if (topic) {
        for (let partition = 0; partition < topic.partitions; partition++) {
          const key = `${topicName}-${partition}`
          const offsetInfo = topic.partitionOffsets.get(partition)
          this.currentPositions.set(key, offsetInfo?.latest ?? 0)
        }
      }
    }
  }

  async seek(position: { partition: number; offset: number }): Promise<void> {
    for (const topicName of this.subscriptions) {
      const key = `${topicName}-${position.partition}`
      this.currentPositions.set(key, position.offset)
    }
  }

  async seekToTimestamp(timestamp: number): Promise<void> {
    for (const topicName of this.subscriptions) {
      const topic = topics.get(topicName)
      if (topic) {
        for (let partition = 0; partition < topic.partitions; partition++) {
          const key = `${topicName}-${partition}`
          const partitionMessages = messages.get(key) ?? []

          // Find first message strictly after timestamp
          const msg = partitionMessages.find((m) => m.timestamp > timestamp)
          if (msg) {
            this.currentPositions.set(key, msg.offset)
          } else {
            // No messages after timestamp, go to end
            const offsetInfo = topic.partitionOffsets.get(partition)
            this.currentPositions.set(key, offsetInfo?.latest ?? 0)
          }
        }
      }
    }
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  async close(): Promise<void> {
    if (this.autoCommitTimer) {
      clearInterval(this.autoCommitTimer)
    }
    await this.flushAutoCommit()
    this.closed = true
  }

  setAssignment(partitions: number[], generation: number): void {
    this.assignedPartitions = partitions
    this.groupGeneration = generation
  }

  [Symbol.asyncIterator](): AsyncIterator<Message<T>> {
    const consumer = this

    return {
      async next(): Promise<IteratorResult<Message<T>>> {
        const msg = await consumer.poll()
        if (msg) {
          return { value: msg, done: false }
        }
        return { value: undefined as never, done: true }
      },
    }
  }
}

// =============================================================================
// CONSUMER GROUP
// =============================================================================

export class ConsumerGroup {
  public readonly groupId: string
  public readonly topics: string[]
  public readonly rebalanceStrategy: 'range' | 'roundRobin'
  public generation = 0
  public leader?: string
  private memberMap = new Map<string, { id: string; assignment: number[]; consumer: Consumer }>()
  private rebalanceHandlers: Array<(event: { type: string; partitions: number[] }) => void> = []
  private sessionTimeout: number
  private heartbeatInterval: number
  private heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    groupId: string,
    public readonly options: {
      topics: string[]
      rebalanceStrategy?: 'range' | 'roundRobin'
      sessionTimeout?: number
      heartbeatInterval?: number
    }
  ) {
    this.groupId = groupId
    this.topics = options.topics
    this.rebalanceStrategy = options.rebalanceStrategy ?? 'range'
    this.sessionTimeout = options.sessionTimeout ?? 30000
    this.heartbeatInterval = options.heartbeatInterval ?? 10000

    // Store in global groups
    groups.set(groupId, {
      groupId,
      generation: 0,
      leader: null,
      members: new Map(),
      sessionTimeout: this.sessionTimeout,
      heartbeatInterval: this.heartbeatInterval,
      topics: this.topics,
      rebalanceStrategy: this.rebalanceStrategy,
      rebalanceHandlers: this.rebalanceHandlers,
    })
  }

  on(event: 'rebalance', handler: (assignment: { type: string; partitions: number[] }) => void): void {
    this.rebalanceHandlers.push(handler)
  }

  private getTotalPartitions(): number {
    let total = 0
    for (const topicName of this.topics) {
      const topic = topics.get(topicName)
      if (topic) {
        total += topic.partitions
      }
    }
    return total
  }

  private rebalance(): void {
    const memberIds = Array.from(this.memberMap.keys()).sort()
    const totalPartitions = this.getTotalPartitions()

    // Clear all assignments
    for (const member of this.memberMap.values()) {
      member.assignment = []
    }

    if (memberIds.length === 0) return

    if (this.rebalanceStrategy === 'roundRobin') {
      // Round-robin: distribute partitions one at a time
      let memberIndex = 0
      for (let partition = 0; partition < totalPartitions; partition++) {
        const memberId = memberIds[memberIndex % memberIds.length]
        const member = this.memberMap.get(memberId)
        if (member) {
          member.assignment.push(partition)
          member.consumer.setAssignment(member.assignment, this.generation)
        }
        memberIndex++
      }
    } else {
      // Range: divide partitions into contiguous ranges
      const partitionsPerMember = Math.floor(totalPartitions / memberIds.length)
      const extra = totalPartitions % memberIds.length

      let currentPartition = 0
      for (let i = 0; i < memberIds.length; i++) {
        const memberId = memberIds[i]
        const member = this.memberMap.get(memberId)
        if (member) {
          const count = partitionsPerMember + (i < extra ? 1 : 0)
          for (let j = 0; j < count; j++) {
            member.assignment.push(currentPartition++)
          }
          member.consumer.setAssignment(member.assignment, this.generation)
        }
      }
    }

    // Notify handlers
    for (const member of this.memberMap.values()) {
      for (const handler of this.rebalanceHandlers) {
        handler({ type: 'assigned', partitions: member.assignment })
      }
    }
  }

  private startHeartbeat(memberId: string): void {
    // Clear existing timer
    const existingTimer = this.heartbeatTimers.get(memberId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set timeout for member failure
    const timer = setTimeout(() => {
      // Member failed heartbeat - remove them
      this.leave(memberId)
    }, this.sessionTimeout)

    this.heartbeatTimers.set(memberId, timer)
  }

  async join(memberId: string): Promise<GroupMember> {
    // Create consumer for this member
    const consumer = new Consumer(this.topics[0], {
      groupId: this.groupId,
      autoCommit: false,
    })

    // Subscribe to all topics
    for (const topicName of this.topics) {
      await consumer.subscribe(topicName)
    }

    // Set leader if first member
    if (this.memberMap.size === 0) {
      this.leader = memberId
    }

    // Add member
    this.memberMap.set(memberId, {
      id: memberId,
      assignment: [],
      consumer,
    })

    // Increment generation
    this.generation++

    // Update stored group
    const storedGroup = groups.get(this.groupId)
    if (storedGroup) {
      storedGroup.generation = this.generation
      storedGroup.leader = this.leader ?? null
    }

    // Start heartbeat monitoring for new member
    this.startHeartbeat(memberId)

    // Refresh heartbeat timers for all existing members (simulates successful rebalance)
    for (const existingMemberId of this.memberMap.keys()) {
      if (existingMemberId !== memberId) {
        this.startHeartbeat(existingMemberId)
      }
    }

    // Rebalance
    this.rebalance()

    const memberRef = this.memberMap.get(memberId)!
    const groupRef = this
    const memberMapRef = this.memberMap
    return {
      id: memberRef.id,
      get assignment() {
        // Return current assignment from the map (updates after rebalance)
        const currentMember = memberMapRef.get(memberRef.id)
        return currentMember?.assignment ?? []
      },
      consumer: memberRef.consumer,
      async commitWithGeneration(offset: number, generation: number): Promise<void> {
        if (generation < groupRef.generation) {
          throw new Error(`Stale generation ${generation}, current is ${groupRef.generation}`)
        }
        await memberRef.consumer.commit(offset)
      },
    }
  }

  async leave(memberId: string): Promise<void> {
    // Clear heartbeat timer
    const timer = this.heartbeatTimers.get(memberId)
    if (timer) {
      clearTimeout(timer)
      this.heartbeatTimers.delete(memberId)
    }

    const member = this.memberMap.get(memberId)
    if (member) {
      await member.consumer.close()
      this.memberMap.delete(memberId)

      // Elect new leader if needed
      if (this.leader === memberId) {
        const remainingMembers = Array.from(this.memberMap.keys())
        this.leader = remainingMembers[0] ?? undefined
      }

      // Increment generation
      this.generation++

      // Update stored group
      const storedGroup = groups.get(this.groupId)
      if (storedGroup) {
        storedGroup.generation = this.generation
        storedGroup.leader = this.leader ?? null
      }

      // Rebalance remaining members
      this.rebalance()
    }
  }

  members(): Array<{ id: string }> {
    return Array.from(this.memberMap.values()).map((m) => ({ id: m.id }))
  }
}

// =============================================================================
// TOPIC
// =============================================================================

export class Topic<T = unknown> {
  public readonly name: string
  public readonly partitions: number
  public readonly compaction: boolean
  public readonly minCleanableDirtyRatio: number
  private producer: Producer

  constructor(
    name: string,
    options?: {
      partitions?: number
      retention?: string
      compaction?: boolean
      minCleanableDirtyRatio?: number
    }
  ) {
    this.name = name
    this.partitions = options?.partitions ?? 1
    this.compaction = options?.compaction ?? false
    this.minCleanableDirtyRatio = options?.minCleanableDirtyRatio ?? 0.5
    this.producer = new Producer()

    // Create topic if it doesn't exist
    if (!topics.has(name)) {
      const partitionOffsets = new Map<number, { earliest: number; latest: number }>()
      for (let i = 0; i < this.partitions; i++) {
        partitionOffsets.set(i, { earliest: 0, latest: 0 })
        messages.set(`${name}-${i}`, [])
      }

      topics.set(name, {
        name,
        partitions: this.partitions,
        config: {
          'cleanup.policy': this.compaction ? 'compact' : 'delete',
        },
        partitionOffsets,
      })
    }
  }

  async produce(message: {
    key: string | null
    value: T
    headers?: Record<string, string>
  }): Promise<{ topic: string; partition: number; offset: number }> {
    return this.producer.send(this.name, message)
  }

  async produceBatch(
    messageBatch: Array<{ key: string | null; value: T; headers?: Record<string, string> }>
  ): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    return this.producer.sendBatch(this.name, messageBatch)
  }

  async get(key: string): Promise<T | null> {
    // Scan all partitions for key
    const topic = topics.get(this.name)
    if (!topic) return null

    let latestMessage: StoredMessage | null = null

    for (let partition = 0; partition < topic.partitions; partition++) {
      const partitionMessages = messages.get(`${this.name}-${partition}`) ?? []

      for (const msg of partitionMessages) {
        if (msg.key === key) {
          if (!latestMessage || msg.offset > latestMessage.offset) {
            latestMessage = msg
          }
        }
      }
    }

    if (latestMessage && latestMessage.value !== null) {
      return latestMessage.value as T
    }

    return null
  }

  async readCurrentState(): Promise<Record<string, T>> {
    const state: Record<string, T> = {}
    const topic = topics.get(this.name)
    if (!topic) return state

    // Collect latest value per key
    const latestByKey = new Map<string, StoredMessage>()

    for (let partition = 0; partition < topic.partitions; partition++) {
      const partitionMessages = messages.get(`${this.name}-${partition}`) ?? []

      for (const msg of partitionMessages) {
        if (msg.key !== null) {
          const existing = latestByKey.get(msg.key)
          if (!existing || msg.offset > existing.offset) {
            latestByKey.set(msg.key, msg)
          }
        }
      }
    }

    for (const [key, msg] of latestByKey) {
      if (msg.value !== null) {
        state[key] = msg.value as T
      }
    }

    return state
  }
}

// =============================================================================
// EXACTLY ONCE CONTEXT
// =============================================================================

export class ExactlyOnceContext {
  private pendingProduces: Array<{ topic: string; message: { key: string | null; value: unknown } }> = []
  private pendingCommits: Array<{ consumer: Consumer | null; offset: number }> = []
  private producer = new Producer()

  async transaction(fn: (tx: Transaction) => Promise<void>): Promise<void> {
    this.pendingProduces = []
    this.pendingCommits = []

    const tx: Transaction = {
      produce: async (topic: string, message: { key: string | null; value: unknown }) => {
        this.pendingProduces.push({ topic, message })
      },
      commit: async (offset: number) => {
        // Track the consumer that was polled for this commit
        this.pendingCommits.push({ consumer: lastPolledConsumer, offset })
      },
    }

    try {
      await fn(tx)

      // All succeeded - commit everything
      for (const { topic, message } of this.pendingProduces) {
        await this.producer.send(topic, message)
      }

      // Commit offsets to their associated consumers
      for (const { consumer, offset } of this.pendingCommits) {
        if (consumer) {
          await consumer.commit(offset)
        }
      }
    } catch (error) {
      // Rollback - don't persist anything
      this.pendingProduces = []
      this.pendingCommits = []
      throw error
    }
  }

  async withIdempotency(messageId: string, fn: () => Promise<void>): Promise<void> {
    if (processedIdempotencyKeys.has(messageId)) {
      // Already processed - skip
      return
    }

    await fn()
    processedIdempotencyKeys.add(messageId)
  }
}
