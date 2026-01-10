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
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

// =============================================================================
// Types
// =============================================================================

export interface UseDollarOptions {
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Optional DO instance ID */
  doId?: string
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean
}

export interface UseDollarReturn {
  /** The $ RPC proxy */
  $: DollarProxy
  /** True while connecting */
  isLoading: boolean
  /** True when connected */
  isConnected: boolean
  /** Connection error if any */
  error: Error | null
  /** Manual connect */
  connect: () => void
  /** Manual disconnect */
  disconnect: () => void
}

/** Event handler for state updates */
type StateHandler = (state: unknown) => void

/** Event handler for conflicts */
type ConflictHandler = (conflict: { local: unknown; remote: unknown }) => void

/** Generic event handler */
type EventHandler = (data: unknown) => void

/** Unsubscribe function */
type Unsubscribe = () => void

/** Schedule handler */
type ScheduleHandler = () => void

// =============================================================================
// Internal Types
// =============================================================================

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  batchIndex?: number
}

interface BatchedCall {
  type: 'rpc'
  noun: string
  id: string
  method: string
  args: unknown[]
  pipeline?: string[][]
}

interface RPCMessage {
  type: 'send' | 'try' | 'do' | 'rpc' | 'subscribe' | 'schedule' | 'sync' | 'optimistic' | 'batch'
  id?: string
  event?: string
  payload?: unknown
  noun?: string
  method?: string
  args?: unknown[]
  cron?: string
  since?: number
  pipeline?: string[][]
  calls?: BatchedCall[]
  data?: unknown
}

interface RPCResponse {
  type: 'response' | 'batch-response' | 'event' | 'state'
  id?: string
  result?: unknown
  error?: { code: string; message: string }
  results?: Array<{ id: number; result: unknown; error?: { message: string } }>
  event?: string
  data?: unknown
  txid?: number
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

/** On proxy for event subscriptions - $.on.Noun.verb(handler) */
interface OnProxy {
  state: (handler: StateHandler) => Unsubscribe
  conflict: (handler: ConflictHandler) => Unsubscribe
  [noun: string]: OnNounProxy | ((handler: StateHandler | ConflictHandler) => Unsubscribe)
}

interface OnNounProxy {
  [verb: string]: (handler: EventHandler) => Unsubscribe
}

/** Every proxy for scheduling - $.every.Monday.at9am(handler) */
interface EveryProxy {
  hour: (handler: ScheduleHandler) => void
  minute: (handler: ScheduleHandler) => void
  Monday: EveryDayProxy
  Tuesday: EveryDayProxy
  Wednesday: EveryDayProxy
  Thursday: EveryDayProxy
  Friday: EveryDayProxy
  Saturday: EveryDayProxy
  Sunday: EveryDayProxy
  [key: string]: EveryDayProxy | ((handler: ScheduleHandler) => void)
}

interface EveryDayProxy {
  at9am: (handler: ScheduleHandler) => void
  [time: string]: (handler: ScheduleHandler) => void
}

/** Optimistic update proxy */
interface OptimisticProxy {
  update: (state: unknown) => void
}

/** Cross-DO RPC proxy - $.Noun(id).method() */
interface NounProxy {
  (id: string): NounInstanceProxy
}

interface NounInstanceProxy {
  [method: string]: NounMethodProxy
}

/** Method that can be chained (for pipelining) or called */
interface NounMethodProxy {
  (...args: unknown[]): Promise<unknown> & NounMethodProxy
  [chainMethod: string]: NounMethodProxy
}

/** Main $ proxy interface */
export interface DollarProxy {
  send: (event: unknown) => void
  try: (action: unknown) => Promise<unknown>
  do: (action: unknown) => Promise<unknown>
  on: OnProxy
  every: EveryProxy
  optimistic: OptimisticProxy
  [noun: string]: NounProxy | unknown
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
  const [error, setError] = useState<Error | null>(null)

  // Refs for mutable state
  const wsRef = useRef<WebSocket | null>(null)
  const pendingCallsRef = useRef<Map<string, PendingCall>>(new Map())
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

  // Generate unique request ID
  const generateRequestId = useCallback(() => {
    return `req_${Date.now()}_${++requestIdRef.current}`
  }, [])

  // Send message over WebSocket
  const sendMessage = useCallback((message: RPCMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  // Flush batched calls
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

  // Add call to batch queue (for pipelining)
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

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data: RPCResponse = JSON.parse(event.data)

      switch (data.type) {
        case 'response': {
          // Find pending call by checking all pending
          const pendingCalls = pendingCallsRef.current
          for (const [id, pending] of pendingCalls) {
            if (data.error) {
              pending.reject(new Error(data.error.message))
            } else {
              pending.resolve(data.result)
            }
            pendingCalls.delete(id)
            break // Only resolve first matching pending call
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
                  pending.reject(new Error(result.error.message))
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
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err)
    }
  }, [])

  // Connect to WebSocket
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

      // If reconnecting, request state sync
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
        // Schedule reconnection with backoff
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, 1000)
      } else {
        setIsLoading(false)
      }
    })

    ws.addEventListener('error', (event) => {
      setError(new Error('WebSocket connection error'))
    })

    ws.addEventListener('message', handleMessage)
  }, [doUrl, handleMessage, sendMessage])

  // Disconnect from WebSocket
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
            // If accessing promise methods, return them
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
              return (target as Record<string, unknown>)[prop]?.bind(target)
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
