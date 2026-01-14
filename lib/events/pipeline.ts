/**
 * Unified Events Pipeline
 *
 * THE universal event stream for everything:
 * - Domain events (Customer.created, Order.completed)
 * - Telemetry (Request.routed, RPC.called)
 * - Analytics (Session.started, Page.viewed)
 * - Browser insights (Vitals.measured, Error.caught)
 * - DB mutations (Thing.created, Thing.updated)
 * - Workers logs (Worker.invoked, Worker.errored)
 *
 * All events use flat fields (no nesting) for R2/SQL compatibility.
 * Uses Noun.event semantic for the verb field.
 *
 * @example
 * ```typescript
 * import { sendEvent, initEventSink, event } from 'lib/events'
 *
 * // Initialize with env bindings (enables direct pipeline access)
 * initEventSink(env)
 *
 * // Send events - flat fields, Noun.event verb
 * await sendEvent(event('Customer.created', {
 *   source: 'tenant-123',
 *   customerId: 'cust-456',
 *   name: 'Acme Corp',
 *   plan: 'enterprise',
 * }))
 *
 * // Or use typed helpers
 * await sendEvent(routingEvent({
 *   source: 'api-router',
 *   requestId: 'req-123',
 *   pathname: '/api/customers',
 *   method: 'GET',
 *   targetBinding: 'DO',
 *   durationMs: 5,
 * }))
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Base event structure - all events are flat with Noun.event verb
 *
 * Fields are flat (no nesting) for R2/SQL/Streams compatibility.
 */
export interface BaseEvent {
  /** Event type in Noun.event format (e.g., 'Customer.created', 'Request.routed') */
  verb: string
  /** Origin of the event (DO namespace, worker name, browser sessionId, etc.) */
  source: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** All other fields are flat at root level */
  [key: string]: string | number | boolean | null | undefined
}

/**
 * Pipeline interface matching Cloudflare's Pipeline binding
 */
export interface Pipeline {
  send(data: unknown[]): Promise<void>
}

/**
 * Environment with optional EVENTS binding
 */
export interface EventsEnv {
  EVENTS?: Pipeline
}

/**
 * Event sink interface for sending events
 */
export interface EventSink {
  send(events: BaseEvent[]): Promise<void>
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Multi-tenant events endpoint (forwards to Pipeline HTTP endpoint)
 */
export const EVENTS_ENDPOINT = 'https://workers.do/events'

/**
 * Request timeout for HTTP fallback (ms)
 */
const HTTP_TIMEOUT = 5000

/**
 * Max batch size for events
 */
export const MAX_BATCH_SIZE = 1000

// ============================================================================
// Pipeline Sink (Direct binding)
// ============================================================================

/**
 * Event sink using direct Pipeline binding
 */
export class PipelineEventSink implements EventSink {
  constructor(private pipeline: Pipeline) {}

  async send(events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return

    // Ensure timestamps
    const timestampedEvents = events.map((e) => ({
      ...e,
      timestamp: e.timestamp || new Date().toISOString(),
    }))

    // Batch if needed
    for (let i = 0; i < timestampedEvents.length; i += MAX_BATCH_SIZE) {
      const batch = timestampedEvents.slice(i, i + MAX_BATCH_SIZE)
      await this.pipeline.send(batch)
    }
  }
}

// ============================================================================
// HTTP Sink (Fallback)
// ============================================================================

/**
 * Event sink using HTTP POST to workers.do/events
 */
export class HttpEventSink implements EventSink {
  constructor(
    private endpoint: string = EVENTS_ENDPOINT,
    private timeout: number = HTTP_TIMEOUT
  ) {}

  async send(events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return

    // Ensure timestamps
    const timestampedEvents = events.map((e) => ({
      ...e,
      timestamp: e.timestamp || new Date().toISOString(),
    }))

    // Batch if needed
    for (let i = 0; i < timestampedEvents.length; i += MAX_BATCH_SIZE) {
      const batch = timestampedEvents.slice(i, i + MAX_BATCH_SIZE)
      await this.sendBatch(batch)
    }
  }

  private async sendBatch(events: BaseEvent[]): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(events),
        signal: controller.signal,
      })

      if (!response.ok) {
        console.error(`Events pipeline HTTP error: ${response.status}`)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Events pipeline HTTP timeout')
      } else {
        console.error('Events pipeline HTTP error:', error)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an event sink based on available bindings
 *
 * @param env - Environment with optional EVENTS binding
 * @returns EventSink that sends to pipeline or HTTP fallback
 */
export function createEventSink(env?: EventsEnv): EventSink {
  if (env?.EVENTS) {
    return new PipelineEventSink(env.EVENTS)
  }
  return new HttpEventSink()
}

/**
 * Check if direct pipeline binding is available
 */
export function hasEventsBinding(env?: EventsEnv): boolean {
  return env?.EVENTS !== undefined
}

// ============================================================================
// Global Sink
// ============================================================================

let globalSink: EventSink | null = null

function getGlobalSink(): EventSink {
  if (!globalSink) {
    globalSink = new HttpEventSink()
  }
  return globalSink
}

/**
 * Initialize the global sink with env bindings
 *
 * Call this early in request handling to enable direct pipeline access.
 */
export function initEventSink(env: EventsEnv): void {
  globalSink = createEventSink(env)
}

/**
 * Send events to the pipeline
 */
export async function sendEvents(events: BaseEvent[]): Promise<void> {
  const sink = getGlobalSink()
  await sink.send(events)
}

/**
 * Send a single event to the pipeline
 */
export async function sendEvent(ev: BaseEvent): Promise<void> {
  await sendEvents([ev])
}

// ============================================================================
// Event Factory - Generic
// ============================================================================

/**
 * Create an event with Noun.event verb and flat fields
 *
 * @param verb - Event type in Noun.event format (e.g., 'Customer.created')
 * @param fields - Flat fields for the event (source required, others optional)
 *
 * @example
 * ```typescript
 * event('Customer.created', {
 *   source: 'tenant-123',
 *   customerId: 'cust-456',
 *   name: 'Acme Corp',
 * })
 * ```
 */
export function event(
  verb: string,
  fields: { source: string } & Record<string, string | number | boolean | null | undefined>
): BaseEvent {
  return {
    verb,
    timestamp: new Date().toISOString(),
    ...fields,
  }
}

// ============================================================================
// Event Factories - Typed Helpers
// ============================================================================

/**
 * Request.routed - API routing decision
 */
export function routingEvent(fields: {
  source: string
  requestId: string
  pathname: string
  method: string
  targetBinding: string
  isReplica?: boolean
  consistencyMode?: string
  durationMs: number
  colo?: string
  region?: string
  replicaRegion?: string
}): BaseEvent {
  return event('Request.routed', fields)
}

/**
 * Usage.recorded - API usage tracking
 */
export function usageEvent(fields: {
  source: string
  requestId: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  cost: number
  userId?: string
  apiKeyId?: string
  tenantId?: string
}): BaseEvent {
  return event('Usage.recorded', fields)
}

/**
 * RPC.called - Cap'n Web RPC metering
 */
export function rpcEvent(fields: {
  source: string
  requestId: string
  service: string
  method: string
  status: string
  durationMs: number
  costUnits: number
  tenantId?: string
  userId?: string
  inputTokens?: number
  outputTokens?: number
}): BaseEvent {
  return event('RPC.called', fields)
}

/**
 * Thing.created - Domain entity created
 */
export function thingCreatedEvent(fields: {
  source: string
  thingId: string
  thingType: string
  branch?: string
  [key: string]: string | number | boolean | null | undefined
}): BaseEvent {
  return event(`${fields.thingType}.created`, fields)
}

/**
 * Thing.updated - Domain entity updated
 */
export function thingUpdatedEvent(fields: {
  source: string
  thingId: string
  thingType: string
  branch?: string
  version?: number
  [key: string]: string | number | boolean | null | undefined
}): BaseEvent {
  return event(`${fields.thingType}.updated`, fields)
}

/**
 * Thing.deleted - Domain entity deleted
 */
export function thingDeletedEvent(fields: {
  source: string
  thingId: string
  thingType: string
  branch?: string
}): BaseEvent {
  return event(`${fields.thingType}.deleted`, fields)
}

/**
 * Session.started - Browser/user session started
 */
export function sessionStartedEvent(fields: {
  source: string
  sessionId: string
  userId?: string
  userAgent?: string
  referrer?: string
  pathname?: string
}): BaseEvent {
  return event('Session.started', fields)
}

/**
 * Page.viewed - Page view event (Segment-style)
 */
export function pageViewedEvent(fields: {
  source: string
  sessionId: string
  pathname: string
  title?: string
  referrer?: string
  userId?: string
}): BaseEvent {
  return event('Page.viewed', fields)
}

/**
 * Vitals.measured - Core Web Vitals
 */
export function vitalsEvent(fields: {
  source: string
  sessionId: string
  pathname: string
  metric: string // 'LCP' | 'FID' | 'CLS' | 'FCP' | 'TTFB'
  value: number
  rating?: string // 'good' | 'needs-improvement' | 'poor'
}): BaseEvent {
  return event('Vitals.measured', fields)
}

/**
 * Error.caught - Client/server error
 */
export function errorEvent(fields: {
  source: string
  errorType: string
  message: string
  stack?: string
  sessionId?: string
  requestId?: string
  pathname?: string
}): BaseEvent {
  return event('Error.caught', fields)
}

/**
 * Worker.invoked - Workers tail log
 */
export function workerInvokedEvent(fields: {
  source: string
  requestId: string
  method: string
  pathname: string
  statusCode: number
  durationMs: number
  colo?: string
  rayId?: string
}): BaseEvent {
  return event('Worker.invoked', fields)
}

/**
 * Browser.connected - Browser DO lifecycle
 */
export function browserConnectedEvent(fields: {
  source: string
  browserId: string
  sessionId?: string
}): BaseEvent {
  return event('Browser.connected', fields)
}

/**
 * Browser.disconnected - Browser DO lifecycle
 */
export function browserDisconnectedEvent(fields: {
  source: string
  browserId: string
  sessionId?: string
  durationMs?: number
}): BaseEvent {
  return event('Browser.disconnected', fields)
}

// ============================================================================
// Segment-style Analytics Events
// ============================================================================

/**
 * User.identified - Segment identify() equivalent
 */
export function identifyEvent(fields: {
  source: string
  userId: string
  anonymousId?: string
  traits?: string // JSON stringified for flat storage
}): BaseEvent {
  return event('User.identified', fields)
}

/**
 * Action.tracked - Segment track() equivalent
 */
export function trackEvent(fields: {
  source: string
  eventName: string
  userId?: string
  anonymousId?: string
  properties?: string // JSON stringified for flat storage
}): BaseEvent {
  return event('Action.tracked', { ...fields, actionName: fields.eventName })
}

/**
 * Group.joined - Segment group() equivalent
 */
export function groupEvent(fields: {
  source: string
  userId: string
  groupId: string
  traits?: string // JSON stringified for flat storage
}): BaseEvent {
  return event('Group.joined', fields)
}
