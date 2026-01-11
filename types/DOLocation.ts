/**
 * DO Location Types
 *
 * Issue: dotdo-gm44s - DO Location types
 *
 * Provides types for Durable Object location detection:
 * - DOLocation interface (base location info for a DO)
 * - DOLocationInfo interface (extended location info with DO metadata)
 * - ColoMetadata interface (external colo data from WHERE-DOs-Live)
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
// DOLocation Interface
// ============================================================================

/**
 * Represents the detected location of a Durable Object instance
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
  /** Timestamp when location was detected (Unix timestamp) */
  detectedAt: number
  /** Optional coordinates */
  coordinates?: {
    lat: number
    lng: number
  }
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
  detectedAt?: number
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
 * // { colo: 'iad', city: 'Virginia', region: 'us-east', cfHint: 'enam', detectedAt: ... }
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
    detectedAt: options?.detectedAt ?? Date.now(),
  }

  if (options?.coordinates) {
    result.coordinates = options.coordinates
  }

  return result
}
