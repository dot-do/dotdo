/**
 * Error Classes Module
 *
 * Standard error types for workflow failures.
 */

// ============================================================================
// APPLICATION FAILURE
// ============================================================================

/**
 * Application-level failure that can be thrown from workflows or activities.
 * Use this to signal business logic failures vs infrastructure errors.
 *
 * @example
 * ```typescript
 * import { ApplicationFailure } from '@dotdo/temporal'
 *
 * if (!user.hasPermission('admin')) {
 *   throw new ApplicationFailure('User does not have admin permission', true)
 * }
 * ```
 */
export class ApplicationFailure extends Error {
  readonly type = 'ApplicationFailure' as const

  constructor(
    message: string,
    readonly nonRetryable: boolean = false,
    readonly details?: unknown[]
  ) {
    super(message)
    this.name = 'ApplicationFailure'
  }

  /**
   * Create a non-retryable application failure
   */
  static nonRetryable(message: string, ...details: unknown[]): ApplicationFailure {
    return new ApplicationFailure(message, true, details.length > 0 ? details : undefined)
  }

  /**
   * Create a retryable application failure
   */
  static retryable(message: string, ...details: unknown[]): ApplicationFailure {
    return new ApplicationFailure(message, false, details.length > 0 ? details : undefined)
  }
}

// ============================================================================
// ACTIVITY FAILURE
// ============================================================================

/**
 * Failure thrown when an activity execution fails.
 * Contains information about the failed activity and the underlying cause.
 *
 * @example
 * ```typescript
 * try {
 *   await activities.processPayment(order)
 * } catch (error) {
 *   if (error instanceof ActivityFailure) {
 *     console.log(`Activity ${error.activityType} failed: ${error.cause?.message}`)
 *   }
 * }
 * ```
 */
export class ActivityFailure extends Error {
  readonly type = 'ActivityFailure' as const

  constructor(
    readonly activityType: string,
    readonly activityId: string,
    readonly cause?: Error
  ) {
    super(`Activity ${activityType} (${activityId}) failed${cause ? `: ${cause.message}` : ''}`)
    this.name = 'ActivityFailure'
  }
}

// ============================================================================
// CHILD WORKFLOW FAILURE
// ============================================================================

/**
 * Failure thrown when a child workflow execution fails.
 * Contains information about the failed child workflow and the underlying cause.
 *
 * @example
 * ```typescript
 * try {
 *   await executeChild(childWorkflow, { workflowId: 'child-1' })
 * } catch (error) {
 *   if (error instanceof ChildWorkflowFailure) {
 *     console.log(`Child workflow ${error.workflowType} failed: ${error.cause?.message}`)
 *   }
 * }
 * ```
 */
export class ChildWorkflowFailure extends Error {
  readonly type = 'ChildWorkflowFailure' as const

  constructor(
    readonly workflowType: string,
    readonly workflowId: string,
    readonly cause?: Error
  ) {
    super(`Child workflow ${workflowType} (${workflowId}) failed${cause ? `: ${cause.message}` : ''}`)
    this.name = 'ChildWorkflowFailure'
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if an error is an ApplicationFailure
 */
export function isApplicationFailure(error: unknown): error is ApplicationFailure {
  return error instanceof ApplicationFailure
}

/**
 * Check if an error is an ActivityFailure
 */
export function isActivityFailure(error: unknown): error is ActivityFailure {
  return error instanceof ActivityFailure
}

/**
 * Check if an error is a ChildWorkflowFailure
 */
export function isChildWorkflowFailure(error: unknown): error is ChildWorkflowFailure {
  return error instanceof ChildWorkflowFailure
}
