/**
 * Tests for Magic-Map pattern
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createMagicMap,
  createInMemoryTransport,
  createStoreTransport,
  MagicMapError,
  isMagicMapProxy,
  getProxyPath,
  createRequest,
  createBatchRequest,
  type MagicMapTransport,
  type MagicMapHandler,
} from '../magic-map'
import type { Thing } from '../things'

describe('Magic-Map Pattern', () => {
  describe('createMagicMap', () => {
    it('should create a proxy with $path property', () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      expect(proxy.$path).toEqual([])
    })

    it('should build paths through property access', () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic path building
      const usersPath = proxy.users.$path
      expect(usersPath).toEqual(['users'])

      // @ts-expect-error - testing dynamic path building
      const getPath = proxy.users.get.$path
      expect(getPath).toEqual(['users', 'get'])
    })

    it('should make RPC calls when invoked as function', async () => {
      const handler = vi.fn(async (path, args) => {
        if (path[0] === 'users' && path[1] === 'get') {
          return { $id: args[0], $type: 'User', name: 'Test User' }
        }
        return null
      })

      const transport = createInMemoryTransport(handler)
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      const result = await proxy.users.get('user-123')

      expect(handler).toHaveBeenCalled()
      expect(result).toEqual({ $id: 'user-123', $type: 'User', name: 'Test User' })
    })

    it('should propagate errors from handler', async () => {
      const handler: MagicMapHandler = async () => {
        throw new Error('Not found')
      }

      const transport = createInMemoryTransport(handler)
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      await expect(proxy.users.get('unknown')).rejects.toThrow('Not found')
    })
  })

  describe('createInMemoryTransport', () => {
    it('should handle single requests', async () => {
      const handler: MagicMapHandler = async (path, args) => {
        return { path, args }
      }

      const transport = createInMemoryTransport(handler)
      const response = await transport.send({
        id: 'test-1',
        path: ['users', 'list'],
        args: [],
        timestamp: Date.now(),
      })

      expect(response).toMatchObject({
        id: 'test-1',
        success: true,
        result: { path: ['users', 'list'], args: [] },
      })
    })

    it('should handle batch requests', async () => {
      const handler: MagicMapHandler = async (path, args) => {
        return { path, args }
      }

      const transport = createInMemoryTransport(handler)
      const response = await transport.send({
        type: 'batch',
        requests: [
          { id: 'req-1', path: ['users', 'get'], args: ['user-1'], timestamp: Date.now() },
          { id: 'req-2', path: ['users', 'get'], args: ['user-2'], timestamp: Date.now() },
        ],
        timestamp: Date.now(),
      })

      expect(response.type).toBe('batch')
      expect('responses' in response && response.responses).toHaveLength(2)
    })

    it('should handle errors in batch requests', async () => {
      const handler: MagicMapHandler = async (path, args) => {
        if (args[0] === 'error') {
          throw new Error('Test error')
        }
        return { id: args[0] }
      }

      const transport = createInMemoryTransport(handler)
      const response = await transport.send({
        type: 'batch',
        requests: [
          { id: 'req-1', path: ['users', 'get'], args: ['user-1'], timestamp: Date.now() },
          { id: 'req-2', path: ['users', 'get'], args: ['error'], timestamp: Date.now() },
        ],
        timestamp: Date.now(),
      })

      expect(response.type).toBe('batch')
      if ('responses' in response) {
        expect(response.responses[0]!.success).toBe(true)
        expect(response.responses[1]!.success).toBe(false)
        expect(response.responses[1]!.error?.message).toBe('Test error')
      }
    })
  })

  describe('createStoreTransport', () => {
    const mockThingsStore = {
      get: vi.fn(async (id: string) => {
        if (id === 'user-1') {
          return {
            $id: 'user-1',
            $type: 'User',
            $createdAt: Date.now(),
            $updatedAt: Date.now(),
            name: 'User One',
          } as Thing
        }
        return null
      }),
      list: vi.fn(async () => [
        { $id: 'user-1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'User One' },
        { $id: 'user-2', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'User Two' },
      ] as Thing[]),
    }

    const mockRelationshipsStore = {
      getRelated: vi.fn(async (subjectId: string, predicate: string) => {
        if (subjectId === 'user-1' && predicate === 'owns') {
          return ['item-1', 'item-2']
        }
        return []
      }),
      getRelatedTo: vi.fn(async () => []),
    }

    it('should handle things.get', async () => {
      const transport = createStoreTransport({ things: mockThingsStore })
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      const user = await proxy.things.get('user-1')

      expect(mockThingsStore.get).toHaveBeenCalledWith('user-1')
      expect(user).toMatchObject({ $id: 'user-1', name: 'User One' })
    })

    it('should handle things.list', async () => {
      const transport = createStoreTransport({ things: mockThingsStore })
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      const users = await proxy.things.list()

      expect(mockThingsStore.list).toHaveBeenCalled()
      expect(users).toHaveLength(2)
    })

    it('should handle relationships.getRelated', async () => {
      const transport = createStoreTransport({
        things: mockThingsStore,
        relationships: mockRelationshipsStore,
      })
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      const items = await proxy.relationships.getRelated('user-1', 'owns')

      expect(mockRelationshipsStore.getRelated).toHaveBeenCalledWith('user-1', 'owns')
      expect(items).toEqual(['item-1', 'item-2'])
    })

    it('should throw for unknown store', async () => {
      const transport = createStoreTransport({ things: mockThingsStore })
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      await expect(proxy.unknown.get('x')).rejects.toThrow('Unknown store')
    })

    it('should throw for unknown method', async () => {
      const transport = createStoreTransport({ things: mockThingsStore })
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic call
      await expect(proxy.things.unknownMethod()).rejects.toThrow('Unknown things method')
    })
  })

  describe('MagicMapError', () => {
    it('should create error with code and message', () => {
      const error = new MagicMapError('NOT_FOUND', 'User not found')
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe('NOT_FOUND: User not found')
      expect(error.name).toBe('MagicMapError')
    })

    it('should include optional data', () => {
      const error = new MagicMapError('VALIDATION', 'Invalid data', { field: 'email' })
      expect(error.data).toEqual({ field: 'email' })
    })
  })

  describe('Utility functions', () => {
    it('isMagicMapProxy should detect proxies', () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      expect(isMagicMapProxy(proxy)).toBe(true)
      expect(isMagicMapProxy({})).toBe(false)
      expect(isMagicMapProxy(null)).toBe(false)
      expect(isMagicMapProxy('string')).toBe(false)
    })

    it('getProxyPath should return path', () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      // @ts-expect-error - testing dynamic path
      expect(getProxyPath(proxy.users.get)).toEqual(['users', 'get'])
    })

    it('createRequest should create valid request structure', () => {
      const request = createRequest(['users', 'get'], ['user-123'])

      expect(request.id).toMatch(/^req-/)
      expect(request.path).toEqual(['users', 'get'])
      expect(request.args).toEqual(['user-123'])
      expect(request.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('createBatchRequest should create valid batch structure', () => {
      const requests = [
        createRequest(['users', 'get'], ['user-1']),
        createRequest(['users', 'get'], ['user-2']),
      ]
      const batch = createBatchRequest(requests)

      expect(batch.type).toBe('batch')
      expect(batch.requests).toHaveLength(2)
      expect(batch.timestamp).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('Batch collector', () => {
    it('should create batch collector via $batch', () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      const batch = proxy.$batch()
      expect(batch).toBeDefined()
      expect(batch.size).toBe(0)
    })

    it('should execute batched operations', async () => {
      let callCount = 0
      const handler: MagicMapHandler = async (path, args) => {
        callCount++
        return { id: args[0] }
      }

      const transport = createInMemoryTransport(handler)
      const proxy = createMagicMap(transport)

      const batch = proxy.$batch()

      // Add operations (they execute immediately in this simplified implementation)
      // @ts-expect-error - testing dynamic call
      const p1 = batch.add(() => proxy.users.get('user-1'))
      // @ts-expect-error - testing dynamic call
      const p2 = batch.add(() => proxy.users.get('user-2'))

      await batch.execute()

      expect(await p1).toEqual({ id: 'user-1' })
      expect(await p2).toEqual({ id: 'user-2' })
    })
  })

  describe('Map operation', () => {
    it('should map over items with batching', async () => {
      const handler: MagicMapHandler = async (path, args) => {
        if (path[0] === 'users' && path[1] === 'get') {
          return { $id: args[0], name: `User ${args[0]}` }
        }
        return null
      }

      const transport = createInMemoryTransport(handler)
      const proxy = createMagicMap(transport)

      const items = ['user-1', 'user-2', 'user-3']

      const results = await proxy.map(items, async (id) => {
        // @ts-expect-error - testing dynamic call
        return proxy.users.get(id)
      })

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ $id: 'user-1', name: 'User user-1' })
    })

    it('should handle empty arrays', async () => {
      const transport = createInMemoryTransport(async () => null)
      const proxy = createMagicMap(transport)

      const results = await proxy.map([], async () => null)
      expect(results).toEqual([])
    })

    it('should support continueOnError option', async () => {
      const handler: MagicMapHandler = async (path, args) => {
        if (args[0] === 'error') {
          throw new Error('Test error')
        }
        return { id: args[0] }
      }

      const transport = createInMemoryTransport(handler)
      const proxy = createMagicMap(transport)

      const items = ['user-1', 'error', 'user-3']

      const results = await proxy.map(
        items,
        async (id) => {
          // @ts-expect-error - testing dynamic call
          return proxy.users.get(id)
        },
        { continueOnError: true }
      )

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ id: 'user-1' })
      expect(results[1]).toBeInstanceOf(Error)
      expect(results[2]).toEqual({ id: 'user-3' })
    })
  })
})
