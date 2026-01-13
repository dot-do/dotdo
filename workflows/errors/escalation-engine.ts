/**
 * Error Escalation Engine
 *
 * Implements error escalation chains that cascade through capability tiers:
 * Code -> Generative -> Agentic -> Human
 *
 * Features:
 * - Retry with exponential backoff for transient errors
 * - Circuit breaker for consecutive failures
 * - Dead letter queue for exhausted escalation chains
 * - Graph integration for escalation tracking
 * - Event emission for observability
 *
 * @module workflows/errors/escalation-engine
 */

import type { GraphEngine } from '../../db/graph'
import {
  classifyError as classifyErrorFn,
  type ClassifiedError,
  type CapabilityTier,
  type ErrorClassification,
  type ErrorSeverity,
  getNextTier,
  TIER_ORDER,
} from './error-classifier'

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { classifyError } from './error-classifier'
export type {
  ClassifiedError,
  CapabilityTier,
  ErrorClassification,
  ErrorSeverity,
} from './error-classifier'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Escalation step in the chain
 */
export interface EscalationStep {
  id: string
  tier: CapabilityTier
  error: Error
  classification: ClassifiedError
  timestamp: number
  duration: number
  success: boolean
  resolution?: unknown
}

/**
 * Escalation chain result
 */
export interface EscalationChainResult {
  /** All steps taken */
  steps: EscalationStep[]
  /** Final resolution (if successful) */
  resolution?: unknown
  /** Final error (if failed) */
  finalError?: Error
  /** Whether the chain was exhausted */
  exhausted: boolean
  /** Total duration in ms */
  totalDuration: number
  /** Which tier resolved the issue */
  resolvedByTier?: CapabilityTier
}

/**
 * Recovery strategy
 */
export interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'circuit-breaker' | 'dead-letter' | 'escalate'
  maxAttempts?: number
  backoffMs?: number
  fallbackTier?: CapabilityTier
}

/**
 * Escalation options
 */
export interface EscalationOptions {
  /** Starting tier */
  startTier?: CapabilityTier
  /** Maximum tiers to try */
  maxTiers?: number
  /** Timeout per tier in ms */
  tierTimeout?: number
  /** Global timeout in ms */
  globalTimeout?: number
  /** Handler for each tier */
  handlers?: Partial<Record<CapabilityTier, (error: Error) => Promise<unknown> | unknown>>
}

/**
 * Escalation query options
 */
export interface EscalationQueryOptions {
  /** Filter by tier */
  tier?: CapabilityTier
  /** Filter by classification */
  classification?: ErrorClassification
  /** Filter by time range */
  since?: number
  /** Limit results */
  limit?: number
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening */
  failureThreshold: number
  /** Cooldown period in ms before half-open */
  cooldownPeriod: number
  /** Number of successes to close from half-open */
  successThreshold?: number
}

/**
 * Escalation event types
 */
export type EscalationEventType =
  | 'escalation.started'
  | 'escalation.completed'
  | 'tier.started'
  | 'tier.succeeded'
  | 'tier.failed'
  | 'tier.timeout'
  | 'retry.attempt'
  | 'circuit.opened'
  | 'circuit.half_opened'
  | 'circuit.closed'

/**
 * Escalation event
 */
export interface EscalationEvent {
  type: EscalationEventType
  timestamp: number
  tier?: CapabilityTier
  error?: Error
  resolution?: unknown
  metadata?: Record<string, unknown>
}

/**
 * Escalation engine configuration
 */
export interface EscalationEngineConfig {
  /** Graph engine for tracking */
  graph: GraphEngine
  /** Database reference for isolation */
  db: object
  /** Maximum retries per tier */
  maxRetries?: number
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig
  /** Dead letter handler */
  deadLetterHandler?: (error: Error, chain: EscalationChainResult) => Promise<void>
  /** Event callback */
  onEscalation?: (event: EscalationEvent) => void
}

/**
 * Escalation metrics
 */
export interface EscalationMetrics {
  totalEscalations: number
  resolvedAtTier: Record<CapabilityTier, number>
  exhaustedCount: number
  averageEscalationDepth: number
  averageDuration: number
}

/**
 * Error escalation engine interface
 */
export interface ErrorEscalationEngine {
  /** Classify an error */
  classify(error: Error, context?: Record<string, unknown>): ClassifiedError

  /** Escalate an error through the chain */
  escalate(error: Error, options?: EscalationOptions): Promise<EscalationChainResult>

  /** Get recovery strategy for a classified error */
  getRecoveryStrategy(classified: ClassifiedError): RecoveryStrategy

  /** Record escalation in the graph */
  recordEscalation(step: EscalationStep): Promise<void>

  /** Query escalation history */
  queryEscalations(options?: EscalationQueryOptions): Promise<EscalationStep[]>

  /** Get circuit state for a tier */
  getCircuitState(tier: CapabilityTier): CircuitState

  /** Get escalation metrics */
  getMetrics(): Promise<EscalationMetrics>
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailureTime: number
  lastStateChange: number
}

class CircuitBreaker {
  private circuits: Map<CapabilityTier, CircuitBreakerState> = new Map()
  private config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = config
  }

  getState(tier: CapabilityTier): CircuitState {
    const circuit = this.getOrCreateCircuit(tier)

    // Check if we should transition from OPEN to HALF_OPEN
    if (circuit.state === CircuitState.OPEN) {
      const elapsed = Date.now() - circuit.lastStateChange
      if (elapsed >= this.config.cooldownPeriod) {
        circuit.state = CircuitState.HALF_OPEN
        circuit.lastStateChange = Date.now()
        circuit.successCount = 0
      }
    }

    return circuit.state
  }

  recordSuccess(tier: CapabilityTier): void {
    const circuit = this.getOrCreateCircuit(tier)

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successCount++
      const threshold = this.config.successThreshold ?? 1
      if (circuit.successCount >= threshold) {
        circuit.state = CircuitState.CLOSED
        circuit.failureCount = 0
        circuit.lastStateChange = Date.now()
      }
    } else if (circuit.state === CircuitState.CLOSED) {
      // Reset failure count on success
      circuit.failureCount = 0
    }
  }

  recordFailure(tier: CapabilityTier): void {
    const circuit = this.getOrCreateCircuit(tier)

    circuit.failureCount++
    circuit.lastFailureTime = Date.now()

    if (circuit.state === CircuitState.CLOSED) {
      if (circuit.failureCount >= this.config.failureThreshold) {
        circuit.state = CircuitState.OPEN
        circuit.lastStateChange = Date.now()
      }
    } else if (circuit.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open reopens the circuit
      circuit.state = CircuitState.OPEN
      circuit.lastStateChange = Date.now()
    }
  }

  private getOrCreateCircuit(tier: CapabilityTier): CircuitBreakerState {
    if (!this.circuits.has(tier)) {
      this.circuits.set(tier, {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        lastStateChange: Date.now(),
      })
    }
    return this.circuits.get(tier)!
  }
}

// ============================================================================
// ESCALATION ENGINE IMPLEMENTATION
// ============================================================================

class EscalationEngineImpl implements ErrorEscalationEngine {
  private graph: GraphEngine
  private db: object
  private maxRetries: number
  private circuitBreaker: CircuitBreaker | null
  private deadLetterHandler?: (error: Error, chain: EscalationChainResult) => Promise<void>
  private onEscalation?: (event: EscalationEvent) => void
  private escalationStore: EscalationStep[] = []
  private stepIdCounter = 0

  constructor(config: EscalationEngineConfig) {
    this.graph = config.graph
    this.db = config.db
    this.maxRetries = config.maxRetries ?? 3
    this.circuitBreaker = config.circuitBreaker
      ? new CircuitBreaker(config.circuitBreaker)
      : null
    this.deadLetterHandler = config.deadLetterHandler
    this.onEscalation = config.onEscalation
  }

  classify(error: Error, context?: Record<string, unknown>): ClassifiedError {
    return classifyErrorFn(error, { context })
  }

  async escalate(error: Error, options: EscalationOptions = {}): Promise<EscalationChainResult> {
    const startTime = Date.now()
    const {
      startTier = 'code',
      maxTiers = TIER_ORDER.length,
      tierTimeout,
      globalTimeout,
      handlers = {},
    } = options

    const steps: EscalationStep[] = []
    let resolution: unknown
    let finalError: Error | undefined
    let resolvedByTier: CapabilityTier | undefined
    let exhausted = false

    // Emit start event
    this.emit({ type: 'escalation.started', timestamp: Date.now(), error })

    // Build tier order starting from startTier
    const startIndex = TIER_ORDER.indexOf(startTier)
    const tiersToTry = TIER_ORDER.slice(startIndex, startIndex + maxTiers)

    // Global timeout tracking
    let globalTimedOut = false
    let globalTimeoutId: ReturnType<typeof setTimeout> | undefined

    if (globalTimeout) {
      globalTimeoutId = setTimeout(() => {
        globalTimedOut = true
      }, globalTimeout)
    }

    let currentError = error

    try {
      for (const tier of tiersToTry) {
        // Check if global timeout has been reached
        if (globalTimedOut) {
          finalError = new Error(`Global escalation timeout after ${globalTimeout}ms`)
          exhausted = true
          break
        }

        const handler = handlers[tier]
        if (!handler) continue

        // Check circuit breaker
        if (this.circuitBreaker) {
          const circuitState = this.circuitBreaker.getState(tier)
          if (circuitState === CircuitState.OPEN) {
            // Skip this tier, circuit is open
            continue
          }
        }

        const stepStart = Date.now()
        const classified = classifyErrorFn(currentError, { currentTier: tier })
        let success = false
        let stepResolution: unknown
        let stepError: Error | undefined

        this.emit({ type: 'tier.started', timestamp: stepStart, tier, error: currentError })

        // Retry logic - use maxRetries if configured, otherwise use classification-based retries
        // If error is retryable (transient), use maxRetries; otherwise also use maxRetries
        // to allow configured retry behavior even for non-transient errors
        const maxAttempts = this.maxRetries
        let attempts = 0

        while (attempts < maxAttempts && !globalTimedOut) {
          attempts++

          if (attempts > 1) {
            // Wait before retry with exponential backoff
            const delay = classified.retryDelay
              ? classified.retryDelay * Math.pow(2, attempts - 2)
              : 100 * Math.pow(2, attempts - 2)
            await this.sleep(delay)
            this.emit({
              type: 'retry.attempt',
              timestamp: Date.now(),
              tier,
              metadata: { attempt: attempts },
            })
          }

          try {
            // Execute handler with optional timeout
            const handlerPromise = Promise.resolve().then(() => handler(currentError))

            let result: unknown
            if (tierTimeout) {
              result = await Promise.race([
                handlerPromise,
                this.createTimeout(tierTimeout, tier),
              ])
            } else if (globalTimeout) {
              // Use remaining global timeout for this tier
              const elapsed = Date.now() - startTime
              const remaining = Math.max(1, globalTimeout - elapsed)
              result = await Promise.race([
                handlerPromise,
                this.createTimeout(remaining, tier),
              ])
            } else {
              result = await handlerPromise
            }

            // Success!
            success = true
            stepResolution = result
            resolvedByTier = tier
            resolution = result

            this.circuitBreaker?.recordSuccess(tier)
            this.emit({ type: 'tier.succeeded', timestamp: Date.now(), tier, resolution: result })

            break
          } catch (err) {
            stepError = err instanceof Error ? err : new Error(String(err))
            currentError = stepError

            // If it's a timeout, emit specific event and check if it's the global timeout
            if (stepError.message.includes('timeout')) {
              this.emit({ type: 'tier.timeout', timestamp: Date.now(), tier, error: stepError })
              // If global timeout triggered, break out
              if (globalTimedOut) break
            }
          }
        }

        // Check global timeout again before recording step
        if (globalTimedOut && !success) {
          finalError = new Error(`Global escalation timeout after ${globalTimeout}ms`)
          exhausted = true
          break
        }

        // Record step - snapshot the error to preserve its state at this point
        const errorSnapshot = cloneError(success ? currentError : stepError ?? currentError)
        const step: EscalationStep = {
          id: `step-${++this.stepIdCounter}`,
          tier,
          error: errorSnapshot,
          classification: classified,
          timestamp: stepStart,
          duration: Date.now() - stepStart,
          success,
          resolution: stepResolution,
        }
        steps.push(step)
        await this.recordEscalation(step)

        if (success) {
          break
        } else {
          this.circuitBreaker?.recordFailure(tier)
          this.emit({ type: 'tier.failed', timestamp: Date.now(), tier, error: stepError })
          finalError = stepError
        }
      }

      // Check if exhausted (no tier resolved it)
      if (!resolvedByTier) {
        exhausted = true

        // Send to dead letter queue
        if (this.deadLetterHandler && finalError) {
          const chainResult: EscalationChainResult = {
            steps,
            finalError,
            exhausted: true,
            totalDuration: Date.now() - startTime,
          }
          await this.deadLetterHandler(finalError, chainResult)
        }
      }
    } catch (err) {
      // Global timeout or unexpected error
      finalError = err instanceof Error ? err : new Error(String(err))
      exhausted = true
    } finally {
      if (globalTimeoutId) {
        clearTimeout(globalTimeoutId)
      }
    }

    const result: EscalationChainResult = {
      steps,
      resolution,
      finalError,
      exhausted,
      totalDuration: Date.now() - startTime,
      resolvedByTier,
    }

    this.emit({
      type: 'escalation.completed',
      timestamp: Date.now(),
      resolution,
      metadata: { exhausted, resolvedByTier },
    })

    return result
  }

  getRecoveryStrategy(classified: ClassifiedError): RecoveryStrategy {
    const { classification, currentTier, retryable, maxRetries, retryDelay } = classified

    // Human tier has no further escalation
    if (currentTier === 'human') {
      return { type: 'dead-letter' }
    }

    // Transient errors -> retry
    if (classification === 'transient' && retryable) {
      return {
        type: 'retry',
        maxAttempts: maxRetries,
        backoffMs: retryDelay ?? 100,
      }
    }

    // Escalatable -> escalate
    if (classification === 'escalatable') {
      const nextTier = getNextTier(currentTier)
      return {
        type: 'escalate',
        fallbackTier: nextTier,
      }
    }

    // Permanent at lower tiers -> escalate
    if (classification === 'permanent' && currentTier !== 'human') {
      const nextTier = getNextTier(currentTier)
      if (nextTier) {
        return {
          type: 'escalate',
          fallbackTier: nextTier,
        }
      }
    }

    // Default: dead letter
    return { type: 'dead-letter' }
  }

  async recordEscalation(step: EscalationStep): Promise<void> {
    // Store in memory
    this.escalationStore.push(step)

    // Store in graph
    try {
      await this.graph.createNode(
        'Escalation',
        {
          tier: step.tier,
          success: step.success,
          duration: step.duration,
          errorMessage: step.error.message,
          errorCode: extractErrorCode(step.error),
          classification: step.classification.classification,
          severity: step.classification.severity,
          context: extractErrorContext(step.error) ?? step.classification.context,
          httpStatus: extractStatus(step.error),
        },
        { id: `escalation-${step.id}` }
      )

      // Create edge to previous step if exists
      const prevStep = this.escalationStore[this.escalationStore.length - 2]
      if (prevStep && !prevStep.success) {
        await this.graph.createEdge(
          `escalation-${prevStep.id}`,
          'ESCALATED_TO',
          `escalation-${step.id}`,
          { timestamp: step.timestamp }
        )
      }
    } catch {
      // Ignore graph errors - the step was already recorded in memory
    }
  }

  async queryEscalations(options: EscalationQueryOptions = {}): Promise<EscalationStep[]> {
    let results = [...this.escalationStore]

    if (options.tier) {
      results = results.filter((s) => s.tier === options.tier)
    }

    if (options.classification) {
      results = results.filter((s) => s.classification.classification === options.classification)
    }

    if (options.since) {
      results = results.filter((s) => s.timestamp >= options.since!)
    }

    if (options.limit) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  getCircuitState(tier: CapabilityTier): CircuitState {
    if (!this.circuitBreaker) {
      return CircuitState.CLOSED
    }
    return this.circuitBreaker.getState(tier)
  }

  async getMetrics(): Promise<EscalationMetrics> {
    const steps = this.escalationStore

    // Group steps by escalation chain (consecutive steps)
    const chains: EscalationStep[][] = []
    let currentChain: EscalationStep[] = []

    for (const step of steps) {
      if (currentChain.length === 0 || !currentChain[currentChain.length - 1]?.success) {
        currentChain.push(step)
      } else {
        chains.push(currentChain)
        currentChain = [step]
      }
      if (step.success) {
        chains.push(currentChain)
        currentChain = []
      }
    }
    if (currentChain.length > 0) {
      chains.push(currentChain)
    }

    const resolvedAtTier: Record<CapabilityTier, number> = {
      code: 0,
      generative: 0,
      agentic: 0,
      human: 0,
    }

    let exhaustedCount = 0
    let totalDepth = 0
    let totalDuration = 0

    for (const chain of chains) {
      const successStep = chain.find((s) => s.success)
      if (successStep) {
        resolvedAtTier[successStep.tier]++
      } else {
        exhaustedCount++
      }
      totalDepth += chain.length
      totalDuration += chain.reduce((sum, s) => sum + s.duration, 0)
    }

    return {
      totalEscalations: chains.length,
      resolvedAtTier,
      exhaustedCount,
      averageEscalationDepth: chains.length > 0 ? totalDepth / chains.length : 0,
      averageDuration: chains.length > 0 ? totalDuration / chains.length : 0,
    }
  }

  private emit(event: EscalationEvent): void {
    if (this.onEscalation) {
      this.onEscalation(event)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private createTimeout(ms: number, tier: CapabilityTier): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tier ${tier} timeout after ${ms}ms`))
      }, ms)
    })
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const obj = error as Record<string, unknown>
  if (typeof obj.code === 'string') return obj.code
  if (typeof obj.errorCode === 'string') return obj.errorCode
  return undefined
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const obj = error as Record<string, unknown>
  if (typeof obj.status === 'number') return obj.status
  if (typeof obj.statusCode === 'number') return obj.statusCode
  return undefined
}

function extractErrorContext(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined
  const obj = error as Record<string, unknown>
  if (obj.context && typeof obj.context === 'object') {
    return obj.context as Record<string, unknown>
  }
  return undefined
}

/**
 * Clone an error to create a snapshot of its current state.
 * This is needed to preserve error state when the original error
 * may be mutated during escalation.
 */
function cloneError(error: Error): Error {
  const cloned = new Error(error.message)
  cloned.name = error.name
  cloned.stack = error.stack

  // Copy any additional properties from the original error
  const obj = error as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (key !== 'message' && key !== 'name' && key !== 'stack') {
      ;(cloned as Record<string, unknown>)[key] = obj[key]
    }
  }

  return cloned
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an error escalation engine.
 *
 * @param config - Engine configuration
 * @returns Escalation engine instance
 *
 * @example
 * ```typescript
 * const engine = createEscalationEngine({
 *   graph,
 *   db,
 *   maxRetries: 3,
 *   circuitBreaker: {
 *     failureThreshold: 3,
 *     cooldownPeriod: 5000,
 *   },
 * })
 *
 * const result = await engine.escalate(error, {
 *   handlers: {
 *     code: async (err) => tryAutoFix(err),
 *     generative: async (err) => tryAIFix(err),
 *     agentic: async (err) => tryAgentFix(err),
 *     human: async (err) => createTicket(err),
 *   },
 * })
 * ```
 */
export function createEscalationEngine(config: EscalationEngineConfig): ErrorEscalationEngine {
  return new EscalationEngineImpl(config)
}

// CircuitState is already exported inline with the enum definition
