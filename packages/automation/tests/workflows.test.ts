/**
 * @dotdo/automation - Workflow Engine Tests
 *
 * Tests for n8n-compatible workflow engine including:
 * - Workflow definition and validation
 * - Workflow execution with exactly-once semantics
 * - Node execution order
 * - Error handling and retries
 * - Workflow history and state persistence
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Workflow,
  WorkflowEngine,
  type WorkflowExecution,
} from '../src'

describe('Workflow Engine', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    vi.useFakeTimers()
    engine = new WorkflowEngine()
  })

  afterEach(() => {
    vi.useRealTimers()
    engine.dispose()
  })

  // ============================================================================
  // WORKFLOW DEFINITION
  // ============================================================================

  describe('Workflow Definition', () => {
    it('should create a workflow with name and nodes', () => {
      const workflow = new Workflow({
        name: 'My First Workflow',
        nodes: [
          {
            id: 'trigger-1',
            type: 'webhook',
            config: { path: '/webhook/start', method: 'POST' },
          },
          {
            id: 'action-1',
            type: 'http',
            config: { method: 'GET', url: 'https://api.example.com/data' },
          },
        ],
        connections: [
          { from: 'trigger-1', to: 'action-1' },
        ],
      })

      expect(workflow.name).toBe('My First Workflow')
      expect(workflow.nodes).toHaveLength(2)
      expect(workflow.connections).toHaveLength(1)
    })

    it('should generate unique workflow ID', () => {
      const workflow1 = new Workflow({ name: 'Workflow 1', nodes: [], connections: [] })
      const workflow2 = new Workflow({ name: 'Workflow 2', nodes: [], connections: [] })

      expect(workflow1.id).toBeDefined()
      expect(workflow2.id).toBeDefined()
      expect(workflow1.id).not.toBe(workflow2.id)
    })

    it('should validate node IDs are unique', () => {
      expect(() => {
        new Workflow({
          name: 'Invalid Workflow',
          nodes: [
            { id: 'node-1', type: 'code', config: {} },
            { id: 'node-1', type: 'set', config: {} }, // Duplicate ID
          ],
          connections: [],
        })
      }).toThrow(/duplicate.*node/i)
    })

    it('should validate connections reference existing nodes', () => {
      expect(() => {
        new Workflow({
          name: 'Invalid Workflow',
          nodes: [
            { id: 'node-1', type: 'code', config: {} },
          ],
          connections: [
            { from: 'node-1', to: 'non-existent' }, // Invalid target
          ],
        })
      }).toThrow(/invalid.*connection/i)
    })

    it('should support node metadata', () => {
      const workflow = new Workflow({
        name: 'With Metadata',
        nodes: [
          {
            id: 'node-1',
            type: 'code',
            config: { code: 'return input' },
            metadata: {
              position: { x: 100, y: 200 },
              notes: 'Process incoming data',
            },
          },
        ],
        connections: [],
      })

      expect(workflow.nodes[0].metadata?.position).toEqual({ x: 100, y: 200 })
    })

    it('should clone workflow for editing', () => {
      const original = new Workflow({
        name: 'Original',
        nodes: [{ id: 'node-1', type: 'code', config: {} }],
        connections: [],
      })

      const clone = original.clone()

      expect(clone.id).not.toBe(original.id)
      expect(clone.name).toBe('Original')
      expect(clone.nodes).toHaveLength(1)

      // Modifying clone shouldn't affect original
      clone.nodes.push({ id: 'node-2', type: 'set', config: {} })
      expect(original.nodes).toHaveLength(1)
    })

    it('should serialize to JSON', () => {
      const workflow = new Workflow({
        name: 'Serializable',
        nodes: [
          { id: 'trigger', type: 'webhook', config: { path: '/test' } },
          { id: 'action', type: 'http', config: { url: 'https://api.example.com' } },
        ],
        connections: [{ from: 'trigger', to: 'action' }],
      })

      const json = workflow.toJSON()
      const restored = Workflow.fromJSON(json)

      expect(restored.name).toBe('Serializable')
      expect(restored.nodes).toHaveLength(2)
      expect(restored.connections).toHaveLength(1)
    })
  })

  // ============================================================================
  // WORKFLOW ENGINE
  // ============================================================================

  describe('WorkflowEngine', () => {
    it('should register a workflow', () => {
      const workflow = new Workflow({
        name: 'Test',
        nodes: [],
        connections: [],
      })

      engine.register(workflow)

      expect(engine.getWorkflow(workflow.id)).toBeDefined()
    })

    it('should list all registered workflows', () => {
      engine.register(new Workflow({ name: 'W1', nodes: [], connections: [] }))
      engine.register(new Workflow({ name: 'W2', nodes: [], connections: [] }))
      engine.register(new Workflow({ name: 'W3', nodes: [], connections: [] }))

      const workflows = engine.listWorkflows()

      expect(workflows).toHaveLength(3)
    })

    it('should activate and deactivate workflows', () => {
      const workflow = new Workflow({
        name: 'Activatable',
        nodes: [
          { id: 'trigger', type: 'webhook', config: { path: '/test' } },
        ],
        connections: [],
      })

      engine.register(workflow)

      expect(engine.isActive(workflow.id)).toBe(false)

      engine.activate(workflow.id)
      expect(engine.isActive(workflow.id)).toBe(true)

      engine.deactivate(workflow.id)
      expect(engine.isActive(workflow.id)).toBe(false)
    })

    it('should unregister a workflow', () => {
      const workflow = new Workflow({ name: 'Temporary', nodes: [], connections: [] })

      engine.register(workflow)
      expect(engine.getWorkflow(workflow.id)).toBeDefined()

      engine.unregister(workflow.id)
      expect(engine.getWorkflow(workflow.id)).toBeUndefined()
    })

    it('should execute a workflow manually', async () => {
      const workflow = new Workflow({
        name: 'Manual Workflow',
        nodes: [
          {
            id: 'start',
            type: 'manual',
            config: {},
          },
          {
            id: 'code',
            type: 'code',
            config: {
              language: 'javascript',
              code: 'return { result: input.value * 2 }',
            },
          },
        ],
        connections: [{ from: 'start', to: 'code' }],
      })

      engine.register(workflow)

      const execution = await engine.execute(workflow.id, {
        input: { value: 21 },
      })

      expect(execution.status).toBe('completed')
      expect(execution.output).toEqual({ result: 42 })
    })

    it('should track execution history', async () => {
      const workflow = new Workflow({
        name: 'Tracked',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
        ],
        connections: [],
      })

      engine.register(workflow)

      await engine.execute(workflow.id, { input: {} })
      await engine.execute(workflow.id, { input: {} })
      await engine.execute(workflow.id, { input: {} })

      const history = engine.getExecutionHistory(workflow.id)

      expect(history).toHaveLength(3)
    })
  })

  // ============================================================================
  // WORKFLOW EXECUTION
  // ============================================================================

  describe('Workflow Execution', () => {
    it('should execute nodes in topological order', async () => {
      const executionOrder: string[] = []

      const workflow = new Workflow({
        name: 'Ordered Execution',
        nodes: [
          {
            id: 'start',
            type: 'manual',
            config: {},
            hooks: {
              onExecute: () => executionOrder.push('start'),
            },
          },
          {
            id: 'step-a',
            type: 'code',
            config: { code: 'return input' },
            hooks: {
              onExecute: () => executionOrder.push('step-a'),
            },
          },
          {
            id: 'step-b',
            type: 'code',
            config: { code: 'return input' },
            hooks: {
              onExecute: () => executionOrder.push('step-b'),
            },
          },
          {
            id: 'end',
            type: 'code',
            config: { code: 'return input' },
            hooks: {
              onExecute: () => executionOrder.push('end'),
            },
          },
        ],
        connections: [
          { from: 'start', to: 'step-a' },
          { from: 'start', to: 'step-b' },
          { from: 'step-a', to: 'end' },
          { from: 'step-b', to: 'end' },
        ],
      })

      engine.register(workflow)
      await engine.execute(workflow.id, { input: {} })

      // Start should be first, end should be last
      expect(executionOrder[0]).toBe('start')
      expect(executionOrder[executionOrder.length - 1]).toBe('end')
    })

    it('should pass data between nodes', async () => {
      const workflow = new Workflow({
        name: 'Data Flow',
        nodes: [
          {
            id: 'start',
            type: 'manual',
            config: {},
          },
          {
            id: 'double',
            type: 'code',
            config: {
              language: 'javascript',
              code: 'return { value: input.value * 2 }',
            },
          },
          {
            id: 'add-ten',
            type: 'code',
            config: {
              language: 'javascript',
              code: 'return { value: input.value + 10 }',
            },
          },
        ],
        connections: [
          { from: 'start', to: 'double' },
          { from: 'double', to: 'add-ten' },
        ],
      })

      engine.register(workflow)
      const execution = await engine.execute(workflow.id, {
        input: { value: 5 },
      })

      // (5 * 2) + 10 = 20
      expect(execution.output).toEqual({ value: 20 })
    })

    it('should handle node failures', async () => {
      const workflow = new Workflow({
        name: 'Failing Workflow',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          {
            id: 'fail',
            type: 'code',
            config: {
              language: 'javascript',
              code: 'throw new Error("Node failed")',
            },
          },
        ],
        connections: [{ from: 'start', to: 'fail' }],
      })

      engine.register(workflow)
      const execution = await engine.execute(workflow.id, { input: {} })

      expect(execution.status).toBe('failed')
      expect(execution.error).toContain('Node failed')
      expect(execution.failedNode).toBe('fail')
    })

    it('should support continue on error', async () => {
      const workflow = new Workflow({
        name: 'Continue On Error',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          {
            id: 'might-fail',
            type: 'code',
            config: { code: 'throw new Error("Failed")' },
            continueOnFail: true,
          },
          {
            id: 'continues',
            type: 'code',
            config: { code: 'return { continued: true }' },
          },
        ],
        connections: [
          { from: 'start', to: 'might-fail' },
          { from: 'might-fail', to: 'continues' },
        ],
      })

      engine.register(workflow)
      const execution = await engine.execute(workflow.id, { input: {} })

      expect(execution.status).toBe('completed')
      expect(execution.output).toEqual({ continued: true })
    })

    it('should generate unique execution IDs', async () => {
      const workflow = new Workflow({
        name: 'Unique IDs',
        nodes: [{ id: 'start', type: 'manual', config: {} }],
        connections: [],
      })

      engine.register(workflow)

      const exec1 = await engine.execute(workflow.id, { input: {} })
      const exec2 = await engine.execute(workflow.id, { input: {} })

      expect(exec1.id).toBeDefined()
      expect(exec2.id).toBeDefined()
      expect(exec1.id).not.toBe(exec2.id)
    })

    it('should track execution timing', async () => {
      const workflow = new Workflow({
        name: 'Timed',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
        ],
        connections: [],
      })

      engine.register(workflow)

      const execution = await engine.execute(workflow.id, { input: {} })

      expect(execution.startedAt).toBeDefined()
      expect(execution.completedAt).toBeDefined()
      expect(execution.completedAt).toBeGreaterThanOrEqual(execution.startedAt)
    })

    it('should track node-level execution details', async () => {
      const workflow = new Workflow({
        name: 'Detailed',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'step1', type: 'code', config: { code: 'return { a: 1 }' } },
          { id: 'step2', type: 'code', config: { code: 'return { b: 2 }' } },
        ],
        connections: [
          { from: 'start', to: 'step1' },
          { from: 'step1', to: 'step2' },
        ],
      })

      engine.register(workflow)
      const execution = await engine.execute(workflow.id, { input: {} })

      expect(execution.nodeExecutions).toBeDefined()
      expect(execution.nodeExecutions['step1']).toBeDefined()
      expect(execution.nodeExecutions['step1'].input).toBeDefined()
      expect(execution.nodeExecutions['step1'].output).toEqual({ a: 1 })
    })
  })

  // ============================================================================
  // TRIGGER-BASED EXECUTION
  // ============================================================================

  describe('Trigger-Based Execution', () => {
    it('should execute workflow on webhook trigger', async () => {
      const executions: WorkflowExecution[] = []

      const workflow = new Workflow({
        name: 'Webhook Triggered',
        nodes: [
          {
            id: 'webhook',
            type: 'webhook',
            config: { path: '/webhook/order', method: 'POST' },
          },
          {
            id: 'process',
            type: 'code',
            config: { code: 'return { processed: input.orderId }' },
          },
        ],
        connections: [{ from: 'webhook', to: 'process' }],
      })

      engine.register(workflow)
      engine.activate(workflow.id)
      engine.onExecution((exec) => executions.push(exec))

      // Simulate webhook request
      await engine.handleWebhook('/webhook/order', 'POST', {
        orderId: '123',
      })

      expect(executions).toHaveLength(1)
      expect(executions[0].status).toBe('completed')
      expect(executions[0].output).toEqual({ processed: '123' })
    })
  })

  // ============================================================================
  // EXACTLY-ONCE EXECUTION
  // ============================================================================

  describe('Exactly-Once Execution', () => {
    it('should deduplicate duplicate executions', async () => {
      const workflow = new Workflow({
        name: 'Dedup',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
        ],
        connections: [],
      })

      engine.register(workflow)

      // Execute with same idempotency key
      await engine.execute(workflow.id, {
        input: {},
        idempotencyKey: 'unique-key-1',
      })

      await engine.execute(workflow.id, {
        input: {},
        idempotencyKey: 'unique-key-1',
      })

      // Should only execute once
      const history = engine.getExecutionHistory(workflow.id)
      expect(history).toHaveLength(1)
    })

    it('should persist execution state for recovery', async () => {
      const workflow = new Workflow({
        name: 'Persistent',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'step', type: 'code', config: { code: 'return { done: true }' } },
        ],
        connections: [{ from: 'start', to: 'step' }],
      })

      // Create engine with storage
      const storage = new Map<string, unknown>()
      const persistentEngine = new WorkflowEngine({
        storage: {
          get: async (key) => storage.get(key),
          set: async (key, value) => storage.set(key, value),
          delete: async (key) => storage.delete(key),
        },
      })

      persistentEngine.register(workflow)
      await persistentEngine.execute(workflow.id, { input: {} })

      // State should be persisted
      expect(storage.size).toBeGreaterThan(0)

      persistentEngine.dispose()
    })
  })

  // ============================================================================
  // WORKFLOW VERSIONING
  // ============================================================================

  describe('Workflow Versioning', () => {
    it('should track workflow versions', () => {
      const workflow = new Workflow({
        name: 'Versioned',
        nodes: [{ id: 'start', type: 'manual', config: {} }],
        connections: [],
      })

      expect(workflow.version).toBe(1)

      // Update workflow
      const updated = workflow.update({
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'new-node', type: 'code', config: {} },
        ],
      })

      expect(updated.version).toBe(2)
    })

    it('should rollback to previous version', () => {
      const workflow = new Workflow({
        name: 'Rollback Test',
        nodes: [{ id: 'v1', type: 'manual', config: {} }],
        connections: [],
      })

      const v2 = workflow.update({
        nodes: [{ id: 'v2', type: 'manual', config: {} }],
      })

      const rolled = v2.rollback()

      expect(rolled.nodes[0].id).toBe('v1')
      expect(rolled.version).toBe(3) // New version, not 1
    })

    it('should keep execution on original workflow version', async () => {
      const workflow = new Workflow({
        name: 'Version Lock',
        nodes: [{ id: 'v1', type: 'manual', config: {} }],
        connections: [],
      })

      engine.register(workflow)

      // Start execution
      const execution1 = await engine.execute(workflow.id, { input: {} })

      // Update workflow
      const updated = workflow.update({
        nodes: [{ id: 'v2', type: 'manual', config: {} }],
      })
      engine.register(updated)

      // Execution should reference original version
      expect(execution1.workflowVersion).toBe(1)
    })
  })

  // ============================================================================
  // PARALLEL EXECUTION
  // ============================================================================

  describe('Parallel Execution', () => {
    it('should merge parallel branch outputs', async () => {
      const workflow = new Workflow({
        name: 'Merge Outputs',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'get-users', type: 'code', config: { code: 'return { users: ["a", "b"] }' } },
          { id: 'get-orders', type: 'code', config: { code: 'return { orders: [1, 2] }' } },
          {
            id: 'merge',
            type: 'merge',
            config: { mode: 'combine' },
          },
        ],
        connections: [
          { from: 'start', to: 'get-users' },
          { from: 'start', to: 'get-orders' },
          { from: 'get-users', to: 'merge' },
          { from: 'get-orders', to: 'merge' },
        ],
      })

      engine.register(workflow)
      const execution = await engine.execute(workflow.id, { input: {} })

      expect(execution.output).toEqual({
        users: ['a', 'b'],
        orders: [1, 2],
      })
    })
  })

  // ============================================================================
  // SUB-WORKFLOWS
  // ============================================================================

  describe('Sub-Workflows', () => {
    it('should execute sub-workflow', async () => {
      // Child workflow
      const childWorkflow = new Workflow({
        name: 'Child',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'process', type: 'code', config: { code: 'return { processed: input.value * 2 }' } },
        ],
        connections: [{ from: 'start', to: 'process' }],
      })

      // Parent workflow
      const parentWorkflow = new Workflow({
        name: 'Parent',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          {
            id: 'call-child',
            type: 'execute-workflow',
            config: { workflowId: childWorkflow.id },
          },
        ],
        connections: [{ from: 'start', to: 'call-child' }],
      })

      engine.register(childWorkflow)
      engine.register(parentWorkflow)

      const execution = await engine.execute(parentWorkflow.id, {
        input: { value: 21 },
      })

      expect(execution.output).toEqual({ processed: 42 })
    })

    it('should pass data to sub-workflow', async () => {
      const childWorkflow = new Workflow({
        name: 'Echo Child',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          { id: 'echo', type: 'code', config: { code: 'return input' } },
        ],
        connections: [{ from: 'start', to: 'echo' }],
      })

      const parentWorkflow = new Workflow({
        name: 'Passing Parent',
        nodes: [
          { id: 'start', type: 'manual', config: {} },
          {
            id: 'prepare',
            type: 'set',
            config: {
              values: [{ name: 'message', value: 'Hello from parent' }],
            },
          },
          {
            id: 'call-child',
            type: 'execute-workflow',
            config: { workflowId: childWorkflow.id },
          },
        ],
        connections: [
          { from: 'start', to: 'prepare' },
          { from: 'prepare', to: 'call-child' },
        ],
      })

      engine.register(childWorkflow)
      engine.register(parentWorkflow)

      const execution = await engine.execute(parentWorkflow.id, { input: {} })

      expect((execution.output as { message: string }).message).toBe('Hello from parent')
    })
  })
})
