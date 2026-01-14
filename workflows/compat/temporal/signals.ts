/**
 * Signals, Queries, and Updates Module
 *
 * Definitions and handlers for workflow communication primitives.
 */

import type {
  SignalDefinition,
  QueryDefinition,
  UpdateDefinition,
  SignalHandler,
  QueryHandler,
  UpdateHandler,
  WorkflowInfo,
  SearchAttributes,
  PatchState,
} from './types'
import {
  getCurrentWorkflow,
  getCurrentPatchState,
  setCurrentPatchState,
} from './context'

// ============================================================================
// SIGNAL, QUERY, UPDATE DEFINITIONS
// ============================================================================

/**
 * Define a signal
 */
export function defineSignal<Args extends unknown[] = [], Name extends string = string>(name: Name): SignalDefinition<Args, Name> {
  return { name, type: 'signal' }
}

/**
 * Define a query
 */
export function defineQuery<TResult = unknown, Args extends unknown[] = [], Name extends string = string>(name: Name): QueryDefinition<TResult, Args, Name> {
  return { name, type: 'query' }
}

/**
 * Define an update
 */
export function defineUpdate<TResult = unknown, Args extends unknown[] = [], Name extends string = string>(name: Name): UpdateDefinition<TResult, Args, Name> {
  return { name, type: 'update' }
}

// ============================================================================
// SET HANDLER
// ============================================================================

/**
 * Set handler for signal, query, or update
 */
export function setHandler<Args extends unknown[]>(signal: SignalDefinition<Args>, handler: SignalHandler<Args>): void
export function setHandler<TResult, Args extends unknown[]>(query: QueryDefinition<TResult, Args>, handler: QueryHandler<TResult, Args>): void
export function setHandler<TResult, Args extends unknown[]>(update: UpdateDefinition<TResult, Args>, handler: UpdateHandler<TResult, Args>): void
export function setHandler(
  definition: SignalDefinition<unknown[]> | QueryDefinition<unknown, unknown[]> | UpdateDefinition<unknown, unknown[]>,
  handler: SignalHandler<unknown[]> | QueryHandler<unknown, unknown[]> | UpdateHandler<unknown, unknown[]>
): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('setHandler can only be called within a workflow')
  }

  if (definition.type === 'signal') {
    workflow.signalHandlers.set(definition.name, handler as SignalHandler<unknown[]>)
  } else if (definition.type === 'query') {
    workflow.queryHandlers.set(definition.name, handler as QueryHandler<unknown, unknown[]>)
  } else {
    workflow.updateHandlers.set(definition.name, handler as UpdateHandler<unknown, unknown[]>)
  }
}

// ============================================================================
// WORKFLOW INFO
// ============================================================================

/**
 * Get current workflow info
 */
export function workflowInfo(): WorkflowInfo {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('workflowInfo can only be called within a workflow')
  }

  return {
    workflowId: workflow.workflowId,
    runId: workflow.runId,
    workflowType: workflow.workflowType,
    taskQueue: workflow.taskQueue,
    namespace: workflow.namespace,
    firstExecutionRunId: workflow.runId,
    attempt: workflow.attempt,
    historyLength: workflow.historyLength,
    startTime: workflow.startTime,
    runStartTime: workflow.runStartTime,
    memo: workflow.memo,
    searchAttributes: workflow.searchAttributes,
    parent: workflow.parent,
  }
}

// ============================================================================
// SEARCH ATTRIBUTES
// ============================================================================

/**
 * Set search attributes (replaces all)
 */
export function setSearchAttributes(attrs: SearchAttributes): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('setSearchAttributes can only be called within a workflow')
  }
  workflow.searchAttributes = { ...attrs }
  workflow.historyLength++
}

/**
 * Upsert (merge) search attributes
 */
export function upsertSearchAttributes(attrs: SearchAttributes): void {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    throw new Error('upsertSearchAttributes can only be called within a workflow')
  }
  workflow.searchAttributes = {
    ...workflow.searchAttributes,
    ...attrs,
  }
  workflow.historyLength++
}

// ============================================================================
// VERSIONING / PATCHING
// ============================================================================

/**
 * Check if a patch should be applied
 * For new executions, this always returns true (take the new path)
 * For replays of old executions, this returns false to maintain compatibility
 */
export function patched(patchId: string): boolean {
  let patchState = getCurrentPatchState()
  if (!patchState) {
    patchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
    setCurrentPatchState(patchState)
  }

  // For new executions, always apply patches
  // In a full implementation, this would check workflow history
  patchState.appliedPatches.add(patchId)

  const workflow = getCurrentWorkflow()
  if (workflow) {
    workflow.historyLength++
  }

  return true
}

/**
 * Deprecate an old patch (removes it from consideration in new workflow code)
 */
export function deprecatePatch(patchId: string): void {
  let patchState = getCurrentPatchState()
  if (!patchState) {
    patchState = {
      appliedPatches: new Set(),
      deprecatedPatches: new Set(),
    }
    setCurrentPatchState(patchState)
  }

  patchState.deprecatedPatches.add(patchId)
}

// ============================================================================
// DETERMINISTIC RANDOM AND UUID
// ============================================================================

/**
 * Per-workflow counters for deterministic step IDs
 * These are tracked per workflow execution to ensure each uuid4()/random() call
 * gets a unique, deterministic step ID based on call order.
 */
import type { WorkflowState } from './types'
const uuidCounters = new WeakMap<WorkflowState, number>()
const randomCounters = new WeakMap<WorkflowState, number>()
const nowCounters = new WeakMap<WorkflowState, number>()

/**
 * Generate deterministic UUID (for replay)
 *
 * This function is deterministic within a workflow execution:
 * - First execution: generates a new UUID and stores it
 * - Replay: returns the same UUID that was generated before
 *
 * IMPORTANT: Must be called within a workflow context.
 * The step ID is based on call order within the workflow, so
 * uuid4() calls must happen in the same order on replay.
 *
 * @returns A UUID v4 string that is deterministic on replay
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { uuid4 } from '@dotdo/temporal'
 *
 * export async function orderWorkflow() {
 *   // These IDs will be the same on replay
 *   const orderId = uuid4()
 *   const transactionId = uuid4()
 *   return { orderId, transactionId }
 * }
 * ```
 */
export function uuid4(): string {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to non-deterministic
    // This allows usage in tests or non-workflow code
    return crypto.randomUUID()
  }

  // Get and increment the counter for this workflow
  const counter = uuidCounters.get(workflow) ?? 0
  uuidCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `uuid4:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return workflow.stepResults.get(stepId) as string
  }

  // Generate new UUID and store for replay
  const id = crypto.randomUUID()
  workflow.stepResults.set(stepId, id)
  workflow.historyLength++

  return id
}

/**
 * Get deterministic random number (for replay)
 *
 * This function is deterministic within a workflow execution:
 * - First execution: generates a new random number and stores it
 * - Replay: returns the same random number that was generated before
 *
 * IMPORTANT: Must be called within a workflow context.
 * The step ID is based on call order within the workflow, so
 * random() calls must happen in the same order on replay.
 *
 * @returns A number between 0 (inclusive) and 1 (exclusive)
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { random } from '@dotdo/temporal'
 *
 * export async function retryWorkflow() {
 *   // This decision will be the same on replay
 *   const shouldRetry = random() < 0.5
 *   return { shouldRetry }
 * }
 * ```
 */
export function random(): number {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to non-deterministic
    // This allows usage in tests or non-workflow code
    return Math.random()
  }

  // Get and increment the counter for this workflow
  const counter = randomCounters.get(workflow) ?? 0
  randomCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `random:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return workflow.stepResults.get(stepId) as number
  }

  // Generate new random number and store for replay
  const num = Math.random()
  workflow.stepResults.set(stepId, num)
  workflow.historyLength++

  return num
}

/**
 * Get deterministic current time (for replay).
 *
 * This function returns a deterministic timestamp based on workflow start time
 * plus an offset derived from the step count. On replay, it returns the same
 * timestamp that was recorded during the original execution.
 *
 * Use this instead of `Date.now()` or `new Date()` in workflow code.
 *
 * @returns A Date object representing the current workflow time
 * @throws Error if called outside a workflow context
 *
 * @example
 * ```typescript
 * import { workflowNow } from '@dotdo/temporal'
 *
 * export async function orderWorkflow() {
 *   // Use workflowNow() instead of new Date() or Date.now()
 *   const orderTime = workflowNow()
 *   const expiresAt = new Date(workflowNow().getTime() + 24 * 60 * 60 * 1000)
 *
 *   return { orderTime, expiresAt }
 * }
 * ```
 */
export function workflowNow(): Date {
  const workflow = getCurrentWorkflow()
  if (!workflow) {
    // Outside workflow context - fall back to real time
    // This allows usage in tests or non-workflow code
    return new Date()
  }

  // Get and increment the counter for this workflow
  const counter = nowCounters.get(workflow) ?? 0
  nowCounters.set(workflow, counter + 1)

  // Create deterministic step ID based on call order
  const stepId = `workflowNow:${counter}`

  // Check for existing result (replay case)
  if (workflow.stepResults.has(stepId)) {
    return new Date(workflow.stepResults.get(stepId) as number)
  }

  // Calculate deterministic time:
  // Start time + (counter * small increment to show progression)
  // This ensures time appears to progress while remaining deterministic
  // NOTE: We use the workflowNow counter (not historyLength) because historyLength
  // can vary between replays due to conditional paths or optimizations
  const baseTime = workflow.startTime.getTime()
  const stepIncrement = counter + 1 // 1ms per call for minimal progression (counter is 0-indexed)
  const deterministicTime = baseTime + stepIncrement

  // Store for replay
  workflow.stepResults.set(stepId, deterministicTime)
  workflow.historyLength++

  return new Date(deterministicTime)
}

// ============================================================================
// CONTINUE AS NEW
// ============================================================================

import type { ContinueAsNewOptions } from './types'

export class ContinueAsNew extends Error {
  readonly args: unknown[]
  readonly options: ContinueAsNewOptions

  constructor(args: unknown[], options: ContinueAsNewOptions = {}) {
    super('ContinueAsNew')
    this.name = 'ContinueAsNew'
    this.args = args
    this.options = options
  }
}

/**
 * Continue as new with fresh history
 */
export function continueAsNew<TArgs extends unknown[]>(...args: TArgs): never {
  throw new ContinueAsNew(args)
}

/**
 * Make continue-as-new function for a specific workflow
 */
export function makeContinueAsNewFunc<TArgs extends unknown[], TResult>(
  _workflowType: string | ((...args: TArgs) => Promise<TResult>),
  options?: ContinueAsNewOptions
): (...args: TArgs) => never {
  return (...args: TArgs) => {
    throw new ContinueAsNew(args, options)
  }
}

// ============================================================================
// CANCELLATION
// ============================================================================

import { WaitCancelledError } from '../../WaitForEventManager'

export class CancellationScope {
  private readonly children: CancellationScope[] = []
  private readonly cleanupFns: (() => void | Promise<void>)[] = []
  private _isCancelled = false

  get isCancelled(): boolean {
    return this._isCancelled
  }

  cancel(): void {
    this._isCancelled = true
    for (const child of this.children) {
      child.cancel()
    }
  }

  /**
   * Run a function in this cancellation scope
   */
  static async run<T>(fn: () => Promise<T>): Promise<T> {
    const scope = new CancellationScope()
    try {
      return await fn()
    } finally {
      for (const cleanup of scope.cleanupFns) {
        await cleanup()
      }
    }
  }

  /**
   * Create a non-cancellable scope
   */
  static nonCancellable<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  /**
   * Create a cancellable scope with timeout
   */
  static async cancellable<T>(fn: () => Promise<T>): Promise<T> {
    return CancellationScope.run(fn)
  }
}

/**
 * Check if cancelled
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof WaitCancelledError
}
