/**
 * @dotdo/rpc - Promise Pipelining Tests
 *
 * Cap'n Web RPC promise pipelining enables multiple dependent calls
 * to execute in a single network round trip by passing promise references
 * instead of awaiting intermediate results.
 *
 * TDD RED phase: Tests written first, implementation to follow.
 *
 * @module @dotdo/rpc/tests/pipeline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createPipelineProxy,
  PipelineExecutor,
  PipelineCollector,
  PipelinePromise,
  resolvePipeline,
  resolvePipelineWith,
  type PipelineCall,
  type PipelineResult,
} from '../src/pipeline.js'

describe('@dotdo/rpc - Promise Pipelining', () => {
  // ==========================================================================
  // Core Pipeline Promise Tests
  // ==========================================================================
  describe('PipelinePromise', () => {
    it('should create a pipeline promise that tracks method calls', () => {
      const collector = new PipelineCollector()
      const promise = new PipelinePromise(collector, 'getUser', ['user-123'])

      expect(promise).toBeInstanceOf(PipelinePromise)
      expect(promise.callId).toBeDefined()
      expect(collector.calls.length).toBe(1)
    })

    it('should allow chaining method calls on pipeline promise', () => {
      const collector = new PipelineCollector()
      const userPromise = new PipelinePromise(collector, 'getUser', ['user-123'])
      const profilePromise = userPromise.getProfile()

      expect(collector.calls.length).toBe(2)
      expect(collector.calls[1].method).toBe('getProfile')
      expect(collector.calls[1].targetPromiseId).toBe(userPromise.callId)
    })

    it('should allow property access on pipeline promise', () => {
      const collector = new PipelineCollector()
      const userPromise = new PipelinePromise(collector, 'getUser', ['user-123'])
      const namePromise = userPromise.name

      expect(collector.calls.length).toBe(2)
      expect(collector.calls[1].method).toBe('__get__')
      expect(collector.calls[1].property).toBe('name')
      expect(collector.calls[1].targetPromiseId).toBe(userPromise.callId)
    })

    it('should track deep chaining A.B().C().D()', () => {
      const collector = new PipelineCollector()

      // Use addCall directly for explicit chaining (PipelinePromise is internal)
      const orgId = collector.addCall({ method: 'getOrg', args: ['org-1'] })
      const teamId = collector.addCall({ method: 'getTeam', args: ['team-1'], targetPromiseId: orgId })
      const membersId = collector.addCall({ method: 'getMembers', targetPromiseId: teamId })
      const firstMemberId = collector.addCall({ method: '__get__', property: '0', targetPromiseId: membersId })

      expect(collector.calls.length).toBe(4)

      // Verify dependency chain
      expect(collector.calls[0].method).toBe('getOrg')
      expect(collector.calls[1].method).toBe('getTeam')
      expect(collector.calls[1].targetPromiseId).toBe(collector.calls[0].id)
      expect(collector.calls[2].method).toBe('getMembers')
      expect(collector.calls[2].targetPromiseId).toBe(collector.calls[1].id)
      expect(collector.calls[3].method).toBe('__get__')
      expect(collector.calls[3].property).toBe('0')
      expect(collector.calls[3].targetPromiseId).toBe(collector.calls[2].id)
    })
  })

  // ==========================================================================
  // Pipeline Collector Tests
  // ==========================================================================
  describe('PipelineCollector', () => {
    it('should collect all calls in a pipeline', () => {
      const collector = new PipelineCollector()

      collector.addCall({
        id: 'call-1',
        method: 'getUser',
        args: ['user-123'],
      })

      collector.addCall({
        id: 'call-2',
        method: 'getProfile',
        targetPromiseId: 'call-1',
      })

      expect(collector.calls.length).toBe(2)
      expect(collector.getDependencies('call-2')).toContain('call-1')
    })

    it('should build execution stages from dependency graph', () => {
      const collector = new PipelineCollector()

      // Independent calls
      collector.addCall({ id: 'a', method: 'getUser', args: ['1'] })
      collector.addCall({ id: 'b', method: 'getOrg', args: ['org-1'] })

      // Dependent on 'a'
      collector.addCall({ id: 'c', method: 'getPosts', targetPromiseId: 'a' })

      // Dependent on 'b'
      collector.addCall({ id: 'd', method: 'getTeam', targetPromiseId: 'b' })

      // Dependent on both 'c' and 'd'
      collector.addCall({
        id: 'e',
        method: 'merge',
        args: [],
        pipelineArgs: [
          { type: 'promise', promiseId: 'c' },
          { type: 'promise', promiseId: 'd' },
        ],
      })

      const stages = collector.buildExecutionStages()

      expect(stages.length).toBe(3)
      expect(stages[0].map((c) => c.id).sort()).toEqual(['a', 'b']) // Independent
      expect(stages[1].map((c) => c.id).sort()).toEqual(['c', 'd']) // Depend on stage 0
      expect(stages[2].map((c) => c.id)).toEqual(['e']) // Depends on stage 1
    })

    it('should detect circular dependencies', () => {
      const collector = new PipelineCollector()

      collector.addCall({ id: 'a', method: 'foo', targetPromiseId: 'c' })
      collector.addCall({ id: 'b', method: 'bar', targetPromiseId: 'a' })
      collector.addCall({ id: 'c', method: 'baz', targetPromiseId: 'b' })

      expect(() => collector.buildExecutionStages()).toThrow(/circular/i)
    })
  })

  // ==========================================================================
  // Pipeline Executor Tests
  // ==========================================================================
  describe('PipelineExecutor', () => {
    it('should execute a single call', async () => {
      const handler = vi.fn().mockResolvedValue({ id: 'user-123', name: 'Alice' })
      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'call-1', method: 'getUser', args: ['user-123'] },
      ]

      const results = await executor.execute(calls)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(results.get('call-1')?.value).toEqual({ id: 'user-123', name: 'Alice' })
    })

    it('should execute dependent calls in correct order', async () => {
      const executionOrder: string[] = []
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        executionOrder.push(call.id)

        if (call.method === 'getUser') {
          return { id: 'user-123', name: 'Alice' }
        }
        if (call.method === 'getProfile') {
          const user = results.get(call.targetPromiseId!)?.value
          return { userId: (user as { id: string }).id, bio: 'Hello world' }
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'call-1', method: 'getUser', args: ['user-123'] },
        { id: 'call-2', method: 'getProfile', targetPromiseId: 'call-1' },
      ]

      const results = await executor.execute(calls)

      expect(executionOrder).toEqual(['call-1', 'call-2'])
      expect(results.get('call-2')?.value).toEqual({ userId: 'user-123', bio: 'Hello world' })
    })

    it('should execute independent calls in parallel', async () => {
      const startTimes: Map<string, number> = new Map()
      const endTimes: Map<string, number> = new Map()

      const handler = vi.fn().mockImplementation(async (call: PipelineCall) => {
        startTimes.set(call.id, performance.now())
        await new Promise((r) => setTimeout(r, 50)) // 50ms delay
        endTimes.set(call.id, performance.now())
        return { id: call.id }
      })

      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'a', method: 'getUser', args: ['1'] },
        { id: 'b', method: 'getOrg', args: ['org-1'] },
        { id: 'c', method: 'getItems', args: [] },
      ]

      const start = performance.now()
      await executor.execute(calls)
      const duration = performance.now() - start

      // Should complete in ~50ms (parallel), not ~150ms (sequential)
      expect(duration).toBeLessThan(100)

      // All should start at approximately the same time
      const startA = startTimes.get('a')!
      const startB = startTimes.get('b')!
      const startC = startTimes.get('c')!
      expect(Math.abs(startA - startB)).toBeLessThan(20)
      expect(Math.abs(startB - startC)).toBeLessThan(20)
    })

    it('should handle errors and propagate to dependent calls', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall) => {
        if (call.method === 'getUser') {
          throw new Error('User not found')
        }
        return { value: 'success' }
      })

      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'call-1', method: 'getUser', args: ['user-123'] },
        { id: 'call-2', method: 'getProfile', targetPromiseId: 'call-1' },
      ]

      const results = await executor.execute(calls)

      expect(results.get('call-1')?.error).toBeDefined()
      expect(results.get('call-1')?.error?.message).toBe('User not found')

      // Dependent call should also fail
      expect(results.get('call-2')?.error).toBeDefined()
      expect(results.get('call-2')?.error?.code).toBe('DEPENDENCY_FAILED')
    })

    it('should resolve property access from promise results', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getUser') {
          return { id: 'user-123', name: 'Alice', email: 'alice@example.com' }
        }
        if (call.method === '__get__') {
          const target = results.get(call.targetPromiseId!)?.value as Record<string, unknown>
          return target?.[call.property!]
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'call-1', method: 'getUser', args: ['user-123'] },
        { id: 'call-2', method: '__get__', property: 'name', targetPromiseId: 'call-1' },
      ]

      const results = await executor.execute(calls)

      expect(results.get('call-2')?.value).toBe('Alice')
    })

    it('should resolve array index access', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getUsers') {
          return [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
          ]
        }
        if (call.method === '__get__') {
          const target = results.get(call.targetPromiseId!)?.value
          const prop = call.property!
          // Handle both array index and object property access
          if (Array.isArray(target)) {
            const index = parseInt(prop, 10)
            if (!isNaN(index)) {
              return target[index]
            }
          }
          // Object property access
          return (target as Record<string, unknown>)?.[prop]
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      const calls: PipelineCall[] = [
        { id: 'call-1', method: 'getUsers', args: [] },
        { id: 'call-2', method: '__get__', property: '0', targetPromiseId: 'call-1' },
        { id: 'call-3', method: '__get__', property: 'name', targetPromiseId: 'call-2' },
      ]

      const results = await executor.execute(calls)

      expect(results.get('call-3')?.value).toBe('Alice')
    })
  })

  // ==========================================================================
  // Full Pipeline Proxy Tests (A calls B calls C in single round trip)
  // ==========================================================================
  describe('Pipeline Proxy (single round trip)', () => {
    it('should batch dependent calls into single execution', async () => {
      const batchExecutions: PipelineCall[][] = []

      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getUser') {
          return { id: 'user-123', name: 'Alice' }
        }
        if (call.method === 'getPosts') {
          const user = results.get(call.targetPromiseId!)?.value as { id: string }
          return [
            { id: 'post-1', authorId: user.id, title: 'First Post' },
            { id: 'post-2', authorId: user.id, title: 'Second Post' },
          ]
        }
        if (call.method === '__get__') {
          const target = results.get(call.targetPromiseId!)?.value
          if (Array.isArray(target)) {
            return target[parseInt(call.property!, 10)]
          }
          return (target as Record<string, unknown>)?.[call.property!]
        }
        return null
      })

      // Create executor that tracks batches
      const executor = new PipelineExecutor((call, results) => {
        return handler(call, results)
      })

      // Create pipeline proxy
      interface UserService {
        getUser(id: string): Promise<{ id: string; name: string; getPosts(): Promise<Post[]> }>
      }
      interface Post {
        id: string
        authorId: string
        title: string
      }

      const proxy = createPipelineProxy<UserService>(executor)

      // Build a pipeline: getUser -> getPosts -> [0] -> title
      // This should NOT make individual calls, but collect them
      const userPromise = proxy.getUser('user-123')
      const postsPromise = userPromise.getPosts()
      const firstPostPromise = postsPromise[0]
      const titlePromise = firstPostPromise.title

      // Now resolve the entire pipeline in a single batch
      const title = await resolvePipelineWith(titlePromise, executor)

      // Should have been executed as a single batch
      expect(title).toBe('First Post')
    })

    it('should resolve multiple pipelines in parallel', async () => {
      const executionOrder: string[] = []

      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        executionOrder.push(call.method)

        if (call.method === 'getUser') {
          return { id: call.args![0], name: `User ${call.args![0]}` }
        }
        if (call.method === 'getOrg') {
          return { id: call.args![0], name: `Org ${call.args![0]}` }
        }
        if (call.method === '__get__') {
          const target = results.get(call.targetPromiseId!)?.value
          return (target as Record<string, unknown>)?.[call.property!]
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      interface Service {
        getUser(id: string): Promise<{ id: string; name: string }>
        getOrg(id: string): Promise<{ id: string; name: string }>
      }

      const proxy = createPipelineProxy<Service>(executor)

      // Build two independent pipelines
      const userNamePromise = proxy.getUser('u1').name
      const orgNamePromise = proxy.getOrg('o1').name

      // Resolve both in parallel
      const [userName, orgName] = await Promise.all([
        resolvePipelineWith(userNamePromise, executor),
        resolvePipelineWith(orgNamePromise, executor),
      ])

      expect(userName).toBe('User u1')
      expect(orgName).toBe('Org o1')

      // Both root calls should have started early (parallel execution)
      const getUserIndex = executionOrder.indexOf('getUser')
      const getOrgIndex = executionOrder.indexOf('getOrg')
      expect(Math.abs(getUserIndex - getOrgIndex)).toBeLessThanOrEqual(1)
    })

    it('should support passing pipeline promises as arguments', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getUser') {
          return { id: call.args![0], name: `User ${call.args![0]}` }
        }
        if (call.method === 'sendNotification') {
          // Arguments should be resolved from pipeline
          const user = call.resolvedArgs![0] as { id: string; name: string }
          const message = call.resolvedArgs![1] as string
          return { sent: true, to: user.id, message }
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      interface Service {
        getUser(id: string): Promise<{ id: string; name: string }>
        sendNotification(user: { id: string; name: string }, message: string): Promise<{ sent: boolean }>
      }

      const proxy = createPipelineProxy<Service>(executor)

      // Pass pipeline promise as argument
      const userPromise = proxy.getUser('user-123')
      const notificationPromise = proxy.sendNotification(userPromise as unknown as { id: string; name: string }, 'Hello!')

      const result = await resolvePipelineWith(notificationPromise, executor)

      expect(result).toEqual({ sent: true, to: 'user-123', message: 'Hello!' })
    })
  })

  // ==========================================================================
  // Integration with existing RPC infrastructure
  // ==========================================================================
  describe('Integration', () => {
    it('should integrate with InMemoryExecutor', async () => {
      const target = {
        getUser: async (id: string) => ({
          id,
          name: 'Alice',
          getProfile: async () => ({ bio: 'Hello world' }),
        }),
      }

      // PipelineExecutor should be able to wrap InMemoryExecutor
      const handler = async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.targetPromiseId) {
          const targetResult = results.get(call.targetPromiseId)?.value
          if (targetResult && typeof targetResult === 'object' && call.method in targetResult) {
            const method = (targetResult as Record<string, unknown>)[call.method]
            if (typeof method === 'function') {
              return method.apply(targetResult, call.args || [])
            }
          }
          if (call.method === '__get__' && call.property) {
            return (targetResult as Record<string, unknown>)?.[call.property]
          }
        } else {
          // Root call
          const method = target[call.method as keyof typeof target]
          if (typeof method === 'function') {
            return method.apply(target, call.args || [])
          }
        }
        throw new Error(`Method not found: ${call.method}`)
      }

      const executor = new PipelineExecutor(handler)

      interface UserService {
        getUser(id: string): Promise<{
          id: string
          name: string
          getProfile(): Promise<{ bio: string }>
        }>
      }

      const proxy = createPipelineProxy<UserService>(executor)

      const bioPromise = proxy.getUser('user-123').getProfile().bio

      const bio = await resolvePipelineWith(bioPromise, executor)
      expect(bio).toBe('Hello world')
    })

    it('should serialize pipeline for HTTP transport', async () => {
      const collector = new PipelineCollector()

      // Build a pipeline using addCall directly (PipelinePromise doesn't chain without proxy)
      const userId = collector.addCall({ method: 'getUser', args: ['user-123'] })
      const profileId = collector.addCall({ method: 'getProfile', targetPromiseId: userId })
      const bioId = collector.addCall({ method: '__get__', property: 'bio', targetPromiseId: profileId })

      // Serialize for transport
      const serialized = collector.serialize()

      expect(serialized.calls).toHaveLength(3)
      expect(serialized.calls[0]).toEqual({
        id: expect.any(String),
        method: 'getUser',
        args: ['user-123'],
      })
      expect(serialized.calls[1]).toEqual({
        id: expect.any(String),
        method: 'getProfile',
        targetPromiseId: serialized.calls[0].id,
      })
      expect(serialized.calls[2]).toEqual({
        id: expect.any(String),
        method: '__get__',
        property: 'bio',
        targetPromiseId: serialized.calls[1].id,
      })

      // Should be JSON serializable
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)
      expect(parsed.calls).toHaveLength(3)
    })
  })

  // ==========================================================================
  // Magic Map Operation Tests (from CLAUDE.md)
  // ==========================================================================
  describe('Magic Map Operations', () => {
    it('should support map operation on pipeline arrays', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getUsers') {
          return [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Carol' },
          ]
        }
        if (call.method === '__map__') {
          const target = results.get(call.targetPromiseId!)?.value as unknown[]
          const mapSpec = call.args![0] as { property: string }
          return target.map((item) => (item as Record<string, unknown>)[mapSpec.property])
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      interface Service {
        getUsers(): Promise<Array<{ id: string; name: string }>>
      }

      const proxy = createPipelineProxy<Service>(executor)

      // Magic map: get all names in single pipeline
      const usersPromise = proxy.getUsers()
      const namesPromise = usersPromise.map((u: { name: string }) => u.name)

      const names = await resolvePipelineWith(namesPromise, executor)
      expect(names).toEqual(['Alice', 'Bob', 'Carol'])
    })

    it('should support filter operation on pipeline arrays', async () => {
      const handler = vi.fn().mockImplementation(async (call: PipelineCall, results: Map<string, PipelineResult>) => {
        if (call.method === 'getItems') {
          return [
            { id: '1', active: true },
            { id: '2', active: false },
            { id: '3', active: true },
          ]
        }
        if (call.method === '__filter__') {
          const target = results.get(call.targetPromiseId!)?.value as unknown[]
          const filterSpec = call.args![0] as { property: string; equals: unknown }
          return target.filter((item) => (item as Record<string, unknown>)[filterSpec.property] === filterSpec.equals)
        }
        return null
      })

      const executor = new PipelineExecutor(handler)

      interface Service {
        getItems(): Promise<Array<{ id: string; active: boolean }>>
      }

      const proxy = createPipelineProxy<Service>(executor)

      // Magic filter: get active items
      const itemsPromise = proxy.getItems()
      const activeItemsPromise = itemsPromise.filter((item: { active: boolean }) => item.active === true)

      const activeItems = await resolvePipelineWith(activeItemsPromise, executor)
      expect(activeItems).toHaveLength(2)
      expect(activeItems.every((item: { active: boolean }) => item.active)).toBe(true)
    })
  })
})
