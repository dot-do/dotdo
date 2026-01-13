/**
 * Database Source Connectors - Stubs
 *
 * SQL and NoSQL database source connectors for the connector framework.
 * These stubs define the interface - full implementation pending.
 *
 * @module db/primitives/connector-framework/sources/database
 */

import type { Source, SourceState, Record as SourceRecord } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Base database source configuration
 */
export interface DatabaseSourceConfig {
  /** Connection string or host */
  connectionString?: string
  host?: string
  port?: number
  database: string
  /** Table/collection name */
  table: string
  /** Credentials */
  username?: string
  password?: string
  /** SSL configuration */
  ssl?: boolean | {
    ca?: string
    cert?: string
    key?: string
    rejectUnauthorized?: boolean
  }
  /** Connection pool size */
  poolSize?: number
  /** Query timeout in ms */
  timeout?: number
  /** ID field name */
  idField?: string
  /** Updated at field name (for incremental sync) */
  updatedAtField?: string
  /** Batch size for reads */
  batchSize?: number
}

/**
 * PostgreSQL source configuration
 */
export interface PostgresSourceConfig extends DatabaseSourceConfig {
  /** Schema name */
  schema?: string
  /** Custom query (overrides table) */
  query?: string
}

/**
 * MySQL source configuration
 */
export interface MySQLSourceConfig extends DatabaseSourceConfig {
  /** Character set */
  charset?: string
  /** Custom query (overrides table) */
  query?: string
}

/**
 * MongoDB source configuration
 */
export interface MongoDBSourceConfig extends Omit<DatabaseSourceConfig, 'table'> {
  /** Collection name */
  collection: string
  /** MongoDB query filter */
  filter?: Record<string, unknown>
  /** Projection (fields to include/exclude) */
  projection?: Record<string, 0 | 1>
  /** Sort order */
  sort?: Record<string, 1 | -1>
  /** Auth database */
  authSource?: string
  /** Replica set name */
  replicaSet?: string
}

// ============================================================================
// Factory Functions (Stubs)
// ============================================================================

/**
 * Create a PostgreSQL source connector
 */
export function createPostgresSource(_config: PostgresSourceConfig): Source {
  return {
    name: 'postgres',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      throw new Error('Not implemented')
    },
  }
}

/**
 * Create a MySQL source connector
 */
export function createMySQLSource(_config: MySQLSourceConfig): Source {
  return {
    name: 'mysql',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      throw new Error('Not implemented')
    },
  }
}

/**
 * Create a MongoDB source connector
 */
export function createMongoDBSource(_config: MongoDBSourceConfig): Source {
  return {
    name: 'mongodb',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      throw new Error('Not implemented')
    },
  }
}
