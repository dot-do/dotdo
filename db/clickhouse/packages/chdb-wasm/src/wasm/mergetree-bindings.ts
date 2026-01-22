/**
 * MergeTree WASM Bindings
 *
 * TypeScript bindings for the C API exposed by mergetree_bindings.cpp.
 * This module provides a type-safe interface to the WASM module's exported functions.
 *
 * The bindings handle:
 * - String marshalling between JS and WASM memory
 * - 64-bit integer handling (JavaScript doesn't natively support i64)
 * - Error propagation from C to TypeScript
 * - Memory management (allocation/deallocation)
 *
 * C API (from mergetree_bindings.cpp):
 *   - mergetree_reader_create(db, table, partition, part_name) -> handle
 *   - mergetree_reader_destroy(handle)
 *   - mergetree_reader_get_row_count(handle) -> int64
 *   - mergetree_reader_get_column_count(handle) -> int32
 *   - mergetree_reader_get_mark_count(handle) -> int64
 *   - mergetree_reader_get_column_name(handle, index) -> stores in result buffer
 *   - mergetree_reader_get_column_type(handle, index) -> stores in result buffer
 *   - mergetree_reader_read_marks(handle, column_name) -> mark count
 *   - mergetree_reader_read_column_raw(handle, column, start, end) -> bytes
 *   - mergetree_get_result() -> pointer to result buffer
 *   - mergetree_get_result_len() -> length of result buffer
 *   - mergetree_get_error() -> error message pointer
 *   - mergetree_version() -> version string
 *   - mergetree_test() -> self-test result
 */

import type { MergeTreeModule } from './mergetree-loader';

// ---------------------------------------------------------------------------
// Error Codes (matching mergetree_bindings.cpp)
// ---------------------------------------------------------------------------

/** Invalid parameter passed to function */
export const MERGETREE_ERR_INVALID_PARAM = -1;

/** Reader creation failed (e.g., part not found) */
export const MERGETREE_ERR_CREATE_FAILED = -2;

/** Column not found */
export const MERGETREE_ERR_COLUMN_NOT_FOUND = -3;

/** I/O error during VFS operation */
export const MERGETREE_ERR_IO = -5;

/** Invalid handle */
export const MERGETREE_ERR_BAD_HANDLE = -9;

// ---------------------------------------------------------------------------
// Memory Helpers
// ---------------------------------------------------------------------------

/**
 * Allocate a null-terminated string in WASM memory
 */
export function allocString(module: MergeTreeModule, str: string): number {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const ptr = module._malloc(bytes.length + 1);
  if (ptr === 0) {
    throw new Error('Failed to allocate memory for string');
  }
  module.HEAPU8.set(bytes, ptr);
  module.HEAPU8[ptr + bytes.length] = 0; // Null terminator
  return ptr;
}

/**
 * Free a pointer allocated by allocString
 */
export function freeString(module: MergeTreeModule, ptr: number): void {
  if (ptr !== 0) {
    module._free(ptr);
  }
}

/**
 * Read a null-terminated string from WASM memory
 */
export function readString(module: MergeTreeModule, ptr: number): string {
  if (ptr === 0) {
    return '';
  }
  return module.UTF8ToString(ptr);
}

/**
 * Read bytes from the result buffer
 */
export function readResultBytes(module: MergeTreeModule, length: number): Uint8Array {
  const resultPtr = module._mergetree_get_result();
  if (resultPtr === 0 || length <= 0) {
    return new Uint8Array(0);
  }
  // Create a copy of the data (not a view, since WASM memory might change)
  return new Uint8Array(module.HEAPU8.buffer.slice(resultPtr, resultPtr + length));
}

/**
 * Read the result buffer as a string
 */
export function readResultString(module: MergeTreeModule): string {
  const resultPtr = module._mergetree_get_result();
  return readString(module, resultPtr);
}

// ---------------------------------------------------------------------------
// Low-Level Bindings
// ---------------------------------------------------------------------------

/**
 * Low-level bindings that directly wrap the C API with type safety.
 * These handle memory management but don't provide higher-level abstractions.
 */
export class MergeTreeBindings {
  private module: MergeTreeModule;

  constructor(module: MergeTreeModule) {
    this.module = module;
  }

  /**
   * Get the module version string
   */
  version(): string {
    const ptr = this.module._mergetree_version();
    return readString(this.module, ptr);
  }

  /**
   * Run self-test
   * @returns 0 on success, error code on failure
   */
  test(): number {
    return this.module._mergetree_test();
  }

  /**
   * Get the last error message
   */
  getError(): string {
    const ptr = this.module._mergetree_get_error();
    return readString(this.module, ptr);
  }

  /**
   * Create a part reader
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Partition value
   * @param partName - Part directory name
   * @returns Handle (>0) on success, error code (<0) on failure
   */
  readerCreate(
    database: string,
    table: string,
    partition: string,
    partName: string
  ): number {
    const dbPtr = allocString(this.module, database);
    const tablePtr = allocString(this.module, table);
    const partitionPtr = allocString(this.module, partition);
    const partNamePtr = allocString(this.module, partName);

    try {
      return this.module._mergetree_reader_create(
        dbPtr,
        tablePtr,
        partitionPtr,
        partNamePtr
      );
    } finally {
      freeString(this.module, dbPtr);
      freeString(this.module, tablePtr);
      freeString(this.module, partitionPtr);
      freeString(this.module, partNamePtr);
    }
  }

  /**
   * Destroy a part reader
   */
  readerDestroy(handle: number): void {
    this.module._mergetree_reader_destroy(handle);
  }

  /**
   * Get row count in part
   * @returns Row count or -1 on error
   */
  readerGetRowCount(handle: number): bigint {
    const result = this.module._mergetree_reader_get_row_count(handle);
    return BigInt(result);
  }

  /**
   * Get column count in part
   * @returns Column count or -1 on error
   */
  readerGetColumnCount(handle: number): number {
    return this.module._mergetree_reader_get_column_count(handle);
  }

  /**
   * Get mark count in part
   * @returns Mark count or -1 on error
   */
  readerGetMarkCount(handle: number): bigint {
    const result = this.module._mergetree_reader_get_mark_count(handle);
    return BigInt(result);
  }

  /**
   * Get column name by index
   * @returns Column name or empty string on error
   */
  readerGetColumnName(handle: number, index: number): string {
    const len = this.module._mergetree_reader_get_column_name(handle, index);
    if (len < 0) {
      return '';
    }
    return readResultString(this.module);
  }

  /**
   * Get column type by index
   * @returns Column type name or empty string on error
   */
  readerGetColumnType(handle: number, index: number): string {
    const len = this.module._mergetree_reader_get_column_type(handle, index);
    if (len < 0) {
      return '';
    }
    return readResultString(this.module);
  }

  /**
   * Read marks for a column
   * @returns Array of mark data (16 bytes per mark: offset_compressed + offset_decompressed)
   */
  readerReadMarks(handle: number, columnName: string): { count: number; data: Uint8Array } {
    const columnNamePtr = allocString(this.module, columnName);
    try {
      const count = this.module._mergetree_reader_read_marks(handle, columnNamePtr);
      if (count <= 0) {
        return { count: 0, data: new Uint8Array(0) };
      }
      const data = readResultBytes(this.module, count * 16);
      return { count, data };
    } finally {
      freeString(this.module, columnNamePtr);
    }
  }

  /**
   * Read raw column data for a mark range
   *
   * @param handle - Reader handle
   * @param columnName - Column name
   * @param startMark - Starting mark (0 for beginning)
   * @param endMark - Ending mark (0 for all)
   * @returns Raw bytes or empty array on error
   */
  readerReadColumnRaw(
    handle: number,
    columnName: string,
    startMark: bigint,
    endMark: bigint
  ): Uint8Array {
    const columnNamePtr = allocString(this.module, columnName);
    try {
      // WASM is 32-bit, so we need to pass 64-bit values as two 32-bit parts
      const startLo = Number(startMark & 0xffffffffn);
      const startHi = Number(startMark >> 32n);
      const endLo = Number(endMark & 0xffffffffn);
      const endHi = Number(endMark >> 32n);

      const bytesRead = this.module._mergetree_reader_read_column_raw(
        handle,
        columnNamePtr,
        startLo,
        startHi,
        endLo,
        endHi
      );

      if (bytesRead <= 0) {
        return new Uint8Array(0);
      }

      return readResultBytes(this.module, Number(bytesRead));
    } finally {
      freeString(this.module, columnNamePtr);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: Parse Marks from Raw Data
// ---------------------------------------------------------------------------

/**
 * Mark structure matching MarkInCompressedFile
 */
export interface MarkInfo {
  /** Offset in the compressed data file */
  compressedOffset: bigint;
  /** Offset within the decompressed block */
  decompressedOffset: bigint;
}

/**
 * Parse marks from raw byte data returned by readerReadMarks
 */
export function parseMarks(data: Uint8Array): MarkInfo[] {
  const marks: MarkInfo[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < data.length; i += 16) {
    const compressedOffset = view.getBigUint64(i, true);
    const decompressedOffset = view.getBigUint64(i + 8, true);
    marks.push({ compressedOffset, decompressedOffset });
  }

  return marks;
}

// ---------------------------------------------------------------------------
// Error Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an error code to a human-readable message
 */
export function errorCodeToMessage(code: number): string {
  switch (code) {
    case MERGETREE_ERR_INVALID_PARAM:
      return 'Invalid parameter';
    case MERGETREE_ERR_CREATE_FAILED:
      return 'Failed to create reader (part may not exist)';
    case MERGETREE_ERR_COLUMN_NOT_FOUND:
      return 'Column not found';
    case MERGETREE_ERR_IO:
      return 'I/O error';
    case MERGETREE_ERR_BAD_HANDLE:
      return 'Invalid handle';
    default:
      return `Unknown error (code: ${code})`;
  }
}

/**
 * Check if a result code indicates an error
 */
export function isError(code: number): boolean {
  return code < 0;
}
