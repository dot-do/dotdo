/**
 * Tests for db-client.ts
 *
 * Tests for the createTypedClient helper function.
 * The DBClient interface itself is just type definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTypedClient, type DBClient, type Thing, type StorableData } from '../src/index'

describe('createTypedClient', () => {
  interface User extends StorableData {
    name: string
    email: string
  }

  // Create a mock DBClient
  function createMockDBClient(): DBClient {
    const mockData = new Map<string, Thing>()

    return {
      get: vi.fn(async (url: string) => mockData.get(url) ?? null),
      getById: vi.fn(async (ns: string, type: string, id: string) => {
        const url = `https://${ns}/${type}/${id}`
        return mockData.get(url) ?? null
      }),
      create: vi.fn(async (options) => {
        const id = options.id ?? `id-${Date.now()}`
        const url = `https://${options.ns}/${options.type}/${id}`
        const thing: Thing = {
          ns: options.ns,
          type: options.type,
          id,
          url,
          createdAt: new Date(),
          updatedAt: new Date(),
          data: options.data,
        }
        mockData.set(url, thing)
        return thing
      }),
      update: vi.fn(async (url: string, data) => {
        const existing = mockData.get(url)
        if (!existing) throw new Error('Not found')
        const updated: Thing = {
          ...existing,
          data: { ...existing.data, ...data },
          updatedAt: new Date(),
        }
        mockData.set(url, updated)
        return updated
      }),
      upsert: vi.fn(async (options) => {
        const url = `https://${options.ns}/${options.type}/${options.id}`
        const existing = mockData.get(url)
        if (existing) {
          const updated: Thing = {
            ...existing,
            data: options.data,
            updatedAt: new Date(),
          }
          mockData.set(url, updated)
          return updated
        }
        const thing: Thing = {
          ns: options.ns,
          type: options.type,
          id: options.id,
          url,
          createdAt: new Date(),
          updatedAt: new Date(),
          data: options.data,
        }
        mockData.set(url, thing)
        return thing
      }),
      delete: vi.fn(async (url: string) => {
        const existed = mockData.has(url)
        mockData.delete(url)
        return existed
      }),
      list: vi.fn(async () => Array.from(mockData.values())),
      find: vi.fn(async () => Array.from(mockData.values())),
      search: vi.fn(async () => []),
      count: vi.fn(async () => mockData.size),
      relate: vi.fn(async () => ({
        id: 'rel-1',
        type: 'test',
        from: '',
        to: '',
        createdAt: new Date(),
      })),
      unrelate: vi.fn(async () => true),
      related: vi.fn(async () => []),
      references: vi.fn(async () => []),
      relationships: vi.fn(async () => []),
      batchGet: vi.fn(async (urls) => {
        const result = new Map<string, Thing | null>()
        for (const url of urls) {
          result.set(url, mockData.get(url) ?? null)
        }
        return result
      }),
      batchCreate: vi.fn(async (items) => {
        const results: Thing[] = []
        for (const item of items) {
          const id = item.id ?? `id-${Date.now()}`
          const url = `https://${item.ns}/${item.type}/${id}`
          const thing: Thing = {
            ns: item.ns,
            type: item.type,
            id,
            url,
            createdAt: new Date(),
            updatedAt: new Date(),
            data: item.data,
          }
          mockData.set(url, thing)
          results.push(thing)
        }
        return results
      }),
    }
  }

  let mockDb: DBClient
  let users: ReturnType<typeof createTypedClient<User>>

  beforeEach(() => {
    mockDb = createMockDBClient()
    users = createTypedClient<User>(mockDb, 'app', 'User')
  })

  describe('get', () => {
    it('should call getById with correct arguments', async () => {
      await users.get('user-123')

      expect(mockDb.getById).toHaveBeenCalledWith('app', 'User', 'user-123')
    })

    it('should return null for non-existent user', async () => {
      const result = await users.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('create', () => {
    it('should call create with ns and type', async () => {
      const userData: User = { name: 'Alice', email: 'alice@example.com' }

      await users.create(userData)

      expect(mockDb.create).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
        data: userData,
      })
    })

    it('should return created thing', async () => {
      const userData: User = { name: 'Bob', email: 'bob@example.com' }

      const result = await users.create(userData)

      expect(result.data.name).toBe('Bob')
      expect(result.data.email).toBe('bob@example.com')
      expect(result.ns).toBe('app')
      expect(result.type).toBe('User')
    })
  })

  describe('update', () => {
    it('should call update with correct URL', async () => {
      // First create a user
      await users.create({ name: 'Charlie', email: 'charlie@example.com' })

      // Get the created user to find its ID
      const created = (await users.list())[0]

      await users.update(created.id, { name: 'Charles' })

      expect(mockDb.update).toHaveBeenCalledWith(
        `https://app/User/${created.id}`,
        { name: 'Charles' }
      )
    })
  })

  describe('delete', () => {
    it('should call delete with correct URL', async () => {
      await users.delete('user-456')

      expect(mockDb.delete).toHaveBeenCalledWith('https://app/User/user-456')
    })

    it('should return true for deleted user', async () => {
      // Create a user first
      const created = await users.create({ name: 'ToDelete', email: 'delete@example.com' })

      const result = await users.delete(created.id)

      expect(result).toBe(true)
    })
  })

  describe('list', () => {
    it('should call list with ns and type', async () => {
      await users.list()

      expect(mockDb.list).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
      })
    })

    it('should pass additional options', async () => {
      await users.list({ limit: 10, offset: 5, orderBy: 'createdAt', order: 'desc' })

      expect(mockDb.list).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
        limit: 10,
        offset: 5,
        orderBy: 'createdAt',
        order: 'desc',
      })
    })
  })

  describe('find', () => {
    it('should call find with ns, type, and where clause', async () => {
      await users.find({ where: { email: 'test@example.com' } })

      expect(mockDb.find).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
        where: { email: 'test@example.com' },
      })
    })
  })

  describe('count', () => {
    it('should call count with ns and type', async () => {
      await users.count()

      expect(mockDb.count).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
      })
    })

    it('should pass additional options', async () => {
      await users.count({ where: { active: true } })

      expect(mockDb.count).toHaveBeenCalledWith({
        ns: 'app',
        type: 'User',
        where: { active: true },
      })
    })
  })

  describe('URL building', () => {
    it('should build correct URLs for operations', async () => {
      // First create a user so update has something to update
      const created = await users.create({ name: 'Test', email: 'test@example.com' })

      // The typed client builds URLs in format: https://{ns}/{type}/{id}
      await users.update(created.id, { name: 'Updated' })
      expect(mockDb.update).toHaveBeenCalledWith(`https://app/User/${created.id}`, { name: 'Updated' })

      await users.delete(created.id)
      expect(mockDb.delete).toHaveBeenCalledWith(`https://app/User/${created.id}`)
    })
  })
})
