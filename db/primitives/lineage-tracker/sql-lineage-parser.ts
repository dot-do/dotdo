/**
 * SQL Query Lineage Parser
 *
 * Parses SQL queries to extract lineage information including source tables,
 * target tables, and column mappings. Supports SELECT, INSERT, CREATE TABLE AS SELECT,
 * UPDATE, and MERGE statements.
 *
 * @see dotdo-wztr9
 * @module db/primitives/lineage-tracker/sql-lineage-parser
 */

import {
  Tokenizer,
  TokenType,
  type Token,
  ParseError,
} from '../query-engine/parsers/common'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Reference to a table (optionally with schema and alias)
 */
export interface TableRef {
  /** Table name */
  name: string
  /** Schema or namespace (optional) */
  schema?: string
  /** Alias used in the query (optional) */
  alias?: string
}

/**
 * Reference to a column with optional table qualifier
 */
export interface ColumnRef {
  /** Column name */
  name: string
  /** Table or alias qualifier (optional) */
  table?: string
  /** Expression (for computed columns) */
  expression?: string
  /** Alias in the output (optional) */
  alias?: string
}

/**
 * Mapping from source column(s) to target column
 */
export interface ColumnMapping {
  /** Source columns that contribute to this target */
  sources: ColumnRef[]
  /** Target column */
  target: ColumnRef
  /** Type of transformation (direct, computed, aggregate, etc.) */
  transformationType: 'direct' | 'computed' | 'aggregate' | 'wildcard'
}

/**
 * SQL statement type
 */
export type SqlStatementType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE_TABLE_AS' | 'MERGE' | 'UNKNOWN'

/**
 * Complete lineage information extracted from a SQL query
 */
export interface SqlLineage {
  /** Type of SQL statement */
  statementType: SqlStatementType
  /** Source tables (data read from) */
  sources: TableRef[]
  /** Target tables (data written to) */
  targets: TableRef[]
  /** Column-level lineage mappings */
  columns: ColumnMapping[]
  /** Common Table Expressions (CTEs) defined in the query */
  ctes: CteDefinition[]
  /** Subqueries referenced in the query */
  subqueries: SqlLineage[]
}

/**
 * Common Table Expression definition
 */
export interface CteDefinition {
  /** Name of the CTE */
  name: string
  /** Lineage of the CTE subquery */
  lineage: SqlLineage
}

// =============================================================================
// SQL KEYWORDS
// =============================================================================

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'IS', 'NULL', 'LIKE', 'ILIKE', 'TRUE', 'FALSE', 'AS', 'ON',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'OUTER', 'FULL',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'LIMIT', 'OFFSET', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'MERGE', 'USING', 'MATCHED',
  'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'TRUNCATE', 'IF',
  'WITH', 'RECURSIVE', 'MATERIALIZED',
  'OVER', 'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
  'CAST', 'CONVERT', 'DATE', 'TIMESTAMP', 'INTERVAL', 'ARRAY',
  'EXISTS', 'ANY', 'SOME',
])

const AGGREGATE_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG',
  'GROUP_CONCAT', 'LISTAGG', 'STDDEV', 'VARIANCE', 'MEDIAN',
])

const WINDOW_FUNCTIONS = new Set([
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD',
  'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
])

// =============================================================================
// SQL LINEAGE PARSER
// =============================================================================

/**
 * Parser for extracting lineage information from SQL queries
 */
export class SqlLineageParser {
  private tokens: Token[] = []
  private pos = 0
  private input = ''

  /**
   * Parse a SQL query and extract lineage information
   */
  parse(sql: string): SqlLineage {
    if (!sql || sql.trim().length === 0) {
      return this.emptyLineage('UNKNOWN')
    }

    this.input = sql
    this.tokens = this.tokenize(sql)
    this.pos = 0

    return this.parseStatement()
  }

  /**
   * Tokenize SQL input using the shared Tokenizer
   */
  private tokenize(input: string): Token[] {
    const tokenizer = new Tokenizer(input, {
      keywords: SQL_KEYWORDS,
      backslashEscapes: false,
    })
    return tokenizer.tokenizeAll()
  }

  // ===========================================================================
  // MAIN PARSING
  // ===========================================================================

  private parseStatement(): SqlLineage {
    // Handle CTEs (WITH clause)
    const ctes: CteDefinition[] = []
    if (this.matchKeyword('WITH')) {
      this.matchKeyword('RECURSIVE') // optional
      do {
        const cte = this.parseCte()
        ctes.push(cte)
      } while (this.match(','))
    }

    // Determine statement type and parse accordingly
    const token = this.current()

    if (this.matchKeyword('SELECT')) {
      const lineage = this.parseSelect()
      lineage.ctes = ctes
      return lineage
    }

    if (this.matchKeyword('INSERT')) {
      const lineage = this.parseInsert()
      lineage.ctes = ctes
      return lineage
    }

    if (this.matchKeyword('UPDATE')) {
      const lineage = this.parseUpdate()
      lineage.ctes = ctes
      return lineage
    }

    if (this.matchKeyword('DELETE')) {
      const lineage = this.parseDelete()
      lineage.ctes = ctes
      return lineage
    }

    if (this.matchKeyword('MERGE')) {
      const lineage = this.parseMerge()
      lineage.ctes = ctes
      return lineage
    }

    if (this.matchKeyword('CREATE')) {
      if (this.matchKeyword('TABLE') || this.matchKeyword('VIEW') || this.matchKeyword('MATERIALIZED')) {
        const lineage = this.parseCreateTableAs()
        lineage.ctes = ctes
        return lineage
      }
    }

    return this.emptyLineage('UNKNOWN')
  }

  // ===========================================================================
  // SELECT PARSING
  // ===========================================================================

  private parseSelect(): SqlLineage {
    const lineage = this.emptyLineage('SELECT')

    // DISTINCT is optional
    this.matchKeyword('DISTINCT')
    this.matchKeyword('ALL')

    // Parse SELECT columns
    lineage.columns = this.parseSelectColumns()

    // Parse FROM clause (required for lineage)
    if (this.matchKeyword('FROM')) {
      lineage.sources = this.parseFromClause()
    }

    // Skip WHERE, GROUP BY, HAVING, ORDER BY, LIMIT for lineage purposes
    // but we need to consume tokens to avoid confusion
    this.skipToEndOfStatement()

    // Resolve column references to actual source tables
    this.resolveColumnSources(lineage)

    return lineage
  }

  private parseSelectColumns(): ColumnMapping[] {
    const columns: ColumnMapping[] = []

    // Handle SELECT *
    if (this.match('*')) {
      columns.push({
        sources: [{ name: '*' }],
        target: { name: '*' },
        transformationType: 'wildcard',
      })

      if (!this.match(',')) {
        return columns
      }
    }

    do {
      const col = this.parseSelectColumn()
      if (col) {
        columns.push(col)
      }
    } while (this.match(','))

    return columns
  }

  private parseSelectColumn(): ColumnMapping | null {
    const startPos = this.pos
    const sources: ColumnRef[] = []
    let transformationType: ColumnMapping['transformationType'] = 'direct'

    // Check for aggregate functions
    const token = this.current()
    if (token.type === 'KEYWORD' && (AGGREGATE_FUNCTIONS.has(token.value) || WINDOW_FUNCTIONS.has(token.value))) {
      transformationType = 'aggregate'
      const fnName = token.value
      this.advance()

      if (this.match('(')) {
        // Parse function arguments
        const argSources = this.parseFunctionArgs()
        sources.push(...argSources)
        this.match(')')

        // Handle OVER clause for window functions
        if (this.matchKeyword('OVER')) {
          this.skipParenthesized()
        }
      }

      // Parse alias
      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER') {
        // Implicit alias (without AS)
        const next = this.peek(1)
        if (next.type === 'COMMA' || next.type === 'KEYWORD' || next.type === 'EOF') {
          alias = this.parseIdentifier()
        }
      }

      return {
        sources,
        target: { name: alias || `${fnName}(...)`, alias },
        transformationType,
      }
    }

    // Check for CASE expression
    if (this.matchKeyword('CASE')) {
      transformationType = 'computed'
      const caseSources = this.parseCaseExpression()
      sources.push(...caseSources)

      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER' && !this.isKeywordAhead()) {
        alias = this.parseIdentifier()
      }

      return {
        sources,
        target: { name: alias || 'case_expr', alias },
        transformationType,
      }
    }

    // Check for parenthesized expression
    if (this.current().type === 'LPAREN') {
      transformationType = 'computed'
      const exprSources = this.parseParenthesizedExpression()
      sources.push(...exprSources)

      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER' && !this.isKeywordAhead()) {
        alias = this.parseIdentifier()
      }

      return {
        sources,
        target: { name: alias || 'expr', alias },
        transformationType,
      }
    }

    // Regular column reference (possibly qualified) or function call
    // Reuse token from earlier check
    const currentToken = this.current()

    // Check if this is a function call (identifier followed by parenthesis)
    if ((currentToken.type === 'IDENTIFIER' || currentToken.type === 'KEYWORD') && this.peek(1).type === TokenType.LPAREN) {
      const fnName = currentToken.value
      this.advance() // consume function name
      transformationType = 'computed'

      if (this.current().type === TokenType.LPAREN) {
        this.advance() // consume (
        const argSources = this.parseFunctionArgsInner()
        sources.push(...argSources)
        if (this.current().type === TokenType.RPAREN) {
          this.advance() // consume )
        }
      }

      // Parse alias
      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER' && !this.isKeywordAhead()) {
        alias = this.parseIdentifier()
      }

      return {
        sources,
        target: { name: alias || `${fnName}(...)`, alias },
        transformationType,
      }
    }

    const columnRef = this.parseColumnReference()
    if (!columnRef) {
      return null
    }

    // Check for operators indicating a computed expression
    const next = this.current()
    if (next.type === 'OPERATOR' && ['+', '-', '*', '/', '||'].includes(next.value)) {
      transformationType = 'computed'
      sources.push(columnRef)

      // Parse the rest of the expression
      while (this.current().type === 'OPERATOR' || this.current().type === 'IDENTIFIER' ||
             this.current().type === 'NUMBER' || this.current().type === 'STRING' ||
             this.current().type === TokenType.LPAREN) {
        if (this.current().type === 'IDENTIFIER') {
          const ref = this.parseColumnReference()
          if (ref) sources.push(ref)
        } else if (this.current().type === TokenType.LPAREN) {
          // Function call in expression
          const exprSources = this.parseParenthesizedExpression()
          sources.push(...exprSources)
        } else {
          this.advance()
        }
      }
    } else {
      sources.push(columnRef)
    }

    // Parse alias
    let alias: string | undefined
    if (this.matchKeyword('AS')) {
      alias = this.parseIdentifier()
    } else if (this.current().type === 'IDENTIFIER' && !this.isKeywordAhead()) {
      alias = this.parseIdentifier()
    }

    const targetName = alias || columnRef.name
    return {
      sources,
      target: { name: targetName, alias },
      transformationType,
    }
  }

  private parseColumnReference(): ColumnRef | null {
    const token = this.current()

    // Handle * (wildcard)
    if (token.value === '*') {
      this.advance()
      return { name: '*' }
    }

    if (token.type !== 'IDENTIFIER' && token.type !== 'STRING') {
      return null
    }

    let name = token.value
    this.advance()

    // Check for qualified name (schema.table.column or table.column)
    let table: string | undefined
    if (this.current().type === 'DOT') {
      this.advance()
      const next = this.current()

      if (next.value === '*') {
        // table.*
        this.advance()
        return { name: '*', table: name }
      }

      if (next.type === 'IDENTIFIER' || next.type === 'STRING') {
        table = name
        name = next.value
        this.advance()

        // Could be schema.table.column
        if (this.current().type === 'DOT') {
          this.advance()
          const col = this.current()
          if (col.type === 'IDENTIFIER' || col.type === 'STRING' || col.value === '*') {
            // schema.table.column - ignore schema for now
            table = name
            name = col.value
            this.advance()
          }
        }
      }
    }

    return { name, table }
  }

  private parseFunctionArgs(): ColumnRef[] {
    const sources: ColumnRef[] = []

    // Handle DISTINCT inside function (e.g., COUNT(DISTINCT col))
    this.matchKeyword('DISTINCT')

    // Handle * (e.g., COUNT(*))
    if (this.match('*')) {
      sources.push({ name: '*' })
      return sources
    }

    let depth = 0
    while (this.current().type !== 'EOF') {
      const token = this.current()

      if (token.type === 'LPAREN') {
        depth++
        this.advance()
      } else if (token.type === 'RPAREN') {
        if (depth === 0) break
        depth--
        this.advance()
      } else if (token.type === 'IDENTIFIER') {
        const ref = this.parseColumnReference()
        if (ref) sources.push(ref)
      } else if (token.type === 'COMMA' && depth === 0) {
        this.advance()
      } else {
        this.advance()
      }
    }

    return sources
  }

  /**
   * Parse function arguments (inner - already past the opening paren)
   * Handles nested functions and extracts column references
   */
  private parseFunctionArgsInner(): ColumnRef[] {
    const sources: ColumnRef[] = []

    // Handle DISTINCT inside function
    this.matchKeyword('DISTINCT')

    // Handle * (e.g., COUNT(*))
    if (this.match('*')) {
      sources.push({ name: '*' })
      return sources
    }

    let depth = 0
    while (this.current().type !== TokenType.EOF) {
      const token = this.current()

      if (token.type === TokenType.LPAREN) {
        depth++
        this.advance()
      } else if (token.type === TokenType.RPAREN) {
        if (depth === 0) break
        depth--
        this.advance()
      } else if (token.type === 'IDENTIFIER') {
        // Check if this is a nested function call
        if (this.peek(1).type === TokenType.LPAREN) {
          // Skip function name
          this.advance()
          // Parse nested function args
          if (this.current().type === TokenType.LPAREN) {
            this.advance()
            const nested = this.parseFunctionArgsInner()
            sources.push(...nested)
            if (this.current().type === TokenType.RPAREN) {
              this.advance()
            }
          }
        } else {
          const ref = this.parseColumnReference()
          if (ref) sources.push(ref)
        }
      } else if (token.type === 'COMMA' && depth === 0) {
        this.advance()
      } else {
        this.advance()
      }
    }

    return sources
  }

  private parseCaseExpression(): ColumnRef[] {
    const sources: ColumnRef[] = []
    let depth = 0

    while (this.current().type !== 'EOF') {
      const token = this.current()

      if (token.type === 'KEYWORD' && token.value === 'END') {
        this.advance()
        break
      }

      if (token.type === 'KEYWORD' && token.value === 'CASE') {
        depth++
        this.advance()
        continue
      }

      if (token.type === 'IDENTIFIER') {
        const ref = this.parseColumnReference()
        if (ref && ref.name !== '*') sources.push(ref)
      } else {
        this.advance()
      }
    }

    return sources
  }

  private parseParenthesizedExpression(): ColumnRef[] {
    const sources: ColumnRef[] = []

    if (this.current().type !== 'LPAREN') return sources
    this.advance()

    let depth = 1
    while (this.current().type !== 'EOF' && depth > 0) {
      const token = this.current()

      if (token.type === 'LPAREN') {
        depth++
        this.advance()
      } else if (token.type === 'RPAREN') {
        depth--
        this.advance()
      } else if (token.type === 'IDENTIFIER') {
        const ref = this.parseColumnReference()
        if (ref) sources.push(ref)
      } else {
        this.advance()
      }
    }

    return sources
  }

  // ===========================================================================
  // FROM CLAUSE PARSING
  // ===========================================================================

  private parseFromClause(): TableRef[] {
    const tables: TableRef[] = []

    // Parse first table
    const firstTable = this.parseTableReference()
    if (firstTable) {
      tables.push(firstTable)
    }

    // Parse JOINs and additional tables
    while (true) {
      if (this.match(',')) {
        // Comma-separated table (implicit cross join)
        const table = this.parseTableReference()
        if (table) tables.push(table)
        continue
      }

      // Check for JOIN keywords
      let joinType = ''
      if (this.matchKeyword('INNER')) joinType = 'INNER'
      else if (this.matchKeyword('LEFT')) {
        joinType = 'LEFT'
        this.matchKeyword('OUTER')
      } else if (this.matchKeyword('RIGHT')) {
        joinType = 'RIGHT'
        this.matchKeyword('OUTER')
      } else if (this.matchKeyword('FULL')) {
        joinType = 'FULL'
        this.matchKeyword('OUTER')
      } else if (this.matchKeyword('CROSS')) {
        joinType = 'CROSS'
      }

      if (this.matchKeyword('JOIN')) {
        const joinTable = this.parseTableReference()
        if (joinTable) tables.push(joinTable)

        // Skip ON clause
        if (this.matchKeyword('ON')) {
          this.skipExpression()
        }
        continue
      }

      // No more tables
      break
    }

    return tables
  }

  private parseTableReference(): TableRef | null {
    // Handle subquery
    if (this.current().type === 'LPAREN') {
      this.skipParenthesized()

      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER') {
        alias = this.parseIdentifier()
      }

      return { name: `(subquery)`, alias }
    }

    // Handle LATERAL keyword
    this.matchKeyword('LATERAL')

    const token = this.current()
    if (token.type !== 'IDENTIFIER' && token.type !== 'STRING') {
      return null
    }

    let name = token.value
    let schema: string | undefined
    this.advance()

    // Check for schema.table
    if (this.current().type === 'DOT') {
      this.advance()
      schema = name
      name = this.parseIdentifier()
    }

    // Check for alias
    let alias: string | undefined
    if (this.matchKeyword('AS')) {
      alias = this.parseIdentifier()
    } else if (this.current().type === 'IDENTIFIER' && !this.isKeywordAhead()) {
      alias = this.parseIdentifier()
    }

    return { name, schema, alias }
  }

  // ===========================================================================
  // INSERT PARSING
  // ===========================================================================

  private parseInsert(): SqlLineage {
    const lineage = this.emptyLineage('INSERT')

    // INTO keyword
    this.matchKeyword('INTO')

    // Target table
    const target = this.parseTableReference()
    if (target) {
      lineage.targets.push(target)
    }

    // Optional column list
    const targetColumns: string[] = []
    if (this.current().type === 'LPAREN') {
      this.advance()
      while (this.current().type !== 'RPAREN' && this.current().type !== 'EOF') {
        if (this.current().type === 'IDENTIFIER') {
          targetColumns.push(this.current().value)
        }
        this.advance()
        this.match(',')
      }
      this.match(')')
    }

    // VALUES or SELECT
    if (this.matchKeyword('VALUES')) {
      // VALUES clause - no source tables
      this.skipToEndOfStatement()
    } else if (this.matchKeyword('SELECT')) {
      // INSERT INTO ... SELECT
      const selectLineage = this.parseSelect()
      lineage.sources = selectLineage.sources
      lineage.subqueries.push(selectLineage)

      // Map source columns to target columns
      if (targetColumns.length > 0) {
        for (let i = 0; i < Math.min(targetColumns.length, selectLineage.columns.length); i++) {
          lineage.columns.push({
            sources: selectLineage.columns[i]?.sources || [],
            target: { name: targetColumns[i]! },
            transformationType: selectLineage.columns[i]?.transformationType || 'direct',
          })
        }
      } else {
        lineage.columns = selectLineage.columns.map(col => ({
          ...col,
          target: { ...col.target },
        }))
      }
    }

    return lineage
  }

  // ===========================================================================
  // UPDATE PARSING
  // ===========================================================================

  private parseUpdate(): SqlLineage {
    const lineage = this.emptyLineage('UPDATE')

    // Target table
    const target = this.parseTableReference()
    if (target) {
      lineage.targets.push(target)
      // Update also reads from the target table
      lineage.sources.push({ ...target })
    }

    // SET clause
    if (this.matchKeyword('SET')) {
      this.parseSetClause(lineage)
    }

    // FROM clause (PostgreSQL-style)
    if (this.matchKeyword('FROM')) {
      const fromTables = this.parseFromClause()
      lineage.sources.push(...fromTables)
    }

    // Skip WHERE clause
    this.skipToEndOfStatement()

    return lineage
  }

  private parseSetClause(lineage: SqlLineage): void {
    do {
      const columnName = this.parseIdentifier()
      if (!columnName) continue

      if (!this.match('=')) continue

      // Parse the value expression
      const sources: ColumnRef[] = []
      let transformationType: ColumnMapping['transformationType'] = 'direct'

      // Check if it's a subquery
      if (this.current().type === 'LPAREN' && this.peek(1).value === 'SELECT') {
        transformationType = 'computed'
        this.skipParenthesized()
      } else {
        // Parse expression, collecting column references
        while (this.current().type !== 'EOF' &&
               this.current().type !== 'COMMA' &&
               !(this.current().type === 'KEYWORD' && ['WHERE', 'FROM', 'RETURNING'].includes(this.current().value))) {
          if (this.current().type === 'IDENTIFIER') {
            const ref = this.parseColumnReference()
            if (ref) sources.push(ref)
          } else if (this.current().type === 'OPERATOR') {
            transformationType = 'computed'
            this.advance()
          } else {
            this.advance()
          }
        }
      }

      lineage.columns.push({
        sources,
        target: { name: columnName },
        transformationType,
      })
    } while (this.match(','))
  }

  // ===========================================================================
  // DELETE PARSING
  // ===========================================================================

  private parseDelete(): SqlLineage {
    const lineage = this.emptyLineage('DELETE')

    // FROM keyword
    this.matchKeyword('FROM')

    // Target table (also a source since we read before delete)
    const target = this.parseTableReference()
    if (target) {
      lineage.targets.push(target)
      lineage.sources.push({ ...target })
    }

    // USING clause (PostgreSQL)
    if (this.matchKeyword('USING')) {
      const usingTables = this.parseFromClause()
      lineage.sources.push(...usingTables)
    }

    this.skipToEndOfStatement()

    return lineage
  }

  // ===========================================================================
  // MERGE PARSING
  // ===========================================================================

  private parseMerge(): SqlLineage {
    const lineage = this.emptyLineage('MERGE')

    // INTO keyword
    this.matchKeyword('INTO')

    // Target table
    const target = this.parseTableReference()
    if (target) {
      lineage.targets.push(target)
      lineage.sources.push({ ...target }) // MERGE reads from target
    }

    // USING clause
    if (this.matchKeyword('USING')) {
      // Could be a table or subquery
      if (this.current().type === 'LPAREN') {
        this.skipParenthesized()
        // Get alias
        if (this.matchKeyword('AS') || this.current().type === 'IDENTIFIER') {
          const alias = this.parseIdentifier()
          lineage.sources.push({ name: '(subquery)', alias })
        }
      } else {
        const source = this.parseTableReference()
        if (source) lineage.sources.push(source)
      }
    }

    // Skip ON and WHEN clauses
    this.skipToEndOfStatement()

    return lineage
  }

  // ===========================================================================
  // CREATE TABLE AS PARSING
  // ===========================================================================

  private parseCreateTableAs(): SqlLineage {
    const lineage = this.emptyLineage('CREATE_TABLE_AS')

    // Note: CREATE and TABLE/VIEW/MATERIALIZED keywords were already consumed in parseStatement
    // Handle additional VIEW keyword after MATERIALIZED (MATERIALIZED VIEW)
    this.matchKeyword('VIEW')

    // IF NOT EXISTS - must check before parsing table name
    if (this.matchKeyword('IF')) {
      this.matchKeyword('NOT')
      this.matchKeyword('EXISTS')
    }

    // Target table name - don't use parseTableReference which could pick up keywords
    const token = this.current()
    if (token.type === TokenType.IDENTIFIER || token.type === TokenType.STRING) {
      let name = token.value
      let schema: string | undefined
      this.advance()

      // Check for schema.table
      if (this.current().type === TokenType.DOT) {
        this.advance()
        schema = name
        name = this.parseIdentifier()
      }

      lineage.targets.push({ name, schema })
    }

    // Optional column list
    if (this.current().type === TokenType.LPAREN) {
      this.skipParenthesized()
    }

    // AS SELECT
    if (this.matchKeyword('AS')) {
      if (this.matchKeyword('SELECT')) {
        const selectLineage = this.parseSelect()
        lineage.sources = selectLineage.sources
        lineage.columns = selectLineage.columns
        lineage.subqueries.push(selectLineage)
      }
    }

    return lineage
  }

  // ===========================================================================
  // CTE PARSING
  // ===========================================================================

  private parseCte(): CteDefinition {
    const name = this.parseIdentifier()

    // Optional column list
    if (this.current().type === TokenType.LPAREN) {
      this.skipParenthesized()
    }

    // AS keyword
    this.expectKeyword('AS')

    // Optional MATERIALIZED / NOT MATERIALIZED
    this.matchKeyword('MATERIALIZED')
    if (this.matchKeyword('NOT')) {
      this.matchKeyword('MATERIALIZED')
    }

    // CTE subquery must be in parentheses
    if (this.current().type !== TokenType.LPAREN) {
      return { name, lineage: this.emptyLineage('SELECT') }
    }

    this.advance() // consume (

    // Parse inner statement
    let lineage: SqlLineage
    if (this.matchKeyword('SELECT')) {
      lineage = this.parseSelect()
    } else {
      lineage = this.emptyLineage('SELECT')
      this.skipToClosingParen()
    }

    // Consume the closing parenthesis
    if (this.current().type === TokenType.RPAREN) {
      this.advance()
    }

    return { name, lineage }
  }

  // ===========================================================================
  // COLUMN RESOLUTION
  // ===========================================================================

  /**
   * Resolve column references to their source tables based on FROM clause
   */
  private resolveColumnSources(lineage: SqlLineage): void {
    // Build a map of aliases to table names
    const aliasMap = new Map<string, string>()
    for (const table of lineage.sources) {
      if (table.alias) {
        aliasMap.set(table.alias.toLowerCase(), table.name)
      }
      aliasMap.set(table.name.toLowerCase(), table.name)
    }

    // Resolve each column mapping
    for (const mapping of lineage.columns) {
      for (const source of mapping.sources) {
        if (source.table) {
          const resolved = aliasMap.get(source.table.toLowerCase())
          if (resolved) {
            source.table = resolved
          }
        } else if (lineage.sources.length === 1) {
          // If only one source table, assume column belongs to it
          source.table = lineage.sources[0]!.name
        }
      }
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private emptyLineage(type: SqlStatementType): SqlLineage {
    return {
      statementType: type,
      sources: [],
      targets: [],
      columns: [],
      ctes: [],
      subqueries: [],
    }
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '', position: this.input.length }
  }

  private peek(offset: number): Token {
    return this.tokens[this.pos + offset] || { type: TokenType.EOF, value: '', position: this.input.length }
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private match(value: string): boolean {
    if (this.current().value === value || this.current().value.toUpperCase() === value) {
      this.advance()
      return true
    }
    return false
  }

  private matchKeyword(keyword: string): boolean {
    const t = this.current()
    if (t.type === 'KEYWORD' && t.value === keyword) {
      this.advance()
      return true
    }
    return false
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new ParseError(`Expected ${keyword}`, this.current().position)
    }
  }

  private parseIdentifier(): string {
    const token = this.current()
    if (token.type === 'IDENTIFIER' || token.type === 'STRING' || token.type === 'KEYWORD') {
      this.advance()
      return token.value
    }
    return ''
  }

  private isKeywordAhead(): boolean {
    const token = this.current()
    if (token.type !== 'KEYWORD') return false
    return ['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION',
            'INTERSECT', 'EXCEPT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL',
            'CROSS', 'ON', 'SET', 'VALUES', 'RETURNING', 'INTO'].includes(token.value)
  }

  private skipExpression(): void {
    let depth = 0
    while (this.current().type !== 'EOF') {
      const token = this.current()

      if (token.type === 'LPAREN') {
        depth++
      } else if (token.type === 'RPAREN') {
        if (depth === 0) break
        depth--
      } else if (depth === 0 && token.type === 'KEYWORD') {
        if (['AND', 'OR', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
             'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING'].includes(token.value)) {
          break
        }
      } else if (depth === 0 && token.type === 'COMMA') {
        break
      }

      this.advance()
    }
  }

  private skipParenthesized(): void {
    if (this.current().type !== 'LPAREN') return
    this.advance()

    let depth = 1
    while (this.current().type !== 'EOF' && depth > 0) {
      if (this.current().type === 'LPAREN') depth++
      else if (this.current().type === 'RPAREN') depth--
      this.advance()
    }
  }

  private skipToClosingParen(): void {
    let depth = 1
    while (this.current().type !== 'EOF' && depth > 0) {
      if (this.current().type === 'LPAREN') depth++
      else if (this.current().type === 'RPAREN') depth--
      if (depth > 0) this.advance()
    }
  }

  private skipToEndOfStatement(): void {
    let depth = 0
    while (this.current().type !== TokenType.EOF) {
      const token = this.current()

      // Track parenthesis depth
      if (token.type === TokenType.LPAREN) {
        depth++
      } else if (token.type === TokenType.RPAREN) {
        // Stop at unmatched closing paren (we're inside a subquery/CTE)
        if (depth === 0) {
          break
        }
        depth--
      }

      // Stop at statement boundaries
      if (depth === 0 && token.type === TokenType.OPERATOR && token.value === ';') {
        break
      }

      this.advance()
    }
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Parse a SQL query and extract lineage information
 *
 * @param sql - SQL query string
 * @returns Lineage information including sources, targets, and column mappings
 *
 * @example
 * ```typescript
 * const lineage = parseSqlLineage(`
 *   SELECT
 *     u.id,
 *     u.name,
 *     COUNT(o.id) as order_count
 *   FROM users u
 *   LEFT JOIN orders o ON o.user_id = u.id
 *   GROUP BY u.id, u.name
 * `)
 *
 * // lineage.sources = [{ name: 'users', alias: 'u' }, { name: 'orders', alias: 'o' }]
 * // lineage.columns = [
 * //   { sources: [{ name: 'id', table: 'users' }], target: { name: 'id' }, transformationType: 'direct' },
 * //   { sources: [{ name: 'name', table: 'users' }], target: { name: 'name' }, transformationType: 'direct' },
 * //   { sources: [{ name: 'id', table: 'orders' }], target: { name: 'order_count' }, transformationType: 'aggregate' },
 * // ]
 * ```
 */
export function parseSqlLineage(sql: string): SqlLineage {
  const parser = new SqlLineageParser()
  return parser.parse(sql)
}

/**
 * Create a new SqlLineageParser instance for repeated parsing
 */
export function createSqlLineageParser(): SqlLineageParser {
  return new SqlLineageParser()
}
