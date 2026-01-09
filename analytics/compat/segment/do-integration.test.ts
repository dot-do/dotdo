/**
 * Analytics DO Integration Tests
 *
 * TDD RED Phase: These tests define the expected behavior for Analytics
 * Durable Object storage integration. All tests are expected to FAIL
 * initially as this is the RED phase.
 *
 * Test Coverage:
 * - Sharding: Events routed by userId/anonymousId, consistent sharding
 * - Storage: Events persisted to DO SQLite, retrievable by various criteria
 * - Tiering: Hot events in SQLite, warm events in R2, cold archive
 *
 * @module @dotdo/compat/analytics/do-integration.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockDO,
  createMockDONamespace,
  createMockId,
  createMockR2,
  type MockDOResult,
  type MockEnv,
  type MockDurableObjectNamespace,
  type MockR2,
} from '../../testing/do'
import type { AnalyticsEvent, TrackEvent, IdentifyEvent, PageEvent } from './types'

// ============================================================================
// TYPE DEFINITIONS FOR DO INTEGRATION TESTS
// ============================================================================

/**
 * Analytics DO configuration
 */
interface AnalyticsDOConfig {
  /** Number of shards for event distribution */
  shardCount: number
  /** Shard key field ('userId' or 'anonymousId') */
  shardKey: 'userId' | 'anonymousId'
  /** Days before moving events to warm storage (R2) */
  warmThresholdDays: number
  /** Days before moving events to cold archive */
  coldThresholdDays: number
  /** Maximum events to keep in hot storage per user */
  maxHotEventsPerUser: number
}

/**
 * Analytics DO state interface
 */
interface AnalyticsDOState {
  /** DO namespace URL */
  ns: string
  /** Configuration */
  config: AnalyticsDOConfig
  /** Shard index (if part of shard set) */
  shardIndex?: number
  /** Total shards in set */
  totalShards?: number
}

/**
 * Stored analytics event with metadata
 */
interface StoredEvent extends AnalyticsEvent {
  /** Internal storage ID */
  _id: string
  /** When the event was stored */
  _storedAt: string
  /** Storage tier: 'hot' | 'warm' | 'cold' */
  _tier: 'hot' | 'warm' | 'cold'
  /** Shard index where event is stored */
  _shardIndex: number
}

/**
 * Event query options
 */
interface EventQueryOptions {
  /** Filter by userId */
  userId?: string
  /** Filter by anonymousId */
  anonymousId?: string
  /** Filter by event type */
  eventType?: AnalyticsEvent['type']
  /** Filter by event name (for track events) */
  eventName?: string
  /** Start time for time range query */
  startTime?: Date | string
  /** End time for time range query */
  endTime?: Date | string
  /** Maximum number of events to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Include events from all tiers or just hot */
  includeTiers?: ('hot' | 'warm' | 'cold')[]
}

/**
 * Event query result
 */
interface EventQueryResult {
  /** Matching events */
  events: StoredEvent[]
  /** Total count matching query */
  total: number
  /** Query metadata */
  meta: {
    /** Number of shards queried */
    shardsQueried: number
    /** Events from each tier */
    tierBreakdown: {
      hot: number
      warm: number
      cold: number
    }
    /** Query duration in ms */
    duration: number
  }
}

/**
 * Tiering operation result
 */
interface TieringResult {
  /** Events moved to warm storage */
  movedToWarm: number
  /** Events moved to cold storage */
  movedToCold: number
  /** Events deleted (past retention) */
  deleted: number
  /** Duration of tiering operation */
  duration: number
}

/**
 * Shard routing result
 */
interface ShardRoutingResult {
  /** Target shard index */
  shardIndex: number
  /** Target shard DO ID */
  doId: string
  /** Target shard namespace */
  ns: string
}

/**
 * Analytics DO class (mock interface for testing)
 */
interface AnalyticsDO {
  /** Store a single event */
  storeEvent(event: AnalyticsEvent): Promise<StoredEvent>
  /** Store multiple events */
  storeEvents(events: AnalyticsEvent[]): Promise<StoredEvent[]>
  /** Query events */
  queryEvents(options: EventQueryOptions): Promise<EventQueryResult>
  /** Get events by user ID */
  getEventsByUser(userId: string, limit?: number): Promise<StoredEvent[]>
  /** Get events in time range */
  getEventsByTimeRange(start: Date, end: Date): Promise<StoredEvent[]>
  /** Get events by type */
  getEventsByType(type: AnalyticsEvent['type']): Promise<StoredEvent[]>
  /** Route event to correct shard */
  routeEvent(event: AnalyticsEvent): Promise<ShardRoutingResult>
  /** Run tiering operation */
  runTiering(): Promise<TieringResult>
  /** Get storage statistics */
  getStorageStats(): Promise<StorageStats>
  /** Check if DO is sharded */
  isSharded(): Promise<boolean>
  /** Get shard info */
  getShardInfo(): Promise<ShardInfo | null>
}

/**
 * Storage statistics
 */
interface StorageStats {
  /** Total events stored */
  totalEvents: number
  /** Events in hot tier (SQLite) */
  hotEvents: number
  /** Events in warm tier (R2) */
  warmEvents: number
  /** Events in cold tier (archive) */
  coldEvents: number
  /** Unique users tracked */
  uniqueUsers: number
  /** Storage size in bytes */
  sizeBytes: number
}

/**
 * Shard information
 */
interface ShardInfo {
  /** Shard index */
  shardIndex: number
  /** Total shards */
  totalShards: number
  /** Shard key field */
  shardKey: string
  /** Registry ID */
  registryId: string
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample track events
 */
function createTrackEvents(
  count: number,
  userIdPrefix: string = 'user'
): TrackEvent[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    type: 'track' as const,
    event: `Event ${i % 5}`, // 5 different event types
    userId: `${userIdPrefix}-${i % 10}`, // 10 different users
    anonymousId: `anon-${i}`,
    timestamp: new Date(now - i * 1000 * 60).toISOString(), // 1 minute apart
    messageId: `msg-${i}`,
    properties: {
      index: i,
      value: `value-${i}`,
    },
  }))
}

/**
 * Create sample identify events
 */
function createIdentifyEvents(count: number): IdentifyEvent[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    type: 'identify' as const,
    userId: `user-${i % 10}`,
    anonymousId: `anon-${i}`,
    timestamp: new Date(now - i * 1000 * 60 * 60).toISOString(),
    messageId: `identify-msg-${i}`,
    traits: {
      email: `user${i % 10}@example.com`,
      name: `User ${i % 10}`,
    },
  }))
}

/**
 * Create events with specific timestamps for tiering tests
 */
function createTimedEvents(
  config: {
    hotCount: number
    warmCount: number
    coldCount: number
    warmThresholdDays: number
    coldThresholdDays: number
  }
): TrackEvent[] {
  const now = Date.now()
  const events: TrackEvent[] = []
  let index = 0

  // Hot events (recent)
  for (let i = 0; i < config.hotCount; i++) {
    events.push({
      type: 'track',
      event: 'Hot Event',
      userId: `user-${i % 5}`,
      anonymousId: `anon-hot-${i}`,
      timestamp: new Date(now - i * 1000 * 60 * 60).toISOString(), // Hours ago
      messageId: `hot-msg-${index++}`,
      properties: { tier: 'hot' },
    })
  }

  // Warm events (older than warmThreshold but younger than coldThreshold)
  const warmTime = now - config.warmThresholdDays * 24 * 60 * 60 * 1000
  for (let i = 0; i < config.warmCount; i++) {
    events.push({
      type: 'track',
      event: 'Warm Event',
      userId: `user-${i % 5}`,
      anonymousId: `anon-warm-${i}`,
      timestamp: new Date(warmTime - i * 1000 * 60 * 60).toISOString(),
      messageId: `warm-msg-${index++}`,
      properties: { tier: 'warm' },
    })
  }

  // Cold events (older than coldThreshold)
  const coldTime = now - config.coldThresholdDays * 24 * 60 * 60 * 1000
  for (let i = 0; i < config.coldCount; i++) {
    events.push({
      type: 'track',
      event: 'Cold Event',
      userId: `user-${i % 5}`,
      anonymousId: `anon-cold-${i}`,
      timestamp: new Date(coldTime - i * 1000 * 60 * 60 * 24).toISOString(),
      messageId: `cold-msg-${index++}`,
      properties: { tier: 'cold' },
    })
  }

  return events
}

/**
 * Simple consistent hash for testing shard routing
 */
function getShardIndex(key: string, shardCount: number): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash) % shardCount
}

// ============================================================================
// IMPORT ANALYTICS DO IMPLEMENTATION
// ============================================================================

import { AnalyticsDO } from './do-integration'

// ============================================================================
// TEST SUITE: SHARDING
// ============================================================================

describe('Analytics DO Integration - Sharding', () => {
  let mockDO: MockDOResult<AnalyticsDO, MockEnv>
  let mockNamespace: MockDurableObjectNamespace

  beforeEach(() => {
    mockNamespace = createMockDONamespace()

    mockDO = createMockDO(AnalyticsDO as any, {
      ns: 'https://analytics.test.do',
      storage: new Map([
        ['config', {
          shardCount: 4,
          shardKey: 'userId',
          warmThresholdDays: 7,
          coldThresholdDays: 30,
          maxHotEventsPerUser: 1000,
        }],
      ]),
      env: {
        ANALYTICS_DO: mockNamespace,
      } as any,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SHARD ROUTING
  // ==========================================================================

  describe('shard routing', () => {
    it('should route events by userId when configured', async () => {
      // RED: Events with same userId should go to same shard
      const event1: TrackEvent = {
        type: 'track',
        event: 'Test Event',
        userId: 'user-123',
        anonymousId: 'anon-1',
        timestamp: new Date().toISOString(),
        messageId: 'msg-1',
      }

      const event2: TrackEvent = {
        type: 'track',
        event: 'Another Event',
        userId: 'user-123', // Same userId
        anonymousId: 'anon-2',
        timestamp: new Date().toISOString(),
        messageId: 'msg-2',
      }

      const route1 = await mockDO.instance.routeEvent(event1)
      const route2 = await mockDO.instance.routeEvent(event2)

      // Same user should route to same shard
      expect(route1.shardIndex).toBe(route2.shardIndex)
      expect(route1.doId).toBe(route2.doId)
    })

    it('should route events by anonymousId when no userId present', async () => {
      // RED: Events without userId should route by anonymousId
      const event1: TrackEvent = {
        type: 'track',
        event: 'Anonymous Event',
        anonymousId: 'anon-abc',
        timestamp: new Date().toISOString(),
        messageId: 'msg-1',
      }

      const event2: TrackEvent = {
        type: 'track',
        event: 'Another Anonymous',
        anonymousId: 'anon-abc', // Same anonymousId
        timestamp: new Date().toISOString(),
        messageId: 'msg-2',
      }

      const route1 = await mockDO.instance.routeEvent(event1)
      const route2 = await mockDO.instance.routeEvent(event2)

      // Same anonymous user should route to same shard
      expect(route1.shardIndex).toBe(route2.shardIndex)
    })

    it('should use consistent hashing for shard assignment', async () => {
      // RED: Same key should always route to same shard
      const userId = 'consistent-user-456'
      const events = Array.from({ length: 100 }, (_, i) => ({
        type: 'track' as const,
        event: `Event ${i}`,
        userId,
        anonymousId: `anon-${i}`,
        timestamp: new Date().toISOString(),
        messageId: `msg-${i}`,
      }))

      const routes = await Promise.all(
        events.map((e) => mockDO.instance.routeEvent(e))
      )

      // All events for same user should go to same shard
      const uniqueShards = new Set(routes.map((r) => r.shardIndex))
      expect(uniqueShards.size).toBe(1)
    })

    it('should distribute different users across shards', async () => {
      // RED: Different users should be distributed across shards
      const events = createTrackEvents(100, 'diverse-user')

      const routes = await Promise.all(
        events.map((e) => mockDO.instance.routeEvent(e))
      )

      // Should use multiple shards
      const uniqueShards = new Set(routes.map((r) => r.shardIndex))
      expect(uniqueShards.size).toBeGreaterThan(1)
    })

    it('should return valid shard information', async () => {
      // RED: Route result should contain all required fields
      const event: TrackEvent = {
        type: 'track',
        event: 'Test',
        userId: 'user-999',
        timestamp: new Date().toISOString(),
        messageId: 'msg-test',
      }

      const route = await mockDO.instance.routeEvent(event)

      expect(route).toHaveProperty('shardIndex')
      expect(route).toHaveProperty('doId')
      expect(route).toHaveProperty('ns')
      expect(typeof route.shardIndex).toBe('number')
      expect(route.shardIndex).toBeGreaterThanOrEqual(0)
      expect(route.shardIndex).toBeLessThan(4) // 4 shards configured
    })

    it('should handle identify events for routing', async () => {
      // RED: Identify events should route by userId
      const event: IdentifyEvent = {
        type: 'identify',
        userId: 'identified-user',
        anonymousId: 'anon-before-identify',
        timestamp: new Date().toISOString(),
        messageId: 'identify-msg',
        traits: { email: 'test@example.com' },
      }

      const route = await mockDO.instance.routeEvent(event)

      expect(route.shardIndex).toBeDefined()
      expect(route.shardIndex).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // SHARD STORAGE
  // ==========================================================================

  describe('shard storage', () => {
    it('should store event in correct shard', async () => {
      // RED: Event should be stored in the shard it routes to
      const event: TrackEvent = {
        type: 'track',
        event: 'Stored Event',
        userId: 'store-user',
        timestamp: new Date().toISOString(),
        messageId: 'store-msg',
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored._shardIndex).toBeDefined()
      expect(stored._id).toBeDefined()
      expect(stored.event).toBe('Stored Event')
    })

    it('should batch store events across shards', async () => {
      // RED: Batch store should distribute to correct shards
      const events = createTrackEvents(50)

      const stored = await mockDO.instance.storeEvents(events)

      expect(stored.length).toBe(50)
      // Events should have shard assignments
      const shards = new Set(stored.map((s) => s._shardIndex))
      expect(shards.size).toBeGreaterThan(1)
    })

    it('should query from specific shard by userId', async () => {
      // RED: Query with userId should only hit relevant shard
      const userId = 'query-user-specific'
      const events = Array.from({ length: 10 }, (_, i) => ({
        type: 'track' as const,
        event: `User Event ${i}`,
        userId,
        timestamp: new Date().toISOString(),
        messageId: `query-msg-${i}`,
      }))

      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.queryEvents({ userId })

      expect(result.events.length).toBe(10)
      expect(result.meta.shardsQueried).toBe(1) // Only one shard queried
    })

    it('should fan out query when no shard key provided', async () => {
      // RED: Query without userId/anonymousId should query all shards
      await mockDO.instance.storeEvents(createTrackEvents(100))

      const result = await mockDO.instance.queryEvents({
        eventName: 'Event 1',
      })

      expect(result.meta.shardsQueried).toBe(4) // All 4 shards queried
    })

    it('should aggregate results from multiple shards', async () => {
      // RED: Fan-out query should combine results
      const events = createTrackEvents(100)
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
        limit: 50,
      })

      expect(result.events.length).toBeLessThanOrEqual(50)
      expect(result.total).toBe(100)
    })
  })

  // ==========================================================================
  // SHARD CONFIGURATION
  // ==========================================================================

  describe('shard configuration', () => {
    it('should report if DO is sharded', async () => {
      // RED: Should know shard status
      const isSharded = await mockDO.instance.isSharded()

      // Initially configured with shards
      expect(isSharded).toBe(true)
    })

    it('should return shard info when sharded', async () => {
      // RED: Should return shard metadata
      const shardInfo = await mockDO.instance.getShardInfo()

      expect(shardInfo).not.toBeNull()
      expect(shardInfo?.totalShards).toBe(4)
      expect(shardInfo?.shardKey).toBe('userId')
    })

    it('should return null shard info when not sharded', async () => {
      // RED: Non-sharded DO should return null
      const unshardedDO = createMockDO(AnalyticsDO as any, {
        ns: 'https://analytics-single.test.do',
        storage: new Map([
          ['config', {
            shardCount: 1, // Single shard = not sharded
            shardKey: 'userId',
            warmThresholdDays: 7,
            coldThresholdDays: 30,
            maxHotEventsPerUser: 1000,
          }],
        ]),
      })

      const shardInfo = await unshardedDO.instance.getShardInfo()

      expect(shardInfo).toBeNull()
    })
  })
})

// ============================================================================
// TEST SUITE: STORAGE
// ============================================================================

describe('Analytics DO Integration - Storage', () => {
  let mockDO: MockDOResult<AnalyticsDO, MockEnv>

  beforeEach(() => {
    mockDO = createMockDO(AnalyticsDO as any, {
      ns: 'https://analytics-storage.test.do',
      sqlData: new Map([
        ['events', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1, // Single shard for storage tests
          shardKey: 'userId',
          warmThresholdDays: 7,
          coldThresholdDays: 30,
          maxHotEventsPerUser: 1000,
        }],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // EVENT PERSISTENCE
  // ==========================================================================

  describe('event persistence', () => {
    it('should persist track event to SQLite', async () => {
      // RED: Track events should be stored
      const event: TrackEvent = {
        type: 'track',
        event: 'Product Viewed',
        userId: 'persist-user',
        timestamp: new Date().toISOString(),
        messageId: 'persist-msg-1',
        properties: {
          productId: 'prod-123',
          price: 99.99,
        },
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored._id).toBeDefined()
      expect(stored._storedAt).toBeDefined()
      expect(stored._tier).toBe('hot')
      expect(stored.event).toBe('Product Viewed')
      expect((stored as any).properties.productId).toBe('prod-123')
    })

    it('should persist identify event to SQLite', async () => {
      // RED: Identify events should be stored
      const event: IdentifyEvent = {
        type: 'identify',
        userId: 'identify-persist-user',
        timestamp: new Date().toISOString(),
        messageId: 'identify-persist-msg',
        traits: {
          email: 'test@example.com',
          name: 'Test User',
        },
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored._id).toBeDefined()
      expect(stored.type).toBe('identify')
      expect((stored as any).traits.email).toBe('test@example.com')
    })

    it('should persist page event to SQLite', async () => {
      // RED: Page events should be stored
      const event: PageEvent = {
        type: 'page',
        userId: 'page-user',
        timestamp: new Date().toISOString(),
        messageId: 'page-msg',
        name: 'Home',
        category: 'Marketing',
        properties: {
          url: 'https://example.com/',
          referrer: 'https://google.com/',
        },
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored._id).toBeDefined()
      expect(stored.type).toBe('page')
    })

    it('should assign storage ID to persisted events', async () => {
      // RED: Each event should get unique storage ID
      const events = createTrackEvents(10)

      const stored = await mockDO.instance.storeEvents(events)

      const ids = stored.map((s) => s._id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10) // All unique
    })

    it('should record storage timestamp', async () => {
      // RED: Storage timestamp should be recorded
      const before = Date.now()

      const event: TrackEvent = {
        type: 'track',
        event: 'Timestamp Test',
        userId: 'ts-user',
        timestamp: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        messageId: 'ts-msg',
      }

      const stored = await mockDO.instance.storeEvent(event)
      const after = Date.now()

      const storedTime = new Date(stored._storedAt).getTime()
      expect(storedTime).toBeGreaterThanOrEqual(before)
      expect(storedTime).toBeLessThanOrEqual(after)
    })

    it('should preserve all event fields', async () => {
      // RED: All event data should be preserved
      const event: TrackEvent = {
        type: 'track',
        event: 'Complete Event',
        userId: 'complete-user',
        anonymousId: 'anon-complete',
        timestamp: '2026-01-09T10:00:00.000Z',
        messageId: 'complete-msg',
        properties: {
          nested: { deep: { value: 42 } },
          array: [1, 2, 3],
          string: 'test',
        },
        context: {
          ip: '192.168.1.1',
          userAgent: 'Test Agent',
          page: {
            url: 'https://example.com/',
            title: 'Test Page',
          },
        },
        integrations: {
          'Google Analytics': true,
          Mixpanel: false,
        },
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored.event).toBe('Complete Event')
      expect(stored.userId).toBe('complete-user')
      expect(stored.anonymousId).toBe('anon-complete')
      expect(stored.timestamp).toBe('2026-01-09T10:00:00.000Z')
      expect((stored as any).properties.nested.deep.value).toBe(42)
      expect(stored.context?.ip).toBe('192.168.1.1')
      expect(stored.integrations?.Mixpanel).toBe(false)
    })
  })

  // ==========================================================================
  // EVENT RETRIEVAL BY USER ID
  // ==========================================================================

  describe('retrieval by userId', () => {
    it('should retrieve events by userId', async () => {
      // RED: Should find events for specific user
      const targetUser = 'retrieve-user-0'
      const events = [
        ...createTrackEvents(5, 'retrieve-user'),
        ...createTrackEvents(10, 'other-user'),
      ]
      await mockDO.instance.storeEvents(events)

      const userEvents = await mockDO.instance.getEventsByUser(targetUser)

      // createTrackEvents creates userId as `${prefix}-${i % 10}`, so 'retrieve-user-0' appears once
      // in the first 5 events (at index 0)
      expect(userEvents.length).toBe(1)
      expect(userEvents.every((e) => e.userId === targetUser)).toBe(true)
    })

    it('should limit results when limit specified', async () => {
      // RED: Should respect limit parameter
      const userId = 'limit-user-0'
      const events = createTrackEvents(50, 'limit-user')
      await mockDO.instance.storeEvents(events)

      // createTrackEvents creates userId as `${prefix}-${i % 10}`, so 'limit-user-0' appears at indices 0, 10, 20, 30, 40 = 5 times
      const limitedEvents = await mockDO.instance.getEventsByUser(userId, 10)

      expect(limitedEvents.length).toBe(5) // Only 5 events match 'limit-user-0'
    })

    it('should return empty array for unknown user', async () => {
      // RED: Unknown user should return empty
      await mockDO.instance.storeEvents(createTrackEvents(10))

      const events = await mockDO.instance.getEventsByUser('nonexistent-user')

      expect(events).toEqual([])
    })

    it('should order events by timestamp descending', async () => {
      // RED: Most recent events first
      const userId = 'ordered-user'
      const events = createTrackEvents(20, userId)
      await mockDO.instance.storeEvents(events)

      const userEvents = await mockDO.instance.getEventsByUser(userId)

      for (let i = 1; i < userEvents.length; i++) {
        const prevTime = new Date(userEvents[i - 1].timestamp!).getTime()
        const currTime = new Date(userEvents[i].timestamp!).getTime()
        expect(prevTime).toBeGreaterThanOrEqual(currTime)
      }
    })
  })

  // ==========================================================================
  // EVENT RETRIEVAL BY TIME RANGE
  // ==========================================================================

  describe('retrieval by time range', () => {
    it('should retrieve events within time range', async () => {
      // RED: Should filter by timestamp
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)

      const events = createTrackEvents(100)
      await mockDO.instance.storeEvents(events)

      const rangeEvents = await mockDO.instance.getEventsByTimeRange(
        twoHoursAgo,
        oneHourAgo
      )

      // All returned events should be within range
      for (const event of rangeEvents) {
        const eventTime = new Date(event.timestamp!).getTime()
        expect(eventTime).toBeGreaterThanOrEqual(twoHoursAgo.getTime())
        expect(eventTime).toBeLessThanOrEqual(oneHourAgo.getTime())
      }
    })

    it('should return empty array for range with no events', async () => {
      // RED: Empty range should return empty
      await mockDO.instance.storeEvents(createTrackEvents(10))

      const farPast = new Date('2020-01-01')
      const stillPast = new Date('2020-01-02')
      const events = await mockDO.instance.getEventsByTimeRange(farPast, stillPast)

      expect(events).toEqual([])
    })

    it('should include boundary events', async () => {
      // RED: Events at exact boundary times should be included
      const exactTime = '2026-01-09T12:00:00.000Z'
      const event: TrackEvent = {
        type: 'track',
        event: 'Boundary Event',
        userId: 'boundary-user',
        timestamp: exactTime,
        messageId: 'boundary-msg',
      }
      await mockDO.instance.storeEvent(event)

      const start = new Date(exactTime)
      const end = new Date(exactTime)
      const events = await mockDO.instance.getEventsByTimeRange(start, end)

      expect(events.length).toBe(1)
      expect(events[0].timestamp).toBe(exactTime)
    })
  })

  // ==========================================================================
  // EVENT RETRIEVAL BY TYPE
  // ==========================================================================

  describe('retrieval by event type', () => {
    it('should retrieve only track events', async () => {
      // RED: Filter by event type
      const trackEvents = createTrackEvents(10)
      const identifyEvents = createIdentifyEvents(5)
      await mockDO.instance.storeEvents([...trackEvents, ...identifyEvents])

      const tracks = await mockDO.instance.getEventsByType('track')

      expect(tracks.length).toBe(10)
      expect(tracks.every((e) => e.type === 'track')).toBe(true)
    })

    it('should retrieve only identify events', async () => {
      // RED: Filter by identify type
      const trackEvents = createTrackEvents(10)
      const identifyEvents = createIdentifyEvents(5)
      await mockDO.instance.storeEvents([...trackEvents, ...identifyEvents])

      const identifies = await mockDO.instance.getEventsByType('identify')

      expect(identifies.length).toBe(5)
      expect(identifies.every((e) => e.type === 'identify')).toBe(true)
    })

    it('should return empty for type with no events', async () => {
      // RED: Empty type should return empty
      await mockDO.instance.storeEvents(createTrackEvents(10))

      const groups = await mockDO.instance.getEventsByType('group')

      expect(groups).toEqual([])
    })
  })

  // ==========================================================================
  // ADVANCED QUERYING
  // ==========================================================================

  describe('advanced querying', () => {
    it('should support combined filters', async () => {
      // RED: Multiple filters should AND together
      const events = createTrackEvents(100)
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.queryEvents({
        userId: 'user-1',
        eventType: 'track',
        eventName: 'Event 1',
      })

      expect(result.events.every((e) => e.userId === 'user-1')).toBe(true)
      expect(result.events.every((e) => e.type === 'track')).toBe(true)
      expect(result.events.every((e) => (e as any).event === 'Event 1')).toBe(true)
    })

    it('should support pagination with offset', async () => {
      // RED: Offset should skip events
      const events = createTrackEvents(100)
      await mockDO.instance.storeEvents(events)

      const page1 = await mockDO.instance.queryEvents({ limit: 10, offset: 0 })
      const page2 = await mockDO.instance.queryEvents({ limit: 10, offset: 10 })

      expect(page1.events.length).toBe(10)
      expect(page2.events.length).toBe(10)

      // Pages should not overlap
      const page1Ids = page1.events.map((e) => e._id)
      const page2Ids = page2.events.map((e) => e._id)
      const overlap = page1Ids.filter((id) => page2Ids.includes(id))
      expect(overlap.length).toBe(0)
    })

    it('should return total count in result', async () => {
      // RED: Total should reflect all matching events
      await mockDO.instance.storeEvents(createTrackEvents(100))

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
        limit: 10,
      })

      expect(result.events.length).toBe(10)
      expect(result.total).toBe(100)
    })

    it('should include query metadata', async () => {
      // RED: Meta should have query info
      await mockDO.instance.storeEvents(createTrackEvents(50))

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
      })

      expect(result.meta).toBeDefined()
      expect(result.meta.shardsQueried).toBeGreaterThanOrEqual(1)
      expect(result.meta.duration).toBeGreaterThanOrEqual(0)
      expect(result.meta.tierBreakdown).toBeDefined()
    })
  })

  // ==========================================================================
  // STORAGE STATISTICS
  // ==========================================================================

  describe('storage statistics', () => {
    it('should return accurate event counts', async () => {
      // RED: Stats should reflect stored data
      await mockDO.instance.storeEvents(createTrackEvents(50))

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.totalEvents).toBe(50)
      expect(stats.hotEvents).toBe(50) // All in hot tier initially
    })

    it('should track unique users', async () => {
      // RED: Should count distinct users
      const events = createTrackEvents(100) // 10 unique users
      await mockDO.instance.storeEvents(events)

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.uniqueUsers).toBe(10)
    })

    it('should report storage size', async () => {
      // RED: Should estimate storage size
      await mockDO.instance.storeEvents(createTrackEvents(100))

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.sizeBytes).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: TIERING
// ============================================================================

describe('Analytics DO Integration - Tiering', () => {
  let mockDO: MockDOResult<AnalyticsDO, MockEnv>
  let mockR2: MockR2

  const tieringConfig = {
    warmThresholdDays: 7,
    coldThresholdDays: 30,
  }

  beforeEach(() => {
    mockR2 = createMockR2()

    mockDO = createMockDO(AnalyticsDO as any, {
      ns: 'https://analytics-tiering.test.do',
      sqlData: new Map([
        ['events', []],
      ]),
      storage: new Map([
        ['config', {
          shardCount: 1,
          shardKey: 'userId',
          warmThresholdDays: tieringConfig.warmThresholdDays,
          coldThresholdDays: tieringConfig.coldThresholdDays,
          maxHotEventsPerUser: 1000,
        }],
      ]),
      env: {
        R2: mockR2,
      } as any,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // HOT TIER (SQLITE)
  // ==========================================================================

  describe('hot tier (SQLite)', () => {
    it('should store recent events in hot tier', async () => {
      // RED: New events should be hot
      const event: TrackEvent = {
        type: 'track',
        event: 'Hot Event',
        userId: 'hot-user',
        timestamp: new Date().toISOString(),
        messageId: 'hot-msg',
      }

      const stored = await mockDO.instance.storeEvent(event)

      expect(stored._tier).toBe('hot')
    })

    it('should keep events in hot tier within threshold', async () => {
      // RED: Events younger than warmThreshold stay hot
      const events = createTimedEvents({
        hotCount: 50,
        warmCount: 0,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      await mockDO.instance.runTiering()

      const stats = await mockDO.instance.getStorageStats()
      expect(stats.hotEvents).toBe(50)
    })

    it('should query hot tier by default', async () => {
      // RED: Queries should hit hot tier
      await mockDO.instance.storeEvents(createTrackEvents(50))

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
      })

      expect(result.meta.tierBreakdown.hot).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // WARM TIER (R2)
  // ==========================================================================

  describe('warm tier (R2)', () => {
    it('should move old events to warm storage', async () => {
      // RED: Events older than warmThreshold should move to R2
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 30,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.runTiering()

      expect(result.movedToWarm).toBe(30)
    })

    it('should store warm events in R2', async () => {
      // RED: Warm events should be in R2
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 20,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      await mockDO.instance.runTiering()

      // R2 should have warm events
      expect(mockR2.operations.filter((op) => op.type === 'put').length)
        .toBeGreaterThan(0)
    })

    it('should include warm tier in queries when requested', async () => {
      // RED: Queries can include warm tier
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 20,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)
      await mockDO.instance.runTiering()

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
        includeTiers: ['hot', 'warm'],
      })

      expect(result.meta.tierBreakdown.warm).toBeGreaterThan(0)
      expect(result.total).toBe(30)
    })

    it('should exclude warm tier by default for performance', async () => {
      // RED: Default queries should only hit hot tier
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 20,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)
      await mockDO.instance.runTiering()

      const result = await mockDO.instance.queryEvents({
        eventType: 'track',
      })

      expect(result.meta.tierBreakdown.hot).toBe(10)
      expect(result.meta.tierBreakdown.warm).toBe(0) // Not queried
    })

    it('should preserve event data when moving to warm tier', async () => {
      // RED: Event data should be intact after tiering
      const event: TrackEvent = {
        type: 'track',
        event: 'Warm Preservation Test',
        userId: 'warm-preserve-user',
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        messageId: 'warm-preserve-msg',
        properties: {
          important: 'data',
          nested: { value: 42 },
        },
      }
      await mockDO.instance.storeEvent(event)
      await mockDO.instance.runTiering()

      // Query including warm tier
      const result = await mockDO.instance.queryEvents({
        userId: 'warm-preserve-user',
        includeTiers: ['hot', 'warm'],
      })

      expect(result.events.length).toBe(1)
      expect((result.events[0] as any).properties.important).toBe('data')
    })
  })

  // ==========================================================================
  // COLD TIER (ARCHIVE)
  // ==========================================================================

  describe('cold tier (archive)', () => {
    it('should move very old events to cold storage', async () => {
      // RED: Events older than coldThreshold should be archived
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 20,
        coldCount: 15,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.runTiering()

      expect(result.movedToCold).toBe(15)
    })

    it('should support querying cold tier when explicitly requested', async () => {
      // RED: Cold tier should be queryable
      const events = createTimedEvents({
        hotCount: 5,
        warmCount: 10,
        coldCount: 20,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)
      await mockDO.instance.runTiering()

      const result = await mockDO.instance.queryEvents({
        includeTiers: ['hot', 'warm', 'cold'],
      })

      expect(result.meta.tierBreakdown.cold).toBeGreaterThan(0)
    })

    it('should track tier breakdown in statistics', async () => {
      // RED: Stats should show tier distribution
      const events = createTimedEvents({
        hotCount: 25,
        warmCount: 50,
        coldCount: 25,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)
      await mockDO.instance.runTiering()

      const stats = await mockDO.instance.getStorageStats()

      expect(stats.hotEvents).toBe(25)
      expect(stats.warmEvents).toBe(50)
      expect(stats.coldEvents).toBe(25)
    })
  })

  // ==========================================================================
  // TIERING OPERATIONS
  // ==========================================================================

  describe('tiering operations', () => {
    it('should return tiering operation result', async () => {
      // RED: Tiering should return result object
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 30,
        coldCount: 10,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.runTiering()

      expect(result).toHaveProperty('movedToWarm')
      expect(result).toHaveProperty('movedToCold')
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('duration')
    })

    it('should be idempotent (safe to run multiple times)', async () => {
      // RED: Running tiering twice should not move events again
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 20,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      const result1 = await mockDO.instance.runTiering()
      const result2 = await mockDO.instance.runTiering()

      expect(result1.movedToWarm).toBe(20)
      expect(result2.movedToWarm).toBe(0) // Nothing more to move
    })

    it('should handle empty database', async () => {
      // RED: Tiering empty DB should not error
      const result = await mockDO.instance.runTiering()

      expect(result.movedToWarm).toBe(0)
      expect(result.movedToCold).toBe(0)
      expect(result.deleted).toBe(0)
    })

    it('should report duration of tiering operation', async () => {
      // RED: Duration should be tracked
      const events = createTimedEvents({
        hotCount: 10,
        warmCount: 50,
        coldCount: 50,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      const result = await mockDO.instance.runTiering()

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(typeof result.duration).toBe('number')
    })
  })

  // ==========================================================================
  // THRESHOLD CONFIGURATION
  // ==========================================================================

  describe('threshold configuration', () => {
    it('should respect custom warm threshold', async () => {
      // RED: Custom threshold should be honored
      const customDO = createMockDO(AnalyticsDO as any, {
        ns: 'https://analytics-custom.test.do',
        storage: new Map([
          ['config', {
            shardCount: 1,
            shardKey: 'userId',
            warmThresholdDays: 3, // Custom: 3 days
            coldThresholdDays: 14,
            maxHotEventsPerUser: 1000,
          }],
        ]),
        env: { R2: mockR2 } as any,
      })

      // Create events 4 days old (should be warm with 3-day threshold)
      const oldEvent: TrackEvent = {
        type: 'track',
        event: 'Custom Threshold',
        userId: 'custom-threshold-user',
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        messageId: 'custom-msg',
      }
      await customDO.instance.storeEvent(oldEvent)

      const result = await customDO.instance.runTiering()

      expect(result.movedToWarm).toBe(1)
    })

    it('should respect custom cold threshold', async () => {
      // RED: Custom cold threshold should be honored
      const customDO = createMockDO(AnalyticsDO as any, {
        ns: 'https://analytics-custom-cold.test.do',
        storage: new Map([
          ['config', {
            shardCount: 1,
            shardKey: 'userId',
            warmThresholdDays: 3,
            coldThresholdDays: 7, // Custom: 7 days
            maxHotEventsPerUser: 1000,
          }],
        ]),
        env: { R2: mockR2 } as any,
      })

      // Create events 10 days old (should be cold with 7-day threshold)
      const veryOldEvent: TrackEvent = {
        type: 'track',
        event: 'Cold Threshold',
        userId: 'cold-threshold-user',
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        messageId: 'cold-msg',
      }
      await customDO.instance.storeEvent(veryOldEvent)

      const result = await customDO.instance.runTiering()

      expect(result.movedToCold).toBe(1)
    })
  })

  // ==========================================================================
  // DATA INTEGRITY
  // ==========================================================================

  describe('data integrity', () => {
    it('should maintain event integrity across tiers', async () => {
      // RED: Event data should be identical regardless of tier
      const originalEvent: TrackEvent = {
        type: 'track',
        event: 'Integrity Test',
        userId: 'integrity-user',
        anonymousId: 'integrity-anon',
        timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        messageId: 'integrity-msg',
        properties: {
          complex: { nested: { array: [1, 2, 3] } },
          unicode: 'Test data',
          number: 42.5,
          boolean: true,
        },
        context: {
          ip: '10.0.0.1',
          userAgent: 'IntegrityTest/1.0',
        },
      }
      await mockDO.instance.storeEvent(originalEvent)
      await mockDO.instance.runTiering()

      const result = await mockDO.instance.queryEvents({
        userId: 'integrity-user',
        includeTiers: ['hot', 'warm', 'cold'],
      })

      const retrieved = result.events[0]
      expect(retrieved.event).toBe(originalEvent.event)
      expect((retrieved as any).properties.complex.nested.array).toEqual([1, 2, 3])
      expect((retrieved as any).properties.unicode).toBe('Test data')
    })

    it('should not lose events during tiering', async () => {
      // RED: Total events should be constant
      const events = createTimedEvents({
        hotCount: 50,
        warmCount: 100,
        coldCount: 50,
        ...tieringConfig,
      })
      const totalBefore = events.length

      await mockDO.instance.storeEvents(events)

      const statsBefore = await mockDO.instance.getStorageStats()
      expect(statsBefore.totalEvents).toBe(totalBefore)

      await mockDO.instance.runTiering()

      const statsAfter = await mockDO.instance.getStorageStats()
      expect(statsAfter.totalEvents).toBe(totalBefore)
    })

    it('should handle concurrent tiering requests gracefully', async () => {
      // RED: Concurrent tiering should not corrupt data
      const events = createTimedEvents({
        hotCount: 20,
        warmCount: 80,
        coldCount: 0,
        ...tieringConfig,
      })
      await mockDO.instance.storeEvents(events)

      // Run tiering concurrently
      const results = await Promise.all([
        mockDO.instance.runTiering(),
        mockDO.instance.runTiering(),
        mockDO.instance.runTiering(),
      ])

      // Total moved should equal events to move (no duplicates)
      const totalMoved = results.reduce((sum, r) => sum + r.movedToWarm, 0)
      expect(totalMoved).toBe(80) // Each event moved exactly once
    })
  })
})
