/**
 * Safety Policy Module for @dotdo/bashx
 *
 * Provides configurable policies for determining when commands should be blocked
 * based on their safety classification. Policies can be customized to fit
 * different use cases from permissive (development) to strict (production).
 *
 * @packageDocumentation
 */

import type { ImpactLevel } from '../types.js'

/**
 * Minimal classification info needed for policy decisions.
 * Allows policies to accept partial classification objects.
 */
export interface PolicyInput {
  impact: ImpactLevel
}

/**
 * A safety policy that determines blocking behavior based on command classification.
 *
 * Policies define which impact levels should be blocked and provide
 * user-facing messages explaining why a command was blocked.
 */
export interface SafetyPolicy {
  /** Human-readable policy name for identification */
  readonly name: string

  /**
   * Determine if a command should be blocked based on its classification.
   * @param classification - The safety classification (or partial with impact)
   * @returns true if the command should be blocked
   */
  shouldBlock(classification: PolicyInput): boolean

  /**
   * Get a human-readable message explaining why a command was blocked.
   * @param classification - The safety classification (or partial with impact)
   * @returns Message describing why the command is blocked
   */
  getMessage(classification: PolicyInput): string
}

/**
 * Default policy: blocks critical and high impact commands.
 *
 * Suitable for general use where dangerous operations should require
 * explicit confirmation but normal development commands are allowed.
 */
export const DEFAULT_POLICY: SafetyPolicy = {
  name: 'DEFAULT_POLICY',

  shouldBlock(classification: PolicyInput): boolean {
    return classification.impact === 'critical' || classification.impact === 'high'
  },

  getMessage(classification: PolicyInput): string {
    return `Command blocked: ${classification.impact} impact operations require confirmation`
  },
}

/**
 * Permissive policy: only blocks critical impact commands.
 *
 * Suitable for experienced users or development environments where
 * only the most dangerous operations (rm -rf /, dd to device) are blocked.
 */
export const PERMISSIVE_POLICY: SafetyPolicy = {
  name: 'PERMISSIVE_POLICY',

  shouldBlock(classification: PolicyInput): boolean {
    return classification.impact === 'critical'
  },

  getMessage(classification: PolicyInput): string {
    return `Command blocked: ${classification.impact} impact operations are not allowed`
  },
}

/**
 * Strict policy: blocks medium, high, and critical impact commands.
 *
 * Suitable for production environments or untrusted contexts where
 * any potentially harmful operation should be blocked by default.
 */
export const STRICT_POLICY: SafetyPolicy = {
  name: 'STRICT_POLICY',

  shouldBlock(classification: PolicyInput): boolean {
    return (
      classification.impact === 'critical' ||
      classification.impact === 'high' ||
      classification.impact === 'medium'
    )
  },

  getMessage(classification: PolicyInput): string {
    return `Command blocked: ${classification.impact} impact operations require approval in strict mode`
  },
}
