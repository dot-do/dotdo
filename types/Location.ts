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

// Re-export all types and functions from LocationBase.ts (breaks circular dependency with DOLocation.ts)
export {
  type CFLocationHint,
  type Region,
  type ColoCode,
  type ColoCity,
  type Colo,
  type NormalizedLocation,
  cityToCode,
  codeToCity,
  coloRegion,
  regionToCF,
  normalizeLocation,
} from './LocationBase'

// Re-export DOLocation type for backwards compatibility
// This doesn't create a cycle because DOLocation.ts imports from LocationBase.ts, not Location.ts
export type { DOLocation } from './DOLocation'

// Runtime marker for the DOLocation type (for test assertion compatibility)
// This satisfies `hasOwnProperty('DOLocation')` tests
export const DOLocationMarker = 'DOLocation' as const
