/**
 * Segment Identify Transformer
 *
 * Transforms Segment-style identify events to the unified event schema.
 * Identify events link anonymous_id to actor_id for identity resolution.
 *
 * @see https://segment.com/docs/connections/spec/identify/
 */

import type { UnifiedEvent } from '../../../types/unified-event'
import { createUnifiedEvent } from '../../../types/unified-event'
import { extractSegmentContext, type SegmentContext } from './shared/segment-context'

/**
 * Segment identify event structure
 * @see https://segment.com/docs/connections/spec/identify/
 */
export interface SegmentIdentifyEvent {
  /** Authenticated user identifier */
  userId?: string
  /** Anonymous/device identifier */
  anonymousId?: string
  /** User traits (profile data) */
  traits?: {
    name?: string
    email?: string
    [key: string]: unknown
  }
  /** Event context (device, campaign, etc.) */
  context?: SegmentContext
  /** Event timestamp */
  timestamp?: string | Date
  /** Message ID (optional, for deduplication) */
  messageId?: string
}

/**
 * Transform a Segment identify event to a unified event.
 *
 * Identity events are tracked as 'track' events with event_name 'identify'.
 * This allows them to be queried alongside other user actions while
 * also serving as identity resolution events that link anonymous_id to actor_id.
 *
 * @param identify - Segment identify event
 * @param ns - Namespace URL for the event source
 * @returns Unified event
 *
 * @example
 * ```typescript
 * const unified = transformSegmentIdentify({
 *   userId: 'user_123',
 *   anonymousId: 'anon_456',
 *   traits: {
 *     name: 'Alice Smith',
 *     email: 'alice@example.com',
 *     plan: 'pro',
 *   },
 *   context: {
 *     userAgent: 'Mozilla/5.0...',
 *     page: { url: 'https://example.com/settings' },
 *   },
 * }, 'https://api.example.com')
 * ```
 */
export function transformSegmentIdentify(
  identify: SegmentIdentifyEvent,
  ns: string
): UnifiedEvent {
  // Extract context fields
  const ctx = extractSegmentContext(identify.context)

  // Handle timestamp
  let timestamp: string
  if (identify.timestamp) {
    timestamp =
      identify.timestamp instanceof Date
        ? identify.timestamp.toISOString()
        : identify.timestamp
  } else {
    timestamp = new Date().toISOString()
  }

  return createUnifiedEvent({
    // Core identity
    id: crypto.randomUUID(),
    event_type: 'track', // Identify is tracked as an event
    event_name: 'identify',
    ns,

    // Actor fields - identity resolution
    actor_id: identify.userId ?? null,
    actor_name: identify.traits?.name ?? null,
    anonymous_id: identify.anonymousId ?? null,

    // Timing
    timestamp,

    // HTTP Context
    http_url: ctx.http_url,
    http_path: ctx.http_path,
    http_referrer: ctx.http_referrer,
    http_user_agent: ctx.http_user_agent,

    // Page/Marketing
    page_title: ctx.page_title,
    page_search: ctx.page_search,

    // Campaign/UTM
    campaign_name: ctx.campaign_name,
    campaign_source: ctx.campaign_source,
    campaign_medium: ctx.campaign_medium,
    campaign_term: ctx.campaign_term,
    campaign_content: ctx.campaign_content,

    // Client/Device
    client_type: ctx.client_type,
    client_name: ctx.client_name,
    client_version: ctx.client_version,
    device_type: ctx.device_type,
    device_model: ctx.device_model,
    device_brand: ctx.device_brand,
    os_name: ctx.os_name,
    os_version: ctx.os_version,
    screen_size: ctx.screen_size,

    // Geo
    geo_country: ctx.geo_country,
    geo_region: ctx.geo_region,
    geo_city: ctx.geo_city,
    geo_latitude: ctx.geo_latitude,
    geo_longitude: ctx.geo_longitude,
    geo_timezone: ctx.geo_timezone,

    // Flexible payloads
    traits: identify.traits ?? null,
    context: ctx.context,

    // Partition/Internal
    event_source: 'segment',
  })
}
