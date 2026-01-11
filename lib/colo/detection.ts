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
import { codeToCity } from '../../types/Location'

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
// Types
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
  postalCode: string
  /** Region/state code */
  region: string
  /** Region/state name */
  regionCode: string
  /** Timezone */
  timezone: string
  /** ASN number */
  asn: number
  /** ASN organization name */
  asOrganization: string
  /** HTTP protocol version */
  httpProtocol: string
  /** Request priority */
  requestPriority: string
  /** TLS cipher suite */
  tlsCipher: string
  /** TLS version */
  tlsVersion: string
  /** Client TCP RTT (ms) */
  clientTcpRtt: number
  /** Client trust score */
  clientTrustScore: number
  /** Is bot */
  isEUCountry: string
  /** Bot management fields */
  botManagement?: {
    score: number
    staticResource: boolean
    verifiedBot: boolean
  }
}

/**
 * Parsed trace response data from Cloudflare's /cdn-cgi/trace endpoint
 * @deprecated Prefer CfJsonData from cf.json endpoint
 */
export interface TraceData {
  /** Cloudflare identifier */
  fl: string
  /** Host */
  h: string
  /** IP address */
  ip: string
  /** Timestamp */
  ts: string
  /** Visit scheme (http/https) */
  visit_scheme: string
  /** User agent */
  uag: string
  /** 3-letter colo code (IATA) */
  colo: string
  /** Sliver */
  sliver: string
  /** HTTP version */
  http: string
  /** Country code */
  loc: string
  /** TLS version */
  tls: string
  /** SNI status */
  sni: string
  /** WARP status */
  warp: string
  /** Gateway status */
  gateway: string
  /** RBI status */
  rbi: string
  /** Key exchange algorithm */
  kex: string
}

/**
 * Location information for a Durable Object
 */
export interface DOLocation {
  /** Normalized colo code (lowercase) */
  colo: ColoCode
  /** IP address of the DO (from trace) or empty string */
  ip: string
  /** Country code */
  loc: string
  /** When the location was detected */
  detectedAt: Date
  /** Full trace data from Cloudflare (if from trace endpoint) */
  traceData: TraceData
  /** Full cf.json data (if from cf.json endpoint) */
  cfJsonData?: CfJsonData
  /** Coordinates from cf.json */
  coordinates?: {
    latitude: number
    longitude: number
  }
  /** City name from cf.json */
  city?: string
  /** Timezone from cf.json */
  timezone?: string
}

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
 * @returns Typed TraceData object with all parsed fields
 *
 * @example
 * ```ts
 * const data = parseTraceResponse('colo=SJC\nip=1.2.3.4\nloc=US')
 * console.log(data.colo) // 'SJC'
 * console.log(data.loc) // 'US'
 * ```
 */
export function parseTraceResponse(response: string): TraceData {
  const result: Record<string, string> = {}

  // Split by various line ending styles (CRLF, LF, CR)
  const lines = response.split(/\r\n|\n|\r/)

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    // Find the first equals sign (value may contain equals signs)
    const eqIndex = trimmedLine.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmedLine.substring(0, eqIndex)
    const value = trimmedLine.substring(eqIndex + 1)

    result[key] = value
  }

  return result as unknown as TraceData
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
 * console.log(location.coordinates) // { latitude: 37.36, longitude: -121.93 }
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

  return {
    colo: coloValue,
    ip: '', // Not available in cf.json
    loc: cfData.country,
    detectedAt: new Date(),
    traceData: {} as TraceData, // Empty for cf.json source
    cfJsonData: cfData,
    coordinates: {
      latitude: parseFloat(cfData.latitude),
      longitude: parseFloat(cfData.longitude),
    },
    city: cfData.city,
    timezone: cfData.timezone,
  }
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

  return {
    colo,
    ip: traceData.ip,
    loc: traceData.loc,
    detectedAt: new Date(),
    traceData,
  }
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
