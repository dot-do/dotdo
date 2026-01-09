/**
 * @dotdo/planetscale - PlanetScale SDK compat
 *
 * Drop-in replacement for @planetscale/database backed by DO SQLite.
 * This in-memory implementation matches the PlanetScale API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://github.com/planetscale/database-js
 */
import type { Config, ExecutedQuery, Row, Transaction } from './types'
import { DatabaseError } from './types'

// ============================================================================
// IN-MEMORY SQLITE (for testing)
// ============================================================================

interface TableSchema {
  name: string
  columns: string[]
  columnTypes: string[]
  primaryKey?: string
  uniqueConstraints: string[]
  autoIncrement?: string
}

interface StoredRow {
  rowid: number
  values: Map<string, unknown>
}

class InMemorySQLite {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private autoIncrementCounters = new Map<string, number>()
  private inTransaction = false
  private transactionSnapshot: Map<string, StoredRow[]> | null = null
  private autoIncrementSnapshot: Map<string, number> | null = null

  execute(
    sql: string,
    params: unknown[] = []
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    // Translate MySQL syntax to SQLite
    const translatedSql = this.translateMySQL(sql)
    const normalizedSql = translatedSql.trim()
    const upperSql = normalizedSql.toUpperCase()

    if (upperSql.startsWith('CREATE TABLE')) {
      return this.executeCreateTable(normalizedSql)
    }

    if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
      return this.executeCreateIndex()
    }

    if (upperSql.startsWith('DROP TABLE')) {
      return this.executeDropTable(normalizedSql)
    }

    if (upperSql.startsWith('INSERT')) {
      return this.executeInsert(normalizedSql, params)
    }

    if (upperSql.startsWith('SELECT')) {
      return this.executeSelect(normalizedSql, params)
    }

    if (upperSql.startsWith('UPDATE')) {
      return this.executeUpdate(normalizedSql, params)
    }

    if (upperSql.startsWith('DELETE')) {
      return this.executeDelete(normalizedSql, params)
    }

    if (upperSql.startsWith('BEGIN') || upperSql === 'START TRANSACTION') {
      return this.executeBegin()
    }

    if (upperSql.startsWith('COMMIT')) {
      return this.executeCommit()
    }

    if (upperSql.startsWith('ROLLBACK')) {
      return this.executeRollback()
    }

    if (upperSql.startsWith('SET ')) {
      return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'SET' }
    }

    throw new DatabaseError(`Unsupported SQL: ${sql}`, 'ER_PARSE_ERROR')
  }

  private translateMySQL(sql: string): string {
    let result = sql

    // Remove backticks (MySQL identifier quotes) - replace with double quotes
    result = result.replace(/`([^`]+)`/g, '"$1"')

    // UNSIGNED - just remove it
    result = result.replace(/\s+UNSIGNED/gi, '')

    // TINYINT(1) -> INTEGER
    result = result.replace(/TINYINT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // INT(...) -> INTEGER
    result = result.replace(/INT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // BIGINT(...) -> INTEGER
    result = result.replace(/BIGINT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // VARCHAR(...) -> TEXT
    result = result.replace(/VARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT')

    // DATETIME -> TEXT
    result = result.replace(/\bDATETIME\b/gi, 'TEXT')

    // TIMESTAMP -> TEXT
    result = result.replace(/\bTIMESTAMP\b/gi, 'TEXT')

    // DATE -> TEXT
    result = result.replace(/\bDATE\b/gi, 'TEXT')

    // TIME -> TEXT
    result = result.replace(/\bTIME\b/gi, 'TEXT')

    // ENUM(...) -> TEXT
    result = result.replace(/ENUM\s*\([^)]+\)/gi, 'TEXT')

    // DOUBLE -> REAL
    result = result.replace(/\bDOUBLE\b/gi, 'REAL')

    // FLOAT -> REAL
    result = result.replace(/\bFLOAT\b/gi, 'REAL')

    // BOOLEAN -> INTEGER
    result = result.replace(/\bBOOLEAN\b/gi, 'INTEGER')

    // BOOL -> INTEGER
    result = result.replace(/\bBOOL\b/gi, 'INTEGER')

    // JSON -> TEXT
    result = result.replace(/\bJSON\b/gi, 'TEXT')

    // TEXT types stay as TEXT
    result = result.replace(/\bMEDIUMTEXT\b/gi, 'TEXT')
    result = result.replace(/\bLONGTEXT\b/gi, 'TEXT')
    result = result.replace(/\bTINYTEXT\b/gi, 'TEXT')

    // Remove ENGINE=... clause
    result = result.replace(/\s+ENGINE\s*=\s*\w+/gi, '')

    // Remove DEFAULT CHARSET=... clause
    result = result.replace(/\s+DEFAULT\s+CHARSET\s*=\s*\w+/gi, '')

    // Remove COLLATE=... clause
    result = result.replace(/\s+COLLATE\s*=\s*\w+/gi, '')

    // Remove CHARACTER SET clause
    result = result.replace(/\s+CHARACTER\s+SET\s+\w+/gi, '')

    return result
  }

  beginTransaction(): void {
    this.inTransaction = true
    this.transactionSnapshot = new Map()
    this.autoIncrementSnapshot = new Map(this.autoIncrementCounters)
    for (const [table, rows] of this.data) {
      this.transactionSnapshot.set(
        table,
        rows.map((r) => ({ rowid: r.rowid, values: new Map(r.values) }))
      )
    }
  }

  commitTransaction(): void {
    this.inTransaction = false
    this.transactionSnapshot = null
    this.autoIncrementSnapshot = null
  }

  rollbackTransaction(): void {
    if (this.transactionSnapshot) {
      this.data = this.transactionSnapshot
    }
    if (this.autoIncrementSnapshot) {
      this.autoIncrementCounters = this.autoIncrementSnapshot
    }
    this.inTransaction = false
    this.transactionSnapshot = null
    this.autoIncrementSnapshot = null
  }

  private executeCreateTable(sql: string): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    // Parse CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const match = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(([^)]+(?:\([^)]*\)[^)]*)*)\)/i
    )
    if (!match) {
      throw new DatabaseError('Invalid CREATE TABLE syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'CREATE TABLE' }
      }
      throw new DatabaseError(`Table '${tableName}' already exists`, 'ER_TABLE_EXISTS_ERROR')
    }

    const columnDefs = this.splitColumnDefs(match[3])

    const columns: string[] = []
    const columnTypes: string[] = []
    const uniqueConstraints: string[] = []
    let primaryKey: string | undefined
    let autoIncrement: string | undefined

    for (const def of columnDefs) {
      const trimmed = def.trim()

      // Skip constraint definitions
      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT|INDEX|KEY)/i.test(trimmed)) {
        const pkMatch = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
        if (pkMatch) {
          primaryKey = pkMatch[1].split(',')[0].trim().replace(/"/g, '').toLowerCase()
        }
        continue
      }

      const parts = trimmed.split(/\s+/)
      const colName = parts[0].replace(/"/g, '').toLowerCase()
      const colType = parts[1]?.toUpperCase() ?? 'TEXT'

      columns.push(colName)
      columnTypes.push(colType)

      const upperDef = trimmed.toUpperCase()
      if (upperDef.includes('PRIMARY KEY')) {
        primaryKey = colName
        uniqueConstraints.push(colName)
      }
      if (upperDef.includes('UNIQUE') && !uniqueConstraints.includes(colName)) {
        uniqueConstraints.push(colName)
      }
      if (upperDef.includes('AUTO_INCREMENT') || upperDef.includes('AUTOINCREMENT')) {
        autoIncrement = colName
        if (!primaryKey) primaryKey = colName
      }
    }

    this.tables.set(tableName, {
      name: tableName,
      columns,
      columnTypes,
      primaryKey,
      uniqueConstraints,
      autoIncrement,
    })
    this.data.set(tableName, [])
    if (autoIncrement) {
      this.autoIncrementCounters.set(tableName, 0)
    }

    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'CREATE TABLE' }
  }

  private splitColumnDefs(defs: string): string[] {
    const result: string[] = []
    let current = ''
    let depth = 0

    for (const char of defs) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      result.push(current.trim())
    }
    return result
  }

  private executeCreateIndex(): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'CREATE INDEX' }
  }

  private executeDropTable(sql: string): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i)
    if (!match) {
      throw new DatabaseError('Invalid DROP TABLE syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const ifExists = /IF\s+EXISTS/i.test(sql)

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'DROP TABLE' }
      }
      throw new DatabaseError(`Unknown table '${tableName}'`, 'ER_BAD_TABLE_ERROR')
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)
    this.autoIncrementCounters.delete(tableName)

    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'DROP TABLE' }
  }

  private executeInsert(
    sql: string,
    params: unknown[]
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    // Handle ON DUPLICATE KEY UPDATE by translating to upsert
    const onDuplicateMatch = sql.match(/(.+?)\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+)$/i)
    if (onDuplicateMatch) {
      return this.executeUpsert(onDuplicateMatch[1], onDuplicateMatch[2], params)
    }

    // Parse INSERT INTO table [(cols)] VALUES (...), (...), ...
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*(.+)$/i
    )
    if (!match) {
      throw new DatabaseError('Invalid INSERT syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE')
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    // Parse all value sets: (1, 100), (2, 100)
    const valuesSets = this.parseMultipleValueSets(match[4], params)

    const tableData = this.data.get(tableName) ?? []
    let firstInsertId = 0
    let affectedRows = 0

    for (const insertValues of valuesSets) {
      // Build row values map
      const values = new Map<string, unknown>()
      for (let i = 0; i < specifiedCols.length; i++) {
        values.set(specifiedCols[i], insertValues[i] ?? null)
      }

      // Handle auto-increment
      let insertId = 0
      if (schema.autoIncrement) {
        const currentCounter = this.autoIncrementCounters.get(tableName) ?? 0
        if (
          !values.has(schema.autoIncrement) ||
          values.get(schema.autoIncrement) === null ||
          values.get(schema.autoIncrement) === undefined
        ) {
          insertId = currentCounter + 1
          values.set(schema.autoIncrement, insertId)
          this.autoIncrementCounters.set(tableName, insertId)
        } else {
          insertId = values.get(schema.autoIncrement) as number
          if (insertId > currentCounter) {
            this.autoIncrementCounters.set(tableName, insertId)
          }
        }
        if (firstInsertId === 0) firstInsertId = insertId
      }

      // Check unique constraints
      for (const constraint of schema.uniqueConstraints) {
        const newValue = values.get(constraint)
        for (const row of tableData) {
          if (
            row.values.get(constraint) === newValue &&
            newValue !== null &&
            newValue !== undefined
          ) {
            throw new DatabaseError(
              `Duplicate entry '${newValue}' for key '${constraint}'`,
              'ER_DUP_ENTRY'
            )
          }
        }
      }

      const rowid = tableData.length + 1
      tableData.push({ rowid, values })
      affectedRows++
    }

    return {
      columns: [],
      rows: [],
      affectedRows,
      insertId: firstInsertId,
      command: 'INSERT',
    }
  }

  private parseMultipleValueSets(valuesStr: string, params: unknown[]): unknown[][] {
    const results: unknown[][] = []
    let currentSet: string[] = []
    let current = ''
    let depth = 0
    let inString = false
    let stringChar = ''
    let paramIndex = 0

    for (const char of valuesStr) {
      if (!inString && (char === "'" || char === '"')) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        current += char
      } else if (!inString && char === '(') {
        if (depth === 0) {
          current = ''
        } else {
          current += char
        }
        depth++
      } else if (!inString && char === ')') {
        depth--
        if (depth === 0) {
          // End of value set
          currentSet.push(current)
          // Parse the values
          const values: unknown[] = []
          for (const part of currentSet) {
            const trimmed = part.trim()
            if (trimmed === '?') {
              let paramValue = params[paramIndex++]
              if (typeof paramValue === 'boolean') {
                paramValue = paramValue ? 1 : 0
              }
              values.push(paramValue)
            } else if (trimmed === '') {
              continue
            } else {
              values.push(this.parseSingleValue(trimmed))
            }
          }
          results.push(values)
          currentSet = []
          current = ''
        } else {
          current += char
        }
      } else if (!inString && depth === 1 && char === ',') {
        currentSet.push(current)
        current = ''
      } else if (!inString && depth === 0 && char === ',') {
        // Between value sets, skip
      } else {
        current += char
      }
    }

    return results
  }

  private parseSingleValue(trimmed: string): unknown {
    // Handle DEFAULT
    if (trimmed.toUpperCase() === 'DEFAULT') {
      return undefined
    }

    // Handle quoted strings
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      return trimmed.slice(1, -1)
    }

    // Handle NULL
    if (trimmed.toUpperCase() === 'NULL') {
      return null
    }

    // Handle booleans
    if (trimmed.toUpperCase() === 'TRUE') return 1
    if (trimmed.toUpperCase() === 'FALSE') return 0

    // Handle numbers
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
    if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed)

    return trimmed
  }

  private executeUpsert(
    insertPart: string,
    _updatePart: string,
    params: unknown[]
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    // Parse the INSERT part
    const match = insertPart.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)/i
    )
    if (!match) {
      throw new DatabaseError('Invalid INSERT syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE')
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[4]
    const insertValues = this.parseValues(valuesPart, params)

    // Build row values map
    const values = new Map<string, unknown>()
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i], insertValues[i] ?? null)
    }

    const tableData = this.data.get(tableName) ?? []

    // Check if row exists (by primary key)
    if (schema.primaryKey) {
      const pkValue = values.get(schema.primaryKey)
      const existingRowIndex = tableData.findIndex(
        (r) => r.values.get(schema.primaryKey!) === pkValue
      )

      if (existingRowIndex >= 0) {
        // Update existing row
        const existingRow = tableData[existingRowIndex]
        for (const [col, val] of values) {
          existingRow.values.set(col, val)
        }
        return {
          columns: [],
          rows: [],
          affectedRows: 2, // MySQL returns 2 for update via ON DUPLICATE KEY
          insertId: pkValue as number,
          command: 'INSERT',
        }
      }
    }

    // Insert new row
    let insertId = 0
    if (schema.autoIncrement) {
      const currentCounter = this.autoIncrementCounters.get(tableName) ?? 0
      if (!values.has(schema.autoIncrement) || values.get(schema.autoIncrement) === null) {
        insertId = currentCounter + 1
        values.set(schema.autoIncrement, insertId)
        this.autoIncrementCounters.set(tableName, insertId)
      } else {
        insertId = values.get(schema.autoIncrement) as number
        if (insertId > currentCounter) {
          this.autoIncrementCounters.set(tableName, insertId)
        }
      }
    }

    const rowid = tableData.length + 1
    tableData.push({ rowid, values })

    return {
      columns: [],
      rows: [],
      affectedRows: 1,
      insertId,
      command: 'INSERT',
    }
  }

  private parseValues(valuesPart: string, params: unknown[]): unknown[] {
    const values: unknown[] = []
    const parts = this.splitValues(valuesPart)
    let paramIndex = 0

    for (const part of parts) {
      const trimmed = part.trim()

      // Handle ? placeholder
      if (trimmed === '?') {
        let paramValue = params[paramIndex++]
        if (typeof paramValue === 'boolean') {
          paramValue = paramValue ? 1 : 0
        }
        values.push(paramValue)
        continue
      }

      // Handle DEFAULT
      if (trimmed.toUpperCase() === 'DEFAULT') {
        values.push(undefined)
        continue
      }

      // Handle quoted strings
      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        values.push(trimmed.slice(1, -1))
        continue
      }

      // Handle NULL
      if (trimmed.toUpperCase() === 'NULL') {
        values.push(null)
        continue
      }

      // Handle numbers
      if (/^-?\d+$/.test(trimmed)) {
        values.push(parseInt(trimmed, 10))
        continue
      }
      if (/^-?\d+\.\d+$/.test(trimmed)) {
        values.push(parseFloat(trimmed))
        continue
      }

      // Handle booleans
      if (trimmed.toUpperCase() === 'TRUE') {
        values.push(1)
        continue
      }
      if (trimmed.toUpperCase() === 'FALSE') {
        values.push(0)
        continue
      }

      values.push(trimmed)
    }

    return values
  }

  private splitValues(valuesPart: string): string[] {
    const parts: string[] = []
    let current = ''
    let inString = false
    let stringChar = ''
    let depth = 0

    for (const char of valuesPart) {
      if (!inString && (char === "'" || char === '"')) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        current += char
      } else if (!inString && char === '(') {
        depth++
        current += char
      } else if (!inString && char === ')') {
        depth--
        current += char
      } else if (!inString && depth === 0 && char === ',') {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }

    if (current.length > 0) {
      parts.push(current)
    }

    return parts
  }

  private executeSelect(
    sql: string,
    params: unknown[]
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    // Handle SELECT 1, SELECT version(), etc.
    if (/SELECT\s+\d+/i.test(normalized) && !/FROM/i.test(normalized)) {
      const match = normalized.match(/SELECT\s+(.+)/i)
      if (match) {
        const expr = match[1].trim()
        // Handle SELECT 1 as num
        const asMatch = expr.match(/(\d+)\s+as\s+(\w+)/i)
        if (asMatch) {
          return {
            columns: [asMatch[2]],
            rows: [[parseInt(asMatch[1], 10)]],
            affectedRows: 0,
            insertId: 0,
            command: 'SELECT',
          }
        }
        if (/^\d+$/.test(expr)) {
          return {
            columns: ['1'],
            rows: [[parseInt(expr, 10)]],
            affectedRows: 0,
            insertId: 0,
            command: 'SELECT',
          }
        }
        return {
          columns: ['?column?'],
          rows: [['MySQL 8.0 (dotdo compat)']],
          affectedRows: 0,
          insertId: 0,
          command: 'SELECT',
        }
      }
    }

    // Handle aggregate functions without FROM
    const aggMatch = normalized.match(/SELECT\s+(COUNT|SUM|AVG|MIN|MAX)\s*\(/i)
    if (aggMatch && !/FROM/i.test(normalized)) {
      return {
        columns: [aggMatch[1].toLowerCase()],
        rows: [[0]],
        affectedRows: 0,
        insertId: 0,
        command: 'SELECT',
      }
    }

    // Handle SELECT columns FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
    const fromMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|(\w+))/i)
    if (!fromMatch) {
      throw new DatabaseError('Invalid SELECT syntax', 'ER_PARSE_ERROR')
    }

    const columnsPart = fromMatch[1]
    const mainTable = (fromMatch[2] || fromMatch[3]).toLowerCase()

    const sqlKeywords =
      'WHERE|ORDER|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|GROUP|HAVING|UNION'
    const afterTablePattern = new RegExp(
      `FROM\\s+(?:"${mainTable}"|${mainTable})(?:\\s+(?:AS\\s+)?(?!${sqlKeywords}\\b)(\\w+))?(.*)$`,
      'i'
    )
    const afterTableMatch = normalized.match(afterTablePattern)
    const restOfQuery = afterTableMatch?.[2]?.trim() ?? ''

    const schema = this.tables.get(mainTable)
    if (!schema) {
      throw new DatabaseError(`Table '${mainTable}' doesn't exist`, 'ER_NO_SUCH_TABLE')
    }

    let tableData = [...(this.data.get(mainTable) ?? [])]

    // Parse columns
    let selectedColumns: string[]
    let isAggregate = false
    if (columnsPart.trim() === '*') {
      selectedColumns = [...schema.columns]
    } else if (/^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(columnsPart.trim())) {
      isAggregate = true
      // Handle aggregate like COUNT(*)
      const aggFuncMatch = columnsPart.match(/(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*([^)]+)\s*\)/i)
      if (aggFuncMatch) {
        const funcName = aggFuncMatch[1].toLowerCase()
        const asMatch = columnsPart.match(/\s+as\s+(\w+)/i)
        selectedColumns = [asMatch ? asMatch[1].toLowerCase() : funcName]
      } else {
        selectedColumns = ['count']
      }
    } else {
      selectedColumns = columnsPart.split(',').map((c) => {
        const col = c.trim()
        if (col.includes('.')) {
          return col.split('.')[1].replace(/"/g, '').toLowerCase()
        }
        const asMatch = col.match(/(.+?)\s+AS\s+(\w+)/i)
        if (asMatch) {
          return asMatch[2].trim().toLowerCase()
        }
        return col.replace(/"/g, '').toLowerCase()
      })
    }

    // Apply WHERE filter
    const whereMatch = restOfQuery.match(
      /WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s+GROUP\s+BY|\s*$)/i
    )
    if (whereMatch) {
      const condition = whereMatch[1].trim()
      tableData = this.applyWhere(tableData, condition, params)
    }

    // Apply ORDER BY
    const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (orderMatch) {
      const orderBy = orderMatch[1].trim()
      tableData = this.applyOrderBy(tableData, orderBy)
    }

    // Apply LIMIT and OFFSET
    const limitMatch = restOfQuery.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i)
    const offsetMatch = restOfQuery.match(/OFFSET\s+(\d+)/i)

    let offset = 0
    let limit = tableData.length

    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10)
      if (limitMatch[2]) {
        offset = parseInt(limitMatch[2], 10)
      }
    }
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10)
    }

    tableData = tableData.slice(offset, offset + limit)

    // Build result
    if (isAggregate) {
      // Handle aggregate function
      const aggFuncMatch = columnsPart.match(/(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*([^)]+)\s*\)/i)
      if (aggFuncMatch) {
        const funcName = aggFuncMatch[1].toUpperCase()
        const colExpr = aggFuncMatch[2].trim()

        let value: number
        if (funcName === 'COUNT') {
          value = tableData.length
        } else if (colExpr === '*') {
          value = tableData.length
        } else {
          const colName = colExpr.replace(/"/g, '').toLowerCase()
          const values = tableData.map((r) => r.values.get(colName) as number).filter((v) => v != null)
          switch (funcName) {
            case 'SUM':
              value = values.reduce((a, b) => a + b, 0)
              break
            case 'AVG':
              value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
              break
            case 'MIN':
              value = Math.min(...values)
              break
            case 'MAX':
              value = Math.max(...values)
              break
            default:
              value = 0
          }
        }
        return {
          columns: selectedColumns,
          rows: [[value]],
          affectedRows: 0,
          insertId: 0,
          command: 'SELECT',
        }
      }
    }

    const rows = tableData.map((row) =>
      selectedColumns.map((col) => {
        const actualCol =
          schema.columns.find((c) => c.toLowerCase() === col.toLowerCase()) || col
        return row.values.get(actualCol) ?? null
      })
    )

    return {
      columns: selectedColumns,
      rows,
      affectedRows: 0,
      insertId: 0,
      command: 'SELECT',
    }
  }

  private applyWhere(data: StoredRow[], condition: string, params: unknown[]): StoredRow[] {
    const andParts = condition.split(/\s+AND\s+/i)
    let result = data
    let paramIndex = 0

    for (const part of andParts) {
      const { filtered, usedParams } = this.applySingleCondition(
        result,
        part.trim(),
        params.slice(paramIndex)
      )
      result = filtered
      paramIndex += usedParams
    }

    return result
  }

  private applySingleCondition(
    data: StoredRow[],
    condition: string,
    params: unknown[]
  ): { filtered: StoredRow[]; usedParams: number } {
    let usedParams = 0

    // Handle IS NULL
    const isNullMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s+IS\s+NULL/i)
    if (isNullMatch) {
      const colName = (isNullMatch[1] || isNullMatch[2]).toLowerCase()
      return { filtered: data.filter((row) => row.values.get(colName) === null), usedParams: 0 }
    }

    // Handle IS NOT NULL
    const isNotNullMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s+IS\s+NOT\s+NULL/i)
    if (isNotNullMatch) {
      const colName = (isNotNullMatch[1] || isNotNullMatch[2]).toLowerCase()
      return { filtered: data.filter((row) => row.values.get(colName) !== null), usedParams: 0 }
    }

    // Handle IN clause
    const inMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s+IN\s*\(([^)]+)\)/i)
    if (inMatch) {
      const colName = (inMatch[1] || inMatch[2]).toLowerCase()
      const valuesPart = inMatch[3]
      const inValues = valuesPart.split(',').map((v) => {
        const trimmed = v.trim()
        if (trimmed === '?') {
          usedParams++
          return params[usedParams - 1]
        }
        return this.resolveValue(trimmed)
      })
      return {
        filtered: data.filter((row) => inValues.includes(row.values.get(colName))),
        usedParams,
      }
    }

    // Handle LIKE
    const likeMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s+LIKE\s+(.+)/i)
    if (likeMatch) {
      const colName = (likeMatch[1] || likeMatch[2]).toLowerCase()
      let pattern: string
      if (likeMatch[3].trim() === '?') {
        pattern = params[0] as string
        usedParams = 1
      } else {
        pattern = this.resolveValue(likeMatch[3].trim()) as string
      }
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$')
      return {
        filtered: data.filter((row) => regex.test(String(row.values.get(colName) ?? ''))),
        usedParams,
      }
    }

    // Handle comparison operators
    const compMatch = condition.match(
      /(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s*(>=|<=|!=|<>|>|<|=)\s*(.+)/i
    )
    if (compMatch) {
      const colName = (compMatch[1] || compMatch[2]).toLowerCase()
      const operator = compMatch[3]
      const valuePart = compMatch[4].trim()

      let value: unknown
      if (valuePart === '?') {
        value = params[0]
        usedParams = 1
      } else {
        value = this.resolveValue(valuePart)
      }

      // Convert boolean to number for comparison
      if (typeof value === 'boolean') {
        value = value ? 1 : 0
      }

      const compareFn = (rowValue: unknown): boolean => {
        switch (operator) {
          case '=':
            return rowValue === value
          case '!=':
          case '<>':
            return rowValue !== value
          case '>':
            return ((rowValue as number) ?? 0) > (value as number)
          case '>=':
            return ((rowValue as number) ?? 0) >= (value as number)
          case '<':
            return ((rowValue as number) ?? 0) < (value as number)
          case '<=':
            return ((rowValue as number) ?? 0) <= (value as number)
          default:
            return false
        }
      }

      return {
        filtered: data.filter((row) => compareFn(row.values.get(colName))),
        usedParams,
      }
    }

    return { filtered: data, usedParams: 0 }
  }

  private resolveValue(valuePart: string): unknown {
    // Handle quoted strings
    if (
      (valuePart.startsWith("'") && valuePart.endsWith("'")) ||
      (valuePart.startsWith('"') && valuePart.endsWith('"'))
    ) {
      return valuePart.slice(1, -1)
    }

    // Handle NULL
    if (valuePart.toUpperCase() === 'NULL') {
      return null
    }

    // Handle booleans
    if (valuePart.toUpperCase() === 'TRUE') return 1
    if (valuePart.toUpperCase() === 'FALSE') return 0

    // Handle numbers
    if (/^-?\d+$/.test(valuePart)) return parseInt(valuePart, 10)
    if (/^-?\d+\.\d+$/.test(valuePart)) return parseFloat(valuePart)

    return valuePart
  }

  private applyOrderBy(data: StoredRow[], orderBy: string): StoredRow[] {
    const parts = orderBy.split(',').map((p) => {
      const trimmed = p.trim()
      const descMatch = trimmed.match(/(.+?)\s+DESC/i)
      const ascMatch = trimmed.match(/(.+?)\s+ASC/i)
      const col = (descMatch?.[1] || ascMatch?.[1] || trimmed).replace(/"/g, '').toLowerCase()
      const desc = !!descMatch
      return { col, desc }
    })

    return [...data].sort((a, b) => {
      for (const { col, desc } of parts) {
        const aVal = a.values.get(col)
        const bVal = b.values.get(col)
        if (aVal === bVal) continue
        if (aVal === null) return desc ? -1 : 1
        if (bVal === null) return desc ? 1 : -1
        if ((aVal as number) < (bVal as number)) return desc ? 1 : -1
        if ((aVal as number) > (bVal as number)) return desc ? -1 : 1
      }
      return 0
    })
  }

  private executeUpdate(
    sql: string,
    params: unknown[]
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    const match = sql.match(/UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
    if (!match) {
      throw new DatabaseError('Invalid UPDATE syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const setPart = match[3]
    const wherePart = match[4]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE')
    }

    const tableData = this.data.get(tableName) ?? []

    // Parse SET assignments to count params used
    const setAssignments = this.splitValues(setPart)
    let setParamCount = 0
    for (const assignment of setAssignments) {
      if (assignment.includes('?')) {
        setParamCount++
      }
    }

    // Apply WHERE filter
    let toUpdate = [...tableData]
    if (wherePart) {
      toUpdate = this.applyWhere(toUpdate, wherePart, params.slice(setParamCount))
    }

    // Parse SET assignments and apply
    const assignments = this.parseSetClause(setPart, params)

    for (const row of toUpdate) {
      for (const [col, assignment] of assignments) {
        if (assignment.expr) {
          // Evaluate expression like balance = balance - 50
          const currentValue = (row.values.get(assignment.expr.col) as number) ?? 0
          let newValue: number
          switch (assignment.expr.op) {
            case '+':
              newValue = currentValue + assignment.expr.param
              break
            case '-':
              newValue = currentValue - assignment.expr.param
              break
            case '*':
              newValue = currentValue * assignment.expr.param
              break
            case '/':
              newValue = currentValue / assignment.expr.param
              break
            default:
              newValue = currentValue
          }
          row.values.set(col, newValue)
        } else {
          row.values.set(col, assignment.value)
        }
      }
    }

    return {
      columns: [],
      rows: [],
      affectedRows: toUpdate.length,
      insertId: 0,
      command: 'UPDATE',
    }
  }

  private parseSetClause(
    setPart: string,
    params: unknown[]
  ): Map<string, { value?: unknown; expr?: { col: string; op: string; param: number } }> {
    const assignments = new Map<
      string,
      { value?: unknown; expr?: { col: string; op: string; param: number } }
    >()
    const parts = this.splitValues(setPart)
    let paramIndex = 0

    for (const part of parts) {
      const match = part.match(/(?:"([^"]+)"|(\w+))\s*=\s*(.+)/i)
      if (match) {
        const col = (match[1] || match[2]).toLowerCase()
        const valuePart = match[3].trim()

        if (valuePart === '?') {
          assignments.set(col, { value: params[paramIndex++] })
        } else if (valuePart.includes('?')) {
          // Handle expressions like "col = col + ?" or "balance = balance - ?"
          const exprMatch = valuePart.match(/(\w+)\s*([+\-*/])\s*\?/)
          if (exprMatch) {
            const exprCol = exprMatch[1].toLowerCase()
            const op = exprMatch[2]
            const param = params[paramIndex++] as number
            assignments.set(col, { expr: { col: exprCol, op, param } })
          }
        } else {
          // Check for expressions with literal numbers like "col = col + 1"
          const literalExprMatch = valuePart.match(/(\w+)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/)
          if (literalExprMatch) {
            const exprCol = literalExprMatch[1].toLowerCase()
            const op = literalExprMatch[2]
            const param = parseFloat(literalExprMatch[3])
            assignments.set(col, { expr: { col: exprCol, op, param } })
          } else {
            assignments.set(col, { value: this.resolveValue(valuePart) })
          }
        }
      }
    }

    return assignments
  }

  private executeDelete(
    sql: string,
    params: unknown[]
  ): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    const match = sql.match(/DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))(?:\s+WHERE\s+(.+))?$/i)
    if (!match) {
      throw new DatabaseError('Invalid DELETE syntax', 'ER_PARSE_ERROR')
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const wherePart = match[3]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new DatabaseError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE')
    }

    const tableData = this.data.get(tableName) ?? []

    let toDelete = [...tableData]
    if (wherePart) {
      toDelete = this.applyWhere(toDelete, wherePart, params)
    }

    const toDeleteRowIds = new Set(toDelete.map((r) => r.rowid))
    this.data.set(
      tableName,
      tableData.filter((r) => !toDeleteRowIds.has(r.rowid))
    )

    return {
      columns: [],
      rows: [],
      affectedRows: toDelete.length,
      insertId: 0,
      command: 'DELETE',
    }
  }

  private executeBegin(): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    this.beginTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'BEGIN' }
  }

  private executeCommit(): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    this.commitTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'COMMIT' }
  }

  private executeRollback(): {
    columns: string[]
    rows: unknown[][]
    affectedRows: number
    insertId: number
    command: string
  } {
    this.rollbackTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, command: 'ROLLBACK' }
  }
}

// ============================================================================
// CONNECTION CLASS
// ============================================================================

export class Connection {
  private db: InMemorySQLite
  private config: Config

  constructor(config: Config) {
    this.config = config
    this.db = new InMemorySQLite()
  }

  async execute<T = Row>(sql: string, args?: unknown[]): Promise<ExecutedQuery<T>> {
    const startTime = performance.now()

    try {
      const result = this.db.execute(sql, args ?? [])
      const endTime = performance.now()

      if (result.command === 'SELECT') {
        // Build rows as objects
        const rows = result.rows.map((row) => {
          const obj: Record<string, unknown> = {}
          for (let i = 0; i < result.columns.length; i++) {
            obj[result.columns[i]] = row[i]
          }
          return obj as T
        })

        return {
          headers: result.columns,
          rows,
          size: rows.length,
          time: endTime - startTime,
        }
      } else {
        // For INSERT, UPDATE, DELETE
        return {
          headers: [],
          rows: [],
          size: 0,
          time: endTime - startTime,
          insertId: result.insertId || undefined,
          rowsAffected: result.affectedRows,
        }
      }
    } catch (e) {
      if (e instanceof DatabaseError) {
        throw e
      }
      throw new DatabaseError((e as Error).message, 'UNKNOWN')
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // Begin transaction
    this.db.execute('BEGIN')

    const tx: Transaction = {
      execute: async <R = Row>(sql: string, args?: unknown[]): Promise<ExecutedQuery<R>> => {
        return this.execute<R>(sql, args)
      },
    }

    try {
      const result = await fn(tx)
      this.db.execute('COMMIT')
      return result
    } catch (e) {
      this.db.execute('ROLLBACK')
      throw e
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function connect(config: Config): Connection {
  // Validate config
  if (!config.url && !config.host) {
    throw new DatabaseError('Either url or host is required', 'INVALID_CONFIG')
  }
  if (!config.url && config.host === '') {
    throw new DatabaseError('Host cannot be empty', 'INVALID_CONFIG')
  }

  return new Connection(config)
}

// ============================================================================
// CAST HELPERS
// ============================================================================

export function hex(data: Buffer | Uint8Array): string {
  const bytes = data instanceof Buffer ? data : Buffer.from(data)
  return bytes.toString('hex')
}

export function datetime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function json(obj: unknown): string {
  return JSON.stringify(obj)
}

export const cast = {
  hex,
  datetime,
  json,
}

export { DatabaseError }
