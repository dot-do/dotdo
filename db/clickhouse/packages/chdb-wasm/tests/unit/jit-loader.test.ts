/**
 * JIT Loader Tests
 *
 * These tests verify the Just-In-Time loading system for WASM modules.
 * The JitLoader provides on-demand loading of WASM modules based on
 * query requirements with a 3-tier caching strategy.
 *
 * Run with: pnpm test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  JitLoader,
  createJitLoader,
  prepareQuery,
  type ModuleMetadata,
} from '../../src/jit-loader';

// ============================================================================
// Mock WebAssembly.compile
// ============================================================================

// Store original WebAssembly.compile
const originalCompile = WebAssembly.compile;
const mockModules = new Map<ArrayBuffer, WebAssembly.Module>();

/**
 * Create a mock WebAssembly.Module that can be identified
 */
function createMockWasmModule(): WebAssembly.Module {
  // Create a minimal valid WASM module binary
  const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

  // Create a sentinel module (we just need something to return)
  // In the test environment, we'll use a proxy to track it
  const mockModule = {} as WebAssembly.Module;

  // Associate this mock with a unique buffer for testing
  mockModules.set(wasmBinary, mockModule);

  return mockModule;
}

/**
 * Setup mock WebAssembly.compile
 */
function setupWasmMock() {
  // Mock WebAssembly.compile to return a tracked mock module
  (WebAssembly as unknown as { compile: typeof WebAssembly.compile }).compile = vi.fn(
    async (buffer: BufferSource): Promise<WebAssembly.Module> => {
      // Return a mock module object
      return createMockWasmModule();
    }
  );
}

/**
 * Restore original WebAssembly.compile
 */
function restoreWasmMock() {
  (WebAssembly as unknown as { compile: typeof WebAssembly.compile }).compile = originalCompile;
  mockModules.clear();
}

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Create a mock WASM binary
 */
function createMockWasmBinary(): ArrayBuffer {
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;
}

/**
 * Create a mock R2 bucket with configurable responses
 */
function createMockR2Bucket(moduleNames: string[] = []) {
  const wasmBinary = createMockWasmBinary();
  return {
    get: vi.fn(async (key: string) => {
      const match = key.match(/wasm\/(.+)\.wasm$/);
      const name = match ? match[1] : key;
      if (!moduleNames.includes(name)) return null;
      return {
        key,
        size: wasmBinary.byteLength,
        arrayBuffer: () => Promise.resolve(wasmBinary),
      };
    }),
    head: vi.fn(async (key: string) => {
      const match = key.match(/wasm\/(.+)\.wasm$/);
      const name = match ? match[1] : key;
      if (!moduleNames.includes(name)) return null;
      return { size: wasmBinary.byteLength };
    }),
  };
}

/**
 * Create a mock KV namespace with in-memory storage
 */
function createMockKVNamespace() {
  const storage = new Map<string, ArrayBuffer | string>();
  return {
    get: vi.fn(async (key: string, options?: { type?: string }) => {
      const value = storage.get(key);
      if (!value) return null;
      if (options?.type === 'json') {
        return typeof value === 'string' ? JSON.parse(value) : null;
      }
      if (options?.type === 'arrayBuffer') {
        return value instanceof ArrayBuffer ? value : null;
      }
      return value;
    }),
    put: vi.fn(async (key: string, value: string | ArrayBuffer) => {
      storage.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    _storage: storage, // For testing
  };
}

/**
 * Create a mock static assets fetcher
 */
function createMockAssets(moduleNames: string[] = []) {
  const wasmBinary = createMockWasmBinary();
  return {
    fetch: vi.fn(async (request: Request | string) => {
      const url = typeof request === 'string' ? request : request.url;
      const match = url.match(/\/extensions\/(.+)\.wasm$/);
      const name = match ? match[1] : null;
      if (!name || !moduleNames.includes(name)) {
        return new Response(null, { status: 404 });
      }
      return new Response(wasmBinary);
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('JitLoader', () => {
  beforeEach(() => {
    setupWasmMock();
  });

  afterEach(() => {
    restoreWasmMock();
  });

  describe('Query Analysis', () => {
    let loader: JitLoader;

    beforeEach(() => {
      loader = new JitLoader();
    });

    it('should analyze query and detect geo extension', () => {
      const modules = loader.analyzeQuery('SELECT h3ToGeo(cell) FROM data');
      expect(modules).toContain('ext-geo');
    });

    it('should analyze query and detect json extension', () => {
      const modules = loader.analyzeQuery("SELECT JSONPath(data, '$.name') FROM events");
      expect(modules).toContain('ext-json');
    });

    it('should analyze query and detect crypto extension', () => {
      const modules = loader.analyzeQuery("SELECT encrypt('aes', data, key) FROM secrets");
      expect(modules).toContain('ext-crypto');
    });

    it('should detect multiple extensions', () => {
      const sql = `
        SELECT
          h3ToGeo(cell) AS geo,
          JSONExtractString(data, 'name') AS name,
          sha256(secret) AS hash
        FROM table
      `;
      const modules = loader.analyzeQuery(sql);

      expect(modules).toContain('ext-geo');
      expect(modules).toContain('ext-json');
      expect(modules).toContain('ext-crypto');
    });

    it('should return empty array for core-only functions', () => {
      const modules = loader.analyzeQuery('SELECT COUNT(*), SUM(amount), now()');
      expect(modules).toHaveLength(0);
    });

    it('should handle empty SQL', () => {
      expect(loader.analyzeQuery('')).toHaveLength(0);
      expect(loader.analyzeQuery('   ')).toHaveLength(0);
    });

    it('should get functions from query', () => {
      const functions = loader.getQueryFunctions('SELECT h3ToGeo(a), count(*) FROM t');
      expect(functions).toContain('h3togeo');
      expect(functions).toContain('count');
    });

    it('should get extension for function', () => {
      expect(loader.getExtensionForFunction('h3ToGeo')).toBe('ext-geo');
      expect(loader.getExtensionForFunction('JSONPath')).toBe('ext-json');
      expect(loader.getExtensionForFunction('encrypt')).toBe('ext-crypto');
      expect(loader.getExtensionForFunction('count')).toBeNull();
    });
  });

  describe('Module Loading', () => {
    it('should track cache statistics', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      // First load - cache miss
      await loader.loadModules(['ext-geo']);

      let stats = loader.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.memoryEntries).toBe(1);

      // Second load - cache hit
      await loader.loadModules(['ext-geo']);

      stats = loader.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should load from R2 bucket', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-geo']);

      expect(result.loaded).toContain('ext-geo');
      expect(result.failed).toHaveLength(0);
      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
    });

    it('should load from static assets', async () => {
      const assets = createMockAssets(['ext-geo']);

      const loader = new JitLoader({ assets });

      const result = await loader.loadModules(['ext-geo']);

      expect(result.loaded).toContain('ext-geo');
      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
    });

    it('should use KV cache when available', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);
      const kvNamespace = createMockKVNamespace();

      const loader = new JitLoader({ r2Bucket, kvNamespace });

      // First load - from R2, cached to KV
      await loader.loadModules(['ext-geo']);
      expect(r2Bucket.get).toHaveBeenCalled();
      expect(kvNamespace.put).toHaveBeenCalled();
    });

    it('should cache loaded modules in memory', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      // First load
      await loader.loadModules(['ext-geo']);
      expect(r2Bucket.get).toHaveBeenCalledTimes(1);

      // Second load - should hit memory cache
      const result = await loader.loadModules(['ext-geo']);
      expect(result.cached).toContain('ext-geo');
      expect(r2Bucket.get).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should load multiple modules in parallel', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo', 'ext-json', 'ext-crypto']);

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-geo', 'ext-json', 'ext-crypto']);

      expect(result.loaded).toHaveLength(3);
      expect(result.loaded).toContain('ext-geo');
      expect(result.loaded).toContain('ext-json');
      expect(result.loaded).toContain('ext-crypto');
    });

    it('should handle module not found', async () => {
      const r2Bucket = createMockR2Bucket([]);

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-nonexistent']);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].name).toBe('ext-nonexistent');
      expect(result.failed[0].error).toContain('not found');
    });

    it('should report timing information', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-geo']);

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Module Status', () => {
    it('should check if module is loaded', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      expect(loader.isModuleLoaded('ext-geo')).toBe(false);

      await loader.loadModules(['ext-geo']);

      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
    });

    it('should get loaded module', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      expect(loader.getModule('ext-geo')).toBeNull();

      await loader.loadModules(['ext-geo']);

      const module = loader.getModule('ext-geo');
      expect(module).not.toBeNull();
    });

    it('should get module status', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      // Before loading
      let status = loader.getModuleStatus('ext-geo');
      expect(status).toEqual({ name: 'ext-geo', loaded: false });

      // After loading
      await loader.loadModules(['ext-geo']);
      status = loader.getModuleStatus('ext-geo');

      expect(status?.loaded).toBe(true);
      expect(status?.size).toBeDefined();
      expect(status?.source).toBe('r2');
      expect(status?.loadedAt).toBeDefined();
    });

    it('should get all module statuses', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo', 'ext-json']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo', 'ext-json']);

      const statuses = loader.getAllModuleStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.name)).toContain('ext-geo');
      expect(statuses.map((s) => s.name)).toContain('ext-json');
    });

    it('should list loaded modules', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo', 'ext-json']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo', 'ext-json']);

      const loaded = loader.listLoadedModules();
      expect(loaded).toContain('ext-geo');
      expect(loaded).toContain('ext-json');
    });
  });

  describe('Metadata Management', () => {
    it('should set and get module metadata', async () => {
      const kvNamespace = createMockKVNamespace();
      const loader = new JitLoader({ kvNamespace });

      const metadata: Omit<ModuleMetadata, 'name' | 'updatedAt'> = {
        version: '1.0.0',
        size: 1024,
        functions: ['func1', 'func2'],
        dependencies: ['ext-core'],
        r2Key: 'wasm/ext-test.wasm',
        hash: 'abc123',
      };

      await loader.setModuleMetadata('ext-test', metadata);

      const retrieved = await loader.getModuleMetadata('ext-test');

      expect(retrieved?.version).toBe('1.0.0');
      expect(retrieved?.size).toBe(1024);
      expect(retrieved?.functions).toContain('func1');
      expect(retrieved?.name).toBe('ext-test');
      expect(retrieved?.updatedAt).toBeDefined();
    });

    it('should cache metadata locally', async () => {
      const kvNamespace = createMockKVNamespace();
      const loader = new JitLoader({ kvNamespace });

      await loader.setModuleMetadata('ext-test', {
        version: '1.0.0',
        size: 1024,
        functions: [],
        dependencies: [],
        r2Key: 'wasm/ext-test.wasm',
        hash: 'abc123',
      });

      // First get - from local cache (set already populates cache)
      await loader.getModuleMetadata('ext-test');

      // Second get - should still use local cache
      await loader.getModuleMetadata('ext-test');

      // KV.get should not be called because setModuleMetadata populates local cache
      expect(kvNamespace.get).toHaveBeenCalledTimes(0);
    });
  });

  describe('Cache Management', () => {
    it('should unload a module', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo']);
      expect(loader.isModuleLoaded('ext-geo')).toBe(true);

      const unloaded = loader.unloadModule('ext-geo');
      expect(unloaded).toBe(true);
      expect(loader.isModuleLoaded('ext-geo')).toBe(false);
    });

    it('should return false when unloading non-existent module', () => {
      const loader = new JitLoader();

      const unloaded = loader.unloadModule('ext-nonexistent');
      expect(unloaded).toBe(false);
    });

    it('should clear memory cache', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo', 'ext-json']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo', 'ext-json']);
      expect(loader.listLoadedModules()).toHaveLength(2);

      loader.clearMemoryCache();
      expect(loader.listLoadedModules()).toHaveLength(0);
    });

    it('should clear KV cache for a module', async () => {
      const kvNamespace = createMockKVNamespace();
      const loader = new JitLoader({ kvNamespace });

      // Add something to KV
      await kvNamespace.put('module:ext-test:wasm', new ArrayBuffer(8));
      await kvNamespace.put('module:ext-test:meta', JSON.stringify({ version: '1.0' }));

      await loader.clearKVCache('ext-test');

      expect(kvNamespace.delete).toHaveBeenCalledWith('module:ext-test:wasm');
      expect(kvNamespace.delete).toHaveBeenCalledWith('module:ext-test:meta');
    });

    it('should get cache statistics', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo']);

      const stats = loader.getCacheStats();

      expect(stats.memoryEntries).toBe(1);
      expect(stats.memorySize).toBeGreaterThan(0);
      expect(stats.hits).toBeDefined();
      expect(stats.misses).toBeDefined();
      expect(stats.hitRate).toBeDefined();
    });

    it('should reset cache statistics on clear', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo']);
      await loader.loadModules(['ext-geo']); // Cache hit

      let stats = loader.getCacheStats();
      expect(stats.hits).toBe(1);

      loader.clearMemoryCache();
      stats = loader.getCacheStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const loader = new JitLoader();
      // Should not throw
      expect(loader.analyzeQuery('SELECT 1')).toEqual([]);
    });

    it('should accept custom R2 prefix', async () => {
      const wasmBinary = createMockWasmBinary();
      const r2Bucket = {
        get: vi.fn(async (key: string) => {
          if (key === 'custom/prefix/ext-geo.wasm') {
            return {
              key,
              size: wasmBinary.byteLength,
              arrayBuffer: () => Promise.resolve(wasmBinary),
            };
          }
          return null;
        }),
        head: vi.fn(async () => ({ size: wasmBinary.byteLength })),
      };

      const loader = new JitLoader({
        r2Bucket,
        r2Prefix: 'custom/prefix/',
      });

      await loader.loadModules(['ext-geo']);

      expect(r2Bucket.get).toHaveBeenCalledWith('custom/prefix/ext-geo.wasm');
    });

    it('should accept custom assets path', async () => {
      const wasmBinary = createMockWasmBinary();
      const assets = {
        fetch: vi.fn(async (request: Request | string) => {
          const url = typeof request === 'string' ? request : request.url;
          if (url.includes('/custom/wasm/ext-geo.wasm')) {
            return new Response(wasmBinary);
          }
          return new Response(null, { status: 404 });
        }),
      };

      const loader = new JitLoader({
        assets,
        assetsPath: '/custom/wasm',
      });

      await loader.loadModules(['ext-geo']);

      expect(assets.fetch).toHaveBeenCalled();
      const call = assets.fetch.mock.calls[0][0] as Request;
      expect(call.url).toContain('/custom/wasm/ext-geo.wasm');
    });

    it('should enable debug logging when configured', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket, debug: true });

      await loader.loadModules(['ext-geo']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[JitLoader]'));

      consoleSpy.mockRestore();
    });
  });

  describe('Name Normalization', () => {
    it('should normalize .wasm extension', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['ext-geo.wasm']);

      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
      expect(loader.isModuleLoaded('ext-geo.wasm')).toBe(true);
    });

    it('should handle case-insensitive names', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = new JitLoader({ r2Bucket });

      await loader.loadModules(['EXT-GEO']);

      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
      expect(loader.isModuleLoaded('EXT-GEO')).toBe(true);
    });
  });

  describe('Convenience Functions', () => {
    it('createJitLoader should create a new instance', () => {
      const loader = createJitLoader();
      expect(loader).toBeInstanceOf(JitLoader);
    });

    it('createJitLoader should accept configuration', () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = createJitLoader({ r2Bucket });
      expect(loader).toBeInstanceOf(JitLoader);
    });

    it('prepareQuery should analyze and load modules', async () => {
      const r2Bucket = createMockR2Bucket(['ext-geo']);

      const loader = createJitLoader({ r2Bucket });

      const result = await prepareQuery(loader, 'SELECT h3ToGeo(cell) FROM data');

      expect(result.loaded).toContain('ext-geo');
      expect(loader.isModuleLoaded('ext-geo')).toBe(true);
    });

    it('prepareQuery should return empty for core-only queries', async () => {
      const loader = createJitLoader();

      const result = await prepareQuery(loader, 'SELECT 1 + 1');

      expect(result.loaded).toHaveLength(0);
      expect(result.cached).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle R2 fetch errors gracefully', async () => {
      const r2Bucket = {
        get: vi.fn(async () => {
          throw new Error('R2 connection failed');
        }),
        head: vi.fn(async () => ({ size: 100 })),
      };

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-geo']);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('not found');
    });

    it('should handle asset fetch errors gracefully', async () => {
      const assets = {
        fetch: vi.fn(async () => {
          throw new Error('Network error');
        }),
      };

      const loader = new JitLoader({ assets });

      const result = await loader.loadModules(['ext-geo']);

      expect(result.failed).toHaveLength(1);
    });

    it('should continue loading other modules when one fails', async () => {
      const r2Bucket = createMockR2Bucket(['ext-json']);

      const loader = new JitLoader({ r2Bucket });

      const result = await loader.loadModules(['ext-geo', 'ext-json', 'ext-crypto']);

      expect(result.loaded).toContain('ext-json');
      expect(result.failed).toHaveLength(2);
      expect(result.failed.map((f) => f.name)).toContain('ext-geo');
      expect(result.failed.map((f) => f.name)).toContain('ext-crypto');
    });
  });
});
