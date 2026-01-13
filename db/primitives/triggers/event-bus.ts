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
 * - Event ordering guarantees (global, per-topic, per-key, none)
 *
 * @example
 * ```typescript
 * import { createEventBus, EventBus } from 'db/primitives/triggers/event-bus'
 *
 * const bus = createEventBus()
 * // or
 * const bus = new EventBus()
 *
 * // Subscribe to a topic with exact match
 * const sub = await bus.subscribe('orders', async (envelope) => {
 *   console.log('New order:', envelope.event)
 *   return { success: true }
 * })
 *
 * // Subscribe to wildcard pattern
 * await bus.subscribePattern('orders.*', async (envelope) => {
 *   console.log('Order event:', envelope.topic, envelope.event)
 *   return { success: true }
 * })
 *
 * // Subscribe with attribute filter
 * await bus.subscribe('orders', async (envelope) => {
 *   console.log('Large order:', envelope.event)
 *   return { success: true }
 * }, { filter: { attributes: { total: { $gt: 1000 } } } })
 *
 * // Publish an event
 * const result = await bus.publish('orders', { orderId: '123', amount: 1500 })
 * console.log(result.eventId, result.success)
 *
 * // Unsubscribe
 * await bus.unsubscribe(sub.id)
 * ```
 *
 * @module db/primitives/triggers/event-bus
 */

import { type MetricsCollector, noopMetrics } from '../observability'

// =============================================================================
// DURATION HELPERS
// =============================================================================

/**
 * Convert seconds to milliseconds
 */
export function seconds(n: number): number {
  return n * 1000
}

/**
 * Convert minutes to milliseconds
 */
export function minutes(n: number): number {
  return n * 60 * 1000
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Handler result indicating success or failure
 */
export interface HandlerResult {
  success: boolean
  error?: string
}

/**
 * Event envelope passed to handlers
 */
export interface EventEnvelope<T = unknown> {
  /** Unique event ID */
  eventId: string
  /** Topic the event was published to */
  topic: string
  /** Original event payload */
  event: T
  /** Timestamp when event was published */
  publishedAt: Date
  /** Event attributes for filtering */
  attributes?: Record<string, unknown>
  /** Ordering key if specified */
  orderingKey?: string
  /** Current delivery attempt number */
  attempt: number
  /** Pattern that matched (for pattern subscriptions) */
  matchedPattern?: string
  /** Manually acknowledge the event */
  ack(): Promise<void>
  /** Manually negative-acknowledge the event */
  nack(error?: string): Promise<void>
}

/**
 * Event handler function
 */
export type EventHandler<T = unknown> = (envelope: EventEnvelope<T>) => Promise<HandlerResult | void> | HandlerResult | void

/**
 * Publish result
 */
export interface PublishResult {
  /** Whether publish succeeded */
  success: boolean
  /** Unique event ID */
  eventId: string
  /** Timestamp when event was published */
  timestamp: Date
}

/**
 * Publish options
 */
export interface PublishOptions {
  /** Deduplication ID - events with same ID are deduplicated */
  deduplicationId?: string
  /** Ordering key for per-key ordering */
  orderingKey?: string
  /** Event attributes for filtering */
  attributes?: Record<string, unknown>
}

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
  | { $startsWith: string }
  | { $endsWith: string }
  | { $contains: string }

/**
 * Attribute filter expression
 */
export type AttributeFilter = Record<string, unknown | FilterOperator>

/**
 * Event body filter expression
 */
export type EventFilter = Record<string, unknown | FilterOperator>

/**
 * Filter expression for subscription filtering
 */
export interface FilterExpression {
  /** Filter on event attributes */
  attributes?: AttributeFilter
  /** Filter on event body */
  event?: EventFilter
  /** OR combination of filters */
  $or?: FilterExpression[]
  /** AND combination of filters */
  $and?: FilterExpression[]
  /** NOT filter */
  $not?: FilterExpression
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Subscription name for identification */
  name?: string
  /** Attribute-based filter expression */
  filter?: FilterExpression
  /** Maximum concurrent handlers */
  maxConcurrency?: number
  /** Batch size for batch processing */
  batchSize?: number
  /** Whether explicit acknowledgment is required */
  requireAck?: boolean
  /** Whether to use manual ack/nack */
  manualAck?: boolean
  /** Acknowledgment timeout in ms */
  ackTimeoutMs?: number
}

/**
 * Subscription handle returned from subscribe
 */
export interface SubscriptionHandle {
  /** Unique subscription ID */
  id: string
  /** Topic or pattern subscribed to */
  topic: string
  /** Subscription name */
  name?: string
  /** When subscription was created */
  createdAt: Date
  /** Whether subscription is paused */
  paused: boolean
  /** Maximum concurrency */
  maxConcurrency?: number
  /** Batch size */
  batchSize?: number
}

/**
 * Internal subscription record
 */
interface InternalSubscription<T = unknown> {
  id: string
  topic: string
  pattern?: string
  name?: string
  handler: EventHandler<T>
  filter?: FilterExpression
  maxConcurrency: number
  batchSize: number
  requireAck: boolean
  manualAck: boolean
  ackTimeoutMs: number
  createdAt: Date
  paused: boolean
  active: boolean
}

/**
 * Delivery attempt record
 */
export interface DeliveryAttempt {
  /** Attempt number */
  attempt: number
  /** Timestamp */
  timestamp: Date
  /** Whether delivery succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in ms */
  durationMs: number
}

/**
 * Event status
 */
export interface EventStatus {
  /** Event ID */
  eventId: string
  /** Current status */
  status: 'pending' | 'delivered' | 'failed'
  /** Whether event was acknowledged */
  acknowledged: boolean
  /** Number of delivery attempts */
  attempts: number
  /** Delivery attempt history */
  attemptHistory: DeliveryAttempt[]
  /** When event was delivered (if successful) */
  deliveredAt?: Date
  /** Last error message */
  error?: string
}

/**
 * Dead letter event
 */
export interface DeadLetterEvent<T = unknown> {
  /** Event ID */
  eventId: string
  /** Original topic */
  originalTopic: string
  /** Original event payload */
  event: T
  /** Event attributes */
  attributes?: Record<string, unknown>
  /** Error message */
  error: string
  /** Number of delivery attempts */
  attempts: number
  /** Attempt history */
  attemptHistory: DeliveryAttempt[]
  /** When event was dead-lettered */
  deadLetteredAt: Date
}

/**
 * Dead letter queue handler
 */
export type DLQHandler<T = unknown> = (event: DeadLetterEvent<T>) => void | Promise<void>

/**
 * Dead letter queue options for filtering
 */
export interface DLQQueryOptions {
  /** Filter by topic */
  topic?: string
  /** Filter events after this time */
  after?: Date
  /** Maximum events to return */
  limit?: number
}

/**
 * Replay result
 */
export interface ReplayResult {
  /** Number of events successfully replayed */
  replayed: number
  /** Number of events that failed to replay */
  failed: number
}

/**
 * Ordering guarantee modes
 */
export type OrderingGuarantee = 'global' | 'per-topic' | 'per-key' | 'none'

/**
 * Dead letter queue configuration
 */
export interface DeadLetterQueueOptions {
  /** Maximum DLQ size */
  maxSize?: number
  /** Time-to-live for DLQ entries in ms */
  ttlMs?: number
}

/**
 * Event bus configuration
 */
export interface EventBusOptions {
  /** Metrics collector */
  metrics?: MetricsCollector
  /** Default max retries */
  maxRetries?: number
  /** Retry delay in ms */
  retryDelayMs?: number
  /** Default ack timeout in ms */
  ackTimeoutMs?: number
  /** Enable dead letter queue */
  enableDeadLetterQueue?: boolean
  /** Dead letter queue configuration */
  deadLetterQueue?: DeadLetterQueueOptions
  /** Ordering guarantee mode */
  orderingGuarantee?: OrderingGuarantee
}

/**
 * Event bus statistics
 */
export interface EventBusStats {
  /** Total events published */
  totalPublished: number
  /** Total events delivered */
  totalDelivered: number
  /** Total failed deliveries */
  totalFailed: number
  /** Active subscriptions */
  activeSubscriptions: number
  /** Active topics */
  activeTopics: number
}

/**
 * Per-topic statistics
 */
export interface TopicStats {
  /** Events published to this topic */
  published: number
  /** Events delivered from this topic */
  delivered: number
  /** Number of subscribers */
  subscribers: number
}

// Type aliases for backwards compatibility
export type Subscription = SubscriptionHandle
export type OrderingKey = string
export type Event<T = unknown> = T

// =============================================================================
// METRIC NAMES
// =============================================================================

export const EventBusMetrics = {
  PUBLISH_LATENCY: 'eventbus.publish.latency',
  DELIVER_LATENCY: 'eventbus.deliver.latency',
  EVENTS_PUBLISHED: 'eventbus.events.published',
  EVENTS_DELIVERED: 'eventbus.events.delivered',
  DELIVERY_FAILURES: 'eventbus.delivery.failures',
  DELIVERY_RETRIES: 'eventbus.delivery.retries',
  DEAD_LETTERS: 'eventbus.dead_letters',
  ACTIVE_SUBSCRIPTIONS: 'eventbus.subscriptions.active',
  FILTER_MATCHES: 'eventbus.filter.matches',
  FILTER_REJECTS: 'eventbus.filter.rejects',
} as const

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * Check if topic matches a pattern
 * Supports:
 * - Exact match: "orders.created" matches "orders.created"
 * - Single segment wildcard (*): "orders.*" matches "orders.created" but not "orders.us.created"
 * - Multi segment wildcard (**): "orders.**" matches "orders", "orders.created" and "orders.us.created"
 * - Single character wildcard (?): "orders.region-?" matches "orders.region-1"
 * - Character class ([abc]): "orders.region-[123]" matches "orders.region-1"
 */
function matchesPattern(topic: string, pattern: string): boolean {
  // Exact match
  if (topic === pattern) {
    return true
  }

  // Handle special case: pattern ending with .** should also match the prefix
  // e.g., "orders.**" should match "orders"
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3)
    if (topic === prefix) {
      return true
    }
  }

  // Handle special case: pattern starting with **. should also match the suffix
  // e.g., "**.shipped" should match "shipped"
  if (pattern.startsWith('**.')) {
    const suffix = pattern.slice(3)
    if (topic === suffix) {
      return true
    }
  }

  // Convert pattern to regex
  let regexPattern = ''
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === '*') {
      // Check for ** (multi-segment wildcard)
      if (pattern[i + 1] === '*') {
        // ** can match zero or more segments
        // If preceded by a dot, make the dot optional for zero-segment match
        if (regexPattern.endsWith('\\.')) {
          regexPattern = regexPattern.slice(0, -2) + '(?:\\..*)?'
        } else if (i === 0) {
          // ** at start - can match zero or more segments
          regexPattern += '(?:.*\\.)?'
        } else {
          regexPattern += '.*'
        }
        i += 2
        continue
      }
      // Single segment wildcard - matches anything except dots
      regexPattern += '[^.]*'
      i++
      continue
    }

    if (char === '?') {
      // Single character wildcard
      regexPattern += '[^.]'
      i++
      continue
    }

    if (char === '[') {
      // Character class - find the closing bracket
      const closeIndex = pattern.indexOf(']', i)
      if (closeIndex !== -1) {
        regexPattern += pattern.slice(i, closeIndex + 1)
        i = closeIndex + 1
        continue
      }
    }

    // Escape regex special characters
    if ('.+^${}()|\\'.includes(char!)) {
      regexPattern += '\\' + char
    } else {
      regexPattern += char
    }
    i++
  }

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
  if ('$startsWith' in operator) {
    return typeof value === 'string' && value.startsWith(operator.$startsWith)
  }
  if ('$endsWith' in operator) {
    return typeof value === 'string' && value.endsWith(operator.$endsWith)
  }
  if ('$contains' in operator) {
    return typeof value === 'string' && value.includes(operator.$contains)
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
    [
      '$eq',
      '$ne',
      '$gt',
      '$gte',
      '$lt',
      '$lte',
      '$in',
      '$nin',
      '$exists',
      '$regex',
      '$startsWith',
      '$endsWith',
      '$contains',
    ].includes(keys[0]!)
  )
}

/**
 * Evaluate attribute filter against attributes
 */
function evaluateAttributeFilter(attributes: Record<string, unknown> | undefined, filter: AttributeFilter): boolean {
  for (const [path, condition] of Object.entries(filter)) {
    const value = attributes ? attributes[path] : undefined

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

/**
 * Evaluate event filter against event body
 */
function evaluateEventFilter(event: unknown, filter: EventFilter): boolean {
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

/**
 * Evaluate filter expression
 */
function evaluateFilter(
  event: unknown,
  attributes: Record<string, unknown> | undefined,
  filter: FilterExpression
): boolean {
  // Handle $or
  if (filter.$or) {
    const orResult = filter.$or.some((f) => evaluateFilter(event, attributes, f))
    if (!orResult) return false
  }

  // Handle $and
  if (filter.$and) {
    const andResult = filter.$and.every((f) => evaluateFilter(event, attributes, f))
    if (!andResult) return false
  }

  // Handle $not
  if (filter.$not) {
    if (evaluateFilter(event, attributes, filter.$not)) {
      return false
    }
  }

  // Handle attributes filter
  if (filter.attributes) {
    if (!evaluateAttributeFilter(attributes, filter.attributes)) {
      return false
    }
  }

  // Handle event body filter
  if (filter.event) {
    if (!evaluateEventFilter(event, filter.event)) {
      return false
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
function calculateBackoff(attempt: number, baseMs: number): number {
  const exponentialBackoff = baseMs * Math.pow(2, attempt - 1)
  const withJitter = exponentialBackoff * (0.5 + Math.random() * 0.5)
  return Math.min(withJitter, 30000) // Cap at 30 seconds
}

/**
 * Internal event record
 */
interface InternalEvent<T = unknown> {
  id: string
  topic: string
  event: T
  publishedAt: Date
  attributes?: Record<string, unknown>
  orderingKey?: string
  deduplicationId?: string
}

/**
 * EventBus - DO-native pub/sub event system
 */
export class EventBus<T = unknown> {
  private subscriptions = new Map<string, InternalSubscription<T>>()
  private deadLetterQueue: DeadLetterEvent<T>[] = []
  private dlqHandlers: DLQHandler<T>[] = []
  private eventStatuses = new Map<string, EventStatus>()
  private deduplicationCache = new Map<string, number>() // deduplicationId -> timestamp
  private metrics: MetricsCollector
  private closed = false

  // Stats tracking
  private totalPublished = 0
  private totalDelivered = 0
  private totalFailed = 0
  private topicStats = new Map<string, { published: number; delivered: number }>()
  private activeTopics = new Set<string>()

  // Configuration
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly defaultAckTimeoutMs: number
  private readonly enableDeadLetterQueue: boolean
  private readonly maxDLQSize: number
  private readonly dlqTtlMs: number
  private readonly orderingGuarantee: OrderingGuarantee

  // Pending handlers for graceful shutdown
  private pendingHandlers = new Set<Promise<void>>()

  // Ordering queues
  private globalQueue: Array<{ event: InternalEvent<T>; resolve: () => void }> = []
  private topicQueues = new Map<string, Array<{ event: InternalEvent<T>; resolve: () => void }>>()
  private keyQueues = new Map<string, Array<{ event: InternalEvent<T>; resolve: () => void }>>()
  private processingGlobal = false
  private processingTopics = new Set<string>()
  private processingKeys = new Set<string>()

  constructor(options: EventBusOptions = {}) {
    this.metrics = options.metrics ?? noopMetrics
    this.maxRetries = options.maxRetries ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 100
    this.defaultAckTimeoutMs = options.ackTimeoutMs ?? 30000
    this.enableDeadLetterQueue = options.enableDeadLetterQueue ?? false
    this.maxDLQSize = options.deadLetterQueue?.maxSize ?? 1000
    this.dlqTtlMs = options.deadLetterQueue?.ttlMs ?? 0 // 0 = no TTL
    this.orderingGuarantee = options.orderingGuarantee ?? 'none'
  }

  /**
   * Publish an event to a topic
   */
  async publish(topic: string, event: T, options?: PublishOptions): Promise<PublishResult> {
    if (this.closed) {
      throw new Error('EventBus is closed')
    }

    const start = performance.now()
    const eventId = generateId()
    const publishedAt = new Date()

    // Check for deduplication
    if (options?.deduplicationId) {
      const existing = this.deduplicationCache.get(options.deduplicationId)
      if (existing) {
        // Already processed this event
        return {
          success: true,
          eventId: eventId,
          timestamp: publishedAt,
        }
      }
      // Add to deduplication cache (with 5 minute TTL)
      this.deduplicationCache.set(options.deduplicationId, Date.now())
      // Clean old entries
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      for (const [key, timestamp] of this.deduplicationCache) {
        if (timestamp < fiveMinutesAgo) {
          this.deduplicationCache.delete(key)
        }
      }
    }

    const internalEvent: InternalEvent<T> = {
      id: eventId,
      topic,
      event,
      publishedAt,
      attributes: options?.attributes,
      orderingKey: options?.orderingKey,
      deduplicationId: options?.deduplicationId,
    }

    // Track stats
    this.totalPublished++
    this.activeTopics.add(topic)
    const topicStat = this.topicStats.get(topic) ?? { published: 0, delivered: 0 }
    topicStat.published++
    this.topicStats.set(topic, topicStat)

    this.metrics.incrementCounter(EventBusMetrics.EVENTS_PUBLISHED, { topic })

    // Initialize event status
    this.eventStatuses.set(eventId, {
      eventId,
      status: 'pending',
      acknowledged: false,
      attempts: 0,
      attemptHistory: [],
    })

    // Deliver based on ordering guarantee
    if (this.orderingGuarantee === 'global') {
      await this.queueGlobalDelivery(internalEvent)
    } else if (this.orderingGuarantee === 'per-topic') {
      await this.queueTopicDelivery(internalEvent)
    } else if (this.orderingGuarantee === 'per-key' && options?.orderingKey) {
      await this.queueKeyDelivery(internalEvent, options.orderingKey)
    } else {
      // No ordering - deliver immediately in parallel
      await this.deliverEvent(internalEvent)
    }

    const latency = performance.now() - start
    this.metrics.recordLatency(EventBusMetrics.PUBLISH_LATENCY, latency, { topic })

    return {
      success: true,
      eventId,
      timestamp: publishedAt,
    }
  }

  private async queueGlobalDelivery(event: InternalEvent<T>): Promise<void> {
    return new Promise<void>((resolve) => {
      this.globalQueue.push({ event, resolve })
      this.processGlobalQueue()
    })
  }

  private async processGlobalQueue(): Promise<void> {
    if (this.processingGlobal || this.globalQueue.length === 0) return
    this.processingGlobal = true

    while (this.globalQueue.length > 0) {
      const item = this.globalQueue.shift()!
      await this.deliverEvent(item.event)
      item.resolve()
    }

    this.processingGlobal = false
  }

  private async queueTopicDelivery(event: InternalEvent<T>): Promise<void> {
    const topic = event.topic
    return new Promise<void>((resolve) => {
      const queue = this.topicQueues.get(topic) ?? []
      queue.push({ event, resolve })
      this.topicQueues.set(topic, queue)
      this.processTopicQueue(topic)
    })
  }

  private async processTopicQueue(topic: string): Promise<void> {
    if (this.processingTopics.has(topic)) return
    this.processingTopics.add(topic)

    const queue = this.topicQueues.get(topic) ?? []
    while (queue.length > 0) {
      const item = queue.shift()!
      await this.deliverEvent(item.event)
      item.resolve()
    }

    this.processingTopics.delete(topic)
  }

  private async queueKeyDelivery(event: InternalEvent<T>, key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const queue = this.keyQueues.get(key) ?? []
      queue.push({ event, resolve })
      this.keyQueues.set(key, queue)
      this.processKeyQueue(key)
    })
  }

  private async processKeyQueue(key: string): Promise<void> {
    if (this.processingKeys.has(key)) return
    this.processingKeys.add(key)

    const queue = this.keyQueues.get(key) ?? []
    while (queue.length > 0) {
      const item = queue.shift()!
      await this.deliverEvent(item.event)
      item.resolve()
    }

    this.processingKeys.delete(key)
  }

  private async deliverEvent(internalEvent: InternalEvent<T>): Promise<void> {
    const { topic, event, attributes, orderingKey } = internalEvent

    // Find matching subscriptions
    const matchingSubs = this.getMatchingSubscriptions(topic, event, attributes)

    // Deliver to each subscription
    const deliveryPromises = matchingSubs.map((sub) =>
      this.deliverToSubscription(internalEvent, sub)
    )

    // Track pending handlers
    const tracked = Promise.all(deliveryPromises).then(() => {})
    this.pendingHandlers.add(tracked)
    tracked.finally(() => this.pendingHandlers.delete(tracked))

    await tracked
  }

  private getMatchingSubscriptions(
    topic: string,
    event: T,
    attributes?: Record<string, unknown>
  ): InternalSubscription<T>[] {
    const matching: InternalSubscription<T>[] = []

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active || subscription.paused) continue

      // Check pattern/topic match
      if (subscription.pattern) {
        if (!matchesPattern(topic, subscription.pattern)) {
          continue
        }
      } else if (subscription.topic !== topic) {
        continue
      }

      // Check filter if present
      if (subscription.filter) {
        if (!evaluateFilter(event, attributes, subscription.filter)) {
          this.metrics.incrementCounter(EventBusMetrics.FILTER_REJECTS, {
            pattern: subscription.pattern ?? subscription.topic,
          })
          continue
        }
        this.metrics.incrementCounter(EventBusMetrics.FILTER_MATCHES, {
          pattern: subscription.pattern ?? subscription.topic,
        })
      }

      matching.push(subscription)
    }

    return matching
  }

  private async deliverToSubscription(
    internalEvent: InternalEvent<T>,
    subscription: InternalSubscription<T>
  ): Promise<void> {
    const { id: eventId, topic, event, publishedAt, attributes, orderingKey } = internalEvent
    const eventStatus = this.eventStatuses.get(eventId)!
    const attempts: DeliveryAttempt[] = []
    let lastError: string | undefined

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const start = performance.now()
      let success = false
      let error: string | undefined

      // Create ack/nack callbacks
      let ackCalled = false
      let nackCalled = false
      let nackError: string | undefined

      const ack = async () => {
        ackCalled = true
      }

      const nack = async (err?: string) => {
        nackCalled = true
        nackError = err
      }

      const envelope: EventEnvelope<T> = {
        eventId,
        topic,
        event,
        publishedAt,
        attributes,
        orderingKey,
        attempt,
        matchedPattern: subscription.pattern,
        ack,
        nack,
      }

      try {
        const result = await subscription.handler(envelope)

        // Handle manual ack/nack
        if (subscription.manualAck) {
          if (nackCalled) {
            throw new Error(nackError ?? 'Handler called nack()')
          }
          if (!ackCalled) {
            // Timeout handling would go here in a real implementation
            throw new Error('Handler did not call ack()')
          }
          success = true
        } else if (result && typeof result === 'object' && 'success' in result) {
          success = result.success
          if (!success && result.error) {
            error = result.error
          }
        } else {
          // No result means success
          success = true
        }

        if (success) {
          this.totalDelivered++
          const topicStat = this.topicStats.get(topic) ?? { published: 0, delivered: 0 }
          topicStat.delivered++
          this.topicStats.set(topic, topicStat)

          this.metrics.incrementCounter(EventBusMetrics.EVENTS_DELIVERED, { topic })

          const durationMs = performance.now() - start
          this.metrics.recordLatency(EventBusMetrics.DELIVER_LATENCY, durationMs)

          attempts.push({
            attempt,
            timestamp: new Date(),
            success: true,
            durationMs,
          })

          // Update event status
          eventStatus.status = 'delivered'
          eventStatus.acknowledged = true
          eventStatus.deliveredAt = new Date()
          eventStatus.attempts = attempt
          eventStatus.attemptHistory = attempts
          return
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }

      lastError = error
      this.totalFailed++
      this.metrics.incrementCounter(EventBusMetrics.DELIVERY_FAILURES, { topic })

      attempts.push({
        attempt,
        timestamp: new Date(),
        success: false,
        error,
        durationMs: performance.now() - start,
      })

      if (attempt < this.maxRetries) {
        this.metrics.incrementCounter(EventBusMetrics.DELIVERY_RETRIES, { topic })
        const backoff = calculateBackoff(attempt, this.retryDelayMs)
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }

    // All retries exhausted
    eventStatus.status = 'failed'
    eventStatus.acknowledged = false
    eventStatus.attempts = this.maxRetries
    eventStatus.attemptHistory = attempts
    eventStatus.error = lastError

    // Add to dead letter queue if enabled
    if (this.enableDeadLetterQueue) {
      this.addToDeadLetterQueue(internalEvent, lastError ?? 'Unknown error', attempts)
    }
  }

  private addToDeadLetterQueue(
    event: InternalEvent<T>,
    error: string,
    attempts: DeliveryAttempt[]
  ): void {
    const dlqEvent: DeadLetterEvent<T> = {
      eventId: event.id,
      originalTopic: event.topic,
      event: event.event,
      attributes: event.attributes,
      error,
      attempts: attempts.length,
      attemptHistory: attempts,
      deadLetteredAt: new Date(),
    }

    this.deadLetterQueue.push(dlqEvent)
    this.metrics.incrementCounter(EventBusMetrics.DEAD_LETTERS)

    // Notify DLQ handlers
    for (const handler of this.dlqHandlers) {
      try {
        handler(dlqEvent)
      } catch {
        // Ignore errors in DLQ handlers
      }
    }

    // Trim dead letter queue if it exceeds max size
    if (this.deadLetterQueue.length > this.maxDLQSize) {
      this.deadLetterQueue.shift()
    }
  }

  /**
   * Subscribe to a topic
   */
  async subscribe(
    topic: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<SubscriptionHandle> {
    const id = generateId()

    const subscription: InternalSubscription<T> = {
      id,
      topic,
      name: options.name,
      handler,
      filter: options.filter,
      maxConcurrency: options.maxConcurrency ?? 1,
      batchSize: options.batchSize ?? 1,
      requireAck: options.requireAck ?? false,
      manualAck: options.manualAck ?? false,
      ackTimeoutMs: options.ackTimeoutMs ?? this.defaultAckTimeoutMs,
      createdAt: new Date(),
      paused: false,
      active: true,
    }

    this.subscriptions.set(id, subscription)
    this.activeTopics.add(topic)
    this.metrics.recordGauge(EventBusMetrics.ACTIVE_SUBSCRIPTIONS, this.subscriptions.size)

    return {
      id,
      topic,
      name: options.name,
      createdAt: subscription.createdAt,
      paused: false,
      maxConcurrency: options.maxConcurrency,
      batchSize: options.batchSize,
    }
  }

  /**
   * Subscribe to a pattern
   */
  async subscribePattern(
    pattern: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<SubscriptionHandle> {
    const id = generateId()

    const subscription: InternalSubscription<T> = {
      id,
      topic: pattern,
      pattern,
      name: options.name,
      handler,
      filter: options.filter,
      maxConcurrency: options.maxConcurrency ?? 1,
      batchSize: options.batchSize ?? 1,
      requireAck: options.requireAck ?? false,
      manualAck: options.manualAck ?? false,
      ackTimeoutMs: options.ackTimeoutMs ?? this.defaultAckTimeoutMs,
      createdAt: new Date(),
      paused: false,
      active: true,
    }

    this.subscriptions.set(id, subscription)
    this.metrics.recordGauge(EventBusMetrics.ACTIVE_SUBSCRIPTIONS, this.subscriptions.size)

    return {
      id,
      topic: pattern,
      name: options.name,
      createdAt: subscription.createdAt,
      paused: false,
      maxConcurrency: options.maxConcurrency,
      batchSize: options.batchSize,
    }
  }

  /**
   * Unsubscribe by subscription ID
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (subscription) {
      subscription.active = false
      this.subscriptions.delete(subscriptionId)
      this.metrics.recordGauge(EventBusMetrics.ACTIVE_SUBSCRIPTIONS, this.subscriptions.size)
    }
  }

  /**
   * Get all subscriptions
   */
  getSubscriptions(): SubscriptionHandle[] {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        topic: s.topic,
        name: s.name,
        createdAt: s.createdAt,
        paused: s.paused,
        maxConcurrency: s.maxConcurrency,
        batchSize: s.batchSize,
      }))
  }

  /**
   * Get subscription by ID
   */
  getSubscription(subscriptionId: string): SubscriptionHandle | undefined {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub || !sub.active) return undefined
    return {
      id: sub.id,
      topic: sub.topic,
      name: sub.name,
      createdAt: sub.createdAt,
      paused: sub.paused,
      maxConcurrency: sub.maxConcurrency,
      batchSize: sub.batchSize,
    }
  }

  /**
   * Get subscriptions by topic
   */
  getSubscriptionsByTopic(topic: string): SubscriptionHandle[] {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.active && s.topic === topic)
      .map((s) => ({
        id: s.id,
        topic: s.topic,
        name: s.name,
        createdAt: s.createdAt,
        paused: s.paused,
        maxConcurrency: s.maxConcurrency,
        batchSize: s.batchSize,
      }))
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return Array.from(this.subscriptions.values()).filter((s) => s.active).length
  }

  /**
   * Pause a subscription
   */
  async pauseSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub) {
      sub.paused = true
    }
  }

  /**
   * Resume a subscription
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub) {
      sub.paused = false
    }
  }

  /**
   * Update a subscription
   */
  async updateSubscription(
    subscriptionId: string,
    updates: { handler?: EventHandler<T>; filter?: FilterExpression }
  ): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub) {
      if (updates.handler) {
        sub.handler = updates.handler
      }
      if (updates.filter !== undefined) {
        sub.filter = updates.filter
      }
    }
  }

  /**
   * Get event status
   */
  async getEventStatus(eventId: string): Promise<EventStatus> {
    return (
      this.eventStatuses.get(eventId) ?? {
        eventId,
        status: 'pending',
        acknowledged: false,
        attempts: 0,
        attemptHistory: [],
      }
    )
  }

  /**
   * Register a dead letter queue handler
   */
  onDeadLetter(handler: DLQHandler<T>): void {
    this.dlqHandlers.push(handler)
  }

  /**
   * Get dead letter queue entries
   */
  async getDeadLetterQueue(options?: DLQQueryOptions): Promise<DeadLetterEvent<T>[]> {
    // Clean expired entries if TTL is configured
    if (this.dlqTtlMs > 0) {
      const now = Date.now()
      this.deadLetterQueue = this.deadLetterQueue.filter(
        (e) => now - e.deadLetteredAt.getTime() < this.dlqTtlMs
      )
    }

    let result = [...this.deadLetterQueue]

    if (options?.topic) {
      result = result.filter((e) => e.originalTopic === options.topic)
    }

    if (options?.after) {
      result = result.filter((e) => e.deadLetteredAt > options.after!)
    }

    if (options?.limit) {
      result = result.slice(0, options.limit)
    }

    return result
  }

  /**
   * Replay an event from the dead letter queue
   */
  async replayFromDLQ(eventId: string): Promise<boolean> {
    const index = this.deadLetterQueue.findIndex((e) => e.eventId === eventId)
    if (index === -1) return false

    const dlqEvent = this.deadLetterQueue[index]!

    // Re-publish the event
    try {
      const result = await this.publish(dlqEvent.originalTopic, dlqEvent.event, {
        attributes: dlqEvent.attributes,
      })

      // Wait for delivery
      await new Promise((r) => setTimeout(r, 100))

      const status = await this.getEventStatus(result.eventId)
      if (status.acknowledged) {
        // Remove from DLQ on success
        this.deadLetterQueue.splice(index, 1)
        // Update original event status
        const originalStatus = this.eventStatuses.get(eventId)
        if (originalStatus) {
          originalStatus.acknowledged = true
          originalStatus.status = 'delivered'
          originalStatus.deliveredAt = new Date()
        }
        return true
      }
    } catch {
      // Failed to replay
    }

    return false
  }

  /**
   * Replay all events from the dead letter queue
   */
  async replayAllFromDLQ(options?: DLQQueryOptions): Promise<ReplayResult> {
    const events = await this.getDeadLetterQueue(options)
    let replayed = 0
    let failed = 0

    for (const event of events) {
      const success = await this.replayFromDLQ(event.eventId)
      if (success) {
        replayed++
      } else {
        failed++
      }
    }

    return { replayed, failed }
  }

  /**
   * Remove an event from the dead letter queue
   */
  async removeFromDLQ(eventId: string): Promise<void> {
    const index = this.deadLetterQueue.findIndex((e) => e.eventId === eventId)
    if (index !== -1) {
      this.deadLetterQueue.splice(index, 1)
    }
  }

  /**
   * Purge the dead letter queue
   */
  async purgeDLQ(options?: { topic?: string }): Promise<void> {
    if (options?.topic) {
      this.deadLetterQueue = this.deadLetterQueue.filter(
        (e) => e.originalTopic !== options.topic
      )
    } else {
      this.deadLetterQueue = []
    }
  }

  /**
   * Get all topics
   */
  getTopics(): string[] {
    return Array.from(this.activeTopics)
  }

  /**
   * Get event bus statistics
   */
  getStats(): EventBusStats {
    return {
      totalPublished: this.totalPublished,
      totalDelivered: this.totalDelivered,
      totalFailed: this.totalFailed,
      activeSubscriptions: this.getSubscriptionCount(),
      activeTopics: this.activeTopics.size,
    }
  }

  /**
   * Get per-topic statistics
   */
  getTopicStats(topic: string): TopicStats {
    const stats = this.topicStats.get(topic) ?? { published: 0, delivered: 0 }
    const subscribers = Array.from(this.subscriptions.values()).filter(
      (s) => s.active && (s.topic === topic || (s.pattern && matchesPattern(topic, s.pattern)))
    ).length

    return {
      published: stats.published,
      delivered: stats.delivered,
      subscribers,
    }
  }

  /**
   * Close the event bus
   */
  async close(): Promise<void> {
    this.closed = true

    // Wait for pending handlers to complete
    await Promise.all(this.pendingHandlers)

    // Clear all state
    this.subscriptions.clear()
    this.deadLetterQueue = []
    this.eventStatuses.clear()
    this.deduplicationCache.clear()
    this.activeTopics.clear()
    this.topicStats.clear()
    this.dlqHandlers = []
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
 *   maxRetries: 5,
 *   retryDelayMs: 500,
 * })
 *
 * // Subscribe to topic
 * const sub = await bus.subscribe('user.created', async (envelope) => {
 *   console.log('User created:', envelope.event)
 *   return { success: true }
 * })
 *
 * // Publish event
 * await bus.publish('user.created', { userId: '123', email: 'user@example.com' })
 *
 * // Cleanup
 * await bus.unsubscribe(sub.id)
 * await bus.close()
 * ```
 */
export function createEventBus<T = unknown>(options?: EventBusOptions): EventBus<T> {
  return new EventBus<T>(options)
}
