/**
 * Storage Strategy Module
 *
 * Unified abstraction for step execution and durability.
 * Allows the Temporal compat layer to use different backends:
 * - CFWorkflowsStrategy: Uses native step.do() and step.sleep() when WorkflowStep is available
 * - InMemoryStrategy: Uses in-memory Maps with setTimeout for testing/fallback
 */

import { InMemoryStepStorage } from '../../runtime'
import type { StepStorage, StepResult } from '../../runtime'
import type { WorkflowStep, StepDoOptions, RetryOptions } from '../../../lib/cloudflare/workflows'
import { ensureError } from '../utils'
import type { StepExecutionOptions, CachedStepResult } from './types'

// ============================================================================
// STORAGE STRATEGY INTERFACE
// ============================================================================

/**
 * WorkflowStorageStrategy abstracts the underlying execution and storage mechanism.
 *
 * This pattern allows the Temporal compat layer to use different backends:
 * - CFWorkflowsStrategy: Uses native step.do() and step.sleep() when WorkflowStep is available
 * - InMemoryStrategy: Uses in-memory Maps with setTimeout for testing/fallback
 *
 * ## Cost Implications
 *
 * When using CFWorkflowsStrategy:
 * - sleep() uses step.sleep() - FREE (doesn't consume DO wall-clock time)
 * - Activities use step.do() - DURABLE (survives restarts, automatic retries)
 *
 * When using InMemoryStrategy (fallback):
 * - sleep() uses setTimeout - BILLABLE (consumes DO wall-clock time)
 * - Activities execute directly - NOT DURABLE (no automatic retries or persistence)
 */
export interface WorkflowStorageStrategy {
  /**
   * Execute a step with automatic caching and optional durability.
   *
   * @param name - Unique step name for caching/replay
   * @param fn - The function to execute
   * @param options - Execution options (timeout, retries)
   * @returns The result of the function
   */
  executeStep<T>(name: string, fn: () => T | Promise<T>, options?: StepExecutionOptions): Promise<T>

  /**
   * Sleep for a duration (durable when using CF Workflows).
   *
   * @param name - Unique step name for caching/replay
   * @param durationMs - Duration in milliseconds
   * @param durationStr - Original duration string for CF Workflows
   */
  sleep(name: string, durationMs: number, durationStr: string): Promise<void>

  /**
   * Check if a step has been completed (for replay optimization).
   *
   * @param name - Step name to check
   * @returns True if step is completed
   */
  isStepCompleted(name: string): Promise<boolean>

  /**
   * Get the cached result of a completed step.
   *
   * @param name - Step name to retrieve
   * @returns The cached result or undefined
   */
  getStepResult<T>(name: string): Promise<T | undefined>

  /**
   * Store a step result (for replay).
   *
   * @param name - Step name
   * @param result - Result to store
   */
  setStepResult(name: string, result: unknown): Promise<void>
}

// ============================================================================
// CFWORKFLOWS STORAGE STRATEGY
// ============================================================================

/**
 * CFWorkflowsStorageStrategy uses Cloudflare Workflows native APIs for durable execution.
 *
 * Benefits:
 * - sleep() is FREE - you don't pay for wall-clock time
 * - step.do() is DURABLE - survives worker restarts, automatic retries
 * - Replay is automatic - completed steps return cached results
 *
 * This strategy is automatically selected when a WorkflowStep is available
 * in the current workflow context.
 */
export class CFWorkflowsStorageStrategy implements WorkflowStorageStrategy {
  private readonly stepResults = new Map<string, CachedStepResult>()

  constructor(private readonly step: WorkflowStep) {}

  async executeStep<T>(name: string, fn: () => T | Promise<T>, options?: StepExecutionOptions): Promise<T> {
    // Check for cached result (replay)
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Build step.do() options from execution options
    const stepOptions: StepDoOptions | undefined = this.buildStepDoOptions(options)

    try {
      // Execute via step.do() for durability
      const result = stepOptions
        ? await this.step.do(name, stepOptions, async () => fn())
        : await this.step.do(name, async () => fn())

      // Cache the result with discriminated union
      this.stepResults.set(name, { status: 'success', value: result })
      return result
    } catch (error) {
      // Cache errors for deterministic replay
      const err = ensureError(error)
      this.stepResults.set(name, { status: 'error', error: err })
      throw err
    }
  }

  async sleep(name: string, _durationMs: number, durationStr: string): Promise<void> {
    // Check for cached completion (replay)
    if (this.stepResults.has(name)) {
      return
    }

    // Use CF Workflows native step.sleep() - FREE, doesn't consume wall-clock time
    await this.step.sleep(name, durationStr)

    // Cache completion
    this.stepResults.set(name, { status: 'success', value: true })
  }

  async isStepCompleted(name: string): Promise<boolean> {
    return this.stepResults.has(name)
  }

  async getStepResult<T>(name: string): Promise<T | undefined> {
    const cached = this.stepResults.get(name)
    if (!cached) return undefined
    if (cached.status === 'error') {
      throw cached.error
    }
    return cached.value as T
  }

  async setStepResult(name: string, result: unknown): Promise<void> {
    if (result instanceof Error) {
      this.stepResults.set(name, { status: 'error', error: result })
    } else {
      this.stepResults.set(name, { status: 'success', value: result })
    }
  }

  private buildStepDoOptions(options?: StepExecutionOptions): StepDoOptions | undefined {
    if (!options) return undefined

    const stepOptions: StepDoOptions = {}

    if (options.retries) {
      stepOptions.retries = options.retries
    }

    if (options.timeout) {
      stepOptions.timeout = options.timeout
    }

    // Only return if we have something to configure
    if (stepOptions.retries || stepOptions.timeout) {
      return stepOptions
    }
    return undefined
  }
}

// ============================================================================
// INMEMORY STORAGE STRATEGY
// ============================================================================

/**
 * InMemoryStorageStrategy provides fallback behavior when no WorkflowStep is available.
 *
 * This is used in:
 * - Testing environments
 * - Development without CF Workflows runtime
 * - Direct workflow execution outside of CF Workflows
 *
 * Cost: sleep() uses setTimeout which is BILLABLE (consumes DO wall-clock time)
 */
export class InMemoryStorageStrategy implements WorkflowStorageStrategy {
  private readonly stepResults = new Map<string, CachedStepResult>()
  private readonly durableStorage: StepStorage

  constructor(storage?: StepStorage) {
    this.durableStorage = storage ?? new InMemoryStepStorage()
  }

  async executeStep<T>(name: string, fn: () => T | Promise<T>, _options?: StepExecutionOptions): Promise<T> {
    // Check in-memory cache first
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Check durable storage for completed steps (survives worker restarts)
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      this.stepResults.set(name, { status: 'success', value: durableResult.result })
      return durableResult.result as T
    }

    // Execute the function
    try {
      const result = await fn()

      // Store in both in-memory and durable storage
      this.stepResults.set(name, { status: 'success', value: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      })

      return result
    } catch (error) {
      const err = ensureError(error)
      this.stepResults.set(name, { status: 'error', error: err })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'failed',
        error: err.message,
        attempts: 1,
        createdAt: Date.now(),
      })
      throw err
    }
  }

  async sleep(name: string, durationMs: number, _durationStr: string): Promise<void> {
    // Check for cached completion
    if (this.stepResults.has(name)) {
      return
    }

    // Check durable storage
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      this.stepResults.set(name, { status: 'success', value: true })
      return
    }

    // Persist pending state before sleeping
    await this.durableStorage.set(name, {
      stepId: name,
      status: 'pending',
      attempts: 1,
      createdAt: Date.now(),
    })

    // Fallback to setTimeout - BILLABLE
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))

    // Persist completed state
    await this.durableStorage.set(name, {
      stepId: name,
      status: 'completed',
      result: true,
      attempts: 1,
      createdAt: Date.now(),
      completedAt: Date.now(),
    })

    this.stepResults.set(name, { status: 'success', value: true })
  }

  async isStepCompleted(name: string): Promise<boolean> {
    if (this.stepResults.has(name)) {
      return true
    }

    const durableResult = await this.durableStorage.get(name)
    return durableResult?.status === 'completed'
  }

  async getStepResult<T>(name: string): Promise<T | undefined> {
    // Check in-memory first
    const cached = this.stepResults.get(name)
    if (cached) {
      if (cached.status === 'error') {
        throw cached.error
      }
      return cached.value as T
    }

    // Check durable storage
    const durableResult = await this.durableStorage.get(name)
    if (durableResult?.status === 'completed') {
      return durableResult.result as T | undefined
    }

    return undefined
  }

  async setStepResult(name: string, result: unknown): Promise<void> {
    if (result instanceof Error) {
      this.stepResults.set(name, { status: 'error', error: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'failed',
        error: result.message,
        attempts: 1,
        createdAt: Date.now(),
      })
    } else {
      this.stepResults.set(name, { status: 'success', value: result })
      await this.durableStorage.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      })
    }
  }

  /**
   * Clear all cached results (for testing)
   */
  clear(): void {
    this.stepResults.clear()
  }
}

// ============================================================================
// STRATEGY FACTORY
// ============================================================================

/**
 * Get the appropriate storage strategy for the current workflow execution.
 *
 * Selection logic:
 * 1. If WorkflowStep is available in context, use CFWorkflowsStorageStrategy (FREE sleeping, durable)
 * 2. Otherwise, use InMemoryStorageStrategy (fallback, BILLABLE sleeping)
 *
 * @param workflowStep - Optional WorkflowStep from CF Workflows runtime
 * @param storage - Optional StepStorage for InMemory fallback
 * @returns The appropriate storage strategy
 */
export function createStorageStrategy(
  workflowStep: WorkflowStep | null,
  storage?: StepStorage
): WorkflowStorageStrategy {
  if (workflowStep) {
    return new CFWorkflowsStorageStrategy(workflowStep)
  }
  return new InMemoryStorageStrategy(storage)
}
