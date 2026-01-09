/**
 * Migration Support for DrizzleStorageStrategy
 *
 * Provides migration utilities for the Drizzle strategy, including:
 * - Schema DDL generation for up/down migrations
 * - Migration template generation
 * - Schema diff detection
 * - Integration with Payload's migration system
 *
 * @module @dotdo/payload/strategies/drizzle/migrations
 */

import { sql } from 'drizzle-orm'
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import type { PayloadCollection, PayloadField, PayloadFieldType } from '../../adapter/types'
import type { SchemaBuilder, CollectionSchema } from './schema-builder'
import type {
  Migration,
  MigrateCreateResult,
  MigrationStore,
} from '../../adapter/operations/migrations'

// ============================================================================
// TYPES
// ============================================================================

/**
 * DDL statement for a table
 */
export interface DDLStatement {
  /** SQL statement */
  sql: string
  /** Table affected */
  table: string
  /** Operation type */
  operation: 'create' | 'drop' | 'alter' | 'index'
  /** Description */
  description: string
}

/**
 * Schema diff result
 */
export interface SchemaDiff {
  /** Tables to create */
  create: string[]
  /** Tables to drop */
  drop: string[]
  /** Columns to add */
  addColumns: Array<{ table: string; column: string; type: string }>
  /** Columns to drop */
  dropColumns: Array<{ table: string; column: string }>
  /** Indexes to add */
  addIndexes: Array<{ table: string; name: string; columns: string[] }>
  /** Indexes to drop */
  dropIndexes: Array<{ table: string; name: string }>
  /** Has changes */
  hasChanges: boolean
}

/**
 * Migration helpers for Drizzle mode
 */
export interface DrizzleMigrationHelpers {
  /** Execute raw SQL */
  execute: (query: string) => Promise<void>
  /** Get schema builder */
  getSchemaBuilder: () => SchemaBuilder
  /** Generate DDL for a collection */
  generateDDL: (collection: PayloadCollection) => DDLStatement[]
  /** Detect schema differences */
  diffSchema: (
    oldCollections: PayloadCollection[],
    newCollections: PayloadCollection[]
  ) => SchemaDiff
}

// ============================================================================
// DDL GENERATION
// ============================================================================

/**
 * Field type to SQLite type mapping
 */
const SQLITE_TYPE_MAP: Record<PayloadFieldType, string> = {
  text: 'TEXT',
  textarea: 'TEXT',
  email: 'TEXT',
  code: 'TEXT',
  richText: 'TEXT',
  date: 'TEXT',
  checkbox: 'INTEGER',
  select: 'TEXT',
  radio: 'TEXT',
  number: 'REAL',
  json: 'TEXT',
  relationship: 'TEXT',
  upload: 'TEXT',
  array: 'TEXT',
  group: 'TEXT',
  row: 'TEXT',
  collapsible: 'TEXT',
  tabs: 'TEXT',
  blocks: 'TEXT',
  point: 'TEXT',
}

/**
 * Generate CREATE TABLE DDL for a collection.
 *
 * @param collection - The collection configuration
 * @param tablePrefix - Optional table name prefix
 * @returns DDL statement
 */
export function generateCreateTableDDL(
  collection: PayloadCollection,
  tablePrefix = ''
): DDLStatement {
  const tableName = `${tablePrefix}${collection.slug}`
  const columns: string[] = []

  // ID column
  columns.push('"id" TEXT PRIMARY KEY NOT NULL')

  // Timestamp columns
  if (collection.timestamps !== false) {
    columns.push('"createdAt" TEXT NOT NULL')
    columns.push('"updatedAt" TEXT NOT NULL')
  }

  // Status column for drafts
  columns.push('"_status" TEXT')

  // Field columns
  for (const field of collection.fields) {
    const columnDef = fieldToColumnDDL(field)
    if (columnDef) {
      columns.push(columnDef)
    }
  }

  const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columns.join(',\n  ')}\n);`

  return {
    sql: ddl,
    table: tableName,
    operation: 'create',
    description: `Create table for ${collection.slug} collection`,
  }
}

/**
 * Generate DROP TABLE DDL for a collection.
 *
 * @param collectionSlug - The collection slug
 * @param tablePrefix - Optional table name prefix
 * @returns DDL statement
 */
export function generateDropTableDDL(
  collectionSlug: string,
  tablePrefix = ''
): DDLStatement {
  const tableName = `${tablePrefix}${collectionSlug}`
  const ddl = `DROP TABLE IF EXISTS "${tableName}";`

  return {
    sql: ddl,
    table: tableName,
    operation: 'drop',
    description: `Drop table for ${collectionSlug} collection`,
  }
}

/**
 * Generate ADD COLUMN DDL.
 *
 * @param tableName - Table name
 * @param field - Field to add
 * @returns DDL statement
 */
export function generateAddColumnDDL(
  tableName: string,
  field: PayloadField
): DDLStatement {
  const columnDef = fieldToColumnDDL(field, false) // No NOT NULL for ALTER
  const ddl = `ALTER TABLE "${tableName}" ADD COLUMN ${columnDef};`

  return {
    sql: ddl,
    table: tableName,
    operation: 'alter',
    description: `Add column ${field.name} to ${tableName}`,
  }
}

/**
 * Generate CREATE INDEX DDL.
 *
 * @param tableName - Table name
 * @param columnName - Column name
 * @param unique - Whether index is unique
 * @returns DDL statement
 */
export function generateCreateIndexDDL(
  tableName: string,
  columnName: string,
  unique = false
): DDLStatement {
  const indexName = `${tableName}_${columnName}_idx`
  const uniqueKeyword = unique ? 'UNIQUE ' : ''
  const ddl = `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" ("${columnName}");`

  return {
    sql: ddl,
    table: tableName,
    operation: 'index',
    description: `Create ${unique ? 'unique ' : ''}index on ${tableName}.${columnName}`,
  }
}

/**
 * Generate DROP INDEX DDL.
 *
 * @param tableName - Table name
 * @param columnName - Column name
 * @returns DDL statement
 */
export function generateDropIndexDDL(
  tableName: string,
  columnName: string
): DDLStatement {
  const indexName = `${tableName}_${columnName}_idx`
  const ddl = `DROP INDEX IF EXISTS "${indexName}";`

  return {
    sql: ddl,
    table: tableName,
    operation: 'index',
    description: `Drop index on ${tableName}.${columnName}`,
  }
}

/**
 * Generate CREATE TABLE DDL for versions table.
 *
 * @param collectionSlug - The collection slug
 * @param tablePrefix - Optional table name prefix
 * @returns DDL statement
 */
export function generateVersionsTableDDL(
  collectionSlug: string,
  tablePrefix = ''
): DDLStatement {
  const tableName = `${tablePrefix}${collectionSlug}_versions`

  const columns = [
    '"id" TEXT PRIMARY KEY NOT NULL',
    '"parent_id" TEXT NOT NULL',
    '"version_number" INTEGER NOT NULL',
    '"type" TEXT NOT NULL DEFAULT \'draft\'',
    '"label" TEXT',
    '"created_by" TEXT',
    '"created_at" TEXT NOT NULL',
    '"snapshot" TEXT NOT NULL',
  ]

  const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columns.join(',\n  ')}\n);`

  return {
    sql: ddl,
    table: tableName,
    operation: 'create',
    description: `Create versions table for ${collectionSlug} collection`,
  }
}

/**
 * Generate CREATE TABLE DDL for relationship join table.
 *
 * @param collectionSlug - The collection slug
 * @param fieldName - The relationship field name
 * @param polymorphic - Whether the relationship is polymorphic
 * @param tablePrefix - Optional table name prefix
 * @returns DDL statement
 */
export function generateRelationTableDDL(
  collectionSlug: string,
  fieldName: string,
  polymorphic = false,
  tablePrefix = ''
): DDLStatement {
  const tableName = `${tablePrefix}${collectionSlug}_${fieldName}_rels`

  const columns = [
    '"id" TEXT PRIMARY KEY NOT NULL',
    '"parent_id" TEXT NOT NULL',
    '"path" TEXT NOT NULL',
    '"order" INTEGER NOT NULL',
  ]

  if (polymorphic) {
    columns.push('"relation_to" TEXT NOT NULL')
  }

  columns.push('"related_id" TEXT NOT NULL')

  const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columns.join(',\n  ')}\n);`

  return {
    sql: ddl,
    table: tableName,
    operation: 'create',
    description: `Create relationship table for ${collectionSlug}.${fieldName}`,
  }
}

/**
 * Convert a Payload field to column DDL.
 */
function fieldToColumnDDL(field: PayloadField, allowNotNull = true): string | null {
  // Skip layout-only fields
  if (field.type === 'row' || field.type === 'collapsible' || field.type === 'tabs') {
    return null
  }

  // Skip many-to-many relationships (stored in join table)
  if ((field.type === 'relationship' || field.type === 'upload') && field.hasMany) {
    return null
  }

  const sqliteType = SQLITE_TYPE_MAP[field.type] || 'TEXT'
  let columnDef = `"${field.name}" ${sqliteType}`

  // Add NOT NULL constraint
  if (allowNotNull && field.required) {
    columnDef += ' NOT NULL'
  }

  // Add default value
  if (field.defaultValue !== undefined) {
    if (typeof field.defaultValue === 'string') {
      columnDef += ` DEFAULT '${field.defaultValue}'`
    } else if (typeof field.defaultValue === 'number') {
      columnDef += ` DEFAULT ${field.defaultValue}`
    } else if (typeof field.defaultValue === 'boolean') {
      columnDef += ` DEFAULT ${field.defaultValue ? 1 : 0}`
    }
  }

  return columnDef
}

// ============================================================================
// SCHEMA DIFF
// ============================================================================

/**
 * Diff two collection schemas to find changes.
 *
 * @param oldCollections - Previous collection configurations
 * @param newCollections - New collection configurations
 * @returns Schema diff
 */
export function diffSchemas(
  oldCollections: PayloadCollection[],
  newCollections: PayloadCollection[]
): SchemaDiff {
  const diff: SchemaDiff = {
    create: [],
    drop: [],
    addColumns: [],
    dropColumns: [],
    addIndexes: [],
    dropIndexes: [],
    hasChanges: false,
  }

  const oldSlugs = new Set(oldCollections.map((c) => c.slug))
  const newSlugs = new Set(newCollections.map((c) => c.slug))
  const oldBySlug = new Map(oldCollections.map((c) => [c.slug, c]))
  const newBySlug = new Map(newCollections.map((c) => [c.slug, c]))

  // Find tables to create
  for (const slug of newSlugs) {
    if (!oldSlugs.has(slug)) {
      diff.create.push(slug)
      diff.hasChanges = true
    }
  }

  // Find tables to drop
  for (const slug of oldSlugs) {
    if (!newSlugs.has(slug)) {
      diff.drop.push(slug)
      diff.hasChanges = true
    }
  }

  // Find column changes in existing tables
  for (const slug of newSlugs) {
    if (!oldSlugs.has(slug)) continue

    const oldCollection = oldBySlug.get(slug)!
    const newCollection = newBySlug.get(slug)!

    const oldFields = new Map(oldCollection.fields.map((f) => [f.name, f]))
    const newFields = new Map(newCollection.fields.map((f) => [f.name, f]))

    // Find columns to add
    for (const [fieldName, field] of newFields) {
      if (!oldFields.has(fieldName)) {
        const sqliteType = SQLITE_TYPE_MAP[field.type] || 'TEXT'
        diff.addColumns.push({ table: slug, column: fieldName, type: sqliteType })
        diff.hasChanges = true
      }
    }

    // Find columns to drop (SQLite doesn't support DROP COLUMN easily)
    for (const fieldName of oldFields.keys()) {
      if (!newFields.has(fieldName)) {
        diff.dropColumns.push({ table: slug, column: fieldName })
        diff.hasChanges = true
      }
    }

    // Find index changes
    for (const [fieldName, field] of newFields) {
      const oldField = oldFields.get(fieldName)

      // Index added
      if (field.index && (!oldField || !oldField.index)) {
        diff.addIndexes.push({ table: slug, name: `${slug}_${fieldName}_idx`, columns: [fieldName] })
        diff.hasChanges = true
      }

      // Index removed
      if (oldField?.index && !field.index) {
        diff.dropIndexes.push({ table: slug, name: `${slug}_${fieldName}_idx` })
        diff.hasChanges = true
      }
    }
  }

  return diff
}

// ============================================================================
// MIGRATION TEMPLATE GENERATION
// ============================================================================

/**
 * Generate a Drizzle migration template.
 *
 * @param name - Migration name
 * @param upStatements - DDL statements for up migration
 * @param downStatements - DDL statements for down migration
 * @returns Migration template string
 */
export function generateDrizzleMigrationTemplate(
  name: string,
  upStatements: DDLStatement[] = [],
  downStatements: DDLStatement[] = []
): string {
  const upSql = upStatements.length > 0
    ? upStatements.map((s) => `    // ${s.description}\n    await execute(\`${s.sql}\`);\n`).join('\n')
    : '    // Add your schema changes here\n    // await execute(`ALTER TABLE ...`);\n'

  const downSql = downStatements.length > 0
    ? downStatements.map((s) => `    // ${s.description}\n    await execute(\`${s.sql}\`);\n`).join('\n')
    : '    // Rollback schema changes\n    // await execute(`DROP TABLE ...`);\n'

  return `import type { MigrateUpArgs, MigrateDownArgs } from '@dotdo/payload';

/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 *
 * This migration uses the Drizzle storage strategy.
 * Use execute() for raw SQL, or the schema helpers for type-safe operations.
 */

export async function up({ payload, req, session, execute }: MigrateUpArgs): Promise<void> {
${upSql}
}

export async function down({ payload, req, session, execute }: MigrateDownArgs): Promise<void> {
${downSql}
}

export const migration = {
  name: '${name}',
  timestamp: ${Date.now()},
  up,
  down,
};
`
}

/**
 * Generate a migration from a schema diff.
 *
 * @param name - Migration name
 * @param diff - Schema diff
 * @param tablePrefix - Table name prefix
 * @returns Migration template string
 */
export function generateMigrationFromDiff(
  name: string,
  diff: SchemaDiff,
  tablePrefix = ''
): string {
  const upStatements: DDLStatement[] = []
  const downStatements: DDLStatement[] = []

  // Create tables
  for (const slug of diff.create) {
    // Note: We'd need the full collection config to generate proper DDL
    // This is a simplified version
    upStatements.push({
      sql: `CREATE TABLE IF NOT EXISTS "${tablePrefix}${slug}" ("id" TEXT PRIMARY KEY NOT NULL);`,
      table: `${tablePrefix}${slug}`,
      operation: 'create',
      description: `Create table ${slug}`,
    })

    downStatements.unshift({
      sql: `DROP TABLE IF EXISTS "${tablePrefix}${slug}";`,
      table: `${tablePrefix}${slug}`,
      operation: 'drop',
      description: `Drop table ${slug}`,
    })
  }

  // Drop tables
  for (const slug of diff.drop) {
    upStatements.push({
      sql: `DROP TABLE IF EXISTS "${tablePrefix}${slug}";`,
      table: `${tablePrefix}${slug}`,
      operation: 'drop',
      description: `Drop table ${slug}`,
    })

    // Note: Can't easily recreate dropped table without schema
  }

  // Add columns
  for (const { table, column, type } of diff.addColumns) {
    upStatements.push({
      sql: `ALTER TABLE "${tablePrefix}${table}" ADD COLUMN "${column}" ${type};`,
      table: `${tablePrefix}${table}`,
      operation: 'alter',
      description: `Add column ${column} to ${table}`,
    })

    // Note: SQLite doesn't support DROP COLUMN
    downStatements.unshift({
      sql: `-- SQLite doesn't support DROP COLUMN\n-- Would need to recreate table without ${column}`,
      table: `${tablePrefix}${table}`,
      operation: 'alter',
      description: `Drop column ${column} from ${table} (manual)`,
    })
  }

  // Add indexes
  for (const { table, name, columns } of diff.addIndexes) {
    const cols = columns.map((c) => `"${c}"`).join(', ')
    upStatements.push({
      sql: `CREATE INDEX IF NOT EXISTS "${name}" ON "${tablePrefix}${table}" (${cols});`,
      table: `${tablePrefix}${table}`,
      operation: 'index',
      description: `Create index ${name} on ${table}`,
    })

    downStatements.unshift({
      sql: `DROP INDEX IF EXISTS "${name}";`,
      table: `${tablePrefix}${table}`,
      operation: 'index',
      description: `Drop index ${name}`,
    })
  }

  // Drop indexes
  for (const { table, name } of diff.dropIndexes) {
    upStatements.push({
      sql: `DROP INDEX IF EXISTS "${name}";`,
      table: `${tablePrefix}${table}`,
      operation: 'index',
      description: `Drop index ${name}`,
    })

    // Note: Can't easily recreate index without column info
  }

  return generateDrizzleMigrationTemplate(name, upStatements, downStatements)
}

// ============================================================================
// MIGRATION HELPERS FACTORY
// ============================================================================

/**
 * Create migration helpers for the Drizzle strategy.
 *
 * @param schemaBuilder - The schema builder instance
 * @param executeQuery - Function to execute raw SQL
 * @returns Migration helpers
 */
export function createDrizzleMigrationHelpers(
  schemaBuilder: SchemaBuilder,
  executeQuery: (sql: string) => Promise<void>
): DrizzleMigrationHelpers {
  return {
    execute: executeQuery,
    getSchemaBuilder: () => schemaBuilder,

    generateDDL(collection: PayloadCollection): DDLStatement[] {
      const statements: DDLStatement[] = []

      // Main table
      statements.push(generateCreateTableDDL(collection))

      // Indexes
      for (const field of collection.fields) {
        if (field.index) {
          statements.push(generateCreateIndexDDL(collection.slug, field.name))
        }
        if (field.unique) {
          statements.push(generateCreateIndexDDL(collection.slug, field.name, true))
        }
      }

      // Version table
      if (collection.versions) {
        statements.push(generateVersionsTableDDL(collection.slug))
      }

      // Relationship tables
      for (const field of collection.fields) {
        if ((field.type === 'relationship' || field.type === 'upload') && field.hasMany) {
          const polymorphic = Array.isArray(field.relationTo)
          statements.push(generateRelationTableDDL(collection.slug, field.name, polymorphic))
        }
      }

      return statements
    },

    diffSchema(
      oldCollections: PayloadCollection[],
      newCollections: PayloadCollection[]
    ): SchemaDiff {
      return diffSchemas(oldCollections, newCollections)
    },
  }
}

// ============================================================================
// MIGRATION CREATION FOR ADAPTER
// ============================================================================

/**
 * Create a migration for the Drizzle strategy.
 *
 * @param store - Migration store
 * @param name - Migration name
 * @param collections - Current collections (for schema generation)
 * @returns Migration creation result
 */
export function createDrizzleMigration(
  store: MigrationStore,
  name: string,
  collections?: PayloadCollection[]
): MigrateCreateResult {
  // Sanitize name
  const sanitizedName = name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')

  // Generate timestamp
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const fullName = `${timestamp}_${sanitizedName}`
  const path = `${store.migrationDir}/${fullName}.ts`

  // Generate DDL statements if collections provided
  let upStatements: DDLStatement[] = []
  let downStatements: DDLStatement[] = []

  if (collections && collections.length > 0) {
    for (const collection of collections) {
      upStatements.push(generateCreateTableDDL(collection))

      // Add indexes
      for (const field of collection.fields) {
        if (field.index) {
          upStatements.push(generateCreateIndexDDL(collection.slug, field.name))
        }
      }

      // Add down statement
      downStatements.push(generateDropTableDDL(collection.slug))
    }
  }

  const template = generateDrizzleMigrationTemplate(fullName, upStatements, downStatements)

  return {
    name: fullName,
    path,
    template,
  }
}
