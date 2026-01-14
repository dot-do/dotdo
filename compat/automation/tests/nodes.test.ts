/**
 * RED Phase Tests: Flow Control Nodes
 *
 * Tests for n8n-compatible flow control nodes including:
 * - IF node (conditional branching)
 * - Switch node (multi-way branching)
 * - Loop node (iteration over items)
 * - Merge node (combining branches)
 * - Split node (splitting into multiple items)
 * - Filter node (filtering items)
 * - NoOp node (pass-through)
 *
 * These tests define the expected API before implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  IfNode,
  SwitchNode,
  LoopNode,
  MergeNode,
  SplitNode,
  FilterNode,
  NoOpNode,
  WaitNode,
  ExecutionBranch,
  NodeOutput,
} from '../nodes'

describe('Flow Control Nodes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================================
  // IF NODE
  // ============================================================================

  describe('IfNode', () => {
    it('should create an IF node with conditions', () => {
      const node = new IfNode({
        conditions: [
          { field: 'status', operator: 'equals', value: 'active' },
        ],
      })

      expect(node.conditions).toHaveLength(1)
    })

    it('should route to true branch when condition is met', async () => {
      const node = new IfNode({
        conditions: [
          { field: 'value', operator: 'greaterThan', value: 10 },
        ],
      })

      const result = await node.execute({ value: 15 })

      expect(result.branch).toBe('true')
      expect(result.output).toEqual({ value: 15 })
    })

    it('should route to false branch when condition is not met', async () => {
      const node = new IfNode({
        conditions: [
          { field: 'value', operator: 'greaterThan', value: 10 },
        ],
      })

      const result = await node.execute({ value: 5 })

      expect(result.branch).toBe('false')
    })

    it('should support multiple conditions with AND logic', async () => {
      const node = new IfNode({
        conditions: [
          { field: 'status', operator: 'equals', value: 'active' },
          { field: 'count', operator: 'greaterThan', value: 0 },
        ],
        combineWith: 'and',
      })

      // Both conditions met
      const result1 = await node.execute({ status: 'active', count: 5 })
      expect(result1.branch).toBe('true')

      // One condition not met
      const result2 = await node.execute({ status: 'active', count: 0 })
      expect(result2.branch).toBe('false')
    })

    it('should support multiple conditions with OR logic', async () => {
      const node = new IfNode({
        conditions: [
          { field: 'role', operator: 'equals', value: 'admin' },
          { field: 'role', operator: 'equals', value: 'superuser' },
        ],
        combineWith: 'or',
      })

      const result1 = await node.execute({ role: 'admin' })
      expect(result1.branch).toBe('true')

      const result2 = await node.execute({ role: 'superuser' })
      expect(result2.branch).toBe('true')

      const result3 = await node.execute({ role: 'user' })
      expect(result3.branch).toBe('false')
    })

    it('should support various comparison operators', async () => {
      const operators = [
        { op: 'equals', field: 'a', value: 5, input: { a: 5 }, expected: true },
        { op: 'notEquals', field: 'a', value: 5, input: { a: 3 }, expected: true },
        { op: 'greaterThan', field: 'a', value: 5, input: { a: 10 }, expected: true },
        { op: 'greaterThanOrEqual', field: 'a', value: 5, input: { a: 5 }, expected: true },
        { op: 'lessThan', field: 'a', value: 5, input: { a: 3 }, expected: true },
        { op: 'lessThanOrEqual', field: 'a', value: 5, input: { a: 5 }, expected: true },
        { op: 'contains', field: 'a', value: 'hello', input: { a: 'hello world' }, expected: true },
        { op: 'notContains', field: 'a', value: 'xyz', input: { a: 'hello' }, expected: true },
        { op: 'startsWith', field: 'a', value: 'hello', input: { a: 'hello world' }, expected: true },
        { op: 'endsWith', field: 'a', value: 'world', input: { a: 'hello world' }, expected: true },
        { op: 'regex', field: 'a', value: '^\\d{3}-\\d{4}$', input: { a: '123-4567' }, expected: true },
        { op: 'isEmpty', field: 'a', value: null, input: { a: '' }, expected: true },
        { op: 'isNotEmpty', field: 'a', value: null, input: { a: 'content' }, expected: true },
        { op: 'exists', field: 'a', value: null, input: { a: undefined }, expected: false },
        { op: 'exists', field: 'a', value: null, input: { a: 'value' }, expected: true },
      ]

      for (const { op, field, value, input, expected } of operators) {
        const node = new IfNode({
          conditions: [{ field, operator: op as any, value }],
        })

        const result = await node.execute(input)
        expect(result.branch).toBe(expected ? 'true' : 'false')
      }
    })

    it('should support nested field access', async () => {
      const node = new IfNode({
        conditions: [
          { field: 'user.profile.verified', operator: 'equals', value: true },
        ],
      })

      const result = await node.execute({
        user: { profile: { verified: true } },
      })

      expect(result.branch).toBe('true')
    })

    it('should support expression-based conditions', async () => {
      const node = new IfNode({
        conditions: [
          { expression: '={{input.a + input.b > 10}}' },
        ],
      })

      const result1 = await node.execute({ a: 5, b: 7 })
      expect(result1.branch).toBe('true')

      const result2 = await node.execute({ a: 2, b: 3 })
      expect(result2.branch).toBe('false')
    })
  })

  // ============================================================================
  // SWITCH NODE
  // ============================================================================

  describe('SwitchNode', () => {
    it('should create a switch node with rules', () => {
      const node = new SwitchNode({
        rules: [
          { output: 0, conditions: [{ field: 'type', operator: 'equals', value: 'A' }] },
          { output: 1, conditions: [{ field: 'type', operator: 'equals', value: 'B' }] },
        ],
        fallbackOutput: 2,
      })

      expect(node.rules).toHaveLength(2)
      expect(node.fallbackOutput).toBe(2)
    })

    it('should route to matching rule output', async () => {
      const node = new SwitchNode({
        rules: [
          { output: 0, conditions: [{ field: 'type', operator: 'equals', value: 'user' }] },
          { output: 1, conditions: [{ field: 'type', operator: 'equals', value: 'order' }] },
          { output: 2, conditions: [{ field: 'type', operator: 'equals', value: 'product' }] },
        ],
        fallbackOutput: 3,
      })

      const result1 = await node.execute({ type: 'user' })
      expect(result1.outputIndex).toBe(0)

      const result2 = await node.execute({ type: 'order' })
      expect(result2.outputIndex).toBe(1)

      const result3 = await node.execute({ type: 'product' })
      expect(result3.outputIndex).toBe(2)
    })

    it('should route to fallback when no rule matches', async () => {
      const node = new SwitchNode({
        rules: [
          { output: 0, conditions: [{ field: 'type', operator: 'equals', value: 'known' }] },
        ],
        fallbackOutput: 1,
      })

      const result = await node.execute({ type: 'unknown' })

      expect(result.outputIndex).toBe(1)
    })

    it('should support mode: all to activate multiple outputs', async () => {
      const node = new SwitchNode({
        rules: [
          { output: 0, conditions: [{ field: 'tags', operator: 'contains', value: 'urgent' }] },
          { output: 1, conditions: [{ field: 'tags', operator: 'contains', value: 'important' }] },
          { output: 2, conditions: [{ field: 'priority', operator: 'greaterThan', value: 5 }] },
        ],
        mode: 'all',
      })

      const result = await node.execute({
        tags: 'urgent important task',
        priority: 8,
      })

      // All matching rules should be activated
      expect(result.outputs).toEqual([0, 1, 2])
    })

    it('should stop at first match when mode is first', async () => {
      const node = new SwitchNode({
        rules: [
          { output: 0, conditions: [{ field: 'value', operator: 'greaterThan', value: 0 }] },
          { output: 1, conditions: [{ field: 'value', operator: 'greaterThan', value: 5 }] },
        ],
        mode: 'first',
      })

      const result = await node.execute({ value: 10 })

      // Should only match first rule, even though second would also match
      expect(result.outputs).toEqual([0])
    })

    it('should support named outputs', async () => {
      const node = new SwitchNode({
        rules: [
          {
            output: 'email',
            conditions: [{ field: 'channel', operator: 'equals', value: 'email' }],
          },
          {
            output: 'sms',
            conditions: [{ field: 'channel', operator: 'equals', value: 'sms' }],
          },
          {
            output: 'push',
            conditions: [{ field: 'channel', operator: 'equals', value: 'push' }],
          },
        ],
        fallbackOutput: 'default',
      })

      const result = await node.execute({ channel: 'sms' })

      expect(result.outputName).toBe('sms')
    })
  })

  // ============================================================================
  // LOOP NODE
  // ============================================================================

  describe('LoopNode', () => {
    it('should create a loop node', () => {
      const node = new LoopNode({
        loopOver: 'items',
      })

      expect(node.loopOver).toBe('items')
    })

    it('should iterate over array items', async () => {
      const node = new LoopNode({
        loopOver: 'items',
      })

      const results: NodeOutput[] = []
      await node.execute(
        { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        { onItem: (output) => results.push(output) }
      )

      expect(results).toHaveLength(3)
      expect(results[0].data).toEqual({ id: 1 })
      expect(results[1].data).toEqual({ id: 2 })
      expect(results[2].data).toEqual({ id: 3 })
    })

    it('should provide loop index and metadata', async () => {
      const node = new LoopNode({
        loopOver: 'items',
      })

      const results: NodeOutput[] = []
      await node.execute(
        { items: ['a', 'b', 'c'] },
        { onItem: (output) => results.push(output) }
      )

      expect(results[0].loopIndex).toBe(0)
      expect(results[0].isFirst).toBe(true)
      expect(results[0].isLast).toBe(false)

      expect(results[2].loopIndex).toBe(2)
      expect(results[2].isFirst).toBe(false)
      expect(results[2].isLast).toBe(true)
    })

    it('should support batch size', async () => {
      const node = new LoopNode({
        loopOver: 'items',
        batchSize: 2,
      })

      const batches: NodeOutput[] = []
      await node.execute(
        { items: [1, 2, 3, 4, 5] },
        { onBatch: (output) => batches.push(output) }
      )

      expect(batches).toHaveLength(3) // [1,2], [3,4], [5]
      expect(batches[0].data).toEqual([1, 2])
      expect(batches[1].data).toEqual([3, 4])
      expect(batches[2].data).toEqual([5])
    })

    it('should support loop with condition (while)', async () => {
      const node = new LoopNode({
        mode: 'while',
        condition: { field: 'counter', operator: 'lessThan', value: 5 },
      })

      let counter = 0
      const results: number[] = []

      await node.execute(
        { counter: 0 },
        {
          onItem: (output) => {
            results.push(output.data.counter)
            counter++
            return { counter }
          },
        }
      )

      expect(results).toEqual([0, 1, 2, 3, 4])
    })

    it('should support max iterations limit', async () => {
      const node = new LoopNode({
        mode: 'while',
        condition: { expression: '={{true}}' }, // Always true
        maxIterations: 10,
      })

      let iterations = 0
      await node.execute({}, {
        onItem: () => {
          iterations++
          return {}
        },
      })

      expect(iterations).toBe(10)
    })

    it('should allow breaking out of loop', async () => {
      const node = new LoopNode({
        loopOver: 'items',
      })

      const results: number[] = []
      await node.execute(
        { items: [1, 2, 3, 4, 5] },
        {
          onItem: (output) => {
            results.push(output.data)
            if (output.data === 3) {
              return { break: true }
            }
            return {}
          },
        }
      )

      expect(results).toEqual([1, 2, 3])
    })

    it('should support continue to skip iterations', async () => {
      const node = new LoopNode({
        loopOver: 'items',
      })

      const results: number[] = []
      await node.execute(
        { items: [1, 2, 3, 4, 5] },
        {
          onItem: (output) => {
            if (output.data % 2 === 0) {
              return { continue: true }
            }
            results.push(output.data)
            return {}
          },
        }
      )

      expect(results).toEqual([1, 3, 5])
    })

    it('should collect loop results', async () => {
      const node = new LoopNode({
        loopOver: 'items',
        collectResults: true,
      })

      const result = await node.execute(
        { items: [1, 2, 3] },
        {
          onItem: (output) => ({ doubled: output.data * 2 }),
        }
      )

      expect(result.collectedResults).toEqual([
        { doubled: 2 },
        { doubled: 4 },
        { doubled: 6 },
      ])
    })
  })

  // ============================================================================
  // MERGE NODE
  // ============================================================================

  describe('MergeNode', () => {
    it('should create a merge node', () => {
      const node = new MergeNode({
        mode: 'wait',
      })

      expect(node.mode).toBe('wait')
    })

    it('should wait for all inputs in wait mode', async () => {
      const node = new MergeNode({
        mode: 'wait',
        inputCount: 2,
      })

      // First input arrives
      const result1 = await node.addInput(0, { branch: 'a', data: { a: 1 } })
      expect(result1.ready).toBe(false)

      // Second input arrives
      const result2 = await node.addInput(1, { branch: 'b', data: { b: 2 } })
      expect(result2.ready).toBe(true)
      expect(result2.output).toEqual([
        { a: 1 },
        { b: 2 },
      ])
    })

    it('should combine inputs in combine mode', async () => {
      const node = new MergeNode({
        mode: 'combine',
        inputCount: 2,
      })

      await node.addInput(0, { data: { user: { id: 1 } } })
      const result = await node.addInput(1, { data: { orders: [1, 2] } })

      expect(result.output).toEqual({
        user: { id: 1 },
        orders: [1, 2],
      })
    })

    it('should append items in append mode', async () => {
      const node = new MergeNode({
        mode: 'append',
        inputCount: 2,
      })

      await node.addInput(0, { data: [{ id: 1 }, { id: 2 }] })
      const result = await node.addInput(1, { data: [{ id: 3 }] })

      expect(result.output).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ])
    })

    it('should pass first input in passThrough mode', async () => {
      const node = new MergeNode({
        mode: 'passThrough',
        inputCount: 2,
      })

      const result1 = await node.addInput(0, { data: { first: true } })
      expect(result1.ready).toBe(true)
      expect(result1.output).toEqual({ first: true })

      // Second input is ignored
      const result2 = await node.addInput(1, { data: { second: true } })
      expect(result2.ready).toBe(false)
    })

    it('should join on key in multiplex mode', async () => {
      const node = new MergeNode({
        mode: 'multiplex',
        joinKey: 'id',
        inputCount: 2,
      })

      await node.addInput(0, {
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      })

      const result = await node.addInput(1, {
        data: [
          { id: 1, score: 100 },
          { id: 2, score: 85 },
        ],
      })

      expect(result.output).toEqual([
        { id: 1, name: 'Alice', score: 100 },
        { id: 2, name: 'Bob', score: 85 },
      ])
    })

    it('should handle timeout for missing inputs', async () => {
      const node = new MergeNode({
        mode: 'wait',
        inputCount: 2,
        timeout: 1000,
      })

      await node.addInput(0, { data: { a: 1 } })

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(1100)

      const result = await node.getResult()

      expect(result.timedOut).toBe(true)
      expect(result.missingInputs).toContain(1)
    })

    it('should reset after output', async () => {
      const node = new MergeNode({
        mode: 'wait',
        inputCount: 2,
      })

      // First round
      await node.addInput(0, { data: { round: 1 } })
      await node.addInput(1, { data: { round: 1 } })

      // Reset for second round
      node.reset()

      // Second round
      await node.addInput(0, { data: { round: 2 } })
      const result = await node.addInput(1, { data: { round: 2 } })

      expect(result.output[0].round).toBe(2)
    })
  })

  // ============================================================================
  // SPLIT NODE
  // ============================================================================

  describe('SplitNode', () => {
    it('should split array into individual items', async () => {
      const node = new SplitNode({
        splitOn: 'items',
      })

      const result = await node.execute({
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        metadata: { source: 'test' },
      })

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ id: 1 })
      expect(result.items[1]).toEqual({ id: 2 })
      expect(result.items[2]).toEqual({ id: 3 })
    })

    it('should include original context with each item', async () => {
      const node = new SplitNode({
        splitOn: 'items',
        includeContext: true,
      })

      const result = await node.execute({
        items: [1, 2],
        batchId: 'batch-1',
      })

      expect(result.items[0]).toEqual({
        item: 1,
        context: { batchId: 'batch-1' },
      })
    })

    it('should support splitting by delimiter', async () => {
      const node = new SplitNode({
        splitOn: 'text',
        delimiter: ',',
      })

      const result = await node.execute({
        text: 'apple,banana,cherry',
      })

      expect(result.items).toEqual(['apple', 'banana', 'cherry'])
    })

    it('should handle empty arrays', async () => {
      const node = new SplitNode({
        splitOn: 'items',
      })

      const result = await node.execute({
        items: [],
      })

      expect(result.items).toHaveLength(0)
    })
  })

  // ============================================================================
  // FILTER NODE
  // ============================================================================

  describe('FilterNode', () => {
    it('should filter items by condition', async () => {
      const node = new FilterNode({
        conditions: [
          { field: 'status', operator: 'equals', value: 'active' },
        ],
      })

      const result = await node.execute({
        items: [
          { id: 1, status: 'active' },
          { id: 2, status: 'inactive' },
          { id: 3, status: 'active' },
          { id: 4, status: 'pending' },
        ],
      })

      expect(result.kept).toHaveLength(2)
      expect(result.kept.map((i: any) => i.id)).toEqual([1, 3])
    })

    it('should output filtered items separately', async () => {
      const node = new FilterNode({
        conditions: [
          { field: 'value', operator: 'greaterThan', value: 50 },
        ],
        outputFiltered: true,
      })

      const result = await node.execute({
        items: [
          { id: 1, value: 30 },
          { id: 2, value: 70 },
          { id: 3, value: 20 },
          { id: 4, value: 90 },
        ],
      })

      expect(result.kept).toHaveLength(2)
      expect(result.filtered).toHaveLength(2)
      expect(result.filtered.map((i: any) => i.id)).toEqual([1, 3])
    })

    it('should support multiple conditions', async () => {
      const node = new FilterNode({
        conditions: [
          { field: 'age', operator: 'greaterThanOrEqual', value: 18 },
          { field: 'verified', operator: 'equals', value: true },
        ],
        combineWith: 'and',
      })

      const result = await node.execute({
        items: [
          { name: 'Alice', age: 25, verified: true },
          { name: 'Bob', age: 16, verified: true },
          { name: 'Charlie', age: 30, verified: false },
          { name: 'Diana', age: 20, verified: true },
        ],
      })

      expect(result.kept.map((i: any) => i.name)).toEqual(['Alice', 'Diana'])
    })

    it('should work with single item input', async () => {
      const node = new FilterNode({
        conditions: [
          { field: 'status', operator: 'equals', value: 'active' },
        ],
      })

      const result1 = await node.execute({ status: 'active', id: 1 })
      expect(result1.passed).toBe(true)
      expect(result1.output).toEqual({ status: 'active', id: 1 })

      const result2 = await node.execute({ status: 'inactive', id: 2 })
      expect(result2.passed).toBe(false)
    })
  })

  // ============================================================================
  // NO-OP NODE
  // ============================================================================

  describe('NoOpNode', () => {
    it('should pass data through unchanged', async () => {
      const node = new NoOpNode()

      const input = { foo: 'bar', nested: { value: 42 } }
      const result = await node.execute(input)

      expect(result.output).toEqual(input)
    })

    it('should support adding notes/documentation', () => {
      const node = new NoOpNode({
        notes: 'This is a placeholder for future implementation',
      })

      expect(node.notes).toBe('This is a placeholder for future implementation')
    })
  })

  // ============================================================================
  // WAIT NODE
  // ============================================================================

  describe('WaitNode', () => {
    it('should wait for specified duration', async () => {
      const node = new WaitNode({
        duration: '1s',
      })

      const startTime = Date.now()
      const resultPromise = node.execute({})

      await vi.advanceTimersByTimeAsync(1000)

      const result = await resultPromise

      expect(result.waitedMs).toBeGreaterThanOrEqual(1000)
    })

    it('should support various duration formats', async () => {
      const durations = ['500ms', '5s', '2m', '1h']

      for (const duration of durations) {
        const node = new WaitNode({ duration })
        expect(node.getDurationMs()).toBeGreaterThan(0)
      }
    })

    it('should wait until specific time', async () => {
      const futureTime = new Date(Date.now() + 5000)

      const node = new WaitNode({
        until: futureTime.toISOString(),
      })

      const resultPromise = node.execute({})

      await vi.advanceTimersByTimeAsync(5000)

      const result = await resultPromise

      expect(result.success).toBe(true)
    })

    it('should support wait on webhook response', async () => {
      const node = new WaitNode({
        resumeOn: 'webhook',
        webhookPath: '/continue',
        timeout: '1h',
      })

      const resultPromise = node.execute({})

      // Simulate webhook trigger
      await vi.advanceTimersByTimeAsync(100)
      node.resume({ confirmed: true })

      const result = await resultPromise

      expect(result.resumeData).toEqual({ confirmed: true })
    })

    it('should timeout if not resumed', async () => {
      const node = new WaitNode({
        resumeOn: 'webhook',
        timeout: '1s',
      })

      const resultPromise = node.execute({})

      await vi.advanceTimersByTimeAsync(1100)

      const result = await resultPromise

      expect(result.timedOut).toBe(true)
    })
  })

  // ============================================================================
  // NODE COMPOSITION
  // ============================================================================

  describe('Node Composition', () => {
    it('should chain IF node with actions', async () => {
      const ifNode = new IfNode({
        conditions: [
          { field: 'status', operator: 'equals', value: 'vip' },
        ],
      })

      const result = await ifNode.execute({ status: 'vip', email: 'vip@example.com' })

      if (result.branch === 'true') {
        // VIP path
        expect(result.output.status).toBe('vip')
      } else {
        // Regular path
        expect(result.output.status).not.toBe('vip')
      }
    })

    it('should combine switch with loop', async () => {
      const switchNode = new SwitchNode({
        rules: [
          { output: 'batch', conditions: [{ field: 'type', operator: 'equals', value: 'batch' }] },
          { output: 'single', conditions: [{ field: 'type', operator: 'equals', value: 'single' }] },
        ],
      })

      const result = await switchNode.execute({ type: 'batch', items: [1, 2, 3] })

      if (result.outputName === 'batch') {
        const loopNode = new LoopNode({ loopOver: 'items' })
        const items: number[] = []

        await loopNode.execute(
          result.output,
          { onItem: (output) => items.push(output.data) }
        )

        expect(items).toEqual([1, 2, 3])
      }
    })
  })
})
