/**
 * @dotdo/lib/sql/adapters/pgsql-parser - PostgreSQL WASM Parser Adapter
 *
 * High-performance PostgreSQL parser using pgsql-parser (libpg_query WASM).
 * This is the real PostgreSQL parser compiled to WebAssembly, providing
 * exact PostgreSQL syntax parsing with 5-13x better performance.
 *
 * Performance: ~16μs parse time (5-13x faster than node-sql-parser)
 * Bundle size: ~1.2MB (WASM binary)
 * Dialect: PostgreSQL only
 *
 * @module lib/sql/adapters/pgsql-parser
 */

import { parseSync as pgParse, deparseSync as pgDeparse } from 'pgsql-parser'
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
  OrderByClause,
} from '../types'
import { SQLParseError, SQLStringifyError } from '../types'

// ============================================================================
// SUPPORTED DIALECTS
// ============================================================================

/**
 * pgsql-parser only supports PostgreSQL
 */
const SUPPORTED_DIALECTS: Dialect[] = ['postgresql']

// ============================================================================
// AST CONVERSION UTILITIES
// ============================================================================

/**
 * PostgreSQL node types from libpg_query
 */
type PgNode = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * ParseResult from libpg-query
 */
interface PgParseResult {
  version: number
  stmts: Array<{
    stmt: PgNode
    stmt_len?: number
    stmt_location?: number
  }>
}

/**
 * Extract the actual statement from a pg_query result
 */
function extractStatement(pgStmt: { stmt: PgNode } | PgNode): PgNode | null {
  // pg_query uses { stmt: {...} } format in stmts array
  if ('stmt' in pgStmt && pgStmt.stmt) {
    return pgStmt.stmt
  }
  // Legacy: wrapped in RawStmt container
  if ('RawStmt' in pgStmt && pgStmt.RawStmt) {
    return (pgStmt.RawStmt as { stmt: PgNode }).stmt
  }
  return pgStmt as PgNode
}

/**
 * Convert pgsql-parser AST to our normalized AST format
 */
function convertPgAST(pgParseResult: PgParseResult): AST | AST[] {
  const stmts = pgParseResult.stmts
  if (!stmts || stmts.length === 0) {
    return { type: 'unknown' }
  }

  if (stmts.length === 1) {
    const stmt = extractStatement(stmts[0])
    return convertStatement(stmt)
  }

  return stmts.map((s) => {
    const stmt = extractStatement(s)
    return convertStatement(stmt)
  })
}

/**
 * Convert a single statement
 */
function convertStatement(stmt: PgNode | null): AST {
  if (!stmt) {
    return { type: 'unknown' }
  }

  // Determine statement type from the object key
  const stmtType = Object.keys(stmt)[0]
  const stmtData = stmt[stmtType]

  switch (stmtType) {
    case 'SelectStmt':
      return convertSelectStmt(stmtData)
    case 'InsertStmt':
      return convertInsertStmt(stmtData)
    case 'UpdateStmt':
      return convertUpdateStmt(stmtData)
    case 'DeleteStmt':
      return convertDeleteStmt(stmtData)
    case 'CreateStmt':
      return convertCreateStmt(stmtData)
    case 'TransactionStmt':
      return convertTransactionStmt(stmtData)
    case 'VariableSetStmt':
      return { type: 'set', ...stmtData }
    case 'ExplainStmt':
      return { type: 'explain', ...stmtData }
    default:
      return { type: stmtType.replace('Stmt', '').toLowerCase(), ...stmtData }
  }
}

/**
 * Convert SELECT statement
 */
function convertSelectStmt(stmt: PgNode): SelectStatement {
  // Target list (columns) - required field
  const columns: SelectStatement['columns'] = stmt.targetList
    ? stmt.targetList.map(convertResTarget)
    : '*'

  const result: SelectStatement = {
    type: 'select',
    columns,
  }

  // Distinct
  if (stmt.distinctClause) {
    result.distinct = true
  }

  // FROM clause
  if (stmt.fromClause) {
    result.from = stmt.fromClause.map(convertFromClause)
  }

  // WHERE clause
  if (stmt.whereClause) {
    result.where = convertExpr(stmt.whereClause) as Expression
  }

  // GROUP BY clause
  if (stmt.groupClause) {
    result.groupby = stmt.groupClause.map(convertExpr) as (ColumnRef | Expression)[]
  }

  // HAVING clause
  if (stmt.havingClause) {
    result.having = convertExpr(stmt.havingClause) as Expression
  }

  // ORDER BY clause
  if (stmt.sortClause) {
    result.orderby = stmt.sortClause.map(convertSortBy)
  }

  // LIMIT clause
  if (stmt.limitCount || stmt.limitOffset) {
    result.limit = {
      value: stmt.limitCount ? convertExpr(stmt.limitCount) as LiteralValue : { type: 'null', value: null },
      offset: stmt.limitOffset ? convertExpr(stmt.limitOffset) as LiteralValue : undefined,
    }
  }

  // WITH clause (CTEs)
  if (stmt.withClause) {
    result.with = stmt.withClause.ctes?.map(convertCTE) || []
  }

  return result
}

/**
 * Convert INSERT statement
 */
function convertInsertStmt(stmt: PgNode): InsertStatement {
  const result: InsertStatement = {
    type: 'insert',
    table: convertRangeVar(stmt.relation),
  }

  // Columns
  if (stmt.cols) {
    result.columns = stmt.cols.map((col: PgNode) => {
      const target = col.ResTarget
      return target?.name || ''
    })
  }

  // VALUES or SELECT
  if (stmt.selectStmt) {
    const selectStmt = stmt.selectStmt.SelectStmt
    if (selectStmt?.valuesLists) {
      // VALUES clause
      result.values = selectStmt.valuesLists.map((row: PgNode[]) =>
        row.map((val) => convertExpr(val) as LiteralValue)
      )
    } else {
      // SELECT subquery
      result.select = convertSelectStmt(selectStmt)
    }
  }

  // RETURNING clause
  if (stmt.returningList) {
    result.returning = stmt.returningList.map(convertResTarget) as ColumnRef[]
  }

  // ON CONFLICT clause
  if (stmt.onConflictClause) {
    const onConflict = stmt.onConflictClause
    result.on_conflict = {
      target: onConflict.infer?.indexElems?.map((e: PgNode) => e.IndexElem?.name) || undefined,
      action: onConflict.action === 0 ? 'nothing' : {
        update: onConflict.targetList?.map((t: PgNode) => ({
          column: t.ResTarget?.name || '',
          value: convertExpr(t.ResTarget?.val),
        })) || [],
      },
    }
  }

  return result
}

/**
 * Convert UPDATE statement
 */
function convertUpdateStmt(stmt: PgNode): UpdateStatement {
  const result: UpdateStatement = {
    type: 'update',
    table: convertRangeVar(stmt.relation),
    set: stmt.targetList?.map((t: PgNode) => ({
      column: t.ResTarget?.name || '',
      value: convertExpr(t.ResTarget?.val),
    })) || [],
  }

  // WHERE clause
  if (stmt.whereClause) {
    result.where = convertExpr(stmt.whereClause) as Expression
  }

  // RETURNING clause
  if (stmt.returningList) {
    result.returning = stmt.returningList.map(convertResTarget) as ColumnRef[]
  }

  return result
}

/**
 * Convert DELETE statement
 */
function convertDeleteStmt(stmt: PgNode): DeleteStatement {
  const result: DeleteStatement = {
    type: 'delete',
    from: convertRangeVar(stmt.relation),
  }

  // WHERE clause
  if (stmt.whereClause) {
    result.where = convertExpr(stmt.whereClause) as Expression
  }

  // RETURNING clause
  if (stmt.returningList) {
    result.returning = stmt.returningList.map(convertResTarget) as ColumnRef[]
  }

  return result
}

/**
 * Convert CREATE TABLE statement
 */
function convertCreateStmt(stmt: PgNode): CreateTableStatement {
  return {
    type: 'create_table',
    table: convertRangeVar(stmt.relation),
    if_not_exists: stmt.if_not_exists || undefined,
    columns: stmt.tableElts
      ?.filter((e: PgNode) => e.ColumnDef)
      .map((e: PgNode) => {
        const col = e.ColumnDef
        return {
          name: col.colname,
          dataType: convertTypeName(col.typeName),
          nullable: !col.constraints?.some(
            (c: PgNode) => c.Constraint?.contype === 1 // NOT NULL
          ),
          default: col.constraints?.find(
            (c: PgNode) => c.Constraint?.contype === 2 // DEFAULT
          )?.Constraint?.raw_expr
            ? convertExpr(col.constraints.find((c: PgNode) => c.Constraint?.contype === 2).Constraint.raw_expr)
            : undefined,
          primary_key: col.constraints?.some(
            (c: PgNode) => c.Constraint?.contype === 5 // PRIMARY KEY
          ) || undefined,
          unique: col.constraints?.some(
            (c: PgNode) => c.Constraint?.contype === 4 // UNIQUE
          ) || undefined,
        }
      }) || [],
    constraints: stmt.tableElts
      ?.filter((e: PgNode) => e.Constraint)
      .map((e: PgNode) => {
        const con = e.Constraint
        return {
          type: mapConstraintType(con.contype),
          name: con.conname || undefined,
          columns: con.keys?.map((k: PgNode) => k.String?.str) || undefined,
        }
      }) || undefined,
  }
}

/**
 * Convert transaction statement
 */
function convertTransactionStmt(stmt: PgNode): AST {
  const kindMap: Record<number, string> = {
    0: 'begin',
    1: 'commit',
    2: 'rollback',
    3: 'savepoint',
    4: 'release',
    5: 'rollback_to',
  }
  return { type: kindMap[stmt.kind] || 'transaction', ...stmt }
}

/**
 * Convert ResTarget (column in select list)
 */
function convertResTarget(target: PgNode): ColumnRef | Expression | { expr: Expression; as?: string } {
  const resTarget = target.ResTarget
  if (!resTarget) {
    return { type: 'column_ref', column: '' }
  }

  const expr = convertExpr(resTarget.val)

  if (resTarget.name) {
    return {
      expr: expr as Expression,
      as: resTarget.name,
    }
  }

  if ((expr as ColumnRef).type === 'column_ref') {
    return expr as ColumnRef
  }

  return {
    expr: expr as Expression,
  }
}

/**
 * Convert FROM clause item
 */
function convertFromClause(item: PgNode): TableRef {
  if (item.RangeVar) {
    return convertRangeVar(item)
  }
  if (item.JoinExpr) {
    // For joins, return the left table for now
    // Full join support would require extending TableRef
    return convertFromClause(item.JoinExpr.larg)
  }
  if (item.RangeSubselect) {
    return {
      type: 'table_ref',
      table: '(subquery)',
      as: item.RangeSubselect.alias?.aliasname,
    }
  }
  return { type: 'table_ref', table: '' }
}

/**
 * Convert RangeVar (table reference)
 */
function convertRangeVar(rangeVar: PgNode): TableRef {
  const rv = rangeVar?.RangeVar || rangeVar
  if (!rv) {
    return { type: 'table_ref', table: '' }
  }

  return {
    type: 'table_ref',
    db: rv.catalogname || undefined,
    schema: rv.schemaname || undefined,
    table: rv.relname || '',
    as: rv.alias?.aliasname || undefined,
  }
}

/**
 * Convert expression
 */
function convertExpr(expr: PgNode): Expression | ColumnRef | LiteralValue {
  if (!expr) {
    return { type: 'null', value: null }
  }

  const exprType = Object.keys(expr)[0]
  const exprData = expr[exprType]

  switch (exprType) {
    case 'ColumnRef':
      return convertColumnRef(exprData)

    case 'A_Const':
      return convertAConst(exprData)

    case 'A_Expr':
      return convertAExpr(exprData)

    case 'BoolExpr':
      return convertBoolExpr(exprData)

    case 'NullTest':
      return {
        type: 'unary_expr',
        operator: exprData.nulltesttype === 0 ? 'IS NULL' : 'IS NOT NULL',
        args: [convertExpr(exprData.arg)],
      }

    case 'FuncCall':
      return {
        type: 'function',
        operator: exprData.funcname?.map((n: PgNode) => n.String?.str).join('.') || 'unknown',
        args: exprData.args?.map(convertExpr) || [],
      }

    case 'TypeCast':
      return {
        type: 'cast',
        args: [convertExpr(exprData.arg)],
        operator: convertTypeName(exprData.typeName),
      }

    case 'SubLink':
      return {
        type: 'subquery',
        operator: mapSubLinkType(exprData.subLinkType),
        args: exprData.subselect ? [convertStatement(exprData.subselect)] : [],
      }

    case 'CaseExpr':
      return {
        type: 'case',
        args: [
          ...(exprData.args?.map(convertExpr) || []),
          exprData.defresult ? convertExpr(exprData.defresult) : undefined,
        ].filter(Boolean),
      }

    case 'ParamRef':
      return { type: 'param', value: exprData.number || 0 }

    case 'A_Star':
      return { type: 'column_ref', column: '*' }

    case 'A_ArrayExpr':
      return {
        type: 'array',
        args: exprData.elements?.map(convertExpr) || [],
      }

    case 'CoalesceExpr':
      return {
        type: 'function',
        operator: 'COALESCE',
        args: exprData.args?.map(convertExpr) || [],
      }

    default:
      return { type: exprType.toLowerCase(), ...exprData }
  }
}

/**
 * Convert ColumnRef
 */
function convertColumnRef(colRef: PgNode): ColumnRef {
  const fields = colRef.fields || []
  const parts = fields.map((f: PgNode) => f.String?.str || (f.A_Star ? '*' : ''))

  if (parts.length === 1) {
    return {
      type: 'column_ref',
      column: parts[0],
    }
  }

  if (parts.length === 2) {
    return {
      type: 'column_ref',
      table: parts[0],
      column: parts[1],
    }
  }

  // schema.table.column
  return {
    type: 'column_ref',
    table: parts.slice(0, -1).join('.'),
    column: parts[parts.length - 1],
  }
}

/**
 * Convert A_Const (literal value)
 */
function convertAConst(aConst: PgNode): LiteralValue {
  if (aConst.ival !== undefined) {
    return { type: 'number', value: aConst.ival.ival ?? aConst.ival }
  }
  if (aConst.fval !== undefined) {
    return { type: 'number', value: parseFloat(aConst.fval.fval ?? aConst.fval) }
  }
  if (aConst.sval !== undefined) {
    return { type: 'string', value: aConst.sval.sval ?? aConst.sval }
  }
  if (aConst.boolval !== undefined) {
    return { type: 'bool', value: aConst.boolval.boolval ?? aConst.boolval }
  }
  if (aConst.isnull) {
    return { type: 'null', value: null }
  }
  // Handle newer pgsql-parser versions
  if (aConst.Integer) {
    return { type: 'number', value: aConst.Integer.ival }
  }
  if (aConst.Float) {
    return { type: 'number', value: parseFloat(aConst.Float.fval) }
  }
  if (aConst.String) {
    return { type: 'string', value: aConst.String.sval }
  }
  return { type: 'null', value: null }
}

/**
 * Convert A_Expr (binary/unary expression)
 */
function convertAExpr(aExpr: PgNode): Expression {
  const operator = aExpr.name?.map((n: PgNode) => n.String?.str).join('') || '='

  // Handle IN, LIKE, BETWEEN, etc.
  switch (aExpr.kind) {
    case 0: // AEXPR_OP
      return {
        type: 'binary_expr',
        operator,
        left: convertExpr(aExpr.lexpr),
        right: convertExpr(aExpr.rexpr),
      }
    case 6: // AEXPR_IN
      return {
        type: 'binary_expr',
        operator: operator === '=' ? 'IN' : 'NOT IN',
        left: convertExpr(aExpr.lexpr),
        right: convertExpr(aExpr.rexpr),
      }
    case 7: // AEXPR_LIKE
      return {
        type: 'binary_expr',
        operator: 'LIKE',
        left: convertExpr(aExpr.lexpr),
        right: convertExpr(aExpr.rexpr),
      }
    case 8: // AEXPR_ILIKE
      return {
        type: 'binary_expr',
        operator: 'ILIKE',
        left: convertExpr(aExpr.lexpr),
        right: convertExpr(aExpr.rexpr),
      }
    case 10: // AEXPR_BETWEEN
      return {
        type: 'binary_expr',
        operator: 'BETWEEN',
        left: convertExpr(aExpr.lexpr),
        right: convertExpr(aExpr.rexpr),
      }
    default:
      return {
        type: 'binary_expr',
        operator,
        left: aExpr.lexpr ? convertExpr(aExpr.lexpr) : undefined,
        right: aExpr.rexpr ? convertExpr(aExpr.rexpr) : undefined,
      }
  }
}

/**
 * Convert BoolExpr
 */
function convertBoolExpr(boolExpr: PgNode): Expression {
  const opMap: Record<number, string> = {
    0: 'AND',
    1: 'OR',
    2: 'NOT',
  }

  if (boolExpr.boolop === 2) {
    // NOT
    return {
      type: 'unary_expr',
      operator: 'NOT',
      args: boolExpr.args?.map(convertExpr) || [],
    }
  }

  // AND/OR - chain binary expressions
  const args = boolExpr.args?.map(convertExpr) || []
  if (args.length === 0) {
    return { type: 'null', value: null } as unknown as Expression
  }

  return args.reduce((left: Expression | ColumnRef | LiteralValue, right: Expression | ColumnRef | LiteralValue) => ({
    type: 'binary_expr' as const,
    operator: opMap[boolExpr.boolop] || 'AND',
    left,
    right,
  })) as Expression
}

/**
 * Convert SortBy (ORDER BY item)
 */
function convertSortBy(sortBy: PgNode): OrderByClause {
  const sb = sortBy.SortBy
  return {
    expr: convertExpr(sb.node) as ColumnRef | Expression,
    type: sb.sortby_dir === 2 ? 'DESC' : 'ASC',
    nulls: sb.sortby_nulls === 1 ? 'FIRST' : sb.sortby_nulls === 2 ? 'LAST' : undefined,
  }
}

/**
 * Convert CTE
 */
function convertCTE(cte: PgNode): NonNullable<SelectStatement['with']>[number] {
  const c = cte.CommonTableExpr
  return {
    name: c.ctename,
    columns: c.aliascolnames?.map((n: PgNode) => n.String?.str) || undefined,
    query: convertSelectStmt(c.ctequery?.SelectStmt || c.ctequery),
    recursive: c.cterecursive || undefined,
  }
}

/**
 * Convert type name
 */
function convertTypeName(typeName: PgNode): string {
  if (!typeName?.TypeName) {
    return 'TEXT'
  }

  const tn = typeName.TypeName
  const names = tn.names?.map((n: PgNode) => n.String?.str).filter(Boolean) || []

  // Handle common pg_catalog types
  const typeStr = names.join('.')
    .replace('pg_catalog.', '')
    .toUpperCase()

  // Add type modifiers if present
  if (tn.typmods) {
    const mods = tn.typmods.map((m: PgNode) => {
      const val = convertExpr(m)
      return (val as LiteralValue).value
    })
    return `${typeStr}(${mods.join(', ')})`
  }

  // Handle arrays
  if (tn.arrayBounds && tn.arrayBounds.length > 0) {
    return `${typeStr}[]`
  }

  return typeStr
}

/**
 * Map constraint type number to string
 */
function mapConstraintType(contype: number): 'primary_key' | 'unique' | 'foreign_key' | 'check' {
  const map: Record<number, 'primary_key' | 'unique' | 'foreign_key' | 'check'> = {
    1: 'check', // CONSTR_NULL (not null is check-ish)
    4: 'unique',
    5: 'primary_key',
    6: 'foreign_key',
    8: 'check',
  }
  return map[contype] || 'check'
}

/**
 * Map sublink type
 */
function mapSubLinkType(subLinkType: number): string {
  const map: Record<number, string> = {
    0: 'EXISTS',
    1: 'ALL',
    2: 'ANY',
    4: 'EXPR',
    5: 'ARRAY',
  }
  return map[subLinkType] || 'SUBQUERY'
}

// ============================================================================
// PGSQL PARSER ADAPTER
// ============================================================================

/**
 * PostgreSQL WASM Parser adapter implementing the unified SQLParser interface.
 *
 * This adapter wraps pgsql-parser (libpg_query compiled to WASM) to provide:
 * - Exact PostgreSQL syntax parsing
 * - High performance (5-13x faster than node-sql-parser)
 * - AST normalization to our unified format
 * - SQL regeneration using deparse
 *
 * Note: This adapter ONLY supports PostgreSQL. For multi-dialect support,
 * use the NodeSQLParserAdapter instead.
 *
 * @example
 * ```typescript
 * const parser = new PgsqlParserAdapter()
 *
 * // Parse PostgreSQL SQL
 * const result = parser.parse('SELECT * FROM users WHERE active = true')
 *
 * // Convert back to SQL
 * const sql = parser.stringify(result.ast)
 *
 * // Validate SQL
 * const validation = parser.validate('SELEC * FROM users')
 * ```
 */
export class PgsqlParserAdapter implements SQLParser {
  /**
   * Adapter name
   */
  get adapterName(): string {
    return 'pgsql-parser'
  }

  /**
   * Supported dialects (PostgreSQL only)
   */
  get supportedDialects(): Dialect[] {
    return SUPPORTED_DIALECTS
  }

  /**
   * Parse SQL string to AST
   */
  parse(sql: string, options: ParseOptions = {}): ParseResult {
    const dialect = options.dialect || 'postgresql'

    // pgsql-parser only supports PostgreSQL
    if (dialect !== 'postgresql') {
      throw new SQLParseError(
        `pgsql-parser only supports PostgreSQL dialect, got: ${dialect}`,
        { sql, dialect }
      )
    }

    const startTime = performance.now()

    try {
      const pgParseResult = pgParse(sql) as PgParseResult
      const endTime = performance.now()
      const parseTimeUs = Math.round((endTime - startTime) * 1000)

      const ast = convertPgAST(pgParseResult)

      return {
        ast,
        sql,
        dialect: 'postgresql',
        parseTimeUs,
      }
    } catch (error) {
      if (options.throwOnError === false) {
        return {
          ast: { type: 'unknown' },
          sql,
          dialect: 'postgresql',
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      // pgsql-parser includes location info in the error
      const locationMatch = errorMessage.match(/at position (\d+)/i)
      let location: { line: number; column: number; offset?: number } | undefined

      if (locationMatch) {
        const offset = parseInt(locationMatch[1], 10)
        const beforeError = sql.substring(0, offset)
        const lines = beforeError.split('\n')
        location = {
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
          offset,
        }
      }

      throw new SQLParseError(errorMessage, {
        sql,
        dialect: 'postgresql',
        location,
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * Convert AST back to SQL string using deparse
   */
  stringify(ast: AST | AST[], options: StringifyOptions = {}): string {
    const dialect = options.dialect || 'postgresql'

    if (dialect !== 'postgresql') {
      throw new SQLStringifyError(
        `pgsql-parser only supports PostgreSQL dialect, got: ${dialect}`
      )
    }

    try {
      // pgsql-parser's deparse expects the original pg_query AST format
      // If we have our normalized AST, we need to parse the original SQL
      // and deparse that. This is a limitation of the current approach.
      //
      // For production use, consider caching the original pg_query AST
      // alongside the normalized AST.

      // If this is array, deparse each statement
      if (Array.isArray(ast)) {
        return ast.map((a) => this.stringifySingle(a)).join(';\n')
      }

      return this.stringifySingle(ast)
    } catch (error) {
      throw new SQLStringifyError(
        `Failed to stringify AST: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined }
      )
    }
  }

  /**
   * Stringify a single AST node
   */
  private stringifySingle(ast: AST): string {
    // pgsql-parser's deparse works with the original pg_query format
    // We'll convert our normalized AST back to a rough approximation
    // For best results, store the original pg_query AST

    // Wrap in the expected format for deparse (ParseResult format)
    const pgAst = this.convertToStoredPgAST(ast)

    try {
      // pgDeparse expects ParseResult: { version: number, stmts: RawStmt[] }
      // where RawStmt is { stmt: {...}, stmt_len?: number }
      const parseResult = {
        version: 170004, // PostgreSQL 17 version
        stmts: pgAst.map((rawStmt: PgNode) => ({
          stmt: rawStmt.RawStmt?.stmt || rawStmt,
          stmt_len: 0,
        })),
      }
      return pgDeparse(parseResult as unknown as Parameters<typeof pgDeparse>[0])
    } catch {
      // Fallback: reconstruct SQL manually for common cases
      return this.manualStringify(ast)
    }
  }

  /**
   * Convert our normalized AST back to pg_query format
   * This is a best-effort conversion for common cases
   */
  private convertToStoredPgAST(ast: AST): PgNode[] {
    // Wrap in RawStmt as expected by deparse
    const stmt = this.convertStatementToPg(ast)
    return [{ RawStmt: { stmt } }]
  }

  /**
   * Convert a single statement to pg_query format
   */
  private convertStatementToPg(ast: AST): PgNode {
    switch ((ast as { type: string }).type) {
      case 'select':
        return this.convertSelectToPg(ast as SelectStatement)
      case 'insert':
        return this.convertInsertToPg(ast as InsertStatement)
      case 'update':
        return this.convertUpdateToPg(ast as UpdateStatement)
      case 'delete':
        return this.convertDeleteToPg(ast as DeleteStatement)
      default:
        return ast as unknown as PgNode
    }
  }

  /**
   * Convert SELECT to pg format
   */
  private convertSelectToPg(select: SelectStatement): PgNode {
    const stmt: PgNode = { SelectStmt: {} }
    const ss = stmt.SelectStmt

    // Target list
    if (select.columns && select.columns !== '*') {
      ss.targetList = (select.columns as (ColumnRef | Expression | { expr: Expression; as?: string })[]).map(
        (col) => this.convertColumnToPgResTarget(col)
      )
    }

    // FROM
    if (select.from) {
      ss.fromClause = select.from.map((t) => ({
        RangeVar: {
          relname: t.table,
          schemaname: t.schema,
          alias: t.as ? { aliasname: t.as } : undefined,
        },
      }))
    }

    // WHERE
    if (select.where) {
      ss.whereClause = this.convertExprToPg(select.where)
    }

    // ORDER BY
    if (select.orderby) {
      ss.sortClause = select.orderby.map((o) => ({
        SortBy: {
          node: this.convertExprToPg(o.expr),
          sortby_dir: o.type === 'DESC' ? 2 : 1,
        },
      }))
    }

    // LIMIT
    if (select.limit) {
      if (typeof select.limit.value === 'number') {
        ss.limitCount = { A_Const: { ival: { ival: select.limit.value } } }
      }
      if (select.limit.offset && typeof select.limit.offset === 'number') {
        ss.limitOffset = { A_Const: { ival: { ival: select.limit.offset } } }
      }
    }

    return stmt
  }

  /**
   * Convert INSERT to pg format
   */
  private convertInsertToPg(insert: InsertStatement): PgNode {
    return {
      InsertStmt: {
        relation: {
          RangeVar: {
            relname: insert.table.table,
            schemaname: insert.table.schema,
          },
        },
        cols: insert.columns?.map((c) => ({ ResTarget: { name: c } })),
        selectStmt: insert.values
          ? {
              SelectStmt: {
                valuesLists: insert.values.map((row) =>
                  row.map((v) => this.convertLiteralToPg(v))
                ),
              },
            }
          : undefined,
      },
    }
  }

  /**
   * Convert UPDATE to pg format
   */
  private convertUpdateToPg(update: UpdateStatement): PgNode {
    return {
      UpdateStmt: {
        relation: {
          RangeVar: {
            relname: update.table.table,
            schemaname: update.table.schema,
          },
        },
        targetList: update.set.map((s) => ({
          ResTarget: {
            name: s.column,
            val: this.convertExprToPg(s.value),
          },
        })),
        whereClause: update.where ? this.convertExprToPg(update.where) : undefined,
      },
    }
  }

  /**
   * Convert DELETE to pg format
   */
  private convertDeleteToPg(del: DeleteStatement): PgNode {
    return {
      DeleteStmt: {
        relation: {
          RangeVar: {
            relname: del.from.table,
            schemaname: del.from.schema,
          },
        },
        whereClause: del.where ? this.convertExprToPg(del.where) : undefined,
      },
    }
  }

  /**
   * Convert column to ResTarget
   */
  private convertColumnToPgResTarget(col: ColumnRef | Expression | { expr: Expression; as?: string }): PgNode {
    if ('expr' in col && col.expr) {
      return {
        ResTarget: {
          val: this.convertExprToPg(col.expr),
          name: col.as,
        },
      }
    }

    const c = col as ColumnRef
    return {
      ResTarget: {
        val: {
          ColumnRef: {
            fields: c.table
              ? [{ String: { str: c.table } }, { String: { str: c.column } }]
              : [{ String: { str: c.column } }],
          },
        },
        name: c.as,
      },
    }
  }

  /**
   * Convert expression to pg format
   */
  private convertExprToPg(expr: Expression | ColumnRef | LiteralValue): PgNode {
    const type = (expr as { type: string }).type

    switch (type) {
      case 'column_ref': {
        const col = expr as ColumnRef
        return {
          ColumnRef: {
            fields: col.table
              ? [{ String: { str: col.table } }, { String: { str: col.column } }]
              : col.column === '*'
                ? [{ A_Star: {} }]
                : [{ String: { str: col.column } }],
          },
        }
      }

      case 'number':
      case 'string':
      case 'bool':
      case 'null':
        return this.convertLiteralToPg(expr as LiteralValue)

      case 'binary_expr': {
        const binExpr = expr as Expression
        return {
          A_Expr: {
            kind: 0, // AEXPR_OP
            name: [{ String: { str: binExpr.operator || '=' } }],
            lexpr: binExpr.left ? this.convertExprToPg(binExpr.left) : undefined,
            rexpr: binExpr.right ? this.convertExprToPg(binExpr.right) : undefined,
          },
        }
      }

      default:
        return expr as unknown as PgNode
    }
  }

  /**
   * Convert literal to pg format
   */
  private convertLiteralToPg(lit: LiteralValue): PgNode {
    switch (lit.type) {
      case 'number':
        return Number.isInteger(lit.value)
          ? { A_Const: { ival: { ival: lit.value } } }
          : { A_Const: { fval: { fval: String(lit.value) } } }
      case 'string':
        return { A_Const: { sval: { sval: lit.value } } }
      case 'bool':
        return { A_Const: { boolval: { boolval: lit.value } } }
      case 'null':
        return { A_Const: { isnull: true } }
      default:
        return { A_Const: { sval: { sval: String(lit.value) } } }
    }
  }

  /**
   * Manual SQL reconstruction fallback
   */
  private manualStringify(ast: AST): string {
    const type = (ast as { type: string }).type

    switch (type) {
      case 'select':
        return this.stringifySelect(ast as SelectStatement)
      case 'insert':
        return this.stringifyInsert(ast as InsertStatement)
      case 'update':
        return this.stringifyUpdate(ast as UpdateStatement)
      case 'delete':
        return this.stringifyDelete(ast as DeleteStatement)
      default:
        throw new SQLStringifyError(`Cannot stringify statement type: ${type}`)
    }
  }

  /**
   * Stringify SELECT manually
   */
  private stringifySelect(select: SelectStatement): string {
    const parts: string[] = ['SELECT']

    if (select.distinct) {
      parts.push('DISTINCT')
    }

    // Columns
    if (select.columns === '*') {
      parts.push('*')
    } else if (Array.isArray(select.columns)) {
      parts.push(
        select.columns
          .map((col) => {
            if ('expr' in col && col.expr) {
              const expr = this.stringifyExpr(col.expr)
              return col.as ? `${expr} AS ${col.as}` : expr
            }
            const c = col as ColumnRef
            const ref = c.table ? `${c.table}.${c.column}` : c.column
            return c.as ? `${ref} AS ${c.as}` : ref
          })
          .join(', ')
      )
    }

    // FROM
    if (select.from && select.from.length > 0) {
      parts.push('FROM')
      parts.push(
        select.from
          .map((t) => {
            const name = t.schema ? `${t.schema}.${t.table}` : t.table
            return t.as ? `${name} AS ${t.as}` : name
          })
          .join(', ')
      )
    }

    // WHERE
    if (select.where) {
      parts.push('WHERE')
      parts.push(this.stringifyExpr(select.where))
    }

    // ORDER BY
    if (select.orderby && select.orderby.length > 0) {
      parts.push('ORDER BY')
      parts.push(
        select.orderby
          .map((o) => `${this.stringifyExpr(o.expr)} ${o.type}`)
          .join(', ')
      )
    }

    // LIMIT
    if (select.limit) {
      if (typeof select.limit.value === 'number') {
        parts.push(`LIMIT ${select.limit.value}`)
      }
      if (select.limit.offset && typeof select.limit.offset === 'number') {
        parts.push(`OFFSET ${select.limit.offset}`)
      }
    }

    return parts.join(' ')
  }

  /**
   * Stringify INSERT manually
   */
  private stringifyInsert(insert: InsertStatement): string {
    const table = insert.table.schema
      ? `${insert.table.schema}.${insert.table.table}`
      : insert.table.table

    const parts: string[] = [`INSERT INTO ${table}`]

    if (insert.columns) {
      parts.push(`(${insert.columns.join(', ')})`)
    }

    if (insert.values) {
      const valueStrings = insert.values.map(
        (row) => `(${row.map((v) => this.stringifyLiteral(v)).join(', ')})`
      )
      parts.push(`VALUES ${valueStrings.join(', ')}`)
    }

    return parts.join(' ')
  }

  /**
   * Stringify UPDATE manually
   */
  private stringifyUpdate(update: UpdateStatement): string {
    const table = update.table.schema
      ? `${update.table.schema}.${update.table.table}`
      : update.table.table

    const sets = update.set
      .map((s) => `${s.column} = ${this.stringifyExpr(s.value)}`)
      .join(', ')

    let sql = `UPDATE ${table} SET ${sets}`

    if (update.where) {
      sql += ` WHERE ${this.stringifyExpr(update.where)}`
    }

    return sql
  }

  /**
   * Stringify DELETE manually
   */
  private stringifyDelete(del: DeleteStatement): string {
    const table = del.from.schema
      ? `${del.from.schema}.${del.from.table}`
      : del.from.table

    let sql = `DELETE FROM ${table}`

    if (del.where) {
      sql += ` WHERE ${this.stringifyExpr(del.where)}`
    }

    return sql
  }

  /**
   * Stringify expression
   */
  private stringifyExpr(expr: Expression | ColumnRef | LiteralValue): string {
    const type = (expr as { type: string }).type

    switch (type) {
      case 'column_ref': {
        const col = expr as ColumnRef
        return col.table ? `${col.table}.${col.column}` : col.column
      }

      case 'number':
      case 'string':
      case 'bool':
      case 'null':
        return this.stringifyLiteral(expr as LiteralValue)

      case 'binary_expr': {
        const bin = expr as Expression
        const left = bin.left ? this.stringifyExpr(bin.left) : ''
        const right = bin.right ? this.stringifyExpr(bin.right) : ''
        return `${left} ${bin.operator || '='} ${right}`
      }

      case 'unary_expr': {
        const unary = expr as Expression
        const arg = unary.args?.[0] ? this.stringifyExpr(unary.args[0]) : ''
        return `${arg} ${unary.operator || ''}`
      }

      case 'function': {
        const func = expr as Expression
        const args = func.args?.map((a) => this.stringifyExpr(a)).join(', ') || ''
        return `${func.operator}(${args})`
      }

      default:
        return String(expr)
    }
  }

  /**
   * Stringify literal value
   */
  private stringifyLiteral(lit: LiteralValue): string {
    switch (lit.type) {
      case 'number':
        return String(lit.value)
      case 'string':
        return `'${String(lit.value).replace(/'/g, "''")}'`
      case 'bool':
        return lit.value ? 'TRUE' : 'FALSE'
      case 'null':
        return 'NULL'
      case 'param':
        return `$${lit.value}`
      default:
        return String(lit.value)
    }
  }

  /**
   * Validate SQL syntax
   */
  validate(sql: string, dialect: Dialect = 'postgresql'): ValidationResult {
    const issues: ValidationIssue[] = []

    // pgsql-parser only supports PostgreSQL
    if (dialect !== 'postgresql') {
      issues.push({
        severity: 'warning',
        message: `pgsql-parser only supports PostgreSQL, validating as PostgreSQL instead of ${dialect}`,
        code: 'DIALECT_OVERRIDE',
      })
    }

    try {
      this.parse(sql, { dialect: 'postgresql', throwOnError: true })
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
      valid: !issues.some((i) => i.severity === 'error'),
      issues,
      sql,
      dialect: 'postgresql',
    }
  }
}

/**
 * Create a new PgsqlParserAdapter instance
 */
export function createPgsqlParserAdapter(): PgsqlParserAdapter {
  return new PgsqlParserAdapter()
}

export default PgsqlParserAdapter
