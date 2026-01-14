/**
 * applyGate Pipeline Stage
 *
 * Safety gate pipeline stage that decides whether to block command execution
 * based on safety classification and confirmation state.
 *
 * This stage is independently callable and provides a clean interface for
 * safety gating that can be used standalone or as part of a larger pipeline.
 *
 * @packageDocumentation
 */

import type { SafetyClassification } from '../../../core/types.js'

/**
 * Input for the applyGate stage.
 */
export interface GateInput {
  /**
   * The safety classification of the command to evaluate.
   */
  classification: SafetyClassification

  /**
   * Whether the user has confirmed they want to proceed with a dangerous operation.
   */
  confirm: boolean
}

/**
 * Result from the applyGate stage.
 */
export interface GateResult {
  /**
   * Whether the command execution is blocked.
   * - true: Command should not be executed
   * - false: Command may proceed (possibly with a warning)
   */
  blocked: boolean

  /**
   * Whether confirmation is required/recommended before execution.
   * - true: User should confirm before proceeding
   * - false: No confirmation needed
   */
  requiresConfirm: boolean

  /**
   * Explanation of why the command was blocked.
   * Only present when blocked is true.
   */
  blockReason?: string

  /**
   * Suggested safer alternative command or approach.
   * Passed through from the classification if available.
   */
  suggestion?: string
}

/**
 * Apply safety gate logic to determine if a command should be blocked.
 *
 * This is a pipeline stage that evaluates a safety classification and determines
 * whether execution should proceed. The gate logic is:
 *
 * - Critical impact + no confirm: blocked=true, requiresConfirm=true
 * - Critical impact + confirm: blocked=false, requiresConfirm=false
 * - High impact + no confirm: blocked=false, requiresConfirm=true
 * - High impact + confirm: blocked=false, requiresConfirm=false
 * - Medium/low/none impact: blocked=false, requiresConfirm=false
 *
 * @param input - The gate input containing classification and confirmation state
 * @returns Gate result indicating whether to block and if confirmation is needed
 *
 * @example
 * ```typescript
 * // Critical command without confirmation - blocked
 * const result = applyGate({
 *   classification: { type: 'delete', impact: 'critical', reversible: false, reason: 'rm -rf /' },
 *   confirm: false
 * })
 * // { blocked: true, requiresConfirm: true, blockReason: '...' }
 *
 * // High impact command - warn but don't block
 * const result = applyGate({
 *   classification: { type: 'write', impact: 'high', reversible: true, reason: 'System mod' },
 *   confirm: false
 * })
 * // { blocked: false, requiresConfirm: true }
 *
 * // Low impact command - allow
 * const result = applyGate({
 *   classification: { type: 'read', impact: 'low', reversible: true, reason: 'Read file' },
 *   confirm: false
 * })
 * // { blocked: false, requiresConfirm: false }
 * ```
 */
export function applyGate(input: GateInput): GateResult {
  const { classification, confirm } = input
  const { impact, reason } = classification

  // Critical impact handling
  if (impact === 'critical') {
    if (confirm) {
      // User has confirmed - allow execution
      return {
        blocked: false,
        requiresConfirm: false,
        suggestion: classification.suggestion,
      }
    }

    // Not confirmed - block and require confirmation
    return {
      blocked: true,
      requiresConfirm: true,
      blockReason: `Dangerous operation blocked: ${reason}`,
      suggestion: classification.suggestion,
    }
  }

  // High impact handling
  if (impact === 'high') {
    if (confirm) {
      // User has confirmed - allow without warning
      return {
        blocked: false,
        requiresConfirm: false,
        suggestion: classification.suggestion,
      }
    }

    // Not confirmed - warn but don't block
    return {
      blocked: false,
      requiresConfirm: true,
      suggestion: classification.suggestion,
    }
  }

  // Medium, low, or none impact - allow without confirmation
  return {
    blocked: false,
    requiresConfirm: false,
  }
}
