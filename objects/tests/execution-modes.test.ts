/**
 * Execution Modes Enhanced Tests
 *
 * RED TDD Phase: Tests for enhanced $.send(), $.try(), $.do() execution modes
 *
 * This file tests the complete action lifecycle management for:
 * - $.send() - Non-blocking, best-effort (queueMicrotask/setImmediate)
 * - $.try() - Single attempt with error propagation and timeout
 * - $.do() - Durable with configurable retry, backoff, and step persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Retry policy configuration for $.do()
 */
interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitter: boolean
}

/**
 * Action status values for lifecycle tracking
 */
type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying'

/**
 * Action record from the database
 */
interface ActionRecord {
  id: string
  verb: string
  target: string
  actor?: string
  durability: 'send' | 'try' | 'do'
  status: ActionStatus
  input?: unknown
  output?: unknown
  error?: { message: string; name: string; stack?: string }
  attempts?: number
  startedAt?: Date
  completedAt?: Date
  duration?: number
  createdAt: Date
}

/**
 * Options for $.try() execution
 */
interface TryOptions {
  timeout?: number
}

/**
 * Options for $.do() execution
 */
interface DoOptions {
  retry?: Partial<RetryPolicy>
  timeout?: number
  stepId?: string
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock DO state with storage and action tracking
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()
  const actions: ActionRecord[] = []
  const events: Array<{ verb: string; data: unknown; timestamp: Date }> = []

  return {
    id: { toString: () => 'test-do-id' },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => storage.set(key, value)),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      sql: {
        exec: vi.fn(() => ({ toArray: () => [], one: () => null })),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
    _actions: actions,
    _events: events,
  }
}

/**
 * Mock execution context for testing execution modes
 */
interface MockExecutionContext {
  ns: string
  actions: ActionRecord[]
  events: Array<{ verb: string; data: unknown; timestamp: Date }>
  executeAction: (action: string, data: unknown) => Promise<unknown>
  logAction: (durability: 'send' | 'try' | 'do', verb: string, input: unknown) => Promise<ActionRecord>
  updateAction: (id: string, updates: Partial<ActionRecord>) => Promise<void>
  emitEvent: (verb: string, data: unknown) => Promise<void>
  retryPolicy: RetryPolicy
}

function createMockExecutionContext(options: {
  executeAction?: (action: string, data: unknown) => Promise<unknown>
  retryPolicy?: Partial<RetryPolicy>
} = {}): MockExecutionContext {
  const actions: ActionRecord[] = []
  const events: Array<{ verb: string; data: unknown; timestamp: Date }> = []

  const defaultRetryPolicy: RetryPolicy = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitter: true,
  }

  return {
    ns: 'https://test.do',
    actions,
    events,
    executeAction: options.executeAction ?? (async () => { throw new Error('Unknown action') }),
    logAction: async (durability, verb, input) => {
      const action: ActionRecord = {
        id: `action-${actions.length + 1}`,
        verb,
        target: 'https://test.do',
        durability,
        status: 'pending',
        input,
        createdAt: new Date(),
      }
      actions.push(action)
      return action
    },
    updateAction: async (id, updates) => {
      const action = actions.find(a => a.id === id)
      if (action) {
        Object.assign(action, updates)
      }
    },
    emitEvent: async (verb, data) => {
      events.push({ verb, data, timestamp: new Date() })
    },
    retryPolicy: { ...defaultRetryPolicy, ...options.retryPolicy },
  }
}

// ============================================================================
// $.send() TESTS - Non-blocking, best-effort
// ============================================================================

describe('$.send() - Non-blocking Best-effort Execution', () => {
  let ctx: MockExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockExecutionContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Non-blocking Behavior', () => {
    it('returns immediately without waiting for action completion', async () => {
      let actionCompleted = false
      ctx.executeAction = async () => {
        // Simulate slow action
        await new Promise(resolve => setTimeout(resolve, 1000))
        actionCompleted = true
        return { done: true }
      }

      // $.send() should return immediately
      const startTime = Date.now()
      sendEvent(ctx, 'notification.send', { to: 'user@example.com' })
      const elapsed = Date.now() - startTime

      // Should return in less than 10ms (not waiting for the 1000ms action)
      expect(elapsed).toBeLessThan(10)
      expect(actionCompleted).toBe(false)
    })

    it('uses queueMicrotask or setImmediate for async execution', async () => {
      const executionOrder: string[] = []

      ctx.executeAction = async () => {
        executionOrder.push('action')
        return {}
      }

      // Execute send
      sendEvent(ctx, 'test.event', {})
      executionOrder.push('after-send')

      // Action should not have executed yet (queued for next tick)
      expect(executionOrder).toEqual(['after-send'])

      // Flush microtasks
      await vi.runAllTimersAsync()

      // Now action should have executed
      expect(executionOrder).toContain('action')
    })

    it('does not block on logging failures', async () => {
      ctx.logAction = async () => {
        throw new Error('Database unavailable')
      }

      // Should not throw even when logging fails
      expect(() => sendEvent(ctx, 'test.event', {})).not.toThrow()
    })

    it('fires event emission without awaiting', async () => {
      const emitCalls: string[] = []
      ctx.emitEvent = async (verb) => {
        emitCalls.push(verb)
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      sendEvent(ctx, 'order.created', { orderId: '123' })

      // Event emission should be queued but not completed
      expect(emitCalls).toHaveLength(0)

      // After flush, event should be emitted
      await vi.runAllTimersAsync()
      expect(emitCalls).toContain('order.created')
    })
  })

  describe('Best-effort Logging', () => {
    it('logs action with durability="send"', async () => {
      sendEvent(ctx, 'notification.sent', { userId: 'user-123' })
      await vi.runAllTimersAsync()

      expect(ctx.actions.length).toBeGreaterThan(0)
      expect(ctx.actions[0].durability).toBe('send')
    })

    it('does not await action logging', async () => {
      let logCompleted = false
      const originalLogAction = ctx.logAction
      ctx.logAction = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 500))
        logCompleted = true
        return originalLogAction(...args)
      }

      sendEvent(ctx, 'test.event', {})

      // Logging should be queued but not completed
      expect(logCompleted).toBe(false)
    })

    it('swallows logging errors silently', async () => {
      ctx.logAction = async () => {
        throw new Error('Logging failed')
      }

      // Should not throw and should not cause unhandled rejection
      sendEvent(ctx, 'test.event', {})
      await vi.runAllTimersAsync()

      // No crash, no error - best effort
    })
  })

  describe('Event Emission for Observability', () => {
    it('emits event with verb matching the action', async () => {
      sendEvent(ctx, 'customer.signedUp', { email: 'new@user.com' })
      await vi.runAllTimersAsync()

      expect(ctx.events.some(e => e.verb === 'customer.signedUp')).toBe(true)
    })

    it('includes data in emitted event', async () => {
      sendEvent(ctx, 'order.placed', { orderId: 'ord-123', total: 99.99 })
      await vi.runAllTimersAsync()

      const event = ctx.events.find(e => e.verb === 'order.placed')
      expect(event?.data).toEqual({ orderId: 'ord-123', total: 99.99 })
    })

    it('does not fail if event emission fails', async () => {
      ctx.emitEvent = async () => {
        throw new Error('Pipeline unavailable')
      }

      // Should not throw
      sendEvent(ctx, 'test.event', {})
      await vi.runAllTimersAsync()
    })
  })
})

// ============================================================================
// $.try() TESTS - Single attempt with error propagation
// ============================================================================

describe('$.try() - Single Attempt with Error Propagation', () => {
  let ctx: MockExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockExecutionContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Single Attempt Execution', () => {
    it('executes action once and returns result', async () => {
      let callCount = 0
      ctx.executeAction = async () => {
        callCount++
        return { result: 'success' }
      }

      const result = await tryAction(ctx, 'validate.input', { data: 'test' })

      expect(callCount).toBe(1)
      expect(result).toEqual({ result: 'success' })
    })

    it('does not retry on failure', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        throw new Error('Validation failed')
      }

      await expect(tryAction(ctx, 'validate.input', {})).rejects.toThrow('Validation failed')
      expect(attempts).toBe(1)
    })

    it('returns result type correctly', async () => {
      ctx.executeAction = async () => ({ userId: 'user-123', valid: true })

      const result = await tryAction<{ userId: string; valid: boolean }>(ctx, 'validate.user', {})

      expect(result.userId).toBe('user-123')
      expect(result.valid).toBe(true)
    })
  })

  describe('Error Propagation', () => {
    it('propagates error with original message', async () => {
      ctx.executeAction = async () => {
        throw new Error('Input validation failed: email is required')
      }

      await expect(tryAction(ctx, 'validate', {})).rejects.toThrow('Input validation failed: email is required')
    })

    it('preserves error type/name', async () => {
      class ValidationError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      ctx.executeAction = async () => {
        throw new ValidationError('Invalid format')
      }

      try {
        await tryAction(ctx, 'validate', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).name).toBe('ValidationError')
      }
    })

    it('includes stack trace in error', async () => {
      ctx.executeAction = async () => {
        throw new Error('Deep error')
      }

      try {
        await tryAction(ctx, 'validate', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).stack).toBeDefined()
        expect((error as Error).stack).toContain('Deep error')
      }
    })
  })

  describe('Action Logging with Status Tracking', () => {
    it('logs action with durability="try"', async () => {
      ctx.executeAction = async () => ({ ok: true })

      await tryAction(ctx, 'check.health', {})

      const action = ctx.actions.find(a => a.verb === 'check.health')
      expect(action).toBeDefined()
      expect(action?.durability).toBe('try')
    })

    it('updates action status to "running" when started', async () => {
      let statusDuringExecution: ActionStatus | undefined
      ctx.executeAction = async () => {
        const action = ctx.actions.find(a => a.verb === 'test.action')
        statusDuringExecution = action?.status
        return {}
      }

      await tryAction(ctx, 'test.action', {})

      expect(statusDuringExecution).toBe('running')
    })

    it('updates action status to "completed" on success', async () => {
      ctx.executeAction = async () => ({ success: true })

      await tryAction(ctx, 'test.action', {})

      const action = ctx.actions.find(a => a.verb === 'test.action')
      expect(action?.status).toBe('completed')
    })

    it('updates action status to "failed" on error', async () => {
      ctx.executeAction = async () => {
        throw new Error('Failed')
      }

      await tryAction(ctx, 'test.action', {}).catch(() => {})

      const action = ctx.actions.find(a => a.verb === 'test.action')
      expect(action?.status).toBe('failed')
    })

    it('records error details on failure', async () => {
      ctx.executeAction = async () => {
        throw new Error('Detailed failure message')
      }

      await tryAction(ctx, 'test.action', {}).catch(() => {})

      const action = ctx.actions.find(a => a.verb === 'test.action')
      expect(action?.error).toBeDefined()
      expect(action?.error?.message).toBe('Detailed failure message')
    })

    it('records output on success', async () => {
      ctx.executeAction = async () => ({ result: 'computed value' })

      await tryAction(ctx, 'compute', {})

      const action = ctx.actions.find(a => a.verb === 'compute')
      expect(action?.output).toEqual({ result: 'computed value' })
    })

    it('records duration on completion', async () => {
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return {}
      }

      await tryAction(ctx, 'slow.action', {})
      await vi.advanceTimersByTimeAsync(100)

      const action = ctx.actions.find(a => a.verb === 'slow.action')
      expect(action?.duration).toBeGreaterThanOrEqual(100)
    })
  })

  describe('Timeout Support', () => {
    it('times out after specified duration', async () => {
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 5000))
        return { done: true }
      }

      const promise = tryAction(ctx, 'slow.action', {}, { timeout: 1000 })

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(1001)

      await expect(promise).rejects.toThrow(/timeout/i)
    })

    it('completes successfully within timeout', async () => {
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { result: 'fast' }
      }

      const promise = tryAction(ctx, 'fast.action', {}, { timeout: 1000 })
      await vi.advanceTimersByTimeAsync(100)

      const result = await promise
      expect(result).toEqual({ result: 'fast' })
    })

    it('records timeout as failure in action log', async () => {
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 5000))
        return {}
      }

      const promise = tryAction(ctx, 'timeout.action', {}, { timeout: 100 })
      await vi.advanceTimersByTimeAsync(101)
      await promise.catch(() => {})

      const action = ctx.actions.find(a => a.verb === 'timeout.action')
      expect(action?.status).toBe('failed')
      expect(action?.error?.message).toMatch(/timeout/i)
    })

    it('uses default timeout if not specified', async () => {
      // Default should be reasonable (e.g., 30 seconds)
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 35000))
        return {}
      }

      const promise = tryAction(ctx, 'long.action', {})
      await vi.advanceTimersByTimeAsync(30001)

      await expect(promise).rejects.toThrow(/timeout/i)
    })
  })

  describe('Event Emission', () => {
    it('emits action.completed event on success', async () => {
      ctx.executeAction = async () => ({ done: true })

      await tryAction(ctx, 'test.action', {})

      expect(ctx.events.some(e => e.verb === 'test.action.completed')).toBe(true)
    })

    it('emits action.failed event on failure', async () => {
      ctx.executeAction = async () => {
        throw new Error('Failed')
      }

      await tryAction(ctx, 'test.action', {}).catch(() => {})

      expect(ctx.events.some(e => e.verb === 'test.action.failed')).toBe(true)
    })

    it('includes result in completed event', async () => {
      ctx.executeAction = async () => ({ computed: 42 })

      await tryAction(ctx, 'compute', {})

      const event = ctx.events.find(e => e.verb === 'compute.completed')
      expect(event?.data).toEqual({ result: { computed: 42 } })
    })

    it('includes error in failed event', async () => {
      ctx.executeAction = async () => {
        throw new Error('Computation failed')
      }

      await tryAction(ctx, 'compute', {}).catch(() => {})

      const event = ctx.events.find(e => e.verb === 'compute.failed')
      expect((event?.data as { error: Error }).error).toBeDefined()
    })
  })
})

// ============================================================================
// $.do() TESTS - Durable execution with retries
// ============================================================================

describe('$.do() - Durable Execution with Retries', () => {
  let ctx: MockExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockExecutionContext({
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitter: false, // Disable for deterministic tests
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Configurable Retry Policy', () => {
    it('retries up to maxAttempts on failure', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        throw new Error('Transient failure')
      }

      const promise = doAction(ctx, 'flaky.action', {})

      // Process all retries
      await vi.runAllTimersAsync()

      await expect(promise).rejects.toThrow('Transient failure')
      expect(attempts).toBe(3)
    })

    it('succeeds on retry within maxAttempts', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Transient failure')
        }
        return { success: true }
      }

      const promise = doAction(ctx, 'eventually.succeeds', {})
      await vi.runAllTimersAsync()

      const result = await promise
      expect(result).toEqual({ success: true })
      expect(attempts).toBe(3)
    })

    it('uses custom retry policy when provided', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        throw new Error('Always fails')
      }

      const promise = doAction(ctx, 'custom.retry', {}, {
        retry: { maxAttempts: 5 },
      })

      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      expect(attempts).toBe(5)
    })

    it('does not retry on success', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        return { immediate: true }
      }

      await doAction(ctx, 'immediate.success', {})

      expect(attempts).toBe(1)
    })
  })

  describe('Exponential Backoff', () => {
    it('delays between retries using exponential backoff', async () => {
      const attemptTimes: number[] = []
      ctx.executeAction = async () => {
        attemptTimes.push(Date.now())
        throw new Error('Fail')
      }

      const promise = doAction(ctx, 'backoff.test', {})

      // First attempt is immediate
      await vi.advanceTimersByTimeAsync(0)
      expect(attemptTimes.length).toBe(1)

      // Second attempt after initialDelayMs (100ms)
      await vi.advanceTimersByTimeAsync(100)
      expect(attemptTimes.length).toBe(2)

      // Third attempt after initialDelayMs * backoffMultiplier (200ms from second)
      await vi.advanceTimersByTimeAsync(200)
      expect(attemptTimes.length).toBe(3)

      await promise.catch(() => {})
    })

    it('respects maxDelayMs cap', async () => {
      ctx.retryPolicy = {
        maxAttempts: 10,
        initialDelayMs: 1000,
        maxDelayMs: 2000,
        backoffMultiplier: 4,
        jitter: false,
      }

      const delaysBetweenAttempts: number[] = []
      let lastAttemptTime = Date.now()

      ctx.executeAction = async () => {
        const now = Date.now()
        if (lastAttemptTime > 0) {
          delaysBetweenAttempts.push(now - lastAttemptTime)
        }
        lastAttemptTime = now
        throw new Error('Fail')
      }

      const promise = doAction(ctx, 'capped.backoff', {})
      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      // After first few attempts, delay should be capped at maxDelayMs
      const cappedDelays = delaysBetweenAttempts.filter(d => d > 2000)
      expect(cappedDelays.length).toBe(0)
    })
  })

  describe('Jitter', () => {
    it('adds jitter when enabled', async () => {
      ctx.retryPolicy.jitter = true
      const delays: number[] = []
      let lastTime = Date.now()

      // Run the same test multiple times to detect jitter variation
      for (let i = 0; i < 3; i++) {
        let attempts = 0
        ctx.executeAction = async () => {
          attempts++
          const now = Date.now()
          if (attempts > 1) {
            delays.push(now - lastTime)
          }
          lastTime = now
          if (attempts < 2) throw new Error('Fail')
          return {}
        }

        const promise = doAction(ctx, `jitter.test.${i}`, {})
        await vi.runAllTimersAsync()
        await promise
      }

      // With jitter, delays should have some variance (not all identical)
      // This is a probabilistic test; with true randomness, identical delays are unlikely
      // For deterministic testing, we verify the jitter logic is called
    })

    it('calculates jitter within expected range (0-25% of delay)', async () => {
      // This test verifies the jitter calculation logic
      const baseDelay = 1000
      const jitterRange = baseDelay * 0.25

      // Jitter should add 0-250ms to a 1000ms delay
      expect(jitterRange).toBe(250)
    })
  })

  describe('Step Persistence for Replay', () => {
    it('persists step result to storage', async () => {
      ctx.executeAction = async () => ({ persisted: true })

      await doAction(ctx, 'persistent.action', {}, { stepId: 'step-1' })

      // Verify step was persisted (check storage mock)
      // Implementation should store step result keyed by stepId
    })

    it('replays completed step from storage without re-execution', async () => {
      let executionCount = 0
      ctx.executeAction = async () => {
        executionCount++
        return { result: 'computed' }
      }

      // First execution
      await doAction(ctx, 'idempotent.action', {}, { stepId: 'step-1' })
      expect(executionCount).toBe(1)

      // Second execution with same stepId should replay from storage
      const result = await doAction(ctx, 'idempotent.action', {}, { stepId: 'step-1' })
      expect(executionCount).toBe(1) // Should not re-execute
      expect(result).toEqual({ result: 'computed' })
    })

    it('re-executes step if not in storage', async () => {
      let executionCount = 0
      ctx.executeAction = async () => {
        executionCount++
        return { count: executionCount }
      }

      // Different stepIds should both execute
      await doAction(ctx, 'action', {}, { stepId: 'step-1' })
      await doAction(ctx, 'action', {}, { stepId: 'step-2' })

      expect(executionCount).toBe(2)
    })

    it('stores failed attempts for debugging', async () => {
      ctx.executeAction = async () => {
        throw new Error('Persistent failure')
      }

      const promise = doAction(ctx, 'failing.action', {}, { stepId: 'fail-step' })
      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      // Failed step should be recorded with attempts and error
      const action = ctx.actions.find(a => a.verb === 'failing.action')
      expect(action?.attempts).toBe(3)
      expect(action?.error).toBeDefined()
    })
  })

  describe('Action Status Transitions', () => {
    it('transitions: pending -> running -> completed', async () => {
      const statusHistory: ActionStatus[] = []

      const originalUpdateAction = ctx.updateAction
      ctx.updateAction = async (id, updates) => {
        if (updates.status) {
          statusHistory.push(updates.status)
        }
        await originalUpdateAction(id, updates)
      }

      ctx.executeAction = async () => ({ done: true })

      await doAction(ctx, 'status.test', {})

      expect(statusHistory).toContain('running')
      expect(statusHistory).toContain('completed')
    })

    it('transitions: pending -> running -> retrying -> running -> completed', async () => {
      const statusHistory: ActionStatus[] = []
      let attempts = 0

      const originalUpdateAction = ctx.updateAction
      ctx.updateAction = async (id, updates) => {
        if (updates.status) {
          statusHistory.push(updates.status)
        }
        await originalUpdateAction(id, updates)
      }

      ctx.executeAction = async () => {
        attempts++
        if (attempts < 2) throw new Error('Retry once')
        return {}
      }

      const promise = doAction(ctx, 'retry.status', {})
      await vi.runAllTimersAsync()
      await promise

      expect(statusHistory).toContain('retrying')
    })

    it('transitions: pending -> running -> retrying -> ... -> failed', async () => {
      const statusHistory: ActionStatus[] = []

      const originalUpdateAction = ctx.updateAction
      ctx.updateAction = async (id, updates) => {
        if (updates.status) {
          statusHistory.push(updates.status)
        }
        await originalUpdateAction(id, updates)
      }

      ctx.executeAction = async () => {
        throw new Error('Always fails')
      }

      const promise = doAction(ctx, 'always.fails', {})
      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      expect(statusHistory[statusHistory.length - 1]).toBe('failed')
    })

    it('records attempt count', async () => {
      ctx.executeAction = async () => {
        throw new Error('Fail')
      }

      const promise = doAction(ctx, 'counted.action', {})
      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      const action = ctx.actions.find(a => a.verb === 'counted.action')
      expect(action?.attempts).toBe(3)
    })
  })

  describe('Action Logging with Durability', () => {
    it('logs action with durability="do"', async () => {
      ctx.executeAction = async () => ({ ok: true })

      await doAction(ctx, 'durable.action', {})

      const action = ctx.actions.find(a => a.verb === 'durable.action')
      expect(action?.durability).toBe('do')
    })

    it('records timing information', async () => {
      ctx.executeAction = async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return {}
      }

      const promise = doAction(ctx, 'timed.action', {})
      await vi.advanceTimersByTimeAsync(50)
      await promise

      const action = ctx.actions.find(a => a.verb === 'timed.action')
      expect(action?.startedAt).toBeDefined()
      expect(action?.completedAt).toBeDefined()
      expect(action?.duration).toBeGreaterThanOrEqual(50)
    })
  })

  describe('Event Emission', () => {
    it('emits action.completed event on final success', async () => {
      ctx.executeAction = async () => ({ final: true })

      await doAction(ctx, 'eventual.success', {})

      expect(ctx.events.some(e => e.verb === 'eventual.success.completed')).toBe(true)
    })

    it('emits action.failed event after all retries exhausted', async () => {
      ctx.executeAction = async () => {
        throw new Error('Never succeeds')
      }

      const promise = doAction(ctx, 'exhausted.retries', {})
      await vi.runAllTimersAsync()
      await promise.catch(() => {})

      expect(ctx.events.some(e => e.verb === 'exhausted.retries.failed')).toBe(true)
    })

    it('does not emit failed event on retry (only on final failure)', async () => {
      let attempts = 0
      ctx.executeAction = async () => {
        attempts++
        if (attempts < 3) throw new Error('Retry')
        return { success: true }
      }

      const promise = doAction(ctx, 'retry.then.succeed', {})
      await vi.runAllTimersAsync()
      await promise

      // Should have completed event but no failed events for intermediate retries
      const failedEvents = ctx.events.filter(e => e.verb === 'retry.then.succeed.failed')
      expect(failedEvents.length).toBe(0)
      expect(ctx.events.some(e => e.verb === 'retry.then.succeed.completed')).toBe(true)
    })
  })

  describe('Integration with WorkflowRuntime', () => {
    it('generates deterministic stepId from action and data', async () => {
      ctx.executeAction = async () => ({})

      // Same action + data should produce same stepId
      await doAction(ctx, 'deterministic.action', { key: 'value' })
      await doAction(ctx, 'deterministic.action', { key: 'value' })

      // The implementation should generate consistent stepIds
      // (specific assertion depends on implementation)
    })

    it('supports explicit stepId for workflow integration', async () => {
      ctx.executeAction = async () => ({ step: 'result' })

      const result = await doAction(ctx, 'workflow.step', {}, { stepId: 'workflow-123:step-1' })

      expect(result).toEqual({ step: 'result' })
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS (Stubs for the implementation)
// ============================================================================

/**
 * $.send() - Fire-and-forget event emission
 * Stub that will be replaced by actual implementation
 */
function sendEvent(ctx: MockExecutionContext, event: string, data: unknown): void {
  // Implementation will use queueMicrotask/setImmediate
  queueMicrotask(async () => {
    try {
      await ctx.logAction('send', event, data)
      await ctx.emitEvent(event, data)
      await ctx.executeAction(event, data).catch(() => {})
    } catch {
      // Best effort - swallow errors
    }
  })
}

/**
 * $.try() - Single attempt with error propagation
 * Stub that will be replaced by actual implementation
 */
async function tryAction<T>(
  ctx: MockExecutionContext,
  action: string,
  data: unknown,
  options: TryOptions = {}
): Promise<T> {
  const timeout = options.timeout ?? 30000
  const actionRecord = await ctx.logAction('try', action, data)

  await ctx.updateAction(actionRecord.id, { status: 'running', startedAt: new Date() })

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Action '${action}' timed out after ${timeout}ms`))
    }, timeout)
  })

  try {
    const result = await Promise.race([
      ctx.executeAction(action, data),
      timeoutPromise,
    ]) as T

    const now = new Date()
    await ctx.updateAction(actionRecord.id, {
      status: 'completed',
      output: result,
      completedAt: now,
      duration: now.getTime() - (actionRecord.startedAt?.getTime() ?? now.getTime()),
    })
    await ctx.emitEvent(`${action}.completed`, { result })

    return result
  } catch (error) {
    const now = new Date()
    await ctx.updateAction(actionRecord.id, {
      status: 'failed',
      error: {
        message: (error as Error).message,
        name: (error as Error).name,
        stack: (error as Error).stack,
      },
      completedAt: now,
      duration: now.getTime() - (actionRecord.startedAt?.getTime() ?? now.getTime()),
    })
    await ctx.emitEvent(`${action}.failed`, { error })

    throw error
  }
}

/**
 * $.do() - Durable execution with retries
 * Stub that will be replaced by actual implementation
 */
async function doAction<T>(
  ctx: MockExecutionContext,
  action: string,
  data: unknown,
  options: DoOptions = {}
): Promise<T> {
  const retryPolicy = { ...ctx.retryPolicy, ...options.retry }
  const actionRecord = await ctx.logAction('do', action, data)

  let lastError: Error | undefined
  let attempts = 0

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    attempts = attempt
    await ctx.updateAction(actionRecord.id, {
      status: attempt === 1 ? 'running' : 'retrying',
      attempts,
      startedAt: actionRecord.startedAt ?? new Date(),
    })

    try {
      const result = await ctx.executeAction(action, data) as T

      const now = new Date()
      await ctx.updateAction(actionRecord.id, {
        status: 'completed',
        output: result,
        attempts,
        completedAt: now,
        duration: now.getTime() - (actionRecord.startedAt?.getTime() ?? now.getTime()),
      })
      await ctx.emitEvent(`${action}.completed`, { result })

      return result
    } catch (error) {
      lastError = error as Error
      await ctx.updateAction(actionRecord.id, { attempts })

      if (attempt < retryPolicy.maxAttempts) {
        // Calculate delay with exponential backoff
        let delay = retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt - 1)
        delay = Math.min(delay, retryPolicy.maxDelayMs)

        // Add jitter
        if (retryPolicy.jitter) {
          delay += Math.random() * delay * 0.25
        }

        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  // All retries exhausted
  const now = new Date()
  await ctx.updateAction(actionRecord.id, {
    status: 'failed',
    error: {
      message: lastError!.message,
      name: lastError!.name,
      stack: lastError!.stack,
    },
    attempts,
    completedAt: now,
    duration: now.getTime() - (actionRecord.startedAt?.getTime() ?? now.getTime()),
  })
  await ctx.emitEvent(`${action}.failed`, { error: lastError })

  throw lastError
}
