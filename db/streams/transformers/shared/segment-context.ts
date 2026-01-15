/**
 * Shared Segment Context Extraction
 *
 * Extracts and normalizes context fields from Segment events
 * into the unified event schema format.
 */

/**
 * Segment context page object
 */
export interface SegmentPage {
  url?: string
  path?: string
  referrer?: string
  title?: string
  search?: string
}

/**
 * Segment context campaign object (UTM parameters)
 */
export interface SegmentCampaign {
  name?: string
  source?: string
  medium?: string
  term?: string
  content?: string
}

/**
 * Segment context device object
 */
export interface SegmentDevice {
  type?: string
  model?: string
  manufacturer?: string
}

/**
 * Segment context screen object
 */
export interface SegmentScreen {
  width?: number
  height?: number
  density?: number
}

/**
 * Segment context OS object
 */
export interface SegmentOS {
  name?: string
  version?: string
}

/**
 * Segment context location object
 */
export interface SegmentLocation {
  country?: string
  region?: string
  city?: string
  latitude?: number
  longitude?: number
}

/**
 * Segment context object structure
 */
export interface SegmentContext {
  ip?: string
  userAgent?: string
  locale?: string
  timezone?: string
  page?: SegmentPage
  campaign?: SegmentCampaign
  device?: SegmentDevice
  os?: SegmentOS
  screen?: SegmentScreen
  location?: SegmentLocation
  library?: {
    name?: string
    version?: string
  }
  traits?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Extracted context fields for unified event schema.
 *
 * Note: The `page_*` fields are Segment-specific and map to UnifiedEvent fields:
 * - page_url -> http_url
 * - page_path -> http_path
 * - page_referrer -> http_referrer
 * - page_title -> WebMarketing.page_title
 * - page_search -> WebMarketing.page_search
 */
export interface ExtractedSegmentContext {
  // HTTP Context (maps directly to UnifiedEvent.HttpContext)
  http_url: string | null
  http_path: string | null
  http_referrer: string | null
  http_user_agent: string | null
  http_query: string | null

  // Page/Marketing (Segment-specific, maps to http_* and page_* in UnifiedEvent)
  /** @deprecated Use http_url for UnifiedEvent mapping */
  page_url: string | null
  /** @deprecated Use http_path for UnifiedEvent mapping */
  page_path: string | null
  /** @deprecated Use http_referrer for UnifiedEvent mapping */
  page_referrer: string | null
  page_title: string | null
  page_search: string | null

  // Campaign/UTM
  campaign_name: string | null
  campaign_source: string | null
  campaign_medium: string | null
  campaign_term: string | null
  campaign_content: string | null

  // Client/Device
  client_type: string | null
  client_name: string | null
  client_version: string | null
  device_type: string | null
  device_model: string | null
  device_brand: string | null
  os_name: string | null
  os_version: string | null
  screen_size: string | null

  // Geo
  geo_country: string | null
  geo_region: string | null
  geo_city: string | null
  geo_latitude: number | null
  geo_longitude: number | null
  geo_timezone: string | null

  // Traits (stored as context)
  traits: Record<string, unknown> | null

  // Raw context for custom fields
  context: Record<string, unknown> | null
}

/**
 * Extract normalized context fields from Segment context object
 *
 * @param context - Segment context object
 * @returns Extracted fields for unified event schema
 */
export function extractSegmentContext(
  context?: SegmentContext
): ExtractedSegmentContext {
  if (!context) {
    return {
      http_url: null,
      http_path: null,
      http_referrer: null,
      http_user_agent: null,
      http_query: null,
      page_url: null,
      page_path: null,
      page_referrer: null,
      page_title: null,
      page_search: null,
      campaign_name: null,
      campaign_source: null,
      campaign_medium: null,
      campaign_term: null,
      campaign_content: null,
      client_type: null,
      client_name: null,
      client_version: null,
      device_type: null,
      device_model: null,
      device_brand: null,
      os_name: null,
      os_version: null,
      screen_size: null,
      geo_country: null,
      geo_region: null,
      geo_city: null,
      geo_latitude: null,
      geo_longitude: null,
      geo_timezone: null,
      traits: null,
      context: null,
    }
  }

  const page = context.page
  const campaign = context.campaign
  const device = context.device
  const os = context.os
  const screen = context.screen
  const location = context.location
  const library = context.library

  // Build screen size string if dimensions available
  let screenSize: string | null = null
  if (screen?.width && screen?.height) {
    screenSize = `${screen.width}x${screen.height}`
  }

  return {
    // HTTP Context
    http_url: page?.url ?? null,
    http_path: page?.path ?? null,
    http_referrer: page?.referrer ?? null,
    http_user_agent: context.userAgent ?? null,
    http_query: page?.search ?? null,

    // Page/Marketing (duplicated for semantic clarity)
    page_url: page?.url ?? null,
    page_path: page?.path ?? null,
    page_referrer: page?.referrer ?? null,
    page_title: page?.title ?? null,
    page_search: page?.search ?? null,

    // Campaign/UTM
    campaign_name: campaign?.name ?? null,
    campaign_source: campaign?.source ?? null,
    campaign_medium: campaign?.medium ?? null,
    campaign_term: campaign?.term ?? null,
    campaign_content: campaign?.content ?? null,

    // Client/Device
    client_type: library?.name ?? null,
    client_name: library?.name ?? null,
    client_version: library?.version ?? null,
    device_type: device?.type ?? null,
    device_model: device?.model ?? null,
    device_brand: device?.manufacturer ?? null,
    os_name: os?.name ?? null,
    os_version: os?.version ?? null,
    screen_size: screenSize,

    // Geo
    geo_country: location?.country ?? null,
    geo_region: location?.region ?? null,
    geo_city: location?.city ?? null,
    geo_latitude: location?.latitude ?? null,
    geo_longitude: location?.longitude ?? null,
    geo_timezone: context.timezone ?? null,

    // Traits
    traits: context.traits ?? null,

    // Raw context for custom fields (ip, locale, etc.)
    context: context as Record<string, unknown>,
  }
}
