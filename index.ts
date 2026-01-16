/**
 * dotdo - Durable Object Framework for Cloudflare Workers
 *
 * This is the main entry point for the dotdo package. It exports all the
 * core functionality needed to build Durable Object applications:
 *
 * - DO Classes (DOCore, DOFull, DOStorage, DOWorkflow, DOSemantic)
 * - WorkflowContext ($) - Event handlers, scheduling, durable execution
 * - Storage Layer - 4-tier storage with Pipeline-as-WAL
 * - RPC Layer - Cap'n Web RPC with promise pipelining
 * - AI Module - Template literal AI operations
 * - Types - Branded IDs, ThingData, Events, etc.
 *
 * @example
 * ```typescript
 * // Import DO classes for wrangler.toml bindings
 * import { DOCore, DOFull } from 'dotdo'
 *
 * export { DOCore, DOFull }
 * export default {
 *   fetch(req, env) {
 *     const stub = env.DOCore.get(env.DOCore.idFromName('default'))
 *     return stub.fetch(req)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use RPC client
 * import { createRPCClient } from 'dotdo/rpc'
 *
 * const customer = createRPCClient<CustomerDO>({ target: stub })
 * const orders = await customer.getOrders()
 * ```
 *
 * @example
 * ```typescript
 * // Use AI module
 * import { ai, is, list, code } from 'dotdo/ai'
 *
 * const sentiment = await is`Classify: ${text}`
 * const items = await list`Extract items from: ${text}`
 * ```
 *
 * @module dotdo
 */

// ============================================================================
// Core DO Classes
// ============================================================================

export { DOCore, type DOCoreEnv } from './core/DOCore'
export { DOSemantic } from './semantic/DOSemantic'
export { DOStorageClass, DOStorageClass as DOStorage } from './storage/DOStorage'
export { DOWorkflowClass, DOWorkflowClass as DOWorkflow } from './workflow/DOWorkflow'
export { DOFull, type DOFullEnv } from './objects/DOFull'
export { McpServer } from './mcp/server'

// ============================================================================
// WorkflowContext ($)
// ============================================================================

export {
  createWorkflowContext,
  type WorkflowContext,
  type Event,
  type CreateContextOptions,
  type CascadeOptions,
  type CascadeResult,
} from './workflow/workflow-context'

// ============================================================================
// Types - Branded IDs and Core Data Types
// ============================================================================

export {
  // Branded ID Types
  type ThingId,
  type EventId,
  type RelationshipId,
  type CallbackId,
  type BrokerMessageId,
  // ID Generation
  createThingId,
  createEventId,
  createRelationshipId,
  createCallbackId,
  createBrokerMessageId,
  // Core Data Types
  type ThingData,
  type Thing,
  type ScoredThing,
  type Event as EventType,
  type EventHandler,
  type Noun,
  type NounOptions,
  type Verb,
  type VerbOptions,
  type Action,
  type ActionResult,
  type CreateThingInput,
  type ListOptions,
  type TransactionOp,
  type RelationshipOperator,
  type FuzzyOptions,
  type NounRegistry,
  type VerbRegistry,
  // Schedule Types
  type ScheduleHandler,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
  // Workflow Context Types
  type SendErrorInfo,
  type CascadeTierTimeout,
  type CascadeCircuitBreakerConfig,
  type CascadeTimeoutResult,
  type GracefulDegradationOptions,
  type CircuitBreakerContextConfig,
  type CascadeCircuitBreakerContextConfig,
  type CircuitBreakerPersistenceState,
  type CircuitBreakerPersistenceCallbacks,
} from './types'

// ============================================================================
// Default Worker Handler
// ============================================================================

import { DOFull, type DOFullEnv } from './objects/DOFull'

export default {
  async fetch(request: Request, env: DOFullEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}
