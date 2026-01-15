/**
 * ScannerDO - Executes queries on local data partition
 *
 * Each scanner handles a subset of the data (shard).
 * Supports parameterized queries and cursor-based pagination.
 */

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

export class ScannerDO {
  public readonly id: string
  private data: Record<string, unknown>[] = []
  private cursors: Map<string, CursorInfo> = new Map()
  private cursorTtlMs: number
  private _healthy: boolean = true
  public lastQuery?: string

  constructor(options: ScannerOptions = {}) {
    this.id = options.id ?? `scanner-${Math.random().toString(36).slice(2, 8)}`
    this.cursorTtlMs = options.cursorTtlMs ?? 60000
  }

  /**
   * Seed the scanner with test data
   */
  async seed(data: Record<string, unknown>[]): Promise<void> {
    this.data = data
  }

  /**
   * Execute a query on local data
   */
  async execute<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.lastQuery = sql

    // Simple query parser for testing
    const rows = this.executeQuery<T>(sql, params)

    return {
      rows,
      scannerId: this.id,
    }
  }

  /**
   * Execute query with cursor-based pagination
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
   */
  private applyWhere(
    data: Record<string, unknown>[],
    whereClause: string,
    params?: unknown[]
  ): Record<string, unknown>[] {
    // Handle parameterized query (? placeholders)
    let processedWhere = whereClause
    if (params && params.length > 0) {
      let paramIndex = 0
      processedWhere = whereClause.replace(/\?/g, () => {
        const param = params[paramIndex++]
        if (typeof param === 'string') {
          return `'${param}'`
        }
        return String(param)
      })
    }

    // Simple equality filter: column = 'value' or column = value
    const equalityMatch = processedWhere.match(/(\w+)\s*=\s*'([^']+)'/)
    if (equalityMatch) {
      const [, column, value] = equalityMatch
      return data.filter((row) => row[column] === value)
    }

    // Simple equality without quotes
    const numericMatch = processedWhere.match(/(\w+)\s*=\s*(\d+)/)
    if (numericMatch) {
      const [, column, value] = numericMatch
      return data.filter((row) => row[column] === parseInt(value, 10))
    }

    return data
  }
}
