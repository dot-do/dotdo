/**
 * Segment Context Mapping Utilities
 *
 * Shared utilities for mapping Segment context objects to UnifiedEvent fields.
 * These are used by all Segment event transformers (track, page, identify).
 *
 * Segment context contains enrichment data including:
 * - page: URL, path, referrer, title, search
 * - campaign: UTM parameters (source, medium, name, term, content)
 * - device: Type, model, brand
 * - os: Name, version
 * - userAgent: Browser user agent string
 *
 * @module db/streams/transformers/segment-context
 */

import type { UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// Segment Context Types
// ============================================================================

/**
 * Page context information from Segment events
 */
export interface SegmentPageContext {
  /** Full page URL */
  url?: string
  /** URL path without query string */
  path?: string
  /** Referrer URL */
  referrer?: string
  /** Page title */
  title?: string
  /** Query string (including ?) */
  search?: string
}

/**
 * Campaign/UTM context information from Segment events
 */
export interface SegmentCampaignContext {
  /** UTM campaign name */
  name?: string
  /** UTM source */
  source?: string
  /** UTM medium */
  medium?: string
  /** UTM term */
  term?: string
  /** UTM content */
  content?: string
}

/**
 * Device context information from Segment events
 */
export interface SegmentDeviceContext {
  /** Device type (mobile, tablet, desktop) */
  type?: string
  /** Device model name */
  model?: string
  /** Device brand/manufacturer */
  brand?: string
  /** Device identifier */
  id?: string
}

/**
 * OS context information from Segment events
 */
export interface SegmentOsContext {
  /** Operating system name */
  name?: string
  /** Operating system version */
  version?: string
}

/**
 * Full context object for Segment events.
 *
 * This interface represents the `context` field present in all Segment events
 * (track, page, identify, group, etc.).
 */
export interface SegmentContext {
  /** Page/screen context */
  page?: SegmentPageContext
  /** Campaign/UTM parameters */
  campaign?: SegmentCampaignContext
  /** Device information */
  device?: SegmentDeviceContext
  /** Operating system information */
  os?: SegmentOsContext
  /** Browser user agent string */
  userAgent?: string
  /** Client IP address */
  ip?: string
  /** User locale (e.g., 'en-US') */
  locale?: string
  /** User timezone (e.g., 'America/New_York') */
  timezone?: string
}

// ============================================================================
// Context Mapping Functions
// ============================================================================

/**
 * Maps Segment page context to UnifiedEvent fields.
 *
 * @param page - Segment page context object
 * @returns Partial UnifiedEvent with page-related fields
 *
 * @example
 * ```typescript
 * const pageFields = mapPageContext({
 *   url: 'https://example.com/products',
 *   path: '/products',
 *   title: 'Products',
 * })
 * // { http_url: 'https://example.com/products', http_path: '/products', page_title: 'Products', ... }
 * ```
 */
export function mapPageContext(page?: SegmentPageContext): Partial<UnifiedEvent> {
  if (!page) {
    return {
      http_url: null,
      http_path: null,
      http_referrer: null,
      page_title: null,
      page_search: null,
    }
  }

  return {
    http_url: page.url ?? null,
    http_path: page.path ?? null,
    http_referrer: page.referrer ?? null,
    page_title: page.title ?? null,
    page_search: page.search ?? null,
  }
}

/**
 * Maps Segment campaign context to UnifiedEvent fields.
 *
 * @param campaign - Segment campaign context object
 * @returns Partial UnifiedEvent with campaign-related fields
 *
 * @example
 * ```typescript
 * const campaignFields = mapCampaignContext({
 *   source: 'google',
 *   medium: 'cpc',
 *   name: 'Summer Sale',
 * })
 * // { campaign_source: 'google', campaign_medium: 'cpc', campaign_name: 'Summer Sale', ... }
 * ```
 */
export function mapCampaignContext(campaign?: SegmentCampaignContext): Partial<UnifiedEvent> {
  if (!campaign) {
    return {
      campaign_name: null,
      campaign_source: null,
      campaign_medium: null,
      campaign_term: null,
      campaign_content: null,
    }
  }

  return {
    campaign_name: campaign.name ?? null,
    campaign_source: campaign.source ?? null,
    campaign_medium: campaign.medium ?? null,
    campaign_term: campaign.term ?? null,
    campaign_content: campaign.content ?? null,
  }
}

/**
 * Maps Segment device context to UnifiedEvent fields.
 *
 * @param device - Segment device context object
 * @returns Partial UnifiedEvent with device-related fields
 *
 * @example
 * ```typescript
 * const deviceFields = mapDeviceContext({
 *   type: 'mobile',
 *   model: 'iPhone 15',
 *   brand: 'Apple',
 * })
 * // { device_type: 'mobile', device_model: 'iPhone 15', device_brand: 'Apple' }
 * ```
 */
export function mapDeviceContext(device?: SegmentDeviceContext): Partial<UnifiedEvent> {
  if (!device) {
    return {
      device_type: null,
      device_model: null,
      device_brand: null,
    }
  }

  return {
    device_type: device.type ?? null,
    device_model: device.model ?? null,
    device_brand: device.brand ?? null,
  }
}

/**
 * Maps Segment OS context to UnifiedEvent fields.
 *
 * @param os - Segment OS context object
 * @returns Partial UnifiedEvent with OS-related fields
 *
 * @example
 * ```typescript
 * const osFields = mapOsContext({
 *   name: 'iOS',
 *   version: '17.2',
 * })
 * // { os_name: 'iOS', os_version: '17.2' }
 * ```
 */
export function mapOsContext(os?: SegmentOsContext): Partial<UnifiedEvent> {
  if (!os) {
    return {
      os_name: null,
      os_version: null,
    }
  }

  return {
    os_name: os.name ?? null,
    os_version: os.version ?? null,
  }
}

/**
 * Maps all Segment context fields to UnifiedEvent fields.
 *
 * This is a convenience function that combines all context mapping functions
 * into a single call for use by transformers.
 *
 * @param context - Full Segment context object
 * @returns Partial UnifiedEvent with all context-related fields
 *
 * @example
 * ```typescript
 * const contextFields = mapSegmentContext({
 *   page: { url: 'https://example.com', path: '/' },
 *   campaign: { source: 'google' },
 *   device: { type: 'desktop' },
 *   os: { name: 'macOS' },
 *   userAgent: 'Mozilla/5.0...',
 * })
 * ```
 */
export function mapSegmentContext(context?: SegmentContext): Partial<UnifiedEvent> {
  if (!context) {
    return {
      ...mapPageContext(undefined),
      ...mapCampaignContext(undefined),
      ...mapDeviceContext(undefined),
      ...mapOsContext(undefined),
      http_user_agent: null,
    }
  }

  return {
    ...mapPageContext(context.page),
    ...mapCampaignContext(context.campaign),
    ...mapDeviceContext(context.device),
    ...mapOsContext(context.os),
    http_user_agent: context.userAgent ?? null,
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalizes timestamp to ISO string format.
 *
 * Accepts either an ISO string or a Date object and returns an ISO string.
 *
 * @param timestamp - Timestamp as string or Date
 * @returns ISO string timestamp or null if not provided
 *
 * @example
 * ```typescript
 * normalizeTimestamp('2024-01-15T14:30:00.000Z') // '2024-01-15T14:30:00.000Z'
 * normalizeTimestamp(new Date('2024-01-15')) // '2024-01-15T00:00:00.000Z'
 * normalizeTimestamp(undefined) // null
 * ```
 */
export function normalizeTimestamp(timestamp?: string | Date): string | null {
  if (!timestamp) {
    return null
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }

  return timestamp
}

/**
 * Generates a unique event ID.
 *
 * Uses crypto.randomUUID if available, otherwise falls back to
 * a timestamp-based ID.
 *
 * @returns Unique event ID string
 */
export function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}
