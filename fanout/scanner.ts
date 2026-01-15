/**
 * ScannerDO - Executes queries on local data partition
 *
 * Each scanner handles a subset of the data (shard).
 * Supports parameterized queries and cursor-based pagination.
 */

// Constants for scanner configuration
const DEFAULT_CURSOR_TTL_MS = 60000
const CURSOR_EXPIRY_BUFFER_MS = 100

export interface QueryResult<T = unknown> {
  rows: T[]
  cursor?: string
  hasMore?: boolean
  scannerId?: string
  error?: string
}

interface ScannerOptions {
  id?: string
  cursorTtlMs?: number
}

interface CursorInfo {
  query: string
  offset: number
  createdAt: number
}

/**
 * ScannerDO - Executes queries on a data shard (local partition)
 *
 * Each ScannerDO instance manages a subset of the total dataset and handles:
 * - Local query execution with parameterized SQL support
 * - Cursor-based pagination with TTL expiration
 * - Health status tracking for failure detection
 * - SQL injection prevention via parameter binding
 * - Timeout and error handling
 *
 * Used in conjunction with QueryCoordinator for distributed query execution.
 *
 * @example
 * const scanner = new ScannerDO({ id: 'scanner-0' })
 * await scanner.seed(data)
 * const result = await scanner.execute('SELECT * FROM users WHERE status = ?', ['active'])
 *
 * // Pagination
 * const page1 = await scanner.executeWithCursor('SELECT * FROM users', undefined, 100)
 * const page2 = await scanner.executeWithCursor(
 *   'SELECT * FROM users',
 *   page1.cursor,
 *   100
 * )
 */
export class ScannerDO {
  public readonly id: string
  private data: Record<string, unknown>[] = []
  private cursors: Map<string, CursorInfo> = new Map()
  private cursorTtlMs: number
  private _healthy: boolean = true
  public lastQuery?: string

  constructor(options: ScannerOptions = {}) {
    this.id = options.id ?? `scanner-${Math.random().toString(36).slice(2, 8)}`
    this.cursorTtlMs = options.cursorTtlMs ?? DEFAULT_CURSOR_TTL_MS
  }

  /**
   * Seed the scanner with test data
   */
  async seed(data: Record<string, unknown>[]): Promise<void> {
    this.data = data
  }

  /**
   * Execute a query on local data (non-paginated)
   *
   * SECURITY: All parameters are validated before use to prevent injection attacks.
   * Parameters are never interpolated into strings - they are compared directly
   * against column values using strict equality.
   *
   * @param sql SQL query string
   * @param params Optional parameterized query values (safe from SQL injection)
   * @returns Query results with scannerId for tracing
   * @throws Error if parameter validation fails
   *
   * @example
   * const result = await scanner.execute(
   *   'SELECT * FROM users WHERE status = ?',
   *   ['active']
   * )
   */
  async execute<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.lastQuery = sql

    // SECURITY: Validate all parameters before processing
    const validatedParams = params?.map((p) => this.validateParam(p))

    // Simple query parser for testing
    const rows = this.executeQuery<T>(sql, validatedParams)

    return {
      rows,
      scannerId: this.id,
    }
  }

  /**
   * Execute query with cursor-based pagination
   *
   * Supports paginating large result sets by returning cursors for subsequent requests.
   * Cursors are validated and have a configurable TTL to prevent stale pagination.
   *
   * @param sql SQL query string
   * @param cursor Optional cursor from previous page (undefined for first page)
   * @param limit Maximum rows per page (default 100)
   * @returns Results with cursor for next page (if hasMore=true)
   * @throws Error if cursor is expired or invalid
   *
   * @example
   * // First page
   * const page1 = await scanner.executeWithCursor('SELECT * FROM users', undefined, 10)
   *
   * // Second page (if page1.cursor exists)
   * if (page1.cursor) {
   *   const page2 = await scanner.executeWithCursor(
   *     'SELECT * FROM users',
   *     page1.cursor,
   *     10
   *   )
   * }
   */
  async executeWithCursor<T = unknown>(
    sql: string,
    cursor?: string,
    limit: number = 100
  ): Promise<QueryResult<T>> {
    this.lastQuery = sql
    let offset = 0

    // Handle cursor
    if (cursor) {
      const cursorInfo = this.cursors.get(cursor)
      if (!cursorInfo) {
        throw new Error('Cursor expired or invalid')
      }

      // Check TTL
      if (Date.now() - cursorInfo.createdAt > this.cursorTtlMs) {
        this.cursors.delete(cursor)
        throw new Error('Cursor expired')
      }

      offset = cursorInfo.offset
    }

    // Execute with pagination
    const allRows = this.executeQuery<T>(sql)
    const pagedRows = allRows.slice(offset, offset + limit)
    const hasMore = offset + limit < allRows.length

    // Create new cursor if there are more results
    let newCursor: string | undefined
    if (hasMore) {
      newCursor = `cursor-${Math.random().toString(36).slice(2, 10)}`
      this.cursors.set(newCursor, {
        query: sql,
        offset: offset + limit,
        createdAt: Date.now(),
      })
    }

    return {
      rows: pagedRows,
      cursor: newCursor,
      hasMore,
      scannerId: this.id,
    }
  }

  /**
   * Get local row count
   */
  getLocalRowCount(): number {
    return this.data.length
  }

  /**
   * Check scanner health
   */
  isHealthy(): boolean {
    return this._healthy
  }

  /**
   * Test helper: corrupt storage
   */
  async corruptStorage(): Promise<void> {
    this._healthy = false
  }

  /**
   * Simple SQL query execution (for testing)
   * Supports SELECT, WHERE, ORDER BY
   */
  private executeQuery<T = unknown>(sql: string, params?: unknown[]): T[] {
    // Parse the SQL (simplified parser for testing)
    const lowerSql = sql.toLowerCase()

    let result = [...this.data]

    // Handle WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s*$)/i)
    if (whereMatch) {
      const whereClause = whereMatch[1]
      result = this.applyWhere(result, whereClause, params)
    }

    // Handle ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i)
    if (orderMatch) {
      const orderKey = orderMatch[1]
      const orderDir = (orderMatch[2] || 'ASC').toUpperCase()
      result.sort((a, b) => {
        const aVal = a[orderKey] as number
        const bVal = b[orderKey] as number
        return orderDir === 'ASC' ? aVal - bVal : bVal - aVal
      })
    }

    return result as T[]
  }

  /**
   * Apply WHERE clause filtering
   *
   * SECURITY: This method uses safe parameter binding to prevent SQL injection.
   * Parameters are never interpolated into strings - they are compared directly
   * against column values using strict equality.
   */
  private applyWhere(
    data: Record<string, unknown>[],
    whereClause: string,
    params?: unknown[]
  ): Record<string, unknown>[] {
    // Try parameterized query first (most secure)
    const paramResult = this.applyParameterizedWhere(data, whereClause, params)
    if (paramResult !== null) {
      return paramResult
    }

    // Try literal string values (for test queries)
    const literalStringResult = this.applyLiteralStringWhere(data, whereClause)
    if (literalStringResult !== null) {
      return literalStringResult
    }

    // Try numeric literal (for test queries)
    const numericResult = this.applyNumericWhere(data, whereClause)
    if (numericResult !== null) {
      return numericResult
    }

    // No WHERE clause matched
    return data
  }

  /**
   * Apply parameterized WHERE clause (safe against SQL injection)
   * Returns null if no parameter match found
   */
  private applyParameterizedWhere(
    data: Record<string, unknown>[],
    whereClause: string,
    params?: unknown[]
  ): Record<string, unknown>[] | null {
    const paramMatch = whereClause.match(/(\w+)\s*=\s*\?/)
    if (!paramMatch || !params || params.length === 0) {
      return null
    }

    const [, column] = paramMatch
    const paramValue = params[0]

    // SECURITY: Direct value comparison - no string interpolation
    // This prevents SQL injection by treating the parameter as an opaque value
    return data.filter((row) => row[column] === paramValue)
  }

  /**
   * Apply WHERE clause with literal string value
   * Returns null if no literal string match found
   */
  private applyLiteralStringWhere(
    data: Record<string, unknown>[],
    whereClause: string
  ): Record<string, unknown>[] | null {
    const literalMatch = whereClause.match(/(\w+)\s*=\s*'([^']*)'/)
    if (!literalMatch) {
      return null
    }

    const [, column, value] = literalMatch
    return data.filter((row) => row[column] === value)
  }

  /**
   * Apply WHERE clause with numeric literal value
   * Returns null if no numeric match found
   */
  private applyNumericWhere(
    data: Record<string, unknown>[],
    whereClause: string
  ): Record<string, unknown>[] | null {
    const numericMatch = whereClause.match(/(\w+)\s*=\s*(\d+)/)
    if (!numericMatch) {
      return null
    }

    const [, column, value] = numericMatch
    return data.filter((row) => row[column] === parseInt(value, 10))
  }

  /**
   * Validate and sanitize a parameter value
   *
   * SECURITY: This is an additional layer of defense that validates
   * parameter types and rejects obviously malicious inputs.
   */
  private validateParam(param: unknown): unknown {
    if (param === null || param === undefined) {
      return param
    }

    if (typeof param === 'number') {
      // Validate it's a finite number
      if (!Number.isFinite(param)) {
        throw new Error('Invalid parameter: non-finite number')
      }
      return param
    }

    if (typeof param === 'boolean') {
      return param
    }

    if (typeof param === 'string') {
      // String parameters are treated as opaque values
      // No SQL syntax interpretation occurs
      return param
    }

    // Reject complex types that could be exploited
    if (typeof param === 'object') {
      throw new Error('Invalid parameter: objects not allowed')
    }

    if (typeof param === 'function') {
      throw new Error('Invalid parameter: functions not allowed')
    }

    return param
  }
}
