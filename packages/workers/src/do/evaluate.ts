/**
 * evaluate - Run code with WorkflowContext ($)
 *
 * Executes code strings with access to the WorkflowContext,
 * enabling dynamic workflow definitions.
 *
 * @module @dotdo/workers/do
 */

import type { WorkflowContext } from './WorkflowContext'

/**
 * Options for evaluate function
 */
export interface EvaluateOptions {
  /** The WorkflowContext to expose as $ */
  context: WorkflowContext
  /** Additional variables to expose */
  globals?: Record<string, unknown>
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Result from evaluate function
 */
export interface EvaluateResult<T = unknown> {
  /** The result of the evaluation */
  value: T
  /** Duration in milliseconds */
  duration: number
  /** Any logs captured during execution */
  logs?: string[]
}

/**
 * Execute code with WorkflowContext ($) available
 *
 * @param code - The code string to evaluate
 * @param options - Evaluation options including context
 * @returns The result of the evaluation
 *
 * @example
 * ```typescript
 * const $ = createWorkflowContext({ stubResolver })
 * const result = await evaluate(`
 *   $.on.Customer.signup(async (event) => {
 *     console.log('New customer:', event.data.name)
 *   })
 *   return 'handlers registered'
 * `, { context: $ })
 * ```
 */
export async function evaluate<T = unknown>(
  _code: string,
  _options: EvaluateOptions
): Promise<EvaluateResult<T>> {
  throw new Error('evaluate not implemented yet')
}
