/**
 * ConnectorFramework Types - Shared type definitions for sources
 *
 * Types used by source connectors in the connector framework.
 *
 * @module db/primitives/connector-framework/types
 */

/**
 * Source state for incremental sync
 */
export interface SourceState {
  /** Cursor position for incremental reads */
  cursor?: string | number
  /** Last sync timestamp */
  lastSyncAt?: number
  /** Stream-specific state */
  streams?: Record<string, Record<string, unknown>>
  /** Checksum for state validation */
  checksum?: string
}

/**
 * Generic record type for sources
 */
export interface Record {
  /** Unique identifier */
  id: string
  /** Record data */
  data: unknown
  /** Timestamp when record was emitted */
  emittedAt: number
  /** Stream this record belongs to */
  stream?: string
  /** Namespace for the stream */
  namespace?: string
}

/**
 * Source connector interface
 */
export interface Source {
  /** Connector name */
  name: string
  /** Initialize the source */
  initialize(): Promise<void>
  /** Read records from the source */
  read(state?: SourceState): Promise<{ records: Record[]; state: SourceState }>
  /** Get current state */
  getState(): Promise<SourceState>
  /** Close the source and cleanup */
  close(): Promise<void>
}

/**
 * Destination connector interface
 */
export interface Destination {
  /** Connector name */
  name: string
  /** Initialize the destination */
  initialize(): Promise<void>
  /** Write records to the destination */
  write(records: Record[]): Promise<{ written: number; failed: number }>
  /** Commit pending writes */
  commit(): Promise<void>
  /** Close the destination and cleanup */
  close(): Promise<void>
}

/**
 * Transform function for record mapping
 */
export type Transform = (record: Record) => Record | null | Promise<Record | null>
