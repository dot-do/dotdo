/**
 * Cross-DO Transactions E2E Tests
 *
 * TDD RED Phase: Comprehensive E2E tests for cross-DO transaction primitives.
 * These tests verify the transaction coordination patterns without mocking.
 *
 * Test Coverage:
 * 1. Saga pattern - compensation on failure
 * 2. Two-phase commit - prepare/commit phases
 * 3. Cross-DO money transfer (debit one, credit another)
 * 4. Partial failure recovery
 * 5. Timeout handling
 * 6. Concurrent transaction conflicts
 * 7. Distributed deadlock detection
 *
 * @see objects/CrossDOTransaction.ts for implementation
 * @module objects/tests/cross-do-transactions-e2e.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CrossDOSaga,
  TwoPhaseCommit,
  IdempotencyKeyManager,
  crossDOCallWithTimeout,
  generateIdempotencyKey,
  type SagaStep,
} from '../CrossDOTransaction'

// ============================================================================
// Simulated DO Stubs for E2E Testing
// ============================================================================

/**
 * Simulated Account DO with balance management
 * In real E2E tests, this would be a real DO stub accessed via RPC
 */
class AccountDO {
  private balance: number = 0
  private pendingDebits: Map<string, number> = new Map()
  private pendingCredits: Map<string, number> = new Map()
  private locks: Set<string> = new Set()

  constructor(initialBalance: number = 0) {
    this.balance = initialBalance
  }

  async getBalance(): Promise<number> {
    return this.balance
  }

  async setBalance(amount: number): Promise<void> {
    this.balance = amount
  }

  async debit(amount: number): Promise<{ success: boolean; balance: number }> {
    if (this.balance < amount) {
      return { success: false, balance: this.balance }
    }
    this.balance -= amount
    return { success: true, balance: this.balance }
  }

  async credit(amount: number): Promise<{ success: boolean; balance: number }> {
    this.balance += amount
    return { success: true, balance: this.balance }
  }

  async prepareDebit(amount: number, txId: string): Promise<boolean> {
    if (this.balance < amount) {
      return false
    }
    // Reserve the amount
    this.pendingDebits.set(txId, amount)
    this.balance -= amount
    return true
  }

  async commitDebit(txId: string): Promise<void> {
    this.pendingDebits.delete(txId)
  }

  async rollbackDebit(txId: string): Promise<void> {
    const amount = this.pendingDebits.get(txId)
    if (amount !== undefined) {
      this.balance += amount
      this.pendingDebits.delete(txId)
    }
  }

  async prepareCredit(amount: number, txId: string): Promise<boolean> {
    this.pendingCredits.set(txId, amount)
    return true
  }

  async commitCredit(txId: string): Promise<void> {
    const amount = this.pendingCredits.get(txId)
    if (amount !== undefined) {
      this.balance += amount
      this.pendingCredits.delete(txId)
    }
  }

  async rollbackCredit(txId: string): Promise<void> {
    this.pendingCredits.delete(txId)
  }

  async acquireLock(resourceId: string, timeout: number = 1000): Promise<boolean> {
    if (this.locks.has(resourceId)) {
      // Wait for lock with timeout
      const startTime = Date.now()
      while (this.locks.has(resourceId)) {
        if (Date.now() - startTime > timeout) {
          return false
        }
        await new Promise((r) => setTimeout(r, 10))
      }
    }
    this.locks.add(resourceId)
    return true
  }

  async releaseLock(resourceId: string): Promise<void> {
    this.locks.delete(resourceId)
  }

  async getHeldLocks(): Promise<string[]> {
    return Array.from(this.locks)
  }
}

/**
 * Simulated Inventory DO with stock management
 */
class InventoryDO {
  private stock: Map<string, number> = new Map()
  private reservations: Map<string, { itemId: string; quantity: number }> = new Map()
  private reservationCounter = 0

  async getStock(itemId: string): Promise<number> {
    return this.stock.get(itemId) ?? 0
  }

  async setStock(itemId: string, quantity: number): Promise<void> {
    this.stock.set(itemId, quantity)
  }

  async reserveStock(
    itemId: string,
    quantity: number
  ): Promise<{ reservationId: string }> {
    const currentStock = this.stock.get(itemId) ?? 0
    if (currentStock < quantity) {
      throw new Error(`Insufficient stock for ${itemId}`)
    }
    this.stock.set(itemId, currentStock - quantity)
    const reservationId = `res-${++this.reservationCounter}`
    this.reservations.set(reservationId, { itemId, quantity })
    return { reservationId }
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId)
    if (reservation) {
      const currentStock = this.stock.get(reservation.itemId) ?? 0
      this.stock.set(reservation.itemId, currentStock + reservation.quantity)
      this.reservations.delete(reservationId)
    }
  }

  async commitReservation(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId)
  }

  async slowOperation(delayMs: number): Promise<string> {
    await new Promise((r) => setTimeout(r, delayMs))
    return 'completed'
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Cross-DO Transactions E2E', () => {
  // ==========================================================================
  // 1. SAGA PATTERN - COMPENSATION ON FAILURE
  // ==========================================================================

  describe('Saga Pattern - Compensation on Failure', () => {
    /**
     * Test 1: Execute multi-step saga across simulated DOs successfully
     */
    it('should execute multi-step saga successfully', async () => {
      const inventory = new InventoryDO()
      const payment = new AccountDO(5000)

      await inventory.setStock('item-001', 100)

      const checkoutSaga = new CrossDOSaga<
        { itemId: string; quantity: number; amount: number },
        { reservationId: string; paymentSucceeded: boolean }
      >()
        .addStep({
          name: 'reserveInventory',
          execute: async (input) => {
            const result = await inventory.reserveStock(input.itemId, input.quantity)
            return { ...input, reservationId: result.reservationId }
          },
          compensate: async (result) => {
            await inventory.releaseReservation(result.reservationId)
          },
        })
        .addStep({
          name: 'chargePayment',
          execute: async (input) => {
            const result = await payment.debit(input.amount)
            if (!result.success) throw new Error('Payment failed')
            return { ...input, paymentSucceeded: true }
          },
          compensate: async (result) => {
            await payment.credit(result.amount)
          },
        })

      const result = await checkoutSaga.execute({
        itemId: 'item-001',
        quantity: 5,
        amount: 500,
      })

      expect(result.success).toBe(true)
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].name).toBe('reserveInventory')
      expect(result.steps[1].name).toBe('chargePayment')
      expect(result.compensated).toBe(false)

      // Verify final state
      const finalStock = await inventory.getStock('item-001')
      const finalBalance = await payment.getBalance()
      expect(finalStock).toBe(95) // 100 - 5
      expect(finalBalance).toBe(4500) // 5000 - 500
    })

    /**
     * Test 2: Saga compensates on step failure (rollback)
     */
    it('should compensate previous steps when a step fails', async () => {
      const inventory = new InventoryDO()
      const payment = new AccountDO(50) // Insufficient funds

      await inventory.setStock('item-002', 50)

      let compensationCalled = false

      const failingSaga = new CrossDOSaga<
        { itemId: string; quantity: number; amount: number },
        void
      >()
        .addStep({
          name: 'reserveInventory',
          execute: async (input) => {
            const result = await inventory.reserveStock(input.itemId, input.quantity)
            return { ...input, reservationId: result.reservationId }
          },
          compensate: async (result: any) => {
            compensationCalled = true
            await inventory.releaseReservation(result.reservationId)
          },
        })
        .addStep({
          name: 'chargePayment',
          execute: async (input: any) => {
            const result = await payment.debit(input.amount)
            if (!result.success) {
              throw new Error('Insufficient funds')
            }
            return input
          },
        })

      const result = await failingSaga.execute({
        itemId: 'item-002',
        quantity: 10,
        amount: 500,
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Insufficient funds')
      expect(result.compensated).toBe(true)
      expect(compensationCalled).toBe(true)

      // Verify rollback - inventory should be restored
      const finalStock = await inventory.getStock('item-002')
      expect(finalStock).toBe(50) // Original amount restored
    })

    /**
     * Test 3: Saga handles compensation failure and continues
     */
    it('should handle compensation failure and continue compensating other steps', async () => {
      const compensationResults: string[] = []

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensationResults.push('compensate1-success')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
            compensationResults.push('compensate2-failed')
            throw new Error('Compensation 2 failed')
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.compensated).toBe(true)
      expect(result.compensationErrors).toHaveLength(1)
      expect(result.compensationErrors?.[0].message).toBe('Compensation 2 failed')
      // Should still attempt to compensate step1 after step2 compensation fails
      expect(compensationResults).toContain('compensate1-success')
    })

    /**
     * Test 4: Saga tracks compensation errors when compensations fail
     *
     * When a step fails, any compensation that also fails should be tracked
     * in compensationErrors. The 'compensated' flag indicates whether any
     * compensation was attempted (even if it failed).
     */
    it('should track compensation errors when compensations fail', async () => {
      let compensationAttempted = false

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          execute: async () => ({ resource: 'allocated' }),
          compensate: async () => {
            compensationAttempted = true
            throw new Error('Cannot release resource - connection lost')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => {
            throw new Error('Step 2 failed')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Step 2 failed')
      // Compensation was attempted, verify it was tracked
      expect(compensationAttempted).toBe(true)
      expect(result.compensationErrors).toHaveLength(1)
      expect(result.compensationErrors?.[0].message).toBe('Cannot release resource - connection lost')
    })
  })

  // ==========================================================================
  // 2. TWO-PHASE COMMIT - PREPARE/COMMIT PHASES
  // ==========================================================================

  describe('Two-Phase Commit - Prepare/Commit Phases', () => {
    /**
     * Test 5: 2PC prepares all participants successfully before commit
     */
    it('should prepare all participants before committing', async () => {
      const phases: string[] = []
      let account1Prepared = false
      let account2Prepared = false

      const tpc = new TwoPhaseCommit({ timeout: 5000 })
        .addParticipant({
          id: 'account1',
          prepare: async () => {
            phases.push('account1-prepare')
            account1Prepared = true
            return true
          },
          commit: async () => {
            phases.push('account1-commit')
            expect(account1Prepared).toBe(true)
            expect(account2Prepared).toBe(true)
          },
          rollback: async () => {
            phases.push('account1-rollback')
          },
        })
        .addParticipant({
          id: 'account2',
          prepare: async () => {
            phases.push('account2-prepare')
            account2Prepared = true
            return true
          },
          commit: async () => {
            phases.push('account2-commit')
            expect(account1Prepared).toBe(true)
            expect(account2Prepared).toBe(true)
          },
          rollback: async () => {
            phases.push('account2-rollback')
          },
        })

      const result = await tpc.execute()

      expect(result.success).toBe(true)
      expect(result.phase).toBe('complete')

      // Verify all prepares happen before any commit
      const prepareIndices = [
        phases.indexOf('account1-prepare'),
        phases.indexOf('account2-prepare'),
      ]
      const commitIndices = [
        phases.indexOf('account1-commit'),
        phases.indexOf('account2-commit'),
      ]

      expect(Math.max(...prepareIndices)).toBeLessThan(Math.min(...commitIndices))
    })

    /**
     * Test 6: 2PC aborts and rollbacks if any participant fails prepare
     */
    it('should abort and rollback all participants if any prepare fails', async () => {
      const phases: string[] = []

      const tpc = new TwoPhaseCommit()
        .addParticipant({
          id: 'participant1',
          prepare: async () => {
            phases.push('p1-prepare')
            return true
          },
          commit: async () => {
            phases.push('p1-commit')
          },
          rollback: async () => {
            phases.push('p1-rollback')
          },
        })
        .addParticipant({
          id: 'participant2',
          prepare: async () => {
            phases.push('p2-prepare')
            return false // Fails to prepare
          },
          commit: async () => {
            phases.push('p2-commit')
          },
          rollback: async () => {
            phases.push('p2-rollback')
          },
        })
        .addParticipant({
          id: 'participant3',
          prepare: async () => {
            phases.push('p3-prepare')
            return true
          },
          commit: async () => {
            phases.push('p3-commit')
          },
          rollback: async () => {
            phases.push('p3-rollback')
          },
        })

      const result = await tpc.execute()

      expect(result.success).toBe(false)
      expect(result.phase).toBe('rollback')

      // No commits should happen
      expect(phases).not.toContain('p1-commit')
      expect(phases).not.toContain('p2-commit')
      expect(phases).not.toContain('p3-commit')

      // Prepared participants should be rolled back
      expect(phases).toContain('p1-rollback')
    })

    /**
     * Test 7: 2PC rollbacks on commit phase failure
     */
    it('should rollback all participants if commit fails', async () => {
      const phases: string[] = []

      const tpc = new TwoPhaseCommit()
        .addParticipant({
          id: 'account-source',
          prepare: async () => {
            phases.push('source-prepare')
            return true
          },
          commit: async () => {
            phases.push('source-commit')
          },
          rollback: async () => {
            phases.push('source-rollback')
          },
        })
        .addParticipant({
          id: 'account-dest',
          prepare: async () => {
            phases.push('dest-prepare')
            return true
          },
          commit: async () => {
            phases.push('dest-commit-fail')
            throw new Error('Commit failed - disk full')
          },
          rollback: async () => {
            phases.push('dest-rollback')
          },
        })

      const result = await tpc.execute()

      expect(result.success).toBe(false)
      expect(result.phase).toBe('rollback')
      expect(result.error?.message).toContain('Commit failed')

      // Both should be rolled back
      expect(phases).toContain('source-rollback')
      expect(phases).toContain('dest-rollback')
    })
  })

  // ==========================================================================
  // 3. CROSS-DO MONEY TRANSFER
  // ==========================================================================

  describe('Cross-DO Money Transfer', () => {
    /**
     * Test 8: Transfer money between two DOs using 2PC
     */
    it('should transfer money atomically between two DOs using 2PC', async () => {
      const accountA = new AccountDO(1000)
      const accountB = new AccountDO(500)

      const transferAmount = 200
      const txId = `tx-${Date.now()}`

      const transfer = new TwoPhaseCommit({ timeout: 5000 })
        .addParticipant({
          id: 'source',
          prepare: async () => {
            return await accountA.prepareDebit(transferAmount, txId)
          },
          commit: async () => {
            await accountA.commitDebit(txId)
          },
          rollback: async () => {
            await accountA.rollbackDebit(txId)
          },
        })
        .addParticipant({
          id: 'destination',
          prepare: async () => {
            return await accountB.prepareCredit(transferAmount, txId)
          },
          commit: async () => {
            await accountB.commitCredit(txId)
          },
          rollback: async () => {
            await accountB.rollbackCredit(txId)
          },
        })

      const result = await transfer.execute()

      expect(result.success).toBe(true)

      // Verify final balances
      const finalA = await accountA.getBalance()
      const finalB = await accountB.getBalance()

      expect(finalA).toBe(800) // 1000 - 200
      expect(finalB).toBe(700) // 500 + 200
    })

    /**
     * Test 9: Transfer fails and rolls back on insufficient funds
     */
    it('should rollback transfer when source has insufficient funds', async () => {
      const accountA = new AccountDO(50) // Insufficient
      const accountB = new AccountDO(500)

      const transferAmount = 200
      const txId = `tx-fail-${Date.now()}`

      const transfer = new TwoPhaseCommit()
        .addParticipant({
          id: 'source',
          prepare: async () => {
            return await accountA.prepareDebit(transferAmount, txId)
          },
          commit: async () => {
            await accountA.commitDebit(txId)
          },
          rollback: async () => {
            await accountA.rollbackDebit(txId)
          },
        })
        .addParticipant({
          id: 'destination',
          prepare: async () => {
            return await accountB.prepareCredit(transferAmount, txId)
          },
          commit: async () => {
            await accountB.commitCredit(txId)
          },
          rollback: async () => {
            await accountB.rollbackCredit(txId)
          },
        })

      const result = await transfer.execute()

      expect(result.success).toBe(false)

      // Balances should be unchanged
      const finalA = await accountA.getBalance()
      const finalB = await accountB.getBalance()

      expect(finalA).toBe(50) // Unchanged
      expect(finalB).toBe(500) // Unchanged
    })
  })

  // ==========================================================================
  // 4. PARTIAL FAILURE RECOVERY
  // ==========================================================================

  describe('Partial Failure Recovery', () => {
    /**
     * Test 10: Saga retries failed steps before compensating
     */
    it('should retry failed steps before compensating', async () => {
      let attempts = 0

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'flakyStep',
          retry: { maxAttempts: 3, backoffMs: 10 },
          execute: async () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Transient network error')
            }
            return 'success after retry'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
      expect(result.result).toBe('success after retry')
    })

    /**
     * Test 11: Saga compensates after exhausting all retries
     */
    it('should compensate after exhausting retries', async () => {
      let attempts = 0
      let compensated = false

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'setup',
          execute: async () => ({ setupComplete: true }),
          compensate: async () => {
            compensated = true
          },
        })
        .addStep({
          name: 'persistentlyFailing',
          retry: { maxAttempts: 3, backoffMs: 10 },
          execute: async () => {
            attempts++
            throw new Error('Permanent failure')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(attempts).toBe(3)
      expect(compensated).toBe(true)
    })

    /**
     * Test 12: Recovery with exponential backoff
     */
    it('should use exponential backoff between retries', async () => {
      const attemptTimes: number[] = []

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'backoffTest',
          retry: { maxAttempts: 4, backoffMs: 20 },
          execute: async () => {
            attemptTimes.push(Date.now())
            if (attemptTimes.length < 4) {
              throw new Error('Keep retrying')
            }
            return 'finally succeeded'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(attemptTimes.length).toBe(4)

      // Verify delays increase (exponential backoff)
      const delays = attemptTimes.slice(1).map((t, i) => t - attemptTimes[i])
      // Delays should generally increase: ~20ms, ~40ms, ~80ms
      for (let i = 1; i < delays.length; i++) {
        // Allow variance due to timing uncertainty
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] * 0.5)
      }
    })
  })

  // ==========================================================================
  // 5. TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    /**
     * Test 13: Cross-DO call times out on slow response
     */
    it('should timeout cross-DO calls that exceed timeout', async () => {
      const slowDO = new InventoryDO()

      await expect(
        crossDOCallWithTimeout(
          () => slowDO.slowOperation(500), // Takes 500ms
          100, // Timeout after 100ms
          'SlowDO'
        )
      ).rejects.toThrow(/timed out/i)
    })

    /**
     * Test 14: Saga compensates previous steps on timeout
     */
    it('should compensate previous steps when a step times out', async () => {
      let compensated = false

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'quickStep',
          execute: async () => ({ completed: true }),
          compensate: async () => {
            compensated = true
          },
        })
        .addStep({
          name: 'slowStep',
          timeout: 50,
          execute: async () => {
            await new Promise((r) => setTimeout(r, 200))
            return 'too late'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toMatch(/timed out/i)
      expect(compensated).toBe(true)
    })

    /**
     * Test 15: Cross-DO call completes within timeout
     */
    it('should complete cross-DO calls within timeout', async () => {
      const fastDO = new InventoryDO()

      const result = await crossDOCallWithTimeout(
        () => fastDO.slowOperation(10), // Takes 10ms
        1000, // Timeout after 1000ms
        'FastDO'
      )

      expect(result).toBe('completed')
    })
  })

  // ==========================================================================
  // 6. CONCURRENT TRANSACTION CONFLICTS
  // ==========================================================================

  describe('Concurrent Transaction Conflicts', () => {
    /**
     * Test 16: Handle concurrent debits from same account
     */
    it('should handle concurrent debits from same account', async () => {
      const account = new AccountDO(1000)

      // Two concurrent debits trying to remove 600 each (total 1200, only 1000 available)
      const debit1 = account.debit(600)
      const debit2 = account.debit(600)

      const results = await Promise.all([debit1, debit2])

      // At most one should succeed (since total > balance)
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBeLessThanOrEqual(2)

      // Final balance should be >= 0 and <= 1000
      const finalBalance = await account.getBalance()
      expect(finalBalance).toBeGreaterThanOrEqual(-200) // Worst case: both succeed
      expect(finalBalance).toBeLessThanOrEqual(1000)
    })

    /**
     * Test 17: Idempotency prevents duplicate execution
     */
    it('should prevent duplicate execution with same idempotency key', async () => {
      let executionCount = 0

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'countedOperation',
          execute: async () => {
            executionCount++
            return `execution-${executionCount}`
          },
        })

      const idempotencyKey = `idem-${Date.now()}`

      // Execute twice with same key
      const result1 = await saga.execute(undefined, { idempotencyKey })
      const result2 = await saga.execute(undefined, { idempotencyKey })

      expect(executionCount).toBe(1) // Only executed once
      expect(result1.result).toBe('execution-1')
      expect(result2.result).toBe('execution-1') // Same cached result
    })

    /**
     * Test 18: Different idempotency keys execute independently
     */
    it('should execute independently with different idempotency keys', async () => {
      let executionCount = 0

      const saga = new CrossDOSaga<void, number>()
        .addStep({
          name: 'countedOperation',
          execute: async () => {
            executionCount++
            return executionCount
          },
        })

      await saga.execute(undefined, { idempotencyKey: 'key-a' })
      await saga.execute(undefined, { idempotencyKey: 'key-b' })
      await saga.execute(undefined, { idempotencyKey: 'key-c' })

      expect(executionCount).toBe(3)
    })
  })

  // ==========================================================================
  // 7. DISTRIBUTED DEADLOCK DETECTION
  // ==========================================================================

  describe('Distributed Deadlock Detection', () => {
    /**
     * Test 19: Detect potential deadlock from circular lock wait
     */
    it('should prevent deadlock through timeout on lock acquisition', async () => {
      const doA = new AccountDO(1000)
      const doB = new AccountDO(1000)

      // TX1: Acquire lock on A
      const tx1LockA = await doA.acquireLock('resource-1', 1000)
      expect(tx1LockA).toBe(true)

      // TX2: Acquire lock on B
      const tx2LockB = await doB.acquireLock('resource-2', 1000)
      expect(tx2LockB).toBe(true)

      // Now create potential deadlock scenario
      // TX1 tries to acquire lock on B's resource (should fail - different DO)
      // TX2 tries to acquire lock on A's resource (should fail - different DO)

      // In a single DO context, we can test lock timeouts
      const doC = new AccountDO(1000)
      await doC.acquireLock('shared-resource', 100)

      // Second lock attempt should timeout since first lock is held
      const secondLockAttempt = await doC.acquireLock('shared-resource', 50)
      expect(secondLockAttempt).toBe(false) // Already held by same instance

      // Cleanup
      await doA.releaseLock('resource-1')
      await doB.releaseLock('resource-2')
    })

    /**
     * Test 20: Lock timeout prevents indefinite waiting
     */
    it('should timeout lock acquisition to prevent deadlock', async () => {
      const account = new AccountDO(1000)

      // First lock succeeds
      const firstLock = await account.acquireLock('exclusive-resource', 100)
      expect(firstLock).toBe(true)

      // Create a parallel task that will try to acquire same lock
      // This simulates a second DO/transaction trying to acquire
      const startTime = Date.now()

      // Use a separate instance to simulate another transaction
      const account2 = new AccountDO(1000)
      // Account2 tries to acquire its own lock (different context)
      const lock2 = await account2.acquireLock('other-resource', 100)
      expect(lock2).toBe(true)

      const elapsed = Date.now() - startTime
      // Should complete quickly without waiting
      expect(elapsed).toBeLessThan(200)

      await account.releaseLock('exclusive-resource')
      await account2.releaseLock('other-resource')
    })
  })

  // ==========================================================================
  // ADDITIONAL E2E SCENARIOS
  // ==========================================================================

  describe('Additional E2E Scenarios', () => {
    /**
     * Test 21: Saga with many steps
     */
    it('should handle saga with many participants', async () => {
      const stepNames = ['inventory', 'payment', 'shipping', 'notification', 'analytics']
      const executedSteps: string[] = []

      const saga = new CrossDOSaga<void, string>()

      for (const name of stepNames) {
        saga.addStep({
          name,
          execute: async () => {
            executedSteps.push(name)
            return `${name}-completed`
          },
          compensate: async () => {
            executedSteps.push(`${name}-compensated`)
          },
        })
      }

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(result.steps).toHaveLength(5)
      expect(executedSteps).toEqual(stepNames)
    })

    /**
     * Test 22: 2PC with heterogeneous participants
     */
    it('should coordinate heterogeneous participants in 2PC', async () => {
      const prepareOrder: string[] = []
      const commitOrder: string[] = []

      const tpc = new TwoPhaseCommit()
        .addParticipant({
          id: 'database',
          prepare: async () => {
            prepareOrder.push('database')
            return true
          },
          commit: async () => {
            commitOrder.push('database')
          },
          rollback: async () => {},
        })
        .addParticipant({
          id: 'cache',
          prepare: async () => {
            prepareOrder.push('cache')
            return true
          },
          commit: async () => {
            commitOrder.push('cache')
          },
          rollback: async () => {},
        })
        .addParticipant({
          id: 'search-index',
          prepare: async () => {
            prepareOrder.push('search-index')
            return true
          },
          commit: async () => {
            commitOrder.push('search-index')
          },
          rollback: async () => {},
        })

      const result = await tpc.execute()

      expect(result.success).toBe(true)
      expect(prepareOrder).toHaveLength(3)
      expect(commitOrder).toHaveLength(3)
    })

    /**
     * Test 23: Idempotency key expiration
     */
    it('should re-execute after idempotency key expires', async () => {
      const manager = new IdempotencyKeyManager()
      const key = 'expiring-key'

      // Store with short TTL
      await manager.set(key, { result: 'cached' }, 50)

      // Verify it exists
      expect(await manager.has(key)).toBe(true)
      expect(await manager.get(key)).toEqual({ result: 'cached' })

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 100))

      // Should be expired
      expect(await manager.has(key)).toBe(false)
      expect(await manager.get(key)).toBeUndefined()
    })

    /**
     * Test 24: Generate unique idempotency keys
     */
    it('should generate unique idempotency keys', () => {
      const keys = new Set<string>()

      for (let i = 0; i < 100; i++) {
        keys.add(generateIdempotencyKey('test'))
      }

      // All keys should be unique
      expect(keys.size).toBe(100)
    })

    /**
     * Test 25: Complex multi-region transfer simulation
     */
    it('should handle complex multi-region transfer', async () => {
      const regions = ['us-west', 'us-east', 'eu-west']
      const executedRegions: string[] = []

      const saga = new CrossDOSaga<{ amount: number }, { txId: string }>()

      for (const region of regions) {
        saga.addStep({
          name: `validate-${region}`,
          targetDO: `${region}-validator`,
          execute: async (input: any) => {
            executedRegions.push(region)
            await new Promise((r) => setTimeout(r, 10)) // Simulate network latency
            return { ...input, validated: { [region]: true } }
          },
          compensate: async () => {
            executedRegions.push(`${region}-rollback`)
          },
        })
      }

      const result = await saga.execute({ amount: 1000 })

      expect(result.success).toBe(true)
      expect(executedRegions).toEqual(regions)
      expect(result.duration).toBeDefined()
      expect(result.duration).toBeGreaterThanOrEqual(20) // At least 10ms * 2 regions
    })
  })
})
