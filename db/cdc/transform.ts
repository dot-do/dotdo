/**
 * CDC Transform helpers - event creation and pipeline transformation
 */

import type {
  UnifiedEvent,
  PartialEvent,
  PipelineEvent,
  CDCOperation,
} from './types'

/**
 * Simple ULID generator - Universally Unique Lexicographically Sortable Identifier
 *
 * ULID format: 26 characters total
 * - 10 characters: timestamp (ms since Unix epoch, base32)
 * - 16 characters: randomness (base32)
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford's base32

function ulid(): string {
  const now = Date.now()

  // Encode timestamp (10 characters)
  let timestamp = now
  let timeStr = ''
  for (let i = 0; i < 10; i++) {
    timeStr = ENCODING[timestamp % 32] + timeStr
    timestamp = Math.floor(timestamp / 32)
  }

  // Encode random (16 characters)
  let randStr = ''
  for (let i = 0; i < 16; i++) {
    randStr += ENCODING[Math.floor(Math.random() * 32)]
  }

  return timeStr + randStr
}

/**
 * Map CDC operation to event type
 */
function opToType(op?: CDCOperation): string {
  switch (op) {
    case 'c':
      return 'cdc.insert'
    case 'u':
      return 'cdc.update'
    case 'd':
      return 'cdc.delete'
    case 'r':
      return 'cdc.read'
    default:
      return 'cdc.unknown'
  }
}

/**
 * Create a UnifiedEvent from partial input with auto-generated fields
 */
export function createCDCEvent(partial: PartialEvent & { ns?: string }): UnifiedEvent {
  const id = ulid()
  const timestamp = new Date().toISOString()

  // Generate type from op if not provided
  const type = partial.type ?? opToType(partial.op)

  return {
    id,
    type,
    timestamp,
    ns: partial.ns ?? '',
    ...partial,
    _meta: {
      schemaVersion: 1,
      source: partial._meta?.source ?? '',
      ...partial._meta,
    },
  } as UnifiedEvent
}

/**
 * Transform a UnifiedEvent for pipeline/R2 SQL storage
 *
 * - Expands local IDs to global URLs
 * - Serializes complex fields to JSON strings
 * - Renames correlationId to correlation_id
 */
export function transformForPipeline(event: UnifiedEvent): PipelineEvent {
  const source = event._meta?.source
    ? `${event.ns}/${event._meta.source}`
    : event.ns

  const tableUrl = event.table
    ? `${event.ns}/${event.table}`
    : null

  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    ns: event.ns,
    source,
    table_url: tableUrl,
    op: event.op ?? null,
    store: event.store ?? null,
    key: event.key ?? null,
    before: event.before !== undefined ? JSON.stringify(event.before) : null,
    after: event.after !== undefined ? JSON.stringify(event.after) : null,
    actor: event.actor ?? null,
    data: event.data !== undefined ? JSON.stringify(event.data) : null,
    correlation_id: event.correlationId ?? null,
    _meta: JSON.stringify(event._meta ?? { schemaVersion: 1, source: '' }),
  }
}
