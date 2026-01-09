/**
 * Stop Conditions - Agent loop termination logic
 *
 * Stop conditions determine when an agent should stop its execution loop.
 * They're evaluated after each step and can be combined (any match = stop).
 *
 * @module agents/stopConditions
 */

import type { StopCondition, StepState } from './types'

// ============================================================================
// Stop Condition Factories
// ============================================================================

/**
 * Stop after a specific number of steps
 *
 * @param count - Maximum number of steps before stopping
 * @returns Stop condition that triggers when stepNumber >= count
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   stopWhen: stepCountIs(5), // Stop after 5 steps max
 * })
 * ```
 */
export function stepCountIs(count: number): StopCondition {
  return { type: 'stepCount', count }
}

/**
 * Stop when a specific tool is called
 *
 * Useful for agents that should stop when they call a "finish" or "submit" tool.
 *
 * @param toolName - Name of the tool that triggers stop
 * @returns Stop condition that triggers when the tool is called
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   stopWhen: hasToolCall('submit_answer'),
 * })
 * ```
 */
export function hasToolCall(toolName: string): StopCondition {
  return { type: 'hasToolCall', toolName }
}

/**
 * Stop when the agent produces text output
 *
 * Useful for chat agents that should stop after generating a response.
 *
 * @returns Stop condition that triggers when non-empty text is produced
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   stopWhen: hasText(),
 * })
 * ```
 */
export function hasText(): StopCondition {
  return { type: 'hasText' }
}

/**
 * Stop based on custom logic
 *
 * Provides full access to step state for complex termination conditions.
 *
 * @param check - Function that returns true when agent should stop
 * @returns Stop condition with custom evaluation logic
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   stopWhen: customStop((state) => {
 *     // Stop if we've used too many tokens
 *     return state.totalTokens > 10000
 *   }),
 * })
 * ```
 */
export function customStop(check: (state: StepState) => boolean): StopCondition {
  return { type: 'custom', check }
}

// ============================================================================
// Stop Condition Evaluation
// ============================================================================

/**
 * Evaluate stop conditions against current state
 *
 * @param conditions - Single condition or array of conditions (OR logic)
 * @param state - Current step state to evaluate against
 * @returns True if any condition is satisfied
 *
 * @example
 * ```ts
 * // Single condition
 * shouldStop(stepCountIs(5), state)
 *
 * // Multiple conditions (stops if ANY matches)
 * shouldStop([stepCountIs(10), hasToolCall('done')], state)
 * ```
 */
export function shouldStop(
  conditions: StopCondition | StopCondition[],
  state: StepState
): boolean {
  const conditionArray = Array.isArray(conditions) ? conditions : [conditions]

  return conditionArray.some((condition) => evaluateCondition(condition, state))
}

/**
 * Evaluate a single stop condition
 */
function evaluateCondition(condition: StopCondition, state: StepState): boolean {
  switch (condition.type) {
    case 'stepCount':
      return state.stepNumber >= condition.count

    case 'hasToolCall':
      return state.lastStep.toolCalls?.some((tc) => tc.name === condition.toolName) ?? false

    case 'hasText':
      return !!state.lastStep.text && state.lastStep.text.length > 0

    case 'custom':
      return condition.check(state)

    default:
      // Unknown condition type - don't stop
      return false
  }
}

// ============================================================================
// Composite Stop Conditions
// ============================================================================

/**
 * Combine multiple conditions with AND logic
 *
 * All conditions must be true for the agent to stop.
 *
 * @param conditions - Conditions that must ALL be satisfied
 * @returns Composite stop condition
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   // Stop only when we have text AND we've done at least 2 steps
 *   stopWhen: all(hasText(), stepCountIs(2)),
 * })
 * ```
 */
export function all(...conditions: StopCondition[]): StopCondition {
  return {
    type: 'custom',
    check: (state) => conditions.every((c) => evaluateCondition(c, state)),
  }
}

/**
 * Combine multiple conditions with OR logic
 *
 * Stop if ANY condition is satisfied.
 *
 * @param conditions - Conditions where ANY can trigger stop
 * @returns Composite stop condition
 *
 * @example
 * ```ts
 * const agent = provider.createAgent({
 *   // Stop on finish tool OR after 10 steps
 *   stopWhen: any(hasToolCall('finish'), stepCountIs(10)),
 * })
 * ```
 */
export function any(...conditions: StopCondition[]): StopCondition {
  return {
    type: 'custom',
    check: (state) => conditions.some((c) => evaluateCondition(c, state)),
  }
}

/**
 * Negate a stop condition
 *
 * @param condition - Condition to negate
 * @returns Stop condition that triggers when original condition is NOT met
 *
 * @example
 * ```ts
 * // Stop when there's NO text (useful for tool-only agents)
 * stopWhen: not(hasText())
 * ```
 */
export function not(condition: StopCondition): StopCondition {
  return {
    type: 'custom',
    check: (state) => !evaluateCondition(condition, state),
  }
}
