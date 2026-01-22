/**
 * WorkflowContext ($) - Core context for workflow operations
 *
 * Provides the $ context with a fluent API for:
 * - Event handlers: $.on.Customer.signup(handler)
 * - Scheduling: $.every.Monday.at('9am')(handler)
 * - Cross-DO RPC: $.Customer(id).method()
 * - Durability levels: $.send(), $.try(), $.do()
 *
 * ## Architecture Note (do-q63lc)
 *
 * This module intentionally uses a **facade pattern** rather than decomposed classes.
 * The WorkflowContext aggregates multiple capabilities into a single $ object because:
 *
 * 1. **Developer Experience**: The $ context is the primary API surface for workflows.
 *    Having a single object with all capabilities (events, scheduling, RPC, primitives)
 *    provides a cohesive, discoverable interface: `$.on`, `$.every`, `$.send`, `$.do`.
 *
 * 2. **Composition via Helpers**: Internal complexity is managed through helper functions:
 *    - `initializeContextState()` - State initialization
 *    - `createEventProcessor()` - Event processing with retries
 *    - `createBaseContext()` - Base context object assembly
 *    - `createTryMethod()` / `createDoMethod()` - Durability methods
 *
 * 3. **Proxy-Based Extension**: Cross-DO RPC ($.Customer(id)) uses Proxy, which requires
 *    a single object to intercept property access. Decomposing would complicate this.
 *
 * 4. **Shared State**: Event handlers, schedules, stub cache, and integrations are
 *    interdependent. A single ContextState object manages this shared state cleanly.
 *
 * ### Alternative Considered
 *
 * A class-based approach (EventEmitter, Scheduler, RPCProxy classes) was considered but
 * rejected because:
 * - It would require passing the $ context to each class for cross-references
 * - The Proxy-based RPC pattern doesn't compose well with separate class instances
 * - Testing is equally simple with the current helper function approach
 *
 * ### Testing Strategy
 *
 * Each capability is testable in isolation via the helper functions, and the full
 * context can be tested via createContext() with mock options. See workflow/tests/.
 *
 * @module do/workflow/context
 */

import { createEventsStore } from '@dotdo/db'
import type { Event, EventsStore, JsonValue, ThingsStore, SqlStorage } from '@dotdo/db'
import { createEveryProxy } from './schedule'
import {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  invokeRemoteHandlers,
  registerRemoteHandler,
  matchRemoteHandlers,
} from './events'
import type { RetryOptions, RemoteEventHandler } from './events'
import { createDORPCProxy } from './rpc'
import { StubCache, createStubCache, type StubCacheOptions } from './stub-cache'
import type { EntitySchema as LegacyEntitySchema } from './entity'
import { parseSchema, generateSchemaDDL, generateMigrationDDL } from '../schema/index'
import type { EntitySchema, RawDatabaseSchema, DDLOptions } from '../schema/index'
import { RPCError, TimeoutError, InternalError, ValidationError } from '@dotdo/rpc'
import { createInMemoryErrorStore, extractErrorInfo } from '../fire-and-forget-errors'
import type { FireAndForgetErrorStore } from '../fire-and-forget-errors'
import { IntegrationRegistry } from '@dotdo/integrations'
import { createScopedLogger, LogLevel } from '@dotdo/utils'
import {
  runWithWorkflowContextSync,
  getContextMetadata,
  setContextMetadata,
  getRequestId,
  hasWorkflowContext,
  initializeAsyncContext,
} from './async-context'

// Re-export types from types.ts for backward compatibility
export type {
  WorkflowContext,
  $,
  DoOptions,
  TryOptions,
  DOStubFactory,
  EveryProxy,
  FsCapability,
  GitCapability,
  BashCapability,
  NpmCapability,
  PrimitivesConfig,
  CreateContextOptions,
} from './types'

// Import types for internal use
import type {
  WorkflowContext,
  DoOptions,
  TryOptions,
  CreateContextOptions,
  CodeEvaluator,
} from './types'
import type { EventHandler } from './events'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[WorkflowContext]' })

// Import ScheduleRegistration for internal use
import type { ScheduleRegistration } from './schedule'
import type { DOStubProxy } from './rpc'
import type { CircuitBreakerRPCConfig } from '@dotdo/rpc'

/**
 * Minimal interface for base context that satisfies createDORPCProxy requirements.
 * This interface must include the internal fields that createDORPCProxy expects.
 */
interface BaseContextWithInternals {
  _env: unknown
  _stubCache: StubCache<DOStubProxy>
  _circuitBreakerConfig?: CircuitBreakerRPCConfig
  _things?: ThingsStore
  _legacyEntitySchemas?: Map<string, LegacyEntitySchema>
  _entitySchemas?: Map<string, EntitySchema>
  [key: string]: unknown
}

/**
 * Internal state object for the workflow context
 */
interface ContextState {
  events: EventsStore
  handlers: Map<string, EventHandler[]>
  /** Remote handlers registered via RPC (stringified code for server-side execution) */
  remoteHandlers: Map<string, RemoteEventHandler[]>
  schedules: Map<string, ScheduleRegistration>
  /** DO stub cache with TTL and LRU eviction (do-o16uz) */
  stubCache: StubCache<DOStubProxy>
  fireAndForgetErrors: FireAndForgetErrorStore
  integrations: IntegrationRegistry
  /** Things store for entity operations (do-lekf.8) */
  things?: ThingsStore
  /** SQL storage for DDL execution (do-lekf.3) */
  sql?: SqlStorage
  /** Entity schema registry - parsed from DB() calls (do-lekf.8) */
  entitySchemas: Map<string, EntitySchema>
  /** Legacy entity schemas for backward compatibility with entity proxy */
  legacyEntitySchemas: Map<string, LegacyEntitySchema>
  /** Custom evaluator for remote handler execution (do-qkqhm) */
  evaluator?: CodeEvaluator
}

/**
 * Initialize the internal state for the workflow context
 */
function initializeContextState(options?: CreateContextOptions): ContextState {
  const events = createEventsStore()
  const handlers = new Map<string, EventHandler[]>()
  const remoteHandlers = new Map<string, RemoteEventHandler[]>()
  const schedules = new Map<string, ScheduleRegistration>()
  // Create stub cache with TTL and eviction policies (do-o16uz)
  const stubCache = createStubCache<DOStubProxy>(options?.stubCache)
  const fireAndForgetErrors = options?.errorStore ?? createInMemoryErrorStore()
  const integrations = options?.integrationRegistry ?? new IntegrationRegistry()
  const things = options?.things
  const sql = options?.sql
  const entitySchemas = new Map<string, EntitySchema>()
  const legacyEntitySchemas = new Map<string, LegacyEntitySchema>()
  const evaluator = options?.evaluator

  // Initialize async context system (do-nexi)
  initializeAsyncContext().catch((err) => {
    logger.error('Failed to initialize async context:', err)
  })

  // Initialize integrations if configs provided
  if (options?.integrationConfigs) {
    integrations.initAll(options.integrationConfigs).catch((err) => {
      logger.error('Failed to initialize integrations:', err)
    })
  }

  return { events, handlers, remoteHandlers, schedules, stubCache, fireAndForgetErrors, integrations, things, sql, entitySchemas, legacyEntitySchemas, evaluator }
}

/**
 * Create the event processor function that handles event processing with retry logic
 */
function createEventProcessor(
  state: ContextState,
  baseContext: () => BaseContextWithInternals
): (emitted: Event, eventType: string, payload: unknown) => Promise<void> {
  const { events, handlers, remoteHandlers, fireAndForgetErrors, evaluator } = state

  return async function processEvent(emitted: Event, eventType: string, payload: unknown): Promise<void> {
    // Get durability config for this event type (supports per-type configuration)
    const config = events.getDurabilityConfig(eventType)
    const retryOptions: RetryOptions = {
      maxRetries: config.retries ?? 3, // Max 3 retries by default as per task spec
      backoff: config.backoff ?? 'exponential',
      initialDelay: 100
    }

    // Use invokeHandlers which includes retry logic
    const result = await invokeHandlers(eventType, emitted, handlers, retryOptions)

    // Also invoke remote handlers (do-qkqhm)
    // Remote handlers are stringified functions registered via RPC
    // They execute server-side with access to the $ context
    // Uses custom evaluator if provided (e.g., ai-evaluate sandbox)
    const remoteResult = await invokeRemoteHandlers(
      eventType,
      emitted,
      remoteHandlers,
      {
        // Provide the $ context to remote handlers
        context: { $: baseContext() },
        timeout: 30000,
        // Use custom evaluator if provided (do-qkqhm)
        // In production, this should be ai-evaluate for secure sandboxed execution
        evaluator: evaluator
      }
    )

    // Combine results for metrics (remote handlers use single attempt for now)
    const combinedResult = {
      succeeded: [...result.succeeded, ...remoteResult.succeeded.map(r => ({ attempts: r.attempts }))],
      failed: [...result.failed, ...remoteResult.failed.map(r => ({ attempts: r.attempts, error: r.error }))]
    }

    // Handle failed handlers - add to DLQ, track validation failures, and track in error store
    for (const failure of result.failed) {
      trackHandlerFailure(failure, eventType, payload, result.failed.indexOf(failure), fireAndForgetErrors, events, emitted)
    }

    // Track remote handler failures
    for (const failure of remoteResult.failed) {
      trackHandlerFailure(
        { error: failure.error, attempts: failure.attempts },
        eventType,
        payload,
        result.failed.length + remoteResult.failed.indexOf(failure),
        fireAndForgetErrors,
        events,
        emitted
      )
    }

    // Update retry status and metrics
    updateRetryMetrics(combinedResult, emitted, eventType, payload, events)

    // Emit recovery events for handlers that succeeded after retries
    await emitRecoveryEvents(result, emitted, eventType, handlers)
  }
}

/**
 * Track a handler failure in the error store and DLQ/validation queue
 */
function trackHandlerFailure(
  failure: { error?: Error; attempts: number },
  eventType: string,
  payload: unknown,
  handlerIndex: number,
  fireAndForgetErrors: FireAndForgetErrorStore,
  events: EventsStore,
  emitted: Event
): void {
  const errorInfo = extractErrorInfo(failure.error)

  // Track in fire-and-forget error store
  const errorContext = typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : undefined
  fireAndForgetErrors.track({
    operation: 'event.handler',
    eventType: eventType,
    handlerIndex,
    message: errorInfo.message,
    ...(errorInfo.stack !== undefined && { stack: errorInfo.stack }),
    errorType: errorInfo.errorType,
    retriable: errorInfo.retriable,
    ...(errorContext !== undefined && { context: errorContext }),
    attempts: failure.attempts,
  })

  if (failure.error instanceof ValidationError) {
    events.addValidationFailure({
      type: eventType,
      payload: payload as JsonValue,
      error: `ValidationError: ${failure.error.message}`,
      details: failure.error.details as Record<string, JsonValue> | undefined
    })
  } else {
    events.addToDeadLetterQueue({
      event: emitted,
      attempts: failure.attempts,
      lastError: failure.error?.message || 'Unknown error'
    })
  }
}

/**
 * Update retry status and metrics for an event
 */
function updateRetryMetrics(
  result: { succeeded: Array<{ attempts: number }>; failed: Array<{ attempts: number }> },
  emitted: Event,
  eventType: string,
  payload: unknown,
  events: EventsStore
): void {
  // Calculate total attempts (max across all handlers)
  const totalAttempts = Math.max(
    ...result.succeeded.map(h => h.attempts),
    ...result.failed.map(h => h.attempts),
    1
  )

  // Track event retry status using event payload's id or the emitted $id
  const eventId = (payload as { id?: string })?.id || emitted.$id
  events.setEventRetryStatus(eventId, {
    attempts: totalAttempts,
    succeeded: result.failed.length === 0,
    lastAttempt: Date.now()
  })

  // Record retry metrics
  const totalRetries = result.succeeded.reduce((sum, h) => sum + (h.attempts - 1), 0) +
                      result.failed.reduce((sum, h) => sum + (h.attempts - 1), 0)

  if (result.succeeded.length > 0 || result.failed.length > 0) {
    events.recordRetryAttempt(
      eventType,
      result.failed.length === 0,
      totalRetries
    )
  }
}

/**
 * Emit recovery events for handlers that succeeded after retries
 */
async function emitRecoveryEvents(
  result: { succeeded: Array<{ attempts: number }> },
  emitted: Event,
  eventType: string,
  handlers: Map<string, EventHandler[]>
): Promise<void> {
  for (const success of result.succeeded) {
    if (success.attempts > 1) {
      const recoveryEvent = {
        $id: `recovery-${emitted.$id}`,
        type: 'System.recovered',
        originalEvent: { type: eventType },
        attempts: success.attempts,
        $timestamp: Date.now(),
        source: 'system'
      }

      const recoveryHandlers = matchHandlers('System.recovered', handlers)
      for (const handler of recoveryHandlers) {
        try {
          await handler(recoveryEvent)
        } catch (err) {
          logger.error('Error in recovery handler:', err)
        }
      }
    }
  }
}

/**
 * Setup the event subscription for replayed events from the DLQ
 */
function setupEventSubscription(
  state: ContextState,
  processEvent: (emitted: Event, eventType: string, payload: unknown) => Promise<void>
): void {
  state.events.subscribe((event) => {
    // Only process events replayed from the DLQ (source: 'dlq-replay')
    // Events from $.send() have source: 'workflow' and are processed separately
    if (event.source !== 'dlq-replay') {
      return
    }

    // Process replayed events with retry logic
    processEvent(event, event.type, event.payload).catch((err) => {
      logger.error(`Error processing replayed event "${event.type}":`, err)
    })
  })
}

/**
 * Create a WorkflowContext ($) instance
 *
 * This is the main factory function for creating the $ context that provides
 * the fluent API for event handlers, scheduling, cross-DO RPC, and durability levels.
 *
 * @param state - The DurableObjectState
 * @param env - The environment containing DO namespace bindings
 * @param options - Optional configuration
 * @returns WorkflowContext instance
 *
 * @example
 * ```ts
 * const $ = createContext(state, env)
 *
 * // Event handlers
 * $.on.Customer.signup(async (event) => {
 *   await $.send({ type: 'welcome-email', payload: { to: event.email } })
 * })
 *
 * // Scheduling
 * $.every.Monday.at('9am')(async () => {
 *   await generateWeeklyReport()
 * })
 *
 * // Cross-DO RPC
 * await $.Customer(customerId).notify({ message: 'Hello' })
 *
 * // Durability levels
 * $.send(event)              // Fire-and-forget
 * await $.try(action)        // Single attempt
 * await $.do(action)         // Durable with retries
 * ```
 */
export function createContext(
  _state: DurableObjectState,
  env: unknown,
  options?: CreateContextOptions
): WorkflowContext {
  // Initialize state using helper function
  const state = initializeContextState(options)
  const { events, handlers, remoteHandlers, schedules, stubCache, fireAndForgetErrors, integrations } = state

  // Create a lazy reference to base context (needed for remote handler execution)
  // This allows the event processor to access the full context including RPC capabilities
  let baseContextRef: BaseContextWithInternals | null = null
  const getBaseContext = () => {
    if (!baseContextRef) {
      throw new Error('Context not yet initialized')
    }
    return baseContextRef
  }

  // Create event processor using helper function (with lazy context reference)
  const processEvent = createEventProcessor(state, getBaseContext)

  // Setup event subscription for DLQ replays using helper function
  setupEventSubscription(state, processEvent)

  // Create the base context object using helper function
  const baseContext = createBaseContext(
    state,
    processEvent,
    env,
    options
  )

  // Store reference for lazy access
  baseContextRef = baseContext

  // Wrap context in Proxy to support cross-DO RPC: $.Customer(id)
  // Uses _env and _stubCache from baseContext directly - no duplicate reference needed (do-1e3z)
  return createDORPCProxy(baseContext) as WorkflowContext
}

/**
 * Create the base context object with all workflow methods
 */
function createBaseContext(
  state: ContextState,
  processEvent: (emitted: Event, eventType: string, payload: unknown) => Promise<void>,
  env: unknown,
  options?: CreateContextOptions
): BaseContextWithInternals {
  const { events, handlers, remoteHandlers, schedules, stubCache, fireAndForgetErrors, integrations, things, sql, entitySchemas, legacyEntitySchemas, evaluator } = state

  const baseContext: BaseContextWithInternals = {
    // Fire-and-forget event emission with retry support
    send(event: { type: string; payload?: JsonValue }) {
      const payload = event.payload ?? null
      events.emit({
        type: event.type,
        payload,
        source: 'workflow'
      }).then(async (emitted) => {
        // Process handlers with retry logic
        await processEvent(emitted, event.type, payload)
      }).catch((err: unknown) => {
        // Track error in fire-and-forget error store (do-l2kx4)
        const errorInfo = extractErrorInfo(err)
        const errorContext = typeof payload === 'object' && payload !== null
          ? payload as Record<string, unknown>
          : undefined
        fireAndForgetErrors.track({
          operation: 'event.send',
          eventType: event.type,
          message: errorInfo.message,
          ...(errorInfo.stack !== undefined && { stack: errorInfo.stack }),
          errorType: errorInfo.errorType,
          retriable: errorInfo.retriable,
          ...(errorContext !== undefined && { context: errorContext }),
        })

        // Log error for visibility
        logger.error(`Error processing event "${event.type}":`, err)

        // Invoke configurable error handler if provided (do-l2kx4)
        if (options?.onSendError) {
          try {
            options.onSendError(err, event)
          } catch (handlerErr) {
            logger.error('Error in onSendError handler:', handlerErr)
          }
        }

        // Emit system event for observability (do-l2kx4)
        // Note: We use setImmediate-style to avoid infinite recursion if System.sendFailed handler also fails
        queueMicrotask(() => {
          const systemHandlers = matchHandlers('System.sendFailed', handlers)
          const systemEvent = {
            $id: `send-failed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'System.sendFailed',
            payload: {
              originalEvent: event,
              error: {
                message: errorInfo.message,
                type: errorInfo.errorType,
                retriable: errorInfo.retriable,
              },
            },
            $timestamp: Date.now(),
            source: 'system',
          }
          for (const handler of systemHandlers) {
            try {
              // Fire-and-forget for system handlers - don't await
              Promise.resolve(handler(systemEvent)).catch((sysErr) => {
                logger.error('Error in System.sendFailed handler:', sysErr)
              })
            } catch (syncErr) {
              logger.error('Error in System.sendFailed handler:', syncErr)
            }
          }
        })
      })
    },

    // Single attempt - no retries, optional timeout
    try: createTryMethod(),

    // Durable with retries
    do: createDoMethod(),

    // Event handlers - Proxy-based
    on: createOnProxy(handlers),

    // Scheduling DSL - with callback for alarm scheduling (do-7td2u.1)
    every: createEveryProxy(schedules, {
      onScheduleRegistered: options?.onScheduleRegistered,
    }),

    // Integration registry for third-party services
    integrations,

    // Extended primitives (fsx, gitx, bashx, npmx) - wired via options (do-ibsi)
    fs: options?.fs,
    git: options?.git,
    bash: options?.bash,
    npm: options?.npm,

    // Context propagation methods (do-nexi)
    run<T>(fn: () => T): T {
      return runWithWorkflowContextSync(baseContext as unknown as WorkflowContext, fn)
    },
    getRequestId(): string | undefined {
      return getRequestId()
    },
    getMetadata<T = unknown>(key: string): T | undefined {
      return getContextMetadata<T>(key)
    },
    setMetadata(key: string, value: unknown): void {
      setContextMetadata(key, value)
    },
    hasContext(): boolean {
      return hasWorkflowContext()
    },

    // Remote handler registration (do-qkqhm)
    /**
     * Register a remote event handler from stringified code.
     *
     * This is the RPC endpoint called by remote clients to register event handlers
     * that execute server-side. The handler code is stringified on the client side
     * and sent here for storage and execution when events fire.
     *
     * @param params - Registration parameters
     * @param params.event - Event type pattern (e.g., 'Customer.signup')
     * @param params.code - Stringified handler function code
     * @param params.source - Optional source identifier (client ID, etc.)
     * @returns The registered handler info
     *
     * @example
     * ```ts
     * // Client-side (via RPC):
     * await $.registerHandler({
     *   event: 'Customer.signup',
     *   code: 'async (event) => { console.log(event.email) }',
     *   source: 'client-123'
     * })
     * ```
     */
    registerHandler(params: { event: string; code: string; source?: string }): RemoteEventHandler {
      const { event, code, source } = params

      // Validate the event pattern
      if (!event || typeof event !== 'string') {
        throw new ValidationError('Event pattern is required and must be a string', { field: 'event' })
      }

      // Validate the code
      if (!code || typeof code !== 'string') {
        throw new ValidationError('Handler code is required and must be a string', { field: 'code' })
      }

      // Basic validation that code looks like a function
      const trimmedCode = code.trim()
      const looksLikeFunction = (
        trimmedCode.startsWith('function') ||
        trimmedCode.startsWith('async function') ||
        trimmedCode.includes('=>') ||
        trimmedCode.startsWith('(')
      )

      if (!looksLikeFunction) {
        throw new ValidationError('Handler code must be a function expression', { field: 'code' })
      }

      // Register the remote handler
      return registerRemoteHandler(event, code, remoteHandlers, source)
    },

    // Database Schema Methods (do-lekf.8)
    /**
     * Define entire database schema at once (ai-database style).
     * Parses the schema using the unified parser, registers all entities,
     * and generates/executes DDL when sql storage is provided (do-lekf.3).
     */
    DB(schemas: RawDatabaseSchema): void {
      if (!things) {
        throw new Error('Cannot use $.DB() without a things store. Pass { things: store } to createContext options.')
      }

      // Parse the raw schema using the unified parser
      const parsed = parseSchema(schemas)

      // DDL options for table/index generation (do-lekf.3)
      const ddlOptions: DDLOptions = {
        ifNotExists: true,
        foreignKeys: true,
        indexes: true,
        compositeIndexes: true,
        fullTextSearch: true,
      }

      // Register each entity schema and generate DDL (do-lekf.3)
      for (const [name, schema] of parsed.entities) {
        // Check if this is a new entity or an update (for migrations)
        const existingSchema = entitySchemas.get(name)

        // Register the new schema
        entitySchemas.set(name, schema)

        // Convert fields Map to array of entries - handle both Map and plain object
        // (workers runtime may serialize Maps as plain objects)
        const fieldsEntries = schema.fields instanceof Map
          ? Array.from(schema.fields.entries())
          : Object.entries(schema.fields as unknown as Record<string, { type: string; required: boolean; defaultValue?: unknown }>)

        // Also register in legacy schema format for backward compatibility with entity proxy
        legacyEntitySchemas.set(name, {
          name,
          fields: Object.fromEntries(
            fieldsEntries.map(([fieldName, field]) => [
              fieldName,
              {
                type: field.type as 'string' | 'number' | 'boolean' | 'object' | 'array',
                required: field.required,
                default: field.defaultValue,
              }
            ])
          ),
          strict: false,
        })

        // Generate and execute DDL if sql storage is provided (do-lekf.3)
        if (sql) {
          try {
            if (existingSchema) {
              // Schema migration: generate ALTER TABLE statements
              const migrationStatements = generateMigrationDDL(existingSchema, schema, ddlOptions)
              for (const statement of migrationStatements) {
                // Skip comments (warnings about removed fields)
                if (!statement.startsWith('--')) {
                  sql.exec(statement)
                  logger.debug(`Executed migration: ${statement.substring(0, 80)}...`)
                }
              }
              logger.info(`Migrated schema for entity "${name}"`)
            } else {
              // New entity: generate CREATE TABLE and indexes
              const { ddl } = generateSchemaDDL(new Map([[name, schema]]), ddlOptions)
              sql.exec(ddl)
              logger.info(`Created table and indexes for entity "${name}"`)
            }
          } catch (err) {
            logger.error(`Failed to execute DDL for entity "${name}":`, err)
            throw err
          }
        }
      }

      logger.info(`Registered ${parsed.entities.size} entity schemas: ${Array.from(parsed.entities.keys()).join(', ')}`)
    },

    // Internal state
    _events: events,
    _handlers: handlers,
    _remoteHandlers: remoteHandlers,
    _schedules: schedules,
    _stubCache: stubCache,
    _env: env,
    _fireAndForgetErrors: fireAndForgetErrors,
    // Circuit breaker config for cross-DO RPC (do-fcxj)
    _circuitBreakerConfig: options?.circuitBreaker,
    // Entity state (do-lekf.8)
    _things: things,
    _entitySchemas: entitySchemas,
    _legacyEntitySchemas: legacyEntitySchemas,
    // SQL storage for DDL execution (do-lekf.3)
    _sql: sql,
    // Custom evaluator for remote handler execution (do-qkqhm)
    _evaluator: evaluator,
  }

  return baseContext
}

/**
 * Create the $.try method - single attempt with optional timeout
 */
function createTryMethod() {
  return async function tryAction<T>(action: () => Promise<T>, options: TryOptions = {}): Promise<T> {
    const { timeout } = options

    // If no timeout specified, just execute the action directly
    if (timeout === undefined) {
      return action()
    }

    // Wrap with timeout
    return Promise.race([
      action(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(TimeoutError.afterMs(timeout)), timeout)
      )
    ])
  }
}

/**
 * Create the $.do method - durable action with retries and timeout
 */
function createDoMethod() {
  return async function doAction<T>(action: () => Promise<T>, options: DoOptions = {}): Promise<T> {
    const { retries = 3, backoff = 'exponential', timeout = 30000 } = options

    let lastError: RPCError | undefined

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Wrap with timeout
        const result = await Promise.race([
          action(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(TimeoutError.afterMs(timeout)), timeout)
          )
        ])
        return result
      } catch (error) {
        // Preserve RPCErrors, wrap others
        if (error instanceof RPCError) {
          lastError = error
        } else {
          lastError = InternalError.wrap(error)
        }

        // Log retry attempt (no silent catches)
        logger.warn(`Attempt ${attempt + 1}/${retries + 1} failed:`, lastError.message)

        if (attempt < retries) {
          // Wait before retry
          const delay = backoff === 'exponential'
            ? Math.pow(2, attempt) * 100
            : (attempt + 1) * 100
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    throw lastError
  }
}

// Re-export types for convenience
export type { EventHandler, OnProxy, RetryOptions, RemoteEventHandler, RemoteHandlerResult } from './events'
export type { ScheduleHandler, ScheduleInterval, ScheduleRegistration } from './schedule'
export type { DOStubProxy } from './rpc'
export { StubCache, createStubCache, DEFAULT_STUB_CACHE_OPTIONS } from './stub-cache'
export type { StubCacheOptions, CacheEntry, CacheStats } from './stub-cache'
