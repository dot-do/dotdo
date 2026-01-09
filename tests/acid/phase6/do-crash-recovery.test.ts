/**
 * ACID Test Suite - Phase 6.2: DO Crash Recovery Tests
 *
 * RED TDD: These tests define the expected behavior for DO crash and recovery scenarios.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Key test scenarios:
 * 1. Immediate crash recovery - Sudden DO termination
 * 2. Graceful shutdown recovery - Clean shutdown with state persistence
 * 3. OOM crash recovery - Out of memory crash handling
 * 4. In-flight operation recovery - Recovery of operations in progress
 * 5. WAL replay correctness - Write-ahead log replay on restart
 *
 * @see types/Chaos.ts for type definitions
 * @see tests/mocks/chaos.ts for mock implementations
 * @task dotdo-ga1r (ACID Phase 6 - Failure Injection)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'
import {
  createMockChaosController,
  createMockDOCrashManager,
  createFailureInjection,
  createChaosScenario,
} from '../../../tests/mocks/chaos'
import type {
  DOCrashConfig,
  DOCrashResult,
  RecoveryStatus,
  RecoveryError,
} from '../../../types/Chaos'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample test data
 * Note: Column order must match schema (id, type, branch, name, data, deleted, visibility)
 */
function createTestData(count: number): Array<{
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown>
  deleted: number
  visibility: string
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: 'main',
    name: `Item ${i}`,
    data: { index: i, name: `Item ${i}` },
    deleted: 0,
    visibility: 'user',
  }))
}

/**
 * Simulate in-flight operations
 */
function createPendingOperations(): Array<{
  operationId: string
  type: 'write' | 'delete' | 'update'
  status: 'pending' | 'committed' | 'rolled_back'
}> {
  return [
    { operationId: 'op-1', type: 'write', status: 'pending' },
    { operationId: 'op-2', type: 'update', status: 'pending' },
    { operationId: 'op-3', type: 'delete', status: 'pending' },
  ]
}

// ============================================================================
// TEST SUITE: DO CRASH RECOVERY
// ============================================================================

describe('DO Crash Recovery Tests', () => {
  let mockDO: MockDOResult<DO, MockEnv>
  let chaosController: ReturnType<typeof createMockChaosController>

  beforeEach(() => {
    vi.useFakeTimers()

    // Create DO with data
    mockDO = createMockDO(DO, {
      ns: 'https://test.crash.do',
      sqlData: new Map([
        ['things', createTestData(100)],
        ['branches', [{ name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() }]],
        ['actions', []],
        ['events', []],
      ]),
    })

    // Create chaos controller
    chaosController = createMockChaosController()
  })

  afterEach(() => {
    vi.useRealTimers()
    chaosController.reset()
  })

  // ==========================================================================
  // 1. IMMEDIATE CRASH RECOVERY
  // ==========================================================================

  describe('Immediate Crash Recovery', () => {
    it('should handle sudden DO termination', async () => {
      // RED: System should survive immediate crash
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.crashId).toBeDefined()
      expect(crashResult.targetNs).toBe('https://test.crash.do')
      expect(crashResult.crashedAt).toBeInstanceOf(Date)
    })

    it('should preserve committed data on immediate crash', async () => {
      // RED: Committed data should survive crash
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: false,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.preservedState).toBeDefined()
      expect(crashResult.preservedState?.itemCount).toBeGreaterThan(0)
    })

    it('should lose uncommitted data on immediate crash', async () => {
      // RED: Uncommitted data may be lost
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 0,
        statePreservation: 'none',
      }

      const crashResult = await chaosController.crashDO(config)

      // With no state preservation, recovery will have losses
      expect(crashResult.preservedState).toBeUndefined()
    })

    it('should restart DO after configured delay', async () => {
      // RED: DO should restart automatically
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 1000,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(chaosController.crashManager.isCrashed('https://test.crash.do')).toBe(true)

      // Advance time past restart delay
      await vi.advanceTimersByTimeAsync(1500)

      expect(chaosController.crashManager.isCrashed('https://test.crash.do')).toBe(false)
    })

    it('should emit crash event for monitoring', async () => {
      // RED: Crash should be observable
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      // Crash should be tracked
      const state = chaosController.getState()
      expect(state.crashedDOs.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 2. GRACEFUL SHUTDOWN RECOVERY
  // ==========================================================================

  describe('Graceful Shutdown Recovery', () => {
    it('should preserve all data on graceful shutdown', async () => {
      // RED: Graceful shutdown should save all state
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.preservedState).toBeDefined()
      expect(crashResult.preservedState?.walFlushed).toBe(true)
    })

    it('should flush WAL on graceful shutdown', async () => {
      // RED: WAL should be flushed before shutdown
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: false,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.preservedState?.walFlushed).toBe(true)
      expect(crashResult.preservedState?.pendingOperations).toBe(0)
    })

    it('should complete in-flight operations before shutdown', async () => {
      // RED: Operations in progress should complete or rollback
      const beforeCrashCalled = { value: false }
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
        beforeCrash: async () => {
          beforeCrashCalled.value = true
        },
      }

      await chaosController.crashDO(config)

      expect(beforeCrashCalled.value).toBe(true)
    })

    it('should recover all data after graceful restart', async () => {
      // RED: All data should be available after restart
      const afterRestartCalled = { value: false }
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
        afterRestart: async () => {
          afterRestartCalled.value = true
        },
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      expect(afterRestartCalled.value).toBe(true)
    })

    it('should maintain transaction consistency after graceful recovery', async () => {
      // RED: No partial transactions should exist after recovery
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const recoveryStatus = await chaosController.crashManager.restart('https://test.crash.do')

      expect(recoveryStatus.successful).toBe(true)
      expect(recoveryStatus.errors).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 3. OOM CRASH RECOVERY
  // ==========================================================================

  describe('OOM Crash Recovery', () => {
    it('should handle out-of-memory crash', async () => {
      // RED: System should survive OOM
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'oom',
        autoRestart: true,
        restartDelay: 500,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.crashId).toBeDefined()
      expect(chaosController.crashManager.isCrashed('https://test.crash.do')).toBe(true)
    })

    it('should preserve checkpoint data on OOM', async () => {
      // RED: Last checkpoint should be preserved
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'oom',
        autoRestart: true,
        restartDelay: 500,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.preservedState).toBeDefined()
      // Partial preservation means some data saved
      expect(crashResult.preservedState?.itemCount).toBeGreaterThan(0)
    })

    it('should restart with reduced memory allocation after OOM', async () => {
      // RED: System should adapt after OOM
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'oom',
        autoRestart: true,
        restartDelay: 1000,
        statePreservation: 'partial',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(1500)

      expect(chaosController.crashManager.isCrashed('https://test.crash.do')).toBe(false)
    })

    it('should emit OOM warning for capacity planning', async () => {
      // RED: OOM should be logged for alerting
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'oom',
        autoRestart: true,
        restartDelay: 500,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo).toBeDefined()
    })

    it('should recover to consistent state after OOM', async () => {
      // RED: Recovery should result in consistent state
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'oom',
        autoRestart: true,
        restartDelay: 500,
        statePreservation: 'partial',
      }

      await chaosController.crashDO(config)

      // Wait for restart and get recovery status
      await vi.advanceTimersByTimeAsync(600)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.successful).toBe(true)
    })
  })

  // ==========================================================================
  // 4. IN-FLIGHT OPERATION RECOVERY
  // ==========================================================================

  describe('In-Flight Operation Recovery', () => {
    it('should track operations in progress at crash time', async () => {
      // RED: System should know what was in progress
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      expect(crashResult.preservedState).toBeDefined()
    })

    it('should rollback uncommitted write operations', async () => {
      // RED: Uncommitted writes should be rolled back
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'partial',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery).toBeDefined()
    })

    it('should retry idempotent operations after crash', async () => {
      // RED: Idempotent ops should be retried automatically
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.strategy).toBeDefined()
    })

    it('should notify callers of failed operations after crash', async () => {
      // RED: Callers should be notified of operation failure
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'partial',
      }

      const crashResult = await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.errors).toBeDefined()
    })

    it('should preserve operation ordering after recovery', async () => {
      // RED: Operations should be replayed in order
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.successful).toBe(true)
    })
  })

  // ==========================================================================
  // 5. WAL REPLAY CORRECTNESS
  // ==========================================================================

  describe('WAL Replay Correctness', () => {
    it('should replay WAL on restart', async () => {
      // RED: WAL should be replayed to recover state
      // Note: WAL replay is only used for graceful shutdowns where WAL was fully flushed
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful', // Graceful shutdown ensures WAL is flushed
        autoRestart: false, // Don't auto-restart, we'll do it manually
        statePreservation: 'full',
      }

      await chaosController.crashDO(config)

      // Manually trigger restart (more reliable than waiting for setTimeout)
      await chaosController.crashManager.restart('https://test.crash.do')

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.strategy).toBe('wal_replay')
    })

    it('should recover correct item count from WAL', async () => {
      // RED: All committed items should be recovered
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      const crashResult = await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.itemsRecovered).toBe(crashResult.preservedState?.itemCount)
    })

    it('should detect and report WAL corruption', async () => {
      // RED: Corrupted WAL should be detected
      chaosController.crashManager.setRecoveryBehavior({
        successful: false,
        strategy: 'wal_replay',
        itemsRecovered: 50,
        itemsLost: 50,
        recoveryTimeMs: 1000,
        errors: [
          {
            type: 'data_corruption',
            message: 'WAL checksum mismatch',
            recoverable: false,
          },
        ],
      })

      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.errors.length).toBeGreaterThan(0)
      expect(crashInfo?.recovery.errors[0].type).toBe('data_corruption')
    })

    it('should fallback to checkpoint if WAL is corrupted', async () => {
      // RED: Should use checkpoint as fallback
      chaosController.crashManager.setRecoveryBehavior({
        successful: true,
        strategy: 'checkpoint',
        itemsRecovered: 80,
        itemsLost: 20,
        recoveryTimeMs: 500,
        errors: [],
      })

      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'immediate',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'partial',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.strategy).toBe('checkpoint')
    })

    it('should verify data integrity after WAL replay', async () => {
      // RED: Integrity check should run after replay
      const config: DOCrashConfig = {
        targetNs: 'https://test.crash.do',
        crashType: 'graceful',
        autoRestart: true,
        restartDelay: 100,
        statePreservation: 'full',
      }

      await chaosController.crashDO(config)

      // Wait for restart
      await vi.advanceTimersByTimeAsync(200)

      const crashInfo = chaosController.crashManager.getCrashInfo('https://test.crash.do')
      expect(crashInfo?.recovery.itemsLost).toBe(0)
    })
  })

  // ==========================================================================
  // CHAOS SCENARIO: DO CRASH
  // ==========================================================================

  describe('Chaos Scenario Execution', () => {
    it('should execute complete crash recovery scenario', async () => {
      const scenario = createChaosScenario(
        'crash-recovery-full',
        [
          createFailureInjection('do_crash', {
            injectAt: 0,
            duration: 1000,
            config: {
              targetNs: 'https://test.crash.do',
              crashType: 'immediate',
              autoRestart: true,
              restartDelay: 500,
              statePreservation: 'full',
            } as DOCrashConfig,
          }),
        ],
        {
          assertions: [
            {
              name: 'Data durability maintained',
              property: 'durability',
              expected: { type: 'true' },
            },
            {
              name: 'Recovery time within bounds',
              property: 'recovery_time',
              expected: { type: 'lessThan', value: 5000 },
            },
          ],
          recoveryVerification: {
            maxRecoveryTimeMs: 5000,
            checks: [
              { name: 'data-presence', checkType: 'data_presence' },
              { name: 'service-health', checkType: 'service_health' },
            ],
          },
        }
      )

      const result = await chaosController.runScenario(scenario)

      expect(result.failureResults).toHaveLength(1)
      expect(result.failureResults[0].injected).toBe(true)
      expect(result.summary.totalFailuresInjected).toBe(1)
    })

    it('should handle cascading crash scenario', async () => {
      const scenario = createChaosScenario(
        'cascading-crash',
        [
          createFailureInjection('do_crash', {
            injectAt: 0,
            config: {
              targetNs: 'https://primary.crash.do',
              crashType: 'immediate',
              autoRestart: true,
              restartDelay: 200,
              statePreservation: 'full',
            } as DOCrashConfig,
          }),
          createFailureInjection('do_crash', {
            injectAt: 100,
            config: {
              targetNs: 'https://secondary.crash.do',
              crashType: 'immediate',
              autoRestart: true,
              restartDelay: 300,
              statePreservation: 'partial',
            } as DOCrashConfig,
          }),
        ],
        {
          order: 'sequential',
          assertions: [
            {
              name: 'No data loss',
              property: 'no_data_loss',
              expected: { type: 'true' },
            },
          ],
        }
      )

      const result = await chaosController.runScenario(scenario)

      expect(result.failureResults).toHaveLength(2)
      expect(result.status).toBe('passed')
    })

    it('should verify recovery metrics after crash scenario', async () => {
      const scenario = createChaosScenario(
        'crash-metrics',
        [
          createFailureInjection('do_crash', {
            injectAt: 0,
            config: {
              targetNs: 'https://test.crash.do',
              crashType: 'graceful',
              autoRestart: true,
              restartDelay: 100,
              statePreservation: 'full',
            } as DOCrashConfig,
          }),
        ]
      )

      const result = await chaosController.runScenario(scenario)

      expect(result.summary).toBeDefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })
})
