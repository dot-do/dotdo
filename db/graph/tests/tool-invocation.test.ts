/**
 * Tool Invocation Tracking Tests
 *
 * Tests for invocation relationship tracking with verb-state transitions
 * and performance metrics.
 *
 * @module db/graph/tests/tool-invocation
 * @see dotdo-28u9r - [GREEN] Implement Invocation Relationship Tracking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InvocationStore,
  ToolExecutor,
  createInvocationStore,
  createToolExecutor,
  VERB_INVOKE,
  VERB_INVOKING,
  VERB_INVOKED,
  type Invocation,
  type RegisteredTool,
} from '../tool-invocation'

describe('InvocationStore', () => {
  let store: InvocationStore

  beforeEach(() => {
    // Use a fresh object for each test to get isolated in-memory store
    store = createInvocationStore({})
  })

  describe('startInvocation', () => {
    it('should create an invocation with pending status', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: { query: 'weather' },
      })

      expect(inv).toBeDefined()
      expect(inv.id).toMatch(/^inv-/)
      expect(inv.callerId).toBe('agent:ralph')
      expect(inv.toolId).toBe('tool:web_search')
      expect(inv.verb).toBe(VERB_INVOKE)
      expect(inv.data.status).toBe('pending')
      expect(inv.data.input).toEqual({ query: 'weather' })
      expect(inv.data.startedAt).toBeGreaterThan(0)
    })

    it('should generate unique invocation IDs', async () => {
      const inv1 = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })

      const inv2 = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })

      expect(inv1.id).not.toBe(inv2.id)
    })

    it('should support parent invocation ID for nested calls', async () => {
      const parent = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:coordinator',
        input: {},
      })

      const child = await store.startInvocation({
        callerId: 'tool:coordinator',
        toolId: 'tool:web_search',
        input: { query: 'test' },
        parentInvocationId: parent.id,
      })

      expect(child.data.parentInvocationId).toBe(parent.id)
    })

    it('should support optional metadata', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
        metadata: { traceId: 'trace-123', spanId: 'span-456' },
      })

      expect(inv.data.metadata).toEqual({
        traceId: 'trace-123',
        spanId: 'span-456',
      })
    })
  })

  describe('markRunning', () => {
    it('should update verb to invoking and status to running', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })

      const running = await store.markRunning(inv.id)

      expect(running).not.toBeNull()
      expect(running!.verb).toBe(VERB_INVOKING)
      expect(running!.data.status).toBe('running')
    })

    it('should return null for non-existent invocation', async () => {
      const result = await store.markRunning('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('completeInvocation', () => {
    it('should update verb to invoked and status to completed', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: { query: 'test' },
      })

      await store.markRunning(inv.id)

      const completed = await store.completeInvocation({
        invocationId: inv.id,
        output: { results: ['result1', 'result2'] },
      })

      expect(completed).not.toBeNull()
      expect(completed!.verb).toBe(VERB_INVOKED)
      expect(completed!.data.status).toBe('completed')
      expect(completed!.data.output).toEqual({ results: ['result1', 'result2'] })
      expect(completed!.data.completedAt).toBeGreaterThan(0)
      expect(completed!.data.duration).toBeGreaterThanOrEqual(0)
    })

    it('should support cost tracking', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:llm_call',
        input: { prompt: 'test' },
      })

      const completed = await store.completeInvocation({
        invocationId: inv.id,
        output: { response: 'test response' },
        cost: 0.0025,
      })

      expect(completed!.data.cost).toBe(0.0025)
    })

    it('should return null for non-existent invocation', async () => {
      const result = await store.completeInvocation({
        invocationId: 'non-existent',
        output: {},
      })
      expect(result).toBeNull()
    })
  })

  describe('failInvocation', () => {
    it('should update status to failed and store error', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: { query: 'test' },
      })

      await store.markRunning(inv.id)

      const failed = await store.failInvocation(inv.id, {
        code: 'TIMEOUT',
        message: 'Request timed out',
      })

      expect(failed).not.toBeNull()
      expect(failed!.verb).toBe(VERB_INVOKED)
      expect(failed!.data.status).toBe('failed')
      expect(failed!.data.error).toEqual({
        code: 'TIMEOUT',
        message: 'Request timed out',
      })
      expect(failed!.data.completedAt).toBeGreaterThan(0)
    })
  })

  describe('getInvocation', () => {
    it('should return invocation by ID', async () => {
      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: { query: 'test' },
      })

      const retrieved = await store.getInvocation(inv.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(inv.id)
    })

    it('should return null for non-existent invocation', async () => {
      const result = await store.getInvocation('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('getInvocations', () => {
    beforeEach(async () => {
      // Create test invocations
      const inv1 = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: { query: 'query1' },
      })
      await store.completeInvocation({ invocationId: inv1.id, output: {} })

      const inv2 = await store.startInvocation({
        callerId: 'agent:priya',
        toolId: 'tool:web_search',
        input: { query: 'query2' },
      })
      await store.failInvocation(inv2.id, { code: 'ERROR', message: 'Failed' })

      await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:code_search',
        input: { pattern: '*.ts' },
      })
    })

    it('should return all invocations', async () => {
      const invocations = await store.getInvocations()
      expect(invocations.length).toBe(3)
    })

    it('should filter by callerId', async () => {
      const invocations = await store.getInvocations({ callerId: 'agent:ralph' })
      expect(invocations.length).toBe(2)
      expect(invocations.every((inv) => inv.callerId === 'agent:ralph')).toBe(true)
    })

    it('should filter by toolId', async () => {
      const invocations = await store.getInvocations({ toolId: 'tool:web_search' })
      expect(invocations.length).toBe(2)
      expect(invocations.every((inv) => inv.toolId === 'tool:web_search')).toBe(true)
    })

    it('should filter by status', async () => {
      const completed = await store.getInvocations({ status: 'completed' })
      expect(completed.length).toBe(1)

      const failed = await store.getInvocations({ status: 'failed' })
      expect(failed.length).toBe(1)

      const pending = await store.getInvocations({ status: 'pending' })
      expect(pending.length).toBe(1)
    })

    it('should apply limit and offset', async () => {
      const first = await store.getInvocations({ limit: 1 })
      expect(first.length).toBe(1)

      const second = await store.getInvocations({ limit: 1, offset: 1 })
      expect(second.length).toBe(1)
      expect(second[0].id).not.toBe(first[0].id)
    })

    it('should sort by startedAt descending (most recent first)', async () => {
      const invocations = await store.getInvocations()
      for (let i = 1; i < invocations.length; i++) {
        expect(invocations[i - 1].data.startedAt).toBeGreaterThanOrEqual(
          invocations[i].data.startedAt
        )
      }
    })
  })

  describe('getInvokedBy', () => {
    it('should return invocations made by a caller', async () => {
      await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:code_search',
        input: {},
      })
      await store.startInvocation({
        callerId: 'agent:priya',
        toolId: 'tool:web_search',
        input: {},
      })

      const invocations = await store.getInvokedBy('agent:ralph')
      expect(invocations.length).toBe(2)
    })
  })

  describe('getInvokes', () => {
    it('should return invocations of a tool', async () => {
      await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.startInvocation({
        callerId: 'agent:priya',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:code_search',
        input: {},
      })

      const invocations = await store.getInvokes('tool:web_search')
      expect(invocations.length).toBe(2)
    })
  })

  describe('Call Chain Traversal', () => {
    let rootInv: Invocation
    let childInv1: Invocation
    let childInv2: Invocation
    let grandchildInv: Invocation

    beforeEach(async () => {
      // Create a call chain: root -> child1, child2 -> grandchild
      rootInv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:orchestrator',
        input: {},
      })

      childInv1 = await store.startInvocation({
        callerId: 'tool:orchestrator',
        toolId: 'tool:web_search',
        input: {},
        parentInvocationId: rootInv.id,
      })

      childInv2 = await store.startInvocation({
        callerId: 'tool:orchestrator',
        toolId: 'tool:code_search',
        input: {},
        parentInvocationId: rootInv.id,
      })

      grandchildInv = await store.startInvocation({
        callerId: 'tool:web_search',
        toolId: 'tool:http_fetch',
        input: {},
        parentInvocationId: childInv1.id,
      })
    })

    describe('getCallChain', () => {
      it('should build call chain tree from root', async () => {
        const chain = await store.getCallChain(rootInv.id)

        expect(chain).not.toBeNull()
        expect(chain!.invocation.id).toBe(rootInv.id)
        expect(chain!.depth).toBe(0)
        expect(chain!.children.length).toBe(2)

        // Find child1 entry
        const child1Entry = chain!.children.find(
          (c) => c.invocation.id === childInv1.id
        )
        expect(child1Entry).toBeDefined()
        expect(child1Entry!.depth).toBe(1)
        expect(child1Entry!.children.length).toBe(1)
        expect(child1Entry!.children[0].invocation.id).toBe(grandchildInv.id)
      })

      it('should return null for non-existent invocation', async () => {
        const chain = await store.getCallChain('non-existent')
        expect(chain).toBeNull()
      })

      it('should respect maxDepth', async () => {
        const chain = await store.getCallChain(rootInv.id, 1)

        expect(chain!.children.length).toBe(2)
        // Children should have empty children arrays due to depth limit
        for (const child of chain!.children) {
          expect(child.children.length).toBe(0)
        }
      })
    })

    describe('getCallChainRoot', () => {
      it('should find root from grandchild', async () => {
        const root = await store.getCallChainRoot(grandchildInv.id)

        expect(root).not.toBeNull()
        expect(root!.id).toBe(rootInv.id)
      })

      it('should return same invocation if already root', async () => {
        const root = await store.getCallChainRoot(rootInv.id)

        expect(root).not.toBeNull()
        expect(root!.id).toBe(rootInv.id)
      })
    })

    describe('getCallPath', () => {
      it('should return path from root to grandchild', async () => {
        const path = await store.getCallPath(grandchildInv.id)

        expect(path.length).toBe(3)
        expect(path[0].id).toBe(rootInv.id)
        expect(path[1].id).toBe(childInv1.id)
        expect(path[2].id).toBe(grandchildInv.id)
      })

      it('should return single-element path for root', async () => {
        const path = await store.getCallPath(rootInv.id)

        expect(path.length).toBe(1)
        expect(path[0].id).toBe(rootInv.id)
      })
    })
  })

  describe('getMetrics', () => {
    beforeEach(async () => {
      // Create invocations with varying outcomes
      const inv1 = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.completeInvocation({
        invocationId: inv1.id,
        output: {},
        cost: 0.001,
      })

      const inv2 = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.completeInvocation({
        invocationId: inv2.id,
        output: {},
        cost: 0.002,
      })

      const inv3 = await store.startInvocation({
        callerId: 'agent:priya',
        toolId: 'tool:code_search',
        input: {},
      })
      await store.failInvocation(inv3.id, { code: 'ERROR', message: 'Failed' })
    })

    it('should calculate aggregate metrics', async () => {
      const metrics = await store.getMetrics()

      expect(metrics.totalCount).toBe(3)
      expect(metrics.successCount).toBe(2)
      expect(metrics.failedCount).toBe(1)
      expect(metrics.totalCost).toBe(0.003)
      expect(metrics.avgDuration).toBeGreaterThanOrEqual(0)
    })

    it('should break down by tool', async () => {
      const metrics = await store.getMetrics()

      expect(metrics.byTool['tool:web_search'].count).toBe(2)
      expect(metrics.byTool['tool:code_search'].count).toBe(1)
    })

    it('should break down by caller', async () => {
      const metrics = await store.getMetrics()

      expect(metrics.byCaller['agent:ralph'].count).toBe(2)
      expect(metrics.byCaller['agent:priya'].count).toBe(1)
    })
  })

  describe('getToolMetrics', () => {
    it('should return tool-specific metrics with percentiles', async () => {
      // Create multiple invocations
      for (let i = 0; i < 5; i++) {
        const inv = await store.startInvocation({
          callerId: 'agent:ralph',
          toolId: 'tool:web_search',
          input: {},
        })
        await store.completeInvocation({
          invocationId: inv.id,
          output: {},
          cost: 0.001,
        })
      }

      const inv = await store.startInvocation({
        callerId: 'agent:ralph',
        toolId: 'tool:web_search',
        input: {},
      })
      await store.failInvocation(inv.id, { code: 'ERROR', message: 'Failed' })

      const metrics = await store.getToolMetrics('tool:web_search')

      expect(metrics.invocationCount).toBe(6)
      expect(metrics.successRate).toBeCloseTo(5 / 6)
      expect(metrics.totalCost).toBe(0.005)
      expect(metrics.avgDuration).toBeGreaterThanOrEqual(0)
      expect(metrics.p50Duration).toBeGreaterThanOrEqual(0)
      expect(metrics.p95Duration).toBeGreaterThanOrEqual(0)
      expect(metrics.p99Duration).toBeGreaterThanOrEqual(0)
    })

    it('should return zeros for non-existent tool', async () => {
      const metrics = await store.getToolMetrics('tool:non-existent')

      expect(metrics.invocationCount).toBe(0)
      expect(metrics.successRate).toBe(0)
      expect(metrics.totalCost).toBe(0)
    })
  })
})

describe('ToolExecutor', () => {
  let executor: ToolExecutor

  beforeEach(() => {
    executor = createToolExecutor({})
  })

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool: RegisteredTool = {
        id: 'tool:echo',
        name: 'echo',
        description: 'Echo input back',
        handler: async (input) => input,
      }

      executor.registerTool(tool)

      expect(executor.getTool('tool:echo')).toBe(tool)
    })
  })

  describe('invoke', () => {
    beforeEach(() => {
      executor.registerTool({
        id: 'tool:echo',
        name: 'echo',
        description: 'Echo input back',
        handler: async (input) => input,
      })

      executor.registerTool({
        id: 'tool:add',
        name: 'add',
        description: 'Add two numbers',
        handler: async (input) => {
          const a = input.a as number
          const b = input.b as number
          return { sum: a + b }
        },
      })

      executor.registerTool({
        id: 'tool:fail',
        name: 'fail',
        description: 'Always fails',
        handler: async () => {
          throw new Error('Intentional failure')
        },
      })
    })

    it('should invoke a tool and return result', async () => {
      const result = await executor.invoke('agent:ralph', 'tool:echo', {
        message: 'hello',
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ message: 'hello' })
    })

    it('should handle tool errors', async () => {
      const result = await executor.invoke('agent:ralph', 'tool:fail', {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('TOOL_ERROR')
      expect(result.error!.message).toBe('Intentional failure')
    })

    it('should return error for non-existent tool', async () => {
      const result = await executor.invoke('agent:ralph', 'tool:non-existent', {})

      expect(result.success).toBe(false)
      expect(result.error!.code).toBe('TOOL_NOT_FOUND')
    })

    it('should support nested tool invocations', async () => {
      // Register a tool that invokes another tool
      executor.registerTool({
        id: 'tool:compute',
        name: 'compute',
        description: 'Compute using nested tools',
        handler: async (input, context) => {
          const result = await context.invoke<{ sum: number }>('tool:add', {
            a: input.x as number,
            b: input.y as number,
          })
          return { computedSum: result.sum }
        },
      })

      const result = await executor.invoke('agent:ralph', 'tool:compute', {
        x: 5,
        y: 3,
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ computedSum: 8 })
    })

    it('should provide invocation context to handler', async () => {
      let capturedContext: any = null

      executor.registerTool({
        id: 'tool:capture_context',
        name: 'capture_context',
        description: 'Capture context',
        handler: async (input, context) => {
          capturedContext = context
          return {}
        },
      })

      await executor.invoke('agent:ralph', 'tool:capture_context', {})

      expect(capturedContext).not.toBeNull()
      expect(capturedContext.invocationId).toMatch(/^inv-/)
      expect(capturedContext.callerId).toBe('agent:ralph')
      expect(typeof capturedContext.invoke).toBe('function')
    })
  })
})

describe('Factory Functions', () => {
  describe('createInvocationStore', () => {
    it('should create InvocationStore instance', () => {
      const store = createInvocationStore({})
      expect(store).toBeInstanceOf(InvocationStore)
    })
  })

  describe('createToolExecutor', () => {
    it('should create ToolExecutor instance', () => {
      const executor = createToolExecutor({})
      expect(executor).toBeInstanceOf(ToolExecutor)
    })
  })
})
