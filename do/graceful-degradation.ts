/**
 * Graceful Degradation Module for DO Unavailability
 *
 * Provides fallback responses, health checks, and degradation strategies
 * when Durable Objects are unavailable or responding slowly.
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
