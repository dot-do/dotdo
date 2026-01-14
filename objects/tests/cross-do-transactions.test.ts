/**
 * Cross-DO Transaction Safety Tests
 *
 * TDD GREEN Phase: These tests verify the transactional behavior for
 * coordinating operations across multiple Durable Objects.
 *
 * Key Challenges:
 * - DOs are single-threaded but cross-DO calls are async
 * - No distributed transaction support in Cloudflare
 * - Need saga pattern for eventual consistency with compensation
 * - Need 2PC for critical atomic operations
 *
 * Patterns Implemented:
 * 1. Single DO transaction isolation (baseline)
 * 2. Saga pattern with compensating transactions
 * 3. Two-Phase Commit (2PC) for atomic multi-DO operations
 * 4. Failure recovery with compensation
 * 5. Timeout handling for cross-DO calls
 * 6. Idempotency keys to prevent duplicate execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CrossDOSaga,
  TwoPhaseCommit,
  IdempotencyKeyManager,
  SqliteIdempotencyKeyManager,
  createPersistentIdempotencyStore,
  crossDOCallWithTimeout,
  type SagaStep,
  type SagaResult,
  type TwoPhaseParticipant,
  type TwoPhaseResult,
} from '../CrossDOTransaction'

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Cross-DO Transaction Safety', () => {
  // ==========================================================================
  // 1. SINGLE DO TRANSACTION ISOLATION
  // ==========================================================================

  describe('Single DO Transaction Isolation', () => {
    it('should execute operations atomically within a single DO', async () => {
      // This tests the baseline - single DO is already atomic due to single-threading
      const executionLog: string[] = []

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'localOp1',
          execute: async () => {
            executionLog.push('op1-start')
            await new Promise(r => setTimeout(r, 10))
            executionLog.push('op1-end')
            return 'result1'
          },
        })
        .addStep({
          name: 'localOp2',
          execute: async (input: string) => {
            executionLog.push('op2-start')
            await new Promise(r => setTimeout(r, 10))
            executionLog.push('op2-end')
            return `${input}-result2`
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(result.result).toBe('result1-result2')
      // Operations should complete in order (no interleaving)
      expect(executionLog).toEqual(['op1-start', 'op1-end', 'op2-start', 'op2-end'])
    })

    it('should maintain consistency even with concurrent access attempts', async () => {
      // This test validates that each saga instance maintains its own execution state
      // In a real DO, concurrent requests are serialized by the runtime.
      // Here we verify that saga execution is self-contained and consistent.
      const results: string[] = []

      // Create independent sagas with different inputs
      const saga1 = new CrossDOSaga<string, string>()
        .addStep({
          name: 'process',
          execute: async (input) => {
            await new Promise(r => setTimeout(r, 5))
            return `processed-${input}`
          },
        })

      const saga2 = new CrossDOSaga<string, string>()
        .addStep({
          name: 'process',
          execute: async (input) => {
            await new Promise(r => setTimeout(r, 5))
            return `processed-${input}`
          },
        })

      const saga3 = new CrossDOSaga<string, string>()
        .addStep({
          name: 'process',
          execute: async (input) => {
            await new Promise(r => setTimeout(r, 5))
            return `processed-${input}`
          },
        })

      // Execute concurrent sagas with different inputs
      const sagaResults = await Promise.all([
        saga1.execute('A'),
        saga2.execute('B'),
        saga3.execute('C'),
      ])

      sagaResults.forEach(r => {
        if (r.success && r.result) results.push(r.result)
      })

      // All results should be present and unique
      expect(results.length).toBe(3)
      expect(new Set(results).size).toBe(3)
      expect(results).toContain('processed-A')
      expect(results).toContain('processed-B')
      expect(results).toContain('processed-C')
    })
  })

  // ==========================================================================
  // 2. SAGA PATTERN WITH COMPENSATING TRANSACTIONS
  // ==========================================================================

  describe('Cross-DO Saga Pattern', () => {
    it('should execute all steps in order across DOs', async () => {
      const executionOrder: string[] = []

      const saga = new CrossDOSaga<{ orderId: string }, string>()
        .addStep({
          name: 'reserveInventory',
          targetDO: 'InventoryDO',
          execute: async (input: { orderId: string }) => {
            executionOrder.push('reserveInventory')
            return { reservationId: `res_${input.orderId}` }
          },
        })
        .addStep({
          name: 'processPayment',
          targetDO: 'PaymentDO',
          execute: async (input: { reservationId: string }) => {
            executionOrder.push('processPayment')
            return { paymentId: `pay_${input.reservationId}` }
          },
        })
        .addStep({
          name: 'createShipment',
          targetDO: 'ShippingDO',
          execute: async (input: { paymentId: string }) => {
            executionOrder.push('createShipment')
            return { shipmentId: `ship_${input.paymentId}` }
          },
        })

      const result = await saga.execute({ orderId: 'order_123' })

      expect(result.success).toBe(true)
      expect(executionOrder).toEqual(['reserveInventory', 'processPayment', 'createShipment'])
      expect(result.steps).toHaveLength(3)
      expect(result.steps.every(s => s.success)).toBe(true)
    })

    it('should run compensations in reverse order on failure', async () => {
      const compensations: string[] = []

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          targetDO: 'DO1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          targetDO: 'DO2',
          execute: async () => 'result2',
          compensate: async () => {
            compensations.push('compensate2')
          },
        })
        .addStep({
          name: 'step3',
          targetDO: 'DO3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
          compensate: async () => {
            compensations.push('compensate3')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Step 3 failed')
      expect(result.compensated).toBe(true)
      // Compensations run in reverse order, excluding failed step
      expect(compensations).toEqual(['compensate2', 'compensate1'])
    })

    it('should not compensate steps that did not execute', async () => {
      const compensations: string[] = []

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          execute: async () => {
            throw new Error('First step fails')
          },
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
            compensations.push('compensate2')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      // No compensations should run since step1 failed before completing
      expect(compensations).toEqual([])
      expect(result.compensated).toBe(false)
    })

    it('should handle compensation failures gracefully', async () => {
      const compensations: string[] = []

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
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
      // Should continue compensation despite step2's compensation failing
      expect(compensations).toContain('compensate1')
      expect(result.compensationErrors).toHaveLength(1)
      expect(result.compensationErrors?.[0]?.message).toBe('Compensation 2 failed')
    })

    it('should track step results for compensation', async () => {
      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'createResource',
          execute: async () => ({ resourceId: 'res_123', created: true }),
          compensate: async (result) => {
            // Compensation receives the result from execute
            expect(result).toEqual({ resourceId: 'res_123', created: true })
          },
        })
        .addStep({
          name: 'failingStep',
          execute: async () => {
            throw new Error('Deliberate failure')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.steps[0]?.result).toEqual({ resourceId: 'res_123', created: true })
    })
  })

  // ==========================================================================
  // 3. TWO-PHASE COMMIT (2PC)
  // ==========================================================================

  describe('Two-Phase Commit (2PC)', () => {
    it('should prepare all participants before committing', async () => {
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
            return true
          },
          commit: async () => {
            phases.push('p2-commit')
          },
          rollback: async () => {
            phases.push('p2-rollback')
          },
        })

      const result = await tpc.execute()

      expect(result.success).toBe(true)
      expect(result.phase).toBe('complete')
      // All prepares should happen before any commits
      const prepareEndIndex = Math.max(
        phases.indexOf('p1-prepare'),
        phases.indexOf('p2-prepare')
      )
      const commitStartIndex = Math.min(
        phases.indexOf('p1-commit'),
        phases.indexOf('p2-commit')
      )
      expect(prepareEndIndex).toBeLessThan(commitStartIndex)
    })

    it('should rollback all participants if any prepare fails', async () => {
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

      const result = await tpc.execute()

      expect(result.success).toBe(false)
      expect(result.phase).toBe('rollback')
      // No commits should happen
      expect(phases).not.toContain('p1-commit')
      expect(phases).not.toContain('p2-commit')
      // All participants that prepared should rollback
      expect(phases).toContain('p1-rollback')
    })

    it('should rollback on commit failure', async () => {
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
            return true
          },
          commit: async () => {
            phases.push('p2-commit')
            throw new Error('Commit failed')
          },
          rollback: async () => {
            phases.push('p2-rollback')
          },
        })

      const result = await tpc.execute()

      expect(result.success).toBe(false)
      // Should attempt rollback for all participants
      expect(phases).toContain('p1-rollback')
      expect(phases).toContain('p2-rollback')
    })

    it('should track participant states throughout execution', async () => {
      const tpc = new TwoPhaseCommit()
        .addParticipant({
          id: 'p1',
          prepare: async () => true,
          commit: async () => {},
          rollback: async () => {},
        })
        .addParticipant({
          id: 'p2',
          prepare: async () => true,
          commit: async () => {},
          rollback: async () => {},
        })

      const result = await tpc.execute()

      expect(result.participantResults.get('p1')).toEqual({
        prepared: true,
        committed: true,
      })
      expect(result.participantResults.get('p2')).toEqual({
        prepared: true,
        committed: true,
      })
    })
  })

  // ==========================================================================
  // 4. FAILURE RECOVERY WITH COMPENSATION
  // ==========================================================================

  describe('Failure Recovery', () => {
    it('should retry failed steps before compensating', async () => {
      let attempts = 0

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'flaky',
          retry: { maxAttempts: 3, backoffMs: 10 },
          execute: async () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Transient error')
            }
            return 'success'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })

    it('should compensate after exhausting retries', async () => {
      let attempts = 0
      let compensated = false

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'setup',
          execute: async () => 'done',
          compensate: async () => {
            compensated = true
          },
        })
        .addStep({
          name: 'alwaysFails',
          retry: { maxAttempts: 3, backoffMs: 10 },
          execute: async () => {
            attempts++
            throw new Error('Persistent failure')
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(attempts).toBe(3)
      expect(compensated).toBe(true)
    })

    it('should use exponential backoff for retries', async () => {
      const attemptTimes: number[] = []

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'backoffTest',
          retry: { maxAttempts: 4, backoffMs: 50 },
          execute: async () => {
            attemptTimes.push(Date.now())
            if (attemptTimes.length < 4) {
              throw new Error('Keep retrying')
            }
            return 'success'
          },
        })

      await saga.execute()

      // Check that delays increase (roughly)
      const delays = attemptTimes.slice(1).map((t, i) => t - attemptTimes[i]!)
      // Each delay should be >= previous (with some tolerance for timing)
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]! * 0.8)
      }
    })
  })

  // ==========================================================================
  // 5. TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('should timeout slow cross-DO calls', async () => {
      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'slowStep',
          targetDO: 'SlowDO',
          timeout: 50,
          execute: async () => {
            await new Promise(r => setTimeout(r, 200))
            return 'too late'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toMatch(/timed out/i)
    })

    it('should compensate previous steps on timeout', async () => {
      let compensated = false

      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'fastStep',
          execute: async () => 'done',
          compensate: async () => {
            compensated = true
          },
        })
        .addStep({
          name: 'slowStep',
          timeout: 50,
          execute: async () => {
            await new Promise(r => setTimeout(r, 200))
            return 'too late'
          },
        })

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(compensated).toBe(true)
    })

    it('should handle timeout during compensation gracefully', async () => {
      const saga = new CrossDOSaga<void, void>()
        .addStep({
          name: 'step1',
          execute: async () => 'done',
          compensate: async () => {
            // Slow compensation
            await new Promise(r => setTimeout(r, 200))
          },
        })
        .addStep({
          name: 'failingStep',
          execute: async () => {
            throw new Error('Trigger compensation')
          },
        })

      // Should not hang indefinitely
      const result = await Promise.race([
        saga.execute(),
        new Promise<SagaResult>(resolve =>
          setTimeout(() => resolve({
            success: false,
            error: new Error('Test timeout'),
            steps: [],
            compensated: false,
            duration: 5000,
          }), 5000)
        ),
      ])

      expect(result.duration).toBeLessThan(5000)
    })

    it('should use crossDOCallWithTimeout for external calls', async () => {
      const slowCall = async () => {
        await new Promise(r => setTimeout(r, 200))
        return 'result'
      }

      await expect(
        crossDOCallWithTimeout(slowCall, 50, 'TestDO')
      ).rejects.toThrow(/timed out/i)
    })
  })

  // ==========================================================================
  // 6. IDEMPOTENCY KEYS
  // ==========================================================================

  describe('Idempotency Keys', () => {
    it('should prevent duplicate execution with same idempotency key', async () => {
      let executionCount = 0

      const saga = new CrossDOSaga<void, string>()
        .addStep({
          name: 'countedStep',
          execute: async () => {
            executionCount++
            return `result-${executionCount}`
          },
        })

      const key = 'unique-key-123'

      // First execution
      const result1 = await saga.execute(undefined, { idempotencyKey: key })
      // Second execution with same key
      const result2 = await saga.execute(undefined, { idempotencyKey: key })

      expect(executionCount).toBe(1)
      expect(result1.result).toBe('result-1')
      expect(result2.result).toBe('result-1') // Same result as first
    })

    it('should allow execution with different idempotency keys', async () => {
      let executionCount = 0

      const saga = new CrossDOSaga<void, number>()
        .addStep({
          name: 'countedStep',
          execute: async () => {
            executionCount++
            return executionCount
          },
        })

      await saga.execute(undefined, { idempotencyKey: 'key-1' })
      await saga.execute(undefined, { idempotencyKey: 'key-2' })
      await saga.execute(undefined, { idempotencyKey: 'key-3' })

      expect(executionCount).toBe(3)
    })

    it('should expire idempotency keys after TTL', async () => {
      const manager = new IdempotencyKeyManager()
      const key = 'expiring-key'

      await manager.set(key, 'value', 50) // 50ms TTL

      expect(await manager.has(key)).toBe(true)

      await new Promise(r => setTimeout(r, 100))

      expect(await manager.has(key)).toBe(false)
    })

    it('should store and retrieve idempotency results', async () => {
      const manager = new IdempotencyKeyManager()
      const key = 'stored-key'
      const result = { orderId: 'ord_123', status: 'completed' }

      await manager.set(key, result)

      const retrieved = await manager.get<typeof result>(key)
      expect(retrieved).toEqual(result)
    })

    it('should return undefined for unknown keys', async () => {
      const manager = new IdempotencyKeyManager()

      const result = await manager.get('unknown-key')
      expect(result).toBeUndefined()
    })

    it('should delete idempotency keys', async () => {
      const manager = new IdempotencyKeyManager()
      const key = 'deletable-key'

      await manager.set(key, 'value')
      expect(await manager.has(key)).toBe(true)

      const deleted = await manager.delete(key)
      expect(deleted).toBe(true)
      expect(await manager.has(key)).toBe(false)
    })
  })

  // ==========================================================================
  // 7. SQLITE IDEMPOTENCY KEY MANAGER (Persistent)
  // ==========================================================================

  describe('SqliteIdempotencyKeyManager (Persistent Storage)', () => {
    // Mock SQL interface that simulates DO SQLite behavior
    function createMockSql() {
      const tables = new Map<string, unknown[]>()
      const indexes = new Set<string>()

      return {
        exec: <T = unknown>(query: string, ...params: unknown[]): { toArray(): T[]; one(): T | null } => {
          const normalizedQuery = query.trim().toLowerCase()

          // Handle CREATE TABLE
          if (normalizedQuery.startsWith('create table')) {
            const tableMatch = query.match(/create table if not exists (\w+)/i)
            if (tableMatch) {
              const tableName = tableMatch[1]!
              if (!tables.has(tableName)) {
                tables.set(tableName, [])
              }
            }
            return { toArray: () => [] as T[], one: () => null }
          }

          // Handle CREATE INDEX
          if (normalizedQuery.startsWith('create index')) {
            const indexMatch = query.match(/create index if not exists (\w+)/i)
            if (indexMatch) {
              indexes.add(indexMatch[1]!)
            }
            return { toArray: () => [] as T[], one: () => null }
          }

          // Handle INSERT (with ON CONFLICT UPSERT)
          if (normalizedQuery.startsWith('insert')) {
            const tableMatch = query.match(/insert into (\w+)/i)
            if (tableMatch) {
              const tableName = tableMatch[1]!
              const tableData = tables.get(tableName) || []

              const [key, result, created_at, expires_at] = params
              // Check for existing key and update or insert
              const existingIndex = tableData.findIndex((row: unknown) => (row as { key: string }).key === key)
              const newRow = { key, result, created_at, expires_at }

              if (existingIndex >= 0) {
                tableData[existingIndex] = newRow
              } else {
                tableData.push(newRow)
              }
              tables.set(tableName, tableData)
            }
            return { toArray: () => [] as T[], one: () => null }
          }

          // Handle SELECT with WHERE key = ?
          if (normalizedQuery.includes('select') && normalizedQuery.includes('from idempotency_keys')) {
            const tableData = tables.get('idempotency_keys') || []

            // SELECT COUNT(*)
            if (normalizedQuery.includes('count(*)')) {
              if (normalizedQuery.includes('expires_at is not null and expires_at <=')) {
                const now = params[0] as number
                const count = tableData.filter((row: unknown) => {
                  const r = row as { expires_at: number | null }
                  return r.expires_at !== null && r.expires_at <= now
                }).length
                return { toArray: () => [{ count }] as T[], one: () => ({ count }) as T }
              }
              return { toArray: () => [{ count: tableData.length }] as T[], one: () => ({ count: tableData.length }) as T }
            }

            // SELECT with key filter
            if (normalizedQuery.includes('where key = ?')) {
              const [key, now] = params
              const found = tableData.find((row: unknown) => {
                const r = row as { key: string; expires_at: number | null }
                return r.key === key && (r.expires_at === null || r.expires_at > (now as number))
              })
              return {
                toArray: () => (found ? [found] : []) as T[],
                one: () => (found || null) as T | null,
              }
            }

            // SELECT all non-expired keys
            if (normalizedQuery.includes('expires_at is null or expires_at >')) {
              const now = params[0] as number
              const results = tableData.filter((row: unknown) => {
                const r = row as { expires_at: number | null }
                return r.expires_at === null || r.expires_at > now
              })
              return { toArray: () => results as T[], one: () => (results[0] || null) as T | null }
            }
          }

          // Handle DELETE
          if (normalizedQuery.startsWith('delete')) {
            const tableMatch = query.match(/delete from (\w+)/i)
            if (tableMatch) {
              const tableName = tableMatch[1]!
              const tableData = tables.get(tableName) || []

              if (normalizedQuery.includes('where key = ?')) {
                const key = params[0]
                tables.set(
                  tableName,
                  tableData.filter((row: unknown) => (row as { key: string }).key !== key)
                )
              } else if (normalizedQuery.includes('expires_at is not null and expires_at <=')) {
                const now = params[0] as number
                tables.set(
                  tableName,
                  tableData.filter((row: unknown) => {
                    const r = row as { expires_at: number | null }
                    return r.expires_at === null || r.expires_at > now
                  })
                )
              } else {
                // Clear all
                tables.set(tableName, [])
              }
            }
            return { toArray: () => [] as T[], one: () => null }
          }

          return { toArray: () => [] as T[], one: () => null }
        },
      }
    }

    it('should store and retrieve idempotency results', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)
      const key = 'stored-key'
      const result = { orderId: 'ord_123', status: 'completed' }

      await manager.set(key, result)

      const retrieved = await manager.get<typeof result>(key)
      expect(retrieved).toEqual(result)
    })

    it('should check key existence', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      expect(await manager.has('nonexistent')).toBe(false)

      await manager.set('exists', { value: 1 })
      expect(await manager.has('exists')).toBe(true)
    })

    it('should delete keys', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('to-delete', { value: 1 })
      expect(await manager.has('to-delete')).toBe(true)

      const deleted = await manager.delete('to-delete')
      expect(deleted).toBe(true)
      expect(await manager.has('to-delete')).toBe(false)
    })

    it('should return false when deleting non-existent key', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      const deleted = await manager.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('should expire keys after TTL', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)
      const key = 'expiring-key'

      await manager.set(key, 'value', 50) // 50ms TTL

      expect(await manager.has(key)).toBe(true)

      await new Promise((r) => setTimeout(r, 100))

      expect(await manager.has(key)).toBe(false)
    })

    it('should use default TTL when not specified', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql, { defaultTtlMs: 100 })

      await manager.set('default-ttl-key', 'value')

      expect(await manager.has('default-ttl-key')).toBe(true)

      await new Promise((r) => setTimeout(r, 150))

      expect(await manager.has('default-ttl-key')).toBe(false)
    })

    it('should clear all keys', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('key1', 'value1')
      await manager.set('key2', 'value2')

      expect(manager.keys().length).toBe(2)

      await manager.clear()

      expect(manager.keys().length).toBe(0)
    })

    it('should list all non-expired keys', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('key1', 'value1')
      await manager.set('key2', 'value2')
      await manager.set('key3', 'value3')

      const keys = manager.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should cleanup expired keys', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('expires-soon', 'value', 50)
      await manager.set('expires-later', 'value', 10000)

      await new Promise((r) => setTimeout(r, 100))

      const cleaned = await manager.cleanupExpired()
      expect(cleaned).toBe(1)

      expect(await manager.has('expires-soon')).toBe(false)
      expect(await manager.has('expires-later')).toBe(true)
    })

    it('should report stats correctly', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('active1', 'value', 10000)
      await manager.set('active2', 'value', 10000)
      await manager.set('expired', 'value', 1)

      await new Promise((r) => setTimeout(r, 10))

      const stats = await manager.stats()
      expect(stats.total).toBe(3)
      expect(stats.expired).toBe(1)
      expect(stats.active).toBe(2)
    })

    it('should handle upsert (update existing key)', async () => {
      const sql = createMockSql()
      const manager = new SqliteIdempotencyKeyManager(sql)

      await manager.set('key', { version: 1 })
      expect(await manager.get('key')).toEqual({ version: 1 })

      await manager.set('key', { version: 2 })
      expect(await manager.get('key')).toEqual({ version: 2 })
    })

    it('should create manager using factory function', async () => {
      const sql = createMockSql()
      const manager = createPersistentIdempotencyStore(sql, { defaultTtlMs: 5000 })

      expect(manager).toBeInstanceOf(SqliteIdempotencyKeyManager)

      await manager.set('test', 'value')
      expect(await manager.get('test')).toBe('value')
    })

    it('should work with CrossDOSaga for persistent idempotency', async () => {
      const sql = createMockSql()
      const idempotencyStore = new SqliteIdempotencyKeyManager(sql)
      let executionCount = 0

      const saga = new CrossDOSaga<void, string>({ idempotencyStore })
        .addStep({
          name: 'countedStep',
          execute: async () => {
            executionCount++
            return `result-${executionCount}`
          },
        })

      const key = 'persistent-key-123'

      // First execution
      const result1 = await saga.execute(undefined, { idempotencyKey: key })
      expect(executionCount).toBe(1)
      expect(result1.result).toBe('result-1')

      // Second execution with same key (should return cached result)
      const result2 = await saga.execute(undefined, { idempotencyKey: key })
      expect(executionCount).toBe(1) // Not incremented
      expect(result2.result).toBe('result-1') // Same result
    })
  })

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Real-World Integration Scenarios', () => {
    it('should handle e-commerce checkout saga', async () => {
      const events: string[] = []

      interface Order { id: string; total: number }
      interface Reservation { id: string; items: string[] }
      interface Payment { id: string; amount: number }
      interface Shipment { id: string }

      const checkoutSaga = new CrossDOSaga<Order, Shipment>()
        .addStep<Order, Reservation>({
          name: 'reserveInventory',
          targetDO: 'InventoryDO',
          execute: async (order) => {
            events.push(`reserve:${order.id}`)
            return { id: `res_${order.id}`, items: ['item1', 'item2'] }
          },
          compensate: async (reservation) => {
            events.push(`release:${reservation.id}`)
          },
        })
        .addStep<Reservation, Payment>({
          name: 'processPayment',
          targetDO: 'PaymentDO',
          execute: async (reservation) => {
            events.push(`charge:${reservation.id}`)
            return { id: `pay_${reservation.id}`, amount: 100 }
          },
          compensate: async (payment) => {
            events.push(`refund:${payment.id}`)
          },
        })
        .addStep<Payment, Shipment>({
          name: 'createShipment',
          targetDO: 'ShippingDO',
          execute: async (payment) => {
            events.push(`ship:${payment.id}`)
            return { id: `ship_${payment.id}` }
          },
          compensate: async (shipment) => {
            events.push(`cancel:${shipment.id}`)
          },
        })

      const result = await checkoutSaga.execute({ id: 'order_1', total: 100 })

      expect(result.success).toBe(true)
      expect(events).toEqual([
        'reserve:order_1',
        'charge:res_order_1',
        'ship:pay_res_order_1',
      ])
    })

    it('should handle checkout failure with compensation', async () => {
      const events: string[] = []

      const failingCheckoutSaga = new CrossDOSaga<{ id: string }, void>()
        .addStep({
          name: 'reserveInventory',
          execute: async (order: { id: string }) => {
            events.push(`reserve:${order.id}`)
            return { id: `res_${order.id}` }
          },
          compensate: async (reservation: { id: string }) => {
            events.push(`release:${reservation.id}`)
          },
        })
        .addStep({
          name: 'processPayment',
          execute: async () => {
            events.push('payment-attempt')
            throw new Error('Card declined')
          },
          compensate: async () => {
            events.push('refund-attempted')
          },
        })

      const result = await failingCheckoutSaga.execute({ id: 'order_2' })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Card declined')
      expect(events).toContain('release:res_order_2')
    })

    it('should use 2PC for cross-DO atomic transfer', async () => {
      let account1Balance = 1000
      let account2Balance = 500
      const transferAmount = 200

      const transfer = new TwoPhaseCommit({ timeout: 5000 })
        .addParticipant({
          id: 'account1',
          prepare: async () => {
            // Check sufficient balance
            return account1Balance >= transferAmount
          },
          commit: async () => {
            account1Balance -= transferAmount
          },
          rollback: async () => {
            // Nothing to rollback if not committed
          },
        })
        .addParticipant({
          id: 'account2',
          prepare: async () => {
            // Account2 is always ready to receive
            return true
          },
          commit: async () => {
            account2Balance += transferAmount
          },
          rollback: async () => {
            // Nothing to rollback if not committed
          },
        })

      const result = await transfer.execute()

      expect(result.success).toBe(true)
      expect(account1Balance).toBe(800)
      expect(account2Balance).toBe(700)
    })

    it('should rollback atomic transfer on insufficient funds', async () => {
      let account1Balance = 100 // Insufficient
      let account2Balance = 500
      const transferAmount = 200

      const transfer = new TwoPhaseCommit()
        .addParticipant({
          id: 'account1',
          prepare: async () => {
            return account1Balance >= transferAmount // Will return false
          },
          commit: async () => {
            account1Balance -= transferAmount
          },
          rollback: async () => {},
        })
        .addParticipant({
          id: 'account2',
          prepare: async () => true,
          commit: async () => {
            account2Balance += transferAmount
          },
          rollback: async () => {},
        })

      const result = await transfer.execute()

      expect(result.success).toBe(false)
      // Balances should be unchanged
      expect(account1Balance).toBe(100)
      expect(account2Balance).toBe(500)
    })
  })
})
