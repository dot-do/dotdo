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
// Core Types - Re-exported from types/
// ============================================================================

export type {
  ThingData,
  Thing,
  ScoredThing,
  ThingId,
  EventId,
  RelationshipId,
  Noun,
  NounOptions,
  Verb,
  VerbOptions,
  Action,
  ActionResult,
  CreateThingInput,
  ListOptions,
} from '../types'

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
// Extracted Modules - Focused implementations
// ============================================================================

// Event System - Event types, handlers, and registration
export {
  generateEventId,
  generateThingId,
  createOnProxy,
  EventSystem,
  type Event as DurableEvent,
  type EventHandler,
  type OnProxy,
} from './event-system'

// Schedule Manager - CRON DSL and scheduling
export {
  parseTime,
  ScheduleManager,
  DAY_MAP,
  type ScheduleHandler,
  type ScheduleEntry,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
} from './schedule-manager'

// State Manager - Key-value state operations
export {
  StateManager,
  STATE_KEYS,
  type ListOptions as StateListOptions,
  type TransactionOp,
  type TransactionResult,
} from './state-manager'

// WebSocket Manager - WebSocket handling and broadcast
export {
  WebSocketManager,
  WEBSOCKET_STATUS,
  type WebSocketManagerState,
} from './websocket-manager'

// HTTP Router - CORS and HTTP utilities
export {
  HTTP_STATUS,
  VERSION_HEADER,
  VERSION,
  type HttpStatusCode,
} from './http-router'

// Storage Operations - Thing CRUD
export {
  ThingStore,
  type EventEmitter,
  type ThingQueryOptions,
} from './storage-ops'

// Durable Execution - Retry logic and action logging
export {
  DurableExecution,
  type ActionLogEntry,
  type DurableExecutionOptions,
  type TryExecutionOptions,
} from './durable-execution'

// Noun Accessors - RPC-compatible accessors
export {
  NounAccessor,
  NounInstanceAccessor,
  createNounAccessor,
  type ThingStorageInterface,
  type NounQueryOptions,
  type NounInstanceRPC,
  type NounAccessorRPC,
} from './noun-accessors'

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
