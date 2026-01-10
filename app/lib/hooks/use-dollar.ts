/**
 * use$ (useDollar) Hook
 *
 * Core React hook for Durable Object interaction via WebSocket.
 * Provides the $ RPC proxy for Cap'n Web RPC pattern.
 *
 * Features:
 * - WebSocket connection to Durable Objects
 * - $ proxy with send/try/do methods for different durability levels
 * - Cross-DO RPC calls via $.Noun(id).method()
 * - Event subscriptions via $.on.Noun.verb(handler)
 * - Scheduling via $.every.interval(handler)
 * - Promise pipelining (multiple calls in single round trip)
 * - State synchronization with optimistic updates
 *
 * @module app/lib/hooks/use-dollar
 *
 * @example Basic usage
 * ```tsx
 * function MyComponent() {
 *   const { $, isConnected, error } = useDollar({
 *     doUrl: 'wss://example.com/do/123'
 *   })
 *
 *   // Fire and forget
 *   $.send({ type: 'event', data: {} })
 *
 *   // Single attempt RPC
 *   const result = await $.try({ action: 'process' })
 *
 *   // Durable execution with retries
 *   await $.do({ action: 'sendEmail' })
 *
 *   // Cross-DO RPC
 *   await $.Customer('id').notify({ message: 'Hello' })
 * }
 * ```
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { z } from 'zod'

// =============================================================================
// Branded Types for Type Safety
// =============================================================================

/**
 * Branded type for request IDs to prevent mixing with other string types
 */
export type RequestId = string & { readonly __brand: 'RequestId' }

/**
 * Branded type for transaction IDs
 */
export type TransactionId = number & { readonly __brand: 'TransactionId' }

/**
 * Creates a branded RequestId
 */
function createRequestId(prefix: string, counter: number): RequestId {
  return `${prefix}_${Date.now()}_${counter}` as RequestId
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for WebSocket/RPC errors
 */
export type DollarErrorCode =
  | 'CONNECTION_ERROR'
  | 'CONNECTION_CLOSED'
  | 'MESSAGE_PARSE_ERROR'
  | 'RPC_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN'

/**
 * Structured error class for $ hook errors
 */
export class DollarError extends Error {
  readonly code: DollarErrorCode
  readonly cause?: Error

  constructor(code: DollarErrorCode, message: string, cause?: Error) {
    super(message)
    this.name = 'DollarError'
    this.code = code
    this.cause = cause
    Object.setPrototypeOf(this, DollarError.prototype)
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the useDollar hook
 */
export interface UseDollarOptions {
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Optional DO instance ID */
  doId?: string
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean
}

/**
 * Return value from the useDollar hook
 */
export interface UseDollarReturn {
  /** The $ RPC proxy for DO interaction */
  $: DollarProxy
  /** True while connection is being established */
  isLoading: boolean
  /** True when WebSocket is connected and ready */
  isConnected: boolean
  /** Connection or RPC error, null when healthy */
  error: DollarError | null
  /** Manually initiate WebSocket connection */
  connect: () => void
  /** Manually close WebSocket connection */
  disconnect: () => void
}

/**
 * Handler for state updates from the Durable Object
 * @typeParam T - The state type, defaults to unknown
 */
export type StateHandler<T = unknown> = (state: T) => void

/**
 * Handler for optimistic update conflicts
 * @typeParam T - The state type, defaults to unknown
 */
export type ConflictHandler<T = unknown> = (conflict: { local: T; remote: T }) => void

/**
 * Generic event handler for subscriptions
 * @typeParam T - The event data type, defaults to unknown
 */
export type EventHandler<T = unknown> = (data: T) => void

/**
 * Function to unsubscribe from an event
 */
export type Unsubscribe = () => void

/**
 * Handler for scheduled tasks
 */
export type ScheduleHandler = () => void

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Represents a pending RPC call awaiting response
 * @internal
 */
interface PendingCall<T = unknown> {
  resolve: (value: T) => void
  reject: (error: DollarError) => void
  batchIndex?: number
}

/**
 * Message types for the RPC protocol
 * @internal
 */
type RPCMessageType =
  | 'send'
  | 'try'
  | 'do'
  | 'rpc'
  | 'subscribe'
  | 'schedule'
  | 'sync'
  | 'optimistic'
  | 'batch'

/**
 * Response types from the DO
 */
export type RPCResponseType = 'response' | 'batch-response' | 'event' | 'state'

/**
 * A batched RPC call for promise pipelining
 * @internal
 */
interface BatchedCall {
  type: 'rpc'
  noun: string
  id: string
  method: string
  args: readonly unknown[]
  pipeline?: ReadonlyArray<readonly string[]>
}

/**
 * Outgoing RPC message structure
 * @internal
 */
interface RPCMessage {
  type: RPCMessageType
  id?: RequestId
  event?: string
  payload?: unknown
  noun?: string
  method?: string
  args?: readonly unknown[]
  cron?: string
  since?: number
  pipeline?: ReadonlyArray<readonly string[]>
  calls?: readonly BatchedCall[]
  data?: unknown
}

/**
 * Error response from the DO
 * @internal
 */
interface RPCErrorPayload {
  code: string
  message: string
}

/**
 * Individual result in a batch response
 * @internal
 */
interface BatchResultItem {
  id: number
  result: unknown
  error?: { message: string }
}

/**
 * Incoming RPC response structure
 */
export interface RPCResponse {
  type: RPCResponseType
  id?: RequestId
  result?: unknown
  error?: RPCErrorPayload
  results?: readonly BatchResultItem[]
  event?: string
  data?: unknown
  txid?: number
}

// =============================================================================
// Zod Schemas for Runtime Validation
// =============================================================================

/**
 * Zod schema for RPC error payload
 */
const RPCErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
})

/**
 * Zod schema for batch result items
 */
const BatchResultItemSchema = z.object({
  id: z.number(),
  result: z.unknown(),
  error: z.object({ message: z.string() }).optional(),
})

/**
 * Zod schema for RPC response validation
 * Use safeParse for runtime validation of WebSocket messages
 */
export const RPCResponseSchema = z.object({
  type: z.enum(['response', 'batch-response', 'event', 'state']),
  id: z.string().optional(),
  result: z.unknown().optional(),
  error: RPCErrorPayloadSchema.optional(),
  results: z.array(BatchResultItemSchema).optional(),
  event: z.string().optional(),
  data: z.unknown().optional(),
  txid: z.number().optional(),
})

// =============================================================================
// Type Guards for WebSocket Messages
// =============================================================================

/**
 * Type guard to check if data is a valid RPC response
 * @param data - Unknown data to validate
 * @returns True if data is a valid RPCResponse
 */
export function isRPCResponse(data: unknown): data is RPCResponse {
  const result = RPCResponseSchema.safeParse(data)
  return result.success
}

/**
 * Type guard to check if data is a state message
 * @param data - Unknown data to validate
 * @returns True if data is a state message
 */
export function isStateMessage(data: unknown): data is RPCResponse & { type: 'state' } {
  if (!isRPCResponse(data)) return false
  return data.type === 'state'
}

/**
 * Type guard to check if data is a batch response
 * @param data - Unknown data to validate
 * @returns True if data is a batch response
 */
export function isBatchResponse(data: unknown): data is RPCResponse & { type: 'batch-response' } {
  if (!isRPCResponse(data)) return false
  return data.type === 'batch-response'
}

/**
 * Type guard to check if data is an event message
 * @param data - Unknown data to validate
 * @returns True if data is an event message
 */
export function isEventMessage(data: unknown): data is RPCResponse & { type: 'event' } {
  if (!isRPCResponse(data)) return false
  return data.type === 'event'
}

// =============================================================================
// Day/Time Mappings for Scheduling
// =============================================================================

const DAYS: Record<string, string> = {
  Sunday: '0',
  Monday: '1',
  Tuesday: '2',
  Wednesday: '3',
  Thursday: '4',
  Friday: '5',
  Saturday: '6',
}

// =============================================================================
// $ Proxy Types
// =============================================================================

/**
 * Proxy for subscribing to events - $.on.Noun.verb(handler)
 *
 * @example
 * ```ts
 * // Subscribe to state changes
 * $.on.state(state => console.log(state))
 *
 * // Subscribe to specific events
 * $.on.Customer.signup(data => console.log('New customer:', data))
 * ```
 */
interface OnProxy {
  /**
   * Subscribe to state changes from the Durable Object
   * @param handler - Called with the new state whenever it changes
   * @returns Unsubscribe function
   */
  state: <T = unknown>(handler: StateHandler<T>) => Unsubscribe
  /**
   * Subscribe to optimistic update conflicts
   * @param handler - Called when local optimistic state conflicts with server state
   * @returns Unsubscribe function
   */
  conflict: <T = unknown>(handler: ConflictHandler<T>) => Unsubscribe
  /**
   * Dynamic noun access for event subscriptions
   */
  [noun: string]: OnNounProxy | (<T = unknown>(handler: StateHandler<T> | ConflictHandler<T>) => Unsubscribe)
}

/**
 * Noun-level proxy for verb subscriptions
 * @internal
 */
interface OnNounProxy {
  [verb: string]: <T = unknown>(handler: EventHandler<T>) => Unsubscribe
}

/**
 * Proxy for scheduling - $.every.Monday.at9am(handler)
 *
 * @example
 * ```ts
 * // Run every hour
 * $.every.hour(() => sendReport())
 *
 * // Run every Monday at 9am
 * $.every.Monday.at9am(() => sendWeeklyReport())
 * ```
 */
interface EveryProxy {
  /** Schedule to run every hour */
  hour: (handler: ScheduleHandler) => void
  /** Schedule to run every minute */
  minute: (handler: ScheduleHandler) => void
  /** Monday scheduling */
  Monday: EveryDayProxy
  /** Tuesday scheduling */
  Tuesday: EveryDayProxy
  /** Wednesday scheduling */
  Wednesday: EveryDayProxy
  /** Thursday scheduling */
  Thursday: EveryDayProxy
  /** Friday scheduling */
  Friday: EveryDayProxy
  /** Saturday scheduling */
  Saturday: EveryDayProxy
  /** Sunday scheduling */
  Sunday: EveryDayProxy
  /** Dynamic day access */
  [key: string]: EveryDayProxy | ((handler: ScheduleHandler) => void)
}

/**
 * Day-level proxy for time-based scheduling
 * @internal
 */
interface EveryDayProxy {
  /** Schedule for 9am on this day */
  at9am: (handler: ScheduleHandler) => void
  /** Dynamic time access (e.g., at10am, at3pm) */
  [time: string]: (handler: ScheduleHandler) => void
}

/**
 * Proxy for optimistic updates
 *
 * @example
 * ```ts
 * // Apply optimistic update before server confirms
 * $.optimistic.update({ counter: newValue })
 * ```
 */
interface OptimisticProxy {
  /**
   * Apply an optimistic state update
   * @param state - The optimistic state to apply immediately
   */
  update: <T = unknown>(state: T) => void
}

/**
 * Factory function for creating noun instance proxies
 * Used for cross-DO RPC: $.Customer(id)
 * @internal
 */
interface NounProxy {
  (id: string): NounInstanceProxy
}

/**
 * Instance-level proxy for method calls
 * @internal
 */
interface NounInstanceProxy {
  [method: string]: NounMethodProxy
}

/**
 * Method proxy that can be called or chained for pipelining
 *
 * Supports both immediate calls and Cap'n Proto-style promise pipelining:
 * - Immediate: $.Customer('id').notify({ message: 'Hi' })
 * - Pipelined: $.User('id').getAccount().getBalance()
 *
 * @internal
 */
interface NounMethodProxy {
  (...args: readonly unknown[]): Promise<unknown> & NounMethodProxy
  [chainMethod: string]: NounMethodProxy
}

/**
 * Main $ proxy interface for Durable Object interaction
 *
 * Provides three durability levels:
 * - `send`: Fire and forget, no response expected
 * - `try`: Single attempt, may fail
 * - `do`: Durable execution with automatic retries
 *
 * @example
 * ```ts
 * const { $ } = useDollar({ doUrl: 'wss://...' })
 *
 * // Fire and forget
 * $.send({ type: 'log', data: { event: 'click' } })
 *
 * // Single attempt
 * const result = await $.try({ action: 'validate' })
 *
 * // Durable with retries
 * await $.do({ action: 'charge', amount: 100 })
 *
 * // Cross-DO RPC
 * await $.Customer('cust-123').sendEmail({ subject: 'Hello' })
 * ```
 */
export interface DollarProxy {
  /**
   * Fire-and-forget message sending
   * @param event - The event payload to send
   */
  send: (event: unknown) => void
  /**
   * Single-attempt RPC call
   * @param action - The action to execute
   * @returns Promise resolving to the result
   */
  try: <T = unknown>(action: unknown) => Promise<T>
  /**
   * Durable RPC call with automatic retries
   * @param action - The action to execute durably
   * @returns Promise resolving to the result
   */
  do: <T = unknown>(action: unknown) => Promise<T>
  /**
   * Event subscription proxy
   */
  on: OnProxy
  /**
   * Scheduling proxy
   */
  every: EveryProxy
  /**
   * Optimistic update proxy
   */
  optimistic: OptimisticProxy
  /**
   * Dynamic noun access for cross-DO RPC
   */
  [noun: string]: NounProxy | OnProxy | EveryProxy | OptimisticProxy | ((event: unknown) => void) | (<T = unknown>(action: unknown) => Promise<T>)
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * useDollar (use$) - Core hook for Durable Object interaction
 *
 * @param options - Hook configuration
 * @returns $ proxy and connection state
 *
 * @example
 * ```tsx
 * const { $, isConnected, isLoading, error } = useDollar({
 *   doUrl: 'wss://example.com/do/123'
 * })
 *
 * // Fire and forget
 * $.send({ type: 'Customer.signup', data: { email: 'test@example.com' } })
 *
 * // Single attempt
 * const result = await $.try({ action: 'processPayment', amount: 100 })
 *
 * // Durable with retries
 * await $.do({ action: 'sendEmail', to: 'user@example.com' })
 *
 * // Cross-DO RPC
 * await $.Customer('cust-456').notify({ message: 'Hello' })
 *
 * // Event subscription
 * const unsubscribe = $.on.Customer.signup(data => console.log(data))
 *
 * // Scheduling
 * $.every.Monday.at9am(() => sendReport())
 * ```
 */
export function useDollar(options: UseDollarOptions): UseDollarReturn {
  const { doUrl, autoConnect = true } = options

  // Connection state
  const [isLoading, setIsLoading] = useState(autoConnect)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<DollarError | null>(null)

  // Refs for mutable state - use typed Maps and Sets
  const wsRef = useRef<WebSocket | null>(null)
  const pendingCallsRef = useRef<Map<RequestId, PendingCall>>(new Map())
  const eventHandlersRef = useRef<Map<string, Set<EventHandler>>>(new Map())
  const stateHandlersRef = useRef<Set<StateHandler>>(new Set())
  const conflictHandlersRef = useRef<Set<ConflictHandler>>(new Set())
  const requestIdRef = useRef(0)
  const lastTxidRef = useRef<number | null>(null)
  const optimisticStateRef = useRef<unknown>(null)
  const intentionalDisconnectRef = useRef(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Batching state for promise pipelining
  const batchQueueRef = useRef<BatchedCall[]>([])
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchPendingRef = useRef<Map<number, PendingCall>>(new Map())

  /**
   * Generate unique request ID for tracking RPC calls
   * @internal
   */
  const generateRequestId = useCallback((): RequestId => {
    return createRequestId('req', ++requestIdRef.current)
  }, [])

  /**
   * Send a message over the WebSocket connection
   * Silently fails if not connected
   * @internal
   */
  const sendMessage = useCallback((message: RPCMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  /**
   * Flush all batched RPC calls in a single message
   * Implements Cap'n Proto-style promise pipelining
   * @internal
   */
  const flushBatch = useCallback(() => {
    const queue = batchQueueRef.current
    if (queue.length === 0) return

    // Send all calls in a single batch message
    const batchId = generateRequestId()
    sendMessage({
      type: 'batch',
      id: batchId,
      calls: queue,
    })

    batchQueueRef.current = []
    batchTimeoutRef.current = null
  }, [generateRequestId, sendMessage])

  /**
   * Add an RPC call to the batch queue for pipelining
   * Calls are automatically flushed on the next microtask
   * @internal
   */
  const addToBatch = useCallback((call: BatchedCall): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const batchIndex = batchQueueRef.current.length
      batchQueueRef.current.push(call)
      batchPendingRef.current.set(batchIndex, { resolve, reject, batchIndex })

      // Schedule flush on next microtask to batch synchronous calls
      if (!batchTimeoutRef.current) {
        batchTimeoutRef.current = setTimeout(flushBatch, 0)
      }
    })
  }, [flushBatch])

  /**
   * Handle incoming WebSocket messages
   * Dispatches responses to pending calls and events to handlers
   * @internal
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data)
    } catch (parseErr) {
      const error = new DollarError(
        'MESSAGE_PARSE_ERROR',
        'Failed to parse WebSocket message',
        parseErr instanceof Error ? parseErr : undefined
      )
      setError(error)
      return
    }

    // Validate parsed data using type guard with Zod safeParse
    if (!isRPCResponse(parsed)) {
      const error = new DollarError(
        'MESSAGE_PARSE_ERROR',
        'Invalid RPC response structure'
      )
      setError(error)
      return
    }

    const data: RPCResponse = parsed

    switch (data.type) {
      case 'response': {
        // Find pending call by ID if provided, otherwise resolve first pending
        const pendingCalls = pendingCallsRef.current
        const targetId = data.id

        if (targetId && pendingCalls.has(targetId)) {
          const pending = pendingCalls.get(targetId)!
          if (data.error) {
            pending.reject(new DollarError('RPC_ERROR', data.error.message))
          } else {
            pending.resolve(data.result)
          }
          pendingCalls.delete(targetId)
        } else {
          // Fallback: resolve first pending call (for backwards compatibility)
          const entries = Array.from(pendingCalls.entries())
          if (entries.length > 0) {
            const [id, pending] = entries[0]
            if (data.error) {
              pending.reject(new DollarError('RPC_ERROR', data.error.message))
            } else {
              pending.resolve(data.result)
            }
            pendingCalls.delete(id)
          }
        }
        break
      }

      case 'batch-response': {
        // Resolve all batched calls
        if (data.results) {
          for (const result of data.results) {
            const pending = batchPendingRef.current.get(result.id)
            if (pending) {
              if (result.error) {
                pending.reject(new DollarError('RPC_ERROR', result.error.message))
              } else {
                pending.resolve(result.result)
              }
              batchPendingRef.current.delete(result.id)
            }
          }
        }
        break
      }

      case 'event': {
        // Dispatch to event handlers
        if (data.event) {
          const handlers = eventHandlersRef.current.get(data.event)
          handlers?.forEach(handler => handler(data.data))
        }
        break
      }

      case 'state': {
        // Track transaction ID for sync
        if (data.txid !== undefined) {
          lastTxidRef.current = data.txid
        }

        // Check for conflicts with optimistic state
        if (optimisticStateRef.current !== null) {
          const optimistic = optimisticStateRef.current
          const remote = data.data

          // Simple conflict detection - if values differ, notify
          if (JSON.stringify(optimistic) !== JSON.stringify(remote)) {
            conflictHandlersRef.current.forEach(handler =>
              handler({ local: optimistic, remote })
            )
          }
          optimisticStateRef.current = null
        }

        // Notify state handlers
        stateHandlersRef.current.forEach(handler => handler(data.data))
        break
      }
    }
  }, [])

  /**
   * Establish WebSocket connection to the Durable Object
   * Handles reconnection with exponential backoff on abnormal closure
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    intentionalDisconnectRef.current = false
    setIsLoading(true)
    setError(null)

    const ws = new WebSocket(doUrl)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setIsConnected(true)
      setIsLoading(false)
      setError(null) // Clear any previous errors on successful connection

      // If reconnecting, request state sync from last known transaction
      if (lastTxidRef.current !== null) {
        sendMessage({
          type: 'sync',
          since: lastTxidRef.current,
        })
      }
    })

    ws.addEventListener('close', (event) => {
      setIsConnected(false)

      // Only reconnect on abnormal closure (not intentional disconnect)
      if (!intentionalDisconnectRef.current && event.code !== 1000) {
        setIsLoading(true)
        setError(new DollarError(
          'CONNECTION_CLOSED',
          `Connection closed unexpectedly (code: ${event.code})`
        ))
        // Schedule reconnection with backoff
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, 1000)
      } else {
        setIsLoading(false)
      }
    })

    ws.addEventListener('error', () => {
      setError(new DollarError('CONNECTION_ERROR', 'WebSocket connection error'))
    })

    ws.addEventListener('message', handleMessage)
  }, [doUrl, handleMessage, sendMessage])

  /**
   * Cleanly disconnect from the WebSocket
   * Cancels any pending reconnection attempts
   */
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    setIsConnected(false)
    setIsLoading(false)
  }, [])

  // Create the $ proxy
  const $ = useMemo((): DollarProxy => {
    // Create on proxy for event subscriptions
    const createOnProxy = (): OnProxy => {
      return new Proxy({} as OnProxy, {
        get(_, prop: string) {
          // Special handlers for state and conflict
          if (prop === 'state') {
            return (handler: StateHandler): Unsubscribe => {
              stateHandlersRef.current.add(handler)
              return () => stateHandlersRef.current.delete(handler)
            }
          }

          if (prop === 'conflict') {
            return (handler: ConflictHandler): Unsubscribe => {
              conflictHandlersRef.current.add(handler)
              return () => conflictHandlersRef.current.delete(handler)
            }
          }

          // Return noun proxy for $.on.Customer.signup pattern
          return new Proxy({} as OnNounProxy, {
            get(_, verb: string) {
              return (handler: EventHandler): Unsubscribe => {
                const eventKey = `${prop}.${verb}`

                // Subscribe message
                sendMessage({
                  type: 'subscribe',
                  event: eventKey,
                })

                // Register handler
                if (!eventHandlersRef.current.has(eventKey)) {
                  eventHandlersRef.current.set(eventKey, new Set())
                }
                eventHandlersRef.current.get(eventKey)!.add(handler)

                // Return unsubscribe function
                return () => {
                  eventHandlersRef.current.get(eventKey)?.delete(handler)
                }
              }
            },
          })
        },
      })
    }

    // Create every proxy for scheduling
    const createEveryProxy = (): EveryProxy => {
      return new Proxy({} as EveryProxy, {
        get(_, prop: string) {
          // Handle simple intervals
          if (prop === 'hour') {
            return (handler: ScheduleHandler) => {
              sendMessage({
                type: 'schedule',
                cron: '0 * * * *',
              })
            }
          }

          if (prop === 'minute') {
            return (handler: ScheduleHandler) => {
              sendMessage({
                type: 'schedule',
                cron: '* * * * *',
              })
            }
          }

          // Handle day-based scheduling ($.every.Monday)
          const dayNum = DAYS[prop]
          if (dayNum !== undefined) {
            return new Proxy({} as EveryDayProxy, {
              get(_, time: string) {
                return (handler: ScheduleHandler) => {
                  // Parse time like at9am -> 9
                  const match = time.match(/at(\d+)(am|pm)?/)
                  if (match) {
                    let hour = parseInt(match[1], 10)
                    if (match[2] === 'pm' && hour !== 12) hour += 12
                    if (match[2] === 'am' && hour === 12) hour = 0

                    const cron = `0 ${hour} * * ${dayNum}`
                    sendMessage({
                      type: 'schedule',
                      cron,
                    })
                  }
                }
              },
            })
          }

          return undefined
        },
      })
    }

    // Create optimistic update proxy
    const createOptimisticProxy = (): OptimisticProxy => ({
      update: (state: unknown) => {
        optimisticStateRef.current = state
        // Immediately notify state handlers with optimistic value
        stateHandlersRef.current.forEach(handler => handler(state))
      },
    })

    // Create cross-DO RPC proxy - $.Noun(id).method()
    const createNounProxy = (noun: string): NounProxy => {
      return (id: string): NounInstanceProxy => {
        return createNounInstanceProxy(noun, id, [])
      }
    }

    // Create instance proxy that tracks the method chain (for pipelining)
    const createNounInstanceProxy = (
      noun: string,
      id: string,
      pipeline: string[][]
    ): NounInstanceProxy => {
      return new Proxy({} as NounInstanceProxy, {
        get(_, method: string) {
          return createNounMethodProxy(noun, id, method, pipeline)
        },
      })
    }

    // Create method proxy that can be called or chained
    const createNounMethodProxy = (
      noun: string,
      id: string,
      method: string,
      pipeline: string[][]
    ): NounMethodProxy => {
      const fn = (...args: unknown[]): Promise<unknown> & NounMethodProxy => {
        const currentPipeline = [...pipeline, [method, ...args.map(a => JSON.stringify(a))]]

        // Create a promise that batches the call
        const promise = addToBatch({
          type: 'rpc',
          noun,
          id,
          method,
          args,
          pipeline: currentPipeline.length > 1 ? currentPipeline : undefined,
        })

        // Make promise also act as a proxy for further chaining
        return new Proxy(promise as Promise<unknown> & NounMethodProxy, {
          get(target, prop: string) {
            // If accessing promise methods, return them bound to the promise
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
              const method = target[prop as keyof Promise<unknown>]
              if (typeof method === 'function') {
                return method.bind(target)
              }
              return method
            }

            // Otherwise, return a chained method proxy
            return createNounMethodProxy(noun, id, prop, currentPipeline)
          },
        })
      }

      // Make the function also act as a proxy for chaining without calling
      return new Proxy(fn as NounMethodProxy, {
        get(target, prop: string) {
          if (typeof prop === 'string') {
            return createNounMethodProxy(noun, id, prop, [...pipeline, [method]])
          }
          return undefined
        },
      })
    }

    // Main $ proxy
    return new Proxy({} as DollarProxy, {
      get(_, prop: string) {
        switch (prop) {
          case 'send':
            return (event: unknown) => {
              const requestId = generateRequestId()
              sendMessage({
                type: 'send',
                id: requestId,
                payload: event,
              })
            }

          case 'try':
            return (action: unknown): Promise<unknown> => {
              return new Promise((resolve, reject) => {
                const requestId = generateRequestId()
                pendingCallsRef.current.set(requestId, { resolve, reject })
                sendMessage({
                  type: 'try',
                  id: requestId,
                  payload: action,
                })
              })
            }

          case 'do':
            return (action: unknown): Promise<unknown> => {
              return new Promise((resolve, reject) => {
                const requestId = generateRequestId()
                pendingCallsRef.current.set(requestId, { resolve, reject })
                sendMessage({
                  type: 'do',
                  id: requestId,
                  payload: action,
                })
              })
            }

          case 'on':
            return createOnProxy()

          case 'every':
            return createEveryProxy()

          case 'optimistic':
            return createOptimisticProxy()

          default:
            // Assume it's a Noun for cross-DO RPC
            return createNounProxy(prop)
        }
      },
    })
  }, [generateRequestId, sendMessage, addToBatch])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return {
    $,
    isLoading,
    isConnected,
    error,
    connect,
    disconnect,
  }
}

// Re-export as both useDollar and use$ for flexibility
export { useDollar as use$ }
export default useDollar
