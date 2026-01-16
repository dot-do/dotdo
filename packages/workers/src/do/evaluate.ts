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
  code: string,
  options: EvaluateOptions
): Promise<EvaluateResult<T>> {
  const { context, globals = {}, timeout } = options

  const startTime = performance.now()

  // Build the function arguments
  const argNames = ['$', ...Object.keys(globals)]
  const argValues = [context, ...Object.values(globals)]

  // Wrap code in async function
  const wrappedCode = `
    return (async function() {
      ${code}
    })()
  `

  // Create the function
  const fn = new Function(...argNames, wrappedCode)

  // Execute with optional timeout
  let value: T
  if (timeout) {
    const result = await Promise.race([
      fn(...argValues) as Promise<T>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Evaluation timeout')), timeout)
      ),
    ])
    value = result
  } else {
    value = await fn(...argValues)
  }

  const duration = performance.now() - startTime

  return {
    value,
    duration,
  }
}
