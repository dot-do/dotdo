/**
 * Workflow - Define durable workflows with magic syntax
 *
 * Provides a DSL for defining workflows that:
 * - Use proxy-based domain resolution ($.Noun(id).verb())
 * - Support conditional execution ($.when)
 * - Enable batch processing via magic map
 */

import type { WorkflowContext } from '../types/WorkflowContext'

/**
 * Workflow definition result
 */
export interface WorkflowDefinition<TInput, TOutput> {
  name: string
  execute: (context: WorkflowContext, input: TInput) => TOutput
}

/**
 * Extended workflow context with additional helpers
 */
export interface ExtendedWorkflowContext extends WorkflowContext {
  /**
   * Conditional execution
   */
  when<T, F>(
    condition: unknown,
    branches: {
      then: () => T
      else: () => F
    },
  ): T | F
}

/**
 * Define a workflow
 *
 * @example
 * ```typescript
 * const MyWorkflow = Workflow('my-workflow', ($, input: MyInput) => {
 *   const result = $.Service(input.id).doSomething()
 *   $.when(result.success, {
 *     then: () => $.Notification.send({ message: 'Success!' }),
 *     else: () => $.Alert.trigger({ error: result.error })
 *   })
 *   return { processed: true }
 * })
 * ```
 */
export function Workflow<TInput, TOutput>(
  name: string,
  definition: ($: ExtendedWorkflowContext, input: TInput) => TOutput,
): WorkflowDefinition<TInput, TOutput> {
  return {
    name,
    execute: (context: WorkflowContext, input: TInput) => {
      // Extend context with workflow helpers
      const extendedContext = createExtendedContext(context)
      return definition(extendedContext, input)
    },
  }
}

/**
 * Create extended workflow context with helpers
 */
function createExtendedContext(baseContext: WorkflowContext): ExtendedWorkflowContext {
  return new Proxy(baseContext as ExtendedWorkflowContext, {
    get(target, prop: string) {
      if (prop === 'when') {
        return <T, F>(condition: unknown, branches: { then: () => T; else: () => F }): T | F => {
          // In real implementation, this would be recorded and replayed
          // For now, just evaluate synchronously
          return condition ? branches.then() : branches.else()
        }
      }

      // Delegate to base context
      return (target as Record<string, unknown>)[prop]
    },
  })
}

export default Workflow
