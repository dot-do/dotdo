/**
 * Function Cascade Chain Resolution Tests
 *
 * Tests for the FunctionGraphAdapter cascade chain resolution functionality.
 *
 * @see dotdo-mvzvj - [GREEN] Cascade Chain Graph Resolution
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SQLiteGraphStore } from '../../stores'
import {
  FunctionGraphAdapter,
  createFunctionGraphAdapter,
  type FunctionData,
  type CascadeRelationshipData,
} from '../function-graph-adapter'

describe('FunctionGraphAdapter', () => {
  let store: SQLiteGraphStore
  let adapter: FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = new FunctionGraphAdapter(store)
  })

  describe('Function CRUD Operations', () => {
    it('should create a function', async () => {
      const fn = await adapter.createFunction({
        name: 'calculate',
        type: 'code',
        handler: 'handlers/calculate.ts',
      })

      expect(fn.id).toBeDefined()
      // Function type name is based on the function type (code -> CodeFunction)
      expect(fn.typeName).toBe('CodeFunction')

      const data = fn.data as FunctionData
      expect(data.name).toBe('calculate')
      expect(data.type).toBe('code')
      expect(data.handler).toBe('handlers/calculate.ts')
      expect(data.enabled).toBe(true)
      expect(data.version).toBe('1.0.0')
    })

    it('should create a function with custom ID', async () => {
      const fn = await adapter.createFunction(
        {
          name: 'custom',
          type: 'generative',
        },
        { id: 'my-custom-id' }
      )

      expect(fn.id).toBe('my-custom-id')
    })

    it('should get a function by ID', async () => {
      const created = await adapter.createFunction({
        name: 'test',
        type: 'code',
      })

      const retrieved = await adapter.getFunction(created.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
    })

    it('should return null for non-existent function', async () => {
      const fn = await adapter.getFunction('non-existent')
      expect(fn).toBeNull()
    })

    it('should get functions by type', async () => {
      await adapter.createFunction({ name: 'code1', type: 'code' })
      await adapter.createFunction({ name: 'code2', type: 'code' })
      await adapter.createFunction({ name: 'ai1', type: 'generative' })

      const codeFunctions = await adapter.getFunctionsByType('code')
      expect(codeFunctions).toHaveLength(2)

      const aiFunctions = await adapter.getFunctionsByType('generative')
      expect(aiFunctions).toHaveLength(1)
    })

    it('should update a function', async () => {
      const fn = await adapter.createFunction({
        name: 'original',
        type: 'code',
      })

      const updated = await adapter.updateFunction(fn.id, {
        name: 'updated',
        description: 'New description',
      })

      expect(updated).toBeDefined()
      const data = updated!.data as FunctionData
      expect(data.name).toBe('updated')
      expect(data.description).toBe('New description')
      expect(data.type).toBe('code') // Unchanged
    })

    it('should delete a function', async () => {
      const fn = await adapter.createFunction({
        name: 'to-delete',
        type: 'code',
      })

      const deleted = await adapter.deleteFunction(fn.id)
      // Returns the deleted function (soft delete) or null if not found
      expect(deleted).not.toBeNull()
      expect(deleted!.id).toBe(fn.id)
      expect(deleted!.deletedAt).not.toBeNull()

      const retrieved = await adapter.getFunction(fn.id)
      expect(retrieved).toBeNull() // Soft deleted - getFunction excludes deleted
    })
  })

  describe('Cascade Relationship Operations', () => {
    it('should add a cascade relationship', async () => {
      const fn1 = await adapter.createFunction({ name: 'code', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'ai', type: 'generative' })

      const rel = await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })

      expect(rel.id).toBeDefined()
      expect(rel.verb).toBe('cascadesTo')
      expect(rel.from).toContain(fn1.id)
      expect(rel.to).toContain(fn2.id)

      const data = rel.data as CascadeRelationshipData
      expect(data.priority).toBe(0)
    })

    it('should add cascade with condition', async () => {
      const fn1 = await adapter.createFunction({ name: 'code', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'ai', type: 'generative' })

      const rel = await adapter.addCascade(fn1.id, fn2.id, {
        priority: 1,
        condition: 'on-error',
      })

      const data = rel.data as CascadeRelationshipData
      expect(data.condition).toBe('on-error')
    })

    it('should remove a cascade relationship', async () => {
      const fn1 = await adapter.createFunction({ name: 'code', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'ai', type: 'generative' })

      await adapter.addCascade(fn1.id, fn2.id)

      const removed = await adapter.removeCascade(fn1.id, fn2.id)
      expect(removed).toBe(true)

      const targets = await adapter.getCascadeTargets(fn1.id)
      expect(targets).toHaveLength(0)
    })

    it('should get cascade targets sorted by priority', async () => {
      const fn1 = await adapter.createFunction({ name: 'code', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'ai1', type: 'generative' })
      const fn3 = await adapter.createFunction({ name: 'ai2', type: 'agentic' })
      const fn4 = await adapter.createFunction({ name: 'human', type: 'human' })

      // Add in non-priority order
      await adapter.addCascade(fn1.id, fn3.id, { priority: 2 })
      await adapter.addCascade(fn1.id, fn4.id, { priority: 3 })
      await adapter.addCascade(fn1.id, fn2.id, { priority: 1 })

      const targets = await adapter.getCascadeTargets(fn1.id)
      expect(targets).toHaveLength(3)
      expect(targets[0]!.function.id).toBe(fn2.id) // priority 1
      expect(targets[1]!.function.id).toBe(fn3.id) // priority 2
      expect(targets[2]!.function.id).toBe(fn4.id) // priority 3
    })
  })

  describe('Cascade Chain Resolution', () => {
    it('should resolve a simple cascade chain', async () => {
      const code = await adapter.createFunction({ name: 'code', type: 'code' })
      const generative = await adapter.createFunction({ name: 'generative', type: 'generative' })
      const agentic = await adapter.createFunction({ name: 'agentic', type: 'agentic' })
      const human = await adapter.createFunction({ name: 'human', type: 'human' })

      await adapter.addCascade(code.id, generative.id, { priority: 0 })
      await adapter.addCascade(generative.id, agentic.id, { priority: 0 })
      await adapter.addCascade(agentic.id, human.id, { priority: 0 })

      const chain = await adapter.getCascadeChain(code.id)

      expect(chain).toHaveLength(4)
      expect(chain[0]!.id).toBe(code.id)
      expect(chain[1]!.id).toBe(generative.id)
      expect(chain[2]!.id).toBe(agentic.id)
      expect(chain[3]!.id).toBe(human.id)
    })

    it('should handle single function with no cascades', async () => {
      const fn = await adapter.createFunction({ name: 'standalone', type: 'code' })

      const chain = await adapter.getCascadeChain(fn.id)

      expect(chain).toHaveLength(1)
      expect(chain[0]!.id).toBe(fn.id)
    })

    it('should handle cycles in cascade chain', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'agentic' })

      // Create a cycle: fn1 -> fn2 -> fn3 -> fn1
      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })
      await adapter.addCascade(fn3.id, fn1.id, { priority: 0 }) // Cycle back

      const chain = await adapter.getCascadeChain(fn1.id)

      // Should stop at the cycle, not include fn1 twice
      expect(chain).toHaveLength(3)
      expect(chain[0]!.id).toBe(fn1.id)
      expect(chain[1]!.id).toBe(fn2.id)
      expect(chain[2]!.id).toBe(fn3.id)
    })

    it('should detect cycles in cascade chain', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })

      // Create a cycle
      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn1.id, { priority: 0 })

      const hasCycle = await adapter.hasCascadeCycle(fn1.id)
      expect(hasCycle).toBe(true)
    })

    it('should not detect cycle when none exists', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })

      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })

      const hasCycle = await adapter.hasCascadeCycle(fn1.id)
      expect(hasCycle).toBe(false)
    })

    it('should respect priority ordering in chain resolution', async () => {
      const fn1 = await adapter.createFunction({ name: 'start', type: 'code' })
      const fn2High = await adapter.createFunction({ name: 'high-priority', type: 'generative' })
      const fn2Low = await adapter.createFunction({ name: 'low-priority', type: 'agentic' })
      const fn3 = await adapter.createFunction({ name: 'end', type: 'human' })

      // fn1 has two cascades with different priorities
      await adapter.addCascade(fn1.id, fn2Low.id, { priority: 10 })
      await adapter.addCascade(fn1.id, fn2High.id, { priority: 1 })

      // Both fn2s cascade to fn3
      await adapter.addCascade(fn2High.id, fn3.id, { priority: 0 })
      await adapter.addCascade(fn2Low.id, fn3.id, { priority: 0 })

      const chain = await adapter.getCascadeChain(fn1.id)

      // Should follow high-priority path: fn1 -> fn2High -> fn3
      expect(chain).toHaveLength(3)
      expect(chain[0]!.id).toBe(fn1.id)
      expect(chain[1]!.id).toBe(fn2High.id) // Lower priority number = higher priority
      expect(chain[2]!.id).toBe(fn3.id)
    })

    it('should respect maxDepth option', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'agentic' })
      const fn4 = await adapter.createFunction({ name: 'fn4', type: 'human' })

      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })
      await adapter.addCascade(fn3.id, fn4.id, { priority: 0 })

      const chain = await adapter.getCascadeChain(fn1.id, { maxDepth: 2 })

      expect(chain).toHaveLength(2)
      expect(chain[0]!.id).toBe(fn1.id)
      expect(chain[1]!.id).toBe(fn2.id)
    })

    it('should skip disabled functions by default', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative', enabled: false })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'agentic' })

      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })

      const chain = await adapter.getCascadeChain(fn1.id)

      // Should stop at disabled fn2
      expect(chain).toHaveLength(1)
      expect(chain[0]!.id).toBe(fn1.id)
    })

    it('should include disabled functions when requested', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative', enabled: false })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'agentic' })

      await adapter.addCascade(fn1.id, fn2.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })

      const chain = await adapter.getCascadeChain(fn1.id, { includeDisabled: true })

      expect(chain).toHaveLength(3)
    })

    it('should filter by condition', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2Error = await adapter.createFunction({ name: 'fn2-error', type: 'generative' })
      const fn2Timeout = await adapter.createFunction({ name: 'fn2-timeout', type: 'agentic' })

      await adapter.addCascade(fn1.id, fn2Error.id, { priority: 1, condition: 'on-error' })
      await adapter.addCascade(fn1.id, fn2Timeout.id, { priority: 2, condition: 'on-timeout' })

      const chainError = await adapter.getCascadeChain(fn1.id, { condition: 'on-error' })
      expect(chainError).toHaveLength(2)
      expect(chainError[1]!.id).toBe(fn2Error.id)

      const chainTimeout = await adapter.getCascadeChain(fn1.id, { condition: 'on-timeout' })
      expect(chainTimeout).toHaveLength(2)
      expect(chainTimeout[1]!.id).toBe(fn2Timeout.id)
    })
  })

  describe('Detailed Cascade Chain', () => {
    it('should return detailed chain with relationship data', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })

      await adapter.addCascade(fn1.id, fn2.id, { priority: 5, metadata: { reason: 'fallback' } })

      const chain = await adapter.getCascadeChainDetailed(fn1.id)

      expect(chain).toHaveLength(2)

      // First entry has no incoming relationship
      expect(chain[0]!.function.id).toBe(fn1.id)
      expect(chain[0]!.relationship).toBeNull()
      expect(chain[0]!.depth).toBe(0)

      // Second entry has the cascade relationship
      expect(chain[1]!.function.id).toBe(fn2.id)
      expect(chain[1]!.relationship).toBeDefined()
      expect(chain[1]!.relationship!.verb).toBe('cascadesTo')
      expect(chain[1]!.depth).toBe(1)

      const relData = chain[1]!.relationship!.data as CascadeRelationshipData
      expect(relData.priority).toBe(5)
      expect(relData.metadata).toEqual({ reason: 'fallback' })
    })
  })

  describe('Reverse Cascade Lookup', () => {
    it('should find cascade sources', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'agentic' })

      // Both fn1 and fn2 cascade to fn3
      await adapter.addCascade(fn1.id, fn3.id, { priority: 0 })
      await adapter.addCascade(fn2.id, fn3.id, { priority: 0 })

      const sources = await adapter.getCascadeSources(fn3.id)

      expect(sources).toHaveLength(2)
      const sourceIds = sources.map((s) => s.id)
      expect(sourceIds).toContain(fn1.id)
      expect(sourceIds).toContain(fn2.id)
    })
  })

  describe('Factory Function', () => {
    it('should create adapter via factory', async () => {
      const factoryAdapter = createFunctionGraphAdapter(store)
      const fn = await factoryAdapter.createFunction({ name: 'test', type: 'code' })

      expect(fn).toBeDefined()
      expect(fn.typeName).toBe('CodeFunction')
    })
  })

  describe('Store Access', () => {
    it('should expose underlying store', () => {
      const underlyingStore = adapter.getStore()
      expect(underlyingStore).toBe(store)
    })
  })
})
