/**
 * ACID Test Suite - Phase 3: Shard Transactions
 *
 * RED TDD: These tests define the expected behavior for distributed transactions
 * across multiple shards. All tests are expected to FAIL initially as this is
 * the RED phase.
 *
 * Cross-shard transactions provide:
 * - Distributed ACID guarantees across shards
 * - Two-phase commit (2PC) coordination
 * - Saga pattern for eventual consistency
 * - Compensating transactions for rollback
 * - Distributed locking across shards
 * - Deadlock detection and resolution
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type { ShardOptions } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR TRANSACTION TESTS
// ============================================================================

/**
 * Transaction isolation level
 */
type IsolationLevel =
  | 'read_uncommitted'
  | 'read_committed'
  | 'repeatable_read'
  | 'serializable'

/**
 * Transaction mode
 */
type TransactionMode =
  | 'two_phase_commit' // Strong consistency
  | 'saga'             // Eventually consistent with compensation
  | 'best_effort'      // Fire-and-forget across shards

/**
 * Cross-shard transaction options
 */
interface CrossShardTransactionOptions {
  /** Transaction mode */
  mode?: TransactionMode
  /** Isolation level */
  isolation?: IsolationLevel
  /** Timeout in milliseconds */
  timeout?: number
  /** Correlation ID for tracing */
  correlationId?: string
  /** Retry count for failed operations */
  retryCount?: number
  /** Whether to auto-rollback on failure */
  autoRollback?: boolean
  /** Participants to include */
  participants?: string[]
}

/**
 * Transaction operation
 */
interface TransactionOperation {
  /** Operation type */
  type: 'insert' | 'update' | 'delete' | 'query'
  /** Target shard (null = determine from shard key) */
  shard?: number
  /** SQL query or mutation */
  sql: string
  /** Query parameters */
  params?: unknown[]
  /** Shard key value (for routing) */
  shardKey?: string
}

/**
 * Transaction result
 */
interface CrossShardTransactionResult {
  /** Whether transaction committed successfully */
  committed: boolean
  /** Transaction ID */
  transactionId: string
  /** Results from each operation */
  results: OperationResult[]
  /** Duration of transaction */
  duration: number
  /** Shards that participated */
  participatingShards: number[]
  /** Error if transaction failed */
  error?: TransactionError
}

/**
 * Result of a single operation
 */
interface OperationResult {
  /** Operation index */
  index: number
  /** Whether operation succeeded */
  success: boolean
  /** Rows affected (for mutations) */
  rowsAffected?: number
  /** Query results (for SELECT) */
  data?: unknown[]
  /** Error if operation failed */
  error?: string
  /** Shard that handled this operation */
  shard: number
}

/**
 * Transaction error details
 */
interface TransactionError {
  /** Error type */
  type: 'timeout' | 'conflict' | 'deadlock' | 'shard_unavailable' | 'validation' | 'unknown'
  /** Error message */
  message: string
  /** Which shard(s) caused the error */
  shards?: number[]
  /** Original error */
  cause?: Error
}

/**
 * Saga step definition
 */
interface SagaStep {
  /** Step name */
  name: string
  /** Forward operation */
  forward: TransactionOperation
  /** Compensating operation (for rollback) */
  compensate: TransactionOperation
  /** Dependencies (other step names) */
  dependsOn?: string[]
}

/**
 * Saga execution result
 */
interface SagaResult {
  /** Whether saga completed successfully */
  completed: boolean
  /** Steps that executed */
  executedSteps: string[]
  /** Steps that were compensated (on failure) */
  compensatedSteps: string[]
  /** Current saga state */
  state: 'completed' | 'compensated' | 'failed'
  /** Error if saga failed */
  error?: TransactionError
}

/**
 * Distributed lock
 */
interface DistributedLock {
  /** Lock ID */
  id: string
  /** Resources locked */
  resources: string[]
  /** Shards holding locks */
  shards: number[]
  /** Lock owner (transaction ID) */
  owner: string
  /** Lock expiry time */
  expiresAt: Date
  /** Lock mode */
  mode: 'shared' | 'exclusive'
}

/**
 * Thing record for testing
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  createdAt?: string
  updatedAt?: string
  version?: number
}

/**
 * Shard registry entry
 */
interface ShardRegistry {
  id: string
  shardKey: string
  shardCount: number
  strategy: 'hash' | 'range' | 'roundRobin' | 'custom'
  createdAt: Date
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing'
  }>
}

/**
 * Transaction event types
 */
type TransactionEventType =
  | 'transaction.started'
  | 'transaction.prepared'
  | 'transaction.committed'
  | 'transaction.rolled_back'
  | 'transaction.failed'
  | 'saga.step_executed'
  | 'saga.step_compensated'
  | 'lock.acquired'
  | 'lock.released'
  | 'deadlock.detected'

/**
 * Transaction event payload
 */
interface TransactionEvent {
  type: TransactionEventType
  correlationId: string
  timestamp: Date
  data?: Record<string, unknown>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things with specific distribution
 */
function createThingsWithDistribution(
  distribution: Record<string, number>,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const now = new Date().toISOString()
  const things: ThingRecord[] = []
  let index = 0

  for (const [key, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      things.push({
        id: `thing-${index}`,
        type: 1,
        branch: null,
        name: `Item ${index}`,
        data: {
          [keyField]: key,
          index,
          balance: 1000, // For balance transfer tests
        },
        deleted: false,
        visibility: 'user',
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      index++
    }
  }

  return things
}

/**
 * Create mock shard data
 */
function createMockShardData(
  shardCount: number,
  thingsPerShard: number
): Map<number, ThingRecord[]> {
  const shardData = new Map<number, ThingRecord[]>()

  for (let shard = 0; shard < shardCount; shard++) {
    const things: ThingRecord[] = []
    for (let i = 0; i < thingsPerShard; i++) {
      things.push({
        id: `shard${shard}-thing-${i}`,
        type: 1,
        branch: null,
        name: `Shard ${shard} Item ${i}`,
        data: {
          tenantId: `tenant-${shard}`,
          balance: 1000,
          index: i,
        },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
    }
    shardData.set(shard, things)
  }

  return shardData
}

// ============================================================================
// TEST SUITE: TWO-PHASE COMMIT
// ============================================================================

describe('shard transactions - two-phase commit', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: TransactionEvent[]
  let shardData: Map<number, ThingRecord[]>

  beforeEach(() => {
    capturedEvents = []
    shardData = createMockShardData(4, 25)

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as TransactionEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    // Setup shard state
    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })

    // Setup mock shard namespace
    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockImplementation(async (request: Request) => {
        const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
        const url = new URL(request.url)

        if (url.pathname.includes('/prepare')) {
          return new Response(JSON.stringify({ prepared: true }))
        }
        if (url.pathname.includes('/commit')) {
          return new Response(JSON.stringify({ committed: true }))
        }
        if (url.pathname.includes('/rollback')) {
          return new Response(JSON.stringify({ rolledBack: true }))
        }
        if (url.pathname.includes('/query')) {
          return new Response(JSON.stringify({
            data: shardData.get(shardIndex) || [],
          }))
        }

        return new Response(JSON.stringify({ success: true }))
      }),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('basic 2PC', () => {
    it('should coordinate transaction across multiple shards', async () => {
      // RED: Should execute operations on multiple shards atomically
      const txResult = await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        {
          type: 'update',
          sql: "UPDATE things SET data = json_set(data, '$.balance', data->>'$.balance' - 100) WHERE id = ?",
          params: ['shard0-thing-0'],
          shardKey: 'tenant-0',
        },
        {
          type: 'update',
          sql: "UPDATE things SET data = json_set(data, '$.balance', data->>'$.balance' + 100) WHERE id = ?",
          params: ['shard1-thing-0'],
          shardKey: 'tenant-1',
        },
      ], {
        mode: 'two_phase_commit',
      })

      expect(txResult.committed).toBe(true)
      expect(txResult.participatingShards.length).toBe(2)
    })

    it('should prepare all shards before commit', async () => {
      // RED: Should execute prepare phase on all participating shards
      await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-1' },
      ], {
        mode: 'two_phase_commit',
      })

      const prepareEvent = capturedEvents.find((e) => e.type === 'transaction.prepared')
      expect(prepareEvent).toBeDefined()
    })

    it('should commit only after all shards are prepared', async () => {
      // RED: Commit should happen after all prepares succeed
      const txResult = await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-1' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-2' },
      ], {
        mode: 'two_phase_commit',
      })

      const commitEvent = capturedEvents.find((e) => e.type === 'transaction.committed')
      expect(commitEvent).toBeDefined()
      expect(txResult.participatingShards.length).toBe(3)
    })

    it('should return transaction ID', async () => {
      // RED: Should assign unique transaction ID
      const txResult = await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
      ], {
        mode: 'two_phase_commit',
      })

      expect(txResult.transactionId).toBeDefined()
      expect(txResult.transactionId.length).toBeGreaterThan(0)
    })
  })

  describe('2PC rollback', () => {
    it('should rollback all shards if any prepare fails', async () => {
      // RED: Should abort entire transaction if any shard fails prepare
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const url = new URL(request.url)

          if (url.pathname.includes('/prepare') && shardIndex === 2) {
            return new Response(JSON.stringify({
              prepared: false,
              error: 'Constraint violation',
            }), { status: 409 })
          }
          if (url.pathname.includes('/rollback')) {
            return new Response(JSON.stringify({ rolledBack: true }))
          }

          return new Response(JSON.stringify({ prepared: true }))
        }),
      })

      const txResult = await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-1' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-2' },
      ], {
        mode: 'two_phase_commit',
        autoRollback: true,
      })

      expect(txResult.committed).toBe(false)

      const rollbackEvent = capturedEvents.find((e) => e.type === 'transaction.rolled_back')
      expect(rollbackEvent).toBeDefined()
    })

    it('should rollback all shards if commit fails', async () => {
      // RED: Should rollback if commit phase fails
      const mockNamespace = result.env.DO!
      let prepareCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const url = new URL(request.url)

          if (url.pathname.includes('/prepare')) {
            prepareCount++
            return new Response(JSON.stringify({ prepared: true }))
          }
          if (url.pathname.includes('/commit') && shardIndex === 1) {
            throw new Error('Commit failed on shard 1')
          }
          if (url.pathname.includes('/rollback')) {
            return new Response(JSON.stringify({ rolledBack: true }))
          }

          return new Response(JSON.stringify({ committed: true }))
        }),
      })

      await expect(
        (result.instance as unknown as {
          executeTransaction(
            operations: TransactionOperation[],
            options?: CrossShardTransactionOptions
          ): Promise<CrossShardTransactionResult>
        }).executeTransaction([
          { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
          { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-1' },
        ], {
          mode: 'two_phase_commit',
        })
      ).rejects.toThrow(/commit.*failed/i)
    })

    it('should handle partial commit with heuristic resolution', async () => {
      // RED: Should handle case where some shards commit but not all
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const url = new URL(request.url)

          if (url.pathname.includes('/prepare')) {
            return new Response(JSON.stringify({ prepared: true }))
          }
          if (url.pathname.includes('/commit')) {
            if (shardIndex === 0) {
              return new Response(JSON.stringify({ committed: true }))
            }
            // Shard 1 times out
            await new Promise((resolve) => setTimeout(resolve, 5000))
            return new Response(JSON.stringify({ committed: true }))
          }

          return new Response(JSON.stringify({ success: true }))
        }),
      })

      const txResult = await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-1' },
      ], {
        mode: 'two_phase_commit',
        timeout: 100,
      })

      // Should have error about partial commit
      expect(txResult.error?.type).toBe('timeout')
    })
  })

  describe('2PC recovery', () => {
    it('should recover in-doubt transactions on restart', async () => {
      // RED: Should resolve pending transactions after crash recovery
      // Simulate a pending transaction state
      result.storage.data.set('pendingTransactions', [{
        transactionId: 'tx-pending-1',
        state: 'prepared',
        participants: [0, 1, 2],
        startedAt: new Date(Date.now() - 60000), // 1 minute ago
      }])

      const recoveryResult = await (result.instance as unknown as {
        recoverTransactions(): Promise<{ recovered: number; committed: number; rolledBack: number }>
      }).recoverTransactions()

      expect(recoveryResult.recovered).toBeGreaterThanOrEqual(0)
    })

    it('should log transaction decisions for recovery', async () => {
      // RED: Should persist transaction log
      await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE things SET name = ?', params: ['new'], shardKey: 'tenant-0' },
      ], {
        mode: 'two_phase_commit',
      })

      // Transaction log should be persisted
      const txLog = result.storage.data.get('transactionLog')
      expect(txLog).toBeDefined()
    })
  })
})

// ============================================================================
// TEST SUITE: SAGA PATTERN
// ============================================================================

describe('shard transactions - saga pattern', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: TransactionEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as TransactionEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('saga execution', () => {
    it('should execute saga steps in order', async () => {
      // RED: Should execute steps sequentially
      const saga: SagaStep[] = [
        {
          name: 'debit-source',
          forward: {
            type: 'update',
            sql: "UPDATE accounts SET balance = balance - 100 WHERE id = ?",
            params: ['account-1'],
            shardKey: 'tenant-0',
          },
          compensate: {
            type: 'update',
            sql: "UPDATE accounts SET balance = balance + 100 WHERE id = ?",
            params: ['account-1'],
            shardKey: 'tenant-0',
          },
        },
        {
          name: 'credit-destination',
          forward: {
            type: 'update',
            sql: "UPDATE accounts SET balance = balance + 100 WHERE id = ?",
            params: ['account-2'],
            shardKey: 'tenant-1',
          },
          compensate: {
            type: 'update',
            sql: "UPDATE accounts SET balance = balance - 100 WHERE id = ?",
            params: ['account-2'],
            shardKey: 'tenant-1',
          },
          dependsOn: ['debit-source'],
        },
      ]

      const sagaResult = await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      expect(sagaResult.completed).toBe(true)
      expect(sagaResult.executedSteps).toEqual(['debit-source', 'credit-destination'])
    })

    it('should emit step execution events', async () => {
      // RED: Should emit events for each step
      const saga: SagaStep[] = [
        {
          name: 'step-1',
          forward: { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
          compensate: { type: 'update', sql: 'UPDATE x SET y = 0', shardKey: 'tenant-0' },
        },
        {
          name: 'step-2',
          forward: { type: 'update', sql: 'UPDATE x SET z = 1', shardKey: 'tenant-1' },
          compensate: { type: 'update', sql: 'UPDATE x SET z = 0', shardKey: 'tenant-1' },
          dependsOn: ['step-1'],
        },
      ]

      await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      const stepEvents = capturedEvents.filter((e) => e.type === 'saga.step_executed')
      expect(stepEvents.length).toBe(2)
    })

    it('should support parallel saga steps', async () => {
      // RED: Steps without dependencies can run in parallel
      const saga: SagaStep[] = [
        {
          name: 'parallel-1',
          forward: { type: 'update', sql: 'UPDATE x SET a = 1', shardKey: 'tenant-0' },
          compensate: { type: 'update', sql: 'UPDATE x SET a = 0', shardKey: 'tenant-0' },
        },
        {
          name: 'parallel-2',
          forward: { type: 'update', sql: 'UPDATE x SET b = 1', shardKey: 'tenant-1' },
          compensate: { type: 'update', sql: 'UPDATE x SET b = 0', shardKey: 'tenant-1' },
          // No dependsOn - can run in parallel with parallel-1
        },
        {
          name: 'sequential',
          forward: { type: 'update', sql: 'UPDATE x SET c = 1', shardKey: 'tenant-2' },
          compensate: { type: 'update', sql: 'UPDATE x SET c = 0', shardKey: 'tenant-2' },
          dependsOn: ['parallel-1', 'parallel-2'],
        },
      ]

      const sagaResult = await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      expect(sagaResult.completed).toBe(true)
      expect(sagaResult.executedSteps).toContain('parallel-1')
      expect(sagaResult.executedSteps).toContain('parallel-2')
      expect(sagaResult.executedSteps).toContain('sequential')
    })
  })

  describe('saga compensation', () => {
    it('should compensate executed steps on failure', async () => {
      // RED: Should run compensating transactions in reverse order
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const body = await request.text()
          if (body.includes('step-3')) {
            throw new Error('Step 3 failed')
          }
          return new Response(JSON.stringify({ success: true }))
        }),
      })

      const saga: SagaStep[] = [
        {
          name: 'step-1',
          forward: { type: 'update', sql: 'UPDATE x SET a = 1', shardKey: 'tenant-0' },
          compensate: { type: 'update', sql: 'UPDATE x SET a = 0', shardKey: 'tenant-0' },
        },
        {
          name: 'step-2',
          forward: { type: 'update', sql: 'UPDATE x SET b = 1', shardKey: 'tenant-1' },
          compensate: { type: 'update', sql: 'UPDATE x SET b = 0', shardKey: 'tenant-1' },
          dependsOn: ['step-1'],
        },
        {
          name: 'step-3',
          forward: { type: 'update', sql: 'UPDATE x SET c = 1 -- step-3', shardKey: 'tenant-2' },
          compensate: { type: 'update', sql: 'UPDATE x SET c = 0', shardKey: 'tenant-2' },
          dependsOn: ['step-2'],
        },
      ]

      const sagaResult = await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      expect(sagaResult.completed).toBe(false)
      expect(sagaResult.state).toBe('compensated')
      expect(sagaResult.compensatedSteps).toEqual(['step-2', 'step-1']) // Reverse order
    })

    it('should emit compensation events', async () => {
      // RED: Should emit events for compensations
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const body = await request.text()
          if (body.includes('fail-step')) {
            throw new Error('Intentional failure')
          }
          return new Response(JSON.stringify({ success: true }))
        }),
      })

      const saga: SagaStep[] = [
        {
          name: 'success-step',
          forward: { type: 'update', sql: 'UPDATE x SET a = 1', shardKey: 'tenant-0' },
          compensate: { type: 'update', sql: 'UPDATE x SET a = 0', shardKey: 'tenant-0' },
        },
        {
          name: 'fail-step',
          forward: { type: 'update', sql: 'UPDATE x SET b = 1 -- fail-step', shardKey: 'tenant-1' },
          compensate: { type: 'update', sql: 'UPDATE x SET b = 0', shardKey: 'tenant-1' },
          dependsOn: ['success-step'],
        },
      ]

      await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      const compensationEvents = capturedEvents.filter((e) => e.type === 'saga.step_compensated')
      expect(compensationEvents.length).toBeGreaterThan(0)
    })

    it('should handle compensation failure', async () => {
      // RED: Should report when compensation itself fails
      const mockNamespace = result.env.DO!
      let callCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 2) { // Forward step 2 fails
            throw new Error('Forward failed')
          }
          if (callCount === 3) { // Compensation also fails
            throw new Error('Compensation failed')
          }
          return new Response(JSON.stringify({ success: true }))
        }),
      })

      const saga: SagaStep[] = [
        {
          name: 'step-1',
          forward: { type: 'update', sql: 'UPDATE x SET a = 1', shardKey: 'tenant-0' },
          compensate: { type: 'update', sql: 'UPDATE x SET a = 0', shardKey: 'tenant-0' },
        },
        {
          name: 'step-2',
          forward: { type: 'update', sql: 'UPDATE x SET b = 1', shardKey: 'tenant-1' },
          compensate: { type: 'update', sql: 'UPDATE x SET b = 0', shardKey: 'tenant-1' },
          dependsOn: ['step-1'],
        },
      ]

      const sagaResult = await (result.instance as unknown as {
        executeSaga(steps: SagaStep[]): Promise<SagaResult>
      }).executeSaga(saga)

      expect(sagaResult.state).toBe('failed')
      expect(sagaResult.error?.message).toMatch(/compensation.*failed/i)
    })
  })
})

// ============================================================================
// TEST SUITE: DISTRIBUTED LOCKING
// ============================================================================

describe('shard transactions - distributed locking', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: TransactionEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as TransactionEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('lock acquisition', () => {
    it('should acquire locks across multiple shards', async () => {
      // RED: Should acquire distributed lock
      const lock = await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive'; timeout?: number }): Promise<DistributedLock>
      }).acquireLock([
        'tenant-0:account-1',
        'tenant-1:account-2',
      ], {
        mode: 'exclusive',
      })

      expect(lock.id).toBeDefined()
      expect(lock.resources).toEqual(['tenant-0:account-1', 'tenant-1:account-2'])
      expect(lock.shards.length).toBe(2)
    })

    it('should emit lock acquired event', async () => {
      // RED: Should emit event on lock acquisition
      await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive' }): Promise<DistributedLock>
      }).acquireLock(['tenant-0:resource-1'], { mode: 'exclusive' })

      const lockEvent = capturedEvents.find((e) => e.type === 'lock.acquired')
      expect(lockEvent).toBeDefined()
    })

    it('should timeout if lock cannot be acquired', async () => {
      // RED: Should respect lock timeout
      // Simulate existing lock
      result.storage.data.set('locks', [{
        id: 'existing-lock',
        resources: ['tenant-0:resource-1'],
        owner: 'other-tx',
        expiresAt: new Date(Date.now() + 60000),
        mode: 'exclusive',
      }])

      await expect(
        (result.instance as unknown as {
          acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive'; timeout?: number }): Promise<DistributedLock>
        }).acquireLock(['tenant-0:resource-1'], {
          mode: 'exclusive',
          timeout: 100,
        })
      ).rejects.toThrow(/timeout|lock.*held/i)
    })

    it('should support shared locks', async () => {
      // RED: Multiple transactions can hold shared locks
      const lock1 = await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive' }): Promise<DistributedLock>
      }).acquireLock(['tenant-0:resource-1'], { mode: 'shared' })

      const lock2 = await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive' }): Promise<DistributedLock>
      }).acquireLock(['tenant-0:resource-1'], { mode: 'shared' })

      expect(lock1.id).not.toBe(lock2.id)
      expect(lock1.mode).toBe('shared')
      expect(lock2.mode).toBe('shared')
    })

    it('should block exclusive lock when shared locks exist', async () => {
      // RED: Exclusive should wait for shared locks to release
      await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive' }): Promise<DistributedLock>
      }).acquireLock(['tenant-0:resource-1'], { mode: 'shared' })

      await expect(
        (result.instance as unknown as {
          acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive'; timeout?: number }): Promise<DistributedLock>
        }).acquireLock(['tenant-0:resource-1'], {
          mode: 'exclusive',
          timeout: 100,
        })
      ).rejects.toThrow(/timeout|lock.*held/i)
    })
  })

  describe('lock release', () => {
    it('should release locks', async () => {
      // RED: Should release held locks
      const lock = await (result.instance as unknown as {
        acquireLock(resources: string[], options?: { mode?: 'shared' | 'exclusive' }): Promise<DistributedLock>
      }).acquireLock(['tenant-0:resource-1'], { mode: 'exclusive' })

      await (result.instance as unknown as {
        releaseLock(lockId: string): Promise<void>
      }).releaseLock(lock.id)

      const releaseEvent = capturedEvents.find((e) => e.type === 'lock.released')
      expect(releaseEvent).toBeDefined()
    })

    it('should auto-release locks on transaction commit', async () => {
      // RED: Locks should be released when transaction completes
      await (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
      ], {
        mode: 'two_phase_commit',
      })

      // All transaction locks should be released
      const locks = result.storage.data.get('locks') as DistributedLock[] || []
      expect(locks.length).toBe(0)
    })

    it('should auto-release locks on transaction rollback', async () => {
      // RED: Locks should be released on failure
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockRejectedValue(new Error('Operation failed')),
      })

      try {
        await (result.instance as unknown as {
          executeTransaction(
            operations: TransactionOperation[],
            options?: CrossShardTransactionOptions
          ): Promise<CrossShardTransactionResult>
        }).executeTransaction([
          { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
        ], {
          mode: 'two_phase_commit',
        })
      } catch {
        // Expected
      }

      const locks = result.storage.data.get('locks') as DistributedLock[] || []
      expect(locks.length).toBe(0)
    })
  })

  describe('deadlock detection', () => {
    it('should detect deadlock between transactions', async () => {
      // RED: Should detect circular wait
      // Transaction 1 holds lock A, wants lock B
      // Transaction 2 holds lock B, wants lock A
      result.storage.data.set('locks', [
        {
          id: 'lock-a',
          resources: ['tenant-0:resource-a'],
          owner: 'tx-1',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [0],
        },
        {
          id: 'lock-b',
          resources: ['tenant-1:resource-b'],
          owner: 'tx-2',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [1],
        },
      ])
      result.storage.data.set('pendingLocks', [
        { transactionId: 'tx-1', resource: 'tenant-1:resource-b' },
        { transactionId: 'tx-2', resource: 'tenant-0:resource-a' },
      ])

      const deadlocks = await (result.instance as unknown as {
        detectDeadlocks(): Promise<Array<{ transactions: string[]; cycle: string[] }>>
      }).detectDeadlocks()

      expect(deadlocks.length).toBeGreaterThan(0)
      expect(deadlocks[0].transactions).toContain('tx-1')
      expect(deadlocks[0].transactions).toContain('tx-2')
    })

    it('should emit deadlock detected event', async () => {
      // RED: Should emit event on deadlock detection
      result.storage.data.set('locks', [
        {
          id: 'lock-a',
          resources: ['tenant-0:resource-a'],
          owner: 'tx-1',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [0],
        },
        {
          id: 'lock-b',
          resources: ['tenant-1:resource-b'],
          owner: 'tx-2',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [1],
        },
      ])
      result.storage.data.set('pendingLocks', [
        { transactionId: 'tx-1', resource: 'tenant-1:resource-b' },
        { transactionId: 'tx-2', resource: 'tenant-0:resource-a' },
      ])

      await (result.instance as unknown as {
        detectDeadlocks(): Promise<Array<{ transactions: string[]; cycle: string[] }>>
      }).detectDeadlocks()

      const deadlockEvent = capturedEvents.find((e) => e.type === 'deadlock.detected')
      expect(deadlockEvent).toBeDefined()
    })

    it('should resolve deadlock by aborting younger transaction', async () => {
      // RED: Should use wait-die or wound-wait scheme
      result.storage.data.set('transactions', [
        { id: 'tx-1', startedAt: new Date(Date.now() - 60000) }, // Older
        { id: 'tx-2', startedAt: new Date(Date.now() - 30000) }, // Younger
      ])
      result.storage.data.set('locks', [
        {
          id: 'lock-a',
          resources: ['tenant-0:resource-a'],
          owner: 'tx-1',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [0],
        },
        {
          id: 'lock-b',
          resources: ['tenant-1:resource-b'],
          owner: 'tx-2',
          expiresAt: new Date(Date.now() + 60000),
          mode: 'exclusive',
          shards: [1],
        },
      ])
      result.storage.data.set('pendingLocks', [
        { transactionId: 'tx-1', resource: 'tenant-1:resource-b' },
        { transactionId: 'tx-2', resource: 'tenant-0:resource-a' },
      ])

      const resolution = await (result.instance as unknown as {
        resolveDeadlock(deadlock: { transactions: string[] }): Promise<{ abortedTransaction: string }>
      }).resolveDeadlock({ transactions: ['tx-1', 'tx-2'] })

      // Younger transaction (tx-2) should be aborted
      expect(resolution.abortedTransaction).toBe('tx-2')
    })
  })
})

// ============================================================================
// TEST SUITE: ISOLATION LEVELS
// ============================================================================

describe('shard transactions - isolation levels', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should support read_committed isolation', async () => {
    // RED: Should only see committed data
    const txResult = await (result.instance as unknown as {
      executeTransaction(
        operations: TransactionOperation[],
        options?: CrossShardTransactionOptions
      ): Promise<CrossShardTransactionResult>
    }).executeTransaction([
      { type: 'query', sql: 'SELECT * FROM things', shardKey: 'tenant-0' },
    ], {
      isolation: 'read_committed',
    })

    expect(txResult.committed).toBe(true)
  })

  it('should support repeatable_read isolation', async () => {
    // RED: Same query should return same results within transaction
    const txResult = await (result.instance as unknown as {
      executeTransaction(
        operations: TransactionOperation[],
        options?: CrossShardTransactionOptions
      ): Promise<CrossShardTransactionResult>
    }).executeTransaction([
      { type: 'query', sql: 'SELECT * FROM things WHERE id = 1', shardKey: 'tenant-0' },
      { type: 'update', sql: 'UPDATE other SET x = 1', shardKey: 'tenant-0' },
      { type: 'query', sql: 'SELECT * FROM things WHERE id = 1', shardKey: 'tenant-0' }, // Should see same result
    ], {
      isolation: 'repeatable_read',
    })

    expect(txResult.committed).toBe(true)
    // Both SELECT results should be identical (even if external changes occurred)
  })

  it('should support serializable isolation', async () => {
    // RED: Transactions should appear to execute serially
    const txResult = await (result.instance as unknown as {
      executeTransaction(
        operations: TransactionOperation[],
        options?: CrossShardTransactionOptions
      ): Promise<CrossShardTransactionResult>
    }).executeTransaction([
      { type: 'query', sql: 'SELECT COUNT(*) FROM things', shardKey: 'tenant-0' },
      { type: 'insert', sql: 'INSERT INTO things VALUES (?)', params: ['new'], shardKey: 'tenant-0' },
    ], {
      isolation: 'serializable',
    })

    expect(txResult.committed).toBe(true)
  })

  it('should detect serialization conflicts', async () => {
    // RED: Should detect conflicting concurrent transactions
    // Start two serializable transactions that conflict
    const tx1 = (result.instance as unknown as {
      executeTransaction(
        operations: TransactionOperation[],
        options?: CrossShardTransactionOptions
      ): Promise<CrossShardTransactionResult>
    }).executeTransaction([
      { type: 'query', sql: 'SELECT * FROM things WHERE id = 1', shardKey: 'tenant-0' },
      { type: 'update', sql: 'UPDATE things SET version = version + 1 WHERE id = 1', shardKey: 'tenant-0' },
    ], {
      isolation: 'serializable',
    })

    const tx2 = (result.instance as unknown as {
      executeTransaction(
        operations: TransactionOperation[],
        options?: CrossShardTransactionOptions
      ): Promise<CrossShardTransactionResult>
    }).executeTransaction([
      { type: 'query', sql: 'SELECT * FROM things WHERE id = 1', shardKey: 'tenant-0' },
      { type: 'update', sql: 'UPDATE things SET version = version + 1 WHERE id = 1', shardKey: 'tenant-0' },
    ], {
      isolation: 'serializable',
    })

    const results = await Promise.allSettled([tx1, tx2])

    // At least one should have conflict
    const failures = results.filter((r) =>
      r.status === 'rejected' ||
      (r.status === 'fulfilled' && !r.value.committed)
    )
    expect(failures.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// TEST SUITE: VALIDATION
// ============================================================================

describe('shard transactions - validation', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should reject transaction on non-sharded DO', async () => {
    // RED: Cannot run cross-shard transaction if not sharded
    result.storage.data.set('isSharded', false)
    result.storage.data.delete('shardRegistry')

    await expect(
      (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
      ])
    ).rejects.toThrow(/not.*sharded/i)
  })

  it('should reject empty transaction', async () => {
    // RED: Transaction must have operations
    await expect(
      (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([])
    ).rejects.toThrow(/empty|no.*operations/i)
  })

  it('should reject invalid isolation level', async () => {
    // RED: Isolation level must be valid
    await expect(
      (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
      ], {
        isolation: 'invalid' as IsolationLevel,
      })
    ).rejects.toThrow(/invalid.*isolation/i)
  })

  it('should reject invalid transaction mode', async () => {
    // RED: Mode must be valid
    await expect(
      (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE x SET y = 1', shardKey: 'tenant-0' },
      ], {
        mode: 'invalid' as TransactionMode,
      })
    ).rejects.toThrow(/invalid.*mode/i)
  })

  it('should validate shard key in operations', async () => {
    // RED: Operations must have valid shard routing
    await expect(
      (result.instance as unknown as {
        executeTransaction(
          operations: TransactionOperation[],
          options?: CrossShardTransactionOptions
        ): Promise<CrossShardTransactionResult>
      }).executeTransaction([
        { type: 'update', sql: 'UPDATE x SET y = 1' }, // No shard key
      ])
    ).rejects.toThrow(/shard.*key|routing/i)
  })
})
