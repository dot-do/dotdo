/**
 * Type Guards for GraphThing Domain Data Types
 *
 * This module provides runtime type guards that enable safe type narrowing
 * without requiring 'as unknown as T' casts. These guards validate the structure
 * of data at runtime and provide TypeScript type predicates.
 *
 * @module db/graph/type-guards
 * @see dotdo-y04jb - Type guards for GraphThing domain data types
 */

import type { FunctionData, FunctionType } from './adapters/function-graph-adapter'
import type {
  WorkflowInstanceData,
  WorkflowTemplateData,
  WorkflowStepData,
  WorkflowStepType,
  StepResultData,
} from './workflows/types'
import type { SessionThingData, UserThingData } from './humans/types'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a value is a non-null object (not an array)
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ============================================================================
// FUNCTION DATA TYPE GUARD
// ============================================================================

/**
 * Valid function types
 */
const FUNCTION_TYPES: FunctionType[] = ['code', 'generative', 'agentic', 'human']

/**
 * Type guard for FunctionData
 *
 * Validates that an unknown value conforms to the FunctionData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid FunctionData
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(id)
 * if (thing && isFunctionData(thing.data)) {
 *   // thing.data is now typed as FunctionData
 *   console.log(thing.data.name, thing.data.type)
 * }
 * ```
 */
export function isFunctionData(data: unknown): data is FunctionData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// WORKFLOW INSTANCE DATA TYPE GUARD
// ============================================================================

/**
 * Type guard for WorkflowInstanceData
 *
 * Validates that an unknown value conforms to the WorkflowInstanceData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid WorkflowInstanceData
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(instanceId)
 * if (thing && isWorkflowInstanceData(thing.data)) {
 *   // thing.data is now typed as WorkflowInstanceData
 *   console.log(thing.data.templateId, thing.data.stateVerb)
 * }
 * ```
 */
export function isWorkflowInstanceData(data: unknown): data is WorkflowInstanceData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// WORKFLOW TEMPLATE DATA TYPE GUARD
// ============================================================================

/**
 * Type guard for WorkflowTemplateData
 *
 * Validates that an unknown value conforms to the WorkflowTemplateData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid WorkflowTemplateData
 */
export function isWorkflowTemplateData(data: unknown): data is WorkflowTemplateData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// WORKFLOW STEP DATA TYPE GUARD
// ============================================================================

/**
 * Valid workflow step types
 */
const WORKFLOW_STEP_TYPES: WorkflowStepType[] = ['action', 'decision', 'parallel', 'wait', 'human', 'subprocess']

/**
 * Type guard for WorkflowStepData
 *
 * Validates that an unknown value conforms to the WorkflowStepData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid WorkflowStepData
 */
export function isWorkflowStepData(data: unknown): data is WorkflowStepData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// STEP RESULT DATA TYPE GUARD
// ============================================================================

/**
 * Type guard for StepResultData
 *
 * Validates that an unknown value conforms to the StepResultData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid StepResultData
 */
export function isStepResultData(data: unknown): data is StepResultData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// SESSION THING DATA TYPE GUARD
// ============================================================================

/**
 * Type guard for SessionThingData
 *
 * Validates that an unknown value conforms to the SessionThingData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid SessionThingData
 */
export function isSessionThingData(data: unknown): data is SessionThingData {
  // TODO: Implement in GREEN phase
  return false
}

// ============================================================================
// USER THING DATA TYPE GUARD (re-export with enhanced validation)
// ============================================================================

/**
 * Type guard for UserThingData
 *
 * Validates that an unknown value conforms to the UserThingData interface.
 * Re-exported from humans/types with the same implementation for consistency.
 *
 * @param data - The value to check
 * @returns true if the value is valid UserThingData
 */
export function isUserThingData(data: unknown): data is UserThingData {
  // Re-use existing implementation from humans/types.ts
  // This is the existing implementation which checks email and status
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.email === 'string' && typeof d.status === 'string'
}
