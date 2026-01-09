/**
 * WorkflowTestHarness
 *
 * A test harness for testing workflows without real infrastructure.
 *
 * Features:
 * - Create harness from workflow definition
 * - Mock step handlers
 * - Control time for timeout testing
 * - Simulate events for waitForEvent
 * - Capture step executions for assertions
 */

import type {
  WorkflowBuilder,
  WorkflowStepHandler,
  WorkflowStepDefinition,
  StepContext,
} from '../WorkflowFactory'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface WorkflowTestHarnessOptions {
  /** Initial simulated time */
  initialTime?: Date
}

export interface StepCall {
  stepName: string
  input: unknown
  output?: unknown
  error?: Error
  duration: number
  timestamp: Date
}

export interface EmittedEvent {
  event: string
  data: unknown
}

export interface LogEntry {
  message: string
  data?: unknown
}

export interface WorkflowRunResult {
  status: 'completed' | 'failed' | 'paused'
  instanceId: string
  output: unknown
  stepResults: Record<string, unknown>
  error?: Error
}

export interface QueuedEvent {
  eventType: string
  payload: unknown
}

// ============================================================================
// DURATION PARSER
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+)\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?)$/i)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return value
  if (unit.startsWith('s') || unit.startsWith('second')) return value * 1000
  if (unit.startsWith('m') || unit.startsWith('minute')) return value * 60 * 1000
  if (unit.startsWith('h') || unit.startsWith('hour')) return value * 60 * 60 * 1000
  if (unit.startsWith('d') || unit.startsWith('day')) return value * 24 * 60 * 60 * 1000

  return value
}

// ============================================================================
// WORKFLOW TEST HARNESS
// ============================================================================

export class WorkflowTestHarness {
  private workflow: WorkflowBuilder
  private _initialTime: Date
  private _currentTime: Date
  private _elapsedTime: number = 0
  private _currentStep: string | null = null
  private _instanceId: string = ''

  // Step management
  private stepMocks: Map<string, WorkflowStepHandler> = new Map()
  private stepCalls: StepCall[] = []

  // Event management
  private eventQueue: QueuedEvent[] = []
  private _pendingEvents: Set<string> = new Set()
  private eventResolvers: Map<string, (payload: unknown) => void> = new Map()

  // Context tracking
  private emittedEvents: EmittedEvent[] = []
  private logs: LogEntry[] = []

  // Waiting management
  private waitingForStep: string | null = null
  private waitForStepResolver: (() => void) | null = null

  // Step reached notification
  private stepReachedResolvers: Map<string, (() => void)[]> = new Map()

  constructor(workflow: WorkflowBuilder, options: WorkflowTestHarnessOptions = {}) {
    this.workflow = workflow
    this._initialTime = options.initialTime ?? new Date()
    this._currentTime = new Date(this._initialTime)
  }

  // ==========================================================================
  // GETTERS
  // ==========================================================================

  get workflowName(): string {
    return this.workflow.name
  }

  get stepNames(): string[] {
    return this.workflow.steps.map((s) => s.name)
  }

  get currentTime(): Date {
    return new Date(this._currentTime)
  }

  get elapsedTime(): number {
    return this._elapsedTime
  }

  get currentStep(): string | null {
    return this._currentStep
  }

  get pendingEvents(): string[] {
    return Array.from(this._pendingEvents)
  }

  // ==========================================================================
  // STEP MOCKING
  // ==========================================================================

  mockStep(stepName: string, handler: WorkflowStepHandler): void {
    const step = this.workflow.steps.find((s) => s.name === stepName)
    if (!step) {
      throw new Error(`Step "${stepName}" not found in workflow "${this.workflowName}"`)
    }
    this.stepMocks.set(stepName, handler)
  }

  clearMocks(): void {
    this.stepMocks.clear()
  }

  clearMock(stepName: string): void {
    this.stepMocks.delete(stepName)
  }

  // ==========================================================================
  // STEP CALL TRACKING
  // ==========================================================================

  getStepCalls(stepName: string): StepCall[] {
    return this.stepCalls.filter((c) => c.stepName === stepName)
  }

  getAllStepCalls(): StepCall[] {
    return [...this.stepCalls]
  }

  getStepInput(stepName: string): unknown {
    const calls = this.getStepCalls(stepName)
    return calls.length > 0 ? calls[calls.length - 1].input : undefined
  }

  getStepOutput(stepName: string): unknown {
    const calls = this.getStepCalls(stepName)
    return calls.length > 0 ? calls[calls.length - 1].output : undefined
  }

  // ==========================================================================
  // TIME CONTROL
  // ==========================================================================

  advanceTime(duration: string | number): void {
    const ms = parseDuration(duration)
    this._elapsedTime += ms
    this._currentTime = new Date(this._currentTime.getTime() + ms)

    // Check for event timeouts
    this.checkEventTimeouts()
  }

  private checkEventTimeouts(): void {
    // This will be used when implementing timeout testing
  }

  // ==========================================================================
  // EVENT SIMULATION
  // ==========================================================================

  queueEvent(eventType: string, payload: unknown): void {
    this.eventQueue.push({ eventType, payload })
  }

  simulateEvent(eventType: string, payload: unknown): void {
    const resolver = this.eventResolvers.get(eventType)
    if (resolver) {
      this._pendingEvents.delete(eventType)
      this.eventResolvers.delete(eventType)
      resolver(payload)
    }
  }

  async waitForStep(stepName: string): Promise<void> {
    // If already at the step, return immediately
    if (this._currentStep === stepName) {
      return
    }

    return new Promise((resolve) => {
      // Add resolver to the list for this step
      const resolvers = this.stepReachedResolvers.get(stepName) || []
      resolvers.push(resolve)
      this.stepReachedResolvers.set(stepName, resolvers)
    })
  }

  private async notifyStepReached(stepName: string): Promise<void> {
    const resolvers = this.stepReachedResolvers.get(stepName)
    if (resolvers && resolvers.length > 0) {
      this.stepReachedResolvers.delete(stepName)
      // Resolve all waiters
      for (const resolver of resolvers) {
        resolver()
      }
      // Yield to allow waiters to run their code (e.g., simulateEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  // ==========================================================================
  // CONTEXT TRACKING
  // ==========================================================================

  getEmittedEvents(): EmittedEvent[] {
    return [...this.emittedEvents]
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  reset(): void {
    this._currentTime = new Date(this._initialTime)
    this._elapsedTime = 0
    this._currentStep = null
    this._instanceId = ''
    this.stepCalls = []
    this.eventQueue = []
    this._pendingEvents.clear()
    this.eventResolvers.clear()
    this.emittedEvents = []
    this.logs = []
    this.waitingForStep = null
    this.waitForStepResolver = null
    this.stepReachedResolvers.clear()
  }

  // ==========================================================================
  // ASSERTIONS
  // ==========================================================================

  assertStepCalled(stepName: string): void {
    const calls = this.getStepCalls(stepName)
    if (calls.length === 0) {
      throw new Error(`Expected step "${stepName}" to be called, but it was not`)
    }
  }

  assertStepNotCalled(stepName: string): void {
    const calls = this.getStepCalls(stepName)
    if (calls.length > 0) {
      throw new Error(`Expected step "${stepName}" not to be called, but it was called ${calls.length} time(s)`)
    }
  }

  assertStepCalledWith(stepName: string, expectedInput: unknown): void {
    const calls = this.getStepCalls(stepName)
    if (calls.length === 0) {
      throw new Error(`Expected step "${stepName}" to be called with specific input, but it was not called`)
    }

    const matchingCall = calls.find((c) => JSON.stringify(c.input) === JSON.stringify(expectedInput))
    if (!matchingCall) {
      throw new Error(
        `Expected step "${stepName}" to be called with ${JSON.stringify(expectedInput)}, but got ${JSON.stringify(calls.map((c) => c.input))}`
      )
    }
  }

  assertStepOutput(stepName: string, expectedOutput: unknown): void {
    const calls = this.getStepCalls(stepName)
    if (calls.length === 0) {
      throw new Error(`Expected step "${stepName}" to have output, but it was not called`)
    }

    const lastCall = calls[calls.length - 1]
    if (JSON.stringify(lastCall.output) !== JSON.stringify(expectedOutput)) {
      throw new Error(
        `Expected step "${stepName}" output to be ${JSON.stringify(expectedOutput)}, but got ${JSON.stringify(lastCall.output)}`
      )
    }
  }

  assertNoErrors(): void {
    const errorCalls = this.stepCalls.filter((c) => c.error)
    if (errorCalls.length > 0) {
      const errorMessages = errorCalls.map((c) => `${c.stepName}: ${c.error!.message}`).join(', ')
      throw new Error(`Expected no errors, but found errors in steps: ${errorMessages}`)
    }
  }

  // ==========================================================================
  // WORKFLOW EXECUTION
  // ==========================================================================

  async run(input: unknown): Promise<WorkflowRunResult> {
    this._instanceId = crypto.randomUUID()
    const stepResults: Record<string, unknown> = {}
    let currentInput = input
    let status: 'completed' | 'failed' | 'paused' = 'completed'
    let error: Error | undefined

    for (const step of this.workflow.steps) {
      this._currentStep = step.name

      try {
        const startTime = Date.now()
        let stepOutput: unknown

        if (step.type === 'do') {
          // Notify waiters that we've reached this step
          await this.notifyStepReached(step.name)
          stepOutput = await this.executeDoStep(step, currentInput)
        } else if (step.type === 'sleep') {
          // Notify waiters that we've reached this step
          await this.notifyStepReached(step.name)
          await this.executeSleepStep(step)
          stepOutput = currentInput
        } else if (step.type === 'waitForEvent') {
          // For waitForEvent, we need to set up the pending event BEFORE notifying
          // so that tests can check pendingEvents and call simulateEvent
          stepOutput = await this.executeWaitForEventStep(step)
        }

        const duration = Date.now() - startTime

        this.stepCalls.push({
          stepName: step.name,
          input: currentInput,
          output: stepOutput,
          duration,
          timestamp: new Date(this._currentTime),
        })

        stepResults[step.name] = stepOutput
        currentInput = stepOutput
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        const duration = Date.now()

        this.stepCalls.push({
          stepName: step.name,
          input: currentInput,
          error: err,
          duration: 0,
          timestamp: new Date(this._currentTime),
        })

        status = 'failed'
        error = err
        throw err
      }
    }

    this._currentStep = null

    return {
      status,
      instanceId: this._instanceId,
      output: currentInput,
      stepResults,
      error,
    }
  }

  // ==========================================================================
  // STEP EXECUTION
  // ==========================================================================

  private async executeDoStep(step: WorkflowStepDefinition, input: unknown): Promise<unknown> {
    const handler = this.stepMocks.get(step.name) ?? step.handler
    if (!handler) {
      throw new Error(`Step "${step.name}" has no handler`)
    }

    const ctx = this.createStepContext(step.name)
    return handler(input, ctx)
  }

  private async executeSleepStep(step: WorkflowStepDefinition): Promise<void> {
    const duration = step.duration ?? 0
    this._elapsedTime += duration
    this._currentTime = new Date(this._currentTime.getTime() + duration)
  }

  private async executeWaitForEventStep(step: WorkflowStepDefinition): Promise<unknown> {
    const eventType = step.event!
    const timeout = step.timeout
    const stepName = step.name

    // Check if event is already queued
    const queuedIndex = this.eventQueue.findIndex((e) => e.eventType === eventType)
    if (queuedIndex >= 0) {
      // Notify that we reached the step, then return immediately
      await this.notifyStepReached(stepName)
      const event = this.eventQueue.splice(queuedIndex, 1)[0]
      return event.payload
    }

    // Set up the pending event BEFORE notifying, so tests can check pendingEvents
    this._pendingEvents.add(eventType)

    // Create the promise that will wait for the event
    let resolveEvent: (payload: unknown) => void
    let rejectEvent: (error: Error) => void
    const eventPromise = new Promise<unknown>((resolve, reject) => {
      resolveEvent = resolve
      rejectEvent = reject
    })

    let timeoutId: NodeJS.Timeout | null = null
    let intervalId: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (intervalId) clearInterval(intervalId)
      this._pendingEvents.delete(eventType)
      this.eventResolvers.delete(eventType)
    }

    this.eventResolvers.set(eventType, (payload) => {
      cleanup()
      resolveEvent!(payload)
    })

    if (timeout) {
      // Set up a polling interval to check if time has been advanced
      intervalId = setInterval(() => {
        if (this._elapsedTime >= timeout) {
          cleanup()
          rejectEvent!(new Error(`Timeout waiting for event "${eventType}"`))
        }
      }, 10)

      // Also set up a real timeout as a fallback
      timeoutId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId)
        if (this._pendingEvents.has(eventType)) {
          cleanup()
          rejectEvent!(new Error(`Timeout waiting for event "${eventType}"`))
        }
      }, timeout)
    }

    // NOW notify waiters - pending event is already set up
    await this.notifyStepReached(stepName)

    // Wait for the event
    return eventPromise
  }

  // ==========================================================================
  // STEP CONTEXT CREATION
  // ==========================================================================

  private createStepContext(stepName: string): StepContext {
    return {
      workflowId: this.workflowName,
      instanceId: this._instanceId,
      stepName,
      input: null, // Will be passed separately to handler
      emit: async (event: string, data: unknown) => {
        this.emittedEvents.push({ event, data })
      },
      log: (message: string, data?: unknown) => {
        this.logs.push({ message, data })
      },
      sleep: async (ms: number) => {
        // Sleep is instant in test mode, but we track elapsed time
        this._elapsedTime += ms
        this._currentTime = new Date(this._currentTime.getTime() + ms)
      },
      waitForEvent: async <T>(eventType: string, options?: { timeout?: number }): Promise<T> => {
        // Check queued events first
        const queuedIndex = this.eventQueue.findIndex((e) => e.eventType === eventType)
        if (queuedIndex >= 0) {
          const event = this.eventQueue.splice(queuedIndex, 1)[0]
          return event.payload as T
        }

        // Wait for event
        this._pendingEvents.add(eventType)
        return new Promise((resolve, reject) => {
          this.eventResolvers.set(eventType, (payload) => {
            this._pendingEvents.delete(eventType)
            this.eventResolvers.delete(eventType)
            resolve(payload as T)
          })

          if (options?.timeout) {
            setTimeout(() => {
              if (this._pendingEvents.has(eventType)) {
                this._pendingEvents.delete(eventType)
                this.eventResolvers.delete(eventType)
                reject(new Error(`Timeout waiting for event "${eventType}"`))
              }
            }, options.timeout)
          }
        })
      },
    }
  }
}

export default WorkflowTestHarness
