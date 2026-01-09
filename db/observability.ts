import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// OBSERVABILITY TABLE - Iceberg schema for Pipeline output
// ============================================================================
//
// This table defines the schema for observability events written to R2 Data Catalog
// via Cloudflare Pipelines. It captures:
// - Console logs (log)
// - Uncaught exceptions (exception)
// - HTTP requests (request)
// - Durable Object method invocations (do_method)
//
// Partition columns:
// - hour: ISO hour string derived from timestamp (e.g., "2024-01-15T14:00:00Z")
// - severity_bucket: 'error' for error/warn levels, 'normal' for info/debug
// ============================================================================

/** Valid event types for observability events */
export type ObservabilityEventType = 'log' | 'exception' | 'request' | 'do_method'

/** Valid log levels */
export type ObservabilityLevel = 'debug' | 'info' | 'warn' | 'error'

/** Valid severity buckets for partitioning */
export type SeverityBucket = 'error' | 'normal'

export const observability = sqliteTable(
  'do_observability',
  {
    // Primary key - UUID
    id: text('id').primaryKey(),

    // Event type: 'log', 'exception', 'request', 'do_method'
    type: text('type').$type<ObservabilityEventType>().notNull(),

    // Log level: 'debug', 'info', 'warn', 'error'
    level: text('level').$type<ObservabilityLevel>().notNull(),

    // Worker script name
    script: text('script').notNull(),

    // Unix timestamp in milliseconds
    timestamp: integer('timestamp').notNull(),

    // Request correlation ID (nullable)
    request_id: text('request_id'),

    // HTTP method for request events (nullable)
    method: text('method'),

    // Request URL (nullable)
    url: text('url'),

    // HTTP status code (nullable)
    status: integer('status'),

    // Duration in milliseconds (nullable)
    duration_ms: integer('duration_ms'),

    // Durable Object class name (nullable)
    do_name: text('do_name'),

    // Durable Object instance ID (nullable)
    do_id: text('do_id'),

    // Durable Object method name (nullable)
    do_method: text('do_method'),

    // Log message - JSON array of serialized log arguments (nullable)
    message: text('message'),

    // Stack trace for exceptions (nullable)
    stack: text('stack'),

    // Arbitrary JSON metadata (nullable)
    metadata: text('metadata'),

    // Partition column: ISO hour string (e.g., "2024-01-15T14:00:00Z")
    hour: text('hour').notNull(),

    // Partition column: 'error' for error/warn, 'normal' for info/debug
    severity_bucket: text('severity_bucket').$type<SeverityBucket>().notNull(),
  },
  (table) => [
    // Index for time-based queries
    index('obs_timestamp_idx').on(table.timestamp),

    // Index for partition-based queries
    index('obs_hour_idx').on(table.hour),
    index('obs_severity_bucket_idx').on(table.severity_bucket),
    index('obs_hour_severity_idx').on(table.hour, table.severity_bucket),

    // Index for type filtering
    index('obs_type_idx').on(table.type),
    index('obs_level_idx').on(table.level),

    // Index for script filtering
    index('obs_script_idx').on(table.script),

    // Index for request correlation
    index('obs_request_id_idx').on(table.request_id),

    // Index for DO queries
    index('obs_do_name_idx').on(table.do_name),
    index('obs_do_id_idx').on(table.do_id),

    // Compound indexes for common query patterns
    index('obs_script_hour_idx').on(table.script, table.hour),
    index('obs_type_hour_idx').on(table.type, table.hour),
    index('obs_level_hour_idx').on(table.level, table.hour),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Select type for observability table */
export type ObservabilityEvent = typeof observability.$inferSelect

/** Insert type for observability table */
export type NewObservabilityEvent = typeof observability.$inferInsert

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Derive the hour partition column from a timestamp.
 * Truncates to the start of the hour in ISO format.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns ISO hour string (e.g., "2024-01-15T14:00:00Z")
 */
export function deriveHour(timestamp: number): string {
  const date = new Date(timestamp)
  // Truncate to hour by setting minutes, seconds, milliseconds to 0
  date.setUTCMinutes(0, 0, 0)
  return date.toISOString().replace('.000Z', 'Z')
}

/**
 * Derive the severity bucket partition column from a log level.
 *
 * @param level - Log level ('debug', 'info', 'warn', 'error')
 * @returns Severity bucket ('error' for error/warn, 'normal' for info/debug)
 */
export function deriveSeverityBucket(level: string): SeverityBucket {
  return level === 'error' || level === 'warn' ? 'error' : 'normal'
}
