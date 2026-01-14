export interface LocationInfo {
  colo: string
  region: string
  lat: number
  lon: number
  country: string
}

// Map Cloudflare colos to regions
const COLO_TO_REGION: Record<string, string> = {
  // US West
  'SJC': 'us-west', 'LAX': 'us-west', 'SEA': 'us-west', 'PDX': 'us-west',
  // US East
  'IAD': 'us-east', 'EWR': 'us-east', 'JFK': 'us-east', 'BOS': 'us-east', 'ATL': 'us-east',
  // EU West
  'LHR': 'eu-west', 'CDG': 'eu-west', 'AMS': 'eu-west', 'FRA': 'eu-west',
  // Asia East
  'NRT': 'asia-east', 'HND': 'asia-east', 'ICN': 'asia-east', 'HKG': 'asia-east',
}

/**
 * Get the region name from a Cloudflare colo code.
 */
export function getRegionFromColo(colo: string): string | null {
  return COLO_TO_REGION[colo.toUpperCase()] || null
}

/**
 * Extract location information from a Cloudflare request.
 * Returns null if cf object is missing.
 */
export function extractLocation(request: Request): LocationInfo | null {
  const cf = (request as any).cf
  if (!cf) return null

  const colo = cf.colo || ''
  const region = cf.region || getRegionFromColo(colo) || 'unknown'

  return {
    colo,
    region,
    lat: parseFloat(cf.latitude) || 0,
    lon: parseFloat(cf.longitude) || 0,
    country: cf.country || 'unknown',
  }
}
