/**
 * Migration Helpers
 *
 * Strategy-specific helpers available inside migration up/down functions.
 *
 * Things mode helpers:
 * - createJsonIndex / dropJsonIndex / listJsonIndexes
 * - bulkUpdateData (data transforms via Payload API)
 *
 * Drizzle mode helpers:
 * - execute (raw SQL execution)
 * - generateSchema / diffSchema (schema utilities)
 *
 * @module @dotdo/payload/migrations/helpers
 */

import { sql } from 'drizzle-orm'
import type { StorageMode, WhereClause, Payload, PayloadRequest } from '../strategies/types'
import type { PayloadDocument, PayloadCollection } from '../adapter/types'
import {
  createJsonIndex as coreCreateJsonIndex,
  dropJsonIndex as coreDropJsonIndex,
  listJsonIndexes as coreListJsonIndexes,
  type JsonIndexInfo,
} from '../../../json-indexes'
import {
  diffSchemas,
  generateCreateTableDDL,
  generateDropTableDDL,
  type SchemaDiff,
  type DDLStatement,
} from '../strategies/drizzle/migrations'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base migration arguments passed to up/down functions
 */
export interface BaseMigrateArgs {
  /** Payload instance for data operations */
  payload: MigrationPayload
  /** Request context */
  req?: PayloadRequest
  /** Transaction/session ID */
  session?: string
}

/**
 * Migration arguments for Things mode
 */
export interface ThingsMigrateArgs extends BaseMigrateArgs {
  /** Things-specific helpers */
  helpers: ThingsMigrationHelpers
}

/**
 * Migration arguments for Drizzle mode
 */
export interface DrizzleMigrateArgs extends BaseMigrateArgs {
  /** Execute raw SQL */
  execute: ExecuteFunction
  /** Drizzle-specific helpers */
  helpers?: DrizzleMigrationHelpers
}

/**
 * Union type for migrate up/down args
 */
export type MigrateUpArgs = ThingsMigrateArgs | DrizzleMigrateArgs
export type MigrateDownArgs = ThingsMigrateArgs | DrizzleMigrateArgs

/**
 * Minimal Payload interface for migrations
 */
export interface MigrationPayload {
  find<T = PayloadDocument>(args: {
    collection: string
    where?: WhereClause
    limit?: number
    page?: number
    sort?: string
  }): Promise<{ docs: T[]; totalDocs: number }>

  findByID<T = PayloadDocument>(args: {
    collection: string
    id: string
  }): Promise<T | null>

  update<T = PayloadDocument>(args: {
    collection: string
    id: string
    data: Record<string, unknown>
  }): Promise<T>

  create<T = PayloadDocument>(args: {
    collection: string
    data: Record<string, unknown>
  }): Promise<T>

  delete(args: {
    collection: string
    id: string
  }): Promise<PayloadDocument>

  /** Database adapter reference */
  db: {
    execute?: ExecuteFunction
    $client?: unknown
  }
}

/**
 * Execute function type for raw SQL
 */
export type ExecuteFunction = (query: string) => Promise<void>

// ============================================================================
// THINGS MODE HELPERS
// ============================================================================

/**
 * Options for creating a JSON index
 */
export interface CreateJsonIndexOptions {
  /** Collection slug */
  collection: string
  /** JSON path to index (e.g., 'publishedAt', 'author.name') */
  path: string
  /** Whether the index should be unique */
  unique?: boolean
}

/**
 * Options for dropping a JSON index
 */
export interface DropJsonIndexOptions {
  /** Collection slug */
  collection: string
  /** JSON path that was indexed */
  path: string
}

/**
 * Options for bulk data update
 */
export interface BulkUpdateOptions<T = PayloadDocument> {
  /** Collection slug */
  collection: string
  /** Where clause to filter documents */
  where?: WhereClause
  /** Transform function applied to each document */
  transform: (doc: T) => Record<string, unknown>
  /** Batch size for processing */
  batchSize?: number
}

/**
 * Result of bulk update operation
 */
export interface BulkUpdateResult {
  /** Number of documents updated */
  updated: number
  /** Number of documents skipped */
  skipped: number
  /** Errors encountered */
  errors: Array<{ id: string; error: Error }>
}

/**
 * Things mode migration helpers
 */
export interface ThingsMigrationHelpers {
  /**
   * Create a JSON path index on a collection.
   * Improves query performance for frequently accessed fields.
   */
  createJsonIndex(options: CreateJsonIndexOptions): Promise<void>

  /**
   * Drop a JSON path index from a collection.
   */
  dropJsonIndex(options: DropJsonIndexOptions): Promise<void>

  /**
   * List all JSON indexes on a collection.
   */
  listJsonIndexes(collection: string): Promise<JsonIndexInfo[]>

  /**
   * Bulk update documents with a transform function.
   * Uses pagination to handle large datasets efficiently.
   */
  bulkUpdateData<T = PayloadDocument>(options: BulkUpdateOptions<T>): Promise<BulkUpdateResult>
}

/**
 * Create Things mode migration helpers.
 *
 * @param db - Database instance
 * @param payload - Payload instance
 * @param getTypeId - Function to get type ID for a collection
 * @returns Things migration helpers
 */
export function createThingsMigrationHelpers(
  db: any,
  payload: MigrationPayload,
  getTypeId: (collection: string) => Promise<number>
): ThingsMigrationHelpers {
  return {
    async createJsonIndex(options: CreateJsonIndexOptions): Promise<void> {
      const typeId = await getTypeId(options.collection)
      await coreCreateJsonIndex(db, {
        table: 'things',
        path: options.path,
        typeId,
      })
    },

    async dropJsonIndex(options: DropJsonIndexOptions): Promise<void> {
      const typeId = await getTypeId(options.collection)
      await coreDropJsonIndex(db, {
        table: 'things',
        path: options.path,
        typeId,
      })
    },

    async listJsonIndexes(collection: string): Promise<JsonIndexInfo[]> {
      const typeId = await getTypeId(collection)
      const allIndexes = await coreListJsonIndexes(db, 'things')
      return allIndexes.filter((idx) => idx.typeId === typeId)
    },

    async bulkUpdateData<T = PayloadDocument>(
      options: BulkUpdateOptions<T>
    ): Promise<BulkUpdateResult> {
      const { collection, where, transform, batchSize = 100 } = options

      const result: BulkUpdateResult = {
        updated: 0,
        skipped: 0,
        errors: [],
      }

      let page = 1
      let hasMore = true

      while (hasMore) {
        const response = await payload.find<T>({
          collection,
          where,
          limit: batchSize,
          page,
        })

        for (const doc of response.docs) {
          try {
            const transformed = transform(doc)

            // Skip if transform returns same data
            if (!transformed || Object.keys(transformed).length === 0) {
              result.skipped++
              continue
            }

            await payload.update({
              collection,
              id: (doc as any).id,
              data: transformed,
            })

            result.updated++
          } catch (error) {
            result.errors.push({
              id: (doc as any).id,
              error: error as Error,
            })
          }
        }

        hasMore = response.docs.length === batchSize
        page++
      }

      return result
    },
  }
}

// ============================================================================
// DRIZZLE MODE HELPERS
// ============================================================================

/**
 * Drizzle mode migration helpers
 */
export interface DrizzleMigrationHelpers {
  /**
   * Generate DDL for a collection.
   */
  generateDDL(collection: PayloadCollection): DDLStatement[]

  /**
   * Diff two sets of collection schemas.
   */
  diffSchema(
    oldCollections: PayloadCollection[],
    newCollections: PayloadCollection[]
  ): SchemaDiff

  /**
   * Generate CREATE TABLE SQL for a collection.
   */
  generateCreateTable(collection: PayloadCollection): string

  /**
   * Generate DROP TABLE SQL for a collection.
   */
  generateDropTable(collectionSlug: string): string
}

/**
 * Create Drizzle mode migration helpers.
 *
 * @param db - Database instance
 * @param tablePrefix - Table name prefix
 * @returns Drizzle migration helpers
 */
export function createDrizzleMigrationHelpers(
  db: any,
  tablePrefix = ''
): DrizzleMigrationHelpers {
  return {
    generateDDL(collection: PayloadCollection): DDLStatement[] {
      const statements: DDLStatement[] = []
      statements.push(generateCreateTableDDL(collection, tablePrefix))
      return statements
    },

    diffSchema(
      oldCollections: PayloadCollection[],
      newCollections: PayloadCollection[]
    ): SchemaDiff {
      return diffSchemas(oldCollections, newCollections)
    },

    generateCreateTable(collection: PayloadCollection): string {
      return generateCreateTableDDL(collection, tablePrefix).sql
    },

    generateDropTable(collectionSlug: string): string {
      return generateDropTableDDL(collectionSlug, tablePrefix).sql
    },
  }
}

/**
 * Create an execute function for raw SQL.
 *
 * @param db - Database instance
 * @returns Execute function
 */
export function createExecuteFunction(db: any): ExecuteFunction {
  return async (query: string): Promise<void> => {
    const connection = db.$client || db

    if (typeof connection.exec === 'function') {
      // better-sqlite3
      connection.exec(query)
    } else if (typeof connection.run === 'function') {
      // D1 or other async sqlite
      await connection.run(query)
    } else if (typeof db.run === 'function') {
      // Drizzle
      await db.run(sql.raw(query))
    } else {
      throw new Error('Unable to execute SQL: unsupported database type')
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create migration helpers for the given strategy.
 *
 * @param strategy - Storage strategy
 * @param db - Database instance
 * @param payload - Payload instance
 * @param options - Additional options
 * @returns Migration helpers appropriate for the strategy
 */
export function createMigrationHelpers(
  strategy: StorageMode,
  db: any,
  payload: MigrationPayload,
  options: {
    getTypeId?: (collection: string) => Promise<number>
    tablePrefix?: string
  } = {}
): ThingsMigrationHelpers | DrizzleMigrationHelpers {
  if (strategy === 'things') {
    if (!options.getTypeId) {
      throw new Error('getTypeId function required for Things strategy helpers')
    }
    return createThingsMigrationHelpers(db, payload, options.getTypeId)
  }

  return createDrizzleMigrationHelpers(db, options.tablePrefix)
}

/**
 * Build migration arguments for up/down functions.
 *
 * @param strategy - Storage strategy
 * @param db - Database instance
 * @param payload - Payload instance
 * @param options - Additional options
 * @returns Migration arguments
 */
export function buildMigrateArgs(
  strategy: StorageMode,
  db: any,
  payload: MigrationPayload,
  options: {
    req?: PayloadRequest
    session?: string
    getTypeId?: (collection: string) => Promise<number>
    tablePrefix?: string
  } = {}
): MigrateUpArgs {
  const { req, session, getTypeId, tablePrefix } = options

  if (strategy === 'things') {
    if (!getTypeId) {
      throw new Error('getTypeId function required for Things strategy')
    }
    return {
      payload,
      req,
      session,
      helpers: createThingsMigrationHelpers(db, payload, getTypeId),
    }
  }

  return {
    payload,
    req,
    session,
    execute: createExecuteFunction(db),
    helpers: createDrizzleMigrationHelpers(db, tablePrefix),
  }
}
