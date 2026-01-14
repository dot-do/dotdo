/**
 * @module Resolver
 * @description Cross-DO resolution with circuit breakers
 *
 * Handles stub caching, circuit breakers, and cross-DO method invocation.
 * Extracted from DOBase and DOFull.
 */

import type { Thing } from '../../types/Thing'

/**
 * Custom error class for cross-DO call failures with rich context
 */
export class CrossDOError extends Error {
  code: string
  context: {
    targetDO?: string
    method?: string
    source?: string
    attempts?: number
    originalError?: string
  }

  constructor(
    code: string,
    message: string,
    context: {
      targetDO?: string
      method?: string
      source?: string
      attempts?: number
      originalError?: string
    } = {}
  ) {
    super(message)
    this.name = 'CrossDOError'
    this.code = code
    this.context = context

    // Preserve stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CrossDOError)
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        context: this.context,
      },
    }
  }
}

/**
 * Circuit breaker state
 */
type CircuitBreakerState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerEntry {
  failures: number
  lastFailure: number
  openUntil: number
  state: CircuitBreakerState
  halfOpenTestInProgress?: boolean
}

interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

interface StubCacheEntry {
  stub: DOStub
  cachedAt: number
  lastUsed: number
}

/**
 * Configuration for cross-DO operations
 */
export interface ResolverConfig {
  /** TTL for stub cache entries in ms */
  stubCacheTtl?: number

  /** Max number of stubs to cache */
  stubCacheMaxSize?: number

  /** Number of failures before circuit opens */
  circuitBreakerThreshold?: number

  /** Time circuit stays open in ms */
  circuitBreakerTimeout?: number

  /** Max retry attempts */
  maxRetryAttempts?: number

  /** Initial retry delay in ms */
  initialRetryDelayMs?: number

  /** Max retry delay in ms */
  maxRetryDelayMs?: number

  /** Backoff multiplier */
  backoffMultiplier?: number

  /** HTTP status codes that trigger retry */
  retryableStatuses?: number[]

  /** Timeout for cross-DO calls in ms */
  callTimeoutMs?: number
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ResolverConfig> = {
  stubCacheTtl: 60000,
  stubCacheMaxSize: 100,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 30000,
  maxRetryAttempts: 3,
  initialRetryDelayMs: 100,
  maxRetryDelayMs: 5000,
  backoffMultiplier: 2,
  retryableStatuses: [500, 502, 503, 504],
  callTimeoutMs: 30000,
}

/**
 * Dependencies required by Resolver
 */
export interface ResolverDeps {
  /** Namespace URL */
  ns: string

  /** DO namespace binding */
  doNamespace: {
    idFromName(name: string): unknown
    idFromString(id: string): unknown
    get(id: unknown): DOStub
  } | undefined

  /** Objects store for looking up DO registrations */
  objectsGet: (ns: string) => Promise<{ id: string } | null>

  /** Sleep function */
  sleep: (ms: number) => Promise<void>
}

/**
 * Resolver - Manages cross-DO resolution with circuit breakers
 *
 * This class encapsulates all cross-DO resolution logic,
 * allowing it to be composed into DO classes rather than inherited.
 */
export class Resolver {
  private _stubCache: Map<string, StubCacheEntry> = new Map()
  private _circuitBreakers: Map<string, CircuitBreakerEntry> = new Map()
  private readonly config: Required<ResolverConfig>
  private readonly deps: ResolverDeps

  constructor(deps: ResolverDeps, config: ResolverConfig = {}) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUIT BREAKER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check circuit breaker state for a target
   */
  checkCircuitBreaker(target: string): CircuitBreakerState {
    const state = this._circuitBreakers.get(target)
    if (!state) return 'closed'

    const now = Date.now()

    if (state.state === 'open') {
      if (now >= state.openUntil) {
        state.state = 'half-open'
        state.halfOpenTestInProgress = false
        this._circuitBreakers.set(target, state)
        return 'half-open'
      }
      return 'open'
    }

    return state.state
  }

  /**
   * Record a failure for a target
   */
  recordFailure(target: string): void {
    const state = this._circuitBreakers.get(target) || {
      failures: 0,
      lastFailure: 0,
      openUntil: 0,
      state: 'closed' as CircuitBreakerState,
    }

    state.failures++
    state.lastFailure = Date.now()

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.state = 'open'
      state.openUntil = Date.now() + this.config.circuitBreakerTimeout
      state.failures = 0
      this._stubCache.delete(target)
    }

    if (state.state === 'half-open') {
      state.state = 'open'
      state.openUntil = Date.now() + this.config.circuitBreakerTimeout
      state.halfOpenTestInProgress = false
    }

    this._circuitBreakers.set(target, state)
  }

  /**
   * Record a success for a target (resets circuit breaker)
   */
  recordSuccess(target: string): void {
    this._circuitBreakers.delete(target)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STUB CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get or create a stub for a target DO
   */
  getOrCreateStub(ns: string, doId: string): DOStub {
    if (!this.deps.doNamespace) {
      throw new Error('DO namespace binding not configured')
    }

    const now = Date.now()
    const cached = this._stubCache.get(ns)

    if (cached && now - cached.cachedAt < this.config.stubCacheTtl) {
      cached.lastUsed = now
      return cached.stub
    }

    const id = this.deps.doNamespace.idFromString(doId)
    const stub = this.deps.doNamespace.get(id)

    this.evictLRUStubs()

    this._stubCache.set(ns, { stub, cachedAt: now, lastUsed: now })

    return stub
  }

  /**
   * Evict least recently used stubs when cache is full
   */
  private evictLRUStubs(): void {
    while (this._stubCache.size >= this.config.stubCacheMaxSize) {
      let lruNs: string | null = null
      let lruLastUsed = Infinity

      this._stubCache.forEach((entry, ns) => {
        if (entry.lastUsed < lruLastUsed) {
          lruLastUsed = entry.lastUsed
          lruNs = ns
        }
      })

      if (lruNs) {
        this._stubCache.delete(lruNs)
      } else {
        break
      }
    }
  }

  /**
   * Clear stub cache (optionally for a specific ns)
   */
  clearStubCache(ns?: string): void {
    if (ns) {
      this._stubCache.delete(ns)
    } else {
      this._stubCache.clear()
    }
  }

  /**
   * Clear circuit breaker state (optionally for a specific target)
   */
  clearCircuitBreaker(target?: string): void {
    if (target) {
      this._circuitBreakers.delete(target)
    } else {
      this._circuitBreakers.clear()
    }
  }

  /**
   * Clear all cross-DO caches
   */
  clearAll(ns?: string): void {
    this.clearStubCache(ns)
    this.clearCircuitBreaker(ns)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-DO RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a cross-DO reference
   */
  async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    // Check circuit breaker state
    const circuitState = this.checkCircuitBreaker(ns)
    if (circuitState === 'open') {
      throw new CrossDOError(
        'CIRCUIT_BREAKER_OPEN',
        `Circuit breaker open for namespace: ${ns}`,
        { targetDO: ns, source: this.deps.ns }
      )
    }

    const obj = await this.deps.objectsGet(ns)
    if (!obj) {
      throw new CrossDOError(
        'UNKNOWN_NAMESPACE',
        `Unknown namespace: ${ns}`,
        { targetDO: ns, source: this.deps.ns }
      )
    }

    if (!this.deps.doNamespace) {
      throw new CrossDOError(
        'NO_DO_BINDING',
        'DO namespace binding not configured',
        { targetDO: ns, source: this.deps.ns }
      )
    }

    const stub = this.getOrCreateStub(ns, obj.id)

    const resolveUrl = new URL(`${ns}/resolve`)
    resolveUrl.searchParams.set('path', path)
    resolveUrl.searchParams.set('ref', ref)

    try {
      const response = await stub.fetch(new Request(resolveUrl.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }))

      if (!response.ok) {
        this.recordFailure(ns)
        throw new CrossDOError(
          'RESOLUTION_FAILED',
          `Cross-DO resolution failed: ${response.status}`,
          { targetDO: ns, source: this.deps.ns }
        )
      }

      this.recordSuccess(ns)

      let thing: Thing
      try {
        thing = await response.json() as Thing
      } catch {
        throw new CrossDOError(
          'INVALID_RESPONSE',
          'Invalid response from remote DO',
          { targetDO: ns, source: this.deps.ns }
        )
      }

      return thing
    } catch (error) {
      if (error instanceof CrossDOError) {
        throw error
      }
      this.recordFailure(ns)
      throw error
    }
  }

  /**
   * Invoke a method on a cross-DO
   */
  async invokeCrossDOMethod(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<unknown> {
    if (!this.deps.doNamespace) {
      throw new CrossDOError(
        'NO_DO_BINDING',
        `Method '${method}' not found and DO namespace not configured for cross-DO calls`,
        { targetDO: `${noun}/${id}`, method, source: this.deps.ns }
      )
    }

    const targetNs = `${noun}/${id}`
    const timeout = options?.timeout ?? this.config.callTimeoutMs

    // Check circuit breaker
    const circuitState = this.checkCircuitBreaker(targetNs)
    if (circuitState === 'open') {
      throw new CrossDOError(
        'CIRCUIT_BREAKER_OPEN',
        `Circuit breaker open for ${targetNs}`,
        { targetDO: targetNs, source: this.deps.ns }
      )
    }

    const doId = this.deps.doNamespace.idFromName(targetNs)
    const stub = this.deps.doNamespace.get(doId)

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      attempts = attempt

      try {
        const response = await this.fetchWithTimeout(
          stub,
          `https://${targetNs}/rpc/${method}`,
          { args },
          timeout
        )

        if (!response.ok) {
          if (this.config.retryableStatuses.includes(response.status) &&
              attempt < this.config.maxRetryAttempts) {
            const delay = this.calculateBackoffDelay(attempt)
            await this.deps.sleep(delay)
            continue
          }

          this.recordFailure(targetNs)
          throw new CrossDOError(
            'RPC_FAILED',
            `Cross-DO RPC failed: ${response.status}`,
            { targetDO: targetNs, method, source: this.deps.ns, attempts }
          )
        }

        this.recordSuccess(targetNs)
        return await response.json()
      } catch (error) {
        lastError = error as Error

        if (error instanceof CrossDOError) {
          throw error
        }

        if (attempt < this.config.maxRetryAttempts) {
          const delay = this.calculateBackoffDelay(attempt)
          await this.deps.sleep(delay)
        } else {
          this.recordFailure(targetNs)
        }
      }
    }

    throw new CrossDOError(
      'RPC_EXHAUSTED',
      lastError?.message ?? 'Cross-DO RPC failed after all retries',
      { targetDO: targetNs, method, source: this.deps.ns, attempts }
    )
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    stub: DOStub,
    url: string,
    body: unknown,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      return await stub.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    let delay = this.config.initialRetryDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt - 1)
    delay = Math.min(delay, this.config.maxRetryDelayMs)
    // Add jitter
    delay += Math.random() * delay * 0.25
    return Math.floor(delay)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOMAIN PROXY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a domain proxy for $.Noun(id) syntax
   */
  createDomainProxy(
    noun: string,
    id: string,
    localMethodResolver: (method: string, args: unknown[]) => Promise<unknown> | null
  ): unknown {
    const self = this

    return new Proxy({}, {
      get(_, method: string) {
        if (method === 'then' || method === 'catch' || method === 'finally') {
          return undefined
        }

        return (...args: unknown[]): Promise<unknown> => {
          // Try local method first
          const localResult = localMethodResolver(method, args)
          if (localResult !== null) {
            return localResult
          }

          // Fall back to cross-DO invocation
          return self.invokeCrossDOMethod(noun, id, method, args)
        }
      },
    })
  }
}

/**
 * Factory function to create a Resolver instance
 */
export function createResolver(deps: ResolverDeps, config?: ResolverConfig): Resolver {
  return new Resolver(deps, config)
}
