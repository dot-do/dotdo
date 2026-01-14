/**
 * NPM Error Types
 *
 * Structured error types for npm operations with:
 * - Typed error codes for programmatic handling
 * - Helpful messages with context
 * - JSON serialization for RPC
 */

// =============================================================================
// Error Code Types
// =============================================================================

/**
 * Error codes for npm operations
 */
export type NpmErrorCode =
  | 'ENOTFOUND'      // Package/version not found in registry
  | 'EFETCH'         // Network fetch failed
  | 'EINSTALL'       // Installation failed
  | 'EEXEC'          // Execution failed
  | 'ESECURITY'      // Security violation
  | 'EVALIDATION'    // Invalid input/data
  | 'ETIMEOUT'       // Operation timed out
  | 'ERESOLUTION'    // Dependency resolution failed
  | 'ETARBALL'       // Tarball extraction failed
  | 'EPARSE'         // Parsing failed (semver, package.json, etc.)

// =============================================================================
// Error Context Types
// =============================================================================

/**
 * Context for package-related errors
 */
export interface NpmErrorContext {
  package?: string
  version?: string
  registry?: string
  path?: string
  cause?: string
}

/**
 * JSON-serializable error representation
 */
export interface NpmErrorJSON {
  name: string
  code: NpmErrorCode
  message: string
  context?: NpmErrorContext
  stack?: string
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for npm operations
 *
 * Features:
 * - Typed error codes
 * - Optional context (package, version, etc.)
 * - JSON serialization for RPC
 * - Proper instanceof checks
 */
export class NpmError extends Error {
  readonly code: NpmErrorCode
  readonly context?: NpmErrorContext

  constructor(
    code: NpmErrorCode,
    message: string,
    context?: NpmErrorContext
  ) {
    super(message)
    this.name = 'NpmError'
    this.code = code
    this.context = context

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Serialize error for JSON transport (RPC)
   */
  toJSON(): NpmErrorJSON {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    }
  }

  /**
   * Create NpmError from JSON representation
   */
  static fromJSON(json: NpmErrorJSON): NpmError {
    const error = new NpmError(json.code, json.message, json.context)
    if (json.stack) {
      error.stack = json.stack
    }
    return error
  }
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Package or version not found in registry
 */
export class PackageNotFoundError extends NpmError {
  constructor(packageName: string, version?: string) {
    const message = version
      ? `Package not found: ${packageName}@${version}`
      : `Package not found: ${packageName}`

    super('ENOTFOUND', message, { package: packageName, version })
    this.name = 'PackageNotFoundError'
  }
}

/**
 * Network fetch failed
 */
export class FetchError extends NpmError {
  readonly status?: number

  constructor(message: string, options?: { status?: number; registry?: string }) {
    super('EFETCH', message, { registry: options?.registry })
    this.name = 'FetchError'
    this.status = options?.status
  }
}

/**
 * Package installation failed
 */
export class InstallError extends NpmError {
  constructor(message: string, packageName?: string) {
    super('EINSTALL', message, { package: packageName })
    this.name = 'InstallError'
  }
}

/**
 * Command/binary execution failed
 */
export class ExecError extends NpmError {
  readonly exitCode?: number

  constructor(message: string, options?: { package?: string; exitCode?: number }) {
    super('EEXEC', message, { package: options?.package })
    this.name = 'ExecError'
    this.exitCode = options?.exitCode
  }
}

/**
 * Security violation (blocked package, vulnerability, etc.)
 */
export class SecurityError extends NpmError {
  readonly severity?: 'critical' | 'high' | 'medium' | 'low'

  constructor(message: string, options?: { package?: string; severity?: 'critical' | 'high' | 'medium' | 'low' }) {
    super('ESECURITY', message, { package: options?.package })
    this.name = 'SecurityError'
    this.severity = options?.severity
  }
}

/**
 * Invalid input or data validation failed
 */
export class ValidationError extends NpmError {
  constructor(message: string, context?: NpmErrorContext) {
    super('EVALIDATION', message, context)
    this.name = 'ValidationError'
  }
}

/**
 * Operation timed out
 */
export class TimeoutError extends NpmError {
  readonly timeoutMs?: number

  constructor(message: string, timeoutMs?: number) {
    super('ETIMEOUT', message)
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Dependency resolution failed
 */
export class ResolutionError extends NpmError {
  constructor(message: string, packageName?: string, version?: string) {
    super('ERESOLUTION', message, { package: packageName, version })
    this.name = 'ResolutionError'
  }
}

/**
 * Tarball extraction failed
 */
export class TarballError extends NpmError {
  constructor(message: string, packageName?: string) {
    super('ETARBALL', message, { package: packageName })
    this.name = 'TarballError'
  }
}

/**
 * Parsing failed (semver, package.json, etc.)
 */
export class ParseError extends NpmError {
  constructor(message: string, context?: NpmErrorContext) {
    super('EPARSE', message, context)
    this.name = 'ParseError'
  }
}

// =============================================================================
// Error Type Guards
// =============================================================================

/**
 * Check if an error is an NpmError
 */
export function isNpmError(error: unknown): error is NpmError {
  return error instanceof NpmError
}

/**
 * Check if an error has a specific code
 */
export function hasErrorCode(error: unknown, code: NpmErrorCode): boolean {
  return isNpmError(error) && error.code === code
}

// =============================================================================
// Error Utilities
// =============================================================================

/**
 * Wrap an unknown error as an NpmError
 */
export function wrapError(error: unknown, code: NpmErrorCode = 'EVALIDATION'): NpmError {
  if (isNpmError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new NpmError(code, error.message, { cause: error.message })
  }

  return new NpmError(code, String(error))
}
