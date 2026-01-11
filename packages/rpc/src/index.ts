/**
 * @dotdo/rpc - Universal SDK Wrapper
 *
 * Wraps any npm package/SDK in RPC with a single line.
 *
 * @example
 * ```typescript
 * import { createRpcProxy, InMemoryExecutor } from '@dotdo/rpc'
 *
 * // Wrap any object in RPC
 * const target = {
 *   async getUser(id: string) {
 *     return { id, name: 'Alice' }
 *   },
 *   users: {
 *     async list() {
 *       return [{ id: '1', name: 'Alice' }]
 *     }
 *   }
 * }
 *
 * const executor = new InMemoryExecutor(target)
 * const client = createRpcProxy(executor)
 *
 * // Use like the original API
 * const user = await client.getUser('123')
 * const users = await client.users.list()
 * ```
 *
 * @module @dotdo/rpc
 */

// =============================================================================
// Types
// =============================================================================

export type {
  MethodCall,
  CallResult,
  BatchResult,
  RpcError,
  Executor,
  ProxyConfig,
  BatchingConfig,
  SerializedValue,
  FunctionReference,
  HTTPExecutorOptions,
  DeepPartial,
  MethodNames,
  Promisify,
} from './types.js'

// =============================================================================
// Core Proxy
// =============================================================================

export { createRpcProxy, RpcProxyError, resetCallIdCounter } from './proxy.js'

// =============================================================================
// Executors
// =============================================================================

export { InMemoryExecutor, HTTPExecutor } from './executor.js'

// =============================================================================
// Serialization
// =============================================================================

export { serialize, deserialize } from './serialization.js'
