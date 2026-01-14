/**
 * Pipeline SQL Transform for ObservabilityEvents
 *
 * Transforms ObservabilityEvents into the Iceberg table format
 * used by Cloudflare Pipelines for analytics storage.
 */

import type { ObservabilityEvent } from '../types/observability'

/**
 * IcebergRow represents the output format for Cloudflare Pipelines.
 * All field names use snake_case to match SQL/Iceberg conventions.
 */
export interface IcebergRow {
  // Required fields
  id: string
  type: string
  level: string
  script: string
  timestamp: number

  // Partition columns (derived)
  hour: string
  severity_bucket: 'error' | 'normal'

  // Optional fields (nullable)
  request_id: string | null
  method: string | null
  url: string | null
  status: number | null
  duration_ms: number | null
  do_name: string | null
  do_id: string | null
  do_method: string | null
  message: string | null
  stack: string | null
  metadata: string | null
}

/**
 * Converts a Unix millisecond timestamp to an ISO hour string.
 * Truncates to the start of the hour for partitioning.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns ISO string truncated to hour (e.g., "2024-01-01T12:00:00Z")
 */
export function deriveHour(timestamp: number): string {
  // Truncate to hour by flooring to nearest hour in milliseconds
  const hourMs = 60 * 60 * 1000
  const truncatedTimestamp = Math.floor(timestamp / hourMs) * hourMs
  const date = new Date(truncatedTimestamp)
  return date.toISOString().replace('.000Z', 'Z')
}

/**
 * Derives a severity bucket for partitioning based on log level.
 * Groups error/warn into 'error' bucket, debug/info into 'normal'.
 *
 * @param level - The log level (debug, info, warn, error)
 * @returns 'error' for error/warn, 'normal' for debug/info
 */
export function deriveSeverityBucket(
  level: 'debug' | 'info' | 'warn' | 'error'
): 'error' | 'normal' {
  return level === 'error' || level === 'warn' ? 'error' : 'normal'
}

/**
 * Transforms an ObservabilityEvent into an IcebergRow for Pipeline output.
 *
 * - Maps camelCase field names to snake_case
 * - Converts undefined optional fields to null
 * - Serializes message array and metadata object to JSON strings
 * - Derives partition columns (hour, severity_bucket)
 *
 * @param event - The ObservabilityEvent to transform
 * @returns IcebergRow ready for Pipeline insertion
 */
export function transformForIceberg(event: ObservabilityEvent): IcebergRow {
  return {
    // Required fields
    id: event.id,
    type: event.type,
    level: event.level,
    script: event.script,
    timestamp: event.timestamp,

    // Partition columns (derived)
    hour: deriveHour(event.timestamp),
    severity_bucket: deriveSeverityBucket(event.level),

    // Optional fields - convert undefined to null, snake_case names
    request_id: event.requestId ?? null,
    method: event.method ?? null,
    url: event.url ?? null,
    status: event.status ?? null,
    duration_ms: event.duration ?? null,
    do_name: event.doName ?? null,
    do_id: event.doId ?? null,
    do_method: event.doMethod ?? null,

    // JSON serialized fields
    message: event.message !== undefined ? JSON.stringify(event.message) : null,
    stack: event.stack ?? null,
    metadata:
      event.metadata !== undefined ? JSON.stringify(event.metadata) : null,
  }
}
