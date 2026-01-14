/**
 * DO Static Interface Types
 *
 * These types provide type-safe access to static properties on DO classes,
 * eliminating the need for `as unknown as` double assertions when accessing
 * static configuration like `$mcp`, `$rest`, `_eagerFeatures`, etc.
 *
 * @module types/DOStatic
 */

import type { RestMethodConfig } from './mcp'

// ============================================================================
// MCP CONFIGURATION TYPES
// ============================================================================

/**
 * MCP (Model Context Protocol) configuration for a DO class
 */
export interface McpConfig {
  /** Whether MCP is enabled for this DO */
  enabled?: boolean
  /** MCP server name */
  name?: string
  /** MCP server version */
  version?: string
  /** Exposed tool methods */
  tools?: string[]
  /** Exposed resource methods */
  resources?: string[]
  /** Exposed prompt methods */
  prompts?: string[]
  /** Custom capabilities */
  capabilities?: McpCapabilities
}

/**
 * MCP capability flags
 */
export interface McpCapabilities {
  tools?: boolean
  resources?: boolean
  prompts?: boolean
  logging?: boolean
  sampling?: boolean
}

// ============================================================================
// REST CONFIGURATION TYPES
// ============================================================================

/**
 * REST route configuration for a DO class
 */
export interface RestConfig {
  /** Base path prefix for all routes */
  prefix?: string
  /** Individual route configurations keyed by method name */
  routes?: Record<string, RestMethodConfig>
}

// ============================================================================
// DO STATIC INTERFACE
// ============================================================================

/**
 * Base interface for DO class constructors with static configuration.
 *
 * Use this instead of `DOClass as unknown as { $mcp?: McpConfig }` patterns.
 *
 * @example
 * ```typescript
 * // Instead of:
 * const mcpConfig = (DOClass as unknown as { $mcp?: McpConfig }).$mcp
 *
 * // Use:
 * const mcpConfig = (DOClass as DOClassStatic).$mcp
 * ```
 *
 * @typeParam T - The instance type created by the constructor
 * @typeParam E - The environment bindings type
 */
export interface DOClassStatic<T = unknown, E = unknown> {
  /** Constructor signature */
  new (ctx: DurableObjectState, env: E): T

  /** Prototype for method access */
  prototype: T & Record<string, unknown>

  /** MCP configuration */
  $mcp?: McpConfig

  /** REST route configuration */
  $rest?: Record<string, RestMethodConfig>

  /** Eager feature initialization config (internal) */
  _eagerFeatures?: DOFeatureConfig

  /** DO class name */
  readonly name: string
}

/**
 * Extended DO class constructor with instance type awareness.
 *
 * Use this when you need to access both static properties AND create instances.
 *
 * @example
 * ```typescript
 * function createMcpHandler<T extends DOClassWithMcp>(DOClass: T) {
 *   const config = DOClass.$mcp // Type-safe access
 *   return (instance: InstanceType<T>, request: Request) => {
 *     // ...
 *   }
 * }
 * ```
 */
export interface DOClassWithMcp<T = unknown, E = unknown> extends DOClassStatic<T, E> {
  $mcp: McpConfig // Required, not optional
}

/**
 * DO class constructor with REST configuration.
 */
export interface DOClassWithRest<T = unknown, E = unknown> extends DOClassStatic<T, E> {
  $rest: Record<string, RestMethodConfig> // Required, not optional
}

// ============================================================================
// FEATURE CONFIGURATION
// ============================================================================

/**
 * Configuration for DO.with() feature initialization
 */
export interface DOFeatureConfig {
  /** Enable Things store */
  things?: boolean
  /** Enable Relationships store */
  relationships?: boolean
  /** Enable Actions store */
  actions?: boolean
  /** Enable Events store */
  events?: boolean
  /** Enable Search index */
  search?: boolean
  /** Enable Analytics */
  analytics?: boolean
  /** Enable R2 storage */
  r2?: boolean
  /** Enable Iceberg state adapter */
  iceberg?: boolean
  /** Custom feature flags */
  [feature: string]: boolean | undefined
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a DO class has MCP configuration
 *
 * @example
 * ```typescript
 * if (hasMcpConfig(DOClass)) {
 *   const tools = DOClass.$mcp.tools // Safe access
 * }
 * ```
 */
export function hasMcpConfig<T, E>(
  DOClass: DOClassStatic<T, E>
): DOClass is DOClassWithMcp<T, E> {
  return (
    typeof DOClass === 'function' &&
    '$mcp' in DOClass &&
    DOClass.$mcp !== undefined &&
    typeof DOClass.$mcp === 'object'
  )
}

/**
 * Type guard to check if a DO class has REST configuration
 */
export function hasRestConfig<T, E>(
  DOClass: DOClassStatic<T, E>
): DOClass is DOClassWithRest<T, E> {
  return (
    typeof DOClass === 'function' &&
    '$rest' in DOClass &&
    DOClass.$rest !== undefined &&
    typeof DOClass.$rest === 'object'
  )
}

/**
 * Type guard to check if a value is a DO class constructor
 */
export function isDOClass(value: unknown): value is DOClassStatic {
  return (
    typeof value === 'function' &&
    'prototype' in value &&
    value.prototype !== null &&
    typeof value.prototype === 'object'
  )
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract the instance type from a DO class
 *
 * @example
 * ```typescript
 * type MyDOInstance = DOInstance<typeof MyDO>
 * ```
 */
export type DOInstance<T extends DOClassStatic> = T extends DOClassStatic<infer I, unknown>
  ? I
  : never

/**
 * Extract the environment type from a DO class
 */
export type DOEnv<T extends DOClassStatic> = T extends DOClassStatic<unknown, infer E>
  ? E
  : never

// ============================================================================
// DYNAMIC METHOD ACCESS
// ============================================================================

/**
 * Interface for DO instances with dynamic method access.
 *
 * Use this instead of `(this as unknown as Record<string, unknown>)[method]`
 *
 * @example
 * ```typescript
 * // Instead of:
 * const method = (this as unknown as Record<string, unknown>)[methodName]
 *
 * // Use:
 * const self = this as DOWithMethods
 * if (self.hasMethod(methodName)) {
 *   const method = self.getMethod(methodName)
 * }
 * ```
 */
export interface DOWithMethods {
  /**
   * Check if a method exists on this instance
   */
  hasMethod(name: string): boolean

  /**
   * Get a method by name (type-safe)
   */
  getMethod<TArgs extends unknown[] = unknown[], TReturn = unknown>(
    name: string
  ): ((...args: TArgs) => TReturn) | undefined

  /**
   * Invoke a method by name
   */
  invokeMethod<TReturn = unknown>(name: string, args: unknown[]): Promise<TReturn>
}

/**
 * Helper to safely access a method on any object
 *
 * @example
 * ```typescript
 * // Instead of:
 * const localMethod = (this as unknown as Record<string, unknown>)[method]
 *
 * // Use:
 * const localMethod = getMethodSafe(this, method)
 * if (localMethod) {
 *   return await localMethod.apply(this, args)
 * }
 * ```
 */
export function getMethodSafe<T extends object>(
  obj: T,
  methodName: string
): ((...args: unknown[]) => unknown) | undefined {
  const value = (obj as Record<string, unknown>)[methodName]
  if (typeof value === 'function') {
    return value as (...args: unknown[]) => unknown
  }
  return undefined
}

/**
 * Helper to safely invoke a method on any object
 */
export async function invokeMethodSafe<TReturn = unknown>(
  obj: object,
  methodName: string,
  args: unknown[]
): Promise<TReturn | undefined> {
  const method = getMethodSafe(obj, methodName)
  if (method) {
    return (await method.apply(obj, args)) as TReturn
  }
  return undefined
}
