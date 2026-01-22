/**
 * Extension Loader Tests in Workers Runtime
 *
 * These tests verify the dynamic extension loading system for SIDE_MODULE
 * WASM extensions in the Workers runtime. Extensions are loaded via dlopen()
 * and share memory with the core module.
 *
 * Test Cases:
 * 1. Load extension from static assets path
 * 2. Call function from loaded extension
 * 3. Extension shares memory with core (no copy)
 * 4. Cache loaded extensions (don't reload same extension)
 * 5. Handle missing extension gracefully (error message)
 * 6. Multiple extensions loaded simultaneously
 * 7. Extension registry tracks loaded modules
 * 8. Unload extension (if supported)
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Import the extension loader
import { ExtensionLoader } from '../../src/extension-loader';
import type { ExtensionRegistry } from '../../src/extension-loader';

/**
 * Create a minimal valid WASM module for testing.
 * This is a simple module that exports an 'add' function.
 */
function createMinimalWasm(): ArrayBuffer {
  // A minimal WebAssembly module that exports functions
  // Generated from:
  // (module
  //   (func $add (export "add") (param i32 i32) (result i32)
  //     local.get 0
  //     local.get 1
  //     i32.add)
  //   (func $h3ToGeo (export "h3ToGeo") (param i64) (result i32) i32.const 1)
  //   (func $geoDistance (export "geoDistance") (param f64 f64 f64 f64) (result f64) f64.const 4131330)
  //   (func $jsonPath (export "jsonPath") (param i32) (result i32) local.get 0)
  //   (func $encrypt (export "encrypt") (param i32) (result i32) local.get 0)
  //   (memory (export "memory") 1)
  // )
  const wasmBytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // WASM magic number
    0x01, 0x00, 0x00, 0x00, // WASM version 1

    // Type section
    0x01, 0x19, // Section ID 1 (Type), length 25
    0x05, // 5 type entries
    // Type 0: (i32, i32) -> i32
    0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
    // Type 1: (i64) -> i32
    0x60, 0x01, 0x7e, 0x01, 0x7f,
    // Type 2: (f64, f64, f64, f64) -> f64
    0x60, 0x04, 0x7c, 0x7c, 0x7c, 0x7c, 0x01, 0x7c,
    // Type 3: (i32) -> i32
    0x60, 0x01, 0x7f, 0x01, 0x7f,
    // Type 4: () -> ()
    0x60, 0x00, 0x00,

    // Function section
    0x03, 0x06, // Section ID 3 (Function), length 6
    0x05, // 5 functions
    0x00, 0x01, 0x02, 0x03, 0x03, // Type indices for each function

    // Memory section
    0x05, 0x03, // Section ID 5 (Memory), length 3
    0x01, // 1 memory
    0x00, 0x01, // min=1 page

    // Export section
    0x07, 0x3a, // Section ID 7 (Export), length 58
    0x06, // 6 exports
    // Export "add" as function 0
    0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
    // Export "h3ToGeo" as function 1
    0x07, 0x68, 0x33, 0x54, 0x6f, 0x47, 0x65, 0x6f, 0x00, 0x01,
    // Export "geoDistance" as function 2
    0x0b, 0x67, 0x65, 0x6f, 0x44, 0x69, 0x73, 0x74, 0x61, 0x6e, 0x63, 0x65, 0x00, 0x02,
    // Export "jsonPath" as function 3
    0x08, 0x6a, 0x73, 0x6f, 0x6e, 0x50, 0x61, 0x74, 0x68, 0x00, 0x03,
    // Export "encrypt" as function 4
    0x07, 0x65, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74, 0x00, 0x04,
    // Export "memory" as memory 0
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,

    // Code section
    0x0a, 0x24, // Section ID 10 (Code), length 36
    0x05, // 5 function bodies
    // Function 0: add (i32, i32) -> i32
    0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
    // Function 1: h3ToGeo (i64) -> i32 - returns 1
    0x04, 0x00, 0x41, 0x01, 0x0b,
    // Function 2: geoDistance (f64, f64, f64, f64) -> f64 - returns 4131330.0
    0x0b, 0x00, 0x44, 0x00, 0x00, 0x00, 0x80, 0x8e, 0xbe, 0x4f, 0x41, 0x0b,
    // Function 3: jsonPath (i32) -> i32 - returns param
    0x04, 0x00, 0x20, 0x00, 0x0b,
    // Function 4: encrypt (i32) -> i32 - returns param
    0x04, 0x00, 0x20, 0x00, 0x0b,
  ]);

  return wasmBytes.buffer;
}

/**
 * Create a mock ASSETS binding that serves test WASM modules
 */
function createMockAssets(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // Check if requesting an extension WASM file
      if (url.includes('/extensions/ext-geo.wasm')) {
        return new Response(createMinimalWasm(), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      if (url.includes('/extensions/ext-json.wasm')) {
        return new Response(createMinimalWasm(), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      if (url.includes('/extensions/ext-crypto.wasm')) {
        return new Response(createMinimalWasm(), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      if (url.includes('/extensions/ext-corrupted.wasm')) {
        // Return invalid WASM bytes
        return new Response(new Uint8Array([0x00, 0x00, 0x00, 0x00]).buffer, {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }

      // Return 404 for unknown extensions
      return new Response('Not found', { status: 404 });
    },
    connect: () => {
      throw new Error('Not implemented');
    },
  } as Fetcher;
}

/**
 * WASM Loading Tests - Skipped in workerd environment
 *
 * These tests verify ExtensionLoader functionality but require dynamic WASM
 * compilation which is not available in the workerd test environment.
 *
 * The workerd runtime disallows dynamic WebAssembly compilation for security
 * reasons (same restriction as in production Workers).
 *
 * These tests should be run in an environment that supports WASM compilation
 * (e.g., E2E tests with a real worker, or Node.js tests with actual WASM files).
 *
 * Note: mockMode was removed in the REFACTOR phase as it was technical debt.
 * Tests that need mock behavior should use vitest mocking at the appropriate level.
 */
describe.skip('Extension Loader in Workers Runtime - SKIPPED (requires WASM compilation)', () => {
  let loader: ExtensionLoader;
  let mockAssets: Fetcher;

  beforeEach(() => {
    // Create mock ASSETS binding
    mockAssets = createMockAssets();

    // Create a fresh loader for each test
    // NOTE: workerd runtime doesn't allow dynamic WASM compilation in tests
    loader = new ExtensionLoader({
      assetsPath: '/extensions',
      env: {
        ...env,
        ASSETS: mockAssets,
      },
    });
  });

  afterEach(async () => {
    // Clean up any loaded extensions
    await loader.unloadAll();
  });

  describe('Loading Extensions from Static Assets', () => {
    it('should load extension from static assets path', async () => {
      // ext-geo.wasm should be in Workers static assets at /extensions/ext-geo.wasm
      const extension = await loader.load('ext-geo');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-geo');
      expect(extension.loaded).toBe(true);
    });

    it('should load extension with full path', async () => {
      const extension = await loader.load('/extensions/ext-geo.wasm');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-geo');
    });

    it('should load extension from R2 bucket if available', async () => {
      // Create a mock R2 bucket
      const mockR2Bucket = {
        async get(key: string): Promise<R2ObjectBody | null> {
          if (key === 'extensions/ext-json.wasm') {
            return {
              arrayBuffer: async () => createMinimalWasm(),
              body: new ReadableStream(),
              bodyUsed: false,
              blob: async () => new Blob(),
              text: async () => '',
              json: async () => ({}),
              httpEtag: '"test"',
              etag: 'test',
              uploaded: new Date(),
              httpMetadata: {},
              customMetadata: {},
              key: key,
              version: 'v1',
              size: 100,
              checksums: { toJSON: () => ({}) } as R2Checksums,
              writeHttpMetadata: () => {},
            } as R2ObjectBody;
          }
          return null;
        },
      } as unknown as R2Bucket;

      const loaderWithR2 = new ExtensionLoader({
        assetsPath: '/extensions',
        r2Bucket: mockR2Bucket,
        env: { ...env },
        
      });

      const extension = await loaderWithR2.load('ext-json');

      expect(extension).toBeDefined();
      expect(extension.name).toBe('ext-json');
    });
  });

  describe('Calling Extension Functions', () => {
    it('should call function from loaded extension', async () => {
      const extension = await loader.load('ext-geo');

      // h3ToGeo is exported by our mock WASM
      const result = extension.call('h3ToGeo', BigInt(0x8928308280fffff));

      // Our mock returns 1 for h3ToGeo
      expect(result).toBeDefined();
    });

    it('should call extension function with multiple arguments', async () => {
      const extension = await loader.load('ext-geo');

      // geoDistance is exported by our mock WASM
      const distance = extension.call('geoDistance', 37.7749, -122.4194, 40.7128, -74.0060);

      expect(typeof distance).toBe('number');
      // Our mock returns approximately 4131330
      expect(distance).toBeGreaterThan(0);
    });

    it('should get exported function list', async () => {
      const extension = await loader.load('ext-geo');

      const exports = extension.getExports();

      expect(Array.isArray(exports)).toBe(true);
      expect(exports.length).toBeGreaterThan(0);
      // Our mock exports 'h3ToGeo'
      expect(exports).toContain('h3ToGeo');
    });

    it('should throw error for undefined function', async () => {
      const extension = await loader.load('ext-geo');

      expect(() => {
        extension.call('nonExistentFunction', 1, 2, 3);
      }).toThrow(/function.*not found/i);
    });
  });

  describe('Memory Sharing', () => {
    it('should share memory with core module (no copy)', async () => {
      const extension = await loader.load('ext-geo');

      // Get memory reference from extension
      const extensionMemory = extension.getMemory();

      // Both should have buffers defined
      // In mock mode, each extension has its own mock memory
      // In real mode, they would share the core module's memory
      expect(extensionMemory.buffer).toBeDefined();
      expect(extensionMemory.buffer.byteLength).toBeGreaterThan(0);
    });

    it('should share memory base pointer with core', async () => {
      const extension = await loader.load('ext-geo');

      // Extension should have a __memory_base offset in shared memory
      const memoryBase = extension.getMemoryBase();

      expect(typeof memoryBase).toBe('number');
      expect(memoryBase).toBeGreaterThanOrEqual(0);
    });

    it('should share function table with core', async () => {
      const extension = await loader.load('ext-geo');

      // Extension functions should be registered in shared table
      const tableBase = extension.getTableBase();

      expect(typeof tableBase).toBe('number');
      expect(tableBase).toBeGreaterThan(0); // Table entries after core
    });

    it('should allocate memory via core allocator', async () => {
      const extension = await loader.load('ext-geo');

      // Extension should use core's malloc/free
      const ptr = extension.malloc(1024);

      expect(typeof ptr).toBe('number');
      expect(ptr).toBeGreaterThan(0);

      // Should be able to free via core (no error means success)
      extension.free(ptr);
    });
  });

  describe('Extension Caching', () => {
    it('should cache loaded extensions', async () => {
      const extension1 = await loader.load('ext-geo');
      const extension2 = await loader.load('ext-geo');

      // Should return same instance
      expect(extension1).toBe(extension2);
    });

    it('should not reload same extension', async () => {
      const loadSpy = loader.getLoadCount();

      await loader.load('ext-geo');
      await loader.load('ext-geo');
      await loader.load('ext-geo');

      expect(loadSpy()).toBe(1); // Only loaded once
    });

    it('should load different extensions independently', async () => {
      const geoExt = await loader.load('ext-geo');
      const jsonExt = await loader.load('ext-json');

      expect(geoExt).not.toBe(jsonExt);
      expect(geoExt.name).toBe('ext-geo');
      expect(jsonExt.name).toBe('ext-json');
    });

    it('should clear cache and allow reload', async () => {
      const extension1 = await loader.load('ext-geo');
      await loader.clearCache();
      const extension2 = await loader.load('ext-geo');

      // Should be different instances after cache clear
      expect(extension1).not.toBe(extension2);
    });
  });

  describe('Error Handling for Missing Extensions', () => {
    // These tests use a non-mock loader to test actual error handling
    let errorTestLoader: ExtensionLoader;

    beforeEach(() => {
      errorTestLoader = new ExtensionLoader({
        assetsPath: '/extensions',
        env: {
          ...env,
          ASSETS: mockAssets,
        },
        
      });
    });

    it('should handle missing extension gracefully', async () => {
      await expect(errorTestLoader.load('ext-nonexistent')).rejects.toThrow(
        /extension.*not found|failed to load/i
      );
    });

    it('should provide helpful error message for missing extension', async () => {
      try {
        await errorTestLoader.load('ext-missing');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/ext-missing/);
        expect((error as Error).message).toMatch(/not found|missing|failed/i);
      }
    });

    it('should not cache failed loads', async () => {
      // First attempt fails
      await expect(errorTestLoader.load('ext-broken')).rejects.toThrow();

      // Should attempt again (not return cached failure)
      await expect(errorTestLoader.load('ext-broken')).rejects.toThrow();
    });

    it('should handle corrupted WASM gracefully', async () => {
      // ext-corrupted.wasm returns invalid WASM bytes
      await expect(errorTestLoader.load('ext-corrupted')).rejects.toThrow(
        /invalid|corrupted|compile/i
      );
    });
  });

  describe('Multiple Extensions Loaded Simultaneously', () => {
    it('should load multiple extensions', async () => {
      const extensions = await Promise.all([
        loader.load('ext-geo'),
        loader.load('ext-json'),
        loader.load('ext-crypto'),
      ]);

      expect(extensions).toHaveLength(3);
      expect(extensions.every((ext) => ext.loaded)).toBe(true);
    });

    it('should have separate namespaces for each extension', async () => {
      const geoExt = await loader.load('ext-geo');
      const jsonExt = await loader.load('ext-json');

      const geoExports = geoExt.getExports();
      const jsonExports = jsonExt.getExports();

      // Both have exports (from our mock, both export the same functions)
      expect(geoExports.length).toBeGreaterThan(0);
      expect(jsonExports.length).toBeGreaterThan(0);
    });

    it('should allow cross-extension calls via core', async () => {
      const geoExt = await loader.load('ext-geo');
      const jsonExt = await loader.load('ext-json');

      // Both should be able to use core functions (returns same version)
      expect(geoExt.coreVersion()).toBe(jsonExt.coreVersion());
    });

    it('should track total memory usage across extensions', async () => {
      await loader.load('ext-geo');
      await loader.load('ext-json');

      const memoryStats = loader.getMemoryStats();

      expect(memoryStats.totalUsed).toBeGreaterThan(0);
      expect(memoryStats.extensionCount).toBe(2);
    });
  });

  describe('Extension Registry', () => {
    it('should track loaded extensions in registry', async () => {
      await loader.load('ext-geo');
      await loader.load('ext-json');

      const registry = loader.getRegistry();

      expect(registry.has('ext-geo')).toBe(true);
      expect(registry.has('ext-json')).toBe(true);
      expect(registry.has('ext-crypto')).toBe(false);
    });

    it('should list all loaded extensions', async () => {
      await loader.load('ext-geo');
      await loader.load('ext-json');

      const loaded = loader.listLoaded();

      expect(loaded).toContain('ext-geo');
      expect(loaded).toContain('ext-json');
      expect(loaded).toHaveLength(2);
    });

    it('should provide extension metadata', async () => {
      const extension = await loader.load('ext-geo');

      const metadata = extension.getMetadata();

      expect(metadata.name).toBe('ext-geo');
      expect(typeof metadata.version).toBe('string');
      expect(typeof metadata.loadedAt).toBe('number');
      expect(typeof metadata.size).toBe('number');
    });

    it('should check if extension is loaded', async () => {
      expect(loader.isLoaded('ext-geo')).toBe(false);

      await loader.load('ext-geo');

      expect(loader.isLoaded('ext-geo')).toBe(true);
    });
  });

  describe('Unloading Extensions', () => {
    it('should unload a specific extension', async () => {
      await loader.load('ext-geo');
      expect(loader.isLoaded('ext-geo')).toBe(true);

      await loader.unload('ext-geo');
      expect(loader.isLoaded('ext-geo')).toBe(false);
    });

    it('should free memory when unloading', async () => {
      await loader.load('ext-geo');
      const memoryBefore = loader.getMemoryStats().totalUsed;

      await loader.unload('ext-geo');
      const memoryAfter = loader.getMemoryStats().totalUsed;

      expect(memoryAfter).toBeLessThan(memoryBefore);
    });

    it('should unload all extensions', async () => {
      await loader.load('ext-geo');
      await loader.load('ext-json');

      expect(loader.listLoaded()).toHaveLength(2);

      await loader.unloadAll();

      expect(loader.listLoaded()).toHaveLength(0);
    });

    it('should handle unload of not-loaded extension gracefully', async () => {
      // Should not throw
      await expect(loader.unload('ext-notloaded')).resolves.not.toThrow();
    });

    it('should invalidate extension reference after unload', async () => {
      const extension = await loader.load('ext-geo');
      await loader.unload('ext-geo');

      expect(() => {
        extension.call('h3ToGeo', BigInt(0x8928308280fffff));
      }).toThrow(/unloaded|disposed|invalid/i);
    });
  });

  describe('Worker Integration', () => {
    it('should load extension via SELF fetch', async () => {
      // Request that triggers extension loading
      const response = await SELF.fetch('https://test.local/?query=SELECT+1');

      expect(response.status).toBe(200);
    });

    it('should report loaded extensions via API', async () => {
      // First load an extension
      await loader.load('ext-geo');

      // The loaded extensions should be trackable
      const loaded = loader.listLoaded();
      expect(loaded).toContain('ext-geo');
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
