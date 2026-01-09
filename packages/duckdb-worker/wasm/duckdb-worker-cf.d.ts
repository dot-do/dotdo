/**
 * DuckDB WASM Module for Cloudflare Workers (patched)
 * Provides Workers-compatible module loading without import.meta.url
 */

export interface DuckDBModule {
  // Memory views
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  // Runtime methods
  ccall(ident: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
  cwrap(ident: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;
  lengthBytesUTF8(str: string): number;
  stackSave(): number;
  stackRestore(ptr: number): void;
  stackAlloc(size: number): number;

  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // DuckDB C API
  _duckdb_open(path: number, outDb: number): number;
  _duckdb_open_ext(path: number, outDb: number, config: number, outError: number): number;
  _duckdb_close(db: number): void;
  _duckdb_connect(db: number, outConn: number): number;
  _duckdb_disconnect(conn: number): void;
  _duckdb_query(conn: number, query: number, outResult: number): number;
  _duckdb_destroy_result(result: number): void;
  _duckdb_column_count(result: number): number;
  _duckdb_row_count(result: number): bigint;
  _duckdb_column_name(result: number, col: number): number;
  _duckdb_column_type(result: number, col: number): number;
  _duckdb_value_varchar(result: number, col: number, row: number): number;
  _duckdb_value_int64(result: number, col: number, row: number): bigint;
  _duckdb_value_double(result: number, col: number, row: number): number;
  _duckdb_value_is_null(result: number, col: number, row: number): number;
  _duckdb_result_error(result: number): number;

  // Prepared statements
  _duckdb_prepare(conn: number, query: number, outStmt: number): number;
  _duckdb_bind_boolean(stmt: number, idx: number, val: number): number;
  _duckdb_bind_int32(stmt: number, idx: number, val: number): number;
  _duckdb_bind_int64(stmt: number, idx: number, val: bigint): number;
  _duckdb_bind_double(stmt: number, idx: number, val: number): number;
  _duckdb_bind_varchar(stmt: number, idx: number, val: number): number;
  _duckdb_bind_null(stmt: number, idx: number): number;
  _duckdb_execute_prepared(stmt: number, outResult: number): number;
  _duckdb_destroy_prepare(stmt: number): void;

  // Appender API
  _duckdb_appender_create(conn: number, schema: number, table: number, outAppender: number): number;
  _duckdb_appender_destroy(appender: number): number;
  _duckdb_append_bool(appender: number, val: number): number;
  _duckdb_append_int32(appender: number, val: number): number;
  _duckdb_append_int64(appender: number, val: bigint): number;
  _duckdb_append_double(appender: number, val: number): number;
  _duckdb_append_varchar(appender: number, val: number): number;
  _duckdb_append_null(appender: number): number;
  _duckdb_appender_end_row(appender: number): number;
  _duckdb_appender_flush(appender: number): number;
  _duckdb_appender_close(appender: number): number;
}

export interface DuckDBModuleConfig {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
  ) => void;
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
}

/**
 * Create a DuckDB module instance
 * @param config Optional configuration for the module
 * @returns Promise resolving to initialized DuckDB module
 */
export default function createDuckDB(config?: DuckDBModuleConfig): Promise<DuckDBModule>;
