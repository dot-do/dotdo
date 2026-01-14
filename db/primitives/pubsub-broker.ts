/**
 * PubSubBroker - Redis-compatible publish/subscribe primitive
 *
 * Provides message broadcasting with channel subscriptions:
 * - **publish** - Send messages to a channel
 * - **subscribe** - Subscribe to exact channel names
 * - **psubscribe** - Pattern-based subscriptions with glob syntax
 * - **Channel management** - Track active channels and subscribers
 *
 * ## Features
 * - Async iterator interface for consuming messages
 * - Pattern matching with *, **, ?, and character classes
 * - Configurable message buffering per subscription
 * - Observability integration for metrics
 *
 * ## Performance Characteristics
 * | Operation | Time Complexity | Description |
 * |-----------|-----------------|-------------|
 * | publish | O(n) | n = matching subscribers |
 * | subscribe | O(1) | Direct channel subscription |
 * | psubscribe | O(1) | Pattern registration |
 * | unsubscribe | O(1) | Remove subscription |
 * | channels | O(c) | c = number of channels |
 *
 * Maps to Redis: PUBLISH, SUBSCRIBE, UNSUBSCRIBE, PSUBSCRIBE, PUNSUBSCRIBE, PUBSUB
 *
 * @module db/primitives/pubsub-broker
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Message wrapper with channel metadata
 */
export interface PubSubMessage<T> {
  /** The channel the message was published to */
  channel: string
  /** The actual message payload */
  message: T
  /** The pattern that matched (only for pattern subscriptions) */
  pattern?: string
  /** Timestamp when the message was published */
  timestamp: number
}

/**
 * Subscription handle with metadata
 */
export interface SubscriptionHandle<T> {
  /** Unique identifier for this subscription */
  id: string
  /** Channel name (for exact subscriptions) */
  channel?: string
  /** Pattern (for pattern subscriptions) */
  pattern?: string
  /** The async iterator for consuming messages */
  iterator: AsyncIterator<PubSubMessage<T>>
  /** When the subscription was created */
  createdAt: number
}

/**
 * Statistics for a channel
 */
export interface ChannelStats {
  /** Channel name */
  channel: string
  /** Number of subscribers */
  subscriberCount: number
  /** Total messages published to this channel */
  messagesPublished: number
}

/**
 * Configuration options for PubSubBroker
 */
export interface PubSubOptions {
  /**
   * Maximum messages to buffer per subscription.
   * When buffer is full, oldest messages are dropped.
   * Set to 0 for unlimited buffering.
   * @default 1000
   */
  bufferSize?: number

  /**
   * Metrics collector for observability.
   * @default noopMetrics
   */
  metrics?: MetricsCollector
}

/**
 * PubSubBroker interface for message broadcasting
 *
 * @typeParam T - The type of message payload
 */
export interface PubSubBroker<T> {
  /**
   * Publish a message to a channel.
   * Returns the number of subscribers that received the message.
   *
   * @param channel - Channel to publish to
   * @param message - Message payload
   * @returns Number of subscribers that received the message
   */
  publish(channel: string, message: T): Promise<number>

  /**
   * Subscribe to a channel and receive messages.
   * Returns an async iterator that yields messages.
   *
   * @param channel - Channel to subscribe to
   * @returns Async iterator for consuming messages
   */
  subscribe(channel: string): AsyncIterator<PubSubMessage<T>>

  /**
   * Subscribe with a handle containing metadata.
   *
   * @param channel - Channel to subscribe to
   * @returns Subscription handle with metadata and iterator
   */
  subscribeWithHandle(channel: string): SubscriptionHandle<T>

  /**
   * Unsubscribe from a channel.
   *
   * @param subscription - The subscription iterator to unsubscribe
   */
  unsubscribe(subscription: AsyncIterator<PubSubMessage<T>>): Promise<void>

  /**
   * Unsubscribe by subscription ID.
   *
   * @param id - Subscription ID from SubscriptionHandle
   */
  unsubscribeById(id: string): Promise<void>

  /**
   * Subscribe to channels matching a pattern.
   * Patterns support:
   * - `*` - Match any characters except `.`
   * - `**` - Match any characters including `.`
   * - `?` - Match exactly one character
   * - `[abc]` - Match any character in the set
   *
   * @param pattern - Glob pattern to match channels
   * @returns Async iterator for consuming messages
   */
  psubscribe(pattern: string): AsyncIterator<PubSubMessage<T>>

  /**
   * Pattern subscribe with handle containing metadata.
   *
   * @param pattern - Glob pattern to match channels
   * @returns Subscription handle with metadata and iterator
   */
  psubscribeWithHandle(pattern: string): SubscriptionHandle<T>

  /**
   * Unsubscribe from a pattern subscription.
   *
   * @param subscription - The pattern subscription iterator
   */
  punsubscribe(subscription: AsyncIterator<PubSubMessage<T>>): Promise<void>

  /**
   * List all active channels with subscribers.
   *
   * @returns Array of channel names
   */
  channels(): Promise<string[]>

  /**
   * Get the number of subscribers for a channel.
   *
   * @param channel - Channel name
   * @returns Number of subscribers
   */
  numsub(channel: string): Promise<number>

  /**
   * Get the number of active pattern subscriptions.
   *
   * @returns Number of pattern subscriptions
   */
  numpat(): Promise<number>

  /**
   * Get statistics for a channel.
   *
   * @param channel - Channel name
   * @returns Channel statistics
   */
  stats(channel: string): Promise<ChannelStats>

  /**
   * Close the broker and cleanup all subscriptions.
   */
  close(): Promise<void>
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal subscription state
 * @internal
 */
interface Subscription<T> {
  id: string
  channel?: string
  pattern?: string
  regex?: RegExp
  buffer: PubSubMessage<T>[]
  resolvers: Array<(value: IteratorResult<PubSubMessage<T>>) => void>
  closed: boolean
  createdAt: number
}

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * Convert a glob pattern to a RegExp
 * - * matches any characters except .
 * - ** matches any characters including .
 * - ? matches exactly one character
 * - [abc] matches any character in the set
 * @internal
 */
function globToRegex(pattern: string): RegExp {
  let regex = ''
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches everything including dots
        regex += '.*'
        i += 2
      } else {
        // * matches everything except dots
        regex += '[^.]*'
        i++
      }
    } else if (char === '?') {
      // ? matches exactly one character
      regex += '.'
      i++
    } else if (char === '[') {
      // Character class - find the closing bracket
      const end = pattern.indexOf(']', i)
      if (end === -1) {
        // No closing bracket - treat literally
        regex += '\\['
        i++
      } else {
        regex += pattern.slice(i, end + 1)
        i = end + 1
      }
    } else if ('.+^${}|()\\'.includes(char!)) {
      // Escape regex special characters
      regex += '\\' + char
      i++
    } else {
      regex += char
      i++
    }
  }

  return new RegExp('^' + regex + '$')
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of PubSubBroker
 * @internal
 */
class InMemoryPubSubBroker<T> implements PubSubBroker<T> {
  /** Channel name -> Set of subscription IDs */
  private channelSubscribers: Map<string, Set<string>> = new Map()

  /** Subscription ID -> Subscription */
  private subscriptions: Map<string, Subscription<T>> = new Map()

  /** Iterator reference -> Subscription ID (for unsubscribe) */
  private iteratorToId: WeakMap<AsyncIterator<PubSubMessage<T>>, string> = new WeakMap()

  /** Pattern subscriptions (separate from channel subscriptions) */
  private patternSubscriptions: Set<string> = new Set()

  /** Channel stats */
  private channelStats: Map<string, { messagesPublished: number }> = new Map()

  /** Counter for generating subscription IDs */
  private subscriptionCounter = 0

  /** Buffer size limit */
  private readonly bufferSize: number

  /** Metrics collector */
  private readonly metrics: MetricsCollector

  /** Whether the broker is closed */
  private closed = false

  constructor(options?: PubSubOptions) {
    this.bufferSize = options?.bufferSize ?? 1000
    this.metrics = options?.metrics ?? noopMetrics
  }

  async publish(channel: string, message: T): Promise<number> {
    if (this.closed) {
      throw new Error('PubSubBroker is closed')
    }

    const start = performance.now()
    let deliveredCount = 0

    try {
      const pubsubMessage: PubSubMessage<T> = {
        channel,
        message,
        timestamp: Date.now(),
      }

      // Update channel stats
      const stats = this.channelStats.get(channel) || { messagesPublished: 0 }
      stats.messagesPublished++
      this.channelStats.set(channel, stats)

      // Deliver to exact channel subscribers
      const subscriberIds = this.channelSubscribers.get(channel)
      if (subscriberIds) {
        for (const subId of subscriberIds) {
          const subscription = this.subscriptions.get(subId)
          if (subscription && !subscription.closed) {
            this.deliverMessage(subscription, pubsubMessage)
            deliveredCount++
          }
        }
      }

      // Deliver to pattern subscribers
      for (const subId of this.patternSubscriptions) {
        const subscription = this.subscriptions.get(subId)
        if (subscription && !subscription.closed && subscription.regex) {
          if (subscription.regex.test(channel)) {
            const patternMessage: PubSubMessage<T> = {
              ...pubsubMessage,
              pattern: subscription.pattern,
            }
            this.deliverMessage(subscription, patternMessage)
            deliveredCount++
          }
        }
      }

      // Record metrics
      this.metrics.incrementCounter('pubsub.messages.published')

      return deliveredCount
    } finally {
      this.metrics.recordLatency('pubsub.publish.latency', performance.now() - start)
    }
  }

  subscribe(channel: string): AsyncIterator<PubSubMessage<T>> {
    return this.subscribeWithHandle(channel).iterator
  }

  subscribeWithHandle(channel: string): SubscriptionHandle<T> {
    if (this.closed) {
      throw new Error('PubSubBroker is closed')
    }

    const id = `sub-${++this.subscriptionCounter}-${Date.now()}`
    const subscription: Subscription<T> = {
      id,
      channel,
      buffer: [],
      resolvers: [],
      closed: false,
      createdAt: Date.now(),
    }

    this.subscriptions.set(id, subscription)

    // Add to channel subscribers
    let subscribers = this.channelSubscribers.get(channel)
    if (!subscribers) {
      subscribers = new Set()
      this.channelSubscribers.set(channel, subscribers)
    }
    subscribers.add(id)

    // Create async iterator
    const iterator = this.createIterator(subscription)
    this.iteratorToId.set(iterator, id)

    // Record metrics
    this.metrics.incrementCounter('pubsub.subscriptions.created')
    this.metrics.recordGauge('pubsub.channels.active', this.channelSubscribers.size)

    return {
      id,
      channel,
      iterator,
      createdAt: subscription.createdAt,
    }
  }

  async unsubscribe(subscription: AsyncIterator<PubSubMessage<T>>): Promise<void> {
    const id = this.iteratorToId.get(subscription)
    if (id) {
      await this.unsubscribeById(id)
    }
  }

  async unsubscribeById(id: string): Promise<void> {
    const subscription = this.subscriptions.get(id)
    if (!subscription || subscription.closed) {
      return
    }

    subscription.closed = true

    // Remove from channel subscribers
    if (subscription.channel) {
      const subscribers = this.channelSubscribers.get(subscription.channel)
      if (subscribers) {
        subscribers.delete(id)
        if (subscribers.size === 0) {
          this.channelSubscribers.delete(subscription.channel)
        }
      }
    }

    // Remove from pattern subscriptions
    if (subscription.pattern) {
      this.patternSubscriptions.delete(id)
    }

    // Resolve any pending reads with done
    for (const resolver of subscription.resolvers) {
      resolver({ done: true, value: undefined as unknown as PubSubMessage<T> })
    }
    subscription.resolvers = []

    this.subscriptions.delete(id)

    // Record metrics
    this.metrics.incrementCounter('pubsub.subscriptions.removed')
    this.metrics.recordGauge('pubsub.channels.active', this.channelSubscribers.size)
  }

  psubscribe(pattern: string): AsyncIterator<PubSubMessage<T>> {
    return this.psubscribeWithHandle(pattern).iterator
  }

  psubscribeWithHandle(pattern: string): SubscriptionHandle<T> {
    if (this.closed) {
      throw new Error('PubSubBroker is closed')
    }

    const id = `psub-${++this.subscriptionCounter}-${Date.now()}`
    const regex = globToRegex(pattern)

    const subscription: Subscription<T> = {
      id,
      pattern,
      regex,
      buffer: [],
      resolvers: [],
      closed: false,
      createdAt: Date.now(),
    }

    this.subscriptions.set(id, subscription)
    this.patternSubscriptions.add(id)

    const iterator = this.createIterator(subscription)
    this.iteratorToId.set(iterator, id)

    // Record metrics
    this.metrics.incrementCounter('pubsub.subscriptions.created')

    return {
      id,
      pattern,
      iterator,
      createdAt: subscription.createdAt,
    }
  }

  async punsubscribe(subscription: AsyncIterator<PubSubMessage<T>>): Promise<void> {
    await this.unsubscribe(subscription)
  }

  async channels(): Promise<string[]> {
    return Array.from(this.channelSubscribers.keys())
  }

  async numsub(channel: string): Promise<number> {
    const subscribers = this.channelSubscribers.get(channel)
    return subscribers ? subscribers.size : 0
  }

  async numpat(): Promise<number> {
    return this.patternSubscriptions.size
  }

  async stats(channel: string): Promise<ChannelStats> {
    const subscribers = this.channelSubscribers.get(channel)
    const stats = this.channelStats.get(channel) || { messagesPublished: 0 }

    return {
      channel,
      subscriberCount: subscribers ? subscribers.size : 0,
      messagesPublished: stats.messagesPublished,
    }
  }

  async close(): Promise<void> {
    this.closed = true

    // Unsubscribe all
    const ids = Array.from(this.subscriptions.keys())
    for (const id of ids) {
      await this.unsubscribeById(id)
    }

    this.channelSubscribers.clear()
    this.patternSubscriptions.clear()
    this.channelStats.clear()
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Create an async iterator for a subscription
   * @internal
   */
  private createIterator(subscription: Subscription<T>): AsyncIterator<PubSubMessage<T>> {
    const self = this

    const iterator: AsyncIterator<PubSubMessage<T>> = {
      async next(): Promise<IteratorResult<PubSubMessage<T>>> {
        if (subscription.closed) {
          return { done: true, value: undefined as unknown as PubSubMessage<T> }
        }

        // If there's a buffered message, return it
        if (subscription.buffer.length > 0) {
          const message = subscription.buffer.shift()!
          return { done: false, value: message }
        }

        // Wait for next message
        return new Promise<IteratorResult<PubSubMessage<T>>>((resolve) => {
          if (subscription.closed) {
            resolve({ done: true, value: undefined as unknown as PubSubMessage<T> })
            return
          }
          subscription.resolvers.push(resolve)
        })
      },

      async return(): Promise<IteratorResult<PubSubMessage<T>>> {
        await self.unsubscribeById(subscription.id)
        return { done: true, value: undefined as unknown as PubSubMessage<T> }
      },

      async throw(error?: Error): Promise<IteratorResult<PubSubMessage<T>>> {
        await self.unsubscribeById(subscription.id)
        if (error) {
          throw error
        }
        return { done: true, value: undefined as unknown as PubSubMessage<T> }
      },
    }

    return iterator
  }

  /**
   * Deliver a message to a subscription
   * @internal
   */
  private deliverMessage(subscription: Subscription<T>, message: PubSubMessage<T>): void {
    // If there's a waiting resolver, deliver directly
    if (subscription.resolvers.length > 0) {
      const resolver = subscription.resolvers.shift()!
      resolver({ done: false, value: message })
      return
    }

    // Otherwise buffer the message
    if (this.bufferSize === 0 || subscription.buffer.length < this.bufferSize) {
      subscription.buffer.push(message)
    } else {
      // Buffer is full - drop oldest message
      subscription.buffer.shift()
      subscription.buffer.push(message)
      this.metrics.incrementCounter('pubsub.buffer.overflow')
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new PubSubBroker instance.
 *
 * @typeParam T - The type of message payloads
 * @param options - Configuration options
 * @returns A new PubSubBroker instance
 *
 * @example
 * ```typescript
 * interface ChatMessage {
 *   userId: string
 *   text: string
 * }
 *
 * const broker = createPubSubBroker<ChatMessage>()
 *
 * // Subscribe to a channel
 * const subscription = broker.subscribe('room:general')
 *
 * // Consume messages
 * for await (const { message } of { [Symbol.asyncIterator]: () => subscription }) {
 *   console.log(`${message.userId}: ${message.text}`)
 * }
 *
 * // In another context, publish messages
 * await broker.publish('room:general', { userId: 'alice', text: 'Hello!' })
 *
 * // Pattern subscriptions
 * const allRooms = broker.psubscribe('room.*')
 * ```
 */
export function createPubSubBroker<T>(options?: PubSubOptions): PubSubBroker<T> {
  return new InMemoryPubSubBroker<T>(options)
}
