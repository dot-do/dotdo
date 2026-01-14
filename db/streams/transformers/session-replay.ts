/**
 * Session Replay Transformer
 *
 * Transforms rrweb-style session replay events to the unified event schema.
 *
 * rrweb event types:
 * - 0: DomContentLoaded
 * - 1: Load
 * - 2: FullSnapshot
 * - 3: IncrementalSnapshot
 * - 4: Meta
 * - 5: Custom
 *
 * IncrementalSnapshot sources:
 * - 0: Mutation, 1: MouseMove, 2: MouseInteraction, 3: Scroll
 * - 4: ViewportResize, 5: Input, 6: TouchMove, 7: MediaInteraction
 * - 8: StyleSheetRule, 9: CanvasMutation, 10: Font, 11: Log, 12: Drag
 *
 * @module db/streams/transformers/session-replay
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

/**
 * rrweb event type names indexed by their numeric type value.
 */
export const EVENT_TYPES = [
  'DomContentLoaded',
  'Load',
  'FullSnapshot',
  'IncrementalSnapshot',
  'Meta',
  'Custom',
] as const

/**
 * IncrementalSnapshot source names indexed by their numeric source value.
 */
export const SOURCES = [
  'Mutation',
  'MouseMove',
  'MouseInteraction',
  'Scroll',
  'ViewportResize',
  'Input',
  'TouchMove',
  'MediaInteraction',
  'StyleSheetRule',
  'CanvasMutation',
  'Font',
  'Log',
  'Drag',
] as const

/**
 * Raw rrweb event structure.
 */
export interface RrwebEvent {
  /** Event type number (0-5) */
  type: number
  /** Event payload data */
  data: unknown
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Source number for IncrementalSnapshot events (type=3) */
  source?: number
}

/**
 * Context required for transforming session replay events.
 */
export interface SessionReplayContext {
  /** User session identifier */
  sessionId: string
  /** Current page URL */
  pageUrl: string
  /** Namespace/tenant identifier */
  ns: string
  /** Sequence number within the session */
  sequence: number
}

/**
 * Transforms an rrweb session replay event to a UnifiedEvent.
 *
 * Mapping:
 * - type -> replay_type (DomContentLoaded, Load, FullSnapshot, IncrementalSnapshot, Meta, Custom)
 * - source (for type=3) -> replay_source (Mutation, MouseMove, etc.)
 * - data -> replay_data (JSON string)
 * - timestamp -> timestamp (ISO string)
 * - context.sequence -> replay_sequence
 * - context.sessionId -> session_id, trace_id
 * - context.pageUrl -> http_url
 * - context.ns -> ns
 * - event_type = 'replay'
 * - event_name = typeName or typeName.sourceName for IncrementalSnapshot
 *
 * @param event - The rrweb event to transform
 * @param context - Session context containing sessionId, pageUrl, ns, and sequence
 * @returns UnifiedEvent with replay-specific fields populated
 */
export function transformSessionReplay(
  event: RrwebEvent,
  context: SessionReplayContext
): UnifiedEvent {
  const typeName = EVENT_TYPES[event.type] ?? `Unknown(${event.type})`
  const isIncrementalSnapshot = event.type === 3
  const sourceName = isIncrementalSnapshot && event.source !== undefined
    ? SOURCES[event.source] ?? `Unknown(${event.source})`
    : null

  const eventName = sourceName ? `${typeName}.${sourceName}` : typeName

  return createUnifiedEvent({
    id: crypto.randomUUID(),
    event_type: 'replay',
    event_name: eventName,
    ns: context.ns,

    // CausalityChain - session is the trace for replay
    session_id: context.sessionId,
    trace_id: context.sessionId,

    // SessionReplay fields
    replay_type: typeName,
    replay_source: sourceName,
    replay_sequence: context.sequence,
    replay_data: JSON.stringify(event.data),

    // HttpContext - page URL
    http_url: context.pageUrl,

    // Timing
    timestamp: new Date(event.timestamp).toISOString(),
  })
}
