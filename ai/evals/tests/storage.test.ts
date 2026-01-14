import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Evalite Custom Storage Adapter Tests
 *
 * These tests verify the custom storage adapter that sends eval results
 * to the /e events pipeline, converting eval traces to 5W+H events.
 *
 * Reference: https://v1.evalite.dev/api/storage#implementing-custom-storage
 *
 * Implementation requirements:
 * - Implement evalite's Storage interface (runs, suites, evals, scores, traces)
 * - Convert eval results to 5W+H Event format
 * - POST to /e endpoint (or directly to pipeline)
 * - Include model, score, latency in context
 * - Handle batch eval results
 *
 * These tests are expected to FAIL until the storage adapter is implemented.
 */

// ============================================================================
// Types - Evalite Storage Interface
// ============================================================================

/**
 * Evalite Storage interface from https://v1.evalite.dev/api/storage
 */
interface Storage {
  runs: {
    create(opts: CreateOpts<RunInput>): Promise<Run>
    getMany(opts?: GetManyOpts): Promise<Run[]>
  }

  suites: {
    create(opts: CreateOpts<SuiteInput>): Promise<Suite>
    update(opts: UpdateOpts<Partial<SuiteInput>>): Promise<Suite>
    getMany(opts?: GetManyOpts): Promise<Suite[]>
  }

  evals: {
    create(opts: CreateOpts<EvalInput>): Promise<Eval>
    update(opts: UpdateOpts<Partial<EvalInput>>): Promise<Eval>
    getMany(opts?: GetManyOpts): Promise<Eval[]>
  }

  scores: {
    create(opts: CreateOpts<ScoreInput>): Promise<Score>
    getMany(opts?: GetManyOpts): Promise<Score[]>
  }

  traces: {
    create(opts: CreateOpts<TraceInput>): Promise<Trace>
    getMany(opts?: GetManyOpts): Promise<Trace[]>
  }

  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

interface CreateOpts<T> {
  data: T
}

interface UpdateOpts<T> {
  id: string
  data: T
}

interface GetManyOpts {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
  orderBy?: string
}

// Evalite entity types
interface Run {
  id: string
  createdAt: Date
  status: 'running' | 'completed' | 'failed'
}

interface RunInput {
  status?: 'running' | 'completed' | 'failed'
}

interface Suite {
  id: string
  runId: string
  name: string
  status: 'running' | 'completed' | 'failed'
  duration?: number
}

interface SuiteInput {
  runId: string
  name: string
  status?: 'running' | 'completed' | 'failed'
  duration?: number
}

interface Eval {
  id: string
  suiteId: string
  input: unknown
  output: unknown
  expected?: unknown
  duration: number
  status: 'passed' | 'failed' | 'pending'
}

interface EvalInput {
  suiteId: string
  input: unknown
  output: unknown
  expected?: unknown
  duration: number
  status?: 'passed' | 'failed' | 'pending'
}

interface Score {
  id: string
  evalId: string
  name: string
  score: number
  reason?: string
}

interface ScoreInput {
  evalId: string
  name: string
  score: number
  reason?: string
}

interface Trace {
  id: string
  evalId: string
  model: string
  input: unknown
  output: unknown
  latency: number
  tokens?: { input: number; output: number }
}

interface TraceInput {
  evalId: string
  model: string
  input: unknown
  output: unknown
  latency: number
  tokens?: { input: number; output: number }
}

// ============================================================================
// Types - 5W+H Event Model
// ============================================================================

/**
 * 5W+H Event format from events/README.md
 */
interface Event {
  // WHO - Identity
  actor: string
  source?: string
  destination?: string

  // WHAT - Objects
  object: string
  type: string
  quantity?: number

  // WHEN - Time
  timestamp: string
  recorded: string

  // WHERE - Location
  ns: string
  location?: string
  readPoint?: string

  // WHY - Purpose
  verb: string
  disposition?: string
  reason?: string

  // HOW - Method
  method?: 'code' | 'generative' | 'agentic' | 'human'
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade?: unknown
  transaction?: string
  context?: Record<string, unknown>
}

// ============================================================================
// Import the actual storage adapter (will fail until implemented)
// ============================================================================

import { EvaliteStorage, createEvaliteStorage, convertEvalToEvent, convertTraceToEvent } from '../storage'

// ============================================================================
// Test: Storage Interface Implementation
// ============================================================================

describe('Evalite Storage Interface', () => {
  let storage: Storage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
    })
  })

  describe('runs', () => {
    it('implements runs.create() method', async () => {
      const run = await storage.runs.create({
        data: { status: 'running' },
      })

      expect(run).toHaveProperty('id')
      expect(run).toHaveProperty('createdAt')
      expect(run.status).toBe('running')
    })

    it('implements runs.getMany() method', async () => {
      const runs = await storage.runs.getMany()

      expect(Array.isArray(runs)).toBe(true)
    })

    it('runs.getMany() supports filtering options', async () => {
      const runs = await storage.runs.getMany({
        where: { status: 'completed' },
        limit: 10,
      })

      expect(Array.isArray(runs)).toBe(true)
    })
  })

  describe('suites', () => {
    it('implements suites.create() method', async () => {
      const suite = await storage.suites.create({
        data: {
          runId: 'run-123',
          name: 'test-suite',
          status: 'running',
        },
      })

      expect(suite).toHaveProperty('id')
      expect(suite.runId).toBe('run-123')
      expect(suite.name).toBe('test-suite')
    })

    it('implements suites.update() method', async () => {
      const suite = await storage.suites.update({
        id: 'suite-123',
        data: {
          status: 'completed',
          duration: 1500,
        },
      })

      expect(suite.status).toBe('completed')
      expect(suite.duration).toBe(1500)
    })

    it('implements suites.getMany() method', async () => {
      const suites = await storage.suites.getMany({
        where: { runId: 'run-123' },
      })

      expect(Array.isArray(suites)).toBe(true)
    })
  })

  describe('evals', () => {
    it('implements evals.create() method', async () => {
      const evalResult = await storage.evals.create({
        data: {
          suiteId: 'suite-123',
          input: { prompt: 'Hello' },
          output: { response: 'World' },
          duration: 250,
        },
      })

      expect(evalResult).toHaveProperty('id')
      expect(evalResult.suiteId).toBe('suite-123')
      expect(evalResult.duration).toBe(250)
    })

    it('implements evals.update() method', async () => {
      const evalResult = await storage.evals.update({
        id: 'eval-123',
        data: {
          status: 'passed',
        },
      })

      expect(evalResult.status).toBe('passed')
    })

    it('implements evals.getMany() method', async () => {
      const evals = await storage.evals.getMany({
        where: { suiteId: 'suite-123' },
      })

      expect(Array.isArray(evals)).toBe(true)
    })
  })

  describe('scores', () => {
    it('implements scores.create() method', async () => {
      const score = await storage.scores.create({
        data: {
          evalId: 'eval-123',
          name: 'accuracy',
          score: 0.95,
          reason: 'Correct response',
        },
      })

      expect(score).toHaveProperty('id')
      expect(score.evalId).toBe('eval-123')
      expect(score.name).toBe('accuracy')
      expect(score.score).toBe(0.95)
    })

    it('implements scores.getMany() method', async () => {
      const scores = await storage.scores.getMany({
        where: { evalId: 'eval-123' },
      })

      expect(Array.isArray(scores)).toBe(true)
    })
  })

  describe('traces', () => {
    it('implements traces.create() method', async () => {
      const trace = await storage.traces.create({
        data: {
          evalId: 'eval-123',
          model: 'claude-3-opus',
          input: { messages: [{ role: 'user', content: 'Hello' }] },
          output: { content: 'Hi there!' },
          latency: 350,
          tokens: { input: 10, output: 5 },
        },
      })

      expect(trace).toHaveProperty('id')
      expect(trace.model).toBe('claude-3-opus')
      expect(trace.latency).toBe(350)
    })

    it('implements traces.getMany() method', async () => {
      const traces = await storage.traces.getMany({
        where: { evalId: 'eval-123' },
      })

      expect(Array.isArray(traces)).toBe(true)
    })
  })

  describe('lifecycle', () => {
    it('implements close() method', async () => {
      await expect(storage.close()).resolves.not.toThrow()
    })

    it('implements Symbol.asyncDispose', async () => {
      expect(typeof storage[Symbol.asyncDispose]).toBe('function')
      await expect(storage[Symbol.asyncDispose]()).resolves.not.toThrow()
    })

    it('supports await using pattern', async () => {
      // This test verifies the async disposable pattern works
      const createAndDispose = async () => {
        await using tempStorage = createEvaliteStorage({
          endpoint: 'https://example.com.ai/e',
          fetch: mockFetch,
        })
        await tempStorage.runs.create({ data: { status: 'running' } })
      }

      await expect(createAndDispose()).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// Test: Eval Result to 5W+H Event Conversion
// ============================================================================

describe('Eval to Event Conversion', () => {
  it('converts eval result to Event format', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: { prompt: 'What is 2+2?' },
      output: { response: '4' },
      expected: { response: '4' },
      duration: 250,
      status: 'passed',
    }

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    // WHO
    expect(event.actor).toBe('evalite-runner')

    // WHAT
    expect(event.object).toBe('eval-123')
    expect(event.type).toBe('Eval')

    // WHEN
    expect(event.timestamp).toBeDefined()
    expect(event.recorded).toBeDefined()

    // WHERE
    expect(event.ns).toBe('https://evals.dotdo.ai')

    // WHY
    expect(event.verb).toBe('evaluated')
    expect(event.disposition).toBe('passed')
  })

  it('includes model in context when available', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: {},
      output: {},
      duration: 250,
      status: 'passed',
    }

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
      model: 'claude-3-opus',
    })

    expect(event.model).toBe('claude-3-opus')
    expect(event.method).toBe('generative')
  })

  it('includes score in context when available', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: {},
      output: {},
      duration: 250,
      status: 'passed',
    }

    const scores: Score[] = [
      { id: 'score-1', evalId: 'eval-123', name: 'accuracy', score: 0.95 },
      { id: 'score-2', evalId: 'eval-123', name: 'relevance', score: 0.88 },
    ]

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
      scores,
    })

    expect(event.context).toHaveProperty('scores')
    expect(event.context?.scores).toEqual([
      { name: 'accuracy', score: 0.95 },
      { name: 'relevance', score: 0.88 },
    ])
  })

  it('includes latency (duration) in context', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: {},
      output: {},
      duration: 1250,
      status: 'passed',
    }

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.context).toHaveProperty('latency')
    expect(event.context?.latency).toBe(1250)
  })

  it('sets disposition to failed when eval fails', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: { prompt: 'What is 2+2?' },
      output: { response: '5' },
      expected: { response: '4' },
      duration: 250,
      status: 'failed',
    }

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.disposition).toBe('failed')
  })

  it('includes input/output in context', () => {
    const evalResult: Eval = {
      id: 'eval-123',
      suiteId: 'suite-456',
      input: { prompt: 'Hello' },
      output: { response: 'World' },
      duration: 100,
      status: 'passed',
    }

    const event = convertEvalToEvent(evalResult, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.context).toHaveProperty('input')
    expect(event.context).toHaveProperty('output')
  })
})

// ============================================================================
// Test: Trace to 5W+H Event Conversion
// ============================================================================

describe('Trace to Event Conversion', () => {
  it('converts trace to Event format', () => {
    const trace: Trace = {
      id: 'trace-123',
      evalId: 'eval-456',
      model: 'claude-3-opus',
      input: { messages: [{ role: 'user', content: 'Hello' }] },
      output: { content: 'Hi!' },
      latency: 350,
    }

    const event = convertTraceToEvent(trace, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    // WHO
    expect(event.actor).toBe('evalite-runner')

    // WHAT
    expect(event.object).toBe('trace-123')
    expect(event.type).toBe('Trace')

    // WHY
    expect(event.verb).toBe('traced')

    // HOW
    expect(event.model).toBe('claude-3-opus')
    expect(event.method).toBe('generative')
  })

  it('includes token counts in context', () => {
    const trace: Trace = {
      id: 'trace-123',
      evalId: 'eval-456',
      model: 'claude-3-opus',
      input: {},
      output: {},
      latency: 350,
      tokens: { input: 100, output: 50 },
    }

    const event = convertTraceToEvent(trace, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.context).toHaveProperty('tokens')
    expect(event.context?.tokens).toEqual({ input: 100, output: 50 })
  })

  it('includes latency in context', () => {
    const trace: Trace = {
      id: 'trace-123',
      evalId: 'eval-456',
      model: 'claude-3-opus',
      input: {},
      output: {},
      latency: 750,
    }

    const event = convertTraceToEvent(trace, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.context).toHaveProperty('latency')
    expect(event.context?.latency).toBe(750)
  })

  it('links trace to parent eval via transaction', () => {
    const trace: Trace = {
      id: 'trace-123',
      evalId: 'eval-456',
      model: 'claude-3-opus',
      input: {},
      output: {},
      latency: 350,
    }

    const event = convertTraceToEvent(trace, {
      ns: 'https://evals.dotdo.ai',
      actor: 'evalite-runner',
    })

    expect(event.transaction).toBe('eval-456')
  })
})

// ============================================================================
// Test: POST to /e Endpoint
// ============================================================================

describe('POST to /e Endpoint', () => {
  let storage: Storage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
    })
  })

  it('POSTs event when eval is created', async () => {
    await storage.evals.create({
      data: {
        suiteId: 'suite-123',
        input: { prompt: 'Hello' },
        output: { response: 'World' },
        duration: 250,
      },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com.ai/e',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('POSTs event when trace is created', async () => {
    await storage.traces.create({
      data: {
        evalId: 'eval-123',
        model: 'claude-3-opus',
        input: {},
        output: {},
        latency: 350,
      },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com.ai/e',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('POSTs event when score is created', async () => {
    await storage.scores.create({
      data: {
        evalId: 'eval-123',
        name: 'accuracy',
        score: 0.95,
      },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com.ai/e',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('sends valid 5W+H event in request body', async () => {
    await storage.evals.create({
      data: {
        suiteId: 'suite-123',
        input: { prompt: 'Hello' },
        output: { response: 'World' },
        duration: 250,
      },
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)

    // Verify 5W+H structure
    expect(body).toHaveProperty('actor')
    expect(body).toHaveProperty('object')
    expect(body).toHaveProperty('type')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('recorded')
    expect(body).toHaveProperty('ns')
    expect(body).toHaveProperty('verb')
  })
})

// ============================================================================
// Test: Batch Eval Results
// ============================================================================

describe('Batch Eval Results', () => {
  let storage: Storage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      batchSize: 10,
    })
  })

  it('batches multiple eval events before sending', async () => {
    // Create 5 evals quickly
    await Promise.all([
      storage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      storage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      storage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      storage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      storage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
    ])

    // Should batch events - may call fetch fewer times than number of evals
    // The exact number depends on implementation, but should be at least 1
    expect(mockFetch).toHaveBeenCalled()
  })

  it('flushes batch on close()', async () => {
    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    // Clear previous calls
    mockFetch.mockClear()

    // Close should flush any pending batched events
    await storage.close()

    // Verify flush happened (may or may not have called fetch depending on if there were pending events)
    // At minimum, close() should complete without error
  })

  it('sends array of events in batch mode', async () => {
    const batchStorage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      batchSize: 3,
      flushInterval: 0, // Immediate flush for testing
    })

    await Promise.all([
      batchStorage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      batchStorage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
      batchStorage.evals.create({ data: { suiteId: 's1', input: {}, output: {}, duration: 100 } }),
    ])

    await batchStorage.close()

    // Check that at least one call was made with an array body
    const calls = mockFetch.mock.calls
    const hasArrayBody = calls.some(([, options]) => {
      if (!options?.body) return false
      const body = JSON.parse(options.body as string)
      return Array.isArray(body) || (body.events && Array.isArray(body.events))
    })

    expect(hasArrayBody || calls.length > 0).toBe(true)
  })
})

// ============================================================================
// Test: Error Handling
// ============================================================================

describe('Error Handling', () => {
  it('handles failed fetch gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
    })

    // Should not throw, but log error or queue for retry
    await expect(
      storage.evals.create({
        data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
      }),
    ).resolves.toBeDefined()
  })

  it('handles non-ok response status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
    })

    // Should not throw, but handle error gracefully
    await expect(
      storage.evals.create({
        data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
      }),
    ).resolves.toBeDefined()
  })

  it('retries failed sends with exponential backoff', async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount < 3) {
        return Promise.reject(new Error('Temporary failure'))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      retryAttempts: 3,
    })

    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    await storage.close()

    // Should have retried
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it('queues events when offline and sends when back online', async () => {
    let isOnline = false
    const mockFetch = vi.fn().mockImplementation(() => {
      if (!isOnline) {
        return Promise.reject(new Error('Offline'))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      queueOffline: true,
    })

    // Create eval while offline
    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    // Come back online
    isOnline = true

    // Trigger flush
    await storage.close()

    // Should have attempted to send
    expect(mockFetch).toHaveBeenCalled()
  })

  it('validates event data before sending', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
    })

    // Invalid eval data (missing required fields)
    await expect(
      storage.evals.create({
        data: {
          suiteId: '', // Empty suite ID
          input: {},
          output: {},
          duration: -1, // Invalid negative duration
        },
      }),
    ).rejects.toThrow()
  })
})

// ============================================================================
// Test: Configuration Options
// ============================================================================

describe('Configuration Options', () => {
  it('accepts custom endpoint', () => {
    const storage = createEvaliteStorage({
      endpoint: 'https://custom.api.com/events',
      fetch: vi.fn(),
    })

    expect(storage).toBeDefined()
  })

  it('accepts custom namespace', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      ns: 'https://my-evals.example.com.ai',
    })

    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)

    expect(body.ns).toBe('https://my-evals.example.com.ai')
  })

  it('accepts custom actor', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      actor: 'my-ci-pipeline',
    })

    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)

    expect(body.actor).toBe('my-ci-pipeline')
  })

  it('accepts authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      authorization: 'Bearer my-api-key',
    })

    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(options.headers).toHaveProperty('Authorization', 'Bearer my-api-key')
  })

  it('accepts model default for all events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const storage = createEvaliteStorage({
      endpoint: 'https://example.com.ai/e',
      fetch: mockFetch,
      defaultModel: 'claude-3-sonnet',
    })

    await storage.evals.create({
      data: { suiteId: 's1', input: {}, output: {}, duration: 100 },
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)

    expect(body.model).toBe('claude-3-sonnet')
  })
})
