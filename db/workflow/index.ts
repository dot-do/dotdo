/**
 * Workflow Primitives
 *
 * Temporal-inspired durable execution with activities, timers, and signals.
 * This is a stub file - implementation TBD.
 */

// =============================================================================
// Types (exported for consumers)
// =============================================================================

export interface WorkflowContext<T = unknown> {
  workflowId: string
  taskQueue: string
  startTime: Date
  currentStep: string

  // Activities
  activity<R>(
    name: string,
    options: ActivityOptions<unknown>
  ): Promise<R>

  // Timers
  sleep(duration: string | number): Promise<void>
  sleepUntil(deadline: string | Date): Promise<void>

  // Signals
  waitForSignal<T>(
    name: string,
    options?: WaitForSignalOptions<T>
  ): Promise<T>

  // Queries
  setQueryHandler<R>(name: string, handler: (...args: unknown[]) => R): void

  // Child workflows
  startChild<I, O>(
    workflow: WorkflowDefinition<I, O>,
    options: ChildWorkflowOptions<I>
  ): Promise<WorkflowHandle<O>>
}

export interface ActivityOptions<T> {
  input: T
  retry?: RetryPolicy
  timeout?: string
  heartbeatTimeout?: string
}

export interface RetryPolicy {
  maxAttempts?: number
  initialInterval?: string
  maxInterval?: string
  backoffCoefficient?: number
  backoff?: 'exponential' | 'linear'
}

export interface WaitForSignalOptions<T> {
  timeout?: string
  default?: T
}

export interface ChildWorkflowOptions<T> {
  workflowId: string
  input: T
  taskQueue?: string
}

export interface WorkflowDefinition<I = unknown, O = unknown> {
  name: string
  handler: (ctx: WorkflowContext, input: I) => Promise<O>
  toJSON(): { name: string }
}

export interface WorkflowHandle<T = unknown> {
  workflowId: string
  result(options?: { timeout?: string }): Promise<T>
  query<R>(name: string, ...args: unknown[]): Promise<R>
  signal<T>(name: string, payload: T): Promise<void>
  cancel(): Promise<void>
}

export interface ActivityDefinition<I = unknown, O = unknown> {
  name: string
  handler: (input: I) => Promise<O>
}

export interface ActivityContext {
  heartbeat(details?: unknown): Promise<void>
}

export interface WorkflowInfo {
  workflowId: string
  workflowType: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  taskQueue: string
  startedAt: Date
  completedAt?: Date
  error?: string
}

export interface ListOptions {
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  taskQueue?: string
  limit?: number
  pageToken?: string
}

export interface ListResult extends Array<WorkflowInfo> {
  nextPageToken?: string
}

export interface WorkerOptions {
  taskQueue: string
  workflows: WorkflowDefinition[]
  activities: ActivityDefinition[]
}

// =============================================================================
// workflow() - Define a workflow
// =============================================================================

export function workflow<I, O>(
  name: string,
  handler: (ctx: WorkflowContext, input: I) => Promise<O>
): WorkflowDefinition<I, O> {
  throw new Error('workflow() not implemented')
}

// =============================================================================
// activity() - Placeholder (use defineActivity instead)
// =============================================================================

export function activity<I, O>(
  name: string,
  handler: (input: I) => Promise<O>
): ActivityDefinition<I, O> {
  throw new Error('activity() not implemented')
}

// =============================================================================
// defineActivity() - Define an activity
// =============================================================================

export function defineActivity<I, O>(
  name: string,
  handler: (input: I, ctx?: ActivityContext) => Promise<O>
): ActivityDefinition<I, O> {
  throw new Error('defineActivity() not implemented')
}

// =============================================================================
// WorkflowClient - Start and interact with workflows
// =============================================================================

export class WorkflowClient {
  constructor(private readonly doBinding: unknown) {
    throw new Error('WorkflowClient not implemented')
  }

  async start<I, O>(
    workflow: WorkflowDefinition<I, O>,
    options: {
      workflowId?: string
      input: I
      taskQueue: string
    }
  ): Promise<WorkflowHandle<O>> {
    throw new Error('WorkflowClient.start() not implemented')
  }

  async list(options?: ListOptions): Promise<ListResult> {
    throw new Error('WorkflowClient.list() not implemented')
  }

  async describe(workflowId: string): Promise<WorkflowInfo> {
    throw new Error('WorkflowClient.describe() not implemented')
  }

  async terminate(workflowId: string, reason?: string): Promise<void> {
    throw new Error('WorkflowClient.terminate() not implemented')
  }
}

// =============================================================================
// WorkflowWorker - Execute workflows
// =============================================================================

export class WorkflowWorker {
  public readonly taskQueue: string

  constructor(options: WorkerOptions) {
    throw new Error('WorkflowWorker not implemented')
  }

  async run(): Promise<void> {
    throw new Error('WorkflowWorker.run() not implemented')
  }

  async shutdown(): Promise<void> {
    throw new Error('WorkflowWorker.shutdown() not implemented')
  }
}
