/**
 * ACID Location Types for Cloudflare Region and Colo Management
 *
 * Provides types and utilities for working with Cloudflare's edge locations
 * in ACID testing scenarios:
 * - RegionHint type (Cloudflare region hints for DO location)
 * - ColoCode type (IATA codes for Cloudflare colos/datacenters)
 * - REGION_COLOS mapping (region to colo arrays)
 * - LocationConfig interface (test configuration)
 *
 * @see types/Location.ts for the general-purpose location types
 * @see types/Chaos.ts for chaos testing types
 * @task dotdo-7xi3 - ACID Types: Location
 */

// ============================================================================
// RegionHint Type
// ============================================================================

/**
 * Cloudflare region hints for Durable Object location placement.
 *
 * These are the valid values for `locationHint` when creating a DO stub
 * via `getOrCreate()` with location preferences.
 *
 * @example
 * ```typescript
 * const stub = env.MY_DO.get(id, { locationHint: 'wnam' })
 * ```
 */
export type RegionHint =
  | 'wnam'  // Western North America
  | 'enam'  // Eastern North America
  | 'sam'   // South America
  | 'weur'  // Western Europe
  | 'eeur'  // Eastern Europe
  | 'apac'  // Asia Pacific
  | 'oc'    // Oceania
  | 'afr'   // Africa
  | 'me'    // Middle East

// ============================================================================
// ColoCode Type
// ============================================================================

/**
 * IATA airport codes (lowercase) for Cloudflare colos/datacenters.
 *
 * This is an extended list covering major Cloudflare datacenters
 * that support Durable Objects for ACID testing scenarios.
 *
 * Note: Not all Cloudflare colos support DOs. This list includes
 * the primary DO-capable datacenters for test scenarios.
 */
export type ColoCode =
  // North America - East
  | 'ewr'  // Newark, NJ
  | 'ord'  // Chicago, IL
  | 'dfw'  // Dallas, TX
  | 'iad'  // Ashburn, VA (Washington DC area)
  | 'atl'  // Atlanta, GA
  | 'mia'  // Miami, FL
  // North America - West
  | 'lax'  // Los Angeles, CA
  | 'sjc'  // San Jose, CA
  | 'sea'  // Seattle, WA
  | 'den'  // Denver, CO
  // South America
  | 'gru'  // Sao Paulo, Brazil
  // Europe - West
  | 'cdg'  // Paris, France
  | 'ams'  // Amsterdam, Netherlands
  | 'fra'  // Frankfurt, Germany
  | 'lhr'  // London, UK
  | 'mad'  // Madrid, Spain
  | 'mxp'  // Milan, Italy
  | 'zrh'  // Zurich, Switzerland
  // Europe - East
  | 'vie'  // Vienna, Austria
  | 'arn'  // Stockholm, Sweden
  // Asia Pacific
  | 'sin'  // Singapore
  | 'nrt'  // Tokyo Narita, Japan
  | 'hkg'  // Hong Kong
  | 'bom'  // Mumbai, India
  | 'del'  // Delhi, India
  | 'hnd'  // Tokyo Haneda, Japan
  | 'icn'  // Seoul, South Korea
  | 'kix'  // Osaka, Japan
  // Oceania
  | 'syd'  // Sydney, Australia
  | 'mel'  // Melbourne, Australia
  | 'akl'  // Auckland, New Zealand
  // Africa
  | 'jnb'  // Johannesburg, South Africa

// ============================================================================
// Region to Colo Mapping
// ============================================================================

/**
 * Mapping from region hints to their associated colo codes.
 *
 * This mapping is used for test scenarios where we need to select
 * a specific datacenter within a region, or verify that a DO
 * was placed in the expected region.
 *
 * Note: The `me` (Middle East) region currently has no colos listed
 * as DO support in that region may vary.
 */
export const REGION_COLOS: Record<RegionHint, ColoCode[]> = {
  wnam: ['lax', 'sjc', 'sea', 'den'],
  enam: ['ewr', 'ord', 'dfw', 'iad', 'atl', 'mia'],
  sam: ['gru'],
  weur: ['cdg', 'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh'],
  eeur: ['vie', 'arn'],
  apac: ['sin', 'nrt', 'hkg', 'bom', 'del', 'hnd', 'icn', 'kix'],
  oc: ['syd', 'mel', 'akl'],
  afr: ['jnb'],
  me: [],
} as const

// ============================================================================
// Location Configuration
// ============================================================================

/**
 * Location configuration for ACID test scenarios.
 *
 * Used to specify location constraints and simulated network
 * conditions for tests involving multi-region deployments,
 * edge routing, and geographic failover.
 *
 * @example
 * ```typescript
 * const config: LocationConfig = {
 *   region: 'wnam',
 *   colo: 'lax',
 *   latencyMs: 50,
 * }
 * ```
 */
export interface LocationConfig {
  /**
   * Target region hint for DO placement.
   * If specified without colo, any colo in the region may be used.
   */
  region?: RegionHint

  /**
   * Specific datacenter (colo) code.
   * If specified, takes precedence over region for exact placement.
   */
  colo?: ColoCode

  /**
   * Simulated network latency in milliseconds.
   * Used for testing latency-sensitive scenarios and timeouts.
   * Default: 0 (no simulated latency)
   */
  latencyMs?: number
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the region for a given colo code.
 * Returns the RegionHint that contains the specified colo.
 */
export type ColoToRegion<C extends ColoCode> = {
  [R in RegionHint]: C extends (typeof REGION_COLOS)[R][number] ? R : never
}[RegionHint]

/**
 * All colo codes for a specific region.
 */
export type ColosInRegion<R extends RegionHint> = (typeof REGION_COLOS)[R][number]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the region hint for a given colo code.
 *
 * @param colo - The datacenter code
 * @returns The region containing the colo, or undefined if not found
 *
 * @example
 * ```typescript
 * getRegionForColo('lax') // 'wnam'
 * getRegionForColo('cdg') // 'weur'
 * ```
 */
export function getRegionForColo(colo: ColoCode): RegionHint | undefined {
  for (const [region, colos] of Object.entries(REGION_COLOS)) {
    if ((colos as readonly ColoCode[]).includes(colo)) {
      return region as RegionHint
    }
  }
  return undefined
}

/**
 * Get all colos in a region.
 *
 * @param region - The region hint
 * @returns Array of colo codes in the region
 *
 * @example
 * ```typescript
 * getColosForRegion('wnam') // ['lax', 'sjc', 'sea', 'den']
 * ```
 */
export function getColosForRegion(region: RegionHint): readonly ColoCode[] {
  return REGION_COLOS[region]
}

/**
 * Check if a colo is in a specific region.
 *
 * @param colo - The datacenter code
 * @param region - The region hint to check
 * @returns True if the colo is in the region
 *
 * @example
 * ```typescript
 * isColoInRegion('lax', 'wnam') // true
 * isColoInRegion('lax', 'enam') // false
 * ```
 */
export function isColoInRegion(colo: ColoCode, region: RegionHint): boolean {
  return (REGION_COLOS[region] as readonly ColoCode[]).includes(colo)
}

/**
 * Get a random colo from a region.
 *
 * @param region - The region hint
 * @returns A random colo code from the region, or undefined if region is empty
 *
 * @example
 * ```typescript
 * getRandomColoInRegion('wnam') // 'lax' | 'sjc' | 'sea' | 'den'
 * ```
 */
export function getRandomColoInRegion(region: RegionHint): ColoCode | undefined {
  const colos = REGION_COLOS[region]
  if (colos.length === 0) {
    return undefined
  }
  return colos[Math.floor(Math.random() * colos.length)]
}

/**
 * Validate a LocationConfig.
 *
 * @param config - The location configuration to validate
 * @returns True if valid, throws if invalid
 * @throws Error if colo is specified but not in the specified region
 *
 * @example
 * ```typescript
 * validateLocationConfig({ region: 'wnam', colo: 'lax' }) // true
 * validateLocationConfig({ region: 'wnam', colo: 'cdg' }) // throws
 * ```
 */
export function validateLocationConfig(config: LocationConfig): boolean {
  // If both region and colo are specified, verify colo is in region
  if (config.region && config.colo) {
    if (!isColoInRegion(config.colo, config.region)) {
      throw new Error(
        `Colo '${config.colo}' is not in region '${config.region}'. ` +
        `Valid colos for ${config.region}: ${REGION_COLOS[config.region].join(', ')}`
      )
    }
  }

  // Validate latency is non-negative
  if (config.latencyMs !== undefined && config.latencyMs < 0) {
    throw new Error(`latencyMs must be non-negative, got: ${config.latencyMs}`)
  }

  return true
}

// ============================================================================
// Constants
// ============================================================================

/**
 * All valid region hints as an array.
 */
export const ALL_REGIONS: readonly RegionHint[] = [
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
] as const

/**
 * All valid colo codes as an array.
 */
export const ALL_COLOS: readonly ColoCode[] = [
  // North America - East
  'ewr', 'ord', 'dfw', 'iad', 'atl', 'mia',
  // North America - West
  'lax', 'sjc', 'sea', 'den',
  // South America
  'gru',
  // Europe - West
  'cdg', 'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh',
  // Europe - East
  'vie', 'arn',
  // Asia Pacific
  'sin', 'nrt', 'hkg', 'bom', 'del', 'hnd', 'icn', 'kix',
  // Oceania
  'syd', 'mel', 'akl',
  // Africa
  'jnb',
] as const

/**
 * Regions that have DO-capable colos.
 */
export const REGIONS_WITH_COLOS: readonly RegionHint[] = ALL_REGIONS.filter(
  r => REGION_COLOS[r].length > 0
)
