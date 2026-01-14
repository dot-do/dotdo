/**
 * Workflow Primitives - Activity Definitions and Execution
 */

import type { ActivityDefinition, ActivityHandler, ActivityOptions, ActivityContext, RetryPolicy } from './types'
import { parseDuration } from './timer'

// Global activity registry
const activityRegistry = new Map<string, ActivityDefinition>()

/**
 * Define an activity
 */
export function defineActivity<T, R>(
  name: string,
  handler: ActivityHandler<T, R>
): ActivityDefinition<T, R> {
  const definition: ActivityDefinition<T, R> = {
    name,
    handler,
  }
  activityRegistry.set(name, definition as ActivityDefinition)
  return definition
}

/**
 * Get an activity from the registry
 */
export function getActivity(name: string): ActivityDefinition | undefined {
  return activityRegistry.get(name)
}

/**
 * Clear the activity registry (for testing)
 */
export function clearActivities(): void {
  activityRegistry.clear()
}

/**
 * Execute an activity with retry policy
 */
export async function executeActivity<T, R>(
  name: string,
  options: ActivityOptions<T>
): Promise<R> {
  const activity = activityRegistry.get(name)
  if (!activity) {
    throw new Error(`Activity not found: ${name}`)
  }

  const retryPolicy: RetryPolicy = options.retry || { maxAttempts: 1 }
  const maxAttempts = retryPolicy.maxAttempts || 1
  const initialInterval = retryPolicy.initialInterval
    ? parseDuration(retryPolicy.initialInterval)
    : 100
  const backoffCoefficient = retryPolicy.backoffCoefficient || 2
  const maxInterval = retryPolicy.maxInterval
    ? parseDuration(retryPolicy.maxInterval)
    : 60000

  let lastError: Error | undefined
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt++

    try {
      // Create activity context for heartbeat support
      const activityCtx: ActivityContext = {
        async heartbeat(_details?: unknown): Promise<void> {
          // In a real implementation, this would record heartbeat
        },
      }

      // Determine how to call the handler:
      // - If input is undefined, pass context as first arg
      // - Otherwise pass input as first arg
      const callHandler = () => {
        if (options.input === undefined) {
          return activity.handler(activityCtx) as Promise<R>
        }
        return activity.handler(options.input, activityCtx) as Promise<R>
      }

      // Wrap execution with timeout if specified
      if (options.timeout) {
        const timeoutMs = parseDuration(options.timeout)
        const result = await Promise.race([
          callHandler(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Activity timeout')), timeoutMs)
          }),
        ])
        return result
      }

      return await callHandler()
    } catch (error) {
      lastError = error as Error

      if (attempt < maxAttempts) {
        // Calculate backoff delay
        let delay = initialInterval * Math.pow(backoffCoefficient, attempt - 1)
        delay = Math.min(delay, maxInterval)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}
