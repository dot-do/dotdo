/**
 * Core type definitions for @dotdo/pyx
 *
 * This module contains platform-agnostic types that can be used
 * in any JavaScript runtime (Node.js, Deno, Bun, browsers, etc.)
 */

/**
 * Represents a Python version string (e.g., "3.11", "3.12")
 */
export type PythonVersion = `${number}.${number}` | `${number}.${number}.${number}`

/**
 * Python execution result
 */
export interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Python package specification
 */
export interface PackageSpec {
  name: string
  version?: string
  extras?: string[]
}

/**
 * Virtual environment configuration
 */
export interface VenvConfig {
  pythonVersion: PythonVersion
  packages?: PackageSpec[]
  systemSitePackages?: boolean
}

/**
 * AST node base type
 */
export interface ASTNode {
  type: string
  start?: number
  end?: number
}

/**
 * Transform options
 */
export interface TransformOptions {
  sourceMap?: boolean
  minify?: boolean
}

/**
 * Transform result
 */
export interface TransformResult {
  code: string
  sourceMap?: string
}

/**
 * Safety check result
 */
export interface SafetyCheckResult {
  safe: boolean
  violations: SafetyViolation[]
}

/**
 * Safety violation detail
 */
export interface SafetyViolation {
  type: string
  message: string
  line?: number
  column?: number
}
