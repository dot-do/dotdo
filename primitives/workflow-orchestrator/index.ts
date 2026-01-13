/**
 * @module workflow-orchestrator
 *
 * Workflow Orchestrator Primitive - DAG-based workflow execution for the dotdo platform.
 *
 * Provides a powerful workflow engine with directed acyclic graph (DAG) execution,
 * automatic retries, compensation (saga pattern), pause/resume capabilities, and
 * rich event handling. Built for complex, multi-step business processes.
 *
 * ## Features
 *
 * - **DAG execution** with parallel step processing
 * - **Automatic retries** with configurable backoff strategies
 * - **Compensation handlers** for rollback on failure (saga pattern)
 * - **Pause/resume** for long-running workflows
 * - **Step conditions** for conditional execution
 * - **Input mapping** for step data transformation
 * - **Workflow timeouts** with cancellation
 * - **Event triggers** for workflow initiation
 * - **Fluent builder** for workflow definition
 *
 * @example Basic Workflow
 * ```typescript
 * import { WorkflowOrchestrator, WorkflowBuilder } from 'dotdo/primitives/workflow-orchestrator'
 *
 * const workflow = new WorkflowBuilder('order-processing')
 *   .name('Order Processing')
 *   .step('validate', async (ctx) => {
 *     const order = ctx.inputs.order
 *     if (!order.items.length) throw new Error('Empty order')
 *     return { valid: true }
 *   })
 *   .step('reserve-inventory', async (ctx) => {
 *     return await reserveItems(ctx.inputs.order.items)
 *   }, { dependencies: ['validate'] })
 *   .step('charge-payment', async (ctx) => {
 *     return await chargeCard(ctx.inputs.payment)
 *   }, { dependencies: ['validate'] })
 *   .step('fulfill', async (ctx) => {
 *     const inventory = ctx.getStepOutput('reserve-inventory')
 *     const payment = ctx.getStepOutput('charge-payment')
 *     return await createFulfillment(inventory, payment)
 *   }, { dependencies: ['reserve-inventory', 'charge-payment'] })
 *   .build()
 *
 * const orchestrator = new WorkflowOrchestrator()
 * orchestrator.register(workflow)
 *
 * const execution = await orchestrator.execute('order-processing', {
 *   order: { items: [...] },
 *   payment: { cardToken: '...' },
 * })
 * ```
 *
 * @example Compensation for Rollback
 * ```typescript
 * const workflow = new WorkflowBuilder('saga-booking')
 *   .step('book-flight', async (ctx) => {
 *     return await bookFlight(ctx.inputs.flight)
 *   }, {
 *     compensation: async (ctx, output) => {
 *       await cancelFlight(output.confirmationId)
 *     },
 *   })
 *   .step('book-hotel', async (ctx) => {
 *     return await bookHotel(ctx.inputs.hotel)
 *   }, {
 *     dependencies: ['book-flight'],
 *     compensation: async (ctx, output) => {
 *       await cancelHotel(output.reservationId)
 *     },
 *   })
 *   .step('book-car', async (ctx) => {
 *     // If this fails, book-hotel and book-flight compensations run
 *     return await bookCar(ctx.inputs.car)
 *   }, { dependencies: ['book-hotel'] })
 *   .build()
 * ```
 *
 * @example Conditional Steps
 * ```typescript
 * const workflow = new WorkflowBuilder('conditional-workflow')
 *   .step('check-eligibility', async (ctx) => {
 *     return { eligible: ctx.inputs.score > 700 }
 *   })
 *   .step('premium-offer', async (ctx) => {
 *     return await createPremiumOffer()
 *   }, {
 *     dependencies: ['check-eligibility'],
 *     condition: (ctx) => ctx.getStepOutput('check-eligibility')?.eligible === true,
 *   })
 *   .step('standard-offer', async (ctx) => {
 *     return await createStandardOffer()
 *   }, {
 *     dependencies: ['check-eligibility'],
 *     condition: (ctx) => ctx.getStepOutput('check-eligibility')?.eligible === false,
 *   })
 *   .build()
 * ```
 *
 * @example Retries with Backoff
 * ```typescript
 * const workflow = new WorkflowBuilder('resilient-workflow')
 *   .retry({
 *     maxAttempts: 3,
 *     delayMs: 1000,
 *     backoffMultiplier: 2,
 *     maxDelayMs: 10000,
 *   })
 *   .step('external-api', async (ctx) => {
 *     return await callExternalApi()
 *   })
 *   .build()
 * ```
 *
 * @example Pause and Resume
 * ```typescript
 * const execution = await orchestrator.execute('long-workflow', inputs)
 *
 * // Pause at any point
 * await orchestrator.pause(execution.id)
 *
 * // Resume later
 * await orchestrator.resume(execution.id)
 *
 * // Or cancel with compensation
 * await orchestrator.cancel(execution.id)
 * ```
 *
 * @example Event-Triggered Workflows
 * ```typescript
 * const workflow = new WorkflowBuilder('event-workflow')
 *   .trigger({ type: 'event', config: { eventName: 'user.signup' } })
 *   .step('welcome-email', sendWelcomeEmail)
 *   .step('provision-account', provisionAccount)
 *   .build()
 *
 * // Trigger via event
 * const workflowIds = orchestrator.getTriggerManager().matchEvent('user.signup')
 * ```
 *
 * @packageDocumentation
 */

import type {
  Workflow,
  WorkflowStep,
  WorkflowExecution,
  WorkflowContext,
  StepResult,
  StepExecution,
  ExecutionStatus,
  StepStatus,
  RetryConfig,
  CompensationHandler,
  Trigger,
  OrchestratorOptions,
  EventHandler,
  WorkflowEvent,
  WorkflowEventType,
  ExecutionMetadata,
} from './types'

export type {
  Workflow,
  WorkflowStep,
  WorkflowExecution,
  WorkflowContext,
  StepResult,
  StepExecution,
  ExecutionStatus,
  StepStatus,
  RetryConfig,
  CompensationHandler,
  Trigger,
  OrchestratorOptions,
} from './types'

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// ExecutionStore
// =============================================================================

export class ExecutionStore {
  private executions = new Map<string, WorkflowExecution>()

  save(execution: WorkflowExecution): void {
    this.executions.set(execution.id, execution)
  }

  get(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId)
  }

  listByWorkflow(workflowId: string): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter(
      (e) => e.workflowId === workflowId
    )
  }

  delete(executionId: string): void {
    this.executions.delete(executionId)
  }
}

// =============================================================================
// DAGExecutor
// =============================================================================

export class DAGExecutor {
  /**
   * Build execution levels from steps based on dependencies.
   * Each level contains steps that can be executed in parallel.
   * @param steps - The steps to build levels from
   * @param alreadyProcessed - Optional set of step IDs that are already completed (for retry scenarios)
   */
  buildExecutionLevels(steps: WorkflowStep[], alreadyProcessed?: Set<string>): WorkflowStep[][] {
    const levels: WorkflowStep[][] = []
    const processed = new Set<string>(alreadyProcessed ?? [])

    while (processed.size < steps.length + (alreadyProcessed?.size ?? 0)) {
      const level: WorkflowStep[] = []

      for (const step of steps) {
        if (processed.has(step.id)) continue

        const deps = step.dependencies ?? []
        const allDepsProcessed = deps.every((d) => processed.has(d))

        if (allDepsProcessed) {
          level.push(step)
        }
      }

      if (level.length === 0) {
        // Check if we've processed all steps in the input array
        const unprocessedSteps = steps.filter((s) => !processed.has(s.id))
        if (unprocessedSteps.length > 0) {
          // No progress made - indicates circular dependency or missing deps
          throw new Error('Cannot build execution order - possible circular dependency')
        }
        break
      }

      for (const step of level) {
        processed.add(step.id)
      }

      levels.push(level)
    }

    return levels
  }

  /**
   * Validate workflow DAG for circular dependencies and missing references.
   */
  validate(steps: WorkflowStep[]): void {
    const stepIds = new Set(steps.map((s) => s.id))

    // Check for missing dependencies
    for (const step of steps) {
      for (const dep of step.dependencies ?? []) {
        if (!stepIds.has(dep)) {
          throw new Error(`Step "${step.id}" has dependency "${dep}" not found in workflow`)
        }
      }
    }

    // Check for circular dependencies using DFS
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (stepId: string): boolean => {
      visited.add(stepId)
      recursionStack.add(stepId)

      const step = steps.find((s) => s.id === stepId)
      for (const dep of step?.dependencies ?? []) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true
        } else if (recursionStack.has(dep)) {
          return true
        }
      }

      recursionStack.delete(stepId)
      return false
    }

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (hasCycle(step.id)) {
          throw new Error('Circular dependency detected in workflow')
        }
      }
    }
  }
}

// =============================================================================
// StepRunner
// =============================================================================

export interface StepRunnerOptions {
  timeout?: number
}

export class StepRunner {
  async run(
    step: WorkflowStep,
    context: WorkflowContext,
    options: StepRunnerOptions = {}
  ): Promise<StepResult> {
    const startTime = Date.now()

    try {
      // Get input via mapping if provided
      const input = step.inputMapping ? step.inputMapping(context) : undefined

      // Create promise with timeout
      const executePromise = step.handler(context, input)

      let result: unknown

      if (options.timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Step timeout exceeded')), options.timeout)
        })
        result = await Promise.race([executePromise, timeoutPromise])
      } else {
        result = await executePromise
      }

      return {
        success: true,
        output: result,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - startTime,
      }
    }
  }
}

// =============================================================================
// CompensationManager
// =============================================================================

interface CompensationEntry {
  stepId: string
  handler: CompensationHandler
  output: unknown
}

export class CompensationManager {
  private entries: CompensationEntry[] = []

  register(
    stepId: string,
    handler: CompensationHandler,
    result: { output: unknown }
  ): void {
    this.entries.push({ stepId, handler, output: result.output })
  }

  async compensate(context: WorkflowContext): Promise<void> {
    // Execute in reverse order
    const reversed = [...this.entries].reverse()

    for (const entry of reversed) {
      try {
        await entry.handler(context, entry.output)
      } catch (error) {
        // Log but continue compensating other steps
        console.error(`Compensation failed for step ${entry.stepId}:`, error)
      }
    }
  }

  clear(): void {
    this.entries = []
  }
}

// =============================================================================
// TriggerManager
// =============================================================================

interface TriggerEntry {
  workflowId: string
  trigger: Trigger
}

export class TriggerManager {
  private triggers: TriggerEntry[] = []

  register(workflowId: string, trigger: Trigger): void {
    this.triggers.push({ workflowId, trigger })
  }

  matchEvent(eventName: string): string[] {
    return this.triggers
      .filter(
        (t) =>
          t.trigger.type === 'event' &&
          t.trigger.config?.eventName === eventName
      )
      .map((t) => t.workflowId)
  }

  matchWebhook(path: string): string | undefined {
    const match = this.triggers.find(
      (t) =>
        t.trigger.type === 'webhook' && t.trigger.config?.webhookPath === path
    )
    return match?.workflowId
  }

  unregister(workflowId: string): void {
    this.triggers = this.triggers.filter((t) => t.workflowId !== workflowId)
  }
}

// =============================================================================
// WorkflowBuilder
// =============================================================================

export class WorkflowBuilder {
  private workflow: Workflow

  constructor(id: string) {
    this.workflow = {
      id,
      name: id,
      steps: [],
    }
  }

  name(name: string): this {
    this.workflow.name = name
    return this
  }

  description(description: string): this {
    this.workflow.description = description
    return this
  }

  step(
    id: string,
    handler: WorkflowStep['handler'],
    options?: Partial<Omit<WorkflowStep, 'id' | 'handler'>>
  ): this {
    this.workflow.steps.push({
      id,
      name: options?.name ?? id,
      handler,
      ...options,
    })
    return this
  }

  timeout(ms: number): this {
    this.workflow.timeout = ms
    return this
  }

  trigger(trigger: Trigger): this {
    if (!this.workflow.triggers) {
      this.workflow.triggers = []
    }
    this.workflow.triggers.push(trigger)
    return this
  }

  retry(config: RetryConfig): this {
    this.workflow.retry = config
    return this
  }

  build(): Workflow {
    return this.workflow
  }
}

// =============================================================================
// WorkflowOrchestrator
// =============================================================================

export class WorkflowOrchestrator {
  private workflows = new Map<string, Workflow>()
  private store = new ExecutionStore()
  private dagExecutor = new DAGExecutor()
  private stepRunner = new StepRunner()
  private triggerManager = new TriggerManager()
  private activeExecutions = new Map<string, string>() // workflowId -> executionId
  private executionControllers = new Map<
    string,
    {
      paused: boolean
      cancelled: boolean
      pausePromise?: Promise<void>
      resumeResolve?: () => void
    }
  >()
  private options: OrchestratorOptions

  constructor(options: OrchestratorOptions = {}) {
    this.options = options
  }

  /**
   * Register a workflow definition.
   */
  register(workflow: Workflow): void {
    // Validate the workflow DAG
    this.dagExecutor.validate(workflow.steps)

    this.workflows.set(workflow.id, workflow)

    // Register triggers
    for (const trigger of workflow.triggers ?? []) {
      this.triggerManager.register(workflow.id, trigger)
    }
  }

  /**
   * Execute a workflow with given inputs.
   */
  async execute<TInputs = Record<string, unknown>, TOutputs = Record<string, unknown>>(
    workflowId: string,
    inputs: TInputs
  ): Promise<WorkflowExecution<TInputs, TOutputs>> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" not found`)
    }

    const executionId = generateId()
    const now = new Date()

    // Initialize execution state
    const execution: WorkflowExecution<TInputs, TOutputs> = {
      id: executionId,
      workflowId,
      status: 'pending',
      steps: new Map(),
      inputs,
      startedAt: now,
      metadata: {
        startedAt: now,
        retryCount: 0,
      },
    }

    // Initialize step states
    for (const step of workflow.steps) {
      execution.steps.set(step.id, {
        stepId: step.id,
        status: 'pending',
        attempt: 0,
      })
    }

    this.store.save(execution)
    this.activeExecutions.set(workflowId, executionId)

    // Initialize execution controller
    this.executionControllers.set(executionId, {
      paused: false,
      cancelled: false,
    })

    // Execute the workflow
    await this.runWorkflow(execution, workflow)

    return execution
  }

  private async runWorkflow(
    execution: WorkflowExecution,
    workflow: Workflow
  ): Promise<void> {
    const compensationManager = new CompensationManager()
    const stepOutputs = new Map<string, unknown>()

    execution.status = 'running'
    this.emitEvent('workflow:started', execution)

    // Set up workflow-level timeout if configured
    const workflowStartTime = Date.now()
    const workflowTimeout = workflow.timeout

    const checkWorkflowTimeout = () => {
      if (workflowTimeout && Date.now() - workflowStartTime >= workflowTimeout) {
        throw new Error('Workflow timeout exceeded')
      }
    }

    try {
      // Build execution levels from DAG
      const levels = this.dagExecutor.buildExecutionLevels(workflow.steps)

      for (const level of levels) {
        // Check for workflow timeout
        checkWorkflowTimeout()

        // Check for pause/cancel
        const controller = this.executionControllers.get(execution.id)
        if (controller?.cancelled) {
          await compensationManager.compensate(
            this.createContext(execution, stepOutputs)
          )
          execution.status = 'cancelled'
          this.emitEvent('workflow:cancelled', execution)
          return
        }

        if (controller?.paused) {
          execution.status = 'paused'
          this.emitEvent('workflow:paused', execution)
          await controller.pausePromise
          execution.status = 'running'
          this.emitEvent('workflow:resumed', execution)
        }

        // Execute all steps in this level in parallel
        const results = await Promise.all(
          level.map((step) =>
            this.executeStep(
              step,
              execution,
              workflow,
              stepOutputs,
              compensationManager
            )
          )
        )

        // Check for workflow timeout after step execution
        checkWorkflowTimeout()

        // Check for cancellation after step execution
        const controllerAfter = this.executionControllers.get(execution.id)
        if (controllerAfter?.cancelled) {
          await compensationManager.compensate(
            this.createContext(execution, stepOutputs)
          )
          execution.status = 'cancelled'
          this.emitEvent('workflow:cancelled', execution)
          return
        }

        // Check for failures
        const failedStep = results.find((r) => !r.success)
        if (failedStep) {
          await compensationManager.compensate(
            this.createContext(execution, stepOutputs)
          )
          execution.status = 'failed'
          execution.error = failedStep.error
          execution.completedAt = new Date()
          this.emitEvent('workflow:failed', execution)
          return
        }
      }

      // Success - set outputs from the last executed step(s)
      const lastLevel = levels[levels.length - 1]
      if (lastLevel.length === 1) {
        execution.outputs = stepOutputs.get(lastLevel[0].id) as typeof execution.outputs
      } else {
        // Multiple final steps - combine outputs
        const combinedOutputs: Record<string, unknown> = {}
        for (const step of lastLevel) {
          const output = stepOutputs.get(step.id)
          if (typeof output === 'object' && output !== null) {
            Object.assign(combinedOutputs, output)
          }
        }
        execution.outputs = combinedOutputs as typeof execution.outputs
      }

      execution.status = 'completed'
      execution.completedAt = new Date()
      this.emitEvent('workflow:completed', execution)
    } catch (error) {
      await compensationManager.compensate(
        this.createContext(execution, stepOutputs)
      )
      execution.status = 'failed'
      execution.error = error instanceof Error ? error : new Error(String(error))
      execution.completedAt = new Date()
      this.emitEvent('workflow:failed', execution)
    } finally {
      this.activeExecutions.delete(execution.workflowId)
    }
  }

  private async executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution,
    workflow: Workflow,
    stepOutputs: Map<string, unknown>,
    compensationManager: CompensationManager
  ): Promise<StepResult> {
    // Check for cancellation before starting
    const controller = this.executionControllers.get(execution.id)
    if (controller?.cancelled) {
      return { success: false, error: new Error('Cancelled'), duration: 0 }
    }

    const stepExecution = execution.steps.get(step.id)!
    const context = this.createContext(execution, stepOutputs)

    // Check condition
    if (step.condition) {
      const shouldRun = await Promise.resolve(step.condition(context))
      if (!shouldRun) {
        stepExecution.status = 'skipped'
        this.emitEvent('step:skipped', execution, step.id)
        return { success: true, duration: 0 }
      }
    }

    stepExecution.status = 'running'
    stepExecution.startedAt = new Date()
    this.emitEvent('step:started', execution, step.id)

    // Get retry config
    const retryConfig = step.retry ?? workflow.retry ?? { maxAttempts: 1 }
    let lastResult: StepResult | undefined

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      stepExecution.attempt = attempt

      // Check for pause/cancel between retries
      const controller = this.executionControllers.get(execution.id)
      if (controller?.cancelled) {
        return { success: false, error: new Error('Cancelled'), duration: 0 }
      }

      if (controller?.paused) {
        await controller.pausePromise
      }

      // Calculate timeout
      const timeout =
        step.timeout ?? this.options.defaultStepTimeout ?? undefined

      lastResult = await this.stepRunner.run(step, context, { timeout })

      if (lastResult.success) {
        stepExecution.status = 'completed'
        stepExecution.result = lastResult
        stepExecution.completedAt = new Date()
        stepOutputs.set(step.id, lastResult.output)

        // Register compensation if provided
        if (step.compensation) {
          compensationManager.register(step.id, step.compensation, {
            output: lastResult.output,
          })
        }

        this.emitEvent('step:completed', execution, step.id)
        return lastResult
      }

      // Emit retry event if not last attempt
      if (attempt < retryConfig.maxAttempts) {
        this.emitEvent('step:retrying', execution, step.id)

        // Apply backoff delay
        if (retryConfig.delayMs) {
          const multiplier = retryConfig.backoffMultiplier ?? 1
          const delayTime = retryConfig.delayMs * Math.pow(multiplier, attempt - 1)
          const maxDelay = retryConfig.maxDelayMs ?? Infinity
          await delay(Math.min(delayTime, maxDelay))
        }
      }
    }

    // All retries exhausted
    stepExecution.status = 'failed'
    stepExecution.result = lastResult
    stepExecution.completedAt = new Date()
    this.emitEvent('step:failed', execution, step.id)

    return lastResult!
  }

  private createContext(
    execution: WorkflowExecution,
    stepOutputs: Map<string, unknown>
  ): WorkflowContext {
    const outputs: Record<string, unknown> = {}
    for (const [key, value] of stepOutputs) {
      outputs[key] = value
    }

    return {
      executionId: execution.id,
      workflowId: execution.workflowId,
      inputs: execution.inputs,
      outputs,
      metadata: execution.metadata,
      getStepOutput: <T>(stepId: string) => stepOutputs.get(stepId) as T | undefined,
    }
  }

  private emitEvent(
    type: WorkflowEventType,
    execution: WorkflowExecution,
    stepId?: string
  ): void {
    if (this.options.onEvent) {
      this.options.onEvent({
        type,
        executionId: execution.id,
        workflowId: execution.workflowId,
        stepId,
        timestamp: new Date(),
      })
    }
  }

  /**
   * Pause a running workflow execution.
   */
  async pause(executionId: string): Promise<void> {
    const controller = this.executionControllers.get(executionId)
    if (!controller) {
      throw new Error(`Execution "${executionId}" not found`)
    }

    controller.paused = true
    controller.pausePromise = new Promise<void>((resolve) => {
      controller.resumeResolve = resolve
    })
  }

  /**
   * Resume a paused workflow execution.
   */
  async resume(executionId: string): Promise<void> {
    const controller = this.executionControllers.get(executionId)
    if (!controller) {
      throw new Error(`Execution "${executionId}" not found`)
    }

    controller.paused = false
    controller.resumeResolve?.()
  }

  /**
   * Cancel a running workflow execution.
   */
  async cancel(executionId: string): Promise<void> {
    const controller = this.executionControllers.get(executionId)
    if (!controller) {
      throw new Error(`Execution "${executionId}" not found`)
    }

    controller.cancelled = true

    // If paused, resume to allow cancellation to proceed
    if (controller.paused) {
      controller.resumeResolve?.()
    }
  }

  /**
   * Get the current status of an execution.
   */
  getStatus(executionId: string): WorkflowExecution | undefined {
    return this.store.get(executionId)
  }

  /**
   * Retry a failed step in an execution.
   */
  async retry(
    executionId: string,
    stepId: string
  ): Promise<WorkflowExecution> {
    const execution = this.store.get(executionId)
    if (!execution) {
      throw new Error(`Execution "${executionId}" not found`)
    }

    const workflow = this.workflows.get(execution.workflowId)
    if (!workflow) {
      throw new Error(`Workflow "${execution.workflowId}" not found`)
    }

    const step = workflow.steps.find((s) => s.id === stepId)
    if (!step) {
      throw new Error(`Step "${stepId}" not found in workflow`)
    }

    // Reset execution state
    execution.status = 'running'
    execution.error = undefined
    execution.completedAt = undefined

    // Reset step state
    const stepExecution = execution.steps.get(stepId)!
    stepExecution.status = 'pending'
    stepExecution.result = undefined
    stepExecution.attempt = 0

    // Rebuild step outputs from completed steps and track already processed
    const stepOutputs = new Map<string, unknown>()
    const alreadyProcessed = new Set<string>()
    for (const [id, stepExec] of execution.steps) {
      if (stepExec.status === 'completed' && stepExec.result?.output) {
        stepOutputs.set(id, stepExec.result.output)
        alreadyProcessed.add(id)
      }
    }

    // Re-run from the failed step
    const compensationManager = new CompensationManager()

    // Find remaining steps to execute (the failed step and all subsequent steps)
    const failedStepIndex = workflow.steps.findIndex((s) => s.id === stepId)
    const remainingSteps = workflow.steps.slice(failedStepIndex)

    // Build execution levels for remaining steps, considering already-processed dependencies
    const levels = this.dagExecutor.buildExecutionLevels(remainingSteps, alreadyProcessed)

    try {
      for (const level of levels) {
        const results = await Promise.all(
          level.map((s) =>
            this.executeStep(
              s,
              execution,
              workflow,
              stepOutputs,
              compensationManager
            )
          )
        )

        const failedStep = results.find((r) => !r.success)
        if (failedStep) {
          await compensationManager.compensate(
            this.createContext(execution, stepOutputs)
          )
          execution.status = 'failed'
          execution.error = failedStep.error
          execution.completedAt = new Date()
          return execution
        }
      }

      // Success
      const lastStep = remainingSteps[remainingSteps.length - 1]
      execution.outputs = stepOutputs.get(lastStep.id) as typeof execution.outputs
      execution.status = 'completed'
      execution.completedAt = new Date()
    } catch (error) {
      execution.status = 'failed'
      execution.error = error instanceof Error ? error : new Error(String(error))
      execution.completedAt = new Date()
    }

    return execution
  }

  /**
   * Get the active execution ID for a workflow.
   */
  getActiveExecutionId(workflowId: string): string | undefined {
    return this.activeExecutions.get(workflowId)
  }

  /**
   * Get the trigger manager for registering event/webhook handlers.
   */
  getTriggerManager(): TriggerManager {
    return this.triggerManager
  }
}
