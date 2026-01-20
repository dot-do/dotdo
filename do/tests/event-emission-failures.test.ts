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
 * Current behavior (these tests should FAIL to demonstrate the bug):
 * - Handler errors are logged but NOT tracked in DLQ
 * - Async handler rejections are completely swallowed (no logging at all)
 * - Caller has no programmatic way to know if event handlers failed
 * - No retry mechanism for failed handlers in entity operations
 *
 * Expected behavior (after fix):
 * - Failed handlers should be tracked in the dead letter queue (DLQ)
 * - Async rejections should be caught and logged
 * - EntityManager should provide observability into handler failures
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
    it('should track failed handlers in DLQ for programmatic observability', async () => {
      const entityManager = new EntityManager()

      // Register a handler that throws
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.created') {
          throw new Error('Handler exploded!')
        }
      })

      // Create a thing - the event emission should fail due to handler error
      const thing = await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      // The thing was created successfully (this is expected - the entity op shouldn't fail)
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')

      // BUG: Handler failures are NOT tracked in DLQ
      // Currently the error is only logged via console.error but there's no
      // programmatic way to detect that a handler failed.
      //
      // After the fix, failed handlers should be added to DLQ
      const dlq = entityManager.events.getDeadLetterQueue()
      expect(dlq.length).toBeGreaterThan(0)
      expect(dlq[0].lastError).toContain('Handler exploded!')
    })

    it('should track multiple handler failures in events store', async () => {
      const entityManager = new EntityManager()

      // Register a handler that throws
      entityManager.events.subscribe(() => {
        throw new Error('First handler failed')
      })

      // Create a thing
      await entityManager.things.create({
        $type: 'Order',
        total: 99.99
      })

      // BUG: There's no way to query failed handlers programmatically
      // The DLQ is empty because EntityManager doesn't use WorkflowContext's
      // event processing logic that tracks failures.
      const dlq = entityManager.events.getDeadLetterQueue()
      expect(dlq.length).toBeGreaterThan(0)
      expect(dlq[0].lastError).toContain('First handler failed')
    })
  })

  describe('things.update() event emission', () => {
    it('should track handler failures in DLQ on update', async () => {
      const entityManager = new EntityManager()

      // Create a thing first
      const thing = await entityManager.things.create({
        $type: 'Product',
        name: 'Widget',
        price: 10
      })

      // Clear any DLQ entries from create
      // (none expected, but be explicit)

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

      // BUG: The failure is NOT tracked in DLQ
      // After fix, we should be able to query the failure programmatically
      const dlq = entityManager.events.getDeadLetterQueue()
      const updateFailures = dlq.filter(entry => entry.event.type === 'Thing.updated')
      expect(updateFailures.length).toBeGreaterThan(0)
      expect(updateFailures[0].lastError).toContain('Update handler crashed!')
    })
  })

  describe('things.delete() event emission', () => {
    it('should track handler failures in DLQ on delete', async () => {
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

      // BUG: Handler failure is NOT tracked in DLQ
      const dlq = entityManager.events.getDeadLetterQueue()
      const deleteFailures = dlq.filter(entry => entry.event.type === 'Thing.deleted')
      expect(deleteFailures.length).toBeGreaterThan(0)
      expect(deleteFailures[0].lastError).toContain('Delete handler failed!')
    })
  })

  describe('relationships event emission', () => {
    it('should track handler failures in DLQ on relationship add', async () => {
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

      // BUG: Handler failure is NOT tracked in DLQ
      const dlq = entityManager.events.getDeadLetterQueue()
      const relFailures = dlq.filter(entry => entry.event.type === 'Relationship.added')
      expect(relFailures.length).toBeGreaterThan(0)
      expect(relFailures[0].lastError).toContain('Relationship handler exploded!')
    })
  })

  describe('bulk operations event emission', () => {
    it('should track all handler failures in DLQ during bulk create', async () => {
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

      // BUG: None of the 3 handler failures are tracked in DLQ
      const dlq = entityManager.events.getDeadLetterQueue()
      expect(dlq.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('async handler failures', () => {
    it('should catch and track async handler rejections', async () => {
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

      // BUG: Async rejection is completely swallowed - not even logged
      // The EventsStore.emit() calls handlers synchronously in a try-catch,
      // but if the handler returns a Promise that later rejects, it's lost.
      // After fix, async rejections should be caught and tracked.
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorLogs = consoleErrorSpy.mock.calls.map(call => call.join(' ')).join('\n')
      expect(errorLogs).toContain('Async rejection!')
    })
  })

  describe('observability requirements', () => {
    it('should provide a way to query all failed handlers since a timestamp', async () => {
      const entityManager = new EntityManager()
      const startTime = Date.now()

      // Register a handler that always fails
      entityManager.events.subscribe(() => {
        throw new Error('Always fails')
      })

      // Perform multiple operations
      await entityManager.things.create({ $type: 'A', name: 'a' })
      await entityManager.things.create({ $type: 'B', name: 'b' })

      // BUG: queryDeadLetterQueue returns empty because failures aren't tracked
      const failures = entityManager.events.queryDeadLetterQueue({ since: startTime })
      expect(failures.length).toBeGreaterThanOrEqual(2)
    })

    it('should allow inspection of handler failure details', async () => {
      const entityManager = new EntityManager()

      // Register a handler that fails with context
      entityManager.events.subscribe((event) => {
        if (event.type === 'Thing.created') {
          const error = new Error('Validation failed')
          ;(error as any).code = 'VALIDATION_ERROR'
          ;(error as any).field = 'email'
          throw error
        }
      })

      await entityManager.things.create({ $type: 'User', email: 'invalid' })

      // BUG: No DLQ entries exist, so we can't inspect failure details
      const dlq = entityManager.events.getDeadLetterQueue()
      expect(dlq.length).toBeGreaterThan(0)

      // After fix, we should be able to see error details
      const failure = dlq[0]
      expect(failure.lastError).toContain('Validation failed')
      expect(failure.attempts).toBeGreaterThanOrEqual(1)
    })
  })
})
