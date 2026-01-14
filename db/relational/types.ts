/**
 * RelationalStore Types
 *
 * Type definitions for the RelationalStore primitive
 */

import type { SQLiteTableWithColumns, TableConfig, SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { SQL } from 'drizzle-orm'

/** CDC event types */
export type CDCEventType = 'cdc.insert' | 'cdc.update' | 'cdc.delete'

/** CDC operation codes (Debezium-style) */
export type CDCOp = 'c' | 'u' | 'd'

/** CDC event emitted on mutations */
export interface CDCEvent {
  type: CDCEventType
  op: CDCOp
  store: 'relational'
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  seq: number
  ts: number
  txId?: string
}

/** CDC event handler type */
export type CDCEventHandler = (event: CDCEvent) => void

/** Foreign key reference */
export interface ForeignKeyReference {
  column: string
  references: {
    table: string
    column: string
  }
}

/** Table constraints */
export interface TableConstraints {
  primaryKey: string
  unique: string[]
  notNull: string[]
}

/** Migration definition */
export interface Migration {
  version: number
  up: (db: MigrationDB) => Promise<void>
  down: (db: MigrationDB) => Promise<void>
}

/** Migration history entry */
export interface MigrationHistoryEntry {
  version: number
  appliedAt: Date
}

/** Migration database interface */
export interface MigrationDB {
  run: (sql: SQL) => Promise<void>
}

/** Schema evolution modes */
export type EvolutionMode = 'BACKWARD' | 'FORWARD' | 'FULL'

/** Schema change types */
export type SchemaChange =
  | {
      type: 'ADD_COLUMN'
      table: string
      column: { name: string; type: string; nullable: boolean; default?: unknown }
    }
  | {
      type: 'DROP_COLUMN'
      table: string
      column: string
    }
  | {
      type: 'RENAME_COLUMN'
      table: string
      from: string
      to: string
    }
  | {
      type: 'MODIFY_COLUMN'
      table: string
      column: string
      changes: Partial<{ type: string; nullable: boolean; default: unknown }>
    }

/** Compatibility check result */
export interface CompatibilityResult {
  ok: boolean
  errors?: string[]
}

/** Generic table type */
export type AnyTable = SQLiteTableWithColumns<TableConfig>

/** Schema map type */
export type SchemaMap = Record<string, AnyTable>

/** Extract select type from table */
export type InferSelect<T extends AnyTable> = T['$inferSelect']

/** Extract insert type from table */
export type InferInsert<T extends AnyTable> = T['$inferInsert']

/** Internal database interface - what we expect from the db argument */
export interface InternalDB {
  run: (sql: string, ...params: unknown[]) => unknown
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown[]; run: (...params: unknown[]) => unknown }
  exec: (sql: string) => void
}
