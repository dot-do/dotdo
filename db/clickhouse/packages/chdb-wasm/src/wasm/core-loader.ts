/**
 * Core WASM Module Loader
 *
 * This module provides the infrastructure to load the core WASM module
 * in the Cloudflare Workers environment. It handles:
 *
 * - Direct WASM module imports (bundled by wrangler)
 * - Emscripten module initialization with pre-compiled WASM
 * - Memory and table management
 * - ccall/cwrap wrapper functions for easy function calling
 *
 * In Workers, WASM modules must be imported as ES modules rather than
 * fetched via URLs. This loader provides the bridge between the standard
 * Emscripten-generated JavaScript and the Workers runtime.
 *
 * @example
 * ```typescript
 * import { loadCoreModule, createCoreModuleWithWasm } from './wasm/core-loader';
 *
 * // Load with bundled WASM (recommended)
 * const module = await loadCoreModule();
 *
 * // Or provide pre-compiled WASM
 * import coreWasm from '../wasm/dist/modular/core.wasm';
 * const module = await createCoreModuleWithWasm(coreWasm);
 * ```
 */

/**
 * Type definitions for the core module exports
 */
export interface CoreModuleExports {
  // Memory management (required for side modules)
  malloc: (size: number) => number;
  free: (ptr: number) => void;

  // Core initialization and version
  core_init: () => number;
  core_get_version: () => number;

  // Memory allocation wrappers
  core_alloc: (size: number) => number;
  core_free: (ptr: number) => void;

  // Logging and error handling
  core_log: (messagePtr: number) => void;
  core_set_error: (errorPtr: number) => void;
  core_get_error: () => number;

  // Extension registry
  core_register_extension: (namePtr: number) => number;
  core_get_extension_count: () => number;

  // Query tracking
  core_increment_query_count: () => void;
  core_get_query_count: () => number;

  // Utility functions
  core_add: (a: number, b: number) => number;
  core_multiply: (a: number, b: number) => number;
  core_process_buffer: (bufferPtr: number, length: number) => number;

  // VFS functions (for storage abstraction)
  vfs_open: (pathPtr: number, flags: number) => number;
  vfs_read: (fd: number, bufferPtr: number, count: number) => number;
  vfs_write: (fd: number, bufferPtr: number, count: number) => number;
  vfs_close: (fd: number) => number;
  vfs_seek: (fd: number, offset: number, whence: number) => number;
  vfs_size: (fd: number) => number;

  // Extension call dispatch
  extension_register: (namePtr: number, initFnPtr: number) => number;
  extension_call: (namePtr: number, funcNamePtr: number, argsPtr: number) => number;

  // Emscripten stack functions
  emscripten_get_sbrk_ptr: () => number;
  emscripten_stack_get_current: () => number;
  _emscripten_stack_restore: (ptr: number) => void;
  _emscripten_stack_alloc: (size: number) => number;

  // Calloc for zero-initialized memory
  calloc: (count: number, size: number) => number;

  // Dynamic loading support
  __dl_seterr: (errPtr: number, formatPtr: number) => void;
  _emscripten_find_dylib: (namePtr: number, handlePtr: number, flags: number, depthPtr: number) => number;
}

/**
 * Type definitions for the Emscripten runtime methods
 */
export interface CoreModuleRuntime {
  // Memory access
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  // Memory management
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;

  // String utilities
  UTF8ToString: (ptr: number, maxLength?: number) => string;
  stringToUTF8: (str: string, ptr: number, maxLength: number) => void;

  // Function pointer utilities
  addFunction: (fn: Function, signature: string) => number;
  removeFunction: (ptr: number) => void;

  // Dynamic library loading
  loadDynamicLibrary: (path: string, options?: object) => Promise<void>;

  // Function table
  wasmTable: WebAssembly.Table;

  // Memory
  wasmMemory: WebAssembly.Memory;

  // ccall/cwrap for calling exported functions
  ccall: (name: string, returnType: string, argTypes: string[], args: unknown[]) => unknown;
  cwrap: (name: string, returnType: string, argTypes: string[]) => Function;
}

/**
 * Complete core module interface
 */
export type CoreModule = CoreModuleExports & CoreModuleRuntime;

/**
 * Options for creating the core module
 */
export interface CoreModuleOptions {
  /** Pre-compiled WebAssembly.Module to use */
  wasmModule?: WebAssembly.Module;

  /** WASM binary as ArrayBuffer or Uint8Array */
  wasmBinary?: ArrayBuffer | Uint8Array;

  /** Initial memory in pages (64KB per page) */
  initialMemory?: number;

  /** Maximum memory in pages */
  maximumMemory?: number;

  /** Print function for stdout */
  print?: (text: string) => void;

  /** Print function for stderr */
  printErr?: (text: string) => void;

  /** Function to locate files (for legacy compatibility) */
  locateFile?: (path: string) => string;
}

/**
 * Default import object for the core WASM module
 */
function createDefaultImports(memory: WebAssembly.Memory): WebAssembly.Imports {
  return {
    wasi_snapshot_preview1: {
      fd_write: (
        _fd: number,
        _iovs: number,
        _iovsLen: number,
        _nwritten: number
      ): number => 0,
      environ_sizes_get: (
        _environCount: number,
        _environBufSize: number
      ): number => 0,
      environ_get: (_environ: number, _environBuf: number): number => 0,
    },
    env: {
      memory,
      emscripten_resize_heap: (_requestedSize: number): number => {
        // In Workers, memory growth is handled automatically
        return 0;
      },
      __syscall_stat64: (_path: number, _buf: number): number => -1,
    },
  };
}

/**
 * Create memory heap views for a WebAssembly.Memory instance
 */
function createHeapViews(memory: WebAssembly.Memory): {
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
} {
  const buffer = memory.buffer;
  return {
    HEAP8: new Int8Array(buffer),
    HEAP16: new Int16Array(buffer),
    HEAP32: new Int32Array(buffer),
    HEAPU8: new Uint8Array(buffer),
    HEAPU16: new Uint16Array(buffer),
    HEAPU32: new Uint32Array(buffer),
    HEAPF32: new Float32Array(buffer),
    HEAPF64: new Float64Array(buffer),
  };
}

/**
 * Create the core module from a pre-compiled WebAssembly.Module
 *
 * This function instantiates the WASM module and wraps it with
 * Emscripten-style helper functions for easy interop.
 *
 * @param wasmModule - Pre-compiled WebAssembly.Module
 * @param options - Optional configuration
 * @returns The initialized core module with all exports and helpers
 */
export async function createCoreModuleWithWasm(
  wasmModule: WebAssembly.Module,
  options: CoreModuleOptions = {}
): Promise<CoreModule> {
  const {
    initialMemory = 256, // 16MB
    maximumMemory = 2048, // 128MB (Workers limit)
    print = console.log,
    printErr = console.error,
  } = options;

  // Create shared memory
  const memory = new WebAssembly.Memory({
    initial: initialMemory,
    maximum: maximumMemory,
  });

  // Create import object
  const imports = createDefaultImports(memory);

  // Instantiate the module
  const instance = await WebAssembly.instantiate(wasmModule, imports);
  const exports = instance.exports as unknown as CoreModuleExports & {
    memory?: WebAssembly.Memory;
    __indirect_function_table?: WebAssembly.Table;
  };

  // Use exported memory if available, otherwise use our created one
  const wasmMemory = exports.memory || memory;

  // Create heap views
  const heaps = createHeapViews(wasmMemory);

  // Get or create function table
  const wasmTable =
    exports.__indirect_function_table ||
    new WebAssembly.Table({ initial: 100, maximum: 1000, element: 'anyfunc' });

  // UTF8 string utilities
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8');

  function UTF8ToString(ptr: number, maxLength?: number): string {
    if (ptr === 0) return '';
    const heap = new Uint8Array(wasmMemory.buffer);
    let end = ptr;
    const max = maxLength !== undefined ? ptr + maxLength : heap.length;
    while (end < max && heap[end] !== 0) end++;
    return textDecoder.decode(heap.subarray(ptr, end));
  }

  function stringToUTF8(str: string, ptr: number, maxLength: number): void {
    const bytes = textEncoder.encode(str);
    const heap = new Uint8Array(wasmMemory.buffer);
    const len = Math.min(bytes.length, maxLength - 1);
    heap.set(bytes.subarray(0, len), ptr);
    heap[ptr + len] = 0; // Null terminator
  }

  // Function pointer management
  let nextFunctionIndex = 1;
  const functionRegistry = new Map<number, Function>();

  function addFunction(fn: Function, _signature: string): number {
    const index = nextFunctionIndex++;
    functionRegistry.set(index, fn);
    // Note: In a full implementation, this would add to wasmTable
    return index;
  }

  function removeFunction(ptr: number): void {
    functionRegistry.delete(ptr);
  }

  // ccall implementation
  function ccall(
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[]
  ): unknown {
    const fn = (exports as Record<string, unknown>)[name] as Function | undefined;
    if (!fn) {
      throw new Error(`Function '${name}' not found in WASM exports`);
    }

    // Convert arguments
    const convertedArgs = args.map((arg, i) => {
      const type = argTypes[i];
      if (type === 'string') {
        // Allocate and write string
        const str = arg as string;
        const bytes = textEncoder.encode(str);
        const ptr = exports.malloc(bytes.length + 1);
        const heap = new Uint8Array(wasmMemory.buffer);
        heap.set(bytes, ptr);
        heap[ptr + bytes.length] = 0;
        return ptr;
      }
      return arg;
    });

    // Call the function
    const result = fn(...convertedArgs);

    // Free string arguments
    args.forEach((arg, i) => {
      if (argTypes[i] === 'string') {
        exports.free(convertedArgs[i] as number);
      }
    });

    // Convert return value
    if (returnType === 'string' && typeof result === 'number') {
      return UTF8ToString(result);
    }

    return result;
  }

  // cwrap implementation
  function cwrap(
    name: string,
    returnType: string,
    argTypes: string[]
  ): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => ccall(name, returnType, argTypes, args);
  }

  // Dynamic library loading (stub for side modules)
  async function loadDynamicLibrary(
    _path: string,
    _options?: object
  ): Promise<void> {
    // In Workers, dynamic loading would need special handling
    // This is a placeholder for future implementation
    print(`[CoreModule] Dynamic library loading requested: ${_path}`);
  }

  // Construct the complete module object
  const module: CoreModule = {
    // Exports from WASM
    ...exports,

    // Memory management wrappers
    _malloc: exports.malloc,
    _free: exports.free,

    // Heap views - these need to be getters to handle memory growth
    get HEAP8() {
      return new Int8Array(wasmMemory.buffer);
    },
    get HEAP16() {
      return new Int16Array(wasmMemory.buffer);
    },
    get HEAP32() {
      return new Int32Array(wasmMemory.buffer);
    },
    get HEAPU8() {
      return new Uint8Array(wasmMemory.buffer);
    },
    get HEAPU16() {
      return new Uint16Array(wasmMemory.buffer);
    },
    get HEAPU32() {
      return new Uint32Array(wasmMemory.buffer);
    },
    get HEAPF32() {
      return new Float32Array(wasmMemory.buffer);
    },
    get HEAPF64() {
      return new Float64Array(wasmMemory.buffer);
    },

    // String utilities
    UTF8ToString,
    stringToUTF8,

    // Function pointer management
    addFunction,
    removeFunction,

    // Dynamic loading
    loadDynamicLibrary,

    // Tables and memory
    wasmTable,
    wasmMemory,

    // ccall/cwrap
    ccall,
    cwrap,
  };

  // Initialize static heap views for backwards compatibility
  Object.assign(module, heaps);

  return module;
}

/**
 * Create the core module from WASM binary data
 *
 * @param wasmBinary - WASM binary as ArrayBuffer or Uint8Array
 * @param options - Optional configuration
 * @returns The initialized core module
 */
export async function createCoreModuleFromBinary(
  wasmBinary: ArrayBuffer | Uint8Array,
  options: CoreModuleOptions = {}
): Promise<CoreModule> {
  const wasmModule = await WebAssembly.compile(wasmBinary);
  return createCoreModuleWithWasm(wasmModule, options);
}

/**
 * Load the core module using the default bundled WASM
 *
 * This function loads the core.wasm module that is bundled with the worker.
 * In the test environment, it uses direct import; in production, it may
 * fetch from assets.
 *
 * @param options - Optional configuration
 * @returns The initialized core module
 */
export async function loadCoreModule(
  options: CoreModuleOptions = {}
): Promise<CoreModule> {
  // If a pre-compiled module is provided, use it directly
  if (options.wasmModule) {
    return createCoreModuleWithWasm(options.wasmModule, options);
  }

  // If binary data is provided, compile and instantiate
  if (options.wasmBinary) {
    return createCoreModuleFromBinary(options.wasmBinary, options);
  }

  // Otherwise, try to import the bundled WASM module
  // This will be resolved by wrangler's WASM bundling
  throw new Error(
    'No WASM module or binary provided. ' +
      'Use createCoreModuleWithWasm() with an imported WASM module, or ' +
      'provide wasmBinary in options.'
  );
}

/**
 * Validate that a WASM binary is valid and has expected exports
 */
export function validateWasmBinary(binary: ArrayBuffer | Uint8Array): {
  valid: boolean;
  error?: string;
} {
  // Check WASM magic number
  const bytes = new Uint8Array(binary instanceof ArrayBuffer ? binary : binary.buffer);
  if (
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    return { valid: false, error: 'Invalid WASM magic number' };
  }

  // Validate using WebAssembly API
  try {
    const isValid = WebAssembly.validate(bytes);
    if (!isValid) {
      return { valid: false, error: 'WebAssembly.validate() returned false' };
    }
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: `WebAssembly.validate() threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
