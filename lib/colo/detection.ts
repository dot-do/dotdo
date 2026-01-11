/**
 * DO Location Detection
 *
 * Detects Cloudflare colo location from within a Durable Object.
 *
 * Primary method: `https://workers.cloudflare.com/cf.json` - returns JSON with
 * colo, coordinates, country, and more metadata directly.
 *
 * Fallback: `https://cloudflare.com/cdn-cgi/trace` - returns key=value pairs
 * with colo=XXX where XXX is a 3-letter IATA code.
 *
 * Reference: dotdo-c3g99 - DO location detection mechanism
 */

import type { ColoCode } from '../../types/Location'
import { codeToCity, coloRegion, regionToCF } from '../../types/Location'
import {
  type DOLocation,
  type CfJsonData,
  type TraceData,
  createDOLocation,
} from '../../types/DOLocation'

// Re-export types for backward compatibility
export type { DOLocation, CfJsonData, TraceData }

// ============================================================================
// Constants
// ============================================================================

/**
 * Cloudflare's cf.json endpoint - returns JSON with rich location data
 * Preferred over trace endpoint for simpler parsing and more data
 */
export const CLOUDFLARE_CF_JSON_URL = 'https://workers.cloudflare.com/cf.json'

/**
 * Cloudflare's trace endpoint URL for detecting colo location (fallback)
 * @deprecated Use CLOUDFLARE_CF_JSON_URL instead
 */
export const CLOUDFLARE_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace'

// ============================================================================
// Helper: Valid ColoCode Set
// ============================================================================

const validColoCodes = new Set<string>(Object.keys(codeToCity))

/**
 * Validates if a string is a known ColoCode
 */
function isValidColoCode(code: string): code is ColoCode {
  return validColoCodes.has(code)
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Parses all fields from trace response
 *
 * @param response - Raw response from /cdn-cgi/trace endpoint
 * @returns TraceData object with parsed fields (all fields are optional)
 *
 * @example
 * ```ts
 * const data = parseTraceResponse('colo=SJC\nip=1.2.3.4\nloc=US')
 * console.log(data.colo) // 'SJC'
 * console.log(data.loc) // 'US'
 * ```
 */
export function parseTraceResponse(response: string): TraceData {
  const result: TraceData = {}

  // Split by various line ending styles (CRLF, LF, CR)
  const lines = response.split(/\r\n|\n|\r/)

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    // Find the first equals sign (value may contain equals signs)
    const eqIndex = trimmedLine.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmedLine.substring(0, eqIndex) as keyof TraceData
    const value = trimmedLine.substring(eqIndex + 1)

    result[key] = value
  }

  return result
}

/**
 * Parses the trace response to extract colo code
 *
 * @param traceResponse - Raw response from /cdn-cgi/trace endpoint
 * @returns ColoCode if valid, null otherwise
 *
 * @example
 * ```ts
 * const colo = detectColoFromTrace('colo=SJC\nip=1.2.3.4')
 * // Returns: 'sjc'
 * ```
 */
export function detectColoFromTrace(traceResponse: string): ColoCode | null {
  if (!traceResponse || !traceResponse.trim()) {
    return null
  }

  const traceData = parseTraceResponse(traceResponse)

  if (!traceData.colo) {
    return null
  }

  // Trim whitespace and normalize to lowercase
  const coloValue = traceData.colo.trim().toLowerCase()

  if (!coloValue) {
    return null
  }

  // Validate against known colo codes
  if (!isValidColoCode(coloValue)) {
    return null
  }

  return coloValue
}

/**
 * Fetches location from cf.json endpoint (preferred method)
 *
 * @returns Promise resolving to DOLocation with rich metadata
 * @throws Error on network error or invalid response
 *
 * @example
 * ```ts
 * const location = await fetchDOLocationFromCfJson()
 * console.log(location.colo) // 'sjc'
 * console.log(location.coordinates) // { lat: 37.36, lng: -121.93 }
 * ```
 */
export async function fetchDOLocationFromCfJson(): Promise<DOLocation> {
  const response = await fetch(CLOUDFLARE_CF_JSON_URL)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch cf.json endpoint: ${response.status} ${response.statusText}`
    )
  }

  const cfData = (await response.json()) as CfJsonData

  if (!cfData.colo) {
    throw new Error('Missing colo in cf.json response')
  }

  const coloValue = cfData.colo.trim().toLowerCase()

  if (!isValidColoCode(coloValue)) {
    throw new Error(`Invalid or unknown colo code: ${cfData.colo}`)
  }

  const lat = parseFloat(cfData.latitude)
  const lng = parseFloat(cfData.longitude)

  return createDOLocation(coloValue, {
    coordinates: isFinite(lat) && isFinite(lng) ? { lat, lng } : undefined,
    cf: cfData,
    country: cfData.country,
    timezone: cfData.timezone,
  })
}

/**
 * Fetches location from trace endpoint (fallback method)
 *
 * @returns Promise resolving to DOLocation with trace metadata
 * @throws Error on network error, invalid response, or unknown colo code
 * @deprecated Use fetchDOLocationFromCfJson for richer data
 */
export async function fetchDOLocationFromTrace(): Promise<DOLocation> {
  const response = await fetch(CLOUDFLARE_TRACE_URL)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch trace endpoint: ${response.status} ${response.statusText}`
    )
  }

  const responseText = await response.text()

  if (!responseText || !responseText.trim()) {
    throw new Error('Empty response from trace endpoint')
  }

  const traceData = parseTraceResponse(responseText)
  const colo = detectColoFromTrace(responseText)

  if (!colo) {
    const rawColo = traceData.colo || '<missing>'
    throw new Error(`Invalid or unknown colo code: ${rawColo}`)
  }

  return createDOLocation(colo, {
    trace: traceData,
    ip: traceData.ip,
    country: traceData.loc,
  })
}

/**
 * Fetches and parses location from within a DO
 *
 * Uses cf.json endpoint as primary source (richer data, simpler parsing).
 * Falls back to trace endpoint if cf.json fails.
 *
 * @returns Promise resolving to DOLocation with detected colo and metadata
 * @throws Error on network error, invalid response, or unknown colo code
 *
 * @example
 * ```ts
 * const location = await fetchDOLocation()
 * console.log(location.colo) // 'sjc'
 * console.log(location.coordinates) // { latitude: 37.36, longitude: -121.93 }
 * console.log(location.detectedAt) // Date
 * ```
 */
export async function fetchDOLocation(): Promise<DOLocation> {
  try {
    // Try cf.json first - richer data, simpler parsing
    return await fetchDOLocationFromCfJson()
  } catch {
    // Fall back to trace endpoint
    return await fetchDOLocationFromTrace()
  }
}
