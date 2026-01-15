/**
 * Cascade Graceful Degradation Tests
 *
 * Tests for [ARCH-5] Graceful degradation pattern in cascade execution.
 *
 * Graceful degradation means:
 * - If a tier fails, return partial results instead of complete failure
 * - Provide fallback values when configured
 * - Track which parts succeeded vs failed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWorkflowContext, type WorkflowContext, type CascadeResult } from '../../workflow/workflow-context'

describe('Cascade Graceful Degradation Pattern', () => {
  let $: WorkflowContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Basic Graceful Degradation
  // ==========================================================================

  describe('basic graceful degradation', () => {
    it('should return degraded result with fallback value when all tiers fail', async () => {
      $ = createWorkflowContext()

      const failingCode = vi.fn().mockRejectedValue(new Error('Code tier failed'))
      const failingGenerative = vi.fn().mockRejectedValue(new Error('Generative tier failed'))

      const result = await $.cascade({
        task: 'test-task',
        tiers: {
          code: failingCode,
          generative: failingGenerative,
        },
        gracefulDegradation: {
          enabled: true,
          fallbackValue: { default: 'fallback-response' },
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.value).toEqual({ default: 'fallback-response' })
      expect(result.failedTiers).toContain('code')
      expect(result.failedTiers).toContain('generative')
      expect(result.completedTiers).toEqual([])
      expect(result.tierErrors).toBeDefined()
      expect(result.tierErrors?.code).toBe('Code tier failed')
      expect(result.tierErrors?.generative).toBe('Generative tier failed')
    })

    it('should return partial result from last successful tier when confidence threshold not met', async () => {
      $ = createWorkflowContext()

      const lowConfidenceCode = vi.fn().mockResolvedValue({ value: 'partial-code', confidence: 0.5 })
      const failingGenerative = vi.fn().mockRejectedValue(new Error('Generative failed'))

      const result = await $.cascade({
        task: 'test-task',
        tiers: {
          code: lowConfidenceCode,
          generative: failingGenerative,
        },
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.partialResult).toBe('partial-code')
      expect(result.value).toBe('partial-code') // Best partial result is used as value
      expect(result.completedTiers).toContain('code')
      expect(result.failedTiers).toContain('generative')
    })

    it('should throw CascadeError when graceful degradation is disabled', async () => {
      $ = createWorkflowContext()

      const failingCode = vi.fn().mockRejectedValue(new Error('Code tier failed'))

      await expect(
        $.cascade({
          task: 'test-task',
          tiers: {
            code: failingCode,
          },
          gracefulDegradation: {
            enabled: false,
          },
        })
      ).rejects.toThrow('All tiers failed for task: test-task')
    })

    it('should not degrade when at least one tier succeeds with sufficient confidence', async () => {
      $ = createWorkflowContext()

      const failingCode = vi.fn().mockRejectedValue(new Error('Code failed'))
      const successGenerative = vi.fn().mockResolvedValue({ value: 'success', confidence: 0.9 })

      const result = await $.cascade({
        task: 'test-task',
        tiers: {
          code: failingCode,
          generative: successGenerative,
        },
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
          fallbackValue: 'fallback',
        },
      })

      expect(result.degraded).toBe(false)
      expect(result.value).toBe('success')
      expect(result.tier).toBe('generative')
      expect(result.completedTiers).toContain('generative')
      expect(result.failedTiers).toContain('code')
    })
  })

  // ==========================================================================
  // Partial Results Tracking
  // ==========================================================================

  describe('partial results tracking', () => {
    it('should track completed and failed tiers accurately', async () => {
      $ = createWorkflowContext()

      const codeHandler = vi.fn().mockResolvedValue({ value: 'code-result', confidence: 0.3 })
      const generativeHandler = vi.fn().mockRejectedValue(new Error('Generative failed'))
      const agenticHandler = vi.fn().mockResolvedValue({ value: 'agentic-result', confidence: 0.6 })
      const humanHandler = vi.fn().mockRejectedValue(new Error('Human unavailable'))

      const result = await $.cascade({
        task: 'multi-tier-task',
        tiers: {
          code: codeHandler,
          generative: generativeHandler,
          agentic: agenticHandler,
          human: humanHandler,
        },
        confidenceThreshold: 0.9, // Very high threshold
        gracefulDegradation: {
          enabled: true,
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.completedTiers).toEqual(['code', 'agentic'])
      expect(result.failedTiers).toEqual(['generative', 'human'])
      expect(result.executionPath).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should return best partial result based on highest confidence', async () => {
      $ = createWorkflowContext()

      const codeHandler = vi.fn().mockResolvedValue({ value: 'code-result', confidence: 0.4 })
      const generativeHandler = vi.fn().mockResolvedValue({ value: 'generative-result', confidence: 0.7 })
      const agenticHandler = vi.fn().mockResolvedValue({ value: 'agentic-result', confidence: 0.5 })

      const result = await $.cascade({
        task: 'best-partial-task',
        tiers: {
          code: codeHandler,
          generative: generativeHandler,
          agentic: agenticHandler,
        },
        confidenceThreshold: 0.9,
        gracefulDegradation: {
          enabled: true,
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.value).toBe('generative-result') // Highest confidence
      expect(result.confidence).toBe(0.7)
      expect(result.partialResult).toBe('generative-result')
    })

    it('should include tier error messages in result', async () => {
      $ = createWorkflowContext()

      const failingCode = vi.fn().mockRejectedValue(new Error('Database connection lost'))
      const failingGenerative = vi.fn().mockRejectedValue(new Error('API rate limited'))

      const result = await $.cascade({
        task: 'error-tracking-task',
        tiers: {
          code: failingCode,
          generative: failingGenerative,
        },
        gracefulDegradation: {
          enabled: true,
          fallbackValue: null,
        },
      })

      expect(result.tierErrors).toEqual({
        code: 'Database connection lost',
        generative: 'API rate limited',
      })
    })
  })

  // ==========================================================================
  // Timeout with Graceful Degradation
  // ==========================================================================

  describe('timeout handling with graceful degradation', () => {
    it('should return partial on timeout when returnPartialOnTimeout is true', async () => {
      $ = createWorkflowContext()

      const fastCode = vi.fn().mockResolvedValue({ value: 'fast-code', confidence: 0.5 })
      const slowGenerative = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return { value: 'slow-generative', confidence: 0.9 }
      })

      const cascadePromise = $.cascade({
        task: 'timeout-partial-task',
        tiers: {
          code: fastCode,
          generative: slowGenerative,
        },
        timeout: 100, // Global 100ms timeout
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
          returnPartialOnTimeout: true,
        },
      })

      await vi.advanceTimersByTimeAsync(200)

      const result = await cascadePromise

      expect(result.degraded).toBe(true)
      expect(result.timedOut).toBe(true)
      expect(result.completedTiers).toContain('code')
      expect(result.partialResult).toBe('fast-code')
    })

    it('should use fallback value on timeout when configured', async () => {
      $ = createWorkflowContext()

      const slowCode = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return { value: 'never-reached', confidence: 1.0 }
      })

      const cascadePromise = $.cascade({
        task: 'timeout-fallback-task',
        tiers: {
          code: slowCode,
        },
        timeout: 50,
        gracefulDegradation: {
          enabled: true,
          fallbackValue: { error: 'timeout', default: true },
          returnPartialOnTimeout: true,
        },
      })

      await vi.advanceTimersByTimeAsync(100)

      const result = await cascadePromise

      expect(result.degraded).toBe(true)
      expect(result.value).toEqual({ error: 'timeout', default: true })
    })
  })

  // ==========================================================================
  // Error Handling with Graceful Degradation
  // ==========================================================================

  describe('error handling with graceful degradation', () => {
    it('should continue to next tier on error and track in failedTiers', async () => {
      $ = createWorkflowContext()

      const errorCode = vi.fn().mockRejectedValue(new Error('Code threw'))
      const successGenerative = vi.fn().mockResolvedValue({ value: 'success', confidence: 0.9 })

      const result = await $.cascade({
        task: 'error-continue-task',
        tiers: {
          code: errorCode,
          generative: successGenerative,
        },
        gracefulDegradation: {
          enabled: true,
        },
      })

      expect(result.degraded).toBe(false)
      expect(result.value).toBe('success')
      expect(result.failedTiers).toContain('code')
      expect(result.completedTiers).toContain('generative')
      expect(result.tierErrors?.code).toBe('Code threw')
    })

    it('should return partial result on error when returnPartialOnError is true', async () => {
      $ = createWorkflowContext()

      const lowConfidenceCode = vi.fn().mockResolvedValue({ value: 'partial', confidence: 0.4 })
      const errorGenerative = vi.fn().mockRejectedValue(new Error('Generative crashed'))
      const errorAgentic = vi.fn().mockRejectedValue(new Error('Agentic unavailable'))

      const result = await $.cascade({
        task: 'partial-on-error-task',
        tiers: {
          code: lowConfidenceCode,
          generative: errorGenerative,
          agentic: errorAgentic,
        },
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
          returnPartialOnError: true,
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.partialResult).toBe('partial')
      expect(result.value).toBe('partial')
    })
  })

  // ==========================================================================
  // Circuit Breaker Integration
  // ==========================================================================

  describe('circuit breaker integration with graceful degradation', () => {
    it('should include circuit states in degraded result', async () => {
      $ = createWorkflowContext()

      // Create handlers that always fail to trigger circuit breaker
      const failingCode = vi.fn().mockRejectedValue(new Error('Always fails'))

      // Trigger circuit breaker by failing multiple times
      for (let i = 0; i < 5; i++) {
        await $.cascade({
          task: 'circuit-task',
          tiers: { code: failingCode },
          circuitBreaker: {
            failureThreshold: 3,
            resetTimeout: 60000,
          },
          gracefulDegradation: {
            enabled: true,
            fallbackValue: null,
          },
        }).catch(() => {})
      }

      // Next call should have circuit breaker state in result
      const result = await $.cascade({
        task: 'circuit-task',
        tiers: { code: failingCode },
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 60000,
        },
        gracefulDegradation: {
          enabled: true,
          fallbackValue: 'circuit-fallback',
        },
      })

      expect(result.circuitStates).toBeDefined()
      expect(result.circuitStates?.code).toBe('open')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty tiers object', async () => {
      $ = createWorkflowContext()

      const result = await $.cascade({
        task: 'empty-tiers-task',
        tiers: {},
        gracefulDegradation: {
          enabled: true,
          fallbackValue: 'no-tiers-fallback',
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.value).toBe('no-tiers-fallback')
      expect(result.completedTiers).toEqual([])
      expect(result.failedTiers).toEqual([])
    })

    it('should handle undefined fallback value', async () => {
      $ = createWorkflowContext()

      const failingCode = vi.fn().mockRejectedValue(new Error('Failed'))

      const result = await $.cascade({
        task: 'undefined-fallback-task',
        tiers: { code: failingCode },
        gracefulDegradation: {
          enabled: true,
          // No fallbackValue specified
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.value).toBeUndefined()
    })

    it('should prefer fallback value over partial result when both available', async () => {
      $ = createWorkflowContext()

      const lowConfidenceCode = vi.fn().mockResolvedValue({ value: 'partial', confidence: 0.3 })
      const failingGenerative = vi.fn().mockRejectedValue(new Error('Failed'))

      const result = await $.cascade({
        task: 'fallback-vs-partial-task',
        tiers: {
          code: lowConfidenceCode,
          generative: failingGenerative,
        },
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
          fallbackValue: 'explicit-fallback',
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.value).toBe('explicit-fallback')
      expect(result.partialResult).toBe('partial')
    })

    it('should handle synchronous handlers', async () => {
      $ = createWorkflowContext()

      const syncCode = vi.fn().mockReturnValue({ value: 'sync-result', confidence: 0.5 })
      const syncGenerative = vi.fn().mockImplementation(() => {
        throw new Error('Sync error')
      })

      const result = await $.cascade({
        task: 'sync-handlers-task',
        tiers: {
          code: syncCode,
          generative: syncGenerative,
        },
        confidenceThreshold: 0.8,
        gracefulDegradation: {
          enabled: true,
        },
      })

      expect(result.degraded).toBe(true)
      expect(result.partialResult).toBe('sync-result')
    })
  })
})
