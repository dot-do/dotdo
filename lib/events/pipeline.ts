/**
 * Unified Events Pipeline
 *
 * Sends all events to a pipeline - either via EVENTS binding or HTTP fallback.
 *
 * Usage:
 * ```typescript
 * import { sendEvents, createEventSink } from 'lib/events/pipeline'
 *
 * // Direct send (auto-detects binding or uses HTTP)
 * await sendEvents([{ type: 'routing', ... }])
 *
 * // Or create a sink for middleware
 * const sink = createEventSink(env)
 * await sink.send([event1, event2])
 * ```
 *
 * Priority:
 * 1. env.EVENTS binding (Pipeline) - direct pipeline access
 * 2. HTTP POST to workers.do/events - multi-tenant fallback
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Base event structure - all events must have type and timestamp
 */
export interface BaseEvent {
  type: string
  timestamp?: number
  [key: string]: unknown
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
const EVENTS_ENDPOINT = 'https://workers.do/events'

/**
 * Request timeout for HTTP fallback (ms)
 */
const HTTP_TIMEOUT = 5000

/**
 * Max batch size for events
 */
const MAX_BATCH_SIZE = 1000

// ============================================================================
// Pipeline Sink (Direct binding)
// ============================================================================

/**
 * Event sink using direct Pipeline binding
 */
class PipelineEventSink implements EventSink {
  constructor(private pipeline: Pipeline) {}

  async send(events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return

    // Add timestamps if missing
    const timestampedEvents = events.map((e) => ({
      ...e,
      timestamp: e.timestamp ?? Date.now(),
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
class HttpEventSink implements EventSink {
  constructor(
    private endpoint: string = EVENTS_ENDPOINT,
    private timeout: number = HTTP_TIMEOUT
  ) {}

  async send(events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return

    // Add timestamps if missing
    const timestampedEvents = events.map((e) => ({
      ...e,
      timestamp: e.timestamp ?? Date.now(),
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
  // Check for EVENTS binding
  if (env?.EVENTS) {
    return new PipelineEventSink(env.EVENTS)
  }

  // Fallback to HTTP
  return new HttpEventSink()
}

/**
 * Check if direct pipeline binding is available
 */
export function hasEventsBinding(env?: EventsEnv): boolean {
  return env?.EVENTS !== undefined
}

// ============================================================================
// Convenience Functions
// ============================================================================

// Global sink instance (lazy initialized)
let globalSink: EventSink | null = null

/**
 * Get or create the global event sink
 *
 * For use when env is not readily available (e.g., utility functions).
 * Falls back to HTTP endpoint.
 */
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
 *
 * @param env - Environment with optional EVENTS binding
 */
export function initEventSink(env: EventsEnv): void {
  globalSink = createEventSink(env)
}

/**
 * Send events to the pipeline
 *
 * Uses the global sink (HTTP fallback if not initialized with binding).
 * For best performance, call initEventSink(env) early in request handling.
 *
 * @param events - Events to send
 */
export async function sendEvents(events: BaseEvent[]): Promise<void> {
  const sink = getGlobalSink()
  await sink.send(events)
}

/**
 * Send a single event to the pipeline
 *
 * @param event - Event to send
 */
export async function sendEvent(event: BaseEvent): Promise<void> {
  await sendEvents([event])
}

// ============================================================================
// Event Type Helpers
// ============================================================================

/**
 * Create a routing event
 */
export function routingEvent(data: {
  requestId: string
  pathname: string
  method: string
  targetBinding: string
  isReplica: boolean
  consistencyMode: string
  durationMs: number
  colo?: string
  region?: string
  replicaRegion?: string
}): BaseEvent {
  return {
    type: 'routing',
    timestamp: Date.now(),
    ...data,
  }
}

/**
 * Create a usage event
 */
export function usageEvent(data: {
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
  return {
    type: 'usage',
    timestamp: Date.now(),
    ...data,
  }
}

/**
 * Create an RPC metering event
 */
export function rpcEvent(data: {
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
  return {
    type: 'rpc',
    timestamp: Date.now(),
    ...data,
  }
}

/**
 * Create a generic event
 */
export function genericEvent(type: string, data: Record<string, unknown>): BaseEvent {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  PipelineEventSink,
  HttpEventSink,
  EVENTS_ENDPOINT,
  MAX_BATCH_SIZE,
}
