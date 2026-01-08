/**
 * Cloudflare Pipelines SQL definitions for streaming DO data to R2 SQL
 *
 * These SQL transformations stream data from Durable Objects to R2 Iceberg tables
 * for global queryability and analytics.
 *
 * Pipelines:
 * - things: Thing versions for cross-DO queries
 * - events: Domain events for analytics
 * - actions: Audit log for SOC2 compliance
 */

// SQL file paths (relative to package root)
export const SQL_FILES = {
  things: './streams/things.sql',
  events: './streams/events.sql',
  actions: './streams/actions.sql',
} as const

// Target table names
export const TABLES = {
  things: 'do_things',
  events: 'do_events',
  actions: 'do_actions',
} as const

// Source stream names
export const STREAMS = {
  things: 'things_stream',
  events: 'events_stream',
  actions: 'actions_stream',
} as const

/**
 * Thing record schema for do_things table
 */
export interface ThingRecord {
  id: string // Full URL: ns + '/' + id
  type: string // Full URL: ns + '/' + type
  version: number
  branch: string
  name: string
  data: Record<string, unknown>
  deleted: boolean
  action_id: string
  timestamp: string
  ns: string
}

/**
 * Event record schema for do_events table
 */
export interface EventRecord {
  verb: string
  source: string // Full URL: ns + '/' + source
  source_type: string // Full URL: ns + '/' + sourceType
  data: Record<string, unknown>
  action_id: string
  timestamp: string
  ns: string
}

/**
 * Action record schema for do_actions table (audit log)
 */
export interface ActionRecord {
  id: string
  verb: string
  actor: string // Full URL (may already be URL or ns + '/' + actor)
  target: string // Full URL: ns + '/' + target
  input_version: number
  output_version: number
  durability: 'do' | 'local' | 'confirmed'
  status: 'completed' | 'failed'
  error: string | null
  request_id: string | null
  session_id: string | null
  workflow_id: string | null
  started_at: string
  completed_at: string
  duration_ms: number
  timestamp: string
  ns: string
}
