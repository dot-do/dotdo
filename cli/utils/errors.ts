/**
 * CLI Error Handling Utilities
 *
 * Provides a unified error type hierarchy, standardized exit codes,
 * and structured error output for machine consumption.
 *
 * Error Categories:
 * - CLIError: Base class for all CLI errors
 * - AuthError: Authentication/authorization failures
 * - ValidationError: Invalid input or configuration
 * - NetworkError: Connection/network failures
 * - SandboxError: Code execution failures
 * - MCPError: MCP protocol failures
 * - CommandError: Command execution failures
 *
 * Exit Codes:
 * - 0: Success
 * - 1: General error
 * - 2: Misuse (invalid arguments/options)
 * - 3: Authentication required
 * - 4: Authorization denied
 * - 5: Network/connection error
 * - 6: Rate limited
 * - 7: Resource not found
 * - 8: Timeout
 * - 9: Sandbox/execution error
 * - 10: Configuration error
 */

// ============================================================================
// Exit Codes
// ============================================================================

export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  MISUSE: 2,
  AUTH_REQUIRED: 3,
  AUTH_DENIED: 4,
  NETWORK_ERROR: 5,
  RATE_LIMITED: 6,
  NOT_FOUND: 7,
  TIMEOUT: 8,
  SANDBOX_ERROR: 9,
  CONFIG_ERROR: 10,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

// ============================================================================
// Error Codes (for structured output)
// ============================================================================

export const ErrorCode = {
  // General
  UNKNOWN: 'unknown_error',
  INTERNAL: 'internal_error',

  // Authentication
  AUTH_REQUIRED: 'auth_required',
  AUTH_EXPIRED: 'auth_expired',
  AUTH_DENIED: 'auth_denied',
  AUTH_INVALID: 'auth_invalid',

  // Validation
  INVALID_ARGUMENT: 'invalid_argument',
  MISSING_ARGUMENT: 'missing_argument',
  INVALID_OPTION: 'invalid_option',
  MISSING_OPTION: 'missing_option',
  INVALID_FORMAT: 'invalid_format',

  // Network
  NETWORK_ERROR: 'network_error',
  CONNECTION_FAILED: 'connection_failed',
  DNS_ERROR: 'dns_error',
  TIMEOUT: 'timeout',

  // API
  API_ERROR: 'api_error',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  SERVER_ERROR: 'server_error',

  // Sandbox
  SANDBOX_ERROR: 'sandbox_error',
  TRANSFORM_ERROR: 'transform_error',
  EXECUTION_ERROR: 'execution_error',
  EXECUTION_TIMEOUT: 'execution_timeout',

  // MCP
  MCP_ERROR: 'mcp_error',
  MCP_TRANSPORT_ERROR: 'mcp_transport_error',
  MCP_PROTOCOL_ERROR: 'mcp_protocol_error',
  MCP_TOOL_ERROR: 'mcp_tool_error',

  // Configuration
  CONFIG_NOT_FOUND: 'config_not_found',
  CONFIG_INVALID: 'config_invalid',
  CONFIG_PARSE_ERROR: 'config_parse_error',

  // Command
  COMMAND_FAILED: 'command_failed',
  COMMAND_NOT_FOUND: 'command_not_found',
  SPAWN_ERROR: 'spawn_error',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

// ============================================================================
// Structured Error Output
// ============================================================================

export interface StructuredError {
  error: {
    code: ErrorCodeValue
    message: string
    exitCode: ExitCodeValue
    details?: Record<string, unknown>
    hint?: string
    cause?: string
  }
}

// ============================================================================
// Base CLI Error
// ============================================================================

export interface CLIErrorOptions {
  code?: ErrorCodeValue
  exitCode?: ExitCodeValue
  details?: Record<string, unknown>
  hint?: string
  cause?: Error
}

/**
 * Base class for all CLI errors.
 *
 * Provides structured error information including:
 * - Machine-readable error code
 * - Exit code for process termination
 * - Optional details and hints for resolution
 */
export class CLIError extends Error {
  readonly code: ErrorCodeValue
  readonly exitCode: ExitCodeValue
  readonly details?: Record<string, unknown>
  readonly hint?: string

  constructor(message: string, options: CLIErrorOptions = {}) {
    super(message)
    this.name = 'CLIError'
    this.code = options.code ?? ErrorCode.UNKNOWN
    this.exitCode = options.exitCode ?? ExitCode.ERROR
    this.details = options.details
    this.hint = options.hint
    if (options.cause) {
      this.cause = options.cause
    }
  }

  /**
   * Convert to structured JSON format for machine consumption
   */
  toJSON(): StructuredError {
    return {
      error: {
        code: this.code,
        message: this.message,
        exitCode: this.exitCode,
        ...(this.details && { details: this.details }),
        ...(this.hint && { hint: this.hint }),
        ...(this.cause && { cause: (this.cause as Error).message }),
      },
    }
  }

  /**
   * Format error for human-readable CLI output
   */
  format(useColors = true): string {
    const red = useColors ? '\x1b[31m' : ''
    const dim = useColors ? '\x1b[2m' : ''
    const reset = useColors ? '\x1b[0m' : ''

    let output = `${red}Error:${reset} ${this.message}`

    if (this.hint) {
      output += `\n${dim}Hint: ${this.hint}${reset}`
    }

    if (this.details && Object.keys(this.details).length > 0) {
      const detailsStr = Object.entries(this.details)
        .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')
      output += `\n${dim}Details:\n${detailsStr}${reset}`
    }

    return output
  }
}

// ============================================================================
// Authentication Errors
// ============================================================================

export interface AuthErrorOptions extends CLIErrorOptions {
  expired?: boolean
}

/**
 * Error for authentication/authorization failures.
 */
export class AuthError extends CLIError {
  readonly expired: boolean

  constructor(message: string, options: AuthErrorOptions = {}) {
    super(message, {
      code: options.expired ? ErrorCode.AUTH_EXPIRED : options.code ?? ErrorCode.AUTH_REQUIRED,
      exitCode: options.exitCode ?? ExitCode.AUTH_REQUIRED,
      details: options.details,
      hint: options.hint ?? 'Run `dotdo login` to authenticate.',
      cause: options.cause,
    })
    this.name = 'AuthError'
    this.expired = options.expired ?? false
  }

  static notLoggedIn(): AuthError {
    return new AuthError('Not logged in.', {
      code: ErrorCode.AUTH_REQUIRED,
      hint: 'Run `dotdo login` first.',
    })
  }

  static expired(): AuthError {
    return new AuthError('Session expired.', {
      expired: true,
      hint: 'Run `dotdo login` to re-authenticate.',
    })
  }

  static denied(reason?: string): AuthError {
    return new AuthError(reason ?? 'Access denied.', {
      code: ErrorCode.AUTH_DENIED,
      exitCode: ExitCode.AUTH_DENIED,
      hint: 'Check your permissions or contact an administrator.',
    })
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

export interface ValidationErrorOptions extends CLIErrorOptions {
  argument?: string
  expected?: string
  received?: string
}

/**
 * Error for invalid input or configuration.
 */
export class ValidationError extends CLIError {
  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.INVALID_ARGUMENT,
      exitCode: options.exitCode ?? ExitCode.MISUSE,
      details: {
        ...(options.argument && { argument: options.argument }),
        ...(options.expected && { expected: options.expected }),
        ...(options.received && { received: options.received }),
        ...options.details,
      },
      hint: options.hint,
      cause: options.cause,
    })
    this.name = 'ValidationError'
  }

  static invalidArgument(name: string, expected: string, received?: string): ValidationError {
    return new ValidationError(`Invalid argument: ${name}`, {
      code: ErrorCode.INVALID_ARGUMENT,
      argument: name,
      expected,
      received,
      hint: `Expected: ${expected}`,
    })
  }

  static missingArgument(name: string, description?: string): ValidationError {
    return new ValidationError(`Missing required argument: ${name}`, {
      code: ErrorCode.MISSING_ARGUMENT,
      argument: name,
      hint: description,
    })
  }

  static invalidOption(name: string, expected: string, received?: string): ValidationError {
    return new ValidationError(`Invalid option: --${name}`, {
      code: ErrorCode.INVALID_OPTION,
      argument: name,
      expected,
      received,
      hint: `Expected: ${expected}`,
    })
  }

  static missingOption(name: string, description?: string): ValidationError {
    return new ValidationError(`Missing required option: --${name}`, {
      code: ErrorCode.MISSING_OPTION,
      argument: name,
      hint: description,
    })
  }

  static invalidFormat(field: string, expected: string, received?: string): ValidationError {
    return new ValidationError(`Invalid format for ${field}`, {
      code: ErrorCode.INVALID_FORMAT,
      argument: field,
      expected,
      received,
    })
  }

  static invalidPort(value: string): ValidationError {
    return new ValidationError(`Invalid port: "${value}"`, {
      code: ErrorCode.INVALID_FORMAT,
      argument: 'port',
      expected: 'number between 1 and 65535',
      received: value,
    })
  }

  static invalidPhoneNumber(value: string): ValidationError {
    return new ValidationError(`Invalid phone number format`, {
      code: ErrorCode.INVALID_FORMAT,
      argument: 'phone',
      expected: 'E.164 format (e.g., +15551234567)',
      received: value,
    })
  }

  static invalidEmail(value: string): ValidationError {
    return new ValidationError(`Invalid email address format`, {
      code: ErrorCode.INVALID_FORMAT,
      argument: 'email',
      expected: 'valid email address',
      received: value,
    })
  }

  static invalidJSON(field: string, value?: string): ValidationError {
    return new ValidationError(`Invalid JSON for ${field}`, {
      code: ErrorCode.INVALID_FORMAT,
      argument: field,
      expected: 'valid JSON',
      received: value,
    })
  }
}

// ============================================================================
// Network Errors
// ============================================================================

export interface NetworkErrorOptions extends CLIErrorOptions {
  url?: string
  status?: number
  retryAfter?: number
}

/**
 * Error for network/connection failures.
 */
export class NetworkError extends CLIError {
  readonly url?: string
  readonly status?: number
  readonly retryAfter?: number

  constructor(message: string, options: NetworkErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.NETWORK_ERROR,
      exitCode: options.exitCode ?? ExitCode.NETWORK_ERROR,
      details: {
        ...(options.url && { url: options.url }),
        ...(options.status && { status: options.status }),
        ...options.details,
      },
      hint: options.hint ?? 'Check your network connection and try again.',
      cause: options.cause,
    })
    this.name = 'NetworkError'
    this.url = options.url
    this.status = options.status
    this.retryAfter = options.retryAfter
  }

  static connectionFailed(url?: string, cause?: Error): NetworkError {
    return new NetworkError('Connection failed', {
      code: ErrorCode.CONNECTION_FAILED,
      url,
      cause,
    })
  }

  static timeout(url?: string, timeoutMs?: number): NetworkError {
    return new NetworkError('Request timed out', {
      code: ErrorCode.TIMEOUT,
      exitCode: ExitCode.TIMEOUT,
      url,
      details: timeoutMs ? { timeoutMs } : undefined,
      hint: 'The server took too long to respond. Try again later.',
    })
  }

  static rateLimited(retryAfter?: number): NetworkError {
    return new NetworkError('Rate limit exceeded', {
      code: ErrorCode.RATE_LIMITED,
      exitCode: ExitCode.RATE_LIMITED,
      retryAfter,
      hint: retryAfter
        ? `Try again in ${retryAfter} seconds.`
        : 'Please wait before making more requests.',
    })
  }

  static httpError(status: number, message?: string, url?: string): NetworkError {
    const msg = message ?? `HTTP ${status} error`
    let code: ErrorCodeValue = ErrorCode.API_ERROR
    let exitCode: ExitCodeValue = ExitCode.ERROR

    if (status === 401) {
      code = ErrorCode.AUTH_REQUIRED
      exitCode = ExitCode.AUTH_REQUIRED
    } else if (status === 403) {
      code = ErrorCode.AUTH_DENIED
      exitCode = ExitCode.AUTH_DENIED
    } else if (status === 404) {
      code = ErrorCode.NOT_FOUND
      exitCode = ExitCode.NOT_FOUND
    } else if (status === 429) {
      code = ErrorCode.RATE_LIMITED
      exitCode = ExitCode.RATE_LIMITED
    } else if (status >= 500) {
      code = ErrorCode.SERVER_ERROR
    }

    return new NetworkError(msg, {
      code,
      exitCode,
      status,
      url,
    })
  }

  /**
   * Create error for when a service is unreachable.
   * Used when workers.do or other backend services cannot be contacted.
   */
  static serviceUnavailable(service: string, url?: string, cause?: Error): NetworkError {
    return new NetworkError(`Unable to connect to ${service}`, {
      code: ErrorCode.CONNECTION_FAILED,
      url,
      cause,
      hint: `Check your internet connection or try again later. If the problem persists, ${service} may be temporarily unavailable.`,
    })
  }

  /**
   * Check if an error indicates a network/connection failure.
   * Useful for determining if fallback behavior should be triggered.
   */
  static isNetworkError(error: unknown): boolean {
    if (error instanceof NetworkError) {
      return true
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes('fetch failed') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('etimedout') ||
        message.includes('econnreset') ||
        message.includes('bad rpc message') ||
        message.includes('unable to connect')
      )
    }
    return false
  }
}

// ============================================================================
// Sandbox Errors
// ============================================================================

export interface SandboxErrorOptions extends CLIErrorOptions {
  fileType?: string
  line?: number
  column?: number
}

/**
 * Error for code sandbox execution failures.
 */
export class SandboxError extends CLIError {
  constructor(message: string, options: SandboxErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.SANDBOX_ERROR,
      exitCode: options.exitCode ?? ExitCode.SANDBOX_ERROR,
      details: {
        ...(options.fileType && { fileType: options.fileType }),
        ...(options.line && { line: options.line }),
        ...(options.column && { column: options.column }),
        ...options.details,
      },
      hint: options.hint,
      cause: options.cause,
    })
    this.name = 'SandboxError'
  }

  static transformFailed(fileType: string, cause?: Error): SandboxError {
    return new SandboxError('Failed to transform code', {
      code: ErrorCode.TRANSFORM_ERROR,
      fileType,
      cause,
      hint: 'Check your code syntax.',
    })
  }

  static executionFailed(message: string, cause?: Error): SandboxError {
    return new SandboxError(message, {
      code: ErrorCode.EXECUTION_ERROR,
      cause,
    })
  }

  static executionTimeout(timeoutMs: number): SandboxError {
    return new SandboxError('Execution timeout exceeded', {
      code: ErrorCode.EXECUTION_TIMEOUT,
      exitCode: ExitCode.TIMEOUT,
      details: { timeoutMs },
      hint: 'Your code took too long to execute.',
    })
  }

  static disposed(): SandboxError {
    return new SandboxError('Sandbox has been disposed', {
      code: ErrorCode.SANDBOX_ERROR,
    })
  }
}

// ============================================================================
// MCP Errors
// ============================================================================

export interface MCPErrorOptions extends CLIErrorOptions {
  jsonRpcCode?: number
  targetUrl?: string
}

/**
 * Error for MCP protocol failures.
 */
export class MCPError extends CLIError {
  readonly jsonRpcCode?: number
  readonly targetUrl?: string

  constructor(message: string, options: MCPErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.MCP_ERROR,
      exitCode: options.exitCode ?? ExitCode.ERROR,
      details: {
        ...(options.jsonRpcCode && { jsonRpcCode: options.jsonRpcCode }),
        ...(options.targetUrl && { targetUrl: options.targetUrl }),
        ...options.details,
      },
      hint: options.hint,
      cause: options.cause,
    })
    this.name = 'MCPError'
    this.jsonRpcCode = options.jsonRpcCode
    this.targetUrl = options.targetUrl
  }

  static parseError(cause?: Error): MCPError {
    return new MCPError('Failed to parse JSON', {
      code: ErrorCode.MCP_PROTOCOL_ERROR,
      jsonRpcCode: -32700,
      cause,
    })
  }

  static invalidRequest(message?: string): MCPError {
    return new MCPError(message ?? 'Invalid request', {
      code: ErrorCode.MCP_PROTOCOL_ERROR,
      jsonRpcCode: -32600,
    })
  }

  static methodNotFound(method?: string): MCPError {
    return new MCPError(method ? `Method not found: ${method}` : 'Method not found', {
      code: ErrorCode.MCP_PROTOCOL_ERROR,
      jsonRpcCode: -32601,
    })
  }

  static transportClosed(): MCPError {
    return new MCPError('Transport is closed', {
      code: ErrorCode.MCP_TRANSPORT_ERROR,
    })
  }

  static notConfigured(): MCPError {
    return new MCPError('DO_URL not configured', {
      code: ErrorCode.CONFIG_NOT_FOUND,
      exitCode: ExitCode.CONFIG_ERROR,
      hint: 'Set the DO_URL environment variable or provide the --url option.',
    })
  }

  static invalidUrl(url: string): MCPError {
    return new MCPError('Invalid URL format', {
      code: ErrorCode.INVALID_FORMAT,
      exitCode: ExitCode.MISUSE,
      details: { url },
    })
  }

  static toolNotFound(name: string): MCPError {
    return new MCPError(`Tool not found: ${name}`, {
      code: ErrorCode.MCP_TOOL_ERROR,
      jsonRpcCode: -32601,
    })
  }
}

// ============================================================================
// Command Errors
// ============================================================================

export interface CommandErrorOptions extends CLIErrorOptions {
  command?: string
  args?: string[]
  exitCode?: ExitCodeValue
}

/**
 * Error for command execution failures.
 */
export class CommandError extends CLIError {
  readonly command?: string
  readonly args?: string[]

  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.COMMAND_FAILED,
      exitCode: options.exitCode ?? ExitCode.ERROR,
      details: {
        ...(options.command && { command: options.command }),
        ...(options.args && { args: options.args }),
        ...options.details,
      },
      hint: options.hint,
      cause: options.cause,
    })
    this.name = 'CommandError'
    this.command = options.command
    this.args = options.args
  }

  static notFound(command: string): CommandError {
    return new CommandError(`Command not found: ${command}`, {
      code: ErrorCode.COMMAND_NOT_FOUND,
      exitCode: ExitCode.NOT_FOUND,
      command,
    })
  }

  static failed(command: string, exitCode: number, args?: string[]): CommandError {
    return new CommandError(`Command failed with exit code ${exitCode}`, {
      code: ErrorCode.COMMAND_FAILED,
      exitCode: exitCode === 0 ? ExitCode.SUCCESS : ExitCode.ERROR,
      command,
      args,
      details: { processExitCode: exitCode },
    })
  }

  static spawnFailed(command: string, cause?: Error): CommandError {
    return new CommandError(`Failed to spawn command: ${command}`, {
      code: ErrorCode.SPAWN_ERROR,
      command,
      cause,
    })
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

export interface ConfigErrorOptions extends CLIErrorOptions {
  path?: string
  key?: string
}

/**
 * Error for configuration failures.
 */
export class ConfigError extends CLIError {
  constructor(message: string, options: ConfigErrorOptions = {}) {
    super(message, {
      code: options.code ?? ErrorCode.CONFIG_INVALID,
      exitCode: options.exitCode ?? ExitCode.CONFIG_ERROR,
      details: {
        ...(options.path && { path: options.path }),
        ...(options.key && { key: options.key }),
        ...options.details,
      },
      hint: options.hint,
      cause: options.cause,
    })
    this.name = 'ConfigError'
  }

  static notFound(path: string): ConfigError {
    return new ConfigError(`Configuration file not found: ${path}`, {
      code: ErrorCode.CONFIG_NOT_FOUND,
      path,
    })
  }

  static parseError(path: string, cause?: Error): ConfigError {
    return new ConfigError(`Failed to parse configuration: ${path}`, {
      code: ErrorCode.CONFIG_PARSE_ERROR,
      path,
      cause,
    })
  }

  static invalidKey(key: string): ConfigError {
    return new ConfigError(`Unknown configuration key: ${key}`, {
      code: ErrorCode.CONFIG_INVALID,
      key,
      hint: "Run 'dotdo config list' to see available keys.",
    })
  }

  static invalidValue(key: string, expected: string): ConfigError {
    return new ConfigError(`Invalid value for ${key}`, {
      code: ErrorCode.CONFIG_INVALID,
      key,
      hint: `Expected: ${expected}`,
    })
  }
}

// ============================================================================
// Error Handler
// ============================================================================

export interface HandleErrorOptions {
  /** Output JSON instead of human-readable format */
  json?: boolean
  /** Whether to exit the process (default: true) */
  exit?: boolean
  /** Logger function (default: console.error) */
  log?: (message: string) => void
  /** Enable colored output (default: auto-detect) */
  colors?: boolean
}

/**
 * Handle an error with consistent output and exit behavior.
 *
 * Use this in command handlers to ensure consistent error handling:
 *
 * ```typescript
 * try {
 *   await doSomething()
 * } catch (error) {
 *   handleError(error, { json: options.json })
 * }
 * ```
 */
export function handleError(error: unknown, options: HandleErrorOptions = {}): never | void {
  const { json = false, exit = true, log = console.error, colors = process.stdout.isTTY ?? false } = options

  let cliError: CLIError

  if (error instanceof CLIError) {
    cliError = error
  } else if (error instanceof Error) {
    cliError = new CLIError(error.message, {
      code: ErrorCode.UNKNOWN,
      cause: error,
    })
  } else {
    cliError = new CLIError(String(error))
  }

  if (json) {
    log(JSON.stringify(cliError.toJSON(), null, 2))
  } else {
    log(cliError.format(colors))
  }

  if (exit) {
    process.exit(cliError.exitCode)
  }
}

/**
 * Wrap an async function with error handling.
 *
 * Use this to create command action handlers:
 *
 * ```typescript
 * command.action(withErrorHandling(async (options) => {
 *   // Your command logic here
 * }))
 * ```
 */
export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options?: HandleErrorOptions
): (...args: T) => Promise<R | void> {
  return async (...args: T) => {
    try {
      return await fn(...args)
    } catch (error) {
      handleError(error, options)
    }
  }
}

/**
 * Check if an error is a specific CLI error type.
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError
}

/**
 * Check if an error has a specific error code.
 */
export function hasErrorCode(error: unknown, code: ErrorCodeValue): boolean {
  return error instanceof CLIError && error.code === code
}

/**
 * Convert any error to a CLIError.
 */
export function toCLIError(error: unknown): CLIError {
  if (error instanceof CLIError) {
    return error
  }
  if (error instanceof Error) {
    return new CLIError(error.message, { cause: error })
  }
  return new CLIError(String(error))
}

// ============================================================================
// Stack Trace Formatting
// ============================================================================

export interface FormatStackOptions {
  /** Number of stack frames to show (default: 10) */
  maxFrames?: number
  /** Whether to use colors (default: auto-detect) */
  colors?: boolean
  /** Whether to filter internal node modules (default: true) */
  filterInternal?: boolean
  /** Base directory for relative paths (default: cwd) */
  basePath?: string
  /** Whether to include the error message header (default: true) */
  includeMessage?: boolean
}

interface ParsedStackFrame {
  functionName: string
  file: string
  line: number
  column: number
  isInternal: boolean
  isNodeModule: boolean
}

/**
 * Parse a stack trace string into structured frames.
 */
export function parseStackTrace(stack: string): ParsedStackFrame[] {
  const lines = stack.split('\n').slice(1) // Skip error message line
  const frames: ParsedStackFrame[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) continue

    // Match common V8 stack trace formats:
    // at functionName (file:line:col)
    // at file:line:col
    // at async functionName (file:line:col)
    const match = trimmed.match(/^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/)
    if (!match) continue

    const [, functionName = '<anonymous>', file, lineStr, colStr] = match
    const line_num = parseInt(lineStr, 10)
    const column = parseInt(colStr, 10)

    // Detect internal frames
    const isInternal =
      file.startsWith('node:') || file.includes('internal/') || file.startsWith('internal/')
    const isNodeModule = file.includes('node_modules')

    frames.push({
      functionName: functionName.replace(/^Object\./, ''),
      file,
      line: line_num,
      column,
      isInternal,
      isNodeModule,
    })
  }

  return frames
}

/**
 * Format a stack trace for human-readable CLI output.
 *
 * Provides:
 * - Syntax highlighting for file paths, line numbers, and function names
 * - Relative paths from the current working directory
 * - Filtering of internal Node.js frames
 * - Limiting the number of displayed frames
 *
 * @example
 * try {
 *   doSomething()
 * } catch (error) {
 *   console.error(formatStackTrace(error))
 * }
 */
export function formatStackTrace(error: Error, options: FormatStackOptions = {}): string {
  const {
    maxFrames = 10,
    colors = process.stdout.isTTY ?? false,
    filterInternal = true,
    basePath = process.cwd(),
    includeMessage = true,
  } = options

  // Color codes
  const red = colors ? '\x1b[31m' : ''
  const dim = colors ? '\x1b[2m' : ''
  const cyan = colors ? '\x1b[36m' : ''
  const yellow = colors ? '\x1b[33m' : ''
  const reset = colors ? '\x1b[0m' : ''

  const lines: string[] = []

  // Add error message header
  if (includeMessage) {
    lines.push(`${red}${error.name}: ${error.message}${reset}`)
  }

  // Parse and filter stack frames
  const stack = error.stack ?? ''
  let frames = parseStackTrace(stack)

  if (filterInternal) {
    frames = frames.filter((f) => !f.isInternal)
  }

  // Limit frames
  const truncated = frames.length > maxFrames
  const displayFrames = frames.slice(0, maxFrames)

  // Format each frame
  for (const frame of displayFrames) {
    // Make path relative if possible
    let displayPath = frame.file
    if (displayPath.startsWith(basePath)) {
      displayPath = displayPath.slice(basePath.length + 1)
    }

    // Apply styling based on frame type
    const pathColor = frame.isNodeModule ? dim : cyan
    const fnColor = frame.isNodeModule ? dim : yellow

    const fnName = frame.functionName !== '<anonymous>' ? `${fnColor}${frame.functionName}${reset} ` : ''
    const location = `${pathColor}${displayPath}${reset}:${dim}${frame.line}:${frame.column}${reset}`

    lines.push(`    at ${fnName}(${location})`)
  }

  // Add truncation notice
  if (truncated) {
    const remaining = frames.length - maxFrames
    lines.push(`    ${dim}... ${remaining} more frame(s)${reset}`)
  }

  return lines.join('\n')
}

/**
 * Format a complete error chain including cause chain.
 *
 * Traverses the error's cause chain and formats each error
 * with its stack trace, showing the complete error lineage.
 */
export function formatErrorChain(error: Error, options: FormatStackOptions = {}): string {
  const sections: string[] = []
  let current: Error | undefined = error
  let depth = 0
  const maxDepth = 5 // Prevent infinite loops

  while (current && depth < maxDepth) {
    const prefix = depth === 0 ? '' : `\nCaused by: `
    sections.push(prefix + formatStackTrace(current, { ...options, includeMessage: depth > 0 || options.includeMessage }))

    // Move to cause
    current = current.cause instanceof Error ? current.cause : undefined
    depth++
  }

  return sections.join('')
}

/**
 * Get a concise one-line summary of an error for logging.
 */
export function summarizeError(error: unknown): string {
  if (error instanceof CLIError) {
    return `[${error.code}] ${error.message}`
  }
  if (error instanceof Error) {
    // Get first relevant stack frame
    const frames = parseStackTrace(error.stack ?? '')
    const relevantFrame = frames.find((f) => !f.isInternal && !f.isNodeModule)

    if (relevantFrame) {
      const shortPath = relevantFrame.file.split('/').slice(-2).join('/')
      return `${error.name}: ${error.message} (${shortPath}:${relevantFrame.line})`
    }
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

/**
 * Create a debug-friendly representation of an error.
 *
 * Includes all available information: message, code, details,
 * stack trace, and cause chain. Useful for bug reports and debugging.
 */
export function debugError(error: unknown): string {
  const lines: string[] = []
  const colors = process.stdout.isTTY ?? false
  const bold = colors ? '\x1b[1m' : ''
  const dim = colors ? '\x1b[2m' : ''
  const reset = colors ? '\x1b[0m' : ''

  lines.push(`${bold}=== Error Debug Info ===${reset}`)
  lines.push('')

  if (error instanceof CLIError) {
    lines.push(`${bold}Type:${reset} ${error.name}`)
    lines.push(`${bold}Code:${reset} ${error.code}`)
    lines.push(`${bold}Exit Code:${reset} ${error.exitCode}`)
    lines.push(`${bold}Message:${reset} ${error.message}`)

    if (error.hint) {
      lines.push(`${bold}Hint:${reset} ${error.hint}`)
    }

    if (error.details && Object.keys(error.details).length > 0) {
      lines.push(`${bold}Details:${reset}`)
      for (const [key, value] of Object.entries(error.details)) {
        lines.push(`  ${key}: ${JSON.stringify(value)}`)
      }
    }

    lines.push('')
    lines.push(`${bold}Stack Trace:${reset}`)
    lines.push(formatStackTrace(error, { includeMessage: false, colors }))

    if (error.cause instanceof Error) {
      lines.push('')
      lines.push(`${bold}Cause Chain:${reset}`)
      lines.push(formatErrorChain(error.cause, { includeMessage: true, colors }))
    }
  } else if (error instanceof Error) {
    lines.push(`${bold}Type:${reset} ${error.name}`)
    lines.push(`${bold}Message:${reset} ${error.message}`)
    lines.push('')
    lines.push(`${bold}Stack Trace:${reset}`)
    lines.push(formatStackTrace(error, { includeMessage: false, colors }))

    if (error.cause instanceof Error) {
      lines.push('')
      lines.push(`${bold}Cause:${reset}`)
      lines.push(formatErrorChain(error.cause, { includeMessage: true, colors }))
    }
  } else {
    lines.push(`${bold}Type:${reset} ${typeof error}`)
    lines.push(`${bold}Value:${reset} ${String(error)}`)
  }

  lines.push('')
  lines.push(`${dim}Timestamp: ${new Date().toISOString()}${reset}`)
  lines.push(`${dim}Node: ${process.version}${reset}`)
  lines.push(`${dim}Platform: ${process.platform}${reset}`)

  return lines.join('\n')
}
