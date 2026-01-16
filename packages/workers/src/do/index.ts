/**
 * @dotdo/workers/do - Durable Object utilities
 *
 * Core classes and utilities for building Durable Objects:
 * - DOBase - Base class with state, routing, WebSocket, alarms
 * - WorkflowContext ($) - Event handlers, scheduling, durable execution
 * - evaluate - Run code with $ context
 * - RPC utilities - Type-safe remote calls
 *
 * @module @dotdo/workers/do
 */

export { DOBase } from './DOBase'

export {
  createWorkflowContext,
  type WorkflowContext,
  type Event,
  type EventHandler,
  type ScheduleHandler,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
  type CreateContextOptions,
} from './WorkflowContext'

export {
  evaluate,
  type EvaluateOptions,
  type EvaluateResult,
} from './evaluate'

export {
  createRPCClient,
  sendRPCRequest,
  type RPCRequest,
  type RPCResponse,
  type RPCClientOptions,
} from './rpc'
