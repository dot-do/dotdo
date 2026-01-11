/**
 * DO Location Types
 *
 * Issue: dotdo-gm44s - DO Location types
 *
 * CANONICAL SOURCE OF TRUTH for all DO location types.
 * All other modules should import from here.
 *
 * Provides types for Durable Object location detection:
 * - DOLocation interface (base location info for a DO)
 * - DOLocationInfo interface (extended location info with DO metadata)
 * - ColoMetadata interface (external colo data from WHERE-DOs-Live)
 * - CfJsonData interface (response from workers.cloudflare.com/cf.json)
 * - TraceData interface (response from /cdn-cgi/trace)
 * - createDOLocation factory function
 */

import type {
  Region,
  ColoCode,
  ColoCity,
  CFLocationHint,
  Colo,
} from './Location'

import {
  normalizeLocation,
  codeToCity,
} from './Location'

// ============================================================================
// Raw Detection Types
// ============================================================================

/**
 * Response data from Cloudflare's cf.json endpoint
 * Contains rich location and connection metadata
 */
export interface CfJsonData {
  /** 3-letter colo code (IATA) - uppercase */
  colo: string
  /** Country code (ISO 3166-1 alpha-2) */
  country: string
  /** City name */
  city: string
  /** Continent code */
  continent: string
  /** Latitude */
  latitude: string
  /** Longitude */
  longitude: string
  /** Postal/ZIP code */
  postalCode?: string
  /** Region/state code */
  region?: string
  /** Region/state name */
  regionCode?: string
  /** Timezone */
  timezone: string
  /** ASN number */
  asn?: number
  /** ASN organization name */
  asOrganization?: string
  /** HTTP protocol version */
  httpProtocol?: string
  /** TLS version */
  tlsVersion?: string
  /** Client TCP RTT (ms) */
  clientTcpRtt?: number
}

/**
 * Parsed trace response data from Cloudflare's /cdn-cgi/trace endpoint
 */
export interface TraceData {
  /** Cloudflare identifier */
  fl?: string
  /** Host */
  h?: string
  /** IP address */
  ip?: string
  /** Timestamp */
  ts?: string
  /** Visit scheme (http/https) */
  visit_scheme?: string
  /** User agent */
  uag?: string
  /** 3-letter colo code (IATA) */
  colo?: string
  /** Sliver */
  sliver?: string
  /** HTTP version */
  http?: string
  /** Country code */
  loc?: string
  /** TLS version */
  tls?: string
  /** SNI status */
  sni?: string
  /** WARP status */
  warp?: string
  /** Gateway status */
  gateway?: string
  /** RBI status */
  rbi?: string
  /** Key exchange algorithm */
  kex?: string
}

// ============================================================================
// DOLocation Interface
// ============================================================================

/**
 * Represents the detected location of a Durable Object instance.
 *
 * This is the canonical DOLocation type - all modules should use this.
 */
export interface DOLocation {
  /** IATA code for the Cloudflare colo (e.g., 'lax', 'iad') */
  colo: ColoCode
  /** City name (e.g., 'LosAngeles', 'Virginia') */
  city: ColoCity
  /** Geographic region (e.g., 'us-west', 'us-east') */
  region: Region
  /** Cloudflare location hint (e.g., 'wnam', 'enam') */
  cfHint: CFLocationHint
  /** Timestamp when location was detected */
  detectedAt: Date
  /** Optional coordinates */
  coordinates?: {
    lat: number
    lng: number
  }
  /** Raw cf.json data (when detected via cf.json endpoint) */
  cf?: CfJsonData
  /** Raw trace data (when detected via trace endpoint) */
  trace?: TraceData
  /** IP address (from trace endpoint) */
  ip?: string
  /** Country code (from trace or cf.json) */
  country?: string
  /** Timezone (from cf.json) */
  timezone?: string
}

// ============================================================================
// DOLocationInfo Interface
// ============================================================================

/**
 * Extended location info with DO metadata
 */
export interface DOLocationInfo extends DOLocation {
  /** Durable Object ID */
  doId: string
  /** DO namespace name */
  ns: string
  /** Optional likelihood/confidence score (0-1) */
  likelihood?: number
}

// ============================================================================
// ColoMetadata Interface
// ============================================================================

/**
 * External colo metadata (from WHERE-DOs-Live or similar source)
 */
export interface ColoMetadata {
  /** IATA code for the Cloudflare colo */
  code: ColoCode
  /** City name */
  city: ColoCity
  /** Geographic region */
  region: Region
  /** Geographic coordinates (required for ColoMetadata) */
  coordinates: {
    lat: number
    lng: number
  }
  /** Whether this colo supports Durable Objects */
  supportsDOs: boolean
  /** Optional likelihood/confidence score */
  likelihood?: number
}

// ============================================================================
// createDOLocation Factory Function
// ============================================================================

/**
 * Options for createDOLocation
 */
export interface CreateDOLocationOptions {
  /** Custom coordinates */
  coordinates?: {
    lat: number
    lng: number
  }
  /** Custom timestamp */
  detectedAt?: Date
  /** Raw cf.json data */
  cf?: CfJsonData
  /** Raw trace data */
  trace?: TraceData
  /** IP address */
  ip?: string
  /** Country code */
  country?: string
  /** Timezone */
  timezone?: string
}

/**
 * Create a DOLocation from a colo code or city name
 *
 * @param colo - Colo code or city name
 * @param options - Optional customization
 * @returns DOLocation with all fields populated
 *
 * @example
 * ```ts
 * const location = createDOLocation('iad')
 * // { colo: 'iad', city: 'Virginia', region: 'us-east', cfHint: 'enam', detectedAt: Date }
 * ```
 */
export function createDOLocation(
  colo: Colo,
  options?: CreateDOLocationOptions
): DOLocation {
  const normalized = normalizeLocation(colo)

  // Get the code - normalizeLocation returns code for both ColoCode and ColoCity inputs
  const code = normalized.code as ColoCode
  const city = codeToCity[code]

  const result: DOLocation = {
    colo: code,
    city,
    region: normalized.region,
    cfHint: normalized.cfHint,
    detectedAt: options?.detectedAt ?? new Date(),
  }

  if (options?.coordinates) {
    result.coordinates = options.coordinates
  }
  if (options?.cf) {
    result.cf = options.cf
  }
  if (options?.trace) {
    result.trace = options.trace
  }
  if (options?.ip) {
    result.ip = options.ip
  }
  if (options?.country) {
    result.country = options.country
  }
  if (options?.timezone) {
    result.timezone = options.timezone
  }

  return result
}
