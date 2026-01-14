/**
 * BashxError - Unified Error Hierarchy for bashx.do
 *
 * Provides a structured error system with:
 * - Type-safe error codes for programmatic handling
 * - Rich context preservation throughout the error chain
 * - Recovery hints and suggestions
 * - Serialization/deserialization for RPC transport
 *
 * This module consolidates error handling across the codebase,
 * replacing ad-hoc `error instanceof Error ? error.message : String(error)` patterns.
 *
 * @packageDocumentation
 */

// ============================================================================
// Error Code Types
// ============================================================================

/**
 * Known error codes for BashxError and its subclasses.
 * Used for programmatic error handling via switch statements or maps.
 */
export type ErrorCode =
  | 'EXECUTION_ERROR'
  | 'TIER_EXECUTION_ERROR'
  | 'COMMAND_NOT_FOUND'
  | 'TIMEOUT_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'PARSE_ERROR'
  | 'SAFETY_BLOCKED'
  | 'UNKNOWN_ERROR'
  | 'NETWORK_ERROR'
  | 'CIRCUIT_OPEN'
  | 'RPC_ERROR'

/**
 * Context object for structured error metadata.
 * Allows any additional properties while providing type hints for common ones.
 */
export interface ErrorContext {
  /** The command that was being executed */
  command?: string
  /** The execution tier (1, 2, or 3) */
  tier?: 1 | 2 | 3
  /** Timestamp when the error occurred */
  timestamp?: Date
  /** Any additional context properties */
  [key: string]: unknown
}

/**
 * Serialized error format for RPC transport and logging.
 */
export interface SerializedError {
  name: string
  message: string
  code: ErrorCode
  retryable: boolean
  hint?: string
  context: ErrorContext
  stack?: string
  cause?: SerializedError | { name: string; message: string; stack?: string }
}

// ============================================================================
// BashxError Base Class
// ============================================================================

/**
 * Base error class for all bashx errors.
 *
 * Features:
 * - Typed error code for programmatic handling
 * - Structured context for debugging
 * - Optional recovery hints
 * - Retryable flag for retry logic
 * - Serialization for RPC transport
 *
 * @example
 * ```typescript
 * throw new BashxError('Operation failed', {
 *   code: 'EXECUTION_ERROR',
 *   retryable: true,
 *   hint: 'Try again with elevated privileges',
 *   context: { command: 'ls', tier: 1 }
 * })
 * ```
 */
export class BashxError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly hint?: string
  readonly context: ErrorContext

  constructor(
    message: string,
    options: {
      code: ErrorCode
      retryable?: boolean
      hint?: string
      context?: ErrorContext
      cause?: Error
    }
  ) {
    super(message, { cause: options.cause })
    this.name = 'BashxError'
    this.code = options.code
    this.retryable = options.retryable ?? false
    this.hint = options.hint
    this.context = {
      ...options.context,
      timestamp: options.context?.timestamp ?? new Date(),
    }

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Serialize the error for RPC transport or logging.
   */
  toJSON(): SerializedError {
    const result: SerializedError = {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
    }

    if (this.hint) {
      result.hint = this.hint
    }

    if (this.cause instanceof Error) {
      result.cause = {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack,
      }
    }

    return result
  }

  /**
   * Deserialize an error from JSON data.
   */
  static fromJSON(data: SerializedError): BashxError {
    return new BashxError(data.message, {
      code: data.code,
      retryable: data.retryable,
      hint: data.hint,
      context: data.context,
    })
  }
}

// ============================================================================
// TierExecutionError
// ============================================================================

/**
 * Options for TierExecutionError.
 */
export interface TierExecutionErrorOptions {
  /** The execution tier (1=native, 2=interpreted, 3=RPC) */
  tier: 1 | 2 | 3
  /** The command that failed */
  command: string
  /** Exit code if available */
  exitCode?: number
  /** Standard output captured before failure */
  stdout?: string
  /** Standard error output */
  stderr?: string
  /** Additional context */
  context?: ErrorContext
  /** Original error that caused this */
  cause?: Error
}

/**
 * Error thrown when command execution fails at a specific tier.
 *
 * @example
 * ```typescript
 * throw new TierExecutionError('Native command failed', {
 *   tier: 1,
 *   command: 'cat /nonexistent',
 *   exitCode: 1,
 *   stderr: 'No such file or directory'
 * })
 * ```
 */
export class TierExecutionError extends BashxError {
  readonly tier: 1 | 2 | 3
  readonly command: string
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string

  constructor(message: string, options: TierExecutionErrorOptions) {
    const hint = TierExecutionError.getHintForTier(options.tier)

    super(message, {
      code: 'TIER_EXECUTION_ERROR',
      retryable: false,
      hint,
      context: {
        tier: options.tier,
        command: options.command,
        exitCode: options.exitCode,
        ...options.context,
      },
      cause: options.cause,
    })

    this.name = 'TierExecutionError'
    this.tier = options.tier
    this.command = options.command
    this.exitCode = options.exitCode
    this.stdout = options.stdout
    this.stderr = options.stderr
  }

  private static getHintForTier(tier: 1 | 2 | 3): string {
    switch (tier) {
      case 1:
        return 'The native (Tier 1) executor failed. Check if the command is supported in the sandbox environment.'
      case 2:
        return 'The interpreted (Tier 2) executor failed. Verify the script syntax and dependencies.'
      case 3:
        return 'The RPC (Tier 3) executor failed. Check network connectivity and RPC service availability.'
    }
  }
}

// ============================================================================
// CommandNotFoundError
// ============================================================================

/**
 * Options for CommandNotFoundError.
 */
export interface CommandNotFoundErrorOptions {
  /** Tiers that were searched */
  searchedTiers?: number[]
  /** Similar commands that might be what the user wanted */
  suggestions?: string[]
}

/**
 * Error thrown when a command is not found in any execution tier.
 *
 * @example
 * ```typescript
 * throw new CommandNotFoundError('gti', {
 *   suggestions: ['git'],
 *   searchedTiers: [1, 2, 3]
 * })
 * ```
 */
export class CommandNotFoundError extends BashxError {
  readonly command: string
  readonly suggestions?: string[]

  constructor(command: string, options: CommandNotFoundErrorOptions = {}) {
    const suggestions = options.suggestions
    let hint = `Command '${command}' was not found in the execution environment.`

    if (suggestions && suggestions.length > 0) {
      hint += ` Did you mean: ${suggestions.join(', ')}?`
    }

    super(`Command not found: ${command}`, {
      code: 'COMMAND_NOT_FOUND',
      retryable: false,
      hint,
      context: {
        command,
        searchedTiers: options.searchedTiers,
      },
    })

    this.name = 'CommandNotFoundError'
    this.command = command
    this.suggestions = suggestions
  }
}

// ============================================================================
// BashxTimeoutError
// ============================================================================

/**
 * Options for BashxTimeoutError.
 */
export interface BashxTimeoutErrorOptions {
  /** Timeout threshold in milliseconds */
  timeoutMs: number
  /** The operation that timed out */
  operation: string
  /** Actual elapsed time if different from timeout */
  elapsedMs?: number
  /** Additional context */
  context?: ErrorContext
}

/**
 * Error thrown when an operation times out.
 *
 * This consolidates timeout handling across the codebase, replacing
 * the TimeoutError from src/remote/errors.ts and circuit breaker timeouts.
 *
 * @example
 * ```typescript
 * throw new BashxTimeoutError('Command execution timed out', {
 *   timeoutMs: 30000,
 *   operation: 'ls -R /',
 *   elapsedMs: 30050
 * })
 * ```
 */
export class BashxTimeoutError extends BashxError {
  readonly timeoutMs: number
  readonly operation: string
  readonly elapsedMs?: number

  constructor(message: string, options: BashxTimeoutErrorOptions) {
    const formattedTimeout = BashxTimeoutError.formatDuration(options.timeoutMs)

    super(message, {
      code: 'TIMEOUT_ERROR',
      retryable: true,
      hint: `Operation timed out after ${formattedTimeout}. Try increasing the timeout or simplifying the operation.`,
      context: {
        timeoutMs: options.timeoutMs,
        operation: options.operation,
        elapsedMs: options.elapsedMs,
        ...options.context,
      },
    })

    this.name = 'BashxTimeoutError'
    this.timeoutMs = options.timeoutMs
    this.operation = options.operation
    this.elapsedMs = options.elapsedMs
  }

  /**
   * Get the timeout formatted in human-readable form.
   */
  get formattedTimeout(): string {
    return BashxTimeoutError.formatDuration(this.timeoutMs)
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`
    }

    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }

    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
      return `${minutes}m`
    }

    const hours = Math.floor(minutes / 60)
    return `${hours}h`
  }
}

// ============================================================================
// BashxRateLimitError (consolidates src/rpc and src/remote RateLimitError)
// ============================================================================

/**
 * Provider types for rate limiting.
 */
export type RateLimitProvider = 'github' | 'gitlab' | 'bitbucket' | 'rpc' | 'unknown'

/**
 * Options for BashxRateLimitError.
 */
export interface BashxRateLimitErrorOptions {
  /** Maximum requests allowed */
  limit: number
  /** Requests remaining in current window */
  remaining: number
  /** When the rate limit resets (for remote providers) */
  resetAt?: Date
  /** Provider (for git remote operations) */
  provider?: RateLimitProvider
  /** Window start timestamp (for RPC rate limiting) */
  windowStart?: number
  /** Total requests processed */
  totalRequests?: number
  /** Total requests rejected */
  totalRejected?: number
}

/**
 * Error thrown when rate limits are exceeded.
 *
 * This consolidates:
 * - src/rpc/rate-limiter.ts RateLimitError (for RPC DoS protection)
 * - src/remote/errors.ts RateLimitError (for GitHub/GitLab API limits)
 *
 * @example
 * ```typescript
 * // For remote git operations
 * throw new BashxRateLimitError('GitHub rate limit exceeded', {
 *   limit: 60,
 *   remaining: 0,
 *   resetAt: new Date(Date.now() + 3600000),
 *   provider: 'github'
 * })
 *
 * // For RPC rate limiting
 * throw new BashxRateLimitError('RPC rate limit exceeded', {
 *   limit: 1000,
 *   remaining: 0,
 *   windowStart: Date.now() - 500,
 *   totalRequests: 1000,
 *   totalRejected: 5
 * })
 * ```
 */
export class BashxRateLimitError extends BashxError {
  readonly limit: number
  readonly remaining: number
  readonly resetAt?: Date
  readonly provider?: RateLimitProvider
  readonly windowStart?: number
  readonly totalRequests?: number
  readonly totalRejected?: number

  constructor(message: string, options: BashxRateLimitErrorOptions) {
    const hint = BashxRateLimitError.generateHint(options)

    super(message, {
      code: 'RATE_LIMIT_ERROR',
      retryable: true,
      hint,
      context: {
        limit: options.limit,
        remaining: options.remaining,
        resetAt: options.resetAt,
        provider: options.provider,
      },
    })

    this.name = 'BashxRateLimitError'
    this.limit = options.limit
    this.remaining = options.remaining
    this.resetAt = options.resetAt
    this.provider = options.provider
    this.windowStart = options.windowStart
    this.totalRequests = options.totalRequests
    this.totalRejected = options.totalRejected
  }

  /**
   * Get the number of milliseconds until the rate limit resets.
   */
  getWaitMs(): number {
    if (!this.resetAt) {
      return 0
    }
    return Math.max(0, this.resetAt.getTime() - Date.now())
  }

  /**
   * Wait until the rate limit resets.
   */
  async waitForReset(): Promise<void> {
    const waitMs = this.getWaitMs()
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs + 1000)) // Add 1s buffer
    }
  }

  private static generateHint(options: BashxRateLimitErrorOptions): string {
    if (options.resetAt) {
      const waitTime = BashxRateLimitError.formatWaitTime(options.resetAt)
      return `Rate limit will reset in ${waitTime}. Consider using authentication for higher limits.`
    }

    return 'Rate limit exceeded. Reduce request frequency or wait before retrying.'
  }

  private static formatWaitTime(resetAt: Date): string {
    const ms = resetAt.getTime() - Date.now()
    if (ms <= 0) return 'now'

    const seconds = Math.ceil(ms / 1000)
    if (seconds < 60) return `${seconds} seconds`

    const minutes = Math.ceil(seconds / 60)
    if (minutes < 60) return `${minutes} minutes`

    const hours = Math.ceil(minutes / 60)
    return `${hours} hours`
  }
}

// ============================================================================
// ParseError
// ============================================================================

/**
 * Options for ParseError.
 */
export interface ParseErrorOptions {
  /** The input that failed to parse */
  input: string
  /** Line number where the error occurred (1-indexed) */
  line: number
  /** Column number where the error occurred (1-indexed) */
  column: number
  /** The problematic token */
  token?: string
  /** Additional context */
  context?: ErrorContext
}

/**
 * Error thrown when parsing bash syntax fails.
 *
 * @example
 * ```typescript
 * throw new ParseError('Unexpected token', {
 *   input: 'echo "unclosed',
 *   line: 1,
 *   column: 6,
 *   token: '"'
 * })
 * ```
 */
export class ParseError extends BashxError {
  readonly input: string
  readonly line: number
  readonly column: number
  readonly token?: string

  constructor(message: string, options: ParseErrorOptions) {
    let hint = 'Check the bash syntax around the indicated position.'

    if (options.token === '"' || options.token === "'") {
      hint = 'Unclosed quote detected. Ensure all quotes are properly closed.'
    } else if (options.token === '(') {
      hint = 'Unclosed parenthesis. Ensure all parentheses are balanced.'
    }

    super(message, {
      code: 'PARSE_ERROR',
      retryable: false,
      hint,
      context: {
        input: options.input,
        line: options.line,
        column: options.column,
        token: options.token,
        ...options.context,
      },
    })

    this.name = 'ParseError'
    this.input = options.input
    this.line = options.line
    this.column = options.column
    this.token = options.token
  }

  /**
   * Get the error location formatted for display.
   */
  get formattedLocation(): string {
    return `line ${this.line}, column ${this.column}`
  }
}

// ============================================================================
// SafetyBlockedError
// ============================================================================

/**
 * Impact level for safety classification.
 */
export type SafetyImpact = 'low' | 'medium' | 'high' | 'critical'

/**
 * Safety classification for blocked commands.
 */
export interface SafetyClassification {
  type: string
  impact: SafetyImpact
  reversible: boolean
}

/**
 * Options for SafetyBlockedError.
 */
export interface SafetyBlockedErrorOptions {
  /** The command that was blocked */
  command: string
  /** Reason for blocking */
  reason: string
  /** Impact level */
  impact: SafetyImpact
  /** Full safety classification if available */
  classification?: SafetyClassification
  /** Safer alternative command */
  saferAlternative?: string
}

/**
 * Error thrown when the safety gate blocks command execution.
 *
 * @example
 * ```typescript
 * throw new SafetyBlockedError('Command blocked for safety', {
 *   command: 'rm -rf /',
 *   reason: 'destructive operation on root directory',
 *   impact: 'critical',
 *   saferAlternative: 'rm -ri /'
 * })
 * ```
 */
export class SafetyBlockedError extends BashxError {
  readonly command: string
  readonly reason: string
  readonly impact: SafetyImpact
  readonly classification?: SafetyClassification
  readonly saferAlternative?: string

  constructor(message: string, options: SafetyBlockedErrorOptions) {
    let hint = `Command was blocked due to: ${options.reason}. Use { confirm: true } to execute if intentional.`

    if (options.saferAlternative) {
      hint += ` Consider using: ${options.saferAlternative}`
    }

    super(message, {
      code: 'SAFETY_BLOCKED',
      retryable: false,
      hint,
      context: {
        command: options.command,
        reason: options.reason,
        impact: options.impact,
      },
    })

    this.name = 'SafetyBlockedError'
    this.command = options.command
    this.reason = options.reason
    this.impact = options.impact
    this.classification = options.classification
    this.saferAlternative = options.saferAlternative
  }
}

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Type guard to check if a value is a BashxError.
 *
 * @example
 * ```typescript
 * try {
 *   await execute(command)
 * } catch (error) {
 *   if (isBashxError(error)) {
 *     console.log(`Error code: ${error.code}`)
 *   }
 * }
 * ```
 */
export function isBashxError(value: unknown): value is BashxError {
  return value instanceof BashxError
}

// ============================================================================
// fromError Factory
// ============================================================================

/**
 * Safely wrap any thrown value as a BashxError.
 *
 * This replaces the common pattern:
 * ```typescript
 * error instanceof Error ? error.message : String(error)
 * ```
 *
 * With the more structured:
 * ```typescript
 * fromError(error).message
 * ```
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   const bashxError = fromError(error, { command: 'risky-op' })
 *   logger.error(bashxError.toJSON())
 * }
 * ```
 */
export function fromError(
  error: unknown,
  context?: ErrorContext & { code?: ErrorCode }
): BashxError {
  // If already a BashxError, return it directly
  if (error instanceof BashxError) {
    return error
  }

  // Extract message from various error types
  let message: string
  let cause: Error | undefined

  if (error instanceof Error) {
    message = error.message
    cause = error
  } else if (error === null || error === undefined) {
    message = 'Unknown error occurred'
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    message = String((error as { message: unknown }).message)
  } else {
    message = String(error)
  }

  const code = context?.code ?? 'UNKNOWN_ERROR'
  const { code: _, ...contextWithoutCode } = context ?? {}

  return new BashxError(message, {
    code,
    retryable: false,
    context: contextWithoutCode,
    cause,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a message string from any thrown value.
 *
 * This is a drop-in replacement for the common pattern:
 * ```typescript
 * // Old pattern (loses type info, no context):
 * const message = error instanceof Error ? error.message : String(error)
 *
 * // New pattern:
 * const message = getErrorMessage(error)
 * ```
 *
 * @example
 * ```typescript
 * try {
 *   await execute(command)
 * } catch (error) {
 *   return { exitCode: 1, stderr: getErrorMessage(error) }
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error === null || error === undefined) {
    return 'Unknown error occurred'
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Check if an error is retryable.
 *
 * Works with both BashxError instances (checks retryable flag)
 * and standard Error instances (checks for known retryable error codes).
 *
 * @example
 * ```typescript
 * try {
 *   await execute(command)
 * } catch (error) {
 *   if (isRetryableError(error)) {
 *     await delay(1000)
 *     return execute(command) // retry once
 *   }
 *   throw error
 * }
 * ```
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof BashxError) {
    return error.retryable
  }

  // Check for common retryable error codes/names
  const errorWithCode = error as { code?: string; name?: string }
  const code = errorWithCode?.code
  const name = errorWithCode?.name

  // Network errors are typically retryable
  const retryableCodes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EPIPE',
    'EAI_AGAIN',
  ]

  if (code && retryableCodes.includes(code)) {
    return true
  }

  // Rate limit errors are retryable after waiting
  if (name === 'RateLimitError' || code === 'RATE_LIMIT_ERROR') {
    return true
  }

  return false
}
