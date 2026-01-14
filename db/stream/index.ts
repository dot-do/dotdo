/**
 * Stream Primitives
 *
 * Kafka-inspired streaming with topics, partitions, and consumer groups.
 * Built on DO SQLite and Cloudflare Pipelines.
 *
 * @see README.md for API specification
 *
 * STATUS: Stub exports only - implementation TBD
 */

// Stub exports for RED tests - these will fail when called
// Implementation will replace these stubs

export class Topic<T = unknown> {
  constructor(
    public readonly name: string,
    public readonly options?: {
      partitions?: number
      retention?: string
      compaction?: boolean
      minCleanableDirtyRatio?: number
    }
  ) {
    throw new Error('Topic: Not implemented')
  }

  get partitions(): number {
    throw new Error('Topic.partitions: Not implemented')
  }

  get compaction(): boolean {
    throw new Error('Topic.compaction: Not implemented')
  }

  get minCleanableDirtyRatio(): number {
    throw new Error('Topic.minCleanableDirtyRatio: Not implemented')
  }

  async produce(_message: { key: string | null; value: T; headers?: Record<string, string> }): Promise<{
    topic: string
    partition: number
    offset: number
  }> {
    throw new Error('Topic.produce: Not implemented')
  }

  async produceBatch(
    _messages: Array<{ key: string | null; value: T; headers?: Record<string, string> }>
  ): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    throw new Error('Topic.produceBatch: Not implemented')
  }

  async get(_key: string): Promise<T | null> {
    throw new Error('Topic.get: Not implemented')
  }

  async readCurrentState(): Promise<Record<string, T>> {
    throw new Error('Topic.readCurrentState: Not implemented')
  }
}

export class Producer {
  constructor(
    public readonly options?: {
      partitioner?: 'murmur2' | 'default'
      compression?: 'none' | 'gzip' | 'snappy'
      batchSize?: number
      lingerMs?: number
      idempotent?: boolean
    }
  ) {}

  async send(
    _topic: string,
    _message: { key: string | null; value: unknown; headers?: Record<string, string> }
  ): Promise<{ topic: string; partition: number; offset: number }> {
    throw new Error('Producer.send: Not implemented')
  }

  async sendBatch(
    _topic: string,
    _messages: Array<{ key: string | null; value: unknown; headers?: Record<string, string> }>
  ): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    throw new Error('Producer.sendBatch: Not implemented')
  }
}

export interface Message<T = unknown> {
  topic: string
  partition: number
  offset: number
  key: string
  value: T
  headers?: Record<string, string>
  timestamp: number
}

export class Consumer<T = unknown> {
  public readonly subscriptions: string[] = []
  public closed = false

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

  async subscribe(_topics: string | string[]): Promise<void> {
    throw new Error('Consumer.subscribe: Not implemented')
  }

  async unsubscribe(_topic: string): Promise<void> {
    throw new Error('Consumer.unsubscribe: Not implemented')
  }

  async poll(_options?: { timeout?: number }): Promise<Message<T> | null> {
    throw new Error('Consumer.poll: Not implemented')
  }

  async pollBatch(_options?: { timeout?: number }): Promise<Array<Message<T>>> {
    throw new Error('Consumer.pollBatch: Not implemented')
  }

  async commit(_offset: number | { topic: string; partition: number; offset: number }): Promise<void> {
    throw new Error('Consumer.commit: Not implemented')
  }

  async commitWithGeneration(_offset: number, _generation: number): Promise<void> {
    throw new Error('Consumer.commitWithGeneration: Not implemented')
  }

  async committed(): Promise<Array<{ topic: string; partition: number; offset: number }>> {
    throw new Error('Consumer.committed: Not implemented')
  }

  async seekToBeginning(): Promise<void> {
    throw new Error('Consumer.seekToBeginning: Not implemented')
  }

  async seekToEnd(): Promise<void> {
    throw new Error('Consumer.seekToEnd: Not implemented')
  }

  async seek(_position: { partition: number; offset: number }): Promise<void> {
    throw new Error('Consumer.seek: Not implemented')
  }

  async seekToTimestamp(_timestamp: number): Promise<void> {
    throw new Error('Consumer.seekToTimestamp: Not implemented')
  }

  pause(): void {
    throw new Error('Consumer.pause: Not implemented')
  }

  resume(): void {
    throw new Error('Consumer.resume: Not implemented')
  }

  async close(): Promise<void> {
    throw new Error('Consumer.close: Not implemented')
  }

  [Symbol.asyncIterator](): AsyncIterator<Message<T>> {
    throw new Error('Consumer[Symbol.asyncIterator]: Not implemented')
  }
}

export interface GroupMember {
  id: string
  assignment: number[]
  consumer: Consumer
}

export class ConsumerGroup {
  public readonly groupId: string
  public readonly topics: string[]
  public readonly rebalanceStrategy: 'range' | 'roundRobin'
  public generation = 0
  public leader?: string

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
  }

  on(_event: 'rebalance', _handler: (assignment: { type: string; partitions: number[] }) => void): void {
    throw new Error('ConsumerGroup.on: Not implemented')
  }

  async join(_memberId: string): Promise<GroupMember> {
    throw new Error('ConsumerGroup.join: Not implemented')
  }

  async leave(_memberId: string): Promise<void> {
    throw new Error('ConsumerGroup.leave: Not implemented')
  }

  members(): Array<{ id: string }> {
    throw new Error('ConsumerGroup.members: Not implemented')
  }
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

export class AdminClient {
  async createTopic(
    _name: string,
    _options?: {
      partitions?: number
      replicationFactor?: number
      config?: Record<string, unknown>
    }
  ): Promise<void> {
    throw new Error('AdminClient.createTopic: Not implemented')
  }

  async listTopics(): Promise<Array<{ name: string; partitions?: number }>> {
    throw new Error('AdminClient.listTopics: Not implemented')
  }

  async describeTopic(_name: string): Promise<TopicInfo> {
    throw new Error('AdminClient.describeTopic: Not implemented')
  }

  async deleteTopic(_name: string): Promise<void> {
    throw new Error('AdminClient.deleteTopic: Not implemented')
  }

  async compactTopic(_name: string): Promise<void> {
    throw new Error('AdminClient.compactTopic: Not implemented')
  }
}

export interface Transaction {
  produce(topic: string, message: { key: string | null; value: unknown }): Promise<void>
  commit(offset: number): Promise<void>
}

export class ExactlyOnceContext {
  async transaction(_fn: (tx: Transaction) => Promise<void>): Promise<void> {
    throw new Error('ExactlyOnceContext.transaction: Not implemented')
  }

  async withIdempotency(_messageId: string, _fn: () => Promise<void>): Promise<void> {
    throw new Error('ExactlyOnceContext.withIdempotency: Not implemented')
  }
}
