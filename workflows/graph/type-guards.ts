/**
 * Type Guards for Workflow Graph Adapters
 *
 * This module provides runtime type guards to replace unsafe 'as unknown as T'
 * casts in workflow adapters (instance-thing.ts, step-execution-store.ts).
 *
 * These type guards enable safe type narrowing without runtime type safety gaps.
 *
 * @see dotdo-ziocd - [RED] Replace unsafe as unknown as T in workflow adapters
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * WorkflowInstance data structure (without state - state is in relationships).
 * This mirrors the interface in instance-thing.ts.
 */
export interface WorkflowInstanceDataForStore {
  workflowId: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  currentStep?: string | number
  error?: string
}

/**
 * Step execution relationship data.
 * This mirrors the interface in step-execution-store.ts.
 */
export interface StepExecutionData {
  /** Name of the step being executed */
  stepName: string
  /** Index of the step in the workflow (0-based) */
  stepIndex: number
  /** Duration in milliseconds (only for completed/failed steps) */
  duration?: number
  /** Error message (only for failed steps) */
  error?: string
  /** Timestamp when step started */
  startedAt?: number
  /** Timestamp when step completed */
  completedAt?: number
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Error thrown when WorkflowInstanceDataForStore validation fails.
 */
export class WorkflowInstanceDataForStoreValidationError extends Error {
  public readonly invalidData?: unknown

  constructor(message: string, invalidData?: unknown) {
    super(message)
    this.name = 'WorkflowInstanceDataForStoreValidationError'
    this.invalidData = invalidData
    // Maintain proper prototype chain for instanceof
    Object.setPrototypeOf(this, WorkflowInstanceDataForStoreValidationError.prototype)
  }
}

/**
 * Error thrown when StepExecutionData validation fails.
 */
export class StepExecutionDataValidationError extends Error {
  public readonly invalidData?: unknown

  constructor(message: string, invalidData?: unknown) {
    super(message)
    this.name = 'StepExecutionDataValidationError'
    this.invalidData = invalidData
    // Maintain proper prototype chain for instanceof
    Object.setPrototypeOf(this, StepExecutionDataValidationError.prototype)
  }
}

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
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for WorkflowInstanceDataForStore
 *
 * Validates that an unknown value conforms to the WorkflowInstanceDataForStore interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid WorkflowInstanceDataForStore
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(id)
 * if (thing && isWorkflowInstanceDataForStore(thing.data)) {
 *   // thing.data is now typed as WorkflowInstanceDataForStore
 *   console.log(thing.data.workflowId, thing.data.input)
 * }
 * ```
 */
export function isWorkflowInstanceDataForStore(data: unknown): data is WorkflowInstanceDataForStore {
  if (!isObject(data)) {
    return false
  }

  // Required: workflowId must be a string
  if (typeof data.workflowId !== 'string') {
    return false
  }

  // Required: input must be a non-null object (not an array)
  if (!isObject(data.input)) {
    return false
  }

  // Optional: output must be a non-null object (not an array) if present
  if (data.output !== undefined && !isObject(data.output)) {
    return false
  }

  // Optional: currentStep must be a string or number if present
  if (data.currentStep !== undefined &&
      typeof data.currentStep !== 'string' &&
      typeof data.currentStep !== 'number') {
    return false
  }

  // Optional: error must be a string if present
  if (data.error !== undefined && typeof data.error !== 'string') {
    return false
  }

  return true
}

/**
 * Type guard for StepExecutionData
 *
 * Validates that an unknown value conforms to the StepExecutionData interface.
 *
 * @param data - The value to check
 * @returns true if the value is valid StepExecutionData
 *
 * @example
 * ```typescript
 * const rel = await store.getRelationship(id)
 * if (rel && isStepExecutionData(rel.data)) {
 *   // rel.data is now typed as StepExecutionData
 *   console.log(rel.data.stepName, rel.data.stepIndex)
 * }
 * ```
 */
export function isStepExecutionData(data: unknown): data is StepExecutionData {
  if (!isObject(data)) {
    return false
  }

  // Required: stepName must be a string
  if (typeof data.stepName !== 'string') {
    return false
  }

  // Required: stepIndex must be a non-negative number (not NaN)
  if (typeof data.stepIndex !== 'number' ||
      Number.isNaN(data.stepIndex) ||
      data.stepIndex < 0) {
    return false
  }

  // Optional: duration must be a non-negative number if present
  if (data.duration !== undefined &&
      (typeof data.duration !== 'number' || data.duration < 0)) {
    return false
  }

  // Optional: error must be a string if present
  if (data.error !== undefined && typeof data.error !== 'string') {
    return false
  }

  // Optional: startedAt must be a number if present
  if (data.startedAt !== undefined && typeof data.startedAt !== 'number') {
    return false
  }

  // Optional: completedAt must be a number if present
  if (data.completedAt !== undefined && typeof data.completedAt !== 'number') {
    return false
  }

  return true
}

// ============================================================================
// ASSERTION FUNCTIONS
// ============================================================================

/**
 * Asserts that data is valid WorkflowInstanceDataForStore, throwing if not.
 *
 * @param data - The value to validate
 * @returns The validated data, typed as WorkflowInstanceDataForStore
 * @throws WorkflowInstanceDataForStoreValidationError if validation fails
 *
 * @example
 * ```typescript
 * const thing = await store.getThing(id)
 * const data = assertWorkflowInstanceDataForStore(thing.data)
 * // data is now typed as WorkflowInstanceDataForStore
 * ```
 */
export function assertWorkflowInstanceDataForStore(data: unknown): WorkflowInstanceDataForStore {
  if (!isObject(data)) {
    throw new WorkflowInstanceDataForStoreValidationError(
      'Data must be a non-null object',
      data
    )
  }

  if (typeof data.workflowId !== 'string') {
    throw new WorkflowInstanceDataForStoreValidationError(
      'workflowId is required and must be a string',
      data
    )
  }

  if (!isObject(data.input)) {
    throw new WorkflowInstanceDataForStoreValidationError(
      'input is required and must be a non-null object',
      data
    )
  }

  if (data.output !== undefined && !isObject(data.output)) {
    throw new WorkflowInstanceDataForStoreValidationError(
      'output must be a non-null object if present',
      data
    )
  }

  if (data.currentStep !== undefined &&
      typeof data.currentStep !== 'string' &&
      typeof data.currentStep !== 'number') {
    throw new WorkflowInstanceDataForStoreValidationError(
      'currentStep must be a string or number if present',
      data
    )
  }

  if (data.error !== undefined && typeof data.error !== 'string') {
    throw new WorkflowInstanceDataForStoreValidationError(
      'error must be a string if present',
      data
    )
  }

  return data as WorkflowInstanceDataForStore
}

/**
 * Asserts that data is valid StepExecutionData, throwing if not.
 *
 * @param data - The value to validate
 * @returns The validated data, typed as StepExecutionData
 * @throws StepExecutionDataValidationError if validation fails
 *
 * @example
 * ```typescript
 * const rel = await store.getRelationship(id)
 * const data = assertStepExecutionData(rel.data)
 * // data is now typed as StepExecutionData
 * ```
 */
export function assertStepExecutionData(data: unknown): StepExecutionData {
  if (!isObject(data)) {
    throw new StepExecutionDataValidationError(
      'Data must be a non-null object',
      data
    )
  }

  if (typeof data.stepName !== 'string') {
    throw new StepExecutionDataValidationError(
      'stepName is required and must be a string',
      data
    )
  }

  if (typeof data.stepIndex !== 'number') {
    throw new StepExecutionDataValidationError(
      'stepIndex is required and must be a number',
      data
    )
  }

  if (Number.isNaN(data.stepIndex)) {
    throw new StepExecutionDataValidationError(
      'stepIndex must not be NaN',
      data
    )
  }

  if (data.stepIndex < 0) {
    throw new StepExecutionDataValidationError(
      'stepIndex must be non-negative',
      data
    )
  }

  if (data.duration !== undefined && (typeof data.duration !== 'number' || data.duration < 0)) {
    throw new StepExecutionDataValidationError(
      'duration must be a non-negative number if present',
      data
    )
  }

  if (data.error !== undefined && typeof data.error !== 'string') {
    throw new StepExecutionDataValidationError(
      'error must be a string if present',
      data
    )
  }

  if (data.startedAt !== undefined && typeof data.startedAt !== 'number') {
    throw new StepExecutionDataValidationError(
      'startedAt must be a number if present',
      data
    )
  }

  if (data.completedAt !== undefined && typeof data.completedAt !== 'number') {
    throw new StepExecutionDataValidationError(
      'completedAt must be a number if present',
      data
    )
  }

  return data as StepExecutionData
}
