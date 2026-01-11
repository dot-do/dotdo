/**
 * Pipeline Tests
 *
 * Tests for promise pipelining including:
 * - Execution plan building
 * - Dependency resolution
 * - Cycle detection
 * - Path utilities
 */

import { describe, it, expect } from 'vitest'
import {
  buildExecutionPlan,
  getValueByPath,
  setValueByPath,
  BatchBuilder,
} from '../src/pipeline'
import type { PipelineRequest, ExecutionPlan } from '../src/pipeline'

describe('Pipeline', () => {
  describe('Execution Plan Building', () => {
    it('should build plan for independent requests', () => {
      const requests: PipelineRequest[] = [
        { id: 'req-1', service: 'agents', method: 'list' },
        { id: 'req-2', service: 'workers', method: 'list' },
        { id: 'req-3', service: 'llm', method: 'models' },
      ]

      const plan = buildExecutionPlan(requests)

      expect(plan.stages.length).toBe(1) // All independent, single stage
      expect(plan.stages[0].length).toBe(3)
      expect(plan.cycles).toBeUndefined()
    })

    it('should build plan with dependencies', () => {
      const requests: PipelineRequest[] = [
        { id: 'req-1', service: 'agents', method: 'get' },
        { id: 'req-2', service: 'agents', method: 'invoke', depends: ['req-1'] },
        { id: 'req-3', service: 'agents', method: 'cleanup', depends: ['req-2'] },
      ]

      const plan = buildExecutionPlan(requests)

      expect(plan.stages.length).toBe(3) // Sequential, 3 stages
      expect(plan.stages[0].map((r) => r.id)).toContain('req-1')
      expect(plan.stages[1].map((r) => r.id)).toContain('req-2')
      expect(plan.stages[2].map((r) => r.id)).toContain('req-3')
    })

    it('should build plan with parallel and sequential parts', () => {
      // req-1 and req-2 are independent
      // req-3 depends on both req-1 and req-2
      const requests: PipelineRequest[] = [
        { id: 'req-1', service: 'agents', method: 'get' },
        { id: 'req-2', service: 'workers', method: 'get' },
        { id: 'req-3', service: 'llm', method: 'complete', depends: ['req-1', 'req-2'] },
      ]

      const plan = buildExecutionPlan(requests)

      expect(plan.stages.length).toBe(2)
      expect(plan.stages[0].length).toBe(2) // req-1 and req-2 in parallel
      expect(plan.stages[1].length).toBe(1) // req-3 after both
    })

    it('should detect circular dependencies', () => {
      const requests: PipelineRequest[] = [
        { id: 'req-1', service: 'agents', method: 'get', depends: ['req-3'] },
        { id: 'req-2', service: 'agents', method: 'invoke', depends: ['req-1'] },
        { id: 'req-3', service: 'agents', method: 'cleanup', depends: ['req-2'] },
      ]

      const plan = buildExecutionPlan(requests)

      expect(plan.cycles).toBeDefined()
      expect(plan.cycles!.length).toBeGreaterThan(0)
      expect(plan.stages.length).toBe(0) // No valid execution plan
    })

    it('should extract dependencies from pipeline expressions', () => {
      const requests: PipelineRequest[] = [
        { id: 'req-1', service: 'agents', method: 'get' },
        {
          id: 'req-2',
          service: 'llm',
          method: 'complete',
          pipeline: [{ from: 'req-1', path: 'prompt', into: 'params.prompt' }],
        },
      ]

      const plan = buildExecutionPlan(requests)

      expect(plan.stages.length).toBe(2)
      expect(plan.stages[0].map((r) => r.id)).toContain('req-1')
      expect(plan.stages[1].map((r) => r.id)).toContain('req-2')
    })
  })

  describe('Path Utilities', () => {
    describe('getValueByPath', () => {
      it('should get value at root', () => {
        const obj = { foo: 'bar' }
        expect(getValueByPath(obj, '')).toEqual({ foo: 'bar' })
        expect(getValueByPath(obj, '.')).toEqual({ foo: 'bar' })
      })

      it('should get simple property', () => {
        const obj = { foo: 'bar' }
        expect(getValueByPath(obj, 'foo')).toBe('bar')
      })

      it('should get nested property', () => {
        const obj = { user: { profile: { name: 'Alice' } } }
        expect(getValueByPath(obj, 'user.profile.name')).toBe('Alice')
      })

      it('should get array element', () => {
        const obj = { items: ['a', 'b', 'c'] }
        expect(getValueByPath(obj, 'items[0]')).toBe('a')
        expect(getValueByPath(obj, 'items[1]')).toBe('b')
      })

      it('should get nested array element', () => {
        const obj = { users: [{ name: 'Alice' }, { name: 'Bob' }] }
        expect(getValueByPath(obj, 'users[0].name')).toBe('Alice')
        expect(getValueByPath(obj, 'users[1].name')).toBe('Bob')
      })

      it('should handle bracket notation', () => {
        const obj = { 'my-key': 'value' }
        expect(getValueByPath(obj, "['my-key']")).toBe('value')
      })

      it('should return undefined for missing path', () => {
        const obj = { foo: 'bar' }
        expect(getValueByPath(obj, 'baz')).toBeUndefined()
        expect(getValueByPath(obj, 'foo.bar.baz')).toBeUndefined()
      })

      it('should return undefined for null/undefined', () => {
        expect(getValueByPath(null, 'foo')).toBeUndefined()
        expect(getValueByPath(undefined, 'foo')).toBeUndefined()
      })
    })

    describe('setValueByPath', () => {
      it('should set value at root', () => {
        const result = setValueByPath({}, '', 'value')
        expect(result).toBe('value')
      })

      it('should set simple property', () => {
        const result = setValueByPath({}, 'foo', 'bar')
        expect(result).toEqual({ foo: 'bar' })
      })

      it('should set nested property', () => {
        const result = setValueByPath({}, 'user.profile.name', 'Alice')
        expect(result).toEqual({ user: { profile: { name: 'Alice' } } })
      })

      it('should set array element', () => {
        const result = setValueByPath({}, 'items[0]', 'value')
        expect(result).toEqual({ items: ['value'] })
      })

      it('should preserve existing properties', () => {
        const obj = { existing: 'value' }
        const result = setValueByPath(obj, 'new', 'added')
        expect(result).toEqual({ existing: 'value', new: 'added' })
      })

      it('should not mutate original object', () => {
        const obj = { foo: 'bar' }
        const result = setValueByPath(obj, 'baz', 'qux')
        expect(obj).toEqual({ foo: 'bar' }) // Original unchanged
        expect(result).toEqual({ foo: 'bar', baz: 'qux' })
      })
    })
  })

  describe('BatchBuilder', () => {
    it('should add requests', () => {
      const builder = new BatchBuilder()
      const id = builder.add({ service: 'agents', method: 'list' })
      const batch = builder.build()

      expect(batch.requests.length).toBe(1)
      expect(batch.requests[0].id).toBe(id)
      expect(batch.requests[0].service).toBe('agents')
    })

    it('should add requests with dependencies', () => {
      const builder = new BatchBuilder()
      const id1 = builder.add({ service: 'agents', method: 'get' })
      const id2 = builder.addAfter({ service: 'agents', method: 'invoke' }, id1)
      const batch = builder.build()

      expect(batch.requests.length).toBe(2)
      expect(batch.requests[1].depends).toContain(id1)
    })

    it('should add requests with pipeline expressions', () => {
      const builder = new BatchBuilder()
      const id1 = builder.add({ service: 'agents', method: 'get' })
      builder.addWithPipeline(
        { service: 'llm', method: 'complete' },
        [{ from: id1, path: 'prompt', into: 'params.prompt' }]
      )
      const batch = builder.build()

      expect(batch.requests.length).toBe(2)
      expect(batch.requests[1].pipeline).toBeDefined()
      expect(batch.requests[1].pipeline![0].from).toBe(id1)
    })

    it('should add pipeline references', () => {
      const builder = new BatchBuilder()
      const id1 = builder.add({ service: 'agents', method: 'get' }, 'req-1')
      const id2 = builder.add({ service: 'llm', method: 'complete' }, 'req-2')
      builder.pipe(id1, 'result.prompt', id2, 'params.prompt')
      const batch = builder.build()

      expect(batch.pipeline).toBeDefined()
      expect(batch.pipeline!.length).toBe(1)
      expect(batch.pipeline![0].sourceId).toBe(id1)
      expect(batch.pipeline![0].targetId).toBe(id2)
    })

    it('should generate custom batch ID', () => {
      const builder = new BatchBuilder()
      builder.add({ service: 'agents', method: 'list' })
      const batch = builder.build('my-batch-id')

      expect(batch.id).toBe('my-batch-id')
    })

    it('should reset builder', () => {
      const builder = new BatchBuilder()
      builder.add({ service: 'agents', method: 'list' })
      builder.reset()
      const batch = builder.build()

      expect(batch.requests.length).toBe(0)
    })
  })
})
