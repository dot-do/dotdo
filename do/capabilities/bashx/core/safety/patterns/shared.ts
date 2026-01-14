/**
 * Shared Safety Pattern Infrastructure
 *
 * Common utilities for language-specific safety pattern detection.
 * This module provides the foundation for Python, Ruby, Node.js, and
 * future language pattern analyzers.
 *
 * Exports:
 * - ImpactLevel type - Impact levels from low to critical
 * - IMPACT_ORDER constant - Impact levels in ascending order
 * - DetectedPattern interface - A matched pattern with metadata
 * - PatternDefinition interface - Pattern definition with regex and impact
 * - detectPatterns() - Helper to detect patterns in code
 * - compareImpact() - Compare two impact levels
 * - getHighestImpact() - Get highest impact from patterns
 * - buildReasonString() - Build human-readable reason string
 *
 * @packageDocumentation
 */

/**
 * Impact level type for safety classification.
 * Ordered from lowest to highest severity.
 */
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'

/**
 * Impact level ordering from lowest to highest severity.
 * Used for comparing and determining maximum impact.
 */
export const IMPACT_ORDER: readonly ImpactLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const

/**
 * A detected safety pattern in source code.
 * Represents a matched pattern with its type, impact, and optional match string.
 */
export interface DetectedPattern {
  /** Pattern type identifier (e.g., 'eval', 'system', 'pickle') */
  type: string
  /** Impact level of the pattern */
  impact: ImpactLevel
  /** The matched code snippet (optional) */
  match?: string
}

/**
 * Pattern definition for safety analysis.
 * Defines what to look for and how dangerous it is.
 */
export interface PatternDefinition {
  /** Pattern type identifier */
  type: string
  /** Regex pattern to match */
  pattern: RegExp
  /** Impact level when matched */
  impact: ImpactLevel
}

/**
 * Compares two impact levels.
 *
 * @param a - First impact level
 * @param b - Second impact level
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @example
 * ```typescript
 * compareImpact('low', 'high') // returns negative number
 * compareImpact('critical', 'low') // returns positive number
 * compareImpact('medium', 'medium') // returns 0
 * ```
 */
export function compareImpact(a: ImpactLevel, b: ImpactLevel): number {
  return IMPACT_ORDER.indexOf(a) - IMPACT_ORDER.indexOf(b)
}

/**
 * Gets the highest impact level from an array of detected patterns.
 *
 * @param patterns - Array of detected patterns
 * @returns The highest impact level, or 'low' if no patterns
 *
 * @example
 * ```typescript
 * const patterns = [
 *   { type: 'eval', impact: 'critical' },
 *   { type: 'read', impact: 'low' }
 * ]
 * getHighestImpact(patterns) // returns 'critical'
 * ```
 */
export function getHighestImpact(patterns: DetectedPattern[]): ImpactLevel {
  if (patterns.length === 0) {
    return 'low'
  }

  return patterns.reduce<ImpactLevel>((max, p) => {
    return compareImpact(p.impact, max) > 0 ? p.impact : max
  }, 'low')
}

/**
 * Detects patterns in source code using the provided pattern definitions.
 *
 * @param code - Source code to analyze
 * @param patterns - Array of pattern definitions to check
 * @returns Array of detected patterns with match information
 *
 * @example
 * ```typescript
 * const patterns = [
 *   { type: 'eval', pattern: /\beval\s*\(/, impact: 'critical' }
 * ]
 * const result = detectPatterns('eval(code)', patterns)
 * // Returns: [{ type: 'eval', impact: 'critical', match: 'eval(' }]
 * ```
 */
export function detectPatterns(
  code: string,
  patterns: PatternDefinition[]
): DetectedPattern[] {
  const detected: DetectedPattern[] = []

  for (const def of patterns) {
    const matchResult = def.pattern.exec(code)
    if (matchResult) {
      detected.push({
        type: def.type,
        impact: def.impact,
        match: matchResult[0],
      })
    }
  }

  return detected
}

/**
 * Builds a human-readable reason string from detected patterns.
 *
 * @param patterns - Array of detected patterns
 * @returns Human-readable description of detected patterns
 *
 * @example
 * ```typescript
 * buildReasonString([]) // returns 'No dangerous patterns detected'
 * buildReasonString([{ type: 'eval', impact: 'critical' }])
 * // returns 'Detected eval pattern'
 * buildReasonString([{ type: 'eval', impact: 'critical' }, { type: 'exec', impact: 'critical' }])
 * // returns 'Detected patterns: eval, exec'
 * ```
 */
export function buildReasonString(patterns: DetectedPattern[]): string {
  if (patterns.length === 0) {
    return 'No dangerous patterns detected'
  }

  const patternNames = patterns.map((p) => p.type)
  const uniqueNames = [...new Set(patternNames)]

  if (uniqueNames.length === 1) {
    return `Detected ${uniqueNames[0]} pattern`
  }

  return `Detected patterns: ${uniqueNames.join(', ')}`
}
