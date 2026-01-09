/**
 * Cascade Executor Tests
 *
 * RED TDD: These tests should FAIL because CascadeExecutor doesn't exist yet.
 *
 * CascadeExecutor tries function types in order of speed/cost:
 * 1. Code (fastest, cheapest, deterministic)
 * 2. Generative (AI inference, single call)
 * 3. Agentic (AI + tools, multi-step)
 * 4. Human (slowest, most expensive, guaranteed judgment)
 *
 * The cascade stops when a function succeeds. On failure, it escalates
 * to the next type automatically. The cascade path is recorded in the
 * resulting event for observability.
 *
 * This file tests:
 * 1. Basic cascade execution order
 * 2. Fallback behavior on failure
 * 3. Cascade path recording in events
 * 4. Explicit type override (skip cascade)
 * 5. 5W+H event emission with method field
 * 6. Partial cascade (start from specific type)
 * 7. Timeout and error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  CascadeExecutor,
  type CascadeResult,
  type CascadeOptions,
  type CascadeStep,
  type CascadePath,
  type FunctionType,
  type CodeHandler,
  type GenerativeHandler,
  type AgenticHandler,
  type HumanHandler,
  CascadeExhaustedError,
  CascadeTimeoutError,
  CascadeSkippedError,
} from '../CascadeExecutor'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected cascade result structure
 */
interface ExpectedCascadeResult<T = unknown> {
  success: boolean
  result?: T
  error?: {
    message: string
    name: string
    stack?: string
  }
  method: FunctionType // Which type succeeded (or last attempted)
  cascade: CascadePath // Full cascade path taken
  duration: number
  event: Expected5WHEvent
}

/**
 * Expected cascade path structure
 */
interface ExpectedCascadePath {
  steps: CascadeStep[]
  startedAt: Date
  completedAt: Date
  exhausted: boolean
}

/**
 * Expected cascade step structure
 */
interface ExpectedCascadeStep {
  type: FunctionType
  attempted: boolean
  success: boolean
  error?: string
  duration: number
  timestamp: Date
}

/**
 * Expected 5W+H event structure with method field
 */
interface Expected5WHEvent {
  // WHO - Identity
  actor: string
  source?: string
  destination?: string

  // WHAT - Objects
  object: string
  type: string
  quantity?: number

  // WHEN - Time
  timestamp: Date
  recorded: Date

  // WHERE - Location
  ns: string
  location?: string
  readPoint?: string

  // WHY - Purpose
  verb: string
  disposition?: string
  reason?: string

  // HOW - Method (critical for cascade)
  method: FunctionType
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade: CascadePath
  transaction?: string
  context?: Record<string, unknown>
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-cascade-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    AI: {
      generate: vi.fn().mockResolvedValue({ text: 'Generated response' }),
      complete: vi.fn().mockResolvedValue({ text: 'Completed', stopReason: 'end_turn' }),
    },
    AGENT_RUNNER: {
      run: vi.fn().mockResolvedValue({ result: 'Agent completed' }),
    },
    NOTIFICATIONS: {
      send: vi.fn().mockResolvedValue(undefined),
      waitForResponse: vi.fn().mockResolvedValue({ approved: true }),
    },
    EVENTS: {
      emit: vi.fn(),
    },
  }
}

function createMockHandlers() {
  return {
    code: vi.fn() as CodeHandler,
    generative: vi.fn() as GenerativeHandler,
    agentic: vi.fn() as AgenticHandler,
    human: vi.fn() as HumanHandler,
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('CascadeExecutor', () => {
  let executor: InstanceType<typeof CascadeExecutor>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockHandlers: ReturnType<typeof createMockHandlers>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockHandlers = createMockHandlers()
    executor = new CascadeExecutor({
      state: mockState,
      env: mockEnv,
      handlers: mockHandlers,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC CASCADE EXECUTION ORDER
  // ==========================================================================

  describe('Basic Cascade Execution Order', () => {
    describe('Executes Code first when available', () => {
      it('executes Code handler first and returns on success', async () => {
        mockHandlers.code.mockResolvedValueOnce({ result: 'code_result' })

        const result = await executor.execute({
          input: { query: 'test' },
          handlers: mockHandlers,
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ result: 'code_result' })
        expect(result.method).toBe('code')
        expect(mockHandlers.code).toHaveBeenCalledTimes(1)
        expect(mockHandlers.generative).not.toHaveBeenCalled()
        expect(mockHandlers.agentic).not.toHaveBeenCalled()
        expect(mockHandlers.human).not.toHaveBeenCalled()
      })

      it('passes input to Code handler correctly', async () => {
        mockHandlers.code.mockResolvedValueOnce({ value: 42 })

        await executor.execute({
          input: { a: 1, b: 2 },
          handlers: mockHandlers,
        })

        expect(mockHandlers.code).toHaveBeenCalledWith(
          { a: 1, b: 2 },
          expect.any(Object) // context
        )
      })

      it('records cascade path with single Code step', async () => {
        mockHandlers.code.mockResolvedValueOnce({ done: true })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.cascade.steps).toHaveLength(1)
        expect(result.cascade.steps[0]).toMatchObject({
          type: 'code',
          attempted: true,
          success: true,
        })
        expect(result.cascade.exhausted).toBe(false)
      })
    })

    describe('Cascade order is Code -> Generative -> Agentic -> Human', () => {
      it('tries handlers in correct order when all fail except last', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Generative failed'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('Agentic failed'))
        mockHandlers.human.mockResolvedValueOnce({ humanApproval: true })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.success).toBe(true)
        expect(result.method).toBe('human')

        // Verify order of calls
        const codeCallOrder = mockHandlers.code.mock.invocationCallOrder[0]
        const generativeCallOrder = mockHandlers.generative.mock.invocationCallOrder[0]
        const agenticCallOrder = mockHandlers.agentic.mock.invocationCallOrder[0]
        const humanCallOrder = mockHandlers.human.mock.invocationCallOrder[0]

        expect(codeCallOrder).toBeLessThan(generativeCallOrder)
        expect(generativeCallOrder).toBeLessThan(agenticCallOrder)
        expect(agenticCallOrder).toBeLessThan(humanCallOrder)
      })

      it('records all cascade steps in order', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Generative failed'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('Agentic failed'))
        mockHandlers.human.mockResolvedValueOnce({ done: true })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.cascade.steps).toHaveLength(4)
        expect(result.cascade.steps[0].type).toBe('code')
        expect(result.cascade.steps[1].type).toBe('generative')
        expect(result.cascade.steps[2].type).toBe('agentic')
        expect(result.cascade.steps[3].type).toBe('human')
      })
    })
  })

  // ==========================================================================
  // 2. FALLBACK BEHAVIOR ON FAILURE
  // ==========================================================================

  describe('Fallback Behavior on Failure', () => {
    describe('Falls back to Generative on Code failure', () => {
      it('executes Generative after Code fails', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code cannot handle this'))
        mockHandlers.generative.mockResolvedValueOnce({ text: 'AI generated' })

        const result = await executor.execute({
          input: { complex: true },
          handlers: mockHandlers,
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ text: 'AI generated' })
        expect(result.method).toBe('generative')
        expect(mockHandlers.code).toHaveBeenCalledTimes(1)
        expect(mockHandlers.generative).toHaveBeenCalledTimes(1)
        expect(mockHandlers.agentic).not.toHaveBeenCalled()
        expect(mockHandlers.human).not.toHaveBeenCalled()
      })

      it('records Code failure and Generative success in cascade', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Not deterministic'))
        mockHandlers.generative.mockResolvedValueOnce({ generated: true })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.cascade.steps).toHaveLength(2)
        expect(result.cascade.steps[0]).toMatchObject({
          type: 'code',
          attempted: true,
          success: false,
          error: expect.stringContaining('Not deterministic'),
        })
        expect(result.cascade.steps[1]).toMatchObject({
          type: 'generative',
          attempted: true,
          success: true,
        })
      })
    })

    describe('Falls back to Agentic on Generative failure', () => {
      it('executes Agentic after Code and Generative fail', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Single call not enough'))
        mockHandlers.agentic.mockResolvedValueOnce({ researched: true })

        const result = await executor.execute({
          input: { needsResearch: true },
          handlers: mockHandlers,
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ researched: true })
        expect(result.method).toBe('agentic')
        expect(mockHandlers.code).toHaveBeenCalledTimes(1)
        expect(mockHandlers.generative).toHaveBeenCalledTimes(1)
        expect(mockHandlers.agentic).toHaveBeenCalledTimes(1)
        expect(mockHandlers.human).not.toHaveBeenCalled()
      })

      it('records all three steps when Agentic succeeds', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code error'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Gen error'))
        mockHandlers.agentic.mockResolvedValueOnce({ ok: true })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.cascade.steps).toHaveLength(3)
        expect(result.cascade.steps[0].type).toBe('code')
        expect(result.cascade.steps[0].success).toBe(false)
        expect(result.cascade.steps[1].type).toBe('generative')
        expect(result.cascade.steps[1].success).toBe(false)
        expect(result.cascade.steps[2].type).toBe('agentic')
        expect(result.cascade.steps[2].success).toBe(true)
      })
    })

    describe('Falls back to Human on Agentic failure', () => {
      it('executes Human after all AI methods fail', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Generative failed'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('Agent stuck'))
        mockHandlers.human.mockResolvedValueOnce({ approved: true, comment: 'Manual review' })

        const result = await executor.execute({
          input: { needsJudgment: true },
          handlers: mockHandlers,
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ approved: true, comment: 'Manual review' })
        expect(result.method).toBe('human')
        expect(mockHandlers.code).toHaveBeenCalledTimes(1)
        expect(mockHandlers.generative).toHaveBeenCalledTimes(1)
        expect(mockHandlers.agentic).toHaveBeenCalledTimes(1)
        expect(mockHandlers.human).toHaveBeenCalledTimes(1)
      })

      it('records full cascade path ending with Human', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('e1'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('e2'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('e3'))
        mockHandlers.human.mockResolvedValueOnce({ decision: 'approved' })

        const result = await executor.execute({
          input: {},
          handlers: mockHandlers,
        })

        expect(result.cascade.steps).toHaveLength(4)
        expect(result.cascade.steps.map((s) => s.type)).toEqual([
          'code',
          'generative',
          'agentic',
          'human',
        ])
        expect(result.cascade.steps.filter((s) => s.success)).toHaveLength(1)
        expect(result.cascade.exhausted).toBe(false) // Human succeeded
      })
    })

    describe('Cascade exhausted when all types fail', () => {
      it('throws CascadeExhaustedError when all handlers fail', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Generative failed'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('Agentic failed'))
        mockHandlers.human.mockRejectedValueOnce(new Error('Human declined'))

        await expect(
          executor.execute({
            input: {},
            handlers: mockHandlers,
          })
        ).rejects.toThrow(CascadeExhaustedError)
      })

      it('includes all errors in CascadeExhaustedError', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('Code: not computable'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('Gen: model error'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('Agent: max iterations'))
        mockHandlers.human.mockRejectedValueOnce(new Error('Human: timeout'))

        try {
          await executor.execute({
            input: {},
            handlers: mockHandlers,
          })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(CascadeExhaustedError)
          const cascadeError = error as CascadeExhaustedError
          expect(cascadeError.cascade.steps).toHaveLength(4)
          expect(cascadeError.cascade.exhausted).toBe(true)
          expect(cascadeError.errors).toHaveLength(4)
          expect(cascadeError.errors[0].message).toContain('not computable')
          expect(cascadeError.errors[1].message).toContain('model error')
          expect(cascadeError.errors[2].message).toContain('max iterations')
          expect(cascadeError.errors[3].message).toContain('timeout')
        }
      })

      it('marks cascade as exhausted in path', async () => {
        mockHandlers.code.mockRejectedValueOnce(new Error('e1'))
        mockHandlers.generative.mockRejectedValueOnce(new Error('e2'))
        mockHandlers.agentic.mockRejectedValueOnce(new Error('e3'))
        mockHandlers.human.mockRejectedValueOnce(new Error('e4'))

        try {
          await executor.execute({
            input: {},
            handlers: mockHandlers,
          })
        } catch (error) {
          const cascadeError = error as CascadeExhaustedError
          expect(cascadeError.cascade.exhausted).toBe(true)
          expect(cascadeError.cascade.steps.every((s) => !s.success)).toBe(true)
        }
      })
    })
  })

  // ==========================================================================
  // 3. CASCADE PATH RECORDING IN EVENTS
  // ==========================================================================

  describe('Records cascade path in event', () => {
    it('includes cascade field in emitted 5W+H event', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code failed'))
      mockHandlers.generative.mockResolvedValueOnce({ result: 'ok' })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'user:123',
          object: 'task:456',
          type: 'Task',
          verb: 'processed',
          ns: 'app.example.com',
        },
      })

      expect(result.event).toBeDefined()
      expect(result.event.cascade).toBeDefined()
      expect(result.event.cascade.steps).toHaveLength(2)
      expect(result.event.cascade.steps[0].type).toBe('code')
      expect(result.event.cascade.steps[1].type).toBe('generative')
    })

    it('emits event to pipeline with cascade path', async () => {
      mockHandlers.code.mockResolvedValueOnce({ done: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'system',
          object: 'fn:test',
          type: 'Function',
          verb: 'executed',
          ns: 'test.ns',
        },
        emitEvent: true,
      })

      expect(mockEnv.EVENTS.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          cascade: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'code', success: true }),
            ]),
          }),
        })
      )
    })

    it('cascade path includes duration for each step', async () => {
      mockHandlers.code.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 10))
        throw new Error('Code slow fail')
      })
      mockHandlers.generative.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 20))
        return { ok: true }
      })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      expect(result.cascade.steps[0].duration).toBeGreaterThanOrEqual(10)
      expect(result.cascade.steps[1].duration).toBeGreaterThanOrEqual(20)
    })

    it('cascade path includes timestamps for each step', async () => {
      const before = new Date()

      mockHandlers.code.mockRejectedValueOnce(new Error('fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      const after = new Date()

      for (const step of result.cascade.steps) {
        expect(step.timestamp).toBeInstanceOf(Date)
        expect(step.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
        expect(step.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
      }
    })

    it('includes startedAt and completedAt in cascade path', async () => {
      const before = new Date()

      mockHandlers.code.mockResolvedValueOnce({ quick: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      const after = new Date()

      expect(result.cascade.startedAt).toBeInstanceOf(Date)
      expect(result.cascade.completedAt).toBeInstanceOf(Date)
      expect(result.cascade.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(result.cascade.completedAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(result.cascade.completedAt.getTime()).toBeGreaterThanOrEqual(
        result.cascade.startedAt.getTime()
      )
    })
  })

  // ==========================================================================
  // 4. EXPLICIT TYPE OVERRIDE (SKIP CASCADE)
  // ==========================================================================

  describe('Respects explicit type override (skip cascade)', () => {
    it('skips cascade when explicit type is specified', async () => {
      mockHandlers.generative.mockResolvedValueOnce({ directCall: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        type: 'generative', // Explicit override
      })

      expect(result.success).toBe(true)
      expect(result.result).toEqual({ directCall: true })
      expect(result.method).toBe('generative')
      expect(mockHandlers.code).not.toHaveBeenCalled()
      expect(mockHandlers.generative).toHaveBeenCalledTimes(1)
      expect(mockHandlers.agentic).not.toHaveBeenCalled()
      expect(mockHandlers.human).not.toHaveBeenCalled()
    })

    it('records single step when type is explicit', async () => {
      mockHandlers.agentic.mockResolvedValueOnce({ agent: 'result' })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        type: 'agentic',
      })

      expect(result.cascade.steps).toHaveLength(1)
      expect(result.cascade.steps[0]).toMatchObject({
        type: 'agentic',
        attempted: true,
        success: true,
      })
    })

    it('throws error directly when explicit type fails (no cascade)', async () => {
      mockHandlers.human.mockRejectedValueOnce(new Error('Human unavailable'))

      await expect(
        executor.execute({
          input: {},
          handlers: mockHandlers,
          type: 'human',
        })
      ).rejects.toThrow('Human unavailable')

      // Should not cascade to other types
      expect(mockHandlers.code).not.toHaveBeenCalled()
      expect(mockHandlers.generative).not.toHaveBeenCalled()
      expect(mockHandlers.agentic).not.toHaveBeenCalled()
    })

    it('can specify code type explicitly', async () => {
      mockHandlers.code.mockResolvedValueOnce({ deterministic: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        type: 'code',
      })

      expect(result.method).toBe('code')
      expect(mockHandlers.generative).not.toHaveBeenCalled()
    })

    it('can start cascade from specific type with startFrom', async () => {
      mockHandlers.agentic.mockRejectedValueOnce(new Error('Agent failed'))
      mockHandlers.human.mockResolvedValueOnce({ human: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        startFrom: 'agentic', // Skip code and generative
      })

      expect(result.success).toBe(true)
      expect(result.method).toBe('human')
      expect(mockHandlers.code).not.toHaveBeenCalled()
      expect(mockHandlers.generative).not.toHaveBeenCalled()
      expect(mockHandlers.agentic).toHaveBeenCalledTimes(1)
      expect(mockHandlers.human).toHaveBeenCalledTimes(1)
    })

    it('records only attempted steps when using startFrom', async () => {
      mockHandlers.generative.mockRejectedValueOnce(new Error('Gen fail'))
      mockHandlers.agentic.mockResolvedValueOnce({ ok: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        startFrom: 'generative',
      })

      expect(result.cascade.steps).toHaveLength(2)
      expect(result.cascade.steps[0].type).toBe('generative')
      expect(result.cascade.steps[1].type).toBe('agentic')
      // No code step recorded
      expect(result.cascade.steps.find((s) => s.type === 'code')).toBeUndefined()
    })
  })

  // ==========================================================================
  // 5. EMITS PROPER 5W+H EVENT WITH METHOD FIELD
  // ==========================================================================

  describe('Emits proper 5W+H event with method field', () => {
    it('sets method field to successful type', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'user:1',
          object: 'task:1',
          type: 'Task',
          verb: 'completed',
          ns: 'test',
        },
      })

      expect(result.event.method).toBe('generative')
    })

    it('includes all 5W+H fields in event', async () => {
      mockHandlers.code.mockResolvedValueOnce({ done: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          // WHO
          actor: 'agent:assistant',
          source: 'api',
          destination: 'database',
          // WHAT
          object: 'invoice:inv-123',
          type: 'Invoice',
          quantity: 1,
          // WHEN (timestamps set automatically)
          // WHERE
          ns: 'app.billing.com',
          location: 'us-west-2',
          readPoint: '/api/invoices',
          // WHY
          verb: 'processed',
          disposition: 'completed',
          reason: 'Auto-process workflow',
        },
      })

      expect(result.event).toMatchObject({
        // WHO
        actor: 'agent:assistant',
        source: 'api',
        destination: 'database',
        // WHAT
        object: 'invoice:inv-123',
        type: 'Invoice',
        quantity: 1,
        // WHEN
        timestamp: expect.any(Date),
        recorded: expect.any(Date),
        // WHERE
        ns: 'app.billing.com',
        location: 'us-west-2',
        readPoint: '/api/invoices',
        // WHY
        verb: 'processed',
        disposition: 'completed',
        reason: 'Auto-process workflow',
        // HOW
        method: 'code',
        cascade: expect.any(Object),
      })
    })

    it('sets method to "code" when Code succeeds', async () => {
      mockHandlers.code.mockResolvedValueOnce({ computed: 42 })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'system',
          object: 'calc:1',
          type: 'Calculation',
          verb: 'computed',
          ns: 'math.api',
        },
      })

      expect(result.event.method).toBe('code')
    })

    it('sets method to "generative" when Generative succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockResolvedValueOnce({ text: 'Generated' })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'user:1',
          object: 'summary:1',
          type: 'Summary',
          verb: 'generated',
          ns: 'content.api',
        },
      })

      expect(result.event.method).toBe('generative')
    })

    it('sets method to "agentic" when Agentic succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockRejectedValueOnce(new Error('Gen fail'))
      mockHandlers.agentic.mockResolvedValueOnce({ researched: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'agent:researcher',
          object: 'research:1',
          type: 'Research',
          verb: 'completed',
          ns: 'research.api',
        },
      })

      expect(result.event.method).toBe('agentic')
    })

    it('sets method to "human" when Human succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockRejectedValueOnce(new Error('Gen fail'))
      mockHandlers.agentic.mockRejectedValueOnce(new Error('Agent fail'))
      mockHandlers.human.mockResolvedValueOnce({ approved: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        eventContext: {
          actor: 'human:reviewer',
          object: 'approval:1',
          type: 'Approval',
          verb: 'approved',
          ns: 'workflow.api',
        },
      })

      expect(result.event.method).toBe('human')
    })

    it('includes model field when generative handler succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockResolvedValueOnce({ text: 'Response' })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        model: 'claude-3-sonnet',
        eventContext: {
          actor: 'system',
          object: 'gen:1',
          type: 'Generation',
          verb: 'generated',
          ns: 'ai.api',
        },
      })

      expect(result.event.model).toBe('claude-3-sonnet')
    })

    it('includes tools field when agentic handler succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockRejectedValueOnce(new Error('Gen fail'))
      mockHandlers.agentic.mockResolvedValueOnce({ result: 'done' })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        tools: ['web_search', 'calculator'],
        eventContext: {
          actor: 'agent:helper',
          object: 'task:1',
          type: 'Task',
          verb: 'completed',
          ns: 'agent.api',
        },
      })

      expect(result.event.tools).toEqual(['web_search', 'calculator'])
    })

    it('includes channel field when human handler succeeds', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockRejectedValueOnce(new Error('Gen fail'))
      mockHandlers.agentic.mockRejectedValueOnce(new Error('Agent fail'))
      mockHandlers.human.mockResolvedValueOnce({ approved: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        channel: 'slack',
        eventContext: {
          actor: 'human:approver',
          object: 'expense:1',
          type: 'Expense',
          verb: 'approved',
          ns: 'finance.api',
        },
      })

      expect(result.event.channel).toBe('slack')
    })

    it('includes branch field for experiment tracking', async () => {
      mockHandlers.code.mockResolvedValueOnce({ done: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        branch: 'experiment-v2',
        eventContext: {
          actor: 'system',
          object: 'test:1',
          type: 'Test',
          verb: 'executed',
          ns: 'experiment.api',
        },
      })

      expect(result.event.branch).toBe('experiment-v2')
    })
  })

  // ==========================================================================
  // 6. HANDLER AVAILABILITY
  // ==========================================================================

  describe('Handler Availability', () => {
    it('skips unavailable handlers in cascade', async () => {
      // No code handler provided
      const partialHandlers = {
        generative: vi.fn().mockResolvedValueOnce({ gen: true }),
        agentic: vi.fn(),
        human: vi.fn(),
      }

      const result = await executor.execute({
        input: {},
        handlers: partialHandlers as unknown as typeof mockHandlers,
      })

      expect(result.success).toBe(true)
      expect(result.method).toBe('generative')
      expect(result.cascade.steps[0].type).toBe('generative')
    })

    it('only tries available handlers', async () => {
      // Only code and human available
      const minimalHandlers = {
        code: vi.fn().mockRejectedValueOnce(new Error('Code fail')),
        human: vi.fn().mockResolvedValueOnce({ manual: true }),
      }

      const result = await executor.execute({
        input: {},
        handlers: minimalHandlers as unknown as typeof mockHandlers,
      })

      expect(result.success).toBe(true)
      expect(result.method).toBe('human')
      expect(result.cascade.steps).toHaveLength(2)
      expect(result.cascade.steps[0].type).toBe('code')
      expect(result.cascade.steps[1].type).toBe('human')
    })

    it('throws CascadeSkippedError when no handlers available', async () => {
      const emptyHandlers = {}

      await expect(
        executor.execute({
          input: {},
          handlers: emptyHandlers as unknown as typeof mockHandlers,
        })
      ).rejects.toThrow(CascadeSkippedError)
    })

    it('marks skipped handlers in cascade path', async () => {
      // Only generative provided, others undefined
      const singleHandler = {
        generative: vi.fn().mockResolvedValueOnce({ ok: true }),
      }

      const result = await executor.execute({
        input: {},
        handlers: singleHandler as unknown as typeof mockHandlers,
        trackSkipped: true,
      })

      // Should mark code as skipped (not attempted)
      const codeStep = result.cascade.steps.find((s) => s.type === 'code')
      if (codeStep) {
        expect(codeStep.attempted).toBe(false)
      }
    })
  })

  // ==========================================================================
  // 7. TIMEOUT AND ERROR HANDLING
  // ==========================================================================

  describe('Timeout and Error Handling', () => {
    it('respects per-step timeout', async () => {
      mockHandlers.code.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 500))
        return { slow: true }
      })
      mockHandlers.generative.mockResolvedValueOnce({ fast: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
        stepTimeout: 100, // 100ms timeout per step
      })

      expect(result.success).toBe(true)
      expect(result.method).toBe('generative')
      expect(result.cascade.steps[0].error).toMatch(/timeout/i)
    })

    it('respects global cascade timeout', async () => {
      mockHandlers.code.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 100))
        throw new Error('Code fail')
      })
      mockHandlers.generative.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 100))
        throw new Error('Gen fail')
      })
      mockHandlers.agentic.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 100))
        throw new Error('Agent fail')
      })
      // Human would succeed but global timeout reached

      await expect(
        executor.execute({
          input: {},
          handlers: mockHandlers,
          timeout: 250, // Total 250ms for entire cascade
        })
      ).rejects.toThrow(CascadeTimeoutError)
    })

    it('includes partial cascade path in timeout error', async () => {
      mockHandlers.code.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 50))
        throw new Error('Code fail')
      })
      mockHandlers.generative.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { late: true }
      })

      try {
        await executor.execute({
          input: {},
          handlers: mockHandlers,
          timeout: 100,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(CascadeTimeoutError)
        const timeoutError = error as CascadeTimeoutError
        expect(timeoutError.cascade.steps.length).toBeGreaterThan(0)
        expect(timeoutError.cascade.steps[0].type).toBe('code')
      }
    })

    it('can abort cascade with AbortSignal', async () => {
      const controller = new AbortController()

      mockHandlers.code.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return { slow: true }
      })

      setTimeout(() => controller.abort(), 50)

      await expect(
        executor.execute({
          input: {},
          handlers: mockHandlers,
          signal: controller.signal,
        })
      ).rejects.toThrow(/abort/i)
    })

    it('handles synchronous errors gracefully', async () => {
      mockHandlers.code.mockImplementationOnce(() => {
        throw new Error('Sync error')
      })
      mockHandlers.generative.mockResolvedValueOnce({ recovered: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      expect(result.success).toBe(true)
      expect(result.method).toBe('generative')
      expect(result.cascade.steps[0].error).toContain('Sync error')
    })

    it('preserves original error type in cascade step', async () => {
      class CustomError extends Error {
        code = 'CUSTOM_CODE'
      }

      mockHandlers.code.mockRejectedValueOnce(new CustomError('Custom failure'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      const result = await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      expect(result.cascade.steps[0].error).toContain('Custom failure')
      // Note: Error class info may not be preserved in JSON serialization
    })
  })

  // ==========================================================================
  // 8. CALLBACKS AND OBSERVABILITY
  // ==========================================================================

  describe('Callbacks and Observability', () => {
    it('calls onStepStart before each handler', async () => {
      const onStepStart = vi.fn()

      mockHandlers.code.mockRejectedValueOnce(new Error('fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        onStepStart,
      })

      expect(onStepStart).toHaveBeenCalledTimes(2)
      expect(onStepStart).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'code' }))
      expect(onStepStart).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'generative' }))
    })

    it('calls onStepComplete after each handler', async () => {
      const onStepComplete = vi.fn()

      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        onStepComplete,
      })

      expect(onStepComplete).toHaveBeenCalledTimes(2)
      expect(onStepComplete).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'code',
          success: false,
          error: expect.stringContaining('Code fail'),
        })
      )
      expect(onStepComplete).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'generative',
          success: true,
        })
      )
    })

    it('calls onCascadeComplete with final result', async () => {
      const onCascadeComplete = vi.fn()

      mockHandlers.code.mockResolvedValueOnce({ quick: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        onCascadeComplete,
      })

      expect(onCascadeComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          method: 'code',
          cascade: expect.objectContaining({
            steps: expect.arrayContaining([expect.objectContaining({ type: 'code' })]),
          }),
        })
      )
    })

    it('emits cascade.started event', async () => {
      mockHandlers.code.mockResolvedValueOnce({ done: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        emitEvents: true,
      })

      expect(mockEnv.EVENTS.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'cascade.started',
        })
      )
    })

    it('emits cascade.step event for each step', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        emitEvents: true,
      })

      const stepEvents = mockEnv.EVENTS.emit.mock.calls.filter(
        (call: unknown[]) => (call[0] as Record<string, unknown>).verb === 'cascade.step'
      )
      expect(stepEvents.length).toBe(2)
    })

    it('emits cascade.completed event on success', async () => {
      mockHandlers.code.mockResolvedValueOnce({ done: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
        emitEvents: true,
      })

      expect(mockEnv.EVENTS.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'cascade.completed',
          disposition: 'success',
        })
      )
    })

    it('emits cascade.exhausted event when all fail', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('e1'))
      mockHandlers.generative.mockRejectedValueOnce(new Error('e2'))
      mockHandlers.agentic.mockRejectedValueOnce(new Error('e3'))
      mockHandlers.human.mockRejectedValueOnce(new Error('e4'))

      await executor
        .execute({
          input: {},
          handlers: mockHandlers,
          emitEvents: true,
        })
        .catch(() => {})

      expect(mockEnv.EVENTS.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'cascade.exhausted',
          disposition: 'failed',
        })
      )
    })
  })

  // ==========================================================================
  // 9. CONTEXT PASSING
  // ==========================================================================

  describe('Context Passing', () => {
    it('passes execution context to each handler', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: { data: 'test' },
        handlers: mockHandlers,
        context: {
          userId: 'user:123',
          sessionId: 'session:456',
        },
      })

      // Check code handler received context
      expect(mockHandlers.code).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({
          userId: 'user:123',
          sessionId: 'session:456',
        })
      )

      // Check generative handler received same context
      expect(mockHandlers.generative).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({
          userId: 'user:123',
          sessionId: 'session:456',
        })
      )
    })

    it('includes cascade state in handler context', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('Code fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      // Second handler should know code failed
      expect(mockHandlers.generative).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          cascade: expect.objectContaining({
            previousAttempts: expect.arrayContaining([
              expect.objectContaining({ type: 'code', success: false }),
            ]),
          }),
        })
      )
    })

    it('passes invocation ID to all handlers', async () => {
      mockHandlers.code.mockRejectedValueOnce(new Error('fail'))
      mockHandlers.generative.mockResolvedValueOnce({ ok: true })

      await executor.execute({
        input: {},
        handlers: mockHandlers,
      })

      const codeContext = mockHandlers.code.mock.calls[0][1]
      const genContext = mockHandlers.generative.mock.calls[0][1]

      expect(codeContext.invocationId).toBeDefined()
      expect(genContext.invocationId).toBe(codeContext.invocationId)
    })
  })
})
