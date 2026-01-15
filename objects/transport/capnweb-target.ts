/**
 * Cap'n Web RPC Target Integration
 *
 * Provides integration with the official cloudflare/capnweb library for
 * promise pipelining RPC. This module creates an RpcTarget-compatible
 * wrapper around DO instances.
 *
 * Key features:
 * - Promise pipelining (multiple calls in single round-trip)
 * - Pass-by-reference (send object references instead of serializing)
 * - WebSocket streaming RPC
 * - HTTP batch mode
 *
 * Internal methods (fetch, alarm, etc.) are hidden from RPC exposure.
 *
 * @maintainer When adding new protected/private methods to DO classes,
 * update INTERNAL_METHODS or INTERNAL_PROPERTIES sets below to ensure
 * they are not exposed via RPC.
 */

import {
  RpcTarget,
  newWorkersRpcResponse,
  newHttpBatchRpcResponse,
  newWorkersWebSocketRpcResponse,
  type RpcSessionOptions,
} from 'capnweb'
import { logBestEffortError } from '@/lib/logging/error-logger'

// ============================================================================
// INTERNAL METHODS - These should NOT be exposed via Cap'n Web RPC
// ============================================================================

/**
 * Methods that are internal to DurableObject and should not be exposed via RPC.
 * These are lifecycle methods, internal state accessors, and protected methods.
 *
 * IMPORTANT: Keep this list synchronized with DO class methods. When adding
 * new internal methods to DOBase, DOFull, or DOTiny, add them here.
 *
 * @see DOBase.ts, DOFull.ts, DOTiny.ts
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
  'handleMcp',
  'handleSyncWebSocket',
  'handleIntrospectRoute',

  // Internal accessors (prefixed with _)
  // These are caught by the _ prefix check below

  // Database and storage
  'db',
  'ctx',
  'storage',
  'env',

  // Constructor
  'constructor',

  // Object prototype methods
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

  // Action logging
  'logAction',
  'updateActionStatus',
  'updateActionAttempts',
  'completeAction',
  'failAction',
  'executeAction',

  // Event handling
  'emitEvent',
  'emit',
  'emitSystemError',
  'dispatchEventToHandlers',

  // Cross-DO internals
  'invokeDomainMethod',
  'invokeCrossDOMethod',
  'fetchWithCrossDOTimeout',
  'checkCircuitBreaker',
  'recordCircuitBreakerSuccess',
  'recordCircuitBreakerFailure',

  // Resolution
  'resolve',
  'resolveLocal',
  'resolveCrossDO',
  'resolveNounToFK',
  'registerNoun',

  // Visibility
  'canViewThing',
  'assertCanView',
  'filterVisibleThings',
  'getVisibleThing',
  'getVisibility',
  'isOwner',
  'isInThingOrg',
  'setActorContext',
  'getActorContext',
  'clearActorContext',
  'determineRole',

  // Store context
  'getStoreContext',

  // JWT verification
  'verifyJwtSignature',
  'base64UrlDecode',

  // Introspection helpers
  'introspectClasses',
  'introspectStores',
  'introspectStorage',
  'introspectNouns',
  'introspectVerbs',

  // Utility methods
  'log',
  'sleep',
  'calculateBackoffDelay',
  'generateStepId',
  'persistStepResult',
  'loadPersistedSteps',
])

/**
 * Properties that are internal and should not be exposed via RPC.
 */
const INTERNAL_PROPERTIES = new Set([
  // Internal state
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

  // Static circuit breaker
  '_circuitBreakers',

  // WorkflowContext ($) - expose via methods instead
  '$',

  // Protected properties
  'app',
  'parent',
  'currentBranch',
])

// ============================================================================
// RPC TARGET WRAPPER
// ============================================================================

/**
 * Check if a method/property name is internal and should be hidden from RPC.
 */
export function isInternalMember(name: string): boolean {
  // All underscore-prefixed members are internal
  if (name.startsWith('_')) {
    return true
  }

  // All hash-prefixed members are private (ES2022 private fields)
  if (name.startsWith('#')) {
    return true
  }

  // Check against known internal methods
  if (INTERNAL_METHODS.has(name)) {
    return true
  }

  // Check against known internal properties
  if (INTERNAL_PROPERTIES.has(name)) {
    return true
  }

  return false
}

/**
 * Create a proxy that wraps a DO instance and filters out internal members.
 * This proxy is used as the localMain for Cap'n Web RPC.
 *
 * The proxy:
 * - Hides internal methods (fetch, alarm, etc.)
 * - Hides private members (_ and # prefixed)
 * - Allows access to public methods and properties
 * - Properly binds method `this` context
 */
export function createCapnWebTarget(doInstance: object): object {
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
// CAPN WEB RESPONSE HANDLER
// ============================================================================

/**
 * Options for the Cap'n Web RPC response handler.
 */
export interface CapnWebOptions extends RpcSessionOptions {
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
 * if (request.method === 'POST' || request.headers.get('upgrade') === 'websocket') {
 *   return handleCapnWebRpc(request, this)
 * }
 * ```
 */
export async function handleCapnWebRpc(
  request: Request,
  doInstance: object,
  options?: CapnWebOptions
): Promise<Response> {
  // Create a filtered proxy that hides internal members
  const target = createCapnWebTarget(doInstance)

  // Configure error handling
  const sessionOptions: RpcSessionOptions = {
    onSendError: (error: Error) => {
      // Log errors for observability
      logBestEffortError(error, {
        operation: 'rpcCall',
        source: 'capnweb-target.handleCapnWebRequest',
      })

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
    // Use WebSocket handler with options
    return newWorkersWebSocketRpcResponse(request, target, sessionOptions)
  }

  // HTTP batch mode
  if (request.method === 'POST') {
    // Use HTTP batch handler with options
    return newHttpBatchRpcResponse(request, target, sessionOptions)
  }

  // Fallback to unified handler for any edge cases
  return newWorkersRpcResponse(request, target)
}

/**
 * Check if a request should be handled by Cap'n Web RPC.
 *
 * Returns true for:
 * - POST requests (HTTP batch mode)
 * - WebSocket upgrade requests
 *
 * @param request - The incoming HTTP request
 * @returns true if this is a Cap'n Web RPC request
 */
export function isCapnWebRequest(request: Request): boolean {
  // POST requests are HTTP batch mode
  if (request.method === 'POST') {
    return true
  }

  // WebSocket upgrades are streaming RPC
  const upgradeHeader = request.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    return true
  }

  return false
}

// ============================================================================
// EXTENDED RPC TARGET CLASS (for class-based composition)
// ============================================================================

/**
 * Extended RpcTarget class that can be used with mixins.
 *
 * This class extends capnweb's RpcTarget and provides additional utilities
 * for Durable Object integration.
 *
 * Note: Since DO classes already extend DurableObject, you typically
 * won't use this class directly. Instead, use `createCapnWebTarget()`
 * to wrap your DO instance.
 *
 * @example
 * ```typescript
 * // For non-DO classes that need RPC target behavior:
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
