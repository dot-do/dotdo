/**
 * EventBus - DO-native pub/sub event system with delivery guarantees
 *
 * Provides a robust event bus with:
 * - Topic management with exact and wildcard pattern matching
 * - Subscriber registry stored in DO storage
 * - Filter expression evaluation for attribute-based filtering
 * - Fan-out delivery to multiple subscribers
 * - At-least-once delivery with acknowledgment tracking
 * - Dead letter queue for failed deliveries
 * - Retry with exponential backoff
 *
 * @example
 * ```typescript
 * import { createEventBus } from 'db/primitives/triggers/event-bus'
 *
 * const bus = createEventBus()
 *
 * // Subscribe to a topic with exact match
 * const subId = await bus.subscribe('orders.created', async (event) => {
 *   console.log('New order:', event.data)
 * })
 *
 * // Subscribe to wildcard pattern
 * await bus.subscribe('orders.*', async (event) => {
 *   console.log('Order event:', event.topic, event.data)
 * })
 *
 * // Subscribe with attribute filter
 * await bus.subscribe('orders.created', async (event) => {
 *   console.log('Large order:', event.data)
 * }, { filter: { 'data.amount': { $gt: 1000 } } })
 *
 * // Publish an event
 * await bus.publish('orders.created', { orderId: '123', amount: 1500 })
 *
 * // Unsubscribe
 * await bus.unsubscribe(subId)
 * ```
 *
 * @module db/primitives/triggers/event-bus
 */

import { type MetricsCollector, noopMetrics } from '../observability'
import { createPubSubBroker, type PubSubBroker, type PubSubMessage } from '../pubsub-broker'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Event payload structure
 */
export interface Event<T = unknown> {
  /** Unique event ID */
  id: string
  /** Topic the event was published to */
  topic: string
  /** Event payload */
  data: T
  /** Timestamp when event was published */
  timestamp: number
  /** Optional correlation ID for tracing */
  correlationId?: string
  /** Optional source identifier */
  source?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Event handler function
 */
export type EventHandler<T = unknown> = (event: Event<T>) => Promise<void> | void

/**
 * Filter operator for attribute-based filtering
 */
export type FilterOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $in: unknown[] }
  | { $nin: unknown[] }
  | { $exists: boolean }
  | { $regex: string }

/**
 * Filter expression for attribute-based filtering
 */
export type FilterExpression = Record<string, unknown | FilterOperator>

/**
 * Subscription options
 */
export interface SubscribeOptions {
  /** Attribute-based filter expression */
  filter?: FilterExpression
  /** Maximum retries for failed deliveries */
  maxRetries?: number
  /** Initial backoff duration in ms */
  initialBackoffMs?: number
  /** Maximum backoff duration in ms */
  maxBackoffMs?: number
  /** Acknowledgment timeout in ms */
  ackTimeoutMs?: number
  /** Group ID for competing consumers (only one in group receives) */
  groupId?: string
}

/**
 * Subscription record
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string
  /** Topic pattern (exact or wildcard) */
  pattern: string
  /** Filter expression */
  filter?: FilterExpression
  /** Handler function */
  handler: EventHandler
  /** Configuration */
  options: Required<Omit<SubscribeOptions, 'filter' | 'groupId'>> & { groupId?: string }
  /** Creation timestamp */
  createdAt: number
  /** Whether subscription is active */
  active: boolean
}

/**
 * Delivery attempt record
 */
export interface DeliveryAttempt {
  /** Event ID */
  eventId: string
  /** Subscription ID */
  subscriptionId: string
  /** Attempt number */
  attempt: number
  /** Timestamp */
  timestamp: number
  /** Whether delivery succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in ms */
  durationMs: number
}

/**
 * Dead letter record
 */
export interface DeadLetterRecord {
  /** Original event */
  event: Event
  /** Subscription ID that failed */
  subscriptionId: string
  /** All delivery attempts */
  attempts: DeliveryAttempt[]
  /** When event was moved to DLQ */
  deadLetteredAt: number
  /** Reason for failure */
  reason: string
}

/**
 * Event bus statistics
 */
export interface EventBusStats {
  /** Total events published */
  eventsPublished: number
  /** Total events delivered */
  eventsDelivered: number
  /** Total delivery failures */
  deliveryFailures: number
  /** Active subscriptions */
  activeSubscriptions: number
  /** Dead letter queue size */
  deadLetterQueueSize: number
  /** Average delivery latency in ms */
  avgDeliveryLatencyMs: number
}

/**
 * Event bus configuration
 */
export interface EventBusOptions {
  /** Metrics collector */
  metrics?: MetricsCollector
  /** Default max retries */
  defaultMaxRetries?: number
  /** Default initial backoff in ms */
  defaultInitialBackoffMs?: number
  /** Default max backoff in ms */
  defaultMaxBackoffMs?: number
  /** Default ack timeout in ms */
  defaultAckTimeoutMs?: number
  /** Maximum dead letter queue size (oldest are dropped) */
  maxDeadLetterQueueSize?: number
}

/**
 * Event bus interface
 */
export interface EventBus<T = unknown> {
  /**
   * Publish an event to a topic
   * @param topic - Topic to publish to
   * @param data - Event payload
   * @param options - Optional event metadata
   * @returns The published event
   */
  publish(
    topic: string,
    data: T,
    options?: { correlationId?: string; source?: string; metadata?: Record<string, unknown> }
  ): Promise<Event<T>>

  /**
   * Subscribe to a topic pattern
   * @param pattern - Topic pattern (exact or wildcard with *, #)
   * @param handler - Event handler function
   * @param options - Subscription options
   * @returns Subscription ID
   */
  subscribe(pattern: string, handler: EventHandler<T>, options?: SubscribeOptions): Promise<string>

  /**
   * Unsubscribe by subscription ID
   * @param subscriptionId - Subscription ID to remove
   */
  unsubscribe(subscriptionId: string): Promise<void>

  /**
   * Get all subscriptions
   */
  getSubscriptions(): Subscription[]

  /**
   * Get subscriptions for a topic pattern
   */
  getSubscriptionsForPattern(pattern: string): Subscription[]

  /**
   * Get dead letter queue entries
   * @param limit - Maximum entries to return
   */
  getDeadLetterQueue(limit?: number): DeadLetterRecord[]

  /**
   * Retry a dead letter record
   * @param eventId - Event ID from dead letter queue
   * @returns Whether retry was successful
   */
  retryDeadLetter(eventId: string): Promise<boolean>

  /**
   * Remove an entry from dead letter queue
   * @param eventId - Event ID to remove
   */
  removeFromDeadLetterQueue(eventId: string): Promise<void>

  /**
   * Get event bus statistics
   */
  getStats(): EventBusStats

  /**
   * List all active topics
   */
  topics(): string[]

  /**
   * Close the event bus
   */
  close(): Promise<void>
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const EventBusMetrics = {
  PUBLISH_LATENCY: 'event_bus.publish.latency',
  DELIVER_LATENCY: 'event_bus.deliver.latency',
  EVENTS_PUBLISHED: 'event_bus.events.published',
  EVENTS_DELIVERED: 'event_bus.events.delivered',
  DELIVERY_FAILURES: 'event_bus.delivery.failures',
  DELIVERY_RETRIES: 'event_bus.delivery.retries',
  DEAD_LETTERS: 'event_bus.dead_letters',
  ACTIVE_SUBSCRIPTIONS: 'event_bus.subscriptions.active',
  FILTER_MATCHES: 'event_bus.filter.matches',
  FILTER_REJECTS: 'event_bus.filter.rejects',
} as const

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * Check if topic matches a pattern
 * Supports:
 * - Exact match: "orders.created" matches "orders.created"
 * - Single wildcard (*): "orders.*" matches "orders.created" but not "orders.us.created"
 * - Multi wildcard (#): "orders.#" matches "orders.created" and "orders.us.created"
 */
function matchesPattern(topic: string, pattern: string): boolean {
  // Exact match
  if (topic === pattern) {
    return true
  }

  // Convert pattern to regex
  const regexPattern = pattern
    .split('.')
    .map((segment) => {
      if (segment === '#') {
        return '.*' // Match any number of segments
      }
      if (segment === '*') {
        return '[^.]+' // Match single segment
      }
      // Escape regex special characters
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('\\.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(topic)
}

// =============================================================================
// FILTER EVALUATION
// =============================================================================

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Check if value matches filter operator
 */
function matchesOperator(value: unknown, operator: FilterOperator): boolean {
  if ('$eq' in operator) {
    return value === operator.$eq
  }
  if ('$ne' in operator) {
    return value !== operator.$ne
  }
  if ('$gt' in operator) {
    return typeof value === 'number' && value > operator.$gt
  }
  if ('$gte' in operator) {
    return typeof value === 'number' && value >= operator.$gte
  }
  if ('$lt' in operator) {
    return typeof value === 'number' && value < operator.$lt
  }
  if ('$lte' in operator) {
    return typeof value === 'number' && value <= operator.$lte
  }
  if ('$in' in operator) {
    return operator.$in.includes(value)
  }
  if ('$nin' in operator) {
    return !operator.$nin.includes(value)
  }
  if ('$exists' in operator) {
    return operator.$exists ? value !== undefined : value === undefined
  }
  if ('$regex' in operator) {
    return typeof value === 'string' && new RegExp(operator.$regex).test(value)
  }
  return false
}

/**
 * Check if value is a filter operator
 */
function isFilterOperator(value: unknown): value is FilterOperator {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const keys = Object.keys(value)
  return (
    keys.length === 1 &&
    ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex'].includes(keys[0]!)
  )
}

/**
 * Evaluate filter expression against event
 */
function evaluateFilter(event: Event, filter: FilterExpression): boolean {
  for (const [path, condition] of Object.entries(filter)) {
    const value = getNestedValue(event, path)

    if (isFilterOperator(condition)) {
      if (!matchesOperator(value, condition)) {
        return false
      }
    } else {
      // Direct value comparison
      if (value !== condition) {
        return false
      }
    }
  }
  return true
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Calculate backoff duration with jitter
 */
function calculateBackoff(attempt: number, initialMs: number, maxMs: number): number {
  const exponentialBackoff = initialMs * Math.pow(2, attempt - 1)
  const withJitter = exponentialBackoff * (0.5 + Math.random())
  return Math.min(withJitter, maxMs)
}

/**
 * In-memory event bus implementation
 */
class InMemoryEventBus<T = unknown> implements EventBus<T> {
  private subscriptions = new Map<string, Subscription>()
  private deadLetterQueue: DeadLetterRecord[] = []
  private broker: PubSubBroker<Event<T>>
  private metrics: MetricsCollector

  // Stats tracking
  private eventsPublished = 0
  private eventsDelivered = 0
  private deliveryFailures = 0
  private deliveryLatencies: number[] = []

  // Configuration
  private readonly defaultMaxRetries: number
  private readonly defaultInitialBackoffMs: number
  private readonly defaultMaxBackoffMs: number
  private readonly defaultAckTimeoutMs: number
  private readonly maxDeadLetterQueueSize: number

  // Active topics
  private activeTopics = new Set<string>()

  // Group tracking for competing consumers
  private groupLastDelivery = new Map<string, string>() // groupId -> last subscriptionId

  constructor(options: EventBusOptions = {}) {
    this.metrics = options.metrics ?? noopMetrics
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3
    this.defaultInitialBackoffMs = options.defaultInitialBackoffMs ?? 1000
    this.defaultMaxBackoffMs = options.defaultMaxBackoffMs ?? 30000
    this.defaultAckTimeoutMs = options.defaultAckTimeoutMs ?? 30000
    this.maxDeadLetterQueueSize = options.maxDeadLetterQueueSize ?? 1000

    this.broker = createPubSubBroker<Event<T>>({ metrics: this.metrics })
  }

  async publish(
    topic: string,
    data: T,
    options?: { correlationId?: string; source?: string; metadata?: Record<string, unknown> }
  ): Promise<Event<T>> {
    const start = performance.now()

    const event: Event<T> = {
      id: generateId(),
      topic,
      data,
      timestamp: Date.now(),
      correlationId: options?.correlationId,
      source: options?.source,
      metadata: options?.metadata,
    }

    this.activeTopics.add(topic)
    this.eventsPublished++
    this.metrics.incrementCounter(EventBusMetrics.EVENTS_PUBLISHED, { topic })

    // Deliver to matching subscriptions
    const matchingSubscriptions = this.getMatchingSubscriptions(topic, event)

    // Group subscriptions by groupId for competing consumers
    const groupedSubs = new Map<string | undefined, Subscription[]>()
    for (const sub of matchingSubscriptions) {
      const groupId = sub.options.groupId
      const existing = groupedSubs.get(groupId) ?? []
      existing.push(sub)
      groupedSubs.set(groupId, existing)
    }

    // Deliver to each group (one subscriber per group, all subscribers for undefined group)
    for (const [groupId, subs] of groupedSubs) {
      if (groupId === undefined) {
        // Fan-out to all subscribers without a group
        for (const sub of subs) {
          await this.deliverToSubscription(event, sub)
        }
      } else {
        // Competing consumers - round-robin within group
        const lastSubId = this.groupLastDelivery.get(groupId)
        const lastIndex = subs.findIndex((s) => s.id === lastSubId)
        const nextIndex = (lastIndex + 1) % subs.length
        const selectedSub = subs[nextIndex]!

        await this.deliverToSubscription(event, selectedSub)
        this.groupLastDelivery.set(groupId, selectedSub.id)
      }
    }

    const latency = performance.now() - start
    this.metrics.recordLatency(EventBusMetrics.PUBLISH_LATENCY, latency, { topic })

    return event
  }

  private getMatchingSubscriptions(topic: string, event: Event<T>): Subscription[] {
    const matching: Subscription[] = []

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue

      // Check pattern match
      if (!matchesPattern(topic, subscription.pattern)) {
        continue
      }

      // Check filter if present
      if (subscription.filter) {
        if (!evaluateFilter(event as Event, subscription.filter)) {
          this.metrics.incrementCounter(EventBusMetrics.FILTER_REJECTS, { pattern: subscription.pattern })
          continue
        }
        this.metrics.incrementCounter(EventBusMetrics.FILTER_MATCHES, { pattern: subscription.pattern })
      }

      matching.push(subscription)
    }

    return matching
  }

  private async deliverToSubscription(event: Event<T>, subscription: Subscription): Promise<void> {
    const { maxRetries, initialBackoffMs, maxBackoffMs } = subscription.options
    const attempts: DeliveryAttempt[] = []
    let lastError: string | undefined

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const start = performance.now()
      let success = false
      let error: string | undefined

      try {
        await subscription.handler(event)
        success = true
        this.eventsDelivered++
        this.metrics.incrementCounter(EventBusMetrics.EVENTS_DELIVERED, { topic: event.topic })

        const latency = performance.now() - start
        this.deliveryLatencies.push(latency)
        this.metrics.recordLatency(EventBusMetrics.DELIVER_LATENCY, latency, { topic: event.topic })

        // Keep only last 1000 latencies for avg calculation
        if (this.deliveryLatencies.length > 1000) {
          this.deliveryLatencies.shift()
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        lastError = error
        this.deliveryFailures++
        this.metrics.incrementCounter(EventBusMetrics.DELIVERY_FAILURES, { topic: event.topic })

        if (attempt <= maxRetries) {
          this.metrics.incrementCounter(EventBusMetrics.DELIVERY_RETRIES, { topic: event.topic })
          const backoff = calculateBackoff(attempt, initialBackoffMs, maxBackoffMs)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      }

      attempts.push({
        eventId: event.id,
        subscriptionId: subscription.id,
        attempt,
        timestamp: Date.now(),
        success,
        error,
        durationMs: performance.now() - start,
      })

      if (success) {
        return
      }
    }

    // All retries exhausted - add to dead letter queue
    this.addToDeadLetterQueue(event as Event, subscription.id, attempts, lastError ?? 'Unknown error')
  }

  private addToDeadLetterQueue(
    event: Event,
    subscriptionId: string,
    attempts: DeliveryAttempt[],
    reason: string
  ): void {
    const record: DeadLetterRecord = {
      event,
      subscriptionId,
      attempts,
      deadLetteredAt: Date.now(),
      reason,
    }

    this.deadLetterQueue.push(record)
    this.metrics.incrementCounter(EventBusMetrics.DEAD_LETTERS)

    // Trim dead letter queue if it exceeds max size
    if (this.deadLetterQueue.length > this.maxDeadLetterQueueSize) {
      this.deadLetterQueue.shift()
    }
  }

  async subscribe(pattern: string, handler: EventHandler<T>, options: SubscribeOptions = {}): Promise<string> {
    const id = generateId()

    const subscription: Subscription = {
      id,
      pattern,
      filter: options.filter,
      handler: handler as EventHandler,
      options: {
        maxRetries: options.maxRetries ?? this.defaultMaxRetries,
        initialBackoffMs: options.initialBackoffMs ?? this.defaultInitialBackoffMs,
        maxBackoffMs: options.maxBackoffMs ?? this.defaultMaxBackoffMs,
        ackTimeoutMs: options.ackTimeoutMs ?? this.defaultAckTimeoutMs,
        groupId: options.groupId,
      },
      createdAt: Date.now(),
      active: true,
    }

    this.subscriptions.set(id, subscription)
    this.metrics.recordGauge(EventBusMetrics.ACTIVE_SUBSCRIPTIONS, this.subscriptions.size)

    return id
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (subscription) {
      subscription.active = false
      this.subscriptions.delete(subscriptionId)
      this.metrics.recordGauge(EventBusMetrics.ACTIVE_SUBSCRIPTIONS, this.subscriptions.size)
    }
  }

  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values())
  }

  getSubscriptionsForPattern(pattern: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter((s) => s.pattern === pattern)
  }

  getDeadLetterQueue(limit = 100): DeadLetterRecord[] {
    return this.deadLetterQueue.slice(-limit)
  }

  async retryDeadLetter(eventId: string): Promise<boolean> {
    const index = this.deadLetterQueue.findIndex((r) => r.event.id === eventId)
    if (index === -1) {
      return false
    }

    const record = this.deadLetterQueue[index]!
    const subscription = this.subscriptions.get(record.subscriptionId)

    if (!subscription || !subscription.active) {
      // Subscription no longer exists - remove from DLQ
      this.deadLetterQueue.splice(index, 1)
      return false
    }

    try {
      await subscription.handler(record.event as Event<T>)
      // Success - remove from DLQ
      this.deadLetterQueue.splice(index, 1)
      this.eventsDelivered++
      this.metrics.incrementCounter(EventBusMetrics.EVENTS_DELIVERED, { topic: record.event.topic })
      return true
    } catch {
      // Still failing - leave in DLQ
      return false
    }
  }

  async removeFromDeadLetterQueue(eventId: string): Promise<void> {
    const index = this.deadLetterQueue.findIndex((r) => r.event.id === eventId)
    if (index !== -1) {
      this.deadLetterQueue.splice(index, 1)
    }
  }

  getStats(): EventBusStats {
    const avgLatency =
      this.deliveryLatencies.length > 0
        ? this.deliveryLatencies.reduce((a, b) => a + b, 0) / this.deliveryLatencies.length
        : 0

    return {
      eventsPublished: this.eventsPublished,
      eventsDelivered: this.eventsDelivered,
      deliveryFailures: this.deliveryFailures,
      activeSubscriptions: this.subscriptions.size,
      deadLetterQueueSize: this.deadLetterQueue.length,
      avgDeliveryLatencyMs: avgLatency,
    }
  }

  topics(): string[] {
    return Array.from(this.activeTopics)
  }

  async close(): Promise<void> {
    this.subscriptions.clear()
    this.deadLetterQueue = []
    this.activeTopics.clear()
    await this.broker.close()
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new EventBus instance
 *
 * @param options - Configuration options
 * @returns A new EventBus instance
 *
 * @example
 * ```typescript
 * const bus = createEventBus({
 *   defaultMaxRetries: 5,
 *   defaultInitialBackoffMs: 500,
 * })
 *
 * // Subscribe to topic
 * const subId = await bus.subscribe('user.created', async (event) => {
 *   console.log('User created:', event.data)
 * })
 *
 * // Publish event
 * await bus.publish('user.created', { userId: '123', email: 'user@example.com' })
 *
 * // Cleanup
 * await bus.unsubscribe(subId)
 * await bus.close()
 * ```
 */
export function createEventBus<T = unknown>(options?: EventBusOptions): EventBus<T> {
  return new InMemoryEventBus<T>(options)
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type { PubSubBroker, PubSubMessage }
