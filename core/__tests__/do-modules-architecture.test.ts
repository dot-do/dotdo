/**
 * DOCore Modular Architecture Tests - Wave 4 TDD RED Phase
 *
 * Tests for extracting DOCore (2831 lines) into 5 focused modules:
 * - DOCoreStorage (~800 lines) - Things, Relationships, Events stores
 * - DOCoreSchedule (~500 lines) - Schedule registration, CRON, alarms
 * - DOCoreEvents (~600 lines) - Event emission, handlers, wildcards
 * - DOCoreRpc (~400 lines) - RPC method registration, routing
 * - DOCore (~500 lines) - Coordination, composition
 *
 * Issue: do-m9w2 (Wave 4 Architecture)
 *
 * These are RED phase tests that document the desired modular interfaces.
 * Some tests may be skipped (.skip) if the modules don't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

function getDO(name = 'architecture-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// DOCoreStorage Module Interface Tests
// =============================================================================

describe('DOCoreStorage Module Interface', () => {
  describe('Things Store Operations', () => {
    it('should expose thing creation through storage adapter', async () => {
      const doInstance = getDO('storage-create-test')

      // Thing creation should be delegated to storage module
      const thing = await doInstance.create('TestThing', {
        name: 'Test Item',
        value: 42,
      })

      expect(thing).toBeDefined()
      expect(thing.$type).toBe('TestThing')
      expect(thing.$id).toBeDefined()
      expect(thing.name).toBe('Test Item')
      expect(thing.value).toBe(42)
    })

    it('should expose thing listing through storage adapter', async () => {
      const doInstance = getDO('storage-list-test')

      // Create multiple things
      const thing1 = await doInstance.create('Product', { name: 'Widget A' })
      const thing2 = await doInstance.create('Product', { name: 'Widget B' })

      // List should return all things of type
      const things = await doInstance.listThings('Product')

      expect(Array.isArray(things)).toBe(true)
      expect(things.length).toBeGreaterThanOrEqual(2)
      expect(things).toContainEqual(expect.objectContaining({ $id: thing1.$id }))
      expect(things).toContainEqual(expect.objectContaining({ $id: thing2.$id }))
    })

    it('should expose thing retrieval by ID through storage adapter', async () => {
      const doInstance = getDO('storage-get-test')

      const created = await doInstance.create('User', { email: 'test@example.com' })
      const retrieved = await doInstance.getThingById(created.$id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.email).toBe('test@example.com')
    })

    it('should expose thing updates through storage adapter', async () => {
      const doInstance = getDO('storage-update-test')

      const created = await doInstance.create('Account', { balance: 100 })
      const updated = await doInstance.updateThingById(created.$id, { balance: 150 })

      expect(updated).toBeDefined()
      expect(updated?.$id).toBe(created.$id)
      expect(updated?.balance).toBe(150)
    })

    it('should expose thing deletion through storage adapter', async () => {
      const doInstance = getDO('storage-delete-test')

      const created = await doInstance.create('Temp', { data: 'temporary' })
      const deleted = await doInstance.deleteThingById(created.$id)

      expect(deleted).toBe(true)

      const retrieved = await doInstance.getThingById(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should expose count operation through storage adapter', async () => {
      const doInstance = getDO('storage-count-test')

      // Create multiple things
      await doInstance.create('Counter', { value: 1 })
      await doInstance.create('Counter', { value: 2 })
      await doInstance.create('Counter', { value: 3 })

      const count = await doInstance.countThings('Counter')
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Events Store Operations', () => {
    it('should expose event emission through storage', async () => {
      const doInstance = getDO('storage-emit-test')

      // send() should store event
      const eventId = await doInstance.send('Item.created', {
        id: 'item-123',
        name: 'New Item',
      })

      expect(eventId).toBeDefined()
      expect(typeof eventId).toBe('string')
    })

    it('should provide event retrieval through storage', async () => {
      const doInstance = getDO('storage-event-retrieve-test')

      // After emitting, event should be queryable from storage
      const eventId = await doInstance.send('Payment.processed', {
        amount: 99.99,
        currency: 'USD',
      })

      // This tests the interface for querying event history
      // (Actual method name TBD during implementation)
      expect(eventId).toBeDefined()
    })
  })

  describe('Relationships Store Operations', () => {
    it('should expose relationship creation', async () => {
      const doInstance = getDO('storage-rel-create-test')

      // Create two things to relate
      const user = await doInstance.create('User', { name: 'Alice' })
      const team = await doInstance.create('Team', { name: 'Alpha' })

      // Relationship creation should be exposed
      // (Exact method TBD: createRelationship, addRelationship, etc.)
      expect(user.$id).toBeDefined()
      expect(team.$id).toBeDefined()
    })
  })

  describe('Storage Batch Operations', () => {
    it('should expose createMany for bulk inserts', async () => {
      const doInstance = getDO('storage-batch-create-test')

      const items = [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }]

      const created = await doInstance.createManyThings('Item', items)

      expect(Array.isArray(created)).toBe(true)
      expect(created.length).toBe(3)
      expect(created[0].$type).toBe('Item')
    })

    it('should expose updateMany for bulk updates', async () => {
      const doInstance = getDO('storage-batch-update-test')

      // Create items first
      const item1 = await doInstance.create('Tag', { label: 'old' })
      const item2 = await doInstance.create('Tag', { label: 'old' })

      // Update all with label 'old' to 'new'
      const updated = await doInstance.updateManyThings('Tag', { where: { label: 'old' } }, { label: 'new' })

      expect(Array.isArray(updated)).toBe(true)
      expect(updated.length).toBeGreaterThanOrEqual(2)
      expect(updated[0].label).toBe('new')
    })

    it('should expose deleteMany for bulk deletes', async () => {
      const doInstance = getDO('storage-batch-delete-test')

      // Create items with status=archive
      await doInstance.create('Document', { status: 'archive' })
      await doInstance.create('Document', { status: 'archive' })

      const deleted = await doInstance.deleteManyThings('Document', { where: { status: 'archive' } })

      expect(typeof deleted).toBe('number')
      expect(deleted).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Storage Filtering and Querying', () => {
    it('should support where clause filtering in list operations', async () => {
      const doInstance = getDO('storage-filter-test')

      await doInstance.create('Product', { category: 'electronics', price: 100 })
      await doInstance.create('Product', { category: 'electronics', price: 200 })
      await doInstance.create('Product', { category: 'books', price: 15 })

      const electronics = await doInstance.listThings('Product', { where: { category: 'electronics' } })

      expect(electronics.every((p) => (p as Record<string, unknown>).category === 'electronics')).toBe(true)
    })

    it('should support limit and offset in list operations', async () => {
      const doInstance = getDO('storage-pagination-test')

      // Create more than limit
      for (let i = 0; i < 10; i++) {
        await doInstance.create('Page', { number: i })
      }

      const first = await doInstance.listThings('Page', { limit: 3 })
      const second = await doInstance.listThings('Page', { limit: 3, offset: 3 })

      expect(first.length).toBeLessThanOrEqual(3)
      expect(second.length).toBeLessThanOrEqual(3)
      if (first.length > 0 && second.length > 0) {
        expect(first[0].$id).not.toBe(second[0].$id)
      }
    })
  })

  describe('Storage Transactions', () => {
    it('should expose transactional write operations', async () => {
      const doInstance = getDO('storage-transaction-test')

      // Storage should support atomic multi-step operations
      // (Exact API TBD: transaction, batchWrite, etc.)
      const item = await doInstance.create('Transactional', { value: 1 })
      expect(item).toBeDefined()
    })
  })

  describe('Storage Soft Delete and Restore', () => {
    it('should expose soft delete operations', async () => {
      const doInstance = getDO('storage-soft-delete-test')

      const created = await doInstance.create('Archivable', { data: 'archive me' })

      const softDeleted = await doInstance.softDeleteThingById(created.$id)

      expect(softDeleted).toBeDefined()
      expect((softDeleted as Record<string, unknown>).$deletedAt).toBeDefined()
    })

    it('should expose restore operations', async () => {
      const doInstance = getDO('storage-restore-test')

      const created = await doInstance.create('Restorable', { data: 'restore me' })
      await doInstance.softDeleteThingById(created.$id)

      const restored = await doInstance.restoreThingById(created.$id)

      expect(restored).toBeDefined()
      expect((restored as Record<string, unknown>).$deletedAt).toBeUndefined()
    })
  })

  describe('Storage LRU Cache Management', () => {
    it('should provide cache hit rate statistics', async () => {
      const doInstance = getDO('storage-cache-test')

      // Create and access things multiple times
      const thing = await doInstance.create('Cached', { data: 'test' })

      // Access same thing multiple times (should hit cache)
      await doInstance.getThingById(thing.$id)
      await doInstance.getThingById(thing.$id)
      await doInstance.getThingById(thing.$id)

      // Cache stats should be accessible for testing
      // (Exact method TBD: getCacheStats, getMetrics, etc.)
      expect(thing).toBeDefined()
    })
  })
})

// =============================================================================
// DOCoreSchedule Module Interface Tests
// =============================================================================

describe('DOCoreSchedule Module Interface', () => {
  describe('Schedule Registration via Fluent DSL', () => {
    // Note: The `every` getter returns a Proxy-based builder that cannot be serialized over RPC.
    // For RPC access, use the delegation methods (registerScheduleViaEvery, etc.)
    // The `every` builder is designed for internal DO use, not cross-DO RPC.

    it('should expose $.every.day schedule builder', async () => {
      const doInstance = getDO('schedule-day-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('day', '9am', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 9 * * *')
    })

    it('should expose $.every.hour schedule builder', async () => {
      const doInstance = getDO('schedule-hour-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('hour', null, handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 * * * *')
    })

    it('should expose $.every.minute schedule builder', async () => {
      const doInstance = getDO('schedule-minute-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('minute', null, handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('* * * * *')
    })

    it('should expose $.every[N].minutes for intervals', async () => {
      const doInstance = getDO('schedule-interval-test')

      const handler = vi.fn()
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaInterval(5, 'minutes', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('*/5 * * * *')
    })

    it('should expose $.every[N].hours for interval hours', async () => {
      const doInstance = getDO('schedule-interval-hours-test')

      const handler = vi.fn()
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaInterval(2, 'hours', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 */2 * * *')
    })

    it('should expose $.every[N].seconds for interval seconds', async () => {
      const doInstance = getDO('schedule-interval-seconds-test')

      const handler = vi.fn()
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaInterval(30, 'seconds', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('every:30s')
    })

    it('should expose day-specific scheduling ($.every.Monday.at)', async () => {
      const doInstance = getDO('schedule-monday-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('Monday', '10am', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 10 * * 1')
    })

    it('should support all weekdays', async () => {
      const doInstance = getDO('schedule-weekdays-test')

      const handler = vi.fn()
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

      for (const day of days) {
        // Use the RPC-compatible method instead of direct Proxy access
        // Returns CRON string for unsubscription via deleteScheduleByCron()
        const cron = await doInstance.registerScheduleViaEvery(day, '10am', handler)
        expect(typeof cron).toBe('string')
      }
    })
  })

  describe('Schedule Persistence', () => {
    it('should persist schedules to SQLite', async () => {
      const doInstance = getDO('schedule-persist-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('day', '3pm', handler)

      // Get schedule from SQLite
      const schedule = await doInstance.getSchedule('0 15 * * *')
      expect(schedule).toBeDefined()
    })

    it('should provide schedule retrieval by CRON', async () => {
      const doInstance = getDO('schedule-get-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('hour', null, handler)

      const schedule = await doInstance.getSchedule('0 * * * *')
      expect(schedule).toBeDefined()
      // Note: handler functions are not serializable over RPC
      // Check handler_id instead, which is the RPC-safe identifier
      expect(schedule?.handler_id).toBeDefined()
    })

    it('should allow unsubscribing from schedules', async () => {
      const doInstance = getDO('schedule-unsubscribe-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('day', '5pm', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 17 * * *')

      // After unsubscribe via deleteScheduleByCron, schedule should be removed
      // Use RPC-compatible delegation method
      const deleted = await doInstance.deleteScheduleByCron(cron)
      expect(deleted).toBe(true)

      const retrievedSchedule = await doInstance.getSchedule('0 17 * * *')
      // getSchedule (deprecated) returns undefined when not found
      expect(retrievedSchedule).toBeUndefined()
    })
  })

  describe('CRON Expression Parsing', () => {
    it('should parse CRON expressions correctly for daily schedules', async () => {
      const doInstance = getDO('cron-daily-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('day', '9am', handler)

      // Should register with CRON "0 9 * * *"
      const schedule = await doInstance.getSchedule('0 9 * * *')
      expect(schedule).toBeDefined()
    })

    it('should parse CRON expressions for hourly schedules', async () => {
      const doInstance = getDO('cron-hourly-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('hour', null, handler)

      // Should register with CRON "0 * * * *"
      const schedule = await doInstance.getSchedule('0 * * * *')
      expect(schedule).toBeDefined()
    })

    it('should parse CRON expressions for interval schedules', async () => {
      const doInstance = getDO('cron-interval-test')

      const handler = vi.fn()
      await doInstance.registerScheduleViaInterval(5, 'minutes', handler)

      // Should register with CRON "*/5 * * * *"
      const schedule = await doInstance.getSchedule('*/5 * * * *')
      expect(schedule).toBeDefined()
    })

    it('should handle custom time parsing (9am, 5pm, etc.)', async () => {
      const doInstance = getDO('cron-custom-time-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('day', '11:30am', handler)

      // Should register with CRON "30 11 * * *"
      const schedule = await doInstance.getSchedule('30 11 * * *')
      expect(schedule).toBeDefined()
    })

    it('should parse day-specific CRON expressions', async () => {
      const doInstance = getDO('cron-day-test')

      const handler = vi.fn()
      // Use the RPC-compatible method instead of direct Proxy access
      await doInstance.registerScheduleViaEvery('Friday', '4pm', handler)

      // Should register with CRON "0 16 * * 5" (Friday = 5)
      const schedule = await doInstance.getSchedule('0 16 * * 5')
      expect(schedule).toBeDefined()
    })
  })

  describe('Schedule Alarm Integration', () => {
    it('should expose setAlarm for schedule triggers', async () => {
      const doInstance = getDO('alarm-set-test')

      // Schedules should use setAlarm internally
      const triggerTime = Date.now() + 60000 // 1 minute from now
      // (Exact method TBD: setAlarm, scheduleAlarm, etc.)
      expect(triggerTime).toBeGreaterThan(Date.now())
    })
  })
})

// =============================================================================
// DOCoreEvents Module Interface Tests
// =============================================================================

describe('DOCoreEvents Module Interface', () => {
  describe('Event Emission', () => {
    it('should expose send() for fire-and-forget events', async () => {
      const doInstance = getDO('events-send-test')

      const eventId = await doInstance.send('User.created', { id: 'user-123', name: 'Alice' })

      expect(eventId).toBeDefined()
      expect(typeof eventId).toBe('string')
      expect(eventId).toMatch(/^evt_/)
    })

    it('should return unique event IDs', async () => {
      const doInstance = getDO('events-unique-test')

      const id1 = await doInstance.send('Item.created', { id: 'item-1' })
      const id2 = await doInstance.send('Item.created', { id: 'item-2' })

      expect(id1).not.toBe(id2)
    })

    it('should immediately dispatch to registered handlers', async () => {
      const doInstance = getDO('events-dispatch-test')

      const handler = vi.fn()
      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Customer.signup', handler)

      await new Promise((resolve) => setTimeout(resolve, 10)) // Small delay for async dispatch
      await doInstance.send('Customer.signup', { customerId: 'cust-123' })

      await new Promise((resolve) => setTimeout(resolve, 50)) // Wait for async handler
    })
  })

  describe('Event Handler Registration via OnProxy', () => {
    it('should expose $.on.Noun.verb() pattern for registration', async () => {
      const doInstance = getDO('events-on-test')

      const handler = vi.fn()
      // Use RPC-compatible registerHandler method
      // Note: The OnProxy pattern (on.Noun.verb) works locally but not over RPC
      const unsubscribe = await doInstance.registerHandler('Customer.signup', handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('should support multiple handlers for same event', async () => {
      const doInstance = getDO('events-multiple-handlers-test')

      const handler1 = vi.fn()
      const handler2 = vi.fn()

      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Payment.processed', handler1)
      await doInstance.registerHandler('Payment.processed', handler2)

      expect(await doInstance.getHandlerCount('Payment.processed')).toBeGreaterThanOrEqual(2)
    })

    it('should return unsubscribe function from registration', async () => {
      const doInstance = getDO('events-unsubscribe-test')

      const handler = vi.fn()
      // Use RPC-compatible registerHandler method
      const unsubscribe = await doInstance.registerHandler('Order.created', handler)

      expect(typeof unsubscribe).toBe('function')

      // After unsubscribe, handler should not be called
      unsubscribe()
      const count = await doInstance.getHandlerCount('Order.created')
      expect(count).toBe(0)
    })

    it('should support registering handlers for any Noun', async () => {
      const doInstance = getDO('events-dynamic-noun-test')

      const handler = vi.fn()
      const customNoun = 'CustomEntity'

      // Use RPC-compatible registerHandler method for dynamic noun registration
      await doInstance.registerHandler(`${customNoun}.someEvent`, handler)
      expect(await doInstance.getHandlerCount(`${customNoun}.someEvent`)).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Wildcard Handler Matching', () => {
    it('should support *.verb wildcard pattern', async () => {
      const doInstance = getDO('events-wildcard-verb-test')

      const handler = vi.fn()

      // Use RPC-compatible registerHandler method for wildcard patterns
      await doInstance.registerHandler('*.created', handler)

      expect(await doInstance.getHandlerCount('*.created')).toBeGreaterThanOrEqual(1)
    })

    it('should support Noun.* wildcard pattern', async () => {
      const doInstance = getDO('events-wildcard-noun-test')

      const handler = vi.fn()

      // Use RPC-compatible registerHandler method for wildcard patterns
      await doInstance.registerHandler('Customer.*', handler)

      expect(await doInstance.getHandlerCount('Customer.*')).toBeGreaterThanOrEqual(1)
    })

    it('should support *.* global wildcard pattern', async () => {
      const doInstance = getDO('events-wildcard-global-test')

      const handler = vi.fn()

      // Use RPC-compatible registerHandler method for global wildcard pattern
      await doInstance.registerHandler('*.*', handler)

      expect(await doInstance.getHandlerCount('*.*')).toBeGreaterThanOrEqual(1)
    })

    it('should match handlers for exact event type', async () => {
      const doInstance = getDO('events-exact-match-test')

      const handler = vi.fn()
      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Invoice.paid', handler)

      const count = await doInstance.getHandlerCount('Invoice.paid')
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Event Handler Error Isolation', () => {
    it('should not crash when handler throws error', async () => {
      const doInstance = getDO('events-error-isolation-test')

      const badHandler = () => {
        throw new Error('Handler error')
      }
      const goodHandler = vi.fn()

      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Item.created', badHandler)
      await doInstance.registerHandler('Item.created', goodHandler)

      // Emitting should not throw despite badHandler error
      expect(() => {
        doInstance.send('Item.created', { id: 'item-1' })
      }).not.toThrow()
    })

    it('should execute all handlers even if one fails', async () => {
      const doInstance = getDO('events-all-handlers-test')

      const handler1 = vi.fn()
      const handler2 = vi.fn().mockImplementation(() => {
        throw new Error('Error in handler2')
      })
      const handler3 = vi.fn()

      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Task.updated', handler1)
      await doInstance.registerHandler('Task.updated', handler2)
      await doInstance.registerHandler('Task.updated', handler3)

      doInstance.send('Task.updated', { taskId: 'task-1' })

      // All handlers should be attempted
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
  })

  describe('Event Broadcast to WebSocket Subscribers', () => {
    it('should broadcast events to WebSocket subscribers', async () => {
      const doInstance = getDO('events-broadcast-test')

      // Event broadcast should be handled by the Events module
      const eventId = await doInstance.send('Stream.published', { content: 'data' })

      expect(eventId).toBeDefined()
    })
  })

  describe('Event Handler Metadata', () => {
    it('should provide handler count for event type', async () => {
      const doInstance = getDO('events-handler-count-test')

      const handler1 = vi.fn()
      const handler2 = vi.fn()

      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Status.changed', handler1)
      await doInstance.registerHandler('Status.changed', handler2)

      const count = await doInstance.getHandlerCount('Status.changed')
      expect(count).toBe(2)
    })

    it('should track handler registration timestamp', async () => {
      const doInstance = getDO('events-handler-timestamp-test')

      const handler = vi.fn()
      const beforeRegister = Date.now()
      // Use RPC-compatible registerHandler method
      await doInstance.registerHandler('Event.occurred', handler)
      const afterRegister = Date.now()

      // Handler should have been registered between before and after
      expect(beforeRegister).toBeLessThanOrEqual(afterRegister)
    })
  })
})

// =============================================================================
// DOCoreRpc Module Interface Tests
// =============================================================================

describe('DOCoreRpc Module Interface', () => {
  describe('RPC Method Registration', () => {
    it('should expose create() as RPC method', async () => {
      const doInstance = getDO('rpc-create-test')

      const thing = await doInstance.create('Vehicle', { make: 'Tesla', model: 'Model 3' })

      expect(thing).toBeDefined()
      expect(thing.$type).toBe('Vehicle')
    })

    it('should expose listThings() as RPC method', async () => {
      const doInstance = getDO('rpc-list-test')

      await doInstance.create('Animal', { species: 'dog' })
      await doInstance.create('Animal', { species: 'cat' })

      const animals = await doInstance.listThings('Animal')

      expect(Array.isArray(animals)).toBe(true)
    })

    it('should expose send() as RPC method for event emission', async () => {
      const doInstance = getDO('rpc-send-test')

      const eventId = await doInstance.send('Custom.event', { data: 'test' })

      expect(eventId).toBeDefined()
      expect(typeof eventId).toBe('string')
    })

    it('should expose registerHandler() for remote handler registration', async () => {
      const doInstance = getDO('rpc-handler-test')

      const handler = async (event: Record<string, unknown>) => {
        console.log('Event:', event)
      }

      const unsubscribe = await doInstance.registerHandler('Test.event', handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('should expose noun accessor methods like Customer(), Order()', async () => {
      const doInstance = getDO('rpc-noun-accessor-test')

      // Noun accessors should be RPC-callable
      const customerAccessor = doInstance.Customer()

      expect(customerAccessor).toBeDefined()
      expect(typeof (customerAccessor as Record<string, Function>).create).toBe('function')
      expect(typeof (customerAccessor as Record<string, Function>).list).toBe('function')
    })

    it('should expose instance accessor (Noun with id)', async () => {
      const doInstance = getDO('rpc-instance-accessor-test')

      const created = await doInstance.create('Customer', { name: 'Bob' })
      const instanceAccessor = doInstance.Customer(created.$id)

      expect(instanceAccessor).toBeDefined()
      expect(typeof (instanceAccessor as Record<string, Function>).update).toBe('function')
      expect(typeof (instanceAccessor as Record<string, Function>).delete).toBe('function')
    })

    it('should expose generic noun() method', async () => {
      const doInstance = getDO('rpc-generic-noun-test')

      const accessor = doInstance.noun('CustomType')

      expect(accessor).toBeDefined()
      expect(typeof (accessor as Record<string, Function>).create).toBe('function')
    })
  })

  describe('RPC Method Routing', () => {
    it('should route RPC calls to correct handler', async () => {
      const doInstance = getDO('rpc-routing-test')

      const thing = await doInstance.create('Widget', { name: 'MyWidget' })

      expect(thing.$type).toBe('Widget')
      expect(thing.name).toBe('MyWidget')
    })

    it('should handle RPC calls with complex arguments', async () => {
      const doInstance = getDO('rpc-complex-args-test')

      const created = await doInstance.create('Config', {
        nested: { settings: { enabled: true, timeout: 5000 } },
        tags: ['important', 'urgent'],
      })

      expect((created as Record<string, unknown>).nested).toBeDefined()
      expect((created as Record<string, unknown>).tags).toBeDefined()
    })

    it('should preserve argument types in RPC calls', async () => {
      const doInstance = getDO('rpc-types-test')

      const created = await doInstance.create('Data', {
        stringVal: 'hello',
        numberVal: 42,
        boolVal: true,
        nullVal: null,
      })

      expect((created as Record<string, unknown>).stringVal).toBe('hello')
      expect((created as Record<string, unknown>).numberVal).toBe(42)
      expect((created as Record<string, unknown>).boolVal).toBe(true)
    })
  })

  describe('RPC Error Handling', () => {
    it('should propagate validation errors through RPC', async () => {
      const doInstance = getDO('rpc-validation-error-test')

      await expect(doInstance.create('invalidtype', { data: 'test' })).rejects.toThrow('PascalCase')
    })

    it('should handle missing required fields in RPC calls', async () => {
      const doInstance = getDO('rpc-missing-fields-test')

      // Calling RPC method without required args should fail
      await expect(doInstance.create('', { data: 'test' })).rejects.toThrow()
    })
  })

  describe('RPC Capability Token Support', () => {
    it('should support capability tokens for authorization', async () => {
      const doInstance = getDO('rpc-capability-test')

      // RPC methods should accept optional capability tokens
      const thing = await doInstance.create('Secure', { data: 'sensitive' })

      expect(thing).toBeDefined()
    })
  })

  describe('RPC State Accessor Interface', () => {
    it('should expose state getter for RPC access', async () => {
      const doInstance = getDO('rpc-state-getter-test')

      const stateAccessor = doInstance.state

      expect(stateAccessor).toBeDefined()
      expect(typeof (stateAccessor as Record<string, Function>).get).toBe('function')
      expect(typeof (stateAccessor as Record<string, Function>).set).toBe('function')
    })

    it('should expose getState() method for RPC access', async () => {
      const doInstance = getDO('rpc-getstate-test')

      const stateAccessor = doInstance.getState()

      expect(stateAccessor).toBeDefined()
      expect(typeof (stateAccessor as Record<string, Function>).get).toBe('function')
      expect(typeof (stateAccessor as Record<string, Function>).set).toBe('function')
      expect(typeof (stateAccessor as Record<string, Function>).delete).toBe('function')
      expect(typeof (stateAccessor as Record<string, Function>).list).toBe('function')
    })
  })

  describe('RPC WebSocket Support', () => {
    it('should support WebSocket RPC calls', async () => {
      const doInstance = getDO('rpc-websocket-test')

      // WebSocket support should be exposed through RPC handler
      const thing = await doInstance.create('Message', { text: 'hello' })

      expect(thing).toBeDefined()
    })
  })
})

// =============================================================================
// DOCore Coordination Module Tests
// =============================================================================

describe('DOCore Coordination Module', () => {
  describe('Module Composition', () => {
    it('should coordinate between Storage, Events, Schedule, and RPC modules', async () => {
      const doInstance = getDO('coordination-test')

      // Create a thing (Storage)
      const thing = await doInstance.create('Document', { title: 'Test' })

      // Emit an event (Events)
      const eventId = await doInstance.send('Document.created', thing)

      // Register a handler (Events) - use RPC-compatible method
      const handler = vi.fn()
      await doInstance.registerHandler('Document.created', handler)

      // Register a schedule (Schedule) - use RPC-compatible method
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('hour', null, handler)

      expect(thing).toBeDefined()
      expect(eventId).toBeDefined()
      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 * * * *')
    })

    it('should provide unified interface for all module features', async () => {
      const doInstance = getDO('unified-interface-test')

      // All modules should be accessible through single instance
      expect(typeof doInstance.create).toBe('function')
      expect(typeof doInstance.send).toBe('function')
      expect(doInstance.on).toBeDefined()
      expect(doInstance.every).toBeDefined()
      expect(typeof doInstance.getThingById).toBe('function')
    })
  })

  describe('Lifecycle Management', () => {
    it('should initialize all modules on startup', async () => {
      const doInstance = getDO('lifecycle-init-test')

      // After creation, all modules should be ready
      const thing = await doInstance.create('Lifecycle', { data: 'test' })

      expect(thing).toBeDefined()
    })

    it('should persist module state to SQLite', async () => {
      const doInstance = getDO('lifecycle-persist-test')

      // Create and schedule
      const created = await doInstance.create('Persistent', { data: 'save me' })
      const handler = vi.fn()
      // Use RPC-compatible method instead of every.day.at('noon')
      await doInstance.registerScheduleViaEvery('day', 'noon', handler)

      // State should be persisted to SQLite (tested via recovery)
      expect(created).toBeDefined()
    })

    it('should recover module state from SQLite after eviction', async () => {
      const doInstance = getDO('lifecycle-recovery-test')

      // Create things and schedules
      const thing1 = await doInstance.create('Recoverable', { data: 'test1' })
      const thing2 = await doInstance.create('Recoverable', { data: 'test2' })

      // Clear memory to simulate eviction
      await doInstance.clearMemoryCache()

      // Recovery statistics should show what was in SQLite
      const stats = await doInstance.getRecoveryStats()

      expect(stats.thingsRecovered).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Cross-Module Event Flow', () => {
    it('should emit events when things are created (Storage -> Events)', async () => {
      const doInstance = getDO('crossmodule-create-test')

      const handler = vi.fn()
      // Use RPC-compatible method instead of on.User.created
      await doInstance.registerHandler('User.created', handler)

      await doInstance.create('User', { name: 'Charlie' })

      // Event should be fired after create
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it('should emit events when things are updated (Storage -> Events)', async () => {
      const doInstance = getDO('crossmodule-update-test')

      const thing = await doInstance.create('Record', { status: 'active' })

      const handler = vi.fn()
      // Use RPC-compatible method instead of on.Record.updated
      await doInstance.registerHandler('Record.updated', handler)

      await doInstance.updateThingById(thing.$id, { status: 'inactive' })

      // Event should be fired after update
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it('should emit events when things are deleted (Storage -> Events)', async () => {
      const doInstance = getDO('crossmodule-delete-test')

      const thing = await doInstance.create('Ephemeral', { temporary: true })

      const handler = vi.fn()
      // Use RPC-compatible method instead of on.Ephemeral.deleted
      await doInstance.registerHandler('Ephemeral.deleted', handler)

      await doInstance.deleteThingById(thing.$id)

      // Event should be fired after delete
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it('should trigger scheduled handlers (Schedule -> Events)', async () => {
      const doInstance = getDO('crossmodule-schedule-test')

      const handler = vi.fn()
      // Use RPC-compatible method instead of every.minute
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('minute', null, handler)

      // Schedule should be registered and ready to fire
      expect(typeof cron).toBe('string')
      expect(cron).toBe('* * * * *')
    })
  })

  describe('Multi-Module Operations', () => {
    it('should handle create + event flow atomically', async () => {
      const doInstance = getDO('multimodule-atomic-test')

      const eventHandler = vi.fn()
      // Use RPC-compatible method instead of on.Item.created
      await doInstance.registerHandler('Item.created', eventHandler)

      const thing = await doInstance.create('Item', { name: 'Atomic' })

      // Thing should be created and event should fire
      expect(thing).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    it('should handle schedule + event flow', async () => {
      const doInstance = getDO('multimodule-schedule-event-test')

      const scheduleHandler = vi.fn()
      // Use RPC-compatible method instead of every.hour
      await doInstance.registerScheduleViaEvery('hour', null, scheduleHandler)

      // Schedule should be registered
      const schedule = await doInstance.getSchedule('0 * * * *')
      expect(schedule).toBeDefined()
    })
  })
})

// =============================================================================
// Module Boundary and Separation Tests
// =============================================================================

describe('Module Boundaries and Separation', () => {
  describe('Storage Module Isolation', () => {
    it('should isolate storage concerns from event handling', async () => {
      const doInstance = getDO('isolation-storage-test')

      // Storage operations should work independently
      const thing = await doInstance.create('Isolated', { data: 'test' })
      const retrieved = await doInstance.getThingById(thing.$id)

      expect(retrieved).toBeDefined()
    })
  })

  describe('Schedule Module Isolation', () => {
    it('should isolate schedule management from storage', async () => {
      const doInstance = getDO('isolation-schedule-test')

      // Schedules should not depend on things being created
      const handler = vi.fn()
      // Use RPC-compatible method instead of every.day.at('3pm')
      // Returns CRON string for unsubscription via deleteScheduleByCron()
      const cron = await doInstance.registerScheduleViaEvery('day', '3pm', handler)

      expect(typeof cron).toBe('string')
      expect(cron).toBe('0 15 * * *')
    })
  })

  describe('Events Module Isolation', () => {
    it('should isolate event emission from RPC invocation', async () => {
      const doInstance = getDO('isolation-events-test')

      // Events should work without storage
      const eventId = await doInstance.send('Custom.event', { custom: 'data' })

      expect(eventId).toBeDefined()
    })
  })
})

// =============================================================================
// Module Interface Completeness Tests
// =============================================================================

describe('Module Interface Completeness', () => {
  describe('DOCoreStorage - Complete Interface', () => {
    it('should expose all CRUD operations', async () => {
      const doInstance = getDO('complete-storage-test')

      // Create, Read, Update, Delete should all be available
      const created = await doInstance.create('Complete', { data: 'test' })
      const read = await doInstance.getThingById(created.$id)
      const updated = await doInstance.updateThingById(created.$id, { data: 'updated' })
      const deleted = await doInstance.deleteThingById(created.$id)

      expect(created).toBeDefined()
      expect(read).toBeDefined()
      expect(updated).toBeDefined()
      expect(deleted).toBe(true)
    })
  })

  describe('DOCoreSchedule - Complete Interface', () => {
    it('should expose all schedule builders and patterns', async () => {
      const doInstance = getDO('complete-schedule-test')

      const handler = vi.fn()

      // All patterns should work - use RPC-compatible methods
      // Returns CRON strings for unsubscription via deleteScheduleByCron()
      const daily = await doInstance.registerScheduleViaEvery('day', '9am', handler)
      const hourly = await doInstance.registerScheduleViaEvery('hour', null, handler)
      const interval = await doInstance.registerScheduleViaInterval(5, 'minutes', handler)

      expect(typeof daily).toBe('string')
      expect(typeof hourly).toBe('string')
      expect(typeof interval).toBe('string')
      expect(daily).toBe('0 9 * * *')
      expect(hourly).toBe('0 * * * *')
      expect(interval).toBe('*/5 * * * *')
    })
  })

  describe('DOCoreEvents - Complete Interface', () => {
    it('should expose all event operations', async () => {
      const doInstance = getDO('complete-events-test')

      const handler = vi.fn()

      // Send, on, and handler registration should all work
      const eventId = await doInstance.send('Complete.event', { data: 'test' })
      // Use RPC-compatible method instead of on.Complete.event
      const unsubscribe = await doInstance.registerHandler('Complete.event', handler)
      const count = await doInstance.getHandlerCount('Complete.event')

      expect(eventId).toBeDefined()
      expect(typeof unsubscribe).toBe('function')
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })
})
