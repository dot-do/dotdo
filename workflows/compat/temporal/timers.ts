/**
 * Timers Module
 *
 * Timer management with coalescing optimization and cleanup.
 * Includes sleep, createTimer, and cancelTimer functions.
 */

import { WaitCancelledError } from '../../WaitForEventManager'
import { parseDuration } from '../utils'
import type { TimerHandle, TimerState } from './types'
import {
  getCurrentContext,
  getCurrentWorkflow,
  getCurrentStorageStrategy,
  generateTimerId,
  formatDurationForCF,
  generateSleepStepId,
} from './context'

// ============================================================================
// TIMER STATE
// ============================================================================

// Timer tracking - global for cancel operations by ID
const activeTimers = new Map<string, TimerState>()

// Timer coalescing: Group timers that fire within the same 10ms window
const TIMER_COALESCE_WINDOW_MS = 10
const coalescedTimerBuckets = new Map<number, TimerState[]>()
// Store bucket timeouts separately to avoid "cancelled leader" bug
// When the first timer in a bucket is cancelled, other timers still need the timeout
const bucketTimeouts = new Map<number, ReturnType<typeof setTimeout>>()

// Periodic cleanup for stale timer buckets (memory leak prevention)
// Timers are considered stale if they haven't fired 5 minutes past their expected time
const TIMER_STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const TIMER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Run cleanup every 5 minutes
let timerCleanupIntervalId: ReturnType<typeof setInterval> | null = null

// ============================================================================
// CLEANUP MANAGEMENT
// ============================================================================

// Track whether cleanup intervals have been auto-started.
// This enables lazy initialization - cleanup only starts when actually needed.
let cleanupStarted = false

// Callbacks for workflow cleanup (set by client module to avoid circular deps)
let startWorkflowCleanupFn: (() => void) | null = null

/**
 * Set the workflow cleanup function (called by client module)
 */
export function setWorkflowCleanupFn(fn: () => void): void {
  startWorkflowCleanupFn = fn
}

/**
 * Ensure cleanup intervals are started (lazy initialization).
 *
 * This function is called automatically when:
 * - A workflow is started (WorkflowClient.start, startChild)
 * - A timer is created (createTimer)
 *
 * This eliminates the need to manually call __startWorkflowCleanup() and
 * __startTimerCleanup(), preventing memory leaks from accumulated workflows
 * and timers even when the manual calls are forgotten.
 *
 * The cleanup intervals are idempotent - calling this multiple times is safe.
 */
export function ensureCleanupStarted(): void {
  if (cleanupStarted) return
  cleanupStarted = true
  startWorkflowCleanupFn?.()
  __startTimerCleanup()
}

/**
 * Reset the cleanup started flag (for testing only).
 * This allows tests to verify the lazy initialization behavior.
 */
export function __resetCleanupStarted(): void {
  cleanupStarted = false
}

/**
 * Check if cleanup has been auto-started (for testing only).
 */
export function __isCleanupStarted(): boolean {
  return cleanupStarted
}

// ============================================================================
// TIMER CLEANUP
// ============================================================================

/**
 * Clean up stale timer buckets that haven't fired.
 * This handles cases where:
 * - Workflows terminate without cancelling their timers
 * - setTimeout fails to fire for some reason
 * - Timers are orphaned due to errors
 */
function cleanupStaleTimerBuckets(): void {
  const now = Date.now()
  const bucketsToDelete: number[] = []

  for (const [bucket, timers] of coalescedTimerBuckets) {
    // Filter out stale timers from this bucket
    const activeTimersInBucket = timers.filter((timer) => {
      // Timer is stale if it's past its expected fire time + threshold
      const isStale = timer.pending && now > timer.expectedFireAt + TIMER_STALE_THRESHOLD_MS

      if (isStale) {
        // Clean up the stale timer
        timer.pending = false
        activeTimers.delete(timer.id)
      }

      return !isStale
    })

    if (activeTimersInBucket.length === 0) {
      bucketsToDelete.push(bucket)
    } else if (activeTimersInBucket.length !== timers.length) {
      // Update the bucket with only active timers
      coalescedTimerBuckets.set(bucket, activeTimersInBucket)
    }
  }

  // Delete empty buckets and their timeouts
  for (const bucket of bucketsToDelete) {
    coalescedTimerBuckets.delete(bucket)
    const timeoutId = bucketTimeouts.get(bucket)
    if (timeoutId) {
      clearTimeout(timeoutId)
      bucketTimeouts.delete(bucket)
    }
  }
}

/**
 * Start the periodic timer cleanup (for production use).
 * This should be called once when the module is loaded in a long-running process.
 */
export function __startTimerCleanup(): void {
  if (timerCleanupIntervalId === null) {
    timerCleanupIntervalId = setInterval(cleanupStaleTimerBuckets, TIMER_CLEANUP_INTERVAL_MS)
    // Unref the interval so it doesn't prevent process exit
    if (typeof timerCleanupIntervalId === 'object' && 'unref' in timerCleanupIntervalId) {
      timerCleanupIntervalId.unref()
    }
  }
}

/**
 * Stop the periodic timer cleanup.
 */
export function __stopTimerCleanup(): void {
  if (timerCleanupIntervalId !== null) {
    clearInterval(timerCleanupIntervalId)
    timerCleanupIntervalId = null
  }
}

// ============================================================================
// CREATE TIMER
// ============================================================================

/**
 * Create a cancellable timer with optional coalescing
 *
 * OPTIMIZATION: Timers firing within 10ms of each other are coalesced
 * into a single setTimeout call, reducing system call overhead.
 */
export function createTimer(duration: string | number): TimerHandle {
  // Auto-start cleanup on first timer creation
  ensureCleanupStarted()

  const ms = parseDuration(duration)
  const id = generateTimerId()
  const now = Date.now()

  let resolveTimer: () => void
  let rejectTimer: (error: Error) => void

  const promise = new Promise<void>((resolve, reject) => {
    resolveTimer = resolve
    rejectTimer = reject
  })

  const timerState: TimerState = {
    id,
    pending: true,
    resolve: resolveTimer!,
    reject: rejectTimer!,
    createdAt: now,
    expectedFireAt: now + ms,
  }

  activeTimers.set(id, timerState)

  // Calculate coalesce bucket (round to nearest TIMER_COALESCE_WINDOW_MS)
  const bucket = Math.floor(ms / TIMER_COALESCE_WINDOW_MS) * TIMER_COALESCE_WINDOW_MS

  // Check if we can coalesce with an existing timer
  const existingBucket = coalescedTimerBuckets.get(bucket)
  if (existingBucket && existingBucket.length > 0) {
    // Coalesce: add to existing bucket
    existingBucket.push(timerState)
  } else {
    // Create new bucket with single timer
    const newBucket = [timerState]
    coalescedTimerBuckets.set(bucket, newBucket)

    // Set the actual timeout - stored on bucket, not individual timer
    // This prevents the "cancelled leader" bug where cancelling the first timer
    // in a bucket would leave other timers without a scheduled callback
    const timeoutId = setTimeout(() => {
      bucketTimeouts.delete(bucket)
      // Fire all timers in this bucket
      const timersToFire = coalescedTimerBuckets.get(bucket) || []
      coalescedTimerBuckets.delete(bucket)

      for (const timer of timersToFire) {
        if (timer.pending) {
          timer.pending = false
          timer.resolve()
          activeTimers.delete(timer.id)
          const workflow = getCurrentWorkflow()
          if (workflow) {
            workflow.historyLength++
          }
        }
      }
    }, ms)
    bucketTimeouts.set(bucket, timeoutId)
  }

  // Create a TimerHandle with additional properties
  const handle = promise as TimerHandle
  Object.defineProperty(handle, 'id', { value: id, writable: false })
  Object.defineProperty(handle, 'pending', {
    get: () => timerState.pending,
  })

  return handle
}

// ============================================================================
// CANCEL TIMER
// ============================================================================

/**
 * Cancel a timer
 *
 * OPTIMIZATION: Also removes from coalesced bucket to prevent
 * unnecessary processing of cancelled timers.
 *
 * FIX: Timeouts are now stored on the bucket (bucketTimeouts), not on individual
 * timers. This prevents the "cancelled leader" bug where cancelling the first timer
 * in a bucket would leave other timers without a scheduled callback.
 * When cancelling, we only clear the bucket timeout if this was the last timer.
 */
export function cancelTimer(timer: TimerHandle): void {
  const timerState = activeTimers.get(timer.id)
  if (timerState && timerState.pending) {
    timerState.pending = false

    // Remove from coalesced bucket if present
    for (const [bucket, timers] of coalescedTimerBuckets) {
      const index = timers.findIndex(t => t.id === timer.id)
      if (index !== -1) {
        timers.splice(index, 1)
        if (timers.length === 0) {
          // Only clear the bucket timeout when the last timer is cancelled
          coalescedTimerBuckets.delete(bucket)
          const timeoutId = bucketTimeouts.get(bucket)
          if (timeoutId) {
            clearTimeout(timeoutId)
            bucketTimeouts.delete(bucket)
          }
        }
        // If other timers remain in the bucket, leave the timeout running
        // so those timers will fire when the timeout expires
        break
      }
    }

    timerState.reject(new WaitCancelledError('Timer cancelled'))
    activeTimers.delete(timer.id)
  }
}

// ============================================================================
// SLEEP
// ============================================================================

/**
 * Sleep for a duration (durable)
 *
 * This implementation integrates with both CF Workflows native sleep and
 * the Temporal compat layer's durable storage:
 *
 * 1. If WorkflowStep context is available (CF Workflows), use step.sleep()
 *    - FREE: doesn't use billable DO time
 *    - DURABLE: survives worker restarts
 *
 * 2. Otherwise, fall back to setTimeout with durable storage
 *    - Persists sleep state to storage (in case of crash)
 *    - On replay, completed sleeps are skipped immediately
 */
export async function sleep(duration: string | number): Promise<void> {
  const ctx = getCurrentContext()
  const workflow = ctx?.workflow ?? null
  if (!workflow) {
    throw new Error('sleep can only be called within a workflow')
  }

  const ms = parseDuration(duration)
  const durationStr = typeof duration === 'string' ? duration : formatDurationForCF(ms)
  const stepId = generateSleepStepId(ms)

  // Use the unified storage strategy pattern
  // - CFWorkflowsStorageStrategy: Uses step.sleep() - FREE, doesn't consume wall-clock time
  // - InMemoryStorageStrategy: Uses setTimeout with durable storage - BILLABLE
  const strategy = getCurrentStorageStrategy()
  await strategy.sleep(stepId, ms, durationStr)

  // Update in-memory cache for replay within same execution
  workflow.stepResults.set(stepId, true)
  workflow.historyLength++
}

// ============================================================================
// CONDITION
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function condition(fn: () => boolean, timeout?: string | number): Promise<boolean> {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('condition can only be called within a workflow')
  }

  const timeoutMs = timeout ? parseDuration(timeout) : undefined
  const startTime = Date.now()

  while (true) {
    try {
      if (fn()) {
        break
      }
    } catch (error) {
      // Log the error for debugging but let it propagate
      const err = error instanceof Error ? error : new Error(String(error))
      console.error(`[condition] Error in condition function: ${err.message}`)
      throw err
    }

    // Check timeout
    if (timeoutMs && Date.now() - startTime >= timeoutMs) {
      return false
    }

    // Poll every 100ms
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return true
}

// ============================================================================
// STATE CLEARING
// ============================================================================

/**
 * Clear all timer state (for testing)
 */
export function clearTimerState(): void {
  // Properly cancel all active timers to prevent memory leaks
  for (const timer of activeTimers.values()) {
    timer.pending = false
  }
  activeTimers.clear()

  // Clear bucket timeouts (timeouts are stored on buckets, not individual timers)
  for (const timeoutId of bucketTimeouts.values()) {
    clearTimeout(timeoutId)
  }
  bucketTimeouts.clear()

  // Clear coalesced timer buckets
  for (const timers of coalescedTimerBuckets.values()) {
    for (const timer of timers) {
      timer.pending = false
    }
  }
  coalescedTimerBuckets.clear()

  // Stop the periodic cleanup interval
  __stopTimerCleanup()
}
