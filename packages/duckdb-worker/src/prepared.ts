/**
 * DuckDB Prepared Statements for SQL Injection Safety
 *
 * This module provides prepared statement support using DuckDB's C API.
 * Prepared statements are the primary defense against SQL injection attacks.
 *
 * @see https://duckdb.org/docs/api/c/prepared
 */

import type { DuckDBModule } from '../wasm/duckdb-worker-cf.js'
import type { QueryResult, ColumnInfo } from './types.js'

/**
 * DuckDB type enum values from C API
 * Duplicated here to avoid circular dependencies
 */
const DuckDBType = {
  INVALID: 0,
  BOOLEAN: 1,
  TINYINT: 2,
  SMALLINT: 3,
  INTEGER: 4,
  BIGINT: 5,
  UTINYINT: 6,
  USMALLINT: 7,
  UINTEGER: 8,
  UBIGINT: 9,
  FLOAT: 10,
  DOUBLE: 11,
  TIMESTAMP: 12,
  DATE: 13,
  TIME: 14,
  INTERVAL: 15,
  HUGEINT: 16,
  UHUGEINT: 32,
  VARCHAR: 17,
  BLOB: 18,
  DECIMAL: 19,
  TIMESTAMP_S: 20,
  TIMESTAMP_MS: 21,
  TIMESTAMP_NS: 22,
  ENUM: 23,
  LIST: 24,
  STRUCT: 25,
  MAP: 26,
  ARRAY: 33,
  UUID: 27,
  UNION: 28,
  BIT: 29,
  TIME_TZ: 30,
  TIMESTAMP_TZ: 31,
} as const

/**
 * Set of type codes that duckdb_value_varchar doesn't handle properly
 */
const COMPLEX_TYPES_NEEDING_CAST = new Set<number>([
  DuckDBType.LIST,
  DuckDBType.STRUCT,
  DuckDBType.MAP,
  DuckDBType.ARRAY,
  DuckDBType.UUID,
  DuckDBType.UNION,
  DuckDBType.TIME_TZ,
  DuckDBType.TIMESTAMP_TZ,
])

/**
 * Types that should be parsed as JSON after casting to VARCHAR
 */
const JSON_PARSEABLE_TYPES = new Set<number>([
  DuckDBType.LIST,
  DuckDBType.STRUCT,
  DuckDBType.MAP,
  DuckDBType.ARRAY,
])

/**
 * Map DuckDB type code to string name
 */
function typeCodeToString(code: number): string {
  const entry = Object.entries(DuckDBType).find(([, v]) => v === code)
  return entry ? entry[0] : 'UNKNOWN'
}

/**
 * Convert DuckDB's STRUCT/MAP string format to JSON
 */
function duckdbStructToJson(str: string): string {
  let inString = false
  let stringChar = ''
  const chars: string[] = []

  for (let i = 0; i < str.length; i++) {
    const char = str[i]!
    const prevChar = i > 0 ? str[i - 1] : ''

    if (!inString) {
      if (char === "'" || char === '"') {
        inString = true
        stringChar = char
        chars.push('"')
      } else {
        chars.push(char)
      }
    } else {
      if (char === stringChar && prevChar !== '\\') {
        inString = false
        chars.push('"')
      } else if (char === '"' && stringChar === "'") {
        chars.push('\\"')
      } else {
        chars.push(char)
      }
    }
  }

  return chars.join('')
}

/**
 * Convert DuckDB's MAP string format to JSON
 */
function duckdbMapToJson(str: string): string {
  return str.replace(/([{,]\s*)(\w+)\s*=/g, '$1"$2": ')
}

/**
 * Supported parameter types for prepared statements
 */
export type PreparedParamValue =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | ArrayBuffer

/**
 * PreparedStatement class wrapping DuckDB prepared statements
 *
 * Provides SQL injection-safe parameter binding for queries.
 *
 * @example
 * ```typescript
 * const stmt = await db.prepare<{ name: string }>('SELECT name FROM users WHERE id = $1')
 * try {
 *   const result = await stmt.execute([userId])
 *   console.log(result.rows[0].name)
 * } finally {
 *   await stmt.finalize()
 * }
 * ```
 */
export class PreparedStatement<T = Record<string, unknown>> {
  private stmtPtr: number | null = null
  private boundParams: PreparedParamValue[] = []
  private mod: DuckDBModule
  private connPtr: number
  private bigIntMode: 'auto' | 'string' | 'number'

  constructor(
    mod: DuckDBModule,
    connPtr: number,
    sql: string,
    bigIntMode: 'auto' | 'string' | 'number' = 'auto'
  ) {
    this.mod = mod
    this.connPtr = connPtr
    this.bigIntMode = bigIntMode

    // Prepare the statement
    const stackPtr = mod.stackSave()

    try {
      // Allocate statement pointer location
      const stmtPtrPtr = mod._malloc(4)

      // Allocate SQL string
      const queryLen = mod.lengthBytesUTF8(sql) + 1
      const queryPtr = mod.stackAlloc(queryLen)
      mod.stringToUTF8(sql, queryPtr, queryLen)

      // Prepare the statement
      const prepareResult = mod._duckdb_prepare(this.connPtr, queryPtr, stmtPtrPtr)

      if (prepareResult !== 0) {
        // Get error from the prepared statement before freeing
        const stmtPtrValue = mod.HEAP32[stmtPtrPtr / 4]!

        // Try to get error message - for prepare errors, we need to check result
        mod._duckdb_destroy_prepare(stmtPtrValue)
        mod._free(stmtPtrPtr)

        throw new Error(`Failed to prepare statement: ${sql}`)
      }

      this.stmtPtr = mod.HEAP32[stmtPtrPtr / 4]!
      mod._free(stmtPtrPtr)
    } finally {
      mod.stackRestore(stackPtr)
    }
  }

  /**
   * Bind parameters to the prepared statement
   *
   * Parameters are bound by index (1-based in SQL: $1, $2, etc.)
   *
   * @param params Array of parameter values
   */
  bind(params: PreparedParamValue[]): void {
    if (this.stmtPtr === null) {
      throw new Error('Cannot bind to finalized statement')
    }

    this.boundParams = params

    for (let i = 0; i < params.length; i++) {
      const param = params[i]
      const paramIdx = i + 1 // DuckDB uses 1-based indices

      this.bindValue(paramIdx, param)
    }
  }

  /**
   * Bind a single value at the specified index
   *
   * Note: DuckDB C API uses idx_t (64-bit) for parameter indices.
   * Without WASM_BIGINT, Emscripten "legalizes" 64-bit parameters by splitting
   * them into two 32-bit values (low and high parts).
   */
  private bindValue(idx: number, value: PreparedParamValue): void {
    if (this.stmtPtr === null) {
      throw new Error('Cannot bind to finalized statement')
    }

    // Split index into low and high 32-bit parts for 64-bit idx_t
    const idxLo = idx >>> 0
    const idxHi = 0 // Parameter indices fit in 32 bits

    let bindResult: number

    if (value === null) {
      // duckdb_bind_null(stmt, idx) - idx is legalized to (idxLo, idxHi)
      bindResult = (this.mod._duckdb_bind_null as Function)(this.stmtPtr, idxLo, idxHi)
    } else if (typeof value === 'boolean') {
      // duckdb_bind_boolean(stmt, idx, val)
      bindResult = (this.mod._duckdb_bind_boolean as Function)(
        this.stmtPtr,
        idxLo,
        idxHi,
        value ? 1 : 0
      )
    } else if (typeof value === 'number') {
      // Handle special values
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot bind non-finite number: ${value}`)
      }

      if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
        // Fits in int32
        bindResult = (this.mod._duckdb_bind_int32 as Function)(
          this.stmtPtr,
          idxLo,
          idxHi,
          value
        )
      } else {
        // Float/double (also used for large integers to avoid precision issues)
        bindResult = (this.mod._duckdb_bind_double as Function)(
          this.stmtPtr,
          idxLo,
          idxHi,
          value
        )
      }
    } else if (typeof value === 'string') {
      const stackPtr = this.mod.stackSave()
      try {
        const strLen = this.mod.lengthBytesUTF8(value) + 1
        const strPtr = this.mod.stackAlloc(strLen)
        this.mod.stringToUTF8(value, strPtr, strLen)
        bindResult = (this.mod._duckdb_bind_varchar as Function)(
          this.stmtPtr,
          idxLo,
          idxHi,
          strPtr
        )
      } finally {
        this.mod.stackRestore(stackPtr)
      }
    } else if (value instanceof Date) {
      // Convert Date to ISO string for TIMESTAMP
      const isoString = value.toISOString()
      const stackPtr = this.mod.stackSave()
      try {
        const strLen = this.mod.lengthBytesUTF8(isoString) + 1
        const strPtr = this.mod.stackAlloc(strLen)
        this.mod.stringToUTF8(isoString, strPtr, strLen)
        bindResult = (this.mod._duckdb_bind_varchar as Function)(
          this.stmtPtr,
          idxLo,
          idxHi,
          strPtr
        )
      } finally {
        this.mod.stackRestore(stackPtr)
      }
    } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      // Handle blob - bind as varchar with hex encoding for now
      // DuckDB accepts '\x...' format for blobs
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
      const hexString = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const blobStr = `\\x${hexString}`

      const stackPtr = this.mod.stackSave()
      try {
        const strLen = this.mod.lengthBytesUTF8(blobStr) + 1
        const strPtr = this.mod.stackAlloc(strLen)
        this.mod.stringToUTF8(blobStr, strPtr, strLen)
        bindResult = (this.mod._duckdb_bind_varchar as Function)(
          this.stmtPtr,
          idxLo,
          idxHi,
          strPtr
        )
      } finally {
        this.mod.stackRestore(stackPtr)
      }
    } else {
      throw new Error(`Unsupported parameter type: ${typeof value}`)
    }

    if (bindResult !== 0) {
      throw new Error(`Failed to bind parameter at index ${idx}`)
    }
  }

  /**
   * Execute the prepared statement with optional parameters
   *
   * If params are provided, they will be bound before execution.
   * If params are not provided, previously bound parameters are used.
   *
   * @param params Optional array of parameter values
   * @returns Query result with rows
   */
  async execute(params?: PreparedParamValue[]): Promise<QueryResult<T>> {
    if (this.stmtPtr === null) {
      throw new Error('Cannot execute finalized statement')
    }

    // Bind params if provided
    if (params !== undefined) {
      this.bind(params)
    }

    const stackPtr = this.mod.stackSave()

    try {
      // Allocate result struct (64 bytes should be sufficient)
      const resultPtr = this.mod.stackAlloc(64)

      // Execute prepared statement
      const execResult = this.mod._duckdb_execute_prepared(this.stmtPtr, resultPtr)

      if (execResult !== 0) {
        const errorPtr = this.mod._duckdb_result_error(resultPtr)
        const errorMsg = errorPtr ? this.mod.UTF8ToString(errorPtr) : 'Prepared statement execution failed'
        this.mod._duckdb_destroy_result(resultPtr)
        throw new Error(errorMsg)
      }

      // Extract results
      const result = this.extractResults(resultPtr)
      this.mod._duckdb_destroy_result(resultPtr)

      return result
    } finally {
      this.mod.stackRestore(stackPtr)
    }
  }

  /**
   * Extract results from a result pointer
   */
  private extractResults(resultPtr: number): QueryResult<T> {
    const mod = this.mod

    // Get column count and row count
    const columnCount = mod._duckdb_column_count(resultPtr)
    const rowCount = Number(mod._duckdb_row_count(resultPtr))

    // Build column info
    const columns: ColumnInfo[] = []
    for (let col = 0; col < columnCount; col++) {
      const namePtr = mod._duckdb_column_name(resultPtr, col)
      const name = mod.UTF8ToString(namePtr)
      const typeCode = mod._duckdb_column_type(resultPtr, col)

      columns.push({
        name,
        type: typeCodeToString(typeCode),
        typeCode,
      })
    }

    // Extract row data
    const rows: Record<string, unknown>[] = []
    for (let row = 0; row < rowCount; row++) {
      const rowData: Record<string, unknown> = {}
      const rowLo = row >>> 0
      const rowHi = 0

      for (let col = 0; col < columnCount; col++) {
        const colInfo = columns[col]!
        const colLo = col >>> 0
        const colHi = 0

        const isNull = (mod._duckdb_value_is_null as Function)(
          resultPtr,
          colLo,
          colHi,
          rowLo,
          rowHi
        )

        if (isNull) {
          rowData[colInfo.name] = null
        } else {
          rowData[colInfo.name] = this.extractValue(
            resultPtr,
            colLo,
            colHi,
            rowLo,
            rowHi,
            colInfo.typeCode
          )
        }
      }
      rows.push(rowData)
    }

    return {
      columns,
      rows: rows as T[],
      rowCount,
      success: true,
    }
  }

  /**
   * Extract a single value from the result
   */
  private extractValue(
    resultPtr: number,
    colLo: number,
    colHi: number,
    rowLo: number,
    rowHi: number,
    typeCode: number
  ): unknown {
    const mod = this.mod

    switch (typeCode) {
      case DuckDBType.BOOLEAN:
      case DuckDBType.TINYINT:
      case DuckDBType.SMALLINT:
      case DuckDBType.INTEGER:
      case DuckDBType.UTINYINT:
      case DuckDBType.USMALLINT:
      case DuckDBType.UINTEGER: {
        const valPtr = (mod._duckdb_value_varchar as Function)(
          resultPtr,
          colLo,
          colHi,
          rowLo,
          rowHi
        )
        const valStr = mod.UTF8ToString(valPtr)
        mod._free(valPtr)
        if (typeCode === DuckDBType.BOOLEAN) {
          return valStr === 'true'
        }
        return parseInt(valStr, 10)
      }

      case DuckDBType.BIGINT:
      case DuckDBType.UBIGINT:
      case DuckDBType.HUGEINT:
      case DuckDBType.UHUGEINT: {
        const valPtr = (mod._duckdb_value_varchar as Function)(
          resultPtr,
          colLo,
          colHi,
          rowLo,
          rowHi
        )
        const valStr = mod.UTF8ToString(valPtr)
        mod._free(valPtr)

        if (this.bigIntMode === 'string') {
          return valStr
        } else if (this.bigIntMode === 'number') {
          return Number(BigInt(valStr))
        } else {
          // 'auto' mode
          const bigVal = BigInt(valStr)
          if (
            bigVal >= BigInt(Number.MIN_SAFE_INTEGER) &&
            bigVal <= BigInt(Number.MAX_SAFE_INTEGER)
          ) {
            return Number(bigVal)
          }
          return valStr
        }
      }

      case DuckDBType.FLOAT:
      case DuckDBType.DOUBLE:
      case DuckDBType.DECIMAL: {
        return (mod._duckdb_value_double as Function)(
          resultPtr,
          colLo,
          colHi,
          rowLo,
          rowHi
        )
      }

      default: {
        const valPtr = (mod._duckdb_value_varchar as Function)(
          resultPtr,
          colLo,
          colHi,
          rowLo,
          rowHi
        )
        const valStr = mod.UTF8ToString(valPtr)
        mod._free(valPtr)

        if (JSON_PARSEABLE_TYPES.has(typeCode) && valStr) {
          try {
            return JSON.parse(valStr)
          } catch {
            try {
              const structJson = duckdbStructToJson(valStr)
              return JSON.parse(structJson)
            } catch {
              try {
                const mapJson = duckdbMapToJson(valStr)
                return JSON.parse(mapJson)
              } catch {
                return valStr
              }
            }
          }
        }
        return valStr
      }
    }
  }

  /**
   * Finalize (destroy) the prepared statement
   *
   * This releases resources associated with the statement.
   * After finalization, the statement cannot be used again.
   */
  async finalize(): Promise<void> {
    if (this.stmtPtr !== null) {
      this.mod._duckdb_destroy_prepare(this.stmtPtr)
      this.stmtPtr = null
    }
  }

  /**
   * Check if the statement has been finalized
   */
  isFinalized(): boolean {
    return this.stmtPtr === null
  }
}

/**
 * Execute a parameterized query using prepared statements
 *
 * This is a convenience function that creates a prepared statement,
 * executes it, and cleans up in one call.
 *
 * @param mod DuckDB WASM module
 * @param connPtr Connection pointer
 * @param sql SQL query with $1, $2, ... placeholders
 * @param params Parameter values
 * @param bigIntMode How to handle BIGINT values
 * @returns Query result
 */
export async function executeParameterized<T = Record<string, unknown>>(
  mod: DuckDBModule,
  connPtr: number,
  sql: string,
  params: PreparedParamValue[],
  bigIntMode: 'auto' | 'string' | 'number' = 'auto'
): Promise<QueryResult<T>> {
  const stmt = new PreparedStatement<T>(mod, connPtr, sql, bigIntMode)

  try {
    return await stmt.execute(params)
  } finally {
    await stmt.finalize()
  }
}

/**
 * Validate parameter count matches placeholders in SQL
 *
 * Counts $1, $2, ... placeholders and validates against params length.
 *
 * @param sql SQL query string
 * @param paramCount Number of parameters provided
 * @throws Error if mismatch detected
 */
export function validateParameterCount(sql: string, paramCount: number): void {
  // Find all $N placeholders
  const placeholderRegex = /\$(\d+)/g
  const matches = [...sql.matchAll(placeholderRegex)]

  if (matches.length === 0 && paramCount > 0) {
    throw new Error(`Query has no parameter placeholders but ${paramCount} parameters were provided`)
  }

  // Get the maximum placeholder index
  const maxIndex = matches.reduce((max, match) => {
    const idx = parseInt(match[1]!, 10)
    return Math.max(max, idx)
  }, 0)

  if (maxIndex > paramCount) {
    throw new Error(`Query uses parameter $${maxIndex} but only ${paramCount} parameters were provided`)
  }

  // Check if we have unused parameters (more params than max placeholder)
  // This is a stricter check - some queries might intentionally not use all params
  // For now, we'll just warn but not throw
  // if (paramCount > maxIndex && maxIndex > 0) {
  //   console.warn(`Query only uses up to $${maxIndex} but ${paramCount} parameters were provided`)
  // }
}
