/**
 * TestWorkflowRuntime - Workflow runtime with test hooks
 *
 * Provides a test-friendly workflow runtime with:
 * - Step execution hooks (beforeStep/afterStep)
 * - Mock service injection (mockDomain)
 * - Time control for testing (advanceTime)
 * - State inspection (getState, getExecutedSteps)
 *
 * @example
 * ```typescript
 * import { createTestWorkflowRuntime } from 'dotdo/testing'
 *
 * const runtime = createTestWorkflowRuntime()
 *
 * // Mock a domain handler
 * runtime.mockDomain('Inventory', {
 *   check: async () => ({ available: true, quantity: 42 }),
 *   reserve: async (ctx, args) => ({ reservationId: 'mock-123' }),
 * })
 *
 * // Add step hooks
 * runtime.beforeStep((stepId, pipeline) => {
 *   console.log(`Starting step: ${stepId}`)
 * })
 *
 * runtime.afterStep((stepId, result) => {
 *   console.log(`Completed step: ${stepId}`)
 * })
 *
 * // Execute workflow steps...
 *
 * // Inspect state
 * const steps = runtime.getExecutedSteps()
 * const state = runtime.getState()
 *
 * // Assert on specific step
 * runtime.assertStepExecuted('Inventory.check')
 * runtime.assertStepResult('Inventory.check', { available: true })
 * ```
 *
 * @module dotdo/testing
 */

import type { Pipeline, WorkflowRuntime } from '../workflows/proxy'
import type { StepResult, StepStorage, RetryPolicy, ExecutionMode } from '../workflows/runtime'
import { InMemoryStepStorage, DurableWorkflowRuntime } from '../workflows/runtime'

// ============================================================================
// Types
// ============================================================================

/**
 * Step execution record with full details for testing
 */
export interface StepExecution {
  stepId: string
  pipeline: Pipeline
  args: unknown[]
  mode: ExecutionMode
  result?: unknown
  error?: Error
  startedAt: number
  completedAt?: number
  duration?: number
}

/**
 * Hook function called before a step executes
 */
export type BeforeStepHook = (stepId: string, pipeline: Pipeline, args: unknown[]) => void | Promise<void>

/**
 * Hook function called after a step completes
 */
export type AfterStepHook = (stepId: string, result: unknown, execution: StepExecution) => void | Promise<void>

/**
 * Hook function called when a step fails
 */
export type OnStepErrorHook = (stepId: string, error: Error, execution: StepExecution) => void | Promise<void>

/**
 * Mock handler function signature
 */
export type MockHandler<TContext = unknown, TArgs = unknown, TResult = unknown> = (
  context: TContext,
  args: TArgs,
  $: unknown
) => TResult | Promise<TResult>

/**
 * Map of handler names to mock handler functions
 */
export type MockHandlerMap = Record<string, MockHandler>

/**
 * Options for creating a test workflow runtime
 */
export interface TestRuntimeOptions {
  /** Initial storage (defaults to InMemoryStepStorage) */
  storage?: StepStorage
  /** Custom retry policy (defaults to single attempt, no delays) */
  retryPolicy?: Partial<RetryPolicy>
  /** Start time for simulated time (defaults to Date.now()) */
  startTime?: number
  /** Whether to auto-advance time (defaults to true) */
  autoAdvanceTime?: boolean
}

/**
 * State snapshot for inspection
 */
export interface RuntimeState {
  /** All executed steps */
  executedSteps: StepExecution[]
  /** Mocked domains and their handlers */
  mockedDomains: Map<string, MockHandlerMap>
  /** Current simulated time */
  currentTime: number
  /** Step storage contents */
  storedSteps: StepResult[]
  /** Number of total step executions */
  totalExecutions: number
  /** Number of successful executions */
  successfulExecutions: number
  /** Number of failed executions */
  failedExecutions: number
}

/**
 * Simulated step failure configuration
 */
export interface SimulatedFailure {
  stepId: string
  error: Error
  /** Number of times to fail before succeeding (undefined = always fail) */
  failCount?: number
  /** Current failure count */
  currentFailures: number
}

// ============================================================================
// TestWorkflowRuntime Interface
// ============================================================================

/**
 * Test-friendly workflow runtime with inspection and control hooks
 */
export interface TestWorkflowRuntime extends WorkflowRuntime {
  // Execution
  executeStep<T>(stepId: string, pipeline: Pipeline, args: unknown[], mode?: ExecutionMode): Promise<T>

  // Hooks
  beforeStep(hook: BeforeStepHook): () => void
  afterStep(hook: AfterStepHook): () => void
  onStepError(hook: OnStepErrorHook): () => void

  // Mock injection
  mockDomain(name: string, handlers: MockHandlerMap): void
  clearMock(name: string): void
  clearAllMocks(): void
  getMockedDomains(): Map<string, MockHandlerMap>

  // Time control
  advanceTime(ms: number): void
  setTime(time: number): void
  getTime(): number

  // State inspection
  getExecutedSteps(): StepExecution[]
  getStepById(stepId: string): StepExecution | undefined
  getStepsByDomain(domain: string): StepExecution[]
  getState(): RuntimeState

  // Failure simulation
  simulateStepFailure(stepId: string | RegExp, error: Error, failCount?: number): void
  clearSimulatedFailure(stepId: string | RegExp): void
  clearAllSimulatedFailures(): void

  // Assertions
  assertStepExecuted(stepId: string): void
  assertStepNotExecuted(stepId: string): void
  assertStepResult(stepId: string, expected: unknown): void
  assertStepFailed(stepId: string, errorMatch?: string | RegExp): void
  assertHandlerCalled(domain: string, method: string, times?: number): void

  // Storage access
  getStorage(): StepStorage

  // Reset
  reset(options?: { clearStorage?: boolean; clearMocks?: boolean; resetTime?: boolean }): void
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Internal implementation of TestWorkflowRuntime
 */
class TestWorkflowRuntimeImpl implements TestWorkflowRuntime {
  private storage: StepStorage
  private retryPolicy: RetryPolicy
  private mockedDomains = new Map<string, MockHandlerMap>()
  private executedSteps: StepExecution[] = []
  private beforeStepHooks: BeforeStepHook[] = []
  private afterStepHooks: AfterStepHook[] = []
  private onStepErrorHooks: OnStepErrorHook[] = []
  private simulatedFailures: SimulatedFailure[] = []
  private currentTime: number
  private autoAdvanceTime: boolean
  private totalExecutions = 0
  private successfulExecutions = 0
  private failedExecutions = 0

  constructor(options: TestRuntimeOptions = {}) {
    this.storage = options.storage ?? new InMemoryStepStorage()
    this.retryPolicy = {
      maxAttempts: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
      backoffMultiplier: 1,
      jitter: false,
      ...options.retryPolicy,
    }
    this.currentTime = options.startTime ?? Date.now()
    this.autoAdvanceTime = options.autoAdvanceTime ?? true
  }

  // =========================================================================
  // Step Execution
  // =========================================================================

  async executeStep<T>(
    stepId: string,
    pipeline: Pipeline,
    args: unknown[],
    mode: ExecutionMode = 'do'
  ): Promise<T> {
    const execution: StepExecution = {
      stepId,
      pipeline,
      args,
      mode,
      startedAt: this.currentTime,
    }

    this.totalExecutions++

    // Run beforeStep hooks
    for (const hook of this.beforeStepHooks) {
      await hook(stepId, pipeline, args)
    }

    try {
      // Check for simulated failures
      const simulatedFailure = this.getSimulatedFailure(stepId)
      if (simulatedFailure) {
        simulatedFailure.currentFailures++
        if (simulatedFailure.failCount === undefined || simulatedFailure.currentFailures <= simulatedFailure.failCount) {
          throw simulatedFailure.error
        }
      }

      // Check for replayed result in durable mode
      if (mode === 'do') {
        const existing = await this.storage.get(stepId)
        if (existing?.status === 'completed') {
          execution.result = existing.result
          execution.completedAt = this.currentTime
          execution.duration = 0
          this.executedSteps.push(execution)
          this.successfulExecutions++

          // Run afterStep hooks
          for (const hook of this.afterStepHooks) {
            await hook(stepId, existing.result, execution)
          }

          return existing.result as T
        }
      }

      // Execute the handler
      const result = await this.invokeHandler<T>(pipeline, args)

      // Update execution record
      if (this.autoAdvanceTime) {
        this.currentTime += 1 // Simulate 1ms per step
      }
      execution.result = result
      execution.completedAt = this.currentTime
      execution.duration = execution.completedAt - execution.startedAt

      // Persist result for durable mode
      if (mode === 'do') {
        await this.storage.set(stepId, {
          stepId,
          status: 'completed',
          result,
          attempts: 1,
          createdAt: execution.startedAt,
          completedAt: execution.completedAt,
        })
      }

      this.executedSteps.push(execution)
      this.successfulExecutions++

      // Run afterStep hooks
      for (const hook of this.afterStepHooks) {
        await hook(stepId, result, execution)
      }

      return result
    } catch (error) {
      if (this.autoAdvanceTime) {
        this.currentTime += 1
      }
      execution.error = error as Error
      execution.completedAt = this.currentTime
      execution.duration = execution.completedAt - execution.startedAt

      // Persist failure for durable mode
      if (mode === 'do') {
        await this.storage.set(stepId, {
          stepId,
          status: 'failed',
          error: (error as Error).message,
          attempts: 1,
          createdAt: execution.startedAt,
        })
      }

      this.executedSteps.push(execution)
      this.failedExecutions++

      // Run error hooks
      for (const hook of this.onStepErrorHooks) {
        await hook(stepId, error as Error, execution)
      }

      throw error
    }
  }

  private async invokeHandler<T>(pipeline: Pipeline, args: unknown[]): Promise<T> {
    const [domain, method] = pipeline.path

    // Check mocked domains first
    if (domain && this.mockedDomains.has(domain)) {
      const handlers = this.mockedDomains.get(domain)!
      if (method && handlers[method]) {
        return handlers[method](pipeline.context, args[0], this) as T
      }
      throw new Error(`Mocked domain "${domain}" does not have handler "${method}"`)
    }

    // Fall back to global registry
    // Import dynamically to avoid circular dependencies
    const { resolveHandler } = await import('../workflows/domain')
    const handler = resolveHandler(pipeline.path)

    if (!handler) {
      throw new Error(`Handler not found: ${pipeline.path.join('.')}`)
    }

    return handler.fn(pipeline.context, args[0], this) as T
  }

  // =========================================================================
  // Hooks
  // =========================================================================

  beforeStep(hook: BeforeStepHook): () => void {
    this.beforeStepHooks.push(hook)
    return () => {
      const index = this.beforeStepHooks.indexOf(hook)
      if (index !== -1) {
        this.beforeStepHooks.splice(index, 1)
      }
    }
  }

  afterStep(hook: AfterStepHook): () => void {
    this.afterStepHooks.push(hook)
    return () => {
      const index = this.afterStepHooks.indexOf(hook)
      if (index !== -1) {
        this.afterStepHooks.splice(index, 1)
      }
    }
  }

  onStepError(hook: OnStepErrorHook): () => void {
    this.onStepErrorHooks.push(hook)
    return () => {
      const index = this.onStepErrorHooks.indexOf(hook)
      if (index !== -1) {
        this.onStepErrorHooks.splice(index, 1)
      }
    }
  }

  // =========================================================================
  // Mock Injection
  // =========================================================================

  mockDomain(name: string, handlers: MockHandlerMap): void {
    this.mockedDomains.set(name, handlers)
  }

  clearMock(name: string): void {
    this.mockedDomains.delete(name)
  }

  clearAllMocks(): void {
    this.mockedDomains.clear()
  }

  getMockedDomains(): Map<string, MockHandlerMap> {
    return new Map(this.mockedDomains)
  }

  // =========================================================================
  // Time Control
  // =========================================================================

  advanceTime(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot advance time by negative amount')
    }
    this.currentTime += ms
  }

  setTime(time: number): void {
    this.currentTime = time
  }

  getTime(): number {
    return this.currentTime
  }

  // =========================================================================
  // State Inspection
  // =========================================================================

  getExecutedSteps(): StepExecution[] {
    return [...this.executedSteps]
  }

  getStepById(stepId: string): StepExecution | undefined {
    return this.executedSteps.find((s) => s.stepId === stepId)
  }

  getStepsByDomain(domain: string): StepExecution[] {
    return this.executedSteps.filter((s) => s.pipeline.path[0] === domain)
  }

  async getState(): Promise<RuntimeState> {
    const storedSteps = await this.storage.list()
    return {
      executedSteps: this.getExecutedSteps(),
      mockedDomains: this.getMockedDomains(),
      currentTime: this.currentTime,
      storedSteps,
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
    }
  }

  // =========================================================================
  // Failure Simulation
  // =========================================================================

  private getSimulatedFailure(stepId: string): SimulatedFailure | undefined {
    for (const failure of this.simulatedFailures) {
      if (typeof failure.stepId === 'string') {
        if (stepId === failure.stepId || stepId.includes(failure.stepId)) {
          return failure
        }
      }
    }
    return undefined
  }

  simulateStepFailure(stepId: string | RegExp, error: Error, failCount?: number): void {
    this.simulatedFailures.push({
      stepId: stepId.toString(),
      error,
      failCount,
      currentFailures: 0,
    })
  }

  clearSimulatedFailure(stepId: string | RegExp): void {
    const stepIdStr = stepId.toString()
    this.simulatedFailures = this.simulatedFailures.filter((f) => f.stepId !== stepIdStr)
  }

  clearAllSimulatedFailures(): void {
    this.simulatedFailures = []
  }

  // =========================================================================
  // Assertions
  // =========================================================================

  assertStepExecuted(stepId: string): void {
    const found = this.executedSteps.some(
      (s) => s.stepId === stepId || s.stepId.includes(stepId) || s.pipeline.path.join('.') === stepId
    )
    if (!found) {
      const executedIds = this.executedSteps.map((s) => s.stepId).join(', ')
      throw new Error(`Expected step "${stepId}" to be executed, but it was not. Executed steps: [${executedIds}]`)
    }
  }

  assertStepNotExecuted(stepId: string): void {
    const found = this.executedSteps.some(
      (s) => s.stepId === stepId || s.stepId.includes(stepId) || s.pipeline.path.join('.') === stepId
    )
    if (found) {
      throw new Error(`Expected step "${stepId}" not to be executed, but it was`)
    }
  }

  assertStepResult(stepId: string, expected: unknown): void {
    const step = this.executedSteps.find(
      (s) => s.stepId === stepId || s.stepId.includes(stepId) || s.pipeline.path.join('.') === stepId
    )
    if (!step) {
      throw new Error(`Step "${stepId}" was not executed`)
    }
    if (step.error) {
      throw new Error(`Step "${stepId}" failed with error: ${step.error.message}`)
    }

    // Deep equality check
    const resultStr = JSON.stringify(step.result)
    const expectedStr = JSON.stringify(expected)
    if (resultStr !== expectedStr) {
      throw new Error(`Step "${stepId}" result mismatch.\nExpected: ${expectedStr}\nActual: ${resultStr}`)
    }
  }

  assertStepFailed(stepId: string, errorMatch?: string | RegExp): void {
    const step = this.executedSteps.find(
      (s) => s.stepId === stepId || s.stepId.includes(stepId) || s.pipeline.path.join('.') === stepId
    )
    if (!step) {
      throw new Error(`Step "${stepId}" was not executed`)
    }
    if (!step.error) {
      throw new Error(`Expected step "${stepId}" to fail, but it succeeded with result: ${JSON.stringify(step.result)}`)
    }
    if (errorMatch) {
      const message = step.error.message
      if (typeof errorMatch === 'string') {
        if (!message.includes(errorMatch)) {
          throw new Error(`Step "${stepId}" error "${message}" does not contain "${errorMatch}"`)
        }
      } else if (!errorMatch.test(message)) {
        throw new Error(`Step "${stepId}" error "${message}" does not match pattern ${errorMatch}`)
      }
    }
  }

  assertHandlerCalled(domain: string, method: string, times?: number): void {
    const path = `${domain}.${method}`
    const calls = this.executedSteps.filter((s) => s.pipeline.path.join('.') === path)

    if (calls.length === 0) {
      throw new Error(`Handler "${path}" was not called`)
    }

    if (times !== undefined && calls.length !== times) {
      throw new Error(`Handler "${path}" was called ${calls.length} times, expected ${times}`)
    }
  }

  // =========================================================================
  // Storage Access
  // =========================================================================

  getStorage(): StepStorage {
    return this.storage
  }

  // =========================================================================
  // Reset
  // =========================================================================

  reset(options?: { clearStorage?: boolean; clearMocks?: boolean; resetTime?: boolean }): void {
    this.executedSteps = []
    this.beforeStepHooks = []
    this.afterStepHooks = []
    this.onStepErrorHooks = []
    this.simulatedFailures = []
    this.totalExecutions = 0
    this.successfulExecutions = 0
    this.failedExecutions = 0

    if (options?.clearStorage && this.storage instanceof InMemoryStepStorage) {
      this.storage.clear()
    }

    if (options?.clearMocks) {
      this.mockedDomains.clear()
    }

    if (options?.resetTime) {
      this.currentTime = Date.now()
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a test-friendly workflow runtime with hooks and inspection
 *
 * @example
 * ```typescript
 * const runtime = createTestWorkflowRuntime()
 *
 * // Mock handlers
 * runtime.mockDomain('Inventory', {
 *   check: async (product) => ({ available: true }),
 * })
 *
 * // Add hooks
 * runtime.beforeStep((stepId) => console.log(`Starting: ${stepId}`))
 *
 * // Execute steps...
 *
 * // Inspect results
 * const steps = runtime.getExecutedSteps()
 * runtime.assertStepExecuted('Inventory.check')
 * ```
 */
export function createTestWorkflowRuntime(options?: TestRuntimeOptions): TestWorkflowRuntime {
  return new TestWorkflowRuntimeImpl(options)
}

// Re-export InMemoryStepStorage for convenience
export { InMemoryStepStorage } from '../workflows/runtime'

export default createTestWorkflowRuntime
