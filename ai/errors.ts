/**
 * AI Error Classes for @dotdo/ai
 *
 * Provides a hierarchy of typed errors for AI operations:
 * - AIError: Base class for all AI-related errors
 * - AIModelResolutionError: Model cannot be resolved
 * - AIProviderError: Provider returned an error (with retry detection)
 * - AIGenerationError: Text generation failed
 * - AIObjectGenerationError: Object generation failed
 * - AIEmbeddingError: Embedding generation failed
 * - AIStreamError: Streaming failed
 * - MockModelNotAllowedError: Mock model used but not permitted
 *
 * @module @dotdo/ai/errors
 */

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for AI operations.
 * All AI-related errors extend from this class.
 */
export class AIError extends Error {
  /** The operation that was being performed */
  readonly operation: string
  /** The model being used (if applicable) */
  readonly model?: string
  /** The underlying cause of the error */
  readonly cause?: Error

  constructor(message: string, options: { operation: string; model?: string; cause?: Error }) {
    super(message)
    this.name = 'AIError'
    this.operation = options.operation
    if (options.model !== undefined) {
      this.model = options.model
    }
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
    // Maintain proper stack trace (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AIError)
    }
  }
}

// ============================================================================
// Model Resolution Errors
// ============================================================================

/**
 * Error thrown when a model cannot be resolved.
 */
export class AIModelResolutionError extends AIError {
  constructor(modelId: string, cause?: Error) {
    // Build options with only defined values to satisfy exactOptionalPropertyTypes
    const opts: { operation: string; model: string; cause?: Error } = {
      operation: 'resolveModel',
      model: modelId,
    }
    if (cause !== undefined) {
      opts.cause = cause
    }
    super(
      `Failed to resolve model "${modelId}"${cause ? `: ${cause.message}` : ''}`,
      opts
    )
    this.name = 'AIModelResolutionError'
  }
}

/**
 * Error thrown when mock model is used but not allowed
 */
export class MockModelNotAllowedError extends Error {
  constructor(modelId: string) {
    super(
      `Mock model not allowed for "${modelId}". ` +
      `ai-providers module is not installed and mock models are disabled. ` +
      `Either install ai-providers or set configureMockModel({ allowMock: true }) for testing.`
    )
    this.name = 'MockModelNotAllowedError'
  }
}

// ============================================================================
// Provider Errors
// ============================================================================

/**
 * Error thrown when the AI provider returns an error.
 */
export class AIProviderError extends AIError {
  /** HTTP status code from the provider (if applicable) */
  readonly status?: number
  /** Error code from the provider (if applicable) */
  readonly code?: string
  /** Whether this error is retryable */
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      operation: string
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, options)
    this.name = 'AIProviderError'
    if (options.status !== undefined) {
      this.status = options.status
    }
    if (options.code !== undefined) {
      this.code = options.code
    }
    this.retryable = options.retryable ?? false
  }

  /**
   * Check if an error from the provider is retryable.
   */
  static isRetryable(error: Error & { status?: number; code?: string }): boolean {
    // Rate limit errors are retryable
    if (error.status === 429) return true

    // Server errors are generally retryable
    if (error.status !== undefined && error.status >= 500 && error.status < 600) return true

    // Check error codes
    const code = error.code?.toLowerCase()
    if (code === 'rate_limit_exceeded' || code === 'overloaded' || code === 'server_error') {
      return true
    }

    // Check error message for transient conditions
    const message = error.message?.toLowerCase() || ''
    const transientPatterns = [
      'rate limit',
      'too many requests',
      'overloaded',
      'timeout',
      'econnreset',
      'socket hang up',
      'network error',
    ]
    return transientPatterns.some(p => message.includes(p))
  }
}

// ============================================================================
// Operation-Specific Errors
// ============================================================================

/**
 * Error thrown when text generation fails.
 */
export class AIGenerationError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'generateText' })
    this.name = 'AIGenerationError'
  }
}

/**
 * Error thrown when object generation fails.
 */
export class AIObjectGenerationError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'generateObject' })
    this.name = 'AIObjectGenerationError'
  }
}

/**
 * Error thrown when embedding generation fails.
 */
export class AIEmbeddingError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'embedText' })
    this.name = 'AIEmbeddingError'
  }
}

/**
 * Error thrown when streaming fails.
 */
export class AIStreamError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'streamText' })
    this.name = 'AIStreamError'
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Extract error details from a provider error.
 * Returns an object that can be safely used with exactOptionalPropertyTypes.
 */
export function extractErrorDetails(error: unknown): { status?: number; code?: string; message: string } {
  if (error instanceof Error) {
    const err = error as Error & { status?: number; code?: string; statusCode?: number }
    const result: { status?: number; code?: string; message: string } = {
      message: err.message,
    }
    const status = err.status ?? err.statusCode
    if (status !== undefined) {
      result.status = status
    }
    if (err.code !== undefined) {
      result.code = err.code
    }
    return result
  }
  return { message: String(error) }
}

/**
 * Build error options from extracted details for use with exactOptionalPropertyTypes.
 */
export function buildErrorOptions(
  modelName: string,
  cause: Error,
  details: { status?: number; code?: string; message: string }
): {
  model: string
  cause: Error
  status?: number
  code?: string
  retryable: boolean
} {
  const opts: {
    model: string
    cause: Error
    status?: number
    code?: string
    retryable: boolean
  } = {
    model: modelName,
    cause,
    retryable: AIProviderError.isRetryable(cause as Error & { status?: number; code?: string }),
  }
  if (details.status !== undefined) {
    opts.status = details.status
  }
  if (details.code !== undefined) {
    opts.code = details.code
  }
  return opts
}
