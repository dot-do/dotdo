/**
 * @dotdo/mysql - MySQL SDK compat
 *
 * Drop-in replacement for mysql2/promise backed by DO SQLite.
 * This in-memory implementation matches the mysql2 API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://sidorares.github.io/node-mysql2/docs
 */
import type {
  Connection as IConnection,
  Pool as IPool,
  PoolConnection as IPoolConnection,
  ConnectionOptions,
  PoolOptions,
  ExtendedMySQLConfig,
  QueryOptions,
  QueryResult,
  RowDataPacket,
  ResultSetHeader,
  FieldPacket,
  PreparedStatementInfo,
} from './types'
import { MySQLError, ConnectionError, Types } from './types'

// ============================================================================
// EVENT EMITTER (minimal implementation)
// ============================================================================

type EventHandler = (...args: any[]) => void

class EventEmitter {
  private handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return this
  }

  off(event: string, handler: EventHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.size === 0) return false
    for (const handler of handlers) {
      try {
        handler(...args)
      } catch (e) {
        if (event !== 'error') {
          this.emit('error', e)
        }
      }
    }
    return true
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
    return this
  }
}

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
  values: Map<string, any>
}

class InMemorySQLite {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private autoIncrementCounters = new Map<string, number>()
  private inTransaction = false
  private transactionSnapshot: Map<string, StoredRow[]> | null = null
  private autoIncrementSnapshot: Map<string, number> | null = null

  execute(sql: string, params: any[] = []): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
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
      return this.executeCreateIndex(normalizedSql)
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
      return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'SET' }
    }

    if (upperSql.startsWith('SHOW ')) {
      return this.executeShow(normalizedSql)
    }

    throw new MySQLError(`Unsupported SQL: ${sql}`, 'ER_PARSE_ERROR', 1064)
  }

  private translateMySQL(sql: string): string {
    let result = sql

    // Remove backticks (MySQL identifier quotes) - replace with nothing or double quotes
    result = result.replace(/`([^`]+)`/g, '"$1"')

    // AUTO_INCREMENT -> AUTOINCREMENT (but handle in CREATE TABLE parsing)
    // We keep AUTO_INCREMENT here but handle it in executeCreateTable

    // UNSIGNED - just remove it
    result = result.replace(/\s+UNSIGNED/gi, '')

    // TINYINT(1) -> INTEGER (SQLite doesn't have TINYINT)
    result = result.replace(/TINYINT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // INT(...) -> INTEGER
    result = result.replace(/INT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // BIGINT(...) -> INTEGER
    result = result.replace(/BIGINT\s*\(\s*\d+\s*\)/gi, 'INTEGER')

    // VARCHAR(...) -> TEXT (SQLite doesn't enforce length)
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

    // BLOB -> BLOB (no change needed)

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
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    // Parse CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(([^)]+(?:\([^)]*\)[^)]*)*)\)/i)
    if (!match) {
      throw new MySQLError('Invalid CREATE TABLE syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'CREATE TABLE' }
      }
      throw new MySQLError(`Table '${tableName}' already exists`, 'ER_TABLE_EXISTS_ERROR', 1050)
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

    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'CREATE TABLE' }
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

  private executeCreateIndex(_sql: string): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'CREATE INDEX' }
  }

  private executeDropTable(sql: string): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/i)
    if (!match) {
      throw new MySQLError('Invalid DROP TABLE syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const ifExists = /IF\s+EXISTS/i.test(sql)

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'DROP TABLE' }
      }
      throw new MySQLError(`Unknown table '${tableName}'`, 'ER_BAD_TABLE_ERROR', 1051)
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)
    this.autoIncrementCounters.delete(tableName)

    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'DROP TABLE' }
  }

  private executeInsert(sql: string, params: any[]): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    // Handle ON DUPLICATE KEY UPDATE by translating to INSERT OR REPLACE
    const onDuplicateMatch = sql.match(/(.+?)\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+)$/i)
    if (onDuplicateMatch) {
      // For simplicity, we'll do an upsert by checking if row exists
      return this.executeUpsert(onDuplicateMatch[1], onDuplicateMatch[2], params)
    }

    // Parse INSERT INTO table [(cols)] VALUES (...), (...), ...
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*(.+)$/i
    )
    if (!match) {
      throw new MySQLError('Invalid INSERT syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new MySQLError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE', 1146)
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
      const values = new Map<string, any>()
      for (let i = 0; i < specifiedCols.length; i++) {
        values.set(specifiedCols[i], insertValues[i] ?? null)
      }

      // Handle auto-increment
      let insertId = 0
      if (schema.autoIncrement) {
        const currentCounter = this.autoIncrementCounters.get(tableName) ?? 0
        if (!values.has(schema.autoIncrement) || values.get(schema.autoIncrement) === null || values.get(schema.autoIncrement) === undefined) {
          insertId = currentCounter + 1
          values.set(schema.autoIncrement, insertId)
          this.autoIncrementCounters.set(tableName, insertId)
        } else {
          insertId = values.get(schema.autoIncrement)
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
          if (row.values.get(constraint) === newValue && newValue !== null && newValue !== undefined) {
            throw new MySQLError(
              `Duplicate entry '${newValue}' for key '${constraint}'`,
              'ER_DUP_ENTRY',
              1062
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
      changedRows: 0,
      command: 'INSERT',
    }
  }

  private parseMultipleValueSets(valuesStr: string, params: any[]): any[][] {
    const results: any[][] = []
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
          const values: any[] = []
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

  private parseSingleValue(trimmed: string): any {
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

    // Handle DEFAULT
    if (trimmed.toUpperCase() === 'DEFAULT') return undefined

    return trimmed
  }

  private executeUpsert(insertPart: string, _updatePart: string, params: any[]): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    // Parse the INSERT part
    const match = insertPart.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)/i
    )
    if (!match) {
      throw new MySQLError('Invalid INSERT syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new MySQLError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE', 1146)
    }

    const specifiedCols = match[3]
      ? match[3].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[4]
    const insertValues = this.parseValues(valuesPart, params)

    // Build row values map
    const values = new Map<string, any>()
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
          insertId: pkValue,
          changedRows: 1,
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
        insertId = values.get(schema.autoIncrement)
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
      changedRows: 0,
      command: 'INSERT',
    }
  }

  private parseValues(valuesPart: string, params: any[]): any[] {
    const values: any[] = []
    const parts = this.splitValues(valuesPart)
    let paramIndex = 0

    for (const part of parts) {
      const trimmed = part.trim()

      // Handle ? placeholder (MySQL style)
      if (trimmed === '?') {
        let paramValue = params[paramIndex++]
        // Convert boolean to integer (MySQL stores booleans as 0/1)
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

  private executeSelect(sql: string, params: any[]): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
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
            changedRows: 0,
            command: 'SELECT',
          }
        }
        if (/^\d+$/.test(expr)) {
          return {
            columns: ['1'],
            rows: [[parseInt(expr, 10)]],
            affectedRows: 0,
            insertId: 0,
            changedRows: 0,
            command: 'SELECT',
          }
        }
        return {
          columns: ['?column?'],
          rows: [['MySQL 8.0 (dotdo compat)']],
          affectedRows: 0,
          insertId: 0,
          changedRows: 0,
          command: 'SELECT',
        }
      }
    }

    // Handle SELECT columns FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...]
    const fromMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|(\w+))/i)
    if (!fromMatch) {
      throw new MySQLError('Invalid SELECT syntax', 'ER_PARSE_ERROR', 1064)
    }

    const columnsPart = fromMatch[1]
    const mainTable = (fromMatch[2] || fromMatch[3]).toLowerCase()

    const sqlKeywords = 'WHERE|ORDER|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|GROUP|HAVING|UNION'
    const afterTablePattern = new RegExp(
      `FROM\\s+(?:"${mainTable}"|${mainTable})(?:\\s+(?:AS\\s+)?(?!${sqlKeywords}\\b)(\\w+))?(.*)$`,
      'i'
    )
    const afterTableMatch = normalized.match(afterTablePattern)
    const restOfQuery = afterTableMatch?.[2]?.trim() ?? ''

    const schema = this.tables.get(mainTable)
    if (!schema) {
      throw new MySQLError(`Table '${mainTable}' doesn't exist`, 'ER_NO_SUCH_TABLE', 1146)
    }

    let tableData = [...(this.data.get(mainTable) ?? [])]

    // Parse columns
    let selectedColumns: string[]
    if (columnsPart.trim() === '*') {
      selectedColumns = [...schema.columns]
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
    const whereMatch = restOfQuery.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s*$)/i)
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
    const rows = tableData.map((row) =>
      selectedColumns.map((col) => {
        const actualCol = schema.columns.find(c => c.toLowerCase() === col.toLowerCase()) || col
        return row.values.get(actualCol) ?? null
      })
    )

    return {
      columns: selectedColumns,
      rows,
      affectedRows: 0,
      insertId: 0,
      changedRows: 0,
      command: 'SELECT',
    }
  }

  private applyWhere(data: StoredRow[], condition: string, params: any[]): StoredRow[] {
    const andParts = condition.split(/\s+AND\s+/i)
    let result = data
    let paramIndex = 0

    for (const part of andParts) {
      const { filtered, usedParams } = this.applySingleCondition(result, part.trim(), params.slice(paramIndex))
      result = filtered
      paramIndex += usedParams
    }

    return result
  }

  private applySingleCondition(data: StoredRow[], condition: string, params: any[]): { filtered: StoredRow[], usedParams: number } {
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
        return this.resolveValue(trimmed, [])
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
        pattern = this.resolveValue(likeMatch[3].trim(), []) as string
      }
      const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$')
      return {
        filtered: data.filter((row) => regex.test(String(row.values.get(colName) ?? ''))),
        usedParams,
      }
    }

    // Handle comparison operators
    const compMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|(\w+))\s*(>=|<=|!=|<>|>|<|=)\s*(.+)/i)
    if (compMatch) {
      const colName = (compMatch[1] || compMatch[2]).toLowerCase()
      const operator = compMatch[3]
      const valuePart = compMatch[4].trim()

      let value: any
      if (valuePart === '?') {
        value = params[0]
        usedParams = 1
      } else {
        value = this.resolveValue(valuePart, [])
      }

      const compareFn = (rowValue: any): boolean => {
        switch (operator) {
          case '=':
            return rowValue === value
          case '!=':
          case '<>':
            return rowValue !== value
          case '>':
            return (rowValue ?? 0) > value
          case '>=':
            return (rowValue ?? 0) >= value
          case '<':
            return (rowValue ?? 0) < value
          case '<=':
            return (rowValue ?? 0) <= value
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

  private resolveValue(valuePart: string, _params: any[]): any {
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
        if (aVal < bVal) return desc ? 1 : -1
        if (aVal > bVal) return desc ? -1 : 1
      }
      return 0
    })
  }

  private executeUpdate(sql: string, params: any[]): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i
    )
    if (!match) {
      throw new MySQLError('Invalid UPDATE syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const setPart = match[3]
    const wherePart = match[4]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new MySQLError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE', 1146)
    }

    let tableData = this.data.get(tableName) ?? []

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
    const assignments = this.parseSetClause(setPart, params, toUpdate)
    let changedRows = 0

    for (const row of toUpdate) {
      let rowChanged = false
      for (const [col, assignment] of assignments) {
        const oldValue = row.values.get(col)
        let newValue: any

        if (assignment.expr) {
          // Evaluate expression like balance = balance - 50
          const currentValue = row.values.get(assignment.expr.col) ?? 0
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
        } else {
          newValue = assignment.value
        }

        if (oldValue !== newValue) {
          row.values.set(col, newValue)
          rowChanged = true
        }
      }
      if (rowChanged) changedRows++
    }

    return {
      columns: [],
      rows: [],
      affectedRows: toUpdate.length,
      insertId: 0,
      changedRows,
      command: 'UPDATE',
    }
  }

  private parseSetClause(setPart: string, params: any[], rows: StoredRow[]): Map<string, { value?: any; expr?: { col: string; op: string; param: any } }> {
    const assignments = new Map<string, { value?: any; expr?: { col: string; op: string; param: any } }>()
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
            const param = params[paramIndex++]
            assignments.set(col, { expr: { col: exprCol, op, param } })
          }
        } else {
          assignments.set(col, { value: this.resolveValue(valuePart, []) })
        }
      }
    }

    return assignments
  }

  private executeDelete(sql: string, params: any[]): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    const match = sql.match(
      /DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))(?:\s+WHERE\s+(.+))?$/i
    )
    if (!match) {
      throw new MySQLError('Invalid DELETE syntax', 'ER_PARSE_ERROR', 1064)
    }

    const tableName = (match[1] || match[2]).toLowerCase()
    const wherePart = match[3]

    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new MySQLError(`Table '${tableName}' doesn't exist`, 'ER_NO_SUCH_TABLE', 1146)
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
      changedRows: 0,
      command: 'DELETE',
    }
  }

  private executeBegin(): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    this.beginTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'BEGIN' }
  }

  private executeCommit(): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    this.commitTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'COMMIT' }
  }

  private executeRollback(): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    this.rollbackTransaction()
    return { columns: [], rows: [], affectedRows: 0, insertId: 0, changedRows: 0, command: 'ROLLBACK' }
  }

  private executeShow(_sql: string): {
    columns: string[]
    rows: any[][]
    affectedRows: number
    insertId: number
    changedRows: number
    command: string
  } {
    return { columns: ['setting'], rows: [['on']], affectedRows: 0, insertId: 0, changedRows: 0, command: 'SHOW' }
  }
}

// ============================================================================
// CONNECTION IMPLEMENTATION
// ============================================================================

class MySQLConnection extends EventEmitter implements IConnection {
  private db: InMemorySQLite
  private config: ExtendedMySQLConfig
  private _threadId = Math.floor(Math.random() * 100000)
  private preparedStatements = new Map<string, PreparedStatementInfo>()
  private stmtIdCounter = 0

  constructor(config: ConnectionOptions | ExtendedMySQLConfig, sharedDb?: InMemorySQLite) {
    super()
    this.config = config as ExtendedMySQLConfig
    this.db = sharedDb ?? new InMemorySQLite()
  }

  get threadId(): number | null {
    return this._threadId
  }

  async query<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
  ): Promise<QueryResult<T>> {
    const sql = typeof sqlOrOptions === 'string' ? sqlOrOptions : sqlOrOptions.sql
    const params = typeof sqlOrOptions === 'string' ? (values ?? []) : (sqlOrOptions.values ?? [])

    try {
      const result = this.db.execute(sql, params)

      const fields: FieldPacket[] = result.columns.map((name, i) => ({
        name,
        table: '',
        db: this.config.database ?? '',
        orgName: name,
        orgTable: '',
        characterSet: 33, // utf8
        columnLength: 255,
        columnType: Types.VARCHAR,
        flags: 0,
        decimals: 0,
      }))

      if (result.command === 'SELECT') {
        const rows = result.rows.map((row) => {
          const obj: any = {}
          for (let i = 0; i < result.columns.length; i++) {
            obj[result.columns[i]] = row[i]
          }
          return obj as T extends any[] ? T[number] : T
        })
        return [rows as T, fields]
      } else {
        // For INSERT, UPDATE, DELETE - return ResultSetHeader
        const header: ResultSetHeader = {
          affectedRows: result.affectedRows,
          changedRows: result.changedRows,
          fieldCount: 0,
          insertId: result.insertId,
          serverStatus: 2,
          warningCount: 0,
          info: '',
        }
        return [header as T, fields]
      }
    } catch (e) {
      if (e instanceof MySQLError) {
        throw e
      }
      throw new MySQLError((e as Error).message, 'ER_UNKNOWN', 1000)
    }
  }

  async execute<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
  ): Promise<QueryResult<T>> {
    // execute is essentially the same as query for prepared statements
    return this.query<T>(sqlOrOptions, values)
  }

  async beginTransaction(): Promise<void> {
    await this.query('BEGIN')
  }

  async commit(): Promise<void> {
    await this.query('COMMIT')
  }

  async rollback(): Promise<void> {
    await this.query('ROLLBACK')
  }

  async ping(): Promise<void> {
    // No-op for in-memory
  }

  async changeUser(_options: { user?: string; password?: string; database?: string }): Promise<void> {
    // No-op for in-memory
  }

  async prepare(sql: string): Promise<PreparedStatementInfo> {
    const id = ++this.stmtIdCounter
    const info: PreparedStatementInfo = {
      id,
      parameters: [],
      columns: [],
      close: async () => {
        this.preparedStatements.delete(sql)
      },
      execute: async (values?: any[]) => {
        return this.execute(sql, values)
      },
    }
    this.preparedStatements.set(sql, info)
    return info
  }

  unprepare(sql: string): void {
    this.preparedStatements.delete(sql)
  }

  async end(): Promise<void> {
    this.emit('end')
  }

  destroy(): void {
    this.emit('end')
  }

  pause(): void {
    // No-op
  }

  resume(): void {
    // No-op
  }

  format(sql: string, values?: any[]): string {
    if (!values || values.length === 0) return sql

    let result = sql
    let index = 0
    result = result.replace(/\?/g, () => {
      const value = values[index++]
      return this.escape(value)
    })
    return result
  }

  escape(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`
    }
    // String
    return "'" + String(value).replace(/'/g, "\\'") + "'"
  }

  escapeId(value: string): string {
    return '`' + value.replace(/`/g, '``') + '`'
  }
}

// ============================================================================
// POOL IMPLEMENTATION
// ============================================================================

class MySQLPool extends EventEmitter implements IPool {
  private config: ExtendedMySQLConfig
  private connections: Set<MySQLPoolConnection> = new Set()
  private idleConnections: MySQLPoolConnection[] = []
  private waitingRequests: Array<{
    resolve: (conn: IPoolConnection) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false
  private sharedDb: InMemorySQLite

  constructor(config: PoolOptions | ExtendedMySQLConfig) {
    super()
    this.config = {
      connectionLimit: 10,
      queueLimit: 0,
      waitForConnections: true,
      ...config,
    } as ExtendedMySQLConfig
    // All pool connections share the same database
    this.sharedDb = new InMemorySQLite()
  }

  get pool() {
    return {
      _allConnections: { length: this.connections.size },
      _freeConnections: { length: this.idleConnections.length },
      _connectionQueue: { length: this.waitingRequests.length },
    }
  }

  async query<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = await connection.query<T>(sqlOrOptions, values)
      connection.release()
      return result
    } catch (e) {
      connection.release()
      throw e
    }
  }

  async execute<T = RowDataPacket[]>(
    sqlOrOptions: string | QueryOptions,
    values?: any[]
  ): Promise<QueryResult<T>> {
    const connection = await this.getConnection()
    try {
      const result = await connection.execute<T>(sqlOrOptions, values)
      connection.release()
      return result
    } catch (e) {
      connection.release()
      throw e
    }
  }

  async getConnection(): Promise<IPoolConnection> {
    if (this._ended) {
      throw new ConnectionError('Pool is closed')
    }

    // Check for idle connection
    if (this.idleConnections.length > 0) {
      const connection = this.idleConnections.pop()!
      this.emit('acquire', connection)
      return connection
    }

    // Create new connection if under limit
    const limit = this.config.connectionLimit ?? 10
    if (this.connections.size < limit) {
      const connection = new MySQLPoolConnection(this.config, this, this.sharedDb)
      this.connections.add(connection)
      this.emit('connection', connection)
      this.emit('acquire', connection)
      return connection
    }

    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectTimeout ?? 30000
      const timer = setTimeout(() => {
        const index = this.waitingRequests.findIndex(
          (r) => r.resolve === resolve && r.reject === reject
        )
        if (index >= 0) {
          this.waitingRequests.splice(index, 1)
        }
        reject(new ConnectionError('Connection timeout'))
      }, timeoutMs)

      this.waitingRequests.push({
        resolve: (conn) => {
          clearTimeout(timer)
          resolve(conn)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this.emit('enqueue')
    })
  }

  _releaseConnection(connection: MySQLPoolConnection): void {
    // Check for waiting requests
    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', connection)
      waiter.resolve(connection)
      return
    }

    // Return to idle pool
    this.idleConnections.push(connection)
    this.emit('release', connection)
  }

  async end(): Promise<void> {
    this._ended = true

    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool is closed'))
    }
    this.waitingRequests = []

    const endPromises: Promise<void>[] = []
    for (const connection of this.connections) {
      endPromises.push(connection.end())
    }
    await Promise.all(endPromises)

    this.connections.clear()
    this.idleConnections = []
  }
}

class MySQLPoolConnection extends MySQLConnection implements IPoolConnection {
  private pool: MySQLPool

  constructor(config: ExtendedMySQLConfig, pool: MySQLPool, sharedDb: InMemorySQLite) {
    super(config, sharedDb)
    this.pool = pool
  }

  get connection(): IConnection {
    return this
  }

  release(): void {
    this.pool._releaseConnection(this)
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export async function createConnection(
  config: ConnectionOptions | ExtendedMySQLConfig
): Promise<IConnection> {
  const connection = new MySQLConnection(config)
  return connection
}

export function createPool(config: PoolOptions | ExtendedMySQLConfig): IPool {
  return new MySQLPool(config)
}

// ============================================================================
// EXPORTS
// ============================================================================

export { Types }
export { MySQLError, ConnectionError }

/**
 * Default export matching mysql2/promise module structure
 */
export const mysql = {
  createConnection,
  createPool,
  Types,
  MySQLError,
  ConnectionError,
}

export default mysql
