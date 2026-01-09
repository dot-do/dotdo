/**
 * Executor Types - Shared type definitions for workflow execution
 *
 * This module exists to break circular dependencies between:
 * - objects/WorkflowRuntime.ts
 * - lib/executors/ParallelStepExecutor.ts
 *
 * By extracting shared types here, both modules can import from this
 * shared file without creating import cycles.
 */

import type { Modifier } from '../Modifier'
import type { WaitForEventOptions } from '../../workflows/WaitForEventManager'

// ============================================================================
// Step Configuration Types
// ============================================================================

export interface WorkflowStepConfig {
  /** Step timeout */
  timeout?: string | number
  /** Number of retries */
  retries?: number
  /** Delay between retries */
  retryDelay?: string | number
  /** Modifiers to transform input/output */
  modifiers?: Modifier[]
}

// ============================================================================
// Step Context Types
// ============================================================================

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
