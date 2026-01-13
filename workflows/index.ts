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
  getHandlerRegistrations,
  getHandlerCount,
  getRegisteredEventKeys,
  clearHandlers,
  clearHandlersByContext,
  unregisterHandler,
  type Unsubscribe,
  type HandlerRegistration,
  type OnHandlerOptions,
  type EveryHandlerOptions,
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

// Feature flag context API ($.flag, $.flags)
export {
  createMockContext as createFlagContext,
  evaluateFlag as evaluateFlagContext,
  type Flag as FlagWithBranches,
  type FlagEvaluation,
  type FlagContextInstance,
  type FlagsCollection,
  type FlagContext,
  type MockStorage as FlagStorage,
} from './context/flag'

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

// Rate limit context API ($.rateLimit, $.rateLimits)
export {
  createMockContext as createRateLimitContext,
  parseWindow as parseRateLimitWindow,
  type RateLimitResult,
  type RateLimitConfig,
  type RateLimitOptions,
  type RateLimitContextInstance,
  type RateLimitsCollection,
  type RateLimitStorage,
  type RateLimitContext,
} from './context/rate-limit'

// Foundation Sprint context API ($.foundation())
export {
  createMockContext as createFoundationContext,
  type CustomerPersona,
  type ProblemStatement,
  type Differentiation,
  type FoundingHypothesis,
  type CustomerInterview,
  type InterviewQuestion,
  type InterviewResponse,
  type HUNCHMetrics,
  type ValidationResult,
  type DifferentiationAnalysis,
  type FoundationBuilder,
  type FoundationHypothesisBuilder,
  type FoundationValidationBuilder,
  type FoundationInterviewBuilder,
  type FoundationAnalyzerBuilder,
  type FoundationMetricsBuilder,
  type FoundationStorage,
  type FoundationContext,
} from './context/foundation'

// Analytics context API ($.analytics)
export {
  createAnalyticsContext,
  type WebMetrics,
  type ProductMetrics,
  type FinancialMetrics,
  type WebAnalytics,
  type ProductAnalytics,
  type FinancialAnalytics,
  type MetricTrend,
  type TrendPeriod,
  type AnalyticsSummary,
  type AllAnalytics,
  type Analytics,
  type AnalyticsContext,
  type AnalyticsStorage,
  type SessionData,
  type PageviewData,
  type ActivityData,
  type FeatureData,
  type RevenueData,
  type CostData,
  type SubscriptionData,
} from './context/analytics'

// WorkflowCore - Unified Workflow Primitives
export {
  WorkflowCore,
  createWorkflowCore,
  type WorkflowCoreOptions,
  type WorkflowEvent,
  type TimerHandle,
  type CheckpointState,
} from './core/workflow-core'

// WorkflowHistory - Time-travel enabled workflow history
export {
  WorkflowHistory,
  createWorkflowHistory,
  type WorkflowHistoryOptions,
  type HistoryEvent,
  type HistoryCheckpoint,
  type HistorySnapshot,
  type RetentionPolicy,
  type PruneStats,
} from './core/workflow-history'

// WorkflowCoreStorageStrategy - Unified storage for compat layers
export {
  WorkflowCoreStorageStrategy,
  createWorkflowCoreStorageStrategy,
  type WorkflowCoreStorageOptions,
  type WorkflowStorageStrategy,
  type StepExecutionOptions,
  type CachedStepResult,
} from './core/workflow-core-storage'
