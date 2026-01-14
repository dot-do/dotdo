/**
 * @dotdo/postgres - Query Builder Utilities
 *
 * Utility functions for building SQL queries safely.
 * These are optional helpers - the main Client and Pool classes
 * work directly with raw SQL strings.
 *
 * @example
 * ```typescript
 * import { sql, identifier, literal } from '@dotdo/postgres'
 *
 * const tableName = 'users'
 * const name = "O'Reilly"
 *
 * // Safe identifiers and literals
 * const query = sql`
 *   SELECT * FROM ${identifier(tableName)}
 *   WHERE name = ${literal(name)}
 * `
 * ```
 */

// ============================================================================
// ESCAPE FUNCTIONS
// ============================================================================

/**
 * Escape a string value for safe inclusion in SQL as a literal.
 * Wraps in single quotes and escapes internal quotes.
 *
 * @example
 * ```typescript
 * literal("O'Reilly") // "'O''Reilly'"
 * literal("test") // "'test'"
 * ```
 */
export function literal(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

/**
 * Escape a string value for safe inclusion in SQL as an identifier.
 * Wraps in double quotes and escapes internal quotes.
 *
 * @example
 * ```typescript
 * identifier('my_table') // '"my_table"'
 * identifier('column"name') // '"column""name"'
 * ```
 */
export function identifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}

// ============================================================================
// TAGGED TEMPLATE LITERAL
// ============================================================================

/**
 * Tagged template literal for building SQL queries.
 * This is a simple string concatenation helper - it does NOT
 * automatically escape values. Use literal() and identifier()
 * for escaping.
 *
 * @example
 * ```typescript
 * const table = identifier('users')
 * const name = literal("O'Reilly")
 *
 * const query = sql`
 *   SELECT * FROM ${table}
 *   WHERE name = ${name}
 * `
 * // Returns: "SELECT * FROM \"users\" WHERE name = 'O''Reilly'"
 * ```
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    result += String(values[i]) + (strings[i + 1] ?? '')
  }
  return result.trim()
}

// ============================================================================
// QUERY CONFIG BUILDER
// ============================================================================

/**
 * Query configuration for parameterized queries.
 */
export interface QueryConfig {
  text: string
  values?: unknown[]
  name?: string
  rowMode?: 'array'
}

/**
 * Build a query config object from a parameterized query.
 *
 * @example
 * ```typescript
 * const config = query(
 *   'SELECT * FROM users WHERE id = $1 AND name = $2',
 *   [1, 'Alice']
 * )
 * // { text: 'SELECT * FROM users WHERE id = $1 AND name = $2', values: [1, 'Alice'] }
 *
 * await client.query(config)
 * ```
 */
export function query(text: string, values?: unknown[]): QueryConfig {
  return values ? { text, values } : { text }
}

/**
 * Build a named prepared statement config.
 *
 * @example
 * ```typescript
 * const config = prepared(
 *   'get_user',
 *   'SELECT * FROM users WHERE id = $1',
 *   [1]
 * )
 * // { name: 'get_user', text: 'SELECT * FROM users WHERE id = $1', values: [1] }
 *
 * await client.query(config)
 * ```
 */
export function prepared(name: string, text: string, values?: unknown[]): QueryConfig {
  return { name, text, values }
}
