/**
 * @module WorkflowContext
 * @description Workflow context ($) management for Durable Objects
 *
 * Handles the WorkflowContext proxy, event handlers, schedule handlers,
 * and execution modes (send, try, do). Extracted from DOBase.
 */

import type {
  WorkflowContext as IWorkflowContext,
  OnProxy,
  OnNounProxy,
  EventHandler,
  DomainEvent,
  ScheduleBuilder,
  ScheduleHandler,
  HandlerOptions,
  HandlerRegistration,
  RetryPolicy,
  ActionStatus,
  ActionError,
  TryOptions,
  DoOptions,
} from '../../types/WorkflowContext'
import { createScheduleBuilderProxy, type ScheduleBuilderConfig } from '../../workflows/schedule-builder'
import { ScheduleManager, type Schedule } from '../../workflows/ScheduleManager'
import { logBestEffortError } from '../../lib/logging/error-logger'
import type { DOLocation } from '../../types/Location'

// Import AI functions
import {
  ai as aiFunc,
  write as writeFunc,
  summarize as summarizeFunc,
  list as listFunc,
  extract as extractFunc,
  is as isFunc,
  decide as decideFunc,
} from '../../ai'

/**
 * Dependencies required by WorkflowContextManager
 */
export interface WorkflowContextDeps {
  /** Namespace URL */
  ns: string

  /** DurableObjectState for scheduling */
  ctx: DurableObjectState

  /** User context from request headers */
  user: { id: string; email?: string; role?: string } | null

  /** Get location (async) */
  getLocation: () => Promise<DOLocation>

  /** Log function */
  log: (message: string, data?: unknown) => void

  /** Sleep function */
  sleep: (ms: number) => Promise<void>

  /** Emit event function */
  emitEvent: (verb: string, data: unknown) => Promise<void>

  /** Create domain proxy for $.Noun(id) */
  createDomainProxy: (noun: string, id: string) => unknown

  /** Log action to database */
  logAction: (
    durability: 'send' | 'try' | 'do',
    verb: string,
    input: unknown
  ) => Promise<{ id: string; rowid: number }>

  /** Update action status */
  updateActionStatus: (
    actionId: string,
    status: ActionStatus,
    fields?: { startedAt?: Date; attempts?: number }
  ) => Promise<void>

  /** Update action attempts */
  updateActionAttempts: (actionId: string, attempts: number) => Promise<void>

  /** Complete action */
  completeAction: (
    actionId: string,
    output: unknown,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ) => Promise<void>

  /** Fail action */
  failAction: (
    actionId: string,
    error: ActionError,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ) => Promise<void>

  /** Execute action */
  executeAction: (action: string, data: unknown) => Promise<unknown>

  /** Persist step result */
  persistStepResult: (stepId: string, result: unknown) => Promise<void>

  /** Dispatch event to handlers */
  dispatchEventToHandlers: (event: DomainEvent) => Promise<void>

  /** DLQ add function for error recovery */
  addToDlq: (entry: {
    eventId: string
    verb: string
    source: string
    data: unknown
    error: string
    errorStack?: string
    maxRetries: number
  }) => Promise<void>
}

/**
 * Default retry policy for durable execution
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
}

export const DEFAULT_TRY_TIMEOUT = 30000

/**
 * WorkflowContextManager - Manages the $ workflow context
 *
 * This class encapsulates all workflow-related state and behavior,
 * allowing it to be composed into DO classes rather than inherited.
 */
export class WorkflowContextManager {
  /** Event handler registry for $.on.Noun.verb() registration */
  readonly eventHandlers: Map<string, HandlerRegistration[]> = new Map()

  /** Schedule handler registry for $.every scheduling */
  readonly scheduleHandlers: Map<string, ScheduleHandler> = new Map()

  /** Step cache for durable execution */
  private _stepCache: Map<string, { result: unknown; completedAt: number }> = new Map()

  /** Handler counter for naming */
  private _handlerCounter: number = 0

  /** Schedule manager instance */
  private _scheduleManager?: ScheduleManager

  private readonly deps: WorkflowContextDeps

  constructor(deps: WorkflowContextDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create the WorkflowContext proxy ($)
   */
  createWorkflowContext(): IWorkflowContext {
    const self = this

    // List of known properties for hasOwnProperty checks
    const knownProperties = new Set([
      'send', 'try', 'do', 'on', 'every', 'log', 'state', 'location', 'user',
      'ai', 'write', 'summarize', 'list', 'extract', 'is', 'decide',
    ])

    return new Proxy({} as IWorkflowContext, {
      get(_, prop: string) {
        switch (prop) {
          // Execution modes
          case 'send':
            return (event: string, data: unknown) => self.send(event, data)
          case 'try':
            return <T>(action: string, data: unknown, options?: TryOptions) =>
              self.try<T>(action, data, options)
          case 'do':
            return <T>(action: string, data: unknown, options?: DoOptions) =>
              self.do<T>(action, data, options)

          // Event subscriptions and scheduling
          case 'on':
            return self.createOnProxy()
          case 'every':
            return self.createScheduleBuilder()

          // Utilities
          case 'log':
            return self.deps.log
          case 'state':
            return {}

          // Location access (lazy, returns Promise)
          case 'location':
            return self.deps.getLocation()

          // User context (from X-User-* headers)
          case 'user':
            return self.deps.user

          // AI Functions - Generation
          case 'ai':
            return aiFunc
          case 'write':
            return writeFunc
          case 'summarize':
            return summarizeFunc
          case 'list':
            return listFunc
          case 'extract':
            return extractFunc

          // AI Functions - Classification
          case 'is':
            return isFunc
          case 'decide':
            return decideFunc

          default:
            // Domain resolution: $.Noun(id)
            return (id: string) => self.deps.createDomainProxy(prop, id)
        }
      },
      has(_, prop: string | symbol) {
        // Support `in` operator and hasOwnProperty checks for known properties
        return knownProperties.has(String(prop))
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULE MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  get scheduleManager(): ScheduleManager {
    if (!this._scheduleManager) {
      this._scheduleManager = new ScheduleManager(this.deps.ctx)
      this._scheduleManager.onScheduleTrigger(async (schedule: Schedule) => {
        const handler = this.scheduleHandlers.get(schedule.name)
        if (handler) {
          await handler()
        }
      })
    }
    return this._scheduleManager
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION MODES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   */
  send(event: string, data: unknown): void {
    queueMicrotask(() => {
      this.deps.logAction('send', event, data).catch((error) => {
        console.error(`[send] Failed to log action for ${event}:`, error)
        this.emitSystemError('send.logAction.failed', event, error)
      })
      this.deps.emitEvent(event, data).catch((error) => {
        console.error(`[send] Failed to emit event ${event}:`, error)
        this.emitSystemError('send.emitEvent.failed', event, error)
      })
      this.deps.executeAction(event, data).catch((error) => {
        console.error(`[send] Failed to execute action ${event}:`, error)
        this.emitSystemError('send.executeAction.failed', event, error)
      })
    })
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  async try<T>(action: string, data: unknown, options?: TryOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TRY_TIMEOUT
    const startedAt = new Date()

    const actionRecord = await this.deps.logAction('try', action, data)
    await this.deps.updateActionStatus(actionRecord.id, 'running', { startedAt })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action '${action}' timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      const result = await Promise.race([
        this.deps.executeAction(action, data),
        timeoutPromise,
      ]) as T

      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      await this.deps.completeAction(actionRecord.id, result, { completedAt, duration })
      await this.deps.emitEvent(`${action}.completed`, { result })

      return result
    } catch (error) {
      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      const actionError: ActionError = {
        message: (error as Error).message,
        name: (error as Error).name,
        stack: (error as Error).stack,
      }

      await this.deps.failAction(actionRecord.id, actionError, { completedAt, duration })
      await this.deps.emitEvent(`${action}.failed`, { error: actionError }).catch(() => {})

      throw error
    }
  }

  /**
   * Durable execution with retries (blocking, durable)
   */
  async do<T>(action: string, data: unknown, options?: DoOptions): Promise<T> {
    const retryPolicy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...options?.retry,
    }

    const stepId = options?.stepId ?? this.generateStepId(action, data)

    const cachedResult = this._stepCache.get(stepId)
    if (cachedResult) {
      return cachedResult.result as T
    }

    const startedAt = new Date()
    const actionRecord = await this.deps.logAction('do', action, data)

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      attempts = attempt

      const status: ActionStatus = attempt === 1 ? 'running' : 'retrying'
      await this.deps.updateActionStatus(actionRecord.id, status, { startedAt, attempts })

      try {
        const result = await this.deps.executeAction(action, data) as T

        const completedAt = new Date()
        const duration = completedAt.getTime() - startedAt.getTime()

        await this.deps.completeAction(actionRecord.id, result, { completedAt, duration, attempts })

        this._stepCache.set(stepId, { result, completedAt: completedAt.getTime() })
        await this.deps.persistStepResult(stepId, result)
        await this.deps.emitEvent(`${action}.completed`, { result })

        return result
      } catch (error) {
        lastError = error as Error
        await this.deps.updateActionAttempts(actionRecord.id, attempts)

        if (attempt < retryPolicy.maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt, retryPolicy)
          await this.deps.sleep(delay)
        }
      }
    }

    const completedAt = new Date()
    const duration = completedAt.getTime() - startedAt.getTime()

    const actionError: ActionError = {
      message: lastError!.message,
      name: lastError!.name,
      stack: lastError!.stack,
    }

    await this.deps.failAction(actionRecord.id, actionError, { completedAt, duration, attempts })
    await this.deps.emitEvent(`${action}.failed`, { error: actionError })

    throw lastError
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROXY FACTORIES
  // ═══════════════════════════════════════════════════════════════════════════

  createOnProxy(): OnProxy {
    const self = this

    return new Proxy({} as OnProxy, {
      get: (_, noun: string): OnNounProxy => {
        return new Proxy({} as OnNounProxy, {
          get: (_, verb: string): ((handler: EventHandler, options?: HandlerOptions) => void) => {
            return (handler: EventHandler, options?: HandlerOptions): void => {
              const eventKey = `${noun}.${verb}`
              const registrations = self.eventHandlers.get(eventKey) ?? []

              const handlerName = options?.name
                || (handler as Function).name
                || `handler_${++self._handlerCounter}`

              const registration: HandlerRegistration = {
                name: handlerName,
                priority: options?.priority ?? 0,
                registeredAt: Date.now(),
                sourceNs: self.deps.ns,
                handler,
                filter: options?.filter,
                maxRetries: options?.maxRetries ?? 3,
                executionCount: 0,
                successCount: 0,
                failureCount: 0,
              }

              registrations.push(registration)
              registrations.sort((a, b) => {
                if (b.priority !== a.priority) {
                  return b.priority - a.priority
                }
                return a.registeredAt - b.registeredAt
              })

              self.eventHandlers.set(eventKey, registrations)
            }
          },
        })
      },
    })
  }

  createScheduleBuilder(): ScheduleBuilder {
    const self = this

    const config: ScheduleBuilderConfig = {
      state: this.deps.ctx,
      onScheduleRegistered: (cron: string, name: string, handler: ScheduleHandler) => {
        self.scheduleHandlers.set(name, handler)
        self.scheduleManager.schedule(cron, name).catch((error) => {
          console.error(`Failed to register schedule ${name}:`, error)
        })
      },
    }

    return createScheduleBuilderProxy(config) as unknown as ScheduleBuilder
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
    let delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)
    delay = Math.min(delay, policy.maxDelayMs)

    if (policy.jitter) {
      const jitterRange = delay * 0.25
      delay += Math.random() * jitterRange
    }

    return Math.floor(delay)
  }

  generateStepId(action: string, data: unknown): string {
    const content = JSON.stringify({ action, data })
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${action}:${Math.abs(hash).toString(36)}`
  }

  /**
   * Emit a system error event for monitoring/observability
   */
  private emitSystemError(errorType: string, originalEvent: string, error: unknown): void {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined

      console.error(`[system.${errorType}]`, {
        ns: this.deps.ns,
        originalEvent,
        error: errorMessage,
        stack: errorStack,
      })

      // Try to persist to DLQ for later replay
      this.deps.addToDlq({
        eventId: `system-error-${crypto.randomUUID()}`,
        verb: errorType,
        source: this.deps.ns,
        data: { originalEvent, error: errorMessage },
        error: errorMessage,
        errorStack,
        maxRetries: 3,
      }).catch(() => {
        console.error(`[CRITICAL] Failed to add system error to DLQ: ${errorType}`)
      })
    } catch (catchError) {
      logBestEffortError(catchError, {
        operation: 'emitSystemError',
        source: 'WorkflowContextManager.emitSystemError',
        context: { errorType, originalEvent, ns: this.deps.ns },
      })
    }
  }

  /**
   * Load persisted steps into cache
   */
  async loadPersistedSteps(storage: DurableObjectStorage): Promise<void> {
    try {
      const steps = await storage.list({ prefix: 'step:' })
      steps.forEach((value, key) => {
        const stepId = key.replace('step:', '')
        const data = value as { result: unknown; completedAt: number }
        this._stepCache.set(stepId, data)
      })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'loadPersistedSteps',
        source: 'WorkflowContextManager.loadPersistedSteps',
        context: { ns: this.deps.ns },
      })
    }
  }

  /**
   * Get step cache (for debugging/testing)
   */
  get stepCache(): Map<string, { result: unknown; completedAt: number }> {
    return this._stepCache
  }
}

/**
 * Factory function to create a WorkflowContextManager instance
 */
export function createWorkflowContextManager(deps: WorkflowContextDeps): WorkflowContextManager {
  return new WorkflowContextManager(deps)
}
