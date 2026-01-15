/**
 * types/index.ts - Canonical Type Definitions
 *
 * This file is the SINGLE SOURCE OF TRUTH for all shared types in dotdo.
 * All files should import these types from here rather than defining them locally.
 *
 * @module types
 */

// ============================================================================
// Thing Types - Core Entity Types
// ============================================================================

/**
 * ThingData - The canonical data structure for Things stored in the DO
 *
 * Used by:
 * - DOCore: thing CRUD operations
 * - InMemoryStateManager: L0 memory storage
 * - ColdStartRecovery: state restoration
 * - IcebergWriter: L3 cold storage
 */
export interface ThingData {
  /** Unique identifier (e.g., "customer_abc123") */
  $id: string
  /** Type name from Noun definition (e.g., "Customer") */
  $type: string
  /** Timestamp when created (ISO 8601) */
  $createdAt?: string
  /** Timestamp when last updated (ISO 8601) */
  $updatedAt?: string
  /** Optimistic concurrency version number */
  $version?: number
  /** Allow additional properties */
  [key: string]: unknown
}

/**
 * Thing - Entity instance with $id and $type (generic version)
 *
 * Used by:
 * - semantic/DOSemantic.ts: semantic type system
 * - semantic/index.ts: functional API
 * - relationship operators (forward, backward, etc.)
 */
export interface Thing<T = Record<string, unknown>> {
  /** Unique identifier */
  $id: string
  /** Type name from Noun definition */
  $type: string
  /** Timestamp when created (ISO 8601) */
  $createdAt?: string
  /** Timestamp when last updated (ISO 8601) */
  $updatedAt?: string
  /** Optimistic concurrency version number */
  $version?: number
  /** Allow additional properties from T */
  [key: string]: unknown
}

/**
 * ScoredThing - Thing with similarity score for fuzzy results
 */
export interface ScoredThing<T = Record<string, unknown>> extends Thing<T> {
  score: number
}

// ============================================================================
// Event Types - Event System Types
// ============================================================================

/**
 * Event - Workflow context event structure
 *
 * Used by:
 * - DOCore: event emission (send method)
 * - workflow-context: WorkflowContext event handling
 */
export interface Event {
  /** Unique event ID */
  id: string
  /** Event type (e.g., "Customer.signup") */
  type: string
  /** Subject (noun) extracted from type */
  subject: string
  /** Object (verb) extracted from type */
  object: string
  /** Event payload */
  data: unknown
  /** Event timestamp */
  timestamp: Date
}

/**
 * EventHandler - Function signature for event handlers
 */
export type EventHandler = (event: Event) => void | Promise<void>

// ============================================================================
// Noun/Verb Types - Semantic Type System
// ============================================================================

/**
 * Noun - Entity type definition with singular/plural forms
 */
export interface Noun {
  /** Singular form (e.g., 'Customer') */
  singular: string
  /** Plural form (e.g., 'Customers') */
  plural: string
}

/**
 * NounOptions - Options for noun definition
 */
export interface NounOptions {
  /** Override the auto-derived plural form */
  plural?: string
}

/**
 * Verb - Action definition with conjugated tenses
 */
export interface Verb {
  /** Base form / infinitive (e.g., 'create') */
  base: string
  /** Past tense (e.g., 'created') */
  past: string
  /** Third person singular present (e.g., 'creates') */
  present: string
  /** Present participle / gerund (e.g., 'creating') */
  gerund: string
}

/**
 * VerbOptions - Options for verb definition
 */
export interface VerbOptions {
  /** Override the auto-derived past tense */
  past?: string
  /** Override the auto-derived present tense */
  present?: string
  /** Override the auto-derived gerund */
  gerund?: string
}

// ============================================================================
// Action Types - Unified Event + Edge + Audit
// ============================================================================

/**
 * Action - Unified event + edge + audit record
 */
export interface Action {
  event: {
    type: string
    subject: string
    object?: string
    timestamp: Date
    metadata?: Record<string, unknown>
  }
  edge: {
    from: string
    to: string
    verb: string
  }
  audit: {
    actor: string
    verb: string
    target: string
    timestamp: Date
  }
}

/**
 * ActionResult - Result of creating an action
 */
export interface ActionResult extends Action {
  success: boolean
}

// ============================================================================
// Storage Types - Storage Layer Types
// ============================================================================

/**
 * CreateThingInput - Input for creating a new thing
 */
export interface CreateThingInput {
  $id?: string
  $type: string
  name?: string
  [key: string]: unknown
}

/**
 * ListOptions - Options for listing state entries
 */
export interface ListOptions {
  /** Prefix to filter keys by */
  prefix?: string
  /** Start of key range (inclusive) */
  start?: string
  /** End of key range (exclusive) */
  end?: string
  /** Maximum number of entries to return */
  limit?: number
  /** Sort results in reverse order */
  reverse?: boolean
}

/**
 * TransactionOp - Operation for transactional updates
 */
export interface TransactionOp {
  op: 'set' | 'delete' | 'error'
  key?: string
  value?: unknown
}

// ============================================================================
// Relationship Types
// ============================================================================

/**
 * RelationshipOperator - The four relationship operators
 */
export type RelationshipOperator = '->' | '~>' | '<-' | '<~'

/**
 * FuzzyOptions - Options for fuzzy relationship traversal
 */
export interface FuzzyOptions {
  /** Similarity threshold (0-1) */
  threshold?: number
  /** Include similarity scores in results */
  withScores?: boolean
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * NounRegistry - Map of noun names to Noun definitions
 */
export type NounRegistry = Map<string, Noun>

/**
 * VerbRegistry - Map of verb names to Verb definitions
 */
export type VerbRegistry = Map<string, Verb>

// ============================================================================
// Schedule Types
// ============================================================================

/**
 * TimeBuilder - Builder for time-based scheduling
 */
export interface TimeBuilder {
  at9am: (handler: Function) => () => void
  at5pm: (handler: Function) => () => void
  at6am: (handler: Function) => () => void
  at: (time: string) => (handler: Function) => () => void
}

/**
 * ScheduleBuilder - Builder for schedule DSL
 */
export interface ScheduleBuilder {
  Monday: TimeBuilder
  Tuesday: TimeBuilder
  Wednesday: TimeBuilder
  Thursday: TimeBuilder
  Friday: TimeBuilder
  Saturday: TimeBuilder
  Sunday: TimeBuilder
  day: TimeBuilder
  hour: (handler: Function) => () => void
  minute: (handler: Function) => () => void
}

/**
 * IntervalBuilder - Builder for interval-based scheduling
 */
export interface IntervalBuilder {
  minutes: (handler: Function) => () => void
  hours: (handler: Function) => () => void
  seconds: (handler: Function) => () => void
}

// ============================================================================
// Workflow Context Types
// ============================================================================

/**
 * SendErrorInfo - Error information from fire-and-forget event dispatch
 */
export interface SendErrorInfo {
  error: Error
  eventType: string
  eventId: string
  timestamp: Date
  data: unknown
  handlerIndex?: number
  retriedCount?: number
}

/**
 * CascadeTierTimeout - Per-tier timeout configuration
 */
export interface CascadeTierTimeout {
  code?: number
  generative?: number
  agentic?: number
  human?: number
}

/**
 * CascadeCircuitBreakerConfig - Per-tier circuit breaker configuration
 */
export interface CascadeCircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold?: number
  /** Time in ms before transitioning from open to half-open */
  resetTimeout?: number
  /** Whether each tier has its own circuit breaker */
  perTier?: boolean
  /** Fallback value to return when circuit is open */
  fallback?: unknown
}

/**
 * CascadeOptions - Options for cascade execution
 */
export interface CascadeOptions<T = unknown> {
  task: string
  tiers: {
    code?: () => T | Promise<T> | { value: T; confidence: number } | Promise<{ value: T; confidence: number }>
    generative?: () => T | Promise<T> | { value: T; confidence: number } | Promise<{ value: T; confidence: number }>
    agentic?: () => T | Promise<T> | { value: T; confidence: number } | Promise<{ value: T; confidence: number }>
    human?: () => T | Promise<T> | { value: T; confidence: number } | Promise<{ value: T; confidence: number }>
  }
  confidenceThreshold?: number
  skipAutomation?: boolean
  /** Global timeout for all tiers (ms) */
  timeout?: number
  /** Per-tier timeout configuration (ms) */
  tierTimeouts?: CascadeTierTimeout
  /** Circuit breaker configuration */
  circuitBreaker?: CascadeCircuitBreakerConfig
  /** Graceful degradation configuration */
  gracefulDegradation?: GracefulDegradationOptions
}

/**
 * CascadeResult - Result of cascade execution
 */
export interface CascadeResult<T = unknown> {
  /** The final result value */
  value: T
  /** Which tier produced the result */
  tier: 'code' | 'generative' | 'agentic' | 'human'
  /** Confidence score of the result */
  confidence?: number
  /** Path of tiers attempted */
  executionPath?: string[]
  /** Number of tier attempts */
  attempts?: number
  /** Duration per tier in ms */
  timing?: Record<string, number>
  /** Confidence scores per tier */
  confidenceScores?: Record<string, number>
  /** Queue entry for human tier */
  queueEntry?: unknown
  /** Whether any tier timed out */
  timedOut?: boolean
  /** Circuit breaker states per tier */
  circuitStates?: Record<string, 'closed' | 'open' | 'half-open'>

  // Graceful degradation fields
  /** Partial result if full result not available (completed before failure) */
  partialResult?: T
  /** True if fallback or partial result was used */
  degraded: boolean
  /** List of tiers that completed successfully */
  completedTiers: string[]
  /** List of tiers that failed */
  failedTiers: string[]
  /** Errors from failed tiers */
  tierErrors?: Record<string, string>
}

/**
 * CascadeTimeoutResult - Result from timeout wrapper
 */
export interface CascadeTimeoutResult<T> {
  result?: T
  timedOut: boolean
  duration: number
}

/**
 * GracefulDegradationOptions - Configuration for graceful degradation behavior
 *
 * Graceful degradation allows cascade execution to return partial results
 * instead of complete failure when tiers fail or timeout.
 */
export interface GracefulDegradationOptions {
  /** Enable graceful degradation mode */
  enabled: boolean
  /** Fallback value to return when all tiers fail */
  fallbackValue?: unknown
  /** Return partial results on timeout instead of failing */
  returnPartialOnTimeout?: boolean
  /** Return partial results on error instead of failing */
  returnPartialOnError?: boolean
}

/**
 * CircuitBreakerContextConfig - Configuration for circuit breaker
 */
export interface CircuitBreakerContextConfig {
  failureThreshold: number
  resetTimeout: number
  timeout?: number
  circuitPerDOType?: boolean
}

/**
 * CreateContextOptions - Options for creating workflow context
 */
export interface CreateContextOptions {
  stubResolver?: (noun: string, id: string) => Record<string, Function>
  rpcTimeout?: number
  circuitBreaker?: CircuitBreakerContextConfig
}
