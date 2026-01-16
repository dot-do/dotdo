/**
 * @dotdo/workers - Durable Object utilities for Cloudflare Workers
 *
 * This package provides core utilities for building Durable Objects:
 *
 * - DOBase - Base class with state, routing, WebSocket, alarms
 * - WorkflowContext ($) - Event handlers, scheduling, durable execution
 * - evaluate - Run code with $ context
 * - PipelinedStub - Cap'n Web style promise pipelining
 * - Unified storage - Cost-optimized storage pattern
 *
 * @example
 * ```typescript
 * import { DOBase, createWorkflowContext } from '@dotdo/workers'
 *
 * class MyDO extends DOBase {
 *   constructor(ctx, env) {
 *     super(ctx, env)
 *   }
 * }
 *
 * const $ = createWorkflowContext({ stubResolver })
 * $.on.Customer.signup(async (event) => {
 *   await $.Customer(event.data.id).sendWelcomeEmail()
 * })
 * ```
 *
 * @module @dotdo/workers
 */

// DO utilities
export { DOBase } from './do/DOBase'
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
} from './do/WorkflowContext'
export {
  evaluate,
  type EvaluateOptions,
  type EvaluateResult,
} from './do/evaluate'
export {
  createRPCClient,
  sendRPCRequest,
  type RPCRequest,
  type RPCResponse,
  type RPCClientOptions,
} from './do/rpc'

// Proxy utilities
export {
  createPipelinedStub,
  serializePipeline,
  deserializePipeline,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  type PipelinedStub,
  type PipelineStep,
  type SerializedPipeline,
} from './proxy/PipelinedStub'
export type {
  PipelinedProxyOptions,
  PipelineResult,
  BatchOptions,
} from './proxy/types'

// Storage utilities
export {
  createUnifiedStore,
  type ThingData,
  type StorageTier,
  type UnifiedStoreConfig,
  type UnifiedStoreStats,
} from './storage/unified'
