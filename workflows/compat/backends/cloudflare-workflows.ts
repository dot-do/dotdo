/**
 * Cloudflare Workflows Backend Adapter
 *
 * Provides a CF Workflows backend for the compat layers, offering:
 * - Hot execution (fast, sub-100ms startup)
 * - Out-of-band processing (doesn't block the DO)
 * - Cost-efficient for workflows with wait periods (no wall-clock billing)
 *
 * CF Workflows is 100-1000x cheaper than pure DO for background jobs
 * because you only pay for CPU time, not wall-clock duration.
 *
 * @example
 * ```typescript
 * import { CFWorkflowsBackend } from '@dotdo/workflows/backends'
 *
 * const backend = new CFWorkflowsBackend(env.MY_WORKFLOW)
 *
 * // Execute a step durably
 * const result = await backend.step('fetch-user', async () => {
 *   return await db.users.get(userId)
 * })
 *
 * // Sleep without paying for wall-clock time
 * await backend.sleep('wait-for-approval', '24h')
 *
 * // Wait for external event
 * const event = await backend.waitForEvent('payment.completed', { timeout: '7d' })
 * ```
 */

import {
  WorkflowStep,
  WorkflowEvent,
  WorkflowParams,
  StepDoOptions,
  WaitForEventOptions,
  RetryOptions,
  WorkflowInstanceStatus,
  StepContext,
  WorkflowInstanceManager,
} from '../../../lib/cloudflare/workflows'
import type { StepStorage, StepResult } from '../../runtime'

// ============================================================================
// TYPES
// ============================================================================

/**
 * CF Workflows binding from environment
 */
export interface WorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>
  createBatch(items: Array<{ id?: string; params?: unknown }>): Promise<Array<{ id: string }>>
  get(id: string): Promise<WorkflowInstance>
}

/**
 * CF Workflows instance handle
 */
export interface WorkflowInstance {
  id: string
  status(): Promise<{
    status: WorkflowInstanceStatus
    output?: unknown
    error?: { message: string }
  }>
  pause(): Promise<void>
  resume(): Promise<void>
  terminate(): Promise<void>
  restart(): Promise<void>
  sendEvent(event: { type: string; payload?: unknown }): Promise<void>
}

/**
 * Backend configuration
 */
export interface CFWorkflowsBackendConfig {
  /** Default retry policy */
  retries?: RetryOptions
  /** Default step timeout */
  timeout?: string
  /** Enable R2 storage for large step results */
  r2Bucket?: R2Bucket
  /** Size threshold for R2 offloading (default: 100KB) */
  r2Threshold?: number
}

/**
 * Step execution options
 */
export interface StepOptions {
  retries?: RetryOptions
  timeout?: string
}

/**
 * Backend execution mode
 */
export type BackendMode = 'do' | 'workflows' | 'auto'

// ============================================================================
// CF WORKFLOWS BACKEND
// ============================================================================

/**
 * Cloudflare Workflows backend adapter
 *
 * Wraps the native CF Workflows API to provide a consistent interface
 * for the compat layers. Enables hot, out-of-band execution that's
 * significantly cheaper than pure DO for workflows with wait periods.
 */
export class CFWorkflowsBackend implements StepStorage {
  private readonly config: CFWorkflowsBackendConfig
  private readonly stepResults = new Map<string, StepResult>()
  private currentStep: WorkflowStep | null = null

  constructor(
    private readonly binding?: WorkflowBinding,
    config: CFWorkflowsBackendConfig = {}
  ) {
    this.config = {
      retries: config.retries ?? { limit: 3, backoff: 'exponential', delay: '1s' },
      timeout: config.timeout ?? '5m',
      r2Threshold: config.r2Threshold ?? 100 * 1024,
      ...config,
    }
  }

  /**
   * Set the current workflow step (called by WorkflowEntrypoint)
   */
  setStep(step: WorkflowStep): void {
    this.currentStep = step
  }

  // ==========================================================================
  // STEP STORAGE INTERFACE
  // ==========================================================================

  async get(stepId: string): Promise<StepResult | undefined> {
    return this.stepResults.get(stepId)
  }

  async set(stepId: string, result: StepResult): Promise<void> {
    this.stepResults.set(stepId, result)
  }

  async delete(stepId: string): Promise<void> {
    this.stepResults.delete(stepId)
  }

  async list(): Promise<StepResult[]> {
    return Array.from(this.stepResults.values())
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  /**
   * Execute a durable step with automatic retries
   *
   * When running on CF Workflows, this uses step.do() which:
   * - Persists the result durably
   * - Retries automatically on failure
   * - Replays without re-executing on workflow restart
   */
  async step<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: StepOptions
  ): Promise<T> {
    // Check for cached result (replay)
    const cached = this.stepResults.get(name)
    if (cached?.status === 'completed') {
      return cached.result as T
    }

    // Use CF Workflows step.do() if available
    if (this.currentStep) {
      const stepOptions: StepDoOptions = {
        retries: options?.retries ?? this.config.retries,
        timeout: options?.timeout ?? this.config.timeout,
      }

      const result = await this.currentStep.do(name, stepOptions, async () => {
        return fn()
      })

      // Cache the result
      this.stepResults.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      })

      return result
    }

    // Fallback to direct execution (testing/dev mode)
    const startedAt = Date.now()
    try {
      const result = await fn()
      this.stepResults.set(name, {
        stepId: name,
        status: 'completed',
        result,
        attempts: 1,
        createdAt: startedAt,
        completedAt: Date.now(),
      })
      return result
    } catch (error) {
      this.stepResults.set(name, {
        stepId: name,
        status: 'failed',
        error: (error as Error).message,
        attempts: 1,
        createdAt: startedAt,
      })
      throw error
    }
  }

  // ==========================================================================
  // SLEEP / WAIT
  // ==========================================================================

  /**
   * Sleep for a duration
   *
   * On CF Workflows, sleeping is FREE - you don't pay for wall-clock time.
   * This makes it ideal for workflows that need to wait hours or days.
   */
  async sleep(name: string, duration: string): Promise<void> {
    // Check for cached completion (replay)
    const cached = this.stepResults.get(name)
    if (cached?.status === 'completed') {
      return
    }

    if (this.currentStep) {
      await this.currentStep.sleep(name, duration)
    } else {
      // Fallback: parse duration and setTimeout
      const ms = parseDuration(duration)
      await new Promise((resolve) => setTimeout(resolve, ms))
    }

    this.stepResults.set(name, {
      stepId: name,
      status: 'completed',
      result: true,
      attempts: 1,
      createdAt: Date.now(),
      completedAt: Date.now(),
    })
  }

  /**
   * Sleep until a specific timestamp
   */
  async sleepUntil(name: string, timestamp: Date | number): Promise<void> {
    const cached = this.stepResults.get(name)
    if (cached?.status === 'completed') {
      return
    }

    if (this.currentStep) {
      await this.currentStep.sleepUntil(name, timestamp)
    } else {
      const targetMs = timestamp instanceof Date ? timestamp.getTime() : timestamp * 1000
      const delayMs = Math.max(0, targetMs - Date.now())
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    this.stepResults.set(name, {
      stepId: name,
      status: 'completed',
      result: true,
      attempts: 1,
      createdAt: Date.now(),
      completedAt: Date.now(),
    })
  }

  /**
   * Wait for an external event
   *
   * On CF Workflows, waiting is FREE - you don't pay for wall-clock time.
   * Events can be sent before the workflow reaches this step (buffered).
   */
  async waitForEvent<T = unknown>(
    name: string,
    options?: WaitForEventOptions
  ): Promise<T | null> {
    const cached = this.stepResults.get(name)
    if (cached?.status === 'completed') {
      return cached.result as T
    }

    if (this.currentStep) {
      try {
        const result = await this.currentStep.waitForEvent<T>(name, options)
        this.stepResults.set(name, {
          stepId: name,
          status: 'completed',
          result,
          attempts: 1,
          createdAt: Date.now(),
          completedAt: Date.now(),
        })
        return result
      } catch (error) {
        // Timeout
        this.stepResults.set(name, {
          stepId: name,
          status: 'completed',
          result: null,
          attempts: 1,
          createdAt: Date.now(),
          completedAt: Date.now(),
        })
        return null
      }
    }

    // Fallback: No event delivery in dev mode
    return null
  }

  // ==========================================================================
  // INSTANCE MANAGEMENT
  // ==========================================================================

  /**
   * Create a new workflow instance
   */
  async createInstance(params?: unknown, id?: string): Promise<{ id: string }> {
    if (!this.binding) {
      throw new Error('Workflow binding not configured')
    }
    return this.binding.create({ id, params })
  }

  /**
   * Create multiple workflow instances in batch
   */
  async createBatch(
    items: Array<{ id?: string; params?: unknown }>
  ): Promise<Array<{ id: string }>> {
    if (!this.binding) {
      throw new Error('Workflow binding not configured')
    }
    return this.binding.createBatch(items)
  }

  /**
   * Get a workflow instance handle
   */
  async getInstance(id: string): Promise<WorkflowInstance> {
    if (!this.binding) {
      throw new Error('Workflow binding not configured')
    }
    return this.binding.get(id)
  }

  /**
   * Get workflow instance status
   */
  async getStatus(id: string): Promise<{
    status: WorkflowInstanceStatus
    output?: unknown
    error?: { message: string }
  }> {
    const instance = await this.getInstance(id)
    return instance.status()
  }

  /**
   * Send an event to a workflow instance
   */
  async sendEvent(
    instanceId: string,
    type: string,
    payload?: unknown
  ): Promise<void> {
    const instance = await this.getInstance(instanceId)
    await instance.sendEvent({ type, payload })
  }

  /**
   * Pause a workflow instance
   */
  async pause(id: string): Promise<void> {
    const instance = await this.getInstance(id)
    await instance.pause()
  }

  /**
   * Resume a paused workflow instance
   */
  async resume(id: string): Promise<void> {
    const instance = await this.getInstance(id)
    await instance.resume()
  }

  /**
   * Terminate a workflow instance
   */
  async terminate(id: string): Promise<void> {
    const instance = await this.getInstance(id)
    await instance.terminate()
  }

  /**
   * Restart a workflow instance from the beginning
   */
  async restart(id: string): Promise<void> {
    const instance = await this.getInstance(id)
    await instance.restart()
  }
}

// ============================================================================
// HYBRID BACKEND - Auto-selects DO or CF Workflows
// ============================================================================

/**
 * Hybrid backend that auto-selects between DO and CF Workflows
 * based on the workflow characteristics
 */
export class HybridWorkflowBackend {
  constructor(
    private readonly cfBackend: CFWorkflowsBackend,
    private readonly doStorage: StepStorage,
    private readonly mode: BackendMode = 'auto'
  ) {}

  /**
   * Determine which backend to use based on step characteristics
   *
   * - Use CF Workflows for: long sleeps, waitForEvent, batch processing
   * - Use DO for: real-time requirements, frequent state access, WebSocket
   */
  private selectBackend(stepType: 'do' | 'sleep' | 'waitForEvent'): StepStorage {
    if (this.mode === 'do') {
      return this.doStorage
    }
    if (this.mode === 'workflows') {
      return this.cfBackend
    }

    // Auto mode: select based on step type
    switch (stepType) {
      case 'sleep':
      case 'waitForEvent':
        // CF Workflows is much cheaper for waiting
        return this.cfBackend
      case 'do':
      default:
        // Use DO for quick steps (lower latency)
        return this.doStorage
    }
  }

  async step<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: StepOptions
  ): Promise<T> {
    const backend = this.selectBackend('do')
    if (backend === this.cfBackend) {
      return this.cfBackend.step(name, fn, options)
    } else {
      // Use DO storage for step execution
      const cached = await this.doStorage.get(name)
      if (cached?.status === 'completed') {
        return cached.result as T
      }

      const startedAt = Date.now()
      try {
        const result = await fn()
        await this.doStorage.set(name, {
          stepId: name,
          status: 'completed',
          result,
          attempts: 1,
          createdAt: startedAt,
          completedAt: Date.now(),
        })
        return result
      } catch (error) {
        await this.doStorage.set(name, {
          stepId: name,
          status: 'failed',
          error: (error as Error).message,
          attempts: 1,
          createdAt: startedAt,
        })
        throw error
      }
    }
  }

  async sleep(name: string, duration: string): Promise<void> {
    const backend = this.selectBackend('sleep')
    if (backend === this.cfBackend) {
      return this.cfBackend.sleep(name, duration)
    }
    // DO fallback - use setTimeout
    const ms = parseDuration(duration)
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  async waitForEvent<T = unknown>(name: string, options?: WaitForEventOptions): Promise<T | null> {
    const backend = this.selectBackend('waitForEvent')
    if (backend === this.cfBackend) {
      return this.cfBackend.waitForEvent<T>(name, options)
    }
    // DO fallback - would need WaitForEventManager integration
    return null
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|hour|d|day|w|week)s?$/i)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    sec: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return Math.floor(value * (multipliers[unit] || 1000))
}

// ============================================================================
// EXPORTS
// ============================================================================

export default CFWorkflowsBackend
