/**
 * Store Adapter Tests
 *
 * Tests for the abstract store interface and mock implementations (do-7jse).
 * These tests verify that the store adapter pattern works correctly.
 *
 * @module mcp/tests/store-adapters.test
 */

import { describe, it, expect } from 'vitest'
import {
  createMockThingsStore,
  createMockRelationshipsStore,
  createMockEventsStore,
  createMockContext,
  type Thing,
  type Relationship,
  type Event
} from '../types'
import { createSearchTool } from '../search'
import { createFetchTool } from '../tools/fetch'

describe('Store Adapter Pattern (do-7jse)', () => {
  describe('createMockThingsStore', () => {
    it('should create an empty store', async () => {
      const store = createMockThingsStore()
      const things = await store.list()
      expect(things).toEqual([])
    })

    it('should return null for non-existent things', async () => {
      const store = createMockThingsStore()
      const thing = await store.get('non-existent')
      expect(thing).toBeNull()
    })

    it('should be initialized with data', async () => {
      const testData: Thing[] = [
        { $id: '1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Alice' },
        { $id: '2', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Bob' }
      ]
      const store = createMockThingsStore(testData)

      const things = await store.list()
      expect(things).toHaveLength(2)

      const alice = await store.get('1')
      expect(alice?.name).toBe('Alice')
    })

    it('should filter by type', async () => {
      const testData: Thing[] = [
        { $id: '1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Alice' },
        { $id: '2', $type: 'Order', $createdAt: Date.now(), $updatedAt: Date.now(), total: 100 }
      ]
      const store = createMockThingsStore(testData)

      const users = await store.list({ type: 'User' })
      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Alice')
    })

    it('should apply limit and offset', async () => {
      const testData: Thing[] = Array.from({ length: 10 }, (_, i) => ({
        $id: String(i),
        $type: 'Item',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        index: i
      }))
      const store = createMockThingsStore(testData)

      const page1 = await store.list({ limit: 3, offset: 0 })
      expect(page1).toHaveLength(3)
      expect(page1[0]?.index).toBe(0)

      const page2 = await store.list({ limit: 3, offset: 3 })
      expect(page2).toHaveLength(3)
      expect(page2[0]?.index).toBe(3)
    })
  })

  describe('createMockRelationshipsStore', () => {
    it('should create an empty store', async () => {
      const store = createMockRelationshipsStore()
      const rels = await store.find({})
      expect(rels).toEqual([])
    })

    it('should be initialized with data', async () => {
      const testData: Relationship[] = [
        { subject: 'user-1', predicate: 'owns', object: 'order-1', $createdAt: Date.now() },
        { subject: 'user-1', predicate: 'owns', object: 'order-2', $createdAt: Date.now() }
      ]
      const store = createMockRelationshipsStore(testData)

      const rels = await store.find({ subject: 'user-1' })
      expect(rels).toHaveLength(2)
    })

    it('should filter by subject', async () => {
      const testData: Relationship[] = [
        { subject: 'user-1', predicate: 'owns', object: 'order-1', $createdAt: Date.now() },
        { subject: 'user-2', predicate: 'owns', object: 'order-2', $createdAt: Date.now() }
      ]
      const store = createMockRelationshipsStore(testData)

      const rels = await store.find({ subject: 'user-1' })
      expect(rels).toHaveLength(1)
      expect(rels[0]?.object).toBe('order-1')
    })

    it('should filter by predicate', async () => {
      const testData: Relationship[] = [
        { subject: 'user-1', predicate: 'owns', object: 'order-1', $createdAt: Date.now() },
        { subject: 'user-1', predicate: 'created', object: 'post-1', $createdAt: Date.now() }
      ]
      const store = createMockRelationshipsStore(testData)

      const rels = await store.find({ predicate: 'owns' })
      expect(rels).toHaveLength(1)
      expect(rels[0]?.object).toBe('order-1')
    })

    it('should filter by object', async () => {
      const testData: Relationship[] = [
        { subject: 'user-1', predicate: 'owns', object: 'order-1', $createdAt: Date.now() },
        { subject: 'user-2', predicate: 'owns', object: 'order-1', $createdAt: Date.now() }
      ]
      const store = createMockRelationshipsStore(testData)

      const rels = await store.find({ object: 'order-1' })
      expect(rels).toHaveLength(2)
    })
  })

  describe('createMockEventsStore', () => {
    it('should create an empty store', async () => {
      const store = createMockEventsStore()
      const events = await store.query()
      expect(events).toEqual([])
    })

    it('should be initialized with data', async () => {
      const testData: Event[] = [
        { $id: 'evt-1', type: 'User.created', payload: {}, $timestamp: Date.now() },
        { $id: 'evt-2', type: 'User.updated', payload: {}, $timestamp: Date.now() }
      ]
      const store = createMockEventsStore(testData)

      const events = await store.query()
      expect(events).toHaveLength(2)
    })

    it('should filter by source', async () => {
      const testData: Event[] = [
        { $id: 'evt-1', type: 'User.created', payload: {}, $timestamp: Date.now(), source: 'user-1' },
        { $id: 'evt-2', type: 'Order.created', payload: {}, $timestamp: Date.now(), source: 'order-1' }
      ]
      const store = createMockEventsStore(testData)

      const events = await store.query({ source: 'user-1' })
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('User.created')
    })

    it('should apply limit', async () => {
      const testData: Event[] = Array.from({ length: 100 }, (_, i) => ({
        $id: `evt-${i}`,
        type: 'Test.event',
        payload: { index: i },
        $timestamp: Date.now()
      }))
      const store = createMockEventsStore(testData)

      const events = await store.query({ limit: 10 })
      expect(events).toHaveLength(10)
    })
  })

  describe('createMockContext', () => {
    it('should create a context with captured array', () => {
      const ctx = createMockContext()
      expect(ctx.captured).toEqual([])
    })

    it('should capture send operations', () => {
      const ctx = createMockContext()
      ctx.send({ type: 'test', payload: { value: 42 } })

      expect(ctx.captured).toHaveLength(1)
      expect(ctx.captured[0]?.op).toBe('send')
      expect(ctx.captured[0]?.data).toEqual({ type: 'test', payload: { value: 42 } })
    })

    it('should capture try operations and return result', async () => {
      const ctx = createMockContext()
      const result = await ctx.try(async () => 'test-result')

      expect(result).toBe('test-result')
      expect(ctx.captured).toHaveLength(1)
      expect(ctx.captured[0]?.op).toBe('try')
      expect(ctx.captured[0]?.data).toBe('test-result')
    })

    it('should capture do operations with options', async () => {
      const ctx = createMockContext()
      const result = await ctx.do(async () => 123, { retries: 3 })

      expect(result).toBe(123)
      expect(ctx.captured).toHaveLength(1)
      expect(ctx.captured[0]?.op).toBe('do')
      expect((ctx.captured[0]?.data as { options: unknown }).options).toEqual({ retries: 3 })
    })
  })

  describe('Integration with MCP tools', () => {
    it('should work with createSearchTool', async () => {
      const testData: Thing[] = [
        { $id: '1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Alice' },
        { $id: '2', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Bob' }
      ]
      const store = createMockThingsStore(testData)
      const searchTool = createSearchTool({ store })

      const result = await searchTool.execute({ $type: 'User' }) as { results: Thing[]; total: number }
      expect(result.results).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should work with createFetchTool', async () => {
      const things = createMockThingsStore([
        { $id: 'user-1', $type: 'User', $createdAt: Date.now(), $updatedAt: Date.now(), name: 'Alice' }
      ])
      const relationships = createMockRelationshipsStore([
        { subject: 'user-1', predicate: 'owns', object: 'order-1', $createdAt: Date.now() }
      ])
      const events = createMockEventsStore([
        { $id: 'evt-1', type: 'User.created', payload: {}, $timestamp: Date.now(), source: 'user-1' }
      ])

      const fetchTool = createFetchTool({ things, relationships, events })
      const result = await fetchTool.execute({
        $id: 'user-1',
        include: ['relationships', 'events']
      }) as { $id: string; name: string; _relationships: unknown[]; _events: unknown[] }

      expect(result.$id).toBe('user-1')
      expect(result.name).toBe('Alice')
      expect(result._relationships).toHaveLength(1)
      expect(result._events).toHaveLength(1)
    })

    it('should allow custom store implementations', async () => {
      // Demonstrate using a custom adapter
      const customStore = {
        async get(id: string): Promise<Thing | null> {
          if (id === 'custom-1') {
            return { $id: 'custom-1', $type: 'Custom', $createdAt: 0, $updatedAt: 0, value: 'custom' }
          }
          return null
        },
        async list(): Promise<Thing[]> {
          return [{ $id: 'custom-1', $type: 'Custom', $createdAt: 0, $updatedAt: 0, value: 'custom' }]
        }
      }

      const searchTool = createSearchTool({ store: customStore })
      const result = await searchTool.execute({}) as { results: Thing[] }

      expect(result.results).toHaveLength(1)
      expect(result.results[0]?.$id).toBe('custom-1')
    })
  })
})
