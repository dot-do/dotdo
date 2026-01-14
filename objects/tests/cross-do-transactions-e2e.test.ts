/**
 * Cross-DO Transaction E2E Tests (GREEN Phase - TDD)
 *
 * Tests for CrossDOTransaction primitives with real miniflare DOs:
 * - CrossDOSaga - Saga pattern with compensation
 * - TwoPhaseCommit - 2PC for atomic operations
 * - IdempotencyKeyManager - Duplicate prevention
 *
 * Uses cloudflare:test with real miniflare - NO MOCKS per CLAUDE.md guidelines.
 * Tests transaction coordination through real DO stubs via RPC.
 *
 * @see objects/CrossDOTransaction.ts for implementation
 * @see workers/wrangler.do-test.jsonc for test DO configuration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()
let testCounter = 0

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'cross-do-test'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
}

/**
 * Helper to get a real DO stub with transaction/saga capabilities
 * Uses the TEST_DO binding from wrangler.do-test.jsonc
 */
function getTransactionStub(ns: string) {
  const id = env.TEST_DO.idFromName(ns)
  return env.TEST_DO.get(id) as unknown as {
    // Saga operations
    executeSaga(params: {
      orderId: string
      userId?: string
      itemId?: string
      quantity?: number
      amount?: number
      idempotencyKey?: string
    }): Promise<{
      success: boolean
      executionId?: string
      steps?: Array<{ name: string; success: boolean }>
      failedStep?: string
      compensated?: boolean
      fromCache?: boolean
      originalExecutionId?: string
    }>
    executeSagaWithFailingCompensation(params: { orderId: string }): Promise<{
      success: boolean
      compensationFailed: boolean
      requiresManualIntervention: boolean
    }>
    // Inventory operations (for saga testing)
    setStock(itemId: string, quantity: number): Promise<void>
    getStock(itemId: string): Promise<number>
    // Payment operations (for saga testing)
    setBalance(userId: string, balance: number): Promise<void>
    getBalance(userId: string): Promise<number>
    // 2PC operations
    registerParticipants(participants: string[]): Promise<void>
    setupTransaction(transactionId: string): Promise<void>
    setupWithFailingParticipant(transactionId: string): Promise<void>
    setupWithSlowParticipant(transactionId: string): Promise<void>
    prepare(params: {
      transactionId: string
      operations?: Array<{ participant: string; op: string; amount: number }>
      timeoutMs?: number
    }): Promise<{
      allPrepared: boolean
      votes?: Record<string, string>
      aborted?: boolean
      timedOut?: boolean
    }>
    commit(params: { transactionId: string }): Promise<{
      committed: boolean
      participants: string[]
    }>
    // Idempotency operations
    executeWithIdempotency(
      key: string,
      params: { operation: string; amount?: number; ttlMs?: number }
    ): Promise<{
      executed: boolean
      storedResult?: unknown
      fromCache?: boolean
      cachedResult?: unknown
    }>
    // Timeout/retry operations
    callWithTimeout(params: {
      targetDO: string
      timeoutMs: number
    }): Promise<{ completed: boolean; timedOut: boolean }>
    callWithRetry(params: {
      targetDO: string
      maxRetries: number
      baseDelayMs: number
    }): Promise<{ attempts: number; success: boolean }>
  }
}

// ============================================================================
// TEST SUITE: CROSS-DO SAGA
// ============================================================================

describe('Cross-DO Transactions E2E', () => {
  describe('CrossDOSaga', () => {
    it('should execute multi-step saga successfully', async () => {
      // Create unique namespace for test isolation
      const ns = uniqueNs('saga-multi-step')
      const stub = getTransactionStub(ns)

      // Setup initial state using real DO
      await stub.setStock('item-1', 10)
      await stub.setBalance('user-1', 1000)

      // Execute saga: reserve inventory -> process payment
      const result = await stub.executeSaga({
        orderId: 'order-1',
        userId: 'user-1',
        itemId: 'item-1',
        quantity: 2,
        amount: 100,
      })

      expect(result.success).toBe(true)
      expect(result.steps).toHaveLength(2)
      expect(result.steps![0].name).toBe('reserveInventory')
      expect(result.steps![1].name).toBe('processPayment')

      // Verify final state via real DO calls
      const stock = await stub.getStock('item-1')
      const balance = await stub.getBalance('user-1')
      expect(stock).toBe(8) // 10 - 2
      expect(balance).toBe(900) // 1000 - 100
    })

    it('should compensate on step failure (rollback)', async () => {
      const ns = uniqueNs('saga-rollback')
      const stub = getTransactionStub(ns)

      // Setup: low balance to trigger failure
      await stub.setStock('item-2', 10)
      await stub.setBalance('user-2', 50) // Not enough for 100

      // Execute saga - should fail at payment step
      const result = await stub.executeSaga({
        orderId: 'order-2',
        userId: 'user-2',
        itemId: 'item-2',
        quantity: 2,
        amount: 100,
      })

      expect(result.success).toBe(false)
      expect(result.failedStep).toBe('processPayment')
      expect(result.compensated).toBe(true)

      // Verify rollback - inventory should be restored
      const stock = await stub.getStock('item-2')
      expect(stock).toBe(10) // Restored
    })

    it('should be idempotent on retry with same key', async () => {
      const ns = uniqueNs('saga-idempotent')
      const stub = getTransactionStub(ns)
      const idempotencyKey = `idem-key-${testRunId}-${testCounter}`

      // First execution
      const result1 = await stub.executeSaga({
        orderId: 'order-3',
        idempotencyKey,
      })

      expect(result1.executionId).toBeDefined()

      // Second execution with same key
      const result2 = await stub.executeSaga({
        orderId: 'order-3',
        idempotencyKey,
      })

      // Should return cached result
      expect(result2.fromCache).toBe(true)
      expect(result2.originalExecutionId).toBe(result1.executionId)
    })

    it('should handle partial failures gracefully', async () => {
      const ns = uniqueNs('saga-partial')
      const stub = getTransactionStub(ns)

      // Execute saga where compensation also fails
      const result = await stub.executeSagaWithFailingCompensation({
        orderId: 'order-4',
      })

      expect(result.success).toBe(false)
      expect(result.compensationFailed).toBe(true)
      expect(result.requiresManualIntervention).toBe(true)
    })
  })

  // ============================================================================
  // TEST SUITE: TWO-PHASE COMMIT
  // ============================================================================

  describe('TwoPhaseCommit', () => {
    it('should prepare all participants successfully', async () => {
      const ns = uniqueNs('2pc-coordinator')
      const stub = getTransactionStub(ns)

      // Register participants
      await stub.registerParticipants(['participant-1', 'participant-2'])

      // Prepare phase
      const prepareResult = await stub.prepare({
        transactionId: 'tx-1',
        operations: [
          { participant: 'participant-1', op: 'credit', amount: 100 },
          { participant: 'participant-2', op: 'debit', amount: 100 },
        ],
      })

      expect(prepareResult.allPrepared).toBe(true)
      expect(prepareResult.votes).toEqual({
        'participant-1': 'prepared',
        'participant-2': 'prepared',
      })
    })

    it('should commit after successful prepare', async () => {
      const ns = uniqueNs('2pc-commit')
      const stub = getTransactionStub(ns)

      // Setup and prepare
      await stub.setupTransaction('tx-2')
      await stub.prepare({ transactionId: 'tx-2' })

      // Commit
      const commitResult = await stub.commit({ transactionId: 'tx-2' })

      expect(commitResult.committed).toBe(true)
      expect(commitResult.participants).toEqual(['participant-1', 'participant-2'])
    })

    it('should abort if any participant fails prepare', async () => {
      const ns = uniqueNs('2pc-abort')
      const stub = getTransactionStub(ns)

      // Setup with one failing participant
      await stub.setupWithFailingParticipant('tx-3')

      // Prepare should detect failure
      const prepareResult = await stub.prepare({ transactionId: 'tx-3' })

      expect(prepareResult.allPrepared).toBe(false)
      expect(prepareResult.aborted).toBe(true)
    })

    it('should handle timeout during prepare', async () => {
      const ns = uniqueNs('2pc-timeout')
      const stub = getTransactionStub(ns)

      // Setup with slow participant
      await stub.setupWithSlowParticipant('tx-4')

      // Prepare with timeout
      const result = await stub.prepare({
        transactionId: 'tx-4',
        timeoutMs: 100,
      })

      expect(result.timedOut).toBe(true)
      expect(result.aborted).toBe(true)
    })
  })

  // ============================================================================
  // TEST SUITE: IDEMPOTENCY KEY MANAGER
  // ============================================================================

  describe('IdempotencyKeyManager', () => {
    it('should store and retrieve execution results', async () => {
      const ns = uniqueNs('idem-manager')
      const stub = getTransactionStub(ns)
      const key = `unique-key-${testRunId}-${testCounter}`

      // First call - execute and store
      const result1 = await stub.executeWithIdempotency(key, {
        operation: 'transfer',
        amount: 100,
      })

      expect(result1.executed).toBe(true)
      expect(result1.storedResult).toBeDefined()

      // Second call - return cached
      const result2 = await stub.executeWithIdempotency(key, {
        operation: 'transfer',
        amount: 100,
      })

      expect(result2.executed).toBe(false)
      expect(result2.fromCache).toBe(true)
      expect(result2.cachedResult).toEqual(result1.storedResult)
    })

    it('should expire old idempotency keys', async () => {
      const ns = uniqueNs('idem-expiry')
      const stub = getTransactionStub(ns)
      const key = `expiring-key-${testRunId}-${testCounter}`

      // Execute with short TTL
      await stub.executeWithIdempotency(key, {
        operation: 'test',
        ttlMs: 100,
      })

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should execute fresh
      const result = await stub.executeWithIdempotency(key, {
        operation: 'test',
      })

      expect(result.executed).toBe(true)
      expect(result.fromCache).toBe(false)
    })

    it('should handle concurrent requests with same key', async () => {
      const ns = uniqueNs('idem-concurrent')
      const stub = getTransactionStub(ns)
      const key = `concurrent-key-${testRunId}-${testCounter}`

      // Launch 10 concurrent requests with same key
      const promises = Array(10)
        .fill(null)
        .map(() =>
          stub.executeWithIdempotency(key, {
            operation: 'increment',
          })
        )

      const results = await Promise.all(promises)

      // Only one should have executed
      const executed = results.filter((r) => r.executed)
      expect(executed).toHaveLength(1)
    })
  })

  // ============================================================================
  // TEST SUITE: CROSS-DO CALL TIMEOUT
  // ============================================================================

  describe('Cross-DO Call Timeout', () => {
    it('should complete within timeout', async () => {
      const ns = uniqueNs('timeout-caller')
      const stub = getTransactionStub(ns)

      const result = await stub.callWithTimeout({
        targetDO: 'fast-responder',
        timeoutMs: 5000,
      })

      expect(result.completed).toBe(true)
      expect(result.timedOut).toBe(false)
    })

    it('should timeout on slow response', async () => {
      const ns = uniqueNs('timeout-slow')
      const stub = getTransactionStub(ns)

      await expect(
        stub.callWithTimeout({
          targetDO: 'slow-responder',
          timeoutMs: 100,
        })
      ).rejects.toThrow(/timeout/i)
    })

    it('should retry on timeout with backoff', async () => {
      const ns = uniqueNs('timeout-retry')
      const stub = getTransactionStub(ns)

      const result = await stub.callWithRetry({
        targetDO: 'flaky-responder',
        maxRetries: 3,
        baseDelayMs: 100,
      })

      expect(result.attempts).toBeGreaterThan(1)
      expect(result.success).toBe(true)
    })
  })
})
