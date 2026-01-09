/**
 * DuckDB WASM Bindings for Cloudflare Workers
 *
 * This module provides Workers-compatible bindings to our custom DuckDB WASM build.
 * The WASM is built with Emscripten flags that eliminate GOT imports for Workers compatibility.
 */

import type { DuckDBInstance, DuckDBConfig, QueryResult, ColumnInfo } from './types.js'
import type { DuckDBModule, DuckDBModuleConfig } from '../wasm/duckdb-worker-cf.js'

// Use Cloudflare-compatible loader (patched to not use import.meta.url)
import createDuckDBLoader from '../wasm/duckdb-worker-cf.js'
import { FileBufferRegistry } from './runtime.js'

// ============================================================================
// Types for Emscripten Module Interface
// ============================================================================

/**
 * Extended DuckDB module interface
 * Note: FILESYSTEM is disabled in Workers build (-sFILESYSTEM=0)
 * All file operations go through runtime.ts in-memory buffers
 */
interface EmscriptenModule extends DuckDBModule {
  // Note: No FS interface - disabled in Workers build
}

/**
 * DuckDB type enum values from C API
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
 * These types return empty strings and need special handling via SQL casting
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
 * DuckDB uses single quotes: {'key': value}
 * JSON requires double quotes: {"key": value}
 *
 * This is a best-effort conversion that handles common cases.
 * For complex nested structures with strings containing quotes, it may fail
 * and fall back to returning the original string.
 */
function duckdbStructToJson(str: string): string {
  // DuckDB STRUCT format: {'key': value, 'key2': 'string value'}
  // Need to convert single-quoted keys to double-quoted
  // and single-quoted string values to double-quoted

  // State machine approach for proper quote handling
  let inString = false
  let stringChar = ''
  const chars: string[] = []

  for (let i = 0; i < str.length; i++) {
    const char = str[i]!
    const prevChar = i > 0 ? str[i - 1] : ''

    if (!inString) {
      if (char === "'" || char === '"') {
        // Starting a string
        inString = true
        stringChar = char
        // Convert single quote to double quote
        chars.push('"')
      } else {
        chars.push(char)
      }
    } else {
      // Inside a string
      if (char === stringChar && prevChar !== '\\') {
        // Ending the string
        inString = false
        chars.push('"')
      } else if (char === '"' && stringChar === "'") {
        // Escape double quotes inside single-quoted strings
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
 * DuckDB MAP format: {key1=value1, key2=value2}
 * JSON format: {"key1": value1, "key2": value2}
 *
 * This handles simple key-value pairs with unquoted keys.
 */
function duckdbMapToJson(str: string): string {
  // DuckDB MAP format: {key1=1, key2=2}
  // Need to: add quotes around keys, replace = with :

  // Simple regex replacement for basic cases
  // Match patterns like: key= at the start or after { or ,
  return str.replace(/([{,]\s*)(\w+)\s*=/g, '$1"$2": ')
}

// ============================================================================
// Global Module Cache
// ============================================================================

/**
 * Cached WASM module instance.
 * The WASM module itself can be safely shared - it's stateless.
 * Each DuckDB instance gets its own database and connection pointers.
 */
let cachedWasmModule: EmscriptenModule | null = null

// ============================================================================
// WASM Loading - Using Emscripten Loader
// ============================================================================

/**
 * Type for Emscripten module factory function
 * Generated by our custom build with -sMODULARIZE=1 -sEXPORT_NAME='createDuckDB'
 */
type CreateDuckDBFn = (config?: DuckDBModuleConfig) => Promise<EmscriptenModule>

/**
 * Global reference to the Emscripten loader function
 * This is set by loadDuckDBModule when the JS glue code is loaded
 */
let createDuckDBFn: CreateDuckDBFn | null = null

/**
 * Options for loading DuckDB WASM module
 */
export interface LoadDuckDBOptions {
  /**
   * Pre-loaded WASM binary (ArrayBuffer)
   * Use this when you've fetched the WASM from a URL or R2
   */
  wasmBinary?: ArrayBuffer

  /**
   * Pre-compiled WebAssembly.Module
   * Use this in Workers with ES module WASM imports
   * @example
   * import duckdbWasm from './duckdb-worker.wasm'
   * const db = await createDuckDB({}, { wasmModule: duckdbWasm })
   */
  wasmModule?: WebAssembly.Module

  /**
   * Pre-loaded Emscripten loader module
   * Use this if the loader is already imported
   */
  loaderModule?: { default: CreateDuckDBFn }

  /**
   * Use dynamic import to load the standard (non-CF) loader
   * This provides a fallback for non-Workers environments
   * @default false
   */
  useDynamicLoader?: boolean
}

/**
 * Load DuckDB WASM module using Emscripten loader
 *
 * This function loads the custom WASM build via the Emscripten-generated JS loader.
 * The loader handles all the complex imports and initialization.
 *
 * @param options Optional loading options (wasmBinary, wasmModule, loaderModule)
 */
export async function loadDuckDBModule(
  options?: ArrayBuffer | LoadDuckDBOptions
): Promise<EmscriptenModule> {
  if (cachedWasmModule) {
    return cachedWasmModule
  }

  // Handle legacy signature: loadDuckDBModule(wasmBinary)
  const opts: LoadDuckDBOptions =
    options instanceof ArrayBuffer ? { wasmBinary: options } : (options ?? {})

  // Get the createDuckDB function from loader module or pre-imported loader
  if (opts.loaderModule?.default) {
    createDuckDBFn = opts.loaderModule.default
  } else if (opts.useDynamicLoader) {
    // Dynamic import fallback for non-Workers environments
    // This allows using the standard loader with import.meta.url support
    try {
      const dynamicLoader = await import('../wasm/duckdb-worker.js')
      createDuckDBFn = dynamicLoader.default
    } catch {
      // Fall back to CF-compatible loader if dynamic import fails
      createDuckDBFn = createDuckDBLoader
    }
  } else if (!createDuckDBFn) {
    // Use the statically imported CF-compatible loader
    // This avoids dynamic import issues in Workers
    createDuckDBFn = createDuckDBLoader
  }

  if (!createDuckDBFn) {
    throw new Error('DuckDB WASM loader not available')
  }

  // Configure the module
  const moduleConfig: DuckDBModuleConfig = {}

  // Priority 1: Use pre-compiled WebAssembly.Module (most efficient for Workers)
  if (opts.wasmModule) {
    moduleConfig.instantiateWasm = (imports, receiveInstance) => {
      WebAssembly.instantiate(opts.wasmModule!, imports).then((instance) => {
        receiveInstance(instance, opts.wasmModule!)
      })
      // Return empty object to signal async instantiation
      return {}
    }
  }
  // Priority 2: Use pre-loaded WASM binary
  else if (opts.wasmBinary) {
    moduleConfig.wasmBinary = opts.wasmBinary
  }
  // Priority 3: Let Emscripten loader fetch the WASM
  else {
    moduleConfig.locateFile = (path: string) => {
      // Return the path as-is - Workers bundler should resolve it
      return path
    }
  }

  try {
    // Initialize the Emscripten module
    cachedWasmModule = await createDuckDBFn(moduleConfig)
    return cachedWasmModule
  } catch (err) {
    throw new Error(
      `Failed to initialize DuckDB WASM: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Check if module is cached
 */
export function isModuleCached(): boolean {
  return cachedWasmModule !== null
}

/**
 * Clear module cache
 */
export function clearModuleCache(): void {
  cachedWasmModule = null
}

// ============================================================================
// Instance Creation
// ============================================================================

/**
 * Create a DuckDB instance from loaded module
 *
 * Each instance has its own database and connection, isolated from others.
 * This enables safe concurrent use in Workers.
 */
export function createInstanceFromModule(
  mod: EmscriptenModule,
  config?: DuckDBConfig
): DuckDBInstance {
  // Allocate pointers for database and connection handles
  const dbPtrPtr = mod._malloc(4)
  const connPtrPtr = mod._malloc(4)

  // Open in-memory database
  const pathPtr = mod._malloc(9)
  mod.stringToUTF8(':memory:', pathPtr, 9)

  const openResult = mod._duckdb_open(pathPtr, dbPtrPtr)
  mod._free(pathPtr)

  if (openResult !== 0) {
    mod._free(dbPtrPtr)
    mod._free(connPtrPtr)
    throw new Error('Failed to open DuckDB database')
  }

  // Instance-scoped state (NOT global)
  const instanceDbPtr = mod.HEAP32[dbPtrPtr / 4]!
  mod._free(dbPtrPtr)

  // Connect to database
  const connectResult = mod._duckdb_connect(instanceDbPtr, connPtrPtr)
  if (connectResult !== 0) {
    mod._duckdb_close(instanceDbPtr)
    mod._free(connPtrPtr)
    throw new Error('Failed to connect to DuckDB database')
  }

  const instanceConnPtr = mod.HEAP32[connPtrPtr / 4]!
  mod._free(connPtrPtr)

  // Track if instance is closed
  let isClosed = false

  // Instance-scoped file buffer registry (NOT global)
  const fileRegistry = new FileBufferRegistry()

  // BigInt handling mode for JSON serialization
  const bigIntMode = config?.bigIntMode ?? 'auto'

  // Array to store config application warnings/errors
  const configWarnings: string[] = []

  // Apply configuration via PRAGMA statements
  const applyConfig = async () => {
    const pragmaConfigs: Array<{ pragma: string; configKey: string }> = []

    if (config?.maxMemory !== undefined) {
      pragmaConfigs.push({
        pragma: `SET memory_limit='${config.maxMemory}'`,
        configKey: 'maxMemory',
      })
    }
    if (config?.threads !== undefined) {
      pragmaConfigs.push({
        pragma: `SET threads=${config.threads}`,
        configKey: 'threads',
      })
    }
    if (config?.accessMode !== undefined) {
      pragmaConfigs.push({
        pragma: `SET access_mode='${config.accessMode}'`,
        configKey: 'accessMode',
      })
    }
    if (config?.defaultOrder !== undefined) {
      pragmaConfigs.push({
        pragma: `SET default_order='${config.defaultOrder}'`,
        configKey: 'defaultOrder',
      })
    }

    // Execute each PRAGMA and capture errors
    for (const { pragma, configKey } of pragmaConfigs) {
      try {
        await executeQuery(pragma)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        configWarnings.push(`Failed to apply ${configKey}: ${errorMessage}`)
      }
    }
  }

  /**
   * Low-level query execution (internal helper)
   * Returns raw results without complex type handling
   */
  const executeQueryRaw = async (
    sql: string,
    originalColumns?: ColumnInfo[]
  ): Promise<QueryResult> => {
    if (isClosed) {
      throw new Error('Database instance is closed')
    }

    const stackPtr = mod.stackSave()

    try {
      // Allocate query string
      const queryLen = mod.lengthBytesUTF8(sql) + 1
      const queryPtr = mod.stackAlloc(queryLen)
      mod.stringToUTF8(sql, queryPtr, queryLen)

      // Allocate result struct (64 bytes should be sufficient)
      const resultPtr = mod.stackAlloc(64)

      // Execute query
      const queryResult = mod._duckdb_query(instanceConnPtr, queryPtr, resultPtr)

      if (queryResult !== 0) {
        const errorPtr = mod._duckdb_result_error(resultPtr)
        const errorMsg = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed'
        mod._duckdb_destroy_result(resultPtr)
        throw new Error(errorMsg)
      }

      // Get column count and row count
      const columnCount = mod._duckdb_column_count(resultPtr)
      const rowCount = Number(mod._duckdb_row_count(resultPtr))

      // Build column info (use original columns if provided, for type preservation)
      const columns: ColumnInfo[] = []
      for (let col = 0; col < columnCount; col++) {
        const namePtr = mod._duckdb_column_name(resultPtr, col)
        const name = mod.UTF8ToString(namePtr)
        const typeCode = mod._duckdb_column_type(resultPtr, col)

        // Use original column type if available (for re-queries with casts)
        const origCol = originalColumns?.[col]
        if (origCol) {
          columns.push({
            name,
            type: origCol.type,
            typeCode: origCol.typeCode,
          })
        } else {
          columns.push({
            name,
            type: typeCodeToString(typeCode),
            typeCode,
          })
        }
      }

      // Extract row data
      // Note: DuckDB C API uses idx_t (64-bit) for column and row indices.
      // Without WASM_BIGINT, Emscripten "legalizes" 64-bit parameters by splitting
      // them into two 32-bit values (low and high parts). We need to pass both parts.
      const rows: Record<string, unknown>[] = []
      for (let row = 0; row < rowCount; row++) {
        const rowData: Record<string, unknown> = {}
        // Split row index into low and high 32-bit parts for 64-bit idx_t
        const rowLo = row >>> 0
        const rowHi = 0 // row indices fit in 32 bits

        for (let col = 0; col < columnCount; col++) {
          const colInfo = columns[col]!
          // Split col index into low and high 32-bit parts for 64-bit idx_t
          const colLo = col >>> 0
          const colHi = 0 // column indices fit in 32 bits

          // Call with 5 params: resultPtr, colLo, colHi, rowLo, rowHi
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
            // Extract value based on type
            switch (colInfo.typeCode) {
              case DuckDBType.BOOLEAN:
              case DuckDBType.TINYINT:
              case DuckDBType.SMALLINT:
              case DuckDBType.INTEGER:
              case DuckDBType.UTINYINT:
              case DuckDBType.USMALLINT:
              case DuckDBType.UINTEGER: {
                // Get as varchar and parse (5 params for legalized idx_t)
                const valPtr = (mod._duckdb_value_varchar as Function)(
                  resultPtr,
                  colLo,
                  colHi,
                  rowLo,
                  rowHi
                )
                const valStr = mod.UTF8ToString(valPtr)
                mod._free(valPtr)
                if (colInfo.typeCode === DuckDBType.BOOLEAN) {
                  rowData[colInfo.name] = valStr === 'true'
                } else {
                  rowData[colInfo.name] = parseInt(valStr, 10)
                }
                break
              }
              case DuckDBType.BIGINT:
              case DuckDBType.UBIGINT:
              case DuckDBType.HUGEINT:
              case DuckDBType.UHUGEINT: {
                // Get value as string first (5 params for legalized idx_t)
                const valPtr = (mod._duckdb_value_varchar as Function)(
                  resultPtr,
                  colLo,
                  colHi,
                  rowLo,
                  rowHi
                )
                const valStr = mod.UTF8ToString(valPtr)
                mod._free(valPtr)

                // Convert to JSON-safe format based on bigIntMode config:
                // - 'auto': number if safe, string otherwise (default)
                // - 'string': always string for full precision
                // - 'number': always number (may lose precision)
                if (bigIntMode === 'string') {
                  rowData[colInfo.name] = valStr
                } else if (bigIntMode === 'number') {
                  rowData[colInfo.name] = Number(BigInt(valStr))
                } else {
                  // 'auto' mode: check if value is within safe integer range
                  const bigVal = BigInt(valStr)
                  if (
                    bigVal >= BigInt(Number.MIN_SAFE_INTEGER) &&
                    bigVal <= BigInt(Number.MAX_SAFE_INTEGER)
                  ) {
                    rowData[colInfo.name] = Number(bigVal)
                  } else {
                    // Return as string to preserve full precision
                    rowData[colInfo.name] = valStr
                  }
                }
                break
              }
              case DuckDBType.FLOAT:
              case DuckDBType.DOUBLE:
              case DuckDBType.DECIMAL: {
                // 5 params for legalized idx_t
                const val = (mod._duckdb_value_double as Function)(
                  resultPtr,
                  colLo,
                  colHi,
                  rowLo,
                  rowHi
                )
                rowData[colInfo.name] = val
                break
              }
              default: {
                // Default to varchar for everything else (5 params for legalized idx_t)
                const valPtr = (mod._duckdb_value_varchar as Function)(
                  resultPtr,
                  colLo,
                  colHi,
                  rowLo,
                  rowHi
                )
                const valStr = mod.UTF8ToString(valPtr)
                mod._free(valPtr)

                // For JSON-parseable types, parse the string as JSON
                if (JSON_PARSEABLE_TYPES.has(colInfo.typeCode) && valStr) {
                  try {
                    // Try parsing as JSON first (works for LIST/ARRAY)
                    rowData[colInfo.name] = JSON.parse(valStr)
                  } catch {
                    // For STRUCT, DuckDB uses single quotes - convert to JSON format
                    // For MAP, DuckDB uses key=value format - convert to JSON format
                    try {
                      // Try STRUCT format first (single quotes)
                      const structJson = duckdbStructToJson(valStr)
                      rowData[colInfo.name] = JSON.parse(structJson)
                    } catch {
                      try {
                        // Try MAP format (key=value)
                        const mapJson = duckdbMapToJson(valStr)
                        rowData[colInfo.name] = JSON.parse(mapJson)
                      } catch {
                        // If all parsing fails, return as string
                        rowData[colInfo.name] = valStr
                      }
                    }
                  }
                } else {
                  rowData[colInfo.name] = valStr
                }
              }
            }
          }
        }
        rows.push(rowData)
      }

      // Clean up result
      mod._duckdb_destroy_result(resultPtr)

      return {
        columns,
        rows,
        rowCount,
        success: true,
      }
    } finally {
      mod.stackRestore(stackPtr)
    }
  }

  /**
   * Execute a query with automatic handling of complex types
   * If complex types are detected, the query is wrapped to cast them to VARCHAR
   */
  const executeQuery = async (sql: string): Promise<QueryResult> => {
    // First, try to get column metadata by wrapping query in a CTE with LIMIT 0
    // This is more reliable than DESCRIBE for complex queries
    const metadataQuery = `WITH __cte AS (${sql}) SELECT * FROM __cte LIMIT 0`

    let columns: ColumnInfo[]
    try {
      const metadataResult = await executeQueryRaw(metadataQuery)
      columns = metadataResult.columns
    } catch {
      // If metadata query fails (e.g., for DDL statements), just execute directly
      return executeQueryRaw(sql)
    }

    // Check if any columns need casting
    const complexColumns = columns.filter((col) =>
      COMPLEX_TYPES_NEEDING_CAST.has(col.typeCode)
    )

    if (complexColumns.length === 0) {
      // No complex types, execute normally
      return executeQueryRaw(sql)
    }

    // Build a wrapped query that casts complex columns to VARCHAR
    // We use a CTE to avoid modifying the original query structure
    const selectParts = columns.map((col) => {
      // Escape column name for SQL
      const escapedName = `"${col.name.replace(/"/g, '""')}"`

      if (COMPLEX_TYPES_NEEDING_CAST.has(col.typeCode)) {
        // For complex types, cast to VARCHAR
        // DuckDB's CAST produces JSON-compatible output for LIST/STRUCT/MAP/ARRAY
        // Note: TO_JSON is not available in minimal WASM builds, so we use CAST
        return `CAST(${escapedName} AS VARCHAR) AS ${escapedName}`
      } else {
        return escapedName
      }
    })

    const wrappedQuery = `WITH __original AS (${sql}) SELECT ${selectParts.join(', ')} FROM __original`

    // Execute the wrapped query with original column types preserved
    return executeQueryRaw(wrappedQuery, columns)
  }

  // Create the instance object
  const instance: DuckDBInstance = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ): Promise<QueryResult<T>> {
      if (params !== undefined && params.length > 0) {
        throw new Error(
          'Parameterized queries are not yet supported. Use string interpolation with proper escaping.'
        )
      }
      return executeQuery(sql) as Promise<QueryResult<T>>
    },

    async exec(sql: string, params?: unknown[]): Promise<void> {
      if (params !== undefined && params.length > 0) {
        throw new Error(
          'Parameterized queries are not yet supported. Use string interpolation with proper escaping.'
        )
      }
      await executeQuery(sql)
    },

    registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void {
      if (isClosed) {
        throw new Error('Cannot register buffer on closed database')
      }
      // All file operations go through instance-scoped registry
      // FILESYSTEM is disabled in Workers build (-sFILESYSTEM=0)
      fileRegistry.register(name, buffer)
    },

    dropFile(name: string): boolean {
      if (isClosed) {
        return false
      }
      // All file operations go through instance-scoped registry
      return fileRegistry.drop(name)
    },

    getFileBuffer(name: string): Uint8Array | undefined {
      return fileRegistry.get(name)
    },

    hasFile(name: string): boolean {
      return fileRegistry.has(name)
    },

    listFiles(): string[] {
      return fileRegistry.list()
    },

    async close(): Promise<void> {
      if (isClosed) return

      isClosed = true
      // Only clear this instance's files - NOT global
      fileRegistry.clear()

      // Disconnect and close
      mod._duckdb_disconnect(instanceConnPtr)
      mod._duckdb_close(instanceDbPtr)
    },

    isOpen(): boolean {
      return !isClosed
    },

    configWarnings,
  }

  // Apply config if provided (errors are captured in configWarnings array)
  if (config) {
    applyConfig().catch(() => {
      // Unexpected error in applyConfig itself (not individual pragmas)
      // Individual pragma errors are already captured in configWarnings
    })
  }

  return instance
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Create a new DuckDB instance
 *
 * This is the main entry point for using DuckDB in Workers.
 *
 * @param loadOptions Optional WASM loading options
 * @param config Optional DuckDB configuration
 */
export async function createDuckDB(
  loadOptions?: ArrayBuffer | LoadDuckDBOptions,
  config?: DuckDBConfig
): Promise<DuckDBInstance> {
  const mod = await loadDuckDBModule(loadOptions)
  return createInstanceFromModule(mod, config)
}
