/**
 * Log Aggregator Types
 *
 * Comprehensive structured logging system types for the dotdo platform.
 */

// =============================================================================
// Log Levels
// =============================================================================

/**
 * Log levels ordered by severity (lowest to highest)
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Numeric values for log levels (for comparison)
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
}

/**
 * Check if a level should be logged based on minimum level
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[minLevel]
}

// =============================================================================
// Log Entry
// =============================================================================

/**
 * A single log entry
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Timestamp when log was created */
  timestamp: Date
  /** Request/trace context */
  context?: LogContext
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Logger name/namespace */
  logger?: string
  /** Error object if present */
  error?: Error
}

// =============================================================================
// Log Context
// =============================================================================

/**
 * Context for request tracing and correlation
 */
export interface LogContext {
  /** Unique request identifier */
  requestId?: string
  /** User identifier */
  userId?: string
  /** Distributed trace identifier */
  traceId?: string
  /** Span identifier within trace */
  spanId?: string
  /** Parent span identifier */
  parentSpanId?: string
  /** Service/component name */
  service?: string
  /** Environment (production, staging, etc.) */
  environment?: string
  /** Additional custom context fields */
  [key: string]: unknown
}

// =============================================================================
// Log Transport
// =============================================================================

/**
 * Transport types for log output
 */
export type LogTransportType = 'console' | 'file' | 'http' | 'buffer'

/**
 * Interface for log transports
 */
export interface LogTransport {
  /** Transport type identifier */
  type: LogTransportType
  /** Transport name */
  name: string
  /** Write a log entry */
  write(entry: LogEntry, formatted: string): void | Promise<void>
  /** Flush any buffered logs */
  flush?(): void | Promise<void>
  /** Close the transport */
  close?(): void | Promise<void>
  /** Minimum level for this transport */
  level?: LogLevel
}

// =============================================================================
// Log Format
// =============================================================================

/**
 * Output format for logs
 */
export type LogFormat = 'json' | 'text' | 'pretty'

/**
 * Format options
 */
export interface LogFormatOptions {
  /** Output format */
  format: LogFormat
  /** Include timestamp */
  includeTimestamp?: boolean
  /** Timestamp format */
  timestampFormat?: 'iso' | 'unix' | 'relative'
  /** Include log level */
  includeLevel?: boolean
  /** Include logger name */
  includeLogger?: boolean
  /** Include context */
  includeContext?: boolean
  /** Include metadata */
  includeMetadata?: boolean
  /** Pretty print JSON (only for json format) */
  prettyPrint?: boolean
  /** Color output (only for pretty format) */
  colorize?: boolean
}

// =============================================================================
// Log Filter
// =============================================================================

/**
 * Filter for querying/filtering logs
 */
export interface LogFilter {
  /** Filter by level (exact match or minimum) */
  level?: LogLevel | LogLevel[]
  /** Filter by message pattern (regex) */
  pattern?: string | RegExp
  /** Filter by specific field value */
  field?: {
    /** Field path (dot notation for nested) */
    path: string
    /** Value to match */
    value: unknown
    /** Match operator */
    operator?: 'eq' | 'ne' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte'
  }
  /** Filter by time range */
  timeRange?: {
    /** Start time (inclusive) */
    from?: Date
    /** End time (exclusive) */
    to?: Date
  }
  /** Filter by logger name */
  logger?: string | string[]
  /** Filter by context fields */
  context?: Partial<LogContext>
  /** Combine multiple filters with AND/OR */
  combine?: 'and' | 'or'
  /** Nested filters */
  filters?: LogFilter[]
}

// =============================================================================
// Log Config
// =============================================================================

/**
 * Fields to redact from logs
 */
export interface RedactConfig {
  /** Field paths to redact (supports wildcards) */
  paths: string[]
  /** Replacement string */
  replacement?: string
  /** Custom redaction function */
  redactor?: (value: unknown, path: string) => unknown
}

/**
 * Sampling configuration
 */
export interface SamplingConfig {
  /** Sample rate (0-1, e.g., 0.1 = 10% of logs) */
  rate: number
  /** Always sample these levels regardless of rate */
  alwaysSample?: LogLevel[]
  /** Sample by key (e.g., requestId) for consistent sampling */
  sampleBy?: string
}

/**
 * Log aggregator configuration
 */
export interface LogConfig {
  /** Minimum log level */
  level: LogLevel
  /** Output transports */
  transports: LogTransport[]
  /** Output format */
  format: LogFormat
  /** Format options */
  formatOptions?: LogFormatOptions
  /** Fields to redact */
  redact?: RedactConfig
  /** Sampling configuration */
  sampling?: SamplingConfig
  /** Default context for all logs */
  defaultContext?: LogContext
  /** Logger name/namespace */
  name?: string
  /** Enable/disable logging */
  enabled?: boolean
}

// =============================================================================
// Query Result
// =============================================================================

/**
 * Result of querying logs
 */
export interface LogQueryResult {
  /** Matching log entries */
  entries: LogEntry[]
  /** Total count (before pagination) */
  total: number
  /** Whether there are more results */
  hasMore: boolean
}

// =============================================================================
// Transport Options
// =============================================================================

/**
 * Console transport options
 */
export interface ConsoleTransportOptions {
  /** Stream to write to (stdout, stderr) */
  stream?: 'stdout' | 'stderr'
  /** Use stderr for error/fatal levels */
  stderrLevels?: LogLevel[]
}

/**
 * Buffer transport options
 */
export interface BufferTransportOptions {
  /** Maximum buffer size */
  maxSize?: number
  /** Flush when buffer reaches this size */
  flushAt?: number
  /** Auto-flush interval (ms) */
  flushInterval?: number
}

/**
 * HTTP transport options
 */
export interface HTTPTransportOptions {
  /** Endpoint URL */
  url: string
  /** HTTP method */
  method?: 'POST' | 'PUT'
  /** Request headers */
  headers?: Record<string, string>
  /** Batch size */
  batchSize?: number
  /** Batch timeout (ms) */
  batchTimeout?: number
  /** Retry configuration */
  retry?: {
    /** Maximum retries */
    maxRetries: number
    /** Initial delay (ms) */
    initialDelay: number
    /** Maximum delay (ms) */
    maxDelay: number
  }
}
