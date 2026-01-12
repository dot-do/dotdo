/**
 * WaitForEventManager - Durable Object Event Wait Manager
 *
 * Manages workflow pauses that wait for external events with:
 * - Persistence across hibernation (DO storage)
 * - Timeout handling via DO alarm API
 * - Event filtering and correlation
 * - Multiple concurrent waits
 *
 * Integrates with the $.waitFor() workflow DSL.
 */

/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// TYPES
// ============================================================================

export interface WaitForEventOptions {
  /** Timeout as duration string (e.g., '7 days', '1 hour') or milliseconds */
  timeout?: string | number
  /** Event type (for validation) */
  type?: string
  /** Filter function or property matcher to validate incoming events */
  filter?: ((payload: unknown) => boolean) | Record<string, unknown>
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Correlation ID for targeted event delivery */
  correlationId?: string
}

export interface PendingWait {
  id: string
  eventName: string
  status: 'pending' | 'resolved' | 'cancelled' | 'timeout'
  options: WaitForEventOptions
  createdAt: number
  timeoutAt?: number
  resolvedAt?: number
  payload?: unknown
}

export interface WaitResult<T = unknown> {
  resolved: boolean
  payload?: T
  reason?: 'no-matching-wait' | 'cancelled' | 'timeout' | 'event-mismatch'
  duration?: number
}

export interface WaitAnyResult<T = unknown> {
  eventName: string
  payload: T
  duration: number
}

export interface WaitAllResult<T = unknown> {
  eventName: string
  payload: T
  duration: number
}

// ============================================================================
// ERRORS
// ============================================================================

export class WaitTimeoutError extends Error {
  readonly eventName: string
  readonly waitedMs: number

  constructor(eventName: string, waitedMs: number) {
    super(`Wait for event '${eventName}' timed out after ${waitedMs}ms`)
    this.name = 'WaitTimeoutError'
    this.eventName = eventName
    this.waitedMs = waitedMs
  }
}

export class WaitCancelledError extends Error {
  readonly reason?: string

  constructor(reason?: string) {
    super(reason ? `Wait cancelled: ${reason}` : 'Wait cancelled')
    this.name = 'WaitCancelledError'
    this.reason = reason
  }
}

export class WaitEventMismatchError extends Error {
  readonly expected: string
  readonly received: string

  constructor(expected: string, received: string) {
    super(`Event name mismatch: expected '${expected}', received '${received}'`)
    this.name = 'WaitEventMismatchError'
    this.expected = expected
    this.received = received
  }
}

// ============================================================================
// DURATION PARSING
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hour|d|day|w|week)s?$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1]!)
  const unit = match[2]!.toLowerCase()

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    sec: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }

  return value * (multipliers[unit] || 1000)
}

// ============================================================================
// WAIT FOR EVENT MANAGER
// ============================================================================

type EventHandler = (data: unknown) => void

export class WaitForEventManager {
  private readonly storage: DurableObjectStorage
  private readonly waitResolvers = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()
  private readonly eventHandlers = new Map<string, Set<EventHandler>>()
  private readonly deliveryLocks = new Set<string>()
  /** In-memory filter cache (functions can't be serialized to storage) */
  private readonly filterCache = new Map<string, ((payload: unknown) => boolean) | Record<string, unknown>>()

  constructor(private readonly state: DurableObjectState) {
    this.storage = state.storage
  }

  // ==========================================================================
  // EVENT EMITTER
  // ==========================================================================

  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data)
      } catch (e) {
        console.error(`Error in event handler for ${event}:`, e)
      }
    })
  }

  // ==========================================================================
  // WAIT REGISTRATION
  // ==========================================================================

  /**
   * Register a wait for an event (low-level API)
   */
  async registerWait(eventName: string, options: WaitForEventOptions): Promise<string> {
    const id = crypto.randomUUID()
    const now = Date.now()

    const pendingWait: PendingWait = {
      id,
      eventName,
      status: 'pending',
      options,
      createdAt: now,
    }

    // Calculate timeout
    if (options.timeout) {
      pendingWait.timeoutAt = now + parseDuration(options.timeout)
    }

    // Store the wait (but not the filter function - can't serialize)
    const storedWait = { ...pendingWait, options: { ...options, filter: undefined } }
    await this.storage.put(`wait:${id}`, storedWait)

    // Cache the filter in memory
    if (options.filter) {
      this.filterCache.set(id, options.filter)
    }

    // Set alarm for timeout if needed
    if (pendingWait.timeoutAt) {
      await this.updateAlarm()
    }

    // Emit event
    this.emit('wait.registered', { waitId: id, eventName, options })

    return id
  }

  /**
   * Wait for an event (high-level API that returns a Promise)
   */
  async waitForEvent<T = unknown>(eventName: string, options: WaitForEventOptions = {}): Promise<T> {
    const waitId = await this.registerWait(eventName, options)

    return new Promise<T>((resolve, reject) => {
      // Store resolvers for later
      this.waitResolvers.set(waitId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      // Handle AbortSignal
      if (options.signal) {
        if (options.signal.aborted) {
          this.cancelWait(waitId, options.signal.reason)
          return
        }

        options.signal.addEventListener('abort', () => {
          this.cancelWait(waitId, options.signal!.reason)
        })
      }
    })
  }

  /**
   * Wait for any of the specified events
   */
  async waitForAny<T = unknown>(eventNames: string[], options: WaitForEventOptions = {}): Promise<WaitAnyResult<T>> {
    const waitIds = await Promise.all(eventNames.map((name) => this.registerWait(name, options)))
    let resolved = false

    return new Promise<WaitAnyResult<T>>((resolve, reject) => {
      const cleanup = async (resolvedWaitId: string) => {
        // Cancel all remaining waits except the resolved one
        for (const waitId of waitIds) {
          if (waitId === resolvedWaitId) continue
          const wait = await this.getPendingWait(waitId)
          if (wait?.status === 'pending') {
            // Silently remove from storage and resolvers without triggering reject
            await this.storage.delete(`wait:${waitId}`)
            this.waitResolvers.delete(waitId)
          }
        }
        await this.updateAlarm()
      }

      // Store wait metadata for later access (since storage is deleted on resolve)
      const waitMetadata = new Map<string, { eventName: string; createdAt: number }>()
      for (let i = 0; i < waitIds.length; i++) {
        waitMetadata.set(waitIds[i]!, { eventName: eventNames[i]!, createdAt: Date.now() })
      }

      // Store resolvers for each wait
      for (const waitId of waitIds) {
        this.waitResolvers.set(waitId, {
          resolve: async (value: unknown) => {
            if (resolved) return // Already resolved by another event
            resolved = true
            const meta = waitMetadata.get(waitId)
            const result = {
              eventName: meta?.eventName || '',
              payload: value as T,
              duration: Date.now() - (meta?.createdAt || Date.now()),
            }
            await cleanup(waitId)
            resolve(result)
          },
          reject: async (error: Error) => {
            if (resolved) return
            resolved = true
            await cleanup('')
            reject(error)
          },
        })
      }

      // Handle AbortSignal
      if (options.signal) {
        if (options.signal.aborted) {
          cleanup('').then(() => reject(new WaitCancelledError(options.signal!.reason)))
          return
        }

        options.signal.addEventListener('abort', async () => {
          if (resolved) return
          resolved = true
          await cleanup('')
          reject(new WaitCancelledError(options.signal!.reason))
        })
      }
    })
  }

  /**
   * Wait for all specified events
   */
  async waitForAll<T = unknown>(eventNames: string[], options: WaitForEventOptions = {}): Promise<WaitAllResult<T>[]> {
    const waitIds = await Promise.all(eventNames.map((name) => this.registerWait(name, options)))
    const results: WaitAllResult<T>[] = []
    const completed = new Set<string>()

    return new Promise<WaitAllResult<T>[]>((resolve, reject) => {
      // Store resolvers for each wait
      for (const waitId of waitIds) {
        this.waitResolvers.set(waitId, {
          resolve: async (value: unknown) => {
            const wait = await this.storage.get<PendingWait>(`wait:${waitId}`)
            results.push({
              eventName: wait?.eventName || '',
              payload: value as T,
              duration: Date.now() - (wait?.createdAt || Date.now()),
            })
            completed.add(waitId)

            if (completed.size === waitIds.length) {
              resolve(results)
            }
          },
          reject,
        })
      }

      // Handle AbortSignal
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new WaitCancelledError(options.signal!.reason))
          return
        }

        options.signal.addEventListener('abort', () => {
          reject(new WaitCancelledError(options.signal!.reason))
        })
      }
    })
  }

  // ==========================================================================
  // WAIT MANAGEMENT
  // ==========================================================================

  /**
   * Get a pending wait by ID
   */
  async getPendingWait(waitId: string): Promise<PendingWait | undefined> {
    return this.storage.get<PendingWait>(`wait:${waitId}`)
  }

  /**
   * List all pending waits
   */
  async listPendingWaits(): Promise<PendingWait[]> {
    const waitMap = await this.storage.list<PendingWait>({ prefix: 'wait:' })
    return Array.from(waitMap.values()).filter((w: PendingWait) => w.status === 'pending')
  }

  /**
   * Cancel a pending wait
   */
  async cancelWait(waitId: string, reason?: string): Promise<boolean> {
    const wait = await this.storage.get<PendingWait>(`wait:${waitId}`)
    if (!wait) {
      return false
    }

    // Remove from storage and cache
    await this.storage.delete(`wait:${waitId}`)
    this.filterCache.delete(waitId)

    // Update alarm
    await this.updateAlarm()

    // Reject the promise
    const resolver = this.waitResolvers.get(waitId)
    if (resolver) {
      resolver.reject(new WaitCancelledError(reason))
      this.waitResolvers.delete(waitId)
    }

    // Emit event
    this.emit('wait.cancelled', { waitId, eventName: wait.eventName, reason })

    return true
  }

  /**
   * Get statistics about pending waits
   */
  async getStats(): Promise<{
    pendingCount: number
    withTimeout: number
    withoutTimeout: number
  }> {
    const waits = await this.listPendingWaits()
    return {
      pendingCount: waits.length,
      withTimeout: waits.filter((w) => w.timeoutAt !== undefined).length,
      withoutTimeout: waits.filter((w) => w.timeoutAt === undefined).length,
    }
  }

  // ==========================================================================
  // EVENT DELIVERY
  // ==========================================================================

  /**
   * Deliver an event to a waiting workflow
   */
  async deliverEvent(waitId: string | null, eventName: string, payload: unknown): Promise<WaitResult> {
    let wait: PendingWait | undefined

    if (waitId) {
      // Specific wait ID provided
      wait = await this.storage.get<PendingWait>(`wait:${waitId}`)

      if (!wait) {
        return { resolved: false, reason: 'no-matching-wait' }
      }

      // Validate event name matches
      if (wait.eventName !== eventName) {
        throw new WaitEventMismatchError(wait.eventName, eventName)
      }
    } else {
      // Find matching wait by event name
      const waits = await this.listPendingWaits()
      wait = waits.find((w) => w.eventName === eventName)

      if (!wait) {
        return { resolved: false, reason: 'no-matching-wait' }
      }

      waitId = wait.id
    }

    // Prevent concurrent delivery to same wait
    if (this.deliveryLocks.has(waitId!)) {
      return { resolved: false, reason: 'no-matching-wait' }
    }
    this.deliveryLocks.add(waitId!)

    // Check filter if present (get from in-memory cache, since functions can't be stored)
    const filter = this.filterCache.get(waitId!)
    if (filter) {
      try {
        const filterFn =
          typeof filter === 'function'
            ? filter
            : (p: unknown) => {
                const obj = p as Record<string, unknown>
                return Object.entries(filter as Record<string, unknown>).every(([key, value]) => obj[key] === value)
              }

        if (!filterFn(payload)) {
          // Filter didn't match, wait continues
          this.deliveryLocks.delete(waitId!)
          return { resolved: false, reason: 'no-matching-wait' }
        }
      } catch (error) {
        console.warn('Filter error, skipping event:', error)
        this.deliveryLocks.delete(waitId!)
        return { resolved: false, reason: 'no-matching-wait' }
      }
    }

    // Calculate duration
    const duration = Date.now() - wait.createdAt

    // Remove from storage and cache
    await this.storage.delete(`wait:${waitId}`)
    this.filterCache.delete(waitId!)

    // Update alarm
    await this.updateAlarm()

    // Resolve the promise
    const resolver = this.waitResolvers.get(waitId!)
    if (resolver) {
      resolver.resolve(payload)
      this.waitResolvers.delete(waitId!)
    }

    // Release lock
    this.deliveryLocks.delete(waitId!)

    // Emit event
    this.emit('wait.resolved', { waitId, eventName, payload, duration })

    return { resolved: true, payload, duration }
  }

  /**
   * Deliver an event by correlation ID
   */
  async deliverEventByCorrelation(eventName: string, correlationId: string, payload: unknown): Promise<WaitResult> {
    const waits = await this.listPendingWaits()
    const wait = waits.find((w) => w.eventName === eventName && w.options.correlationId === correlationId)

    if (!wait) {
      return { resolved: false, reason: 'no-matching-wait' }
    }

    return this.deliverEvent(wait.id, eventName, payload)
  }

  // ==========================================================================
  // ALARM HANDLING
  // ==========================================================================

  /**
   * Handle DO alarm for timeout processing
   */
  async handleAlarm(): Promise<void> {
    const now = Date.now()
    const waits = await this.listPendingWaits()

    // Process timed out waits
    for (const wait of waits) {
      if (wait.timeoutAt && wait.timeoutAt <= now) {
        const duration = now - wait.createdAt

        // Remove from storage and cache
        await this.storage.delete(`wait:${wait.id}`)
        this.filterCache.delete(wait.id)

        // Reject the promise
        const resolver = this.waitResolvers.get(wait.id)
        if (resolver) {
          resolver.reject(new WaitTimeoutError(wait.eventName, duration))
          this.waitResolvers.delete(wait.id)
        }

        // Emit event
        this.emit('wait.timeout', { waitId: wait.id, eventName: wait.eventName, duration })
      }
    }

    // Update alarm for next timeout
    await this.updateAlarm()
  }

  /**
   * Update the DO alarm for the next timeout
   */
  private async updateAlarm(): Promise<void> {
    const waits = await this.listPendingWaits()
    const withTimeouts = waits.filter((w) => w.timeoutAt !== undefined)

    if (withTimeouts.length === 0) {
      await this.storage.deleteAlarm()
      return
    }

    // Find the earliest timeout
    const nextTimeout = Math.min(...withTimeouts.map((w) => w.timeoutAt!))
    await this.storage.setAlarm(nextTimeout)
  }

  // ==========================================================================
  // RESTORATION
  // ==========================================================================

  /**
   * Restore state from storage (called after hibernation)
   */
  async restoreFromStorage(): Promise<void> {
    // Check current alarm state
    await this.storage.getAlarm()

    // Verify alarms are set correctly
    await this.updateAlarm()
  }
}

export default WaitForEventManager
