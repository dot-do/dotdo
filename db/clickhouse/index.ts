// ============================================================================
// CLICKHOUSE MODULE FOR DOTDO
// ============================================================================
//
// ClickHouse schema, types, and utilities for analytics.
//
// Usage:
//   import { Thing, Action, Event } from '../db/clickhouse'
//   import { encodeThingRef, encodeActor } from '../db/clickhouse'
//
// Schema files:
//   - schema.sql: Table definitions
//   - functions.sql: Helper functions
//
// ============================================================================

export * from './types'

// Re-export Tag enum for convenience
export { Tag } from '../../lib/sqids'
