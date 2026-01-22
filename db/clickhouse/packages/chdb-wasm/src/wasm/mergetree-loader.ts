/**
 * MergeTree WASM Loader
 *
 * Loads and initializes the mergetree.wasm module for use in Cloudflare Workers.
 * This module provides MergeTree part reading capabilities via the VFS bridge.
 *
 * The loader:
 * 1. Loads the WASM binary (from static assets or bundled)
 * 2. Initializes the Emscripten module with VFS bridge callbacks
 * 3. Exposes typed wrappers for the C API functions
 *
 * Usage:
 *   const loader = new MergeTreeLoader(env.ASSETS);
 *   await loader.init(storageProvider);
 *   const reader = await loader.createReader('db', 'table', 'partition', 'part');
 *   console.log(reader.getRowCount());
 *   reader.destroy();
 */

import type { VFSStorageProvider } from './vfs-bridge';
import { VFSBridge } from './vfs-bridge';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * Emscripten Module interface for mergetree.wasm
 */
export interface MergeTreeModule {
  ready: Promise<MergeTreeModule>;

  // Memory access
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // String utilities
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;

  // Helper functions (exposed by Emscripten)
  ccall(
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    opts?: { async?: boolean }
  ): unknown;

  cwrap(
    ident: string,
    returnType: string | null,
    argTypes: string[],
    opts?: { async?: boolean }
  ): (...args: unknown[]) => unknown;

  setValue(ptr: number, value: number, type: string): void;
  getValue(ptr: number, type: string): number;

  // VFS bridge (set by loader before init)
  vfsBridge?: VFSBridge;

  // Exported C functions (raw pointers)
  _mergetree_reader_create(
    database: number,
    table: number,
    partition: number,
    part_name: number
  ): number;
  _mergetree_reader_destroy(handle: number): void;
  _mergetree_reader_get_row_count(handle: number): number;
  _mergetree_reader_get_column_count(handle: number): number;
  _mergetree_reader_get_mark_count(handle: number): number;
  _mergetree_reader_get_column_name(handle: number, index: number): number;
  _mergetree_reader_get_column_type(handle: number, index: number): number;
  _mergetree_reader_read_marks(handle: number, column_name: number): number;
  _mergetree_reader_read_column_raw(
    handle: number,
    column_name: number,
    start_mark_lo: number,
    start_mark_hi: number,
    end_mark_lo: number,
    end_mark_hi: number
  ): number;
  _mergetree_get_result(): number;
  _mergetree_get_result_len(): number;
  _mergetree_get_error(): number;
  _mergetree_version(): number;
  _mergetree_test(): number;
}

/**
 * Module factory function type (from mergetree.js)
 */
export type MergeTreeModuleFactory = (
  moduleArg?: Partial<MergeTreeModule>
) => Promise<MergeTreeModule>;

/**
 * Mark structure (matches MarkInCompressedFile from C++)
 */
export interface Mark {
  offsetInCompressedFile: bigint;
  offsetInDecompressedBlock: bigint;
}

/**
 * Column information
 */
export interface ColumnInfo {
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// MergeTree Part Reader
// ---------------------------------------------------------------------------

/**
 * High-level wrapper for a MergeTree part reader
 */
export class MergeTreePartReader {
  private module: MergeTreeModule;
  private handle: number;
  private destroyed = false;

  constructor(module: MergeTreeModule, handle: number) {
    this.module = module;
    this.handle = handle;
  }

  /**
   * Get the total row count in the part
   */
  getRowCount(): bigint {
    this.checkDestroyed();
    // The function returns int64, but JS sees it as number (may lose precision for huge values)
    const result = this.module._mergetree_reader_get_row_count(this.handle);
    return BigInt(result);
  }

  /**
   * Get the number of columns in the part
   */
  getColumnCount(): number {
    this.checkDestroyed();
    return this.module._mergetree_reader_get_column_count(this.handle);
  }

  /**
   * Get the number of marks (index granules) in the part
   */
  getMarkCount(): bigint {
    this.checkDestroyed();
    const result = this.module._mergetree_reader_get_mark_count(this.handle);
    return BigInt(result);
  }

  /**
   * Get column name by index
   */
  getColumnName(index: number): string {
    this.checkDestroyed();
    const len = this.module._mergetree_reader_get_column_name(this.handle, index);
    if (len < 0) {
      throw new Error(`Invalid column index: ${index}`);
    }
    const resultPtr = this.module._mergetree_get_result();
    return this.module.UTF8ToString(resultPtr);
  }

  /**
   * Get column type by index
   */
  getColumnType(index: number): string {
    this.checkDestroyed();
    const len = this.module._mergetree_reader_get_column_type(this.handle, index);
    if (len < 0) {
      throw new Error(`Invalid column index: ${index}`);
    }
    const resultPtr = this.module._mergetree_get_result();
    return this.module.UTF8ToString(resultPtr);
  }

  /**
   * Get all column information
   */
  getColumns(): ColumnInfo[] {
    const count = this.getColumnCount();
    const columns: ColumnInfo[] = [];
    for (let i = 0; i < count; i++) {
      columns.push({
        name: this.getColumnName(i),
        type: this.getColumnType(i),
      });
    }
    return columns;
  }

  /**
   * Read marks for a column
   * Returns array of (compressed_offset, decompressed_offset) pairs
   */
  readMarks(columnName: string): Mark[] {
    this.checkDestroyed();

    const columnNamePtr = this.allocString(columnName);
    try {
      const markCount = this.module._mergetree_reader_read_marks(
        this.handle,
        columnNamePtr
      );

      if (markCount <= 0) {
        return [];
      }

      const resultPtr = this.module._mergetree_get_result();
      const marks: Mark[] = [];

      // Each mark is 16 bytes: 8 bytes compressed offset + 8 bytes decompressed offset
      const view = new DataView(this.module.HEAPU8.buffer);
      for (let i = 0; i < markCount; i++) {
        const baseOffset = resultPtr + i * 16;
        const compressedOffset = view.getBigUint64(baseOffset, true);
        const decompressedOffset = view.getBigUint64(baseOffset + 8, true);
        marks.push({
          offsetInCompressedFile: compressedOffset,
          offsetInDecompressedBlock: decompressedOffset,
        });
      }

      return marks;
    } finally {
      this.module._free(columnNamePtr);
    }
  }

  /**
   * Read raw column data for a mark range
   * Returns compressed bytes that need to be decompressed
   */
  readColumnRaw(
    columnName: string,
    startMark: bigint = 0n,
    endMark: bigint = 0n
  ): Uint8Array {
    this.checkDestroyed();

    const columnNamePtr = this.allocString(columnName);
    try {
      // Split 64-bit values into lo/hi 32-bit parts for WASM
      const startLo = Number(startMark & 0xffffffffn);
      const startHi = Number(startMark >> 32n);
      const endLo = Number(endMark & 0xffffffffn);
      const endHi = Number(endMark >> 32n);

      const bytesRead = this.module._mergetree_reader_read_column_raw(
        this.handle,
        columnNamePtr,
        startLo,
        startHi,
        endLo,
        endHi
      );

      if (bytesRead < 0) {
        throw new Error(`Failed to read column ${columnName}: error ${bytesRead}`);
      }

      if (bytesRead === 0) {
        return new Uint8Array(0);
      }

      const resultPtr = this.module._mergetree_get_result();
      // Copy data out of WASM memory
      return new Uint8Array(
        this.module.HEAPU8.buffer.slice(resultPtr, resultPtr + Number(bytesRead))
      );
    } finally {
      this.module._free(columnNamePtr);
    }
  }

  /**
   * Destroy the reader and free resources
   */
  destroy(): void {
    if (!this.destroyed) {
      this.module._mergetree_reader_destroy(this.handle);
      this.destroyed = true;
    }
  }

  /**
   * Check if this reader has been destroyed
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('MergeTreePartReader has been destroyed');
    }
  }

  private allocString(str: string): number {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = this.module._malloc(bytes.length + 1);
    this.module.HEAPU8.set(bytes, ptr);
    this.module.HEAPU8[ptr + bytes.length] = 0;
    return ptr;
  }
}

// ---------------------------------------------------------------------------
// MergeTree WASM Loader
// ---------------------------------------------------------------------------

/**
 * Loader for the mergetree.wasm module
 *
 * Handles loading the WASM binary and initializing the Emscripten module
 * with VFS bridge integration.
 */
export class MergeTreeLoader {
  private assetFetcher: Fetcher | null;
  private wasmPath: string;
  private module: MergeTreeModule | null = null;
  private vfsBridge: VFSBridge | null = null;
  private initialized = false;

  /**
   * Create a new MergeTreeLoader
   *
   * @param assetFetcher - Cloudflare Worker's ASSETS binding for fetching WASM
   * @param wasmPath - Path to the WASM file (default: /wasm/mergetree.wasm)
   */
  constructor(assetFetcher: Fetcher | null = null, wasmPath = '/wasm/mergetree.wasm') {
    this.assetFetcher = assetFetcher;
    this.wasmPath = wasmPath;
  }

  /**
   * Initialize the WASM module with a storage provider
   *
   * @param storageProvider - VFS storage provider for DO/R2 access
   * @param wasmBinary - Optional pre-loaded WASM binary
   */
  async init(
    storageProvider: VFSStorageProvider,
    wasmBinary?: ArrayBuffer
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create VFS bridge
    this.vfsBridge = new VFSBridge(storageProvider);

    // Load WASM binary if not provided
    let binary = wasmBinary;
    if (!binary) {
      binary = await this.loadWasmBinary();
    }

    // Create and initialize the module
    this.module = await this.createModule(binary);

    // Set VFS bridge on module and connect WASM memory
    this.module.vfsBridge = this.vfsBridge;

    // Get WASM memory from module
    const wasmMemory = {
      buffer: this.module.HEAPU8.buffer,
    } as WebAssembly.Memory;
    this.vfsBridge.setWasmMemory(wasmMemory);

    this.initialized = true;
  }

  /**
   * Check if the loader is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the module version string
   */
  getVersion(): string {
    this.checkInitialized();
    const versionPtr = this.module!._mergetree_version();
    return this.module!.UTF8ToString(versionPtr);
  }

  /**
   * Run self-test
   * Returns 0 on success, non-zero error code on failure
   */
  runSelfTest(): number {
    this.checkInitialized();
    return this.module!._mergetree_test();
  }

  /**
   * Get the last error message
   */
  getLastError(): string {
    this.checkInitialized();
    const errorPtr = this.module!._mergetree_get_error();
    return this.module!.UTF8ToString(errorPtr);
  }

  /**
   * Create a part reader for reading MergeTree data
   *
   * @param database - Database name
   * @param table - Table name
   * @param partition - Partition ID
   * @param partName - Part directory name
   */
  async createReader(
    database: string,
    table: string,
    partition: string,
    partName: string
  ): Promise<MergeTreePartReader> {
    this.checkInitialized();

    const dbPtr = this.allocString(database);
    const tablePtr = this.allocString(table);
    const partitionPtr = this.allocString(partition);
    const partNamePtr = this.allocString(partName);

    try {
      // Note: mergetree_reader_create may be async due to VFS callbacks
      const handle = this.module!._mergetree_reader_create(
        dbPtr,
        tablePtr,
        partitionPtr,
        partNamePtr
      );

      if (handle < 0) {
        const error = this.getLastError();
        throw new Error(`Failed to create reader: ${error || `error code ${handle}`}`);
      }

      return new MergeTreePartReader(this.module!, handle);
    } finally {
      this.module!._free(dbPtr);
      this.module!._free(tablePtr);
      this.module!._free(partitionPtr);
      this.module!._free(partNamePtr);
    }
  }

  /**
   * Shutdown the VFS and clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.vfsBridge) {
      await this.vfsBridge.vfs_shutdown();
    }
    this.module = null;
    this.vfsBridge = null;
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  private checkInitialized(): void {
    if (!this.initialized || !this.module) {
      throw new Error('MergeTreeLoader not initialized. Call init() first.');
    }
  }

  private async loadWasmBinary(): Promise<ArrayBuffer> {
    if (this.assetFetcher) {
      // Fetch from Cloudflare static assets
      const response = await this.assetFetcher.fetch(
        new Request(`https://placeholder${this.wasmPath}`)
      );
      if (!response.ok) {
        throw new Error(`Failed to load WASM: ${response.status} ${response.statusText}`);
      }
      return response.arrayBuffer();
    }

    // For testing: try to fetch from relative path
    const response = await fetch(this.wasmPath);
    if (!response.ok) {
      throw new Error(`Failed to load WASM: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  private async createModule(wasmBinary: ArrayBuffer): Promise<MergeTreeModule> {
    // Dynamic import of the Emscripten JS glue code
    // In Cloudflare Workers, this will be bundled
    const createMergeTreeModule = await this.importModuleFactory();

    // Create module with our configuration
    // The wasmBinary property is set on the Emscripten module but not in our TS interface
    const moduleConfig: Record<string, unknown> = {
      // Provide the WASM binary directly
      wasmBinary: wasmBinary,
      // Don't print to console by default
      print: () => {},
      printErr: (text: string) => console.error('[MergeTree WASM]', text),
    };

    // Initialize the module
    const module = await createMergeTreeModule(moduleConfig);
    await module.ready;

    return module;
  }

  private async importModuleFactory(): Promise<MergeTreeModuleFactory> {
    // This will be replaced by bundler with actual import
    // For now, we assume the factory is available globally or via import
    try {
      // Try ES module import (for bundled worker)
      // @ts-expect-error - dynamic import path
      const mod = await import('../../wasm/dist/mergetree.js');
      return mod.default || mod;
    } catch {
      // Fallback: check if globally available
      if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).createMergeTreeModule) {
        return (globalThis as Record<string, unknown>).createMergeTreeModule as MergeTreeModuleFactory;
      }
      throw new Error('MergeTree module factory not found');
    }
  }

  private allocString(str: string): number {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = this.module!._malloc(bytes.length + 1);
    this.module!.HEAPU8.set(bytes, ptr);
    this.module!.HEAPU8[ptr + bytes.length] = 0;
    return ptr;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { VFSBridge } from './vfs-bridge';
export type { VFSStorageProvider } from './vfs-bridge';
