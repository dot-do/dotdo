/**
 * Transaction Isolation Tests for Event Handlers
 *
 * These tests verify that event handlers execute sequentially (FIFO),
 * preventing interleaving and race conditions on shared state.
 *
 * The fix (do-glz3x): invokeHandlers() now uses a sequential for-loop
 * instead of Promise.all, guaranteeing handlers execute in registration
 * order without interleaving. EventSystem.emit() also queues events
 * so that events emitted during handler execution are processed after
 * the current event completes.
 *
 * All tests in this file should PASS with the sequential execution fix.
 *
 * @module do/tests/transaction-isolation.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventSystem, type EventPayload } from '../workflow/event-system'

describe('Transaction Isolation Between Event Handlers', () => {
  let eventSystem: EventSystem
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    eventSystem = new EventSystem()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  /**
   * Helper to simulate async work (creates opportunity for interleaving)
   */
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  describe('Sequential Handler Execution (PASSING - FIFO ordering via do-glz3x)', () => {
    it('should NOT allow lost updates when handlers perform read-modify-write', async () => {
      /**
       * This test demonstrates the classic "lost update" problem:
       *
       * Without isolation, two handlers can:
       * 1. Handler A reads counter (value: 0)
       * 2. Handler B reads counter (value: 0)
       * 3. Handler A writes counter + 1 (value: 1)
       * 4. Handler B writes counter + 1 (value: 1) <- LOST UPDATE!
       *
       * Expected: counter = 2 (each handler increments once)
       * Actual without isolation: counter = 1 (one update lost)
       *
       * This test PASSES with sequential FIFO handler execution (do-glz3x).
       */
      const sharedState = { counter: 0 }

      // Register multiple handlers for the same event
      eventSystem.on.Counter.increment(async (event) => {
        // Read
        const current = sharedState.counter

        // Simulate async work (creates interleaving opportunity)
        await delay(Math.random() * 10)

        // Modify-Write
        sharedState.counter = current + 1
      })

      eventSystem.on.Counter.increment(async (event) => {
        // Read
        const current = sharedState.counter

        // Simulate async work (creates interleaving opportunity)
        await delay(Math.random() * 10)

        // Modify-Write
        sharedState.counter = current + 1
      })

      // Emit the event - both handlers will run concurrently
      await eventSystem.emit({ type: 'Counter.increment' })

      // With proper isolation, counter should be 2 (both increments applied)
      // Without isolation, counter may be 1 (lost update)
      expect(sharedState.counter).toBe(2)
    })

    it('should NOT allow intermediate state visibility between handlers', async () => {
      /**
       * This test demonstrates that handlers can see uncommitted intermediate state
       * from other handlers that are executing concurrently.
       *
       * Scenario: A transfer operation that should be atomic
       * Handler A: Debits account (sets balance to -100)
       * Handler B: Reads balance during Handler A's operation
       *
       * With isolation: Handler B should never see the intermediate -100 state
       * Without isolation: Handler B CAN see the intermediate state
       *
       * This test PASSES with sequential FIFO handler execution (do-glz3x).
       */
      const accounts = {
        checking: 100,
        savings: 200,
      }

      const observedBalances: number[] = []

      // Handler A: Transfer operation (debit then credit)
      eventSystem.on.Transfer.execute(async (event) => {
        // Step 1: Debit checking (intermediate state: -100)
        accounts.checking = -100
        await delay(15) // Give time for interleaving
        // Step 2: Credit savings (final state: checking=0, savings=300)
        accounts.checking = 0
        accounts.savings = 300
      })

      // Handler B: Observer that reads state during the operation
      eventSystem.on.Transfer.execute(async (event) => {
        await delay(5) // Read during Handler A's intermediate state
        observedBalances.push(accounts.checking)
      })

      await eventSystem.emit({ type: 'Transfer.execute' })

      // With isolation, Handler B should only see consistent states:
      // Either the initial state (100) or the final state (0)
      // It should NEVER see the intermediate state (-100)
      expect(observedBalances[0]).toBeGreaterThanOrEqual(0)
    })

    it('should NOT allow dirty reads from concurrent handler modifications', async () => {
      /**
       * This test shows that handlers can read "dirty" uncommitted data
       * from other handlers.
       *
       * Handler A: Writes partial data (incomplete record)
       * Handler B: Reads the partial/incomplete data
       *
       * With isolation: Handler B should see complete records only
       * Without isolation: Handler B may see incomplete data
       *
       * This test PASSES with sequential FIFO handler execution (do-glz3x).
       */
      const records: Record<string, { name?: string; email?: string; complete?: boolean }> = {}

      // Handler A: Creates a record in multiple steps
      eventSystem.on.Record.create(async (event) => {
        const id = 'rec-1'
        records[id] = {} // Incomplete record
        records[id].name = 'Alice'
        await delay(10)
        records[id].email = 'alice@example.com'
        await delay(5)
        records[id].complete = true
      })

      // Handler B: Reads record during creation
      eventSystem.on.Record.create(async (event) => {
        const id = 'rec-1'
        await delay(5) // Read during Handler A's write
        const record = records[id]

        // Check if we see incomplete state
        if (record && !record.complete && record.name) {
          // We observed an incomplete record - dirty read!
          throw new Error('Dirty read detected: saw incomplete record')
        }
      })

      // With isolation, no dirty read should occur
      // Without isolation, Handler B may see incomplete record and throw
      const result = await eventSystem.emit({ type: 'Record.create' })

      // Expect no failures (no dirty reads)
      expect(result.failed.length).toBe(0)
    })

    it('should maintain consistency under high concurrency', async () => {
      /**
       * Stress test: Multiple handlers all incrementing a shared counter.
       *
       * With 10 handlers each incrementing once, final count should be 10.
       * Without isolation, lost updates will cause count < 10.
       *
       * This test PASSES with sequential FIFO handler execution (do-glz3x).
       */
      const sharedState = { counter: 0 }
      const HANDLER_COUNT = 10

      // Register multiple handlers
      for (let i = 0; i < HANDLER_COUNT; i++) {
        eventSystem.on.Stress.test(async (event) => {
          const current = sharedState.counter
          await delay(Math.random() * 5) // Vary timing to maximize interleaving
          sharedState.counter = current + 1
        })
      }

      await eventSystem.emit({ type: 'Stress.test' })

      // With isolation: counter should equal HANDLER_COUNT
      // Without isolation: counter will likely be less due to lost updates
      expect(sharedState.counter).toBe(HANDLER_COUNT)
    })

    it('should serialize handlers operating on the same aggregate', async () => {
      /**
       * In DDD terms, handlers operating on the same aggregate should be serialized
       * to maintain aggregate invariants.
       *
       * Scenario: Order aggregate with items
       * - Handler A: Adds item (total should increase)
       * - Handler B: Adds item (total should increase)
       *
       * Invariant: order.total should equal sum of item prices
       *
       * Without isolation, concurrent handlers can violate this invariant.
       *
       * This test PASSES with sequential FIFO handler execution (do-glz3x).
       */
      const order = {
        items: [] as { price: number }[],
        total: 0,
      }

      // Handler that adds an item
      const addItemHandler = async (event: EventPayload) => {
        const price = (event.data as { price: number }).price

        // Read current total
        const currentTotal = order.total
        const currentItemCount = order.items.length

        // Simulate processing delay
        await delay(Math.random() * 10)

        // Add item
        order.items.push({ price })

        // Update total based on read value (should be atomic with item addition)
        order.total = currentTotal + price
      }

      eventSystem.on.Order.addItem(addItemHandler)
      eventSystem.on.Order.addItem(addItemHandler) // Second handler for same event

      await eventSystem.emit({
        type: 'Order.addItem',
        data: { price: 50 },
      })

      // Calculate expected total from items
      const expectedTotal = order.items.reduce((sum, item) => sum + item.price, 0)

      // Invariant check: total should match sum of items
      // Without isolation, total may not match due to lost updates
      expect(order.total).toBe(expectedTotal)
    })
  })

  describe('Sequential Execution Verification', () => {
    it('should record execution order to prove sequential FIFO execution', async () => {
      /**
       * This test records the execution order to verify that handlers
       * execute sequentially in FIFO order (do-glz3x fix).
       *
       * Expected sequence with FIFO ordering (serialized):
       * A-start, A-end, B-start, B-end
       */
      const executionLog: string[] = []

      eventSystem.on.Sequence.test(async (event) => {
        executionLog.push('A-start')
        await delay(10)
        executionLog.push('A-end')
      })

      eventSystem.on.Sequence.test(async (event) => {
        executionLog.push('B-start')
        await delay(5)
        executionLog.push('B-end')
      })

      await eventSystem.emit({ type: 'Sequence.test' })

      // Check for serialized execution pattern
      // With isolation, we should see: [A-start, A-end, B-start, B-end] or [B-start, B-end, A-start, A-end]
      // Without isolation, we'll see interleaving like: [A-start, B-start, B-end, A-end]

      const isSerializedA = executionLog[0] === 'A-start' && executionLog[1] === 'A-end'
      const isSerializedB = executionLog[0] === 'B-start' && executionLog[1] === 'B-end'
      const isSerialized = isSerializedA || isSerializedB

      // This assertion PASSES with sequential FIFO handler execution (do-glz3x)
      expect(isSerialized).toBe(true)
    })
  })
})
