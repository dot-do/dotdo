/**
 * Schema Builder for DrizzleStorageStrategy
 *
 * Generates Drizzle schemas from Payload collection configurations.
 * Maps Payload field types to SQLite column types for typed table storage.
 *
 * @module @dotdo/payload/strategies/drizzle/schema-builder
 */

import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core'
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import type { PayloadCollection, PayloadField, PayloadFieldType } from '../../adapter/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generated schema for a collection
 */
export interface CollectionSchema {
  /** Main table for the collection */
  table: SQLiteTableWithColumns<any>
  /** Version table for versioned collections */
  versionsTable?: SQLiteTableWithColumns<any>
  /** Relationship join tables */
  relationTables: Map<string, SQLiteTableWithColumns<any>>
  /** Array value tables (for array fields) */
  arrayTables: Map<string, SQLiteTableWithColumns<any>>
  /** The collection configuration */
  config: PayloadCollection
}

/**
 * Column definition for schema generation
 */
export interface ColumnDefinition {
  name: string
  type: 'text' | 'integer' | 'real' | 'blob'
  notNull?: boolean
  unique?: boolean
  defaultValue?: unknown
}

/**
 * Schema builder configuration
 */
export interface SchemaBuilderConfig {
  /** Table name prefix (e.g., 'payload_') */
  tablePrefix?: string
  /** ID column type */
  idType?: 'text' | 'integer'
  /** Enable timestamps */
  timestamps?: boolean
}

// ============================================================================
// FIELD TYPE MAPPING
// ============================================================================

/**
 * Map Payload field types to SQLite column types
 */
const FIELD_TYPE_MAP: Record<PayloadFieldType, 'text' | 'integer' | 'real' | 'blob'> = {
  text: 'text',
  textarea: 'text',
  email: 'text',
  code: 'text',
  richText: 'text', // Stored as JSON string
  date: 'text', // ISO string
  checkbox: 'integer', // 0 or 1
  select: 'text',
  radio: 'text',
  number: 'real',
  json: 'text', // JSON string
  relationship: 'text', // ID reference
  upload: 'text', // ID reference
  array: 'text', // JSON string for simple arrays, separate table for complex
  group: 'text', // JSON string
  row: 'text', // Not stored directly
  collapsible: 'text', // Not stored directly
  tabs: 'text', // Not stored directly
  blocks: 'text', // JSON string
  point: 'text', // JSON string [lat, lng]
}

/**
 * Fields that should be stored in auxiliary tables
 */
const AUXILIARY_FIELD_TYPES = new Set(['array', 'blocks'])

/**
 * Fields that represent relationships
 */
const RELATIONSHIP_FIELD_TYPES = new Set(['relationship', 'upload'])

// ============================================================================
// SCHEMA BUILDER CLASS
// ============================================================================

/**
 * Builds Drizzle schemas from Payload collection configurations.
 *
 * Generates typed SQLite tables with appropriate column types for each
 * Payload field. Handles relationships via foreign keys or join tables,
 * and creates auxiliary tables for array/block fields.
 */
export class SchemaBuilder {
  private config: Required<SchemaBuilderConfig>
  private schemas: Map<string, CollectionSchema> = new Map()

  constructor(config: SchemaBuilderConfig = {}) {
    this.config = {
      tablePrefix: config.tablePrefix ?? '',
      idType: config.idType ?? 'text',
      timestamps: config.timestamps ?? true,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build schema for a collection.
   *
   * @param collection - The Payload collection configuration
   * @returns Generated collection schema
   */
  buildCollectionSchema(collection: PayloadCollection): CollectionSchema {
    const tableName = this.getTableName(collection.slug)

    // Build main table columns
    const columns = this.buildMainTableColumns(collection.fields)

    // Create main table
    const table = this.createTable(tableName, columns, collection)

    // Build relation tables for many-to-many relationships
    const relationTables = this.buildRelationTables(collection)

    // Build array tables for complex array fields
    const arrayTables = this.buildArrayTables(collection)

    // Build versions table if versioning enabled
    const versionsTable = collection.versions
      ? this.buildVersionsTable(collection)
      : undefined

    const schema: CollectionSchema = {
      table,
      versionsTable,
      relationTables,
      arrayTables,
      config: collection,
    }

    this.schemas.set(collection.slug, schema)
    return schema
  }

  /**
   * Build schemas for multiple collections.
   *
   * @param collections - Array of collection configurations
   * @returns Map of collection slug to schema
   */
  buildSchemas(collections: PayloadCollection[]): Map<string, CollectionSchema> {
    for (const collection of collections) {
      this.buildCollectionSchema(collection)
    }
    return this.schemas
  }

  /**
   * Get schema for a collection.
   *
   * @param slug - Collection slug
   * @returns Collection schema or undefined
   */
  getSchema(slug: string): CollectionSchema | undefined {
    return this.schemas.get(slug)
  }

  /**
   * Get all schemas.
   */
  getAllSchemas(): Map<string, CollectionSchema> {
    return this.schemas
  }

  /**
   * Generate SQL DDL for creating all tables.
   *
   * @returns Array of SQL statements
   */
  generateDDL(): string[] {
    const statements: string[] = []

    for (const [slug, schema] of this.schemas) {
      // Main table
      statements.push(this.tableToSQL(schema.table, slug))

      // Versions table
      if (schema.versionsTable) {
        statements.push(this.tableToSQL(schema.versionsTable, `${slug}_versions`))
      }

      // Relation tables
      for (const [fieldName, table] of schema.relationTables) {
        statements.push(this.tableToSQL(table, `${slug}_${fieldName}_rels`))
      }

      // Array tables
      for (const [fieldName, table] of schema.arrayTables) {
        statements.push(this.tableToSQL(table, `${slug}_${fieldName}`))
      }
    }

    return statements
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE NAME HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the table name for a collection.
   */
  getTableName(slug: string): string {
    return `${this.config.tablePrefix}${slug}`
  }

  /**
   * Get the versions table name for a collection.
   */
  getVersionsTableName(slug: string): string {
    return `${this.config.tablePrefix}${slug}_versions`
  }

  /**
   * Get the relation table name for a field.
   */
  getRelationTableName(collectionSlug: string, fieldName: string): string {
    return `${this.config.tablePrefix}${collectionSlug}_${fieldName}_rels`
  }

  /**
   * Get the array table name for a field.
   */
  getArrayTableName(collectionSlug: string, fieldName: string): string {
    return `${this.config.tablePrefix}${collectionSlug}_${fieldName}`
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLUMN BUILDING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build columns for the main collection table.
   */
  private buildMainTableColumns(fields: PayloadField[]): ColumnDefinition[] {
    const columns: ColumnDefinition[] = [
      // ID column
      {
        name: 'id',
        type: this.config.idType,
        notNull: true,
      },
    ]

    // Add timestamp columns
    if (this.config.timestamps) {
      columns.push(
        { name: 'createdAt', type: 'text', notNull: true },
        { name: 'updatedAt', type: 'text', notNull: true }
      )
    }

    // Add draft status column
    columns.push({ name: '_status', type: 'text' })

    // Add field columns
    for (const field of fields) {
      const fieldColumns = this.fieldToColumns(field)
      columns.push(...fieldColumns)
    }

    return columns
  }

  /**
   * Convert a Payload field to column definitions.
   *
   * Most fields map to a single column. Relationship fields with hasMany
   * get stored in a separate join table instead.
   */
  private fieldToColumns(field: PayloadField): ColumnDefinition[] {
    // Skip layout-only fields
    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'tabs') {
      // Recurse into nested fields
      if (field.fields) {
        return field.fields.flatMap((f) => this.fieldToColumns(f))
      }
      return []
    }

    // Many-to-many relationships stored in separate table
    if (RELATIONSHIP_FIELD_TYPES.has(field.type) && field.hasMany) {
      return []
    }

    // Complex arrays stored in separate table
    if (field.type === 'array' && this.isComplexArray(field)) {
      return []
    }

    // Standard column mapping
    const colType = FIELD_TYPE_MAP[field.type] || 'text'

    return [
      {
        name: field.name,
        type: colType,
        notNull: field.required,
        unique: field.unique,
        defaultValue: field.defaultValue,
      },
    ]
  }

  /**
   * Check if an array field is complex (has multiple subfields or nested objects).
   */
  private isComplexArray(field: PayloadField): boolean {
    if (!field.fields || field.fields.length === 0) {
      return false
    }

    // Single text field = simple array, stored as JSON
    if (field.fields.length === 1 && field.fields[0]?.type === 'text') {
      return false
    }

    // Multiple fields or complex types = separate table
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE CREATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a Drizzle table definition.
   */
  private createTable(
    tableName: string,
    columns: ColumnDefinition[],
    collection: PayloadCollection
  ): SQLiteTableWithColumns<any> {
    // Build column definitions dynamically
    const tableColumns: Record<string, any> = {}

    for (const col of columns) {
      tableColumns[col.name] = this.createColumn(col)
    }

    // Create table with primary key on id
    const table = sqliteTable(tableName, tableColumns, (table) => {
      const indexes: Record<string, any> = {}

      // Primary key index
      indexes.pk = primaryKey({ columns: [table.id!] })

      // Add indexes for indexed fields
      for (const field of collection.fields) {
        if (field.index && table[field.name]) {
          indexes[`${tableName}_${field.name}_idx`] = index(`${tableName}_${field.name}_idx`).on(
            table[field.name]!
          )
        }
        if (field.unique && table[field.name]) {
          indexes[`${tableName}_${field.name}_uniq`] = uniqueIndex(
            `${tableName}_${field.name}_uniq`
          ).on(table[field.name]!)
        }
      }

      return indexes
    })

    return table
  }

  /**
   * Create a Drizzle column from a column definition.
   */
  private createColumn(col: ColumnDefinition): any {
    let column: any

    switch (col.type) {
      case 'text':
        column = text(col.name)
        break
      case 'integer':
        column = integer(col.name)
        break
      case 'real':
        column = real(col.name)
        break
      case 'blob':
        column = blob(col.name)
        break
      default:
        column = text(col.name)
    }

    if (col.notNull) {
      column = column.notNull()
    }

    if (col.defaultValue !== undefined) {
      column = column.default(col.defaultValue)
    }

    // Mark id as primary key
    if (col.name === 'id') {
      column = column.primaryKey()
    }

    return column
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RELATION TABLES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build join tables for many-to-many relationships.
   */
  private buildRelationTables(
    collection: PayloadCollection
  ): Map<string, SQLiteTableWithColumns<any>> {
    const tables = new Map<string, SQLiteTableWithColumns<any>>()

    for (const field of collection.fields) {
      if (RELATIONSHIP_FIELD_TYPES.has(field.type) && field.hasMany) {
        const tableName = this.getRelationTableName(collection.slug, field.name)
        const table = this.createRelationTable(tableName, collection.slug, field)
        tables.set(field.name, table)
      }
    }

    return tables
  }

  /**
   * Create a join table for a many-to-many relationship.
   */
  private createRelationTable(
    tableName: string,
    collectionSlug: string,
    field: PayloadField
  ): SQLiteTableWithColumns<any> {
    const columns: Record<string, any> = {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(), // FK to main collection
      path: text('path').notNull(), // Field path
      order: integer('order').notNull(), // Order in array
    }

    // For polymorphic relationships, store the relation type
    if (Array.isArray(field.relationTo)) {
      columns.relationTo = text('relation_to').notNull()
    }

    // The related document ID
    columns.relatedId = text('related_id').notNull()

    return sqliteTable(tableName, columns, (table) => ({
      parentIdx: index(`${tableName}_parent_idx`).on(table.parentId!),
      relatedIdx: index(`${tableName}_related_idx`).on(table.relatedId!),
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ARRAY TABLES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build tables for complex array fields.
   */
  private buildArrayTables(
    collection: PayloadCollection
  ): Map<string, SQLiteTableWithColumns<any>> {
    const tables = new Map<string, SQLiteTableWithColumns<any>>()

    for (const field of collection.fields) {
      if (field.type === 'array' && this.isComplexArray(field)) {
        const tableName = this.getArrayTableName(collection.slug, field.name)
        const table = this.createArrayTable(tableName, collection.slug, field)
        tables.set(field.name, table)
      }
    }

    return tables
  }

  /**
   * Create a table for complex array field values.
   */
  private createArrayTable(
    tableName: string,
    collectionSlug: string,
    field: PayloadField
  ): SQLiteTableWithColumns<any> {
    const columns: Record<string, any> = {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(), // FK to main collection
      path: text('path').notNull(), // Field path
      order: integer('order').notNull(), // Order in array
    }

    // Add columns for each subfield
    if (field.fields) {
      for (const subfield of field.fields) {
        const colType = FIELD_TYPE_MAP[subfield.type] || 'text'
        columns[subfield.name] =
          colType === 'text'
            ? text(subfield.name)
            : colType === 'integer'
              ? integer(subfield.name)
              : colType === 'real'
                ? real(subfield.name)
                : text(subfield.name)
      }
    }

    return sqliteTable(tableName, columns, (table) => ({
      parentIdx: index(`${tableName}_parent_idx`).on(table.parentId!),
      orderIdx: index(`${tableName}_order_idx`).on(table.parentId!, table.order!),
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VERSION TABLES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build versions table for a versioned collection.
   */
  private buildVersionsTable(collection: PayloadCollection): SQLiteTableWithColumns<any> {
    const tableName = this.getVersionsTableName(collection.slug)

    const columns: Record<string, any> = {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(), // FK to main document
      versionNumber: integer('version_number').notNull(),
      type: text('type').notNull().default('draft'), // 'draft' | 'published'
      label: text('label'),
      createdBy: text('created_by'),
      createdAt: text('created_at').notNull(),
      snapshot: text('snapshot').notNull(), // JSON of document at version time
    }

    return sqliteTable(tableName, columns, (table) => ({
      parentIdx: index(`${tableName}_parent_idx`).on(table.parentId!),
      versionIdx: index(`${tableName}_version_idx`).on(table.parentId!, table.versionNumber!),
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SQL GENERATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate CREATE TABLE SQL from a Drizzle table definition.
   *
   * Note: This is a simplified version. In production, we'd use Drizzle's
   * migration system which generates proper DDL.
   */
  private tableToSQL(table: SQLiteTableWithColumns<any>, name: string): string {
    // Get column definitions from table
    const columns: string[] = []
    const tableConfig = (table as any)[Symbol.for('drizzle:Columns')] || {}

    for (const [colName, col] of Object.entries(tableConfig)) {
      const colDef = col as any
      let colSQL = `"${colName}" ${colDef.dataType || 'TEXT'}`

      if (colDef.notNull) {
        colSQL += ' NOT NULL'
      }
      if (colDef.primaryKey) {
        colSQL += ' PRIMARY KEY'
      }
      if (colDef.default !== undefined) {
        colSQL += ` DEFAULT ${JSON.stringify(colDef.default)}`
      }

      columns.push(colSQL)
    }

    return `CREATE TABLE IF NOT EXISTS "${name}" (\n  ${columns.join(',\n  ')}\n);`
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SchemaBuilder instance.
 *
 * @param config - Builder configuration
 * @returns Configured SchemaBuilder
 */
export function createSchemaBuilder(config?: SchemaBuilderConfig): SchemaBuilder {
  return new SchemaBuilder(config)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the SQLite column type for a Payload field type.
 */
export function getColumnType(fieldType: PayloadFieldType): 'text' | 'integer' | 'real' | 'blob' {
  return FIELD_TYPE_MAP[fieldType] || 'text'
}

/**
 * Check if a field type requires a separate table.
 */
export function requiresSeparateTable(field: PayloadField): boolean {
  // Many-to-many relationships
  if (RELATIONSHIP_FIELD_TYPES.has(field.type) && field.hasMany) {
    return true
  }

  // Complex arrays
  if (field.type === 'array' && field.fields && field.fields.length > 1) {
    return true
  }

  return false
}
