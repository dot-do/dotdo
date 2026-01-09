// Core types
export * from './Thing'

// Drizzle database type bridge
export * from './drizzle'
export * from './Things'
export * from './Collection'
export * from './Noun'
export * from './Verb'
export * from './DO'
export * from './WorkflowContext'
export * from './Experiment'
export * from './Flag'
export * from './capabilities'
export * from './ids'
export * from './event'
export * from './fn'

// Re-export key types for convenience
export type { Thing, ThingData } from './Thing'

export type { Things, ThingsCollection, CreateOptions, ForEachOptions, Query } from './Things'

export type { Collection, CollectionData, CollectionFactory } from './Collection'
export { COLLECTION_TYPE, buildItemId, collection } from './Collection'

export type { Noun, NounData, NounSchema, FieldDefinition, ParsedField } from './Noun'

export type { Verb, VerbData } from './Verb'

export type { DO, DOConfig, Relationship, ObjectRef, Action, Event, SearchResult } from './DO'

export type { WorkflowContext, OnProxy, ScheduleBuilder, DomainProxy, DomainEvent, EventHandler, ScheduleHandler, DOFunction } from './WorkflowContext'

// Typed Event Handler types
export * from './EventHandler'
export type {
  TypedEventHandler,
  TypedDomainEvent,
  EventPayload,
  EventPayloadRegistry,
  InferEventPayload,
  TypedOnNounProxy,
  TypedOnProxy,
  ExtractNoun,
  ExtractVerb,
  EventKey,
} from './EventHandler'
export { isTypedEvent, assertEventPayload } from './EventHandler'

export type { Experiment, ExperimentStatus, ExperimentInput } from './Experiment'
export { ExperimentSchema } from './Experiment'

export type { Flag, Branch, Filter, Stickiness, FlagStatus, FlagInput, BranchInput, FilterInput } from './Flag'
export { FlagSchema, BranchSchema, FilterSchema, validateFlag } from './Flag'

// Capability module types
export type {
  CapabilityModule,
  FsCapability,
  GitCapability,
  BashCapability,
  ExecResult,
  ExecOptions,
  SpawnedProcess,
  SpawnOptions,
  FileStats,
  MkdirOptions,
  RmOptions,
  GitStatus,
  GitCommit,
  GitLogOptions,
  GitCloneOptions,
  CapabilityName,
  CapabilityErrorReason,
  WithFs,
  WithGit,
  WithBash,
  WithAllCapabilities,
} from './capabilities'
export { CapabilityError, hasFs, hasGit, hasBash, hasAllCapabilities } from './capabilities'

// Branded ID types
export type {
  ThingId,
  ActionId,
  EventId,
  NounId,
  AnyId,
  UnbrandedId,
  IsBrandedId,
} from './ids'
export {
  createThingId,
  createActionId,
  createEventId,
  createNounId,
  isThingId,
  isActionId,
  isEventId,
  isNounId,
} from './ids'

// 5W+H Event types
export type {
  Event as FiveWHEvent,
  EventData,
  EventWho,
  EventWhat,
  EventWhen,
  EventWhere,
  EventWhy,
  EventHow,
  FunctionMethod,
  CascadeAttempt,
  EventCascade,
  ValidationError as EventValidationError,
  ValidationResult as EventValidationResult,
} from './event'
export { EventSchema, validateEvent, createEvent } from './event'

// Fn type system
export type {
  Fn,
  AsyncFn,
  RpcFn,
  StreamFn,
  TaggedResult,
  FunctionType,
  RpcPromise,
} from './fn'

// AI Function types
export * from './AIFunction'
export type {
  // JSON Schema types
  JSONSchema,
  JSONSchemaType,
  InferSchema,
  InferSchemaType,
  // Tool types
  Tool,
  ToolInvocation,
  // Executor options
  BaseExecutorOptions,
  CodeOptions,
  GenerativeOptions,
  AgenticOptions,
  HumanOptions,
  // Configuration types
  RetryConfig,
  CacheConfig,
  MemoryConfig,
  ReminderConfig,
  EscalationConfig,
  // Metrics types
  ExecutionMetrics,
  GenerativeMetrics,
  AgenticMetrics,
  HumanMetrics,
  // Result types
  ExecutionResult,
  CodeExecutionResult,
  GenerativeExecutionResult,
  AgenticExecutionResult,
  HumanExecutionResult,
  // Error types
  AIFunctionErrorCode,
  AIFunctionErrorData,
  // Function definition types
  AIFunctionDefinition,
  CodeFunctionDefinition,
  GenerativeFunctionDefinition,
  AgenticFunctionDefinition,
  HumanFunctionDefinition,
  AnyFunctionDefinition,
  // Pipeline integration
  PipelineAIFunction,
  StreamingAIFunction,
  // Executor types
  ExecutorFn,
  CodeExecutor,
  GenerativeExecutor,
  AgenticExecutor,
  HumanExecutor,
  // Composition types
  ComposedFunction,
  CascadingFunction,
  // Template types
  ExtractTemplateParams,
  TemplateFn,
  AITemplateFn,
  // Builder types
  AIFunctionBuilder,
  // Utility types
  UnwrapResult,
  OptionsForType,
  ResultForType,
  MetricsForType,
  DeepRequired,
  DeepPartial,
} from './AIFunction'
export {
  // Error classes
  AIFunctionError,
  ValidationError,
  TimeoutError,
  RateLimitError,
  ModelError,
  ToolError,
  ContentFilterError,
  HumanRejectedError,
  // Type guards
  isAIFunctionError,
  isErrorCode,
  isCodeFunction,
  isGenerativeFunction,
  isAgenticFunction,
  isHumanFunction,
  isSuccess,
  isFailure,
} from './AIFunction'
