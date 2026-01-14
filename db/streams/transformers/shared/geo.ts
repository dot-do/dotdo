/**
 * Geo Location Extraction Utilities
 *
 * Extracts geographic information from Cloudflare CF properties
 * and maps to the unified event schema geo fields.
 */

/**
 * Cloudflare CF geo properties structure.
 */
export interface CfGeoProperties {
  colo?: string
  country?: string
  city?: string
  region?: string
  timezone?: string
  asn?: number
  asOrganization?: string
  latitude?: string
  longitude?: string
  postalCode?: string
}

/**
 * Unified event geo fields.
 */
export interface GeoFields {
  geo_colo: string | null
  geo_country: string | null
  geo_city: string | null
  geo_region: string | null
  geo_timezone: string | null
  geo_asn: number | null
  geo_as_org: string | null
  geo_latitude: number | null
  geo_longitude: number | null
  geo_postal: string | null
}

/**
 * Extracts geo location fields from Cloudflare CF properties.
 *
 * Maps:
 * - colo → geo_colo (3-letter airport code)
 * - country → geo_country (ISO 3166-1 alpha-2)
 * - city → geo_city
 * - region → geo_region
 * - timezone → geo_timezone (IANA timezone)
 * - asn → geo_asn (Autonomous System Number)
 * - asOrganization → geo_as_org
 * - latitude → geo_latitude (parsed to number)
 * - longitude → geo_longitude (parsed to number)
 * - postalCode → geo_postal
 *
 * @param cf - Cloudflare CF properties (may be undefined)
 * @returns Unified geo fields with nulls for missing values
 */
export function extractGeoFromCf(cf: CfGeoProperties | undefined): GeoFields {
  if (!cf) {
    return {
      geo_colo: null,
      geo_country: null,
      geo_city: null,
      geo_region: null,
      geo_timezone: null,
      geo_asn: null,
      geo_as_org: null,
      geo_latitude: null,
      geo_longitude: null,
      geo_postal: null,
    }
  }

  return {
    geo_colo: cf.colo ?? null,
    geo_country: cf.country ?? null,
    geo_city: cf.city ?? null,
    geo_region: cf.region ?? null,
    geo_timezone: cf.timezone ?? null,
    geo_asn: cf.asn ?? null,
    geo_as_org: cf.asOrganization ?? null,
    geo_latitude: cf.latitude ? parseFloat(cf.latitude) : null,
    geo_longitude: cf.longitude ? parseFloat(cf.longitude) : null,
    geo_postal: cf.postalCode ?? null,
  }
}

/**
 * Creates a null-filled geo fields object.
 *
 * @returns GeoFields with all values set to null
 */
export function emptyGeoFields(): GeoFields {
  return extractGeoFromCf(undefined)
}
