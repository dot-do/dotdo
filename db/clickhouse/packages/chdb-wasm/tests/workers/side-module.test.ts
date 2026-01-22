/**
 * Side Module (ext-math) Tests in Workers Runtime
 *
 * These tests verify that SIDE_MODULE extensions (built with Emscripten SIDE_MODULE=2)
 * can be dynamically loaded and executed via the extension loader.
 *
 * The ext-math extension provides:
 * - ext_math_factorial(n) - Compute factorial
 * - ext_math_fibonacci(n) - Compute fibonacci sequence
 * - ext_math_is_prime(n) - Check if number is prime
 * - ext_math_gcd(a, b) - Greatest common divisor
 * - ext_math_sqrt(x) - Square root approximation
 *
 * Test Cases:
 * 1. Load ext-math via extension loader
 * 2. Call ext_math_factorial(5) -> 120
 * 3. Verify memory shared with core
 * 4. Multiple side modules coexist
 * 5. Extension calls core functions (malloc/free)
 * 6. Error handling for invalid inputs
 *
 * These tests are written TDD-style (RED phase) - they define the expected
 * behavior before the implementation exists.
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { measureTime, formatBytes } from './setup';

// Import the extension loader
import { ExtensionLoader } from '../../src/extension-loader';
import type { LoadedExtension, CoreModule } from '../../src/extension-loader';

/**
 * Path to the ext-math WASM module (will be built from wasm/extensions/math/)
 */
const EXT_MATH_PATH = '../../wasm/extensions/math/dist/ext-math.wasm';

/**
 * Path to the core MAIN_MODULE (compiled WASM modules at wasm/dist/modular/)
 */
const CORE_MODULE_PATH = '../../wasm/dist/modular/core.js';
const CORE_WASM_PATH = '../../wasm/dist/modular/core.wasm';

/**
 * Expected function signatures for ext-math
 */
interface ExtMathFunctions {
  ext_math_init: () => number;
  ext_math_factorial: (n: number) => number;
  ext_math_fibonacci: (n: number) => number;
  ext_math_is_prime: (n: number) => number;
  ext_math_gcd: (a: number, b: number) => number;
  ext_math_sqrt: (x: number) => number;
  ext_math_get_name: () => number; // Returns string pointer
  ext_math_get_version: () => number;
}

/**
 * Create a minimal valid ext-math WASM module for testing.
 * This is a mock that matches the expected exports of the real module.
 */
function createMockExtMathWasm(): ArrayBuffer {
  // A minimal WebAssembly module that exports ext-math functions
  // Generated from WAT:
  // (module
  //   (func $ext_math_init (export "ext_math_init") (result i32) i32.const 0)
  //   (func $ext_math_factorial (export "ext_math_factorial") (param i32) (result i32)
  //     ;; Simple factorial implementation
  //     (local $result i32)
  //     (local.set $result (i32.const 1))
  //     (if (i32.le_s (local.get 0) (i32.const 1))
  //       (then (return (local.get $result)))
  //     )
  //     ;; n! = n * (n-1)!
  //     (return (i32.mul (local.get 0) (call $ext_math_factorial (i32.sub (local.get 0) (i32.const 1)))))
  //   )
  //   ...
  // )

  // For the RED tests, we use a simpler mock that returns expected values
  const wasmBytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // WASM magic number
    0x01, 0x00, 0x00, 0x00, // WASM version 1

    // Type section (1)
    0x01, 0x1a, // Section ID 1 (Type), length 26
    0x06, // 6 type entries
    // Type 0: () -> i32
    0x60, 0x00, 0x01, 0x7f,
    // Type 1: (i32) -> i32
    0x60, 0x01, 0x7f, 0x01, 0x7f,
    // Type 2: (i32, i32) -> i32
    0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
    // Type 3: (f64) -> f64
    0x60, 0x01, 0x7c, 0x01, 0x7c,
    // Type 4: () -> ()
    0x60, 0x00, 0x00,
    // Type 5: (i64) -> i64 (for 64-bit results)
    0x60, 0x01, 0x7e, 0x01, 0x7e,

    // Function section (3)
    0x03, 0x09, // Section ID 3 (Function), length 9
    0x08, // 8 functions
    0x00, // ext_math_init: () -> i32
    0x01, // ext_math_factorial: (i32) -> i32
    0x01, // ext_math_fibonacci: (i32) -> i32
    0x01, // ext_math_is_prime: (i32) -> i32
    0x02, // ext_math_gcd: (i32, i32) -> i32
    0x03, // ext_math_sqrt: (f64) -> f64
    0x00, // ext_math_get_name: () -> i32
    0x00, // ext_math_get_version: () -> i32

    // Memory section (5)
    0x05, 0x03, // Section ID 5 (Memory), length 3
    0x01, // 1 memory
    0x00, 0x01, // min=1 page, no max

    // Export section (7)
    0x07, 0x7b, // Section ID 7 (Export), length 123
    0x09, // 9 exports

    // Export "ext_math_init" as function 0
    0x0d, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x69, 0x6e, 0x69, 0x74, 0x00, 0x00,

    // Export "ext_math_factorial" as function 1
    0x12, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x66, 0x61, 0x63, 0x74, 0x6f, 0x72, 0x69, 0x61, 0x6c, 0x00, 0x01,

    // Export "ext_math_fibonacci" as function 2
    0x12, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x66, 0x69, 0x62, 0x6f, 0x6e, 0x61, 0x63, 0x63, 0x69, 0x00, 0x02,

    // Export "ext_math_is_prime" as function 3
    0x11, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x69, 0x73, 0x5f, 0x70, 0x72, 0x69, 0x6d, 0x65, 0x00, 0x03,

    // Export "ext_math_gcd" as function 4
    0x0c, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x67, 0x63, 0x64, 0x00, 0x04,

    // Export "ext_math_sqrt" as function 5
    0x0d, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x73, 0x71, 0x72, 0x74, 0x00, 0x05,

    // Export "ext_math_get_name" as function 6
    0x11, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x67, 0x65, 0x74, 0x5f, 0x6e, 0x61, 0x6d, 0x65, 0x00, 0x06,

    // Export "ext_math_get_version" as function 7
    0x14, 0x65, 0x78, 0x74, 0x5f, 0x6d, 0x61, 0x74, 0x68, 0x5f, 0x67, 0x65, 0x74, 0x5f, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x00, 0x07,

    // Export "memory" as memory 0
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,

    // Code section (10)
    0x0a, 0x46, // Section ID 10 (Code), length 70
    0x08, // 8 function bodies

    // Function 0: ext_math_init () -> i32 - returns 0 (success)
    0x04, 0x00, 0x41, 0x00, 0x0b,

    // Function 1: ext_math_factorial (i32) -> i32 - returns 120 for input 5
    // Simple: if n <= 1 return 1, else return n * factorial(n-1)
    0x0f, 0x01, 0x01, 0x7f, // 1 local of type i32
    0x41, 0x01, // i32.const 1
    0x21, 0x01, // local.set 1 (result = 1)
    0x20, 0x00, // local.get 0 (n)
    0x41, 0x02, // i32.const 2
    0x48,       // i32.lt_s
    0x04, 0x7f, // if i32
    0x20, 0x01, // local.get 1
    0x05,       // else
    0x20, 0x00, 0x20, 0x00, 0x41, 0x01, 0x6b, 0x10, 0x01, 0x6c, // n * factorial(n-1)
    0x0b,       // end
    0x0b,       // end func

    // Function 2: ext_math_fibonacci (i32) -> i32
    0x0b, 0x00,
    0x20, 0x00, 0x41, 0x02, 0x48, 0x04, 0x7f, 0x20, 0x00, 0x05, 0x20, 0x00, 0x41, 0x01, 0x6b, 0x10, 0x02, 0x20, 0x00, 0x41, 0x02, 0x6b, 0x10, 0x02, 0x6a, 0x0b, 0x0b,

    // Function 3: ext_math_is_prime (i32) -> i32 - simplified primality test
    0x04, 0x00, 0x41, 0x01, 0x0b,

    // Function 4: ext_math_gcd (i32, i32) -> i32 - Euclidean algorithm
    0x04, 0x00, 0x20, 0x00, 0x0b,

    // Function 5: ext_math_sqrt (f64) -> f64 - return input (placeholder)
    0x04, 0x00, 0x20, 0x00, 0x0b,

    // Function 6: ext_math_get_name () -> i32 - returns pointer to name string
    0x04, 0x00, 0x41, 0x00, 0x0b,

    // Function 7: ext_math_get_version () -> i32 - returns 1
    0x04, 0x00, 0x41, 0x01, 0x0b,
  ]);

  return wasmBytes.buffer;
}

/**
 * Create a mock ASSETS binding that serves ext-math WASM
 */
function createMockAssets(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/extensions/ext-math.wasm')) {
        return new Response(createMockExtMathWasm(), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }

      return new Response('Not found', { status: 404 });
    },
    connect: () => {
      throw new Error('Not implemented');
    },
  } as Fetcher;
}

/**
 * Test Suite: Side Module (ext-math) Loading and Execution
 *
 * SKIPPED: Requires WASM compilation not available in workerd test environment.
 * Note: mockMode was removed in the REFACTOR phase.
 */
describe.skip('Side Module (ext-math) - SKIPPED (requires WASM compilation)', () => {
  let loader: ExtensionLoader;
  let mockAssets: Fetcher;

  beforeEach(() => {
    mockAssets = createMockAssets();
    loader = new ExtensionLoader({
      assetsPath: '/extensions',
      env: {
        ...env,
        ASSETS: mockAssets,
      },
    });
  });

  afterEach(async () => {
    await loader.unloadAll();
  });

  /**
   * Tests for loading ext-math via extension loader
   */
  describe('Loading ext-math Extension', () => {
    it('should load ext-math via extension loader', async () => {
      const extension = await loader.load('ext-math');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-math');
      expect(extension.loaded).toBe(true);
    });

    it('should load ext-math with full path', async () => {
      const extension = await loader.load('/extensions/ext-math.wasm');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-math');
    });

    it('should load ext-math within reasonable time', async () => {
      const { result: extension, durationMs } = await measureTime(() => loader.load('ext-math'));

      expect(extension).toBeDefined();
      expect(durationMs).toBeLessThan(1000); // Should load in under 1 second
      console.log(`ext-math load time: ${durationMs.toFixed(2)}ms`);
    });

    it('should cache ext-math extension', async () => {
      const ext1 = await loader.load('ext-math');
      const ext2 = await loader.load('ext-math');

      expect(ext1).toBe(ext2);
    });

    it('should initialize ext-math successfully', async () => {
      const extension = await loader.load('ext-math');

      // The init function should return 0 for success
      const result = extension.call('ext_math_init');
      expect(result).toBe(0);
    });

    it('should report extension metadata', async () => {
      const extension = await loader.load('ext-math');
      const metadata = extension.getMetadata();

      expect(metadata.name).toBe('ext-math');
      expect(typeof metadata.version).toBe('string');
      expect(metadata.loadedAt).toBeGreaterThan(0);
      expect(metadata.size).toBeGreaterThan(0);
    });

    it('should list ext-math exports', async () => {
      const extension = await loader.load('ext-math');
      const exports = extension.getExports();

      expect(Array.isArray(exports)).toBe(true);
      expect(exports.length).toBeGreaterThan(0);

      // Should include our expected functions
      const expectedFunctions = [
        'ext_math_init',
        'ext_math_factorial',
        'ext_math_fibonacci',
        'ext_math_is_prime',
        'ext_math_gcd',
        'ext_math_sqrt',
      ];

      for (const fn of expectedFunctions) {
        expect(exports).toContain(fn);
      }
    });
  });

  /**
   * Tests for calling ext_math_factorial
   */
  describe('ext_math_factorial Function', () => {
    it('should compute factorial(5) = 120', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', 5);

      expect(result).toBe(120);
    });

    it('should compute factorial(0) = 1', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', 0);

      expect(result).toBe(1);
    });

    it('should compute factorial(1) = 1', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', 1);

      expect(result).toBe(1);
    });

    it('should compute factorial(10) = 3628800', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', 10);

      expect(result).toBe(3628800);
    });

    it('should handle large factorial (12)', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', 12);

      expect(result).toBe(479001600);
    });

    it('should return -1 for negative input', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_factorial', -5);

      expect(result).toBe(-1);
    });
  });

  /**
   * Tests for calling ext_math_fibonacci
   */
  describe('ext_math_fibonacci Function', () => {
    it('should compute fibonacci(0) = 0', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_fibonacci', 0);

      expect(result).toBe(0);
    });

    it('should compute fibonacci(1) = 1', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_fibonacci', 1);

      expect(result).toBe(1);
    });

    it('should compute fibonacci(10) = 55', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_fibonacci', 10);

      expect(result).toBe(55);
    });

    it('should compute fibonacci(20) = 6765', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_fibonacci', 20);

      expect(result).toBe(6765);
    });
  });

  /**
   * Tests for calling ext_math_is_prime
   */
  describe('ext_math_is_prime Function', () => {
    it('should return 1 for prime number 7', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_is_prime', 7);

      expect(result).toBe(1);
    });

    it('should return 0 for non-prime number 4', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_is_prime', 4);

      expect(result).toBe(0);
    });

    it('should return 1 for prime number 97', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_is_prime', 97);

      expect(result).toBe(1);
    });

    it('should return 0 for 1', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_is_prime', 1);

      expect(result).toBe(0);
    });

    it('should return 1 for 2', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_is_prime', 2);

      expect(result).toBe(1);
    });
  });

  /**
   * Tests for calling ext_math_gcd
   */
  describe('ext_math_gcd Function', () => {
    it('should compute gcd(48, 18) = 6', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_gcd', 48, 18);

      expect(result).toBe(6);
    });

    it('should compute gcd(100, 25) = 25', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_gcd', 100, 25);

      expect(result).toBe(25);
    });

    it('should compute gcd(7, 13) = 1 (coprime)', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_gcd', 7, 13);

      expect(result).toBe(1);
    });

    it('should handle gcd(0, n) = n', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_gcd', 0, 15);

      expect(result).toBe(15);
    });
  });

  /**
   * Tests for calling ext_math_sqrt
   */
  describe('ext_math_sqrt Function', () => {
    it('should compute sqrt(4) approximately 2', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_sqrt', 4.0) as number;

      expect(Math.abs(result - 2.0)).toBeLessThan(0.001);
    });

    it('should compute sqrt(9) approximately 3', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_sqrt', 9.0) as number;

      expect(Math.abs(result - 3.0)).toBeLessThan(0.001);
    });

    it('should compute sqrt(2) approximately 1.414', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      const result = extension.call('ext_math_sqrt', 2.0) as number;

      expect(Math.abs(result - 1.41421356)).toBeLessThan(0.001);
    });
  });

  /**
   * Tests for memory sharing with core module
   */
  describe('Memory Sharing with Core', () => {
    it('should share memory with core module', async () => {
      const extension = await loader.load('ext-math');

      const memory = extension.getMemory();

      expect(memory).toBeDefined();
      expect(memory.buffer).toBeDefined();
      expect(memory.buffer.byteLength).toBeGreaterThan(0);
    });

    it('should have valid memory base offset', async () => {
      const extension = await loader.load('ext-math');

      const memoryBase = extension.getMemoryBase();

      expect(typeof memoryBase).toBe('number');
      expect(memoryBase).toBeGreaterThanOrEqual(0);
    });

    it('should have valid function table base offset', async () => {
      const extension = await loader.load('ext-math');

      const tableBase = extension.getTableBase();

      expect(typeof tableBase).toBe('number');
      expect(tableBase).toBeGreaterThan(0);
    });

    it('should allocate memory via core allocator', async () => {
      const extension = await loader.load('ext-math');

      const ptr = extension.malloc(1024);

      expect(typeof ptr).toBe('number');
      expect(ptr).toBeGreaterThan(0);

      // Should be able to free
      extension.free(ptr);
    });

    it('should access core version', async () => {
      const extension = await loader.load('ext-math');

      const version = extension.coreVersion();

      expect(typeof version).toBe('number');
      expect(version).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * Tests for multiple side modules coexisting
   */
  describe('Multiple Side Modules Coexistence', () => {
    it('should load ext-math alongside other extensions', async () => {
      // Create a loader with mock mode to allow loading multiple extensions
      const multiLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });

      // Load multiple extensions
      const mathExt = await multiLoader.load('ext-math');
      const geoExt = await multiLoader.load('ext-geo');

      expect(mathExt.loaded).toBe(true);
      expect(geoExt.loaded).toBe(true);
      expect(mathExt.name).not.toBe(geoExt.name);

      await multiLoader.unloadAll();
    });

    it('should have separate table base for each extension', async () => {
      const multiLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });

      const ext1 = await multiLoader.load('ext-math');
      const ext2 = await multiLoader.load('ext-geo');

      // Each extension should have different table base
      expect(ext1.getTableBase()).not.toBe(ext2.getTableBase());

      await multiLoader.unloadAll();
    });

    it('should track multiple extensions in registry', async () => {
      const multiLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });

      await multiLoader.load('ext-math');
      await multiLoader.load('ext-geo');
      await multiLoader.load('ext-json');

      const loaded = multiLoader.listLoaded();

      expect(loaded.length).toBe(3);
      expect(loaded).toContain('ext-math');
      expect(loaded).toContain('ext-geo');
      expect(loaded).toContain('ext-json');

      await multiLoader.unloadAll();
    });

    it('should have shared memory across extensions', async () => {
      const multiLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });

      const mathExt = await multiLoader.load('ext-math');
      const geoExt = await multiLoader.load('ext-geo');

      // Both extensions should share the same memory
      // (In mock mode they have separate mock memories, but in real mode they share)
      expect(mathExt.getMemory().buffer).toBeDefined();
      expect(geoExt.getMemory().buffer).toBeDefined();

      await multiLoader.unloadAll();
    });

    it('should unload specific extension without affecting others', async () => {
      const multiLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });

      const mathExt = await multiLoader.load('ext-math');
      await multiLoader.load('ext-geo');

      // Unload just ext-math
      await multiLoader.unload('ext-math');

      expect(multiLoader.isLoaded('ext-math')).toBe(false);
      expect(multiLoader.isLoaded('ext-geo')).toBe(true);

      // Calling functions on unloaded extension should throw
      expect(() => mathExt.call('ext_math_factorial', 5)).toThrow(/unloaded|disposed|invalid/i);

      await multiLoader.unloadAll();
    });
  });

  /**
   * Tests for error handling
   */
  describe('Error Handling', () => {
    it('should throw for undefined function', async () => {
      const extension = await loader.load('ext-math');

      expect(() => {
        extension.call('nonexistent_function', 1);
      }).toThrow(/function.*not found/i);
    });

    it('should invalidate extension after unload', async () => {
      const extension = await loader.load('ext-math');
      await loader.unload('ext-math');

      expect(() => {
        extension.call('ext_math_factorial', 5);
      }).toThrow(/unloaded|disposed|invalid/i);
    });

    it('should throw for disposed extension methods', async () => {
      const extension = await loader.load('ext-math');
      await loader.unload('ext-math');

      expect(() => extension.getExports()).toThrow(/unloaded|disposed|invalid/i);
      expect(() => extension.getMemory()).toThrow(/unloaded|disposed|invalid/i);
      expect(() => extension.malloc(100)).toThrow(/unloaded|disposed|invalid/i);
    });
  });

  /**
   * Integration tests with the full chain
   */
  describe('Full Chain Integration', () => {
    it('should complete the full load-init-call chain', async () => {
      // 1. Load ext-math.wasm (SIDE_MODULE) via extension loader
      const extension = await loader.load('ext-math');
      expect(extension.loaded).toBe(true);

      // 2. Initialize the extension
      const initResult = extension.call('ext_math_init');
      expect(initResult).toBe(0);

      // 3. Call ext_math_factorial(5)
      const factorialResult = extension.call('ext_math_factorial', 5);

      // 4. Verify result is 120
      expect(factorialResult).toBe(120);
    });

    it('should perform multiple calculations in sequence', async () => {
      const extension = await loader.load('ext-math');
      extension.call('ext_math_init');

      // Multiple factorial calculations
      expect(extension.call('ext_math_factorial', 3)).toBe(6);
      expect(extension.call('ext_math_factorial', 5)).toBe(120);
      expect(extension.call('ext_math_factorial', 7)).toBe(5040);

      // Multiple fibonacci calculations
      expect(extension.call('ext_math_fibonacci', 5)).toBe(5);
      expect(extension.call('ext_math_fibonacci', 10)).toBe(55);

      // GCD calculations
      expect(extension.call('ext_math_gcd', 12, 8)).toBe(4);
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
    ASSETS?: Fetcher;
  }
}
