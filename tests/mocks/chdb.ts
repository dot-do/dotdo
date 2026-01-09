/**
 * Mock for chdb (ClickHouse embedded)
 *
 * Used in tests where the native chdb module isn't available
 * (e.g., when the native build hasn't been compiled)
 */

/**
 * Mock query function that returns appropriate results based on the query
 */
export function query(sql: string, format?: string): string {
  // Check for count queries and return 0
  const lowerSql = sql.toLowerCase()
  if (lowerSql.includes('count(') || lowerSql.includes('count ()')) {
    if (format === 'JSONEachRow' || !format) {
      return JSON.stringify({ count: 0 })
    }
    if (format === 'JSON') {
      return JSON.stringify({ data: [{ count: 0 }], rows: 1 })
    }
  }

  // Return empty results based on format
  if (format === 'JSONEachRow' || !format) {
    return ''
  }
  if (format === 'JSON') {
    return JSON.stringify({ data: [], rows: 0 })
  }
  return ''
}

/**
 * Mock Session class
 */
export class Session {
  private _path: string

  constructor(path: string) {
    this._path = path
  }

  query(sql: string, format?: string): string {
    return query(sql, format)
  }

  cleanup(): void {
    // No-op
  }
}
