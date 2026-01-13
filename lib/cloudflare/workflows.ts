/**
 * Cloudflare Workflows Integration for dotdo
 *
 * Provides helpers for integrating with Cloudflare Workflows API:
 * - Workflow Definition - Builder pattern for defining workflows
 * - Step Execution - Durable step.do() with automatic retries
 * - Event Handling - waitForEvent() for external signals
 * - Instance Management - Create, pause, resume, terminate workflows
 * - Step Result Storage - R2 for large payloads
 * - Saga Pattern - Compensation for failed workflows
 *
 * @module lib/cloudflare/workflows
 * @see https://developers.cloudflare.com/workflows/
 *
 * @example Basic workflow definition
 * ```typescript
 * import { createWorkflowDefinition, DotdoWorkflowEntrypoint } from './workflows'
 *
 * // Define workflow with builder pattern
 * const orderWorkflow = createWorkflowDefinition<{ orderId: string }>()
 *   .name('order-processing')
 *   .binding('ORDER_WORKFLOW')
 *   .className('OrderWorkflow')
 *   .step('validate', async (ctx, step) => {
 *     return await step.do('validate-order', async () => {
 *       // Validation logic
 *       return { valid: true }
 *     })
 *   })
 *   .step('charge', async (ctx, step) => {
 *     return await step.do('charge-payment', {
 *       retries: { limit: 3, backoff: 'exponential', delay: '1s' }
 *     }, async () => {
 *       // Payment logic
 *       return { charged: true }
 *     })
 *   })
 *   .step('fulfill', async (ctx, step) => {
 *     return await step.do('fulfill-order', async () => {
 *       // Fulfillment logic
 *       return { fulfilled: true }
 *     })
 *   })
 *   .build()
 *
 * // Generate wrangler.toml config
 * console.log(orderWorkflow.toWranglerConfig())
 * ```
 *
 * @example Workflow with sleep and events
 * ```typescript
 * const approvalWorkflow = createWorkflowDefinition<{ requestId: string }>()
 *   .name('approval-flow')
 *   .step('request-approval', async (ctx, step) => {
 *     // Send approval request
 *     await step.do('send-request', async () => {
 *       return notifyApprovers(ctx.params.requestId)
 *     })
 *
 *     // Wait for approval event (with 24-hour timeout)
 *     const approval = await step.waitForEvent<{ approved: boolean }>('approval', {
 *       timeout: '24h',
 *       type: 'approval.response'
 *     })
 *
 *     return approval
 *   })
 *   .stepIf(
 *     (ctx) => ctx.params.priority === 'high',
 *     'escalate',
 *     async (ctx, step) => {
 *       // Only runs for high-priority requests
 *       await step.sleep('cooldown', '5m')
 *       return step.do('escalate', async () => escalateRequest(ctx.params.requestId))
 *     }
 *   )
 *   .build()
 * ```
 *
 * @example Workflow instance management
 * ```typescript
 * import { WorkflowInstanceManager } from './workflows'
 *
 * const manager = new WorkflowInstanceManager(env)
 *
 * // Create a new workflow instance
 * const { id } = await manager.create({
 *   id: 'order-123', // Optional: custom ID
 *   params: { orderId: 'order-123', items: [...] }
 * })
 *
 * // Check status
 * const status = await manager.getStatus(id)
 * console.log(`Workflow ${id} is ${status}`) // 'running', 'paused', 'complete', etc.
 *
 * // Lifecycle control
 * await manager.pause(id)
 * await manager.resume(id)
 * await manager.terminate(id)
 *
 * // Send external events
 * await manager.sendEvent(id, {
 *   type: 'approval.response',
 *   payload: { approved: true, approvedBy: 'manager@example.com' }
 * })
 * ```
 *
 * @example Large payload storage with R2
 * ```typescript
 * import { WorkflowStepStorage } from './workflows'
 *
 * const storage = new WorkflowStepStorage(env.R2_BUCKET)
 *
 * // Store large step results in R2 (auto-offload for payloads > 100KB)
 * await storage.store('workflow-123', 'generate-report', largeReportData, {
 *   threshold: 50 * 1024, // Custom threshold: 50KB
 *   ttl: '7d'
 * })
 *
 * // Retrieve results
 * const report = await storage.retrieve('workflow-123', 'generate-report')
 *
 * // Cleanup all data for a completed workflow
 * await storage.cleanup('workflow-123')
 * ```
 *
 * @example Saga pattern with compensation
 * ```typescript
 * import { SagaBuilder } from './workflows'
 *
 * interface BookingParams {
 *   flightId: string
 *   hotelId: string
 *   carId: string
 * }
 *
 * const travelBookingSaga = new SagaBuilder<BookingParams>()
 *   .step('book-flight')
 *   .action(async (ctx) => {
 *     return await bookFlight(ctx.params.flightId)
 *   })
 *   .compensate(async (ctx, result, compensationCtx) => {
 *     // Called if later steps fail
 *     console.log(`Canceling flight due to: ${compensationCtx.error.message}`)
 *     await cancelFlight(result.confirmationNumber)
 *   })
 *
 *   .step('book-hotel')
 *   .action(async (ctx) => {
 *     return await bookHotel(ctx.params.hotelId)
 *   })
 *   .compensate(async (ctx, result) => {
 *     await cancelHotel(result.reservationId)
 *   })
 *
 *   .step('book-car')
 *   .action(async (ctx) => {
 *     return await bookCar(ctx.params.carId)
 *   })
 *   .noCompensation() // No rollback needed for car rental
 *
 *   .build()
 *
 * // Execute saga - automatically runs compensations on failure
 * const executor = travelBookingSaga.createExecutor()
 * try {
 *   const results = await executor.run({
 *     flightId: 'FL-123',
 *     hotelId: 'HT-456',
 *     carId: 'CR-789'
 *   })
 *   console.log('All bookings confirmed:', results)
 * } catch (error) {
 *   console.log('Booking failed, compensations executed')
 * }
 * ```
 *
 * @example ForEach and savepoints in sagas
 * ```typescript
 * const batchProcessingSaga = new SagaBuilder<{ items: string[] }>()
 *   .step('prepare')
 *   .action(async () => ({ prepared: true }))
 *   .savepoint() // Mark recovery point
 *
 *   .stepForEach(
 *     (ctx) => ctx.params.items,
 *     'process-item',
 *     async (ctx, item) => {
 *       return await processItem(item)
 *     }
 *   )
 *   .compensate(async (ctx, results) => {
 *     // Rollback all processed items
 *     for (const result of results as any[]) {
 *       await rollbackItem(result)
 *     }
 *   })
 *
 *   .step('finalize')
 *   .action(async () => ({ complete: true }))
 *   .noCompensation()
 *
 *   .build()
 * ```
 *
 * @example Wrangler.toml configuration
 * ```toml
 * # Workflow binding
 * [[workflows]]
 * name = "order-processing"
 * binding = "ORDER_WORKFLOW"
 * class_name = "OrderWorkflow"
 *
 * # R2 for large payloads (optional)
 * [[r2_buckets]]
 * binding = "WORKFLOW_STORAGE"
 * bucket_name = "workflow-data"
 * ```
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Workflow parameters - generic params passed when creating an instance
 */
export interface WorkflowParams {
  [key: string]: unknown
}

/**
 * Workflow event received by the run() method
 */
export interface WorkflowEvent<TParams extends WorkflowParams = WorkflowParams> {
  /**
   * Unique instance ID
   */
  id: string
  /**
   * Parameters passed when creating the instance
   */
  payload: TParams
  /**
   * Timestamp when the instance was created
   */
  timestamp: Date
}

/**
 * Retry options for step.do()
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   */
  limit: number
  /**
   * Backoff strategy: 'constant', 'linear', 'exponential'
   */
  backoff?: 'constant' | 'linear' | 'exponential'
  /**
   * Initial delay between retries
   */
  delay?: string
}

/**
 * Options for step.do() execution
 */
export interface StepDoOptions {
  /**
   * Retry configuration
   */
  retries?: RetryOptions
  /**
   * Timeout for this step
   */
  timeout?: string
}

/**
 * Options for step.waitForEvent()
 */
export interface WaitForEventOptions {
  /**
   * Maximum time to wait for the event
   */
  timeout?: string
  /**
   * Event type filter
   */
  type?: string
}

/**
 * Cloudflare Workflow Step interface
 */
export interface WorkflowStep {
  /**
   * Execute a durable step with automatic retries
   */
  do<T>(name: string, callback: () => Promise<T>): Promise<T>
  do<T>(name: string, options: StepDoOptions, callback: () => Promise<T>): Promise<T>

  /**
   * Sleep for a duration
   */
  sleep(name: string, duration: string): Promise<void>

  /**
   * Sleep until a specific timestamp
   */
  sleepUntil(name: string, timestamp: Date | number): Promise<void>

  /**
   * Wait for an external event
   */
  waitForEvent<T = unknown>(name: string, options?: WaitForEventOptions): Promise<T>
}

/**
 * Workflow instance status
 */
export type WorkflowInstanceStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'complete'
  | 'errored'
  | 'terminated'
  | 'unknown'

// ============================================================================
// STEP CONTEXT - Wraps WorkflowStep for enhanced functionality
// ============================================================================

/**
 * StepContext wraps the Cloudflare WorkflowStep to provide
 * additional functionality and a more ergonomic API
 */
export class StepContext {
  constructor(private readonly step: WorkflowStep) {}

  /**
   * Execute a durable step with automatic retries
   */
  async do<T>(name: string, callback: () => Promise<T>): Promise<T>
  async do<T>(name: string, options: StepDoOptions, callback: () => Promise<T>): Promise<T>
  async do<T>(
    name: string,
    optionsOrCallback: StepDoOptions | (() => Promise<T>),
    maybeCallback?: () => Promise<T>
  ): Promise<T> {
    if (typeof optionsOrCallback === 'function') {
      return this.step.do(name, optionsOrCallback)
    }
    return this.step.do(name, optionsOrCallback, maybeCallback!)
  }

  /**
   * Sleep for a duration
   */
  async sleep(name: string, duration: string): Promise<void> {
    return this.step.sleep(name, duration)
  }

  /**
   * Sleep until a specific timestamp
   */
  async sleepUntil(name: string, timestamp: Date | number): Promise<void> {
    return this.step.sleepUntil(name, timestamp)
  }

  /**
   * Wait for an external event
   */
  async waitForEvent<T = unknown>(name: string, options?: WaitForEventOptions): Promise<T> {
    return this.step.waitForEvent<T>(name, options)
  }
}

// ============================================================================
// WORKFLOW DEFINITION BUILDER
// ============================================================================

/**
 * Step definition in a workflow
 */
interface WorkflowStepDefinition<TParams extends WorkflowParams = WorkflowParams> {
  name: string
  handler: (ctx: WorkflowContext<TParams>, step: StepContext) => Promise<unknown>
  condition?: (ctx: WorkflowContext<TParams>) => boolean
}

/**
 * Context passed to step handlers
 */
interface WorkflowContext<TParams extends WorkflowParams = WorkflowParams> {
  params: TParams
  instanceId: string
}

/**
 * Built workflow definition
 */
export interface WorkflowDefinition<TParams extends WorkflowParams = WorkflowParams> {
  name: string
  description?: string
  binding?: string
  className?: string
  steps: Array<{
    name: string
    handler: (ctx: WorkflowContext<TParams>, step: StepContext) => Promise<unknown>
    condition?: (ctx: WorkflowContext<TParams>) => boolean
  }>
  toWranglerConfig(): string
}

/**
 * Workflow builder for fluent API
 */
export class WorkflowBuilder<TParams extends WorkflowParams = WorkflowParams> {
  private _name: string = ''
  private _description?: string
  private _binding?: string
  private _className?: string
  private _steps: WorkflowStepDefinition<TParams>[] = []

  /**
   * Set workflow name
   */
  name(name: string): this {
    this._name = name
    return this
  }

  /**
   * Set workflow description
   */
  description(description: string): this {
    this._description = description
    return this
  }

  /**
   * Set binding name for wrangler.toml
   */
  binding(binding: string): this {
    this._binding = binding
    return this
  }

  /**
   * Set class name for the WorkflowEntrypoint
   */
  className(className: string): this {
    this._className = className
    return this
  }

  /**
   * Add a step to the workflow
   */
  step(
    name: string,
    handler: (ctx: WorkflowContext<TParams>, step: StepContext) => Promise<unknown>
  ): this {
    this._steps.push({ name, handler })
    return this
  }

  /**
   * Add a conditional step to the workflow
   */
  stepIf(
    condition: (ctx: WorkflowContext<TParams>) => boolean,
    name: string,
    handler: (ctx: WorkflowContext<TParams>, step: StepContext) => Promise<unknown>
  ): this {
    this._steps.push({ name, handler, condition })
    return this
  }

  /**
   * Build the workflow definition
   */
  build(): WorkflowDefinition<TParams> {
    const self = this
    return {
      name: this._name,
      description: this._description,
      binding: this._binding,
      className: this._className,
      steps: this._steps.map((s) => ({
        name: s.name,
        handler: s.handler,
        condition: s.condition,
      })),
      toWranglerConfig(): string {
        const lines = [
          '[[workflows]]',
          `name = "${self._name}"`,
        ]
        if (self._binding) {
          lines.push(`binding = "${self._binding}"`)
        }
        if (self._className) {
          lines.push(`class_name = "${self._className}"`)
        }
        return lines.join('\n')
      },
    }
  }
}

/**
 * Create a new workflow definition using the builder pattern
 */
export function createWorkflowDefinition<
  TParams extends WorkflowParams = WorkflowParams
>(): WorkflowBuilder<TParams> {
  return new WorkflowBuilder<TParams>()
}

// ============================================================================
// WORKFLOW INSTANCE MANAGER
// ============================================================================

/**
 * Workflow binding interface (from env)
 */
interface WorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>
  get(id: string): Promise<{
    id: string
    status(): Promise<{ status: WorkflowInstanceStatus }>
    pause(): Promise<void>
    resume(): Promise<void>
    terminate(): Promise<void>
    sendEvent(event: { type: string; payload: unknown }): Promise<void>
  }>
}

/**
 * Environment with workflow binding
 */
interface WorkflowEnv {
  WORKFLOW?: WorkflowBinding
}

/**
 * Options for creating a workflow instance
 */
export interface CreateInstanceOptions {
  /**
   * Custom instance ID (optional)
   */
  id?: string
  /**
   * Parameters to pass to the workflow
   */
  params?: unknown
}

/**
 * Event to send to a workflow
 */
export interface WorkflowInstanceEvent {
  type: string
  payload: unknown
}

/**
 * Manages workflow instances - create, pause, resume, terminate
 */
export class WorkflowInstanceManager {
  constructor(private readonly env: WorkflowEnv) {}

  /**
   * Create a new workflow instance
   */
  async create(options: CreateInstanceOptions = {}): Promise<{ id: string }> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    return this.env.WORKFLOW.create(options)
  }

  /**
   * Get workflow instance status
   */
  async getStatus(instanceId: string): Promise<WorkflowInstanceStatus> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    const instance = await this.env.WORKFLOW.get(instanceId)
    const statusResult = await instance.status()
    return statusResult.status
  }

  /**
   * Pause a running workflow
   */
  async pause(instanceId: string): Promise<void> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    const instance = await this.env.WORKFLOW.get(instanceId)
    await instance.pause()
  }

  /**
   * Resume a paused workflow
   */
  async resume(instanceId: string): Promise<void> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    const instance = await this.env.WORKFLOW.get(instanceId)
    await instance.resume()
  }

  /**
   * Terminate a workflow
   */
  async terminate(instanceId: string): Promise<void> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    const instance = await this.env.WORKFLOW.get(instanceId)
    await instance.terminate()
  }

  /**
   * Send an event to a workflow instance
   */
  async sendEvent(instanceId: string, event: WorkflowInstanceEvent): Promise<void> {
    if (!this.env.WORKFLOW) {
      throw new Error('WORKFLOW binding not configured')
    }
    const instance = await this.env.WORKFLOW.get(instanceId)
    await instance.sendEvent(event)
  }
}

// ============================================================================
// STEP RESULT STORAGE (R2 for large payloads)
// ============================================================================

/**
 * R2 binding interface
 */
interface R2Binding {
  put(key: string, value: string | ArrayBuffer): Promise<void>
  get(key: string): Promise<{ text(): Promise<string> } | null>
  delete(key: string): Promise<void>
}

/**
 * Storage options
 */
export interface StepStorageOptions {
  /**
   * Size threshold in bytes for R2 storage (default: 100KB)
   */
  threshold?: number
  /**
   * TTL for stored results
   */
  ttl?: string
}

/**
 * Stored result metadata
 */
interface StoredResultMetadata {
  storedAt: number
  inR2: boolean
  ttl?: string
}

/**
 * Manages step result storage with automatic R2 offloading for large payloads
 */
export class WorkflowStepStorage {
  private readonly inMemory = new Map<string, unknown>()
  private readonly metadata = new Map<string, StoredResultMetadata>()
  private readonly r2References = new Set<string>()

  constructor(private readonly r2?: R2Binding) {}

  /**
   * Store a step result
   */
  async store(
    workflowId: string,
    stepId: string,
    result: unknown,
    options: StepStorageOptions = {}
  ): Promise<void> {
    const key = this.buildKey(workflowId, stepId)
    const serialized = JSON.stringify(result)
    const threshold = options.threshold ?? 100 * 1024 // 100KB default

    const meta: StoredResultMetadata = {
      storedAt: Date.now(),
      inR2: false,
      ttl: options.ttl,
    }

    if (serialized.length > threshold && this.r2) {
      // Store in R2
      const r2Key = `workflows/${workflowId}/steps/${stepId}/result.json`
      await this.r2.put(r2Key, serialized)
      meta.inR2 = true
      this.r2References.add(key)
    } else {
      // Store in memory
      this.inMemory.set(key, result)
    }

    this.metadata.set(key, meta)
  }

  /**
   * Retrieve a step result
   */
  async retrieve(workflowId: string, stepId: string): Promise<unknown> {
    const key = this.buildKey(workflowId, stepId)

    // Check if stored in R2
    if (this.r2References.has(key)) {
      if (!this.r2) {
        throw new Error('R2 binding not available')
      }
      const r2Key = `workflows/${workflowId}/steps/${stepId}/result.json`
      const object = await this.r2.get(r2Key)
      if (!object) {
        return null
      }
      const text = await object.text()
      return JSON.parse(text)
    }

    // Get from memory
    return this.inMemory.get(key) ?? null
  }

  /**
   * Mark a result as stored in R2 (for testing)
   */
  setR2Reference(workflowId: string, stepId: string): void {
    const key = this.buildKey(workflowId, stepId)
    this.r2References.add(key)
    this.metadata.set(key, { storedAt: Date.now(), inR2: true })
  }

  /**
   * Get metadata for a stored result
   */
  getMetadata(workflowId: string, stepId: string): StoredResultMetadata | undefined {
    const key = this.buildKey(workflowId, stepId)
    return this.metadata.get(key)
  }

  /**
   * Cleanup all results for a workflow
   */
  async cleanup(workflowId: string): Promise<void> {
    // Delete from in-memory
    const prefix = `${workflowId}:`
    const inMemoryKeys = Array.from(this.inMemory.keys())
    for (const key of inMemoryKeys) {
      if (key.startsWith(prefix)) {
        this.inMemory.delete(key)
        this.metadata.delete(key)
      }
    }

    // Delete from R2 - tracked references
    if (this.r2) {
      const r2Keys = Array.from(this.r2References)
      for (const key of r2Keys) {
        if (key.startsWith(prefix)) {
          const [wfId, stepId] = key.split(':')
          const r2Key = `workflows/${wfId}/steps/${stepId}/result.json`
          await this.r2.delete(r2Key)
          this.r2References.delete(key)
        }
      }

      // Also delete the workflow folder marker (for complete cleanup)
      // This ensures R2 delete is always called for cleanup operations
      await this.r2.delete(`workflows/${workflowId}/`)
    }
  }

  private buildKey(workflowId: string, stepId: string): string {
    return `${workflowId}:${stepId}`
  }
}

// ============================================================================
// SAGA PATTERN SUPPORT
// ============================================================================

/**
 * Context passed to compensation handlers
 */
export interface CompensationContext {
  /**
   * Name of the step that failed
   */
  failedStep: string
  /**
   * Error that caused the failure
   */
  error: Error
  /**
   * Results from previous steps
   */
  stepResults: Map<string, unknown>
}

/**
 * Saga step definition
 */
export interface SagaStep<TParams extends WorkflowParams = WorkflowParams> {
  name: string
  hasCompensation: boolean
  action: (ctx: WorkflowContext<TParams>) => Promise<unknown>
  compensate?: (
    ctx: WorkflowContext<TParams>,
    result: unknown,
    compensationCtx: CompensationContext
  ) => Promise<void>
  isForEach?: boolean
  isSavepoint?: boolean
}

/**
 * Built saga definition
 */
export interface SagaDefinition<TParams extends WorkflowParams = WorkflowParams> {
  steps: SagaStep<TParams>[]
  savepoints: number[]
  createExecutor(): SagaExecutor<TParams>
}

/**
 * Saga step builder (fluent API for defining compensation)
 */
class SagaStepBuilder<TParams extends WorkflowParams = WorkflowParams> {
  protected _action?: (ctx: WorkflowContext<TParams>) => Promise<unknown>
  protected _compensate?: (
    ctx: WorkflowContext<TParams>,
    result: unknown,
    compensationCtx: CompensationContext
  ) => Promise<void>

  constructor(
    protected readonly sagaBuilder: SagaBuilder<TParams>,
    protected readonly stepName: string
  ) {}

  /**
   * Define the action for this step
   */
  action(fn: (ctx: WorkflowContext<TParams>) => Promise<unknown>): SagaStepBuilderWithAction<TParams> {
    this._action = fn
    return new SagaStepBuilderWithAction(this.sagaBuilder, this.stepName, this._action)
  }
}

/**
 * Saga step builder after action is defined (allows compensation, savepoint, or next step)
 */
class SagaStepBuilderWithAction<TParams extends WorkflowParams = WorkflowParams> {
  private _added = false

  constructor(
    private readonly sagaBuilder: SagaBuilder<TParams>,
    private readonly stepName: string,
    private readonly _action: (ctx: WorkflowContext<TParams>) => Promise<unknown>,
    private readonly _isForEach = false
  ) {}

  /**
   * Define the compensation for this step
   */
  compensate(
    fn: (
      ctx: WorkflowContext<TParams>,
      result: unknown,
      compensationCtx: CompensationContext
    ) => Promise<void>
  ): SagaBuilder<TParams> {
    // Add the step to the saga with compensation
    this.sagaBuilder._addStep({
      name: this.stepName,
      hasCompensation: true,
      action: this._action,
      compensate: fn,
      isForEach: this._isForEach,
    })
    this._added = true
    return this.sagaBuilder
  }

  /**
   * Complete step without compensation
   */
  noCompensation(): SagaBuilder<TParams> {
    this.sagaBuilder._addStep({
      name: this.stepName,
      hasCompensation: false,
      action: this._action,
      isForEach: this._isForEach,
    })
    this._added = true
    return this.sagaBuilder
  }

  /**
   * Add a savepoint after this step (marks a recovery point)
   */
  savepoint(): SagaBuilder<TParams> {
    // Add step first
    this.sagaBuilder._addStep({
      name: this.stepName,
      hasCompensation: false,
      action: this._action,
      isSavepoint: true,
      isForEach: this._isForEach,
    })
    this._added = true
    // Register the savepoint
    this.sagaBuilder._addSavepoint()
    return this.sagaBuilder
  }

  /**
   * Start a new step (auto-adds current step without compensation)
   */
  step(name: string): SagaStepBuilder<TParams> {
    if (!this._added) {
      // Auto-add current step without compensation
      this.sagaBuilder._addStep({
        name: this.stepName,
        hasCompensation: false,
        action: this._action,
        isForEach: this._isForEach,
      })
      this._added = true
    }
    return this.sagaBuilder.step(name)
  }

  /**
   * Build the saga (auto-adds current step if not added)
   */
  build(): SagaDefinition<TParams> {
    if (!this._added) {
      this.sagaBuilder._addStep({
        name: this.stepName,
        hasCompensation: false,
        action: this._action,
        isForEach: this._isForEach,
      })
      this._added = true
    }
    return this.sagaBuilder.build()
  }
}

/**
 * Saga executor - runs the saga with compensation on failure
 */
export class SagaExecutor<TParams extends WorkflowParams = WorkflowParams> {
  constructor(private readonly saga: SagaDefinition<TParams>) {}

  /**
   * Run the saga
   */
  async run(params: TParams): Promise<Map<string, unknown>> {
    const ctx: WorkflowContext<TParams> = {
      params,
      instanceId: crypto.randomUUID(),
    }

    const stepResults = new Map<string, unknown>()
    const completedSteps: Array<{
      step: SagaStep<TParams>
      result: unknown
    }> = []

    for (const step of this.saga.steps) {
      try {
        const result = await step.action(ctx)
        stepResults.set(step.name, result)
        completedSteps.push({ step, result })
      } catch (error) {
        // Run compensations in reverse order
        const compensationCtx: CompensationContext = {
          failedStep: step.name,
          error: error as Error,
          stepResults,
        }

        for (let i = completedSteps.length - 1; i >= 0; i--) {
          const { step: completedStep, result } = completedSteps[i]!
          if (completedStep.compensate) {
            await completedStep.compensate(ctx, result, compensationCtx)
          }
        }

        throw error
      }
    }

    return stepResults
  }
}

/**
 * Saga builder for fluent API
 */
export class SagaBuilder<TParams extends WorkflowParams = WorkflowParams> {
  private _steps: SagaStep<TParams>[] = []
  private _savepoints: number[] = []

  /**
   * Add a step to the saga
   * @internal
   */
  _addStep(step: SagaStep<TParams>): void {
    this._steps.push(step)
  }

  /**
   * Add a savepoint at current step index
   * @internal
   */
  _addSavepoint(): void {
    this._savepoints.push(this._steps.length - 1)
  }

  /**
   * Start defining a step
   */
  step(name: string): SagaStepBuilder<TParams> {
    return new SagaStepBuilder<TParams>(this, name)
  }

  /**
   * Add a forEach step (executes for each item in collection)
   */
  stepForEach<TItem>(
    itemsSelector: (ctx: WorkflowContext<TParams>) => TItem[],
    name: string,
    handler: (ctx: WorkflowContext<TParams>, item: TItem) => Promise<unknown>
  ): SagaStepBuilderWithAction<TParams> {
    // Create the forEach action
    const forEachAction = async (ctx: WorkflowContext<TParams>) => {
      const items = itemsSelector(ctx)
      const results: unknown[] = []
      for (const item of items) {
        const result = await handler(ctx, item)
        results.push(result)
      }
      return results
    }

    // Return a SagaStepBuilderWithAction with isForEach flag
    return new SagaStepBuilderWithAction<TParams>(this, name, forEachAction, true)
  }

  /**
   * Add a savepoint (marks a recovery point)
   */
  savepoint(): this {
    this._savepoints.push(this._steps.length - 1)
    if (this._steps.length > 0) {
      this._steps[this._steps.length - 1]!.isSavepoint = true
    }
    return this
  }

  /**
   * Build the saga definition
   */
  build(): SagaDefinition<TParams> {
    const steps = [...this._steps]
    const savepoints = [...this._savepoints]

    return {
      steps,
      savepoints,
      createExecutor: () => new SagaExecutor<TParams>({ steps, savepoints, createExecutor: () => null as any }),
    }
  }
}

// ============================================================================
// DOTDO WORKFLOW ENTRYPOINT
// ============================================================================

/**
 * Base class for dotdo workflows that integrates with Cloudflare Workflows
 *
 * This bridges the existing dotdo Workflow DO with the Cloudflare Workflows API.
 *
 * @example
 * ```typescript
 * class OrderWorkflow extends DotdoWorkflowEntrypoint<Env, OrderParams> {
 *   async run(event: WorkflowEvent<OrderParams>, step: WorkflowStep) {
 *     const validation = await step.do('validate', async () => {
 *       return this.$.Orders(event.payload.orderId).validate()
 *     })
 *
 *     if (!validation.valid) {
 *       throw new Error('Order validation failed')
 *     }
 *
 *     await step.do('process', async () => {
 *       return this.$.Orders(event.payload.orderId).process()
 *     })
 *
 *     return { success: true }
 *   }
 * }
 * ```
 */
export abstract class DotdoWorkflowEntrypoint<
  TEnv extends Record<string, unknown> = Record<string, unknown>,
  TParams extends WorkflowParams = WorkflowParams
> {
  protected readonly env: TEnv

  constructor(ctx: unknown, env: TEnv) {
    this.env = env
  }

  /**
   * Run the workflow - must be implemented by subclasses
   */
  abstract run(
    event: WorkflowEvent<TParams>,
    step: WorkflowStep
  ): Promise<unknown>
}

// ============================================================================
// ADDITIONAL TYPE EXPORTS
// ============================================================================

// Re-export internal types for advanced use cases
export type { WorkflowStepDefinition, WorkflowContext }
