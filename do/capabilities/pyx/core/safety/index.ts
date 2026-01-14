/**
 * Python code safety analyzer
 *
 * Analyzes Python code for potentially dangerous operations:
 * - Dangerous imports (os, subprocess, socket, etc.)
 * - Code execution functions (exec, eval, compile)
 * - File system access to sensitive paths
 * - Network access
 * - Dangerous attribute access
 * - Infinite loops and resource exhaustion
 */

export { analyze } from './analyzer'
export type { SafetyReport, SafetyViolation, ViolationType, Severity } from './types'
export { allRules } from './rules'
export type { SafetyRule } from './rules'
