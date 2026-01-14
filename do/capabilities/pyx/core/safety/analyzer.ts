/**
 * Python code safety analyzer
 *
 * Analyzes Python code for potentially dangerous operations using
 * regex-based pattern matching.
 */

import type { SafetyReport, SafetyViolation } from './types'
import { allRules, type SafetyRule } from './rules'

/**
 * Get the line number for a match position in the code
 */
function getLineNumber(code: string, index: number): number {
  const lines = code.substring(0, index).split('\n')
  return lines.length
}

/**
 * Apply a single rule to the code
 */
function applyRule(code: string, rule: SafetyRule): SafetyViolation[] {
  const violations: SafetyViolation[] = []

  for (const pattern of rule.patterns) {
    const matches = code.matchAll(new RegExp(pattern, 'g'))

    for (const match of matches) {
      // Check if this rule should be skipped
      if (rule.skipIf && rule.skipIf(code, match)) {
        continue
      }

      violations.push({
        type: rule.type,
        message: rule.getMessage(match),
        line: match.index !== undefined ? getLineNumber(code, match.index) : undefined,
        severity: rule.severity,
      })
    }
  }

  return violations
}

/**
 * Analyze Python code for safety violations
 *
 * @param code - Python source code to analyze
 * @returns SafetyReport with violations found
 */
export function analyze(code: string): SafetyReport {
  const violations: SafetyViolation[] = []

  for (const rule of allRules) {
    const ruleViolations = applyRule(code, rule)
    violations.push(...ruleViolations)
  }

  return {
    safe: violations.length === 0,
    violations,
  }
}
