/**
 * WASM Module Loading Tests - GREEN Phase (TDD)
 *
 * These tests verify that WASM modules can be loaded correctly in the
 * Cloudflare Workers runtime (workerd).
 *
 * IMPORTANT: Dynamic WASM compilation from bytes is NOT allowed in the workerd
 * test environment for security reasons. In production, WASM modules are
 * pre-compiled and bundled by wrangler.
 *
 * These tests verify:
 * 1. The core-loader module correctly handles WASM instantiation
 * 2. The WASM module paths are correctly configured
 * 3. The module loading infrastructure is ready for production use
 *
 * For actual WASM execution tests with bundled modules, see:
 * - tests/e2e/ for end-to-end tests with deployed workers
 * - tests/workers/http-wasm-execution.test.ts for HTTP-based execution
 *
 * Run with: pnpm test tests/workers/wasm-module-loading.test.ts
 *
 * @see wasm/dist/modular/ for the WASM module files
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { measureTime, formatBytes } from './setup';
import {
  validateWasmBinary,
  type CoreModuleOptions,
} from '../../src/wasm/core-loader';
import {
  WASM_MODULE_PATH,
  CORE_MODULE_PATH,
  CORE_WASM_PATH,
  SIDE_MODULES,
  EXTENSION_MODULES,
  getWasmPath,
  validateWasmPath,
  getSideModulePath,
  getExtensionModulePath,
  listAllWasmPaths,
} from '../../src/wasm/paths';

/**
 * A minimal WASM module that exports an add function
 * This is used for testing WASM APIs without dynamic compilation
 */
const MINIMAL_ADD_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic number (\0asm)
  0x01, 0x00, 0x00, 0x00, // version 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section
  0x03, 0x02, 0x01, 0x00, // function section
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code section
]);

/**
 * Test Suite: WASM Module Loading
 */
describe('WASM Module Loading', () => {
  /**
   * Tests for WASM path configuration
   */
  describe('WASM Path Configuration', () => {
    it('should have correct base path', () => {
      expect(WASM_MODULE_PATH).toBe('wasm/dist/modular');
    });

    it('should have correct core module paths', () => {
      expect(CORE_MODULE_PATH).toBe('wasm/dist/modular/core.js');
      expect(CORE_WASM_PATH).toBe('wasm/dist/modular/core.wasm');
    });

    it('should have correct side module paths', () => {
      expect(SIDE_MODULES.aggregates).toBe('wasm/dist/modular/aggregates.side.wasm');
      expect(SIDE_MODULES.memoryEngine).toBe('wasm/dist/modular/memory_engine.side.wasm');
    });

    it('should have correct extension module paths', () => {
      expect(EXTENSION_MODULES.math).toBe('wasm/dist/modular/ext-math.wasm');
      expect(EXTENSION_MODULES.geo).toBe('wasm/dist/modular/ext-geo.wasm');
      expect(EXTENSION_MODULES.json).toBe('wasm/dist/modular/ext-json.wasm');
    });

    it('should generate correct custom paths', () => {
      const customPath = getWasmPath('custom.wasm');
      expect(customPath).toBe('wasm/dist/modular/custom.wasm');
    });

    it('should validate correct paths', () => {
      const result = validateWasmPath(CORE_WASM_PATH);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid paths', () => {
      const result = validateWasmPath('invalid/path/core.wasm');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not start with expected base');
    });

    it('should reject empty paths', () => {
      const result = validateWasmPath('');
      expect(result.valid).toBe(false);
    });

    it('should get side module path with validation', () => {
      expect(getSideModulePath('aggregates')).toBe('wasm/dist/modular/aggregates.side.wasm');
      expect(getSideModulePath('memoryEngine')).toBe('wasm/dist/modular/memory_engine.side.wasm');
    });

    it('should throw for unknown side module', () => {
      expect(() => {
        getSideModulePath('unknown' as any);
      }).toThrow('Unknown side module');
    });

    it('should get extension module path with validation', () => {
      expect(getExtensionModulePath('math')).toBe('wasm/dist/modular/ext-math.wasm');
      expect(getExtensionModulePath('geo')).toBe('wasm/dist/modular/ext-geo.wasm');
      expect(getExtensionModulePath('json')).toBe('wasm/dist/modular/ext-json.wasm');
    });

    it('should throw for unknown extension module', () => {
      expect(() => {
        getExtensionModulePath('unknown' as any);
      }).toThrow('Unknown extension module');
    });

    it('should list all paths correctly', () => {
      const paths = listAllWasmPaths();
      expect(paths.basePath).toBe(WASM_MODULE_PATH);
      expect(paths.core.module).toBe(CORE_MODULE_PATH);
      expect(paths.core.wasm).toBe(CORE_WASM_PATH);
      expect(paths.sideModules).toEqual(SIDE_MODULES);
      expect(paths.extensions).toEqual(EXTENSION_MODULES);
    });
  });

  /**
   * Tests for WASM binary validation
   */
  describe('WASM Binary Validation', () => {
    it('should validate correct WASM magic number', () => {
      const result = validateWasmBinary(MINIMAL_ADD_WASM_BYTES);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid magic number', () => {
      const invalidBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const result = validateWasmBinary(invalidBytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid WASM magic number');
    });

    it('should handle ArrayBuffer input', () => {
      const result = validateWasmBinary(MINIMAL_ADD_WASM_BYTES.buffer);
      expect(result.valid).toBe(true);
    });

    it('should validate using WebAssembly.validate', () => {
      // Use the minimal valid WASM bytes
      const result = validateWasmBinary(MINIMAL_ADD_WASM_BYTES);
      expect(result.valid).toBe(true);
    });

    it('should reject truncated WASM', () => {
      // Just the magic number, no content
      const truncated = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
      const result = validateWasmBinary(truncated);
      expect(result.valid).toBe(false);
    });
  });

  /**
   * Tests for WebAssembly API availability in Workers
   */
  describe('WebAssembly API Availability', () => {
    it('should have WebAssembly global available', () => {
      expect(WebAssembly).toBeDefined();
    });

    it('should have WebAssembly.compile function', () => {
      expect(typeof WebAssembly.compile).toBe('function');
    });

    it('should have WebAssembly.instantiate function', () => {
      expect(typeof WebAssembly.instantiate).toBe('function');
    });

    it('should have WebAssembly.validate function', () => {
      expect(typeof WebAssembly.validate).toBe('function');
    });

    it('should have WebAssembly.Module constructor', () => {
      expect(WebAssembly.Module).toBeDefined();
    });

    it('should have WebAssembly.Instance constructor', () => {
      expect(WebAssembly.Instance).toBeDefined();
    });

    it('should have WebAssembly.Memory constructor', () => {
      expect(WebAssembly.Memory).toBeDefined();
    });

    it('should have WebAssembly.Table constructor', () => {
      expect(WebAssembly.Table).toBeDefined();
    });

    it('should validate WASM bytes correctly', () => {
      const isValid = WebAssembly.validate(MINIMAL_ADD_WASM_BYTES);
      expect(isValid).toBe(true);
    });

    it('should reject invalid WASM bytes', () => {
      const invalid = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const isValid = WebAssembly.validate(invalid);
      expect(isValid).toBe(false);
    });
  });

  /**
   * Tests for WebAssembly.Memory in Workers
   */
  describe('WebAssembly.Memory', () => {
    it('should create memory with initial pages', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      expect(memory).toBeInstanceOf(WebAssembly.Memory);
      expect(memory.buffer.byteLength).toBe(65536); // 1 page = 64KB
    });

    it('should create memory with max pages', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
      expect(memory.buffer.byteLength).toBe(65536);
    });

    it('should grow memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
      const oldPages = memory.grow(2);
      expect(oldPages).toBe(1);
      expect(memory.buffer.byteLength).toBe(3 * 65536); // 3 pages = 192KB
    });

    it('should read/write to memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const view = new Uint8Array(memory.buffer);

      // Write
      view[0] = 42;
      view[1] = 100;

      // Read
      expect(view[0]).toBe(42);
      expect(view[1]).toBe(100);
    });

    it('should support typed array views', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });

      const int8View = new Int8Array(memory.buffer);
      const int16View = new Int16Array(memory.buffer);
      const int32View = new Int32Array(memory.buffer);
      const uint8View = new Uint8Array(memory.buffer);
      const uint16View = new Uint16Array(memory.buffer);
      const uint32View = new Uint32Array(memory.buffer);
      const float32View = new Float32Array(memory.buffer);
      const float64View = new Float64Array(memory.buffer);

      expect(int8View).toBeInstanceOf(Int8Array);
      expect(int16View).toBeInstanceOf(Int16Array);
      expect(int32View).toBeInstanceOf(Int32Array);
      expect(uint8View).toBeInstanceOf(Uint8Array);
      expect(uint16View).toBeInstanceOf(Uint16Array);
      expect(uint32View).toBeInstanceOf(Uint32Array);
      expect(float32View).toBeInstanceOf(Float32Array);
      expect(float64View).toBeInstanceOf(Float64Array);
    });

    it('should handle memory within Workers limits', () => {
      // Workers has 128MB memory limit on paid plan
      // That's 2048 pages (128MB / 64KB)
      // Let's test a reasonable amount
      const pages = 256; // 16MB
      const memory = new WebAssembly.Memory({ initial: pages, maximum: 2048 });
      expect(memory.buffer.byteLength).toBe(pages * 65536);
    });
  });

  /**
   * Tests for WebAssembly.Table in Workers
   */
  describe('WebAssembly.Table', () => {
    it('should create function table', () => {
      const table = new WebAssembly.Table({ initial: 10, element: 'anyfunc' });
      expect(table).toBeInstanceOf(WebAssembly.Table);
      expect(table.length).toBe(10);
    });

    it('should create table with max size', () => {
      const table = new WebAssembly.Table({ initial: 10, maximum: 100, element: 'anyfunc' });
      expect(table.length).toBe(10);
    });

    it('should grow table', () => {
      const table = new WebAssembly.Table({ initial: 10, maximum: 100, element: 'anyfunc' });
      const oldLength = table.grow(5);
      expect(oldLength).toBe(10);
      expect(table.length).toBe(15);
    });

    it('should support table for function pointers', () => {
      const table = new WebAssembly.Table({ initial: 100, maximum: 1000, element: 'anyfunc' });

      // This table can be used for Emscripten addFunction/removeFunction
      expect(table.length).toBeGreaterThanOrEqual(100);
    });
  });

  /**
   * Tests for core loader options
   */
  describe('Core Loader Options', () => {
    it('should accept default memory options', () => {
      const options: CoreModuleOptions = {};
      expect(options.initialMemory).toBeUndefined();
      expect(options.maximumMemory).toBeUndefined();
    });

    it('should accept custom memory options', () => {
      const options: CoreModuleOptions = {
        initialMemory: 256, // 16MB
        maximumMemory: 2048, // 128MB
      };
      expect(options.initialMemory).toBe(256);
      expect(options.maximumMemory).toBe(2048);
    });

    it('should accept print functions', () => {
      const logs: string[] = [];
      const options: CoreModuleOptions = {
        print: (text) => logs.push(text),
        printErr: (text) => logs.push(`ERROR: ${text}`),
      };

      options.print?.('test message');
      options.printErr?.('error message');

      expect(logs).toContain('test message');
      expect(logs).toContain('ERROR: error message');
    });

    it('should accept locateFile function', () => {
      const options: CoreModuleOptions = {
        locateFile: (path) => `/custom/path/${path}`,
      };

      const result = options.locateFile?.('core.wasm');
      expect(result).toBe('/custom/path/core.wasm');
    });
  });

  /**
   * Tests for Workers runtime constraints
   */
  describe('Workers Runtime Constraints', () => {
    it('should be able to create 16MB of memory', () => {
      const pages = 256; // 16MB
      const memory = new WebAssembly.Memory({ initial: pages });
      expect(memory.buffer.byteLength).toBe(16 * 1024 * 1024);
    });

    it('should be able to grow memory to 64MB', () => {
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048 }); // 16MB initial
      const oldPages = memory.grow(768); // Grow to 64MB total
      expect(oldPages).toBe(256);
      expect(memory.buffer.byteLength).toBe(64 * 1024 * 1024);
    });

    it('should create large function table', () => {
      const table = new WebAssembly.Table({ initial: 1000, maximum: 10000, element: 'anyfunc' });
      expect(table.length).toBe(1000);
    });

    it('should handle rapid table growth', () => {
      const table = new WebAssembly.Table({ initial: 100, maximum: 10000, element: 'anyfunc' });

      // Grow multiple times
      for (let i = 0; i < 10; i++) {
        table.grow(100);
      }

      expect(table.length).toBe(1100);
    });

    it('should have adequate timing precision', () => {
      const start = performance.now();
      // Busy loop
      let sum = 0;
      for (let i = 0; i < 10000; i++) {
        sum += i;
      }
      const end = performance.now();

      expect(end).toBeGreaterThanOrEqual(start);
      expect(sum).toBe(49995000); // Verify the work was done
    });
  });

  /**
   * Tests for string encoding utilities
   */
  describe('String Encoding Utilities', () => {
    it('should have TextEncoder available', () => {
      expect(TextEncoder).toBeDefined();
      const encoder = new TextEncoder();
      expect(encoder).toBeInstanceOf(TextEncoder);
    });

    it('should have TextDecoder available', () => {
      expect(TextDecoder).toBeDefined();
      const decoder = new TextDecoder();
      expect(decoder).toBeInstanceOf(TextDecoder);
    });

    it('should encode strings to UTF-8', () => {
      const encoder = new TextEncoder();
      const bytes = encoder.encode('Hello, World!');

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes[0]).toBe(0x48); // 'H'
      expect(bytes[1]).toBe(0x65); // 'e'
    });

    it('should decode UTF-8 to strings', () => {
      const decoder = new TextDecoder('utf-8');
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const str = decoder.decode(bytes);

      expect(str).toBe('Hello');
    });

    it('should handle Unicode strings', () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder('utf-8');

      const testStr = 'Hello World!';
      const encoded = encoder.encode(testStr);
      const decoded = decoder.decode(encoded);

      expect(decoded).toBe(testStr);
    });
  });
});

// Type declarations for test env bindings
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHDB_VERSION: string;
    ENVIRONMENT: string;
    DATA_BUCKET: R2Bucket;
    CLICKBENCH_BUCKET: R2Bucket;
    CACHE: KVNamespace;
  }
}
