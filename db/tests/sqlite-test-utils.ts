/**
 * Shared test utilities for SQLite tests
 * Provides mock SQLStorage implementation for unit testing
 */

// Mock SqlStorage interface
export interface MockSqlResult {
  results: Array<Record<string, unknown>>
}

export interface MockSqlStorage {
  exec(sql: string): MockSqlResult
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>
      all(): Promise<{ results: Array<Record<string, unknown>> }>
      run(): Promise<void>
    }
  }
}

export function createMockSqlStorage(): MockSqlStorage {
  // Create shared state for tables
  const state = {
    things: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    relationships: [] as Array<Record<string, unknown>>
  }

  const tables = new Map<string, Array<Record<string, unknown>>>()
  tables.set('things', state.things)
  tables.set('events', state.events)
  tables.set('relationships', state.relationships)

  return {
    exec(_sql: string): MockSqlResult {
      // Simple exec handler for CREATE TABLE
      return { results: [] }
    },

    prepare(sql: string) {
      let boundValues: unknown[] = []

      return {
        bind(...values: unknown[]) {
          boundValues = [...values] // Reset and set new values
          return {
            async first(): Promise<Record<string, unknown> | null> {
              // Parse SQL to determine operation
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('select')) {
                // Extract table name
                const tableMatch = sql.match(/from\s+(\w+)/i)
                if (!tableMatch || !tableMatch[1]) return null

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return null

                // Handle WHERE clause
                if (lowerSql.includes('where')) {
                  // Check for compound WHERE (relationships)
                  if (boundValues.length === 3 && lowerSql.includes('and')) {
                    const [subject, predicate, object] = boundValues
                    const found = rows.find((r: any) =>
                      r.subject === subject && r.predicate === predicate && r.object === object
                    )
                    return found || null
                  }

                  // Simple WHERE clause
                  if (boundValues.length > 0) {
                    const value = boundValues[0]
                    const found = rows.find((r: any) =>
                      r.id === value || r[Object.keys(r)[0]] === value
                    )
                    return found || null
                  }
                }

                return rows[0] || null
              }

              return null
            },

            async all(): Promise<{ results: Array<Record<string, unknown>> }> {
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('select')) {
                const tableMatch = sql.match(/from\s+(\w+)/i)
                if (!tableMatch || !tableMatch[1]) return { results: [] }

                const tableName = tableMatch[1]
                const tableRows = tables.get(tableName)
                if (!tableRows) return { results: [] }

                let rows = [...tableRows]

                // Handle WHERE clause filtering
                if (lowerSql.includes('where') && !lowerSql.includes('where 1=1')) {
                  // Count how many real conditions we have (not including "1=1")
                  const realAndCount = (sql.match(/AND(?!\s*1\s*=\s*1)/gi) || []).length

                  if (realAndCount >= 1) {
                    // Multiple conditions with "WHERE ..." (not 1=1)
                    const hasSubject = sql.includes('subject = ?')
                    const hasPredicate = sql.includes('predicate = ?')
                    const hasObject = sql.includes('object = ?')

                    rows = rows.filter((r: any) => {
                      let valueIndex = 0
                      let matches = true

                      if (hasSubject && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.subject === boundValues[valueIndex]
                        valueIndex++
                      }
                      if (hasPredicate && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.predicate === boundValues[valueIndex]
                        valueIndex++
                      }
                      if (hasObject && boundValues[valueIndex] !== undefined) {
                        matches = matches && r.object === boundValues[valueIndex]
                        valueIndex++
                      }

                      return matches
                    })
                  } else {
                    // We have filters - determine which ones by inspecting SQL and bound values
                    let filterIndex = 0

                    // Check for type filter
                    if (sql.includes('type = ?')) {
                      const typeValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.type === typeValue)
                    }

                    // Check for source filter
                    if (sql.includes('source = ?')) {
                      const sourceValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.source === sourceValue)
                    }

                    // Check for correlation_id filter
                    if (sql.includes('correlation_id = ?')) {
                      const corrValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.correlation_id === corrValue)
                    }

                    // Check for subject filter
                    if (sql.includes('subject = ?')) {
                      const subjectValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.subject === subjectValue)
                    }

                    // Check for predicate filter
                    if (sql.includes('predicate = ?')) {
                      const predicateValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.predicate === predicateValue)
                    }

                    // Check for object filter
                    if (sql.includes('object = ?')) {
                      const objectValue = boundValues[filterIndex++]
                      rows = rows.filter((r: any) => r.object === objectValue)
                    }

                    // Check for timestamp range
                    if (sql.includes('timestamp >= ?')) {
                      const sinceValue = boundValues[filterIndex++] as number
                      rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp >= sinceValue)
                    }

                    if (sql.includes('timestamp <= ?')) {
                      const untilValue = boundValues[filterIndex++] as number
                      rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp <= untilValue)
                    }
                  }
                } else if (lowerSql.includes('where 1=1')) {
                  // "WHERE 1=1" with AND conditions - apply filters in order they appear in SQL
                  // This pattern is used by createSQLiteRelationshipsStore.find()
                  let valueIndex = 0

                  // Count number of filter conditions (excluding LIMIT/OFFSET at the end)
                  // Parameters for filters come before LIMIT/OFFSET params
                  const filterParamCount = boundValues.length

                  if (sql.includes('AND type = ?') && valueIndex < filterParamCount) {
                    const typeValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.type === typeValue)
                  }

                  if (sql.includes('AND source = ?') && valueIndex < filterParamCount) {
                    const sourceValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.source === sourceValue)
                  }

                  if (sql.includes('AND correlation_id = ?') && valueIndex < filterParamCount) {
                    const corrValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.correlation_id === corrValue)
                  }

                  if (sql.includes('AND timestamp >= ?') && valueIndex < filterParamCount) {
                    const sinceValue = boundValues[valueIndex++] as number
                    rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp >= sinceValue)
                  }

                  if (sql.includes('AND timestamp <= ?') && valueIndex < filterParamCount) {
                    const untilValue = boundValues[valueIndex++] as number
                    rows = rows.filter((r: any) => typeof r.timestamp === 'number' && r.timestamp <= untilValue)
                  }

                  if (sql.includes('AND subject = ?') && valueIndex < filterParamCount) {
                    const subjectValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.subject === subjectValue)
                  }

                  if (sql.includes('AND predicate = ?') && valueIndex < filterParamCount) {
                    const predicateValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.predicate === predicateValue)
                  }

                  if (sql.includes('AND object = ?') && valueIndex < filterParamCount) {
                    const objectValue = boundValues[valueIndex++]
                    rows = rows.filter((r: any) => r.object === objectValue)
                  }
                }

                // Handle ORDER BY
                if (lowerSql.includes('order by')) {
                  if (lowerSql.includes('created_at desc') || lowerSql.includes('timestamp desc')) {
                    rows.sort((a: any, b: any) => {
                      const aTime = a.created_at || a.timestamp || 0
                      const bTime = b.created_at || b.timestamp || 0
                      return bTime - aTime
                    })
                  }
                }

                // Handle LIMIT/OFFSET with bound parameters
                let limit = rows.length
                let offset = 0

                // Find limit and offset values from bound parameters
                const questionMarks = (sql.match(/\?/g) || []).length
                if (questionMarks >= 2) {
                  // Last two params are typically LIMIT and OFFSET
                  limit = boundValues[boundValues.length - 2] as number || limit
                  offset = boundValues[boundValues.length - 1] as number || offset
                }

                return { results: rows.slice(offset, offset + limit) }
              }

              return { results: [] }
            },

            async run(): Promise<void> {
              const lowerSql = sql.toLowerCase().trim()

              if (lowerSql.startsWith('insert')) {
                const tableMatch = sql.match(/insert into\s+(\w+)/i)
                if (!tableMatch || !tableMatch[1]) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                // Extract column names
                const columnsMatch = sql.match(/\(([^)]+)\)/i)
                if (!columnsMatch) return

                const columns = columnsMatch[1]!.split(',').map(c => c.trim())

                // Create row object
                const row: Record<string, unknown> = {}
                columns.forEach((col, idx) => {
                  row[col] = boundValues[idx]
                })

                rows.push(row)
              } else if (lowerSql.startsWith('update')) {
                const tableMatch = sql.match(/update\s+(\w+)/i)
                if (!tableMatch || !tableMatch[1]) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                // Find row by ID (last bound value is typically the ID in WHERE clause)
                const id = boundValues[boundValues.length - 1]
                const rowIndex = rows.findIndex((r: any) => r.id === id || r.$id === id)

                if (rowIndex !== -1) {
                  // Update row with new values
                  // This is simplified - real implementation would parse SET clause
                  const setMatch = sql.match(/set\s+(.+?)\s+where/i)
                  if (setMatch) {
                    const setPairs = setMatch[1]!.split(',')
                    setPairs.forEach((pair, idx) => {
                      const [col] = pair.trim().split('=')
                      if (col) rows[rowIndex]![col.trim()] = boundValues[idx]
                    })
                  }
                }
              } else if (lowerSql.startsWith('delete')) {
                const tableMatch = sql.match(/delete from\s+(\w+)/i)
                if (!tableMatch || !tableMatch[1]) return

                const tableName = tableMatch[1]
                const rows = tables.get(tableName)
                if (!rows) return

                if (lowerSql.includes('where')) {
                  // Delete by specific criteria
                  // For relationships: WHERE subject = ? AND predicate = ? AND object = ?
                  if (boundValues.length === 3) {
                    const [subject, predicate, object] = boundValues
                    const index = rows.findIndex((r: any) =>
                      r.subject === subject && r.predicate === predicate && r.object === object
                    )
                    if (index !== -1) {
                      rows.splice(index, 1)
                    }
                  } else {
                    // Simple ID-based delete
                    const id = boundValues[0]
                    const index = rows.findIndex((r: any) => r.id === id)
                    if (index !== -1) {
                      rows.splice(index, 1)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
