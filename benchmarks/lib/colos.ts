/**
 * Cloudflare data center (colo) codes
 *
 * This list contains major Cloudflare data centers used for benchmark targeting.
 * The colo code is extracted from the cf-ray response header (e.g., "8abc123-SJC" -> "SJC")
 *
 * @see https://www.cloudflare.com/network/
 */

/**
 * North American Cloudflare colos
 */
export const NA_COLOS = [
  'SJC', // San Jose, CA
  'LAX', // Los Angeles, CA
  'SEA', // Seattle, WA
  'DFW', // Dallas, TX
  'IAD', // Ashburn, VA
  'EWR', // Newark, NJ
  'ORD', // Chicago, IL
  'ATL', // Atlanta, GA
  'MIA', // Miami, FL
  'DEN', // Denver, CO
  'PHX', // Phoenix, AZ
  'YYZ', // Toronto, Canada
  'YVR', // Vancouver, Canada
] as const

/**
 * European Cloudflare colos
 */
export const EU_COLOS = [
  'LHR', // London, UK
  'CDG', // Paris, France
  'FRA', // Frankfurt, Germany
  'AMS', // Amsterdam, Netherlands
  'MAD', // Madrid, Spain
  'MXP', // Milan, Italy
  'ZRH', // Zurich, Switzerland
  'ARN', // Stockholm, Sweden
  'DUB', // Dublin, Ireland
  'WAW', // Warsaw, Poland
] as const

/**
 * Asia-Pacific Cloudflare colos
 */
export const APAC_COLOS = [
  'NRT', // Tokyo, Japan
  'HKG', // Hong Kong
  'SIN', // Singapore
  'SYD', // Sydney, Australia
  'ICN', // Seoul, South Korea
  'BOM', // Mumbai, India
  'DEL', // New Delhi, India
  'KUL', // Kuala Lumpur, Malaysia
  'BKK', // Bangkok, Thailand
  'MEL', // Melbourne, Australia
] as const

/**
 * All supported Cloudflare colos
 */
export const ALL_COLOS = [...NA_COLOS, ...EU_COLOS, ...APAC_COLOS] as const

/**
 * Colo type - any valid Cloudflare data center code
 */
export type Colo = (typeof ALL_COLOS)[number]

/**
 * Check if a string is a valid colo code
 */
export function isValidColo(colo: string): colo is Colo {
  return ALL_COLOS.includes(colo as Colo)
}

/**
 * Get region for a colo code
 */
export function getColoRegion(colo: string): 'NA' | 'EU' | 'APAC' | 'unknown' {
  if (NA_COLOS.includes(colo as (typeof NA_COLOS)[number])) return 'NA'
  if (EU_COLOS.includes(colo as (typeof EU_COLOS)[number])) return 'EU'
  if (APAC_COLOS.includes(colo as (typeof APAC_COLOS)[number])) return 'APAC'
  return 'unknown'
}

/**
 * Extract colo code from cf-ray header
 *
 * @param cfRay - The cf-ray header value (e.g., "8abc123def456-SJC")
 * @returns The colo code (e.g., "SJC") or undefined if not found
 */
export function extractColoFromCfRay(cfRay: string | null): string | undefined {
  if (!cfRay) return undefined
  const parts = cfRay.split('-')
  return parts.length >= 2 ? parts[parts.length - 1] : undefined
}
