/**
 * DDL Generator for Unified Schema
 *
 * Generates DDL (CREATE TABLE, CREATE INDEX) statements from the unified
 * schema definition. Supports multiple databases via IceType adapters:
 * - SQLite (native dotdo)
 * - PostgreSQL (via IceType)
 * - MySQL (via IceType)
 *
 * Integrates with IceType modifiers and ai-database prompt fields.
 *
 * @module do/schema/ddl
 */

import type { EntitySchema, FieldDefinition, SchemaDirectives } from './types'

// IceType DDL generation imports
import {
  parseSchema as parseIceTypeSchema,
  type IceTypeSchema,
  type SchemaDefinition,
  // SQLite adapter
  SQLiteAdapter,
  transformToSQLiteDDL,
  generateSQLiteDDL,
  type SQLiteAdapterOptions,
  type SQLiteDDL,
  // PostgreSQL adapter
  PostgresAdapter,
  transformToPostgresDDL,
  generatePostgresDDL,
  type PostgresAdapterOptions,
  type PostgresDDL,
  // MySQL adapter
  MySQLAdapter,
  transformToMySQLDDL,
  generateMySQLDDL,
  type MySQLAdapterOptions,
  type MySQLDDL,
} from 'icetype'

/**
 * Options for DDL generation
 */
export interface DDLOptions {
  /**
   * Use IF NOT EXISTS clause for idempotent table creation
   * @default true
   */
  ifNotExists?: boolean

  /**
   * Prefix for table names (e.g., 'app_' -> 'app_products')
   */
  tablePrefix?: string

  /**
   * Whether to include foreign key constraints
   * @default true
   */
  foreignKeys?: boolean

  /**
   * Whether to include indexes from # modifier
   * @default true
   */
  indexes?: boolean

  /**
   * Whether to include composite indexes from $index directive
   * @default true
   */
  compositeIndexes?: boolean

  /**
   * Whether to include full-text search virtual tables from $fts directive
   * @default true
   */
  fullTextSearch?: boolean
}

/**
 * Result of DDL generation
 */
export interface DDLResult {
  /** Combined DDL statements ready to execute */
  ddl: string

  /** Individual CREATE TABLE statements */
  tables: string[]

  /** Individual CREATE INDEX statements */
  indexes: string[]

  /** FTS virtual table statements (if enabled) */
  fts: string[]

  /** Entity names that were processed */
  entities: string[]
}

/**
 * Map IceType types to SQLite types
 */
function mapTypeToSQLite(type: string, field: FieldDefinition): string {
  // Handle array types - store as JSON
  if (field.array) {
    return 'TEXT' // JSON array
  }

  // Normalize type to lowercase for matching
  const normalizedType = type.toLowerCase()

  switch (normalizedType) {
    // String types
    case 'string':
    case 'text':
    case 'markdown':
    case 'url':
    case 'uuid':
      return 'TEXT'

    // Varchar with length
    case 'varchar':
    case 'char':
      return 'TEXT' // SQLite doesn't enforce varchar length

    // Integer types
    case 'int':
    case 'integer':
    case 'long':
    case 'bigint':
      return 'INTEGER'

    // Float types
    case 'float':
    case 'double':
    case 'number':
      return 'REAL'

    // Decimal with precision
    case 'decimal':
    case 'fixed':
      // SQLite doesn't have native decimal, use REAL or store as TEXT for precision
      return 'REAL'

    // Boolean
    case 'bool':
    case 'boolean':
      return 'INTEGER' // SQLite uses 0/1 for boolean

    // Date/time types
    case 'timestamp':
    case 'timestamptz':
    case 'datetime':
      return 'INTEGER' // Store as Unix timestamp

    case 'date':
    case 'time':
      return 'TEXT' // ISO format string

    // JSON
    case 'json':
      return 'TEXT' // JSON string

    // Binary
    case 'binary':
      return 'BLOB'

    // Entity reference (relation) - store as ID
    default:
      // If it looks like an entity name (PascalCase), store as TEXT (ID reference)
      if (/^[A-Z][a-zA-Z0-9]*$/.test(type)) {
        return 'TEXT'
      }
      return 'TEXT'
  }
}

/**
 * Generate column definition for a field
 */
function generateColumnDef(name: string, field: FieldDefinition): string {
  const sqlType = mapTypeToSQLite(field.type, field)
  const parts: string[] = [`"${name}" ${sqlType}`]

  // NOT NULL for required fields (but not for relations - they may be optional)
  if (field.required && !field.relation) {
    parts.push('NOT NULL')
  }

  // DEFAULT value if specified
  if (field.defaultValue !== undefined) {
    const defaultVal = typeof field.defaultValue === 'string'
      ? `'${field.defaultValue.replace(/'/g, "''")}'`
      : JSON.stringify(field.defaultValue)
    parts.push(`DEFAULT ${defaultVal}`)
  }

  return parts.join(' ')
}

/**
 * Generate CREATE TABLE statement for an entity
 */
function generateCreateTable(
  entity: EntitySchema,
  options: DDLOptions
): string {
  const tableName = `${options.tablePrefix || ''}${entity.name.toLowerCase()}`
  const ifNotExists = options.ifNotExists !== false ? 'IF NOT EXISTS ' : ''

  const columns: string[] = [
    // Standard DO entity columns
    '"$id" TEXT PRIMARY KEY',
    '"$type" TEXT NOT NULL',
    '"$createdAt" INTEGER NOT NULL',
    '"$updatedAt" INTEGER NOT NULL',
  ]

  // Track unique fields for UNIQUE constraints
  const uniqueFields: string[] = []

  // Add columns for each field
  // Handle both Map and plain object (workers runtime may serialize Maps as plain objects)
  const fieldsEntries = entity.fields instanceof Map
    ? Array.from(entity.fields.entries())
    : Object.entries(entity.fields as unknown as Record<string, FieldDefinition>)

  for (const [fieldName, field] of fieldsEntries) {
    // Skip relations with backward direction - they're virtual
    if (field.relation?.direction === 'backward') {
      continue
    }

    // Skip generated/prompt fields from column definition (they're computed)
    if (field.generated && field.prompt) {
      // But we still want a column for the result
      columns.push(`"${fieldName}" TEXT`)
      continue
    }

    columns.push(generateColumnDef(fieldName, field))

    // Track unique fields for constraint
    if (field.unique) {
      uniqueFields.push(fieldName)
    }
  }

  // Add UNIQUE constraints
  for (const field of uniqueFields) {
    columns.push(`UNIQUE ("${field}")`)
  }

  // Add foreign key constraints if enabled
  if (options.foreignKeys !== false) {
    for (const [fieldName, field] of fieldsEntries) {
      if (field.relation?.direction === 'forward' && field.relation.matchMode === 'exact') {
        const targetTable = `${options.tablePrefix || ''}${field.relation.targetType.toLowerCase()}`
        columns.push(
          `FOREIGN KEY ("${fieldName}") REFERENCES "${targetTable}"("$id") ON DELETE ${field.relation.onDelete === 'cascade' ? 'CASCADE' : field.relation.onDelete === 'set_null' ? 'SET NULL' : 'RESTRICT'}`
        )
      }
    }
  }

  return `CREATE TABLE ${ifNotExists}"${tableName}" (\n  ${columns.join(',\n  ')}\n);`
}

/**
 * Generate CREATE INDEX statements for an entity
 */
function generateIndexes(
  entity: EntitySchema,
  options: DDLOptions
): string[] {
  const indexes: string[] = []
  const tableName = `${options.tablePrefix || ''}${entity.name.toLowerCase()}`
  const ifNotExists = options.ifNotExists !== false ? 'IF NOT EXISTS ' : ''

  // Index on $type for fast type-based queries
  indexes.push(
    `CREATE INDEX ${ifNotExists}"idx_${tableName}_type" ON "${tableName}"("$type");`
  )

  // Index on $createdAt for time-based queries
  indexes.push(
    `CREATE INDEX ${ifNotExists}"idx_${tableName}_created_at" ON "${tableName}"("$createdAt" DESC);`
  )

  // Handle both Map and plain object
  const fieldsEntries = entity.fields instanceof Map
    ? Array.from(entity.fields.entries())
    : Object.entries(entity.fields as unknown as Record<string, FieldDefinition>)

  // Add indexes from # modifier
  if (options.indexes !== false) {
    for (const [fieldName, field] of fieldsEntries) {
      // Skip virtual backward relations
      if (field.relation?.direction === 'backward') {
        continue
      }

      // Create index for indexed fields (# modifier already creates UNIQUE, but also index)
      if (field.indexed && !field.unique) {
        indexes.push(
          `CREATE INDEX ${ifNotExists}"idx_${tableName}_${fieldName}" ON "${tableName}"("${fieldName}");`
        )
      }

      // Create index for foreign key fields (relations)
      if (field.relation?.direction === 'forward') {
        indexes.push(
          `CREATE INDEX ${ifNotExists}"idx_${tableName}_${fieldName}" ON "${tableName}"("${fieldName}");`
        )
      }
    }
  }

  // Add composite indexes from $index directive
  if (options.compositeIndexes !== false && entity.directives.$index) {
    for (const indexFields of entity.directives.$index) {
      const indexName = `idx_${tableName}_${indexFields.join('_')}`
      const columnList = indexFields.map(f => `"${f}"`).join(', ')
      indexes.push(
        `CREATE INDEX ${ifNotExists}"${indexName}" ON "${tableName}"(${columnList});`
      )
    }
  }

  return indexes
}

/**
 * Generate FTS virtual table for full-text search
 */
function generateFTS(
  entity: EntitySchema,
  options: DDLOptions
): string[] {
  if (!entity.directives.$fts || entity.directives.$fts.length === 0) {
    return []
  }

  const tableName = `${options.tablePrefix || ''}${entity.name.toLowerCase()}`
  const ftsTableName = `${tableName}_fts`
  const columns = entity.directives.$fts

  // Validate that FTS columns exist
  const validColumns = columns.filter(col => entity.fields.has(col))

  if (validColumns.length === 0) {
    return []
  }

  const statements: string[] = []

  // Create FTS5 virtual table
  statements.push(
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTableName}" USING fts5(` +
    `${validColumns.map(c => `"${c}"`).join(', ')}, ` +
    `content="${tableName}", content_rowid="rowid");`
  )

  // Create triggers to keep FTS in sync
  const insertColumns = validColumns.map(c => `new."${c}"`).join(', ')
  const deleteColumns = validColumns.map(c => `old."${c}"`).join(', ')

  statements.push(
    `CREATE TRIGGER IF NOT EXISTS "${tableName}_ai" AFTER INSERT ON "${tableName}" BEGIN ` +
    `INSERT INTO "${ftsTableName}"(rowid, ${validColumns.map(c => `"${c}"`).join(', ')}) ` +
    `VALUES (new.rowid, ${insertColumns}); END;`
  )

  statements.push(
    `CREATE TRIGGER IF NOT EXISTS "${tableName}_ad" AFTER DELETE ON "${tableName}" BEGIN ` +
    `INSERT INTO "${ftsTableName}"("${ftsTableName}", rowid, ${validColumns.map(c => `"${c}"`).join(', ')}) ` +
    `VALUES ('delete', old.rowid, ${deleteColumns}); END;`
  )

  statements.push(
    `CREATE TRIGGER IF NOT EXISTS "${tableName}_au" AFTER UPDATE ON "${tableName}" BEGIN ` +
    `INSERT INTO "${ftsTableName}"("${ftsTableName}", rowid, ${validColumns.map(c => `"${c}"`).join(', ')}) ` +
    `VALUES ('delete', old.rowid, ${deleteColumns}); ` +
    `INSERT INTO "${ftsTableName}"(rowid, ${validColumns.map(c => `"${c}"`).join(', ')}) ` +
    `VALUES (new.rowid, ${insertColumns}); END;`
  )

  return statements
}

/**
 * Generate DDL for a single entity schema
 */
export function generateEntityDDL(
  entity: EntitySchema,
  options: DDLOptions = {}
): DDLResult {
  const tables: string[] = [generateCreateTable(entity, options)]
  const indexes: string[] = generateIndexes(entity, options)
  const fts: string[] = options.fullTextSearch !== false
    ? generateFTS(entity, options)
    : []

  const ddl = [...tables, ...indexes, ...fts].join('\n\n')

  return {
    ddl,
    tables,
    indexes,
    fts,
    entities: [entity.name],
  }
}

/**
 * Generate DDL for multiple entity schemas
 */
export function generateSchemaDDL(
  entities: Map<string, EntitySchema> | Record<string, EntitySchema>,
  options: DDLOptions = {}
): DDLResult {
  const allTables: string[] = []
  const allIndexes: string[] = []
  const allFts: string[] = []
  const entityNames: string[] = []

  // Handle both Map and plain object
  const entriesIterable = entities instanceof Map
    ? entities.entries()
    : Object.entries(entities)

  for (const [name, entity] of entriesIterable) {
    const result = generateEntityDDL(entity, options)
    allTables.push(...result.tables)
    allIndexes.push(...result.indexes)
    allFts.push(...result.fts)
    entityNames.push(name)
  }

  const ddl = [...allTables, ...allIndexes, ...allFts].join('\n\n')

  return {
    ddl,
    tables: allTables,
    indexes: allIndexes,
    fts: allFts,
    entities: entityNames,
  }
}

/**
 * Validate if an entity already exists in the database
 * Returns true if table exists
 */
export function generateTableExistsQuery(
  entityName: string,
  tablePrefix?: string
): string {
  const tableName = `${tablePrefix || ''}${entityName.toLowerCase()}`
  return `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`
}

/**
 * Generate ALTER TABLE statements for schema migrations
 * This compares old and new schema and generates migration SQL
 */
export function generateMigrationDDL(
  oldEntity: EntitySchema | null,
  newEntity: EntitySchema,
  options: DDLOptions = {}
): string[] {
  const statements: string[] = []
  const tableName = `${options.tablePrefix || ''}${newEntity.name.toLowerCase()}`
  const ifNotExists = options.ifNotExists !== false

  // If no old entity, just create the table
  if (!oldEntity) {
    const result = generateEntityDDL(newEntity, options)
    return result.ddl.split('\n\n').filter(Boolean)
  }

  // Handle both Map and plain object for fields
  const oldFieldsEntries = oldEntity.fields instanceof Map
    ? Array.from(oldEntity.fields.entries())
    : Object.entries(oldEntity.fields as unknown as Record<string, FieldDefinition>)

  const newFieldsEntries = newEntity.fields instanceof Map
    ? Array.from(newEntity.fields.entries())
    : Object.entries(newEntity.fields as unknown as Record<string, FieldDefinition>)

  const oldFieldNames = new Set(oldFieldsEntries.map(([name]) => name))
  const newFieldNames = new Set(newFieldsEntries.map(([name]) => name))

  // Find new fields (need ALTER TABLE ADD COLUMN)
  for (const [fieldName, field] of newFieldsEntries) {
    if (!oldFieldNames.has(fieldName)) {
      // Skip backward relations (virtual)
      if (field.relation?.direction === 'backward') {
        continue
      }

      const columnDef = generateColumnDef(fieldName, field)
      statements.push(`ALTER TABLE "${tableName}" ADD COLUMN ${columnDef};`)
    }
  }

  // Note: SQLite doesn't support DROP COLUMN in older versions
  // For removed fields, we would need a full table recreation
  // This is left as a warning rather than automatic handling
  for (const [fieldName] of oldFieldsEntries) {
    if (!newFieldNames.has(fieldName)) {
      // Add comment noting the removed field
      statements.push(`-- WARNING: Field "${fieldName}" was removed from schema but SQLite doesn't support DROP COLUMN easily`)
    }
  }

  return statements
}
