/**
 * Error Escalation Chain Tests
 *
 * TDD RED Phase: Tests for error escalation chains that cascade errors
 * through capability tiers.
 *
 * Error Classification:
 * - Transient/Retryable: Network errors, rate limits, temporary failures
 * - Permanent/Non-retryable: Validation errors, auth failures, missing resources
 * - Escalatable: Errors that should be escalated to higher capability tiers
 * - Severity levels: low, medium, high, critical
 *
 * Escalation Path:
 * Code -> Generative -> Agentic -> Human
 *
 * Recovery Patterns:
 * - Retry with backoff
 * - Fallback to next tier
 * - Circuit breaker
 * - Dead letter queue
 *
 * Uses GraphEngine for integration - NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-ylnl8 - [RED] Error Escalation Chain Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine } from '../../db/graph'

// ============================================================================
// TYPES - Error Classification System
// ============================================================================

/**
 * Error severity levels
 */
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Error classification
 */
type ErrorClassification = 'transient' | 'permanent' | 'escalatable' | 'recoverable'

/**
 * Capability tier in the escalation chain
 */
type CapabilityTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Classified error with metadata
 */
interface ClassifiedError {
  /** Original error */
  error: Error
  /** Classification type */
  classification: ErrorClassification
  /** Severity level */
  severity: ErrorSeverity
  /** Whether this error is retryable */
  retryable: boolean
  /** Retry count before classification */
  retryCount: number
  /** Maximum retries before escalation */
  maxRetries: number
  /** Delay before retry in ms */
  retryDelay?: number
  /** Current capability tier */
  currentTier: CapabilityTier
  /** Next tier to escalate to (if escalatable) */
  nextTier?: CapabilityTier
  /** Reason for classification */
  reason: string
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Escalation step in the chain
 */
interface EscalationStep {
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
interface EscalationChainResult {
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
interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'circuit-breaker' | 'dead-letter' | 'escalate'
  maxAttempts?: number
  backoffMs?: number
  fallbackTier?: CapabilityTier
}

/**
 * Error escalation engine interface
 */
interface ErrorEscalationEngine {
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
}

interface EscalationOptions {
  /** Starting tier */
  startTier?: CapabilityTier
  /** Maximum tiers to try */
  maxTiers?: number
  /** Timeout per tier in ms */
  tierTimeout?: number
  /** Global timeout in ms */
  globalTimeout?: number
  /** Handler for each tier */
  handlers?: Partial<Record<CapabilityTier, (error: Error) => Promise<unknown>>>
}

interface EscalationQueryOptions {
  /** Filter by tier */
  tier?: CapabilityTier
  /** Filter by classification */
  classification?: ErrorClassification
  /** Filter by time range */
  since?: number
  /** Limit results */
  limit?: number
}

// ============================================================================
// TEST SUITE: Error Classification
// ============================================================================

describe('Error Escalation Chain', () => {
  let graph: GraphEngine
  let db: object

  beforeEach(() => {
    graph = new GraphEngine()
    db = { _testId: Math.random().toString(36).slice(2) }
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. Error Classification
  // ==========================================================================

  describe('Error Classification', () => {
    describe('Transient/Retryable Errors', () => {
      it('should classify network timeout as transient', async () => {
        const error = new Error('ETIMEDOUT: Connection timed out')

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('transient')
        expect(classified.retryable).toBe(true)
        expect(classified.severity).toBe('medium')
        expect(classified.maxRetries).toBeGreaterThan(0)
      })

      it('should classify rate limit (429) as transient', async () => {
        const error = Object.assign(new Error('Rate limit exceeded'), {
          status: 429,
          retryAfter: 5000,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('transient')
        expect(classified.retryable).toBe(true)
        expect(classified.retryDelay).toBe(5000)
      })

      it('should classify temporary service unavailable (503) as transient', async () => {
        const error = Object.assign(new Error('Service temporarily unavailable'), {
          status: 503,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('transient')
        expect(classified.retryable).toBe(true)
        expect(classified.severity).toBe('medium')
      })

      it('should classify database connection error as transient', async () => {
        const error = new Error('ECONNREFUSED: Could not connect to database')

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('transient')
        expect(classified.retryable).toBe(true)
      })
    })

    describe('Permanent/Non-retryable Errors', () => {
      it('should classify validation error as permanent', async () => {
        const error = Object.assign(new Error('Invalid email format'), {
          code: 'VALIDATION_ERROR',
          field: 'email',
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('permanent')
        expect(classified.retryable).toBe(false)
        expect(classified.nextTier).toBeUndefined()
      })

      it('should classify authentication failure (401) as permanent', async () => {
        const error = Object.assign(new Error('Unauthorized'), {
          status: 401,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('permanent')
        expect(classified.retryable).toBe(false)
        expect(classified.severity).toBe('high')
      })

      it('should classify resource not found (404) as permanent', async () => {
        const error = Object.assign(new Error('Resource not found'), {
          status: 404,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('permanent')
        expect(classified.retryable).toBe(false)
      })

      it('should classify forbidden (403) as permanent', async () => {
        const error = Object.assign(new Error('Access denied'), {
          status: 403,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.classification).toBe('permanent')
        expect(classified.retryable).toBe(false)
        expect(classified.severity).toBe('high')
      })
    })

    describe('Escalatable Errors', () => {
      it('should classify complex logic error as escalatable', async () => {
        const error = Object.assign(new Error('Complex decision required'), {
          code: 'COMPLEX_LOGIC',
          context: { decision: 'ambiguous-input' },
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error, { currentTier: 'code' })

        expect(classified.classification).toBe('escalatable')
        expect(classified.nextTier).toBe('generative')
      })

      it('should classify AI model failure as escalatable to agentic', async () => {
        const error = Object.assign(new Error('Model could not generate valid response'), {
          code: 'MODEL_FAILURE',
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error, { currentTier: 'generative' })

        expect(classified.classification).toBe('escalatable')
        expect(classified.nextTier).toBe('agentic')
      })

      it('should classify agent failure as escalatable to human', async () => {
        const error = Object.assign(new Error('Agent exhausted all tools'), {
          code: 'AGENT_EXHAUSTED',
          attemptedTools: ['search', 'analyze', 'synthesize'],
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error, { currentTier: 'agentic' })

        expect(classified.classification).toBe('escalatable')
        expect(classified.nextTier).toBe('human')
      })

      it('should mark human tier error as non-escalatable', async () => {
        const error = new Error('Human review failed')

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error, { currentTier: 'human' })

        expect(classified.nextTier).toBeUndefined()
        expect(classified.classification).not.toBe('escalatable')
      })
    })

    describe('Severity Levels', () => {
      it('should assign low severity to informational errors', async () => {
        const error = Object.assign(new Error('Optional feature unavailable'), {
          code: 'FEATURE_UNAVAILABLE',
          optional: true,
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.severity).toBe('low')
      })

      it('should assign medium severity to recoverable errors', async () => {
        const error = new Error('Temporary processing delay')

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.severity).toBe('medium')
      })

      it('should assign high severity to security-related errors', async () => {
        const error = Object.assign(new Error('Security violation detected'), {
          code: 'SECURITY_VIOLATION',
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.severity).toBe('high')
      })

      it('should assign critical severity to data integrity errors', async () => {
        const error = Object.assign(new Error('Data corruption detected'), {
          code: 'DATA_CORRUPTION',
        })

        const { classifyError } = await import('../errors/error-classifier')
        const classified = classifyError(error)

        expect(classified.severity).toBe('critical')
      })
    })
  })

  // ==========================================================================
  // 2. Escalation Path
  // ==========================================================================

  describe('Escalation Path', () => {
    it('should escalate from code to generative tier', async () => {
      const error = new Error('Code handler cannot process this input')

      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(error, {
        startTier: 'code',
        handlers: {
          code: async () => { throw error },
          generative: async () => 'resolved by AI',
        },
      })

      expect(result.exhausted).toBe(false)
      expect(result.resolvedByTier).toBe('generative')
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0]?.tier).toBe('code')
      expect(result.steps[0]?.success).toBe(false)
      expect(result.steps[1]?.tier).toBe('generative')
      expect(result.steps[1]?.success).toBe(true)
    })

    it('should escalate from generative to agentic tier', async () => {
      const codeError = new Error('Code cannot handle')
      const genError = new Error('AI model failed')

      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(codeError, {
        startTier: 'code',
        handlers: {
          code: async () => { throw codeError },
          generative: async () => { throw genError },
          agentic: async () => 'resolved by agent',
        },
      })

      expect(result.resolvedByTier).toBe('agentic')
      expect(result.steps).toHaveLength(3)
    })

    it('should escalate from agentic to human tier', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        startTier: 'code',
        handlers: {
          code: async () => { throw new Error('code failed') },
          generative: async () => { throw new Error('gen failed') },
          agentic: async () => { throw new Error('agent failed') },
          human: async () => 'resolved by human',
        },
      })

      expect(result.resolvedByTier).toBe('human')
      expect(result.steps).toHaveLength(4)
      expect(result.steps[3]?.tier).toBe('human')
      expect(result.steps[3]?.success).toBe(true)
    })

    it('should mark chain as exhausted when human tier fails', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        startTier: 'code',
        handlers: {
          code: async () => { throw new Error('code failed') },
          generative: async () => { throw new Error('gen failed') },
          agentic: async () => { throw new Error('agent failed') },
          human: async () => { throw new Error('human failed too') },
        },
      })

      expect(result.exhausted).toBe(true)
      expect(result.resolvedByTier).toBeUndefined()
      expect(result.finalError).toBeDefined()
      expect(result.finalError?.message).toBe('human failed too')
    })

    it('should skip to specific tier when configured', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        startTier: 'agentic', // Skip code and generative
        handlers: {
          agentic: async () => 'resolved immediately',
        },
      })

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0]?.tier).toBe('agentic')
      expect(result.resolvedByTier).toBe('agentic')
    })

    it('should record timing for each escalation step', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => {
            await new Promise(r => setTimeout(r, 10))
            throw new Error('slow failure')
          },
          generative: async () => 'success',
        },
      })

      expect(result.steps[0]?.duration).toBeGreaterThanOrEqual(10)
      expect(result.totalDuration).toBeGreaterThan(0)
      expect(result.steps[0]?.timestamp).toBeDefined()
    })
  })

  // ==========================================================================
  // 3. Recovery Patterns
  // ==========================================================================

  describe('Recovery Patterns', () => {
    describe('Retry with Backoff', () => {
      it('should retry transient errors with exponential backoff', async () => {
        let attempts = 0
        const error = Object.assign(new Error('Temporary failure'), {
          code: 'TRANSIENT',
        })

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({ graph, db })

        const result = await engine.escalate(error, {
          handlers: {
            code: async () => {
              attempts++
              if (attempts < 3) throw error
              return 'success after retry'
            },
          },
        })

        expect(attempts).toBe(3)
        expect(result.resolution).toBe('success after retry')
      })

      it('should respect retry delay from classified error', async () => {
        vi.useFakeTimers()

        const error = Object.assign(new Error('Rate limited'), {
          status: 429,
          retryAfter: 1000,
        })
        let callTimes: number[] = []

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({ graph, db })

        const promise = engine.escalate(error, {
          handlers: {
            code: async () => {
              callTimes.push(Date.now())
              if (callTimes.length < 2) throw error
              return 'success'
            },
          },
        })

        // Advance time to trigger retry
        await vi.advanceTimersByTimeAsync(1000)
        await promise

        expect(callTimes).toHaveLength(2)
        expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1000)
      })

      it('should stop retrying after max attempts', async () => {
        let attempts = 0
        const error = new Error('Always fails')

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          maxRetries: 3,
        })

        const result = await engine.escalate(error, {
          handlers: {
            code: async () => {
              attempts++
              throw error
            },
          },
        })

        expect(attempts).toBe(3)
        expect(result.steps[0]?.success).toBe(false)
      })
    })

    describe('Fallback to Next Tier', () => {
      it('should fallback when retries exhausted', async () => {
        const transientError = Object.assign(new Error('Keeps failing'), {
          code: 'TRANSIENT',
        })

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          maxRetries: 2,
        })

        const result = await engine.escalate(transientError, {
          handlers: {
            code: async () => { throw transientError },
            generative: async () => 'fallback success',
          },
        })

        expect(result.resolvedByTier).toBe('generative')
      })

      it('should preserve error context through fallback chain', async () => {
        const originalError = Object.assign(new Error('Original failure'), {
          context: { orderId: '123', userId: 'abc' },
        })

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({ graph, db })

        const result = await engine.escalate(originalError, {
          handlers: {
            code: async () => { throw originalError },
            generative: async (err) => {
              // Handler should receive error with context
              expect((err as any).context).toEqual({ orderId: '123', userId: 'abc' })
              return 'handled with context'
            },
          },
        })

        expect(result.resolution).toBe('handled with context')
      })
    })

    describe('Circuit Breaker', () => {
      it('should open circuit after consecutive failures', async () => {
        const { createEscalationEngine, CircuitState } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          circuitBreaker: {
            failureThreshold: 3,
            cooldownPeriod: 5000,
          },
        })

        // Fail 3 times to open circuit
        for (let i = 0; i < 3; i++) {
          await engine.escalate(new Error('Failure'), {
            handlers: {
              code: async () => { throw new Error('Failure') },
            },
          }).catch(() => {})
        }

        const state = engine.getCircuitState('code')
        expect(state).toBe(CircuitState.OPEN)
      })

      it('should fast-fail when circuit is open', async () => {
        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          circuitBreaker: {
            failureThreshold: 1,
            cooldownPeriod: 5000,
          },
        })

        // Trip the circuit
        await engine.escalate(new Error('Failure'), {
          handlers: { code: async () => { throw new Error() } },
        }).catch(() => {})

        // Next call should fast-fail
        const start = Date.now()
        const result = await engine.escalate(new Error('Test'), {
          handlers: {
            code: async () => {
              await new Promise(r => setTimeout(r, 100))
              return 'success'
            },
            generative: async () => 'fallback',
          },
        })

        // Should skip code tier and go to generative
        expect(Date.now() - start).toBeLessThan(50) // Fast-failed
        expect(result.resolvedByTier).toBe('generative')
      })

      it('should half-open after cooldown period', async () => {
        const { createEscalationEngine, CircuitState } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          circuitBreaker: {
            failureThreshold: 1,
            cooldownPeriod: 50, // Short cooldown for testing
          },
        })

        // Trip the circuit
        await engine.escalate(new Error('Failure'), {
          handlers: { code: async () => { throw new Error() } },
        }).catch(() => {})

        expect(engine.getCircuitState('code')).toBe(CircuitState.OPEN)

        // Wait past cooldown period (real time)
        await new Promise(resolve => setTimeout(resolve, 60))

        expect(engine.getCircuitState('code')).toBe(CircuitState.HALF_OPEN)
      })

      it('should close circuit after successful request in half-open', async () => {
        const { createEscalationEngine, CircuitState } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          circuitBreaker: {
            failureThreshold: 1,
            cooldownPeriod: 50, // Short cooldown for testing
            successThreshold: 1,
          },
        })

        // Trip the circuit
        await engine.escalate(new Error('Failure'), {
          handlers: { code: async () => { throw new Error() } },
        }).catch(() => {})

        // Wait for half-open (real time)
        await new Promise(resolve => setTimeout(resolve, 60))

        expect(engine.getCircuitState('code')).toBe(CircuitState.HALF_OPEN)

        // Successful request
        await engine.escalate(new Error('Test'), {
          handlers: { code: async () => 'success' },
        })

        expect(engine.getCircuitState('code')).toBe(CircuitState.CLOSED)
      })
    })

    describe('Dead Letter Queue', () => {
      it('should send to dead letter queue when chain exhausted', async () => {
        const deadLetterItems: unknown[] = []

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          deadLetterHandler: async (error, chain) => {
            deadLetterItems.push({ error, chain })
          },
        })

        await engine.escalate(new Error('Unrecoverable'), {
          handlers: {
            code: async () => { throw new Error('code') },
            generative: async () => { throw new Error('gen') },
            agentic: async () => { throw new Error('agent') },
            human: async () => { throw new Error('human') },
          },
        })

        expect(deadLetterItems).toHaveLength(1)
        expect((deadLetterItems[0] as any).error.message).toBe('human')
      })

      it('should include full escalation history in dead letter', async () => {
        let dlqData: unknown = null

        const { createEscalationEngine } = await import('../errors/escalation-engine')
        const engine = createEscalationEngine({
          graph,
          db,
          deadLetterHandler: async (error, chain) => {
            dlqData = chain
          },
        })

        await engine.escalate(new Error('Test'), {
          handlers: {
            code: async () => { throw new Error('code fail') },
            generative: async () => { throw new Error('gen fail') },
            agentic: async () => { throw new Error('agent fail') },
            human: async () => { throw new Error('human fail') },
          },
        })

        expect(dlqData).toBeDefined()
        expect((dlqData as EscalationChainResult).steps).toHaveLength(4)
        expect((dlqData as EscalationChainResult).exhausted).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 4. Escalation Engine
  // ==========================================================================

  describe('Escalation Engine', () => {
    it('should create escalation engine with graph integration', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      expect(engine).toBeDefined()
      expect(typeof engine.escalate).toBe('function')
      expect(typeof engine.classify).toBe('function')
      expect(typeof engine.getRecoveryStrategy).toBe('function')
    })

    it('should get recovery strategy for classified error', async () => {
      const { createEscalationEngine, classifyError } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const transientError = Object.assign(new Error('Temporary'), { status: 503 })
      const classified = classifyError(transientError)

      const strategy = engine.getRecoveryStrategy(classified)

      expect(strategy.type).toBe('retry')
      expect(strategy.maxAttempts).toBeGreaterThan(0)
      expect(strategy.backoffMs).toBeGreaterThan(0)
    })

    it('should get escalate strategy for permanent errors at lower tiers', async () => {
      const { createEscalationEngine, classifyError } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const complexError = Object.assign(new Error('Needs AI'), { code: 'COMPLEX_LOGIC' })
      const classified = classifyError(complexError, { currentTier: 'code' })

      const strategy = engine.getRecoveryStrategy(classified)

      expect(strategy.type).toBe('escalate')
      expect(strategy.fallbackTier).toBe('generative')
    })

    it('should get dead-letter strategy for exhausted human tier', async () => {
      const { createEscalationEngine, classifyError } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const error = new Error('Human could not resolve')
      const classified = classifyError(error, { currentTier: 'human' })

      const strategy = engine.getRecoveryStrategy(classified)

      expect(strategy.type).toBe('dead-letter')
    })

    it('should emit events during escalation', async () => {
      const events: unknown[] = []

      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({
        graph,
        db,
        onEscalation: (event) => events.push(event),
      })

      await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => { throw new Error('fail') },
          generative: async () => 'success',
        },
      })

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e: any) => e.type === 'escalation.started')).toBe(true)
      expect(events.some((e: any) => e.type === 'tier.failed')).toBe(true)
      expect(events.some((e: any) => e.type === 'tier.succeeded')).toBe(true)
      expect(events.some((e: any) => e.type === 'escalation.completed')).toBe(true)
    })

    it('should respect global timeout', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const start = Date.now()
      const result = await engine.escalate(new Error('Test'), {
        globalTimeout: 100,
        handlers: {
          code: async () => {
            await new Promise(r => setTimeout(r, 500))
            return 'too slow'
          },
        },
      })

      expect(Date.now() - start).toBeLessThan(200)
      expect(result.exhausted).toBe(true)
      expect(result.finalError?.message).toContain('timeout')
    })

    it('should respect per-tier timeout', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        tierTimeout: 50,
        handlers: {
          code: async () => {
            await new Promise(r => setTimeout(r, 100))
            return 'too slow'
          },
          generative: async () => 'fast enough',
        },
      })

      expect(result.resolvedByTier).toBe('generative')
      expect(result.steps[0]?.success).toBe(false)
    })
  })

  // ==========================================================================
  // 5. Graph Integration
  // ==========================================================================

  describe('Graph Integration', () => {
    it('should record escalation steps in graph', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => { throw new Error('code fail') },
          generative: async () => 'success',
        },
      })

      // Query the graph for escalation nodes
      const escalationNodes = await graph.queryNodes({ label: 'Escalation' })
      expect(escalationNodes.length).toBeGreaterThan(0)
    })

    it('should create edges between escalation steps', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => { throw new Error('fail') },
          generative: async () => { throw new Error('fail') },
          agentic: async () => 'success',
        },
      })

      const edges = await graph.queryEdges({ type: 'ESCALATED_TO' })
      expect(edges.length).toBeGreaterThanOrEqual(2) // code->gen, gen->agentic
    })

    it('should query escalation history by tier', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      // Run multiple escalations
      await engine.escalate(new Error('Test1'), {
        handlers: {
          code: async () => 'success1',
        },
      })
      await engine.escalate(new Error('Test2'), {
        handlers: {
          code: async () => { throw new Error() },
          generative: async () => 'success2',
        },
      })

      const codeEscalations = await engine.queryEscalations({ tier: 'code' })
      const genEscalations = await engine.queryEscalations({ tier: 'generative' })

      expect(codeEscalations.length).toBe(2) // Both started at code
      expect(genEscalations.length).toBe(1) // Only one escalated to generative
    })

    it('should query escalation history by classification', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const transientError = Object.assign(new Error('Temp'), { status: 503 })
      const permanentError = Object.assign(new Error('Perm'), { status: 404 })

      await engine.escalate(transientError, {
        handlers: { code: async () => { throw transientError } },
      }).catch(() => {})

      await engine.escalate(permanentError, {
        handlers: { code: async () => { throw permanentError } },
      }).catch(() => {})

      const transientHistory = await engine.queryEscalations({
        classification: 'transient'
      })
      const permanentHistory = await engine.queryEscalations({
        classification: 'permanent'
      })

      expect(transientHistory.length).toBeGreaterThanOrEqual(1)
      expect(permanentHistory.length).toBeGreaterThanOrEqual(1)
    })

    it('should traverse escalation chain through graph', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => { throw new Error('code') },
          generative: async () => { throw new Error('gen') },
          agentic: async () => 'resolved',
        },
      })

      // Get the starting escalation node
      const startNodes = await graph.queryNodes({
        label: 'Escalation',
        where: { tier: 'code' },
      })

      expect(startNodes.length).toBeGreaterThan(0)

      // Traverse to find the full chain
      const result = await graph.traverse({
        start: startNodes[0]!,
        direction: 'OUTGOING',
        maxDepth: 5,
        filter: { type: 'ESCALATED_TO' },
      })

      // Should have traversed through gen to agentic
      expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    })

    it('should store error details in graph node properties', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const detailedError = Object.assign(new Error('Detailed failure'), {
        code: 'SPECIAL_ERROR',
        context: { userId: '123', action: 'purchase' },
        status: 500,
      })

      await engine.escalate(detailedError, {
        handlers: {
          code: async () => { throw detailedError },
        },
      }).catch(() => {})

      const nodes = await graph.queryNodes({ label: 'Escalation' })
      const errorNode = nodes.find(n => n.properties.errorCode === 'SPECIAL_ERROR')

      expect(errorNode).toBeDefined()
      expect(errorNode?.properties.errorMessage).toBe('Detailed failure')
      expect(errorNode?.properties.context).toEqual({ userId: '123', action: 'purchase' })
      expect(errorNode?.properties.httpStatus).toBe(500)
    })

    it('should calculate escalation metrics from graph', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      // Run several escalations with different outcomes
      await engine.escalate(new Error('1'), {
        handlers: { code: async () => 'success' },
      })
      await engine.escalate(new Error('2'), {
        handlers: {
          code: async () => { throw new Error() },
          generative: async () => 'success',
        },
      })
      await engine.escalate(new Error('3'), {
        handlers: {
          code: async () => { throw new Error() },
          generative: async () => { throw new Error() },
          agentic: async () => 'success',
        },
      })

      const metrics = await engine.getMetrics()

      expect(metrics.totalEscalations).toBe(3)
      expect(metrics.resolvedAtTier.code).toBe(1)
      expect(metrics.resolvedAtTier.generative).toBe(1)
      expect(metrics.resolvedAtTier.agentic).toBe(1)
      expect(metrics.averageEscalationDepth).toBeCloseTo(2, 1) // (1+2+3)/3 = 2
    })
  })

  // ==========================================================================
  // 6. Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle synchronous errors in handlers', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        handlers: {
          code: () => { throw new Error('sync error') },
          generative: async () => 'async success',
        },
      })

      expect(result.resolvedByTier).toBe('generative')
    })

    it('should handle errors that mutate during escalation', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      let mutatingError = new Error('Initial')

      const result = await engine.escalate(mutatingError, {
        handlers: {
          code: async () => {
            mutatingError.message = 'Mutated in code'
            throw mutatingError
          },
          generative: async () => {
            mutatingError.message = 'Mutated in gen'
            throw mutatingError
          },
          agentic: async () => mutatingError.message,
        },
      })

      // Each step should have captured the error at that point
      expect(result.steps[0]?.error.message).toBe('Mutated in code')
      expect(result.steps[1]?.error.message).toBe('Mutated in gen')
    })

    it('should handle null/undefined handler results', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        handlers: {
          code: async () => null,
        },
      })

      expect(result.resolvedByTier).toBe('code')
      expect(result.resolution).toBeNull()
    })

    it('should handle empty handler map', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const result = await engine.escalate(new Error('Test'), {
        handlers: {},
      })

      expect(result.exhausted).toBe(true)
      expect(result.steps).toHaveLength(0)
    })

    it('should handle concurrent escalations independently', async () => {
      const { createEscalationEngine } = await import('../errors/escalation-engine')
      const engine = createEscalationEngine({ graph, db })

      const results = await Promise.all([
        engine.escalate(new Error('Error1'), {
          handlers: { code: async () => 'result1' },
        }),
        engine.escalate(new Error('Error2'), {
          handlers: {
            code: async () => { throw new Error() },
            generative: async () => 'result2',
          },
        }),
        engine.escalate(new Error('Error3'), {
          handlers: {
            code: async () => { throw new Error() },
            generative: async () => { throw new Error() },
            agentic: async () => 'result3',
          },
        }),
      ])

      expect(results[0]?.resolvedByTier).toBe('code')
      expect(results[1]?.resolvedByTier).toBe('generative')
      expect(results[2]?.resolvedByTier).toBe('agentic')
    })
  })
})
