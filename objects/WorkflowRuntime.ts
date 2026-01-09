/**
 * WorkflowRuntime - Manages workflow execution in Durable Objects
 *
 * Provides:
 * - State management: pending, running, paused, completed, failed
 * - Step registration and ordered execution
 * - Integration with WaitForEventManager for event-driven pauses
 * - Event emission for observability
 * - Persistence across DO hibernation
 *
 * This is the core runtime for executing workflow definitions in DOs.
 */

/// <reference types="@cloudflare/workers-types" />

import { WaitForEventManager, type WaitForEventOptions } from './WaitForEventManager'

// ============================================================================
// TYPES
// ============================================================================

export type WorkflowRuntimeState = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

export interface WorkflowRuntimeConfig {
  /** Workflow name */
  name: string
  /** Workflow version (optional) */
  version?: string
  /** Workflow description (optional) */
  description?: string
}

export interface WorkflowRuntimeOptions {
  /** Global timeout for the entire workflow */
  timeout?: string | number
  /** Number of retries for failed steps (default: 0) */
  retries?: number
  /** Behavior on error: 'fail' (default) or 'pause' */
  onError?: 'fail' | 'pause'
  /** Domain proxy for $.Noun(id).method() calls */
  domainProxy?: Record<string, unknown>
}

export interface WorkflowStepConfig {
  /** Step timeout */
  timeout?: string | number
  /** Number of retries */
  retries?: number
  /** Delay between retries */
  retryDelay?: string | number
}

export interface StepExecutionResult {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: unknown
  error?: Error
  duration?: number
  startedAt?: Date
  completedAt?: Date
  retryCount?: number
}

export interface WorkflowExecutionResult {
  status: WorkflowRuntimeState
  output?: unknown
  error?: Error
  duration?: number
}

export interface WorkflowMetrics {
  totalSteps: number
  completedSteps: number
  failedSteps: number
  duration?: number
}

export interface StepContext {
  /** Workflow input */
  input: unknown
  /** Output from previous step */
  previousStepOutput?: unknown
  /** Current step name */
  stepName: string
  /** Current step index (0-based) */
  stepIndex: number
  /** Workflow instance ID */
  workflowInstanceId: string
  /** Wait for an external event */
  waitForEvent: <T = unknown>(eventName: string, options?: WaitForEventOptions) => Promise<T>
  /** Domain proxy for cross-DO calls */
  $: Record<string, unknown>
  /** Emit an event */
  emit: (event: string, data: unknown) => void
}

interface RegisteredStep {
  name: string
  handler: (ctx: StepContext) => Promise<unknown>
  config?: WorkflowStepConfig
}

interface PersistedWorkflowState {
  status: WorkflowRuntimeState
  currentStepIndex: number
  input: unknown
  output?: unknown
  error?: { message: string; name: string; stack?: string }
  startedAt?: string
  completedAt?: string
  pendingEvents?: string[]
}

interface PersistedStepState {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: unknown
  error?: { message: string; name: string; stack?: string }
  duration?: number
  startedAt?: string
  completedAt?: string
}

// ============================================================================
// ERRORS
// ============================================================================

export class WorkflowStateError extends Error {
  readonly currentState: WorkflowRuntimeState
  readonly attemptedAction: string

  constructor(currentState: WorkflowRuntimeState, attemptedAction: string) {
    super(`Cannot ${attemptedAction} workflow in '${currentState}' state`)
    this.name = 'WorkflowStateError'
    this.currentState = currentState
    this.attemptedAction = attemptedAction
  }
}

export class WorkflowStepError extends Error {
  readonly stepName: string
  readonly stepIndex: number
  override readonly cause?: Error

  constructor(stepName: string, stepIndex: number, cause?: Error) {
    super(`Step '${stepName}' (index ${stepIndex}) failed: ${cause?.message || 'Unknown error'}`)
    this.name = 'WorkflowStepError'
    this.stepName = stepName
    this.stepIndex = stepIndex
    this.cause = cause
  }
}

export class WorkflowTimeoutError extends Error {
  readonly stepName?: string
  readonly timeoutMs: number

  constructor(timeoutMs: number, stepName?: string) {
    const context = stepName ? `Step '${stepName}'` : 'Workflow'
    super(`${context} timed out after ${timeoutMs}ms`)
    this.name = 'WorkflowTimeoutError'
    this.stepName = stepName
    this.timeoutMs = timeoutMs
  }
}

// ============================================================================
// DURATION PARSING
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  // Support formats like "100ms", "1 second", "30 seconds", "1 hour", etc.
  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|millisecond|s|sec|second|m|min|minute|h|hr|hour|d|day|w|week)s?$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

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
// WORKFLOW RUNTIME
// ============================================================================

type EventHandler = (data: unknown) => void

export class WorkflowRuntime {
  private readonly storage: DurableObjectStorage
  private readonly config: WorkflowRuntimeConfig
  private readonly _options: WorkflowRuntimeOptions
  private readonly _instanceId: string
  private readonly waitForEventManager: WaitForEventManager
  private readonly eventHandlers = new Map<string, Set<EventHandler>>()

  private _state: WorkflowRuntimeState = 'pending'
  private _steps: RegisteredStep[] = []
  private _stepResults: StepExecutionResult[] = []
  private _currentStepIndex = 0
  private _input: unknown = undefined
  private _output: unknown = undefined
  private _error: Error | undefined = undefined
  private _startedAt: Date | undefined = undefined
  private _completedAt: Date | undefined = undefined
  private _pendingEvents: string[] = []
  private _initialized = false

  // For waitForEvent resolution
  private waitResolvers = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  constructor(state: DurableObjectState, config: WorkflowRuntimeConfig, options: WorkflowRuntimeOptions = {}) {
    this.storage = state.storage
    this.config = config
    this._options = {
      retries: 0,
      onError: 'fail',
      ...options,
    }
    this._instanceId = crypto.randomUUID()
    this.waitForEventManager = new WaitForEventManager(state)
  }

  // ==========================================================================
  // GETTERS
  // ==========================================================================

  get name(): string {
    return this.config.name
  }

  get version(): string | undefined {
    return this.config.version
  }

  get instanceId(): string {
    return this._instanceId
  }

  get state(): WorkflowRuntimeState {
    return this._state
  }

  get options(): WorkflowRuntimeOptions {
    return this._options
  }

  get steps(): readonly RegisteredStep[] {
    return this._steps
  }

  get stepResults(): readonly StepExecutionResult[] {
    return this._stepResults
  }

  get currentStepIndex(): number {
    return this._currentStepIndex
  }

  get input(): unknown {
    return this._input
  }

  get output(): unknown {
    return this._output
  }

  get error(): Error | undefined {
    return this._error
  }

  get startedAt(): Date | undefined {
    return this._startedAt
  }

  get completedAt(): Date | undefined {
    return this._completedAt
  }

  get pendingEvents(): readonly string[] {
    return this._pendingEvents
  }

  get duration(): number | undefined {
    if (!this._startedAt) return undefined
    const endTime = this._completedAt || new Date()
    return endTime.getTime() - this._startedAt.getTime()
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this._initialized) return

    await this.storage.put('workflow:config', this.config)
    await this.persistState()
    this._initialized = true
  }

  // ==========================================================================
  // STEP REGISTRATION
  // ==========================================================================

  registerStep(name: string, handler: (ctx: StepContext) => Promise<unknown>, config?: WorkflowStepConfig): void {
    if (this._state !== 'pending') {
      throw new Error('Cannot register steps after workflow has started')
    }

    this._steps.push({ name, handler, config })
  }

  /**
   * Fluent API for step registration
   */
  step(name: string, handler: (ctx: StepContext) => Promise<unknown>, config?: WorkflowStepConfig): this {
    this.registerStep(name, handler, config)
    return this
  }

  // ==========================================================================
  // LIFECYCLE METHODS
  // ==========================================================================

  async start(input: unknown): Promise<WorkflowExecutionResult> {
    if (this._state !== 'pending') {
      throw new WorkflowStateError(this._state, 'start')
    }

    this._input = input
    this._state = 'running'
    this._startedAt = new Date()
    this._initialized = true

    await this.persistState()
    this.emit('workflow.started', { instanceId: this._instanceId, input })

    try {
      await this.executeSteps()

      if (this._state === 'running') {
        this._state = 'completed'
        this._completedAt = new Date()
        this._output = this._stepResults[this._stepResults.length - 1]?.output

        await this.persistState()
        this.emit('workflow.completed', {
          instanceId: this._instanceId,
          output: this._output,
          duration: this.duration,
        })
      }

      return {
        status: this._state,
        output: this._output,
        duration: this.duration,
      }
    } catch (error) {
      if (this._options.onError === 'pause') {
        this._state = 'paused'
        this._error = error instanceof Error ? error : new Error(String(error))
        await this.persistState()
        this.emit('workflow.paused', {
          instanceId: this._instanceId,
          reason: 'error',
          error: this._error,
        })
        return {
          status: this._state,
          error: this._error,
          duration: this.duration,
        }
      }

      this._state = 'failed'
      this._error = error instanceof Error ? error : new Error(String(error))
      this._completedAt = new Date()

      await this.persistState()
      this.emit('workflow.failed', {
        instanceId: this._instanceId,
        error: { message: this._error.message, name: this._error.name },
        duration: this.duration,
      })

      throw error
    }
  }

  async pause(): Promise<void> {
    if (this._state !== 'running') {
      throw new WorkflowStateError(this._state, 'pause')
    }

    this._state = 'paused'
    await this.persistState()
    this.emit('workflow.paused', { instanceId: this._instanceId })
  }

  async resume(): Promise<void> {
    if (this._state !== 'paused') {
      throw new WorkflowStateError(this._state, 'resume')
    }

    this._state = 'running'
    this._error = undefined // Clear error on resume

    await this.persistState()
    this.emit('workflow.resumed', { instanceId: this._instanceId })

    // Continue execution from current step
    try {
      await this.executeSteps()

      if (this._state === 'running') {
        this._state = 'completed'
        this._completedAt = new Date()
        this._output = this._stepResults[this._stepResults.length - 1]?.output

        await this.persistState()
        this.emit('workflow.completed', {
          instanceId: this._instanceId,
          output: this._output,
          duration: this.duration,
        })
      }
    } catch (error) {
      if (this._options.onError === 'pause') {
        this._state = 'paused'
        this._error = error instanceof Error ? error : new Error(String(error))
        await this.persistState()
        return
      }

      this._state = 'failed'
      this._error = error instanceof Error ? error : new Error(String(error))
      this._completedAt = new Date()

      await this.persistState()
      this.emit('workflow.failed', {
        instanceId: this._instanceId,
        error: { message: this._error.message, name: this._error.name },
      })

      throw error
    }
  }

  async restore(): Promise<void> {
    const state = await this.storage.get<PersistedWorkflowState>('workflow:state')
    if (!state) return

    this._state = state.status
    this._currentStepIndex = state.currentStepIndex
    this._input = state.input
    this._output = state.output
    this._pendingEvents = state.pendingEvents || []

    if (state.error) {
      this._error = new Error(state.error.message)
      this._error.name = state.error.name
    }

    if (state.startedAt) {
      this._startedAt = new Date(state.startedAt)
    }

    if (state.completedAt) {
      this._completedAt = new Date(state.completedAt)
    }

    // Restore step results
    const stepStates = await this.storage.list<PersistedStepState>({ prefix: 'workflow:step:' })
    for (const [key, stepState] of stepStates) {
      const indexMatch = key.match(/workflow:step:(\d+)/)
      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10)
        this._stepResults[index] = {
          name: stepState.name,
          status: stepState.status,
          output: stepState.output,
          duration: stepState.duration,
          startedAt: stepState.startedAt ? new Date(stepState.startedAt) : undefined,
          completedAt: stepState.completedAt ? new Date(stepState.completedAt) : undefined,
        }
        if (stepState.error) {
          this._stepResults[index].error = new Error(stepState.error.message)
          this._stepResults[index].error!.name = stepState.error.name
        }
      }
    }

    this._initialized = true
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  private async executeSteps(): Promise<void> {
    while (this._currentStepIndex < this._steps.length && this._state === 'running') {
      const step = this._steps[this._currentStepIndex]
      const stepResult = await this.executeStep(step, this._currentStepIndex)

      this._stepResults[this._currentStepIndex] = stepResult

      await this.storage.put(`workflow:step:${this._currentStepIndex}`, {
        name: stepResult.name,
        status: stepResult.status,
        output: stepResult.output,
        duration: stepResult.duration,
        startedAt: stepResult.startedAt?.toISOString(),
        completedAt: stepResult.completedAt?.toISOString(),
        error: stepResult.error
          ? {
              message: stepResult.error.message,
              name: stepResult.error.name,
            }
          : undefined,
      })

      if (stepResult.status === 'failed') {
        throw stepResult.error || new Error(`Step '${step.name}' failed`)
      }

      // Check if workflow was paused (e.g., by waitForEvent)
      if (this._state === 'paused') {
        return
      }

      this._currentStepIndex++
      await this.persistState()
    }
  }

  private async executeStep(step: RegisteredStep, index: number): Promise<StepExecutionResult> {
    const result: StepExecutionResult = {
      name: step.name,
      status: 'running',
      startedAt: new Date(),
    }

    this.emit('step.started', {
      instanceId: this._instanceId,
      stepName: step.name,
      stepIndex: index,
    })

    const context = this.createStepContext(step.name, index)
    const maxRetries = step.config?.retries || 0
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      result.retryCount = attempt

      try {
        // Handle timeout if configured
        let output: unknown
        if (step.config?.timeout) {
          const timeoutMs = parseDuration(step.config.timeout)
          output = await Promise.race([
            step.handler(context),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new WorkflowTimeoutError(timeoutMs, step.name))
              }, timeoutMs)
            }),
          ])
        } else {
          output = await step.handler(context)
        }

        // Check if we were paused during execution (e.g., waitForEvent)
        if (this._state === 'paused') {
          result.status = 'running' // Still running, just paused
          return result
        }

        result.status = 'completed'
        result.output = output
        result.completedAt = new Date()
        result.duration = result.completedAt.getTime() - result.startedAt!.getTime()

        this.emit('step.completed', {
          instanceId: this._instanceId,
          stepName: step.name,
          stepIndex: index,
          output,
          duration: result.duration,
        })

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if it's a timeout error or if we should retry
        if (error instanceof WorkflowTimeoutError || attempt >= maxRetries) {
          break
        }

        // Wait before retrying
        if (step.config?.retryDelay) {
          const delayMs = parseDuration(step.config.retryDelay)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }

    result.status = 'failed'
    result.error = new WorkflowStepError(step.name, index, lastError)
    result.completedAt = new Date()
    result.duration = result.completedAt.getTime() - result.startedAt!.getTime()

    this.emit('step.failed', {
      instanceId: this._instanceId,
      stepName: step.name,
      stepIndex: index,
      error: { message: result.error.message, name: result.error.name },
    })

    return result
  }

  private createStepContext(stepName: string, stepIndex: number): StepContext {
    const previousOutput = stepIndex > 0 ? this._stepResults[stepIndex - 1]?.output : undefined

    return {
      input: this._input,
      previousStepOutput: previousOutput,
      stepName,
      stepIndex,
      workflowInstanceId: this._instanceId,
      waitForEvent: this.createWaitForEvent(stepName),
      $: this.createDomainProxy(),
      emit: (event: string, data: unknown) => this.emit(event, data),
    }
  }

  private createWaitForEvent(stepName: string): <T = unknown>(eventName: string, options?: WaitForEventOptions) => Promise<T> {
    return async <T = unknown>(eventName: string, options: WaitForEventOptions = {}): Promise<T> => {
      // Track pending event
      this._pendingEvents.push(eventName)

      // Pause the workflow
      this._state = 'paused'
      await this.persistState()

      // Register the wait
      const waitId = await this.waitForEventManager.registerWait(eventName, options)

      return new Promise<T>((resolve, reject) => {
        this.waitResolvers.set(waitId, {
          resolve: resolve as (value: unknown) => void,
          reject,
        })

        // Handle timeout
        if (options.timeout) {
          const timeoutMs = parseDuration(options.timeout)
          setTimeout(async () => {
            if (this.waitResolvers.has(waitId)) {
              this.waitResolvers.delete(waitId)
              this._pendingEvents = this._pendingEvents.filter((e) => e !== eventName)
              await this.waitForEventManager.cancelWait(waitId)
              reject(new WorkflowTimeoutError(timeoutMs, stepName))
            }
          }, timeoutMs)
        }
      })
    }
  }

  private createDomainProxy(): Record<string, unknown> {
    if (this._options.domainProxy) {
      return this._options.domainProxy
    }

    // Default empty proxy
    return new Proxy(
      {},
      {
        get: (_, noun: string) => {
          return (id: string) => {
            return new Proxy(
              {},
              {
                get: (_, method: string) => {
                  return async (...args: unknown[]) => {
                    throw new Error(`Domain proxy not configured: $.${noun}('${id}').${method}()`)
                  }
                },
              },
            )
          }
        },
      },
    )
  }

  // ==========================================================================
  // EVENT DELIVERY
  // ==========================================================================

  async deliverEvent(eventName: string, payload: unknown): Promise<void> {
    // Find matching wait
    const waits = await this.waitForEventManager.listPendingWaits()
    const matchingWait = waits.find((w) => w.eventName === eventName)

    if (!matchingWait) {
      return
    }

    // Resolve the wait
    const result = await this.waitForEventManager.deliverEvent(matchingWait.id, eventName, payload)

    if (result.resolved) {
      // Remove from pending events
      this._pendingEvents = this._pendingEvents.filter((e) => e !== eventName)

      // Resolve the promise
      const resolver = this.waitResolvers.get(matchingWait.id)
      if (resolver) {
        resolver.resolve(payload)
        this.waitResolvers.delete(matchingWait.id)
      }

      // Resume workflow if no more pending waits
      if (this._pendingEvents.length === 0 && this._state === 'paused') {
        this._state = 'running'
        await this.persistState()

        // Continue execution
        this._currentStepIndex++
        await this.executeSteps()

        if (this._state === 'running') {
          this._state = 'completed'
          this._completedAt = new Date()
          this._output = this._stepResults[this._stepResults.length - 1]?.output

          await this.persistState()
          this.emit('workflow.completed', {
            instanceId: this._instanceId,
            output: this._output,
            duration: this.duration,
          })
        }
      }
    }
  }

  async handleAlarm(): Promise<void> {
    await this.waitForEventManager.handleAlarm()
  }

  // ==========================================================================
  // EVENT EMITTER
  // ==========================================================================

  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data)
      } catch (e) {
        console.error(`Error in event handler for ${event}:`, e)
      }
    })
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  private async persistState(): Promise<void> {
    const state: PersistedWorkflowState = {
      status: this._state,
      currentStepIndex: this._currentStepIndex,
      input: this._input,
      output: this._output,
      pendingEvents: [...this._pendingEvents],
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
    }

    if (this._error) {
      state.error = {
        message: this._error.message,
        name: this._error.name,
        stack: this._error.stack,
      }
    }

    await this.storage.put('workflow:state', state)
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  getMetrics(): WorkflowMetrics {
    return {
      totalSteps: this._steps.length,
      completedSteps: this._stepResults.filter((r) => r.status === 'completed').length,
      failedSteps: this._stepResults.filter((r) => r.status === 'failed').length,
      duration: this.duration,
    }
  }
}

export default WorkflowRuntime
