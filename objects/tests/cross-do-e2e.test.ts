/**
 * Cross-DO Transaction E2E Tests (RED Phase)
 *
 * Tests for CrossDOTransaction primitives:
 * - CrossDOSaga - Saga pattern with compensation
 * - TwoPhaseCommit - 2PC for atomic operations
 * - IdempotencyKeyManager - Duplicate prevention
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

describe('Cross-DO Transactions E2E', () => {
  describe('CrossDOSaga', () => {
    it('should execute multi-step saga successfully', async () => {
      const orchestrator = env.DO.get(env.DO.idFromName('saga-orchestrator'))
      const inventory = env.DO.get(env.DO.idFromName('saga-inventory'))
      const payment = env.DO.get(env.DO.idFromName('saga-payment'))

      // Setup initial state
      await (inventory as any).setStock('item-1', 10)
      await (payment as any).setBalance('user-1', 1000)

      // Execute saga: reserve inventory -> process payment
      const result = await (orchestrator as any).executeSaga({
        orderId: 'order-1',
        userId: 'user-1',
        itemId: 'item-1',
        quantity: 2,
        amount: 100
      })

      expect(result.success).toBe(true)
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].name).toBe('reserveInventory')
      expect(result.steps[1].name).toBe('processPayment')

      // Verify final state
      const stock = await (inventory as any).getStock('item-1')
      const balance = await (payment as any).getBalance('user-1')
      expect(stock).toBe(8) // 10 - 2
      expect(balance).toBe(900) // 1000 - 100
    })

    it('should compensate on step failure (rollback)', async () => {
      const orchestrator = env.DO.get(env.DO.idFromName('saga-rollback'))
      const inventory = env.DO.get(env.DO.idFromName('saga-inventory-2'))
      const payment = env.DO.get(env.DO.idFromName('saga-payment-2'))

      // Setup: low balance to trigger failure
      await (inventory as any).setStock('item-2', 10)
      await (payment as any).setBalance('user-2', 50) // Not enough for 100

      // Execute saga - should fail at payment step
      const result = await (orchestrator as any).executeSaga({
        orderId: 'order-2',
        userId: 'user-2',
        itemId: 'item-2',
        quantity: 2,
        amount: 100
      })

      expect(result.success).toBe(false)
      expect(result.failedStep).toBe('processPayment')
      expect(result.compensated).toBe(true)

      // Verify rollback - inventory should be restored
      const stock = await (inventory as any).getStock('item-2')
      expect(stock).toBe(10) // Restored
    })

    it('should be idempotent on retry with same key', async () => {
      const orchestrator = env.DO.get(env.DO.idFromName('saga-idempotent'))
      const idempotencyKey = 'idem-key-1'

      // First execution
      const result1 = await (orchestrator as any).executeSaga({
        orderId: 'order-3',
        idempotencyKey
      })

      // Second execution with same key
      const result2 = await (orchestrator as any).executeSaga({
        orderId: 'order-3',
        idempotencyKey
      })

      // Should return cached result
      expect(result2.fromCache).toBe(true)
      expect(result2.originalExecutionId).toBe(result1.executionId)
    })

    it('should handle partial failures gracefully', async () => {
      const orchestrator = env.DO.get(env.DO.idFromName('saga-partial'))

      // Execute saga where compensation also fails
      const result = await (orchestrator as any).executeSagaWithFailingCompensation({
        orderId: 'order-4'
      })

      expect(result.success).toBe(false)
      expect(result.compensationFailed).toBe(true)
      expect(result.requiresManualIntervention).toBe(true)
    })
  })

  describe('TwoPhaseCommit', () => {
    it('should prepare all participants successfully', async () => {
      const coordinator = env.DO.get(env.DO.idFromName('2pc-coordinator'))
      const participant1 = env.DO.get(env.DO.idFromName('2pc-participant-1'))
      const participant2 = env.DO.get(env.DO.idFromName('2pc-participant-2'))

      // Register participants
      await (coordinator as any).registerParticipants([
        'participant-1',
        'participant-2'
      ])

      // Prepare phase
      const prepareResult = await (coordinator as any).prepare({
        transactionId: 'tx-1',
        operations: [
          { participant: 'participant-1', op: 'credit', amount: 100 },
          { participant: 'participant-2', op: 'debit', amount: 100 }
        ]
      })

      expect(prepareResult.allPrepared).toBe(true)
      expect(prepareResult.votes).toEqual({
        'participant-1': 'prepared',
        'participant-2': 'prepared'
      })
    })

    it('should commit after successful prepare', async () => {
      const coordinator = env.DO.get(env.DO.idFromName('2pc-commit'))

      // Setup and prepare
      await (coordinator as any).setupTransaction('tx-2')
      await (coordinator as any).prepare({ transactionId: 'tx-2' })

      // Commit
      const commitResult = await (coordinator as any).commit({ transactionId: 'tx-2' })

      expect(commitResult.committed).toBe(true)
      expect(commitResult.participants).toEqual(['participant-1', 'participant-2'])
    })

    it('should abort if any participant fails prepare', async () => {
      const coordinator = env.DO.get(env.DO.idFromName('2pc-abort'))

      // Setup with one failing participant
      await (coordinator as any).setupWithFailingParticipant('tx-3')

      // Prepare should detect failure
      const prepareResult = await (coordinator as any).prepare({ transactionId: 'tx-3' })

      expect(prepareResult.allPrepared).toBe(false)
      expect(prepareResult.aborted).toBe(true)
    })

    it('should handle timeout during prepare', async () => {
      const coordinator = env.DO.get(env.DO.idFromName('2pc-timeout'))

      // Setup with slow participant
      await (coordinator as any).setupWithSlowParticipant('tx-4')

      // Prepare with timeout
      const result = await (coordinator as any).prepare({
        transactionId: 'tx-4',
        timeoutMs: 100
      })

      expect(result.timedOut).toBe(true)
      expect(result.aborted).toBe(true)
    })
  })

  describe('IdempotencyKeyManager', () => {
    it('should store and retrieve execution results', async () => {
      const manager = env.DO.get(env.DO.idFromName('idem-manager'))
      const key = 'unique-key-1'

      // First call - execute and store
      const result1 = await (manager as any).executeWithIdempotency(key, {
        operation: 'transfer',
        amount: 100
      })

      expect(result1.executed).toBe(true)
      expect(result1.storedResult).toBeDefined()

      // Second call - return cached
      const result2 = await (manager as any).executeWithIdempotency(key, {
        operation: 'transfer',
        amount: 100
      })

      expect(result2.executed).toBe(false)
      expect(result2.fromCache).toBe(true)
      expect(result2.cachedResult).toEqual(result1.storedResult)
    })

    it('should expire old idempotency keys', async () => {
      const manager = env.DO.get(env.DO.idFromName('idem-expiry'))
      const key = 'expiring-key'

      // Execute with short TTL
      await (manager as any).executeWithIdempotency(key, {
        operation: 'test',
        ttlMs: 100
      })

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should execute fresh
      const result = await (manager as any).executeWithIdempotency(key, {
        operation: 'test'
      })

      expect(result.executed).toBe(true)
      expect(result.fromCache).toBe(false)
    })

    it('should handle concurrent requests with same key', async () => {
      const manager = env.DO.get(env.DO.idFromName('idem-concurrent'))
      const key = 'concurrent-key'

      // Launch 10 concurrent requests with same key
      const promises = Array(10).fill(null).map(() =>
        (manager as any).executeWithIdempotency(key, {
          operation: 'increment'
        })
      )

      const results = await Promise.all(promises)

      // Only one should have executed
      const executed = results.filter(r => r.executed)
      expect(executed).toHaveLength(1)
    })
  })

  describe('Cross-DO Call Timeout', () => {
    it('should complete within timeout', async () => {
      const caller = env.DO.get(env.DO.idFromName('timeout-caller'))

      const result = await (caller as any).callWithTimeout({
        targetDO: 'fast-responder',
        timeoutMs: 5000
      })

      expect(result.completed).toBe(true)
      expect(result.timedOut).toBe(false)
    })

    it('should timeout on slow response', async () => {
      const caller = env.DO.get(env.DO.idFromName('timeout-slow'))

      await expect(
        (caller as any).callWithTimeout({
          targetDO: 'slow-responder',
          timeoutMs: 100
        })
      ).rejects.toThrow(/timeout/i)
    })

    it('should retry on timeout with backoff', async () => {
      const caller = env.DO.get(env.DO.idFromName('timeout-retry'))

      const result = await (caller as any).callWithRetry({
        targetDO: 'flaky-responder',
        maxRetries: 3,
        baseDelayMs: 100
      })

      expect(result.attempts).toBeGreaterThan(1)
      expect(result.success).toBe(true)
    })
  })
})
