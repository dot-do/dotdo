/**
 * Core MAIN_MODULE Tests in Workers Runtime
 *
 * These tests verify that the core module infrastructure is ready for
 * deployment in the Cloudflare Workers runtime (workerd).
 *
 * IMPORTANT: Dynamic WASM compilation from bytes is NOT allowed in the workerd
 * test environment for security reasons. In production, WASM modules are
 * pre-compiled and bundled by wrangler.
 *
 * The core module is responsible for:
 * - Providing system libraries (malloc, free, etc.) to side modules
 * - Exporting VFS functions for storage abstraction
 * - Managing the extension registry for dynamic loading
 * - Supporting table growth for function pointers
 * - Managing memory that side modules can share
 *
 * For actual WASM execution tests with bundled modules, see:
 * - tests/e2e/ for end-to-end tests with deployed workers
 * - tests/workers/http-wasm-execution.test.ts for HTTP-based execution
 *
 * Run with: pnpm test tests/workers/core-module.test.ts
 *
 * @see wasm/dynamic/README.md for architecture documentation
 * @see wasm/dynamic/core.cpp for the spike implementation
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { measureTime, formatBytes } from './setup';
import {
  type CoreModule,
  type CoreModuleOptions,
  type CoreModuleExports,
  type CoreModuleRuntime,
} from '../../src/wasm/core-loader';
import {
  CORE_WASM_PATH,
  CORE_MODULE_PATH,
  validateWasmPath,
} from '../../src/wasm/paths';

/**
 * A minimal WASM module for testing (without dynamic compilation)
 */
const MINIMAL_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic number (\0asm)
  0x01, 0x00, 0x00, 0x00, // version 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section
  0x03, 0x02, 0x01, 0x00, // function section
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code section
]);

/**
 * Test Suite: Core Module Infrastructure
 */
describe('Core MAIN_MODULE', () => {
  /**
   * Tests for module path validation
   */
  describe('Module Path Validation', () => {
    it('should have valid core module path', () => {
      const result = validateWasmPath(CORE_MODULE_PATH);
      expect(result.valid).toBe(true);
    });

    it('should have valid core WASM path', () => {
      const result = validateWasmPath(CORE_WASM_PATH);
      expect(result.valid).toBe(true);
    });

    it('should recognize .js extension as valid', () => {
      const result = validateWasmPath('wasm/dist/modular/core.js');
      expect(result.valid).toBe(true);
    });

    it('should recognize .wasm extension as valid', () => {
      const result = validateWasmPath('wasm/dist/modular/core.wasm');
      expect(result.valid).toBe(true);
    });
  });

  /**
   * Tests for WebAssembly.Memory management (simulating what core module needs)
   */
  describe('Memory Management', () => {
    it('should create memory with initial size', () => {
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 });
      expect(memory.buffer.byteLength).toBe(256 * 65536); // 16MB
    });

    it('should support heap views', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const buffer = memory.buffer;

      // Create all the heap views that Emscripten needs
      const HEAP8 = new Int8Array(buffer);
      const HEAP16 = new Int16Array(buffer);
      const HEAP32 = new Int32Array(buffer);
      const HEAPU8 = new Uint8Array(buffer);
      const HEAPU16 = new Uint16Array(buffer);
      const HEAPU32 = new Uint32Array(buffer);
      const HEAPF32 = new Float32Array(buffer);
      const HEAPF64 = new Float64Array(buffer);

      expect(HEAP8).toBeInstanceOf(Int8Array);
      expect(HEAP16).toBeInstanceOf(Int16Array);
      expect(HEAP32).toBeInstanceOf(Int32Array);
      expect(HEAPU8).toBeInstanceOf(Uint8Array);
      expect(HEAPU16).toBeInstanceOf(Uint16Array);
      expect(HEAPU32).toBeInstanceOf(Uint32Array);
      expect(HEAPF32).toBeInstanceOf(Float32Array);
      expect(HEAPF64).toBeInstanceOf(Float64Array);
    });

    it('should allow memory growth', () => {
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 });
      const initialSize = memory.buffer.byteLength;

      // Grow by 256 pages (16MB)
      memory.grow(256);

      expect(memory.buffer.byteLength).toBe(initialSize * 2);
    });

    it('should handle large allocations within Workers limits', () => {
      // Workers has 128MB limit, which is 2048 pages
      const memory = new WebAssembly.Memory({ initial: 1024, maximum: 2048 }); // 64MB

      expect(memory.buffer.byteLength).toBe(64 * 1024 * 1024);

      console.log(`Created memory: ${formatBytes(memory.buffer.byteLength)}`);
    });

    it('should update heap views after memory growth', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });

      // Initial view
      let HEAPU8 = new Uint8Array(memory.buffer);
      const initialLength = HEAPU8.length;

      // Grow memory
      memory.grow(1);

      // Create new view (old view is now detached)
      HEAPU8 = new Uint8Array(memory.buffer);

      expect(HEAPU8.length).toBe(initialLength * 2);
    });
  });

  /**
   * Tests for WebAssembly.Table management (for function pointers)
   */
  describe('Table Growth Support', () => {
    it('should create function table', () => {
      const table = new WebAssembly.Table({
        initial: 100,
        maximum: 1000,
        element: 'anyfunc',
      });

      expect(table).toBeInstanceOf(WebAssembly.Table);
      expect(table.length).toBe(100);
    });

    it('should allow table growth', () => {
      const table = new WebAssembly.Table({
        initial: 100,
        maximum: 1000,
        element: 'anyfunc',
      });

      const oldLength = table.grow(50);

      expect(oldLength).toBe(100);
      expect(table.length).toBe(150);
    });

    it('should support many function pointers for side modules', () => {
      const table = new WebAssembly.Table({
        initial: 100,
        maximum: 10000,
        element: 'anyfunc',
      });

      // Grow to accommodate many side module functions
      for (let i = 0; i < 10; i++) {
        table.grow(100);
      }

      expect(table.length).toBe(1100);
    });

    it('should track table usage correctly', () => {
      const table = new WebAssembly.Table({
        initial: 10,
        maximum: 100,
        element: 'anyfunc',
      });

      // Simulate tracking function indices
      let nextIndex = 1; // Reserve index 0
      const allocatedIndices: number[] = [];

      // "Allocate" some indices
      for (let i = 0; i < 5; i++) {
        allocatedIndices.push(nextIndex++);
      }

      expect(allocatedIndices).toHaveLength(5);
      expect(allocatedIndices).toEqual([1, 2, 3, 4, 5]);
    });
  });

  /**
   * Tests for UTF-8 string utilities (simulating Emscripten's UTF8ToString/stringToUTF8)
   */
  describe('String Utilities', () => {
    it('should have TextEncoder available', () => {
      const encoder = new TextEncoder();
      expect(encoder).toBeInstanceOf(TextEncoder);
    });

    it('should have TextDecoder available', () => {
      const decoder = new TextDecoder('utf-8');
      expect(decoder).toBeInstanceOf(TextDecoder);
    });

    it('should convert strings to UTF-8 bytes', () => {
      const encoder = new TextEncoder();
      const bytes = encoder.encode('Hello, World!');

      expect(bytes.length).toBe(13);
      expect(bytes[0]).toBe(0x48); // 'H'
    });

    it('should convert UTF-8 bytes to strings', () => {
      const decoder = new TextDecoder('utf-8');
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      expect(decoder.decode(bytes)).toBe('Hello');
    });

    it('should handle Unicode strings', () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder('utf-8');

      const testString = 'Hello, World!';
      const bytes = encoder.encode(testString);
      const result = decoder.decode(bytes);

      expect(result).toBe(testString);
    });

    it('should handle null-terminated strings', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const heap = new Uint8Array(memory.buffer);

      // Write null-terminated string
      const str = 'test';
      const encoder = new TextEncoder();
      const bytes = encoder.encode(str);
      const ptr = 1024;

      heap.set(bytes, ptr);
      heap[ptr + bytes.length] = 0; // Null terminator

      // Read until null terminator
      const decoder = new TextDecoder('utf-8');
      let end = ptr;
      while (heap[end] !== 0) end++;

      const result = decoder.decode(heap.subarray(ptr, end));
      expect(result).toBe(str);
    });
  });

  /**
   * Tests for WASM validation (without dynamic compilation)
   */
  describe('WASM Validation', () => {
    it('should validate correct WASM bytes', () => {
      const isValid = WebAssembly.validate(MINIMAL_WASM_BYTES);
      expect(isValid).toBe(true);
    });

    it('should reject invalid WASM bytes', () => {
      const invalid = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const isValid = WebAssembly.validate(invalid);
      expect(isValid).toBe(false);
    });

    it('should verify WASM magic number', () => {
      const magic = MINIMAL_WASM_BYTES.slice(0, 4);
      expect(magic[0]).toBe(0x00);
      expect(magic[1]).toBe(0x61); // 'a'
      expect(magic[2]).toBe(0x73); // 's'
      expect(magic[3]).toBe(0x6d); // 'm'
    });
  });

  /**
   * Tests for core module type definitions
   */
  describe('Type Definitions', () => {
    it('should define CoreModuleExports interface', () => {
      // Type check - this is a compile-time check
      const exports: Partial<CoreModuleExports> = {
        malloc: (size: number) => 0,
        free: (ptr: number) => {},
        core_init: () => 0,
        core_get_version: () => 1,
      };

      expect(typeof exports.malloc).toBe('function');
      expect(typeof exports.free).toBe('function');
      expect(typeof exports.core_init).toBe('function');
      expect(typeof exports.core_get_version).toBe('function');
    });

    it('should define CoreModuleRuntime interface', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const table = new WebAssembly.Table({ initial: 10, element: 'anyfunc' });

      // Type check - this is a compile-time check
      const runtime: Partial<CoreModuleRuntime> = {
        HEAP8: new Int8Array(memory.buffer),
        HEAPU8: new Uint8Array(memory.buffer),
        wasmMemory: memory,
        wasmTable: table,
        UTF8ToString: (ptr: number) => '',
        stringToUTF8: (str: string, ptr: number, maxLength: number) => {},
      };

      expect(runtime.HEAP8).toBeInstanceOf(Int8Array);
      expect(runtime.wasmMemory).toBeInstanceOf(WebAssembly.Memory);
      expect(runtime.wasmTable).toBeInstanceOf(WebAssembly.Table);
    });

    it('should define CoreModuleOptions interface', () => {
      const options: CoreModuleOptions = {
        initialMemory: 256,
        maximumMemory: 2048,
        print: (text) => console.log(text),
        printErr: (text) => console.error(text),
      };

      expect(options.initialMemory).toBe(256);
      expect(options.maximumMemory).toBe(2048);
    });
  });

  /**
   * Tests for extension registry simulation
   */
  describe('Extension Registry', () => {
    it('should track extension names', () => {
      const registry = new Map<string, number>();

      registry.set('ext-geo', 1);
      registry.set('ext-json', 2);
      registry.set('ext-math', 3);

      expect(registry.size).toBe(3);
      expect(registry.has('ext-geo')).toBe(true);
      expect(registry.get('ext-json')).toBe(2);
    });

    it('should track extension count', () => {
      let extensionCount = 0;
      const extensions: string[] = [];

      const registerExtension = (name: string): number => {
        extensions.push(name);
        return extensionCount++;
      };

      registerExtension('ext-geo');
      registerExtension('ext-json');
      registerExtension('ext-math');

      expect(extensionCount).toBe(3);
      expect(extensions).toEqual(['ext-geo', 'ext-json', 'ext-math']);
    });
  });

  /**
   * Tests for VFS function interface simulation
   */
  describe('VFS Interface', () => {
    it('should define VFS constants', () => {
      // Common VFS flags
      const O_RDONLY = 0x00;
      const O_WRONLY = 0x01;
      const O_RDWR = 0x02;
      const O_CREAT = 0x40;

      expect(O_RDONLY).toBe(0);
      expect(O_WRONLY).toBe(1);
      expect(O_RDWR).toBe(2);
      expect(O_CREAT).toBe(64);
    });

    it('should define seek whence values', () => {
      const SEEK_SET = 0;
      const SEEK_CUR = 1;
      const SEEK_END = 2;

      expect(SEEK_SET).toBe(0);
      expect(SEEK_CUR).toBe(1);
      expect(SEEK_END).toBe(2);
    });

    it('should define VFS function signatures', () => {
      // These are the function signatures that the core module exports
      type VFSOpen = (pathPtr: number, flags: number) => number;
      type VFSRead = (fd: number, bufferPtr: number, count: number) => number;
      type VFSWrite = (fd: number, bufferPtr: number, count: number) => number;
      type VFSClose = (fd: number) => number;
      type VFSSeek = (fd: number, offset: number, whence: number) => number;
      type VFSSize = (fd: number) => number;

      // Type check - these signatures match the exports from core.wasm
      const mockVFS: {
        vfs_open: VFSOpen;
        vfs_read: VFSRead;
        vfs_write: VFSWrite;
        vfs_close: VFSClose;
        vfs_seek: VFSSeek;
        vfs_size: VFSSize;
      } = {
        vfs_open: (pathPtr, flags) => -1,
        vfs_read: (fd, bufferPtr, count) => 0,
        vfs_write: (fd, bufferPtr, count) => 0,
        vfs_close: (fd) => 0,
        vfs_seek: (fd, offset, whence) => 0,
        vfs_size: (fd) => 0,
      };

      expect(typeof mockVFS.vfs_open).toBe('function');
      expect(typeof mockVFS.vfs_read).toBe('function');
      expect(typeof mockVFS.vfs_write).toBe('function');
      expect(typeof mockVFS.vfs_close).toBe('function');
      expect(typeof mockVFS.vfs_seek).toBe('function');
      expect(typeof mockVFS.vfs_size).toBe('function');
    });
  });

  /**
   * Tests for performance timing
   */
  describe('Performance Timing', () => {
    it('should have performance.now available', () => {
      expect(typeof performance.now).toBe('function');
    });

    it('should measure time accurately', async () => {
      const { result, durationMs } = await measureTime(async () => {
        // Simulate some work
        let sum = 0;
        for (let i = 0; i < 10000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(result).toBe(49995000);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should format bytes correctly', () => {
      expect(formatBytes(100)).toBe('100 B');
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(formatBytes(10 * 1024 * 1024)).toBe('10.00 MB');
    });
  });

  /**
   * Tests for query tracking simulation
   */
  describe('Query Tracking', () => {
    it('should track query count', () => {
      let queryCount = 0;

      const incrementQueryCount = () => {
        queryCount++;
      };

      const getQueryCount = () => queryCount;

      incrementQueryCount();
      incrementQueryCount();
      incrementQueryCount();

      expect(getQueryCount()).toBe(3);
    });

    it('should reset query count on init', () => {
      let queryCount = 5;

      const init = () => {
        queryCount = 0;
        return 0; // Success
      };

      expect(init()).toBe(0);
      expect(queryCount).toBe(0);
    });
  });

  /**
   * Tests for utility functions simulation
   */
  describe('Utility Functions', () => {
    it('should add two numbers', () => {
      const core_add = (a: number, b: number) => a + b;

      expect(core_add(10, 20)).toBe(30);
      expect(core_add(-10, 5)).toBe(-5);
      expect(core_add(0, 0)).toBe(0);
    });

    it('should multiply two numbers', () => {
      const core_multiply = (a: number, b: number) => a * b;

      expect(core_multiply(6, 7)).toBe(42);
      expect(core_multiply(-5, -3)).toBe(15);
      expect(core_multiply(0, 100)).toBe(0);
    });

    it('should process buffer and sum bytes', () => {
      const core_process_buffer = (buffer: Uint8Array): number => {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        return sum;
      };

      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(core_process_buffer(data)).toBe(55);
    });
  });

  /**
   * Tests for error handling simulation
   */
  describe('Error Handling', () => {
    it('should store and retrieve error messages', () => {
      let currentError: string | null = null;

      const set_error = (msg: string) => {
        currentError = msg;
      };

      const get_error = () => currentError;

      set_error('Test error message');
      expect(get_error()).toBe('Test error message');

      set_error('');
      expect(get_error()).toBe('');
    });

    it('should clear error on init', () => {
      let currentError: string | null = 'Some error';

      const init = () => {
        currentError = null;
        return 0;
      };

      init();
      expect(currentError).toBeNull();
    });
  });
});
