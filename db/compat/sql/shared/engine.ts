/**
 * @dotdo/db/compat/sql/shared - SQL Engine
 *
 * Shared in-memory SQL engine that powers all SQL compat layers.
 * Consolidates ~3,000+ lines of duplicated code from postgres, mysql, turso, etc.
 *
 * This engine provides a SQLite-compatible in-memory database that can be
 * configured with different dialects (PostgreSQL, MySQL, SQLite) for
 * testing and edge-native execution.
 */

import type {
  SQLValue,
  StorageValue,
  TableSchema,
  StoredRow,
  ExecutionResult,
  DialectConfig,
  TransactionMode,
  TransactionState,
  SQLCommand,
} from './types'
import {
  SQLError,
  SQLParseError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  ReadOnlyTransactionError,
  POSTGRES_DIALECT,
} from './types'
import {
  detectCommand,
  translateDialect,
  splitColumnDefs,
  splitValues,
  parseMultipleValueSets,
  parseValueToken,
  resolveValuePart,
  normalizeValue,
  parseColumnList,
  extractColumnName,
  parseCondition,
  splitWhereConditions,
  parseOrderBy,
  parseSetClause,
  type ParsedCondition,
  type OrderByClause,
  type SetAssignment,
} from './parser'

// ============================================================================
// SQL ENGINE INTERFACE
// ============================================================================

/**
 * SQL Engine interface that all engines must implement
 */
export interface SQLEngine {
  /** Execute a SQL statement */
  execute(sql: string, params?: SQLValue[]): ExecutionResult

  /** Begin a transaction */
  beginTransaction(mode?: TransactionMode): void

  /** Commit the current transaction */
  commitTransaction(): void

  /** Rollback the current transaction */
  rollbackTransaction(): void

  /** Check if a transaction is active */
  isInTransaction(): boolean

  /** Get the dialect configuration */
  getDialect(): DialectConfig
}

// ============================================================================
// IN-MEMORY SQL ENGINE
// ============================================================================

/**
 * In-memory SQL engine backed by native JavaScript data structures.
 * Provides SQLite-compatible behavior with configurable dialect support.
 */
export class InMemorySQLEngine implements SQLEngine {
  // Schema storage
  private tables = new Map<string, TableSchema>()

  // Data storage
  private data = new Map<string, StoredRow[]>()

  // Auto-increment counters per table
  private autoIncrementCounters = new Map<string, number>()

  // Global row ID counter
  private lastRowId = 0

  // Transaction state
  private transaction: TransactionState = {
    active: false,
    mode: 'write',
    dataSnapshot: null,
    autoIncrementSnapshot: null,
  }

  constructor(private dialect: DialectConfig = POSTGRES_DIALECT) {}

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getDialect(): DialectConfig {
    return this.dialect
  }

  execute(sql: string, params: SQLValue[] = []): ExecutionResult {
    // Translate dialect-specific SQL to normalized form
    const translatedSql = translateDialect(sql, this.dialect)
    const command = detectCommand(translatedSql)

    switch (command) {
      case 'SELECT':
        return this.executeSelect(translatedSql, params)
      case 'INSERT':
        this.checkWriteAllowed()
        return this.executeInsert(translatedSql, params)
      case 'UPDATE':
        this.checkWriteAllowed()
        return this.executeUpdate(translatedSql, params)
      case 'DELETE':
        this.checkWriteAllowed()
        return this.executeDelete(translatedSql, params)
      case 'CREATE TABLE':
        return this.executeCreateTable(translatedSql)
      case 'CREATE INDEX':
        return this.executeCreateIndex()
      case 'DROP TABLE':
        return this.executeDropTable(translatedSql)
      case 'BEGIN':
        return this.executeBegin()
      case 'COMMIT':
        return this.executeCommit()
      case 'ROLLBACK':
        return this.executeRollback()
      case 'SET':
      case 'SHOW':
      case 'SAVEPOINT':
      case 'RELEASE':
        return this.emptyResult(command)
      default:
        throw new SQLParseError(`Unsupported SQL: ${sql}`)
    }
  }

  beginTransaction(mode: TransactionMode = 'write'): void {
    this.transaction.active = true
    this.transaction.mode = mode

    // Snapshot current state for rollback
    this.transaction.dataSnapshot = new Map()
    this.data.forEach((rows, table) => {
      this.transaction.dataSnapshot!.set(
        table,
        rows.map((r) => ({ rowid: r.rowid, values: new Map(r.values) }))
      )
    })
    this.transaction.autoIncrementSnapshot = new Map(this.autoIncrementCounters)
  }

  commitTransaction(): void {
    this.transaction.active = false
    this.transaction.dataSnapshot = null
    this.transaction.autoIncrementSnapshot = null
    this.transaction.mode = 'write'
  }

  rollbackTransaction(): void {
    if (this.transaction.dataSnapshot) {
      this.data = this.transaction.dataSnapshot
    }
    if (this.transaction.autoIncrementSnapshot) {
      this.autoIncrementCounters = this.transaction.autoIncrementSnapshot
    }
    this.transaction.active = false
    this.transaction.dataSnapshot = null
    this.transaction.autoIncrementSnapshot = null
    this.transaction.mode = 'write'
  }

  isInTransaction(): boolean {
    return this.transaction.active
  }

  // ============================================================================
  // DDL OPERATIONS
  // ============================================================================

  private executeCreateTable(sql: string): ExecutionResult {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    // Parse CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const match = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s*\(([^)]+(?:\([^)]*\)[^)]*)*)\)/i
    )
    if (!match) {
      throw new SQLParseError('Invalid CREATE TABLE syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return this.emptyResult('CREATE TABLE')
      }
      throw new TableExistsError(tableName)
    }

    const columnDefs = splitColumnDefs(match[4]!)

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
          primaryKey = pkMatch[1]!.split(',')[0]!.trim().replace(/["'`]/g, '').toLowerCase()
        }
        continue
      }

      const parts = trimmed.split(/\s+/)
      const colName = parts[0]!.replace(/["'`]/g, '').toLowerCase()
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
      // Handle all auto-increment variants
      if (
        upperDef.includes('SERIAL') ||
        upperDef.includes('BIGSERIAL') ||
        upperDef.includes('AUTO_INCREMENT') ||
        upperDef.includes('AUTOINCREMENT')
      ) {
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

    return this.emptyResult('CREATE TABLE')
  }

  private executeCreateIndex(): ExecutionResult {
    // Indexes are no-op for in-memory implementation
    return this.emptyResult('CREATE INDEX')
  }

  private executeDropTable(sql: string): ExecutionResult {
    const ifExists = /IF\s+EXISTS/i.test(sql)

    const match = sql.match(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|(\w+))/i
    )
    if (!match) {
      throw new SQLParseError('Invalid DROP TABLE syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()

    if (!this.tables.has(tableName)) {
      if (ifExists) {
        return this.emptyResult('DROP TABLE')
      }
      throw new TableNotFoundError(tableName)
    }

    this.tables.delete(tableName)
    this.data.delete(tableName)
    this.autoIncrementCounters.delete(tableName)

    return this.emptyResult('DROP TABLE')
  }

  // ============================================================================
  // DML OPERATIONS
  // ============================================================================

  private executeInsert(sql: string, params: SQLValue[]): ExecutionResult {
    // Handle ON DUPLICATE KEY UPDATE (MySQL upsert)
    const onDuplicateMatch = sql.match(/(.+?)\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+)$/i)
    if (onDuplicateMatch && this.dialect.supportsOnDuplicateKey) {
      return this.executeUpsert(onDuplicateMatch[1]!, params)
    }

    // Parse INSERT INTO table [(cols)] VALUES (...), (...), ... [RETURNING ...]
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s+(.+?)(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid INSERT syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()
    const schema = this.getTableOrThrow(tableName)

    const specifiedCols = match[4]
      ? match[4].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[5]!
    const returningCols = match[6]
      ? match[6].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : null

    // Parse multiple value sets
    const valueSets = parseMultipleValueSets(valuesPart, params, this.dialect)
    const tableData = this.data.get(tableName) ?? []
    const insertedRows: StorageValue[][] = []
    let firstInsertId = 0
    let totalAffected = 0

    for (const insertValues of valueSets) {
      // Build row values map
      const values = new Map<string, StorageValue>()
      for (let i = 0; i < specifiedCols.length; i++) {
        values.set(specifiedCols[i]!, insertValues[i] ?? null)
      }

      // Handle auto-increment
      let insertId = 0
      if (schema.autoIncrement) {
        const currentCounter = this.autoIncrementCounters.get(tableName) ?? 0
        const providedValue = values.get(schema.autoIncrement)
        if (providedValue === null || providedValue === undefined) {
          insertId = currentCounter + 1
          values.set(schema.autoIncrement, insertId)
          this.autoIncrementCounters.set(tableName, insertId)
        } else {
          insertId = providedValue as number
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
            throw new UniqueConstraintError(tableName, constraint, newValue)
          }
        }
      }

      const rowid = ++this.lastRowId
      tableData.push({ rowid, values })
      totalAffected++

      // Build RETURNING row if needed
      if (returningCols) {
        const returnRow: StorageValue[] = []
        for (const col of returningCols) {
          if (col === '*') {
            returnRow.push(...schema.columns.map((c) => values.get(c) ?? null))
          } else {
            returnRow.push(values.get(col) ?? null)
          }
        }
        insertedRows.push(returnRow)
      }
    }

    // If no auto-increment, use the last rowid
    if (!firstInsertId) {
      firstInsertId = this.lastRowId
    }

    return {
      columns: returningCols?.includes('*') ? schema.columns : (returningCols ?? []),
      columnTypes: [],
      rows: insertedRows,
      affectedRows: totalAffected,
      lastInsertRowid: firstInsertId,
      changedRows: 0,
      command: 'INSERT',
    }
  }

  private executeUpsert(insertPart: string, params: SQLValue[]): ExecutionResult {
    // Parse the INSERT part
    const match = insertPart.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)/i
    )
    if (!match) {
      throw new SQLParseError('Invalid INSERT syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()
    const schema = this.getTableOrThrow(tableName)

    const specifiedCols = match[4]
      ? match[4].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : schema.columns

    const valuesPart = match[5]
    const paramIndex = { current: 0 }
    const insertValues = splitValues(valuesPart!).map((v) =>
      resolveValuePart(v, params, paramIndex, this.dialect)
    )

    // Build row values map
    const values = new Map<string, StorageValue>()
    for (let i = 0; i < specifiedCols.length; i++) {
      values.set(specifiedCols[i]!, insertValues[i] ?? null)
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
        const existingRow = tableData[existingRowIndex]!
        values.forEach((val, col) => {
          existingRow.values.set(col, val)
        })
        return {
          columns: [],
          columnTypes: [],
          rows: [],
          affectedRows: 2, // MySQL returns 2 for upsert update
          lastInsertRowid: pkValue as number,
          changedRows: 1,
          command: 'INSERT',
        }
      }
    }

    // Insert new row
    let insertId = 0
    if (schema.autoIncrement) {
      const currentCounter = this.autoIncrementCounters.get(tableName) ?? 0
      const providedValue = values.get(schema.autoIncrement)
      if (providedValue === null) {
        insertId = currentCounter + 1
        values.set(schema.autoIncrement, insertId)
        this.autoIncrementCounters.set(tableName, insertId)
      } else {
        insertId = providedValue as number
        if (insertId > currentCounter) {
          this.autoIncrementCounters.set(tableName, insertId)
        }
      }
    }

    const rowid = ++this.lastRowId
    tableData.push({ rowid, values })

    return {
      columns: [],
      columnTypes: [],
      rows: [],
      affectedRows: 1,
      lastInsertRowid: insertId || rowid,
      changedRows: 0,
      command: 'INSERT',
    }
  }

  private executeSelect(sql: string, params: SQLValue[]): ExecutionResult {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    // Handle SELECT without FROM (literals, functions)
    if (!/\bFROM\b/i.test(normalized)) {
      return this.executeSelectLiteral(normalized)
    }

    // Parse SELECT columns FROM table
    const fromMatch = normalized.match(
      /SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|`([^`]+)`|(\w+))/i
    )
    if (!fromMatch) {
      throw new SQLParseError('Invalid SELECT syntax')
    }

    const columnsPart = fromMatch[1]!
    const mainTable = (fromMatch[2] || fromMatch[3] || fromMatch[4])!.toLowerCase()

    // Extract rest of query after table name
    const sqlKeywords = 'WHERE|ORDER|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|GROUP|HAVING|UNION'
    const afterTablePattern = new RegExp(
      'FROM\\s+(?:"' + mainTable + '"|`' + mainTable + '`|' + mainTable + ')(?:\\s+(?:AS\\s+)?(?!' + sqlKeywords + '\\b)(\\w+))?(.*)$',
      'i'
    )
    const afterTableMatch = normalized.match(afterTablePattern)
    const tableAlias = afterTableMatch?.[1]?.toLowerCase()
    const restOfQuery = afterTableMatch?.[2]?.trim() ?? ''

    const schema = this.getTableOrThrow(mainTable)
    let tableData = [...(this.data.get(mainTable) ?? [])]

    // Parse selected columns
    const selectedColumns = columnsPart!.trim() === '*'
      ? [...schema.columns]
      : parseColumnList(columnsPart!)

    // Apply WHERE filter
    const whereMatch = restOfQuery.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|\s+GROUP\s+BY|\s*$)/i)
    if (whereMatch) {
      tableData = this.applyWhere(tableData, whereMatch[1]!, params)
    }

    // Apply ORDER BY
    const orderMatch = restOfQuery.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i)
    if (orderMatch) {
      tableData = this.applyOrderBy(tableData, orderMatch[1]!)
    }

    // Apply OFFSET first
    const offsetMatch = restOfQuery.match(/OFFSET\s+(\d+)/i)
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1]!, 10)
      tableData = tableData.slice(offset)
    }

    // Apply LIMIT
    const limitMatch = restOfQuery.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      tableData = tableData.slice(0, parseInt(limitMatch[1]!, 10))
    }

    // Build result rows
    const rows = tableData.map((row) =>
      selectedColumns.map((col) => {
        // Handle * expansion
        if (col === '*') {
          return null // Should not happen after parseColumnList
        }
        return row.values.get(col) ?? null
      })
    )

    return {
      columns: selectedColumns,
      columnTypes: selectedColumns.map(() => 'TEXT'),
      rows,
      affectedRows: 0,
      lastInsertRowid: 0,
      changedRows: 0,
      command: 'SELECT',
    }
  }

  private executeSelectLiteral(sql: string): ExecutionResult {
    const match = sql.match(/SELECT\s+(.+)/i)
    if (!match) {
      throw new SQLParseError('Invalid SELECT syntax')
    }

    const expr = match[1]!.trim()

    // Handle SELECT 1 as num
    const asMatch = expr.match(/(\d+)\s+as\s+(\w+)/i)
    if (asMatch) {
      return {
        columns: [asMatch[2]!],
        columnTypes: ['INTEGER'],
        rows: [[parseInt(asMatch[1]!, 10)]],
        affectedRows: 0,
        lastInsertRowid: 0,
        changedRows: 0,
        command: 'SELECT',
      }
    }

    // Handle SELECT 1
    if (/^\d+$/.test(expr)) {
      return {
        columns: ['?column?'],
        columnTypes: ['INTEGER'],
        rows: [[parseInt(expr, 10)]],
        affectedRows: 0,
        lastInsertRowid: 0,
        changedRows: 0,
        command: 'SELECT',
      }
    }

    // Handle quoted string
    if (/^'[^']*'$/.test(expr)) {
      return {
        columns: ['?column?'],
        columnTypes: ['TEXT'],
        rows: [[expr.slice(1, -1)]],
        affectedRows: 0,
        lastInsertRowid: 0,
        changedRows: 0,
        command: 'SELECT',
      }
    }

    // Handle function calls like version()
    const versionStr = this.dialect.dialect === 'postgresql'
      ? 'PostgreSQL 15.0 (dotdo compat)'
      : this.dialect.dialect === 'mysql'
        ? 'MySQL 8.0 (dotdo compat)'
        : 'SQLite 3.40 (dotdo compat)'

    return {
      columns: ['?column?'],
      columnTypes: ['TEXT'],
      rows: [[versionStr]],
      affectedRows: 0,
      lastInsertRowid: 0,
      changedRows: 0,
      command: 'SELECT',
    }
  }

  private executeUpdate(sql: string, params: SQLValue[]): ExecutionResult {
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid UPDATE syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()
    const setPart = match[4]
    const wherePart = match[5]
    const returningCols = match[6]
      ? match[6].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : null

    const schema = this.getTableOrThrow(tableName)
    const tableData = this.data.get(tableName) ?? []

    // Parse SET clause - returns assignments and count of params consumed
    const { assignments: setAssignments, paramsConsumed } = parseSetClause(setPart!, params, this.dialect)

    // Apply WHERE filter
    // For indexed params ($1, $2), pass full params array - the parser handles $N directly
    // For positional params (?), we need to slice params to skip those consumed by SET
    let toUpdate = [...tableData]
    if (wherePart) {
      const whereParams = this.dialect.parameterStyle === 'positional'
        ? params.slice(paramsConsumed)
        : params
      toUpdate = this.applyWhere(toUpdate, wherePart!, whereParams)
    }

    // Apply updates
    const updatedRows: StorageValue[][] = []
    let changedRows = 0

    for (const row of toUpdate) {
      let rowChanged = false

      for (const assignment of setAssignments) {
        const oldValue = row.values.get(assignment.column)
        let newValue: StorageValue

        if (assignment.expression) {
          const currentValue = (row.values.get(assignment.expression.sourceColumn) as number) ?? 0
          switch (assignment.expression.operator) {
            case '+':
              newValue = currentValue + assignment.expression.operand
              break
            case '-':
              newValue = currentValue - assignment.expression.operand
              break
            case '*':
              newValue = currentValue * assignment.expression.operand
              break
            case '/':
              newValue = currentValue / assignment.expression.operand
              break
          }
        } else {
          newValue = assignment.value ?? null
        }

        if (oldValue !== newValue) {
          row.values.set(assignment.column, newValue)
          rowChanged = true
        }
      }

      if (rowChanged) changedRows++

      if (returningCols) {
        const returnRow = returningCols.includes('*')
          ? schema.columns.map((c) => row.values.get(c) ?? null)
          : returningCols.map((c) => row.values.get(c) ?? null)
        updatedRows.push(returnRow)
      }
    }

    return {
      columns: returningCols?.includes('*') ? schema.columns : (returningCols ?? []),
      columnTypes: [],
      rows: updatedRows,
      affectedRows: toUpdate.length,
      lastInsertRowid: 0,
      changedRows,
      command: 'UPDATE',
    }
  }

  private executeDelete(sql: string, params: SQLValue[]): ExecutionResult {
    const match = sql.match(
      /DELETE\s+FROM\s+(?:"([^"]+)"|`([^`]+)`|(\w+))(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid DELETE syntax')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()
    const wherePart = match[4]
    const returningCols = match[5]
      ? match[5].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : null

    const schema = this.getTableOrThrow(tableName)
    const tableData = this.data.get(tableName) ?? []

    // Find rows to delete
    let toDelete = [...tableData]
    if (wherePart) {
      toDelete = this.applyWhere(toDelete, wherePart!, params)
    }

    // Build RETURNING rows before delete
    const deletedRows: StorageValue[][] = []
    if (returningCols) {
      for (const row of toDelete) {
        const returnRow = returningCols.includes('*')
          ? schema.columns.map((c) => row.values.get(c) ?? null)
          : returningCols.map((c) => row.values.get(c) ?? null)
        deletedRows.push(returnRow)
      }
    }

    // Remove deleted rows
    const toDeleteRowIds = new Set(toDelete.map((r) => r.rowid))
    this.data.set(
      tableName,
      tableData.filter((r) => !toDeleteRowIds.has(r.rowid))
    )

    return {
      columns: returningCols?.includes('*') ? schema.columns : (returningCols ?? []),
      columnTypes: [],
      rows: deletedRows,
      affectedRows: toDelete.length,
      lastInsertRowid: 0,
      changedRows: 0,
      command: 'DELETE',
    }
  }

  // ============================================================================
  // TRANSACTION OPERATIONS
  // ============================================================================

  private executeBegin(): ExecutionResult {
    this.beginTransaction()
    return this.emptyResult('BEGIN')
  }

  private executeCommit(): ExecutionResult {
    this.commitTransaction()
    return this.emptyResult('COMMIT')
  }

  private executeRollback(): ExecutionResult {
    this.rollbackTransaction()
    return this.emptyResult('ROLLBACK')
  }

  // ============================================================================
  // WHERE CLAUSE EXECUTION
  // ============================================================================

  private applyWhere(data: StoredRow[], whereClause: string, params: SQLValue[]): StoredRow[] {
    const conditions = splitWhereConditions(whereClause)
    let result = data
    const paramIndex = { current: 0 }

    for (const conditionStr of conditions) {
      const condition = parseCondition(conditionStr, params, paramIndex, this.dialect)
      if (condition) {
        result = this.applyCondition(result, condition)
      }
    }

    return result
  }

  private applyCondition(data: StoredRow[], condition: ParsedCondition): StoredRow[] {
    switch (condition.operator) {
      case 'IS NULL':
        return data.filter((row) => row.values.get(condition.column) === null)

      case 'IS NOT NULL':
        return data.filter((row) => row.values.get(condition.column) !== null)

      case '=':
        return data.filter((row) => row.values.get(condition.column) === condition.value)

      case '!=':
        return data.filter((row) => row.values.get(condition.column) !== condition.value)

      case '>':
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return val !== null && (val as number) > (condition.value as number)
        })

      case '>=':
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return val !== null && (val as number) >= (condition.value as number)
        })

      case '<':
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return val !== null && (val as number) < (condition.value as number)
        })

      case '<=':
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return val !== null && (val as number) <= (condition.value as number)
        })

      case 'LIKE':
      case 'ILIKE': {
        const pattern = String(condition.value ?? '')
        const flags = condition.operator === 'ILIKE' ? 'i' : ''
        const regex = new RegExp(
          '^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$',
          flags
        )
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return val !== null && regex.test(String(val))
        })
      }

      case 'IN':
        return data.filter((row) => {
          const val = row.values.get(condition.column)
          return condition.values?.includes(val as StorageValue) ?? false
        })

      default:
        return data
    }
  }

  // ============================================================================
  // ORDER BY EXECUTION
  // ============================================================================

  private applyOrderBy(data: StoredRow[], orderByClause: string): StoredRow[] {
    const clauses = parseOrderBy(orderByClause)

    return [...data].sort((a, b) => {
      for (const { column, descending } of clauses) {
        const aVal = a.values.get(column)
        const bVal = b.values.get(column)

        if (aVal === bVal) continue
        if (aVal === null) return descending ? -1 : 1
        if (bVal === null) return descending ? 1 : -1
        if ((aVal as number) < (bVal as number)) return descending ? 1 : -1
        if ((aVal as number) > (bVal as number)) return descending ? -1 : 1
      }
      return 0
    })
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private getTableOrThrow(tableName: string): TableSchema {
    const schema = this.tables.get(tableName)
    if (!schema) {
      throw new TableNotFoundError(tableName)
    }
    return schema
  }

  private checkWriteAllowed(): void {
    if (this.transaction.active && this.transaction.mode === 'read') {
      throw new ReadOnlyTransactionError()
    }
  }

  private emptyResult(command: SQLCommand): ExecutionResult {
    return {
      columns: [],
      columnTypes: [],
      rows: [],
      affectedRows: 0,
      lastInsertRowid: 0,
      changedRows: 0,
      command,
    }
  }
}

// ============================================================================
// EXTERNAL PARSER INTEGRATION
// ============================================================================

/**
 * External SQL parser interface for advanced parsing.
 * When configured, this parser is used for SQL validation and AST analysis
 * while the engine still handles execution with its internal parser.
 *
 * This allows using high-performance parsers like pgsql-parser for validation
 * without changing the execution behavior.
 */
export interface ExternalSQLParser {
  validate(sql: string, dialect?: string): { valid: boolean; issues: Array<{ message: string }> }
  parse?(sql: string, options?: { dialect?: string }): unknown
}

/**
 * Engine configuration options
 */
export interface SQLEngineOptions {
  /** Dialect configuration */
  dialect?: DialectConfig

  /**
   * Optional external SQL parser for validation.
   *
   * When provided, the engine will use this parser to validate SQL before
   * execution. This is useful for catching syntax errors early with a
   * more accurate parser (like pgsql-parser).
   *
   * @example
   * ```typescript
   * import { createSQLParser } from 'lib/sql'
   *
   * const parser = createSQLParser({ adapter: 'pgsql-parser' })
   * const engine = createSQLEngine({
   *   dialect: POSTGRES_DIALECT,
   *   parser,
   * })
   *
   * // SQL will be validated by pgsql-parser before execution
   * engine.execute('SELECT * FROM users')
   * ```
   */
  parser?: ExternalSQLParser

  /**
   * Whether to validate SQL before execution.
   * Default: false (for backward compatibility)
   */
  validateBeforeExecute?: boolean
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new SQL engine with the specified dialect
 *
 * @param dialectOrOptions - Dialect config or full options object
 * @returns SQL engine instance
 *
 * @example
 * ```typescript
 * // Simple usage with dialect
 * const engine = createSQLEngine(POSTGRES_DIALECT)
 *
 * // With external parser for validation
 * import { createSQLParser } from 'lib/sql'
 *
 * const parser = createSQLParser({ adapter: 'pgsql-parser' })
 * const engine = createSQLEngine({
 *   dialect: POSTGRES_DIALECT,
 *   parser,
 *   validateBeforeExecute: true,
 * })
 * ```
 */
export function createSQLEngine(dialectOrOptions?: DialectConfig | SQLEngineOptions): SQLEngine {
  // Handle both old (dialect only) and new (options object) signatures
  if (!dialectOrOptions) {
    return new InMemorySQLEngine()
  }

  // Check if it's an options object (has parser or validateBeforeExecute)
  // SQLEngineOptions has 'parser' or 'validateBeforeExecute', while DialectConfig has 'parameterStyle'
  if ('parser' in dialectOrOptions || 'validateBeforeExecute' in dialectOrOptions) {
    const options = dialectOrOptions as SQLEngineOptions
    return new InMemorySQLEngineWithParser(options)
  }

  // It's a DialectConfig (has parameterStyle which SQLEngineOptions doesn't have at root level)
  return new InMemorySQLEngine(dialectOrOptions as DialectConfig)
}

/**
 * Extended InMemorySQLEngine with optional external parser integration.
 * This class wraps the base engine to add validation capabilities.
 */
class InMemorySQLEngineWithParser implements SQLEngine {
  private baseEngine: InMemorySQLEngine
  private parser?: ExternalSQLParser
  private validateBeforeExecute: boolean

  constructor(options: SQLEngineOptions) {
    this.baseEngine = new InMemorySQLEngine(options.dialect)
    this.parser = options.parser
    this.validateBeforeExecute = options.validateBeforeExecute ?? false
  }

  getDialect(): DialectConfig {
    return this.baseEngine.getDialect()
  }

  execute(sql: string, params: SQLValue[] = []): ExecutionResult {
    // Optionally validate before execution
    if (this.validateBeforeExecute && this.parser) {
      const dialect = this.baseEngine.getDialect().dialect
      const validation = this.parser.validate(sql, dialect)

      if (!validation.valid && validation.issues.length > 0) {
        const firstIssue = validation.issues[0]!
        throw new SQLParseError(firstIssue.message || 'SQL validation failed')
      }
    }

    return this.baseEngine.execute(sql, params)
  }

  beginTransaction(mode?: TransactionMode): void {
    return this.baseEngine.beginTransaction(mode)
  }

  commitTransaction(): void {
    return this.baseEngine.commitTransaction()
  }

  rollbackTransaction(): void {
    return this.baseEngine.rollbackTransaction()
  }

  isInTransaction(): boolean {
    return this.baseEngine.isInTransaction()
  }

  /**
   * Validate SQL without executing it.
   * Requires an external parser to be configured.
   *
   * @param sql - SQL to validate
   * @returns Validation result
   */
  validate(sql: string): { valid: boolean; issues: Array<{ message: string }> } {
    if (!this.parser) {
      // Without external parser, we can only try to parse internally
      try {
        // Just detect the command - if this works, basic syntax is ok
        const translatedSql = translateDialect(sql, this.baseEngine.getDialect())
        detectCommand(translatedSql)
        return { valid: true, issues: [] }
      } catch (error) {
        return {
          valid: false,
          issues: [{ message: error instanceof Error ? error.message : String(error) }],
        }
      }
    }

    return this.parser.validate(sql, this.baseEngine.getDialect().dialect)
  }
}
