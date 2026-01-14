/**
 * Durable Object Class Hierarchy
 *
 * ```
 *                                 ┌─────────────────┐
 *                                 │       DO        │
 *                                 │   (Base Class)  │
 *                                 └────────┬────────┘
 *                                          │
 *          ┌───────────────┬───────────────┼───────────────┬───────────────┐
 *          │               │               │               │               │
 *    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐  ┌──────┴──────┐
 *    │  Business │   │    App    │   │   Site    │   │  Worker   │  │   Entity    │
 *    │           │   │           │   │           │   │           │  │             │
 *    └─────┬─────┘   └───────────┘   └───────────┘   └─────┬─────┘  └──────┬──────┘
 *          │                                               │               │
 *    ┌─────┴──────────┐                              ┌─────┴─────┐   ┌─────┴─────┐
 *    │DigitalBusiness │                              │           │   │           │
 *    └─────┬──────────┘                          ┌───┴───┐   ┌───┴───┐  (Collection, Directory, etc.)
 *          │                                     │ Agent │   │ Human │
 *    ┌─────┴─────┐                               └───────┘   └───────┘
 *    │   SaaS    │
 *    └───────────┘
 * ```
 */

// Base class
export { DO, type Env } from './DO'

// Stateless DO - for non-Cloudflare platforms with Iceberg persistence
export { StatelessDO, type Snapshot } from './StatelessDO'
export { StatelessDOState } from './StatelessDOState'

// Re-export core types from types module
export type { Thing, ThingData } from '../types/Thing'
export type { Relationship, Action, Event, ObjectRef, DOConfig } from '../types/DO'

// Worker hierarchy
export {
  Worker,
  type WorkerMode,
  type Task,
  type TaskResult,
  type Context,
  type Answer,
  type Option,
  type Decision,
  type ApprovalRequest,
  type ApprovalResult,
  type Channel,
} from './Worker'
export { Agent, type Tool, type Goal, type GoalResult, type Memory } from './Agent'
export { Human, type NotificationChannel, type EscalationRule, type EscalationPolicy, type PendingApproval } from './Human'

// Organization hierarchy
export { Business, type BusinessConfig } from './Business'
export { DigitalBusiness, type DigitalBusinessConfig } from './DigitalBusiness'
export { Startup } from './Startup'
export { App, type AppConfig } from './App'
export { Site, type SiteConfig } from './Site'
export { SaaS, type SaaSPlan, type SaaSSubscription, type UsageRecord, type SaaSConfig } from './SaaS'
export {
  Marketplace,
  type MarketplaceSeller,
  type MarketplaceBuyer,
  type MarketplaceListing,
  type MarketplaceTransaction,
  type MarketplaceReview,
  type CommissionConfig,
  type MarketplaceConfig,
} from './Marketplace'

// Entity hierarchy
export { Entity, type EntitySchema, type FieldDefinition, type EntityRecord } from './Entity'
export { Collection, type CollectionConfig } from './Collection'
export { Directory, type DirectoryEntry } from './Directory'
export { Package, type PackageVersion, type PackageConfig } from './Package'
export { Product, type ProductVariant, type ProductConfig } from './Product'

// Execution units
export { Function, type FunctionConfig as FunctionDOConfig, type FunctionInvocation } from './Function'
export { Workflow, type WorkflowStep, type WorkflowConfig, type WorkflowStepDefinition, type WorkflowInstance } from './Workflow'

// Factory functions
export {
  Workflow as WorkflowFactory,
  type WorkflowDefinition,
  type WorkflowStepHandler,
  type WorkflowTriggerConfig,
  type WorkflowEventHandler,
  type WorkflowEntrypoint,
  type WorkflowEntrypointClass,
  type WorkflowBuilder,
  WorkflowValidationError,
} from './WorkflowFactory'

// Business services
export {
  Service,
  type ServiceConfig,
  type PricingModel,
  type PricingTier,
  type ServiceTask,
  type TaskCompletionOptions,
  type TaskResult as ServiceTaskResult,
  type AgentAssignment,
  type ServiceMetrics,
  type ServiceEscalationConfig,
  type EscalationOptions,
  type QualityRatingOptions,
} from './Service'

// Interface types
export { API, type Route, type APIConfig, type RequestContext, type RateLimitState } from './API'
export { SDK, type SDKConfig, type GeneratedFile } from './SDK'
export { CLI, type CLICommand, type CLIArgument, type CLIOption, type CLIConfig, type CLIExecution } from './CLI'

// Integrations
export {
  IntegrationsDO,
  type Provider,
  type ProviderAction,
  type OAuthConfig,
  type WebhookConfig,
  type RateLimitConfig,
} from './IntegrationsDO'

// Workflow Runtime
export {
  WorkflowRuntime,
  type WorkflowRuntimeConfig,
  type WorkflowRuntimeOptions,
  type WorkflowStepConfig,
  type StepExecutionResult,
  type WorkflowExecutionResult,
  type WorkflowMetrics,
  type StepContext,
  type WorkflowRuntimeState,
  WorkflowStateError,
  WorkflowStepError,
  WorkflowTimeoutError,
} from './WorkflowRuntime'

// Step DO Bridge
export {
  StepDOBridge,
  type DOStub,
  type DONamespaceBinding,
  type DomainProxy,
  type MethodProxy,
  DOCallError,
} from '../workflows/StepDOBridge'

// Schedule Manager
export {
  ScheduleManager,
  type Schedule,
  type ScheduleOptions,
  type ScheduleUpdateOptions,
  type ScheduleListOptions,
  type CronExpression,
  type NextRunTimeOptions,
  parseCronExpression,
  getNextRunTime,
  ScheduleValidationError,
  ScheduleNotFoundError,
  InvalidCronExpressionError,
} from '../workflows/ScheduleManager'

// Step Result Storage
export {
  StepResultStorage,
  type StepResultInput,
  type StoredStepResult,
  type StepStatus,
  type GetAllOptions,
  type ResultSummary,
} from '../workflows/StepResultStorage'

// Modifier API
export {
  modifier,
  inputModifier,
  outputModifier,
  conditionalModifier,
  applyInputModifiers,
  applyOutputModifiers,
  type Modifier,
  type ModifierConfig,
  type ModifierContext,
  type InputModifierFunction,
  type OutputModifierFunction,
  type ConditionFunction,
  type ModifierFunction,
} from '../lib/Modifier'

// DOAuth - Authentication capability
export {
  DOAuth,
  createDOAuth,
  type DOAuthConfig,
  type DOAuthContext,
  type ProviderConfig as DOAuthProviderConfig,
  type SessionData as DOAuthSessionData,
} from '../lib/DOAuth'

// ============================================================================
// FUNCTION TYPE SYSTEM (Refactored)
// ============================================================================

// Base Function Executor
export {
  BaseFunctionExecutor,
  ExecutionTimeoutError,
  ExecutionCancelledError,
  ExecutionRetryExhaustedError,
  ExecutionValidationError,
  calculateDelay,
  normalizeError,
  sleep,
  generateInvocationId,
  isCodeFunction,
  isGenerativeFunction,
  isAgenticFunction,
  isHumanFunction,
  type FunctionType,
  type FunctionConfig,
  type CodeFunctionConfig,
  type GenerativeFunctionConfig,
  type AgenticFunctionConfig,
  type HumanFunctionConfig,
  type BaseFunctionConfig,
  type BaseExecutorOptions,
  type BaseExecutionResult,
  type ExecutionMetrics,
  type RetryConfig,
  type StateWrapper,
  type DurableObjectState as FunctionDurableObjectState,
  type Logger as FunctionLogger,
  type EventHandler as FunctionEventHandler,
  type ExecutionMiddleware,
  type MiddlewareContext,
  type MiddlewareNext,
} from '../lib/executors/BaseFunctionExecutor'

// Function Registry
export {
  FunctionRegistry,
  FunctionNotFoundError,
  FunctionAlreadyExistsError,
  FunctionValidationError as RegistryValidationError,
  getDefaultRegistry,
  createRegistry,
  type RegisteredFunction,
  type FunctionMetadata,
  type FunctionFilter,
  type RegistryStats,
} from '../lib/functions/FunctionRegistry'

// Function Composition
export {
  pipe,
  createPipeline,
  parallel,
  parallelWithResults,
  conditional,
  switchCase,
  retry,
  withTimeout,
  fallback,
  tryEach,
  mapOver,
  filterBy,
  reduceWith,
  tap,
  log,
  PipelineError,
  ParallelExecutionError,
  TimeoutError as CompositionTimeoutError,
  RetryExhaustedError,
  type ComposableFunction,
  type ExecutionContext as CompositionExecutionContext,
  type Progress,
  type PipelineResult,
  type StageResult,
  type ParallelResult,
  type PipeOptions,
  type ParallelOptions,
  type RetryOptions,
} from '../lib/functions/FunctionComposition'

// Function Middleware
export {
  createLoggingMiddleware,
  createMetricsMiddleware,
  createMetricsCollector,
  createAuthMiddleware,
  createValidationMiddleware,
  createRateLimitMiddleware,
  createInMemoryRateLimitStore,
  createCachingMiddleware,
  createInMemoryCacheStore,
  createTimeoutMiddleware,
  createTracingMiddleware,
  composeMiddleware,
  AuthenticationError,
  AuthorizationError,
  ValidationError as MiddlewareValidationError,
  RateLimitError,
  TimeoutError as MiddlewareTimeoutError,
  type LogEntry,
  type LogSink,
  type LoggingOptions,
  type MetricsEntry,
  type MetricsSink,
  type MetricsOptions,
  type AuthContext,
  type AuthProvider,
  type AuthValidator,
  type AuthOptions,
  type ValidationOptions,
  type CacheEntry,
  type CacheStore,
  type CacheOptions,
  type RateLimitInfo,
  type RateLimitStore,
  type RateLimitOptions,
  type TimeoutOptions,
  type TraceSpan,
  type TraceSink,
  type TracingOptions,
} from '../lib/functions/FunctionMiddleware'

// Sandbox - Code Execution Environment
export { SandboxDO } from './SandboxDO'

// Cascade Executor - Function type cascade system
export {
  CascadeExecutor,
  CascadeExhaustedError,
  CascadeTimeoutError,
  CascadeSkippedError,
  type FunctionType as CascadeFunctionType,
  type CodeHandler,
  type GenerativeHandler,
  type AgenticHandler,
  type HumanHandler,
  type HandlerContext,
  type CascadeHandlers,
  type CascadeStep,
  type CascadePath,
  type EventContext,
  type Event5WH,
  type CascadeResult,
  type CascadeOptions,
  type CascadeExecutorOptions,
} from './CascadeExecutor'
