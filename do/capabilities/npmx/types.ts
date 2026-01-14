/**
 * Shared type definitions for npmx
 *
 * Single source of truth for all shared types across the package.
 *
 * @module npmx/types
 */

// Re-export security types for convenience
export type {
  NpmSecurityConfig,
  SecurityCheckResult,
  SecurityViolation,
  VulnerabilitySeverity,
} from './core/security/policy.js'

/**
 * Package version entry for install results
 */
export interface PackageVersion {
  name: string
  version: string
}

/**
 * Package update entry with before/after versions
 */
export interface PackageUpdate {
  name: string
  from: string
  to: string
}

/**
 * Unified install result type
 *
 * Combines both the SDK shape (added/removed/updated) and the DO shape
 * (installed/resolved/cached/duration) into a single comprehensive type.
 *
 * @example
 * ```typescript
 * const result: InstallResult = {
 *   installed: [{ name: 'lodash', version: '4.17.21' }],
 *   removed: [],
 *   updated: [],
 *   stats: {
 *     resolved: 1,
 *     cached: 0,
 *     duration: 1234
 *   }
 * }
 * ```
 */
export interface InstallResult {
  /** Packages that were newly installed */
  installed: PackageVersion[]

  /** Packages that were removed */
  removed: PackageVersion[]

  /** Packages that were updated to new versions */
  updated: PackageUpdate[]

  /** Installation statistics */
  stats: {
    /** Number of packages resolved from registry */
    resolved: number
    /** Number of packages served from cache */
    cached: number
    /** Total duration in milliseconds */
    duration: number
  }
}

/**
 * Create an empty InstallResult with default values
 */
export function createEmptyInstallResult(): InstallResult {
  return {
    installed: [],
    removed: [],
    updated: [],
    stats: {
      resolved: 0,
      cached: 0,
      duration: 0,
    },
  }
}
