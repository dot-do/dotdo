/**
 * Location Types for Cloudflare Edge Location Management
 *
 * Provides types and utilities for working with Cloudflare's edge locations:
 * - Region type (geographic regions)
 * - ColoCode type (IATA codes for Cloudflare colos)
 * - ColoCity type (friendly city names)
 * - Colo union type (code | city)
 * - Mapping objects (cityToCode, codeToCity, coloRegion, regionToCF)
 * - normalizeLocation() function
 */

// ============================================================================
// Cloudflare Location Hint Type
// ============================================================================

/**
 * Cloudflare's internal region codes for locationHint
 */
export type CFLocationHint =
  | 'wnam' // Western North America
  | 'enam' // Eastern North America
  | 'sam'  // South America
  | 'weur' // Western Europe
  | 'eeur' // Eastern Europe
  | 'apac' // Asia-Pacific
  | 'oc'   // Oceania
  | 'afr'  // Africa
  | 'me'   // Middle East

// ============================================================================
// Region Type
// ============================================================================

/**
 * Friendly region names for geographic areas
 */
export type Region =
  | 'us-west'
  | 'us-east'
  | 'south-america'
  | 'eu-west'
  | 'eu-east'
  | 'asia-pacific'
  | 'oceania'
  | 'africa'
  | 'middle-east'

// ============================================================================
// ColoCode Type (IATA Codes)
// ============================================================================

/**
 * IATA airport codes (lowercase) for Cloudflare colos
 */
export type ColoCode =
  // North America - East
  | 'iad' // Washington DC (Virginia)
  | 'ewr' // Newark
  | 'atl' // Atlanta
  | 'mia' // Miami
  | 'ord' // Chicago
  | 'dfw' // Dallas
  // North America - West
  | 'den' // Denver
  | 'sjc' // San Jose
  | 'lax' // Los Angeles
  | 'sea' // Seattle
  // Europe - West
  | 'lhr' // London
  | 'cdg' // Paris
  | 'ams' // Amsterdam
  | 'fra' // Frankfurt
  | 'mrs' // Marseille
  | 'mxp' // Milan
  // Europe - East
  | 'prg' // Prague
  | 'arn' // Stockholm
  | 'vie' // Vienna
  // Asia-Pacific
  | 'sin' // Singapore
  | 'hkg' // Hong Kong
  | 'nrt' // Tokyo
  | 'kix' // Osaka

// ============================================================================
// ColoCity Type
// ============================================================================

/**
 * PascalCase city names for Cloudflare colos
 */
export type ColoCity =
  // North America - East
  | 'Virginia'
  | 'Newark'
  | 'Atlanta'
  | 'Miami'
  | 'Chicago'
  | 'Dallas'
  // North America - West
  | 'Denver'
  | 'SanJose'
  | 'LosAngeles'
  | 'Seattle'
  // Europe - West
  | 'London'
  | 'Paris'
  | 'Amsterdam'
  | 'Frankfurt'
  | 'Marseille'
  | 'Milan'
  // Europe - East
  | 'Prague'
  | 'Stockholm'
  | 'Vienna'
  // Asia-Pacific
  | 'Singapore'
  | 'HongKong'
  | 'Tokyo'
  | 'Osaka'

// ============================================================================
// Colo Union Type
// ============================================================================

/**
 * Union type accepting either ColoCode or ColoCity
 */
export type Colo = ColoCode | ColoCity

// ============================================================================
// NormalizedLocation Interface
// ============================================================================

/**
 * Normalized location result with code, region, and CF hint
 */
export interface NormalizedLocation {
  code: ColoCode | undefined
  region: Region
  cfHint: CFLocationHint
}

// ============================================================================
// Mapping Objects
// ============================================================================

/**
 * Map city names to IATA codes
 */
export const cityToCode = {
  // North America - East
  Virginia: 'iad',
  Newark: 'ewr',
  Atlanta: 'atl',
  Miami: 'mia',
  Chicago: 'ord',
  Dallas: 'dfw',
  // North America - West
  Denver: 'den',
  SanJose: 'sjc',
  LosAngeles: 'lax',
  Seattle: 'sea',
  // Europe - West
  London: 'lhr',
  Paris: 'cdg',
  Amsterdam: 'ams',
  Frankfurt: 'fra',
  Marseille: 'mrs',
  Milan: 'mxp',
  // Europe - East
  Prague: 'prg',
  Stockholm: 'arn',
  Vienna: 'vie',
  // Asia-Pacific
  Singapore: 'sin',
  HongKong: 'hkg',
  Tokyo: 'nrt',
  Osaka: 'kix',
} as const satisfies Record<ColoCity, ColoCode>

/**
 * Map IATA codes to city names
 */
export const codeToCity = {
  // North America - East
  iad: 'Virginia',
  ewr: 'Newark',
  atl: 'Atlanta',
  mia: 'Miami',
  ord: 'Chicago',
  dfw: 'Dallas',
  // North America - West
  den: 'Denver',
  sjc: 'SanJose',
  lax: 'LosAngeles',
  sea: 'Seattle',
  // Europe - West
  lhr: 'London',
  cdg: 'Paris',
  ams: 'Amsterdam',
  fra: 'Frankfurt',
  mrs: 'Marseille',
  mxp: 'Milan',
  // Europe - East
  prg: 'Prague',
  arn: 'Stockholm',
  vie: 'Vienna',
  // Asia-Pacific
  sin: 'Singapore',
  hkg: 'HongKong',
  nrt: 'Tokyo',
  kix: 'Osaka',
} as const satisfies Record<ColoCode, ColoCity>

/**
 * Map IATA codes to regions
 */
export const coloRegion = {
  // US West
  lax: 'us-west',
  sjc: 'us-west',
  sea: 'us-west',
  den: 'us-west',
  // US East (includes central and south US colos)
  iad: 'us-east',
  ewr: 'us-east',
  ord: 'us-east',
  dfw: 'us-east',
  atl: 'us-east',
  mia: 'us-east',
  // EU West
  lhr: 'eu-west',
  cdg: 'eu-west',
  ams: 'eu-west',
  fra: 'eu-west',
  mrs: 'eu-west',
  mxp: 'eu-west',
  // EU East
  prg: 'eu-east',
  arn: 'eu-east',
  vie: 'eu-east',
  // Asia-Pacific
  sin: 'asia-pacific',
  hkg: 'asia-pacific',
  nrt: 'asia-pacific',
  kix: 'asia-pacific',
} as const satisfies Record<ColoCode, Region>

/**
 * Map regions to Cloudflare location hints
 */
export const regionToCF = {
  'us-west': 'wnam',
  'us-east': 'enam',
  'south-america': 'sam',
  'eu-west': 'weur',
  'eu-east': 'eeur',
  'asia-pacific': 'apac',
  'oceania': 'oc',
  'africa': 'afr',
  'middle-east': 'me',
} as const satisfies Record<Region, CFLocationHint>

// ============================================================================
// Helper Sets for Runtime Checks
// ============================================================================

const coloCodeSet = new Set<string>(Object.keys(codeToCity))
const coloCitySet = new Set<string>(Object.keys(cityToCode))
const regionSet = new Set<string>(Object.keys(regionToCF))

// ============================================================================
// normalizeLocation Function
// ============================================================================

/**
 * Normalize any location input (ColoCode, ColoCity, or Region) to standard format
 *
 * @param location - A ColoCode, ColoCity, or Region
 * @returns NormalizedLocation with code (undefined for Region input), region, and cfHint
 */
export function normalizeLocation(location: Colo | Region): NormalizedLocation {
  // Check if it's a ColoCode (e.g., 'lax')
  if (coloCodeSet.has(location)) {
    const code = location as ColoCode
    const region = coloRegion[code]
    const cfHint = regionToCF[region]
    return { code, region, cfHint }
  }

  // Check if it's a ColoCity (e.g., 'LosAngeles')
  if (coloCitySet.has(location)) {
    const city = location as ColoCity
    const code = cityToCode[city]
    const region = coloRegion[code]
    const cfHint = regionToCF[region]
    return { code, region, cfHint }
  }

  // Must be a Region (e.g., 'us-west')
  if (regionSet.has(location)) {
    const region = location as Region
    const cfHint = regionToCF[region]
    return { code: undefined, region, cfHint }
  }

  // Should never reach here if types are correct, but handle gracefully
  throw new Error(`Invalid location: ${location}`)
}
