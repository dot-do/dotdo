/**
 * DO Location Detection
 *
 * Detects Cloudflare colo location from within a Durable Object.
 * DOs can detect their colo by fetching `https://cloudflare.com/cdn-cgi/trace`
 * from within the DO. The response contains `colo=XXX` where XXX is a 3-letter IATA code.
 *
 * Reference: dotdo-c3g99 - DO location detection mechanism
 */

import type { ColoCode } from '../../types/Location'
import { codeToCity } from '../../types/Location'

// ============================================================================
// Constants
// ============================================================================

/**
 * Cloudflare's trace endpoint URL for detecting colo location
 */
export const CLOUDFLARE_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace'

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed trace response data from Cloudflare's /cdn-cgi/trace endpoint
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
  /** IP address of the DO */
  ip: string
  /** Country code */
  loc: string
  /** When the location was detected */
  detectedAt: Date
  /** Full trace data from Cloudflare */
  traceData: TraceData
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
 * Fetches and parses location from within a DO
 *
 * @returns Promise resolving to DOLocation with detected colo and metadata
 * @throws Error on network error, invalid response, or unknown colo code
 *
 * @example
 * ```ts
 * const location = await fetchDOLocation()
 * console.log(location.colo) // 'sjc'
 * console.log(location.detectedAt) // Date
 * ```
 */
export async function fetchDOLocation(): Promise<DOLocation> {
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
