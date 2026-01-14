/**
 * Channel - Unified Pub/Sub Abstraction
 *
 * Replaces the 4 EventEmitter variants (Node, Pusher, SocketIO, Ably)
 * with a single, unified Channel interface.
 */

export * from './types'

import type {
  Channel,
  ChannelOptions,
  ChannelType,
  Handler,
  Subscription,
  Presence,
  Member,
  PersistenceConfig,
  DropStrategy,
  StoredMessage,
} from './types'

// Re-export Channel type
export type { Channel }

/**
 * Generate unique subscription ID
 */
function generateId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Internal subscription entry
 */
interface SubscriptionEntry<T> {
  id: string
  event: string
  handler: Handler<T>
}

/**
 * Channel implementation
 */
class ChannelImpl<T = unknown> implements Channel<T> {
  readonly name: string
  readonly type: ChannelType

  private subscriptions: Map<string, SubscriptionEntry<T>> = new Map()
  private eventSubscriptions: Map<string, Set<string>> = new Map() // event -> subscription ids

  // Backpressure
  private bufferCapacity: number = Infinity
  private dropStrategy: DropStrategy = 'oldest'
  private messageBuffer: StoredMessage<T>[] = []

  // Persistence
  private persistenceConfig: PersistenceConfig | null = null
  private persistedMessages: StoredMessage<T>[] = []

  // Presence (only for presence channels)
  presence?: Presence

  constructor(name: string, options: ChannelOptions = {}) {
    this.name = name
    this.type = options.type ?? 'public'

    // Initialize presence for presence channels
    if (this.type === 'presence') {
      this.presence = this.createPresence()
    }
  }

  /**
   * Publish data to an event
   */
  async publish(event: string, data: T): Promise<void> {
    // Get subscribers for this event
    const eventSubs = this.eventSubscriptions.get(event) ?? new Set()
    const wildcardSubs = this.eventSubscriptions.get('*') ?? new Set()

    // Handle persistence
    if (this.persistenceConfig) {
      const message: StoredMessage<T> = {
        id: generateId(),
        event,
        data,
        timestamp: Date.now(),
      }
      this.persistedMessages.push(message)

      // Enforce maxMessages
      if (this.persistenceConfig.maxMessages !== undefined) {
        while (this.persistedMessages.length > this.persistenceConfig.maxMessages) {
          this.persistedMessages.shift()
        }
      }

      // Enforce maxAge
      if (this.persistenceConfig.maxAge !== undefined) {
        const cutoff = Date.now() - this.persistenceConfig.maxAge
        this.persistedMessages = this.persistedMessages.filter(m => m.timestamp >= cutoff)
      }
    }

    // Handle backpressure - if buffer is full and no subscribers, apply strategy
    if (eventSubs.size === 0 && wildcardSubs.size === 0 && this.bufferCapacity !== Infinity) {
      const message: StoredMessage<T> = {
        id: generateId(),
        event,
        data,
        timestamp: Date.now(),
      }

      if (this.messageBuffer.length >= this.bufferCapacity) {
        if (this.dropStrategy === 'oldest') {
          this.messageBuffer.shift()
        } else {
          // Drop newest - don't add
          return
        }
      }
      this.messageBuffer.push(message)
      return
    }

    // Notify specific event subscribers
    for (const subId of eventSubs) {
      const sub = this.subscriptions.get(subId)
      if (sub) {
        sub.handler(data, event)
      }
    }

    // Notify wildcard subscribers
    for (const subId of wildcardSubs) {
      const sub = this.subscriptions.get(subId)
      if (sub) {
        sub.handler(data, event)
      }
    }
  }

  /**
   * Subscribe to an event
   */
  subscribe(event: string | '*', handler: Handler<T>): Subscription {
    const id = generateId()

    const entry: SubscriptionEntry<T> = {
      id,
      event: event as string,
      handler,
    }

    this.subscriptions.set(id, entry)

    // Index by event
    if (!this.eventSubscriptions.has(event as string)) {
      this.eventSubscriptions.set(event as string, new Set())
    }
    this.eventSubscriptions.get(event as string)!.add(id)

    // Create subscription object with unsubscribe
    const subscription: Subscription = {
      id,
      unsubscribe: () => {
        this.removeSubscription(id)
      },
    }

    return subscription
  }

  /**
   * Unsubscribe using subscription object
   */
  unsubscribe(subscription: Subscription): void {
    this.removeSubscription(subscription.id)
  }

  /**
   * Remove a subscription by ID
   */
  private removeSubscription(id: string): void {
    const entry = this.subscriptions.get(id)
    if (!entry) return

    // Remove from subscriptions
    this.subscriptions.delete(id)

    // Remove from event index
    const eventSubs = this.eventSubscriptions.get(entry.event)
    if (eventSubs) {
      eventSubs.delete(id)
      if (eventSubs.size === 0) {
        this.eventSubscriptions.delete(entry.event)
      }
    }
  }

  /**
   * Set buffer capacity for backpressure
   */
  buffer(capacity: number): this {
    this.bufferCapacity = capacity
    return this
  }

  /**
   * Set drop strategy to drop oldest
   */
  dropOldest(): this {
    this.dropStrategy = 'oldest'
    return this
  }

  /**
   * Set drop strategy to drop newest
   */
  dropNewest(): this {
    this.dropStrategy = 'newest'
    return this
  }

  /**
   * Enable persistence
   */
  persistent(config: PersistenceConfig): this {
    this.persistenceConfig = config
    return this
  }

  /**
   * Get buffered messages (internal use)
   */
  getBufferedMessages(): StoredMessage<T>[] {
    return [...this.messageBuffer]
  }

  /**
   * Get persisted messages (internal use)
   */
  getPersistedMessages(): StoredMessage<T>[] {
    return [...this.persistedMessages]
  }

  /**
   * Replay persisted messages to a new subscriber
   */
  replayTo(handler: Handler<T>, filter?: { event?: string; since?: number }): void {
    for (const msg of this.persistedMessages) {
      if (filter?.event && msg.event !== filter.event) continue
      if (filter?.since && msg.timestamp < filter.since) continue
      handler(msg.data, msg.event)
    }
  }

  /**
   * Create presence implementation
   */
  private createPresence(): Presence {
    const members = new Map<string, Member>()
    const joinHandlers = new Map<string, Handler<Member>>()
    const leaveHandlers = new Map<string, Handler<Member>>()
    let currentMemberId: string | null = null

    return {
      async *members(): AsyncIterable<Member> {
        for (const member of members.values()) {
          yield member
        }
      },

      async join(member: Member): Promise<void> {
        members.set(member.id, member)
        currentMemberId = member.id

        // Notify join handlers
        for (const handler of joinHandlers.values()) {
          handler(member)
        }
      },

      async leave(): Promise<void> {
        if (currentMemberId) {
          const member = members.get(currentMemberId)
          if (member) {
            members.delete(currentMemberId)

            // Notify leave handlers
            for (const handler of leaveHandlers.values()) {
              handler(member)
            }
          }
          currentMemberId = null
        }
      },

      onJoin(handler: Handler<Member>): Subscription {
        const id = generateId()
        joinHandlers.set(id, handler)

        return {
          id,
          unsubscribe: () => {
            joinHandlers.delete(id)
          },
        }
      },

      onLeave(handler: Handler<Member>): Subscription {
        const id = generateId()
        leaveHandlers.set(id, handler)

        return {
          id,
          unsubscribe: () => {
            leaveHandlers.delete(id)
          },
        }
      },
    }
  }
}

/**
 * Create a new channel
 */
export function createChannel<T = unknown>(
  name: string,
  options?: ChannelOptions
): Channel<T> & {
  getBufferedMessages(): StoredMessage<T>[]
  getPersistedMessages(): StoredMessage<T>[]
  replayTo(handler: Handler<T>, filter?: { event?: string; since?: number }): void
} {
  return new ChannelImpl<T>(name, options)
}
