/**
 * PipelineExecutor - Server-side pipeline resolution
 *
 * Executes a series of property accesses and method calls against a target object,
 * enabling Cap'n Web-style promise pipelining.
 *
 * @see do-l21: RED: PipelineExecutor tests (server-side)
 * @see do-c6g: GREEN: Implement PipelineExecutor (implementation pending)
 */

/**
 * Pipeline step - either property access or method call
 */
export interface PropertyStep {
  type: 'property'
  name: string
}

export interface MethodStep {
  type: 'method'
  name: string
  args: unknown[]
}

export type ExecutorPipelineStep = PropertyStep | MethodStep

/**
 * PipelineExecutor - Resolves pipelines on the server side
 *
 * Given a target object and a sequence of steps, executes each step
 * to traverse properties and call methods.
 *
 * @example
 * ```typescript
 * const executor = new PipelineExecutor()
 * const result = await executor.execute(
 *   { profile: { email: 'alice@example.com' } },
 *   [
 *     { type: 'property', name: 'profile' },
 *     { type: 'property', name: 'email' }
 *   ]
 * )
 * // Returns: 'alice@example.com'
 * ```
 */
export class PipelineExecutor {
  /**
   * Execute a pipeline against a target object
   *
   * @param target - The object to execute the pipeline against
   * @param pipeline - Array of steps to execute
   * @returns The result of executing all steps
   */
  async execute(target: unknown, pipeline: ExecutorPipelineStep[]): Promise<unknown> {
    let current: unknown = target

    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i]

      // Check for null/undefined before accessing properties or calling methods
      if (current === null || current === undefined) {
        const valueType = current === null ? 'null' : 'undefined'
        throw new Error(
          `Cannot read property '${step.name}' of ${valueType} at step ${i}`
        )
      }

      if (step.type === 'property') {
        // Property access - just read the property
        current = (current as Record<string, unknown>)[step.name]
        // Auto-await if the result is a Promise
        if (current instanceof Promise) {
          current = await current
        }
      } else if (step.type === 'method') {
        // Method call - verify it's callable then invoke
        const method = (current as Record<string, unknown>)[step.name]

        if (typeof method !== 'function') {
          throw new Error(
            `'${step.name}' is not a function at step ${i}`
          )
        }

        // Call the method with proper this context
        current = method.apply(current, step.args)

        // Auto-await if the result is a Promise
        if (current instanceof Promise) {
          current = await current
        }
      }
    }

    return current
  }
}
