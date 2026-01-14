/**
 * Segment Track Event Transformer
 *
 * Transforms Segment-style track events into the UnifiedEvent schema.
 *
 * Segment track events are user action events with:
 * - event: The event name
 * - userId/anonymousId: User identification
 * - properties: Event-specific data
 * - context: Enrichment data (page, device, os, campaign, userAgent)
 * - timestamp: When the event occurred
 *
 * @module db/streams/transformers/segment-track
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'
import {
  type SegmentContext,
  mapSegmentContext,
  normalizeTimestamp,
  generateEventId,
} from './segment-context'

// Re-export context types for convenience
export type {
  SegmentContext,
  SegmentPageContext,
  SegmentCampaignContext,
  SegmentDeviceContext,
  SegmentOsContext,
} from './segment-context'

// ============================================================================
// Segment Track Event Types
// ============================================================================

/**
 * Segment track event structure
 *
 * This represents the incoming track event from Segment's API.
 */
export interface SegmentTrackEvent {
  /** Event name (e.g., 'Product Viewed', 'Order Completed') */
  event: string
  /** Authenticated user identifier */
  userId?: string
  /** Anonymous/device identifier */
  anonymousId?: string
  /** Event-specific properties */
  properties?: Record<string, unknown>
  /** Enrichment context */
  context?: SegmentContext
  /** Event timestamp (ISO string or Date) */
  timestamp?: string | Date
}

// ============================================================================
// Main Transformer
// ============================================================================

/**
 * Transforms a Segment track event into a UnifiedEvent.
 *
 * @param track - The Segment track event to transform
 * @param ns - The namespace URL for the event source
 * @returns A complete UnifiedEvent with all fields populated
 *
 * @example
 * ```typescript
 * const track = {
 *   event: 'Product Viewed',
 *   userId: 'user-123',
 *   properties: { product_id: 'prod-456', price: 99.99 },
 *   context: {
 *     page: { url: 'https://shop.example.com/products/456' },
 *     campaign: { source: 'google', medium: 'cpc' },
 *   },
 *   timestamp: '2024-01-15T14:30:00.000Z',
 * }
 *
 * const unified = transformSegmentTrack(track, 'https://shop.example.com')
 * // unified.event_type === 'track'
 * // unified.event_name === 'Product Viewed'
 * // unified.actor_id === 'user-123'
 * ```
 */
export function transformSegmentTrack(track: SegmentTrackEvent, ns: string): UnifiedEvent {
  return createUnifiedEvent({
    // CoreIdentity
    id: generateEventId(),
    event_type: 'track',
    event_name: track.event,
    ns,

    // Actor
    actor_id: track.userId ?? null,
    anonymous_id: track.anonymousId ?? null,

    // Timing
    timestamp: normalizeTimestamp(track.timestamp),

    // FlexiblePayloads
    properties: track.properties ?? null,

    // Context mappings (page, campaign, device, os, userAgent)
    ...mapSegmentContext(track.context),

    // PartitionInternal
    event_source: 'segment',
  })
}
