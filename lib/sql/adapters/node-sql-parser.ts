/**
 * @dotdo/lib/sql/adapters/node-sql-parser - Node SQL Parser Adapter
 *
 * Lightweight SQL parser adapter (298KB) with multi-dialect support.
 * Uses node-sql-parser which provides good parse coverage across
 * PostgreSQL, MySQL, SQLite, and other SQL dialects.
 *
 * Performance: ~80μs parse time
 * Bundle size: ~298KB
 *
 * @module lib/sql/adapters/node-sql-parser
 */

import { Parser } from 'node-sql-parser'
import type {
  SQLParser,
  AST,
  ParseResult,
  ParseOptions,
  StringifyOptions,
  ValidationResult,
  ValidationIssue,
  Dialect,
  SelectStatement,
  InsertStatement,
  UpdateStatement,
  DeleteStatement,
  CreateTableStatement,
  ColumnRef,
  TableRef,
  Expression,
  LiteralValue,
} from '../types'
import { SQLParseError, SQLStringifyError } from '../types'

// ============================================================================
// DIALECT MAPPING
// ============================================================================

/**
 * Map our dialect names to node-sql-parser dialect names
 */
const DIALECT_MAP: Record<Dialect, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  mariadb: 'MariaDB',
  transactsql: 'TransactSQL',
  bigquery: 'BigQuery',
}

/**
 * Reverse dialect map
 */
const REVERSE_DIALECT_MAP: Record<string, Dialect> = Object.entries(DIALECT_MAP).reduce(
  (acc, [key, value]) => ({ ...acc, [value.toLowerCase()]: key as Dialect }),
  {} as Record<string, Dialect>
)

/**
 * Supported dialects for this adapter
 */
const SUPPORTED_DIALECTS: Dialect[] = ['postgresql', 'mysql', 'sqlite', 'mariadb', 'transactsql', 'bigquery']

// ============================================================================
// AST CONVERSION UTILITIES
// ============================================================================

/**
 * Convert node-sql-parser AST to our normalized AST format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertAST(nodeAst: any, dialect: Dialect): AST {
  if (!nodeAst) {
    return { type: 'unknown' }
  }

  // Handle array of statements
  if (Array.isArray(nodeAst)) {
    return nodeAst.map((stmt) => convertAST(stmt, dialect)) as unknown as AST
  }

  const nodeType = nodeAst.type?.toLowerCase() || 'unknown'

  switch (nodeType) {
    case 'select':
      return convertSelectStatement(nodeAst, dialect)
    case 'insert':
      return convertInsertStatement(nodeAst, dialect)
    case 'update':
      return convertUpdateStatement(nodeAst, dialect)
    case 'delete':
      return convertDeleteStatement(nodeAst, dialect)
    case 'create':
      if (nodeAst.keyword === 'table') {
        return convertCreateTableStatement(nodeAst, dialect)
      }
      return { type: 'create_' + (nodeAst.keyword || 'unknown').toLowerCase(), ...nodeAst }
    default:
      // Return as-is for other statement types
      return { type: nodeType, ...nodeAst }
  }
}

/**
 * Convert SELECT statement
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertSelectStatement(nodeAst: any, _dialect: Dialect): SelectStatement {
  return {
    type: 'select',
    distinct: nodeAst.distinct || undefined,
    columns: convertColumns(nodeAst.columns),
    from: nodeAst.from ? convertFrom(nodeAst.from) : undefined,
    where: nodeAst.where ? convertExpression(nodeAst.where) : undefined,
    groupby: nodeAst.groupby && Array.isArray(nodeAst.groupby) ? nodeAst.groupby.map(convertExpression) : undefined,
    having: nodeAst.having ? convertExpression(nodeAst.having) : undefined,
    orderby: nodeAst.orderby ? convertOrderBy(nodeAst.orderby) : undefined,
    limit: nodeAst.limit ? convertLimit(nodeAst.limit) : undefined,
    with: nodeAst.with ? convertWith(nodeAst.with) : undefined,
  }
}

/**
 * Convert INSERT statement
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertInsertStatement(nodeAst: any, dialect: Dialect): InsertStatement {
  const result: InsertStatement = {
    type: 'insert',
    table: convertTableRef(nodeAst.table?.[0] || nodeAst.table),
    columns: nodeAst.columns || undefined,
    values: nodeAst.values
      ? nodeAst.values.map((row: { value: unknown[] }) =>
          row.value.map(convertLiteral)
        )
      : undefined,
  }

  if (nodeAst.returning) {
    result.returning = nodeAst.returning.map(convertColumnRef)
  }

  if (nodeAst.set) {
    result.select = convertSelectStatement(nodeAst.set, dialect) as SelectStatement
  }

  return result
}

/**
 * Convert UPDATE statement
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertUpdateStatement(nodeAst: any, _dialect: Dialect): UpdateStatement {
  const result: UpdateStatement = {
    type: 'update',
    table: convertTableRef(nodeAst.table?.[0] || nodeAst.table),
    set: nodeAst.set
      ? nodeAst.set.map((s: { column: string; value: unknown }) => ({
          column: s.column,
          value: convertExpression(s.value),
        }))
      : [],
    where: nodeAst.where ? convertExpression(nodeAst.where) : undefined,
  }

  if (nodeAst.returning) {
    result.returning = nodeAst.returning.map(convertColumnRef)
  }

  return result
}

/**
 * Convert DELETE statement
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertDeleteStatement(nodeAst: any, _dialect: Dialect): DeleteStatement {
  const result: DeleteStatement = {
    type: 'delete',
    from: convertTableRef(nodeAst.from?.[0] || nodeAst.table?.[0] || nodeAst.from),
    where: nodeAst.where ? convertExpression(nodeAst.where) : undefined,
  }

  if (nodeAst.returning) {
    result.returning = nodeAst.returning.map(convertColumnRef)
  }

  return result
}

/**
 * Convert CREATE TABLE statement
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertCreateTableStatement(nodeAst: any, _dialect: Dialect): CreateTableStatement {
  return {
    type: 'create_table',
    table: convertTableRef(nodeAst.table?.[0] || nodeAst.table),
    if_not_exists: nodeAst.if_not_exists || undefined,
    columns: nodeAst.create_definitions
      ? nodeAst.create_definitions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((def: any) => def.resource === 'column')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((col: any) => ({
            name: col.column?.column || col.column,
            dataType: col.definition?.dataType || 'TEXT',
            nullable: col.nullable?.value !== 'not null',
            default: col.default_val ? convertLiteral(col.default_val.value) : undefined,
            primary_key: col.primary_key || undefined,
            unique: col.unique_or_primary === 'unique' || undefined,
            auto_increment: col.auto_increment || undefined,
          }))
      : [],
    constraints: nodeAst.create_definitions
      ? nodeAst.create_definitions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((def: any) => def.resource === 'constraint')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((con: any) => ({
            type: con.constraint_type?.toLowerCase() || 'unknown',
            name: con.constraint || undefined,
            columns: con.definition || undefined,
          }))
      : undefined,
  }
}

/**
 * Convert column list
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertColumns(columns: any): SelectStatement['columns'] {
  if (columns === '*') {
    return '*'
  }

  if (!Array.isArray(columns)) {
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return columns.map((col: any) => {
    if (col.expr?.type === 'column_ref') {
      return {
        ...convertColumnRef(col.expr),
        as: col.as || undefined,
      }
    }
    return {
      expr: convertExpression(col.expr || col),
      as: col.as || undefined,
    }
  })
}

/**
 * Convert FROM clause
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertFrom(from: any[]): TableRef[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return from.map((f: any) => convertTableRef(f))
}

/**
 * Convert table reference
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTableRef(table: any): TableRef {
  if (!table) {
    return { type: 'table_ref', table: '' }
  }

  return {
    type: 'table_ref',
    db: table.db || undefined,
    schema: table.schema || undefined,
    table: table.table || table,
    as: table.as || undefined,
  }
}

/**
 * Convert column reference
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertColumnRef(col: any): ColumnRef {
  if (!col) {
    return { type: 'column_ref', column: '' }
  }

  return {
    type: 'column_ref',
    table: col.table || undefined,
    column: col.column || col,
    as: col.as || undefined,
  }
}

/**
 * Convert expression
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertExpression(expr: any): Expression | ColumnRef | LiteralValue {
  if (!expr) {
    return { type: 'null', value: null }
  }

  const exprType = expr.type?.toLowerCase() || 'unknown'

  switch (exprType) {
    case 'column_ref':
      return convertColumnRef(expr)

    case 'number':
    case 'string':
    case 'bool':
    case 'null':
      return convertLiteral(expr)

    case 'binary_expr':
      return {
        type: 'binary_expr',
        operator: expr.operator,
        left: convertExpression(expr.left),
        right: convertExpression(expr.right),
      }

    case 'unary_expr':
      return {
        type: 'unary_expr',
        operator: expr.operator,
        args: [convertExpression(expr.expr)],
      }

    case 'function':
    case 'aggr_func':
      return {
        type: exprType,
        operator: expr.name || expr.type,
        args: expr.args?.value?.map(convertExpression) || [],
      }

    case 'cast':
      return {
        type: 'cast',
        args: [convertExpression(expr.expr)],
        operator: expr.target?.dataType || 'unknown',
      }

    case 'case':
      return {
        type: 'case',
        args: expr.args?.map(convertExpression) || [],
      }

    default:
      // Return as generic expression
      return {
        type: exprType,
        operator: expr.operator || expr.name,
        left: expr.left ? convertExpression(expr.left) : undefined,
        right: expr.right ? convertExpression(expr.right) : undefined,
        args: expr.args ? (Array.isArray(expr.args) ? expr.args.map(convertExpression) : [convertExpression(expr.args)]) : undefined,
      }
  }
}

/**
 * Convert literal value
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertLiteral(lit: any): LiteralValue {
  if (lit === null || lit === undefined) {
    return { type: 'null', value: null }
  }

  if (typeof lit === 'number') {
    return { type: 'number', value: lit }
  }

  if (typeof lit === 'string') {
    return { type: 'string', value: lit }
  }

  if (typeof lit === 'boolean') {
    return { type: 'bool', value: lit }
  }

  const litType = lit.type?.toLowerCase() || 'string'

  switch (litType) {
    case 'number':
      return { type: 'number', value: lit.value }
    case 'single_quote_string':
    case 'double_quote_string':
    case 'string':
      return { type: 'string', value: lit.value }
    case 'bool':
      return { type: 'bool', value: lit.value }
    case 'null':
      return { type: 'null', value: null }
    case 'param':
    case 'var':
      return { type: 'param', value: lit.value }
    default:
      return { type: 'string', value: String(lit.value ?? lit) }
  }
}

/**
 * Convert ORDER BY clause
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertOrderBy(orderby: any[]): SelectStatement['orderby'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return orderby.map((o: any) => ({
    expr: convertExpression(o.expr) as ColumnRef | Expression,
    type: (o.type?.toUpperCase() || 'ASC') as 'ASC' | 'DESC',
    nulls: o.nulls?.toUpperCase() as 'FIRST' | 'LAST' | undefined,
  }))
}

/**
 * Convert LIMIT clause
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertLimit(limit: any): SelectStatement['limit'] {
  if (!limit) return undefined

  // Handle different limit formats
  if (Array.isArray(limit)) {
    return {
      value: limit[0]?.value ?? limit[0],
      offset: limit[1]?.value ?? limit[1],
    }
  }

  return {
    value: limit.value?.[0]?.value ?? limit.value ?? limit,
    offset: limit.value?.[1]?.value ?? undefined,
  }
}

/**
 * Convert WITH clause (CTEs)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertWith(withClause: any[]): SelectStatement['with'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withClause.map((w: any) => ({
    name: w.name?.value || w.name,
    columns: w.columns,
    query: convertSelectStatement(w.stmt, 'postgresql') as SelectStatement,
    recursive: w.recursive || undefined,
  }))
}

// ============================================================================
// NODE SQL PARSER ADAPTER
// ============================================================================

/**
 * Node SQL Parser adapter implementing the unified SQLParser interface.
 *
 * This adapter wraps node-sql-parser to provide:
 * - Multi-dialect support (PostgreSQL, MySQL, SQLite, MariaDB, etc.)
 * - AST normalization to our unified format
 * - Validation with detailed error messages
 * - SQL generation from AST
 *
 * @example
 * ```typescript
 * const parser = new NodeSQLParserAdapter()
 *
 * // Parse SQL
 * const result = parser.parse('SELECT * FROM users WHERE active = true')
 *
 * // Convert back to SQL
 * const sql = parser.stringify(result.ast)
 *
 * // Validate SQL
 * const validation = parser.validate('SELEC * FROM users')
 * ```
 */
export class NodeSQLParserAdapter implements SQLParser {
  private parser: Parser

  constructor() {
    this.parser = new Parser()
  }

  /**
   * Adapter name
   */
  get adapterName(): string {
    return 'node-sql-parser'
  }

  /**
   * Supported dialects
   */
  get supportedDialects(): Dialect[] {
    return SUPPORTED_DIALECTS
  }

  /**
   * Parse SQL string to AST
   */
  parse(sql: string, options: ParseOptions = {}): ParseResult {
    const dialect = options.dialect || 'postgresql'
    const nodeSqlDialect = DIALECT_MAP[dialect]

    if (!nodeSqlDialect) {
      throw new SQLParseError(`Unsupported dialect: ${dialect}`, {
        sql,
        dialect,
      })
    }

    const startTime = performance.now()

    try {
      const nodeAst = this.parser.astify(sql, { database: nodeSqlDialect })
      const endTime = performance.now()
      const parseTimeUs = Math.round((endTime - startTime) * 1000)

      const ast = Array.isArray(nodeAst)
        ? nodeAst.map((stmt) => convertAST(stmt, dialect))
        : convertAST(nodeAst, dialect)

      return {
        ast: ast as AST,
        sql,
        dialect,
        parseTimeUs,
      }
    } catch (error) {
      if (options.throwOnError === false) {
        return {
          ast: { type: 'unknown' },
          sql,
          dialect,
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      // Try to extract location from error message
      const locationMatch = errorMessage.match(/line (\d+), column (\d+)/i)
      const location = locationMatch
        ? { line: parseInt(locationMatch[1]!, 10), column: parseInt(locationMatch[2]!, 10) }
        : undefined

      throw new SQLParseError(errorMessage, {
        sql,
        dialect,
        location,
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * Convert AST back to SQL string
   */
  stringify(ast: AST | AST[], options: StringifyOptions = {}): string {
    const dialect = options.dialect || 'postgresql'
    const nodeSqlDialect = DIALECT_MAP[dialect]

    if (!nodeSqlDialect) {
      throw new SQLStringifyError(`Unsupported dialect: ${dialect}`)
    }

    try {
      // node-sql-parser expects its own AST format
      // We need to pass through the original or convert back
      const nodeAst = this.convertToNodeAST(ast)
      return this.parser.sqlify(nodeAst, { database: nodeSqlDialect })
    } catch (error) {
      throw new SQLStringifyError(
        `Failed to stringify AST: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined }
      )
    }
  }

  /**
   * Validate SQL syntax
   */
  validate(sql: string, dialect: Dialect = 'postgresql'): ValidationResult {
    const issues: ValidationIssue[] = []

    try {
      const result = this.parse(sql, { dialect, throwOnError: false })

      // Check if we got a valid AST
      if (!result.ast || (result.ast as { type: string }).type === 'unknown') {
        issues.push({
          severity: 'error',
          message: 'Failed to parse SQL statement',
          code: 'PARSE_ERROR',
        })
      }
    } catch (error) {
      const parseError = error as SQLParseError
      issues.push({
        severity: 'error',
        message: parseError.message,
        location: parseError.location,
        code: 'PARSE_ERROR',
      })
    }

    return {
      valid: issues.length === 0,
      issues,
      sql,
      dialect,
    }
  }

  /**
   * Convert our normalized AST back to node-sql-parser format
   * This is a simplified conversion that handles common cases
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertToNodeAST(ast: AST | AST[]): any {
    if (Array.isArray(ast)) {
      return ast.map((a) => this.convertToNodeAST(a))
    }

    // For now, we pass through the AST as-is since node-sql-parser
    // can often handle various AST formats. In production, you might
    // need more sophisticated conversion.
    return ast
  }
}

/**
 * Create a new NodeSQLParserAdapter instance
 */
export function createNodeSQLParserAdapter(): NodeSQLParserAdapter {
  return new NodeSQLParserAdapter()
}

export default NodeSQLParserAdapter
