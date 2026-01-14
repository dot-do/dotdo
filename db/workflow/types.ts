/**
 * Workflow Primitives - Type Definitions
 */

// =============================================================================
// Duration Types
// =============================================================================

export type DurationString = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}` | string

// =============================================================================
// Retry Policy
// =============================================================================

export interface RetryPolicy {
  maxAttempts?: number
  initialInterval?: DurationString
  maxInterval?: DurationString
  backoffCoefficient?: number
  backoff?: 'exponential' | 'linear'
}

// =============================================================================
// Activity Types
// =============================================================================

export interface ActivityOptions<T = unknown> {
  input: T
  retry?: RetryPolicy
  timeout?: DurationString
  heartbeatTimeout?: DurationString
}

export interface ActivityContext {
  heartbeat(details?: unknown): Promise<void>
}

// Activity handler receives (inputOrCtx, maybeInput?) to support both:
// - (input: T) => R  (simple case, input-only)
// - (ctx: ActivityContext) => R  (context only, no input)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActivityHandler<T = any, R = any> = (arg: T | ActivityContext, maybeArg?: T) => Promise<R>

export interface ActivityDefinition<T = unknown, R = unknown> {
  name: string
  handler: ActivityHandler<T, R>
}

// =============================================================================
// Signal Types
// =============================================================================

export interface SignalOptions<T = unknown> {
  timeout?: DurationString
  default?: T
}

// =============================================================================
// Workflow Context
// =============================================================================

export interface ChildWorkflowOptions<T = unknown> {
  workflowId: string
  input: T
  taskQueue?: string
}

export interface WorkflowContext {
  workflowId: string
  taskQueue: string
  startTime: Date
  currentStep: number

  // Activities
  activity<T = unknown, R = unknown>(
    name: string,
    options: ActivityOptions<T>
  ): Promise<R>

  // Timers
  sleep(duration: DurationString | number): Promise<void>
  sleepUntil(timestamp: string | Date): Promise<void>

  // Signals
  waitForSignal<T = unknown>(
    name: string,
    options?: SignalOptions<T>
  ): Promise<T>

  // Queries
  setQueryHandler<T = unknown>(
    name: string,
    handler: (...args: unknown[]) => T
  ): void

  // Child Workflows
  startChild<T, R>(
    workflow: WorkflowDefinition<T, R>,
    options: ChildWorkflowOptions<T>
  ): Promise<WorkflowHandle<R>>
}

// =============================================================================
// Workflow Definition
// =============================================================================

export type WorkflowHandler<T, R> = (ctx: WorkflowContext, input: T) => Promise<R>

export interface WorkflowDefinition<T = unknown, R = unknown> {
  name: string
  handler: WorkflowHandler<T, R>
  toJSON(): { name: string }
}

// =============================================================================
// Workflow Handle
// =============================================================================

export interface WorkflowHandle<R = unknown> {
  workflowId: string
  result(options?: { timeout?: DurationString }): Promise<R>
  query<T = unknown>(name: string, ...args: unknown[]): Promise<T>
  signal<T = unknown>(name: string, payload: T): Promise<void>
  cancel(): Promise<void>
}

// =============================================================================
// Workflow Start Options
// =============================================================================

export interface WorkflowStartOptions<T = unknown> {
  workflowId?: string
  input: T
  taskQueue: string
}

// =============================================================================
// Workflow Info
// =============================================================================

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowInfo {
  workflowId: string
  workflowType: string
  status: WorkflowStatus
  taskQueue: string
  input?: unknown
  result?: unknown
  error?: string
  startedAt: Date
  completedAt?: Date
}

// =============================================================================
// Workflow List Options
// =============================================================================

export interface WorkflowListOptions {
  status?: WorkflowStatus
  taskQueue?: string
  limit?: number
  pageToken?: string
}

export interface WorkflowListResult extends Array<WorkflowInfo> {
  nextPageToken?: string
}

// =============================================================================
// Errors
// =============================================================================

export class CancelledError extends Error {
  constructor(message = 'Workflow was cancelled') {
    super(message)
    this.name = 'CancelledError'
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class SignalTimeoutError extends TimeoutError {
  constructor(signalName: string) {
    super(`timeout waiting for signal: ${signalName}`)
    this.name = 'SignalTimeoutError'
  }
}
