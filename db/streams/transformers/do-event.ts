/**
 * DO Event Transformer
 *
 * Transforms DO Event records to the UnifiedEvent schema (162 columns).
 * Maps legacy DO event fields to semantic groups in the unified schema.
 *
 * Mapping:
 * - id (input) -> span_id (causality chain)
 * - verb -> event_name, action_verb
 * - source -> resource_id (qualified with ns/)
 * - sourceType -> resource_type
 * - data -> data (flexible payloads)
 * - actionId -> trace_id
 * - timestamp/createdAt -> timestamp
 * - ns -> ns
 * - actor -> actor_id
 * - actorType -> actor_type
 * - bizStep -> biz_step
 * - disposition -> biz_disposition
 * - bizTransaction -> biz_transaction
 * - bizLocation -> biz_location
 * - readPoint -> biz_read_point
 *
 * @module db/streams/transformers/do-event
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'

/**
 * Input type for DO events to be transformed.
 * Based on the DO Event interface with optional EPCIS extensions.
 */
export interface DoEventInput {
  /** Event ID (becomes span_id) */
  id: string
  /** Action verb (becomes event_name and action_verb) */
  verb: string
  /** Source entity reference (e.g., 'Customer/cust-1') */
  source: string
  /** Source entity type (e.g., 'Customer') */
  sourceType?: string
  /** Event payload data */
  data: Record<string, unknown> | null
  /** Related action ID (becomes trace_id) */
  actionId?: string
  /** Event sequence number */
  sequence?: number
  /** Whether event has been streamed */
  streamed?: boolean
  /** When event was streamed */
  streamedAt?: Date
  /** Event timestamp (when event occurred) */
  timestamp?: Date | string
  /** When event was created in DO */
  createdAt: Date

  // Actor fields (optional)
  /** Actor who triggered the event */
  actor?: string
  /** Actor type (user, agent, system, webhook) */
  actorType?: string

  // EPCIS extension fields (optional)
  /** Business step (EPCIS bizStep) */
  bizStep?: string
  /** Disposition status (EPCIS disposition) */
  disposition?: string
  /** Business transaction reference */
  bizTransaction?: string
  /** Business location */
  bizLocation?: string
  /** Read point where event was captured */
  readPoint?: string
}

/**
 * Normalizes a namespace URL by removing trailing slashes.
 */
function normalizeNs(ns: string): string {
  return ns.endsWith('/') ? ns.slice(0, -1) : ns
}

/**
 * Converts a Date or string timestamp to ISO string format.
 */
function toISOString(timestamp: Date | string): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }
  return new Date(timestamp).toISOString()
}

/**
 * Generates a UUID v4.
 * Uses crypto.randomUUID when available, falls back to manual generation.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Transforms a DO Event to the UnifiedEvent schema.
 *
 * @param event - The DO event to transform
 * @param ns - The namespace URL (e.g., 'https://startups.studio')
 * @returns A UnifiedEvent with all 162 columns populated
 *
 * @example
 * ```typescript
 * const doEvent = {
 *   id: 'evt-123',
 *   verb: 'signup',
 *   source: 'Customer/cust-1',
 *   sourceType: 'Customer',
 *   data: { email: 'alice@example.com' },
 *   actionId: 'action-456',
 *   createdAt: new Date(),
 * }
 *
 * const unified = transformDoEvent(doEvent, 'https://app.example.com')
 * // unified.event_type === 'track'
 * // unified.event_name === 'signup'
 * // unified.resource_id === 'https://app.example.com/Customer/cust-1'
 * ```
 */
export function transformDoEvent(event: DoEventInput, ns: string): UnifiedEvent {
  const normalizedNs = normalizeNs(ns)

  // Determine timestamp: use event.timestamp if present, otherwise createdAt
  const timestamp = event.timestamp
    ? toISOString(event.timestamp)
    : toISOString(event.createdAt)

  // Build the resource_id by qualifying source with namespace
  const resourceId = event.source
    ? `${normalizedNs}/${event.source}`
    : null

  return createUnifiedEvent({
    // CoreIdentity (required fields)
    id: generateUUID(),
    event_type: 'track', // DO events are business/domain events
    event_name: event.verb,
    ns: normalizedNs,

    // CausalityChain
    span_id: event.id,
    trace_id: event.actionId ?? null,

    // Resource
    resource_type: event.sourceType ?? null,
    resource_id: resourceId,

    // Actor
    actor_id: event.actor ?? null,
    actor_type: event.actorType ?? null,

    // Timing
    timestamp,

    // DoSpecific
    action_verb: event.verb,

    // FlexiblePayloads
    data: event.data ?? null,

    // BusinessEpcis
    biz_step: event.bizStep ?? null,
    biz_disposition: event.disposition ?? null,
    biz_transaction: event.bizTransaction ?? null,
    biz_location: event.bizLocation ?? null,
    biz_read_point: event.readPoint ?? null,
  })
}

/**
 * Batch transforms multiple DO events to UnifiedEvents.
 *
 * @param events - Array of DO events to transform
 * @param ns - The namespace URL
 * @returns Array of UnifiedEvents
 */
export function transformDoEvents(events: DoEventInput[], ns: string): UnifiedEvent[] {
  return events.map((event) => transformDoEvent(event, ns))
}
