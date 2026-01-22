/**
 * Shared types for WorkflowContext ($)
 *
 * This module contains type definitions that are shared between
 * async-context.ts and context.ts to avoid circular dependencies.
 *
 * @module do/workflow/types
 */

import type { EventsStore, ThingsStore, SqlStorage } from '@dotdo/db'
import type { OnProxy, EventHandler, RemoteEventHandler, CodeEvaluator } from './events'
import type { ScheduleRegistration } from './schedule'
import type { DOStubProxy, CircuitBreakerRPCConfig } from './rpc'
import type { StubCache, StubCacheOptions } from './stub-cache'
import type { FireAndForgetErrorStore } from '../fire-and-forget-errors'
import type { IntegrationRegistry, IntegrationConfig } from '@dotdo/integrations'
import type { EntitySchema as UnifiedEntitySchema } from '../schema/types'

// Re-export StubCacheOptions for convenience
export type { StubCacheOptions }

// Re-export for convenience
export type { CodeEvaluator, RemoteEventHandler }

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
 * Field definition for entity schema validation.
 *
 * Defined here to avoid circular dependency with entity.ts.
 */
export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  default?: unknown
}

/**
 * Schema definition for an entity type.
 *
 * This is the "legacy" entity schema format used by the entity proxy.
 * Defined here to avoid circular dependency with entity.ts.
 * entity.ts re-exports this type for backwards compatibility.
 */
export interface EntitySchema {
  /** Entity type name */
  name?: string
  /** Field definitions (for future validation) */
  fields?: Record<string, FieldDefinition>
  /** Whether to validate on create/update */
  strict?: boolean
}

/**
 * Callback function invoked when a schedule is registered via $.every DSL.
 * Used by DO to trigger initial alarm scheduling.
 */
export type OnScheduleRegisteredCallback = (scheduleId: string, registration: unknown) => void

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
  /**
   * Things store for entity operations (do-lekf.2)
   *
   * When provided, enables entity proxy access via $.Entity syntax:
   * - $.Product.define(schema)
   * - $.Product.create(data)
   * - $.Product.list(opts)
   * - $.Product(id).get()
   * - $.Product(id).update(data)
   * - $.Product(id).delete()
   */
  things?: ThingsStore

  /**
   * SQL storage for executing DDL statements (do-lekf.3)
   *
   * When provided with a schema definition via $.DB(), the DDL generator
   * will automatically create tables and indexes.
   *
   * This should be the DurableObjectState.storage.sql instance.
   */
  sql?: SqlStorage

  /**
   * Callback invoked when a schedule is registered via $.every DSL.
   * Used by DO to trigger initial alarm scheduling (do-7td2u.1).
   *
   * @example
   * ```ts
   * const $ = createContext(state, env, {
   *   onScheduleRegistered: (id, registration) => {
   *     alarmHandler.scheduleNextAlarm(schedules)
   *   }
   * })
   * ```
   */
  onScheduleRegistered?: OnScheduleRegisteredCallback

  /**
   * Custom code evaluator for remote handler execution (do-qkqhm).
   *
   * In production Cloudflare Workers environments, this should use ai-evaluate
   * which provides secure sandboxed execution via worker_loaders binding.
   *
   * If not provided, a default Function()-based evaluator is used which
   * may not work in environments that disallow dynamic code generation.
   *
   * @example
   * ```ts
   * import { evaluate, createEvaluator } from 'ai-evaluate'
   *
   * const $ = createContext(state, env, {
   *   evaluator: async (code, event, context) => {
   *     const result = await evaluate({
   *       script: `
   *         const handler = ${code};
   *         return handler(event);
   *       `
   *     }, { loader: env.loader, ...context })
   *     if (!result.success) throw new Error(result.error)
   *     return result.value
   *   }
   * })
   * ```
   */
  evaluator?: CodeEvaluator

  /**
   * DO stub cache configuration (do-o16uz).
   *
   * Controls TTL and maximum size for the cross-DO RPC stub cache.
   * When not provided, defaults to:
   * - maxSize: 100 entries
   * - ttlMs: 5 minutes (300000ms)
   *
   * @example
   * ```ts
   * const $ = createContext(state, env, {
   *   stubCache: {
   *     maxSize: 200,          // Allow more cached stubs
   *     ttlMs: 10 * 60 * 1000, // 10 minute TTL
   *   }
   * })
   * ```
   */
  stubCache?: Partial<StubCacheOptions>
}

/**
 * Internal state fields for WorkflowContext.
 *
 * These fields are prefixed with _ to indicate they are private implementation
 * details and should not be accessed directly by application code.
 * They are separated into their own type for better organization and to allow
 * type-safe access patterns in the implementation.
 *
 * @internal
 */
export interface WorkflowContextInternals {
  /** Event store for persistence */
  _events: EventsStore
  /** Local event handlers registry */
  _handlers: Map<string, EventHandler[]>
  /** Remote handlers registry for server-side execution (do-qkqhm) */
  _remoteHandlers: Map<string, RemoteEventHandler[]>
  /** Schedule registrations from $.every DSL */
  _schedules: Map<string, ScheduleRegistration>
  /** DO stub cache with TTL and LRU eviction (do-o16uz) */
  _stubCache: StubCache<DOStubProxy>
  /** Environment bindings */
  _env: unknown
  /** Error store for fire-and-forget operations */
  _fireAndForgetErrors: FireAndForgetErrorStore
  /** Circuit breaker configuration for cross-DO RPC (do-fcxj) */
  _circuitBreakerConfig?: CircuitBreakerRPCConfig
  /** Things store for entity operations (do-lekf.2) */
  _things?: ThingsStore
  /** Entity schema registry - parsed from DB() calls */
  _entitySchemas: Map<string, UnifiedEntitySchema>
  /** Legacy entity schemas for entity proxy (do-lekf.2) */
  _legacyEntitySchemas: Map<string, EntitySchema>
  /** SQL storage for DDL execution (do-lekf.3) */
  _sql?: SqlStorage
  /** Custom evaluator for remote handler execution (do-qkqhm) */
  _evaluator?: CodeEvaluator
}

/**
 * Public API for WorkflowContext.
 *
 * This interface defines the user-facing API for the $ context object.
 * It provides the fluent API for event handling, scheduling, cross-DO RPC,
 * and durability levels.
 */
export interface WorkflowContextPublicAPI {
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

  // Database Schema (do-lekf.3)
  /**
   * Define entire database schema at once (ai-database style).
   * Parses the schema using the unified parser, registers all entities,
   * and generates/executes DDL when sql storage is provided.
   *
   * @example
   * ```typescript
   * $.DB({
   *   Product: {
   *     sku: 'string!#',
   *     name: 'string!',
   *     price: 'decimal(10,2)!',
   *     vendor: '-> Vendor?',
   *   },
   *   Vendor: {
   *     name: 'string!',
   *     email: 'string!#',
   *     products: '<- Product.vendor[]',
   *   },
   * })
   * ```
   */
  DB(schemas: Record<string, Record<string, string | unknown>>): void

  // Extended primitives (fsx, gitx, bashx, npmx)
  /** Filesystem operations - available when wired via primitives config */
  fs?: FsCapability
  /** Git operations - available when wired via primitives config */
  git?: GitCapability
  /** Bash command execution - available when wired via primitives config */
  bash?: BashCapability
  /** NPM package management - available when wired via primitives config */
  npm?: NpmCapability

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

  // Remote handler registration (do-qkqhm)
  /**
   * Register a remote event handler from stringified code.
   *
   * This is the RPC endpoint called by remote clients to register event handlers
   * that execute server-side. The handler code is stringified on the client side
   * and sent here for storage and execution when events fire.
   *
   * Remote handlers are executed in a sandboxed environment with access to the
   * $ context. In production, use the `evaluator` option in CreateContextOptions
   * to provide ai-evaluate's secure execution sandbox.
   *
   * @param params - Registration parameters
   * @param params.event - Event type pattern (e.g., 'Customer.signup', '*.created')
   * @param params.code - Stringified handler function code
   * @param params.source - Optional source identifier (client ID, etc.)
   * @returns The registered handler info
   *
   * @example
   * ```ts
   * // Client-side: stringify the handler
   * const handler = async (event) => {
   *   await $.send({ type: 'welcome-email', payload: { to: event.email } })
   * }
   *
   * // Send to server via RPC
   * await $.registerHandler({
   *   event: 'Customer.signup',
   *   code: handler.toString(),
   *   source: 'client-123'
   * })
   * ```
   */
  registerHandler(params: { event: string; code: string; source?: string }): RemoteEventHandler
}

/**
 * WorkflowContext interface defining the $ API
 *
 * This is the core interface that provides the fluent API for:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 *
 * The interface combines the public API (WorkflowContextPublicAPI) with
 * internal state (WorkflowContextInternals) and dynamic DO stub access.
 */
export interface WorkflowContext extends WorkflowContextPublicAPI, WorkflowContextInternals {
  // Cross-DO RPC (Proxy-based)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: DOStubFactory | unknown
}

/**
 * Short alias for WorkflowContext
 */
export type $ = WorkflowContext
