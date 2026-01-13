/**
 * WaitForEvent via Verb Form Relationships
 *
 * Migrates WaitForEventManager from storage keys to graph relationships.
 *
 * The key insight: verb form IS the state - no separate status column needed:
 * - Action form (waitFor) = pending/intent
 * - Activity form (waitingFor) = in-progress (awaiting event)
 * - Event form (waitedFor) = completed (event received)
 *
 * Verb forms for wait-for-event:
 * - 'waitFor' (action) -> 'waitingFor' (activity) -> 'waitedFor' (event)
 *
 * Timeout enforcement via relationship timestamps (createdAt + timeout = expiresAt).
 *
 * @see dotdo-hg8t8 - [REFACTOR] Migrate WaitForEventManager to use graph relationships
 */

import { VerbFormStateMachine, getVerbFormType } from '../../db/graph/verb-forms'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for creating a wait-for-event
 */
export interface WaitForEventOptions {
  /** Timeout as duration string (e.g., '7 days', '1 hour') or milliseconds */
  timeout?: string | number
  /** Event type (for validation) */
  type?: string
  /** Filter function or property matcher to validate incoming events */
  filter?: ((payload: unknown) => boolean) | Record<string, unknown>
  /** Correlation ID for targeted event delivery */
  correlationId?: string
}

/**
 * WaitForEvent relationship stored in the graph
 */
export interface WaitForEventRelationship {
  id: string
  /** Verb form encoding state: 'waitFor', 'waitingFor', 'waitedFor' */
  verb: string
  /** Source: workflow instance URL */
  from: string
  /** Target: event name/URL (null while waiting, set when resolved) */
  to: string | null
  /** Wait event data */
  data: WaitForEventData
  /** When the wait was created */
  createdAt: number
  /** When the wait was last updated */
  updatedAt: number
}

/**
 * Data stored in a wait-for-event relationship
 */
export interface WaitForEventData {
  /** The event name we're waiting for */
  eventName: string
  /** Timeout in milliseconds */
  timeout?: number
  /** When the timeout expires (createdAt + timeout) */
  expiresAt?: number
  /** Correlation ID for targeted delivery */
  correlationId?: string
  /** Event type for validation */
  type?: string
  /** Payload received when resolved */
  payload?: unknown
  /** When resolved */
  resolvedAt?: number
  /** Error message if timed out or cancelled */
  error?: string
  /** Duration waited in milliseconds */
  duration?: number
}

/**
 * Result from event delivery
 */
export interface WaitResult<T = unknown> {
  resolved: boolean
  payload?: T
  reason?: 'no-matching-wait' | 'cancelled' | 'timeout' | 'event-mismatch' | 'filter-mismatch'
  duration?: number
}

/**
 * Pending wait info for query results
 */
export interface PendingWait {
  /** Relationship ID */
  id: string
  /** Workflow instance ID */
  instanceId: string
  /** Event name */
  eventName: string
  /** Current verb form state */
  verb: string
  /** Options */
  options: WaitForEventOptions
  /** When created */
  createdAt: number
  /** When timeout expires (if set) */
  timeoutAt?: number
  /** Whether timeout has expired */
  isExpired: boolean
  /** Time remaining in milliseconds (negative if expired) */
  timeRemaining: number
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
// STATE MACHINE
// ============================================================================

/**
 * State machine for the 'waitFor' verb lifecycle
 * waitFor (pending) -> waitingFor (in-progress) -> waitedFor (completed)
 *
 * Note: We use a custom state machine because 'waitFor' is a compound verb
 * that doesn't follow standard conjugation rules.
 */
const waitForMachine = new VerbFormStateMachine({
  action: 'waitFor',      // pending
  activity: 'waitingFor', // in-progress
  event: 'waitedFor',     // completed
})

// ============================================================================
// IN-MEMORY STORE (per-db isolation)
// ============================================================================

/**
 * In-memory store for wait relationships (per-db isolation for testing)
 */
const waitStores = new WeakMap<object, Map<string, WaitForEventRelationship>>()

/**
 * In-memory filter cache (functions can't be serialized)
 */
const filterCaches = new WeakMap<object, Map<string, ((payload: unknown) => boolean) | Record<string, unknown>>>()

/**
 * Get or create the wait store for a database
 */
function getWaitStore(db: object): Map<string, WaitForEventRelationship> {
  let store = waitStores.get(db)
  if (!store) {
    store = new Map()
    waitStores.set(db, store)
  }
  return store
}

/**
 * Get or create the filter cache for a database
 */
function getFilterCache(db: object): Map<string, ((payload: unknown) => boolean) | Record<string, unknown>> {
  let cache = filterCaches.get(db)
  if (!cache) {
    cache = new Map()
    filterCaches.set(db, cache)
  }
  return cache
}

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique wait ID
 */
function generateWaitId(): string {
  idCounter++
  return `wait-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

// ============================================================================
// DURATION PARSING
// ============================================================================

/**
 * Parse a duration string or number to milliseconds
 */
export function parseDuration(duration: string | number): number {
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
// WAIT OPERATIONS
// ============================================================================

/**
 * Create a wait-for-event relationship in pending state.
 *
 * Creates a 'waitFor' action relationship from the workflow instance.
 * The verb form encodes the state:
 * - 'waitFor' = pending (intent to wait)
 * - 'waitingFor' = in-progress (actively waiting for event)
 * - 'waitedFor' = completed (event received)
 *
 * @param db - Database instance (or empty object for testing)
 * @param instanceId - The workflow instance ID (becomes 'from' URL)
 * @param eventName - The event name to wait for
 * @param options - Wait options (timeout, filter, correlationId)
 * @returns The created WaitForEventRelationship
 */
export async function createWaitForEvent(
  db: object,
  instanceId: string,
  eventName: string,
  options: WaitForEventOptions = {}
): Promise<WaitForEventRelationship> {
  const store = getWaitStore(db)
  const filterCache = getFilterCache(db)

  const id = generateWaitId()
  const now = Date.now()

  // Calculate timeout
  let timeout: number | undefined
  let expiresAt: number | undefined
  if (options.timeout) {
    timeout = parseDuration(options.timeout)
    expiresAt = now + timeout
  }

  const data: WaitForEventData = {
    eventName,
    timeout,
    expiresAt,
    correlationId: options.correlationId,
    type: options.type,
  }

  const wait: WaitForEventRelationship = {
    id,
    verb: 'waitFor', // Action form = pending state
    from: instanceId,
    to: null, // null while waiting
    data,
    createdAt: now,
    updatedAt: now,
  }

  store.set(id, wait)

  // Cache filter function (can't be serialized to storage)
  if (options.filter) {
    filterCache.set(id, options.filter)
  }

  return wait
}

/**
 * Start waiting for an event (transition pending -> in-progress).
 *
 * Transitions the verb from 'waitFor' (pending) to 'waitingFor' (in-progress).
 *
 * @param db - Database instance
 * @param waitId - The wait relationship ID
 * @returns The updated WaitForEventRelationship
 * @throws Error if wait not found or invalid transition
 */
export async function startWaiting(
  db: object,
  waitId: string
): Promise<WaitForEventRelationship> {
  const store = getWaitStore(db)
  const wait = store.get(waitId)

  if (!wait) {
    throw new Error(`Wait not found: ${waitId}`)
  }

  const currentState = waitForMachine.getState(wait.verb)
  if (currentState !== 'pending') {
    throw new Error(`Cannot start waiting in ${currentState} state`)
  }

  const updated: WaitForEventRelationship = {
    ...wait,
    verb: 'waitingFor', // Activity form = in-progress
    updatedAt: Date.now(),
  }

  store.set(waitId, updated)
  return updated
}

/**
 * Deliver an event to a waiting workflow (transition in-progress -> completed).
 *
 * Transitions the verb from 'waitingFor' (in-progress) to 'waitedFor' (completed).
 *
 * @param db - Database instance
 * @param waitId - The wait relationship ID (or null to match by event name)
 * @param eventName - The event name
 * @param payload - The event payload
 * @returns The result of event delivery
 */
export async function deliverEvent(
  db: object,
  waitId: string | null,
  eventName: string,
  payload: unknown
): Promise<WaitResult> {
  const store = getWaitStore(db)
  const filterCache = getFilterCache(db)
  let wait: WaitForEventRelationship | undefined

  if (waitId) {
    // Specific wait ID provided
    wait = store.get(waitId)

    if (!wait) {
      return { resolved: false, reason: 'no-matching-wait' }
    }

    // Validate event name matches
    if (wait.data.eventName !== eventName) {
      throw new WaitEventMismatchError(wait.data.eventName, eventName)
    }
  } else {
    // Find matching wait by event name (pending or in-progress)
    const waits = Array.from(store.values())
    wait = waits.find((w) => {
      const state = waitForMachine.getState(w.verb)
      return (
        w.data.eventName === eventName &&
        (state === 'pending' || state === 'in_progress')
      )
    })

    if (!wait) {
      return { resolved: false, reason: 'no-matching-wait' }
    }

    waitId = wait.id
  }

  // Check current state using state machine - must be pending or in-progress
  const currentState = waitForMachine.getState(wait.verb)
  if (currentState === 'completed') {
    return { resolved: false, reason: 'no-matching-wait' } // Already resolved
  }

  // Check filter if present
  const filter = filterCache.get(waitId!)
  if (filter) {
    try {
      const filterFn =
        typeof filter === 'function'
          ? filter
          : (p: unknown) => {
              const obj = p as Record<string, unknown>
              return Object.entries(filter as Record<string, unknown>).every(
                ([key, value]) => obj[key] === value
              )
            }

      if (!filterFn(payload)) {
        return { resolved: false, reason: 'filter-mismatch' }
      }
    } catch (error) {
      console.warn('Filter error, skipping event:', error)
      return { resolved: false, reason: 'filter-mismatch' }
    }
  }

  const now = Date.now()
  const duration = now - wait.createdAt

  // Transition to completed state
  const updated: WaitForEventRelationship = {
    ...wait,
    verb: 'waitedFor', // Event form = completed
    to: eventName, // Set the target when completed
    data: {
      ...wait.data,
      payload,
      resolvedAt: now,
      duration,
    },
    updatedAt: now,
  }

  store.set(waitId!, updated)
  filterCache.delete(waitId!)

  return { resolved: true, payload, duration }
}

/**
 * Deliver an event by correlation ID.
 *
 * @param db - Database instance
 * @param eventName - The event name
 * @param correlationId - The correlation ID
 * @param payload - The event payload
 * @returns The result of event delivery
 */
export async function deliverEventByCorrelation(
  db: object,
  eventName: string,
  correlationId: string,
  payload: unknown
): Promise<WaitResult> {
  const store = getWaitStore(db)
  const waits = Array.from(store.values())

  const wait = waits.find((w) => {
    const state = waitForMachine.getState(w.verb)
    return (
      w.data.eventName === eventName &&
      w.data.correlationId === correlationId &&
      (state === 'pending' || state === 'in_progress')
    )
  })

  if (!wait) {
    return { resolved: false, reason: 'no-matching-wait' }
  }

  return deliverEvent(db, wait.id, eventName, payload)
}

/**
 * Cancel a pending wait.
 *
 * Sets the wait to a cancelled state (keeps history for auditing).
 *
 * @param db - Database instance
 * @param waitId - The wait relationship ID
 * @param reason - Cancellation reason
 * @returns True if cancelled, false if not found or already completed
 */
export async function cancelWait(
  db: object,
  waitId: string,
  reason?: string
): Promise<boolean> {
  const store = getWaitStore(db)
  const filterCache = getFilterCache(db)
  const wait = store.get(waitId)

  if (!wait) {
    return false
  }

  // Use state machine to check if already completed
  const state = waitForMachine.getState(wait.verb)
  if (state === 'completed') {
    return false // Already resolved or cancelled
  }

  const now = Date.now()

  // Transition to cancelled state (using 'waitedFor' with error)
  const updated: WaitForEventRelationship = {
    ...wait,
    verb: 'waitedFor', // Event form = completed (cancelled is a form of completion)
    to: null, // No target when cancelled
    data: {
      ...wait.data,
      error: reason ? `Cancelled: ${reason}` : 'Cancelled',
      resolvedAt: now,
      duration: now - wait.createdAt,
    },
    updatedAt: now,
  }

  store.set(waitId, updated)
  filterCache.delete(waitId)

  return true
}

/**
 * Mark a wait as timed out.
 *
 * @param db - Database instance
 * @param waitId - The wait relationship ID
 * @returns The updated relationship or null if not found or already completed
 */
export async function timeoutWait(
  db: object,
  waitId: string
): Promise<WaitForEventRelationship | null> {
  const store = getWaitStore(db)
  const filterCache = getFilterCache(db)
  const wait = store.get(waitId)

  if (!wait) {
    return null
  }

  // Use state machine to check if already completed
  const state = waitForMachine.getState(wait.verb)
  if (state === 'completed') {
    return null // Already resolved
  }

  const now = Date.now()
  const duration = now - wait.createdAt

  const updated: WaitForEventRelationship = {
    ...wait,
    verb: 'waitedFor', // Event form = completed (timeout is a form of completion)
    to: null,
    data: {
      ...wait.data,
      error: `Timed out after ${duration}ms`,
      resolvedAt: now,
      duration,
    },
    updatedAt: now,
  }

  store.set(waitId, updated)
  filterCache.delete(waitId)

  return updated
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Get a wait by ID.
 *
 * @param db - Database instance
 * @param waitId - The wait relationship ID
 * @returns The wait or null if not found
 */
export async function getWait(
  db: object,
  waitId: string
): Promise<WaitForEventRelationship | null> {
  const store = getWaitStore(db)
  return store.get(waitId) ?? null
}

/**
 * Get the semantic state of a wait based on its verb form.
 *
 * @param wait - The wait relationship
 * @returns 'pending' | 'in_progress' | 'completed'
 */
export function getWaitState(
  wait: WaitForEventRelationship
): 'pending' | 'in_progress' | 'completed' {
  const state = waitForMachine.getState(wait.verb)
  return state ?? 'pending'
}

/**
 * Check if a wait has an error (timeout or cancellation).
 *
 * @param wait - The wait relationship
 * @returns True if the wait has an error
 */
export function hasWaitError(wait: WaitForEventRelationship): boolean {
  return !!wait.data.error
}

/**
 * Query pending waits (action form 'waitFor').
 *
 * @param db - Database instance
 * @param options - Optional filters (instanceId, eventName, limit)
 * @returns Array of pending waits
 */
export async function queryPendingWaits(
  db: object,
  options?: { instanceId?: string; eventName?: string; limit?: number }
): Promise<PendingWait[]> {
  const store = getWaitStore(db)
  const now = Date.now()

  let results: PendingWait[] = []

  for (const wait of Array.from(store.values())) {
    // Filter by verb form (pending waits only)
    if (wait.verb !== 'waitFor') continue

    // Filter by instanceId
    if (options?.instanceId && wait.from !== options.instanceId) continue

    // Filter by eventName
    if (options?.eventName && wait.data.eventName !== options.eventName) continue

    const expiresAt = wait.data.expiresAt
    const isExpired = expiresAt ? now > expiresAt : false
    const timeRemaining = expiresAt ? expiresAt - now : Number.MAX_SAFE_INTEGER

    results.push({
      id: wait.id,
      instanceId: wait.from,
      eventName: wait.data.eventName,
      verb: wait.verb,
      options: {
        timeout: wait.data.timeout,
        correlationId: wait.data.correlationId,
        type: wait.data.type,
      },
      createdAt: wait.createdAt,
      timeoutAt: expiresAt,
      isExpired,
      timeRemaining,
    })
  }

  // Sort by urgency: expired first, then by time remaining
  results.sort((a, b) => {
    if (a.isExpired && !b.isExpired) return -1
    if (!a.isExpired && b.isExpired) return 1
    return a.timeRemaining - b.timeRemaining
  })

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query active waits (activity form 'waitingFor').
 *
 * @param db - Database instance
 * @param options - Optional filters
 * @returns Array of active waits
 */
export async function queryActiveWaits(
  db: object,
  options?: { instanceId?: string; eventName?: string; limit?: number }
): Promise<WaitForEventRelationship[]> {
  const store = getWaitStore(db)

  let results: WaitForEventRelationship[] = []

  for (const wait of Array.from(store.values())) {
    // Filter by verb form (active waits only)
    if (wait.verb !== 'waitingFor') continue

    // Filter by instanceId
    if (options?.instanceId && wait.from !== options.instanceId) continue

    // Filter by eventName
    if (options?.eventName && wait.data.eventName !== options.eventName) continue

    results.push(wait)
  }

  // Sort by creation time
  results.sort((a, b) => a.createdAt - b.createdAt)

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query all incomplete waits (pending or in-progress).
 *
 * @param db - Database instance
 * @param options - Optional filters
 * @returns Array of incomplete waits
 */
export async function queryIncompleteWaits(
  db: object,
  options?: { instanceId?: string; limit?: number }
): Promise<WaitForEventRelationship[]> {
  const store = getWaitStore(db)

  let results: WaitForEventRelationship[] = []

  for (const wait of Array.from(store.values())) {
    const state = waitForMachine.getState(wait.verb)

    // Include pending and in-progress, exclude completed
    if (state === 'completed') continue

    // Filter by instanceId
    if (options?.instanceId && wait.from !== options.instanceId) continue

    results.push(wait)
  }

  // Sort by creation time
  results.sort((a, b) => a.createdAt - b.createdAt)

  // Apply limit
  if (options?.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Query all waits for an instance.
 *
 * @param db - Database instance
 * @param instanceId - The workflow instance ID
 * @returns Array of waits (in any state)
 */
export async function queryWaitsByInstance(
  db: object,
  instanceId: string
): Promise<WaitForEventRelationship[]> {
  const store = getWaitStore(db)

  const results: WaitForEventRelationship[] = []

  for (const wait of Array.from(store.values())) {
    if (wait.from === instanceId) {
      results.push(wait)
    }
  }

  // Sort by createdAt (newest first)
  results.sort((a, b) => b.createdAt - a.createdAt)

  return results
}

/**
 * Find all waits with expired timeouts.
 *
 * @param db - Database instance
 * @returns Array of expired waits (still pending or in-progress)
 */
export async function findExpiredWaits(
  db: object
): Promise<WaitForEventRelationship[]> {
  const store = getWaitStore(db)
  const now = Date.now()

  const results: WaitForEventRelationship[] = []

  for (const wait of Array.from(store.values())) {
    const state = waitForMachine.getState(wait.verb)

    // Only check incomplete waits (pending or in_progress)
    if (state === 'completed') continue

    // Check if timeout has expired
    const expiresAt = wait.data.expiresAt
    if (expiresAt && now > expiresAt) {
      results.push(wait)
    }
  }

  return results
}

// ============================================================================
// SLA/TIMEOUT ENFORCEMENT
// ============================================================================

/**
 * Check timeout status for a wait.
 *
 * @param wait - The wait relationship
 * @returns Timeout status information
 */
export function checkWaitTimeout(
  wait: WaitForEventRelationship
): { hasExpired: boolean; timeRemaining: number; expiresAt: Date | null } {
  const now = Date.now()
  const expiresAt = wait.data.expiresAt

  if (!expiresAt) {
    return {
      hasExpired: false,
      timeRemaining: Number.MAX_SAFE_INTEGER,
      expiresAt: null,
    }
  }

  return {
    hasExpired: now > expiresAt,
    timeRemaining: expiresAt - now,
    expiresAt: new Date(expiresAt),
  }
}

/**
 * Get the next timeout timestamp among all incomplete waits.
 *
 * @param db - Database instance
 * @returns The next timeout timestamp in milliseconds, or null if none
 */
export async function getNextWaitTimeout(
  db: object
): Promise<number | null> {
  const store = getWaitStore(db)

  let nextTimeout: number | null = null

  for (const wait of Array.from(store.values())) {
    const verbType = getVerbFormType(wait.verb)

    // Only check incomplete waits with timeouts
    if (verbType === 'event') continue
    if (!wait.data.expiresAt) continue

    if (nextTimeout === null || wait.data.expiresAt < nextTimeout) {
      nextTimeout = wait.data.expiresAt
    }
  }

  return nextTimeout
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get statistics about waits.
 *
 * @param db - Database instance
 * @returns Statistics
 */
export async function getWaitStats(
  db: object
): Promise<{
  pendingCount: number
  activeCount: number
  completedCount: number
  withTimeout: number
  withoutTimeout: number
  expiredCount: number
}> {
  const store = getWaitStore(db)
  const now = Date.now()

  let pendingCount = 0
  let activeCount = 0
  let completedCount = 0
  let withTimeout = 0
  let withoutTimeout = 0
  let expiredCount = 0

  for (const wait of Array.from(store.values())) {
    const verbType = getVerbFormType(wait.verb)

    switch (verbType) {
      case 'action':
        pendingCount++
        break
      case 'activity':
        activeCount++
        break
      case 'event':
        completedCount++
        break
    }

    // Count timeout stats for incomplete waits
    if (verbType !== 'event') {
      if (wait.data.expiresAt) {
        withTimeout++
        if (now > wait.data.expiresAt) {
          expiredCount++
        }
      } else {
        withoutTimeout++
      }
    }
  }

  return {
    pendingCount,
    activeCount,
    completedCount,
    withTimeout,
    withoutTimeout,
    expiredCount,
  }
}
