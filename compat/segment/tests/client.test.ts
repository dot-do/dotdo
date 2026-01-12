/**
 * @dotdo/segment - Analytics Client Tests
 *
 * Tests for the analytics client with primitives integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AnalyticsClient,
  createAnalyticsClient,
  generateMessageId,
  getTimestamp,
  buildLibraryContext,
  deepMerge,
} from '../client'
import { InMemoryTransport } from '../segment'

describe('@dotdo/segment/client - Analytics Client', () => {
  describe('Utility Functions', () => {
    it('should generate valid UUID v4 message IDs', () => {
      const id1 = generateMessageId()
      const id2 = generateMessageId()

      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(id1).not.toBe(id2)
    })

    it('should generate ISO timestamps', () => {
      const timestamp = getTimestamp()
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })

    it('should build library context', () => {
      const context = buildLibraryContext()
      expect(context.library).toBeDefined()
      expect(context.library?.name).toBe('@dotdo/segment')
      expect(context.library?.version).toBeDefined()
    })

    it('should deep merge objects', () => {
      const target = {
        a: 1,
        b: { c: 2, d: 3 },
        e: [1, 2],
      }
      const source = {
        b: { c: 4 },
        f: 5,
      }

      const result = deepMerge(target, source as any)

      expect(result.a).toBe(1)
      expect(result.b.c).toBe(4)
      expect(result.b.d).toBe(3)
      expect(result.e).toEqual([1, 2])
      expect((result as any).f).toBe(5)
    })
  })

  describe('AnalyticsClient', () => {
    it('should create client with default options', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })
      expect(client.writeKey).toBe('test-key')
      expect(client.host).toBe('https://api.segment.io')
      expect(client.flushAt).toBe(20)
      expect(client.flushInterval).toBe(10000)
    })

    it('should create client with custom options', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        host: 'https://custom.host',
        flushAt: 50,
        flushInterval: 5000,
      })

      expect(client.host).toBe('https://custom.host')
      expect(client.flushAt).toBe(50)
      expect(client.flushInterval).toBe(5000)
    })

    it('should route users to partitions consistently', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        partitionCount: 8,
      })

      const partition1 = client.getPartition('user123')
      const partition2 = client.getPartition('user123')
      const partition3 = client.getPartition('user456')

      // Same user always gets same partition
      expect(partition1).toBe(partition2)
      // Different users may get different partitions
      expect(partition1).toBeGreaterThanOrEqual(0)
      expect(partition1).toBeLessThan(8)
      expect(partition3).toBeGreaterThanOrEqual(0)
      expect(partition3).toBeLessThan(8)
    })

    it('should batch route multiple users', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        partitionCount: 4,
      })

      const userIds = ['user1', 'user2', 'user3', 'user4', 'user5']
      const batched = client.routeUsers(userIds)

      // Each partition should be in range
      for (const [partition, users] of batched) {
        expect(partition).toBeGreaterThanOrEqual(0)
        expect(partition).toBeLessThan(4)
        expect(users.length).toBeGreaterThan(0)
      }

      // All users should be accounted for
      const totalUsers = Array.from(batched.values()).flat()
      expect(totalUsers.length).toBe(userIds.length)
    })

    it('should be ready after initialization', async () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })

      await client.ready()
      expect(client.isReady()).toBe(true)
    })

    it('should register and get destinations', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })

      const mockDestination = {
        name: 'TestDestination',
        track: vi.fn(),
        identify: vi.fn(),
        page: vi.fn(),
        screen: vi.fn(),
        group: vi.fn(),
        alias: vi.fn(),
      }

      client.register(mockDestination)

      const destinations = client.getDestinations()
      expect(destinations).toHaveLength(1)
      expect(destinations[0].name).toBe('TestDestination')
    })

    it('should add source middleware', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })

      const middleware = vi.fn((event) => event)
      client.addSourceMiddleware(middleware)

      const middlewares = client.getSourceMiddlewares()
      expect(middlewares).toHaveLength(1)
    })

    it('should close and clean up resources', async () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })

      const mockDestination = {
        name: 'TestDestination',
        track: vi.fn(),
        identify: vi.fn(),
        page: vi.fn(),
        screen: vi.fn(),
        group: vi.fn(),
        alias: vi.fn(),
        unload: vi.fn(),
      }

      client.register(mockDestination)
      await client.close()

      expect(mockDestination.unload).toHaveBeenCalled()
    })
  })

  describe('Factory Function', () => {
    it('should create client via factory', () => {
      const client = createAnalyticsClient({ writeKey: 'factory-key' })
      expect(client).toBeInstanceOf(AnalyticsClient)
      expect(client.writeKey).toBe('factory-key')
    })
  })
})
