import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createClickHouseAnalyticsStore,
  createMockClickHouseClient,
  eventToAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsStore,
  type ClickHouseClient
} from '../analytics'
import type { Event } from '../events'

describe('Analytics Store', () => {
  let client: ClickHouseClient & { getEvents(): AnalyticsEvent[]; clear(): void }
  let store: AnalyticsStore

  beforeEach(() => {
    client = createMockClickHouseClient()
    store = createClickHouseAnalyticsStore({
      client,
      batchSize: 10,
      flushInterval: 0 // Disable auto-flush for tests
    })
  })

  describe('ingest', () => {
    it('should ingest a single event', async () => {
      const event: AnalyticsEvent = {
        event_id: 'evt-1',
        event_type: 'page_view',
        timestamp: Date.now(),
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        payload: { page: '/home' }
      }

      await store.ingest(event)

      // Flush manually since auto-flush is disabled
      await store.close()

      const events = client.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('page_view')
      expect(events[0].tenant_id).toBe('tenant-1')
    })

    it('should batch multiple events', async () => {
      // Ingest less than batch size
      for (let i = 0; i < 5; i++) {
        await store.ingest({
          event_id: `evt-${i}`,
          event_type: 'click',
          timestamp: Date.now() + i,
          payload: { index: i }
        })
      }

      await store.close()

      const events = client.getEvents()
      expect(events).toHaveLength(5)
    })
  })

  describe('ingestBatch', () => {
    it('should ingest multiple events at once', async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'signup', timestamp: Date.now(), payload: {} },
        { event_id: 'evt-2', event_type: 'login', timestamp: Date.now() + 1, payload: {} },
        { event_id: 'evt-3', event_type: 'purchase', timestamp: Date.now() + 2, payload: { amount: 100 } }
      ]

      const result = await store.ingestBatch(events)

      expect(result.inserted).toBe(3)
      expect(client.getEvents()).toHaveLength(3)
    })

    it('should handle large batches', async () => {
      const events: AnalyticsEvent[] = []
      for (let i = 0; i < 25; i++) {
        events.push({
          event_id: `evt-${i}`,
          event_type: 'event',
          timestamp: Date.now() + i,
          payload: { index: i }
        })
      }

      const result = await store.ingestBatch(events)

      expect(result.inserted).toBe(25)
      expect(client.getEvents()).toHaveLength(25)
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, tenant_id: 'tenant-1', payload: {} },
        { event_id: 'evt-2', event_type: 'click', timestamp: 2000, tenant_id: 'tenant-1', payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, tenant_id: 'tenant-2', payload: {} },
        { event_id: 'evt-4', event_type: 'purchase', timestamp: 4000, tenant_id: 'tenant-1', payload: { amount: 50 } }
      ]

      await store.ingestBatch(events)
    })

    it('should query all events', async () => {
      const result = await store.query({})

      expect(result.data.length).toBeGreaterThanOrEqual(4)
      expect(result.metadata.totalRows).toBeGreaterThanOrEqual(4)
    })

    it('should filter by event type', async () => {
      const result = await store.query({ eventTypes: ['page_view'] })

      expect(result.data).toHaveLength(2)
      result.data.forEach(event => {
        expect(event.event_type).toBe('page_view')
      })
    })

    it('should filter by tenant', async () => {
      const result = await store.query({ tenantId: 'tenant-1' })

      expect(result.data).toHaveLength(3)
      result.data.forEach(event => {
        expect(event.tenant_id).toBe('tenant-1')
      })
    })

    it('should return events sorted by timestamp descending', async () => {
      const result = await store.query({})

      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i - 1].timestamp).toBeGreaterThanOrEqual(result.data[i].timestamp)
      }
    })
  })

  describe('count', () => {
    beforeEach(async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, tenant_id: 't1', payload: {} },
        { event_id: 'evt-2', event_type: 'click', timestamp: 2000, tenant_id: 't1', payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, tenant_id: 't2', payload: {} }
      ]

      await store.ingestBatch(events)
    })

    it('should count all events', async () => {
      const count = await store.count()
      expect(count).toBe(3)
    })

    it('should count with filters', async () => {
      const count = await store.count({ eventTypes: ['page_view'] })
      expect(count).toBe(2)
    })

    it('should count by tenant', async () => {
      const count = await store.count({ tenantId: 't1' })
      expect(count).toBe(2)
    })
  })

  describe('countUnique', () => {
    beforeEach(async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, user_id: 'u1', payload: {} },
        { event_id: 'evt-2', event_type: 'page_view', timestamp: 2000, user_id: 'u1', payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, user_id: 'u2', payload: {} },
        { event_id: 'evt-4', event_type: 'page_view', timestamp: 4000, user_id: 'u3', payload: {} }
      ]

      await store.ingestBatch(events)
    })

    it('should count unique users', async () => {
      const count = await store.countUnique('user_id')
      expect(count).toBe(3)
    })
  })

  describe('topN', () => {
    beforeEach(async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, payload: {}, dimensions: { page: '/home' } },
        { event_id: 'evt-2', event_type: 'page_view', timestamp: 2000, payload: {}, dimensions: { page: '/home' } },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, payload: {}, dimensions: { page: '/about' } },
        { event_id: 'evt-4', event_type: 'page_view', timestamp: 4000, payload: {}, dimensions: { page: '/home' } },
        { event_id: 'evt-5', event_type: 'page_view', timestamp: 5000, payload: {}, dimensions: { page: '/contact' } }
      ]

      await store.ingestBatch(events)
    })

    it('should return top N values by count', async () => {
      const top = await store.topN('dimensions.page', 3)

      expect(top).toHaveLength(3)
      expect(top[0].value).toBe('/home')
      expect(top[0].count).toBe(3)
      expect(top[1].count).toBeLessThanOrEqual(top[0].count)
    })

    it('should respect the limit', async () => {
      const top = await store.topN('dimensions.page', 2)
      expect(top).toHaveLength(2)
    })
  })

  describe('timeSeries', () => {
    beforeEach(async () => {
      const now = Date.now()
      const hour = 3600000

      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: now - hour * 3, payload: {} },
        { event_id: 'evt-2', event_type: 'page_view', timestamp: now - hour * 3 + 1000, payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: now - hour * 2, payload: {} },
        { event_id: 'evt-4', event_type: 'page_view', timestamp: now - hour, payload: {} },
        { event_id: 'evt-5', event_type: 'page_view', timestamp: now - hour + 1000, payload: {} },
        { event_id: 'evt-6', event_type: 'page_view', timestamp: now - hour + 2000, payload: {} }
      ]

      await store.ingestBatch(events)
    })

    it('should return time-series data', async () => {
      const series = await store.timeSeries('count', 'count', { granularity: 'hour' })

      expect(series.length).toBeGreaterThan(0)
      series.forEach(point => {
        expect(point).toHaveProperty('timestamp')
        expect(point).toHaveProperty('value')
        expect(typeof point.timestamp).toBe('number')
        expect(typeof point.value).toBe('number')
      })
    })

    it('should be sorted by timestamp ascending', async () => {
      const series = await store.timeSeries('count', 'count', { granularity: 'hour' })

      for (let i = 1; i < series.length; i++) {
        expect(series[i].timestamp).toBeGreaterThanOrEqual(series[i - 1].timestamp)
      }
    })
  })

  describe('aggregate', () => {
    beforeEach(async () => {
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'purchase', timestamp: 1000, payload: {}, metrics: { amount: 100 } },
        { event_id: 'evt-2', event_type: 'purchase', timestamp: 2000, payload: {}, metrics: { amount: 150 } },
        { event_id: 'evt-3', event_type: 'purchase', timestamp: 3000, payload: {}, metrics: { amount: 200 } }
      ]

      await store.ingestBatch(events)
    })

    it('should aggregate count', async () => {
      const result = await store.aggregate({
        metrics: [
          { field: '*', function: 'count', alias: 'total' }
        ]
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].total).toBe(3)
    })
  })

  describe('createTable', () => {
    it('should create table without error', async () => {
      await expect(store.createTable()).resolves.not.toThrow()
    })
  })
})

describe('eventToAnalyticsEvent', () => {
  it('should convert Event to AnalyticsEvent', () => {
    const event: Event = {
      $id: 'evt-abc123' as any,
      type: 'user.signup',
      $timestamp: 1705000000000,
      source: 'user-456',
      correlationId: 'session-789',
      payload: { email: 'test@example.com' }
    }

    const analyticsEvent = eventToAnalyticsEvent(event, 'tenant-1')

    expect(analyticsEvent.event_id).toBe('evt-abc123')
    expect(analyticsEvent.event_type).toBe('user.signup')
    expect(analyticsEvent.timestamp).toBe(1705000000000)
    expect(analyticsEvent.tenant_id).toBe('tenant-1')
    expect(analyticsEvent.user_id).toBe('user-456')
    expect(analyticsEvent.session_id).toBe('session-789')
    expect(analyticsEvent.payload).toEqual({ email: 'test@example.com' })
  })

  it('should handle missing optional fields', () => {
    const event: Event = {
      $id: 'evt-def456' as any,
      type: 'system.heartbeat',
      $timestamp: 1705000000000,
      payload: {}
    }

    const analyticsEvent = eventToAnalyticsEvent(event)

    expect(analyticsEvent.event_id).toBe('evt-def456')
    expect(analyticsEvent.tenant_id).toBeUndefined()
    expect(analyticsEvent.user_id).toBeUndefined()
    expect(analyticsEvent.session_id).toBeUndefined()
  })
})

describe('MockClickHouseClient', () => {
  let client: ClickHouseClient & { getEvents(): AnalyticsEvent[]; clear(): void }

  beforeEach(() => {
    client = createMockClickHouseClient()
  })

  it('should store events from INSERT queries', async () => {
    const sql = `INSERT INTO analytics_events (event_id, event_type, timestamp, tenant_id, user_id, session_id, payload, dimensions, metrics) VALUES ('evt-1', 'test', 1000, 'tenant', 'user', 'session', '{}', '{}', '{}')`

    await client.query(sql)

    const events = client.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event_id).toBe('evt-1')
    expect(events[0].event_type).toBe('test')
  })

  it('should return count for count queries', async () => {
    // Insert some events first
    await client.query(`INSERT INTO analytics_events (event_id, event_type, timestamp, tenant_id, user_id, session_id, payload, dimensions, metrics) VALUES ('evt-1', 'test', 1000, '', '', '', '{}', '{}', '{}')`)
    await client.query(`INSERT INTO analytics_events (event_id, event_type, timestamp, tenant_id, user_id, session_id, payload, dimensions, metrics) VALUES ('evt-2', 'test', 2000, '', '', '', '{}', '{}', '{}')`)

    const result = await client.query<{ cnt: number }>('SELECT count() AS cnt FROM analytics_events')

    expect(result.data).toHaveLength(1)
    expect(result.data[0].cnt).toBe(2)
  })

  it('should clear events', () => {
    client.clear()
    expect(client.getEvents()).toHaveLength(0)
  })

  it('should handle CREATE TABLE', async () => {
    await expect(
      client.query('CREATE TABLE IF NOT EXISTS analytics_events (...)')
    ).resolves.not.toThrow()
  })

  it('should return query metadata', async () => {
    const result = await client.query('SELECT count() AS cnt FROM analytics_events')

    expect(result).toHaveProperty('rowsRead')
    expect(result).toHaveProperty('bytesRead')
    expect(result).toHaveProperty('elapsed')
    expect(typeof result.elapsed).toBe('number')
  })
})

describe('ClickHouse Analytics Integration', () => {
  describe('time range queries', () => {
    let client: ClickHouseClient & { getEvents(): AnalyticsEvent[]; clear(): void }
    let store: AnalyticsStore

    beforeEach(async () => {
      client = createMockClickHouseClient()
      store = createClickHouseAnalyticsStore({
        client,
        batchSize: 100,
        flushInterval: 0
      })

      // Insert events across different time ranges
      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, payload: {} },
        { event_id: 'evt-2', event_type: 'page_view', timestamp: 2000, payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, payload: {} },
        { event_id: 'evt-4', event_type: 'page_view', timestamp: 4000, payload: {} },
        { event_id: 'evt-5', event_type: 'page_view', timestamp: 5000, payload: {} }
      ]

      await store.ingestBatch(events)
    })

    it('should filter by start time', async () => {
      const count = await store.count({ startTime: 3000 })
      expect(count).toBe(3) // Events at 3000, 4000, 5000
    })

    it('should filter by end time', async () => {
      const count = await store.count({ endTime: 3000 })
      expect(count).toBe(2) // Events at 1000, 2000 (end time is exclusive)
    })

    it('should filter by time range', async () => {
      const count = await store.count({ startTime: 2000, endTime: 4000 })
      expect(count).toBe(2) // Events at 2000, 3000
    })
  })

  describe('multi-tenant isolation', () => {
    let client: ClickHouseClient & { getEvents(): AnalyticsEvent[]; clear(): void }
    let store: AnalyticsStore

    beforeEach(async () => {
      client = createMockClickHouseClient()
      store = createClickHouseAnalyticsStore({
        client,
        batchSize: 100,
        flushInterval: 0
      })

      const events: AnalyticsEvent[] = [
        { event_id: 'evt-1', event_type: 'page_view', timestamp: 1000, tenant_id: 'acme', payload: {} },
        { event_id: 'evt-2', event_type: 'page_view', timestamp: 2000, tenant_id: 'acme', payload: {} },
        { event_id: 'evt-3', event_type: 'page_view', timestamp: 3000, tenant_id: 'globex', payload: {} }
      ]

      await store.ingestBatch(events)
    })

    it('should isolate tenant data', async () => {
      const acmeCount = await store.count({ tenantId: 'acme' })
      const globexCount = await store.count({ tenantId: 'globex' })

      expect(acmeCount).toBe(2)
      expect(globexCount).toBe(1)
    })

    it('should query tenant-specific events', async () => {
      const result = await store.query({ tenantId: 'acme' })

      expect(result.data).toHaveLength(2)
      result.data.forEach(event => {
        expect(event.tenant_id).toBe('acme')
      })
    })
  })
})
