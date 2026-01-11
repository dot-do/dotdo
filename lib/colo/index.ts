/**
 * Colo Module
 *
 * Provides utilities for detecting and caching Cloudflare colo locations
 * from within Durable Objects.
 *
 * - detection: Raw location detection from Cloudflare trace endpoint
 * - caching: Persistent caching of detected location in DO storage
 */

// Detection exports
export {
  detectColoFromTrace,
  fetchDOLocation,
  parseTraceResponse,
  CLOUDFLARE_TRACE_URL,
  type TraceData,
  type DOLocation as RawDOLocation,
} from './detection'

// Caching exports
export {
  LocationCache,
  getOrDetectLocation,
  LOCATION_STORAGE_KEY,
  LOCATION_CACHE_VERSION,
  type DOLocation,
} from './caching'

// External data exports (WHERE-DOs-Live API)
export {
  ColoDataClient,
  syncColoData,
  getColoWithLikelihood,
  type ColoMetadata,
  type SyncResult,
} from './external-data'
