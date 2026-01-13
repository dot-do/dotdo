/**
 * DOError hierarchy - structured errors for the dotdo runtime
 *
 * All errors extend DOError and provide:
 * - code: Machine-readable error code
 * - message: Human-readable description
 * - cause: Optional underlying error
 * - httpStatus: Corresponding HTTP status code
 * - toJSON(): Serialization for logging/transport
 */

export interface DOErrorJSON {
  name: string
  code: string
  message: string
  cause?: DOErrorJSON | { name: string; message: string }
}

/**
 * Base error class for all dotdo errors.
 * Provides structured error information with optional cause chaining.
 */
export class DOError extends Error {
  public readonly code: string
  public override readonly cause?: Error

  constructor(code: string, message: string, cause?: Error) {
    super(message)
    this.code = code
    this.cause = cause
    this.name = 'DOError'

    // Capture stack trace properly for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * HTTP status code for this error type.
   * Override in subclasses for specific status codes.
   */
  get httpStatus(): number {
    return 500
  }

  /**
   * Serialize the error for JSON transport/logging.
   * Does not include stack trace or httpStatus in output.
   */
  toJSON(): DOErrorJSON {
    const json: DOErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
    }

    if (this.cause !== undefined && this.cause !== null) {
      if (this.cause instanceof DOError) {
        json.cause = this.cause.toJSON()
      } else if (this.cause instanceof Error) {
        json.cause = {
          name: this.cause.name,
          message: this.cause.message,
        }
      }
    }

    return json
  }
}

/**
 * Validation error - invalid input or data format.
 * HTTP 400 Bad Request.
 */
export class ValidationError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'ValidationError'
  }

  override get httpStatus(): number {
    return 400
  }
}

/**
 * Not found error - resource does not exist.
 * HTTP 404 Not Found.
 */
export class NotFoundError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'NotFoundError'
  }

  override get httpStatus(): number {
    return 404
  }
}

/**
 * Authorization error - access denied.
 * HTTP 403 Forbidden.
 */
export class AuthorizationError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'AuthorizationError'
  }

  override get httpStatus(): number {
    return 403
  }
}

/**
 * Timeout error - operation exceeded time limit.
 * HTTP 408 Request Timeout.
 */
export class TimeoutError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'TimeoutError'
  }

  override get httpStatus(): number {
    return 408
  }
}

/**
 * Transport error - RPC or network failure.
 * HTTP 502 Bad Gateway.
 */
export class TransportError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'TransportError'
  }

  override get httpStatus(): number {
    return 502
  }
}

/**
 * Options for creating a ParseError with full context.
 */
export interface ParseErrorOptions {
  /** The line number where the error occurred (1-indexed) */
  line: number
  /** The column position where the error occurred (1-indexed, optional) */
  column?: number
  /** The source file path or identifier (optional) */
  source?: string
  /** The full source content for context extraction (optional) */
  sourceContent?: string
  /** The underlying error that caused this parse error (optional) */
  cause?: Error
}

/**
 * Parse error - input parsing failed with location tracking.
 * HTTP 400 Bad Request.
 *
 * Provides typed error information for parsing failures instead of
 * using `(error as any).line = lineNumber` casting pattern.
 *
 * Features:
 * - Line number tracking (1-indexed)
 * - Column position tracking (1-indexed)
 * - Source file reference
 * - Error context extraction (shows surrounding lines with caret)
 *
 * @example
 * ```typescript
 * // Simple usage with just line number
 * throw new ParseError('Unexpected token', { line: 5 })
 *
 * // Full context with column and source
 * throw new ParseError('Invalid JSON', {
 *   line: 10,
 *   column: 15,
 *   source: 'config.json',
 *   sourceContent: fileContents
 * })
 *
 * // Type-safe catch handling
 * try {
 *   parseDocument(input)
 * } catch (err) {
 *   if (err instanceof ParseError) {
 *     console.log(`Error at ${err.source}:${err.line}:${err.column}`)
 *     console.log(err.context)
 *   }
 * }
 * ```
 *
 * @see https://github.com/dotdo/dotdo/issues/dotdo-b9dy5
 */
export class ParseError extends DOError {
  /** The line number where the error occurred (1-indexed) */
  public readonly line: number

  /** The column position where the error occurred (1-indexed, or undefined if not available) */
  public readonly column: number | undefined

  /** The source file path or identifier (or undefined if not provided) */
  public readonly source: string | undefined

  /** The extracted context showing surrounding lines with error indicator */
  public readonly context: string | undefined

  /**
   * Creates a new ParseError with location tracking.
   *
   * @param message - The error message describing what went wrong
   * @param options - Location and context options
   */
  constructor(message: string, options: ParseErrorOptions) {
    const { line, column, source, sourceContent, cause } = options

    // Build the error code with location info
    const code = 'PARSE_ERROR'

    // Build location string for the full message
    const locationParts: string[] = []
    if (source) locationParts.push(source)
    locationParts.push(`line ${line}`)
    if (column !== undefined) locationParts.push(`column ${column}`)
    const location = locationParts.join(':')

    // Extract context if source content is provided
    const context = sourceContent
      ? ParseError.extractContext(sourceContent, line, column)
      : undefined

    // Build full message with location and optional context
    const fullMessage = context
      ? `${message} at ${location}\n${context}`
      : `${message} at ${location}`

    super(code, fullMessage, cause)
    this.name = 'ParseError'

    this.line = line
    this.column = column
    this.source = source
    this.context = context

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ParseError.prototype)
  }

  /**
   * HTTP status code for parse errors.
   * Returns 400 Bad Request as parsing failures are client input errors.
   */
  override get httpStatus(): number {
    return 400
  }

  /**
   * Serialize the error for JSON transport/logging.
   * Includes location information in the output.
   */
  override toJSON() {
    return {
      ...super.toJSON(),
      line: this.line,
      column: this.column,
      source: this.source,
    }
  }

  /**
   * Extract source context around the error location.
   * Shows the error line with surrounding context and a caret pointing to the column.
   *
   * @param sourceContent - The full source content
   * @param line - The error line number (1-indexed)
   * @param column - The error column number (1-indexed, optional)
   * @returns Formatted context string with line numbers and error indicator
   */
  static extractContext(
    sourceContent: string,
    line: number,
    column?: number
  ): string {
    const lines = sourceContent.split('\n')

    // Validate line number
    if (line < 1 || line > lines.length) {
      return ''
    }

    const result: string[] = []

    // Determine the range of lines to show (1 line before and after)
    const startLine = Math.max(1, line - 1)
    const endLine = Math.min(lines.length, line + 1)

    // Calculate padding width for line numbers
    const maxLineNum = endLine
    const padWidth = String(maxLineNum).length

    for (let i = startLine; i <= endLine; i++) {
      const lineNum = String(i).padStart(padWidth, ' ')
      const marker = i === line ? '>' : ' '
      result.push(`${marker} ${lineNum} | ${lines[i - 1]}`)

      // Add caret pointing to error column if this is the error line
      if (i === line && column !== undefined && column >= 1) {
        // Calculate padding: marker + space + line number + space + pipe + space
        const prefixLength = 1 + 1 + padWidth + 1 + 1 + 1
        const caretPadding = ' '.repeat(prefixLength + column - 1)
        result.push(`${caretPadding}^`)
      }
    }

    return result.join('\n')
  }

  /**
   * Create a ParseError from a JSON parsing failure.
   * Convenience factory for common JSON.parse error handling.
   *
   * @param error - The original error from JSON.parse
   * @param line - The line number being parsed
   * @param source - Optional source file reference
   * @returns A new ParseError with proper context
   */
  static fromJSONError(
    error: unknown,
    line: number,
    source?: string
  ): ParseError {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    return new ParseError(message, { line, source, cause: error instanceof Error ? error : undefined })
  }
}
