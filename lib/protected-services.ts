/**
 * @module lib/protected-services
 *
 * Service wrappers with Circuit Breaker protection
 *
 * Provides protected versions of:
 * - AI services (with per-model circuits and fallback chains)
 * - Pipeline services (with event buffering on circuit open)
 * - R2 services (with separate read/write circuits)
 */

import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState } from './circuit-breaker'

// ============================================================================
// TYPES
// ============================================================================

interface AIService {
  run(model: string, options: { messages: unknown[] }): Promise<{ response: string }>
}

interface PipelineService {
  send(events: Array<{ type: string; data: unknown }>): Promise<void>
}

interface R2Service {
  put(key: string, data: unknown): Promise<unknown>
  get(key: string): Promise<{ text(): string } | null>
}

export interface ProtectedAIServiceConfig extends CircuitBreakerConfig {
  /** Whether to use separate circuits per model */
  circuitPerModel?: boolean
  /** Fallback chain mapping primary model to fallback models */
  fallbackChain?: Record<string, string[]>
}

export interface ProtectedPipelineServiceConfig extends CircuitBreakerConfig {
  /** Whether to buffer events when circuit is open instead of throwing */
  bufferOnCircuitOpen?: boolean
  /** Maximum number of events to buffer */
  maxBufferSize?: number
}

export interface ProtectedR2ServiceConfig extends CircuitBreakerConfig {
  /** Whether to use separate circuits for read and write operations */
  separateReadWriteCircuits?: boolean
}

// ============================================================================
// PROTECTED AI SERVICE
// ============================================================================

/**
 * AI Service wrapper with circuit breaker protection
 *
 * Features:
 * - Circuit breaker for AI calls
 * - Optional per-model circuits
 * - Automatic fallback to alternative models when primary circuit is open
 */
export class ProtectedAIService {
  private ai: AIService
  private config: ProtectedAIServiceConfig
  private mainBreaker: CircuitBreaker
  private modelBreakers: Map<string, CircuitBreaker> = new Map()

  constructor(ai: AIService, config: ProtectedAIServiceConfig) {
    this.ai = ai
    this.config = config
    this.mainBreaker = new CircuitBreaker(config)
  }

  get circuitState(): CircuitBreakerState {
    return this.mainBreaker.state
  }

  async run(model: string, options: { messages: unknown[] }): Promise<{ response: string }> {
    const breaker = this.getBreakerForModel(model)

    // Check if circuit is open and we have fallbacks
    if (breaker.state === 'open' && this.config.fallbackChain?.[model]) {
      // Try fallback models
      const fallbacks = this.config.fallbackChain[model]
      for (const fallbackModel of fallbacks) {
        const fallbackBreaker = this.getBreakerForModel(fallbackModel)
        if (fallbackBreaker.state !== 'open') {
          return fallbackBreaker.execute(async () => {
            return this.ai.run(fallbackModel, options)
          })
        }
      }
    }

    return breaker.execute(async () => {
      return this.ai.run(model, options)
    })
  }

  private getBreakerForModel(model: string): CircuitBreaker {
    if (!this.config.circuitPerModel) {
      return this.mainBreaker
    }

    if (!this.modelBreakers.has(model)) {
      this.modelBreakers.set(model, new CircuitBreaker(this.config))
    }

    return this.modelBreakers.get(model)!
  }
}

// ============================================================================
// PROTECTED PIPELINE SERVICE
// ============================================================================

/**
 * Pipeline Service wrapper with circuit breaker protection
 *
 * Features:
 * - Circuit breaker for pipeline calls
 * - Optional event buffering when circuit is open
 * - Automatic buffer flush on circuit close
 */
export class ProtectedPipelineService {
  private pipeline: PipelineService
  private config: ProtectedPipelineServiceConfig
  private breaker: CircuitBreaker
  private eventBuffer: Array<{ type: string; data: unknown }> = []

  constructor(pipeline: PipelineService, config: ProtectedPipelineServiceConfig) {
    this.pipeline = pipeline
    this.config = config
    this.breaker = new CircuitBreaker({
      ...config,
      onStateChange: (change) => {
        // Flush buffer when circuit closes
        if (change.to === 'closed' && this.eventBuffer.length > 0) {
          this.flushBuffer()
        }
        config.onStateChange?.(change)
      },
    })
  }

  get circuitState(): CircuitBreakerState {
    return this.breaker.state
  }

  get bufferedEventCount(): number {
    return this.eventBuffer.length
  }

  async send(events: Array<{ type: string; data: unknown }>): Promise<void> {
    // If circuit is already open and buffering is enabled, buffer the events
    if (this.breaker.state === 'open' && this.config.bufferOnCircuitOpen) {
      this.bufferEvents(events)
      return
    }

    // If we're in half-open or closed state, try to execute
    // and include any buffered events
    await this.breaker.execute(async () => {
      // If there are buffered events, include them in this send
      if (this.eventBuffer.length > 0) {
        const allEvents = [...this.eventBuffer, ...events]
        this.eventBuffer = []
        await this.pipeline.send(allEvents)
      } else {
        await this.pipeline.send(events)
      }
    })
  }

  private bufferEvents(events: Array<{ type: string; data: unknown }>): void {
    for (const event of events) {
      if (this.config.maxBufferSize && this.eventBuffer.length >= this.config.maxBufferSize) {
        // Drop oldest event
        this.eventBuffer.shift()
      }
      this.eventBuffer.push(event)
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    try {
      const events = [...this.eventBuffer]
      this.eventBuffer = []
      await this.pipeline.send(events)
    } catch (err) {
      // Flush failed - events are lost, circuit breaker will reopen
      console.error('[ProtectedPipeline] Buffer flush failed - events lost:', (err as Error).message)
    }
  }
}

// ============================================================================
// PROTECTED R2 SERVICE
// ============================================================================

/**
 * R2 Service wrapper with circuit breaker protection
 *
 * Features:
 * - Circuit breaker for R2 calls
 * - Optional separate circuits for read and write operations
 */
export class ProtectedR2Service {
  private r2: R2Service
  private config: ProtectedR2ServiceConfig
  private mainBreaker: CircuitBreaker
  private readBreaker: CircuitBreaker | null = null
  private writeBreaker: CircuitBreaker | null = null

  constructor(r2: R2Service, config: ProtectedR2ServiceConfig) {
    this.r2 = r2
    this.config = config
    this.mainBreaker = new CircuitBreaker(config)

    if (config.separateReadWriteCircuits) {
      this.readBreaker = new CircuitBreaker(config)
      this.writeBreaker = new CircuitBreaker(config)
    }
  }

  get circuitState(): CircuitBreakerState {
    // Return the worst state if using separate circuits
    if (this.config.separateReadWriteCircuits) {
      if (this.writeBreaker?.state === 'open' || this.readBreaker?.state === 'open') {
        return 'open'
      }
      if (this.writeBreaker?.state === 'half-open' || this.readBreaker?.state === 'half-open') {
        return 'half-open'
      }
    }
    return this.mainBreaker.state
  }

  async put(key: string, data: unknown): Promise<void> {
    const breaker = this.config.separateReadWriteCircuits ? this.writeBreaker! : this.mainBreaker

    await breaker.execute(async () => {
      await this.r2.put(key, data)
    })
  }

  async get(key: string): Promise<string> {
    const breaker = this.config.separateReadWriteCircuits ? this.readBreaker! : this.mainBreaker

    return breaker.execute(async () => {
      const result = await this.r2.get(key)
      if (!result) {
        return ''
      }
      return result.text()
    })
  }
}
