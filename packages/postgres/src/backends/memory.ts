/**
 * @dotdo/postgres - In-Memory SQL Backend
 *
 * A complete in-memory SQL engine for testing and edge-native execution.
 * Provides PostgreSQL-compatible behavior using JavaScript data structures.
 *
 * Features:
 * - Full CRUD operations (SELECT, INSERT, UPDATE, DELETE)
 * - Transaction support (BEGIN, COMMIT, ROLLBACK, SAVEPOINT)
 * - Auto-increment (SERIAL) support
 * - Parameterized queries with $1, $2, ... placeholders
 * - Unique constraints and primary keys
 * - ORDER BY, LIMIT, OFFSET
 * - WHERE clause with =, >, <, >=, <=, LIKE, IN operators
 * - RETURNING clause support
 */

// ============================================================================
// TYPES
// ============================================================================

export type SQLValue = string | number | bigint | boolean | null | undefined | ArrayBuffer | Uint8Array | Date

export type StorageValue = string | number | boolean | null | Uint8Array

export interface TableSchema {
  name: string
  columns: string[]
  columnTypes: string[]
  primaryKey?: string
  uniqueConstraints: string[]
  autoIncrement?: string
}

export interface StoredRow {
  rowid: number
  values: Map<string, StorageValue>
}

export interface ExecutionResult {
  columns: string[]
  columnTypes: string[]
  rows: StorageValue[][]
  affectedRows: number
  lastInsertRowid: number
  changedRows: number
  command: string
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class SQLError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly errno?: number
  ) {
    super(message)
    this.name = 'SQLError'
  }
}

export class SQLParseError extends SQLError {
  constructor(message: string, code: string = 'PARSE_ERROR') {
    super(message, code)
    this.name = 'SQLParseError'
  }
}

export class TableNotFoundError extends SQLError {
  constructor(tableName: string, code: string = '42P01') {
    super(`Table '${tableName}' does not exist`, code)
    this.name = 'TableNotFoundError'
  }
}

export class TableExistsError extends SQLError {
  constructor(tableName: string, code: string = '42P07') {
    super(`Table '${tableName}' already exists`, code)
    this.name = 'TableExistsError'
  }
}

export class UniqueConstraintError extends SQLError {
  constructor(tableName: string, constraint: string, value: unknown, code: string = '23505') {
    super(`Duplicate key value violates unique constraint "${tableName}_${constraint}_key": ${value}`, code)
    this.name = 'UniqueConstraintError'
  }
}

// ============================================================================
// IN-MEMORY SQL ENGINE
// ============================================================================

export class InMemorySQLEngine {
  private tables = new Map<string, TableSchema>()
  private data = new Map<string, StoredRow[]>()
  private autoIncrementCounters = new Map<string, number>()
  private lastRowId = 0

  // Transaction state
  private transaction: {
    active: boolean
    dataSnapshot: Map<string, StoredRow[]> | null
    autoIncrementSnapshot: Map<string, number> | null
    savepoints: Map<string, { data: Map<string, StoredRow[]>; autoInc: Map<string, number> }>
  } = {
    active: false,
    dataSnapshot: null,
    autoIncrementSnapshot: null,
    savepoints: new Map(),
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  execute(sql: string, params: SQLValue[] = []): ExecutionResult {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    const command = this.detectCommand(normalized)

    switch (command) {
      case 'SELECT':
        return this.executeSelect(normalized, params)
      case 'INSERT':
        return this.executeInsert(normalized, params)
      case 'UPDATE':
        return this.executeUpdate(normalized, params)
      case 'DELETE':
        return this.executeDelete(normalized, params)
      case 'CREATE TABLE':
        return this.executeCreateTable(normalized)
      case 'CREATE INDEX':
        return this.emptyResult('CREATE INDEX')
      case 'DROP TABLE':
        return this.executeDropTable(normalized)
      case 'BEGIN':
        return this.executeBegin()
      case 'COMMIT':
        return this.executeCommit()
      case 'ROLLBACK':
        return this.executeRollback(normalized)
      case 'SAVEPOINT':
        return this.executeSavepoint(normalized)
      case 'RELEASE':
        return this.executeReleaseSavepoint(normalized)
      case 'SET':
      case 'SHOW':
        return this.emptyResult(command)
      default:
        throw new SQLParseError(`Unsupported SQL: ${sql}`, '42601')
    }
  }

  // ============================================================================
  // COMMAND DETECTION
  // ============================================================================

  private detectCommand(sql: string): string {
    const upper = sql.toUpperCase()
    if (upper.startsWith('SELECT')) return 'SELECT'
    if (upper.startsWith('INSERT')) return 'INSERT'
    if (upper.startsWith('UPDATE')) return 'UPDATE'
    if (upper.startsWith('DELETE')) return 'DELETE'
    if (upper.startsWith('CREATE TABLE')) return 'CREATE TABLE'
    if (upper.startsWith('CREATE INDEX')) return 'CREATE INDEX'
    if (upper.startsWith('DROP TABLE')) return 'DROP TABLE'
    if (upper.startsWith('BEGIN') || upper.startsWith('START TRANSACTION')) return 'BEGIN'
    if (upper.startsWith('COMMIT')) return 'COMMIT'
    if (upper.startsWith('ROLLBACK TO')) return 'ROLLBACK'
    if (upper.startsWith('ROLLBACK')) return 'ROLLBACK'
    if (upper.startsWith('SAVEPOINT')) return 'SAVEPOINT'
    if (upper.startsWith('RELEASE')) return 'RELEASE'
    if (upper.startsWith('SET')) return 'SET'
    if (upper.startsWith('SHOW')) return 'SHOW'
    throw new SQLParseError(`Unknown command: ${sql}`, '42601')
  }

  // ============================================================================
  // DDL OPERATIONS
  // ============================================================================

  private executeCreateTable(sql: string): ExecutionResult {
    const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(sql)

    const match = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s*\((.+)\)$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid CREATE TABLE syntax', '42601')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()

    if (this.tables.has(tableName)) {
      if (ifNotExists) {
        return this.emptyResult('CREATE TABLE')
      }
      throw new TableExistsError(tableName)
    }

    const columnDefs = this.splitColumnDefs(match[4]!)

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
      if (
        upperDef.includes('SERIAL') ||
        upperDef.includes('BIGSERIAL') ||
        upperDef.includes('SMALLSERIAL')
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

  private executeDropTable(sql: string): ExecutionResult {
    const ifExists = /IF\s+EXISTS/i.test(sql)

    const match = sql.match(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|(\w+))/i
    )
    if (!match) {
      throw new SQLParseError('Invalid DROP TABLE syntax', '42601')
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
    const match = sql.match(
      /INSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s*(?:\(([^)]+)\))?\s*VALUES\s+(.+?)(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid INSERT syntax', '42601')
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
    const valueSets = this.parseMultipleValueSets(valuesPart, params)
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

  private executeSelect(sql: string, params: SQLValue[]): ExecutionResult {
    // Handle SELECT without FROM (literals, expressions)
    if (!/\bFROM\b/i.test(sql)) {
      return this.executeSelectLiteral(sql)
    }

    const fromMatch = sql.match(
      /SELECT\s+(.+?)\s+FROM\s+(?:"([^"]+)"|`([^`]+)`|(\w+))/i
    )
    if (!fromMatch) {
      throw new SQLParseError('Invalid SELECT syntax', '42601')
    }

    const columnsPart = fromMatch[1]!
    const tableName = (fromMatch[2] || fromMatch[3] || fromMatch[4])!.toLowerCase()

    const schema = this.getTableOrThrow(tableName)
    let tableData = [...(this.data.get(tableName) ?? [])]

    // Parse selected columns
    const selectedColumns = columnsPart.trim() === '*'
      ? [...schema.columns]
      : this.parseColumnList(columnsPart)

    // Get rest of query
    const restMatch = sql.match(/FROM\s+\S+\s+(.*)/i)
    const restOfQuery = restMatch ? restMatch[1]! : ''

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
      selectedColumns.map((col) => row.values.get(col) ?? null)
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
      throw new SQLParseError('Invalid SELECT syntax', '42601')
    }

    const expr = match[1]!.trim()

    // Handle expressions like "1 + 1 as sum"
    const asMatch = expr.match(/(.+?)\s+as\s+(\w+)/i)
    if (asMatch) {
      const value = this.evaluateExpression(asMatch[1]!.trim())
      return {
        columns: [asMatch[2]!],
        columnTypes: ['INTEGER'],
        rows: [[value]],
        affectedRows: 0,
        lastInsertRowid: 0,
        changedRows: 0,
        command: 'SELECT',
      }
    }

    // Handle simple expressions
    const value = this.evaluateExpression(expr)
    return {
      columns: ['?column?'],
      columnTypes: typeof value === 'number' ? ['INTEGER'] : ['TEXT'],
      rows: [[value]],
      affectedRows: 0,
      lastInsertRowid: 0,
      changedRows: 0,
      command: 'SELECT',
    }
  }

  private evaluateExpression(expr: string): StorageValue {
    // Handle arithmetic like "1 + 1"
    const arithMatch = expr.match(/^(\d+)\s*([+\-*/])\s*(\d+)$/)
    if (arithMatch) {
      const a = parseInt(arithMatch[1]!, 10)
      const b = parseInt(arithMatch[3]!, 10)
      switch (arithMatch[2]) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
      }
    }

    // Handle simple number
    if (/^\d+$/.test(expr)) {
      return parseInt(expr, 10)
    }

    // Handle quoted string
    if (/^'[^']*'$/.test(expr)) {
      return expr.slice(1, -1)
    }

    return expr
  }

  private executeUpdate(sql: string, params: SQLValue[]): ExecutionResult {
    const match = sql.match(
      /UPDATE\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i
    )
    if (!match) {
      throw new SQLParseError('Invalid UPDATE syntax', '42601')
    }

    const tableName = (match[1] || match[2] || match[3])!.toLowerCase()
    const setPart = match[4]!
    const wherePart = match[5]
    const returningCols = match[6]
      ? match[6].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase())
      : null

    const schema = this.getTableOrThrow(tableName)
    const tableData = this.data.get(tableName) ?? []

    // Parse SET clause
    const setAssignments = this.parseSetClause(setPart, params)

    // Apply WHERE filter
    let toUpdate = [...tableData]
    if (wherePart) {
      // Count params used in SET clause for positional offset
      const setParamsUsed = setAssignments.filter((a) => a.paramIndex !== undefined).length
      const whereParams = params.slice(setParamsUsed)
      toUpdate = this.applyWhere(toUpdate, wherePart, whereParams)
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
            default:
              newValue = assignment.value ?? null
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
      throw new SQLParseError('Invalid DELETE syntax', '42601')
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
      toDelete = this.applyWhere(toDelete, wherePart, params)
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
    this.transaction.active = true
    this.transaction.savepoints.clear()

    // Snapshot current state for rollback
    this.transaction.dataSnapshot = new Map()
    this.data.forEach((rows, table) => {
      this.transaction.dataSnapshot!.set(
        table,
        rows.map((r) => ({ rowid: r.rowid, values: new Map(r.values) }))
      )
    })
    this.transaction.autoIncrementSnapshot = new Map(this.autoIncrementCounters)

    return this.emptyResult('BEGIN')
  }

  private executeCommit(): ExecutionResult {
    this.transaction.active = false
    this.transaction.dataSnapshot = null
    this.transaction.autoIncrementSnapshot = null
    this.transaction.savepoints.clear()
    return this.emptyResult('COMMIT')
  }

  private executeRollback(sql: string): ExecutionResult {
    // Check for ROLLBACK TO SAVEPOINT
    const toSavepoint = sql.match(/ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?(\w+)/i)
    if (toSavepoint) {
      const name = toSavepoint[1]!.toLowerCase()
      const savepoint = this.transaction.savepoints.get(name)
      if (savepoint) {
        this.data = savepoint.data
        this.autoIncrementCounters = savepoint.autoInc
      }
      return this.emptyResult('ROLLBACK')
    }

    // Full rollback
    if (this.transaction.dataSnapshot) {
      this.data = this.transaction.dataSnapshot
    }
    if (this.transaction.autoIncrementSnapshot) {
      this.autoIncrementCounters = this.transaction.autoIncrementSnapshot
    }
    this.transaction.active = false
    this.transaction.dataSnapshot = null
    this.transaction.autoIncrementSnapshot = null
    this.transaction.savepoints.clear()

    return this.emptyResult('ROLLBACK')
  }

  private executeSavepoint(sql: string): ExecutionResult {
    const match = sql.match(/SAVEPOINT\s+(\w+)/i)
    if (!match) {
      throw new SQLParseError('Invalid SAVEPOINT syntax', '42601')
    }

    const name = match[1]!.toLowerCase()

    // Snapshot current state
    const dataSnapshot = new Map<string, StoredRow[]>()
    this.data.forEach((rows, table) => {
      dataSnapshot.set(
        table,
        rows.map((r) => ({ rowid: r.rowid, values: new Map(r.values) }))
      )
    })

    this.transaction.savepoints.set(name, {
      data: dataSnapshot,
      autoInc: new Map(this.autoIncrementCounters),
    })

    return this.emptyResult('SAVEPOINT')
  }

  private executeReleaseSavepoint(sql: string): ExecutionResult {
    const match = sql.match(/RELEASE\s+(?:SAVEPOINT\s+)?(\w+)/i)
    if (!match) {
      throw new SQLParseError('Invalid RELEASE SAVEPOINT syntax', '42601')
    }

    const name = match[1]!.toLowerCase()
    this.transaction.savepoints.delete(name)

    return this.emptyResult('RELEASE')
  }

  // ============================================================================
  // WHERE CLAUSE PARSING
  // ============================================================================

  private applyWhere(data: StoredRow[], whereClause: string, params: SQLValue[]): StoredRow[] {
    const conditions = this.splitWhereConditions(whereClause)
    let result = data
    const paramIndex = { current: 0 }

    for (const conditionStr of conditions) {
      const condition = this.parseCondition(conditionStr, params, paramIndex)
      if (condition) {
        result = this.applyCondition(result, condition)
      }
    }

    return result
  }

  private splitWhereConditions(whereClause: string): string[] {
    // Simple split on AND (ignoring OR for now)
    return whereClause.split(/\s+AND\s+/i)
  }

  private parseCondition(
    conditionStr: string,
    params: SQLValue[],
    paramIndex: { current: number }
  ): { column: string; operator: string; value?: StorageValue; values?: StorageValue[] } | null {
    const trimmed = conditionStr.trim()

    // IS NULL / IS NOT NULL
    const nullMatch = trimmed.match(/^(\w+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i)
    if (nullMatch) {
      return {
        column: nullMatch[1]!.toLowerCase(),
        operator: nullMatch[2]!.toUpperCase().replace(/\s+/g, ' '),
      }
    }

    // IN clause
    const inMatch = trimmed.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i)
    if (inMatch) {
      const values = inMatch[2]!.split(',').map((v) => {
        const val = v.trim()
        if (/^\d+$/.test(val)) return parseInt(val, 10)
        if (/^'[^']*'$/.test(val)) return val.slice(1, -1)
        return val
      })
      return {
        column: inMatch[1]!.toLowerCase(),
        operator: 'IN',
        values: values as StorageValue[],
      }
    }

    // LIKE / ILIKE
    const likeMatch = trimmed.match(/^(\w+)\s+(I?LIKE)\s+'([^']+)'$/i)
    if (likeMatch) {
      return {
        column: likeMatch[1]!.toLowerCase(),
        operator: likeMatch[2]!.toUpperCase(),
        value: likeMatch[3]!,
      }
    }

    // Standard comparison operators
    const opMatch = trimmed.match(/^(\w+)\s*(>=|<=|!=|<>|>|<|=)\s*(.+)$/i)
    if (opMatch) {
      const column = opMatch[1]!.toLowerCase()
      let operator = opMatch[2]!
      if (operator === '<>') operator = '!='
      const valueStr = opMatch[3]!.trim()

      let value: StorageValue
      if (valueStr.startsWith('$')) {
        // Indexed parameter ($1, $2, etc.)
        const idx = parseInt(valueStr.slice(1), 10) - 1
        value = this.normalizeValue(params[idx])
      } else if (valueStr === '?') {
        // Positional parameter
        value = this.normalizeValue(params[paramIndex.current++])
      } else if (/^\d+$/.test(valueStr)) {
        value = parseInt(valueStr, 10)
      } else if (/^'[^']*'$/.test(valueStr)) {
        value = valueStr.slice(1, -1)
      } else if (valueStr.toLowerCase() === 'true') {
        value = true
      } else if (valueStr.toLowerCase() === 'false') {
        value = false
      } else if (valueStr.toLowerCase() === 'null') {
        value = null
      } else {
        value = valueStr
      }

      return { column, operator, value }
    }

    return null
  }

  private applyCondition(
    data: StoredRow[],
    condition: { column: string; operator: string; value?: StorageValue; values?: StorageValue[] }
  ): StoredRow[] {
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
  // ORDER BY PARSING
  // ============================================================================

  private applyOrderBy(data: StoredRow[], orderByClause: string): StoredRow[] {
    const clauses = this.parseOrderBy(orderByClause)

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

  private parseOrderBy(clause: string): Array<{ column: string; descending: boolean }> {
    return clause.split(',').map((part) => {
      const trimmed = part.trim()
      const descMatch = trimmed.match(/^(\w+)\s+DESC$/i)
      if (descMatch) {
        return { column: descMatch[1]!.toLowerCase(), descending: true }
      }
      const ascMatch = trimmed.match(/^(\w+)(?:\s+ASC)?$/i)
      if (ascMatch) {
        return { column: ascMatch[1]!.toLowerCase(), descending: false }
      }
      return { column: trimmed.toLowerCase(), descending: false }
    })
  }

  // ============================================================================
  // SET CLAUSE PARSING
  // ============================================================================

  private parseSetClause(
    setPart: string,
    params: SQLValue[]
  ): Array<{
    column: string
    value?: StorageValue
    paramIndex?: number
    expression?: { sourceColumn: string; operator: string; operand: number }
  }> {
    const assignments: Array<{
      column: string
      value?: StorageValue
      paramIndex?: number
      expression?: { sourceColumn: string; operator: string; operand: number }
    }> = []

    let paramCounter = 0
    const parts = setPart.split(',')

    for (const part of parts) {
      const eqMatch = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
      if (!eqMatch) continue

      const column = eqMatch[1]!.toLowerCase()
      const valueStr = eqMatch[2]!.trim()

      // Check for arithmetic expression like "column * 1.1"
      const arithMatch = valueStr.match(/^(\w+)\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/)
      if (arithMatch) {
        assignments.push({
          column,
          expression: {
            sourceColumn: arithMatch[1]!.toLowerCase(),
            operator: arithMatch[2]!,
            operand: parseFloat(arithMatch[3]!),
          },
        })
        continue
      }

      // Handle indexed parameter ($1, $2, etc.)
      if (valueStr.startsWith('$')) {
        const idx = parseInt(valueStr.slice(1), 10) - 1
        assignments.push({
          column,
          value: this.normalizeValue(params[idx]),
          paramIndex: idx,
        })
        continue
      }

      // Handle positional parameter (?)
      if (valueStr === '?') {
        assignments.push({
          column,
          value: this.normalizeValue(params[paramCounter]),
          paramIndex: paramCounter,
        })
        paramCounter++
        continue
      }

      // Handle literal values
      let value: StorageValue
      if (/^\d+$/.test(valueStr)) {
        value = parseInt(valueStr, 10)
      } else if (/^\d+\.\d+$/.test(valueStr)) {
        value = parseFloat(valueStr)
      } else if (/^'[^']*'$/.test(valueStr)) {
        value = valueStr.slice(1, -1)
      } else if (valueStr.toLowerCase() === 'true') {
        value = true
      } else if (valueStr.toLowerCase() === 'false') {
        value = false
      } else if (valueStr.toLowerCase() === 'null') {
        value = null
      } else {
        value = valueStr
      }

      assignments.push({ column, value })
    }

    return assignments
  }

  // ============================================================================
  // VALUE PARSING HELPERS
  // ============================================================================

  private parseMultipleValueSets(valuesPart: string, params: SQLValue[]): StorageValue[][] {
    const sets: StorageValue[][] = []
    const paramIndex = { current: 0 }

    // Match each (...) value set
    const regex = /\(([^)]+)\)/g
    let match
    while ((match = regex.exec(valuesPart)) !== null) {
      const values = this.splitValues(match[1]!).map((v) =>
        this.resolveValuePart(v, params, paramIndex)
      )
      sets.push(values)
    }

    return sets
  }

  private splitValues(valuesPart: string): string[] {
    const values: string[] = []
    let current = ''
    let inQuote = false
    let parenDepth = 0

    for (const char of valuesPart) {
      if (char === "'" && parenDepth === 0) {
        inQuote = !inQuote
        current += char
      } else if (char === '(' && !inQuote) {
        parenDepth++
        current += char
      } else if (char === ')' && !inQuote) {
        parenDepth--
        current += char
      } else if (char === ',' && !inQuote && parenDepth === 0) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }

    if (current.trim()) {
      values.push(current.trim())
    }

    return values
  }

  private resolveValuePart(
    valuePart: string,
    params: SQLValue[],
    paramIndex: { current: number }
  ): StorageValue {
    const trimmed = valuePart.trim()

    // Indexed parameter ($1, $2, etc.)
    if (trimmed.startsWith('$')) {
      const idx = parseInt(trimmed.slice(1), 10) - 1
      return this.normalizeValue(params[idx])
    }

    // Positional parameter (?)
    if (trimmed === '?') {
      return this.normalizeValue(params[paramIndex.current++])
    }

    return this.parseValueToken(trimmed)
  }

  private parseValueToken(token: string): StorageValue {
    if (token.toLowerCase() === 'null') return null
    if (token.toLowerCase() === 'true') return true
    if (token.toLowerCase() === 'false') return false
    if (/^-?\d+$/.test(token)) return parseInt(token, 10)
    if (/^-?\d+\.\d+$/.test(token)) return parseFloat(token)
    if (/^'[^']*'$/.test(token)) return token.slice(1, -1)
    return token
  }

  private normalizeValue(value: SQLValue): StorageValue {
    if (value === undefined) return null
    if (value === null) return null
    if (typeof value === 'bigint') return Number(value)
    if (value instanceof Date) return value.toISOString()
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    return value as StorageValue
  }

  private splitColumnDefs(columnsPart: string): string[] {
    const defs: string[] = []
    let current = ''
    let parenDepth = 0

    for (const char of columnsPart) {
      if (char === '(') {
        parenDepth++
        current += char
      } else if (char === ')') {
        parenDepth--
        current += char
      } else if (char === ',' && parenDepth === 0) {
        defs.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }

    if (current.trim()) {
      defs.push(current.trim())
    }

    return defs
  }

  private parseColumnList(columnsPart: string): string[] {
    return columnsPart.split(',').map((col) => {
      const trimmed = col.trim()
      // Handle "column AS alias" - use the alias
      const asMatch = trimmed.match(/^.+?\s+AS\s+(\w+)$/i)
      if (asMatch) {
        return asMatch[1]!.toLowerCase()
      }
      // Handle column name extraction (remove table prefix if any)
      const dotMatch = trimmed.match(/\.(\w+)$/)
      if (dotMatch) {
        return dotMatch[1]!.toLowerCase()
      }
      return trimmed.replace(/["'`]/g, '').toLowerCase()
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

  private emptyResult(command: string): ExecutionResult {
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
// FACTORY
// ============================================================================

export function createInMemoryEngine(): InMemorySQLEngine {
  return new InMemorySQLEngine()
}
