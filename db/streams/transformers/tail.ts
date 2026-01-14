/**
 * Workers Tail Event Transformer
 *
 * Transforms Cloudflare Workers tail log events into the unified event schema.
 * Handles fetch, scheduled, queue, and alarm event types.
 */

import type { UnifiedEvent } from '../../../types/unified-event'
import { createUnifiedEvent } from '../../../types/unified-event'
import { mapTailOutcome, type TailOutcome } from './shared/outcome'
import { extractGeoFromCf, type CfGeoProperties } from './shared/geo'
import { parseUrl } from './shared/http'

/**
 * Cloudflare Workers tail event structure.
 * This is the raw format from the Workers runtime tail logs.
 */
export interface TailEvent {
  scriptName: string
  scriptVersion?: string
  outcome: TailOutcome
  exceptions?: Array<{ name: string; message: string; timestamp: number }>
  logs?: Array<{ level: string; message: unknown[]; timestamp: number }>
  eventTimestamp: number
  event?: {
    type?: string
    request?: {
      url: string
      method: string
      headers?: Record<string, string>
      cf?: CfGeoProperties & {
        httpProtocol?: string
      }
    }
    response?: { status?: number }
    cron?: string
    scheduledTime?: number
    queue?: {
      queueName: string
      batchSize: number
    }
  }
  diagnosticsChannelEvents?: unknown[]
}

/**
 * Derives the event name from the tail event type.
 *
 * @param eventType - The type from tail.event.type
 * @returns A namespaced event name (e.g., 'workers.fetch')
 */
function deriveEventName(eventType: string | undefined): string {
  if (!eventType) return 'workers.invocation'
  return `workers.${eventType}`
}

/**
 * Generates a unique ID for the event.
 * Uses timestamp + random suffix for uniqueness.
 */
function generateId(timestamp: number): string {
  const random = Math.random().toString(36).substring(2, 10)
  return `tail_${timestamp}_${random}`
}

/**
 * Transforms a Cloudflare Workers tail event into a UnifiedEvent.
 *
 * Mapping summary:
 * - scriptName → service_name, ns
 * - scriptVersion → service_version
 * - outcome → outcome (with mapping via shared/outcome)
 * - exceptions → error_type, error_message, data.exceptions
 * - logs → data.logs
 * - eventTimestamp → timestamp, day, hour
 * - event.type → event_name
 * - event.request → http_* fields
 * - event.request.cf → geo_* fields (via shared/geo)
 * - event.response → http_status, status_code
 * - event.queue → msg_* fields
 * - event.cron/scheduledTime → data.cron, data.scheduledTime
 *
 * @param tail - The raw tail event from Workers runtime
 * @returns A UnifiedEvent with all mappings applied
 */
export function transformTailEvent(tail: TailEvent): UnifiedEvent {
  const timestamp = new Date(tail.eventTimestamp)
  const timestampIso = timestamp.toISOString()
  const day = timestampIso.slice(0, 10) // YYYY-MM-DD
  const hour = timestamp.getUTCHours()

  // Extract HTTP context if present
  const request = tail.event?.request
  const response = tail.event?.response
  const cf = request?.cf
  const urlParts = parseUrl(request?.url)

  // Extract geo fields using shared utility
  const geoFields = extractGeoFromCf(cf)

  // Extract first exception for error fields
  const firstException = tail.exceptions?.[0]

  // Build data payload
  const data: Record<string, unknown> = {}

  // Include logs if present
  if (tail.logs && tail.logs.length > 0) {
    data.logs = tail.logs
  }

  // Include all exceptions if present
  if (tail.exceptions && tail.exceptions.length > 0) {
    data.exceptions = tail.exceptions
  }

  // Include scheduled event data
  if (tail.event?.cron) {
    data.cron = tail.event.cron
  }
  if (tail.event?.scheduledTime) {
    data.scheduledTime = tail.event.scheduledTime
  }

  // Queue event handling
  const isQueueEvent = tail.event?.type === 'queue'
  const queue = tail.event?.queue

  return createUnifiedEvent({
    // CoreIdentity
    id: generateId(tail.eventTimestamp),
    event_type: 'tail',
    event_name: deriveEventName(tail.event?.type),
    ns: `workers://${tail.scriptName}`,

    // Timing
    timestamp: timestampIso,
    day,
    hour,

    // Outcome (using shared utility)
    outcome: mapTailOutcome(tail.outcome),
    status_code: response?.status ?? null,

    // Error fields (from first exception)
    error_type: firstException?.name ?? null,
    error_message: firstException?.message ?? null,

    // ServiceInfra
    service_name: tail.scriptName,
    service_version: tail.scriptVersion ?? null,
    cloud_provider: 'cloudflare',

    // HttpContext
    http_method: request?.method ?? null,
    http_url: request?.url ?? null,
    http_host: urlParts.host,
    http_path: urlParts.path,
    http_query: urlParts.query,
    http_status: response?.status ?? null,
    http_protocol: cf?.httpProtocol ?? null,

    // GeoLocation (from shared utility)
    ...geoFields,

    // MessagingQueue (for queue events)
    msg_system: isQueueEvent ? 'cloudflare_queues' : null,
    msg_destination: queue?.queueName ?? null,
    msg_batch_size: queue?.batchSize ?? null,

    // PartitionInternal
    event_source: 'workers_tail',
    schema_version: 1,

    // FlexiblePayloads
    data: Object.keys(data).length > 0 ? data : null,
  })
}
