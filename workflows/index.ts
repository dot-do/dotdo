/**
 * ai-workflows - Pipeline Proxy Foundation
 *
 * Event-driven domain DSL for durable execution with:
 * - Pipeline promises for lazy execution
 * - Property access on unresolved values
 * - Magic map via record-replay
 * - Automatic batching of independent operations
 * - Event subscriptions and scheduling
 *
 * @example
 * ```typescript
 * import { on, every, Domain, when, waitFor, send } from 'dotdo/workflows'
 *
 * const CRM = Domain('CRM', { createAccount: () => ({}) })
 *
 * on.Customer.signup(customer => {
 *   CRM(customer).createAccount()
 * })
 *
 * every.Monday.at9am(() => {
 *   Analytics('sales').weeklyMetrics()
 * })
 * ```
 */

// Core pipeline promise system
export {
  createWorkflowProxy,
  createPipelinePromise,
  isPipelinePromise,
  collectExpressions,
  analyzeExpressions,
  analyzeExpressionsFull,
  findEmbeddedPromises,
  type PipelinePromise,
  type PipelineExpression,
  type WorkflowProxyOptions,
  type MapperInstruction,
  type AnalysisResult,
  type SimpleAnalysisResult,
} from './pipeline-promise'

// Proxy system for $.Domain(ctx).method() syntax
export {
  createWorkflowProxy as createPipelineProxy,
  type WorkflowRuntime as PipelineRuntime,
  type Pipeline,
  type PipelineProxy,
  type WorkflowAPI,
} from './proxy'

// Event-driven DSL
export {
  on,
  every,
  send,
  when,
  waitFor,
  Domain,
  getRegisteredHandlers,
  clearHandlers,
} from './on'

// Domain registry
export {
  Domain as BaseDomain,
  registerDomain,
  resolveHandler,
  clearDomainRegistry,
  type Handler,
  type DomainObject,
} from './domain'

// Content-addressable hashing
export {
  hashContext,
  hashPipeline,
  hashArgs,
  hashToInt,
} from './hash'

// Expression analyzer
export {
  analyzeExpressionsFull as analyzeExpressionGraph,
  findEmbeddedPromises as findDependencies,
} from './analyzer'

// Workflow definition helper
export {
  Workflow,
  type WorkflowDefinition,
  type ExtendedWorkflowContext,
} from './workflow'

// Feature flags for conditional execution
export {
  createFlagProxy,
  createFlagStore,
  type Flag,
  type FlagStore,
  type FlagInstance,
  type FlagClass,
  type FlagProxy,
  type CreateFlagOptions,
} from './flag'

// Workflow Runtime (Epic 4)
export {
  createWorkflowRuntime,
  createTestRuntime,
  DurableWorkflowRuntime,
  InMemoryStepStorage,
  HandlerNotFoundError,
  WorkflowStepError,
  type RetryPolicy,
  type StepResult,
  type StepStorage,
  type ExecutionMode,
  type RuntimeOptions,
} from './runtime'
