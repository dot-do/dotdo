/**
 * Evaluation Types Module
 *
 * Centralized type definitions for the ai-evaluate integration.
 * These types are used across the CLI, RPC client, and test infrastructure.
 *
 * @module evaluate
 */

// =============================================================================
// Core Evaluation Types
// =============================================================================

/**
 * Log level for console output captured during evaluation.
 * Maps to standard console methods.
 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * A single log entry captured during code evaluation.
 *
 * Log entries are captured from console.* calls made during script execution
 * and forwarded through the RPC response.
 *
 * @example
 * ```ts
 * // Log entry from: console.log('Hello', { name: 'Alice' })
 * const entry: LogEntry = {
 *   level: 'log',
 *   message: 'Hello { name: "Alice" }',
 *   index: 0
 * }
 * ```
 */
export interface LogEntry {
  /** Log level corresponding to console method used */
  level: LogLevel | string
  /** Formatted log message (args joined with spaces) */
  message: string
  /** Sequential index for ordering (optional, used in streaming) */
  index?: number
  /** Original arguments passed to console method (optional) */
  args?: unknown[]
}

/**
 * Result of code evaluation via RPC.
 *
 * This interface represents the response from the DO after executing
 * code using ai-evaluate in a sandboxed environment.
 *
 * @example
 * ```ts
 * // Successful evaluation
 * const result: EvaluateResult = {
 *   success: true,
 *   value: { $id: 'cust_123', name: 'Alice' },
 *   logs: [{ level: 'log', message: 'Created customer' }]
 * }
 *
 * // Failed evaluation
 * const error: EvaluateResult = {
 *   success: false,
 *   error: 'ReferenceError: x is not defined',
 *   logs: []
 * }
 * ```
 */
export interface EvaluateResult {
  /** Whether evaluation succeeded without throwing */
  success: boolean
  /** Return value on success (undefined if void or error) */
  value?: unknown
  /** Error message on failure (includes stack trace when available) */
  error?: string
  /** Log entries captured during evaluation */
  logs: LogEntry[]
  /** Execution duration in milliseconds (optional) */
  duration?: number
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for evaluation failures.
 * These help categorize errors for better error handling and user feedback.
 */
export type EvaluateErrorCode =
  | 'SYNTAX_ERROR'       // Code has syntax errors
  | 'RUNTIME_ERROR'      // Error thrown during execution
  | 'TIMEOUT'            // Execution exceeded time limit
  | 'SECURITY_VIOLATION' // Attempted to access blocked API
  | 'NETWORK_BLOCKED'    // Network access denied
  | 'NOT_CONNECTED'      // RPC client not connected
  | 'RPC_ERROR'          // RPC transport error
  | 'UNKNOWN'            // Unclassified error

/**
 * Extended error type for evaluation failures.
 *
 * Provides structured error information beyond simple message strings,
 * enabling better error handling and user-facing messages.
 */
export interface EvaluateError extends Error {
  /** Error category code */
  code: EvaluateErrorCode
  /** Original error message */
  message: string
  /** Line number where error occurred (if available) */
  line?: number
  /** Column number where error occurred (if available) */
  column?: number
  /** Stack trace (if available) */
  stack?: string
  /** Logs captured before the error */
  logs?: LogEntry[]
}

/**
 * Create an EvaluateError from a plain error or message.
 *
 * @param error - The source error or message string
 * @param code - Error category code (default: 'UNKNOWN')
 * @param logs - Any logs captured before the error
 * @returns Structured EvaluateError
 *
 * @example
 * ```ts
 * const err = createEvaluateError('x is not defined', 'RUNTIME_ERROR')
 * console.log(err.code) // 'RUNTIME_ERROR'
 * ```
 */
export function createEvaluateError(
  error: Error | string,
  code: EvaluateErrorCode = 'UNKNOWN',
  logs: LogEntry[] = []
): EvaluateError {
  const message = typeof error === 'string' ? error : error.message
  const evalError = new Error(message) as EvaluateError
  evalError.code = code
  evalError.logs = logs

  if (typeof error !== 'string') {
    evalError.stack = error.stack
  }

  // Parse line/column from common error formats
  const lineMatch = message.match(/line (\d+)/i)
  const columnMatch = message.match(/column (\d+)/i)
  if (lineMatch?.[1]) evalError.line = parseInt(lineMatch[1], 10)
  if (columnMatch?.[1]) evalError.column = parseInt(columnMatch[1], 10)

  return evalError
}

/**
 * Classify an error message into an EvaluateErrorCode.
 *
 * @param message - Error message to classify
 * @returns Appropriate error code
 */
export function classifyError(message: string): EvaluateErrorCode {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('syntaxerror')) return 'SYNTAX_ERROR'
  if (lowerMessage.includes('timeout')) return 'TIMEOUT'
  if (lowerMessage.includes('not connected')) return 'NOT_CONNECTED'
  if (lowerMessage.includes('network') && lowerMessage.includes('block')) return 'NETWORK_BLOCKED'
  if (
    lowerMessage.includes('process is not defined') ||
    lowerMessage.includes('require is not defined') ||
    lowerMessage.includes('not allowed')
  ) {
    return 'SECURITY_VIOLATION'
  }
  if (
    lowerMessage.includes('referenceerror') ||
    lowerMessage.includes('typeerror') ||
    lowerMessage.includes('rangeerror')
  ) {
    return 'RUNTIME_ERROR'
  }

  return 'UNKNOWN'
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Handle for streaming evaluation with log callbacks.
 *
 * Allows subscribing to log messages as they arrive during evaluation,
 * rather than waiting for the complete result.
 *
 * @example
 * ```ts
 * const handle = client.evaluateStreaming('longRunningCode()')
 * handle.onLog(log => console.log(`[${log.level}] ${log.message}`))
 * const result = await handle.result
 * ```
 */
export interface StreamingEvaluation {
  /** Subscribe to logs as they arrive */
  onLog: (callback: (log: LogEntry) => void) => void
  /** Promise for the final result */
  result: Promise<EvaluateResult>
}

/**
 * Callback for receiving log messages.
 */
export type LogCallback = (level: string, message: string) => void

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Default timeout for evaluation in milliseconds.
 */
export const DEFAULT_EVAL_TIMEOUT = 5000

/**
 * Configuration options for evaluation.
 *
 * These options are passed through the RPC to configure the ai-evaluate
 * sandbox environment.
 */
export interface EvaluateOptions {
  /** Execution timeout in milliseconds (default: 5000) */
  timeout?: number
  /** Environment variables available in the sandbox */
  env?: Record<string, string>
  /** Allow network access (fetch) - default: false */
  allowNetwork?: boolean
}

/**
 * Extended options for SDK-enabled evaluation.
 *
 * When sdk is provided, the $ context will be available in the evaluated code.
 */
export interface EvaluateWithSdkOptions extends EvaluateOptions {
  /** SDK configuration for $ context */
  sdk?: {
    /** RPC URL for $ proxy (e.g., 'wss://tenant.api.dotdo.dev') */
    rpcUrl: string
  }
}

// =============================================================================
// REPL Integration Types
// =============================================================================

/**
 * Function type for the evaluate API.
 *
 * This is the signature expected by REPL and test infrastructure.
 */
export type EvaluateFn = (code: string, options?: EvaluateOptions) => Promise<EvaluateResult>

/**
 * Options for creating a REPL instance.
 */
export interface ReplOptions {
  /** Evaluate function to use for code execution */
  evaluate: EvaluateFn
  /** RPC endpoint URL for $ context */
  endpoint?: string
  /** Callback for output display */
  onOutput?: LogCallback
}

/**
 * Result from REPL execution (simplified view of EvaluateResult).
 */
export interface ReplResult {
  /** Whether execution succeeded */
  success: boolean
  /** Return value on success */
  value?: unknown
  /** Error message on failure */
  error?: string
}

/**
 * REPL interface for code execution.
 */
export interface Repl {
  /** Execute code and return result */
  execute(code: string): Promise<ReplResult>
  /** Clean up resources */
  close(): void
}

// =============================================================================
// Output Type Mapping
// =============================================================================

/**
 * Output types for REPL display.
 * These map to visual styles in the Output component.
 */
export type OutputType = 'input' | 'result' | 'info' | 'warning' | 'error' | 'system'

/**
 * Map log levels to REPL output types.
 *
 * @example
 * ```ts
 * const outputType = LOG_LEVEL_TO_OUTPUT_TYPE['warn'] // 'warning'
 * ```
 */
export const LOG_LEVEL_TO_OUTPUT_TYPE: Record<LogLevel | string, OutputType> = {
  log: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
  debug: 'info',
}
