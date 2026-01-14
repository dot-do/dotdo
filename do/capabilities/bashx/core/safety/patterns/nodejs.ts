/**
 * Node.js Safety Pattern Detection
 *
 * Detects dangerous patterns in Node.js code including:
 * - eval/Function constructor code execution
 * - vm module code execution
 * - Prototype pollution attacks (__proto__, Object.setPrototypeOf)
 * - child_process module execution
 * - Dynamic require injection
 *
 * @packageDocumentation
 */

import type { SafetyClassification } from '../../types.js'
import {
  type DetectedPattern,
  type PatternDefinition,
  type ImpactLevel,
  detectPatterns,
  getHighestImpact,
} from './shared.js'

// Re-export DetectedPattern for backwards compatibility
export type { DetectedPattern }

/**
 * Result of Node.js safety analysis.
 */
export interface NodeSafetyAnalysis {
  /** Overall safety classification */
  classification: SafetyClassification
  /** List of detected patterns */
  patterns: DetectedPattern[]
  /** List of detected require/import modules */
  requires: string[]
  /** Whether the code contains prototype pollution patterns */
  hasPrototypePollution: boolean
}

/**
 * Node.js danger patterns ordered by severity.
 */
const NODE_PATTERNS: PatternDefinition[] = [
  // Code eval - critical
  { type: 'eval', pattern: /\beval\s*\(/, impact: 'critical' },
  { type: 'function_constructor', pattern: /new\s+Function\s*\(/, impact: 'critical' },
  { type: 'function_constructor', pattern: /\bFunction\s*\(/, impact: 'critical' },

  // Prototype pollution - critical
  // Matches: .__proto__ followed by property access, assignment, or bracket notation
  { type: 'prototype_pollution', pattern: /\.__proto__\s*[.=\[]/, impact: 'critical' },
  { type: 'prototype_pollution', pattern: /\["__proto__"\]\s*\[/, impact: 'critical' },
  { type: 'prototype_pollution', pattern: /Object\.setPrototypeOf\s*\(/, impact: 'critical' },

  // vm module - high
  { type: 'vm_execution', pattern: /\bvm\.(run|compile|createContext)/, impact: 'high' },

  // child_process - high
  { type: 'child_process', pattern: /child_process\.(exec|spawn|fork|execFile)/, impact: 'high' },
  { type: 'child_process', pattern: /\.(exec|spawn|fork|execFile)\s*\(/, impact: 'high' },

  // Dynamic require - high (require with variable, not string literal)
  { type: 'dynamic_require', pattern: /require\s*\(\s*`/, impact: 'high' },
  { type: 'dynamic_require', pattern: /require\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)/, impact: 'high' },
]

/**
 * Pattern to extract require statements with string literals.
 */
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * Modules that are considered dangerous when required.
 */
const DANGEROUS_MODULES = new Set(['child_process', 'vm'])

/**
 * Pattern to detect destructured child_process methods.
 * Matches: { exec } from require, { exec, spawn } from require, etc.
 */
const CHILD_PROCESS_DESTRUCTURE = /\{\s*(exec|spawn|fork|execFile)[\s,}]/

/**
 * Pattern to detect standalone calls to exec/spawn/fork/execFile
 * (after destructuring from child_process).
 */
const STANDALONE_CHILD_PROCESS_CALL = /(?:^|[^.\w])(exec|spawn|fork|execFile)\s*\(/m

/**
 * Analyzes Node.js code for safety patterns.
 *
 * Detects dangerous operations such as:
 * - eval() for arbitrary code execution
 * - new Function() for dynamic code generation
 * - vm.runInContext(), vm.runInNewContext() for sandboxed code execution
 * - __proto__ assignment for prototype pollution
 * - Object.setPrototypeOf() for prototype chain manipulation
 * - child_process.exec(), spawn(), execFile() for shell commands
 * - Dynamic require() with variables for module injection
 *
 * @param code - The Node.js code to analyze
 * @returns Safety analysis result with classification and detected patterns
 *
 * @example
 * ```typescript
 * const result = analyzeNodeSafety('eval(userInput)')
 * // Returns: { classification: { impact: 'critical', ... }, patterns: [...] }
 * ```
 */
export function analyzeNodeSafety(code: string): NodeSafetyAnalysis {
  const requires: string[] = []
  let hasPrototypePollution = false

  // Extract all require statements with string literals
  let match: RegExpExecArray | null
  const requirePattern = new RegExp(REQUIRE_PATTERN.source, 'g')
  while ((match = requirePattern.exec(code)) !== null) {
    const moduleName = match[1]
    if (!requires.includes(moduleName)) {
      requires.push(moduleName)
    }
  }

  // Detect patterns using shared utility
  const patterns = detectPatterns(code, NODE_PATTERNS)

  // Check for prototype pollution in detected patterns
  hasPrototypePollution = patterns.some((p) => p.type === 'prototype_pollution')

  // Check for destructured child_process calls
  // Pattern: const { exec } = require('child_process'); exec(...)
  const hasChildProcessRequired = requires.includes('child_process')
  const hasDestructuredChildProcess = CHILD_PROCESS_DESTRUCTURE.test(code)
  const hasStandaloneChildProcessCall = STANDALONE_CHILD_PROCESS_CALL.test(code)

  if (hasChildProcessRequired && hasDestructuredChildProcess && hasStandaloneChildProcessCall) {
    // Check if we already detected a child_process pattern
    const hasChildProcessPattern = patterns.some((p) => p.type === 'child_process')
    if (!hasChildProcessPattern) {
      const standaloneMatch = STANDALONE_CHILD_PROCESS_CALL.exec(code)
      patterns.push({
        type: 'child_process',
        impact: 'high',
        match: standaloneMatch ? standaloneMatch[0].trim() : 'exec/spawn/fork/execFile',
      })
    }
  }

  // Determine highest impact level from patterns and dangerous modules
  let highestImpact: ImpactLevel = getHighestImpact(patterns)
  let operationType: SafetyClassification['type'] = 'read'
  let reversible = true

  // Check if any dangerous modules are required
  const hasDangerousModule = requires.some((m) => DANGEROUS_MODULES.has(m))

  // Adjust reversibility based on impact
  if (highestImpact === 'critical') {
    reversible = false
  }

  // If dangerous module is required but no high impact pattern detected yet, set to high
  if (hasDangerousModule && highestImpact !== 'critical') {
    highestImpact = 'high'
  }

  // Determine operation type based on patterns
  if (hasPrototypePollution) {
    operationType = 'system'
  } else if (patterns.some((p) => p.type === 'child_process')) {
    operationType = 'system'
  } else if (
    patterns.some(
      (p) =>
        p.type === 'eval' ||
        p.type === 'function_constructor' ||
        p.type === 'vm_execution' ||
        p.type === 'dynamic_require'
    )
  ) {
    operationType = 'execute'
  }

  // Build reason string
  let reason: string
  if (patterns.length === 0) {
    reason = 'No dangerous patterns detected'
  } else {
    const patternTypes = [...new Set(patterns.map((p) => p.type))]
    reason = `Detected: ${patternTypes.join(', ')}`
  }

  return {
    classification: {
      type: operationType,
      impact: highestImpact,
      reversible,
      reason,
    },
    patterns,
    requires,
    hasPrototypePollution,
  }
}
