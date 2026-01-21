/**
 * DO Configuration Types
 *
 * This module contains all configuration-related types and interfaces
 * for the DO (Durable Object) class. Extracted from DO.ts for better
 * maintainability and separation of concerns.
 *
 * @module @dotdo/do/types/config
 */

// Time constants are imported for documentation purposes (actual values in comments)
// See @dotdo/utils for DEFAULT_EVAL_TIMEOUT_MS (5000) and DEFAULT_CORS_MAX_AGE_SECONDS (86400)

/**
 * Options for _eval() RPC handler
 */
export interface EvalOptions {
  /** Script code to run immediately (module exports in scope) */
  script?: string
  /** Module code with exports */
  module?: string
  /** Test code using vitest (describe, expect, it in global scope) */
  tests?: string
  /** Timeout in milliseconds (default: 5000ms = DEFAULT_EVAL_TIMEOUT_MS from @dotdo/utils) */
  timeout?: number
}

/**
 * Log entry from console output capture
 */
export interface EvalLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  message: string
  timestamp: number
}

/**
 * Result from _eval() RPC handler
 */
export interface EvalResult {
  /** Whether execution succeeded */
  success: boolean
  /** Return value from script (if any) */
  value?: unknown
  /** Console output */
  logs: EvalLogEntry[]
  /** Error message if execution failed */
  error?: string
  /** Execution time in milliseconds */
  duration: number
}

/**
 * Environment interface for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface DOEnv {
  [key: string]: unknown
  /** Worker loader binding for sandboxed code execution */
  loader?: WorkerLoader
}

/**
 * Worker loader binding type (Cloudflare worker_loaders)
 */
export interface WorkerLoader {
  get(id: string, loader: () => Promise<WorkerCode>): WorkerStub
}

/**
 * Worker code definition for loader
 */
export interface WorkerCode {
  mainModule: string
  modules: Record<string, string>
  compatibilityDate?: string
}

/**
 * Worker stub returned by loader
 */
export interface WorkerStub {
  getEntrypoint(): WorkerEntrypoint
}

/**
 * Worker entrypoint interface
 */
export interface WorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

/**
 * UNSAFE_EVAL binding type (from miniflare unsafeEvalBinding)
 */
export interface UnsafeEval {
  eval(code: string): unknown
}

/**
 * CORS configuration options for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface CORSOptions {
  /**
   * Allowed origins for CORS requests.
   * - String array: List of allowed origins (e.g., ['https://app.example.com'])
   * - '*': Allow all origins (NOT recommended for production)
   * - undefined: Default restrictive behavior (no cross-origin allowed)
   *
   * @security In production, always specify explicit origins rather than using '*'
   */
  allowedOrigins?: string[] | '*'

  /**
   * Allowed HTTP methods for CORS requests.
   * Defaults to: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  allowedMethods?: string[]

  /**
   * Allowed headers for CORS requests.
   * Defaults to: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key']
   */
  allowedHeaders?: string[]

  /**
   * Headers to expose to the client.
   * Defaults to: ['X-Request-ID', 'X-DO-Colo']
   */
  exposeHeaders?: string[]

  /**
   * Whether to allow credentials (cookies, authorization headers).
   * Defaults to true when specific origins are set, false for wildcard.
   */
  credentials?: boolean

  /**
   * Max age in seconds for preflight cache.
   * Defaults to 86400 (24 hours) = DEFAULT_CORS_MAX_AGE_SECONDS from @dotdo/utils.
   */
  maxAge?: number
}

/**
 * Metrics configuration for DO instances.
 *
 * @stable
 * @since 1.1.0
 */
export interface DOMetricsConfig {
  /**
   * Enable metrics collection.
   * @default false
   */
  enabled?: boolean

  /**
   * Enable distributed tracing.
   * @default true (when metrics enabled)
   */
  enableTracing?: boolean

  /**
   * Enable structured logging for observability.
   * @default true (when metrics enabled)
   */
  enableLogging?: boolean

  /**
   * Custom service name for metrics.
   * @default 'dotdo-do'
   */
  serviceName?: string
}

/**
 * Configuration options for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface DOOptions {
  /**
   * CORS configuration.
   * - false: Disable CORS entirely
   * - true: Enable CORS with wildcard origin (development only - logs warning)
   * - CORSOptions: Configure allowed origins, methods, headers
   *
   * @default true (for backward compatibility, but logs warning in production)
   */
  cors?: boolean | CORSOptions
  /** Enable debug logging for handlers */
  debug?: boolean

  /**
   * Metrics configuration for observability.
   * When enabled, collects timing metrics for requests, storage operations,
   * RPC calls, and WebSocket messages.
   *
   * @stable
   * @since 1.1.0
   */
  metrics?: boolean | DOMetricsConfig
}
