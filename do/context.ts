// $ WorkflowContext - same interface everywhere via RPC

import { createEventsStore, type EventsStore } from '../db'
import { createEveryProxy, type ScheduleRegistration } from './schedule'
import { createOnProxy, matchHandlers, type OnProxy, type EventHandler } from './on'
import { createDOStub } from '../rpc/client'

export interface WorkflowContext {
  // Durability levels
  send(event: { type: string; payload?: unknown }): void  // Fire-and-forget
  try<T>(action: () => Promise<T>): Promise<T>            // Single attempt
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>  // Durable with retries

  // Event handlers (Proxy-based - see do-7rf.6.3)
  on: OnProxy

  // Scheduling DSL (see do-7rf.6.4)
  every: EveryProxy

  // Cross-DO RPC (Proxy-based - see do-7rf.6.6)
  // Accessed dynamically via $.Customer(id), $.Worker(id), etc.
  [doName: string]: any

  // Internal
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, any>
  _env: any
}

export type $ = WorkflowContext

export interface DoOptions {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

// Re-export types from on.ts
export type { EventHandler, OnProxy } from './on'

type EveryProxy = {
  [key: string]: EveryProxy
} & {
  (handler: () => Promise<void>): void
}

export function createContext(
  state: DurableObjectState,
  env: unknown
): WorkflowContext {
  const events = createEventsStore()
  const handlers = new Map<string, EventHandler[]>()
  const schedules = new Map<string, ScheduleRegistration>()
  const stubCache = new Map<string, any>()

  const context: WorkflowContext = {
    // Fire-and-forget event emission
    send(event) {
      events.emit({
        type: event.type,
        payload: event.payload,
        source: 'workflow'
      }).then(emitted => {
        // Helper to safely call handler (handles sync and async)
        const safeCall = (h: EventHandler) => {
          try {
            const result = h(emitted)
            // Only call catch if it's a Promise
            if (result && typeof result.catch === 'function') {
              result.catch(console.error)
            }
          } catch (err) {
            console.error(err)
          }
        }

        // Use matchHandlers for pattern matching (exact + all wildcard patterns)
        const matched = matchHandlers(event.type, handlers)
        matched.forEach(safeCall)
      })
    },

    // Single attempt - no retries
    async try<T>(action: () => Promise<T>): Promise<T> {
      return action()
    },

    // Durable with retries
    async do<T>(action: () => Promise<T>, options: DoOptions = {}): Promise<T> {
      const { retries = 3, backoff = 'exponential', timeout = 30000 } = options

      let lastError: Error | undefined

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Wrap with timeout
          const result = await Promise.race([
            action(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), timeout)
            )
          ])
          return result
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

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
    },

    // Event handlers - Proxy-based (from do/on.ts)
    on: createOnProxy(handlers),

    // Scheduling DSL - full implementation (do-7rf.6.4)
    every: createEveryProxy(schedules),

    _events: events,
    _handlers: handlers,
    _schedules: schedules,
    _stubCache: stubCache,
    _env: env
  }

  // Wrap context in Proxy to support cross-DO RPC: $.Customer(id)
  return new Proxy(context, {
    get(target, prop: string | symbol) {
      // Bypass symbols and internal properties
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop)
      }

      // Return existing properties (send, try, do, on, every, etc.)
      if (prop in target) {
        return Reflect.get(target, prop)
      }

      // For unknown properties, assume it's a DO binding name
      // Return a function that creates a cached DO stub
      return (id: string | DurableObjectId) => {
        const cacheKey = `${prop}:${typeof id === 'string' ? id : id.toString()}`

        // Return cached stub if exists
        if (stubCache.has(cacheKey)) {
          return stubCache.get(cacheKey)
        }

        // Get DO namespace binding from env
        const envObj = env as Record<string, any>
        const binding = envObj?.[prop] as DurableObjectNamespace | undefined

        if (!binding) {
          throw new Error(`Durable Object binding "${prop}" not found in environment`)
        }

        // Create and cache the stub
        const stub = createDOStub<any>(binding, id)
        stubCache.set(cacheKey, stub)

        return stub
      }
    }
  })
}
