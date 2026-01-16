/**
 * @dotdo/core - Core Durable Object Runtime
 *
 * This is the foundational package for the dotdo ecosystem, providing:
 * - DOCore class - Base Durable Object with SQLite, Hono routing, WebSocket
 * - Query validation - MongoDB-style operators for filtering
 * - RPC client - Type-safe remote procedure calls (via @dotdo/core/rpc)
 *
 * @example
 * ```typescript
 * // Extend DOCore for your own Durable Object
 * import { DOCore } from '@dotdo/core'
 *
 * export class CustomerDO extends DOCore {
 *   async getOrders() {
 *     return this.listThings('Order', { where: { customerId: this.ns } })
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use the RPC client to call your DO
 * import { createRPCClient } from '@dotdo/core/rpc'
 *
 * const customer = createRPCClient<CustomerDO>({ target: stub })
 * const orders = await customer.getOrders()
 * ```
 *
 * Class Hierarchy (one-way dependency):
 * DOCore (~5KB) <- DOSemantic <- DOStorage <- DOWorkflow <- DOFull
 *
 * @module @dotdo/core
 */

// ============================================================================
// Core DO Class
// ============================================================================

export { DOCore, type DOCoreEnv } from './DOCore'

// ============================================================================
// Query Validation (MongoDB-style operators)
// ============================================================================

export {
  validateOperatorQuery,
  validateWhereClause,
  matchesOperators,
  matchesWhere,
  isOperatorObject,
  QueryValidationError,
  VALID_OPERATORS,
  type OperatorQuery,
  type ValidOperator,
} from './query-validation'

// ============================================================================
// RPC Client Re-exports (also available via @dotdo/core/rpc)
// ============================================================================

export {
  createRPCClient,
  pipeline,
  RPCError,
  RPCErrorCodes,
  WebSocketRpcClient,
  WebSocketRpcHandler,
} from './rpc'

export type {
  RPCClientOptions,
  RPCRequest,
  RPCResponse,
  RpcMessage,
  WebSocketRpcOptions,
} from './rpc'

// ============================================================================
// Default Worker Handler
// ============================================================================

import { DOCore, type DOCoreEnv } from './DOCore'

export default {
  async fetch(request: Request, env: DOCoreEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOCore.idFromName(ns)
    const stub = env.DOCore.get(id)

    return stub.fetch(request)
  },
}
