/**
 * Cap'n Web RPC Target
 *
 * Defines how Durable Objects expose methods to RPC callers.
 * Uses Cloudflare's unified Workers RPC model where DOs can
 * expose methods directly via stub.methodName() calls.
 *
 * Key features:
 * - Promise pipelining (multiple calls in single round-trip)
 * - Pass-by-reference (send object references instead of serializing)
 * - WebSocket streaming RPC
 * - HTTP batch mode
 * - Internal method filtering (hide fetch, alarm, etc.)
 *
 * @module @dotdo/core/rpc/target
 */

import {
  RpcTarget,
  newWorkersRpcResponse,
  newHttpBatchRpcResponse,
  newWorkersWebSocketRpcResponse,
  type RpcSessionOptions,
} from 'capnweb'

// ============================================================================
// INTERNAL MEMBER FILTERING
// ============================================================================

/**
 * Methods that are internal to DurableObject and should not be exposed via RPC.
 * These are lifecycle methods, internal state accessors, and protected methods.
 */
const INTERNAL_METHODS = new Set([
  // DurableObject lifecycle methods
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',

  // DO initialization and state
  'initialize',
  'handleFetch',

  // Database and storage
  'db',
  'ctx',
  'storage',
  'env',

  // Constructor and Object prototype
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',

  // Internal workflow methods
  'send',
  'try',
  'do',
  'createWorkflowContext',
  'createOnProxy',
  'createScheduleBuilder',
  'createDomainProxy',

  // Event handling
  'emitEvent',
  'emit',
  'dispatchEventToHandlers',

  // Resolution and cross-DO
  'resolve',
  'resolveLocal',
  'resolveCrossDO',
])

/**
 * Properties that are internal and should not be exposed via RPC.
 */
const INTERNAL_PROPERTIES = new Set([
  '_mcpSessions',
  '_mcpHandler',
  '_rpcServer',
  '_syncEngine',
  '_currentActor',
  '_things',
  '_rels',
  '_actions',
  '_events',
  '_search',
  '_objects',
  '_dlq',
  '_typeCache',
  '_eventHandlers',
  '_handlerCounter',
  '_scheduleHandlers',
  '_scheduleManager',
  '_stepCache',
  '_currentActorContext',
  '_circuitBreakers',
  '$', // WorkflowContext - expose via methods instead
  'app',
  'parent',
  'currentBranch',
])

/**
 * Check if a method/property name is internal and should be hidden from RPC.
 *
 * @param name - The member name to check
 * @returns true if the member should be hidden
 */
export function isInternalMember(name: string): boolean {
  // All underscore-prefixed members are internal
  if (name.startsWith('_')) return true

  // All hash-prefixed members are private (ES2022 private fields)
  if (name.startsWith('#')) return true

  // Check against known internal methods and properties
  return INTERNAL_METHODS.has(name) || INTERNAL_PROPERTIES.has(name)
}

// ============================================================================
// RPC TARGET WRAPPER
// ============================================================================

/**
 * Create a proxy that wraps a DO instance and filters out internal members.
 * This proxy is used as the localMain for Cap'n Web RPC.
 *
 * The proxy:
 * - Hides internal methods (fetch, alarm, etc.)
 * - Hides private members (_ and # prefixed)
 * - Allows access to public methods and properties
 * - Properly binds method `this` context
 *
 * @param doInstance - The DO instance to wrap
 * @returns A proxy that filters internal members
 *
 * @example
 * ```typescript
 * class MyDO extends DurableObject {
 *   async greet(name: string): Promise<string> {
 *     return `Hello, ${name}!`
 *   }
 * }
 *
 * const target = createRpcTarget(this)
 * // target.greet is accessible
 * // target.fetch is undefined
 * ```
 */
export function createRpcTarget(doInstance: object): object {
  return new Proxy(doInstance, {
    get(target, prop, receiver) {
      // Only handle string property names
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver)
      }

      // Block internal members
      if (isInternalMember(prop)) {
        return undefined
      }

      const value = Reflect.get(target, prop, receiver)

      // Bind methods to the original target to preserve `this` context
      if (typeof value === 'function') {
        return value.bind(target)
      }

      return value
    },

    has(target, prop) {
      if (typeof prop === 'string' && isInternalMember(prop)) {
        return false
      }
      return Reflect.has(target, prop)
    },

    ownKeys(target) {
      const keys = Reflect.ownKeys(target)
      return keys.filter((key) => {
        if (typeof key === 'string') {
          return !isInternalMember(key)
        }
        return true
      })
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && isInternalMember(prop)) {
        return undefined
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  })
}

// ============================================================================
// RPC RESPONSE HANDLER
// ============================================================================

/**
 * Options for the Cap'n Web RPC response handler.
 */
export interface RpcTargetOptions extends RpcSessionOptions {
  /**
   * Whether to include stack traces in error responses.
   * Default: false in production, true in development.
   */
  includeStackTraces?: boolean
}

/**
 * Handle a Cap'n Web RPC request (POST or WebSocket upgrade).
 *
 * This function wraps the DO instance in a proxy that filters out internal
 * members, then delegates to capnweb's handlers.
 *
 * @param request - The incoming HTTP request
 * @param doInstance - The DO instance to expose via RPC
 * @param options - Optional session configuration
 * @returns HTTP response (batch result or WebSocket upgrade)
 *
 * @example
 * ```typescript
 * // In DO.fetch():
 * async fetch(request: Request): Promise<Response> {
 *   if (isRpcRequest(request)) {
 *     return handleRpcRequest(request, this)
 *   }
 *   // ... handle other requests
 * }
 * ```
 */
export async function handleRpcRequest(
  request: Request,
  doInstance: object,
  options?: RpcTargetOptions
): Promise<Response> {
  // Create a filtered proxy that hides internal members
  const target = createRpcTarget(doInstance)

  // Configure error handling
  const sessionOptions: RpcSessionOptions = {
    onSendError: (error: Error) => {
      console.error('[rpc] Error:', error.message)

      // In production, redact stack traces unless explicitly enabled
      if (options?.includeStackTraces) {
        return error
      }

      // Return error without stack trace
      const redactedError = new Error(error.message)
      redactedError.name = error.name
      return redactedError
    },
    ...options,
  }

  // Check for WebSocket upgrade
  const upgradeHeader = request.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    return newWorkersWebSocketRpcResponse(request, target, sessionOptions)
  }

  // HTTP batch mode for POST
  if (request.method === 'POST') {
    return newHttpBatchRpcResponse(request, target, sessionOptions)
  }

  // Fallback to unified handler
  return newWorkersRpcResponse(request, target)
}

/**
 * Check if a request should be handled by RPC.
 *
 * Returns true for:
 * - POST requests (HTTP batch mode)
 * - WebSocket upgrade requests
 *
 * @param request - The incoming HTTP request
 * @returns true if this is an RPC request
 */
export function isRpcRequest(request: Request): boolean {
  if (request.method === 'POST') return true

  const upgradeHeader = request.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() === 'websocket') return true

  return false
}

// ============================================================================
// RPC TARGET CLASS
// ============================================================================

/**
 * Extended RpcTarget class for class-based composition.
 *
 * Extends capnweb's RpcTarget with utilities for Durable Object integration.
 *
 * @example
 * ```typescript
 * // For services that need RPC target behavior:
 * class MyService extends DOBaseRpcTarget {
 *   greet(name: string) {
 *     return `Hello, ${name}!`
 *   }
 * }
 * ```
 */
export class DOBaseRpcTarget extends RpcTarget {
  /**
   * List of method names to hide from RPC.
   * Override in subclasses to customize.
   */
  protected static readonly hiddenMethods: string[] = []

  /**
   * Check if a method should be exposed via RPC.
   */
  protected shouldExposeMethod(name: string): boolean {
    const hiddenMethods = (this.constructor as typeof DOBaseRpcTarget).hiddenMethods
    return !isInternalMember(name) && !hiddenMethods.includes(name)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  RpcTarget,
  newWorkersRpcResponse,
  type RpcSessionOptions,
}
