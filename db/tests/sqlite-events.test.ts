import { describe, it, expect, beforeEach } from 'vitest'
import { createSQLiteEventsStore, SQLiteAdapter } from '../sqlite'
import type { Event, EventsStore } from '../events'
import { createMockSqlStorage, type MockSqlStorage } from './sqlite-test-utils'

describe('SQLite EventsStore', () => {
  let sql: MockSqlStorage
  let store: EventsStore

  beforeEach(async () => {
    sql = createMockSqlStorage()
    // Use legacy init mode for existing tests since mock doesn't support migrations
    const adapter = new SQLiteAdapter(sql as any, { useLegacyInit: true })
    await adapter.initialize()
    store = createSQLiteEventsStore(adapter)
  })

  describe('emit', () => {
    it('should insert event into SQLite', async () => {
      const event = await store.emit({ type: 'user.signup', payload: { userId: '123' } })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('user.signup')
      expect(event.payload).toEqual({ userId: '123' })
      expect(event.$timestamp).toBeDefined()
    })

    it('should support optional source and correlationId', async () => {
      const event = await store.emit({
        type: 'payment.completed',
        payload: { amount: 100 },
        source: 'payment-service',
        correlationId: 'trace-123'
      })

      expect(event.source).toBe('payment-service')
      expect(event.correlationId).toBe('trace-123')
    })

    it('should store payload as JSON', async () => {
      const event = await store.emit({
        type: 'order.created',
        payload: {
          orderId: 'ord-123',
          items: [{ id: 1, qty: 2 }],
          total: 99.99
        }
      })

      const retrieved = await store.get(event.$id)
      expect(retrieved?.payload).toEqual({
        orderId: 'ord-123',
        items: [{ id: 1, qty: 2 }],
        total: 99.99
      })
    })
  })

  describe('get', () => {
    it('should retrieve event by id', async () => {
      const emitted = await store.emit({ type: 'test.event', payload: { data: 'test' } })
      const retrieved = await store.get(emitted.$id)

      expect(retrieved).toEqual(emitted)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      await store.emit({ type: 'user.signup', payload: {}, source: 'auth' })
      await store.emit({ type: 'user.login', payload: {}, source: 'auth' })
      await store.emit({ type: 'payment.completed', payload: {}, source: 'payments' })
    })

    it('should filter by type', async () => {
      const events = await store.query({ type: 'user.signup' })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('user.signup')
    })

    it('should filter by source', async () => {
      const events = await store.query({ source: 'auth' })
      expect(events).toHaveLength(2)
      expect(events.every(e => e.source === 'auth')).toBe(true)
    })

    it('should filter by correlationId', async () => {
      await store.emit({ type: 'step1', payload: {}, correlationId: 'trace-123' })
      await store.emit({ type: 'step2', payload: {}, correlationId: 'trace-123' })
      await store.emit({ type: 'step3', payload: {}, correlationId: 'trace-456' })

      const events = await store.query({ correlationId: 'trace-123' })
      expect(events).toHaveLength(2)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      await store.emit({ type: 'event1', payload: {} })

      const events = await store.query({ since: now })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should support limit and offset', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 })
      const page2 = await store.query({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('subscribe', () => {
    it('should notify subscribers on emit', async () => {
      const events: Event[] = []
      const unsubscribe = store.subscribe((event) => {
        events.push(event)
      })

      await store.emit({ type: 'test', payload: {} })
      await store.emit({ type: 'test2', payload: {} })

      expect(events).toHaveLength(2)
      unsubscribe()
    })

    it('should unsubscribe correctly', async () => {
      const events: Event[] = []
      const unsubscribe = store.subscribe((event) => {
        events.push(event)
      })

      await store.emit({ type: 'test', payload: {} })
      unsubscribe()
      await store.emit({ type: 'test2', payload: {} })

      expect(events).toHaveLength(1)
    })
  })
})
