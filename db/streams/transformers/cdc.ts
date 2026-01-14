/**
 * CDC Events Transformer
 *
 * Transforms database change data capture events to the unified event schema.
 * Supports INSERT, UPDATE, and DELETE operations with full before/after state tracking.
 *
 * @module db/streams/transformers/cdc
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'

/**
 * Database operation types supported by CDC events.
 */
export type CdcOperation = 'INSERT' | 'UPDATE' | 'DELETE'

/**
 * Input CDC event structure.
 *
 * Represents a change data capture event from a database,
 * containing the operation type, affected table, and row state.
 */
export interface CdcEvent {
  /** The type of database operation */
  operation: CdcOperation
  /** The affected table name */
  table: string
  /** Optional database schema/namespace */
  schema?: string
  /** Primary key value (string for simple keys, object for composite) */
  primaryKey: string | Record<string, unknown>
  /** Row state before the operation (for UPDATE/DELETE) */
  before?: Record<string, unknown>
  /** Row state after the operation (for INSERT/UPDATE) */
  after?: Record<string, unknown>
  /** Database transaction identifier */
  transactionId?: string
  /** Log sequence number for CDC ordering */
  lsn?: number
  /** Row version for optimistic concurrency */
  version?: number
  /** Timestamp when the change occurred */
  timestamp: Date
  /** Database system (defaults to 'sqlite') */
  dbSystem?: string
}

/**
 * Transforms a CDC event to a UnifiedEvent.
 *
 * Maps database change data capture fields to the unified event schema:
 * - operation → db_operation
 * - table → db_table, resource_type
 * - schema → db_name
 * - primaryKey → db_row_id, resource_id
 * - before → db_before (JSON string)
 * - after → db_after (JSON string), data
 * - transactionId → transaction_id
 * - lsn → db_lsn (string)
 * - version → db_version
 * - Sets event_type to 'cdc'
 * - Sets event_name to '{table}.{operation}'
 *
 * @param cdc - The CDC event to transform
 * @param ns - Namespace URL identifying the event source
 * @returns Unified event with CDC-specific fields populated
 *
 * @example
 * ```typescript
 * const cdc: CdcEvent = {
 *   operation: 'INSERT',
 *   table: 'users',
 *   primaryKey: 'user-123',
 *   after: { id: 'user-123', name: 'Alice' },
 *   timestamp: new Date(),
 * }
 *
 * const event = transformCdcEvent(cdc, 'https://api.example.com/tenant-1')
 * // event.event_type === 'cdc'
 * // event.event_name === 'users.INSERT'
 * // event.db_operation === 'INSERT'
 * ```
 */
export function transformCdcEvent(cdc: CdcEvent, ns: string): UnifiedEvent {
  // Convert primary key to string (JSON for composite keys)
  const rowId =
    typeof cdc.primaryKey === 'string'
      ? cdc.primaryKey
      : JSON.stringify(cdc.primaryKey)

  // Build resource ID as ns/table/rowId
  const resourceId = `${ns}/${cdc.table}/${rowId}`

  // Determine data field: prefer after for INSERT/UPDATE, fall back to before for DELETE
  const data = cdc.after ?? cdc.before ?? null

  return createUnifiedEvent({
    // Core identity
    id: crypto.randomUUID(),
    event_type: 'cdc',
    event_name: `${cdc.table}.${cdc.operation}`,
    ns,

    // Database CDC fields
    db_system: cdc.dbSystem ?? 'sqlite',
    db_name: cdc.schema ?? null,
    db_table: cdc.table,
    db_operation: cdc.operation,
    db_row_id: rowId,
    db_lsn: cdc.lsn != null ? String(cdc.lsn) : null,
    db_version: cdc.version ?? null,
    db_before: cdc.before ? JSON.stringify(cdc.before) : null,
    db_after: cdc.after ? JSON.stringify(cdc.after) : null,

    // Resource fields
    resource_type: cdc.table,
    resource_id: resourceId,

    // Causality chain
    transaction_id: cdc.transactionId ?? null,

    // Timing
    timestamp: cdc.timestamp.toISOString(),

    // Flexible payloads
    data,
  })
}
