/**
 * Error Class Hierarchy - GREEN PHASE Implementation
 *
 * Issue: do-mdo4 (Error Class Hierarchy)
 *
 * Hierarchy:
 * ```
 * DotdoError (base)
 * ├── TransientError (retryable = true)
 * │   ├── ShardError (shard-related failures)
 * │   └── NetworkError (network-related failures)
 * └── PermanentError (retryable = false)
 *     ├── AuthError (authentication/authorization failures)
 *     ├── ConfigError (configuration errors)
 *     │   └── BindingError (missing/invalid bindings)
 *     └── ValidationError (input validation errors)
 * ```
 *
 * Error codes follow POSIX-style naming: EAUTH, ECONFIG, ESHARD, EBIND
 */

// ============================================================================
// Error Code Constants
// ============================================================================

export const EAUTH = 'EAUTH'
export const ECONFIG = 'ECONFIG'
export const ESHARD = 'ESHARD'
export const EBIND = 'EBIND'
export const ENETWORK = 'ENETWORK'
export const EVALIDATION = 'EVALIDATION'
export const EINTERNAL = 'EINTERNAL'

// ============================================================================
// Types
// ============================================================================

export interface DotdoErrorOptions {
  cause?: Error | unknown
  timestamp?: number
  context?: Record<string, unknown>
  isRetryable?: boolean
}

export interface TransientErrorOptions extends DotdoErrorOptions {
  retryAfter?: number
  maxRetries?: number
}

export interface AuthErrorOptions extends Omit<DotdoErrorOptions, 'isRetryable'> {
  forbidden?: boolean
}

export interface ConfigErrorOptions extends Omit<DotdoErrorOptions, 'isRetryable'> {
  configKey?: string
}

export interface ShardErrorOptions extends TransientErrorOptions {
  shardId?: number
  shardKey?: string
}

export interface BindingErrorOptions extends ConfigErrorOptions {
  bindingName?: string
  bindingType?: string
}

export interface DotdoErrorJSON {
  name: string
  code: string
  message: string
  timestamp: number
  isRetryable: boolean
  context?: Record<string, unknown>
  cause?: DotdoErrorJSON | { name: string; message: string }
  // TransientError fields
  retryAfter?: number
  maxRetries?: number
  // ShardError fields
  shardId?: number
  shardKey?: string
  // BindingError fields
  bindingName?: string
  bindingType?: string
}

// ============================================================================
// DotdoError Base Class
// ============================================================================

/**
 * Base error class for all dotdo errors.
 * Provides structured error information with optional cause chaining.
 */
export class DotdoError extends Error {
  public readonly code: string
  public override readonly cause?: Error | unknown
  public readonly timestamp: number
  public readonly context?: Record<string, unknown>
  public readonly isRetryable: boolean

  constructor(code: string, message: string, options?: DotdoErrorOptions) {
    super(message)
    this.code = code
    this.cause = options?.cause
    this.timestamp = options?.timestamp ?? Date.now()
    this.context = options?.context
    this.isRetryable = options?.isRetryable ?? false
    this.name = 'DotdoError'

    // Capture stack trace properly for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Serialize the error for JSON transport/logging.
   */
  toJSON(): DotdoErrorJSON {
    const json: DotdoErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      isRetryable: this.isRetryable,
    }

    if (this.context !== undefined) {
      // Handle circular references gracefully
      try {
        JSON.stringify(this.context)
        json.context = this.context
      } catch {
        // If circular, stringify what we can
        json.context = { _circular: true }
      }
    }

    if (this.cause !== undefined && this.cause !== null) {
      if (this.cause instanceof DotdoError) {
        json.cause = this.cause.toJSON()
      } else if (this.cause instanceof Error) {
        json.cause = {
          name: this.cause.name,
          message: this.cause.message,
        }
      } else if (typeof this.cause === 'object') {
        json.cause = {
          name: 'Object',
          message: String(this.cause),
        }
      }
    }

    return json
  }

  /**
   * Return formatted string representation
   */
  override toString(): string {
    let str = `${this.name}: [${this.code}] ${this.message}`
    if (this.context) {
      try {
        str += ` ${JSON.stringify(this.context)}`
      } catch {
        str += ' {circular}'
      }
    }
    return str
  }
}

// ============================================================================
// TransientError (Retryable Errors)
// ============================================================================

/**
 * Transient errors are retryable - temporary failures that may succeed on retry.
 */
export class TransientError extends DotdoError {
  public readonly retryAfter?: number
  public readonly maxRetries?: number

  constructor(code: string, message: string, options?: TransientErrorOptions) {
    super(code, message, { ...options, isRetryable: true })
    this.retryAfter = options?.retryAfter
    this.maxRetries = options?.maxRetries
    this.name = 'TransientError'
  }

  override toJSON(): DotdoErrorJSON {
    const json = super.toJSON()
    if (this.retryAfter !== undefined) {
      json.retryAfter = this.retryAfter
    }
    if (this.maxRetries !== undefined) {
      json.maxRetries = this.maxRetries
    }
    return json
  }
}

// ============================================================================
// PermanentError (Non-Retryable Errors)
// ============================================================================

/**
 * Permanent errors are NOT retryable - retrying will not help.
 */
export class PermanentError extends DotdoError {
  constructor(code: string, message: string, options?: DotdoErrorOptions) {
    // Force isRetryable to false, ignoring any override attempt
    super(code, message, { ...options, isRetryable: false })
    this.name = 'PermanentError'
  }
}

// ============================================================================
// AuthError (Authentication/Authorization Failures)
// ============================================================================

/**
 * Authentication/authorization errors - always permanent.
 */
export class AuthError extends PermanentError {
  public readonly httpStatus: number

  constructor(message: string, options?: AuthErrorOptions) {
    super(EAUTH, message, options)
    this.name = 'AuthError'
    this.httpStatus = options?.forbidden ? 403 : 401
  }

  static unauthorized(): AuthError {
    return new AuthError('Request unauthorized', { forbidden: false })
  }

  static forbidden(resource: string): AuthError {
    return new AuthError(`Access forbidden to ${resource}`, { forbidden: true })
  }

  static tokenExpired(): AuthError {
    return new AuthError('Authentication token has expired', { forbidden: false })
  }

  static invalidCredentials(): AuthError {
    return new AuthError('Invalid credentials provided', { forbidden: false })
  }
}

// ============================================================================
// ConfigError (Configuration Errors)
// ============================================================================

/**
 * Configuration errors - always permanent.
 */
export class ConfigError extends PermanentError {
  public readonly configKey?: string

  constructor(message: string, options?: ConfigErrorOptions) {
    super(ECONFIG, message, options)
    this.name = 'ConfigError'
    this.configKey = options?.configKey
  }

  static missingKey(key: string): ConfigError {
    return new ConfigError(`Configuration key '${key}' is missing`, { configKey: key })
  }

  static invalidValue(key: string, value: string, expected: string): ConfigError {
    return new ConfigError(
      `Configuration key '${key}' has invalid value '${value}', expected ${expected}`,
      { configKey: key }
    )
  }

  static fileNotFound(path: string): ConfigError {
    return new ConfigError(`Configuration file '${path}' not found`, { configKey: path })
  }
}

// ============================================================================
// ShardError (Shard-Related Failures)
// ============================================================================

/**
 * Shard-related errors - typically transient/retryable.
 */
export class ShardError extends TransientError {
  public readonly shardId?: number
  public readonly shardKey?: string

  constructor(message: string, options?: ShardErrorOptions) {
    super(ESHARD, message, options)
    this.name = 'ShardError'
    this.shardId = options?.shardId
    this.shardKey = options?.shardKey
  }

  static unavailable(shardId: number): ShardError {
    return new ShardError(`Shard ${shardId} is unavailable`, { shardId })
  }

  static routingFailed(shardKey: string): ShardError {
    return new ShardError(`Shard routing failed for key '${shardKey}'`, { shardKey })
  }

  static overloaded(shardId: number, options?: { retryAfter?: number }): ShardError {
    return new ShardError(`Shard ${shardId} is overloaded`, {
      shardId,
      retryAfter: options?.retryAfter,
    })
  }

  override toJSON(): DotdoErrorJSON {
    const json = super.toJSON()
    if (this.shardId !== undefined) {
      json.shardId = this.shardId
    }
    if (this.shardKey !== undefined) {
      json.shardKey = this.shardKey
    }
    return json
  }
}

// ============================================================================
// BindingError (Binding-Related Errors)
// ============================================================================

/**
 * Binding errors - extends ConfigError, always permanent.
 */
export class BindingError extends ConfigError {
  public readonly bindingName?: string
  public readonly bindingType?: string

  constructor(message: string, options?: BindingErrorOptions) {
    // Call ConfigError constructor but we override the code
    super(message, options)
    // Override the code set by ConfigError
    ;(this as { code: string }).code = EBIND
    this.name = 'BindingError'
    this.bindingName = options?.bindingName
    this.bindingType = options?.bindingType
  }

  static missing(bindingName: string): BindingError {
    return new BindingError(`Binding '${bindingName}' is missing`, { bindingName })
  }

  static wrongType(bindingName: string, actual: string, expected: string): BindingError {
    return new BindingError(
      `Binding '${bindingName}' has type '${actual}', expected '${expected}'`,
      { bindingName, bindingType: actual }
    )
  }

  static notConfigured(bindingName: string): BindingError {
    return new BindingError(`Binding '${bindingName}' is not configured`, { bindingName })
  }

  override toJSON(): DotdoErrorJSON {
    const json = super.toJSON()
    if (this.bindingName !== undefined) {
      json.bindingName = this.bindingName
    }
    if (this.bindingType !== undefined) {
      json.bindingType = this.bindingType
    }
    return json
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for DotdoError
 */
export function isDotdoError(error: unknown): error is DotdoError {
  return error instanceof DotdoError
}

/**
 * Type guard for retryable errors
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof DotdoError) {
    return error.isRetryable
  }
  return false
}

/**
 * Type guard for TransientError
 */
export function isTransient(error: unknown): error is TransientError {
  return error instanceof TransientError
}

/**
 * Type guard for PermanentError
 */
export function isPermanent(error: unknown): error is PermanentError {
  return error instanceof PermanentError
}
