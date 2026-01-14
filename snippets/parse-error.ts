/**
 * Custom ParseError class for JSONL parsing with line tracking.
 *
 * Provides typed line number access instead of using `(error as any).line`.
 * Used by artifacts-ingest.ts for better error handling.
 *
 * @module snippets/parse-error
 * @see https://github.com/dotdo/dotdo/issues/dotdo-b9dy5
 */

/**
 * Error class for parsing errors that includes line number information.
 *
 * @example
 * ```typescript
 * try {
 *   // parse JSONL
 * } catch (err) {
 *   if (err instanceof ParseError) {
 *     console.log(`Error at line ${err.line}: ${err.message}`)
 *   }
 * }
 * ```
 */
export class ParseError extends Error {
  /**
   * Creates a new ParseError with line tracking.
   *
   * @param message - The error message
   * @param line - The line number where the error occurred (1-indexed)
   */
  constructor(
    message: string,
    public readonly line: number
  ) {
    super(message)
    this.name = 'ParseError'

    // Maintain proper prototype chain for instanceof checks
    // This is necessary for extending built-in classes in TypeScript
    Object.setPrototypeOf(this, ParseError.prototype)
  }
}
