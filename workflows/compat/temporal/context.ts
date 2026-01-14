/**
 * Workflow Context Module
 *
 * AsyncLocalStorage-based context management for concurrent workflow execution.
 * This enables multiple workflows to execute concurrently without global state pollution.
 */

import { AsyncLocalStorage } from 'async_hooks'
import { WaitForEventManager } from '../../WaitForEventManager'
import { InMemoryStepStorage } from '../../runtime'
import type { StepStorage } from '../../runtime'
import type { WorkflowStep } from '../../../lib/cloudflare/workflows'
import type { WorkflowState, PatchState, WorkflowContext } from './types'
import { createStorageStrategy, type WorkflowStorageStrategy } from './storage'
import { setGetCurrentWorkflowFn } from './determinism'

// Re-export WorkflowContext from types
export type { WorkflowContext } from './types'

// ============================================================================
// ASYNCLOCALSTORAGE
// ============================================================================

// AsyncLocalStorage provides execution-scoped context
// This works in both Node.js and Cloudflare Workers runtime
const workflowContextStorage = new AsyncLocalStorage<WorkflowContext>()

// ============================================================================
// CONTEXT ACCESSORS
// ============================================================================

/**
 * Get the current workflow context from AsyncLocalStorage.
 * Returns null if not executing within a workflow.
 */
export function getCurrentContext(): WorkflowContext | null {
  return workflowContextStorage.getStore() ?? null
}

/**
 * Get the current workflow state for backward compatibility.
 * This function bridges the old global state approach with the new context-based approach.
 */
export function getCurrentWorkflow(): WorkflowState | null {
  const ctx = getCurrentContext()
  return ctx?.workflow ?? null
}

/**
 * Get the current patch state from context.
 */
export function getCurrentPatchState(): PatchState | null {
  const ctx = getCurrentContext()
  return ctx?.patchState ?? null
}

/**
 * Set the current patch state within the context.
 */
export function setCurrentPatchState(patchState: PatchState): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.patchState = patchState
  }
}

/**
 * Execute a workflow function within a context.
 * This ensures all workflow operations have access to the correct context.
 */
export function runWithContext<T>(context: WorkflowContext, fn: () => T): T {
  return workflowContextStorage.run(context, fn)
}

/**
 * Check if code is running within a workflow context.
 * Useful for conditional behavior based on workflow vs non-workflow execution.
 */
export function inWorkflowContext(): boolean {
  return getCurrentWorkflow() !== null
}

// ============================================================================
// GLOBAL REGISTRIES
// ============================================================================

// These are shared lookup tables, not per-execution state
let globalStorage: StepStorage = new InMemoryStepStorage()
let globalState: DurableObjectState | null = null
let globalWaitManager: WaitForEventManager | null = null
let globalNamespace = 'default'

// Workflow registry - shared across all executions for handle lookups
const workflows = new Map<string, WorkflowState>()
const workflowFunctions = new Map<string, (...args: unknown[]) => Promise<unknown>>()

/**
 * Get the workflows registry (for client and child workflow access)
 */
export function getWorkflowsRegistry(): Map<string, WorkflowState> {
  return workflows
}

/**
 * Get the workflow functions registry
 */
export function getWorkflowFunctionsRegistry(): Map<string, (...args: unknown[]) => Promise<unknown>> {
  return workflowFunctions
}

/**
 * Get the global namespace
 */
export function getGlobalNamespace(): string {
  return globalNamespace
}

/**
 * Set the global namespace
 */
export function setGlobalNamespace(namespace: string): void {
  globalNamespace = namespace
}

/**
 * Get the global storage
 */
export function getGlobalStorage(): StepStorage {
  return globalStorage
}

/**
 * Get the global wait manager
 */
export function getGlobalWaitManager(): WaitForEventManager | null {
  return globalWaitManager
}

/**
 * Get the current storage from context or fallback to global.
 *
 * This provides a single source of truth for storage access, consolidating
 * the pattern of `ctx?.storage ?? globalStorage` that was previously
 * scattered throughout the codebase.
 */
export function getCurrentStorage(): StepStorage {
  const ctx = getCurrentContext()
  return ctx?.storage ?? globalStorage
}

/**
 * Get the storage strategy for the current workflow context.
 *
 * This function creates the appropriate storage strategy based on the current context:
 * - If a WorkflowStep is available, returns CFWorkflowsStorageStrategy (FREE sleeping, durable)
 * - Otherwise, returns InMemoryStorageStrategy (fallback, BILLABLE sleeping)
 *
 * Note: Strategies are created on-demand rather than stored in context to avoid
 * stale strategy references when WorkflowStep is set/cleared dynamically.
 */
export function getCurrentStorageStrategy(): WorkflowStorageStrategy {
  const ctx = getCurrentContext()
  const step = ctx?.workflowStep ?? null
  const storage = getCurrentStorage()
  return createStorageStrategy(step, storage)
}

// ============================================================================
// CF WORKFLOWS STEP CONTEXT
// ============================================================================

/**
 * Set the WorkflowStep context for the current workflow execution.
 * Call this at the beginning of a CF Workflows run() method to enable
 * native step.do() and step.sleep() execution.
 *
 * The step is stored in the workflow's AsyncLocalStorage context, ensuring
 * isolation between concurrent workflow executions.
 *
 * @param step - The WorkflowStep from CF Workflows runtime, or null to clear
 *
 * @example
 * ```typescript
 * async run(event: WorkflowEvent, step: WorkflowStep) {
 *   setWorkflowStep(step)
 *   try {
 *     // Temporal compat layer will use step.sleep() and step.do()
 *     await sleep('5s')
 *     await activities.processOrder(event.payload.orderId)
 *   } finally {
 *     clearWorkflowStep()
 *   }
 * }
 * ```
 */
export function setWorkflowStep(step: WorkflowStep | null): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.workflowStep = step
  }
}

/**
 * Clear the WorkflowStep context for the current workflow.
 * Call this when exiting the CF Workflows context.
 */
export function clearWorkflowStep(): void {
  const ctx = getCurrentContext()
  if (ctx) {
    ctx.workflowStep = null
  }
}

/**
 * Get the current WorkflowStep context, or null if not in a CF Workflows context.
 * Used internally by sleep() and proxyActivities() to route to native APIs.
 */
export function getWorkflowStep(): WorkflowStep | null {
  const ctx = getCurrentContext()
  return ctx?.workflowStep ?? null
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configure the Temporal compat layer globals.
 *
 * This is the single entry point for backend configuration. The storage
 * strategy (CFWorkflows vs InMemory) is auto-detected at runtime based on
 * whether a WorkflowStep context is available.
 *
 * ## Configuration Flow
 *
 * 1. Set `storage` for durable step persistence
 * 2. Set `state` for DurableObject state access (required for waitForEvent)
 * 3. Set `namespace` for workflow isolation
 *
 * ## Storage Strategy Selection (Automatic)
 *
 * - If WorkflowStep context is available: Uses CFWorkflowsStorageStrategy
 *   - sleep() uses step.sleep() - FREE (no wall-clock billing)
 *   - Activities use step.do() - DURABLE (survives restarts)
 *
 * - Otherwise: Uses InMemoryStorageStrategy (fallback)
 *   - sleep() uses setTimeout - BILLABLE (consumes DO time)
 *   - Activities execute directly - NOT DURABLE
 *
 * @example
 * ```typescript
 * import { configure } from '@dotdo/temporal'
 *
 * // In a Durable Object
 * configure({
 *   storage: new DOStepStorage(ctx.storage),
 *   state: ctx.state,
 *   namespace: 'production'
 * })
 * ```
 */
export function configure(opts: { storage?: StepStorage; state?: DurableObjectState; namespace?: string }): void {
  if (opts.storage) globalStorage = opts.storage
  if (opts.state) {
    globalState = opts.state
    globalWaitManager = new WaitForEventManager(opts.state)
  }
  if (opts.namespace) globalNamespace = opts.namespace
}

// ============================================================================
// DURATION FORMATTING
// ============================================================================

/**
 * Format a duration in milliseconds to CF Workflows format string.
 * CF Workflows accepts durations like '5s', '1m', '1h', etc.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDurationForCF(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60 * 1000) {
    const seconds = Math.round(ms / 1000)
    return `${seconds}s`
  }
  if (ms < 60 * 60 * 1000) {
    const minutes = Math.round(ms / (60 * 1000))
    return `${minutes}m`
  }
  const hours = Math.round(ms / (60 * 60 * 1000))
  return `${hours}h`
}

/**
 * Generate a unique step ID for sleep operations.
 * Uses per-workflow counter for deterministic IDs across concurrent workflows.
 *
 * @param ms - Duration in milliseconds
 * @returns Unique step ID
 */
export function generateSleepStepId(ms: number): string {
  const ctx = getCurrentContext()
  if (!ctx?.workflow) {
    // Fallback for non-workflow context (testing)
    return `sleep:${formatDurationForCF(ms)}:${Date.now()}`
  }
  ctx.workflow.sleepStepCounter++
  return `sleep:${formatDurationForCF(ms)}:${ctx.workflow.sleepStepCounter}`
}

// ============================================================================
// ID GENERATION
// ============================================================================

export function generateWorkflowId(): string {
  return `wf_${crypto.randomUUID().replace(/-/g, '')}`
}

export function generateRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '')}`
}

export function generateTimerId(): string {
  return `timer_${crypto.randomUUID().replace(/-/g, '')}`
}

// ============================================================================
// STATE RESET
// ============================================================================

/**
 * Reset global registries (for testing)
 */
export function resetGlobalState(): void {
  workflows.clear()
  workflowFunctions.clear()
  globalNamespace = 'default'
  clearWorkflowStep()
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Wire up the determinism module to access current workflow
setGetCurrentWorkflowFn(getCurrentWorkflow)
