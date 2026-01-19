import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEventsStore, type EventsStore } from '../events'

describe('Events Store', () => {
  let store: EventsStore

  beforeEach(() => {
    store = createEventsStore()
  })

  describe('emit', () => {
    it('should emit an event with generated id and timestamp', async () => {
      const event = await store.emit({
        type: 'user.created',
        payload: { name: 'Alice' }
      })

      expect(event.$id).toMatch(/^evt-/)
      expect(event.type).toBe('user.created')
      expect(event.payload).toEqual({ name: 'Alice' })
      expect(event.$timestamp).toBeDefined()
    })

    it('should include source and correlationId', async () => {
      const event = await store.emit({
        type: 'order.placed',
        payload: { total: 100 },
        source: 'user-123',
        correlationId: 'req-456'
      })

      expect(event.source).toBe('user-123')
      expect(event.correlationId).toBe('req-456')
    })
  })

  describe('get', () => {
    it('should retrieve an event by id', async () => {
      const emitted = await store.emit({ type: 'test', payload: {} })
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
      await store.emit({ type: 'user.created', payload: {}, source: 'system' })
      await store.emit({ type: 'user.updated', payload: {}, source: 'user-1' })
      await store.emit({ type: 'user.created', payload: {}, source: 'system' })
      await store.emit({ type: 'order.placed', payload: {}, correlationId: 'tx-1' })
    })

    it('should query by type', async () => {
      const events = await store.query({ type: 'user.created' })
      expect(events).toHaveLength(2)
    })

    it('should query by source', async () => {
      const events = await store.query({ source: 'system' })
      expect(events).toHaveLength(2)
    })

    it('should query by correlationId', async () => {
      const events = await store.query({ correlationId: 'tx-1' })
      expect(events).toHaveLength(1)
    })

    it('should support pagination', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 })
      const page2 = await store.query({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
    })

    it('should return newest first', async () => {
      const events = await store.query({})

      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].$timestamp).toBeGreaterThanOrEqual(events[i].$timestamp)
      }
    })
  })

  describe('subscribe', () => {
    it('should notify subscribers on emit', async () => {
      const handler = vi.fn()
      store.subscribe(handler)

      const event = await store.emit({ type: 'test', payload: 'data' })

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should allow unsubscribing', async () => {
      const handler = vi.fn()
      const unsubscribe = store.subscribe(handler)

      unsubscribe()
      await store.emit({ type: 'test', payload: {} })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should handle subscriber errors gracefully', async () => {
      const badHandler = vi.fn(() => { throw new Error('Oops') })
      const goodHandler = vi.fn()

      store.subscribe(badHandler)
      store.subscribe(goodHandler)

      await store.emit({ type: 'test', payload: {} })

      expect(goodHandler).toHaveBeenCalled()
    })
  })
})
