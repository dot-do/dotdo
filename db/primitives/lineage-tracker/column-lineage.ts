/**
 * Column Lineage Extraction - Fine-grained column-level lineage from SQL
 *
 * Extracts which source columns contribute to each target column in SQL transformations.
 * Handles complex expressions including CASE, COALESCE, functions, and aggregates.
 *
 * @see dotdo-cpit6
 * @module db/primitives/lineage-tracker/column-lineage
 */

import { Parser } from 'node-sql-parser'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Represents a column reference with optional table qualification
 */
export interface Column {
  /** Table name (if known) */
  table?: string
  /** Column name */
  column: string
}

/**
 * Type of column mapping
 */
export type MappingType =
  /** Direct pass-through: target.col = source.col */
  | 'direct'
  /** Derived from expression: target.total = source.price * source.qty */
  | 'derived'
  /** Result of aggregate function: target.sum = SUM(source.amount) */
  | 'aggregated'
  /** Conditional expression: target.status = CASE WHEN ... END */
  | 'conditional'
  /** Literal value with no source columns */
  | 'literal'

/**
 * Mapping from source columns to a target column
 */
export interface ColumnMapping {
  /** Source columns that contribute to the target */
  sources: Column[]
  /** Target column */
  target: Column
  /** Original SQL expression */
  expression: string
  /** Type of mapping */
  mappingType: MappingType
}

/**
 * Table schema definition
 */
export interface TableSchema {
  /** Column names in this table */
  columns: string[]
}

/**
 * Schema information for column resolution
 */
export interface Schema {
  /** Tables and their columns */
  tables: Record<string, TableSchema>
}

// =============================================================================
// COLUMN LINEAGE EXTRACTOR CLASS
// =============================================================================

/**
 * Extracts column-level lineage from SQL queries
 */
class ColumnLineageExtractor {
  private parser: Parser
  private schema: Schema
  private tableAliases: Map<string, string> = new Map()
  private fromTables: string[] = []

  constructor(schema: Schema) {
    this.parser = new Parser()
    this.schema = schema
  }

  /**
   * Extract column lineage from a SQL query
   */
  extract(sql: string): ColumnMapping[] {
    try {
      const ast = this.parser.astify(sql, { database: 'PostgreSQL' })

      // Handle array of statements
      const stmt = Array.isArray(ast) ? ast[0] : ast

      if (!stmt || stmt.type !== 'select') {
        return []
      }

      return this.extractFromSelect(stmt)
    } catch (error) {
      // Return empty on parse error
      console.error('Failed to parse SQL for column lineage:', error)
      return []
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractFromSelect(stmt: any): ColumnMapping[] {
    const mappings: ColumnMapping[] = []

    // Reset state
    this.tableAliases.clear()
    this.fromTables = []

    // Process FROM clause to get table aliases
    if (stmt.from) {
      this.processFromClause(stmt.from)
    }

    // Process columns
    const columns = stmt.columns

    // Handle SELECT * - the parser returns array with a special star entry
    if (this.isStarSelect(columns)) {
      return this.expandStarColumns()
    }

    if (!Array.isArray(columns)) {
      return []
    }

    for (const col of columns) {
      // Check for table.* expansion
      if (col.expr?.type === 'column_ref' && this.getColumnName(col.expr) === '*') {
        const tableRef = this.getTableFromColumnRef(col.expr)
        const tableName = this.resolveTableName(tableRef)
        if (tableName) {
          mappings.push(...this.expandTableStarColumns(tableName))
        }
        continue
      }

      const mapping = this.extractColumnMapping(col)
      if (mapping) {
        mappings.push(mapping)
      }
    }

    return mappings
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isStarSelect(columns: any): boolean {
    if (columns === '*') return true
    if (Array.isArray(columns) && columns.length === 1) {
      const col = columns[0]
      if (col.expr?.type === 'column_ref' && !col.expr.table) {
        const colName = this.getColumnName(col.expr)
        return colName === '*'
      }
    }
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processFromClause(from: any[]): void {
    for (const f of from) {
      if (f.table) {
        const tableName = f.table
        const alias = f.as || tableName
        this.tableAliases.set(alias, tableName)
        this.fromTables.push(tableName)
      }

      // Handle subqueries
      if (f.expr && (f.expr.ast || f.expr.type === 'select')) {
        // Subquery - use the alias
        if (f.as) {
          this.tableAliases.set(f.as, f.as)
          this.fromTables.push(f.as)
        }
      }
    }
  }

  private expandStarColumns(): ColumnMapping[] {
    const mappings: ColumnMapping[] = []

    for (const tableName of this.fromTables) {
      mappings.push(...this.expandTableStarColumns(tableName))
    }

    return mappings
  }

  private expandTableStarColumns(tableName: string): ColumnMapping[] {
    const mappings: ColumnMapping[] = []
    const tableSchema = this.schema.tables[tableName]

    if (tableSchema) {
      for (const column of tableSchema.columns) {
        mappings.push({
          sources: [{ table: tableName, column }],
          target: { column },
          expression: `${tableName}.${column}`,
          mappingType: 'direct',
        })
      }
    }

    return mappings
  }

  /**
   * Extract the actual column name from a column_ref node
   * Handles both simple strings and nested { expr: { type: 'default', value: 'name' } }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getColumnName(columnRef: any): string {
    if (!columnRef) return ''

    const col = columnRef.column
    if (!col) return ''

    // Simple string
    if (typeof col === 'string') return col

    // Nested { expr: { type: 'default', value: 'name' } }
    if (col.expr?.value) return col.expr.value

    // Direct { value: 'name' }
    if (col.value) return col.value

    return ''
  }

  /**
   * Extract the table name from a column_ref node
   * Handles both simple strings and nested { type: 'default', value: 'tablename' }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getTableFromColumnRef(columnRef: any): string | undefined {
    if (!columnRef || !columnRef.table) return undefined

    const tbl = columnRef.table
    if (typeof tbl === 'string') return tbl
    if (tbl.value) return tbl.value
    return undefined
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractColumnMapping(col: any): ColumnMapping | null {
    const alias = col.as || this.inferColumnName(col.expr)
    const sources = this.extractSourceColumns(col.expr)
    const mappingType = this.determineMappingType(col.expr, sources)
    const expression = this.expressionToString(col.expr)

    return {
      sources,
      target: { column: alias },
      expression,
      mappingType,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractSourceColumns(expr: any): Column[] {
    if (!expr) return []

    const columns: Column[] = []
    this.collectColumnRefs(expr, columns)

    // Deduplicate
    const seen = new Set<string>()
    return columns.filter((col) => {
      const key = `${col.table || ''}.${col.column}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private collectColumnRefs(expr: any, columns: Column[]): void {
    if (!expr) return

    if (expr.type === 'column_ref') {
      const colName = this.getColumnName(expr)
      if (colName && colName !== '*') {
        const tableRef = this.getTableFromColumnRef(expr)
        const table = this.resolveTableName(tableRef)
        columns.push({
          table: table || this.inferTableForColumn(colName),
          column: colName,
        })
      }
      return
    }

    // Handle binary expressions
    if (expr.left) {
      this.collectColumnRefs(expr.left, columns)
    }
    if (expr.right) {
      this.collectColumnRefs(expr.right, columns)
    }

    // Handle function arguments - node-sql-parser wraps args in { expr: ... }
    if (expr.args) {
      if (expr.args.expr) {
        // Single argument wrapped in { expr: ... }
        this.collectColumnRefs(expr.args.expr, columns)
      } else if (Array.isArray(expr.args)) {
        for (const arg of expr.args) {
          this.collectColumnRefs(arg, columns)
        }
      } else if (expr.args.value) {
        // Aggregate functions wrap args in { value: [] }
        for (const arg of expr.args.value) {
          this.collectColumnRefs(arg, columns)
        }
      }
    }

    // Handle CASE expressions
    if (expr.type === 'case') {
      // Simple CASE: CASE expr WHEN ...
      if (expr.expr) {
        this.collectColumnRefs(expr.expr, columns)
      }
      // CASE WHEN conditions
      if (expr.args) {
        for (const arg of expr.args) {
          if (arg.cond) {
            this.collectColumnRefs(arg.cond, columns)
          }
          if (arg.result) {
            this.collectColumnRefs(arg.result, columns)
          }
        }
      }
    }

    // Handle subselect in expression
    if (expr.ast) {
      // This is a subquery - for now, we skip it
    }
  }

  private resolveTableName(alias: string | undefined | null): string | undefined {
    if (!alias) return undefined
    return this.tableAliases.get(alias) || alias
  }

  private inferTableForColumn(column: string): string | undefined {
    // Look up the column in the schema to find which table it belongs to
    for (const [tableName, tableSchema] of Object.entries(this.schema.tables)) {
      if (tableSchema.columns.includes(column)) {
        // Check if this table is in our FROM clause
        if (this.fromTables.includes(tableName)) {
          return tableName
        }
      }
    }

    // If only one table in FROM, use that
    if (this.fromTables.length === 1) {
      return this.fromTables[0]
    }

    return undefined
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inferColumnName(expr: any): string {
    if (!expr) return 'unknown'

    if (expr.type === 'column_ref') {
      return this.getColumnName(expr)
    }

    if (expr.type === 'aggr_func') {
      const name = expr.name || 'agg'
      return name.toLowerCase()
    }

    if (expr.type === 'function') {
      const name = expr.name || 'fn'
      return name.toLowerCase()
    }

    return 'expr'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private determineMappingType(expr: any, sources: Column[]): MappingType {
    if (!expr) return 'literal'

    // Aggregate functions (check before sources.length === 0)
    if (expr.type === 'aggr_func') {
      return 'aggregated'
    }

    // No source columns means literal
    if (sources.length === 0) {
      return 'literal'
    }

    // Direct column reference
    if (expr.type === 'column_ref') {
      return 'direct'
    }

    // CASE expressions
    if (expr.type === 'case') {
      return 'conditional'
    }

    // Function calls or expressions with sources are derived
    if (expr.type === 'function' || expr.type === 'binary_expr') {
      return 'derived'
    }

    // Default to derived if we have sources but it's not a simple column ref
    return 'derived'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private expressionToString(expr: any): string {
    if (!expr) return ''

    try {
      // Use the parser's sqlify to convert back to SQL
      const stmt = {
        type: 'select',
        columns: [{ expr, as: null }],
      }
      const sql = this.parser.sqlify(stmt, { database: 'PostgreSQL' })
      // Extract just the column part
      const match = sql.match(/SELECT\s+(.+?)(?:\s+AS\s+|$)/i)
      return match ? match[1].trim() : ''
    } catch {
      return ''
    }
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Extract column-level lineage from a SQL query
 *
 * @param sql - SQL query string
 * @param schema - Schema information for column resolution
 * @returns Array of column mappings
 *
 * @example
 * ```typescript
 * const schema = {
 *   tables: {
 *     users: { columns: ['id', 'name', 'email'] },
 *     orders: { columns: ['id', 'user_id', 'amount'] },
 *   },
 * }
 *
 * const mappings = extractColumnLineage(
 *   'SELECT u.name, SUM(o.amount) AS total FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name',
 *   schema
 * )
 *
 * // Result:
 * // [
 * //   { sources: [{ table: 'users', column: 'name' }], target: { column: 'name' }, mappingType: 'direct' },
 * //   { sources: [{ table: 'orders', column: 'amount' }], target: { column: 'total' }, mappingType: 'aggregated' },
 * // ]
 * ```
 */
export function extractColumnLineage(sql: string, schema: Schema): ColumnMapping[] {
  const extractor = new ColumnLineageExtractor(schema)
  return extractor.extract(sql)
}
