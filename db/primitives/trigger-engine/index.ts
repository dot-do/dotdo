/**
 * TriggerEngine - Universal webhook/polling/schedule triggers
 *
 * Provides a unified trigger system for all automation platforms:
 * - **WebhookReceiver** - Inbound webhook handling with signature validation
 * - **PollingScheduler** - Rate-limited polling with state tracking
 * - **EventBus** - DO-native pub/sub with filtering
 * - **TriggerRegistry** - Register/unregister/list triggers
 * - **ScheduleManager** - Cron-based scheduling
 *
 * ## Features
 * - Unified API for all trigger types (webhook, polling, event, schedule)
 * - Signature validation for secure webhooks (HMAC-SHA256, etc.)
 * - Rate limiting and exponential backoff for polling
 * - Pattern matching for event subscriptions
 * - Async iterator interface for consuming events
 * - Full observability with metrics
 *
 * ## Usage
 * ```typescript
 * import { createTriggerEngine } from './trigger-engine'
 *
 * const engine = createTriggerEngine()
 *
 * // Register a webhook trigger
 * await engine.register({
 *   id: 'github-webhook',
 *   type: 'webhook',
 *   name: 'GitHub Events',
 *   webhook: {
 *     path: '/webhooks/github',
 *     secret: process.env.GITHUB_SECRET,
 *     signatureValidator: githubValidator,
 *   },
 *   handler: async (event) => {
 *     console.log('Received:', event.payload)
 *   },
 * })
 *
 * // Register a polling trigger
 * await engine.register({
 *   id: 'api-poll',
 *   type: 'polling',
 *   name: 'API Polling',
 *   polling: {
 *     interval: 60000,
 *     fetcher: async ({ cursor }) => {
 *       const data = await fetchNewItems(cursor)
 *       return { data: data.items, cursor: data.nextCursor }
 *     },
 *   },
 *   handler: async (event) => {
 *     await processItem(event.payload)
 *   },
 * })
 *
 * // Handle incoming webhook
 * await engine.handleWebhook({
 *   method: 'POST',
 *   path: '/webhooks/github',
 *   body: { ... },
 *   headers: { 'x-hub-signature-256': '...' },
 * })
 * ```
 *
 * @module db/primitives/trigger-engine
 */

import { type MetricsCollector, noopMetrics } from '../observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Trigger types supported by the engine
 */
export type TriggerType = 'webhook' | 'polling' | 'event' | 'schedule'

/**
 * Trigger status
 */
export type TriggerStatus = 'active' | 'disabled' | 'error'

/**
 * Polling status
 */
export type PollingStatus = 'stopped' | 'running' | 'error'

/**
 * HTTP methods for webhooks
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Signature validator interface for webhook security
 */
export interface SignatureValidator {
  /** Validate the signature */
  validate(payload: unknown, signature: string, secret: string): Promise<boolean>
  /** HTTP header name containing the signature */
  headerName: string
}

/**
 * Webhook payload received from external systems
 */
export interface WebhookPayload {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
  query?: Record<string, string>
}

/**
 * Polling result from fetcher function
 */
export interface PollingResult<T = unknown> {
  /** New items fetched */
  data: T[]
  /** Cursor for next fetch (null if no more data) */
  cursor: string | null
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Polling context passed to fetcher
 */
export interface PollingContext {
  /** Cursor from previous fetch */
  cursor: string | undefined
  /** Trigger ID */
  triggerId: string
  /** Attempt number (for retries) */
  attempt: number
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests in window */
  maxRequests: number
  /** Window duration in milliseconds */
  windowMs: number
}

/**
 * Backoff configuration for retries
 */
export interface BackoffConfig {
  /** Initial delay in milliseconds */
  initialDelay: number
  /** Maximum delay in milliseconds */
  maxDelay: number
  /** Multiplier for exponential backoff */
  multiplier: number
}

/**
 * Webhook trigger configuration
 */
export interface WebhookTriggerConfig {
  /** URL path to match */
  path: string
  /** Allowed HTTP methods (default: all) */
  methods?: HttpMethod[]
  /** Secret for signature validation */
  secret?: string
  /** Signature validator */
  signatureValidator?: SignatureValidator
}

/**
 * Polling trigger configuration
 */
export interface PollingTriggerConfig {
  /** Polling interval in milliseconds */
  interval: number
  /** Fetcher function */
  fetcher: (ctx: PollingContext) => Promise<PollingResult>
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
  /** Backoff configuration for errors */
  backoff?: BackoffConfig
  /** Deduplication key extractor */
  dedupeKey?: (item: unknown) => string
  /** Deduplication window in milliseconds */
  dedupeWindowMs?: number
}

/**
 * Event trigger configuration
 */
export interface EventTriggerConfig {
  /** Single channel to subscribe to */
  channel?: string
  /** Multiple channels to subscribe to */
  channels?: string[]
  /** Filter function for events */
  filter?: (payload: unknown) => boolean
}

/**
 * Schedule trigger configuration
 */
export interface ScheduleTriggerConfig {
  /** Cron expression */
  cron: string
  /** Timezone (default: UTC) */
  timezone?: string
}

/**
 * Trigger event passed to handlers
 */
export interface TriggerEvent<T = unknown> {
  /** Event ID */
  id: string
  /** Trigger type */
  type: TriggerType
  /** Trigger ID */
  triggerId: string
  /** Event payload */
  payload: T
  /** Path parameters (for webhooks) */
  params?: Record<string, string>
  /** Event metadata */
  metadata?: {
    method?: string
    headers?: Record<string, string>
    query?: Record<string, string>
    channel?: string
    scheduledTime?: number
    cron?: string
    correlationId?: string
    source?: string
    timestamp?: number
    [key: string]: unknown
  }
  /** Event timestamp */
  timestamp: number
}

/**
 * Trigger handler function
 */
export type TriggerHandler<T = unknown> = (event: TriggerEvent<T>) => Promise<void> | void

/**
 * Trigger configuration
 */
export interface TriggerConfig<T = unknown> {
  /** Unique trigger ID */
  id: string
  /** Trigger type */
  type: TriggerType
  /** Human-readable name */
  name: string
  /** Webhook configuration */
  webhook?: WebhookTriggerConfig
  /** Polling configuration */
  polling?: PollingTriggerConfig
  /** Event configuration */
  event?: EventTriggerConfig
  /** Schedule configuration */
  schedule?: ScheduleTriggerConfig
  /** Event handler */
  handler?: TriggerHandler<T>
  /** Tags for filtering */
  tags?: string[]
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Registered trigger with runtime state
 */
export interface Trigger<T = unknown> extends TriggerConfig<T> {
  /** Current status */
  status: TriggerStatus
  /** Polling status (for polling triggers) */
  pollingStatus?: PollingStatus
  /** Created timestamp */
  createdAt: number
  /** Updated timestamp */
  updatedAt: number
}

/**
 * Trigger statistics
 */
export interface TriggerStats {
  /** Total invocation count */
  invocationCount: number
  /** Last invocation timestamp */
  lastInvocationAt?: number
  /** Error count */
  errorCount: number
  /** Average handler latency in ms */
  averageLatencyMs: number
  /** Active async iterator subscribers */
  activeSubscribers: number
}

/**
 * List filter options
 */
export interface ListOptions {
  /** Filter by type */
  type?: TriggerType
  /** Filter by status */
  status?: TriggerStatus
  /** Filter by tags */
  tags?: string[]
}

/**
 * Event metadata for emit
 */
export interface EventMetadata {
  correlationId?: string
  source?: string
  timestamp?: number
  [key: string]: unknown
}

/**
 * Trigger engine options
 */
export interface TriggerEngineOptions {
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * TriggerEngine interface
 */
export interface TriggerEngine {
  // Registry operations
  register<T = unknown>(config: TriggerConfig<T>): Promise<Trigger<T>>
  unregister(id: string): Promise<void>
  list(options?: ListOptions): Promise<Trigger[]>
  get(id: string): Promise<Trigger | null>
  enable(id: string): Promise<void>
  disable(id: string): Promise<void>

  // Webhook handling
  handleWebhook(payload: WebhookPayload): Promise<void>

  // Polling control
  startPolling(id: string): Promise<void>
  stopPolling(id: string): Promise<void>

  // Schedule control
  startSchedule(id: string): Promise<void>
  stopSchedule(id: string): Promise<void>

  // Event emission
  emit(channel: string, payload: unknown, metadata?: EventMetadata): Promise<void>

  // Subscription (async iterator)
  subscribe(triggerId: string): AsyncIterator<TriggerEvent>

  // Statistics
  getStats(triggerId: string): Promise<TriggerStats>

  // Cleanup
  close(): Promise<void>
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal trigger state
 * @internal
 */
interface TriggerState {
  trigger: Trigger
  stats: TriggerStats
  latencies: number[]
  // Polling state
  pollingTimer?: ReturnType<typeof setTimeout>
  pollingCursor?: string
  lastPollTime?: number
  pollErrorCount: number
  currentBackoff: number
  // Rate limiting
  rateLimitWindow?: number
  rateLimitCount: number
  // Deduplication
  dedupeCache: Map<string, number>
  // Schedule state
  scheduleTimer?: ReturnType<typeof setTimeout>
  // Subscriptions
  subscriptions: Set<SubscriptionState>
}

/**
 * Subscription state for async iterators
 * @internal
 */
interface SubscriptionState {
  buffer: TriggerEvent[]
  resolvers: Array<(value: IteratorResult<TriggerEvent>) => void>
  closed: boolean
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `evt_${timestamp}_${random}`
}

/**
 * Match URL path with parameters
 * Returns null if no match, or object with params if match
 */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')

  if (patternParts.length !== pathParts.length) {
    return null
  }

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]!
    const pathPart = pathParts[i]!

    if (patternPart.startsWith(':')) {
      // Parameter
      params[patternPart.slice(1)] = pathPart
    } else if (patternPart !== pathPart) {
      return null
    }
  }

  return params
}

/**
 * Match glob pattern for event channels
 */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern === value) return true

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    const parts = value.split('.')
    const prefixParts = prefix.split('.')

    if (parts.length !== prefixParts.length + 1) return false

    for (let i = 0; i < prefixParts.length; i++) {
      if (prefixParts[i] !== parts[i]) return false
    }
    return true
  }

  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3)
    return value.startsWith(prefix + '.')
  }

  // Simple wildcard matching
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$'
  )
  return regex.test(value)
}

/**
 * Parse cron expression to get next execution time
 * Simple implementation - supports: minute hour day month weekday
 */
function getNextCronTime(cron: string, from: Date = new Date()): Date {
  const parts = cron.split(' ')
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cron}`)
  }

  const [minute, hour, day, month, weekday] = parts

  // Simple implementation: find next matching minute
  const next = new Date(from)
  next.setSeconds(0)
  next.setMilliseconds(0)

  // Handle */n patterns
  const parseField = (field: string, current: number, max: number): number => {
    if (field === '*') return current
    if (field.startsWith('*/')) {
      const interval = parseInt(field.slice(2), 10)
      const nextVal = Math.ceil((current + 1) / interval) * interval
      return nextVal > max ? interval : nextVal
    }
    return parseInt(field, 10)
  }

  // Advance by 1 minute minimum
  next.setMinutes(next.getMinutes() + 1)

  // Match minute
  if (minute !== '*' && !minute!.startsWith('*/')) {
    const targetMinute = parseInt(minute!, 10)
    if (next.getMinutes() > targetMinute) {
      next.setHours(next.getHours() + 1)
    }
    next.setMinutes(targetMinute)
  } else if (minute!.startsWith('*/')) {
    const interval = parseInt(minute!.slice(2), 10)
    const currentMinute = next.getMinutes()
    const nextMinute = Math.ceil(currentMinute / interval) * interval
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1)
      next.setMinutes(0)
    } else {
      next.setMinutes(nextMinute)
    }
  }

  // Match hour
  if (hour !== '*' && !hour!.startsWith('*/')) {
    const targetHour = parseInt(hour!, 10)
    if (next.getHours() > targetHour) {
      next.setDate(next.getDate() + 1)
    }
    next.setHours(targetHour)
  }

  return next
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * TriggerEngine implementation
 * @internal
 */
class TriggerEngineImpl implements TriggerEngine {
  private triggers: Map<string, TriggerState> = new Map()
  private webhookIndex: Map<string, string[]> = new Map() // path -> trigger ids
  private eventSubscriptions: Map<string, Set<string>> = new Map() // channel pattern -> trigger ids
  private metrics: MetricsCollector
  private closed = false

  constructor(options?: TriggerEngineOptions) {
    this.metrics = options?.metrics ?? noopMetrics
  }

  // ===========================================================================
  // REGISTRY OPERATIONS
  // ===========================================================================

  async register<T = unknown>(config: TriggerConfig<T>): Promise<Trigger<T>> {
    if (this.closed) {
      throw new Error('TriggerEngine is closed')
    }

    if (this.triggers.has(config.id)) {
      throw new Error(`Trigger '${config.id}' already exists`)
    }

    const now = Date.now()
    const trigger: Trigger<T> = {
      ...config,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    const state: TriggerState = {
      trigger: trigger as Trigger,
      stats: {
        invocationCount: 0,
        errorCount: 0,
        averageLatencyMs: 0,
        activeSubscribers: 0,
      },
      latencies: [],
      pollErrorCount: 0,
      currentBackoff: 0,
      rateLimitCount: 0,
      dedupeCache: new Map(),
      subscriptions: new Set(),
    }

    this.triggers.set(config.id, state)

    // Index by webhook path
    if (config.type === 'webhook' && config.webhook) {
      const path = config.webhook.path
      let ids = this.webhookIndex.get(path)
      if (!ids) {
        ids = []
        this.webhookIndex.set(path, ids)
      }
      ids.push(config.id)
    }

    // Index by event channel
    if (config.type === 'event' && config.event) {
      const channels = config.event.channels ?? (config.event.channel ? [config.event.channel] : [])
      for (const channel of channels) {
        let ids = this.eventSubscriptions.get(channel)
        if (!ids) {
          ids = new Set()
          this.eventSubscriptions.set(channel, ids)
        }
        ids.add(config.id)
      }
    }

    this.metrics.incrementCounter('trigger.registered', { type: config.type })

    return trigger
  }

  async unregister(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) return

    // Stop any running operations
    if (state.pollingTimer) {
      clearTimeout(state.pollingTimer)
    }
    if (state.scheduleTimer) {
      clearTimeout(state.scheduleTimer)
    }

    // Close subscriptions
    for (const sub of state.subscriptions) {
      sub.closed = true
      for (const resolver of sub.resolvers) {
        resolver({ done: true, value: undefined as unknown as TriggerEvent })
      }
    }

    // Remove from indexes
    const trigger = state.trigger
    if (trigger.type === 'webhook' && trigger.webhook) {
      const ids = this.webhookIndex.get(trigger.webhook.path)
      if (ids) {
        const idx = ids.indexOf(id)
        if (idx !== -1) ids.splice(idx, 1)
        if (ids.length === 0) this.webhookIndex.delete(trigger.webhook.path)
      }
    }

    if (trigger.type === 'event' && trigger.event) {
      const channels = trigger.event.channels ?? (trigger.event.channel ? [trigger.event.channel] : [])
      for (const channel of channels) {
        const ids = this.eventSubscriptions.get(channel)
        if (ids) {
          ids.delete(id)
          if (ids.size === 0) this.eventSubscriptions.delete(channel)
        }
      }
    }

    this.triggers.delete(id)
    this.metrics.incrementCounter('trigger.unregistered')
  }

  async list(options?: ListOptions): Promise<Trigger[]> {
    const results: Trigger[] = []

    for (const state of this.triggers.values()) {
      const trigger = state.trigger

      // Apply filters
      if (options?.type && trigger.type !== options.type) continue
      if (options?.status && trigger.status !== options.status) continue
      if (options?.tags) {
        const hasTags = options.tags.every((t) => trigger.tags?.includes(t))
        if (!hasTags) continue
      }

      results.push(trigger)
    }

    return results
  }

  async get(id: string): Promise<Trigger | null> {
    const state = this.triggers.get(id)
    return state?.trigger ?? null
  }

  async enable(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) {
      throw new Error(`Trigger '${id}' not found`)
    }

    state.trigger.status = 'active'
    state.trigger.updatedAt = Date.now()
  }

  async disable(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) {
      throw new Error(`Trigger '${id}' not found`)
    }

    state.trigger.status = 'disabled'
    state.trigger.updatedAt = Date.now()

    // Stop polling if running
    if (state.pollingTimer) {
      clearTimeout(state.pollingTimer)
      state.pollingTimer = undefined
      state.trigger.pollingStatus = 'stopped'
    }

    // Stop schedule if running
    if (state.scheduleTimer) {
      clearTimeout(state.scheduleTimer)
      state.scheduleTimer = undefined
    }
  }

  // ===========================================================================
  // WEBHOOK HANDLING
  // ===========================================================================

  async handleWebhook(payload: WebhookPayload): Promise<void> {
    const start = performance.now()

    // Find matching trigger
    let matchedState: TriggerState | null = null
    let matchedParams: Record<string, string> = {}

    // Check exact path match first
    const exactIds = this.webhookIndex.get(payload.path)
    if (exactIds && exactIds.length > 0) {
      for (const id of exactIds) {
        const state = this.triggers.get(id)
        if (state && state.trigger.status === 'active') {
          matchedState = state
          break
        }
      }
    }

    // Check pattern matches
    if (!matchedState) {
      for (const [pattern, ids] of this.webhookIndex) {
        const params = matchPath(pattern, payload.path)
        if (params) {
          for (const id of ids) {
            const state = this.triggers.get(id)
            if (state && state.trigger.status === 'active') {
              matchedState = state
              matchedParams = params
              break
            }
          }
          if (matchedState) break
        }
      }
    }

    if (!matchedState) {
      throw new Error(`Webhook not found for path: ${payload.path}`)
    }

    const trigger = matchedState.trigger
    const webhookConfig = trigger.webhook!

    // Check if disabled
    if (trigger.status === 'disabled') {
      throw new Error(`Webhook trigger '${trigger.id}' is disabled`)
    }

    // Check method
    if (webhookConfig.methods && webhookConfig.methods.length > 0) {
      if (!webhookConfig.methods.includes(payload.method as HttpMethod)) {
        throw new Error(`Method not allowed: ${payload.method}`)
      }
    }

    // Validate signature if configured
    if (webhookConfig.signatureValidator && webhookConfig.secret) {
      const signature = payload.headers[webhookConfig.signatureValidator.headerName]
      if (!signature) {
        throw new Error('Missing signature header')
      }

      const isValid = await webhookConfig.signatureValidator.validate(
        payload.body,
        signature,
        webhookConfig.secret
      )

      if (!isValid) {
        this.metrics.incrementCounter('trigger.signature_invalid')
        throw new Error('Invalid webhook signature')
      }
    }

    // Create event
    const event: TriggerEvent = {
      id: generateId(),
      type: 'webhook',
      triggerId: trigger.id,
      payload: payload.body,
      params: Object.keys(matchedParams).length > 0 ? matchedParams : undefined,
      metadata: {
        method: payload.method,
        headers: payload.headers,
        query: payload.query,
      },
      timestamp: Date.now(),
    }

    // Update stats
    matchedState.stats.invocationCount++
    matchedState.stats.lastInvocationAt = Date.now()

    // Deliver to subscriptions
    this.deliverToSubscriptions(matchedState, event)

    // Call handler
    if (trigger.handler) {
      try {
        await trigger.handler(event)
      } catch (error) {
        matchedState.stats.errorCount++
        this.metrics.incrementCounter('trigger.errors', { triggerId: trigger.id })
        throw error
      }
    }

    // Record metrics
    const latency = performance.now() - start
    matchedState.latencies.push(latency)
    if (matchedState.latencies.length > 100) matchedState.latencies.shift()
    matchedState.stats.averageLatencyMs =
      matchedState.latencies.reduce((a, b) => a + b, 0) / matchedState.latencies.length

    this.metrics.incrementCounter('trigger.invocations', { type: 'webhook', triggerId: trigger.id })
    this.metrics.recordLatency('trigger.handler.latency', latency, { type: 'webhook' })
  }

  // ===========================================================================
  // POLLING CONTROL
  // ===========================================================================

  async startPolling(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) {
      throw new Error(`Trigger '${id}' not found`)
    }

    if (state.trigger.type !== 'polling') {
      throw new Error(`Trigger '${id}' is not a polling trigger`)
    }

    if (state.pollingTimer) {
      return // Already running
    }

    state.trigger.pollingStatus = 'running'
    state.pollErrorCount = 0
    state.currentBackoff = 0

    // Execute immediately
    this.executePoll(state)
  }

  async stopPolling(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) return

    if (state.pollingTimer) {
      clearTimeout(state.pollingTimer)
      state.pollingTimer = undefined
    }

    state.trigger.pollingStatus = 'stopped'
  }

  private async executePoll(state: TriggerState): Promise<void> {
    const trigger = state.trigger
    const config = trigger.polling!

    // Check rate limit
    if (config.rateLimit) {
      const now = Date.now()
      if (!state.rateLimitWindow || now - state.rateLimitWindow >= config.rateLimit.windowMs) {
        state.rateLimitWindow = now
        state.rateLimitCount = 0
      }

      if (state.rateLimitCount >= config.rateLimit.maxRequests) {
        // Wait for window to reset
        const waitTime = config.rateLimit.windowMs - (now - state.rateLimitWindow)
        state.pollingTimer = setTimeout(() => this.executePoll(state), waitTime)
        return
      }

      state.rateLimitCount++
    }

    try {
      const ctx: PollingContext = {
        cursor: state.pollingCursor,
        triggerId: trigger.id,
        attempt: state.pollErrorCount + 1,
      }

      const result = await config.fetcher(ctx)

      // Update cursor
      if (result.cursor !== null) {
        state.pollingCursor = result.cursor
      }

      // Process items
      for (const item of result.data) {
        // Dedupe check
        if (config.dedupeKey && config.dedupeWindowMs) {
          const key = config.dedupeKey(item)
          const lastSeen = state.dedupeCache.get(key)
          const now = Date.now()

          if (lastSeen && now - lastSeen < config.dedupeWindowMs) {
            continue // Skip duplicate
          }

          state.dedupeCache.set(key, now)

          // Clean old entries
          for (const [k, v] of state.dedupeCache) {
            if (now - v > config.dedupeWindowMs) {
              state.dedupeCache.delete(k)
            }
          }
        }

        // Create event
        const event: TriggerEvent = {
          id: generateId(),
          type: 'polling',
          triggerId: trigger.id,
          payload: item,
          timestamp: Date.now(),
        }

        // Update stats
        state.stats.invocationCount++
        state.stats.lastInvocationAt = Date.now()

        // Deliver to subscriptions
        this.deliverToSubscriptions(state, event)

        // Call handler
        if (trigger.handler) {
          try {
            await trigger.handler(event)
          } catch (error) {
            state.stats.errorCount++
            this.metrics.incrementCounter('trigger.errors', { triggerId: trigger.id })
          }
        }
      }

      // Reset backoff on success
      state.pollErrorCount = 0
      state.currentBackoff = 0

      this.metrics.incrementCounter('trigger.polling.fetched', undefined, result.data.length)

      // Schedule next poll
      state.pollingTimer = setTimeout(() => this.executePoll(state), config.interval)
    } catch (error) {
      state.pollErrorCount++
      state.stats.errorCount++
      this.metrics.incrementCounter('trigger.polling.errors')

      // Calculate backoff
      if (config.backoff) {
        if (state.currentBackoff === 0) {
          state.currentBackoff = config.backoff.initialDelay
        } else {
          state.currentBackoff = Math.min(
            state.currentBackoff * config.backoff.multiplier,
            config.backoff.maxDelay
          )
        }
        state.pollingTimer = setTimeout(() => this.executePoll(state), state.currentBackoff)
      } else {
        // Default: retry with normal interval
        state.pollingTimer = setTimeout(() => this.executePoll(state), config.interval)
      }
    }
  }

  // ===========================================================================
  // SCHEDULE CONTROL
  // ===========================================================================

  async startSchedule(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) {
      throw new Error(`Trigger '${id}' not found`)
    }

    if (state.trigger.type !== 'schedule') {
      throw new Error(`Trigger '${id}' is not a schedule trigger`)
    }

    if (state.scheduleTimer) {
      return // Already running
    }

    this.scheduleNext(state)
  }

  async stopSchedule(id: string): Promise<void> {
    const state = this.triggers.get(id)
    if (!state) return

    if (state.scheduleTimer) {
      clearTimeout(state.scheduleTimer)
      state.scheduleTimer = undefined
    }
  }

  private scheduleNext(state: TriggerState): void {
    const trigger = state.trigger
    const config = trigger.schedule!

    const nextTime = getNextCronTime(config.cron)
    const delay = nextTime.getTime() - Date.now()

    state.scheduleTimer = setTimeout(async () => {
      // Create event
      const event: TriggerEvent = {
        id: generateId(),
        type: 'schedule',
        triggerId: trigger.id,
        payload: {},
        metadata: {
          scheduledTime: nextTime.getTime(),
          cron: config.cron,
        },
        timestamp: Date.now(),
      }

      // Update stats
      state.stats.invocationCount++
      state.stats.lastInvocationAt = Date.now()

      // Deliver to subscriptions
      this.deliverToSubscriptions(state, event)

      // Call handler
      if (trigger.handler) {
        try {
          await trigger.handler(event)
        } catch (error) {
          state.stats.errorCount++
          this.metrics.incrementCounter('trigger.errors', { triggerId: trigger.id })
        }
      }

      this.metrics.incrementCounter('trigger.schedule.executed', { triggerId: trigger.id })

      // Schedule next execution
      this.scheduleNext(state)
    }, Math.max(0, delay))
  }

  // ===========================================================================
  // EVENT EMISSION
  // ===========================================================================

  async emit(channel: string, payload: unknown, metadata?: EventMetadata): Promise<void> {
    const matchedIds = new Set<string>()

    // Find all matching triggers
    for (const [pattern, ids] of this.eventSubscriptions) {
      if (matchGlob(pattern, channel)) {
        for (const id of ids) {
          matchedIds.add(id)
        }
      }
    }

    // Trigger each matching subscription
    for (const id of matchedIds) {
      const state = this.triggers.get(id)
      if (!state || state.trigger.status !== 'active') continue

      const trigger = state.trigger
      const eventConfig = trigger.event!

      // Apply filter
      if (eventConfig.filter && !eventConfig.filter(payload)) {
        continue
      }

      // Create event
      const event: TriggerEvent = {
        id: generateId(),
        type: 'event',
        triggerId: trigger.id,
        payload,
        metadata: {
          channel,
          ...metadata,
        },
        timestamp: Date.now(),
      }

      // Update stats
      state.stats.invocationCount++
      state.stats.lastInvocationAt = Date.now()

      // Deliver to subscriptions
      this.deliverToSubscriptions(state, event)

      // Call handler
      if (trigger.handler) {
        try {
          await trigger.handler(event)
        } catch (error) {
          state.stats.errorCount++
          this.metrics.incrementCounter('trigger.errors', { triggerId: trigger.id })
        }
      }

      this.metrics.incrementCounter('trigger.invocations', { type: 'event', triggerId: trigger.id })
    }
  }

  // ===========================================================================
  // SUBSCRIPTION (ASYNC ITERATOR)
  // ===========================================================================

  subscribe(triggerId: string): AsyncIterator<TriggerEvent> {
    const state = this.triggers.get(triggerId)
    if (!state) {
      throw new Error(`Trigger '${triggerId}' not found`)
    }

    const sub: SubscriptionState = {
      buffer: [],
      resolvers: [],
      closed: false,
    }

    state.subscriptions.add(sub)
    state.stats.activeSubscribers = state.subscriptions.size

    const self = this

    const iterator: AsyncIterator<TriggerEvent> = {
      async next(): Promise<IteratorResult<TriggerEvent>> {
        if (sub.closed) {
          return { done: true, value: undefined as unknown as TriggerEvent }
        }

        // Return buffered event
        if (sub.buffer.length > 0) {
          return { done: false, value: sub.buffer.shift()! }
        }

        // Wait for next event
        return new Promise((resolve) => {
          if (sub.closed) {
            resolve({ done: true, value: undefined as unknown as TriggerEvent })
            return
          }
          sub.resolvers.push(resolve)
        })
      },

      async return(): Promise<IteratorResult<TriggerEvent>> {
        sub.closed = true
        state.subscriptions.delete(sub)
        state.stats.activeSubscribers = state.subscriptions.size

        // Resolve pending
        for (const resolver of sub.resolvers) {
          resolver({ done: true, value: undefined as unknown as TriggerEvent })
        }
        sub.resolvers = []

        return { done: true, value: undefined as unknown as TriggerEvent }
      },

      async throw(error?: Error): Promise<IteratorResult<TriggerEvent>> {
        await this.return!()
        if (error) throw error
        return { done: true, value: undefined as unknown as TriggerEvent }
      },
    }

    return iterator
  }

  private deliverToSubscriptions(state: TriggerState, event: TriggerEvent): void {
    for (const sub of state.subscriptions) {
      if (sub.closed) continue

      if (sub.resolvers.length > 0) {
        const resolver = sub.resolvers.shift()!
        resolver({ done: false, value: event })
      } else {
        sub.buffer.push(event)
      }
    }
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  async getStats(triggerId: string): Promise<TriggerStats> {
    const state = this.triggers.get(triggerId)
    if (!state) {
      throw new Error(`Trigger '${triggerId}' not found`)
    }

    return { ...state.stats }
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  async close(): Promise<void> {
    this.closed = true

    // Stop all polling and schedules
    for (const state of this.triggers.values()) {
      if (state.pollingTimer) {
        clearTimeout(state.pollingTimer)
      }
      if (state.scheduleTimer) {
        clearTimeout(state.scheduleTimer)
      }

      // Close subscriptions
      for (const sub of state.subscriptions) {
        sub.closed = true
        for (const resolver of sub.resolvers) {
          resolver({ done: true, value: undefined as unknown as TriggerEvent })
        }
      }
    }

    this.triggers.clear()
    this.webhookIndex.clear()
    this.eventSubscriptions.clear()
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TriggerEngine instance
 *
 * @param options - Engine configuration options
 * @returns A new TriggerEngine instance
 *
 * @example
 * ```typescript
 * const engine = createTriggerEngine({
 *   metrics: myMetricsCollector,
 * })
 *
 * // Register triggers
 * await engine.register({
 *   id: 'my-webhook',
 *   type: 'webhook',
 *   name: 'My Webhook',
 *   webhook: { path: '/webhooks/my-app' },
 *   handler: async (event) => {
 *     console.log('Received:', event.payload)
 *   },
 * })
 *
 * // Handle webhook
 * await engine.handleWebhook({
 *   method: 'POST',
 *   path: '/webhooks/my-app',
 *   body: { data: 'test' },
 *   headers: {},
 * })
 * ```
 */
export function createTriggerEngine(options?: TriggerEngineOptions): TriggerEngine {
  return new TriggerEngineImpl(options)
}

// =============================================================================
// BUILT-IN SIGNATURE VALIDATORS
// =============================================================================

/**
 * HMAC-SHA256 signature validator for GitHub webhooks
 */
export const githubSignatureValidator: SignatureValidator = {
  headerName: 'x-hub-signature-256',
  async validate(payload, signature, secret): Promise<boolean> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const expected = 'sha256=' + Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return signature === expected
  },
}

/**
 * Stripe signature validator
 */
export const stripeSignatureValidator: SignatureValidator = {
  headerName: 'stripe-signature',
  async validate(payload, signature, secret): Promise<boolean> {
    // Parse signature header
    const parts = signature.split(',')
    let timestamp: string | undefined
    let v1: string | undefined

    for (const part of parts) {
      const [key, value] = part.split('=')
      if (key === 't') timestamp = value
      if (key === 'v1') v1 = value
    }

    if (!timestamp || !v1) return false

    // Compute expected signature
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const signedPayload = `${timestamp}.${data}`
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return v1 === expected
  },
}

/**
 * Slack signature validator
 */
export const slackSignatureValidator: SignatureValidator = {
  headerName: 'x-slack-signature',
  async validate(payload, signature, secret): Promise<boolean> {
    // Slack signatures include timestamp
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const expected = 'v0=' + Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return signature === expected
  },
}
