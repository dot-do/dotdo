/**
 * DOWorkflow Module - $ context, events, scheduling
 *
 * This module extracts workflow-related functionality from DOBase:
 * - WorkflowContext ($) creation via createWorkflowContext()
 * - $.send, $.try, $.do execution modes
 * - $.on.Noun.verb() event handler registration
 * - $.every scheduling builder
 * - Event emission and dispatch
 * - Action logging (logAction, completeAction, failAction)
 * - Retry policies and backoff calculation
 *
 * @module DOWorkflow
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../db'
import { logBestEffortError } from '@/lib/logging/error-logger'
import { createLogger, LogLevel } from '@/lib/logging'
import type {
  WorkflowContext,
  DomainProxy,
  OnProxy,
  OnNounProxy,
  EventHandler,
  DomainEvent,
  ScheduleBuilder,
  ScheduleHandler,
  TryOptions,
  DoOptions,
  RetryPolicy,
  ActionStatus,
  ActionError,
  HandlerOptions,
  HandlerRegistration,
  EnhancedDispatchResult,
  UserContext,
} from '../../types/WorkflowContext'
import { createScheduleBuilderProxy, type ScheduleBuilderConfig } from '../../workflows/schedule-builder'
import { ScheduleManager, type Schedule } from '../../workflows/ScheduleManager'
import { logBestEffortError } from '../../lib/logging/error-logger'
import {
  ai as aiFunc,
  write as writeFunc,
  summarize as summarizeFunc,
  list as listFunc,
  extract as extractFunc,
  is as isFunc,
  decide as decideFunc,
} from '../../ai'

// Re-export WorkflowContext type for consumers
export type { WorkflowContext }

/**
 * Workflow context interface for the workflow module
 */
export interface WorkflowContextInput {
  db: DrizzleD1Database
  ns: string
  ctx: DurableObjectState
  getLocation: () => Promise<unknown>
  user?: UserContext
  sleep: (ms: number) => Promise<void>
  invokeDomainMethod?: (noun: string, id: string, method: string, args: unknown[]) => Promise<unknown>
  dlq: {
    add(entry: {
      eventId: string
      verb: string
      source: string
      data: unknown
      error: string
      errorStack?: string
      maxRetries: number
    }): Promise<{ id: string }>
  }
  persistStepResult?: (stepId: string, result: unknown) => Promise<void>
  getStepResult?: (stepId: string) => { result: unknown; completedAt: number } | undefined
  env?: Record<string, unknown>
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
 * DOWorkflow - Manages workflow context, events, and scheduling
 */
export class DOWorkflow {
  // Context reference
  private readonly _input: WorkflowContextInput

  // Event handler registry for $.on.Noun.verb() registration
  _eventHandlers: Map<string, HandlerRegistration[]> = new Map()
  private _handlerCounter: number = 0

  // Schedule handler registry for $.every scheduling
  _scheduleHandlers: Map<string, ScheduleHandler> = new Map()
  private _scheduleManager?: ScheduleManager

  // Action registry for custom action handlers
  private _actionHandlers: Map<string, (data: unknown) => unknown | Promise<unknown>> = new Map()

  // Current actor for action logging
  private _currentActor: string = ''

  // The workflow context ($) proxy
  readonly $: WorkflowContext

  constructor(input: WorkflowContextInput) {
    this._input = input
    this.$ = this.createWorkflowContext()
  }

  /**
   * Get the schedule manager (lazy initialized)
   */
  get scheduleManager(): ScheduleManager {
    if (!this._scheduleManager) {
      this._scheduleManager = new ScheduleManager(this._input.ctx)
      this._scheduleManager.onScheduleTrigger(async (schedule: Schedule) => {
        const handler = this._scheduleHandlers.get(schedule.name)
        if (handler) {
          await handler()
        }
      })
    }
    return this._scheduleManager
  }

  /**
   * Create the workflow context proxy ($)
   */
  private createWorkflowContext(): WorkflowContext {
    const self = this

    // List of known properties for hasOwnProperty checks
    const knownProperties = new Set([
      'send', 'try', 'do', 'on', 'every', 'log', 'state', 'location', 'user',
      'ai', 'write', 'summarize', 'list', 'extract', 'is', 'decide',
    ])

    return new Proxy({} as WorkflowContext, {
      get(_, prop: string) {
        switch (prop) {
          // Execution modes
          case 'send':
            return self.send.bind(self)
          case 'try':
            return self.try.bind(self)
          case 'do':
            return self.do.bind(self)

          // Event subscriptions and scheduling
          case 'on':
            return self.createOnProxy()
          case 'every':
            return self.createScheduleBuilder()

          // Utilities
          case 'log':
            return self.log.bind(self)
          case 'state':
            return {}

          // Location access (lazy, returns Promise)
          case 'location':
            return self._input.getLocation()

          // User context
          case 'user':
            return self._input.user

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
            return (id: string) => self.createDomainProxy(prop, id)
        }
      },
      has(_, prop: string | symbol) {
        return knownProperties.has(String(prop))
      },
    })
  }

  /**
   * Register an action handler
   */
  registerAction(name: string, handler: (data: unknown) => unknown | Promise<unknown>): void {
    this._actionHandlers.set(name, handler)
  }

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   */
  send(event: string, data: unknown): void {
    queueMicrotask(() => {
      this.logAction('send', event, data).catch((error) => {
        logBestEffortError(error, { operation: 'logAction', source: 'DOWorkflow.send', context: { event } })
      })
      this.emitEvent(event, data).catch((error) => {
        logBestEffortError(error, { operation: 'emitEvent', source: 'DOWorkflow.send', context: { event } })
      })
      this.executeAction(event, data).catch((error) => {
        logBestEffortError(error, { operation: 'executeAction', source: 'DOWorkflow.send', context: { event } })
      })
    })
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  async try<T>(action: string, data: unknown, options?: TryOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TRY_TIMEOUT
    const startedAt = new Date()

    const actionRecord = await this.logAction('try', action, data)
    await this.updateActionStatus(actionRecord.id, 'running', { startedAt })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action '${action}' timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      const result = await Promise.race([
        this.executeAction(action, data),
        timeoutPromise,
      ]) as T

      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      await this.completeAction(actionRecord.id, result, { completedAt, duration })
      await this.emitEvent(`${action}.completed`, { result })

      return result
    } catch (error) {
      const completedAt = new Date()
      const duration = completedAt.getTime() - startedAt.getTime()

      const actionError: ActionError = {
        message: (error as Error).message,
        name: (error as Error).name,
        stack: (error as Error).stack,
      }

      await this.failAction(actionRecord.id, actionError, { completedAt, duration })
      await this.emitEvent(`${action}.failed`, { error: actionError }).catch(() => {})

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

    // Check for cached result
    const cachedResult = this._input.getStepResult?.(stepId)
    if (cachedResult) {
      return cachedResult.result as T
    }

    const startedAt = new Date()
    const actionRecord = await this.logAction('do', action, data)

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      attempts = attempt

      const status: ActionStatus = attempt === 1 ? 'running' : 'retrying'
      await this.updateActionStatus(actionRecord.id, status, { startedAt, attempts })

      try {
        const result = await this.executeAction(action, data) as T

        const completedAt = new Date()
        const duration = completedAt.getTime() - startedAt.getTime()

        await this.completeAction(actionRecord.id, result, { completedAt, duration, attempts })

        // Persist step result
        if (this._input.persistStepResult) {
          await this._input.persistStepResult(stepId, result)
        }
        await this.emitEvent(`${action}.completed`, { result })

        return result
      } catch (error) {
        lastError = error as Error
        await this.updateActionAttempts(actionRecord.id, attempts)

        if (attempt < retryPolicy.maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt, retryPolicy)
          await this._input.sleep(delay)
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

    await this.failAction(actionRecord.id, actionError, { completedAt, duration, attempts })
    await this.emitEvent(`${action}.failed`, { error: actionError })

    throw lastError
  }

  /**
   * Calculate backoff delay for retries
   */
  calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
    let delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)
    delay = Math.min(delay, policy.maxDelayMs)

    if (policy.jitter) {
      const jitterRange = delay * 0.25
      delay += Math.random() * jitterRange
    }

    return Math.floor(delay)
  }

  /**
   * Generate a unique step ID from action name and data
   */
  private generateStepId(action: string, data: unknown): string {
    const content = JSON.stringify({ action, data })
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${action}:${Math.abs(hash).toString(36)}`
  }

  private _workflowLogger = createLogger({ name: 'workflow', level: LogLevel.DEBUG })

  /**
   * Log utility function
   */
  log(message: string, ...args: unknown[]): void {
    this._workflowLogger.debug(`[${this._input.ns}] ${message}`, args.length > 0 ? { args } : undefined)
  }

  /**
   * Log an action (append-only)
   */
  async logAction(
    durability: 'send' | 'try' | 'do',
    verb: string,
    input: unknown
  ): Promise<{ id: string; rowid: number }> {
    const id = crypto.randomUUID()

    await this._input.db
      .insert(schema.actions)
      .values({
        id,
        verb,
        target: this._input.ns,
        actor: this._currentActor ?? undefined,
        // Action input data goes in options, not input (which is for rowid references)
        options: input as Record<string, unknown>,
        durability,
        status: 'pending',
        createdAt: new Date(),
      })

    return { id, rowid: 0 }
  }

  /**
   * Update action status
   */
  async updateActionStatus(
    actionId: string,
    status: ActionStatus,
    fields?: { startedAt?: Date; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = { status }

      if (fields?.startedAt) {
        updateData.startedAt = fields.startedAt
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this._input.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'updateActionStatus',
        source: 'DOWorkflow.updateActionStatus',
        context: { actionId, status, ns: this._input.ns },
      })
    }
  }

  /**
   * Update action attempt count
   */
  async updateActionAttempts(actionId: string, attempts: number): Promise<void> {
    try {
      await this._input.db
        .update(schema.actions)
        .set({ options: JSON.stringify({ attempts }) })
        .where(eq(schema.actions.id, actionId))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'updateActionAttempts',
        source: 'DOWorkflow.updateActionAttempts',
        context: { actionId, attempts, ns: this._input.ns },
      })
    }
  }

  /**
   * Complete an action
   */
  async completeAction(
    actionId: string,
    output: unknown,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: 'completed' as ActionStatus,
        output: output as number,
      }

      if (fields?.completedAt) {
        updateData.completedAt = fields.completedAt
      }
      if (fields?.duration !== undefined) {
        updateData.duration = fields.duration
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this._input.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch (error) {
      logBestEffortError(error, {
        operation: 'completeAction',
        source: 'DOWorkflow.completeAction',
        context: { actionId, ns: this._input.ns },
      })
    }
  }

  /**
   * Fail an action
   */
  async failAction(
    actionId: string,
    error: ActionError,
    fields?: { completedAt?: Date; duration?: number; attempts?: number }
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: 'failed' as ActionStatus,
        error: error,
      }

      if (fields?.completedAt) {
        updateData.completedAt = fields.completedAt
      }
      if (fields?.duration !== undefined) {
        updateData.duration = fields.duration
      }
      if (fields?.attempts !== undefined) {
        updateData.options = JSON.stringify({ attempts: fields.attempts })
      }

      await this._input.db
        .update(schema.actions)
        .set(updateData)
        .where(eq(schema.actions.id, actionId))
    } catch (catchError) {
      logBestEffortError(catchError, {
        operation: 'failAction',
        source: 'DOWorkflow.failAction',
        context: { actionId, errorMessage: error.message, ns: this._input.ns },
      })
    }
  }

  /**
   * Execute an action
   */
  async executeAction(action: string, data: unknown): Promise<unknown> {
    const handler = this._actionHandlers.get(action)
    if (handler) {
      return handler(data)
    }
    throw new Error(`Unknown action: ${action}`)
  }

  /**
   * Emit an event
   */
  async emitEvent(verb: string, data: unknown): Promise<void> {
    const eventId = crypto.randomUUID()

    try {
      await this._input.db.insert(schema.events).values({
        id: eventId,
        verb,
        source: this._input.ns,
        data: data as Record<string, unknown>,
        sequence: 0,
        streamed: false,
        createdAt: new Date(),
      })
    } catch (error) {
      logBestEffortError(error, {
        operation: 'insertEvent',
        source: 'DOWorkflow.emitEvent',
        context: { verb, ns: this._input.ns },
      })

      // Add to DLQ for retry
      try {
        await this._input.dlq.add({
          eventId,
          verb,
          source: this._input.ns,
          data: data as Record<string, unknown>,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          maxRetries: 3,
        })
      } catch (dlqError) {
        logBestEffortError(dlqError, {
          operation: 'addToDLQ',
          source: 'DOWorkflow.emitEvent',
          context: { verb },
        })
      }
    }

    // Dispatch event to handlers
    if (this._eventHandlers.size > 0) {
      const [noun, eventVerb] = verb.split('.')
      if (noun && eventVerb) {
        const event: DomainEvent = {
          id: eventId,
          verb: eventVerb,
          source: `https://${this._input.ns}/${noun}/${eventId}`,
          data,
          timestamp: new Date(),
        }
        await this.dispatchEventToHandlers(event)
      }
    }
  }

  /**
   * Create the $.on proxy for event registration
   */
  private createOnProxy(): OnProxy {
    const self = this

    return new Proxy({} as OnProxy, {
      get: (_, noun: string): OnNounProxy => {
        return new Proxy({} as OnNounProxy, {
          get: (_, verb: string): ((handler: EventHandler, options?: HandlerOptions) => (() => void)) => {
            return (handler: EventHandler, options?: HandlerOptions): (() => void) => {
              const eventKey = `${noun}.${verb}`
              const registrations = self._eventHandlers.get(eventKey) ?? []

              const handlerName = options?.name
                || (handler as Function).name
                || `handler_${++self._handlerCounter}`

              const registration: HandlerRegistration = {
                name: handlerName,
                priority: options?.priority ?? 0,
                registeredAt: Date.now(),
                sourceNs: self._input.ns,
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

              self._eventHandlers.set(eventKey, registrations)

              // Return unsubscribe function
              return () => {
                const regs = self._eventHandlers.get(eventKey)
                if (regs) {
                  const index = regs.findIndex(r => r.handler === handler)
                  if (index > -1) {
                    regs.splice(index, 1)
                  }
                }
              }
            }
          },
        })
      },
    })
  }

  /**
   * Create the $.every schedule builder
   */
  private createScheduleBuilder(): ScheduleBuilder {
    const self = this

    const config: ScheduleBuilderConfig = {
      state: this._input.ctx,
      onScheduleRegistered: (cron: string, name: string, handler: ScheduleHandler) => {
        self._scheduleHandlers.set(name, handler)
        self.scheduleManager.schedule(cron, name).catch((error) => {
          logBestEffortError(error, {
            operation: 'registerSchedule',
            source: 'DOWorkflow.createScheduleBuilder',
            context: { name, cron },
          })
        })
      },
    }

    return createScheduleBuilderProxy(config) as unknown as ScheduleBuilder
  }

  /**
   * Create domain proxy for $.Noun(id) calls
   */
  private createDomainProxy(noun: string, id: string): DomainProxy {
    const self = this

    return new Proxy({} as DomainProxy, {
      get(_, method: string) {
        if (method === 'then' || method === 'catch' || method === 'finally') {
          return undefined
        }

        return (...args: unknown[]): Promise<unknown> => {
          if (self._input.invokeDomainMethod) {
            return self._input.invokeDomainMethod(noun, id, method, args)
          }
          throw new Error(`Method '${method}' not found`)
        }
      },
    })
  }

  /**
   * Dispatch event to registered handlers
   */
  async dispatchEventToHandlers(event: DomainEvent): Promise<EnhancedDispatchResult> {
    const sourceParts = event.source.split('/')
    const noun = sourceParts[sourceParts.length - 2] || ''
    const registrations = this.collectMatchingHandlers(noun, event.verb)

    let handled = 0
    let filtered = 0
    let wildcardMatches = 0
    const errors: Error[] = []
    const dlqEntries: string[] = []

    const exactKey = `${noun}.${event.verb}`
    const exactRegistrations = new Set((this._eventHandlers.get(exactKey) ?? []).map((r) => r.name))

    for (const registration of registrations) {
      if (!exactRegistrations.has(registration.name)) {
        wildcardMatches++
      }
      if (registration.filter) {
        try {
          const shouldExecute = await registration.filter(event)
          if (!shouldExecute) {
            filtered++
            continue
          }
        } catch {
          filtered++
          continue
        }
      }
      registration.executionCount++
      registration.lastExecutedAt = Date.now()
      try {
        await registration.handler(event)
        registration.successCount++
        handled++
      } catch (e) {
        registration.failureCount++
        const error = e instanceof Error ? e : new Error(String(e))
        errors.push(error)
        try {
          const dlqEntry = await this._input.dlq.add({
            eventId: event.id,
            verb: `${noun}.${event.verb}`,
            source: event.source,
            data: event.data as Record<string, unknown>,
            error: error.message,
            errorStack: error.stack,
            maxRetries: registration.maxRetries,
          })
          dlqEntries.push(dlqEntry.id)
        } catch (dlqAddError) {
          logBestEffortError(dlqAddError, {
            operation: 'addToDLQ',
            source: 'DOWorkflow.dispatchEvent',
            context: { eventId: event.id, verb: event.verb },
          })
        }
      }
    }
    return { handled, errors, dlqEntries, filtered, wildcardMatches }
  }

  /**
   * Collect matching handlers for an event
   */
  private collectMatchingHandlers(noun: string, verb: string): HandlerRegistration[] {
    const matchingHandlers: Array<{ registration: HandlerRegistration; isWildcard: boolean }> = []
    const exactKey = `${noun}.${verb}`
    for (const reg of this._eventHandlers.get(exactKey) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: false })
    }
    for (const reg of this._eventHandlers.get(`*.${verb}`) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    for (const reg of this._eventHandlers.get(`${noun}.*`) ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    for (const reg of this._eventHandlers.get('*.*') ?? []) {
      matchingHandlers.push({ registration: reg, isWildcard: true })
    }
    matchingHandlers.sort((a, b) => {
      if (b.registration.priority !== a.registration.priority) {
        return b.registration.priority - a.registration.priority
      }
      if (a.isWildcard !== b.isWildcard) {
        return a.isWildcard ? 1 : -1
      }
      return a.registration.registeredAt - b.registration.registeredAt
    })
    return matchingHandlers.map((h) => h.registration)
  }

  /**
   * Handle alarm callback
   */
  async handleAlarm(): Promise<void> {
    if (this._scheduleManager) {
      await this._scheduleManager.handleAlarm()
    }
  }

  /**
   * Sleep utility for testing/retries
   */
  sleep(ms: number): Promise<void> {
    return this._input.sleep(ms)
  }
}
