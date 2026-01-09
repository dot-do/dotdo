/**
 * StepResultStorage Tests
 *
 * Tests for workflow step result storage, allowing retrieval and inspection.
 *
 * Features:
 * - Store step results with metadata (timing, status, retry count)
 * - Retrieve results by step name
 * - Get all results
 * - Result persistence
 * - Result cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StepResultStorage, type StoredStepResult } from '../StepResultStorage'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-step-result-storage-do-id' },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

// ============================================================================
// TESTS
// ============================================================================

describe('StepResultStorage', () => {
  let mockState: ReturnType<typeof createMockState>
  let results: StepResultStorage

  beforeEach(() => {
    mockState = createMockState()
    results = new StepResultStorage(mockState)
  })

  // ==========================================================================
  // 1. STORE STEP RESULTS
  // ==========================================================================

  describe('Store Step Results', () => {
    it('stores a step result with basic data', async () => {
      await results.store('validateOrder', {
        output: { valid: true },
        status: 'completed',
      })

      const stored = await results.get('validateOrder')
      expect(stored).toBeDefined()
      expect(stored?.output).toEqual({ valid: true })
      expect(stored?.status).toBe('completed')
    })

    it('stores result with duration', async () => {
      await results.store('processPayment', {
        output: { transactionId: 'tx-123' },
        status: 'completed',
        duration: 1500,
      })

      const stored = await results.get('processPayment')
      expect(stored?.duration).toBe(1500)
    })

    it('stores result with retry count', async () => {
      await results.store('sendEmail', {
        output: { sent: true },
        status: 'completed',
        retryCount: 2,
      })

      const stored = await results.get('sendEmail')
      expect(stored?.retryCount).toBe(2)
    })

    it('stores result with timestamps', async () => {
      const startedAt = new Date('2024-01-01T10:00:00Z')
      const completedAt = new Date('2024-01-01T10:00:05Z')

      await results.store('longRunningStep', {
        output: { done: true },
        status: 'completed',
        startedAt,
        completedAt,
      })

      const stored = await results.get('longRunningStep')
      expect(stored?.startedAt).toEqual(startedAt)
      expect(stored?.completedAt).toEqual(completedAt)
    })

    it('stores failed step result with error', async () => {
      await results.store('failingStep', {
        output: null,
        status: 'failed',
        error: {
          message: 'Connection timeout',
          name: 'TimeoutError',
        },
      })

      const stored = await results.get('failingStep')
      expect(stored?.status).toBe('failed')
      expect(stored?.error?.message).toBe('Connection timeout')
      expect(stored?.error?.name).toBe('TimeoutError')
    })

    it('stores step result with custom metadata', async () => {
      await results.store('customStep', {
        output: { result: 'data' },
        status: 'completed',
        metadata: {
          workflowId: 'wf-123',
          executionId: 'exec-456',
          custom: 'value',
        },
      })

      const stored = await results.get('customStep')
      expect(stored?.metadata?.workflowId).toBe('wf-123')
      expect(stored?.metadata?.executionId).toBe('exec-456')
      expect(stored?.metadata?.custom).toBe('value')
    })

    it('overwrites existing result for same step name', async () => {
      await results.store('updateableStep', {
        output: { version: 1 },
        status: 'completed',
      })

      await results.store('updateableStep', {
        output: { version: 2 },
        status: 'completed',
      })

      const stored = await results.get('updateableStep')
      expect(stored?.output).toEqual({ version: 2 })
    })

    it('persists to DO storage', async () => {
      await results.store('persistedStep', {
        output: { data: 'test' },
        status: 'completed',
      })

      expect(mockState.storage.put).toHaveBeenCalledWith(
        expect.stringContaining('step-result:persistedStep'),
        expect.objectContaining({
          stepName: 'persistedStep',
          output: { data: 'test' },
          status: 'completed',
        }),
      )
    })
  })

  // ==========================================================================
  // 2. RETRIEVE BY STEP NAME
  // ==========================================================================

  describe('Retrieve Results by Step Name', () => {
    it('retrieves existing step result', async () => {
      await results.store('step1', {
        output: { found: true },
        status: 'completed',
      })

      const result = await results.get('step1')
      expect(result).toBeDefined()
      expect(result?.stepName).toBe('step1')
      expect(result?.output).toEqual({ found: true })
    })

    it('returns undefined for non-existent step', async () => {
      const result = await results.get('nonExistentStep')
      expect(result).toBeUndefined()
    })

    it('retrieves step from storage after memory clear', async () => {
      // Store directly in mock storage to simulate recovery
      mockState._storage.set('step-result:recoveredStep', {
        stepName: 'recoveredStep',
        output: { recovered: true },
        status: 'completed',
        storedAt: new Date().toISOString(),
      })

      const result = await results.get('recoveredStep')
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ recovered: true })
    })

    it('includes all stored metadata when retrieving', async () => {
      const now = new Date()
      await results.store('fullStep', {
        output: { complete: true },
        status: 'completed',
        duration: 1000,
        retryCount: 1,
        startedAt: now,
        completedAt: new Date(now.getTime() + 1000),
        error: undefined,
        metadata: { extra: 'data' },
      })

      const result = await results.get('fullStep')
      expect(result?.stepName).toBe('fullStep')
      expect(result?.output).toEqual({ complete: true })
      expect(result?.status).toBe('completed')
      expect(result?.duration).toBe(1000)
      expect(result?.retryCount).toBe(1)
      expect(result?.startedAt).toEqual(now)
      expect(result?.metadata?.extra).toBe('data')
    })
  })

  // ==========================================================================
  // 3. GET ALL RESULTS
  // ==========================================================================

  describe('Get All Results', () => {
    it('returns empty array when no results stored', async () => {
      const all = await results.getAll()
      expect(all).toEqual([])
    })

    it('returns all stored results', async () => {
      await results.store('step1', { output: 1, status: 'completed' })
      await results.store('step2', { output: 2, status: 'completed' })
      await results.store('step3', { output: 3, status: 'failed' })

      const all = await results.getAll()
      expect(all).toHaveLength(3)
      expect(all.map((r) => r.stepName)).toContain('step1')
      expect(all.map((r) => r.stepName)).toContain('step2')
      expect(all.map((r) => r.stepName)).toContain('step3')
    })

    it('returns results sorted by stored time (oldest first)', async () => {
      // Store with different times
      await results.store('first', { output: 1, status: 'completed' })
      await new Promise((r) => setTimeout(r, 10)) // Small delay
      await results.store('second', { output: 2, status: 'completed' })
      await new Promise((r) => setTimeout(r, 10))
      await results.store('third', { output: 3, status: 'completed' })

      const all = await results.getAll()
      expect(all[0].stepName).toBe('first')
      expect(all[1].stepName).toBe('second')
      expect(all[2].stepName).toBe('third')
    })

    it('filters by status', async () => {
      await results.store('passed1', { output: 1, status: 'completed' })
      await results.store('failed1', { output: 2, status: 'failed' })
      await results.store('passed2', { output: 3, status: 'completed' })

      const completed = await results.getAll({ status: 'completed' })
      expect(completed).toHaveLength(2)
      expect(completed.every((r) => r.status === 'completed')).toBe(true)

      const failed = await results.getAll({ status: 'failed' })
      expect(failed).toHaveLength(1)
      expect(failed[0].stepName).toBe('failed1')
    })

    it('limits number of results returned', async () => {
      await results.store('s1', { output: 1, status: 'completed' })
      await results.store('s2', { output: 2, status: 'completed' })
      await results.store('s3', { output: 3, status: 'completed' })
      await results.store('s4', { output: 4, status: 'completed' })
      await results.store('s5', { output: 5, status: 'completed' })

      const limited = await results.getAll({ limit: 3 })
      expect(limited).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 4. RESULT PERSISTENCE
  // ==========================================================================

  describe('Result Persistence', () => {
    it('persists results to durable storage', async () => {
      await results.store('durableStep', {
        output: { durable: true },
        status: 'completed',
      })

      // Verify storage was called
      expect(mockState.storage.put).toHaveBeenCalled()

      // Create new instance with same storage
      const newResults = new StepResultStorage(mockState)
      const retrieved = await newResults.get('durableStep')

      expect(retrieved).toBeDefined()
      expect(retrieved?.output).toEqual({ durable: true })
    })

    it('stores timestamp when result is persisted', async () => {
      const before = Date.now()
      await results.store('timestampedStep', {
        output: { data: 'test' },
        status: 'completed',
      })
      const after = Date.now()

      const stored = await results.get('timestampedStep')
      expect(stored?.storedAt).toBeDefined()
      const storedTime = new Date(stored!.storedAt!).getTime()
      expect(storedTime).toBeGreaterThanOrEqual(before)
      expect(storedTime).toBeLessThanOrEqual(after)
    })

    it('loads all results from storage on getAll', async () => {
      // Simulate existing data in storage
      mockState._storage.set('step-result:existing1', {
        stepName: 'existing1',
        output: { existing: 1 },
        status: 'completed',
        storedAt: new Date().toISOString(),
      })
      mockState._storage.set('step-result:existing2', {
        stepName: 'existing2',
        output: { existing: 2 },
        status: 'completed',
        storedAt: new Date().toISOString(),
      })

      const all = await results.getAll()
      expect(all).toHaveLength(2)
      expect(all.map((r) => r.stepName)).toContain('existing1')
      expect(all.map((r) => r.stepName)).toContain('existing2')
    })

    it('handles date serialization correctly', async () => {
      const startedAt = new Date('2024-06-15T10:30:00Z')
      const completedAt = new Date('2024-06-15T10:30:05Z')

      await results.store('dateStep', {
        output: { dates: true },
        status: 'completed',
        startedAt,
        completedAt,
      })

      // Create new instance to force loading from storage
      const newResults = new StepResultStorage(mockState)
      const loaded = await newResults.get('dateStep')

      expect(loaded?.startedAt).toEqual(startedAt)
      expect(loaded?.completedAt).toEqual(completedAt)
    })
  })

  // ==========================================================================
  // 5. RESULT CLEANUP
  // ==========================================================================

  describe('Result Cleanup', () => {
    it('clears a specific step result', async () => {
      await results.store('clearMe', { output: 1, status: 'completed' })
      await results.store('keepMe', { output: 2, status: 'completed' })

      await results.clear('clearMe')

      expect(await results.get('clearMe')).toBeUndefined()
      expect(await results.get('keepMe')).toBeDefined()
    })

    it('clears all step results', async () => {
      await results.store('step1', { output: 1, status: 'completed' })
      await results.store('step2', { output: 2, status: 'completed' })
      await results.store('step3', { output: 3, status: 'completed' })

      await results.clearAll()

      const all = await results.getAll()
      expect(all).toHaveLength(0)
    })

    it('removes from storage when cleared', async () => {
      await results.store('removeMe', { output: 'data', status: 'completed' })
      await results.clear('removeMe')

      expect(mockState.storage.delete).toHaveBeenCalledWith('step-result:removeMe')
    })

    it('clears results older than specified age', async () => {
      // Store old result (simulate by manipulating storage directly)
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      mockState._storage.set('step-result:oldStep', {
        stepName: 'oldStep',
        output: { old: true },
        status: 'completed',
        storedAt: oldDate.toISOString(),
      })

      // Store new result
      await results.store('newStep', { output: { new: true }, status: 'completed' })

      // Clear results older than 1 hour
      await results.clearOlderThan('1 hour')

      const all = await results.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].stepName).toBe('newStep')
    })

    it('clears results by status', async () => {
      await results.store('completed1', { output: 1, status: 'completed' })
      await results.store('failed1', { output: 2, status: 'failed' })
      await results.store('completed2', { output: 3, status: 'completed' })

      await results.clearByStatus('failed')

      const all = await results.getAll()
      expect(all).toHaveLength(2)
      expect(all.every((r) => r.status === 'completed')).toBe(true)
    })
  })

  // ==========================================================================
  // 6. WORKFLOW RUNTIME INTEGRATION
  // ==========================================================================

  describe('WorkflowRuntime Integration', () => {
    it('provides getStepResult convenience method', async () => {
      await results.store('integrationStep', {
        output: { integrated: true },
        status: 'completed',
        duration: 500,
      })

      // getStepResult should be an alias for get
      const result = await results.getStepResult('integrationStep')
      expect(result).toBeDefined()
      expect(result?.output).toEqual({ integrated: true })
    })

    it('returns result summary for quick inspection', async () => {
      await results.store('step1', { output: 'a', status: 'completed', duration: 100 })
      await results.store('step2', { output: 'b', status: 'completed', duration: 200 })
      await results.store('step3', { output: 'c', status: 'failed', duration: 50 })

      const summary = await results.getSummary()

      expect(summary.total).toBe(3)
      expect(summary.completed).toBe(2)
      expect(summary.failed).toBe(1)
      expect(summary.totalDuration).toBe(350)
      expect(summary.stepNames).toEqual(['step1', 'step2', 'step3'])
    })

    it('checks if step has been executed', async () => {
      await results.store('executedStep', { output: null, status: 'completed' })

      expect(await results.hasResult('executedStep')).toBe(true)
      expect(await results.hasResult('notExecuted')).toBe(false)
    })

    it('supports StepExecutionResult type from WorkflowRuntime', async () => {
      // Store using WorkflowRuntime's StepExecutionResult format
      await results.store('runtimeStep', {
        output: { fromRuntime: true },
        status: 'completed',
        duration: 750,
        startedAt: new Date('2024-01-01T12:00:00Z'),
        completedAt: new Date('2024-01-01T12:00:00.750Z'),
        retryCount: 0,
      })

      const stored = await results.get('runtimeStep')
      expect(stored?.stepName).toBe('runtimeStep')
      expect(stored?.output).toEqual({ fromRuntime: true })
      expect(stored?.status).toBe('completed')
      expect(stored?.duration).toBe(750)
      expect(stored?.retryCount).toBe(0)
    })
  })

  // ==========================================================================
  // 7. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles step names with special characters', async () => {
      await results.store('step-with-dashes', { output: 1, status: 'completed' })
      await results.store('step.with.dots', { output: 2, status: 'completed' })
      await results.store('step:with:colons', { output: 3, status: 'completed' })

      expect(await results.get('step-with-dashes')).toBeDefined()
      expect(await results.get('step.with.dots')).toBeDefined()
      expect(await results.get('step:with:colons')).toBeDefined()
    })

    it('handles undefined output gracefully', async () => {
      await results.store('undefinedOutput', { output: undefined, status: 'completed' })

      const stored = await results.get('undefinedOutput')
      expect(stored).toBeDefined()
      expect(stored?.output).toBeUndefined()
    })

    it('handles null output gracefully', async () => {
      await results.store('nullOutput', { output: null, status: 'completed' })

      const stored = await results.get('nullOutput')
      expect(stored).toBeDefined()
      expect(stored?.output).toBeNull()
    })

    it('handles large output objects', async () => {
      const largeOutput = {
        data: Array(1000)
          .fill(0)
          .map((_, i) => ({
            id: i,
            value: `item-${i}`,
            nested: { deep: { value: i * 2 } },
          })),
      }

      await results.store('largeStep', { output: largeOutput, status: 'completed' })

      const stored = await results.get('largeStep')
      expect(stored?.output).toEqual(largeOutput)
    })

    it('handles concurrent stores to same step', async () => {
      // Simulate concurrent writes
      await Promise.all([
        results.store('concurrent', { output: { version: 1 }, status: 'completed' }),
        results.store('concurrent', { output: { version: 2 }, status: 'completed' }),
        results.store('concurrent', { output: { version: 3 }, status: 'completed' }),
      ])

      // One of the values should persist (last write wins)
      const stored = await results.get('concurrent')
      expect(stored).toBeDefined()
      expect([1, 2, 3]).toContain((stored?.output as { version: number }).version)
    })

    it('returns consistent types after serialization roundtrip', async () => {
      const original = {
        output: {
          string: 'hello',
          number: 42,
          boolean: true,
          array: [1, 2, 3],
          object: { nested: 'value' },
        },
        status: 'completed' as const,
        duration: 100,
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
      }

      await results.store('typeCheck', original)

      // Force load from storage
      const newResults = new StepResultStorage(mockState)
      const loaded = await newResults.get('typeCheck')

      expect(loaded?.output).toEqual(original.output)
      expect(typeof loaded?.duration).toBe('number')
      expect(typeof loaded?.retryCount).toBe('number')
      expect(loaded?.startedAt).toBeInstanceOf(Date)
      expect(loaded?.completedAt).toBeInstanceOf(Date)
    })
  })
})
