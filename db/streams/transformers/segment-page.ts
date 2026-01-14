/**
 * Segment Page Event Transformer
 *
 * Transforms Segment-style page events to the unified event schema.
 * Page events track page views with URL, title, and context information.
 *
 * Note: The unified event schema uses:
 * - page_title, page_search for page-specific fields
 * - http_url, http_path, http_referrer, http_query for URL fields
 *
 * @module db/streams/transformers/segment-page
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'
import { extractSegmentContext, type SegmentContext } from './shared/segment-context'

/**
 * Segment page event properties
 */
export interface SegmentPageProperties {
  url?: string
  path?: string
  referrer?: string
  title?: string
  search?: string
  [key: string]: unknown
}

/**
 * Segment page event structure
 */
export interface SegmentPageEvent {
  /** Page name (e.g., 'Getting Started') */
  name?: string
  /** Page category (e.g., 'Docs') */
  category?: string
  /** Page-specific properties */
  properties?: SegmentPageProperties
  /** Authenticated user ID */
  userId?: string
  /** Anonymous/device ID */
  anonymousId?: string
  /** Segment context object */
  context?: SegmentContext
  /** Event timestamp */
  timestamp?: string | Date
}

/**
 * Transform a Segment page event to unified event schema
 *
 * Mapping rules:
 * - name -> page_title (primary)
 * - properties.title -> page_title (fallback)
 * - category -> event_name prefix (e.g., 'Docs.page_view')
 * - properties.url -> http_url
 * - properties.path -> http_path
 * - properties.referrer -> http_referrer
 * - properties.search -> page_search, http_query
 * - context.* -> various unified fields via extractSegmentContext
 *
 * @param page - Segment page event
 * @param ns - Namespace for the event
 * @returns Unified event with page fields populated
 *
 * @example
 * ```typescript
 * const unified = transformSegmentPage({
 *   name: 'Getting Started',
 *   category: 'Docs',
 *   properties: {
 *     url: 'https://docs.example.com/start',
 *     path: '/start',
 *   },
 *   userId: 'user-123',
 * }, 'docs-site')
 *
 * // Result:
 * // {
 * //   event_type: 'page',
 * //   event_name: 'Docs.page_view',
 * //   page_title: 'Getting Started',
 * //   http_url: 'https://docs.example.com/start',
 * //   ...
 * // }
 * ```
 */
export function transformSegmentPage(
  page: SegmentPageEvent,
  ns: string
): UnifiedEvent {
  // Extract context fields
  const ctx = extractSegmentContext(page.context)

  // Determine event name based on category
  const eventName = page.category
    ? `${page.category}.page_view`
    : 'page_view'

  // Determine page title (name takes priority over properties.title)
  const pageTitle = page.name ?? page.properties?.title ?? null

  // Properties take priority over context for URL fields
  const httpUrl = page.properties?.url ?? ctx.http_url ?? null
  const httpPath = page.properties?.path ?? ctx.http_path ?? null
  const httpReferrer = page.properties?.referrer ?? ctx.http_referrer ?? null
  const pageSearch = page.properties?.search ?? null

  // Format timestamp
  const timestamp = formatTimestamp(page.timestamp)

  return createUnifiedEvent({
    // Core Identity
    id: crypto.randomUUID(),
    event_type: 'page',
    event_name: eventName,
    ns,

    // Actor
    actor_id: page.userId ?? null,
    anonymous_id: page.anonymousId ?? null,

    // Page fields (only page_title and page_search exist in schema)
    page_title: pageTitle,
    page_search: pageSearch,

    // HTTP fields (url, path, referrer, query)
    http_url: httpUrl,
    http_path: httpPath,
    http_referrer: httpReferrer,
    http_query: pageSearch,
    http_user_agent: ctx.http_user_agent,

    // Campaign/UTM (from context)
    campaign_name: ctx.campaign_name,
    campaign_source: ctx.campaign_source,
    campaign_medium: ctx.campaign_medium,
    campaign_term: ctx.campaign_term,
    campaign_content: ctx.campaign_content,

    // Device (from context)
    device_type: ctx.device_type,
    device_model: ctx.device_model,
    device_brand: ctx.device_brand,

    // OS (from context)
    os_name: ctx.os_name,
    os_version: ctx.os_version,

    // Geo (from context)
    geo_country: ctx.geo_country,
    geo_region: ctx.geo_region,
    geo_city: ctx.geo_city,
    geo_latitude: ctx.geo_latitude,
    geo_longitude: ctx.geo_longitude,
    geo_timezone: ctx.geo_timezone,

    // Client (from context library)
    client_name: ctx.client_name,
    client_version: ctx.client_version,
    client_type: ctx.client_type,

    // Timestamp
    timestamp,

    // Preserve original properties
    properties: page.properties ?? null,

    // Preserve traits from context
    traits: ctx.traits,
  })
}

/**
 * Format timestamp to ISO string
 *
 * @param timestamp - String, Date, or undefined
 * @returns ISO 8601 timestamp string
 */
function formatTimestamp(timestamp?: string | Date): string {
  if (!timestamp) {
    return new Date().toISOString()
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }

  return timestamp
}
