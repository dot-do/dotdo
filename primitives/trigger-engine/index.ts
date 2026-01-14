/**
 * @dotdo/trigger-engine - Universal Trigger System for Automation
 *
 * A unified trigger system like Zapier/n8n for workflow automation.
 * Supports webhooks, polling, schedules, and events.
 *
 * @example
 * ```typescript
 * import { TriggerEngine } from '@dotdo/trigger-engine'
 *
 * const engine = new TriggerEngine()
 *
 * // Register a webhook trigger
 * engine.webhook('github', {
 *   path: '/webhooks/github',
 *   secret: process.env.GITHUB_SECRET,
 * }, async (ctx) => {
 *   console.log('GitHub event:', ctx.data)
 *   return { success: true, data: ctx.data }
 * })
 *
 * // Register a polling trigger
 * engine.polling('new-issues', {
 *   url: 'https://api.github.com/issues',
 *   intervalMs: 60_000,
 *   idField: 'id',
 * }, async (ctx) => {
 *   console.log('New issue:', ctx.data)
 *   return { success: true, data: ctx.data }
 * })
 *
 * // Register an event trigger
 * engine.event('user-signup', 'user.created', async (data) => {
 *   console.log('User signed up:', data)
 * })
 *
 * // Handle incoming webhook
 * await engine.handleWebhook(request, '/webhooks/github')
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/** Supported trigger types */
export type TriggerType = 'webhook' | 'polling' | 'schedule' | 'event'

/** Trigger configuration based on type */
export type TriggerConfig = WebhookConfig | PollingConfig | ScheduleConfig | EventConfig

/** Webhook configuration */
export interface WebhookConfig {
  /** Path to register webhook at */
  path?: string
  /** Secret for HMAC validation */
  secret?: string
  /** Header containing HMAC signature */
  signatureHeader?: string
  /** Algorithm for HMAC (sha256, sha1) */
  signatureAlgorithm?: 'sha256' | 'sha1'
  /** Header containing nonce for replay protection */
  nonceHeader?: string
  /** Enable replay protection */
  replayProtection?: boolean
  /** Header containing timestamp */
  timestampHeader?: string
  /** Timestamp validation window in ms */
  timestampWindowMs?: number
  /** Maximum body size in bytes */
  maxBodySize?: number
}

/** Polling configuration */
export interface PollingConfig {
  /** URL to poll */
  url: string
  /** Polling interval in ms */
  intervalMs: number
  /** Request headers */
  headers?: Record<string, string>
  /** Field to use as item ID for deduplication */
  idField?: string
  /** Field containing cursor/pagination state */
  cursorField?: string
  /** Minimum interval between polls (rate limiting) */
  minIntervalMs?: number
  /** Maximum retries on failure */
  maxRetries?: number
  /** Initial backoff duration in ms */
  initialBackoffMs?: number
  /** Maximum backoff duration in ms */
  maxBackoffMs?: number
  /** Transform function for response data */
  transform?: (response: unknown) => unknown[]
}

/** Schedule configuration */
export interface ScheduleConfig {
  /** Cron expression */
  cron: string
  /** Timezone */
  timezone?: string
}

/** Event configuration */
export interface EventConfig {
  /** Event name to listen for */
  eventName: string
  /** Filter expression */
  filter?: ((data: unknown) => boolean) | Record<string, unknown>
}

/** Trigger context passed to handlers */
export interface TriggerContext {
  /** Trigger ID */
  triggerId: string
  /** Trigger type */
  triggerType: TriggerType
  /** Timestamp when trigger fired */
  timestamp: number
  /** Trigger data/payload */
  data: unknown
  /** Request metadata (for webhooks) */
  method?: string
  /** Request headers */
  headers?: Record<string, string>
  /** Request path */
  path?: string
}

/** Normalized trigger output */
export interface TriggerOutput {
  /** Whether trigger succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Trigger ID */
  triggerId: string
  /** Timestamp */
  timestamp: number
  /** Source type */
  source: TriggerType
  /** Payload data */
  data: unknown
  /** Additional context */
  context?: Record<string, unknown>
}

/** Trigger definition */
export interface Trigger {
  /** Unique trigger ID */
  id: string
  /** Trigger type */
  type: TriggerType
  /** Trigger configuration */
  config: TriggerConfig
  /** Whether trigger is enabled */
  enabled?: boolean
  /** Handler function */
  handler: (ctx: TriggerContext) => Promise<TriggerOutput>
}

/** Event handler function */
export type EventHandler = (data: unknown, meta?: EventMeta) => void

/** Event metadata */
export interface EventMeta {
  /** Correlation ID for tracing */
  correlationId?: string
  /** Event source */
  source?: string
  /** Event timestamp */
  timestamp: number
}

/** Filter options for event subscriptions */
export interface FilterOptions {
  /** Filter function or JSONPath-like filter */
  filter?: ((data: unknown) => boolean) | Record<string, unknown>
}

/** Trigger statistics */
export interface TriggerStats {
  /** Number of times trigger has fired */
  fireCount: number
  /** Number of successful executions */
  successCount: number
  /** Number of failed executions */
  failureCount: number
  /** Last fire timestamp */
  lastFiredAt?: number
  /** Average latency in ms */
  avgLatencyMs?: number
}

// =============================================================================
// HMAC Utilities
// =============================================================================

/**
 * Create HMAC signature for data
 */
export async function createHmacSignature(
  data: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)

  const algo = algorithm === 'sha256' ? 'SHA-256' : 'SHA-1'

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algo },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify HMAC signature
 */
export async function verifyHmacSignature(
  data: string,
  secret: string,
  signature: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): Promise<boolean> {
  const expected = await createHmacSignature(data, secret, algorithm)
  return timingSafeEqual(expected, signature)
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// =============================================================================
// WebhookReceiver
// =============================================================================

/**
 * Receives and validates HTTP webhooks with HMAC signature verification
 */
export class WebhookReceiver {
  private webhooks = new Map<string, WebhookConfig>()
  private seenNonces = new Set<string>()

  /**
   * Register a webhook endpoint
   */
  register(path: string, config: WebhookConfig): void {
    if (this.webhooks.has(path)) {
      throw new Error(`Webhook already registered at path: ${path}`)
    }
    this.webhooks.set(path, { ...config, path })
  }

  /**
   * Unregister a webhook endpoint
   */
  unregister(path: string): void {
    this.webhooks.delete(path)
  }

  /**
   * Check if webhook is registered
   */
  has(path: string): boolean {
    return this.webhooks.has(path)
  }

  /**
   * List all registered webhook paths
   */
  list(): string[] {
    return Array.from(this.webhooks.keys())
  }

  /**
   * Validate request signature
   */
  async validate(request: Request, path: string): Promise<boolean> {
    const config = this.webhooks.get(path)
    if (!config) {
      return false
    }

    // If no signature verification configured, return true
    if (!config.secret || !config.signatureHeader) {
      return true
    }

    const signatureHeader = request.headers.get(config.signatureHeader)
    if (!signatureHeader) {
      return false
    }

    const body = await request.clone().text()
    const algorithm = config.signatureAlgorithm || 'sha256'

    // Extract signature from header (format: "sha256=xxx" or just "xxx")
    const signatureParts = signatureHeader.split('=')
    const signature = signatureParts.length > 1 ? signatureParts.slice(1).join('=') : signatureHeader

    return verifyHmacSignature(body, config.secret, signature, algorithm)
  }

  /**
   * Handle incoming webhook request
   */
  async handle(request: Request, path: string): Promise<TriggerOutput> {
    const config = this.webhooks.get(path)
    const timestamp = Date.now()
    const triggerId = `webhook-${path}-${timestamp}`

    if (!config) {
      return {
        success: false,
        error: `No webhook registered at path: ${path}`,
        triggerId,
        timestamp,
        source: 'webhook',
        data: null,
      }
    }

    // Check body size limit (check content-length header or actual body)
    if (config.maxBodySize) {
      const contentLength = request.headers.get('content-length')
      let bodySize: number | undefined

      if (contentLength) {
        bodySize = parseInt(contentLength, 10)
      } else {
        // Read the body to check its size
        const clonedRequest = request.clone()
        const bodyText = await clonedRequest.text()
        bodySize = new TextEncoder().encode(bodyText).length
      }

      if (bodySize !== undefined && bodySize > config.maxBodySize) {
        return {
          success: false,
          error: `Request body too large: ${bodySize} bytes exceeds limit of ${config.maxBodySize}`,
          triggerId,
          timestamp,
          source: 'webhook',
          data: null,
        }
      }
    }

    // Validate signature if configured
    if (config.secret && config.signatureHeader) {
      const isValid = await this.validate(request.clone(), path)
      if (!isValid) {
        return {
          success: false,
          error: 'Invalid signature',
          triggerId,
          timestamp,
          source: 'webhook',
          data: null,
        }
      }
    }

    // Check replay protection (nonce)
    if (config.replayProtection && config.nonceHeader) {
      const nonce = request.headers.get(config.nonceHeader)
      if (nonce) {
        if (this.seenNonces.has(nonce)) {
          return {
            success: false,
            error: 'Duplicate nonce detected (replay attack)',
            triggerId,
            timestamp,
            source: 'webhook',
            data: null,
          }
        }
        this.seenNonces.add(nonce)
      }
    }

    // Check timestamp validity
    if (config.timestampHeader && config.timestampWindowMs) {
      const timestampStr = request.headers.get(config.timestampHeader)
      if (timestampStr) {
        const requestTimestamp = parseInt(timestampStr, 10)
        const now = Date.now()
        if (Math.abs(now - requestTimestamp) > config.timestampWindowMs) {
          return {
            success: false,
            error: 'Request timestamp expired or invalid',
            triggerId,
            timestamp,
            source: 'webhook',
            data: null,
          }
        }
      }
    }

    // Parse body based on content type
    const contentType = request.headers.get('content-type') || ''
    let data: unknown

    try {
      if (contentType.includes('application/json')) {
        data = await request.json()
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text()
        const params = new URLSearchParams(text)
        data = Object.fromEntries(params.entries())
      } else {
        data = await request.text()
      }
    } catch {
      data = await request.text()
    }

    // Build headers record
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    return {
      success: true,
      triggerId,
      timestamp,
      source: 'webhook',
      data,
      context: {
        method: request.method,
        headers,
        path,
      },
    }
  }
}

// =============================================================================
// PollingScheduler
// =============================================================================

/**
 * Polls external APIs with rate limiting, backoff, and deduplication
 */
export class PollingScheduler {
  private sources = new Map<string, PollingConfig>()
  private seenIds = new Map<string, Set<string>>()
  private lastPollTime = new Map<string, number>()
  private states = new Map<string, unknown>()
  private backoffs = new Map<string, number>()
  private consecutiveErrors = new Map<string, number>()

  /**
   * Register a polling source
   */
  register(id: string, config: PollingConfig): void {
    this.sources.set(id, config)
    this.seenIds.set(id, new Set())
    this.backoffs.set(id, 0)
    this.consecutiveErrors.set(id, 0)
  }

  /**
   * Unregister a polling source
   */
  unregister(id: string): void {
    this.sources.delete(id)
    this.seenIds.delete(id)
    this.lastPollTime.delete(id)
    this.states.delete(id)
    this.backoffs.delete(id)
    this.consecutiveErrors.delete(id)
  }

  /**
   * Check if source is registered
   */
  has(id: string): boolean {
    return this.sources.has(id)
  }

  /**
   * List all registered source IDs
   */
  list(): string[] {
    return Array.from(this.sources.keys())
  }

  /**
   * Get current backoff duration for source
   */
  getBackoffMs(id: string): number {
    return this.backoffs.get(id) || 0
  }

  /**
   * Get last state for source
   */
  async getLastState(id: string): Promise<unknown> {
    return this.states.get(id)
  }

  /**
   * Set last state for source
   */
  async setLastState(id: string, state: unknown): Promise<void> {
    this.states.set(id, state)
  }

  /**
   * Poll a source and return new items
   */
  async poll(id: string): Promise<TriggerOutput[]> {
    const config = this.sources.get(id)
    if (!config) {
      throw new Error(`Unknown polling source: ${id}`)
    }

    const now = Date.now()
    const lastPoll = this.lastPollTime.get(id) || 0
    const minInterval = config.minIntervalMs || 0

    // Check rate limit
    if (minInterval > 0 && now - lastPoll < minInterval) {
      return []
    }

    // Check backoff
    const backoff = this.backoffs.get(id) || 0
    if (backoff > 0 && now - lastPoll < backoff) {
      return []
    }

    this.lastPollTime.set(id, now)

    try {
      // Fetch data
      const response = await fetch(config.url, {
        headers: config.headers,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      let items: unknown[]
      const rawData = await response.json()

      // Apply transform if provided
      if (config.transform) {
        items = config.transform(rawData)
      } else if (Array.isArray(rawData)) {
        items = rawData
      } else {
        items = [rawData]
      }

      // Reset backoff on success
      this.backoffs.set(id, 0)
      this.consecutiveErrors.set(id, 0)

      // Deduplicate by ID
      const seenSet = this.seenIds.get(id)!
      const newItems: TriggerOutput[] = []

      for (const item of items) {
        const itemId = config.idField
          ? String((item as Record<string, unknown>)[config.idField])
          : JSON.stringify(item)

        if (!seenSet.has(itemId)) {
          seenSet.add(itemId)
          newItems.push({
            success: true,
            triggerId: `poll-${id}-${itemId}`,
            timestamp: now,
            source: 'polling',
            data: item,
          })
        }
      }

      return newItems
    } catch (error) {
      // Apply exponential backoff
      const errors = (this.consecutiveErrors.get(id) || 0) + 1
      this.consecutiveErrors.set(id, errors)

      const initialBackoff = config.initialBackoffMs || 1000
      const maxBackoff = config.maxBackoffMs || 60_000
      const newBackoff = Math.min(initialBackoff * Math.pow(2, errors - 1), maxBackoff)
      this.backoffs.set(id, newBackoff)

      throw error
    }
  }
}

// =============================================================================
// EventBus
// =============================================================================

interface Subscription {
  handler: EventHandler
  filter?: FilterOptions['filter']
  once?: boolean
}

/**
 * Internal event routing and fan-out pub/sub system
 */
export class EventBus {
  private handlers = new Map<string, Subscription[]>()
  private wildcardHandlers = new Map<string, Subscription[]>()

  /**
   * Subscribe to an event
   */
  on(event: string, handler: EventHandler, options?: FilterOptions): () => void {
    const subscription: Subscription = { handler, filter: options?.filter }

    if (event.includes('*')) {
      const existing = this.wildcardHandlers.get(event) || []
      this.wildcardHandlers.set(event, [...existing, subscription])
    } else {
      const existing = this.handlers.get(event) || []
      this.handlers.set(event, [...existing, subscription])
    }

    // Return unsubscribe function
    return () => {
      if (event.includes('*')) {
        const subs = this.wildcardHandlers.get(event) || []
        this.wildcardHandlers.set(event, subs.filter(s => s !== subscription))
      } else {
        const subs = this.handlers.get(event) || []
        this.handlers.set(event, subs.filter(s => s !== subscription))
      }
    }
  }

  /**
   * Subscribe to an event (fires only once)
   */
  once(event: string, handler: EventHandler): () => void {
    const subscription: Subscription = { handler, once: true }

    if (event.includes('*')) {
      const existing = this.wildcardHandlers.get(event) || []
      this.wildcardHandlers.set(event, [...existing, subscription])
    } else {
      const existing = this.handlers.get(event) || []
      this.handlers.set(event, [...existing, subscription])
    }

    // Return unsubscribe function
    return () => {
      if (event.includes('*')) {
        const subs = this.wildcardHandlers.get(event) || []
        this.wildcardHandlers.set(event, subs.filter(s => s !== subscription))
      } else {
        const subs = this.handlers.get(event) || []
        this.handlers.set(event, subs.filter(s => s !== subscription))
      }
    }
  }

  /**
   * Emit an event
   */
  emit(event: string, data: unknown): void {
    this.emitWithMeta(event, data)
  }

  /**
   * Emit an event with metadata
   */
  emitWithMeta(event: string, data: unknown, meta?: Partial<EventMeta>): void {
    const fullMeta: EventMeta = {
      timestamp: Date.now(),
      ...meta,
    }

    // Call exact match handlers
    const exactHandlers = this.handlers.get(event) || []
    const toRemove: Subscription[] = []

    for (const sub of exactHandlers) {
      if (this.matchesFilter(data, sub.filter)) {
        try {
          sub.handler(data, fullMeta)
        } catch {
          // Continue delivery even if handler throws
        }
        if (sub.once) {
          toRemove.push(sub)
        }
      }
    }

    // Remove once handlers
    if (toRemove.length > 0) {
      this.handlers.set(event, exactHandlers.filter(s => !toRemove.includes(s)))
    }

    // Call wildcard handlers
    for (const [pattern, subs] of this.wildcardHandlers) {
      if (this.matchesPattern(event, pattern)) {
        const wildcardToRemove: Subscription[] = []

        for (const sub of subs) {
          if (this.matchesFilter(data, sub.filter)) {
            try {
              sub.handler(data, fullMeta)
            } catch {
              // Continue delivery even if handler throws
            }
            if (sub.once) {
              wildcardToRemove.push(sub)
            }
          }
        }

        // Remove once handlers
        if (wildcardToRemove.length > 0) {
          this.wildcardHandlers.set(pattern, subs.filter(s => !wildcardToRemove.includes(s)))
        }
      }
    }
  }

  /**
   * Check if event matches wildcard pattern
   */
  private matchesPattern(event: string, pattern: string): boolean {
    // Convert pattern to regex
    // * matches single segment, ** matches multiple segments
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '(.+)')
      .replace(/\*/g, '([^.]+)')

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(event)
  }

  /**
   * Check if data matches filter
   */
  private matchesFilter(
    data: unknown,
    filter?: ((data: unknown) => boolean) | Record<string, unknown>
  ): boolean {
    if (!filter) {
      return true
    }

    if (typeof filter === 'function') {
      return filter(data)
    }

    // JSONPath-like filter
    if (typeof filter === 'object') {
      for (const [path, expected] of Object.entries(filter)) {
        const value = this.getByPath(data, path)
        if (value !== expected) {
          return false
        }
      }
      return true
    }

    return true
  }

  /**
   * Get value by JSONPath-like path
   */
  private getByPath(data: unknown, path: string): unknown {
    // Support simple $.field syntax
    const cleanPath = path.replace(/^\$\./, '')
    const parts = cleanPath.split('.')

    let current: unknown = data
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Unsubscribe all handlers for a topic
   */
  off(event: string): void {
    this.handlers.delete(event)
    this.wildcardHandlers.delete(event)
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear()
    this.wildcardHandlers.clear()
  }

  /**
   * List all active topics
   */
  topics(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Get subscriber count for a topic
   */
  subscriberCount(event: string): number {
    return (this.handlers.get(event) || []).length
  }
}

// =============================================================================
// TriggerRegistry
// =============================================================================

/**
 * Registry for trigger definitions
 */
export class TriggerRegistry {
  private triggers = new Map<string, Trigger>()

  /**
   * Register a trigger
   */
  register(trigger: Trigger): void {
    if (this.triggers.has(trigger.id)) {
      throw new Error(`Trigger already registered: ${trigger.id}`)
    }
    this.triggers.set(trigger.id, { ...trigger, enabled: trigger.enabled ?? true })
  }

  /**
   * Unregister a trigger
   */
  unregister(id: string): void {
    this.triggers.delete(id)
  }

  /**
   * Check if trigger exists
   */
  has(id: string): boolean {
    return this.triggers.has(id)
  }

  /**
   * Get trigger by ID
   */
  get(id: string): Trigger | undefined {
    return this.triggers.get(id)
  }

  /**
   * List all triggers
   */
  list(): Trigger[] {
    return Array.from(this.triggers.values())
  }

  /**
   * List triggers by type
   */
  listByType(type: TriggerType): Trigger[] {
    return this.list().filter(t => t.type === type)
  }

  /**
   * List enabled triggers only
   */
  listEnabled(): Trigger[] {
    return this.list().filter(t => t.enabled)
  }

  /**
   * Enable a trigger
   */
  enable(id: string): void {
    const trigger = this.triggers.get(id)
    if (trigger) {
      trigger.enabled = true
    }
  }

  /**
   * Disable a trigger
   */
  disable(id: string): void {
    const trigger = this.triggers.get(id)
    if (trigger) {
      trigger.enabled = false
    }
  }

  /**
   * Generate webhook URL for a trigger
   */
  getWebhookUrl(id: string, baseUrl: string): string {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Unknown trigger: ${id}`)
    }
    if (trigger.type !== 'webhook') {
      throw new Error(`Trigger ${id} is not a webhook trigger`)
    }
    const config = trigger.config as WebhookConfig
    const path = config.path || `/${id}`
    return `${baseUrl}${path}`
  }
}

// =============================================================================
// TriggerEngine
// =============================================================================

/**
 * Main TriggerEngine - unified trigger system
 */
export class TriggerEngine {
  /** Webhook receiver */
  readonly webhooks: WebhookReceiver
  /** Polling scheduler */
  readonly polling: PollingScheduler
  /** Event bus */
  readonly events: EventBus
  /** Trigger registry */
  readonly registry: TriggerRegistry

  private handlers = new Map<string, (ctx: TriggerContext) => Promise<TriggerOutput>>()
  private stats = new Map<string, TriggerStats>()

  constructor() {
    this.webhooks = new WebhookReceiver()
    this.polling = new PollingScheduler()
    this.events = new EventBus()
    this.registry = new TriggerRegistry()
  }

  /**
   * Register a webhook trigger
   */
  webhook(
    id: string,
    config: WebhookConfig,
    handler: (ctx: TriggerContext) => Promise<TriggerOutput>
  ): void {
    const path = config.path || `/${id}`

    this.webhooks.register(path, config)
    this.handlers.set(id, handler)
    this.stats.set(id, { fireCount: 0, successCount: 0, failureCount: 0 })

    this.registry.register({
      id,
      type: 'webhook',
      config: { ...config, path },
      handler,
    })
  }

  /**
   * Register a polling trigger
   */
  pollingTrigger(
    id: string,
    config: PollingConfig,
    handler: (ctx: TriggerContext) => Promise<TriggerOutput>
  ): void {
    this.polling.register(id, config)
    this.handlers.set(id, handler)
    this.stats.set(id, { fireCount: 0, successCount: 0, failureCount: 0 })

    this.registry.register({
      id,
      type: 'polling',
      config,
      handler,
    })
  }

  /**
   * Register an event trigger
   */
  event(id: string, eventName: string, handler: EventHandler): void {
    this.events.on(eventName, handler)
    this.stats.set(id, { fireCount: 0, successCount: 0, failureCount: 0 })

    this.registry.register({
      id,
      type: 'event',
      config: { eventName },
      handler: async (ctx) => ({
        success: true,
        triggerId: id,
        timestamp: ctx.timestamp,
        source: 'event',
        data: ctx.data,
      }),
    })
  }

  /**
   * Handle incoming webhook request
   */
  async handleWebhook(request: Request, path: string): Promise<TriggerOutput> {
    const result = await this.webhooks.handle(request, path)

    // Find the trigger ID for this path
    const trigger = this.registry.listByType('webhook').find(t => {
      const config = t.config as WebhookConfig
      return config.path === path
    })

    if (trigger && result.success) {
      const stats = this.stats.get(trigger.id)
      if (stats) {
        stats.fireCount++
        stats.lastFiredAt = Date.now()
      }

      const handler = this.handlers.get(trigger.id)
      if (handler) {
        try {
          const ctx: TriggerContext = {
            triggerId: trigger.id,
            triggerType: 'webhook',
            timestamp: result.timestamp,
            data: result.data,
            method: result.context?.method as string,
            headers: result.context?.headers as Record<string, string>,
            path: result.context?.path as string,
          }
          const handlerResult = await handler(ctx)
          if (stats) {
            stats.successCount++
          }
          return handlerResult
        } catch (error) {
          if (stats) {
            stats.failureCount++
          }
          throw error
        }
      }
    }

    return result
  }

  /**
   * Get statistics for a trigger
   */
  getStats(id: string): TriggerStats {
    return this.stats.get(id) || { fireCount: 0, successCount: 0, failureCount: 0 }
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { EventHandler, FilterOptions }
