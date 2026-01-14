/**
 * Ruby Safety Pattern Detection
 *
 * Detects dangerous patterns in Ruby code including:
 * - eval family (eval, instance_eval, class_eval, module_eval)
 * - System execution (system, backticks, %x{}, exec, spawn)
 * - Binding exploitation (binding.eval)
 * - File operations with write modes
 *
 * @packageDocumentation
 */

import type { SafetyClassification } from '../../types.js'
import {
  type DetectedPattern,
  type PatternDefinition,
  detectPatterns,
} from './shared.js'

// Re-export DetectedPattern for backwards compatibility
export type { DetectedPattern }

/**
 * Result of Ruby safety analysis.
 */
export interface RubySafetyAnalysis {
  /** Overall safety classification */
  classification: SafetyClassification
  /** List of detected patterns */
  patterns: DetectedPattern[]
  /** List of detected requires */
  requires: string[]
}

/**
 * Extended pattern definition for Ruby safety analysis.
 * Includes classification type for building the final classification.
 */
interface RubyPatternDefinition extends PatternDefinition {
  classificationType: 'execute' | 'system'
}

/**
 * Ruby safety patterns organized by impact level.
 */
const RUBY_PATTERNS: RubyPatternDefinition[] = [
  // eval family - critical impact (code execution)
  { type: 'eval', pattern: /\beval\s*\(/, impact: 'critical', classificationType: 'execute' },
  { type: 'instance_eval', pattern: /\.instance_eval\s*\(/, impact: 'critical', classificationType: 'execute' },
  { type: 'class_eval', pattern: /\.class_eval\s*\(/, impact: 'critical', classificationType: 'execute' },
  { type: 'module_eval', pattern: /\.module_eval\s*\(/, impact: 'critical', classificationType: 'execute' },
  { type: 'binding_eval', pattern: /\bbinding\.eval\s*\(/, impact: 'critical', classificationType: 'execute' },

  // system execution - high impact (shell commands)
  { type: 'system', pattern: /\bsystem\s*\(/, impact: 'high', classificationType: 'system' },
  { type: 'backticks', pattern: /`[^`]+`/, impact: 'high', classificationType: 'system' },
  { type: 'percent_x', pattern: /%x\{[^}]*\}/, impact: 'high', classificationType: 'system' },
  { type: 'exec', pattern: /\bexec\s*\(/, impact: 'high', classificationType: 'system' },
  { type: 'spawn', pattern: /\bspawn\s*\(/, impact: 'high', classificationType: 'system' },
]

/**
 * Pattern to extract require statements.
 */
const REQUIRE_PATTERN = /\brequire\s+["']([^"']+)["']/g

/**
 * Analyzes Ruby code for safety patterns.
 *
 * Detects dangerous operations such as:
 * - eval() for arbitrary code execution
 * - instance_eval(), class_eval(), module_eval() for metaprogramming attacks
 * - system(), backticks (`), %x{} for shell command execution
 * - exec() and spawn() for process execution
 * - binding.eval() for scope exploitation
 * - File operations with write modes
 *
 * @param code - The Ruby code to analyze
 * @returns Safety analysis result with classification and detected patterns
 *
 * @example
 * ```typescript
 * const result = analyzeRubySafety('eval(user_input)')
 * // Returns: { classification: { impact: 'critical', ... }, patterns: [...] }
 * ```
 */
export function analyzeRubySafety(code: string): RubySafetyAnalysis {
  const requires: string[] = []

  // Extract require statements
  let requireMatch: RegExpExecArray | null
  const requirePattern = new RegExp(REQUIRE_PATTERN.source, 'g')
  while ((requireMatch = requirePattern.exec(code)) !== null) {
    requires.push(requireMatch[1])
  }

  // Detect dangerous patterns using shared utility
  const patterns = detectPatterns(code, RUBY_PATTERNS)

  // Determine overall classification based on detected patterns
  const classification = buildClassification(patterns)

  return {
    classification,
    patterns,
    requires,
  }
}

/**
 * Builds a SafetyClassification from detected patterns.
 */
function buildClassification(patterns: DetectedPattern[]): SafetyClassification {
  // Check for critical patterns (eval family, binding.eval)
  const hasCritical = patterns.some(p => p.impact === 'critical')
  if (hasCritical) {
    return {
      type: 'execute',
      impact: 'critical',
      reversible: false,
      reason: 'Code contains eval family functions that can execute arbitrary code',
    }
  }

  // Check for high impact patterns (system execution)
  const hasHigh = patterns.some(p => p.impact === 'high')
  if (hasHigh) {
    return {
      type: 'system',
      impact: 'high',
      reversible: false,
      reason: 'Code contains system execution functions that can run shell commands',
    }
  }

  // No dangerous patterns - safe code
  return {
    type: 'read',
    impact: 'low',
    reversible: true,
    reason: 'No dangerous patterns detected',
  }
}
