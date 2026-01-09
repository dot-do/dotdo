/**
 * Tests for Workflow Runtime (Epic 4)
 *
 * Tests the durable execution engine including:
 * - Step execution with different modes (send, try, do)
 * - Step persistence and replay
 * - Retry logic with configurable policies
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkflowRuntime,
  createTestRuntime,
  DurableWorkflowRuntime,
  InMemoryStepStorage,
  HandlerNotFoundError,
  WorkflowStepError,
  type RetryPolicy,
  type StepResult,
  type StepStorage,
} from './runtime'
import { Domain, registerDomain, clearDomainRegistry } from './domain'
import { createWorkflowProxy, type Pipeline } from './proxy'

describe('Workflow Runtime (Epic 4)', () => {
  beforeEach(() => {
    clearDomainRegistry()
  })

  afterEach(() => {
    clearDomainRegistry()
  })

  // ==========================================================================
  // InMemoryStepStorage Tests
  // ==========================================================================

  describe('InMemoryStepStorage', () => {
    it('stores and retrieves step results', async () => {
      const storage = new InMemoryStepStorage()

      const stepResult: StepResult = {
        stepId: 'test-step-1',
        status: 'completed',
        result: { foo: 'bar' },
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      }

      await storage.set('test-step-1', stepResult)
      const retrieved = await storage.get('test-step-1')

      expect(retrieved).toEqual(stepResult)
    })

    it('returns undefined for non-existent steps', async () => {
      const storage = new InMemoryStepStorage()

      const result = await storage.get('non-existent')

      expect(result).toBeUndefined()
    })

    it('deletes step results', async () => {
      const storage = new InMemoryStepStorage()

      const stepResult: StepResult = {
        stepId: 'test-step-1',
        status: 'completed',
        result: 'test',
        attempts: 1,
        createdAt: Date.now(),
      }

      await storage.set('test-step-1', stepResult)
      await storage.delete('test-step-1')

      const retrieved = await storage.get('test-step-1')
      expect(retrieved).toBeUndefined()
    })

    it('lists all step results', async () => {
      const storage = new InMemoryStepStorage()

      await storage.set('step-1', {
        stepId: 'step-1',
        status: 'completed',
        attempts: 1,
        createdAt: Date.now(),
      })
      await storage.set('step-2', {
        stepId: 'step-2',
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
      })

      const results = await storage.list()

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.stepId).sort()).toEqual(['step-1', 'step-2'])
    })

    it('clears all stored results', async () => {
      const storage = new InMemoryStepStorage()

      await storage.set('step-1', {
        stepId: 'step-1',
        status: 'completed',
        attempts: 1,
        createdAt: Date.now(),
      })

      storage.clear()

      const results = await storage.list()
      expect(results).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Runtime Creation Tests
  // ==========================================================================

  describe('createWorkflowRuntime', () => {
    it('creates a runtime with default options', () => {
      const runtime = createWorkflowRuntime()

      expect(runtime).toBeInstanceOf(DurableWorkflowRuntime)
    })

    it('creates a runtime with custom storage', () => {
      const customStorage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage: customStorage })

      expect(runtime).toBeInstanceOf(DurableWorkflowRuntime)
    })

    it('creates a runtime with custom retry policy', () => {
      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 5,
          initialDelayMs: 500,
        },
      })

      expect(runtime).toBeInstanceOf(DurableWorkflowRuntime)
    })
  })

  describe('createTestRuntime', () => {
    it('creates a runtime with no retries', () => {
      const runtime = createTestRuntime()

      expect(runtime).toBeInstanceOf(DurableWorkflowRuntime)
    })
  })

  // ==========================================================================
  // Step Execution Tests
  // ==========================================================================

  describe('executeStep', () => {
    it('executes handler and returns result', async () => {
      // Register a test domain
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          quantity: 42,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(result).toEqual({
        available: true,
        quantity: 42,
        sku: 'ABC-123',
      })
    })

    it('throws HandlerNotFoundError for unknown domain', async () => {
      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Unknown', 'method'],
        context: {},
        contextHash: 'test-hash',
        runtime,
      }

      // Use 'try' mode to get the direct error (not wrapped in WorkflowStepError)
      await expect(runtime.executeStep('step-1', pipeline, [], 'try')).rejects.toThrow(HandlerNotFoundError)
    })

    it('throws HandlerNotFoundError for unknown method', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({}),
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Inventory', 'unknownMethod'],
        context: {},
        contextHash: 'test-hash',
        runtime,
      }

      // Use 'try' mode to get the direct error (not wrapped in WorkflowStepError)
      await expect(runtime.executeStep('step-1', pipeline, [], 'try')).rejects.toThrow(HandlerNotFoundError)
    })

    it('calls onStepStart callback', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      registerDomain(Inventory)

      const onStepStart = vi.fn()
      const runtime = createWorkflowRuntime({ onStepStart })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'try')

      expect(onStepStart).toHaveBeenCalledWith('step-1', pipeline)
    })

    it('calls onStepComplete callback on success', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      registerDomain(Inventory)

      const onStepComplete = vi.fn()
      const runtime = createWorkflowRuntime({ onStepComplete })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'try')

      expect(onStepComplete).toHaveBeenCalledWith('step-1', { available: true })
    })

    it('calls onStepError callback on failure', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => {
          throw new Error('Check failed')
        },
      })
      registerDomain(Inventory)

      const onStepError = vi.fn()
      const runtime = createWorkflowRuntime({
        onStepError,
        retryPolicy: { maxAttempts: 1 },
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'try')).rejects.toThrow('Check failed')
      expect(onStepError).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Execution Mode: try (Quick, Non-Durable)
  // ==========================================================================

  describe('executeStep - try mode', () => {
    it('executes without persistence', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'try')

      // Storage should be empty for 'try' mode
      const stored = await storage.list()
      expect(stored).toHaveLength(0)
    })

    it('does not retry on failure', async () => {
      let attempts = 0
      const Inventory = Domain('Inventory', {
        check: async () => {
          attempts++
          throw new Error('Check failed')
        },
      })
      registerDomain(Inventory)

      const runtime = createWorkflowRuntime({
        retryPolicy: { maxAttempts: 3 },
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'try')).rejects.toThrow('Check failed')

      // Should only attempt once
      expect(attempts).toBe(1)
    })
  })

  // ==========================================================================
  // Execution Mode: do (Durable, With Retries)
  // ==========================================================================

  describe('executeStep - do mode', () => {
    it('persists successful results', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({ available: true }),
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')

      const stored = await storage.get('step-1')
      expect(stored).toBeDefined()
      expect(stored?.status).toBe('completed')
      expect(stored?.result).toEqual({ available: true })
    })

    it('replays from stored results', async () => {
      let executionCount = 0
      const Inventory = Domain('Inventory', {
        check: async () => {
          executionCount++
          return { available: true }
        },
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      // First execution
      await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(executionCount).toBe(1)

      // Second execution should replay from storage
      const result = await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(executionCount).toBe(1) // Should not increment
      expect(result).toEqual({ available: true })
    })

    it('retries on failure with exponential backoff', async () => {
      let attempts = 0
      const Inventory = Domain('Inventory', {
        check: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return { available: true }
        },
      })
      registerDomain(Inventory)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 10,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(attempts).toBe(3)
      expect(result).toEqual({ available: true })
    })

    it('throws WorkflowStepError after all retries exhausted', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => {
          throw new Error('Permanent failure')
        },
      })
      registerDomain(Inventory)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 2,
          initialDelayMs: 10,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'do')).rejects.toThrow(WorkflowStepError)

      try {
        await runtime.executeStep('step-1', pipeline, [], 'do')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowStepError)
        expect((error as WorkflowStepError).stepId).toBe('step-1')
        expect((error as WorkflowStepError).attempts).toBe(2)
      }
    })

    it('persists failed status after retries exhausted', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => {
          throw new Error('Permanent failure')
        },
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({
        storage,
        retryPolicy: {
          maxAttempts: 2,
          initialDelayMs: 10,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'do')).rejects.toThrow()

      const stored = await storage.get('step-1')
      expect(stored?.status).toBe('failed')
      expect(stored?.error).toBe('Permanent failure')
      expect(stored?.attempts).toBe(2)
    })
  })

  // ==========================================================================
  // Execution Mode: send (Fire-and-Forget)
  // ==========================================================================

  describe('executeStep - send mode', () => {
    it('returns immediately without waiting', async () => {
      let executed = false
      const Inventory = Domain('Inventory', {
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          executed = true
          return { available: true }
        },
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'send')

      // Should return immediately with undefined
      expect(result).toBeUndefined()
      expect(executed).toBe(false)

      // Wait for background execution
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(executed).toBe(true)
    })

    it('does not throw on background failure', async () => {
      const onStepError = vi.fn()
      const Inventory = Domain('Inventory', {
        check: async () => {
          throw new Error('Background failure')
        },
      })
      registerDomain(Inventory)

      const runtime = createWorkflowRuntime({ onStepError })
      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      // Should not throw
      const result = await runtime.executeStep('step-1', pipeline, [], 'send')
      expect(result).toBeUndefined()

      // Wait for background execution to fail
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(onStepError).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Public API Methods (send, try, do)
  // ==========================================================================

  describe('runtime.send()', () => {
    it('fires event without blocking', () => {
      const runtime = createTestRuntime()

      // Should not throw
      expect(() => runtime.send('Order.placed', { id: 'order-123' })).not.toThrow()
    })
  })

  describe('runtime.try()', () => {
    it('executes action and returns result', async () => {
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const result = await runtime.try<{ available: boolean; sku: string }>('Inventory.check', { sku: 'ABC-123' })

      expect(result).toEqual({ available: true, sku: 'ABC-123' })
    })

    it('throws on invalid action format', async () => {
      const runtime = createTestRuntime()

      await expect(runtime.try('InvalidAction', {})).rejects.toThrow('Invalid action format')
    })

    it('throws on unknown handler', async () => {
      const runtime = createTestRuntime()

      await expect(runtime.try('Unknown.method', {})).rejects.toThrow(HandlerNotFoundError)
    })
  })

  describe('runtime.do()', () => {
    it('executes action with durability', async () => {
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const result = await runtime.do<{ available: boolean; sku: string }>('Inventory.check', { sku: 'ABC-123' })

      expect(result).toEqual({ available: true, sku: 'ABC-123' })

      // Should be persisted
      const stored = await storage.list()
      expect(stored.length).toBeGreaterThan(0)
    })

    it('replays from storage on re-execution', async () => {
      let executionCount = 0
      const Inventory = Domain('Inventory', {
        check: async () => {
          executionCount++
          return { available: true }
        },
      })
      registerDomain(Inventory)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      // First execution
      await runtime.do('Inventory.check', { sku: 'ABC-123' })
      expect(executionCount).toBe(1)

      // Second execution with same args should replay
      await runtime.do('Inventory.check', { sku: 'ABC-123' })
      expect(executionCount).toBe(1) // Should not increment
    })
  })

  // ==========================================================================
  // Integration with Workflow Proxy
  // ==========================================================================

  describe('Integration with createWorkflowProxy', () => {
    it('works with $ proxy syntax', async () => {
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const $ = createWorkflowProxy(runtime)

      const product = { sku: 'ABC-123' }
      const result = await $.Inventory(product).check()

      expect(result).toEqual({ available: true, sku: 'ABC-123' })
    })

    it('supports chained method calls', async () => {
      const Order = Domain('Order', {
        validate: async (order: { id: string }) => ({ valid: true, id: order.id }),
        process: async (order: { id: string }) => ({ processed: true, id: order.id }),
      })
      registerDomain(Order)

      const runtime = createTestRuntime()
      const $ = createWorkflowProxy(runtime)

      const order = { id: 'order-123' }

      // Note: These are separate calls, not a pipeline chain
      const validation = await $.Order(order).validate()
      expect(validation).toEqual({ valid: true, id: 'order-123' })

      const result = await $.Order(order).process()
      expect(result).toEqual({ processed: true, id: 'order-123' })
    })
  })
})
