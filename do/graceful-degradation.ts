/**
 * Graceful Degradation Module for DO Unavailability
 *
 * Provides fallback responses, health checks, write queuing, and degradation strategies
 * when Durable Objects are unavailable or responding slowly.
 *
 * Key features:
 * - Circuit breaker pattern for fast failure detection
 * - Response caching for stale data serving
 * - Write queue for retry when DOs become available
 * - Clear degradation status reporting to callers
 *
 * @module @dotdo/do/graceful-degradation
 */

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createCircuitBreakerRegistry,
  type CircuitBreakerConfig,
  type CircuitStats,
  type CircuitState,
} from './circuit-breaker'
import { createScopedLogger, LogLevel } from '@dotdo/utils'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[GracefulDegradation]' })

/**
 * Health status for a DO or service
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

/**
 * Health check result for a single service
 */
export interface HealthCheckResult {
  /** Service/DO name */
  name: string

  /** Current health status */
  status: HealthStatus

  /** Last check timestamp */
  lastCheck: number

  /** Last successful check timestamp */
  lastSuccess: number | null

  /** Response time of last check (ms) */
  latencyMs: number | null

  /** Error message if unhealthy */
  error?: string

  /** Circuit breaker state if applicable */
  circuitState?: CircuitState

  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Overall health report
 */
export interface HealthReport {
  /** Overall system status */
  status: HealthStatus

  /** Individual service health checks */
  services: HealthCheckResult[]

  /** Timestamp of the report */
  timestamp: number

  /** Number of healthy services */
  healthyCount: number

  /** Number of degraded services */
  degradedCount: number

  /** Number of unhealthy services */
  unhealthyCount: number

  /** Uptime percentage (based on recent checks) */
  uptimePercentage: number
}

/**
 * Configuration for health checks
 */
export interface HealthCheckConfig {
  /** Check interval in ms (default: 30000) */
  intervalMs?: number

  /** Timeout for health check requests (default: 5000) */
  timeoutMs?: number

  /** Number of failures before marking unhealthy (default: 3) */
  unhealthyThreshold?: number

  /** Number of successes before marking healthy after degraded (default: 2) */
  healthyThreshold?: number

  /** Maximum latency before marking as degraded (default: 1000) */
  degradedLatencyMs?: number

  /** Custom health check function */
  healthCheckFn?: (name: string) => Promise<{ healthy: boolean; latencyMs: number; error?: string }>
}

/**
 * Fallback response configuration
 */
export interface FallbackConfig {
  /** HTTP status code for fallback response (default: 503) */
  statusCode?: number

  /** Headers to include in fallback response */
  headers?: Record<string, string>

  /** Enable caching of last known good response */
  enableCache?: boolean

  /** Cache TTL in ms (default: 60000) */
  cacheTtlMs?: number

  /** Custom fallback response generator */
  generateResponse?: (request: Request, error: Error, context: FallbackContext) => Response | Promise<Response>
}

/**
 * Context passed to fallback generators
 */
export interface FallbackContext {
  /** DO namespace being accessed */
  namespace: string

  /** Circuit breaker stats if available */
  circuitStats?: CircuitStats

  /** Last successful response (if cached) */
  cachedResponse?: Response

  /** Error that triggered the fallback */
  error: Error

  /** Whether circuit breaker rejected the request */
  circuitOpen: boolean

  /** Health status of the service */
  healthStatus: HealthStatus
}

/**
 * Cached response entry
 */
interface CacheEntry {
  response: Response
  timestamp: number
  ttl: number
}

/**
 * HealthChecker - Monitors health of DOs and services
 */
export class HealthChecker {
  private checks: Map<string, HealthCheckResult> = new Map()
  private config: Required<HealthCheckConfig>
  private checkHistory: Map<string, boolean[]> = new Map()
  private readonly historySize = 100

  constructor(config: HealthCheckConfig = {}) {
    this.config = {
      intervalMs: config.intervalMs ?? 30000,
      timeoutMs: config.timeoutMs ?? 5000,
      unhealthyThreshold: config.unhealthyThreshold ?? 3,
      healthyThreshold: config.healthyThreshold ?? 2,
      degradedLatencyMs: config.degradedLatencyMs ?? 1000,
      healthCheckFn: config.healthCheckFn ?? this.defaultHealthCheck.bind(this),
    }
  }

  /**
   * Perform a health check for a service
   */
  async check(name: string, customFn?: () => Promise<{ healthy: boolean; latencyMs: number; error?: string }>): Promise<HealthCheckResult> {
    const checkFn = customFn ?? this.config.healthCheckFn
    const now = Date.now()

    try {
      const result = await this.executeWithTimeout(
        () => checkFn(name),
        this.config.timeoutMs
      )

      this.recordResult(name, result.healthy)
      const status = this.determineStatus(name, result.healthy, result.latencyMs)

      const checkResult: HealthCheckResult = {
        name,
        status,
        lastCheck: now,
        lastSuccess: result.healthy ? now : this.checks.get(name)?.lastSuccess ?? null,
        latencyMs: result.latencyMs,
        ...(result.error !== undefined && { error: result.error }),
      }

      this.checks.set(name, checkResult)
      return checkResult
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const isTimeout = err.message.includes('timeout')

      this.recordResult(name, false)
      const status = this.determineStatus(name, false, null)

      const checkResult: HealthCheckResult = {
        name,
        status,
        lastCheck: now,
        lastSuccess: this.checks.get(name)?.lastSuccess ?? null,
        latencyMs: isTimeout ? this.config.timeoutMs : null,
        error: err.message,
      }

      this.checks.set(name, checkResult)
      return checkResult
    }
  }

  /**
   * Get health status for a service
   */
  getStatus(name: string): HealthCheckResult | undefined {
    return this.checks.get(name)
  }

  /**
   * Get overall health report
   */
  getReport(): HealthReport {
    const services = Array.from(this.checks.values())
    const healthyCount = services.filter((s) => s.status === 'healthy').length
    const degradedCount = services.filter((s) => s.status === 'degraded').length
    const unhealthyCount = services.filter((s) => s.status === 'unhealthy').length

    // Determine overall status
    let status: HealthStatus = 'healthy'
    if (unhealthyCount > 0) {
      status = unhealthyCount === services.length ? 'unhealthy' : 'degraded'
    } else if (degradedCount > 0) {
      status = 'degraded'
    }

    // Calculate uptime percentage from history
    let totalChecks = 0
    let successfulChecks = 0
    for (const history of this.checkHistory.values()) {
      totalChecks += history.length
      successfulChecks += history.filter(Boolean).length
    }
    const uptimePercentage = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 100

    return {
      status,
      services,
      timestamp: Date.now(),
      healthyCount,
      degradedCount,
      unhealthyCount,
      uptimePercentage,
    }
  }

  /**
   * Register a service for health checking (without immediately checking)
   */
  register(name: string): void {
    if (!this.checks.has(name)) {
      this.checks.set(name, {
        name,
        status: 'unknown',
        lastCheck: 0,
        lastSuccess: null,
        latencyMs: null,
      })
    }
  }

  /**
   * Remove a service from health checking
   */
  unregister(name: string): void {
    this.checks.delete(name)
    this.checkHistory.delete(name)
  }

  /**
   * Clear all health check data
   */
  clear(): void {
    this.checks.clear()
    this.checkHistory.clear()
  }

  /**
   * Default health check implementation
   */
  private async defaultHealthCheck(_name: string): Promise<{ healthy: boolean; latencyMs: number }> {
    // Default implementation just returns healthy
    // In real usage, this would be overridden with actual health check logic
    return { healthy: true, latencyMs: 0 }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Health check timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      fn()
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * Record a health check result in history
   */
  private recordResult(name: string, success: boolean): void {
    if (!this.checkHistory.has(name)) {
      this.checkHistory.set(name, [])
    }
    const history = this.checkHistory.get(name)!
    history.push(success)
    if (history.length > this.historySize) {
      history.shift()
    }
  }

  /**
   * Determine health status based on recent results
   */
  private determineStatus(name: string, currentSuccess: boolean, latencyMs: number | null): HealthStatus {
    const history = this.checkHistory.get(name) ?? []
    const recentResults = history.slice(-5)
    const recentFailures = recentResults.filter((r) => !r).length

    // Check latency-based degradation
    if (currentSuccess && latencyMs !== null && latencyMs > this.config.degradedLatencyMs) {
      return 'degraded'
    }

    // Check failure-based status
    if (recentFailures >= this.config.unhealthyThreshold) {
      return 'unhealthy'
    }

    if (recentFailures > 0) {
      return 'degraded'
    }

    return 'healthy'
  }
}

/**
 * FallbackHandler - Provides fallback responses when DOs are unavailable
 */
export class FallbackHandler {
  private config: Required<FallbackConfig>
  private cache: Map<string, CacheEntry> = new Map()

  constructor(config: FallbackConfig = {}) {
    this.config = {
      statusCode: config.statusCode ?? 503,
      headers: config.headers ?? {
        'Content-Type': 'application/json',
        'Retry-After': '30',
      },
      enableCache: config.enableCache ?? true,
      cacheTtlMs: config.cacheTtlMs ?? 60000,
      generateResponse: config.generateResponse ?? this.defaultFallbackResponse.bind(this),
    }
  }

  /**
   * Generate a fallback response
   */
  async getFallback(request: Request, context: FallbackContext): Promise<Response> {
    // Try to use cached response if available and caching is enabled
    if (this.config.enableCache) {
      const cached = this.getCachedResponse(context.namespace, request.url)
      if (cached) {
        context.cachedResponse = cached
      }
    }

    return this.config.generateResponse(request, context.error, context)
  }

  /**
   * Cache a successful response
   */
  cacheResponse(namespace: string, url: string, response: Response): void {
    if (!this.config.enableCache) return

    const key = this.cacheKey(namespace, url)
    this.cache.set(key, {
      response: response.clone(),
      timestamp: Date.now(),
      ttl: this.config.cacheTtlMs,
    })
  }

  /**
   * Get a cached response if available and not expired
   */
  getCachedResponse(namespace: string, url: string): Response | undefined {
    const key = this.cacheKey(namespace, url)
    const entry = this.cache.get(key)

    if (!entry) return undefined

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return undefined
    }

    return entry.response.clone()
  }

  /**
   * Clear all cached responses
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Clear cached responses for a namespace
   */
  clearNamespaceCache(namespace: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${namespace}:`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Default fallback response generator
   */
  private defaultFallbackResponse(request: Request, _error: Error, context: FallbackContext): Response {
    // If we have a cached response, use it
    if (context.cachedResponse) {
      const headers = new Headers(context.cachedResponse.headers)
      headers.set('X-Fallback', 'cached')
      headers.set('X-Cache-Age', String(Date.now() - (this.cache.get(this.cacheKey(context.namespace, request.url))?.timestamp ?? 0)))
      return new Response(context.cachedResponse.body, {
        status: 200,
        headers,
      })
    }

    // Generate a service unavailable response
    const body = JSON.stringify({
      error: 'Service temporarily unavailable',
      code: 'SERVICE_UNAVAILABLE',
      namespace: context.namespace,
      circuitState: context.circuitStats?.state ?? 'unknown',
      retryAfter: 30,
      message: context.circuitOpen
        ? 'The service is experiencing issues. Please retry later.'
        : 'The request could not be completed. Please retry.',
    })

    const headers = new Headers(this.config.headers)
    headers.set('X-Fallback', 'generated')
    headers.set('X-Circuit-State', context.circuitStats?.state ?? 'unknown')

    return new Response(body, {
      status: this.config.statusCode,
      headers,
    })
  }

  /**
   * Generate cache key
   */
  private cacheKey(namespace: string, url: string): string {
    return `${namespace}:${url}`
  }
}

/**
 * GracefulDegradationHandler - Combines circuit breaker, health checks, and fallbacks
 */
export class GracefulDegradationHandler {
  private circuitRegistry: CircuitBreakerRegistry
  private healthChecker: HealthChecker
  private fallbackHandler: FallbackHandler

  constructor(options: {
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>
    healthCheckConfig?: HealthCheckConfig
    fallbackConfig?: FallbackConfig
  } = {}) {
    this.circuitRegistry = createCircuitBreakerRegistry(options.circuitBreakerConfig)
    this.healthChecker = new HealthChecker(options.healthCheckConfig)
    this.fallbackHandler = new FallbackHandler(options.fallbackConfig)
  }

  /**
   * Execute a request with graceful degradation
   */
  async executeRequest(
    namespace: string,
    request: Request,
    operation: () => Promise<Response>
  ): Promise<Response> {
    const circuit = this.circuitRegistry.get(namespace)
    const healthStatus = this.healthChecker.getStatus(namespace)

    const result = await circuit.execute(operation)

    if (result.success) {
      // Cache successful response
      this.fallbackHandler.cacheResponse(namespace, request.url, result.value)
      return result.value
    }

    // Generate fallback response
    const context: FallbackContext = {
      namespace,
      circuitStats: circuit.getStats(),
      error: result.error,
      circuitOpen: result.rejected,
      healthStatus: healthStatus?.status ?? 'unknown',
    }

    return this.fallbackHandler.getFallback(request, context)
  }

  /**
   * Perform health check for a namespace
   */
  async checkHealth(namespace: string, customFn?: () => Promise<{ healthy: boolean; latencyMs: number; error?: string }>): Promise<HealthCheckResult> {
    const circuit = this.circuitRegistry.get(namespace)
    const result = await this.healthChecker.check(namespace, customFn)

    // Add circuit state to the result
    result.circuitState = circuit.getState()

    return result
  }

  /**
   * Get overall system health
   */
  getHealthReport(): HealthReport {
    const report = this.healthChecker.getReport()

    // Enrich with circuit breaker states
    for (const service of report.services) {
      if (this.circuitRegistry.has(service.name)) {
        service.circuitState = this.circuitRegistry.get(service.name).getState()
      }
    }

    return report
  }

  /**
   * Get circuit breaker for a namespace
   */
  getCircuit(namespace: string): CircuitBreaker {
    return this.circuitRegistry.get(namespace)
  }

  /**
   * Get all circuit stats
   */
  getAllCircuitStats(): Record<string, CircuitStats> {
    return this.circuitRegistry.getAllStats()
  }

  /**
   * Reset everything
   */
  reset(): void {
    this.circuitRegistry.resetAll()
    this.healthChecker.clear()
    this.fallbackHandler.clearCache()
  }
}

/**
 * Create a graceful degradation handler
 */
export function createGracefulDegradationHandler(options?: {
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
  healthCheckConfig?: HealthCheckConfig
  fallbackConfig?: FallbackConfig
}): GracefulDegradationHandler {
  return new GracefulDegradationHandler(options)
}

/**
 * Create a health checker instance
 */
export function createHealthChecker(config?: HealthCheckConfig): HealthChecker {
  return new HealthChecker(config)
}

/**
 * Create a fallback handler instance
 */
export function createFallbackHandler(config?: FallbackConfig): FallbackHandler {
  return new FallbackHandler(config)
}

// ============================================================================
// Write Queue for DO Unavailability
// ============================================================================

/**
 * Represents a queued write operation
 */
export interface QueuedWrite {
  /** Unique ID for this write */
  id: string

  /** Target DO namespace */
  namespace: string

  /** Operation type (e.g., 'create', 'update', 'delete') */
  operation: string

  /** Request method */
  method: string

  /** Request URL */
  url: string

  /** Request body (serialized) */
  body: string | null

  /** Request headers */
  headers: Record<string, string>

  /** Additional metadata */
  metadata?: Record<string, unknown>

  /** Number of retry attempts */
  attempts: number

  /** Maximum retry attempts */
  maxAttempts: number

  /** Timestamp when queued */
  queuedAt: number

  /** Timestamp for next retry */
  nextRetryAt: number

  /** Current backoff delay in ms */
  backoffDelay: number

  /** Status of the write */
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'abandoned'

  /** Last error message if failed */
  lastError?: string

  /** Priority (higher = more urgent) */
  priority: number
}

/**
 * Configuration for the write queue
 */
export interface WriteQueueConfig {
  /** Maximum retry attempts (default: 5) */
  maxAttempts?: number

  /** Initial backoff delay in ms (default: 1000) */
  initialBackoff?: number

  /** Maximum backoff delay in ms (default: 60000) */
  maxBackoff?: number

  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number

  /** Maximum queue size (default: 1000) */
  maxQueueSize?: number

  /** Process interval in ms (default: 5000) */
  processInterval?: number

  /** Whether to persist queue (requires storage) */
  persistent?: boolean

  /** Called when a write succeeds */
  onWriteSuccess?: (write: QueuedWrite) => void

  /** Called when a write permanently fails */
  onWriteFailed?: (write: QueuedWrite, error: Error) => void

  /** Called when a write is abandoned (max attempts exceeded) */
  onWriteAbandoned?: (write: QueuedWrite) => void
}

/**
 * Statistics for the write queue
 */
export interface WriteQueueStats {
  /** Total writes queued */
  total: number

  /** Writes pending retry */
  pending: number

  /** Writes currently being processed */
  processing: number

  /** Writes that succeeded */
  succeeded: number

  /** Writes that permanently failed */
  failed: number

  /** Writes abandoned (max attempts exceeded) */
  abandoned: number

  /** Writes by namespace */
  byNamespace: Record<string, number>

  /** Writes by operation */
  byOperation: Record<string, number>

  /** Oldest pending write timestamp */
  oldestPendingAt: number | null

  /** Average retry attempts for succeeded writes */
  avgRetryAttempts: number
}

/**
 * Query options for write queue
 */
export interface WriteQueueQueryOptions {
  /** Filter by namespace */
  namespace?: string

  /** Filter by operation */
  operation?: string

  /** Filter by status */
  status?: QueuedWrite['status']

  /** Items ready for retry (nextRetryAt <= now) */
  readyForRetry?: boolean

  /** Limit results */
  limit?: number

  /** Sort order */
  sortBy?: 'priority' | 'queuedAt' | 'nextRetryAt'

  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}

/**
 * Write Queue interface for managing failed DO writes
 */
export interface WriteQueue {
  /**
   * Queue a write operation for retry
   */
  enqueue(write: {
    namespace: string
    operation: string
    request: Request
    metadata?: Record<string, unknown>
    priority?: number
  }): Promise<string>

  /**
   * Get a specific queued write
   */
  get(id: string): QueuedWrite | null

  /**
   * Query queued writes
   */
  query(options?: WriteQueueQueryOptions): QueuedWrite[]

  /**
   * Get writes ready for retry
   */
  getReadyWrites(): QueuedWrite[]

  /**
   * Get writes for a specific namespace
   */
  getNamespaceWrites(namespace: string): QueuedWrite[]

  /**
   * Process a single write (execute retry)
   */
  processWrite(id: string, executor: (write: QueuedWrite) => Promise<Response>): Promise<boolean>

  /**
   * Process all ready writes for a namespace
   */
  processNamespaceWrites(
    namespace: string,
    executor: (write: QueuedWrite) => Promise<Response>
  ): Promise<{ processed: number; succeeded: number }>

  /**
   * Mark a write as succeeded
   */
  markSucceeded(id: string): void

  /**
   * Mark a write as failed (will be retried if attempts < maxAttempts)
   */
  markFailed(id: string, error: string): void

  /**
   * Remove a write from the queue
   */
  remove(id: string): boolean

  /**
   * Get queue statistics
   */
  getStats(): WriteQueueStats

  /**
   * Clear all writes from queue
   */
  clear(): void

  /**
   * Clear writes for a specific namespace
   */
  clearNamespace(namespace: string): void

  /**
   * Get count of pending writes
   */
  getPendingCount(): number

  /**
   * Check if namespace has pending writes
   */
  hasPendingWrites(namespace: string): boolean
}

/**
 * Generate a unique write queue ID
 */
function generateWriteId(): string {
  return `wq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Calculate the next backoff delay with exponential backoff and jitter
 */
function calculateNextBackoffWithJitter(
  currentDelay: number,
  multiplier: number,
  maxBackoff: number
): number {
  const nextDelay = currentDelay * multiplier
  const capped = Math.min(nextDelay, maxBackoff)
  // Add 10-20% jitter
  const jitter = capped * (0.1 + Math.random() * 0.1)
  return Math.floor(capped + jitter)
}

/**
 * Create an in-memory write queue
 */
export function createWriteQueue(config: WriteQueueConfig = {}): WriteQueue {
  const {
    maxAttempts = 5,
    initialBackoff = 1000,
    maxBackoff = 60000,
    backoffMultiplier = 2,
    maxQueueSize = 1000,
    onWriteSuccess,
    onWriteFailed,
    onWriteAbandoned,
  } = config

  const writes = new Map<string, QueuedWrite>()

  const queue: WriteQueue = {
    async enqueue(data) {
      // Check queue size limit
      if (writes.size >= maxQueueSize) {
        // Remove oldest abandoned/failed writes first
        const sortedWrites = Array.from(writes.values())
          .filter((w) => w.status === 'abandoned' || w.status === 'failed')
          .sort((a, b) => a.queuedAt - b.queuedAt)

        if (sortedWrites.length > 0) {
          writes.delete(sortedWrites[0]!.id)
        } else {
          // Remove oldest pending write
          const pending = Array.from(writes.values())
            .filter((w) => w.status === 'pending')
            .sort((a, b) => a.queuedAt - b.queuedAt)

          if (pending.length > 0) {
            const removed = pending[0]!
            writes.delete(removed.id)
            if (onWriteAbandoned) {
              onWriteAbandoned(removed)
            }
          }
        }
      }

      const id = generateWriteId()
      const now = Date.now()

      // Serialize request
      const body = data.request.body ? await data.request.text() : null
      const headers: Record<string, string> = {}
      data.request.headers.forEach((value, key) => {
        headers[key] = value
      })

      const write: QueuedWrite = {
        id,
        namespace: data.namespace,
        operation: data.operation,
        method: data.request.method,
        url: data.request.url,
        body,
        headers,
        attempts: 0,
        maxAttempts,
        queuedAt: now,
        nextRetryAt: now + initialBackoff,
        backoffDelay: initialBackoff,
        status: 'pending',
        priority: data.priority ?? 0,
      }

      // Add optional properties only if defined (exactOptionalPropertyTypes)
      if (data.metadata !== undefined) {
        write.metadata = data.metadata
      }

      writes.set(id, write)
      logger.info(`Queued write ${id} for namespace ${data.namespace}, operation: ${data.operation}`)
      return id
    },

    get(id) {
      return writes.get(id) ?? null
    },

    query(options = {}) {
      let results = Array.from(writes.values())
      const now = Date.now()

      if (options.namespace) {
        results = results.filter((w) => w.namespace === options.namespace)
      }

      if (options.operation) {
        results = results.filter((w) => w.operation === options.operation)
      }

      if (options.status) {
        results = results.filter((w) => w.status === options.status)
      }

      if (options.readyForRetry) {
        results = results.filter((w) => w.status === 'pending' && w.nextRetryAt <= now)
      }

      // Sort
      const sortBy = options.sortBy ?? 'priority'
      const sortOrder = options.sortOrder ?? 'desc'
      const multiplier = sortOrder === 'desc' ? -1 : 1

      results.sort((a, b) => {
        switch (sortBy) {
          case 'priority':
            return (a.priority - b.priority) * multiplier
          case 'queuedAt':
            return (a.queuedAt - b.queuedAt) * multiplier
          case 'nextRetryAt':
            return (a.nextRetryAt - b.nextRetryAt) * multiplier
          default:
            return 0
        }
      })

      if (options.limit) {
        results = results.slice(0, options.limit)
      }

      return results
    },

    getReadyWrites() {
      return this.query({ readyForRetry: true, sortBy: 'priority', sortOrder: 'desc' })
    },

    getNamespaceWrites(namespace) {
      return this.query({ namespace, status: 'pending' })
    },

    async processWrite(id, executor) {
      const write = writes.get(id)
      if (!write) return false
      if (write.status !== 'pending') return false

      write.status = 'processing'
      write.attempts++

      try {
        // Reconstruct request
        const headers = new Headers(write.headers)
        const request = new Request(write.url, {
          method: write.method,
          headers,
          body: write.body,
        })

        const response = await executor({
          ...write,
          // Return the current state
        })

        if (response.ok) {
          this.markSucceeded(id)
          return true
        } else {
          const errorText = await response.text()
          this.markFailed(id, `HTTP ${response.status}: ${errorText}`)
          return false
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.markFailed(id, message)
        return false
      }
    },

    async processNamespaceWrites(namespace, executor) {
      const ready = this.query({ namespace, readyForRetry: true, sortBy: 'priority', sortOrder: 'desc' })
      let succeeded = 0

      for (const write of ready) {
        const result = await this.processWrite(write.id, executor)
        if (result) succeeded++
      }

      return { processed: ready.length, succeeded }
    },

    markSucceeded(id) {
      const write = writes.get(id)
      if (!write) return

      write.status = 'succeeded'
      logger.info(`Write ${id} succeeded after ${write.attempts} attempt(s)`)

      if (onWriteSuccess) {
        onWriteSuccess(write)
      }
    },

    markFailed(id, error) {
      const write = writes.get(id)
      if (!write) return

      write.lastError = error

      if (write.attempts >= write.maxAttempts) {
        write.status = 'abandoned'
        logger.warn(`Write ${id} abandoned after ${write.attempts} attempts: ${error}`)

        if (onWriteAbandoned) {
          onWriteAbandoned(write)
        }
      } else {
        write.status = 'pending'
        write.backoffDelay = calculateNextBackoffWithJitter(write.backoffDelay, backoffMultiplier, maxBackoff)
        write.nextRetryAt = Date.now() + write.backoffDelay
        logger.info(`Write ${id} failed, will retry at ${new Date(write.nextRetryAt).toISOString()}: ${error}`)
      }
    },

    remove(id) {
      return writes.delete(id)
    },

    getStats() {
      const stats: WriteQueueStats = {
        total: 0,
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        abandoned: 0,
        byNamespace: {},
        byOperation: {},
        oldestPendingAt: null,
        avgRetryAttempts: 0,
      }

      let totalSucceededAttempts = 0
      let succeededCount = 0

      for (const write of writes.values()) {
        stats.total++

        switch (write.status) {
          case 'pending':
            stats.pending++
            if (stats.oldestPendingAt === null || write.queuedAt < stats.oldestPendingAt) {
              stats.oldestPendingAt = write.queuedAt
            }
            break
          case 'processing':
            stats.processing++
            break
          case 'succeeded':
            stats.succeeded++
            totalSucceededAttempts += write.attempts
            succeededCount++
            break
          case 'failed':
            stats.failed++
            break
          case 'abandoned':
            stats.abandoned++
            break
        }

        stats.byNamespace[write.namespace] = (stats.byNamespace[write.namespace] ?? 0) + 1
        stats.byOperation[write.operation] = (stats.byOperation[write.operation] ?? 0) + 1
      }

      stats.avgRetryAttempts = succeededCount > 0 ? totalSucceededAttempts / succeededCount : 0

      return stats
    },

    clear() {
      writes.clear()
    },

    clearNamespace(namespace) {
      for (const [id, write] of writes.entries()) {
        if (write.namespace === namespace) {
          writes.delete(id)
        }
      }
    },

    getPendingCount() {
      let count = 0
      for (const write of writes.values()) {
        if (write.status === 'pending') count++
      }
      return count
    },

    hasPendingWrites(namespace) {
      for (const write of writes.values()) {
        if (write.namespace === namespace && write.status === 'pending') {
          return true
        }
      }
      return false
    },
  }

  return queue
}

// ============================================================================
// Degradation Status - Clear reporting to callers
// ============================================================================

/**
 * Degradation mode indicating how the system is currently operating
 */
export type DegradationMode =
  | 'normal' // System operating normally
  | 'circuit_open' // Circuit breaker is open, requests being rejected
  | 'degraded' // System degraded, using fallbacks
  | 'write_queued' // Writes being queued for retry
  | 'stale_data' // Serving stale cached data
  | 'unavailable' // Service completely unavailable

/**
 * Comprehensive degradation status for callers
 */
export interface DegradationStatus {
  /** Current degradation mode */
  mode: DegradationMode

  /** Whether the service is accepting requests */
  accepting: boolean

  /** Whether writes are being queued */
  writesQueued: boolean

  /** Number of pending writes */
  pendingWrites: number

  /** Whether stale data may be served */
  mayServeStale: boolean

  /** Estimated time until recovery (ms), null if unknown */
  estimatedRecoveryMs: number | null

  /** Circuit breaker state */
  circuitState: CircuitState

  /** Health status */
  healthStatus: HealthStatus

  /** Human-readable message */
  message: string

  /** Timestamp of this status */
  timestamp: number

  /** Additional details for debugging */
  details?: {
    consecutiveFailures?: number
    lastSuccessAt?: number | null
    lastFailureAt?: number | null
    circuitOpenedAt?: number | null
    avgLatencyMs?: number
  }
}

/**
 * Response with degradation status headers
 */
export interface DegradedResponse {
  response: Response
  status: DegradationStatus
}

/**
 * Add degradation status headers to a response
 */
export function addDegradationHeaders(response: Response, status: DegradationStatus): Response {
  const headers = new Headers(response.headers)

  headers.set('X-Degradation-Mode', status.mode)
  headers.set('X-Degradation-Accepting', String(status.accepting))
  headers.set('X-Degradation-Writes-Queued', String(status.writesQueued))
  headers.set('X-Degradation-Pending-Writes', String(status.pendingWrites))
  headers.set('X-Degradation-May-Serve-Stale', String(status.mayServeStale))
  headers.set('X-Circuit-State', status.circuitState)
  headers.set('X-Health-Status', status.healthStatus)

  if (status.estimatedRecoveryMs !== null) {
    headers.set('X-Degradation-Recovery-Ms', String(status.estimatedRecoveryMs))
    headers.set('Retry-After', String(Math.ceil(status.estimatedRecoveryMs / 1000)))
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Parse degradation status from response headers
 */
export function parseDegradationHeaders(response: Response): DegradationStatus | null {
  const mode = response.headers.get('X-Degradation-Mode') as DegradationMode | null
  if (!mode) return null

  return {
    mode,
    accepting: response.headers.get('X-Degradation-Accepting') === 'true',
    writesQueued: response.headers.get('X-Degradation-Writes-Queued') === 'true',
    pendingWrites: parseInt(response.headers.get('X-Degradation-Pending-Writes') ?? '0', 10),
    mayServeStale: response.headers.get('X-Degradation-May-Serve-Stale') === 'true',
    estimatedRecoveryMs: response.headers.get('X-Degradation-Recovery-Ms')
      ? parseInt(response.headers.get('X-Degradation-Recovery-Ms')!, 10)
      : null,
    circuitState: (response.headers.get('X-Circuit-State') as CircuitState) ?? 'closed',
    healthStatus: (response.headers.get('X-Health-Status') as HealthStatus) ?? 'unknown',
    message: `Degradation mode: ${mode}`,
    timestamp: Date.now(),
  }
}

// ============================================================================
// Enhanced Graceful Degradation Handler with Write Queue
// ============================================================================

/**
 * Enhanced configuration for graceful degradation
 */
export interface EnhancedGracefulDegradationConfig {
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
  healthCheckConfig?: HealthCheckConfig
  fallbackConfig?: FallbackConfig
  writeQueueConfig?: WriteQueueConfig

  /** Whether to queue writes when circuit is open (default: true) */
  queueWritesOnFailure?: boolean

  /** Whether to add degradation headers to responses (default: true) */
  addStatusHeaders?: boolean

  /** Methods considered as writes (default: ['POST', 'PUT', 'PATCH', 'DELETE']) */
  writeMethods?: string[]
}

/**
 * Enhanced Graceful Degradation Handler with write queue and status reporting
 */
export class EnhancedGracefulDegradationHandler {
  private circuitRegistry: CircuitBreakerRegistry
  private healthChecker: HealthChecker
  private fallbackHandler: FallbackHandler
  private writeQueue: WriteQueue
  private config: Required<EnhancedGracefulDegradationConfig>

  constructor(options: EnhancedGracefulDegradationConfig = {}) {
    this.circuitRegistry = createCircuitBreakerRegistry(options.circuitBreakerConfig)
    this.healthChecker = new HealthChecker(options.healthCheckConfig)
    this.fallbackHandler = new FallbackHandler(options.fallbackConfig)
    this.writeQueue = createWriteQueue(options.writeQueueConfig)

    this.config = {
      circuitBreakerConfig: options.circuitBreakerConfig ?? {},
      healthCheckConfig: options.healthCheckConfig ?? {},
      fallbackConfig: options.fallbackConfig ?? {},
      writeQueueConfig: options.writeQueueConfig ?? {},
      queueWritesOnFailure: options.queueWritesOnFailure ?? true,
      addStatusHeaders: options.addStatusHeaders ?? true,
      writeMethods: options.writeMethods ?? ['POST', 'PUT', 'PATCH', 'DELETE'],
    }
  }

  /**
   * Get current degradation status for a namespace
   */
  getDegradationStatus(namespace: string): DegradationStatus {
    const circuit = this.circuitRegistry.get(namespace)
    const circuitStats = circuit.getStats()
    const circuitState = circuit.getState()
    const healthStatus = this.healthChecker.getStatus(namespace)
    const pendingWrites = this.writeQueue.getNamespaceWrites(namespace).length

    // Determine mode
    let mode: DegradationMode = 'normal'
    let accepting = true
    let message = 'System operating normally'
    let estimatedRecoveryMs: number | null = null

    if (circuitState === 'open') {
      mode = 'circuit_open'
      accepting = false
      message = 'Circuit breaker is open due to repeated failures'

      // Estimate recovery based on circuit breaker config
      if (circuitStats.circuitOpenedAt) {
        const resetTimeout = this.config.circuitBreakerConfig.resetTimeoutMs ?? 30000
        const elapsed = Date.now() - circuitStats.circuitOpenedAt
        estimatedRecoveryMs = Math.max(0, resetTimeout - elapsed)
      }
    } else if (circuitState === 'half_open') {
      mode = 'degraded'
      accepting = true
      message = 'System recovering, limited requests being allowed'
    } else if (healthStatus?.status === 'degraded') {
      mode = 'degraded'
      accepting = true
      message = 'System experiencing degraded performance'
    } else if (healthStatus?.status === 'unhealthy') {
      mode = 'unavailable'
      accepting = false
      message = 'Service is unhealthy and not accepting requests'
    }

    // Check if writes are queued
    const writesQueued = pendingWrites > 0
    if (writesQueued && mode === 'normal') {
      mode = 'write_queued'
      message = `${pendingWrites} write(s) queued for retry`
    }

    return {
      mode,
      accepting,
      writesQueued,
      pendingWrites,
      mayServeStale: this.fallbackHandler.getCachedResponse(namespace, '') !== undefined,
      estimatedRecoveryMs,
      circuitState,
      healthStatus: healthStatus?.status ?? 'unknown',
      message,
      timestamp: Date.now(),
      details: {
        consecutiveFailures: circuitStats.consecutiveFailures,
        lastSuccessAt: circuitStats.lastSuccessTime,
        lastFailureAt: circuitStats.lastFailureTime,
        circuitOpenedAt: circuitStats.circuitOpenedAt,
        avgLatencyMs: circuitStats.avgLatencyMs,
      },
    }
  }

  /**
   * Check if a request is a write operation
   */
  private isWriteOperation(request: Request): boolean {
    return this.config.writeMethods.includes(request.method.toUpperCase())
  }

  /**
   * Execute a request with graceful degradation and write queuing
   */
  async executeRequest(
    namespace: string,
    request: Request,
    operation: () => Promise<Response>
  ): Promise<DegradedResponse> {
    const circuit = this.circuitRegistry.get(namespace)
    const isWrite = this.isWriteOperation(request)

    const result = await circuit.execute(operation)

    let response: Response
    let status: DegradationStatus

    if (result.success) {
      // Cache successful read responses
      if (!isWrite) {
        this.fallbackHandler.cacheResponse(namespace, request.url, result.value)
      }

      response = result.value
      status = this.getDegradationStatus(namespace)
    } else {
      // Handle failure
      status = this.getDegradationStatus(namespace)

      // Queue write operations for retry
      if (isWrite && this.config.queueWritesOnFailure && !result.rejected) {
        try {
          // Clone request before it's consumed
          // Cast to standard Request to handle Cloudflare-specific Request types
          const clonedRequest = request.clone() as Request
          await this.writeQueue.enqueue({
            namespace,
            operation: `${request.method} ${new URL(request.url).pathname}`,
            request: clonedRequest,
            metadata: {
              error: result.error.message,
              circuitState: status.circuitState,
            },
          })

          // Update status after queueing
          status = this.getDegradationStatus(namespace)
          status.writesQueued = true
          status.mode = 'write_queued'
          status.message = 'Write queued for retry when service recovers'
        } catch (queueError) {
          logger.error('Failed to queue write:', queueError)
        }
      }

      // Generate fallback response
      const context: FallbackContext = {
        namespace,
        circuitStats: circuit.getStats(),
        error: result.error,
        circuitOpen: result.rejected,
        healthStatus: status.healthStatus,
      }

      response = await this.fallbackHandler.getFallback(request, context)

      // If we're serving cached data, update the mode
      if (response.headers.get('X-Fallback') === 'cached') {
        status.mode = 'stale_data'
        status.mayServeStale = true
        status.message = 'Serving cached/stale data'
      }
    }

    // Add status headers if configured
    if (this.config.addStatusHeaders) {
      response = addDegradationHeaders(response, status)
    }

    return { response, status }
  }

  /**
   * Process pending writes for a namespace
   */
  async processPendingWrites(
    namespace: string,
    executor: (write: QueuedWrite) => Promise<Response>
  ): Promise<{ processed: number; succeeded: number }> {
    return this.writeQueue.processNamespaceWrites(namespace, executor)
  }

  /**
   * Try to recover pending writes when circuit closes
   */
  async attemptWriteRecovery(
    namespace: string,
    executor: (write: QueuedWrite) => Promise<Response>
  ): Promise<void> {
    const circuit = this.circuitRegistry.get(namespace)
    if (circuit.getState() !== 'closed') {
      logger.info(`Cannot recover writes for ${namespace}: circuit not closed`)
      return
    }

    const result = await this.processPendingWrites(namespace, executor)
    logger.info(`Write recovery for ${namespace}: ${result.succeeded}/${result.processed} succeeded`)
  }

  /**
   * Perform health check for a namespace
   */
  async checkHealth(
    namespace: string,
    customFn?: () => Promise<{ healthy: boolean; latencyMs: number; error?: string }>
  ): Promise<HealthCheckResult> {
    const circuit = this.circuitRegistry.get(namespace)
    const result = await this.healthChecker.check(namespace, customFn)
    result.circuitState = circuit.getState()
    return result
  }

  /**
   * Get overall system health with degradation info
   */
  getHealthReport(): HealthReport & { degradation: Record<string, DegradationStatus> } {
    const report = this.healthChecker.getReport()

    // Enrich with circuit breaker states
    for (const service of report.services) {
      if (this.circuitRegistry.has(service.name)) {
        service.circuitState = this.circuitRegistry.get(service.name).getState()
      }
    }

    // Add degradation status for each namespace
    const degradation: Record<string, DegradationStatus> = {}
    for (const name of this.circuitRegistry.getNames()) {
      degradation[name] = this.getDegradationStatus(name)
    }

    return { ...report, degradation }
  }

  /**
   * Get circuit breaker for a namespace
   */
  getCircuit(namespace: string): CircuitBreaker {
    return this.circuitRegistry.get(namespace)
  }

  /**
   * Get write queue
   */
  getWriteQueue(): WriteQueue {
    return this.writeQueue
  }

  /**
   * Get write queue stats
   */
  getWriteQueueStats(): WriteQueueStats {
    return this.writeQueue.getStats()
  }

  /**
   * Get all circuit stats
   */
  getAllCircuitStats(): Record<string, CircuitStats> {
    return this.circuitRegistry.getAllStats()
  }

  /**
   * Reset everything
   */
  reset(): void {
    this.circuitRegistry.resetAll()
    this.healthChecker.clear()
    this.fallbackHandler.clearCache()
    this.writeQueue.clear()
  }
}

/**
 * Create an enhanced graceful degradation handler
 */
export function createEnhancedGracefulDegradationHandler(
  options?: EnhancedGracefulDegradationConfig
): EnhancedGracefulDegradationHandler {
  return new EnhancedGracefulDegradationHandler(options)
}

/**
 * Create a write queue instance
 */
export function createWriteQueueInstance(config?: WriteQueueConfig): WriteQueue {
  return createWriteQueue(config)
}
