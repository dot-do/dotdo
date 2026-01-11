/**
 * DDL Generator - Gel Schema to SQLite DDL
 *
 * Converts Schema IR from SDL Parser to SQLite DDL statements.
 * Supports inheritance (STI/CTI), constraints, indexes, and triggers.
 *
 * @module ddl-generator
 */

import type {
  Schema,
  TypeDefinition,
  Property,
  Link,
  PropertyConstraint,
  EnumDefinition,
  Index,
  ComputedProperty,
  Backlink,
} from './sdl-parser'

// ============================================================================
// PUBLIC INTERFACES
// ============================================================================

/**
 * Result of DDL generation containing all SQL statements.
 */
export interface GeneratedDDL {
  /** CREATE TABLE statements */
  tables: string[]
  /** CREATE INDEX statements */
  indexes: string[]
  /** CREATE TRIGGER statements (for computed properties, readonly enforcement, updated_at) */
  triggers: string[]
  /** CREATE VIEW statements (for backlinks) */
  views: string[]
}

/**
 * Options for DDL generation.
 */
export interface DDLGeneratorOptions {
  /** Inheritance strategy: 'sti' (Single Table) or 'cti' (Class Table) */
  inheritanceStrategy?: 'sti' | 'cti'
  /** Whether to generate metadata tables (_types, _enums, etc.) */
  generateMetadata?: boolean
  /** Whether to add _created_at and _updated_at columns */
  addTimestamps?: boolean
  /** Whether to add _type discriminator column for inheritance */
  addTypeColumn?: boolean
}

// ============================================================================
// SQL CONSTANTS
// ============================================================================

/**
 * SQL reserved keywords that require quoting when used as identifiers.
 */
const SQL_RESERVED_KEYWORDS = new Set([
  'order',
  'group',
  'index',
  'select',
  'insert',
  'update',
  'delete',
  'where',
  'from',
  'table',
  'create',
  'drop',
  'alter',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'on',
  'and',
  'or',
  'not',
  'null',
  'true',
  'false',
  'as',
  'by',
  'is',
  'in',
  'like',
  'between',
  'case',
  'when',
  'then',
  'else',
  'end',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'all',
  'distinct',
  'values',
  'set',
  'primary',
  'key',
  'foreign',
  'references',
  'default',
  'check',
  'unique',
  'constraint',
  'trigger',
  'view',
  'begin',
  'commit',
  'rollback',
  'transaction',
])

/**
 * Type mapping from EdgeDB/Gel scalar types to SQLite types.
 */
const SCALAR_TYPE_MAP: Record<string, string> = {
  str: 'TEXT',
  int16: 'INTEGER',
  int32: 'INTEGER',
  int64: 'INTEGER',
  float32: 'REAL',
  float64: 'REAL',
  bool: 'INTEGER',
  uuid: 'TEXT',
  datetime: 'TEXT',
  duration: 'TEXT',
  json: 'TEXT',
  bytes: 'BLOB',
  bigint: 'TEXT',
  decimal: 'TEXT',
  'cal::local_date': 'TEXT',
  'cal::local_time': 'TEXT',
  'cal::local_datetime': 'TEXT',
  // Collection types stored as JSON
  array: 'TEXT',
  tuple: 'TEXT',
}

// ============================================================================
// SQL TEMPLATE BUILDERS
// ============================================================================

/**
 * Build a CREATE TABLE statement from parts.
 *
 * @param tableName - Table name (will be quoted if reserved)
 * @param columnDefs - Column definition strings
 * @param tableConstraints - Optional table-level constraints
 * @returns Complete CREATE TABLE statement
 */
function buildCreateTable(
  tableName: string,
  columnDefs: string[],
  tableConstraints: string[] = []
): string {
  const quotedName = quoteIdentifier(tableName)
  const allParts = [...columnDefs, ...tableConstraints]
  return `CREATE TABLE ${quotedName} (\n  ${allParts.join(',\n  ')}\n);`
}

/**
 * Build a CREATE INDEX statement.
 *
 * @param indexName - Index name
 * @param tableName - Table name
 * @param columns - Columns to index
 * @returns Complete CREATE INDEX statement
 */
function buildCreateIndex(
  indexName: string,
  tableName: string,
  columns: string[]
): string {
  const quotedTable = quoteIdentifier(tableName)
  return `CREATE INDEX ${indexName} ON ${quotedTable}(${columns.join(', ')});`
}

/**
 * Build a foreign key column definition.
 *
 * @param colName - Column name
 * @param targetTable - Referenced table
 * @param options - Column options
 * @returns Column definition string
 */
function buildForeignKeyColumn(
  colName: string,
  targetTable: string,
  options: { required?: boolean; unique?: boolean; onDelete: string }
): string {
  const parts = [colName, 'TEXT']
  if (options.required) {
    parts.push('NOT NULL')
  }
  if (options.unique) {
    parts.push('UNIQUE')
  }
  parts.push(`REFERENCES ${quoteIdentifier(targetTable)}(id) ON DELETE ${options.onDelete}`)
  return parts.join(' ')
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert PascalCase or camelCase to snake_case.
 * Handles acronyms correctly (e.g., userID -> user_id, XMLParser -> xml_parser).
 *
 * @param name - The identifier to convert
 * @returns snake_case version of the name
 */
export function toSnakeCase(name: string): string {
  return name
    // Insert underscore before sequences of uppercase followed by lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // Insert underscore between lowercase/number and uppercase
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * Quote an identifier if it's a reserved SQL keyword.
 *
 * @param name - The identifier to potentially quote
 * @returns Quoted identifier if reserved, otherwise unchanged
 */
function quoteIdentifier(name: string): string {
  if (SQL_RESERVED_KEYWORDS.has(name.toLowerCase())) {
    return `"${name}"`
  }
  return name
}

/**
 * Map EdgeDB/Gel scalar type to SQLite type.
 *
 * @param sdlType - The EdgeDB scalar type name
 * @returns Corresponding SQLite type
 * @throws Error if type is not recognized
 */
export function mapScalarType(sdlType: string): string {
  const sqlType = SCALAR_TYPE_MAP[sdlType]
  if (!sqlType) {
    throw new Error(`Unknown scalar type: ${sdlType}`)
  }
  return sqlType
}

/**
 * Escape single quotes in string for SQL literals.
 *
 * @param value - String to escape
 * @returns SQL-safe string
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Format a value as SQL literal for DEFAULT clause.
 *
 * @param value - The value to format
 * @param type - The EdgeDB type (unused but kept for future type-specific formatting)
 * @returns SQL literal string
 */
function formatDefaultValue(value: string | number | boolean, type: string): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  // String value
  return `'${escapeSqlString(value)}'`
}

// ============================================================================
// COLUMN DEFINITION GENERATORS
// ============================================================================

/**
 * Generate a column definition for a property.
 *
 * @param name - Property name (will be converted to snake_case)
 * @param type - EdgeDB scalar type
 * @param required - Whether column is NOT NULL
 * @param defaultValue - Optional default value
 * @param constraints - Optional constraint strings (e.g., ['UNIQUE'])
 * @returns SQL column definition
 */
export function generateColumnDef(
  name: string,
  type: string,
  required: boolean,
  defaultValue?: string | number | boolean,
  constraints?: string[]
): string {
  const sqlType = mapScalarType(type)
  const parts = [quoteIdentifier(toSnakeCase(name)), sqlType]

  if (required) {
    parts.push('NOT NULL')
  }

  if (constraints?.includes('UNIQUE')) {
    parts.push('UNIQUE')
  }

  if (defaultValue !== undefined) {
    parts.push(`DEFAULT ${formatDefaultValue(defaultValue, type)}`)
  }

  return parts.join(' ')
}

/**
 * Generate a CHECK constraint from an EdgeDB constraint type.
 *
 * @param constraintType - EdgeDB constraint type (min_value, max_value, etc.)
 * @param columnName - Column name (will be converted to snake_case)
 * @param value - Constraint value
 * @returns SQL CHECK constraint or empty string if unsupported
 */
export function generateCheckConstraint(
  constraintType: string,
  columnName: string,
  value: number | string
): string {
  const col = toSnakeCase(columnName)

  switch (constraintType) {
    case 'min_value':
      return `CHECK (${col} >= ${value})`
    case 'max_value':
      return `CHECK (${col} <= ${value})`
    case 'min_len_value':
      return `CHECK (length(${col}) >= ${value})`
    case 'max_len_value':
      return `CHECK (length(${col}) <= ${value})`
    default:
      return ''
  }
}

// ============================================================================
// TABLE GENERATORS
// ============================================================================

/**
 * Generate a junction table for multi-cardinality links.
 * Junction tables enable many-to-many relationships.
 *
 * @param sourceType - Source type name
 * @param linkName - Link name
 * @param targetType - Target type name
 * @param linkProperties - Optional properties on the link
 * @returns CREATE TABLE statement for junction table
 */
export function generateJunctionTable(
  sourceType: string,
  linkName: string,
  targetType: string,
  linkProperties?: Array<{ name: string; type: string; required: boolean }>
): string {
  const tableName = `${sourceType}_${linkName}`
  const columns: string[] = [
    buildForeignKeyColumn('source_id', sourceType, { required: true, onDelete: 'CASCADE' }),
    buildForeignKeyColumn('target_id', targetType, { required: true, onDelete: 'CASCADE' }),
    '_ordinal INTEGER DEFAULT 0',
  ]

  // Add link properties
  if (linkProperties) {
    for (const prop of linkProperties) {
      const sqlType = mapScalarType(prop.type)
      const col = toSnakeCase(prop.name)
      columns.push(prop.required ? `${col} ${sqlType} NOT NULL` : `${col} ${sqlType}`)
    }
  }

  columns.push('PRIMARY KEY (source_id, target_id)')

  return `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n);`
}

// ============================================================================
// INHERITANCE HELPERS
// ============================================================================

/**
 * Collect all inherited properties, links, indexes, and constraints from parent types.
 * Traverses the inheritance hierarchy depth-first, avoiding duplicate members.
 *
 * @param typeDef - Type definition to collect inherited members for
 * @param allTypes - Map of all type definitions by name
 * @returns Collected inherited members
 */
function collectInheritedMembers(
  typeDef: TypeDefinition,
  allTypes: Map<string, TypeDefinition>
): { properties: Property[]; links: Link[]; indexes: Index[]; constraints: PropertyConstraint[] } {
  const properties: Property[] = []
  const links: Link[] = []
  const indexes: Index[] = []
  const constraints: PropertyConstraint[] = []
  const seenProps = new Set<string>()
  const seenLinks = new Set<string>()

  function collectFromType(t: TypeDefinition) {
    // First collect from parent types (depth-first)
    for (const parentName of t.extends) {
      const parent = allTypes.get(parentName)
      if (parent) {
        collectFromType(parent)
      }
    }

    // Then add this type's members (excluding duplicates for properties/links)
    for (const prop of t.properties) {
      if (!seenProps.has(prop.name)) {
        seenProps.add(prop.name)
        properties.push(prop)
      }
    }
    for (const link of t.links) {
      if (!seenLinks.has(link.name)) {
        seenLinks.add(link.name)
        links.push(link)
      }
    }
    // Indexes and constraints can be duplicated from parents
    indexes.push(...t.indexes)
    constraints.push(...t.constraints)
  }

  // Collect from parent types
  for (const parentName of typeDef.extends) {
    const parent = allTypes.get(parentName)
    if (parent) {
      collectFromType(parent)
    }
  }

  return { properties, links, indexes, constraints }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate SQLite DDL from a parsed Schema IR.
 *
 * Creates tables, indexes, triggers, and views for all non-abstract types.
 * Supports Single Table Inheritance (STI) and Class Table Inheritance (CTI).
 *
 * @param schema - Parsed schema from SDL parser
 * @param options - Generation options
 * @returns Generated DDL statements organized by type
 */
export function generateDDL(schema: Schema, options?: DDLGeneratorOptions): GeneratedDDL {
  const opts = {
    addTimestamps: true,
    generateMetadata: false,
    inheritanceStrategy: 'sti' as const,
    ...options,
  }

  const result: GeneratedDDL = {
    tables: [],
    indexes: [],
    triggers: [],
    views: [],
  }

  // Build type lookup map
  const typeMap = new Map<string, TypeDefinition>()
  for (const t of schema.types) {
    typeMap.set(t.name, t)
  }

  // Build enum lookup map
  const enumMap = new Map<string, EnumDefinition>()
  for (const e of schema.enums) {
    enumMap.set(e.name, e)
  }

  // Generate tables for non-abstract types
  for (const typeDef of schema.types) {
    if (typeDef.abstract) {
      continue
    }

    const { table, tableIndexes, tableTriggers } = generateTableForType(
      typeDef,
      typeMap,
      enumMap,
      opts
    )
    result.tables.push(table)
    result.indexes.push(...tableIndexes)
    result.triggers.push(...tableTriggers)

    // Generate junction tables for multi links
    const inherited = collectInheritedMembers(typeDef, typeMap)
    const allLinks = [...inherited.links, ...typeDef.links]

    for (const link of allLinks) {
      if (link.cardinality === 'multi') {
        const junctionTable = generateJunctionTable(
          typeDef.name,
          link.name,
          link.target,
          link.properties?.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
          }))
        )
        result.tables.push(junctionTable)

        // Index on target_id for junction table
        result.indexes.push(
          `CREATE INDEX idx_${typeDef.name}_${link.name}_target ON ${typeDef.name}_${link.name}(target_id);`
        )
      }
    }
  }

  // Generate metadata tables if requested
  if (opts.generateMetadata) {
    result.tables.push(generateMetadataTables(schema, typeMap))
  }

  return result
}

// ============================================================================
// TYPE TABLE GENERATION
// ============================================================================

/**
 * Generate complete table DDL for a single type definition.
 * Includes columns, constraints, and associated indexes and triggers.
 *
 * @param typeDef - Type definition to generate DDL for
 * @param typeMap - Map of all types for inheritance resolution
 * @param enumMap - Map of all enums for type checking
 * @param opts - Generation options
 * @returns Table DDL, indexes, and triggers
 */
function generateTableForType(
  typeDef: TypeDefinition,
  typeMap: Map<string, TypeDefinition>,
  enumMap: Map<string, EnumDefinition>,
  opts: Required<DDLGeneratorOptions>
): { table: string; tableIndexes: string[]; tableTriggers: string[] } {
  const tableIndexes: string[] = []
  const tableTriggers: string[] = []

  // Collect inherited members
  const inherited = collectInheritedMembers(typeDef, typeMap)
  const allProperties = [...inherited.properties, ...typeDef.properties]
  const allLinks = [...inherited.links, ...typeDef.links]
  const allIndexes = [...inherited.indexes, ...typeDef.indexes]
  const allConstraints = [...inherited.constraints, ...typeDef.constraints]

  const columns: string[] = []
  const tableConstraints: string[] = []

  // ID column first (UUID-like random hex)
  columns.push("id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))")

  // _type column for STI inheritance discrimination
  const hasParent = typeDef.extends.length > 0
  if (opts.inheritanceStrategy === 'sti' && hasParent) {
    columns.push(`_type TEXT NOT NULL DEFAULT '${typeDef.name}'`)
    tableIndexes.push(
      buildCreateIndex(`idx_${typeDef.name}__type`, typeDef.name, ['_type'])
    )
  }

  // Property columns
  for (const prop of allProperties) {
    const { columnDef, checkConstraints } = generatePropertyColumn(prop, enumMap)
    columns.push(columnDef)
    tableConstraints.push(...checkConstraints)

    // Generate readonly trigger for immutable properties
    if (prop.readonly) {
      tableTriggers.push(generateReadonlyTrigger(typeDef.name, prop.name))
    }
  }

  // Single link columns (foreign keys)
  for (const link of allLinks) {
    if (link.cardinality === 'single') {
      const { columnDef, fkIndex } = generateLinkColumn(link, typeDef.name)
      columns.push(columnDef)
      tableIndexes.push(fkIndex)
    }
  }

  // Computed/generated columns
  for (const computed of typeDef.computedProperties) {
    const computedCol = generateComputedColumn(computed)
    if (computedCol) {
      columns.push(computedCol)
    }
  }

  // Timestamp columns
  if (opts.addTimestamps) {
    columns.push('_created_at TEXT DEFAULT CURRENT_TIMESTAMP')
    columns.push('_updated_at TEXT DEFAULT CURRENT_TIMESTAMP')
    tableTriggers.push(generateUpdatedAtTrigger(typeDef.name))
  }

  // Table-level constraints (exclusive, expression)
  for (const constraint of allConstraints) {
    if (constraint.type === 'exclusive' && constraint.on) {
      const cols = constraint.on.map((p) => toSnakeCase(p.replace(/^\./, '')))
      tableConstraints.push(`UNIQUE (${cols.join(', ')})`)
    } else if (constraint.type === 'expression' && constraint.expr) {
      const sqlExpr = convertExpressionToSQL(constraint.expr)
      tableConstraints.push(`CHECK (${sqlExpr})`)
    }
  }

  // Build final table DDL using helper
  const table = buildCreateTable(typeDef.name, columns, tableConstraints)

  // Generate explicit indexes from schema
  for (const idx of allIndexes) {
    tableIndexes.push(generateIndex(typeDef.name, idx))
  }

  return { table, tableIndexes, tableTriggers }
}

/**
 * Generate column definition for a property.
 * Handles type mapping, constraints, defaults, and enum validation.
 *
 * @param prop - Property definition
 * @param enumMap - Map of enum definitions for type checking
 * @returns Column definition and any CHECK constraints
 */
function generatePropertyColumn(
  prop: Property,
  enumMap: Map<string, EnumDefinition>
): { columnDef: string; checkConstraints: string[] } {
  const checkConstraints: string[] = []
  const colName = toSnakeCase(prop.name)
  const quotedColName = quoteIdentifier(colName)

  // Determine SQL type (enums and collections are stored as TEXT)
  const enumDef = enumMap.get(prop.type)
  const sqlType = enumDef
    ? 'TEXT'
    : prop.type === 'array' || prop.type === 'tuple'
      ? 'TEXT'
      : mapScalarType(prop.type)

  const parts = [quotedColName, sqlType]

  if (prop.required) {
    parts.push('NOT NULL')
  }

  // Handle exclusive constraint (UNIQUE)
  if (prop.constraints.some((c) => c.type === 'exclusive')) {
    parts.push('UNIQUE')
  }

  // Handle default value (static or expression)
  if (prop.default !== undefined) {
    parts.push(`DEFAULT ${formatDefaultValue(prop.default, prop.type)}`)
  } else if (prop.defaultExpr) {
    parts.push(`DEFAULT ${convertDefaultExprToSQL(prop.defaultExpr)}`)
  }

  // Generate value range/length constraints
  const valueConstraints = generateValueConstraints(prop)
  if (valueConstraints) {
    checkConstraints.push(valueConstraints)
  }

  // Generate enum value constraint
  if (enumDef) {
    const values = enumDef.values.map((v) => `'${escapeSqlString(v)}'`).join(', ')
    checkConstraints.push(`CHECK (${colName} IN (${values}))`)
  }

  // Generate one_of constraint
  const oneOfConstraint = prop.constraints.find((c) => c.type === 'one_of')
  if (oneOfConstraint?.values) {
    const values = oneOfConstraint.values.map((v) => `'${escapeSqlString(v)}'`).join(', ')
    checkConstraints.push(`CHECK (${colName} IN (${values}))`)
  }

  return { columnDef: parts.join(' '), checkConstraints }
}

/**
 * Generate CHECK constraint for value range/length constraints.
 *
 * @param prop - Property with constraints
 * @returns CHECK constraint string or null if no applicable constraints
 */
function generateValueConstraints(prop: Property): string | null {
  const colName = toSnakeCase(prop.name)
  const conditions: string[] = []

  // Find constraint values
  const minValue = prop.constraints.find((c) => c.type === 'min_value')?.value
  const maxValue = prop.constraints.find((c) => c.type === 'max_value')?.value
  const minLen = prop.constraints.find((c) => c.type === 'min_len_value')?.value
  const maxLen = prop.constraints.find((c) => c.type === 'max_len_value')?.value

  // Build conditions
  if (minValue !== undefined) conditions.push(`${colName} >= ${minValue}`)
  if (maxValue !== undefined) conditions.push(`${colName} <= ${maxValue}`)
  if (minLen !== undefined) conditions.push(`length(${colName}) >= ${minLen}`)
  if (maxLen !== undefined) conditions.push(`length(${colName}) <= ${maxLen}`)

  return conditions.length > 0 ? `CHECK (${conditions.join(' AND ')})` : null
}

/**
 * Map EdgeDB on_target_delete action to SQL ON DELETE clause.
 *
 * @param action - EdgeDB action string
 * @param required - Whether the link is required
 * @returns SQL ON DELETE clause value
 */
function mapOnDeleteAction(action: string | undefined, required: boolean): string {
  if (action) {
    switch (action) {
      case 'restrict':
        return 'RESTRICT'
      case 'delete source':
        return 'CASCADE'
      case 'allow':
        return 'SET NULL'
    }
  }
  // Default: required links cascade, optional links set null
  return required ? 'CASCADE' : 'SET NULL'
}

/**
 * Generate column for a single-cardinality link (foreign key).
 *
 * @param link - Link definition
 * @param sourceType - Source type name for index naming
 * @returns Column definition and foreign key index
 */
function generateLinkColumn(
  link: Link,
  sourceType: string
): { columnDef: string; fkIndex: string } {
  const colName = `${link.name}_id`
  const onDelete = mapOnDeleteAction(link.onTargetDelete, link.required)
  const hasExclusive = link.constraints?.some((c) => c.type === 'exclusive')

  const columnDef = buildForeignKeyColumn(colName, link.target, {
    required: link.required,
    unique: hasExclusive,
    onDelete,
  })

  const fkIndex = buildCreateIndex(`idx_${sourceType}_${link.name}`, sourceType, [colName])

  return { columnDef, fkIndex }
}

// ============================================================================
// EXPRESSION CONVERSION
// ============================================================================

/**
 * Generate a SQLite GENERATED column for a computed property.
 *
 * @param computed - Computed property definition
 * @returns GENERATED column definition
 */
function generateComputedColumn(computed: ComputedProperty): string | null {
  const colName = toSnakeCase(computed.name)
  const returnType = computed.returnType || 'str'
  const sqlType = mapScalarType(returnType)
  const sqlExpr = convertExpressionToSQL(computed.expression)

  return `${colName} ${sqlType} GENERATED ALWAYS AS (${sqlExpr}) STORED`
}

/**
 * Convert EdgeDB/EdgeQL expression to SQLite expression.
 * Handles property references and string concatenation.
 *
 * @param expr - EdgeDB expression
 * @returns SQLite-compatible expression
 */
function convertExpressionToSQL(expr: string): string {
  return expr
    // Remove leading dots from property references (.name -> name)
    .replace(/\.(\w+)/g, '$1')
    // Replace EdgeDB concatenation with SQLite (++ -> ||)
    .replace(/\+\+/g, '||')
}

/**
 * Convert EdgeDB default expression to SQLite DEFAULT clause.
 * Maps common EdgeDB functions to SQLite equivalents.
 *
 * @param expr - EdgeDB default expression
 * @returns SQLite DEFAULT clause value
 */
function convertDefaultExprToSQL(expr: string): string {
  // Map common EdgeDB functions to SQLite
  const functionMap: Record<string, string> = {
    'datetime_current()': 'CURRENT_TIMESTAMP',
    'uuid_generate_v4()': "(lower(hex(randomblob(16))))",
  }

  return functionMap[expr] || expr
}

// ============================================================================
// INDEX AND TRIGGER GENERATION
// ============================================================================

/**
 * Generate CREATE INDEX statement for a schema index.
 *
 * @param typeName - Type/table name
 * @param idx - Index definition
 * @returns CREATE INDEX statement
 */
function generateIndex(typeName: string, idx: Index): string {
  const columns = idx.on.map((p) => toSnakeCase(p.replace(/^\./, '')))
  const indexName = `idx_${typeName}_${columns.join('_')}`
  return buildCreateIndex(indexName, typeName, columns)
}

/**
 * Generate a trigger to enforce readonly property constraint.
 * Prevents modification of property after initial insert.
 *
 * @param typeName - Type/table name
 * @param propName - Property name
 * @returns CREATE TRIGGER statement
 */
function generateReadonlyTrigger(typeName: string, propName: string): string {
  const colName = toSnakeCase(propName)
  const triggerName = `${typeName}_${colName}_readonly`
  const tableName = quoteIdentifier(typeName)

  return `CREATE TRIGGER ${triggerName}
BEFORE UPDATE ON ${tableName}
FOR EACH ROW
WHEN OLD.${colName} IS NOT NULL AND NEW.${colName} != OLD.${colName}
BEGIN
  SELECT RAISE(ABORT, 'Cannot modify readonly property ${colName}');
END;`
}

/**
 * Generate a trigger to automatically update _updated_at timestamp.
 *
 * @param typeName - Type/table name
 * @returns CREATE TRIGGER statement
 */
function generateUpdatedAtTrigger(typeName: string): string {
  const triggerName = `${typeName}_updated_at`
  const tableName = quoteIdentifier(typeName)

  return `CREATE TRIGGER ${triggerName}
AFTER UPDATE ON ${tableName}
FOR EACH ROW
BEGIN
  UPDATE ${tableName} SET _updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;`
}

// ============================================================================
// METADATA TABLES
// ============================================================================

/**
 * Generate metadata tables for schema introspection.
 * Creates _types, _enums, _backlinks, and _type_hierarchy tables as needed.
 *
 * @param schema - Parsed schema
 * @param typeMap - Type lookup map
 * @returns Combined CREATE TABLE statements for metadata
 */
function generateMetadataTables(
  schema: Schema,
  typeMap: Map<string, TypeDefinition>
): string {
  const tables: string[] = []

  // _types table - always included
  tables.push(`CREATE TABLE _types (
  name TEXT PRIMARY KEY,
  abstract INTEGER NOT NULL DEFAULT 0,
  module TEXT
);`)

  // _enums table - only if schema has enums
  if (schema.enums.length > 0) {
    tables.push(`CREATE TABLE _enums (
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (name, value)
);`)
  }

  // _backlinks table - only if any type has backlinks
  if (schema.types.some((t) => t.backlinks.length > 0)) {
    tables.push(`CREATE TABLE _backlinks (
  type_name TEXT NOT NULL,
  backlink_name TEXT NOT NULL,
  forward_link TEXT NOT NULL,
  target_type TEXT NOT NULL,
  PRIMARY KEY (type_name, backlink_name)
);`)
  }

  // _type_hierarchy table - only if any type uses inheritance
  if (schema.types.some((t) => t.extends.length > 0)) {
    tables.push(`CREATE TABLE _type_hierarchy (
  type_name TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  PRIMARY KEY (type_name, parent_name)
);`)
  }

  return tables.join('\n\n')
}
