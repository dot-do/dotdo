/**
 * Pipeline Location Metadata Enrichment
 *
 * Enriches pipeline events with DO location metadata for analytics.
 *
 * Issue: dotdo-b1cyj
 */

import type { ColoCode, Region, CFLocationHint } from '../types/Location'

// ============================================================================
// Types
// ============================================================================

/**
 * Location metadata attached to pipeline events
 */
export interface PipelineEventMeta {
  /** DO's colo code (IATA) */
  colo: ColoCode
  /** DO's geographic region */
  region: Region
  /** Cloudflare location hint */
  cfHint: CFLocationHint
  /** DO namespace */
  ns: string
  /** ISO timestamp */
  timestamp: string
}

/**
 * Pipeline event with optional location metadata
 */
export interface PipelineEvent {
  /** Event verb (e.g., 'Customer.created') */
  verb: string
  /** Event source namespace */
  source: string
  /** Event payload */
  data: unknown
  /** Context namespace */
  $context: string
  /** ISO timestamp */
  timestamp: string
  /** Location metadata (optional) */
  _meta?: PipelineEventMeta
}

/**
 * DO location information
 */
export interface DOLocation {
  /** Colo code (IATA) */
  colo: ColoCode
  /** Geographic region */
  region: Region
  /** Cloudflare location hint */
  cfHint: CFLocationHint
  /** When location was detected */
  detectedAt: string
  /** How location was detected */
  source: string
}

/**
 * Analytics event schema for R2 Iceberg queries
 */
export interface ColoAnalyticsEvent {
  /** Unique event identifier */
  event_id: string
  /** Event verb */
  verb: string
  /** Source namespace */
  source_ns: string
  /** Colo code (string for SQL compatibility) */
  colo: string
  /** Region (string for SQL compatibility) */
  region: string
  /** CF location hint (string for SQL compatibility) */
  cf_hint: string
  /** Event timestamp (ISO) */
  event_timestamp: string
  /** Pipeline ingestion timestamp (ISO) */
  ingested_at: string
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Enriches a pipeline event with location metadata
 *
 * @param event - The base pipeline event (without _meta)
 * @param location - The DO's detected location (may be undefined)
 * @returns A new PipelineEvent with _meta populated
 */
export function enrichEventWithLocation(
  event: Omit<PipelineEvent, '_meta'>,
  location: DOLocation | undefined
): PipelineEvent {
  // Handle undefined location gracefully
  if (!location) {
    return {
      ...event,
      _meta: {
        colo: undefined as unknown as ColoCode,
        region: undefined as unknown as Region,
        cfHint: undefined as unknown as CFLocationHint,
        ns: event.source || event.$context,
        timestamp: new Date().toISOString(),
      },
    }
  }

  // Create new event with _meta (immutable - don't modify original)
  return {
    ...event,
    _meta: {
      colo: location.colo,
      region: location.region,
      cfHint: location.cfHint,
      ns: event.source || event.$context,
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * Maps a PipelineEvent to the ColoAnalyticsEvent schema for R2 Iceberg
 *
 * @param event - The enriched pipeline event
 * @param eventId - Unique event identifier
 * @returns ColoAnalyticsEvent for analytics queries
 */
export function mapToColoAnalyticsEvent(
  event: PipelineEvent,
  eventId: string
): ColoAnalyticsEvent {
  return {
    event_id: eventId,
    verb: event.verb,
    source_ns: event._meta?.ns || event.source,
    colo: event._meta?.colo || '',
    region: event._meta?.region || '',
    cf_hint: event._meta?.cfHint || '',
    event_timestamp: event.timestamp,
    ingested_at: new Date().toISOString(),
  }
}
