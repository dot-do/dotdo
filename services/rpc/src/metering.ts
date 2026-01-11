/**
 * RPC.do Gateway Metering
 *
 * Usage tracking and metering for billing and analytics.
 * Tracks calls, messages, charges, and resource consumption.
 *
 * @module services/rpc/metering
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import type {
  UsageEvent,
  UsageSummary,
  ServiceUsage,
  AuthContext,
  GatewayRequest,
  GatewayResponse,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Metering configuration
 */
export interface MeteringConfig {
  /** Whether metering is enabled */
  enabled: boolean
  /** Batch size for flushing events */
  batchSize: number
  /** Flush interval in ms */
  flushIntervalMs: number
  /** Maximum buffer size before forced flush */
  maxBufferSize: number
  /** Whether to include request/response payloads (for debugging) */
  includePayloads: boolean
  /** Paths to exclude from metering */
  excludePaths: string[]
}

/**
 * Cost calculator function
 */
export type CostCalculator = (
  service: string,
  method: string,
  durationMs: number,
  context?: CostContext
) => number

/**
 * Additional context for cost calculation
 */
export interface CostContext {
  /** Input tokens (for AI services) */
  inputTokens?: number
  /** Output tokens (for AI services) */
  outputTokens?: number
  /** Request size in bytes */
  requestSize?: number
  /** Response size in bytes */
  responseSize?: number
  /** Whether request was cached */
  cached?: boolean
}

/**
 * Usage event sink for persistence
 */
export interface UsageEventSink {
  /** Write usage events */
  write(events: UsageEvent[]): Promise<void>
  /** Flush any buffered events */
  flush(): Promise<void>
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MeteringConfig = {
  enabled: true,
  batchSize: 100,
  flushIntervalMs: 5000, // 5 seconds
  maxBufferSize: 1000,
  includePayloads: false,
  excludePaths: ['/health', '/ready', '/metrics'],
}

// ============================================================================
// Default Cost Calculator
// ============================================================================

/**
 * Default cost calculation based on service and method
 *
 * Cost units:
 * - 1 unit = base API call
 * - 10 units = AI inference/generation
 * - Additional units for tokens
 */
export const defaultCostCalculator: CostCalculator = (
  service: string,
  method: string,
  _durationMs: number,
  context?: CostContext
) => {
  let cost = 1 // Base cost

  // AI services have higher base cost
  if (['llm', 'agents', 'evals'].includes(service)) {
    cost = 10
  }

  // Add token costs for AI services
  if (context?.inputTokens) {
    cost += Math.ceil(context.inputTokens / 1000) // 1 unit per 1000 input tokens
  }
  if (context?.outputTokens) {
    cost += Math.ceil(context.outputTokens / 500) // 1 unit per 500 output tokens
  }

  // Reduce cost for cached responses
  if (context?.cached) {
    cost = Math.ceil(cost * 0.1)
  }

  return cost
}

// ============================================================================
// Usage Event Sinks
// ============================================================================

/**
 * In-memory sink for development/testing
 */
export class InMemoryUsageSink implements UsageEventSink {
  private events: UsageEvent[] = []

  async write(events: UsageEvent[]): Promise<void> {
    this.events.push(...events)
  }

  async flush(): Promise<void> {
    // No-op for in-memory
  }

  /**
   * Get all events
   */
  getEvents(): UsageEvent[] {
    return [...this.events]
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = []
  }

  /**
   * Query events with filters
   */
  async query(filters: {
    tenantId?: string
    userId?: string
    service?: string
    status?: 'success' | 'error'
    from?: Date
    to?: Date
    limit?: number
    offset?: number
  }): Promise<UsageEvent[]> {
    let results = [...this.events]

    if (filters.tenantId) {
      results = results.filter((e) => e.tenantId === filters.tenantId)
    }
    if (filters.userId) {
      results = results.filter((e) => e.userId === filters.userId)
    }
    if (filters.service) {
      results = results.filter((e) => e.service === filters.service)
    }
    if (filters.status) {
      results = results.filter((e) => e.status === filters.status)
    }
    if (filters.from) {
      results = results.filter((e) => e.timestamp >= filters.from!)
    }
    if (filters.to) {
      results = results.filter((e) => e.timestamp <= filters.to!)
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Apply pagination
    if (filters.offset !== undefined) {
      results = results.slice(filters.offset)
    }
    if (filters.limit !== undefined) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  /**
   * Get summary for a tenant
   */
  getSummary(tenantId: string, periodStart: Date, periodEnd: Date): UsageSummary {
    const tenantEvents = this.events.filter(
      (e) =>
        e.tenantId === tenantId &&
        e.timestamp >= periodStart &&
        e.timestamp <= periodEnd
    )

    const byService: Record<string, ServiceUsage> = {}

    for (const event of tenantEvents) {
      if (!byService[event.service]) {
        byService[event.service] = {
          service: event.service,
          requests: 0,
          costUnits: 0,
          errors: 0,
          avgLatencyMs: 0,
        }
      }

      const svc = byService[event.service]
      svc.requests++
      svc.costUnits += event.costUnits
      if (event.status === 'error') svc.errors++
      // Running average
      svc.avgLatencyMs = (svc.avgLatencyMs * (svc.requests - 1) + event.durationMs) / svc.requests
    }

    return {
      periodStart,
      periodEnd,
      tenantId,
      totalRequests: tenantEvents.length,
      successfulRequests: tenantEvents.filter((e) => e.status === 'success').length,
      failedRequests: tenantEvents.filter((e) => e.status === 'error').length,
      totalCostUnits: tenantEvents.reduce((sum, e) => sum + e.costUnits, 0),
      totalInputTokens: tenantEvents.reduce((sum, e) => sum + (e.inputTokens || 0), 0),
      totalOutputTokens: tenantEvents.reduce((sum, e) => sum + (e.outputTokens || 0), 0),
      byService,
    }
  }
}

/**
 * Analytics Pipeline sink for production
 * Writes events to an analytics pipeline (e.g., Cloudflare Analytics Engine)
 */
export class AnalyticsPipelineSink implements UsageEventSink {
  constructor(
    private pipeline: { send: (events: unknown[]) => Promise<void> }
  ) {}

  async write(events: UsageEvent[]): Promise<void> {
    const analyticsEvents = events.map((e) => ({
      // Blobs (string data)
      blob1: e.tenantId,
      blob2: e.userId || '',
      blob3: e.service,
      blob4: e.method,
      blob5: e.status,
      blob6: e.apiKeyId || '',
      blob7: e.agentId || '',

      // Doubles (numeric data)
      double1: e.durationMs,
      double2: e.costUnits,
      double3: e.inputTokens || 0,
      double4: e.outputTokens || 0,
      double5: e.requestSize || 0,
      double6: e.responseSize || 0,

      // Index for time-based queries
      index1: e.id,
    }))

    await this.pipeline.send(analyticsEvents)
  }

  async flush(): Promise<void> {
    // Analytics pipeline handles its own flushing
  }
}

/**
 * Queue-backed sink for reliable event delivery
 */
export class QueueUsageSink implements UsageEventSink {
  constructor(private queue: { send: (body: unknown) => Promise<void> }) {}

  async write(events: UsageEvent[]): Promise<void> {
    // Send events in batches to the queue
    for (const event of events) {
      await this.queue.send(event)
    }
  }

  async flush(): Promise<void> {
    // Queue handles its own delivery
  }
}

// ============================================================================
// Metering Service
// ============================================================================

/**
 * Metering service for tracking usage
 */
export class MeteringService {
  private config: MeteringConfig
  private sink: UsageEventSink
  private buffer: UsageEvent[] = []
  private costCalculator: CostCalculator
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    sink: UsageEventSink,
    config?: Partial<MeteringConfig>,
    costCalculator?: CostCalculator
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sink = sink
    this.costCalculator = costCalculator ?? defaultCostCalculator

    // Start periodic flush if enabled
    if (this.config.enabled && this.config.flushIntervalMs > 0) {
      this.startPeriodicFlush()
    }
  }

  /**
   * Record a usage event
   */
  async record(event: Omit<UsageEvent, 'id' | 'timestamp' | 'costUnits'>): Promise<void> {
    if (!this.config.enabled) return

    const fullEvent: UsageEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      costUnits: this.costCalculator(event.service, event.method, event.durationMs, {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        requestSize: event.requestSize,
        responseSize: event.responseSize,
      }),
      ...event,
    }

    this.buffer.push(fullEvent)

    // Force flush if buffer is full
    if (this.buffer.length >= this.config.maxBufferSize) {
      await this.flush()
    }
  }

  /**
   * Record a gateway request/response pair
   */
  async recordRequest(
    request: GatewayRequest,
    response: GatewayResponse,
    auth?: AuthContext,
    context?: CostContext
  ): Promise<void> {
    await this.record({
      tenantId: auth?.tenantId || 'anonymous',
      userId: auth?.userId,
      agentId: auth?.agentId,
      apiKeyId: undefined, // API key ID is extracted separately if needed
      service: request.service,
      method: request.method,
      durationMs: response.meta?.durationMs || 0,
      status: response.status,
      inputTokens: context?.inputTokens,
      outputTokens: context?.outputTokens,
      requestSize: context?.requestSize,
      responseSize: context?.responseSize,
      metadata: this.config.includePayloads
        ? { request: request.params, response: response.result }
        : undefined,
    })
  }

  /**
   * Flush buffered events to sink
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = [...this.buffer]
    this.buffer = []

    try {
      // Write in batches
      for (let i = 0; i < events.length; i += this.config.batchSize) {
        const batch = events.slice(i, i + this.config.batchSize)
        await this.sink.write(batch)
      }
    } catch (error) {
      // On error, add events back to buffer (with size limit)
      const remaining = this.config.maxBufferSize - this.buffer.length
      if (remaining > 0) {
        this.buffer.unshift(...events.slice(0, remaining))
      }
      console.error('Failed to flush usage events:', error)
    }
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => console.error('Periodic flush error:', err))
    }, this.config.flushIntervalMs)
  }

  /**
   * Stop periodic flush timer
   */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Metering context attached to request
 */
export interface MeteringContext {
  /** Request start time */
  startTime: number
  /** Request ID */
  requestId: string
  /** Service being called */
  service?: string
  /** Method being called */
  method?: string
  /** Request size */
  requestSize?: number
  /** Input tokens (for AI) */
  inputTokens?: number
  /** Output tokens (for AI) */
  outputTokens?: number
}

/**
 * Metering middleware options
 */
export interface MeteringMiddlewareOptions {
  /** Metering service */
  metering: MeteringService
  /** Paths to exclude */
  excludePaths?: string[]
  /** Whether to meter anonymous requests */
  meterAnonymous?: boolean
}

/**
 * Create metering middleware for Hono
 */
export function meteringMiddleware(options: MeteringMiddlewareOptions): MiddlewareHandler {
  const { metering, excludePaths = [], meterAnonymous = true } = options

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip excluded paths
    if (excludePaths.some((p) => path.startsWith(p))) {
      return next()
    }

    // Initialize metering context
    const meteringContext: MeteringContext = {
      startTime: performance.now(),
      requestId: c.req.header('x-request-id') || crypto.randomUUID(),
    }
    c.set('metering', meteringContext)

    // Get request size
    const contentLength = c.req.header('content-length')
    if (contentLength) {
      meteringContext.requestSize = parseInt(contentLength, 10)
    }

    // Process request
    await next()

    // Skip metering for anonymous if configured
    const auth = c.get('auth') as AuthContext | undefined
    if (!meterAnonymous && !auth) {
      return
    }

    // Calculate duration
    const durationMs = performance.now() - meteringContext.startTime

    // Get response size
    let responseSize: number | undefined
    const responseSizeHeader = c.res.headers.get('content-length')
    if (responseSizeHeader) {
      responseSize = parseInt(responseSizeHeader, 10)
    }

    // Extract service and method from context (set by gateway handler)
    const service = meteringContext.service || 'unknown'
    const method = meteringContext.method || c.req.method

    // Determine status
    const status = c.res.status >= 200 && c.res.status < 400 ? 'success' : 'error'

    // Record usage event
    await metering.record({
      tenantId: auth?.tenantId || 'anonymous',
      userId: auth?.userId,
      agentId: auth?.agentId,
      service,
      method,
      durationMs,
      status,
      inputTokens: meteringContext.inputTokens,
      outputTokens: meteringContext.outputTokens,
      requestSize: meteringContext.requestSize,
      responseSize,
    })
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Set metering context values in request handler
 */
export function setMeteringContext(c: Context, updates: Partial<MeteringContext>): void {
  const current = c.get('metering') as MeteringContext | undefined
  if (current) {
    Object.assign(current, updates)
  }
}

/**
 * Get metering context from request
 */
export function getMeteringContext(c: Context): MeteringContext | undefined {
  return c.get('metering') as MeteringContext | undefined
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create metering service with in-memory sink (for development)
 */
export function createDevMeteringService(
  config?: Partial<MeteringConfig>
): { metering: MeteringService; sink: InMemoryUsageSink } {
  const sink = new InMemoryUsageSink()
  const metering = new MeteringService(sink, config)
  return { metering, sink }
}

/**
 * Create metering service with analytics pipeline sink (for production)
 */
export function createProdMeteringService(
  pipeline: { send: (events: unknown[]) => Promise<void> },
  config?: Partial<MeteringConfig>
): MeteringService {
  const sink = new AnalyticsPipelineSink(pipeline)
  return new MeteringService(sink, config)
}
