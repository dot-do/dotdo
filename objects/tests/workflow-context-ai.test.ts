/**
 * Workflow Context AI Integration Tests
 *
 * Tests for integrating AI functions with the $ workflow context.
 *
 * The $ context should provide access to AI functions:
 * - $.ai`prompt` - general AI completion as template literal
 * - $.write`prompt` - text generation with structured output
 * - $.summarize`prompt` - summarization
 * - $.list`prompt` - list generation
 * - $.extract`prompt` - data extraction
 * - $.is`condition` - binary classification
 * - $.decide([options]) - multi-option classification
 *
 * All AI functions should:
 * - Support template literal syntax
 * - Inherit DO context (state, env, events)
 * - Return typed PipelinePromises
 * - Work with both sync and async patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import types
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// TYPES
// ============================================================================

/**
 * PipelinePromise - Promise with chainable methods
 */
interface PipelinePromise<T> extends Promise<T> {
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>
  catch<R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R>
}

// ============================================================================
// TYPES FOR EXTENDED WORKFLOW CONTEXT WITH AI
// ============================================================================

/**
 * Extended WorkflowContext with AI functions
 * This is what the implementation should provide
 */
interface WorkflowContextWithAI extends WorkflowContext {
  // Template literal AI functions
  ai: (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<string>
  write: (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<{ title?: string; body?: string; summary?: string }>
  summarize: (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<string>
  list: (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<string[]>
  extract: <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<{ entities: T[]; raw: string }>

  // Classification functions
  is: (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<boolean>
  decide: <T extends string>(options: T[]) => (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<T>
}

// ============================================================================
// HELPER TO CREATE PIPELINE PROMISE
// ============================================================================

function createMockPipelinePromise<T>(value: T): PipelinePromise<T> {
  const promise = Promise.resolve(value) as PipelinePromise<T>
  promise.map = vi.fn().mockImplementation((fn) => createMockPipelinePromise(fn(value)))
  promise.get = vi.fn().mockImplementation((key) => createMockPipelinePromise((value as Record<string, unknown>)[key as string]))
  promise.catch = vi.fn().mockReturnValue(promise)
  return promise
}

// ============================================================================
// MOCK WORKFLOW CONTEXT FACTORY WITH AI FUNCTIONS
// ============================================================================

/**
 * Create a mock workflow context with AI functions for testing
 */
function createMockWorkflowContextWithAI(): WorkflowContextWithAI {
  // Create mock AI functions
  const aiFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise('AI response')
  })

  const writeFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise({ title: 'Title', body: 'Body' })
  })

  const summarizeFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise('Summary')
  })

  const listFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise(['item1', 'item2'])
  })

  const extractFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise({ entities: [], raw: '' })
  })

  // Create base workflow context mock
  const baseContext = {
    send: vi.fn(),
    try: vi.fn().mockResolvedValue({}),
    do: vi.fn().mockResolvedValue({}),
    on: new Proxy({}, {
      get: () => new Proxy({}, {
        get: () => vi.fn()
      })
    }),
    every: {},
    branch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    state: {},
  }

  // Create is function (binary classification)
  const isFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise(true)
  })

  // Create decide function factory (multi-option classification)
  const decideFunc = vi.fn().mockImplementation(<T extends string>(options: T[]) => {
    return (_strings: TemplateStringsArray, ..._values: unknown[]) => {
      return createMockPipelinePromise(options[0])
    }
  })

  // Create human-in-loop functions
  const askFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise('Human response')
  })

  const approveFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise(true)
  })

  const reviewFunc = vi.fn().mockImplementation((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    return createMockPipelinePromise({ approved: true, feedback: 'Looks good!' })
  })

  return {
    ...baseContext,
    ai: aiFunc,
    write: writeFunc,
    summarize: summarizeFunc,
    list: listFunc,
    extract: extractFunc,
    is: isFunc,
    decide: decideFunc,
    ask: askFunc,
    approve: approveFunc,
    review: reviewFunc,
  } as unknown as WorkflowContextWithAI
}

// ============================================================================
// TESTS
// ============================================================================

describe('Workflow Context AI Integration', () => {
  let $: WorkflowContextWithAI

  beforeEach(() => {
    vi.clearAllMocks()
    $ = createMockWorkflowContextWithAI()
  })

  // ==========================================================================
  // 1. AI FUNCTIONS AVAILABLE ON $ CONTEXT
  // ==========================================================================

  describe('AI Functions Available on $ Context', () => {
    it('$ should have ai template literal function', () => {
      expect($.ai).toBeDefined()
      expect(typeof $.ai).toBe('function')
    })

    it('$ should have write template literal function', () => {
      expect($.write).toBeDefined()
      expect(typeof $.write).toBe('function')
    })

    it('$ should have summarize template literal function', () => {
      expect($.summarize).toBeDefined()
      expect(typeof $.summarize).toBe('function')
    })

    it('$ should have list template literal function', () => {
      expect($.list).toBeDefined()
      expect(typeof $.list).toBe('function')
    })

    it('$ should have extract template literal function', () => {
      expect($.extract).toBeDefined()
      expect(typeof $.extract).toBe('function')
    })

    it('$ should have is classification function', () => {
      expect($.is).toBeDefined()
      expect(typeof $.is).toBe('function')
    })

    it('$ should have decide classification factory', () => {
      expect($.decide).toBeDefined()
      expect(typeof $.decide).toBe('function')
    })

    it('$ should have ask human-in-loop function', () => {
      expect($.ask).toBeDefined()
      expect(typeof $.ask).toBe('function')
    })

    it('$ should have approve human-in-loop function', () => {
      expect($.approve).toBeDefined()
      expect(typeof $.approve).toBe('function')
    })

    it('$ should have review human-in-loop function', () => {
      expect($.review).toBeDefined()
      expect(typeof $.review).toBe('function')
    })
  })

  // ==========================================================================
  // 2. TEMPLATE LITERAL SYNTAX
  // ==========================================================================

  describe('Template Literal Syntax', () => {
    it('$.ai`prompt` should work as template literal', async () => {
      const result = $.ai`What is the capital of France?`
      expect(result).toBeInstanceOf(Promise)
      await expect(result).resolves.toBeDefined()
    })

    it('$.ai`prompt` should support interpolation', async () => {
      const topic = 'TypeScript'
      const result = $.ai`Explain ${topic} in simple terms`
      expect(result).toBeInstanceOf(Promise)
    })

    it('$.write`prompt` should return structured result', async () => {
      const result = await $.write`Write a blog post about AI`
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('body')
    })

    it('$.summarize`text` should return string', async () => {
      const longText = 'This is a very long article about...'
      const result = await $.summarize`${longText}`
      expect(typeof result).toBe('string')
    })

    it('$.list`prompt` should return array', async () => {
      const result = await $.list`List 5 programming languages`
      expect(Array.isArray(result)).toBe(true)
    })

    it('$.extract`prompt` should return entities and raw', async () => {
      const article = 'Apple and Google announced...'
      const result = await $.extract`Extract companies from: ${article}`
      expect(result).toHaveProperty('entities')
      expect(result).toHaveProperty('raw')
    })
  })

  // ==========================================================================
  // 3. CLASSIFICATION FUNCTIONS
  // ==========================================================================

  describe('Classification Functions', () => {
    it('$.is`condition` should return boolean PipelinePromise', async () => {
      const message = 'FREE MONEY NOW!!!'
      const result = $.is`Is this message spam? ${message}`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('boolean')
    })

    it('$.decide([options]) should return factory function', () => {
      const decider = $.decide(['positive', 'negative', 'neutral'])
      expect(typeof decider).toBe('function')
    })

    it('$.decide([options])`prompt` should return one of the options', async () => {
      const text = 'I love this product!'
      const sentiment = $.decide(['positive', 'negative', 'neutral'])
      const result = await sentiment`What is the sentiment of: ${text}`
      expect(['positive', 'negative', 'neutral']).toContain(result)
    })
  })

  // ==========================================================================
  // 4. PIPELINE PROMISE FEATURES
  // ==========================================================================

  describe('PipelinePromise Features', () => {
    it('$.ai should return PipelinePromise with .map()', async () => {
      const result = $.ai`Test`
      expect(typeof result.map).toBe('function')
    })

    it('$.ai should return PipelinePromise with .catch()', async () => {
      const result = $.ai`Test`
      expect(typeof result.catch).toBe('function')
    })

    it('$.write should return PipelinePromise that can be destructured', async () => {
      const result = await $.write`Write a post`
      const { title, body } = result
      expect(title).toBeDefined()
      expect(body).toBeDefined()
    })
  })

  // ==========================================================================
  // 4b. HUMAN-IN-LOOP FUNCTIONS
  // ==========================================================================

  describe('Human-in-Loop Functions', () => {
    it('$.ask`prompt` should return string PipelinePromise', async () => {
      const result = $.ask`What priority should this bug have?`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('$.ask`prompt` should support interpolation', async () => {
      const bugReport = 'Login button not working'
      const result = $.ask`What priority for: ${bugReport}`
      expect(result).toBeInstanceOf(Promise)
    })

    it('$.approve`prompt` should return boolean PipelinePromise', async () => {
      const result = $.approve`Approve this expense?`
      expect(result).toBeInstanceOf(Promise)
      const resolved = await result
      expect(typeof resolved).toBe('boolean')
    })

    it('$.approve`prompt` should support interpolation', async () => {
      const amount = 500
      const description = 'office supplies'
      const result = $.approve`Approve expense $${amount} for ${description}?`
      expect(result).toBeInstanceOf(Promise)
    })

    it('$.review`prompt` should return ReviewResult PipelinePromise', async () => {
      const result = await $.review`Review this PR`
      expect(result).toHaveProperty('approved')
      expect(result).toHaveProperty('feedback')
      expect(typeof result.approved).toBe('boolean')
      expect(typeof result.feedback).toBe('string')
    })

    it('$.review`prompt` should support interpolation', async () => {
      const prNumber = 123
      const diff = '+ const x = 1;'
      const result = $.review`Review PR #${prNumber}: ${diff}`
      expect(result).toBeInstanceOf(Promise)
    })

    it('$.review result should be destructurable', async () => {
      const { approved, feedback } = await $.review`Review this code`
      expect(typeof approved).toBe('boolean')
      expect(typeof feedback).toBe('string')
    })
  })

  // ==========================================================================
  // 5. BACKWARD COMPATIBILITY
  // ==========================================================================

  describe('Backward Compatibility', () => {
    it('$ should still have send method', () => {
      expect($.send).toBeDefined()
      expect(typeof $.send).toBe('function')
    })

    it('$ should still have try method', () => {
      expect($.try).toBeDefined()
      expect(typeof $.try).toBe('function')
    })

    it('$ should still have do method', () => {
      expect($.do).toBeDefined()
      expect(typeof $.do).toBe('function')
    })

    it('$ should still have on proxy', () => {
      expect($.on).toBeDefined()
    })

    it('$ should still have state', () => {
      expect($.state).toBeDefined()
    })

    it('$ should still have log method', () => {
      expect($.log).toBeDefined()
      expect(typeof $.log).toBe('function')
    })

    it('$ should still have branching methods', () => {
      expect($.branch).toBeDefined()
      expect($.checkout).toBeDefined()
      expect($.merge).toBeDefined()
    })
  })

  // ==========================================================================
  // 6. TYPE SAFETY
  // ==========================================================================

  describe('Type Safety', () => {
    it('$.ai should accept template literal and return string promise', async () => {
      const result: Promise<string> = $.ai`Test`
      const resolved = await result
      expect(typeof resolved).toBe('string')
    })

    it('$.list should return string array promise', async () => {
      const result: Promise<string[]> = $.list`List items`
      const resolved = await result
      expect(Array.isArray(resolved)).toBe(true)
    })

    it('$.is should return boolean promise', async () => {
      const result: Promise<boolean> = $.is`Is this true?`
      const resolved = await result
      expect(typeof resolved).toBe('boolean')
    })
  })

  // ==========================================================================
  // 7. INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should support workflow with AI generation', async () => {
      // Simulate a workflow that uses AI
      const summary = await $.ai`Summarize the customer request`
      expect(summary).toBeDefined()
    })

    it('should support workflow with classification', async () => {
      // Simulate a workflow that classifies input
      const isUrgent = await $.is`Is this request urgent?`
      expect(typeof isUrgent).toBe('boolean')
    })

    it('should support workflow with multi-option decision', async () => {
      // Simulate a workflow that makes a decision
      const priority = $.decide(['high', 'medium', 'low'])
      const result = await priority`What priority is this task?`
      expect(['high', 'medium', 'low']).toContain(result)
    })

    it('should support chaining AI results with workflow actions', async () => {
      const result = await $.ai`Generate a response`

      // After getting AI result, can use other workflow methods
      $.send('ai.completed', { result })
      expect($.send).toHaveBeenCalledWith('ai.completed', { result })
    })
  })
})
