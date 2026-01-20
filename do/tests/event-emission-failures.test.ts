/**
 * Event Emission Failures Test
 *
 * This test demonstrates that event emission in entity operations can fail silently.
 * When a handler registered via EventsStore throws an error during an entity operation
 * (create, update, delete), the error is swallowed and the operation completes
 * successfully without any indication of the handler failure.
 *
 * Issue: do-6dc7.4 / do-poim
 *
 * Expected behavior (after fix):
 * - Entity operations should either propagate handler errors OR
 * - Log/report failures in a way that's observable
 *
 * Current behavior (this test should FAIL):
 * - Handler errors are swallowed silently
 * - No error is thrown, logged, or reported
 * - Caller has no way to know the event handler failed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EntityManager } from '../entities'

describe('Event Emission Failures in Entity Operations', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  describe('things.create() event emission', () => {
    it('should indicate failure when Thing.created handler throws', async () => {
      const entityManager = new EntityManager()
      const handlerError = new Error('Handler exploded!')

      // Register a handler that throws
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.created') {
          throw handlerError
        }
      })

      // Create a thing - the event emission should fail due to handler error
      const thing = await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      // The thing was created successfully (this is expected)
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')

      // BUG: The handler failure is silent - this test should FAIL
      // because currently there's no way to observe that the handler threw.
      //
      // After the fix, one of these assertions should pass:
      // Option 1: Error is logged
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Handler exploded!')
    })

    it('should track failed handlers in events store for observability', async () => {
      const entityManager = new EntityManager()

      // Register a handler that throws
      entityManager.events.subscribe(() => {
        throw new Error('Async handler failed')
      })

      // Create a thing
      await entityManager.things.create({
        $type: 'Order',
        total: 99.99
      })

      // BUG: There's no way to query failed handlers
      // After the fix, we should be able to observe the failure somehow.
      //
      // Option 1: Failed events are tracked in the events store
      const dlq = entityManager.events.getDeadLetterQueue()
      expect(dlq.length).toBeGreaterThan(0)
      expect(dlq[0].lastError).toContain('Async handler failed')
    })
  })

  describe('things.update() event emission', () => {
    it('should not silently swallow handler errors on update', async () => {
      const entityManager = new EntityManager()

      // Create a thing first
      const thing = await entityManager.things.create({
        $type: 'Product',
        name: 'Widget',
        price: 10
      })

      // Register a handler that throws on updates
      let handlerCalled = false
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.updated') {
          handlerCalled = true
          throw new Error('Update handler crashed!')
        }
      })

      // Update the thing
      await entityManager.things.update(thing.$id, { price: 15 })

      // Handler was called (verifies the test setup is correct)
      expect(handlerCalled).toBe(true)

      // BUG: The failure is silent - no logging, no tracking
      // After fix, we should be able to observe the failure
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Update handler crashed!')
    })
  })

  describe('things.delete() event emission', () => {
    it('should report handler failures on delete operations', async () => {
      const entityManager = new EntityManager()

      // Create a thing first
      const thing = await entityManager.things.create({
        $type: 'Session',
        userId: 'user-123'
      })

      // Register a handler that throws on deletion
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.deleted') {
          throw new Error('Delete handler failed!')
        }
      })

      // Delete the thing
      await entityManager.things.delete(thing.$id)

      // Verify deletion happened (the entity operation succeeded)
      const deleted = await entityManager.things.get(thing.$id)
      expect(deleted).toBeNull()

      // BUG: Handler failure is silent
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Delete handler failed!')
    })
  })

  describe('relationships event emission', () => {
    it('should not silently swallow handler errors on relationship add', async () => {
      const entityManager = new EntityManager()

      // Create things for the relationship
      const customer = await entityManager.things.create({ $type: 'Customer', name: 'Bob' })
      const order = await entityManager.things.create({ $type: 'Order', total: 50 })

      // Register a handler that throws
      entityManager.events.subscribe((event) => {
        if (event.type === 'Relationship.added') {
          throw new Error('Relationship handler exploded!')
        }
      })

      // Add a relationship
      await entityManager.relationships.add({
        subject: customer.$id,
        predicate: 'placed',
        object: order.$id
      })

      // BUG: Handler failure is silent
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Relationship handler exploded!')
    })
  })

  describe('bulk operations event emission', () => {
    it('should report handler failures during bulk create', async () => {
      const entityManager = new EntityManager()
      let failureCount = 0

      // Register a handler that throws on every Thing.created
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.created') {
          failureCount++
          throw new Error(`Bulk handler failed for item ${failureCount}`)
        }
      })

      // Bulk create multiple things
      const items = [
        { $type: 'Item', name: 'Item 1' },
        { $type: 'Item', name: 'Item 2' },
        { $type: 'Item', name: 'Item 3' }
      ]

      await entityManager.things.bulkCreate(items)

      // Handlers were called for each item
      expect(failureCount).toBe(3)

      // BUG: All 3 handler failures are silent
      // After fix, we should see errors for all 3 failures
      expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('async handler failures', () => {
    it('should handle async handler rejection', async () => {
      const entityManager = new EntityManager()

      // Register an async handler that rejects
      entityManager.events.subscribe(async (event) => {
        if (event.type === 'Thing.created') {
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Async rejection!')), 10)
          )
        }
      })

      // Create a thing
      await entityManager.things.create({
        $type: 'Task',
        title: 'Test async handlers'
      })

      // Wait for async handler to complete
      await new Promise(r => setTimeout(r, 50))

      // BUG: Async rejection is swallowed
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Async rejection!')
    })
  })
})
