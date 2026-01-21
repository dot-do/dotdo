/**
 * Shared types for WorkflowContext ($)
 *
 * This module contains type definitions that are shared between
 * async-context.ts and context.ts to avoid circular dependencies.
 *
 * @module do/workflow/types
 */

import type { EventsStore, JsonValue } from '../../db'
import type { OnProxy, EventHandler } from './events'
import type { ScheduleRegistration } from './schedule'
import type { DOStubProxy, CircuitBreakerRPCConfig } from './rpc'
import type { FireAndForgetErrorStore } from '../fire-and-forget-errors'
import type { IntegrationRegistry, IntegrationConfig } from '@dotdo/integrations'

// Re-export for external use
export type { CircuitBreakerRPCConfig }

/**
 * Options for $.try() single-attempt action execution
 */
export interface TryOptions {
  /** Timeout in milliseconds (default: no timeout) */
  timeout?: number
}

/**
 * Options for $.do() durable action execution
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy: 'linear' or 'exponential' (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Function type for creating DO stubs from an ID.
 */
export type DOStubFactory = (id: string | DurableObjectId) => DOStubProxy

/**
 * EveryProxy type for the scheduling DSL
 */
export type EveryProxy = {
  [key: string]: EveryProxy
} & {
  (handler: () => Promise<void>): void
}

/**
 * FsCapability interface for filesystem operations via $.fs
 *
 * This interface is compatible with the FsCapability from fsx.do/core/types.ts.
 * Both interfaces use the same method names (read, write, list) for consistency
 * across the dotdo ecosystem.
 *
 * @example
 * ```typescript
 * // Using $.fs in a workflow
 * const content = await $.fs.read('/config.json', { encoding: 'utf-8' })
 * await $.fs.write('/output.txt', 'Hello, World!')
 * const files = await $.fs.list('/data')
 * ```
 */
export interface FsCapability {
  /** Capability name for introspection */
  name: 'fs'
  /** Whether the capability has been initialized */
  initialized?: boolean
  /** Initialize the capability (called automatically) */
  initialize?(): Promise<void>
  /** Dispose of resources */
  dispose?(): Promise<void>

  // File operations (matching fsx.do FsCapability)
  /** Read file contents */
  read(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>
  /** Write data to a file */
  write(path: string, data: string | Uint8Array): Promise<void>
  /** Append data to a file */
  append?(path: string, data: string | Uint8Array): Promise<void>
  /** Delete a file */
  unlink(path: string): Promise<void>

  // Directory operations
  /** Create a directory */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  /** Remove a directory */
  rmdir(path: string): Promise<void>
  /** List directory contents */
  list(path: string): Promise<string[]>
  /** Remove file or directory */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>

  // Metadata operations
  /** Check if a path exists */
  exists(path: string): Promise<boolean>
  /** Get file/directory statistics */
  stat(path: string): Promise<{
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    size: number
    mode: number
    mtime: Date
    atime: Date
    ctime: Date
    birthtime: Date
  }>

  // Node.js compatibility aliases (optional)
  /** Alias for read() - Node.js fs compatibility */
  readFile?(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>
  /** Alias for write() - Node.js fs compatibility */
  writeFile?(path: string, data: string | Uint8Array): Promise<void>
  /** Alias for list() - Node.js fs compatibility */
  readdir?(path: string): Promise<string[]>
}

/**
 * GitCapability interface for git operations via $.git
 */
export interface GitCapability {
  name: 'git'
  binding: {
    repo: string
    branch: string
    commit?: string
    lastSync?: Date
  }
  initialize?(): Promise<void>
  dispose?(): Promise<void>
  sync(): Promise<{ success: boolean; objectsFetched: number; filesWritten: number; commit?: string }>
  push(): Promise<{ success: boolean; objectsPushed: number; commit?: string }>
  status(): Promise<{ branch: string; head?: string; staged: string[]; unstaged: string[]; clean: boolean }>
  add(files: string | string[]): Promise<void>
  commit(message: string): Promise<{ hash: string }>
  diff(): Promise<string>
  log(): Promise<Array<{ hash: string; message: string }>>
  pull(): Promise<void>
}

/**
 * BashCapability interface for command execution via $.bash
 */
export interface BashCapability {
  name: 'bash'
  initialize?(): Promise<void>
  dispose?(): Promise<void>
  exec(command: string, args?: string[], options?: { timeout?: number; cwd?: string }): Promise<{
    command: string
    stdout: string
    stderr: string
    exitCode: number
  }>
  run(script: string): Promise<{ command: string; stdout: string; stderr: string; exitCode: number }>
  parse(input: string): unknown
  analyze(input: string): {
    classification: { type: string; impact: string; reversible: boolean }
    intent: { commands: string[]; reads: string[]; writes: string[]; deletes: string[]; network: boolean; elevated: boolean }
  }
  isDangerous(input: string): { dangerous: boolean; reason?: string }
}

/**
 * NpmCapability interface for npm operations via $.npm
 */
export interface NpmCapability {
  name: 'npm'
  initialize?(): Promise<void>
  dispose?(): Promise<void>
  install(packages?: string[], options?: { dev?: boolean; exact?: boolean }): Promise<{
    installed: Array<{ name: string; version: string }>
    removed: Array<{ name: string; version: string }>
    updated: Array<{ name: string; from: string; to: string }>
    stats: { resolved: number; cached: number; duration: number }
  }>
  uninstall(packages: string[]): Promise<void>
  run(script: string, args?: string[]): Promise<{ exitCode: number; output: string }>
  list(options?: { depth?: number }): Promise<Array<{ name: string; version: string }>>
  search(query: string): Promise<Array<{ name: string; version: string; description?: string }>>
  info(name: string, version?: string): Promise<{ name: string; version: string; description?: string; dependencies?: Record<string, string> }>
}

/**
 * Primitives configuration for WorkflowContext
 */
export interface PrimitivesConfig {
  /** Filesystem capability */
  fs?: FsCapability
  /** Git capability */
  git?: GitCapability
  /** Bash command execution capability */
  bash?: BashCapability
  /** NPM package management capability */
  npm?: NpmCapability
}

/**
 * Options for creating a WorkflowContext
 */
export interface CreateContextOptions extends PrimitivesConfig {
  /** Custom error store for fire-and-forget errors */
  errorStore?: FireAndForgetErrorStore
  /** Custom integration registry instance (shared across contexts if desired) */
  integrationRegistry?: IntegrationRegistry
  /** Initial integration configurations to auto-initialize */
  integrationConfigs?: Record<string, IntegrationConfig>
  /**
   * Circuit breaker configuration for cross-DO RPC calls (do-fcxj)
   *
   * Enabled by default. Set enabled: false to disable.
   *
   * @example
   * ```ts
   * const $ = createContext(state, env, {
   *   circuitBreaker: {
   *     failureThreshold: 3,
   *     resetTimeoutMs: 15000,
   *   }
   * })
   * ```
   */
  circuitBreaker?: CircuitBreakerRPCConfig
}

/**
 * WorkflowContext interface defining the $ API
 *
 * This is the core interface that provides the fluent API for:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 */
export interface WorkflowContext {
  // Durability levels
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void
  /** Single attempt (no retries) */
  try<T>(action: () => Promise<T>, options?: TryOptions): Promise<T>
  /** Durable with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>

  // Event handlers (Proxy-based)
  on: OnProxy

  // Scheduling DSL
  every: EveryProxy

  // Integration registry for third-party services
  integrations: IntegrationRegistry

  // Extended primitives (fsx, gitx, bashx, npmx)
  /** Filesystem operations - available when wired via primitives config */
  fs?: FsCapability
  /** Git operations - available when wired via primitives config */
  git?: GitCapability
  /** Bash command execution - available when wired via primitives config */
  bash?: BashCapability
  /** NPM package management - available when wired via primitives config */
  npm?: NpmCapability

  // Cross-DO RPC (Proxy-based)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: DOStubFactory | unknown

  // Context propagation methods (do-nexi)
  /** Run with context propagation across async boundaries */
  run<T>(fn: () => T): T
  /** Get the current request ID */
  getRequestId(): string | undefined
  /** Get request-scoped metadata */
  getMetadata<T = unknown>(key: string): T | undefined
  /** Set request-scoped metadata */
  setMetadata(key: string, value: unknown): void
  /** Check if running within a propagated context */
  hasContext(): boolean

  // Internal state (prefixed with _ to indicate private)
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
  _fireAndForgetErrors: FireAndForgetErrorStore
  /** Circuit breaker configuration for cross-DO RPC (do-fcxj) */
  _circuitBreakerConfig?: CircuitBreakerRPCConfig
}

/**
 * Short alias for WorkflowContext
 */
export type $ = WorkflowContext
