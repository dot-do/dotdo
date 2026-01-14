/**
 * ExecutorFactory - Unified executor creation with graph-based resolution
 *
 * TDD RED PHASE: Tests for the unified factory pattern that consolidates
 * executor instantiation with FunctionGraphAdapter-based cascade chain resolution.
 *
 * @see dotdo-2u2kp - [REFACTOR] Consolidate executor factories with graph-based resolution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DurableObjectState } from '@cloudflare/workers-types'

// Types we'll create
interface ExecutorFactoryOptions {
  state: DurableObjectState
  env: Record<string, unknown>
  graphStore?: unknown // GraphStore
}

interface ResolvedExecutorChain {
  executors: Array<{
    type: 'code' | 'generative' | 'agentic' | 'human'
    functionId: string
    handler?: unknown
  }>
  cascadeConfig: {
    maxDepth: number
    condition?: string
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ExecutorFactory', () => {
  describe('createFromGraph', () => {
    it('should resolve cascade chain from graph and create executor handlers', async () => {
      // Arrange: We have functions in the graph with cascade relationships
      // code -> generative -> human
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'calculate', type: 'code', handler: 'handlers/calculate.ts' },
        },
        {
          id: 'fn-gen-1',
          typeName: 'GenerativeFunction',
          data: { name: 'calculate-ai', type: 'generative', handler: 'ai/calculate' },
        },
        {
          id: 'fn-human-1',
          typeName: 'HumanFunction',
          data: { name: 'calculate-review', type: 'human', handler: 'humans/calculate' },
        },
      ], [
        { from: 'fn-code-1', to: 'fn-gen-1', verb: 'cascadesTo', priority: 0 },
        { from: 'fn-gen-1', to: 'fn-human-1', verb: 'cascadesTo', priority: 0 },
      ])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Resolve the cascade chain from a starting function
      const chain = await factory.resolveChain('fn-code-1')

      // Assert: Chain should have all three executors in order
      expect(chain.executors).toHaveLength(3)
      expect(chain.executors[0].type).toBe('code')
      expect(chain.executors[0].functionId).toBe('fn-code-1')
      expect(chain.executors[1].type).toBe('generative')
      expect(chain.executors[1].functionId).toBe('fn-gen-1')
      expect(chain.executors[2].type).toBe('human')
      expect(chain.executors[2].functionId).toBe('fn-human-1')
    })

    it('should respect version resolution for A/B testing', async () => {
      // Arrange: Function with multiple versions, one tagged as 'canary'
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'pricing', type: 'code' },
        },
        // Version Things
        {
          id: 'sha-v1-stable',
          typeName: 'FunctionVersion',
          data: { sha: 'sha-v1-stable', functionId: 'fn-code-1', message: 'stable' },
        },
        {
          id: 'sha-v2-canary',
          typeName: 'FunctionVersion',
          data: { sha: 'sha-v2-canary', functionId: 'fn-code-1', message: 'canary' },
        },
        // Refs
        {
          id: 'ref-latest',
          typeName: 'FunctionRef',
          data: { name: 'latest', functionId: 'fn-code-1', targetSha: 'sha-v1-stable' },
        },
        {
          id: 'ref-canary',
          typeName: 'FunctionRef',
          data: { name: 'canary', functionId: 'fn-code-1', targetSha: 'sha-v2-canary' },
        },
      ], [])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Resolve with specific version ref
      const stableChain = await factory.resolveChain('fn-code-1', { versionRef: 'latest' })
      const canaryChain = await factory.resolveChain('fn-code-1', { versionRef: 'canary' })

      // Assert: Different versions resolved
      expect(stableChain.executors[0].versionSha).toBe('sha-v1-stable')
      expect(canaryChain.executors[0].versionSha).toBe('sha-v2-canary')
    })

    it('should create CascadeExecutor with resolved handlers', async () => {
      // Arrange: Functions with handlers that can be executed
      const codeHandler = vi.fn().mockResolvedValue({ result: 'code' })
      const genHandler = vi.fn().mockResolvedValue({ result: 'ai' })

      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'process', type: 'code', handler: codeHandler },
        },
        {
          id: 'fn-gen-1',
          typeName: 'GenerativeFunction',
          data: { name: 'process-ai', type: 'generative', handler: genHandler },
        },
      ], [
        { from: 'fn-code-1', to: 'fn-gen-1', verb: 'cascadesTo', priority: 0 },
      ])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Create CascadeExecutor from resolved chain
      const executor = await factory.createCascadeExecutor('fn-code-1')

      // Assert: Executor should be created with handlers from graph
      expect(executor).toBeDefined()
      expect(executor.execute).toBeDefined()

      // Execute and verify cascade behavior
      const result = await executor.execute({ input: { data: 'test' } })
      expect(result.success).toBe(true)
      expect(result.method).toBe('code')
      expect(codeHandler).toHaveBeenCalled()
    })

    it('should handle missing functions gracefully', async () => {
      const mockGraphStore = createMockGraphStore([], [])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act & Assert: Should throw descriptive error for missing function
      await expect(factory.resolveChain('fn-nonexistent'))
        .rejects.toThrow(/not found/i)
    })

    it('should cache resolved chains for performance', async () => {
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'calculate', type: 'code' },
        },
      ], [])

      // Spy on the graph store to count queries
      const getThingSpy = vi.spyOn(mockGraphStore, 'getThing')

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Resolve same chain multiple times
      await factory.resolveChain('fn-code-1')
      await factory.resolveChain('fn-code-1')
      await factory.resolveChain('fn-code-1')

      // Assert: Graph should only be queried once (cached)
      expect(getThingSpy).toHaveBeenCalledTimes(1)
    })

    it('should invalidate cache when explicitly requested', async () => {
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'calculate', type: 'code' },
        },
      ], [])

      const getThingSpy = vi.spyOn(mockGraphStore, 'getThing')

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Resolve, invalidate, resolve again
      await factory.resolveChain('fn-code-1')
      factory.invalidateCache('fn-code-1')
      await factory.resolveChain('fn-code-1')

      // Assert: Graph should be queried twice (after invalidation)
      expect(getThingSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('getHandlerForType', () => {
    it('should return code executor for CodeFunction', async () => {
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'calculate', type: 'code', handler: 'handlers/calculate.ts' },
        },
      ], [])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act
      const handler = await factory.getHandlerForType('fn-code-1', 'code')

      // Assert
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('should return generative executor for GenerativeFunction', async () => {
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-gen-1',
          typeName: 'GenerativeFunction',
          data: { name: 'classify', type: 'generative', model: 'claude-3' },
        },
      ], [])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: { AI: {} },
        graphStore: mockGraphStore,
      })

      // Act
      const handler = await factory.getHandlerForType('fn-gen-1', 'generative')

      // Assert
      expect(handler).toBeDefined()
    })

    it('should return human executor for HumanFunction', async () => {
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-human-1',
          typeName: 'HumanFunction',
          data: { name: 'approve', type: 'human', channel: 'slack' },
        },
      ], [])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: { NOTIFICATIONS: {} },
        graphStore: mockGraphStore,
      })

      // Act
      const handler = await factory.getHandlerForType('fn-human-1', 'human')

      // Assert
      expect(handler).toBeDefined()
    })
  })

  describe('integration with CascadeExecutor', () => {
    it('should fallback through cascade chain on failure', async () => {
      // Arrange: Code handler fails, generative succeeds
      const codeHandler = vi.fn().mockRejectedValue(new Error('Code failed'))
      const genHandler = vi.fn().mockResolvedValue({ result: 'ai-success' })

      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'process', type: 'code', handler: codeHandler },
        },
        {
          id: 'fn-gen-1',
          typeName: 'GenerativeFunction',
          data: { name: 'process-ai', type: 'generative', handler: genHandler },
        },
      ], [
        { from: 'fn-code-1', to: 'fn-gen-1', verb: 'cascadesTo', priority: 0 },
      ])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act
      const executor = await factory.createCascadeExecutor('fn-code-1')
      const result = await executor.execute({ input: { data: 'test' } })

      // Assert: Should cascade to generative after code fails
      expect(result.success).toBe(true)
      expect(result.method).toBe('generative')
      expect(codeHandler).toHaveBeenCalled()
      expect(genHandler).toHaveBeenCalled()
      expect(result.cascade.steps).toHaveLength(2)
      expect(result.cascade.steps[0].type).toBe('code')
      expect(result.cascade.steps[0].success).toBe(false)
      expect(result.cascade.steps[1].type).toBe('generative')
      expect(result.cascade.steps[1].success).toBe(true)
    })

    it('should support conditional cascade based on graph conditions', async () => {
      // Arrange: Cascade with condition
      const mockGraphStore = createMockGraphStore([
        {
          id: 'fn-code-1',
          typeName: 'CodeFunction',
          data: { name: 'process', type: 'code' },
        },
        {
          id: 'fn-gen-1',
          typeName: 'GenerativeFunction',
          data: { name: 'process-ai', type: 'generative' },
        },
        {
          id: 'fn-human-1',
          typeName: 'HumanFunction',
          data: { name: 'process-human', type: 'human' },
        },
      ], [
        { from: 'fn-code-1', to: 'fn-gen-1', verb: 'cascadesTo', priority: 0, data: { condition: 'automated' } },
        { from: 'fn-code-1', to: 'fn-human-1', verb: 'cascadesTo', priority: 1, data: { condition: 'manual' } },
      ])

      const { ExecutorFactory } = await import('../ExecutorFactory')

      const factory = new ExecutorFactory({
        state: createMockState(),
        env: {},
        graphStore: mockGraphStore,
      })

      // Act: Resolve with condition
      const automatedChain = await factory.resolveChain('fn-code-1', { condition: 'automated' })
      const manualChain = await factory.resolveChain('fn-code-1', { condition: 'manual' })

      // Assert: Different chains based on condition
      expect(automatedChain.executors[1].functionId).toBe('fn-gen-1')
      expect(manualChain.executors[1].functionId).toBe('fn-human-1')
    })
  })
})

// ============================================================================
// TEST HELPERS
// ============================================================================

interface MockThing {
  id: string
  typeName: string
  data: Record<string, unknown>
}

interface MockRelationship {
  from: string
  to: string
  verb: string
  priority?: number
  data?: Record<string, unknown>
}

function createMockGraphStore(things: MockThing[], relationships: MockRelationship[]) {
  const thingMap = new Map(things.map(t => [t.id, t]))
  const relationshipsByFrom = new Map<string, MockRelationship[]>()

  for (const rel of relationships) {
    const fromRels = relationshipsByFrom.get(rel.from) || []
    fromRels.push(rel)
    relationshipsByFrom.set(rel.from, fromRels)
  }

  return {
    getThing: vi.fn(async (id: string) => thingMap.get(id) || null),
    getThingsByType: vi.fn(async ({ typeName }: { typeName: string }) =>
      things.filter(t => t.typeName === typeName)
    ),
    queryRelationshipsFrom: vi.fn(async (url: string, opts?: { verb?: string }) => {
      const id = url.replace('do://functions/', '')
      const rels = relationshipsByFrom.get(id) || []
      if (opts?.verb) {
        return rels
          .filter(r => r.verb === opts.verb)
          .map(r => ({
            ...r,
            from: `do://functions/${r.from}`,
            to: `do://functions/${r.to}`,
            id: `rel-${r.from}-${r.to}`,
            data: { priority: r.priority ?? 0, ...r.data },
          }))
      }
      return rels.map(r => ({
        ...r,
        from: `do://functions/${r.from}`,
        to: `do://functions/${r.to}`,
        id: `rel-${r.from}-${r.to}`,
        data: { priority: r.priority ?? 0, ...r.data },
      }))
    }),
    queryRelationshipsTo: vi.fn(async () => []),
    createThing: vi.fn(async () => ({})),
    createRelationship: vi.fn(async () => ({})),
  }
}

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { storage.set(key, value) }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn) => fn()),
  } as unknown as DurableObjectState
}
