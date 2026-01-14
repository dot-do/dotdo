/**
 * CDC Types - Unified event format for change data capture
 */

/**
 * Store types for CDC events
 */
export type StoreType =
  | 'document'
  | 'graph'
  | 'relational'
  | 'columnar'
  | 'timeseries'
  | 'vector'

/**
 * CDC operation types
 */
export type CDCOperation = 'c' | 'u' | 'd' | 'r'

/**
 * Event visibility levels
 */
export type EventVisibility = 'user' | 'team' | 'public'

/**
 * Event metadata
 */
export interface EventMeta {
  /** Event schema version */
  schemaVersion: number
  /** Source service/worker */
  source: string
  /** Retry count */
  retries?: number
}

/**
 * UnifiedEvent - The common event format for all CDC and domain events
 */
export interface UnifiedEvent {
  // ===== ENVELOPE (always present) =====
  /** Unique event ID (ULID) */
  id: string
  /** Event type: 'Customer.created' | 'cdc.insert' */
  type: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** DO namespace (tenant identifier) */
  ns: string
  /** Request correlation ID */
  correlationId?: string

  // ===== CDC FIELDS (for store mutations) =====
  /** Operation: create/update/delete/read */
  op?: CDCOperation
  /** Store type */
  store?: StoreType
  /** Table/collection name */
  table?: string
  /** Primary key */
  key?: string
  /** Previous state (for u/d) */
  before?: Record<string, unknown>
  /** New state (for c/u) */
  after?: Record<string, unknown>
  /** Transaction ID (for batched changes) */
  txid?: string
  /** Log sequence number (ordering) */
  lsn?: number

  // ===== DOMAIN EVENT FIELDS =====
  /** Who triggered this (User/alice) */
  actor?: string
  /** Domain-specific payload */
  data?: Record<string, unknown>
  /** Access control */
  visibility?: EventVisibility

  // ===== METADATA =====
  /** Event metadata */
  _meta?: EventMeta
}

/**
 * Partial event input for emit methods (before id/timestamp/ns are added)
 */
export type PartialEvent = Partial<Omit<UnifiedEvent, 'id' | 'timestamp' | 'ns'>> & {
  type?: string
  op?: CDCOperation
  store?: StoreType
}

/**
 * Options for CDCEmitter constructor
 */
export interface CDCEmitterOptions {
  /** DO namespace (tenant identifier) */
  ns: string
  /** Source identifier (e.g., 'DO/customers') */
  source: string
}

/**
 * Options for emit methods
 */
export interface EmitOptions {
  /** Correlation ID for tracing */
  correlationId?: string
  /** Transaction ID for batching */
  txid?: string
}

/**
 * Pipeline-transformed event format (for R2/SQL)
 */
export interface PipelineEvent {
  id: string
  type: string
  timestamp: string
  ns: string
  source: string
  table_url: string | null
  op: CDCOperation | null
  store: StoreType | null
  key: string | null
  before: string | null
  after: string | null
  actor: string | null
  data: string | null
  correlation_id: string | null
  _meta: string
}
