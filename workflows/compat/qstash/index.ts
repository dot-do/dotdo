/**
 * QStash Compat Layer - 100% API Compatible with @upstash/qstash
 *
 * Drop-in replacement for Upstash QStash that runs on dotdo's
 * durable execution infrastructure.
 *
 * Features:
 * - Real HTTP delivery with fetch()
 * - Retry logic with exponential backoff (5xx only, not 4xx)
 * - Upstash-Retried header on retry attempts
 * - Dead letter queue support (both internal and URL-based)
 * - URL Groups for fan-out delivery (concurrent with Promise.all)
 * - Callback URLs on success/failure
 * - HMAC-SHA256 signature generation and verification
 * - Request timeout handling with AbortController
 * - Content-based deduplication (1 hour window)
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/qstash'
 *
 * const client = new Client({ token: 'xxx' })
 * await client.publishJSON({
 *   url: 'https://example.com/api/webhook',
 *   body: { hello: 'world' },
 *   delay: '5m',
 * })
 * ```
 *
 * @see https://upstash.com/docs/qstash for the original QStash documentation
 *
 * Note: For production use with Cloudflare Workers, consider integrating
 * with CF Workflows for durable retry scheduling (free waits vs setTimeout).
 */

import { ScheduleManager, parseCronExpression, getNextRunTime } from '../../ScheduleManager'
import { DurableWorkflowRuntime, InMemoryStepStorage } from '../../runtime'
import type { StepStorage } from '../../runtime'
import { parseDuration, ensureError } from '../utils'

// ============================================================================
// TYPES - Match QStash SDK exactly
// ============================================================================

export interface ClientConfig {
  /** QStash API token (unused in compat, kept for compatibility) */
  token?: string
  /** Base URL for QStash API (unused in compat) */
  baseUrl?: string
  /** Retry configuration */
  retry?: {
    retries?: number
    backoff?: (retryCount: number) => number
  }
  /** Custom headers */
  headers?: Record<string, string>
  /** Durable storage (DO state for production) */
  storage?: StepStorage
  /** DO state for schedule manager */
  state?: DurableObjectState
  /** Signing key for outgoing request signatures */
  signingKey?: string
}

export interface PublishRequest {
  /** Destination URL to send the message to */
  url?: string
  /** Use a pre-configured API endpoint */
  api?: { name: string; [key: string]: unknown }
  /** Request body */
  body?: string | object
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Custom headers */
  headers?: Record<string, string>
  /** Content type */
  contentType?: string
  /** Delay before delivery (e.g., '5m', '1h', or milliseconds) */
  delay?: string | number
  /** Number of retries on failure */
  retries?: number
  /** Callback URL on success */
  callback?: string
  /** Callback URL on failure */
  failureCallback?: string
  /** Deduplication ID */
  deduplicationId?: string
  /** Content-based deduplication */
  contentBasedDeduplication?: boolean
  /** Timeout for the request in seconds */
  timeout?: number | string
  /** Topic to publish to (for pub/sub fan-out) */
  topic?: string
  /** URL Group to publish to (for direct fan-out) */
  urlGroup?: string
  /** Dead letter queue URL - messages sent here after all retries fail */
  deadLetterQueue?: string
}

/** Delivery status for a single endpoint */
export interface DeliveryStatus {
  /** Destination URL */
  url: string
  /** Delivery status */
  status: 'success' | 'failed' | 'pending'
  /** HTTP status code */
  statusCode?: number
  /** Error message if failed */
  error?: string
  /** Delivery timestamp */
  timestamp: number
}

export interface PublishResponse {
  /** Message ID */
  messageId: string
  /** URL the message was sent to */
  url?: string
  /** Deduplicated flag */
  deduplicated?: boolean
  /** URL Group name if published to a group */
  urlGroup?: string
  /** Topic name if published to a topic */
  topic?: string
  /** Individual delivery statuses for fan-out */
  deliveries?: DeliveryStatus[]
}

// ============================================================================
// URL GROUP TYPES
// ============================================================================

export interface URLGroupEndpoint {
  /** Endpoint URL */
  url: string
  /** Optional name for the endpoint */
  name?: string
}

export interface URLGroup {
  /** Group name */
  name: string
  /** Endpoints in the group */
  endpoints: URLGroupEndpoint[]
  /** Creation timestamp */
  createdAt: number
}

export interface CreateURLGroupRequest {
  /** Group name */
  name: string
  /** Initial endpoints */
  endpoints: URLGroupEndpoint[]
}

// ============================================================================
// DLQ TYPES
// ============================================================================

export interface DLQMessage {
  /** Original message ID */
  messageId: string
  /** Destination URL */
  url: string
  /** Original request body */
  body?: string
  /** HTTP method */
  method: string
  /** Headers */
  headers?: Record<string, string>
  /** Failure reason */
  failureReason: string
  /** Number of delivery attempts */
  attempts: number
  /** Timestamp when added to DLQ */
  dlqTimestamp: number
  /** Original creation timestamp */
  createdAt: number
  /** Cursor for pagination */
  cursor?: string
}

export interface DLQListOptions {
  /** Maximum number of messages to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
}

export interface DLQReplayOptions {
  /** Override destination URL */
  url?: string
}

export interface DLQReplayResult {
  /** Whether replay was successful */
  success: boolean
  /** New message ID for the replayed message */
  newMessageId?: string
  /** Destination URL */
  url?: string
}

// ============================================================================
// TOPIC TYPES
// ============================================================================

export interface Topic {
  /** Topic ID */
  topicId: string
  /** Topic name */
  name: string
  /** Creation timestamp */
  createdAt: number
}

export interface CreateTopicRequest {
  /** Topic name */
  name: string
}

export interface TopicSubscription {
  /** Subscription ID */
  subscriptionId: string
  /** Topic name */
  topicName: string
  /** Destination URL (mutually exclusive with urlGroup) */
  url?: string
  /** URL Group name (mutually exclusive with url) */
  urlGroup?: string
  /** Creation timestamp */
  createdAt: number
}

export interface SubscribeRequest {
  /** Destination URL */
  url?: string
  /** URL Group name */
  urlGroup?: string
}

// ============================================================================
// EVENT TYPES - Discriminated unions for type-safe event handling
// ============================================================================

export type EventType = 'created' | 'delivered' | 'failed' | 'retry' | 'dlq' | 'callback_failed'

/** Base event properties shared by all event types */
interface QStashEventBase {
  /** Event ID */
  eventId: string
  /** Related message ID */
  messageId: string
  /** Timestamp */
  timestamp: number
  /** Destination URL */
  url?: string
  /** Cursor for pagination */
  cursor?: string
}

/** Event emitted when a message is created */
export interface QStashEventCreated extends QStashEventBase {
  type: 'created'
}

/** Event emitted when a message is successfully delivered */
export interface QStashEventDelivered extends QStashEventBase {
  type: 'delivered'
  url: string
  /** HTTP status code from the destination */
  statusCode: number
  /** Response latency in milliseconds */
  latencyMs?: number
}

/** Event emitted when a message delivery fails after all retries */
export interface QStashEventFailed extends QStashEventBase {
  type: 'failed'
  /** Error message describing the failure */
  error: string
  /** HTTP status code if available */
  statusCode?: number
}

/** Event emitted when a message is being retried */
export interface QStashEventRetry extends QStashEventBase {
  type: 'retry'
  /** Error message from the previous attempt */
  error: string
  /** Current retry attempt number (1-based) */
  attempt: number
  /** Timestamp when next retry will be attempted */
  nextRetryAt?: number
}

/** Event emitted when a message is moved to the dead letter queue */
export interface QStashEventDLQ extends QStashEventBase {
  type: 'dlq'
  /** Error message if available */
  error?: string
  /** Original destination URL */
  originalUrl: string
}

/** Event emitted when a callback fails */
export interface QStashEventCallbackFailed extends QStashEventBase {
  type: 'callback_failed'
  /** Error message describing the callback failure */
  error: string
  /** The callback URL that failed */
  callbackUrl: string
}

/** Discriminated union of all event types for type-safe handling */
export type QStashEvent =
  | QStashEventCreated
  | QStashEventDelivered
  | QStashEventFailed
  | QStashEventRetry
  | QStashEventDLQ
  | QStashEventCallbackFailed

export interface EventListOptions {
  /** Filter by event type */
  type?: EventType
  /** Filter by message ID */
  messageId?: string
  /** Maximum number of events to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
}

export interface BatchRequest {
  /** Array of publish requests */
  messages: PublishRequest[]
}

export interface BatchResponse {
  /** Array of publish responses */
  responses: PublishResponse[]
}

export interface ScheduleRequest {
  /** Destination URL */
  destination: string
  /** Cron expression (5 or 6 fields) */
  cron: string
  /** Request body */
  body?: string | object
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Custom headers */
  headers?: Record<string, string>
  /** Content type */
  contentType?: string
  /** Number of retries */
  retries?: number
  /** Callback on success */
  callback?: string
  /** Callback on failure */
  failureCallback?: string
  /** Timeout in seconds */
  timeout?: number
  /** Schedule ID (optional, auto-generated if not provided) */
  scheduleId?: string
}

export interface Schedule {
  /** Schedule ID */
  scheduleId: string
  /** Cron expression */
  cron: string
  /** Destination URL */
  destination: string
  /** Request body */
  body?: string
  /** HTTP method */
  method: string
  /** Custom headers */
  headers?: Record<string, string>
  /** Content type */
  contentType?: string
  /** Number of retries */
  retries: number
  /** Callback on success */
  callback?: string
  /** Callback on failure */
  failureCallback?: string
  /** Timeout in seconds */
  timeout?: number
  /** Creation timestamp */
  createdAt: number
  /** Is paused */
  isPaused: boolean
}

export interface VerifyRequest {
  /** Signature from Upstash-Signature header */
  signature: string
  /** Raw request body */
  body: string
  /** Optional URL (for verification) */
  url?: string
  /** Clock tolerance in seconds (default: 0) */
  clockTolerance?: number
}

export interface ReceiverConfig {
  /** Current signing key */
  currentSigningKey: string
  /** Next signing key (for rotation) */
  nextSigningKey: string
}

export interface MessageMeta {
  messageId: string
  timestamp: number
  url: string
  body?: unknown
}

// ============================================================================
// UTILITIES
// Note: parseDuration and ensureError are imported from '../utils'
// ============================================================================

function generateMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateScheduleId(): string {
  return `sched_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateTopicId(): string {
  return `topic_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateSubscriptionId(): string {
  return `sub_${crypto.randomUUID().replace(/-/g, '')}`
}

function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, '')}`
}

/**
 * Valid HTTP methods for QStash requests
 */
const validHttpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const
type HttpMethod = (typeof validHttpMethods)[number]

/**
 * Check if a string is a valid HTTP method
 */
function isValidHttpMethod(method: string): method is HttpMethod {
  return validHttpMethods.includes(method as HttpMethod)
}

async function hashBody(body: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(body)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number, initialDelayMs = 1000, maxDelayMs = 30000): number {
  // Exponential backoff: initialDelay * 2^(attempt-1)
  let delay = initialDelayMs * Math.pow(2, attempt - 1)

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs)

  // Add jitter (0-25% of delay)
  const jitter = delay * 0.25 * Math.random()
  delay += jitter

  return Math.floor(delay)
}

/**
 * Check if HTTP status code is retryable (5xx errors only)
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600
}

/**
 * Generate HMAC-SHA256 signature for a payload
 */
async function generateSignature(signingKey: string, body: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${timestamp}.${body}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))

  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `t=${timestamp},v1=${signature}`
}

// ============================================================================
// SCHEDULES API
// ============================================================================

class Schedules {
  private readonly manager: ScheduleManager | null
  private readonly inMemorySchedules = new Map<string, Schedule>()

  constructor(state?: DurableObjectState) {
    this.manager = state ? new ScheduleManager(state) : null
  }

  /**
   * Create a new schedule
   */
  async create(request: ScheduleRequest): Promise<{ scheduleId: string }> {
    const scheduleId = request.scheduleId || generateScheduleId()

    const schedule: Schedule = {
      scheduleId,
      cron: request.cron,
      destination: request.destination,
      body: typeof request.body === 'object' ? JSON.stringify(request.body) : request.body,
      method: request.method || 'POST',
      headers: request.headers,
      contentType: request.contentType,
      retries: request.retries ?? 3,
      callback: request.callback,
      failureCallback: request.failureCallback,
      timeout: request.timeout,
      createdAt: Date.now(),
      isPaused: false,
    }

    if (this.manager) {
      // Use DO-based schedule manager
      await this.manager.schedule(request.cron, scheduleId, {
        metadata: {
          destination: request.destination,
          body: schedule.body,
          method: schedule.method,
          headers: schedule.headers,
          contentType: schedule.contentType,
          retries: schedule.retries,
          callback: schedule.callback,
          failureCallback: schedule.failureCallback,
          timeout: schedule.timeout,
        },
      })
    }

    // Always store in memory for compatibility
    this.inMemorySchedules.set(scheduleId, schedule)

    return { scheduleId }
  }

  /**
   * Get a schedule by ID
   */
  async get(scheduleId: string): Promise<Schedule | null> {
    // Check in-memory first
    const schedule = this.inMemorySchedules.get(scheduleId)
    if (schedule) return schedule

    // Check DO storage
    if (this.manager) {
      const stored = await this.manager.getSchedule(scheduleId)
      if (stored) {
        const meta = stored.metadata as Record<string, unknown> | undefined
        return {
          scheduleId,
          cron: stored.cronExpression,
          destination: (meta?.destination as string) || '',
          body: meta?.body as string | undefined,
          method: (meta?.method as string) || 'POST',
          headers: meta?.headers as Record<string, string> | undefined,
          contentType: meta?.contentType as string | undefined,
          retries: (meta?.retries as number) || 3,
          callback: meta?.callback as string | undefined,
          failureCallback: meta?.failureCallback as string | undefined,
          timeout: meta?.timeout as number | undefined,
          createdAt: stored.createdAt.getTime(),
          isPaused: stored.status === 'paused',
        }
      }
    }

    return null
  }

  /**
   * List all schedules
   */
  async list(): Promise<Schedule[]> {
    const schedules: Schedule[] = []

    // Add in-memory schedules
    for (const schedule of Array.from(this.inMemorySchedules.values())) {
      schedules.push(schedule)
    }

    // Add DO schedules (avoiding duplicates)
    if (this.manager) {
      const stored = await this.manager.listSchedules()
      for (const s of stored) {
        if (!this.inMemorySchedules.has(s.name)) {
          const meta = s.metadata as Record<string, unknown> | undefined
          schedules.push({
            scheduleId: s.name,
            cron: s.cronExpression,
            destination: (meta?.destination as string) || '',
            body: meta?.body as string | undefined,
            method: (meta?.method as string) || 'POST',
            headers: meta?.headers as Record<string, string> | undefined,
            contentType: meta?.contentType as string | undefined,
            retries: (meta?.retries as number) || 3,
            callback: meta?.callback as string | undefined,
            failureCallback: meta?.failureCallback as string | undefined,
            timeout: meta?.timeout as number | undefined,
            createdAt: s.createdAt.getTime(),
            isPaused: s.status === 'paused',
          })
        }
      }
    }

    return schedules
  }

  /**
   * Delete a schedule
   */
  async delete(scheduleId: string): Promise<void> {
    this.inMemorySchedules.delete(scheduleId)

    if (this.manager) {
      try {
        await this.manager.deleteSchedule(scheduleId)
      } catch {
        // Schedule may not exist in DO storage
      }
    }
  }

  /**
   * Pause a schedule
   */
  async pause(scheduleId: string): Promise<void> {
    const schedule = this.inMemorySchedules.get(scheduleId)
    if (schedule) {
      schedule.isPaused = true
    }

    if (this.manager) {
      await this.manager.updateSchedule(scheduleId, { enabled: false })
    }
  }

  /**
   * Resume a schedule
   */
  async resume(scheduleId: string): Promise<void> {
    const schedule = this.inMemorySchedules.get(scheduleId)
    if (schedule) {
      schedule.isPaused = false
    }

    if (this.manager) {
      await this.manager.updateSchedule(scheduleId, { enabled: true })
    }
  }
}

// ============================================================================
// URL GROUPS API
// ============================================================================

export class URLGroups {
  private readonly groups = new Map<string, URLGroup>()

  /**
   * Create a new URL group
   * @param nameOrRequest - Either a group name (string) or a CreateURLGroupRequest object
   * @param endpoints - Array of endpoint URLs (only used when first arg is a string)
   */
  async create(nameOrRequest: string | CreateURLGroupRequest, endpoints?: string[]): Promise<URLGroup> {
    let name: string
    let endpointList: URLGroupEndpoint[]

    if (typeof nameOrRequest === 'string') {
      // Simple signature: create('name', ['url1', 'url2'])
      name = nameOrRequest
      endpointList = (endpoints || []).map((url) => ({ url }))
    } else {
      // Object signature: create({ name: 'name', endpoints: [...] })
      name = nameOrRequest.name
      endpointList = [...nameOrRequest.endpoints]
    }

    const group: URLGroup = {
      name,
      endpoints: endpointList,
      createdAt: Date.now(),
    }
    this.groups.set(name, group)
    return group
  }

  /**
   * Get a URL group by name
   */
  async get(name: string): Promise<URLGroup | null> {
    return this.groups.get(name) ?? null
  }

  /**
   * List all URL groups
   */
  async list(): Promise<URLGroup[]> {
    return Array.from(this.groups.values())
  }

  /**
   * Delete a URL group
   */
  async delete(name: string): Promise<void> {
    this.groups.delete(name)
  }

  /**
   * Add endpoints to an existing group
   */
  async addEndpoints(name: string, endpoints: URLGroupEndpoint[]): Promise<void> {
    const group = this.groups.get(name)
    if (!group) {
      throw new Error(`URL group '${name}' not found`)
    }
    group.endpoints.push(...endpoints)
  }

  /**
   * Remove endpoints from an existing group
   */
  async removeEndpoints(name: string, endpoints: URLGroupEndpoint[]): Promise<void> {
    const group = this.groups.get(name)
    if (!group) {
      throw new Error(`URL group '${name}' not found`)
    }
    const urlsToRemove = new Set(endpoints.map((e) => e.url))
    group.endpoints = group.endpoints.filter((e) => !urlsToRemove.has(e.url))
  }
}

// ============================================================================
// DEAD LETTER QUEUE API
// ============================================================================

export class DLQ {
  private readonly messages = new Map<string, DLQMessage>()
  private messageOrder: string[] = []

  /**
   * Add a message to the DLQ (internal use)
   */
  _addMessage(message: DLQMessage): void {
    this.messages.set(message.messageId, message)
    this.messageOrder.push(message.messageId)
  }

  /**
   * List DLQ messages
   */
  async list(options?: DLQListOptions): Promise<DLQMessage[]> {
    const limit = options?.limit ?? 100
    let startIndex = 0

    if (options?.cursor) {
      const cursorIndex = this.messageOrder.indexOf(options.cursor)
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1
      }
    }

    const result: DLQMessage[] = []
    for (let i = startIndex; i < Math.min(startIndex + limit, this.messageOrder.length); i++) {
      const id = this.messageOrder[i]
      const msg = this.messages.get(id)
      if (msg) {
        result.push({
          ...msg,
          cursor: id,
        })
      }
    }

    return result
  }

  /**
   * Get a specific DLQ message
   */
  async get(messageId: string): Promise<DLQMessage | null> {
    return this.messages.get(messageId) ?? null
  }

  /**
   * Replay a DLQ message
   */
  async replay(
    messageId: string,
    options?: DLQReplayOptions,
    publishFn?: (request: PublishRequest) => Promise<PublishResponse>,
  ): Promise<DLQReplayResult> {
    const message = this.messages.get(messageId)
    if (!message) {
      return { success: false }
    }

    const url = options?.url ?? message.url

    if (publishFn) {
      try {
        // Validate HTTP method before casting
        if (!isValidHttpMethod(message.method)) {
          throw new Error(`Invalid HTTP method in DLQ message: ${message.method}`)
        }

        const result = await publishFn({
          url,
          body: message.body,
          method: message.method,
          headers: message.headers,
        })

        // Remove from DLQ on successful replay
        this.messages.delete(messageId)
        this.messageOrder = this.messageOrder.filter((id) => id !== messageId)

        return {
          success: true,
          newMessageId: result.messageId,
          url,
        }
      } catch {
        return { success: false }
      }
    }

    // If no publish function provided, just remove from DLQ
    this.messages.delete(messageId)
    this.messageOrder = this.messageOrder.filter((id) => id !== messageId)

    return {
      success: true,
      newMessageId: generateMessageId(),
      url,
    }
  }

  /**
   * Delete a DLQ message
   */
  async delete(messageId: string): Promise<void> {
    this.messages.delete(messageId)
    this.messageOrder = this.messageOrder.filter((id) => id !== messageId)
  }

  /**
   * Delete multiple DLQ messages
   */
  async deleteMany(messageIds: string[]): Promise<void> {
    for (const id of messageIds) {
      this.messages.delete(id)
    }
    const idsSet = new Set(messageIds)
    this.messageOrder = this.messageOrder.filter((id) => !idsSet.has(id))
  }

  /**
   * Purge all DLQ messages
   */
  async purge(): Promise<void> {
    this.messages.clear()
    this.messageOrder = []
  }
}

// ============================================================================
// TOPICS API
// ============================================================================

export class Topics {
  private readonly topics = new Map<string, Topic>()
  private readonly subscriptions = new Map<string, TopicSubscription>()
  private readonly topicSubscriptions = new Map<string, Set<string>>() // topicName -> subscriptionIds

  /**
   * Create a new topic
   */
  async create(request: CreateTopicRequest): Promise<Topic> {
    const topic: Topic = {
      topicId: generateTopicId(),
      name: request.name,
      createdAt: Date.now(),
    }
    this.topics.set(request.name, topic)
    this.topicSubscriptions.set(request.name, new Set())
    return topic
  }

  /**
   * Get a topic by name
   */
  async get(name: string): Promise<Topic | null> {
    return this.topics.get(name) ?? null
  }

  /**
   * List all topics
   */
  async list(): Promise<Topic[]> {
    return Array.from(this.topics.values())
  }

  /**
   * Delete a topic
   */
  async delete(name: string): Promise<void> {
    this.topics.delete(name)
    // Remove all subscriptions for this topic
    const subIds = this.topicSubscriptions.get(name)
    if (subIds) {
      for (const subId of Array.from(subIds)) {
        this.subscriptions.delete(subId)
      }
    }
    this.topicSubscriptions.delete(name)
  }

  /**
   * Subscribe to a topic
   */
  async subscribe(topicName: string, request: SubscribeRequest): Promise<TopicSubscription> {
    const subscription: TopicSubscription = {
      subscriptionId: generateSubscriptionId(),
      topicName,
      url: request.url,
      urlGroup: request.urlGroup,
      createdAt: Date.now(),
    }

    this.subscriptions.set(subscription.subscriptionId, subscription)

    let topicSubs = this.topicSubscriptions.get(topicName)
    if (!topicSubs) {
      topicSubs = new Set()
      this.topicSubscriptions.set(topicName, topicSubs)
    }
    topicSubs.add(subscription.subscriptionId)

    return subscription
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId)
    if (sub) {
      this.subscriptions.delete(subscriptionId)
      const topicSubs = this.topicSubscriptions.get(sub.topicName)
      if (topicSubs) {
        topicSubs.delete(subscriptionId)
      }
    }
  }

  /**
   * List subscriptions for a topic
   */
  async listSubscriptions(topicName: string): Promise<TopicSubscription[]> {
    const subIds = this.topicSubscriptions.get(topicName)
    if (!subIds) return []

    const result: TopicSubscription[] = []
    for (const id of Array.from(subIds)) {
      const sub = this.subscriptions.get(id)
      if (sub) {
        result.push(sub)
      }
    }
    return result
  }

  /**
   * Get all subscribers for a topic (internal use)
   */
  _getSubscribers(topicName: string): TopicSubscription[] {
    return this.listSubscriptions(topicName) as unknown as TopicSubscription[]
  }
}

// ============================================================================
// EVENTS API
// ============================================================================

export class Events {
  private readonly events: QStashEvent[] = []
  private readonly eventMap = new Map<string, QStashEvent>()

  /**
   * Record an event (internal use)
   */
  _recordEvent(event: Omit<QStashEvent, 'eventId' | 'cursor'>): void {
    const eventId = generateEventId()
    const fullEvent: QStashEvent = {
      ...event,
      eventId,
      cursor: eventId,
    }
    this.events.push(fullEvent)
    this.eventMap.set(eventId, fullEvent)
  }

  /**
   * List events with optional filters
   */
  async list(options?: EventListOptions): Promise<QStashEvent[]> {
    let result = [...this.events]

    // Filter by type
    if (options?.type) {
      result = result.filter((e) => e.type === options.type)
    }

    // Filter by messageId
    if (options?.messageId) {
      result = result.filter((e) => e.messageId === options.messageId)
    }

    // Handle pagination
    if (options?.cursor) {
      const cursorIndex = result.findIndex((e) => e.eventId === options.cursor)
      if (cursorIndex !== -1) {
        result = result.slice(cursorIndex + 1)
      }
    }

    // Apply limit
    if (options?.limit) {
      result = result.slice(0, options.limit)
    }

    return result
  }

  /**
   * Get a specific event by ID
   */
  async get(eventId: string): Promise<QStashEvent | null> {
    return this.eventMap.get(eventId) ?? null
  }
}

// ============================================================================
// CLIENT
// ============================================================================

export class Client {
  readonly schedules: Schedules
  readonly urlGroups: URLGroups
  readonly dlq: DLQ
  readonly topics: Topics
  readonly events: Events
  private readonly runtime: DurableWorkflowRuntime
  private readonly deduplicationCache = new Map<string, { messageId: string; timestamp: number }>()
  private readonly config: ClientConfig
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  // Deduplication window is 1 hour, evict entries older than 2 hours
  private static readonly DEDUP_EVICTION_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours
  private static readonly DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

  constructor(config: ClientConfig = {}) {
    this.config = config
    this.runtime = new DurableWorkflowRuntime({
      storage: config.storage ?? new InMemoryStepStorage(),
      retryPolicy: config.retry
        ? {
            maxAttempts: config.retry.retries ?? 3,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
            jitter: true,
          }
        : undefined,
    })
    this.schedules = new Schedules(config.state)
    this.urlGroups = new URLGroups()
    this.dlq = new DLQ()
    this.topics = new Topics()
    this.events = new Events()

    // Start periodic cleanup of deduplication cache
    this._startDeduplicationCleanup()
  }

  /**
   * Start periodic cleanup of the deduplication cache to prevent memory leaks
   */
  private _startDeduplicationCleanup(): void {
    this.cleanupIntervalId = setInterval(() => {
      this._cleanupDeduplicationCache()
    }, Client.DEDUP_CLEANUP_INTERVAL_MS)

    // Ensure cleanup doesn't prevent process from exiting (Node.js)
    if (typeof this.cleanupIntervalId === 'object' && 'unref' in this.cleanupIntervalId) {
      this.cleanupIntervalId.unref()
    }
  }

  /**
   * Clean up expired entries from the deduplication cache
   */
  private _cleanupDeduplicationCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.deduplicationCache) {
      if (now - entry.timestamp > Client.DEDUP_EVICTION_AGE_MS) {
        this.deduplicationCache.delete(key)
      }
    }
  }

  /**
   * Stop the cleanup interval (useful for testing or shutdown)
   */
  destroy(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
  }

  /**
   * Handle callback failure - logs the error and emits a callback_failed event
   */
  private _handleCallbackFailure(messageId: string, callbackUrl: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[QStash] Callback failed for ${callbackUrl}:`, error)
    this.events._recordEvent({
      type: 'callback_failed',
      messageId,
      url: callbackUrl,
      error: errorMessage,
      timestamp: Date.now(),
    })
  }

  /**
   * Publish a message to a URL, URL group, or topic
   */
  async publish(request: PublishRequest): Promise<PublishResponse> {
    const messageId = generateMessageId()
    const bodyStr = typeof request.body === 'object' ? JSON.stringify(request.body) : (request.body ?? '')
    const maxRetries = request.retries ?? 3

    // Check for deduplication
    if (request.deduplicationId || request.contentBasedDeduplication) {
      const dedupKey = request.deduplicationId ?? (await hashBody(bodyStr))
      const cached = this.deduplicationCache.get(dedupKey)

      // QStash deduplication window is 1 hour
      if (cached && Date.now() - cached.timestamp < 60 * 60 * 1000) {
        return {
          messageId: cached.messageId,
          url: request.url,
          deduplicated: true,
        }
      }

      this.deduplicationCache.set(dedupKey, { messageId, timestamp: Date.now() })
    }

    // Record created event
    this.events._recordEvent({
      type: 'created',
      messageId,
      timestamp: Date.now(),
      url: request.url,
    })

    // Calculate delay
    const delayMs = request.delay ? parseDuration(request.delay) : 0

    // Handle URL group fan-out
    if (request.urlGroup) {
      return this._publishToUrlGroup(request, messageId, bodyStr, delayMs)
    }

    // Handle topic pub/sub (also check if it's a URL group name for simpler fan-out)
    if (request.topic) {
      const group = await this.urlGroups.get(request.topic)
      if (group) {
        // Topic name matches a URL group - do fan-out to all group endpoints
        return this._publishToUrlGroupByName(request, messageId, bodyStr, delayMs, request.topic)
      }
      return this._publishToTopic(request, messageId, bodyStr, delayMs)
    }

    // Get the destination URL
    const url = request.url ?? (request.api ? `https://qstash.upstash.io/v2/api/${request.api.name}` : '')

    if (!url) {
      throw new Error('Either url, urlGroup, topic, or api must be provided')
    }

    // Execute the delivery
    const attemptHistory: Array<{ attempt: number; timestamp: number; error?: string }> = []

    const executeDelivery = async () => {
      let lastError: Error | undefined
      let lastStatus: number | undefined
      let attempt = 0
      let shouldRetry = true

      for (attempt = 1; attempt <= maxRetries + 1 && shouldRetry; attempt++) {
        try {
          const response = await this._deliverMessage(url, bodyStr, request, messageId, attempt)

          // Record delivered event
          this.events._recordEvent({
            type: 'delivered',
            messageId,
            timestamp: Date.now(),
            url,
            statusCode: response.status,
          })

          // Call success callback
          if (request.callback) {
            const responseBody = await response.clone().text()
            const responseHeaders: Record<string, string> = {}
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value
            })

            await fetch(request.callback, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId,
                url,
                status: 'success',
                statusCode: response.status,
                body: responseBody,
                response: {
                  body: responseBody,
                  headers: responseHeaders,
                },
              }),
            }).catch((error) => {
              this._handleCallbackFailure(messageId, request.callback!, error)
            })
          }

          return // Success - exit the function
        } catch (error) {
          lastError = error as Error

          // Track attempt history
          attemptHistory.push({
            attempt,
            timestamp: Date.now(),
            error: lastError.message,
          })

          // Extract status code from error message if present
          const statusMatch = lastError.message.match(/HTTP (\d+):/)
          if (statusMatch) {
            lastStatus = parseInt(statusMatch[1], 10)

            // Don't retry on 4xx errors (client errors)
            if (!isRetryableStatus(lastStatus)) {
              shouldRetry = false
            }
          }

          // Record retry event (if not the last attempt and should retry)
          if (attempt < maxRetries + 1 && shouldRetry) {
            this.events._recordEvent({
              type: 'retry',
              messageId,
              timestamp: Date.now(),
              url,
              error: lastError.message,
              attempt,
            })

            // Wait before next retry with exponential backoff
            const backoffDelay = calculateBackoffDelay(attempt)
            await new Promise((resolve) => setTimeout(resolve, backoffDelay))
          }
        }
      }

      // All retries exhausted or non-retryable error
      this.events._recordEvent({
        type: 'failed',
        messageId,
        timestamp: Date.now(),
        url,
        error: lastError?.message,
      })

      // Send to DLQ URL if provided in request
      if (request.deadLetterQueue) {
        await fetch(request.deadLetterQueue, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            originalUrl: url,
            body: bodyStr,
            method: request.method ?? 'POST',
            headers: request.headers,
            error: lastError?.message ?? 'Unknown error',
            attempts: attempt - 1,
            timestamp: Date.now(),
          }),
        }).catch((error) => {
          // Log DLQ delivery failure
          console.error(`[QStash] DLQ delivery failed for ${request.deadLetterQueue}:`, error)
        })
      }

      // Add to internal DLQ storage
      this.dlq._addMessage({
        messageId,
        url,
        body: bodyStr,
        method: request.method ?? 'POST',
        headers: request.headers,
        failureReason: lastError?.message ?? 'Unknown error',
        attempts: attempt - 1,
        dlqTimestamp: Date.now(),
        createdAt: Date.now(),
      })

      // Record DLQ event
      this.events._recordEvent({
        type: 'dlq',
        messageId,
        timestamp: Date.now(),
        url,
        error: lastError?.message,
      })

      // Call failure callback
      if (request.failureCallback) {
        await fetch(request.failureCallback, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            url,
            status: 'failed',
            error: lastError?.message,
            attempts: attempt - 1,
            attemptHistory,
          }),
        }).catch((error) => {
          this._handleCallbackFailure(messageId, request.failureCallback!, error)
        })
      }
    }

    // Execute with delay if needed
    if (delayMs > 0) {
      setTimeout(executeDelivery, delayMs)
    } else {
      // Execute immediately (non-blocking)
      executeDelivery().catch(() => {
        // Errors handled within executeDelivery
      })
    }

    return {
      messageId,
      url,
      deduplicated: false,
    }
  }

  /**
   * Deliver a message to a single URL
   */
  private async _deliverMessage(
    url: string,
    bodyStr: string,
    request: PublishRequest,
    messageId: string,
    attempt: number = 1,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': request.contentType ?? 'application/json',
      ...request.headers,
      'Upstash-Message-Id': messageId,
    }

    // Add Upstash-Retried header on retries (attempt > 1)
    if (attempt > 1) {
      headers['Upstash-Retried'] = String(attempt - 1)
    }

    // Add signature if signing key is configured
    if (this.config.signingKey) {
      headers['Upstash-Signature'] = await generateSignature(this.config.signingKey, bodyStr)
    }

    // Setup timeout with AbortController
    let controller: AbortController | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (request.timeout) {
      controller = new AbortController()
      const timeoutMs = typeof request.timeout === 'number' ? request.timeout * 1000 : parseDuration(request.timeout)
      timeoutId = setTimeout(() => controller!.abort(), timeoutMs)
    }

    try {
      const response = await fetch(url, {
        method: request.method ?? 'POST',
        headers,
        body: bodyStr || undefined,
        signal: controller?.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      return response
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Publish to a URL group by name (for topic-based fan-out)
   */
  private async _publishToUrlGroupByName(
    request: PublishRequest,
    messageId: string,
    bodyStr: string,
    delayMs: number,
    groupName: string,
  ): Promise<PublishResponse> {
    const group = await this.urlGroups.get(groupName)
    if (!group) {
      throw new Error(`URL group '${groupName}' not found`)
    }

    const deliveries: DeliveryStatus[] = group.endpoints.map((endpoint) => ({
      url: endpoint.url,
      status: 'pending' as const,
      timestamp: Date.now(),
    }))

    const executeDelivery = async () => {
      const deliveryPromises = group.endpoints.map(async (endpoint, index) => {
        try {
          const response = await this._deliverMessage(endpoint.url, bodyStr, request, messageId, 1)
          deliveries[index] = {
            url: endpoint.url,
            status: 'success',
            statusCode: response.status,
            timestamp: Date.now(),
          }
        } catch (error) {
          deliveries[index] = {
            url: endpoint.url,
            status: 'failed',
            error: ensureError(error).message,
            timestamp: Date.now(),
          }
        }
      })

      await Promise.all(deliveryPromises)
    }

    if (delayMs > 0) {
      setTimeout(executeDelivery, delayMs)
    } else {
      executeDelivery().catch(() => {})
    }

    return {
      messageId,
      topic: groupName,
      deliveries,
      deduplicated: false,
    }
  }

  /**
   * Publish to a URL group (fan-out)
   */
  private async _publishToUrlGroup(
    request: PublishRequest,
    messageId: string,
    bodyStr: string,
    delayMs: number,
  ): Promise<PublishResponse> {
    const group = await this.urlGroups.get(request.urlGroup!)
    if (!group) {
      throw new Error(`URL group '${request.urlGroup}' not found`)
    }

    const deliveries: DeliveryStatus[] = group.endpoints.map((endpoint) => ({
      url: endpoint.url,
      status: 'pending' as const,
      timestamp: Date.now(),
    }))

    const executeDelivery = async () => {
      const deliveryPromises = group.endpoints.map(async (endpoint, index) => {
        try {
          const response = await this._deliverMessage(endpoint.url, bodyStr, request, messageId)
          deliveries[index] = {
            url: endpoint.url,
            status: 'success',
            statusCode: response.status,
            timestamp: Date.now(),
          }

          // Call callback for each successful delivery
          if (request.callback) {
            await fetch(request.callback, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId,
                destinationUrl: endpoint.url,
                status: 'success',
                statusCode: response.status,
              }),
            }).catch((err) => {
              this._handleCallbackFailure(messageId, request.callback!, err)
            })
          }
        } catch (error) {
          const errorMessage = ensureError(error).message
          deliveries[index] = {
            url: endpoint.url,
            status: 'failed',
            error: errorMessage,
            timestamp: Date.now(),
          }

          // Call callback for each failed delivery
          if (request.callback) {
            await fetch(request.callback, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId,
                destinationUrl: endpoint.url,
                status: 'failed',
                error: errorMessage,
              }),
            }).catch((err) => {
              this._handleCallbackFailure(messageId, request.callback!, err)
            })
          }
        }
      })

      await Promise.all(deliveryPromises)
    }

    if (delayMs > 0) {
      setTimeout(executeDelivery, delayMs)
    } else {
      executeDelivery().catch(() => {})
    }

    return {
      messageId,
      urlGroup: request.urlGroup,
      deliveries,
      deduplicated: false,
    }
  }

  /**
   * Publish to a topic (pub/sub)
   */
  private async _publishToTopic(
    request: PublishRequest,
    messageId: string,
    bodyStr: string,
    delayMs: number,
  ): Promise<PublishResponse> {
    const subscriptions = await this.topics.listSubscriptions(request.topic!)
    const deliveries: DeliveryStatus[] = []

    const executeDelivery = async () => {
      for (const sub of subscriptions) {
        if (sub.url) {
          // Direct URL subscription
          try {
            await this._deliverMessage(sub.url, bodyStr, request, messageId)
            deliveries.push({
              url: sub.url,
              status: 'success',
              timestamp: Date.now(),
            })
          } catch (error) {
            deliveries.push({
              url: sub.url,
              status: 'failed',
              error: ensureError(error).message,
              timestamp: Date.now(),
            })
          }
        } else if (sub.urlGroup) {
          // URL group subscription
          const group = await this.urlGroups.get(sub.urlGroup)
          if (group) {
            for (const endpoint of group.endpoints) {
              try {
                await this._deliverMessage(endpoint.url, bodyStr, request, messageId)
                deliveries.push({
                  url: endpoint.url,
                  status: 'success',
                  timestamp: Date.now(),
                })
              } catch (error) {
                deliveries.push({
                  url: endpoint.url,
                  status: 'failed',
                  error: ensureError(error).message,
                  timestamp: Date.now(),
                })
              }
            }
          }
        }
      }
    }

    if (delayMs > 0) {
      setTimeout(executeDelivery, delayMs)
    } else {
      executeDelivery().catch(() => {})
    }

    return {
      messageId,
      topic: request.topic,
      deliveries,
      deduplicated: false,
    }
  }

  /**
   * Publish JSON data to a URL (convenience method)
   */
  async publishJSON<T extends object>(request: Omit<PublishRequest, 'body'> & { body: T }): Promise<PublishResponse> {
    return this.publish({
      ...request,
      body: request.body,
      contentType: 'application/json',
    })
  }

  /**
   * Publish multiple messages in a batch
   * Uses Promise.allSettled to return partial results even if some messages fail
   */
  async batch(messages: PublishRequest[]): Promise<BatchResponse> {
    const results = await Promise.allSettled(messages.map((msg) => this.publish(msg)))
    const responses: PublishResponse[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      // For rejected promises, return a minimal response with error info
      return {
        messageId: `failed_${index}`,
        url: messages[index].url,
        deduplicated: false,
        error: result.reason?.message || 'Unknown error',
      } as PublishResponse & { error?: string }
    })
    return { responses }
  }

  /**
   * Enqueue a message (alias for publish)
   */
  async enqueue(request: PublishRequest): Promise<PublishResponse> {
    return this.publish(request)
  }

  /**
   * Get a message by ID (stub - QStash doesn't actually support this well)
   */
  async getMessage(_messageId: string): Promise<MessageMeta | null> {
    // QStash doesn't have a direct getMessage API
    // This would need to be implemented via DLQ or logs
    return null
  }

  /**
   * Publish to a URL group (fan-out) by topic name
   */
  async publishToGroup(request: Omit<PublishRequest, 'url'> & { topic: string }): Promise<PublishToGroupResponse> {
    const group = await this.urlGroups.get(request.topic)
    if (!group) {
      throw new Error(`URL group '${request.topic}' not found`)
    }

    const messageId = generateMessageId()
    const bodyStr = typeof request.body === 'object' ? JSON.stringify(request.body) : (request.body ?? '')

    const responses: PublishResponse[] = group.endpoints.map((endpoint) => ({
      messageId,
      url: endpoint.url,
      deduplicated: false,
    }))

    // Calculate delay
    const delayMs = request.delay ? parseDuration(request.delay) : 0

    const executeDelivery = async () => {
      await Promise.all(
        group.endpoints.map(async (endpoint) => {
          try {
            await this._deliverMessage(endpoint.url, bodyStr, request as PublishRequest, messageId, 1)
          } catch {
            // Errors logged elsewhere
          }
        })
      )
    }

    if (delayMs > 0) {
      setTimeout(executeDelivery, delayMs)
    } else {
      executeDelivery().catch(() => {})
    }

    return { responses }
  }
}

/** Response from publishToGroup */
export interface PublishToGroupResponse {
  /** Array of responses for each endpoint */
  responses: PublishResponse[]
}

// ============================================================================
// RECEIVER
// ============================================================================

export class Receiver {
  private readonly currentSigningKey: string
  private readonly nextSigningKey: string

  constructor(config: ReceiverConfig) {
    this.currentSigningKey = config.currentSigningKey
    this.nextSigningKey = config.nextSigningKey
  }

  /**
   * Verify a QStash webhook signature
   */
  async verify(request: VerifyRequest): Promise<boolean> {
    const { signature, body, clockTolerance = 0 } = request

    // QStash signature format: t=<timestamp>,v1=<signature>
    const parts = signature.split(',')
    const timestampPart = parts.find((p) => p.startsWith('t='))
    const signaturePart = parts.find((p) => p.startsWith('v1='))

    if (!timestampPart || !signaturePart) {
      return false
    }

    const timestamp = parseInt(timestampPart.slice(2), 10)
    const expectedSignature = signaturePart.slice(3)

    // Check timestamp tolerance
    if (clockTolerance > 0) {
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - timestamp) > clockTolerance) {
        return false
      }
    }

    // Verify signature with both keys
    const payload = `${timestamp}.${body}`

    for (const key of [this.currentSigningKey, this.nextSigningKey]) {
      if (!key) continue

      try {
        const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

        const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload))

        const computedSignature = Array.from(new Uint8Array(signatureBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')

        if (computedSignature === expectedSignature) {
          return true
        }
      } catch {
        continue
      }
    }

    return false
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Client
export { parseCronExpression, getNextRunTime }
