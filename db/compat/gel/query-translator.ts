/**
 * Query Translator - EdgeQL AST to SQLite SQL
 *
 * This is a stub file that allows tests to run and fail properly.
 * The actual implementation will be done in the GREEN phase.
 *
 * @see TDD RED Phase - Write comprehensive failing tests first
 */

import type {
  Statement,
  SelectStatement,
  InsertStatement,
  Expression,
  Shape,
  ShapeField,
  PathExpression,
  BinaryExpression,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  FilterExpression,
  InsertData,
  Assignment,
} from './edgeql-parser'

import type { Schema, TypeDefinition } from './sdl-parser'

// =============================================================================
// EXPORTED TYPES
// =============================================================================

/**
 * Result of translating an EdgeQL query to SQL
 */
export interface TranslatedQuery {
  /** The generated SQL string */
  sql: string
  /** Parameter values in order for prepared statement binding */
  params: unknown[]
  /** Original parameter names from EdgeQL (for debugging/mapping) */
  paramNames?: string[]
  /** Column mapping info (for result hydration) */
  columnMap?: ColumnMapping[]
}

/**
 * Mapping between SQL columns and EdgeQL shape fields
 */
export interface ColumnMapping {
  /** SQL column name or alias */
  sqlColumn: string
  /** Original EdgeQL path */
  edgePath: string[]
  /** Type of the column */
  type?: string
  /** Whether this is a computed field */
  computed?: boolean
}

/**
 * Options for query translation
 */
export interface TranslateOptions {
  /** Schema information for type-aware translation */
  schema?: Schema
  /** Whether to generate parameterized queries (default: true) */
  parameterized?: boolean
  /** Prefix for table names */
  tablePrefix?: string
  /** Whether to quote identifiers (default: true) */
  quoteIdentifiers?: boolean
}

/**
 * Extended AST types for features beyond the prototype parser
 */
export interface UpdateStatement {
  type: 'UpdateStatement'
  target: string
  filter?: FilterExpression
  set: SetClause
}

export interface DeleteStatement {
  type: 'DeleteStatement'
  target: string
  filter?: FilterExpression
}

export interface ForStatement {
  type: 'ForStatement'
  variable: string
  iterator: Expression
  body: ASTNode
}

export interface WithBlock {
  type: 'WithBlock'
  bindings: WithBinding[]
  body: ASTNode
}

export interface WithBinding {
  type: 'WithBinding'
  name: string
  value: Expression
}

export interface SetClause {
  type: 'SetClause'
  assignments: Assignment[]
}

export interface OrderByClause {
  type: 'OrderByClause'
  expressions: OrderByExpression[]
}

export interface OrderByExpression {
  type: 'OrderByExpression'
  expression: Expression
  direction: 'asc' | 'desc' | null
  nullsPosition: 'first' | 'last' | null
}

export interface LimitClause {
  type: 'LimitClause'
  count: Expression
}

export interface OffsetClause {
  type: 'OffsetClause'
  count: Expression
}

export interface ParameterExpression {
  type: 'ParameterExpression'
  name: string
  paramType?: string
  optional?: boolean
}

export interface CastExpression {
  type: 'CastExpression'
  typeRef: string
  value: Expression
}

export interface ConcatExpression {
  type: 'ConcatExpression'
  left: Expression
  right: Expression
}

export interface CoalesceExpression {
  type: 'CoalesceExpression'
  left: Expression
  right: Expression
}

export interface UnaryExpression {
  type: 'UnaryExpression'
  operator: 'not' | '-' | '+' | 'exists' | 'distinct'
  operand: Expression
}

export interface InExpression {
  type: 'InExpression'
  expression: Expression
  set: Expression
  negated: boolean
}

export interface LikeExpression {
  type: 'LikeExpression'
  expression: Expression
  pattern: Expression
  caseInsensitive: boolean
  negated?: boolean
}

export interface TypeCheckExpression {
  type: 'TypeCheckExpression'
  expression: Expression
  typeName: string
  negated: boolean
}

export interface SetExpression {
  type: 'SetExpression'
  elements: Expression[]
}

export interface ArrayExpression {
  type: 'ArrayExpression'
  elements: Expression[]
}

export interface FunctionCall {
  type: 'FunctionCall'
  name: string
  args: Expression[]
}

export interface SubqueryExpression {
  type: 'SubqueryExpression'
  query: ASTNode
}

/**
 * Extended expression types
 */
export type ExtendedExpression =
  | Expression
  | ParameterExpression
  | CastExpression
  | ConcatExpression
  | CoalesceExpression
  | UnaryExpression
  | InExpression
  | LikeExpression
  | TypeCheckExpression
  | SetExpression
  | ArrayExpression
  | FunctionCall
  | SubqueryExpression

/**
 * All AST node types
 */
export type ASTNode =
  | Statement
  | UpdateStatement
  | DeleteStatement
  | ForStatement
  | WithBlock

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Translate an EdgeQL AST to SQLite SQL
 *
 * @param ast - The EdgeQL AST node to translate
 * @param options - Translation options
 * @returns Translated SQL query with parameters
 *
 * @example
 * ```typescript
 * import { translateQuery } from './query-translator'
 * import { parse } from './edgeql-parser'
 *
 * const ast = parse('select User { name } filter .age > 18')
 * const result = translateQuery(ast)
 * // result.sql = 'SELECT name FROM User WHERE age > ?'
 * // result.params = [18]
 * ```
 */
export function translateQuery(
  ast: ASTNode,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('Query translator not implemented')
}

/**
 * Translate a SELECT statement to SQL
 */
export function translateSelect(
  ast: SelectStatement,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateSelect not implemented')
}

/**
 * Translate an INSERT statement to SQL
 */
export function translateInsert(
  ast: InsertStatement,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateInsert not implemented')
}

/**
 * Translate an UPDATE statement to SQL
 */
export function translateUpdate(
  ast: UpdateStatement,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateUpdate not implemented')
}

/**
 * Translate a DELETE statement to SQL
 */
export function translateDelete(
  ast: DeleteStatement,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateDelete not implemented')
}

/**
 * Translate a FOR loop to SQL (typically as CTE or subquery)
 */
export function translateFor(
  ast: ForStatement,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateFor not implemented')
}

/**
 * Translate a WITH block to SQL CTEs
 */
export function translateWith(
  ast: WithBlock,
  options?: TranslateOptions
): TranslatedQuery {
  throw new Error('translateWith not implemented')
}

/**
 * Translate an expression to SQL
 */
export function translateExpression(
  expr: ExtendedExpression,
  options?: TranslateOptions
): { sql: string; params: unknown[] } {
  throw new Error('translateExpression not implemented')
}

// =============================================================================
// HELPER EXPORTS (for testing internal functions)
// =============================================================================

/**
 * Convert EdgeQL operator to SQL operator
 */
export function operatorToSQL(op: string): string {
  throw new Error('operatorToSQL not implemented')
}

/**
 * Quote a SQL identifier
 */
export function quoteIdentifier(name: string): string {
  throw new Error('quoteIdentifier not implemented')
}

/**
 * Get the SQL table name for an EdgeQL type
 */
export function getTableName(
  typeName: string,
  schema?: Schema,
  options?: TranslateOptions
): string {
  throw new Error('getTableName not implemented')
}

/**
 * Get the SQL column name for an EdgeQL property
 */
export function getColumnName(
  propertyName: string,
  typeDef?: TypeDefinition
): string {
  throw new Error('getColumnName not implemented')
}

/**
 * Translate a path expression to SQL column reference
 */
export function pathToSQL(
  path: string[],
  context?: { table?: string; schema?: Schema }
): string {
  throw new Error('pathToSQL not implemented')
}
