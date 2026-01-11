/**
 * DDL Generator - Gel Schema to SQLite DDL
 *
 * Converts Schema IR from SDL Parser to SQLite DDL statements.
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

// SQL reserved keywords that need quoting
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
 * Convert PascalCase or camelCase to snake_case
 */
export function toSnakeCase(name: string): string {
  // Handle acronyms (consecutive uppercase letters)
  // e.g., userID -> user_id, XMLParser -> xml_parser
  let result = name
    // Insert underscore before sequences of uppercase followed by lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // Insert underscore between lowercase/number and uppercase
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()

  return result
}

/**
 * Quote identifier if it's a reserved SQL keyword
 */
function quoteIdentifier(name: string): string {
  if (SQL_RESERVED_KEYWORDS.has(name.toLowerCase())) {
    return `"${name}"`
  }
  return name
}

/**
 * Map EdgeDB/Gel scalar type to SQLite type
 */
export function mapScalarType(sdlType: string): string {
  const typeMap: Record<string, string> = {
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

  const sqlType = typeMap[sdlType]
  if (!sqlType) {
    throw new Error(`Unknown scalar type: ${sdlType}`)
  }
  return sqlType
}

/**
 * Escape single quotes in string for SQL
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Format default value for SQL
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

/**
 * Generate the column definition for a property
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
 * Generate a CHECK constraint from EdgeDB constraint
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

/**
 * Generate junction table for multi-link
 */
export function generateJunctionTable(
  sourceType: string,
  linkName: string,
  targetType: string,
  linkProperties?: Array<{ name: string; type: string; required: boolean }>
): string {
  const tableName = `${sourceType}_${linkName}`
  const columns: string[] = [
    `source_id TEXT NOT NULL REFERENCES ${quoteIdentifier(sourceType)}(id) ON DELETE CASCADE`,
    `target_id TEXT NOT NULL REFERENCES ${quoteIdentifier(targetType)}(id) ON DELETE CASCADE`,
    '_ordinal INTEGER DEFAULT 0',
  ]

  // Add link properties
  if (linkProperties) {
    for (const prop of linkProperties) {
      const sqlType = mapScalarType(prop.type)
      const col = toSnakeCase(prop.name)
      if (prop.required) {
        columns.push(`${col} ${sqlType} NOT NULL`)
      } else {
        columns.push(`${col} ${sqlType}`)
      }
    }
  }

  columns.push('PRIMARY KEY (source_id, target_id)')

  return `CREATE TABLE ${tableName} (\n  ${columns.join(',\n  ')}\n);`
}

/**
 * Collect all inherited properties and links from parent types
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
    // First collect from parent types
    for (const parentName of t.extends) {
      const parent = allTypes.get(parentName)
      if (parent) {
        collectFromType(parent)
      }
    }

    // Then add this type's members (excluding duplicates)
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
    // Collect indexes and constraints from parent
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

/**
 * Generate SQLite DDL from Schema IR
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

/**
 * Generate table DDL for a single type
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

  // ID column first
  columns.push("id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))")

  // _type column for STI inheritance
  const hasParent = typeDef.extends.length > 0
  if (opts.inheritanceStrategy === 'sti' && hasParent) {
    columns.push(`_type TEXT NOT NULL DEFAULT '${typeDef.name}'`)
    tableIndexes.push(
      `CREATE INDEX idx_${typeDef.name}__type ON ${quoteIdentifier(typeDef.name)}(_type);`
    )
  }

  // Properties
  for (const prop of allProperties) {
    const { columnDef, checkConstraints } = generatePropertyColumn(prop, enumMap)
    columns.push(columnDef)
    tableConstraints.push(...checkConstraints)

    // Generate readonly trigger
    if (prop.readonly) {
      tableTriggers.push(generateReadonlyTrigger(typeDef.name, prop.name))
    }
  }

  // Single links (foreign keys)
  for (const link of allLinks) {
    if (link.cardinality === 'single') {
      const { columnDef, fkIndex } = generateLinkColumn(link, typeDef.name)
      columns.push(columnDef)
      tableIndexes.push(fkIndex)
    }
  }

  // Computed properties
  for (const computed of typeDef.computedProperties) {
    const computedCol = generateComputedColumn(computed)
    if (computedCol) {
      columns.push(computedCol)
    }
  }

  // Timestamps
  if (opts.addTimestamps) {
    columns.push('_created_at TEXT DEFAULT CURRENT_TIMESTAMP')
    columns.push('_updated_at TEXT DEFAULT CURRENT_TIMESTAMP')

    // Updated_at trigger
    tableTriggers.push(generateUpdatedAtTrigger(typeDef.name))
  }

  // Add table-level constraints
  for (const constraint of allConstraints) {
    if (constraint.type === 'exclusive' && constraint.on) {
      const cols = constraint.on.map((p) => toSnakeCase(p.replace(/^\./, '')))
      tableConstraints.push(`UNIQUE (${cols.join(', ')})`)
    } else if (constraint.type === 'expression' && constraint.expr) {
      // Convert EdgeDB expression to SQLite
      const sqlExpr = convertExpressionToSQL(constraint.expr)
      tableConstraints.push(`CHECK (${sqlExpr})`)
    }
  }

  // Build final table DDL
  const tableName = quoteIdentifier(typeDef.name)
  const allParts = [...columns, ...tableConstraints]
  const table = `CREATE TABLE ${tableName} (\n  ${allParts.join(',\n  ')}\n);`

  // Generate explicit indexes
  for (const idx of allIndexes) {
    const indexDDL = generateIndex(typeDef.name, idx)
    tableIndexes.push(indexDDL)
  }

  return { table, tableIndexes, tableTriggers }
}

/**
 * Generate column definition for a property
 */
function generatePropertyColumn(
  prop: Property,
  enumMap: Map<string, EnumDefinition>
): { columnDef: string; checkConstraints: string[] } {
  const checkConstraints: string[] = []
  const colName = toSnakeCase(prop.name)
  const quotedColName = quoteIdentifier(colName)

  // Check if type is an enum
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
  const hasExclusive = prop.constraints.some((c) => c.type === 'exclusive')
  if (hasExclusive) {
    parts.push('UNIQUE')
  }

  // Handle default value
  if (prop.default !== undefined) {
    parts.push(`DEFAULT ${formatDefaultValue(prop.default, prop.type)}`)
  } else if (prop.defaultExpr) {
    const sqlDefault = convertDefaultExprToSQL(prop.defaultExpr)
    parts.push(`DEFAULT ${sqlDefault}`)
  }

  // Handle check constraints
  const valueConstraints = generateValueConstraints(prop)
  if (valueConstraints) {
    checkConstraints.push(valueConstraints)
  }

  // Handle enum constraint
  if (enumDef) {
    const values = enumDef.values.map((v) => `'${escapeSqlString(v)}'`).join(', ')
    checkConstraints.push(`CHECK (${colName} IN (${values}))`)
  }

  // Handle one_of constraint
  const oneOfConstraint = prop.constraints.find((c) => c.type === 'one_of')
  if (oneOfConstraint?.values) {
    const values = oneOfConstraint.values.map((v) => `'${escapeSqlString(v)}'`).join(', ')
    checkConstraints.push(`CHECK (${colName} IN (${values}))`)
  }

  return { columnDef: parts.join(' '), checkConstraints }
}

/**
 * Generate value constraints (min_value, max_value, min_len_value, max_len_value)
 */
function generateValueConstraints(prop: Property): string | null {
  const colName = toSnakeCase(prop.name)
  const minValue = prop.constraints.find((c) => c.type === 'min_value')
  const maxValue = prop.constraints.find((c) => c.type === 'max_value')
  const minLen = prop.constraints.find((c) => c.type === 'min_len_value')
  const maxLen = prop.constraints.find((c) => c.type === 'max_len_value')

  const conditions: string[] = []

  if (minValue?.value !== undefined) {
    conditions.push(`${colName} >= ${minValue.value}`)
  }
  if (maxValue?.value !== undefined) {
    conditions.push(`${colName} <= ${maxValue.value}`)
  }
  if (minLen?.value !== undefined) {
    conditions.push(`length(${colName}) >= ${minLen.value}`)
  }
  if (maxLen?.value !== undefined) {
    conditions.push(`length(${colName}) <= ${maxLen.value}`)
  }

  if (conditions.length === 0) {
    return null
  }

  return `CHECK (${conditions.join(' AND ')})`
}

/**
 * Generate column for a single link (foreign key)
 */
function generateLinkColumn(
  link: Link,
  sourceType: string
): { columnDef: string; fkIndex: string } {
  const colName = `${link.name}_id`
  const targetTable = quoteIdentifier(link.target)

  // Determine ON DELETE behavior
  let onDelete = 'SET NULL'
  if (link.onTargetDelete) {
    switch (link.onTargetDelete) {
      case 'restrict':
        onDelete = 'RESTRICT'
        break
      case 'delete source':
        onDelete = 'CASCADE'
        break
      case 'allow':
        onDelete = 'SET NULL'
        break
    }
  } else if (link.required) {
    onDelete = 'CASCADE'
  }

  // Check for exclusive constraint
  const hasExclusive = link.constraints?.some((c) => c.type === 'exclusive')

  const parts = [colName, 'TEXT']
  if (link.required) {
    parts.push('NOT NULL')
  }
  if (hasExclusive) {
    parts.push('UNIQUE')
  }
  parts.push(`REFERENCES ${targetTable}(id) ON DELETE ${onDelete}`)

  const fkIndex = `CREATE INDEX idx_${sourceType}_${link.name} ON ${quoteIdentifier(sourceType)}(${colName});`

  return { columnDef: parts.join(' '), fkIndex }
}

/**
 * Generate computed column (GENERATED ALWAYS AS)
 */
function generateComputedColumn(computed: ComputedProperty): string | null {
  const colName = toSnakeCase(computed.name)
  const returnType = computed.returnType || 'str'
  const sqlType = mapScalarType(returnType)

  // Convert EdgeDB expression to SQLite
  const sqlExpr = convertExpressionToSQL(computed.expression)

  return `${colName} ${sqlType} GENERATED ALWAYS AS (${sqlExpr}) STORED`
}

/**
 * Convert EdgeDB expression to SQLite expression
 */
function convertExpressionToSQL(expr: string): string {
  return (
    expr
      // Remove leading dots from property references
      .replace(/\.(\w+)/g, '$1')
      // Replace ++ with ||
      .replace(/\+\+/g, '||')
  )
}

/**
 * Convert EdgeDB default expression to SQLite default
 */
function convertDefaultExprToSQL(expr: string): string {
  if (expr === 'datetime_current()') {
    return 'CURRENT_TIMESTAMP'
  }
  if (expr === 'uuid_generate_v4()') {
    return "(lower(hex(randomblob(16))))"
  }
  return expr
}

/**
 * Generate index DDL
 */
function generateIndex(typeName: string, idx: Index): string {
  const columns = idx.on.map((p) => toSnakeCase(p.replace(/^\./, '')))
  const indexName = `idx_${typeName}_${columns.join('_')}`
  const tableName = quoteIdentifier(typeName)

  return `CREATE INDEX ${indexName} ON ${tableName}(${columns.join(', ')});`
}

/**
 * Generate readonly trigger
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
 * Generate updated_at trigger
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

/**
 * Generate metadata tables (_types, _enums, _backlinks, _type_hierarchy)
 */
function generateMetadataTables(
  schema: Schema,
  typeMap: Map<string, TypeDefinition>
): string {
  const tables: string[] = []

  // _types table
  tables.push(`CREATE TABLE _types (
  name TEXT PRIMARY KEY,
  abstract INTEGER NOT NULL DEFAULT 0,
  module TEXT
);`)

  // _enums table
  if (schema.enums.length > 0) {
    tables.push(`CREATE TABLE _enums (
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (name, value)
);`)
  }

  // _backlinks table
  const hasBacklinks = schema.types.some((t) => t.backlinks.length > 0)
  if (hasBacklinks) {
    tables.push(`CREATE TABLE _backlinks (
  type_name TEXT NOT NULL,
  backlink_name TEXT NOT NULL,
  forward_link TEXT NOT NULL,
  target_type TEXT NOT NULL,
  PRIMARY KEY (type_name, backlink_name)
);`)
  }

  // _type_hierarchy table
  const hasInheritance = schema.types.some((t) => t.extends.length > 0)
  if (hasInheritance) {
    tables.push(`CREATE TABLE _type_hierarchy (
  type_name TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  PRIMARY KEY (type_name, parent_name)
);`)
  }

  return tables.join('\n\n')
}
