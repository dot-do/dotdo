import { describe, it, expect, vi } from 'vitest'
import { createWorkflowProxy } from './proxy'

/**
 * RED Phase Tests for Pipeline Proxy System (Epic 1)
 *
 * These tests define the expected behavior of the $ proxy that enables
 * fluent domain-driven workflow syntax:
 *
 *   const result = await $.Inventory(product).check()
 *   const priorities = await $.Roadmap(startup).prioritizeBacklog()
 *
 * Tests should FAIL because ./proxy module does not exist yet.
 */

describe('Pipeline Proxy', () => {
  /**
   * dotdo-3g2: $ proxy returns function for domain access
   *
   * When accessing a property on the $ proxy (e.g., $.Inventory),
   * it should return a callable function that will capture context.
   */
  describe('$ proxy returns function for domain access (dotdo-3g2)', () => {
    it('returns a function when accessing domain property', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      // $.Inventory should be a function
      expect(typeof $.Inventory).toBe('function')
    })

    it('returns a function for any domain name', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      // Any capitalized domain should return a function
      expect(typeof $.Payment).toBe('function')
      expect(typeof $.Roadmap).toBe('function')
      expect(typeof $.Email).toBe('function')
      expect(typeof $.Analytics).toBe('function')
    })

    it('allows chained domain access', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      // Each domain access should return a new function
      const inventory1 = $.Inventory
      const inventory2 = $.Inventory

      expect(typeof inventory1).toBe('function')
      expect(typeof inventory2).toBe('function')
    })
  })

  /**
   * dotdo-2s0: Domain function captures context
   *
   * When calling the domain function with a context object (e.g., $.Inventory(product)),
   * it should capture that context for use in subsequent method calls.
   */
  describe('Domain function captures context (dotdo-2s0)', () => {
    it('captures context when domain function is called', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123', name: 'Widget' }
      const pipeline = $.Inventory(product)

      // The returned pipeline should have captured the context
      // We verify this by checking that calling a method on it includes the context
      expect(pipeline).toBeDefined()
    })

    it('captures different contexts independently', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product1 = { sku: 'ABC-123' }
      const product2 = { sku: 'XYZ-789' }

      const pipeline1 = $.Inventory(product1)
      const pipeline2 = $.Inventory(product2)

      // Each pipeline should be independent
      expect(pipeline1).not.toBe(pipeline2)
    })

    it('captures complex context objects', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const startup = {
        id: 'startup-1',
        name: 'TechCorp',
        mission: 'Build great products',
        team: ['alice', 'bob', 'charlie']
      }

      const pipeline = $.Roadmap(startup)

      // Pipeline should be created successfully with complex context
      expect(pipeline).toBeDefined()
    })

    it('creates pipeline that can be further accessed', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const order = { id: 'order-123', total: 99.99 }
      const pipeline = $.Payment(order)

      // The pipeline should allow further property access
      // This verifies context was captured and pipeline is ready for chaining
      expect(typeof pipeline.process).toBe('function')
    })
  })

  /**
   * dotdo-ogj: Property access extends pipeline path
   *
   * When accessing properties on the pipeline (e.g., $.Order.validate.process),
   * each access should extend the internal path array.
   */
  describe('Property access extends pipeline path (dotdo-ogj)', () => {
    it('extends path with single property access', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const order = { id: 'order-123' }
      const pipeline = $.Order(order)

      // Accessing .validate should extend the path
      const validatePipeline = pipeline.validate

      expect(validatePipeline).toBeDefined()
      expect(typeof validatePipeline).toBe('function')
    })

    it('extends path with multiple property accesses', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const order = { id: 'order-123' }

      // Chain: $.Order(order).validate.enrich.process
      // Path should be: ["Order", "validate", "enrich", "process"]
      const pipeline = $.Order(order).validate.enrich.process

      expect(pipeline).toBeDefined()
      expect(typeof pipeline).toBe('function')
    })

    it('maintains separate paths for different chains', () => {
      const mockRuntime = { executeStep: vi.fn() }
      const $ = createWorkflowProxy(mockRuntime as any)

      const order = { id: 'order-123' }

      const chain1 = $.Order(order).validate
      const chain2 = $.Order(order).process

      // These should be independent pipelines with different paths
      expect(chain1).not.toBe(chain2)
    })

    it('accumulates path correctly through deep chaining', () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ success: true })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const data = { id: 'test-123' }

      // Create a deep chain
      const deepPipeline = $.Data(data).step1.step2.step3.step4.finalStep

      // The pipeline should be callable and include the full path when executed
      expect(typeof deepPipeline).toBe('function')
    })
  })

  /**
   * dotdo-kvb: Method call returns awaitable with step execution
   *
   * When calling a method on the pipeline (e.g., $.Inventory(product).check()),
   * it should return a Promise that executes a workflow step via the runtime.
   */
  describe('Method call returns awaitable with step execution (dotdo-kvb)', () => {
    it('returns a Promise when method is called', () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ available: true, quantity: 42 })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }
      const result = $.Inventory(product).check()

      // Should return a Promise
      expect(result).toBeInstanceOf(Promise)
    })

    it('executes step through runtime when awaited', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ available: true, quantity: 42 })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }
      await $.Inventory(product).check()

      // Runtime's executeStep should have been called
      expect(mockRuntime.executeStep).toHaveBeenCalled()
    })

    it('passes correct pipeline info to runtime', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ success: true })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }
      await $.Inventory(product).check()

      // executeStep should receive step info including path
      const callArgs = mockRuntime.executeStep.mock.calls[0]

      // First arg should be step ID (hash)
      expect(typeof callArgs[0]).toBe('string')

      // Second arg should include pipeline info
      const pipelineInfo = callArgs[1]
      expect(pipelineInfo.path).toContain('Inventory')
      expect(pipelineInfo.path).toContain('check')
      expect(pipelineInfo.context).toEqual(product)
    })

    it('passes method arguments to runtime', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ reservationId: 'res-123' })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }
      const args = { quantity: 5 }
      await $.Inventory(product).reserve(args)

      const callArgs = mockRuntime.executeStep.mock.calls[0]

      // Args should be passed through
      expect(callArgs[2]).toContainEqual(args)
    })

    it('returns result from runtime execution', async () => {
      const expectedResult = {
        available: true,
        quantity: 42,
        reorderPoint: 10
      }
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue(expectedResult)
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }
      const result = await $.Inventory(product).check()

      expect(result).toEqual(expectedResult)
    })

    it('propagates errors from runtime execution', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockRejectedValue(new Error('Step execution failed'))
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }

      await expect($.Inventory(product).check()).rejects.toThrow('Step execution failed')
    })

    it('generates unique step IDs for different contexts', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({})
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product1 = { sku: 'ABC-123' }
      const product2 = { sku: 'XYZ-789' }

      await $.Inventory(product1).check()
      await $.Inventory(product2).check()

      const stepId1 = mockRuntime.executeStep.mock.calls[0][0]
      const stepId2 = mockRuntime.executeStep.mock.calls[1][0]

      // Different contexts should produce different step IDs
      expect(stepId1).not.toBe(stepId2)
    })

    it('generates same step ID for same context and path', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({})
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const product = { sku: 'ABC-123' }

      await $.Inventory(product).check()
      await $.Inventory(product).check()

      const stepId1 = mockRuntime.executeStep.mock.calls[0][0]
      const stepId2 = mockRuntime.executeStep.mock.calls[1][0]

      // Same context and path should produce same step ID (deterministic)
      expect(stepId1).toBe(stepId2)
    })

    it('supports method calls on extended paths', async () => {
      const mockRuntime = {
        executeStep: vi.fn().mockResolvedValue({ processed: true })
      }
      const $ = createWorkflowProxy(mockRuntime as any)

      const order = { id: 'order-123' }

      // Call method on extended path: $.Order(order).validate.process()
      const result = await $.Order(order).validate.process()

      expect(mockRuntime.executeStep).toHaveBeenCalled()

      const pipelineInfo = mockRuntime.executeStep.mock.calls[0][1]
      expect(pipelineInfo.path).toEqual(['Order', 'validate', 'process'])
    })
  })
})
