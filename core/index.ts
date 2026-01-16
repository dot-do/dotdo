/**
 * @dotdo/core - Core Durable Object Runtime
 *
 * This is the foundational package for the dotdo ecosystem, providing:
 * - DOCore class - Base Durable Object with SQLite, Hono routing, WebSocket
 * - WorkflowContext ($) - Event handlers, scheduling, durable execution
 * - RPC Client - Type-safe remote procedure calls with promise pipelining
 * - Query validation - MongoDB-style operators for filtering
 *
 * @example
 * ```typescript
 * // Use RPC client to connect to a DO
 * import { createRPCClient, createWorkflowContext } from '@dotdo/core'
 *
 * const customer = createRPCClient<CustomerDO>({ target: stub })
 * const orders = await customer.getOrders()
 * ```
 *
 * @example
 * ```typescript
 * // Create workflow context for event handling
 * import { createWorkflowContext } from '@dotdo/core'
 *
 * const $ = createWorkflowContext({ stubResolver })
 * $.on.Customer.signup(async (event) => {
 *   await $.Customer(event.data.id).sendWelcomeEmail()
 * })
 * ```
 *
 * @module @dotdo/core
 */

// ============================================================================
// Core DO Class
// ============================================================================

export { DOCore, type DOCoreEnv } from './DOCore'

// ============================================================================
// WorkflowContext ($) - Event handlers, scheduling, durable execution
// ============================================================================

export {
  createWorkflowContext,
  type WorkflowContext,
  type Event,
  type CreateContextOptions,
  type CascadeOptions,
  type CascadeResult,
} from '../workflow/workflow-context'

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
// SQL Security (Raw Query Protection)
// ============================================================================

export {
  validateSqlQuery,
  sanitizeSqlError,
  isSafeQuery,
  SqlSecurityError,
  type SqlSecurityErrorCode,
} from './sql-security'

// ============================================================================
// RPC Client - Type-safe remote calls with promise pipelining
// ============================================================================

export {
  createRPCClient,
  pipeline,
  RPCError,
  RPCErrorCodes,
  WebSocketRpcClient,
  WebSocketRpcHandler,
  serialize,
  deserialize,
} from './rpc'

export type {
  RPCClientOptions,
  RPCRequest,
  RPCResponse,
  RpcMessage,
  WebSocketRpcOptions,
  Schema,
  MetaInterface,
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
