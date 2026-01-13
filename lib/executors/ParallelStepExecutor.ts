/**
 * ParallelStepExecutor - Parallel step execution for workflows
 *
 * Provides:
 * - step() helper for defining parallel steps
 * - Concurrent execution of grouped steps
 * - Fail-fast or wait-for-all modes
 * - Output merging from parallel steps
 *
 * Usage:
 * ```typescript
 * workflow
 *   .step('validate', validateOrder)
 *   .parallel([
 *     step('checkInventory', checkStock),
 *     step('checkPayment', validatePayment),
 *     step('checkShipping', calculateShipping),
 *   ])
 *   .step('confirm', confirmOrder)
 *
 * // Parallel outputs merged: { checkInventory: {...}, checkPayment: {...}, checkShipping: {...} }
 * ```
 */

import type { StepContext, WorkflowStepConfig } from '../../objects/WorkflowRuntime'

// ============================================================================
// TYPES
// ============================================================================

export interface ParallelStepDefinition {
  name: string
  handler: (ctx: StepContext) => Promise<unknown>
  config?: WorkflowStepConfig
}

export interface ParallelStepResult {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: Error
  duration?: number
  startedAt?: Date
  completedAt?: Date
}

export interface ParallelExecutionResult {
  results: Record<string, ParallelStepResult>
  merged: unknown
  completedCount: number
  failedCount: number
  duration: number
}

export type ParallelMode = 'failFast' | 'waitForAll' | 'allowPartialFailure'

export interface ParallelOptions {
  /** Name for the parallel group */
  name?: string
  /** Execution mode: failFast (default), waitForAll, or allowPartialFailure */
  mode?: ParallelMode
  /** Global timeout for the entire parallel group */
  timeout?: string | number
  /** Custom output merger function */
  merge?: (results: Record<string, unknown>) => unknown
}

// ============================================================================
// ERRORS
// ============================================================================

export class ParallelExecutionError extends Error {
  readonly failedStep: string
  readonly errors: Error[]
  override readonly cause?: Error

  constructor(failedStep: string, cause?: Error, allErrors?: Error[]) {
    const message = allErrors && allErrors.length > 1
      ? `Parallel execution failed: ${allErrors.length} steps failed`
      : `Parallel step '${failedStep}' failed: ${cause?.message || 'Unknown error'}`
    super(message)
    this.name = 'ParallelExecutionError'
    this.failedStep = failedStep
    this.cause = cause
    this.errors = allErrors || (cause ? [cause] : [])
  }
}

export class ParallelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParallelValidationError'
  }
}

// ============================================================================
// STEP HELPER
// ============================================================================

/**
 * Create a parallel step definition
 */
export function step(
  name: string,
  handler: (ctx: StepContext) => Promise<unknown>,
  config?: WorkflowStepConfig
): ParallelStepDefinition {
  return { name, handler, config }
}

// ============================================================================
// DURATION PARSING
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|millisecond|s|sec|second|m|min|minute|h|hr|hour|d|day|w|week)s?$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1]!)
  const unit = match[2]!.toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    millisecond: 1,
    s: 1000,
    sec: 1000,
    second: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return value * (multipliers[unit] || 1000)
}

// ============================================================================
// PARALLEL STEP EXECUTOR
// ============================================================================

export class ParallelStepExecutor {
  private steps: ParallelStepDefinition[]
  private options: ParallelOptions
  private results: Map<string, ParallelStepResult> = new Map()
  private abortController: AbortController | null = null

  constructor(steps: ParallelStepDefinition[], options: ParallelOptions = {}) {
    this.validateSteps(steps)
    this.steps = steps
    this.options = {
      mode: 'failFast',
      ...options,
    }
  }

  private validateSteps(steps: ParallelStepDefinition[]): void {
    if (!steps || steps.length < 2) {
      throw new ParallelValidationError('Parallel execution requires at least two steps')
    }

    const names = new Set<string>()
    for (const step of steps) {
      if (!step.name || typeof step.name !== 'string') {
        throw new ParallelValidationError('Each parallel step must have a name')
      }
      if (names.has(step.name)) {
        throw new ParallelValidationError(`Duplicate step name: ${step.name}`)
      }
      names.add(step.name)

      if (typeof step.handler !== 'function') {
        throw new ParallelValidationError(`Step '${step.name}' must have a handler function`)
      }
    }
  }

  /**
   * Execute all steps in parallel
   */
  async execute(
    baseContext: Omit<StepContext, 'stepName' | 'stepIndex'>,
    onStepStart?: (stepName: string) => void,
    onStepComplete?: (stepName: string, result: ParallelStepResult) => void,
    completedSteps?: Map<string, ParallelStepResult>
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now()
    this.results.clear()
    this.abortController = new AbortController()

    // Initialize results from any already-completed steps
    if (completedSteps) {
      for (const [name, result] of completedSteps) {
        this.results.set(name, result)
      }
    }

    // Filter to only steps that need execution
    const stepsToExecute = this.steps.filter((s) => {
      const existing = this.results.get(s.name)
      return !existing || existing.status !== 'completed'
    })

    // Create execution promises for remaining steps
    const executions = stepsToExecute.map((step, index) =>
      this.executeStep(step, index, baseContext, onStepStart, onStepComplete)
    )

    const errors: Error[] = []
    let firstFailedStep: string | null = null

    try {
      if (this.options.mode === 'failFast') {
        // Promise.all fails fast on first rejection
        await Promise.all(executions)
      } else {
        // Wait for all regardless of failures
        const results = await Promise.allSettled(executions)
        const originalErrors: Error[] = []

        for (const result of results) {
          if (result.status === 'rejected') {
            const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason))
            errors.push(error)

            // Extract step name and original error from ParallelExecutionError
            if (error instanceof ParallelExecutionError) {
              if (!firstFailedStep) {
                firstFailedStep = error.failedStep
              }
              // Get the original error (cause) for the error list
              if (error.cause) {
                originalErrors.push(error.cause)
              } else {
                originalErrors.push(error)
              }
            } else {
              originalErrors.push(error)
            }
          }
        }

        if (errors.length > 0 && this.options.mode !== 'allowPartialFailure') {
          throw new ParallelExecutionError(
            firstFailedStep || 'unknown',
            originalErrors[0],
            originalErrors
          )
        }
      }
    } catch (error) {
      if (error instanceof ParallelExecutionError) {
        throw error
      }

      // Find which step failed
      for (const [name, result] of this.results) {
        if (result.status === 'failed') {
          firstFailedStep = name
          break
        }
      }

      throw new ParallelExecutionError(
        firstFailedStep || 'unknown',
        error instanceof Error ? error : new Error(String(error))
      )
    } finally {
      this.abortController = null
    }

    // Build merged output
    const outputsByName: Record<string, unknown> = {}
    for (const [name, result] of this.results) {
      if (result.status === 'completed') {
        outputsByName[name] = result.output
      }
    }

    const merged = this.options.merge
      ? this.options.merge(outputsByName)
      : outputsByName

    return {
      results: Object.fromEntries(this.results),
      merged,
      completedCount: Array.from(this.results.values()).filter((r) => r.status === 'completed').length,
      failedCount: Array.from(this.results.values()).filter((r) => r.status === 'failed').length,
      duration: Date.now() - startTime,
    }
  }

  private async executeStep(
    step: ParallelStepDefinition,
    index: number,
    baseContext: Omit<StepContext, 'stepName' | 'stepIndex'>,
    onStepStart?: (stepName: string) => void,
    onStepComplete?: (stepName: string, result: ParallelStepResult) => void
  ): Promise<void> {
    const result: ParallelStepResult = {
      name: step.name,
      status: 'running',
      startedAt: new Date(),
    }
    this.results.set(step.name, result)

    onStepStart?.(step.name)

    const context: StepContext = {
      ...baseContext,
      stepName: step.name,
      stepIndex: index,
    }

    try {
      // Handle timeout
      let output: unknown
      const stepTimeout = step.config?.timeout
      const groupTimeout = this.options.timeout

      const timeoutMs = stepTimeout
        ? parseDuration(stepTimeout)
        : groupTimeout
          ? parseDuration(groupTimeout)
          : undefined

      if (timeoutMs) {
        output = await this.executeWithTimeout(step.handler, context, timeoutMs)
      } else {
        output = await this.executeWithRetries(step, context)
      }

      result.status = 'completed'
      result.output = output
      result.completedAt = new Date()
      result.duration = result.completedAt.getTime() - result.startedAt!.getTime()

      onStepComplete?.(step.name, result)
    } catch (error) {
      result.status = 'failed'
      result.error = error instanceof Error ? error : new Error(String(error))
      result.completedAt = new Date()
      result.duration = result.completedAt.getTime() - result.startedAt!.getTime()

      onStepComplete?.(step.name, result)

      // In failFast mode, signal other steps to abort
      if (this.options.mode === 'failFast' && this.abortController) {
        this.abortController.abort()
      }

      throw new ParallelExecutionError(step.name, result.error)
    }
  }

  private async executeWithTimeout(
    handler: (ctx: StepContext) => Promise<unknown>,
    context: StepContext,
    timeoutMs: number
  ): Promise<unknown> {
    return Promise.race([
      handler(context),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Step '${context.stepName}' timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  }

  private async executeWithRetries(
    step: ParallelStepDefinition,
    context: StepContext
  ): Promise<unknown> {
    const maxRetries = step.config?.retries || 0
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await step.handler(context)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt >= maxRetries) {
          throw lastError
        }

        // Wait before retry
        if (step.config?.retryDelay) {
          const delayMs = parseDuration(step.config.retryDelay)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }

    throw lastError
  }

  /**
   * Get current results
   */
  getResults(): Map<string, ParallelStepResult> {
    return new Map(this.results)
  }

  /**
   * Abort execution
   */
  abort(): void {
    this.abortController?.abort()
  }
}

export default ParallelStepExecutor
