/**
 * Modifier API Tests
 *
 * RED TDD: Tests for the modifier API that allows transforming inputs/outputs
 * of workflow steps.
 *
 * Modifiers provide:
 * - modifier() factory to create modifiers
 * - .input(fn) to transform input before step
 * - .output(fn) to transform output after step
 * - Chainable API
 * - Conditional modifiers
 * - Integration with WorkflowRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// These imports will FAIL until implementation exists
import {
  modifier,
  type Modifier,
  type ModifierFunction,
  type ModifierConfig,
  inputModifier,
  outputModifier,
  conditionalModifier,
} from '../Modifier'

import { WorkflowRuntime, type WorkflowStepConfig } from '../WorkflowRuntime'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null } = { time: null }

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      getAlarm: vi.fn(async () => alarms.time),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarms.time = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarms.time = null
      }),
    },
    alarms,
    _storage: storage,
  }
}

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-modifier-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Modifier API', () => {
  // ==========================================================================
  // 1. BASIC MODIFIER CREATION
  // ==========================================================================

  describe('Basic Modifier Creation', () => {
    it('creates a modifier with modifier() factory', () => {
      const mod = modifier()

      expect(mod).toBeDefined()
      expect(typeof mod.input).toBe('function')
      expect(typeof mod.output).toBe('function')
    })

    it('modifier has a name property when provided', () => {
      const mod = modifier({ name: 'my-modifier' })

      expect(mod.name).toBe('my-modifier')
    })

    it('modifier has default name when not provided', () => {
      const mod = modifier()

      expect(mod.name).toBeDefined()
      expect(typeof mod.name).toBe('string')
    })

    it('modifier is immutable - returns new instance on chaining', () => {
      const mod1 = modifier()
      const mod2 = mod1.input((x) => x)

      expect(mod1).not.toBe(mod2)
    })

    it('modifier supports config object', () => {
      const config: ModifierConfig = {
        name: 'validated-modifier',
        description: 'Validates input data',
      }

      const mod = modifier(config)

      expect(mod.name).toBe('validated-modifier')
      expect(mod.description).toBe('Validates input data')
    })
  })

  // ==========================================================================
  // 2. INPUT MODIFIER TESTS
  // ==========================================================================

  describe('Input Modifiers', () => {
    it('transforms input with .input() method', async () => {
      const mod = modifier().input((input: { value: number }) => ({
        ...input,
        doubled: input.value * 2,
      }))

      const result = await mod.applyInput({ value: 5 })

      expect(result).toEqual({ value: 5, doubled: 10 })
    })

    it('supports async input transformers', async () => {
      const mod = modifier().input(async (input: { id: string }) => {
        // Simulate async lookup
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { ...input, resolved: true }
      })

      const result = await mod.applyInput({ id: '123' })

      expect(result).toEqual({ id: '123', resolved: true })
    })

    it('validates input and throws on invalid data', async () => {
      const validateInput = modifier().input((input: { orderId?: string }) => {
        if (!input.orderId) {
          throw new Error('Missing orderId')
        }
        return input
      })

      await expect(validateInput.applyInput({})).rejects.toThrow('Missing orderId')
    })

    it('chains multiple input modifiers', async () => {
      const mod = modifier()
        .input((input: { a: number }) => ({ ...input, b: input.a + 1 }))
        .input((input: { a: number; b: number }) => ({ ...input, c: input.b + 1 }))

      const result = await mod.applyInput({ a: 1 })

      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('input modifier receives context', async () => {
      let receivedContext: unknown = null

      const mod = modifier().input((input, ctx) => {
        receivedContext = ctx
        return input
      })

      await mod.applyInput({ data: 'test' }, { stepName: 'myStep', stepIndex: 0 })

      expect(receivedContext).toBeDefined()
      expect((receivedContext as { stepName: string }).stepName).toBe('myStep')
    })

    it('inputModifier helper creates input-only modifier', async () => {
      const validateOrder = inputModifier((input: { items?: unknown[] }) => {
        if (!input.items || input.items.length === 0) {
          throw new Error('Order must have items')
        }
        return input
      })

      await expect(validateOrder.applyInput({ items: [] })).rejects.toThrow('Order must have items')

      const validResult = await validateOrder.applyInput({ items: ['item1'] })
      expect(validResult).toEqual({ items: ['item1'] })
    })
  })

  // ==========================================================================
  // 3. OUTPUT MODIFIER TESTS
  // ==========================================================================

  describe('Output Modifiers', () => {
    it('transforms output with .output() method', async () => {
      const addTimestamp = modifier().output((result: Record<string, unknown>) => ({
        ...result,
        timestamp: Date.now(),
      }))

      const result = await addTimestamp.applyOutput({ data: 'test' })

      expect(result.data).toBe('test')
      expect(result.timestamp).toBeDefined()
      expect(typeof result.timestamp).toBe('number')
    })

    it('supports async output transformers', async () => {
      const mod = modifier().output(async (result: { id: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { ...result, enriched: true }
      })

      const result = await mod.applyOutput({ id: '456' })

      expect(result).toEqual({ id: '456', enriched: true })
    })

    it('chains multiple output modifiers', async () => {
      const mod = modifier()
        .output((result: { x: number }) => ({ ...result, y: result.x * 2 }))
        .output((result: { x: number; y: number }) => ({ ...result, z: result.y * 2 }))

      const result = await mod.applyOutput({ x: 5 })

      expect(result).toEqual({ x: 5, y: 10, z: 20 })
    })

    it('output modifier receives original input and context', async () => {
      let receivedInput: unknown = null
      let receivedContext: unknown = null

      const mod = modifier().output((result, input, ctx) => {
        receivedInput = input
        receivedContext = ctx
        return result
      })

      await mod.applyOutput({ result: 'done' }, { originalInput: true }, { stepName: 'test' })

      expect(receivedInput).toEqual({ originalInput: true })
      expect((receivedContext as { stepName: string }).stepName).toBe('test')
    })

    it('outputModifier helper creates output-only modifier', async () => {
      const addMetadata = outputModifier((result: Record<string, unknown>) => ({
        ...result,
        processedAt: new Date().toISOString(),
        version: '1.0',
      }))

      const result = await addMetadata.applyOutput({ data: 'test' })

      expect(result.data).toBe('test')
      expect(result.processedAt).toBeDefined()
      expect(result.version).toBe('1.0')
    })
  })

  // ==========================================================================
  // 4. MODIFIER CHAINING TESTS
  // ==========================================================================

  describe('Modifier Chaining', () => {
    it('chains input and output modifiers', async () => {
      const mod = modifier()
        .input((input: { value: number }) => ({ ...input, preprocessed: true }))
        .output((result: Record<string, unknown>) => ({ ...result, postprocessed: true }))

      const inputResult = await mod.applyInput({ value: 10 })
      expect(inputResult).toEqual({ value: 10, preprocessed: true })

      const outputResult = await mod.applyOutput({ result: 'done' })
      expect(outputResult).toEqual({ result: 'done', postprocessed: true })
    })

    it('allows arbitrary chaining order', async () => {
      const mod = modifier()
        .output((r: Record<string, unknown>) => ({ ...r, out1: true }))
        .input((i: Record<string, unknown>) => ({ ...i, in1: true }))
        .output((r: Record<string, unknown>) => ({ ...r, out2: true }))
        .input((i: Record<string, unknown>) => ({ ...i, in2: true }))

      const inputResult = await mod.applyInput({})
      expect(inputResult).toEqual({ in1: true, in2: true })

      const outputResult = await mod.applyOutput({})
      expect(outputResult).toEqual({ out1: true, out2: true })
    })

    it('compose() combines multiple modifiers', async () => {
      const mod1 = modifier().input((i: { a: number }) => ({ ...i, b: 1 }))
      const mod2 = modifier().input((i: { a: number; b: number }) => ({ ...i, c: 2 }))
      const mod3 = modifier().output((r: Record<string, unknown>) => ({ ...r, d: 3 }))

      const composed = mod1.compose(mod2, mod3)

      const inputResult = await composed.applyInput({ a: 0 })
      expect(inputResult).toEqual({ a: 0, b: 1, c: 2 })

      const outputResult = await composed.applyOutput({})
      expect(outputResult).toEqual({ d: 3 })
    })

    it('maintains modifier identity through chaining', () => {
      const original = modifier({ name: 'original' })
      const chained = original
        .input((x) => x)
        .output((x) => x)

      // Name should be preserved through chaining
      expect(chained.name).toBe('original')
    })
  })

  // ==========================================================================
  // 5. CONDITIONAL MODIFIERS TESTS
  // ==========================================================================

  describe('Conditional Modifiers', () => {
    it('conditionalModifier applies only when condition is true', async () => {
      const mod = conditionalModifier(
        (input: { shouldModify?: boolean }) => input.shouldModify === true,
        modifier().input((i: Record<string, unknown>) => ({ ...i, modified: true }))
      )

      const resultWhenTrue = await mod.applyInput({ shouldModify: true })
      expect(resultWhenTrue).toEqual({ shouldModify: true, modified: true })

      const resultWhenFalse = await mod.applyInput({ shouldModify: false })
      expect(resultWhenFalse).toEqual({ shouldModify: false })
    })

    it('supports .when() method for conditional application', async () => {
      const mod = modifier()
        .input((i: Record<string, unknown>) => ({ ...i, enhanced: true }))
        .when((input: { enableEnhancement?: boolean }) => input.enableEnhancement === true)

      const resultWhenEnabled = await mod.applyInput({ enableEnhancement: true })
      expect(resultWhenEnabled).toEqual({ enableEnhancement: true, enhanced: true })

      const resultWhenDisabled = await mod.applyInput({ enableEnhancement: false })
      expect(resultWhenDisabled).toEqual({ enableEnhancement: false })
    })

    it('conditional modifier evaluates condition for each invocation', async () => {
      let callCount = 0
      const mod = conditionalModifier(
        () => {
          callCount++
          return callCount % 2 === 1 // true on odd calls
        },
        modifier().input((i: Record<string, unknown>) => ({ ...i, transformed: true }))
      )

      const result1 = await mod.applyInput({ call: 1 })
      const result2 = await mod.applyInput({ call: 2 })
      const result3 = await mod.applyInput({ call: 3 })

      expect(result1).toEqual({ call: 1, transformed: true })
      expect(result2).toEqual({ call: 2 }) // Not transformed
      expect(result3).toEqual({ call: 3, transformed: true })
    })

    it('conditional applies to both input and output', async () => {
      const mod = modifier()
        .input((i: Record<string, unknown>) => ({ ...i, inMod: true }))
        .output((r: Record<string, unknown>) => ({ ...r, outMod: true }))
        .when((input: { active?: boolean }) => input.active === true)

      // When active
      const activeInput = await mod.applyInput({ active: true })
      const activeOutput = await mod.applyOutput({}, { active: true })

      expect(activeInput).toEqual({ active: true, inMod: true })
      expect(activeOutput).toEqual({ outMod: true })

      // When not active
      const inactiveInput = await mod.applyInput({ active: false })
      const inactiveOutput = await mod.applyOutput({}, { active: false })

      expect(inactiveInput).toEqual({ active: false })
      expect(inactiveOutput).toEqual({})
    })
  })

  // ==========================================================================
  // 6. WORKFLOW RUNTIME INTEGRATION TESTS
  // ==========================================================================

  describe('WorkflowRuntime Integration', () => {
    let mockState: ReturnType<typeof createMockState>
    let runtime: WorkflowRuntime

    beforeEach(() => {
      mockState = createMockState()
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('registerStep accepts modifiers in config', () => {
      const validateInput = modifier().input((input: { orderId?: string }) => {
        if (!input.orderId) throw new Error('Missing orderId')
        return input
      })

      runtime.registerStep(
        'process',
        async (ctx) => ({ processed: true }),
        { modifiers: [validateInput] }
      )

      expect(runtime.steps[0].config?.modifiers).toHaveLength(1)
    })

    it('step() fluent API accepts modifiers', () => {
      const addTimestamp = modifier().output((r: Record<string, unknown>) => ({
        ...r,
        timestamp: Date.now(),
      }))

      runtime.step(
        'process',
        async () => ({ result: 'done' }),
        { modifiers: [addTimestamp] }
      )

      expect(runtime.steps[0].config?.modifiers).toBeDefined()
    })

    it('input modifier is applied before step execution', async () => {
      const executionOrder: string[] = []

      const inputMod = modifier().input((input: Record<string, unknown>) => {
        executionOrder.push('input-modifier')
        return { ...input, modified: true }
      })

      runtime.registerStep(
        'check',
        async (ctx) => {
          executionOrder.push('step')
          return { receivedModified: (ctx.input as { modified?: boolean }).modified }
        },
        { modifiers: [inputMod] }
      )

      const result = await runtime.start({ original: true })

      expect(executionOrder).toEqual(['input-modifier', 'step'])
      expect(result.output).toEqual({ receivedModified: true })
    })

    it('output modifier is applied after step execution', async () => {
      const executionOrder: string[] = []

      const outputMod = modifier().output((result: Record<string, unknown>) => {
        executionOrder.push('output-modifier')
        return { ...result, postProcessed: true }
      })

      runtime.registerStep(
        'process',
        async () => {
          executionOrder.push('step')
          return { stepResult: 'done' }
        },
        { modifiers: [outputMod] }
      )

      const result = await runtime.start({})

      expect(executionOrder).toEqual(['step', 'output-modifier'])
      expect(result.output).toEqual({ stepResult: 'done', postProcessed: true })
    })

    it('multiple modifiers are applied in order', async () => {
      const order: string[] = []

      const mod1 = modifier()
        .input((i) => {
          order.push('mod1-in')
          return i
        })
        .output((r) => {
          order.push('mod1-out')
          return r
        })

      const mod2 = modifier()
        .input((i) => {
          order.push('mod2-in')
          return i
        })
        .output((r) => {
          order.push('mod2-out')
          return r
        })

      runtime.registerStep(
        'process',
        async () => {
          order.push('step')
          return {}
        },
        { modifiers: [mod1, mod2] }
      )

      await runtime.start({})

      // Input modifiers run first in order, then step, then output modifiers in order
      expect(order).toEqual(['mod1-in', 'mod2-in', 'step', 'mod1-out', 'mod2-out'])
    })

    it('input modifier error prevents step execution', async () => {
      const validateInput = modifier().input((input: { required?: string }) => {
        if (!input.required) throw new Error('Validation failed')
        return input
      })

      runtime.registerStep(
        'process',
        async () => ({ shouldNotRun: true }),
        { modifiers: [validateInput] }
      )

      await expect(runtime.start({})).rejects.toThrow('Validation failed')
      expect(runtime.state).toBe('failed')
    })

    it('output modifier error fails the step', async () => {
      const failingOutput = modifier().output(() => {
        throw new Error('Output processing failed')
      })

      runtime.registerStep(
        'process',
        async () => ({ result: 'done' }),
        { modifiers: [failingOutput] }
      )

      await expect(runtime.start({})).rejects.toThrow('Output processing failed')
    })

    it('modifier receives step context', async () => {
      let receivedContext: unknown = null

      const contextCapture = modifier().input((input, ctx) => {
        receivedContext = ctx
        return input
      })

      runtime.registerStep(
        'myStep',
        async () => ({}),
        { modifiers: [contextCapture] }
      )

      await runtime.start({ testData: true })

      expect(receivedContext).toBeDefined()
      expect((receivedContext as { stepName: string }).stepName).toBe('myStep')
      expect((receivedContext as { stepIndex: number }).stepIndex).toBe(0)
    })

    it('modifiers work across multiple steps', async () => {
      const addPrefix = modifier().output((r: { value?: string }) => ({
        ...r,
        value: `prefixed-${r.value || ''}`,
      }))

      runtime
        .step('step1', async () => ({ value: 'one' }), { modifiers: [addPrefix] })
        .step('step2', async (ctx) => ({
          value: 'two',
          previous: (ctx.previousStepOutput as { value: string }).value,
        }), { modifiers: [addPrefix] })

      const result = await runtime.start({})

      expect(result.output).toEqual({
        value: 'prefixed-two',
        previous: 'prefixed-one',
      })
    })

    it('conditional modifiers respect condition in runtime', async () => {
      const conditionalMod = modifier()
        .input((i: Record<string, unknown>) => ({ ...i, enhanced: true }))
        .when((input: { applyEnhancement?: boolean }) => input.applyEnhancement === true)

      runtime.registerStep(
        'process',
        async (ctx) => ({ received: ctx.input }),
        { modifiers: [conditionalMod] }
      )

      // Test with condition true
      mockState = createMockState()
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
      runtime.registerStep(
        'process',
        async (ctx) => ({ received: ctx.input }),
        { modifiers: [conditionalMod] }
      )
      const resultTrue = await runtime.start({ applyEnhancement: true })
      expect((resultTrue.output as { received: { enhanced?: boolean } }).received.enhanced).toBe(true)

      // Test with condition false
      mockState = createMockState()
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
      runtime.registerStep(
        'process',
        async (ctx) => ({ received: ctx.input }),
        { modifiers: [conditionalMod] }
      )
      const resultFalse = await runtime.start({ applyEnhancement: false })
      expect((resultFalse.output as { received: { enhanced?: boolean } }).received.enhanced).toBeUndefined()
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('modifier errors include context information', async () => {
      const failingMod = modifier({ name: 'failing-modifier' }).input(() => {
        throw new Error('Intentional failure')
      })

      try {
        await failingMod.applyInput({}, { stepName: 'testStep' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('Intentional failure')
      }
    })

    it('modifier chain stops on first error', async () => {
      const callOrder: string[] = []

      const mod = modifier()
        .input(() => {
          callOrder.push('first')
          throw new Error('First modifier failed')
        })
        .input(() => {
          callOrder.push('second')
          return {}
        })

      await expect(mod.applyInput({})).rejects.toThrow('First modifier failed')
      expect(callOrder).toEqual(['first'])
    })

    it('async errors are properly propagated', async () => {
      const asyncFailingMod = modifier().input(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        throw new Error('Async failure')
      })

      await expect(asyncFailingMod.applyInput({})).rejects.toThrow('Async failure')
    })
  })

  // ==========================================================================
  // 8. TYPE SAFETY TESTS
  // ==========================================================================

  describe('Type Safety', () => {
    it('preserves input type through transformation', async () => {
      interface OrderInput {
        orderId: string
        items: string[]
      }

      interface EnhancedOrderInput extends OrderInput {
        itemCount: number
      }

      const mod = modifier().input((input: OrderInput): EnhancedOrderInput => ({
        ...input,
        itemCount: input.items.length,
      }))

      const result = await mod.applyInput({ orderId: '123', items: ['a', 'b'] })

      // TypeScript should infer the correct type
      expect(result.itemCount).toBe(2)
      expect(result.orderId).toBe('123')
    })

    it('preserves output type through transformation', async () => {
      interface StepResult {
        success: boolean
      }

      interface EnrichedResult extends StepResult {
        timestamp: number
        version: string
      }

      const mod = modifier().output((result: StepResult): EnrichedResult => ({
        ...result,
        timestamp: Date.now(),
        version: '1.0',
      }))

      const result = await mod.applyOutput({ success: true })

      expect(result.success).toBe(true)
      expect(typeof result.timestamp).toBe('number')
      expect(result.version).toBe('1.0')
    })
  })

  // ==========================================================================
  // 9. REAL-WORLD USAGE PATTERNS
  // ==========================================================================

  describe('Real-World Usage Patterns', () => {
    it('validation modifier pattern', async () => {
      const validateOrder = modifier({ name: 'order-validator' }).input(
        (input: { orderId?: string; items?: unknown[]; amount?: number }) => {
          if (!input.orderId) throw new Error('Missing orderId')
          if (!input.items || input.items.length === 0) throw new Error('Order must have items')
          if (typeof input.amount !== 'number' || input.amount <= 0)
            throw new Error('Invalid amount')
          return input
        }
      )

      await expect(validateOrder.applyInput({})).rejects.toThrow('Missing orderId')
      await expect(validateOrder.applyInput({ orderId: '1' })).rejects.toThrow('must have items')
      await expect(validateOrder.applyInput({ orderId: '1', items: ['x'], amount: 0 })).rejects.toThrow(
        'Invalid amount'
      )

      const valid = await validateOrder.applyInput({
        orderId: '1',
        items: ['x'],
        amount: 100,
      })
      expect(valid.orderId).toBe('1')
    })

    it('timestamp injection pattern', async () => {
      const addTimestamps = modifier({ name: 'timestamp-injector' })
        .input((input: Record<string, unknown>) => ({
          ...input,
          requestedAt: new Date().toISOString(),
        }))
        .output((result: Record<string, unknown>) => ({
          ...result,
          completedAt: new Date().toISOString(),
        }))

      const inputResult = await addTimestamps.applyInput({ data: 'test' })
      expect(inputResult.requestedAt).toBeDefined()

      const outputResult = await addTimestamps.applyOutput({ result: 'done' })
      expect(outputResult.completedAt).toBeDefined()
    })

    it('logging modifier pattern', async () => {
      const logs: string[] = []

      const logger = modifier({ name: 'step-logger' })
        .input((input: unknown, ctx) => {
          logs.push(`[${ctx?.stepName}] Input: ${JSON.stringify(input)}`)
          return input
        })
        .output((result: unknown, input, ctx) => {
          logs.push(`[${ctx?.stepName}] Output: ${JSON.stringify(result)}`)
          return result
        })

      await logger.applyInput({ test: 1 }, { stepName: 'myStep' })
      await logger.applyOutput({ result: 2 }, undefined, { stepName: 'myStep' })

      expect(logs).toContain('[myStep] Input: {"test":1}')
      expect(logs).toContain('[myStep] Output: {"result":2}')
    })

    it('data normalization pattern', async () => {
      const normalizeInput = modifier({ name: 'input-normalizer' }).input(
        (input: { email?: string; name?: string }) => ({
          ...input,
          email: input.email?.toLowerCase().trim(),
          name: input.name?.trim(),
        })
      )

      const result = await normalizeInput.applyInput({
        email: '  USER@Example.COM  ',
        name: '  John Doe  ',
      })

      expect(result.email).toBe('user@example.com.ai')
      expect(result.name).toBe('John Doe')
    })

    it('result enrichment pattern', async () => {
      const enrichResult = modifier({ name: 'result-enricher' }).output(
        (result: { id: string }) => ({
          ...result,
          metadata: {
            processedBy: 'workflow-engine',
            apiVersion: '2.0',
          },
          links: {
            self: `/api/orders/${result.id}`,
            status: `/api/orders/${result.id}/status`,
          },
        })
      )

      const result = await enrichResult.applyOutput({ id: 'order-123' })

      expect(result.metadata.processedBy).toBe('workflow-engine')
      expect(result.links.self).toBe('/api/orders/order-123')
    })
  })
})
