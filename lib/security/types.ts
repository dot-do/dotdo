/**
 * Security static analyzer types
 *
 * Type definitions for JavaScript/TypeScript code security analysis.
 */

/**
 * Types of security violations that can be detected
 */
export type ViolationType =
  | 'dangerous_function'
  | 'code_execution'
  | 'filesystem_access'
  | 'network_access'
  | 'process_access'
  | 'secret_exposure'
  | 'prototype_pollution'
  | 'infinite_loop'
  | 'resource_exhaustion'
  | 'unsafe_deserialization'

/**
 * Severity levels for violations
 */
export type Severity = 'error' | 'warning'

/**
 * A single security violation detected in code
 */
export interface SecurityViolation {
  /** Type of security issue */
  type: ViolationType
  /** Human-readable message describing the issue */
  message: string
  /** Line number where the violation was found (1-indexed) */
  line?: number
  /** Column number where the violation was found (1-indexed) */
  column?: number
  /** Severity level - error blocks execution, warning allows with caution */
  severity: Severity
  /** Suggested safe alternative, if available */
  suggestion?: string
}

/**
 * Result of security analysis
 */
export interface SecurityReport {
  /** Whether the code is safe to execute */
  safe: boolean
  /** List of violations found */
  violations: SecurityViolation[]
  /** Summary counts by severity */
  summary?: {
    errors: number
    warnings: number
  }
}

/**
 * Configuration options for the security analyzer
 */
export interface AnalyzerConfig {
  /** Whether to include warnings in the report (default: true) */
  includeWarnings?: boolean
  /** Custom rules to add to the default set */
  customRules?: SecurityRule[]
  /** Rule types to skip */
  skipRules?: ViolationType[]
  /** Whether code with only warnings is considered safe (default: true) */
  warningsAreSafe?: boolean
}

/**
 * A security rule definition
 */
export interface SecurityRule {
  /** Type of violation this rule detects */
  type: ViolationType
  /** Regex patterns to match */
  patterns: RegExp[]
  /** Function to generate the violation message */
  getMessage: (match: RegExpMatchArray) => string
  /** Severity of violations from this rule */
  severity: Severity
  /** Optional condition to skip the rule */
  skipIf?: (code: string, match: RegExpMatchArray) => boolean
  /** Optional suggestion for a safe alternative */
  suggestion?: string
}
